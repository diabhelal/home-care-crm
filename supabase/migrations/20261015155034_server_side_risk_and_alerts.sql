-- APPLIED to the live project on 2026-10-15 (registered via apply_migration); source: supabase/proposed.
-- (execute_sql iteration -> get_advisors -> apply_migration -> local file with the exact registered version name).
-- Additive; no data deletion. Depends on the existing migrations only (risk_predictions, alerts, tasks,
-- current_staff_id(), is_my_patient()).
--
-- Problem: the browser could INSERT risk_predictions / alerts with client-supplied risk_level,
-- model_version, created_by and timestamps, and UPDATE alerts/tasks with client-supplied
-- acknowledged_by / completed_by / timestamps. A client could forge clinical data.
--
-- After this migration:
--   * risk_predictions and alerts have NO insert grant for authenticated (admin included).
--     The only writers are record_risk_prediction() and record_auto_alert() (SECURITY DEFINER).
--   * Those functions require an HMAC attestation produced by the Python backend (which holds
--     the secret and calls predictive-service). A signed-in user calling the RPC directly
--     cannot invent a risk_level: without the secret the signature does not verify.
--   * created_by / predicted_at / expires_at / patient_id / input_features are derived server-side.
--   * alerts/tasks: BEFORE UPDATE triggers force acknowledged_*/completed_* to auth.uid()/now().
--
-- ONE-TIME OPERATOR STEP after applying (never committed): store the same value the backend has in
-- RISK_ATTESTATION_SECRET (>= 32 random bytes, hex), e.g. in the SQL editor:
--   insert into public.server_secrets(name, value) values ('risk_attestation_secret', '<hex>')
--   on conflict (name) do update set value = excluded.value;
-- Until it exists the functions fail closed (42501).

-- ---------------------------------------------------------------- secret store
create table if not exists public.server_secrets (
  name  text primary key,
  value text not null
);
alter table public.server_secrets enable row level security;     -- no policy: nobody via the API
revoke all on public.server_secrets from public, anon, authenticated;

-- ---------------------------------------------------------------- HMAC-SHA256 (no pgcrypto needed)
create or replace function public._hmac_sha256(p_key bytea, p_msg bytea)
returns bytea
language plpgsql
immutable
as $$
declare
  k bytea := p_key;
  ipad bytea;
  opad bytea;
  i int;
begin
  if length(k) > 64 then k := sha256(k); end if;
  k := k || decode(repeat('00', 64 - length(k)), 'hex');
  ipad := k; opad := k;
  for i in 0..63 loop
    ipad := set_byte(ipad, i, get_byte(k, i) # 54);   -- 0x36
    opad := set_byte(opad, i, get_byte(k, i) # 92);   -- 0x5c
  end loop;
  return sha256(opad || sha256(ipad || p_msg));
end;
$$;
revoke all on function public._hmac_sha256(bytea, bytea) from public, anon, authenticated;

-- Verifies {payload:text, sig:hex}; returns the parsed payload. Fails closed.
create or replace function public._verify_server_attestation(p_att jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_payload text := p_att ->> 'payload';
  v_sig text := lower(coalesce(p_att ->> 'sig', ''));
  v jsonb;
begin
  select value into v_secret from public.server_secrets where name = 'risk_attestation_secret';
  if v_secret is null or v_secret = '' then
    raise exception 'server attestation is not configured' using errcode = '42501';
  end if;
  if v_payload is null or v_sig = ''
     or v_sig <> encode(public._hmac_sha256(convert_to(v_secret, 'UTF8'), convert_to(v_payload, 'UTF8')), 'hex') then
    raise exception 'invalid server attestation' using errcode = '42501';
  end if;
  v := v_payload::jsonb;
  if (v ->> 'uid') is distinct from auth.uid()::text then
    raise exception 'attestation was issued for another user' using errcode = '42501';
  end if;
  if abs(extract(epoch from now()) - (v ->> 'iat')::numeric) > 300 then   -- backend ATTESTATION_TTL_SECONDS
    raise exception 'attestation expired' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function public._verify_server_attestation(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- shared alert insert (dedupe like the browser did)
create or replace function public._insert_auto_alert(p_patient uuid, p_prediction bigint, p_alert jsonb)
returns public.alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.alerts;
begin
  if p_alert is null or jsonb_typeof(p_alert) <> 'object' then
    return null;
  end if;
  if p_alert ->> 'alert_type' not in ('new_red','worsening_trend','vital_anomaly','repeated_abnormal')
     or p_alert ->> 'severity' not in ('low','medium','high')
     or coalesce(btrim(p_alert ->> 'message'), '') = '' then
    raise exception 'invalid alert' using errcode = '22023';
  end if;
  -- an open alert of the same type already exists: do not duplicate
  if exists (select 1 from public.alerts
              where patient_id = p_patient and alert_type = p_alert ->> 'alert_type' and status = 'open') then
    return null;
  end if;
  insert into public.alerts (patient_id, risk_prediction_id, alert_type, severity, message)
  values (p_patient, p_prediction, p_alert ->> 'alert_type', p_alert ->> 'severity',
          left(p_alert ->> 'message', 1000))
  returning * into a;
  return a;
end;
$$;
revoke all on function public._insert_auto_alert(uuid, bigint, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- record_risk_prediction
-- ONE transaction: prediction (+ alert). Idempotent per visit report: visit reports are immutable
-- once completed, so a second call returns the stored prediction instead of appending another.
create or replace function public.record_risk_prediction(p_report_id bigint, p_assessment jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := coalesce((((select auth.jwt()) -> 'app_metadata') ->> 'is_admin')::boolean, false);
  r public.visit_reports;
  b public.bookings;
  v jsonb;
  p public.risk_predictions;
  v_alert public.alerts;
  v_horizon int;
  v_trend text;
  v_conf numeric;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into r from public.visit_reports where id = p_report_id for update;
  if not found then
    raise exception 'visit report not found' using errcode = 'P0002';
  end if;
  select * into b from public.bookings where id = r.booking_id;
  -- assigned staff of the report's booking, or an admin (identity from the verified JWT)
  if not v_admin and b.staff_id is distinct from public.current_staff_id() then
    raise exception 'not your visit report' using errcode = '42501';
  end if;

  v := public._verify_server_attestation(p_assessment);
  if v ->> 'kind' is distinct from 'risk' or (v ->> 'report_id')::bigint is distinct from p_report_id then
    raise exception 'attestation does not match this report' using errcode = '42501';
  end if;

  select * into p from public.risk_predictions where visit_report_id = p_report_id
   order by predicted_at desc limit 1;
  if found then
    return jsonb_build_object('prediction', to_jsonb(p), 'alert', null, 'created', false);
  end if;

  if v ->> 'risk_level' not in ('green','yellow','red') then
    raise exception 'invalid risk_level' using errcode = '22023';
  end if;
  v_trend := nullif(v ->> 'trend', '');
  if v_trend is not null and v_trend not in ('improving','stable','worsening') then
    raise exception 'invalid trend' using errcode = '22023';
  end if;
  v_horizon := (v ->> 'horizon_hours')::int;
  if v_horizon is null or v_horizon < 1 or v_horizon > 168 then
    raise exception 'invalid horizon' using errcode = '22023';
  end if;
  v_conf := (v ->> 'confidence')::numeric;
  if v_conf is not null and (v_conf < 0 or v_conf > 1) then
    raise exception 'invalid confidence' using errcode = '22023';
  end if;

  insert into public.risk_predictions (
    patient_id, visit_report_id, predicted_at, input_features, risk_level, confidence,
    prediction_horizon_hours, expires_at, model_version, trend, probability, created_by)
  values (
    r.patient_id, r.id, now(),
    jsonb_build_object('systolic_bp', r.systolic_bp, 'diastolic_bp', r.diastolic_bp,
                       'blood_sugar', r.blood_sugar, 'pulse', r.pulse,
                       'temperature', r.temperature, 'oxygen_saturation', r.oxygen_saturation),
    v ->> 'risk_level', v_conf, v_horizon, now() + make_interval(hours => v_horizon),
    left(coalesce(nullif(v ->> 'model_version', ''), 'rule-based-v1'), 64),
    v_trend, (v ->> 'probability')::numeric, auth.uid())
  returning * into p;

  v_alert := public._insert_auto_alert(r.patient_id, p.id, v -> 'alert');

  return jsonb_build_object('prediction', to_jsonb(p), 'alert', to_jsonb(v_alert), 'created', true);
end;
$$;
revoke all on function public.record_risk_prediction(bigint, jsonb) from public, anon;
grant execute on function public.record_risk_prediction(bigint, jsonb) to authenticated;

-- ---------------------------------------------------------------- record_auto_alert
-- Comprehensive-diagnosis alert (no prediction row). Admin or staff assigned to the patient.
create or replace function public.record_auto_alert(p_patient_id uuid, p_assessment jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := coalesce((((select auth.jwt()) -> 'app_metadata') ->> 'is_admin')::boolean, false);
  v jsonb;
  v_alert public.alerts;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not v_admin and not public.is_my_patient(p_patient_id) then
    raise exception 'not your patient' using errcode = '42501';
  end if;
  v := public._verify_server_attestation(p_assessment);
  if v ->> 'kind' is distinct from 'alert' or (v ->> 'patient_id')::uuid is distinct from p_patient_id then
    raise exception 'attestation does not match this patient' using errcode = '42501';
  end if;
  v_alert := public._insert_auto_alert(p_patient_id, null, v -> 'alert');
  return jsonb_build_object('alert', to_jsonb(v_alert), 'created', v_alert.id is not null);
end;
$$;
revoke all on function public.record_auto_alert(uuid, jsonb) from public, anon;
grant execute on function public.record_auto_alert(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- no direct inserts any more
revoke insert on public.risk_predictions from authenticated;
revoke insert on public.alerts from authenticated;
revoke usage, select on sequence public.risk_predictions_id_seq from authenticated;
-- (the insert RLS policies stay in place but are unreachable without the table privilege)

-- ---------------------------------------------------------------- alerts: server-side acknowledge / immutability
-- JWT callers only (auth.uid() is null for migrations / SQL editor / service role).
create or replace function public.alerts_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.patient_id is distinct from old.patient_id
     or new.risk_prediction_id is distinct from old.risk_prediction_id
     or new.alert_type is distinct from old.alert_type
     or new.severity is distinct from old.severity
     or new.message is distinct from old.message
     or new.created_at is distinct from old.created_at then
    raise exception 'alert content is immutable' using errcode = '42501';
  end if;
  -- whatever acknowledged_* the client sent is ignored
  new.acknowledged_by := old.acknowledged_by;
  new.acknowledged_at := old.acknowledged_at;
  if new.status is distinct from old.status then
    if new.status = 'acknowledged' then
      new.acknowledged_by := auth.uid();
      new.acknowledged_at := now();
    elsif new.status = 'open' then
      new.acknowledged_by := null;
      new.acknowledged_at := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists alerts_guard_update on public.alerts;
create trigger alerts_guard_update before update on public.alerts
  for each row execute function public.alerts_guard_update();

-- ---------------------------------------------------------------- tasks: server-side created_by / completed_*
create or replace function public.tasks_guard_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    new.status := 'pending';
    new.completed_by := null;
    new.completed_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_guard_insert on public.tasks;
create trigger tasks_guard_insert before insert on public.tasks
  for each row execute function public.tasks_guard_insert();

create or replace function public.tasks_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.patient_id is distinct from old.patient_id
     or new.alert_id is distinct from old.alert_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'task identity is immutable' using errcode = '42501';
  end if;
  new.completed_by := old.completed_by;
  new.completed_at := old.completed_at;
  if new.status is distinct from old.status then
    if new.status = 'completed' then
      new.completed_by := auth.uid();
      new.completed_at := now();
    else
      new.completed_by := null;
      new.completed_at := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_guard_update on public.tasks;
create trigger tasks_guard_update before update on public.tasks
  for each row execute function public.tasks_guard_update();
