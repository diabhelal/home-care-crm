-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration
-- (then copy to supabase/migrations/ under the exact registered version name; see supabase/proposed/APPLIED.md).
-- Additive only: ONE new table + triggers. No existing table, row, policy or grant is changed.
-- Depends on: visit_reports, patients, 20261015155238 (public._is_jwt_admin), current_staff_id()/is_my_patient() (staff identity).
--
-- Purpose: a completed visit report is locked (008). A mistake or a missing detail is recorded as a NEW, append-only
-- amendment that points at the original report: who, when, why, and (optionally) the corrected value of a vital sign or the
-- treatment summary. The original report is never edited or deleted, so the order and the change of results stay visible
-- (the UI shows the corrected value marked as corrected next to the original).
--
-- Rules (callers with a JWT subject; rows written without one, e.g. migrations, are not restricted, as in 005-008):
--   * INSERT only: no UPDATE and no DELETE by anyone with a JWT (administrators included); authenticated has no such grant.
--   * patient_id is taken from the report; author, role and time are set by the server, never by the client.
--   * the amending user must be the report's assigned staff member or an administrator.
--   * corrections may only contain the vital-sign keys and treatment_summary, with the same ranges as the visit_reports CHECKs.
--   * a reason is mandatory.
--   * visit_report_id and patient_id use ON DELETE RESTRICT: a report that has amendments cannot be erased by a cascade.
--
-- Reverse SQL:
--   drop table if exists public.visit_report_amendments;
--   drop function if exists public.visit_report_amendments_guard();

create table if not exists public.visit_report_amendments (
  id              bigint generated always as identity primary key,
  visit_report_id bigint not null references public.visit_reports(id) on delete restrict,
  patient_id      uuid   not null references public.patients(id) on delete restrict,
  amended_by      uuid   not null default auth.uid(),
  amended_by_role text,
  reason          text   not null check (length(btrim(reason)) between 3 and 2000),
  corrections     jsonb  not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists visit_report_amendments_report_idx  on public.visit_report_amendments (visit_report_id);
create index if not exists visit_report_amendments_patient_idx on public.visit_report_amendments (patient_id, created_at desc);

alter table public.visit_report_amendments enable row level security;

create or replace function public.visit_report_amendments_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.visit_reports;
  v_role text;
  k      text;
  val    jsonb;
  n      numeric;
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null then
      raise exception 'amendments are append-only' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if auth.uid() is not null then
      raise exception 'amendments are append-only' using errcode = '42501';
    end if;
    return new;
  end if;

  select * into r from public.visit_reports where id = new.visit_report_id;
  if not found then
    raise exception 'visit report not found' using errcode = '23503';
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if not public._is_jwt_admin() and r.staff_id is distinct from public.current_staff_id() then
    raise exception 'not your visit report' using errcode = '42501';
  end if;

  new.patient_id  := r.patient_id;
  new.amended_by  := auth.uid();
  new.created_at  := now();
  if public._is_jwt_admin() then
    new.amended_by_role := 'admin';
  else
    select role into v_role from public.medical_staff where auth_user_id = auth.uid() limit 1;
    new.amended_by_role := v_role;
  end if;

  if jsonb_typeof(new.corrections) is distinct from 'object' then
    raise exception 'corrections must be a JSON object' using errcode = '22023';
  end if;
  for k, val in select * from jsonb_each(new.corrections) loop
    if k = 'treatment_summary' then
      if jsonb_typeof(val) <> 'string' or length(btrim(val #>> '{}')) = 0 then
        raise exception 'invalid corrected treatment_summary' using errcode = '22023';
      end if;
    elsif k in ('systolic_bp','diastolic_bp','blood_sugar','pulse','temperature','oxygen_saturation') then
      if jsonb_typeof(val) <> 'number' then
        raise exception 'corrected % must be a number', k using errcode = '22023';
      end if;
      n := (val #>> '{}')::numeric;
      if (k = 'systolic_bp'       and n not between 50 and 250)
      or (k = 'diastolic_bp'      and n not between 30 and 150)
      or (k = 'blood_sugar'       and n not between 20 and 600)
      or (k = 'pulse'             and n not between 30 and 220)
      or (k = 'temperature'       and n not between 30 and 45)
      or (k = 'oxygen_saturation' and n not between 50 and 100) then
        raise exception 'corrected % is out of the allowed range', k using errcode = '23514';
      end if;
    else
      raise exception 'field % cannot be corrected through an amendment', k using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.visit_report_amendments_guard() from public, anon, authenticated;

drop trigger if exists visit_report_amendments_guard on public.visit_report_amendments;
create trigger visit_report_amendments_guard before insert or update or delete on public.visit_report_amendments
  for each row execute function public.visit_report_amendments_guard();

drop trigger if exists audit_visit_report_amendments on public.visit_report_amendments;
create trigger audit_visit_report_amendments after insert on public.visit_report_amendments
  for each row execute function public.log_audit_change();

revoke all on public.visit_report_amendments from public, anon, authenticated;
grant select, insert on public.visit_report_amendments to authenticated;
grant usage, select on sequence public.visit_report_amendments_id_seq to authenticated;

drop policy if exists admin_select_visit_report_amendments on public.visit_report_amendments;
create policy admin_select_visit_report_amendments on public.visit_report_amendments for select to authenticated
  using (public._is_jwt_admin());
drop policy if exists admin_insert_visit_report_amendments on public.visit_report_amendments;
create policy admin_insert_visit_report_amendments on public.visit_report_amendments for insert to authenticated
  with check (public._is_jwt_admin());
drop policy if exists staff_select_assigned_visit_report_amendments on public.visit_report_amendments;
create policy staff_select_assigned_visit_report_amendments on public.visit_report_amendments for select to authenticated
  using (public.is_my_patient(patient_id));
drop policy if exists staff_insert_own_visit_report_amendments on public.visit_report_amendments;
create policy staff_insert_own_visit_report_amendments on public.visit_report_amendments for insert to authenticated
  with check (exists (select 1 from public.visit_reports vr
                       where vr.id = visit_report_id and vr.staff_id = public.current_staff_id()));
drop policy if exists patient_select_own_visit_report_amendments on public.visit_report_amendments;
create policy patient_select_own_visit_report_amendments on public.visit_report_amendments for select to authenticated
  using (patient_id = (select auth.uid()));
