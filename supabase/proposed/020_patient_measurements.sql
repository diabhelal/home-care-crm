-- PROPOSED, NOT APPLIED to any database. Review -> isolated-Postgres tests -> get_advisors -> apply_migration
-- (then copy to supabase/migrations/ under the exact registered version name; see supabase/proposed/APPLIED.md).
-- Additive only: ONE new table + one guard function/trigger. No existing table, row, policy or grant is changed.
-- Depends on: patients, public._is_jwt_admin() (20261015155238), current_staff_id()/is_my_patient() (staff identity; 019 narrows
-- is_my_patient and this file follows whichever definition is applied), public.log_audit_change().
--
-- Purpose: let authorised staff add a vital-sign measurement to a patient's chart OUTSIDE a booking (a follow-up reading taken at
-- another time), without touching a completed/locked visit report. visit_reports needs a booking (booking_id NOT NULL UNIQUE) and
-- is locked at completion; amendments (012/017) correct a signed report. This table is the third, separate path: a NEW record.
--
-- Two timestamps, never confused:
--   measured_at  = when the measurement was taken (entered by the user, may be in the past, never in the future);
--   recorded_at  = when it was entered (server clock, set by the trigger, not editable).
--
-- booking_id is OPTIONAL: several readings during one visit (start/middle/end) keep their visit link; NULL = outside any visit.
--
-- Rules (callers with a JWT subject; rows written without one, e.g. migrations, are not restricted, as in 005-012):
--   * INSERT only: no UPDATE and no DELETE by anyone with a JWT (administrators included); authenticated has no such grant.
--   * allowed for an administrator, or for the staff member ASSIGNED to the patient (is_my_patient). Nobody else; patients cannot write.
--   * recorded_by / recorded_by_role / recorded_at are set by the server, never by the client.
--   * at least one vital sign; the same ranges as the visit_reports CHECKs (no new clinical thresholds).
--   * measured_at must not be in the future (5 minutes of clock skew tolerated).
--   * patient_id uses ON DELETE RESTRICT: a patient with measurements cannot be erased by a cascade.
-- OPEN OWNER DECISIONS (defaults chosen here, each a one-line change): (a) no lower bound on how far in the past measured_at may
-- be (a reason for old readings is NOT required); (b) these readings are NOT used by the risk engine (display/history only);
-- (c) patients cannot read them (no patient SELECT policy).
--
-- Reverse SQL (executable version: docs/STAGING_PLAN.md ROLLBACK 020):
--   drop table if exists public.patient_measurements;
--   drop function if exists public.patient_measurements_guard();

create table if not exists public.patient_measurements (
  id                bigint generated always as identity primary key,
  patient_id        uuid   not null references public.patients(id) on delete restrict,
  booking_id        bigint references public.bookings(id) on delete restrict,  -- optional: the visit this reading belongs to (NULL = taken outside any visit)
  measured_at       timestamptz not null,
  recorded_at       timestamptz not null default now(),
  recorded_by       uuid   not null default auth.uid(),
  recorded_by_role  text,
  systolic_bp       int check (systolic_bp between 50 and 250),
  diastolic_bp      int check (diastolic_bp between 30 and 150),
  blood_sugar       int check (blood_sugar between 20 and 600),
  pulse             int check (pulse between 30 and 220),
  temperature       numeric(4,1) check (temperature between 30.0 and 45.0),
  oxygen_saturation int check (oxygen_saturation between 50 and 100),
  note              text check (note is null or length(btrim(note)) between 1 and 2000),
  constraint patient_measurements_has_a_value check (
    systolic_bp is not null or diastolic_bp is not null or blood_sugar is not null
    or pulse is not null or temperature is not null or oxygen_saturation is not null)
);
create index if not exists patient_measurements_booking_idx on public.patient_measurements (booking_id) where booking_id is not null;
create index if not exists patient_measurements_patient_idx on public.patient_measurements (patient_id, measured_at desc);

alter table public.patient_measurements enable row level security;

create or replace function public.patient_measurements_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if auth.uid() is not null then
      raise exception 'measurements are append-only' using errcode = '42501';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if auth.uid() is null then
    return new;
  end if;
  if not public._is_jwt_admin() and not public.is_my_patient(new.patient_id) then
    raise exception 'not your patient' using errcode = '42501';
  end if;
  if new.booking_id is not null and not exists (
       select 1 from public.bookings b where b.id = new.booking_id and b.patient_id = new.patient_id) then
    raise exception 'booking does not belong to this patient' using errcode = '22023';
  end if;
  if new.measured_at > now() + interval '5 minutes' then
    raise exception 'measured_at cannot be in the future' using errcode = '22023';
  end if;

  new.recorded_by := auth.uid();
  new.recorded_at := now();
  if public._is_jwt_admin() then
    new.recorded_by_role := 'admin';
  else
    select role into v_role from public.medical_staff where auth_user_id = auth.uid() limit 1;
    new.recorded_by_role := v_role;
  end if;
  return new;
end;
$$;
revoke all on function public.patient_measurements_guard() from public, anon, authenticated;

drop trigger if exists patient_measurements_guard on public.patient_measurements;
create trigger patient_measurements_guard before insert or update or delete on public.patient_measurements
  for each row execute function public.patient_measurements_guard();

drop trigger if exists audit_patient_measurements on public.patient_measurements;
create trigger audit_patient_measurements after insert on public.patient_measurements
  for each row execute function public.log_audit_change();

revoke all on public.patient_measurements from public, anon, authenticated;
grant select, insert on public.patient_measurements to authenticated;
grant usage, select on sequence public.patient_measurements_id_seq to authenticated;

drop policy if exists admin_select_patient_measurements on public.patient_measurements;
create policy admin_select_patient_measurements on public.patient_measurements for select to authenticated
  using (public._is_jwt_admin());
drop policy if exists admin_insert_patient_measurements on public.patient_measurements;
create policy admin_insert_patient_measurements on public.patient_measurements for insert to authenticated
  with check (public._is_jwt_admin());
drop policy if exists staff_select_assigned_patient_measurements on public.patient_measurements;
create policy staff_select_assigned_patient_measurements on public.patient_measurements for select to authenticated
  using (public.is_my_patient(patient_id));
drop policy if exists staff_insert_assigned_patient_measurements on public.patient_measurements;
create policy staff_insert_assigned_patient_measurements on public.patient_measurements for insert to authenticated
  with check (public.is_my_patient(patient_id));
