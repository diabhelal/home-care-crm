-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration
-- (then copy to supabase/migrations/ under the exact registered version name; see supabase/proposed/APPLIED.md).
-- Additive: 8 nullable/defaulted columns on visit_reports, one trigger, and CREATE OR REPLACE of complete_visit (003) that reads optional keys.
-- No row is changed or deleted; no policy or grant is changed. Without this migration the AI feature still works, but provenance is NOT stored
-- (the backend then answers ai_provenance_saved=false and the UI says so).
-- Depends on: 20261015154103 (complete_visit), visit_reports, audit trigger on visit_reports.
--
-- What it stores for a visit documented with an AI-drafted summary:
--   treatment_summary   unchanged: the FINAL human-approved text (what every screen already shows)
--   source_notes        the nurse's original notes (the source the draft was generated from)
--   ai_assisted         true only when the nurse completed the visit with an approved, signed draft
--   ai_edited           whether the final text differs from the generated draft (decided by the backend from the signed token)
--   ai_model, ai_prompt_version, ai_generation_id   reference to the generation (no provider response is stored)
--   ai_approved_by / ai_approved_at   SET BY THE DATABASE (auth.uid(), now()) - never taken from the client
-- The existing audit trigger on visit_reports records every insert/update of these columns in audit_log; that is the only audit trail claimed.
--
-- Reverse SQL:
--   drop trigger if exists visit_reports_ai_provenance_guard on public.visit_reports;
--   drop function if exists public.visit_reports_ai_provenance_guard();
--   -- restore complete_visit from supabase/migrations/20261015154103_complete_visit.sql, then:
--   alter table public.visit_reports drop column if exists source_notes, drop column if exists ai_assisted, drop column if exists ai_edited,
--     drop column if exists ai_model, drop column if exists ai_prompt_version, drop column if exists ai_generation_id,
--     drop column if exists ai_approved_by, drop column if exists ai_approved_at;

alter table public.visit_reports
  add column if not exists source_notes       text check (source_notes is null or length(source_notes) <= 5000),
  add column if not exists ai_assisted        boolean not null default false,
  add column if not exists ai_edited          boolean,
  add column if not exists ai_model           text check (ai_model is null or length(ai_model) <= 100),
  add column if not exists ai_prompt_version  text check (ai_prompt_version is null or length(ai_prompt_version) <= 60),
  add column if not exists ai_generation_id   text check (ai_generation_id is null or length(ai_generation_id) <= 64),
  add column if not exists ai_approved_by     uuid,
  add column if not exists ai_approved_at     timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'visit_reports_ai_columns_consistent') then
    alter table public.visit_reports add constraint visit_reports_ai_columns_consistent check (
      ai_assisted or (ai_edited is null and ai_model is null and ai_prompt_version is null and ai_generation_id is null
                      and ai_approved_by is null and ai_approved_at is null));
  end if;
end $$;

-- Provenance is written once and then immutable for callers with a JWT; approver/time cannot be forged through a direct write either.
create or replace function public.visit_reports_ai_provenance_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.ai_assisted then
      new.ai_approved_by := auth.uid();
      new.ai_approved_at := now();
    else
      new.ai_edited := null; new.ai_model := null; new.ai_prompt_version := null; new.ai_generation_id := null;
      new.ai_approved_by := null; new.ai_approved_at := null;
    end if;
  else
    new.source_notes := old.source_notes;
    new.ai_assisted := old.ai_assisted; new.ai_edited := old.ai_edited; new.ai_model := old.ai_model;
    new.ai_prompt_version := old.ai_prompt_version; new.ai_generation_id := old.ai_generation_id;
    new.ai_approved_by := old.ai_approved_by; new.ai_approved_at := old.ai_approved_at;
  end if;
  return new;
end;
$$;
revoke all on function public.visit_reports_ai_provenance_guard() from public, anon, authenticated;
drop trigger if exists visit_reports_ai_provenance_guard on public.visit_reports;
create trigger visit_reports_ai_provenance_guard before insert or update on public.visit_reports
  for each row execute function public.visit_reports_ai_provenance_guard();

-- complete_visit: identical to 003 plus the optional provenance keys. The upsert on re-save keeps the same rule.
create or replace function public.complete_visit(p_booking_id bigint, p_payload jsonb)
returns public.visit_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  r public.visit_reports;
  v_ai boolean := coalesce((p_payload->>'ai_assisted')::boolean, false);
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if b.staff_id is distinct from public.current_staff_id()
     and not coalesce((((select auth.jwt()) -> 'app_metadata') ->> 'is_admin')::boolean, false) then
    raise exception 'not your booking' using errcode = '42501';
  end if;
  if b.status <> 'scheduled' or b.approval_status <> 'confirmed' then
    raise exception 'illegal state' using errcode = '55000';
  end if;

  insert into public.visit_reports (
    booking_id, patient_id, staff_id, visit_date,
    systolic_bp, diastolic_bp, blood_sugar, pulse, temperature, oxygen_saturation,
    performed_blood_draw, performed_injection, performed_infusion,
    performed_dressing_change, performed_catheter_change,
    treatment_summary, patient_signature_data,
    source_notes, ai_assisted, ai_edited, ai_model, ai_prompt_version, ai_generation_id, ai_approved_by, ai_approved_at)
  values (
    b.id, b.patient_id, b.staff_id, now(),
    (p_payload->>'systolic_bp')::int, (p_payload->>'diastolic_bp')::int,
    (p_payload->>'blood_sugar')::int, (p_payload->>'pulse')::int,
    (p_payload->>'temperature')::numeric, (p_payload->>'oxygen_saturation')::int,
    coalesce((p_payload->>'performed_blood_draw')::boolean, false),
    coalesce((p_payload->>'performed_injection')::boolean, false),
    coalesce((p_payload->>'performed_infusion')::boolean, false),
    coalesce((p_payload->>'performed_dressing_change')::boolean, false),
    coalesce((p_payload->>'performed_catheter_change')::boolean, false),
    p_payload->>'treatment_summary', p_payload->>'patient_signature_data',
    nullif(p_payload->>'source_notes', ''), v_ai,
    case when v_ai then coalesce((p_payload->>'ai_edited')::boolean, false) end,
    case when v_ai then left(p_payload->>'ai_model', 100) end,
    case when v_ai then left(p_payload->>'ai_prompt_version', 60) end,
    case when v_ai then left(p_payload->>'ai_generation_id', 64) end,
    case when v_ai then auth.uid() end,
    case when v_ai then now() end)
  on conflict (booking_id) do update set
    systolic_bp = excluded.systolic_bp, diastolic_bp = excluded.diastolic_bp,
    blood_sugar = excluded.blood_sugar, pulse = excluded.pulse,
    temperature = excluded.temperature, oxygen_saturation = excluded.oxygen_saturation,
    performed_blood_draw = excluded.performed_blood_draw,
    performed_injection = excluded.performed_injection,
    performed_infusion = excluded.performed_infusion,
    performed_dressing_change = excluded.performed_dressing_change,
    performed_catheter_change = excluded.performed_catheter_change,
    treatment_summary = excluded.treatment_summary,
    patient_signature_data = excluded.patient_signature_data
  returning * into r;

  update public.bookings
     set status = 'completed', workflow_status = 'assigned'
   where id = p_booking_id;
  return r;
end;
$$;

revoke all on function public.complete_visit(bigint, jsonb) from public, anon;
grant execute on function public.complete_visit(bigint, jsonb) to authenticated;
