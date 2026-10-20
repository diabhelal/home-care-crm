-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration
-- (then copy to supabase/migrations/ under the exact registered version name; see supabase/proposed/APPLIED.md).
-- Additive only: 3 nullable columns on patients, 1 new append-only table, 2 functions/triggers. No row is changed or deleted,
-- no existing policy or grant is changed.
-- Depends on: 012 (visit_report_amendments), 20261015155238 (public._is_jwt_admin), the medical-record tables, audit_log.
--
-- Purpose: legal-grade record keeping.
--   1. ARCHIVE a patient instead of ever deleting: patients.archived_at / archived_by / archive_reason. Only an administrator may
--      change them (server sets archived_by); every change is already captured by the audit trigger on patients (old and new
--      row). An archived patient and the whole history stay readable and exportable; nothing is removed.
--   2. EXPORT the complete record on request of the patient or a legal body: public.export_patient_record(...) is administrator
--      only and, in the SAME transaction, writes an append-only row to record_access_log (who exported, when, for whom, on what
--      stated basis, how many rows of each kind). The record cannot be exported without leaving that trace.
-- The retention period is NOT enforced or hard-coded here: it is a legal decision. Nothing is ever deleted automatically, and
-- record_access_log.patient_id is ON DELETE RESTRICT, so a patient with an export history cannot be erased by a cascade.
--
-- Reverse SQL:
--   drop function if exists public.export_patient_record(uuid, text, text, text);
--   drop table if exists public.record_access_log;
--   drop trigger if exists patients_archive_guard on public.patients;
--   drop function if exists public.patients_archive_guard();
--   alter table public.patients drop column if exists archived_at, drop column if exists archived_by, drop column if exists archive_reason;

alter table public.patients
  add column if not exists archived_at   timestamptz,
  add column if not exists archived_by   uuid,
  add column if not exists archive_reason text;

create or replace function public.patients_archive_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.archived_at is distinct from old.archived_at
     or new.archived_by is distinct from old.archived_by
     or new.archive_reason is distinct from old.archive_reason then
    if not public._is_jwt_admin() then
      raise exception 'only an administrator may archive or restore a patient' using errcode = '42501';
    end if;
    if new.archived_at is not null then
      if new.archived_at is distinct from old.archived_at then
        if new.archive_reason is null or length(btrim(new.archive_reason)) < 3 then
          raise exception 'a reason is required to archive a patient' using errcode = '23514';
        end if;
        new.archived_at := now();
      end if;
      new.archived_by := auth.uid();
    else
      new.archived_by := null;
      new.archive_reason := null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.patients_archive_guard() from public, anon, authenticated;
drop trigger if exists patients_archive_guard on public.patients;
create trigger patients_archive_guard before update on public.patients
  for each row execute function public.patients_archive_guard();

create table if not exists public.record_access_log (
  id             bigint generated always as identity primary key,
  patient_id     uuid not null references public.patients(id) on delete restrict,
  requester_type text not null check (requester_type in ('patient','legal','authority','internal','other')),
  requester_name text,
  basis          text not null check (length(btrim(basis)) >= 3),
  exported_by    uuid not null,
  exported_at    timestamptz not null default now(),
  scope          jsonb not null default '{}'::jsonb
);
create index if not exists record_access_log_patient_idx on public.record_access_log (patient_id, exported_at desc);
alter table public.record_access_log enable row level security;
revoke all on public.record_access_log from public, anon, authenticated;
grant select on public.record_access_log to authenticated;
drop policy if exists admin_select_record_access_log on public.record_access_log;
create policy admin_select_record_access_log on public.record_access_log for select to authenticated
  using (public._is_jwt_admin());

create or replace function public.record_access_log_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE','DELETE') and auth.uid() is not null then
    raise exception 'the record access log is append-only' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.record_access_log_guard() from public, anon, authenticated;
drop trigger if exists record_access_log_guard on public.record_access_log;
create trigger record_access_log_guard before update or delete on public.record_access_log
  for each row execute function public.record_access_log_guard();

create or replace function public.export_patient_record(
  p_patient_id uuid, p_requester_type text, p_requester_name text, p_basis text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pid text := p_patient_id::text;
  v_patient jsonb;
  v_scope   jsonb;
  v_log     public.record_access_log;
  v_rec     jsonb;
begin
  if auth.uid() is null or not public._is_jwt_admin() then
    raise exception 'only an administrator may export a patient record' using errcode = '42501';
  end if;
  if p_requester_type is null or p_requester_type not in ('patient','legal','authority','internal','other') then
    raise exception 'invalid requester type' using errcode = '22023';
  end if;
  if p_basis is null or length(btrim(p_basis)) < 3 then
    raise exception 'the basis of the request is required' using errcode = '22023';
  end if;
  select to_jsonb(p) into v_patient from public.patients p where p.id = p_patient_id;
  if v_patient is null then
    raise exception 'patient not found' using errcode = 'P0002';
  end if;

  v_rec := jsonb_build_object(
    'patient',                 v_patient,
    'allergies',               coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.patient_allergies x where x.patient_id = p_patient_id), '[]'),
    'medical_history',         coalesce((select jsonb_agg(to_jsonb(x)) from public.patient_medical_history x where x.patient_id = p_patient_id), '[]'),
    'bookings',                coalesce((select jsonb_agg(to_jsonb(x) order by x.scheduled_at) from public.bookings x where x.patient_id = p_patient_id), '[]'),
    'visit_reports',           coalesce((select jsonb_agg(to_jsonb(x) order by x.visit_date) from public.visit_reports x where x.patient_id = p_patient_id), '[]'),
    'visit_report_amendments', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.visit_report_amendments x where x.patient_id = p_patient_id), '[]'),
    'risk_predictions',        coalesce((select jsonb_agg(to_jsonb(x) order by x.predicted_at) from public.risk_predictions x where x.patient_id = p_patient_id), '[]'),
    'alerts',                  coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.alerts x where x.patient_id = p_patient_id), '[]'),
    'tasks',                   coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.tasks x where x.patient_id = p_patient_id), '[]'),
    'clinical_notes',          coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.clinical_notes x where x.patient_id = p_patient_id), '[]'),
    'medication_events',       coalesce((select jsonb_agg(to_jsonb(x) order by x.administered_at) from public.medication_events x where x.patient_id = p_patient_id), '[]'),
    'service_plans',           coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.service_plans x where x.patient_id = p_patient_id), '[]'),
    'service_plan_visits',     coalesce((select jsonb_agg(to_jsonb(v) order by v.id) from public.service_plan_visits v join public.service_plans sp on sp.id = v.service_plan_id where sp.patient_id = p_patient_id), '[]'),
    'documents_metadata',      coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.patient_documents x where x.patient_id = p_patient_id), '[]'),
    'contacts',                coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.patient_contacts x where x.patient_id = p_patient_id), '[]'),
    'audit_log',               coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.audit_log a
                                          where (a.table_name = 'patients' and a.row_id = pid) or a.new_data ->> 'patient_id' = pid), '[]')
  );
  v_scope := (select jsonb_object_agg(k, jsonb_array_length(v)) from jsonb_each(v_rec - 'patient') as t(k, v));

  insert into public.record_access_log (patient_id, requester_type, requester_name, basis, exported_by, scope)
  values (p_patient_id, p_requester_type, nullif(btrim(p_requester_name), ''), btrim(p_basis), auth.uid(), v_scope)
  returning * into v_log;

  return v_rec || jsonb_build_object('export', jsonb_build_object(
    'log_id', v_log.id, 'exported_at', v_log.exported_at, 'exported_by', v_log.exported_by,
    'requester_type', v_log.requester_type, 'requester_name', v_log.requester_name, 'basis', v_log.basis, 'scope', v_scope));
end;
$$;
revoke all on function public.export_patient_record(uuid, text, text, text) from public, anon;
grant execute on function public.export_patient_record(uuid, text, text, text) to authenticated;
