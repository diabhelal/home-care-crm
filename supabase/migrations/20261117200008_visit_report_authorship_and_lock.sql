-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration
-- (then copy to supabase/migrations/ under the exact registered version name; see supabase/proposed/APPLIED.md).
-- Additive columns (3, nullable) + a one-time backfill of those columns + triggers + two functions replaced
-- (visit_reports_integrity_guard from 008, complete_visit from 003). No clinical value is changed or deleted; grants/policies untouched.
-- Depends on: 003 (complete_visit), 008 (visit_reports_integrity_guard), 015 (block_physical_delete), 20261015155238 (_is_jwt_admin).
--
-- OWNER RULES: (2) only the ORIGINAL AUTHOR may correct a report, and the content of a completed report can change only through
-- an amendment (017); (7) a MANAGER who documents a visit is its author, whatever staff member the visit was assigned to.
--
-- Problem (evidence):
--   * visit_reports records only staff_id (the ASSIGNED nurse). When an administrator completes the visit (complete_visit allows
--     it) the report looks as if the nurse wrote it: authorship is wrong and amendment rights (012) would be given to the
--     wrong person.
--   * The completed-report lock of proposed/008 reads bookings.status. A nurse (bookings policy lets the assigned staff move a
--     visit) or an admin can set the booking back to 'scheduled' and the report content becomes editable again.
--   * visit_reports.clinical_outcome_8h could be overwritten any number of times, also by an admin.
--
-- What changes:
--   1. visit_reports.author_user_id (auth.users id of the person who documented), author_role ('admin' / the staff role), locked_at.
--   2. BACKFILL RULE for legacy rows (run once, below, idempotent): author_user_id := medical_staff.auth_user_id of staff_id,
--      author_role := medical_staff.role; locked_at := created_at for reports whose booking is 'completed'. A legacy report whose
--      staff member has no login stays author_user_id = NULL => NOBODY can amend it through the application (no inheritance);
--      the owner must decide such cases by hand. Legacy reports completed by an admin cannot be told apart and are attributed to
--      the assigned staff member (their staff_id is all the old data holds).
--   3. visit_reports_authorship_lock (BEFORE INSERT/UPDATE): for application callers (role anon/authenticated) author_user_id,
--      author_role and locked_at are server-set and immutable - a client can neither claim authorship nor lock/unlock. Only the
--      SECURITY DEFINER complete_visit (and the DB owner) set them: the trigger detects it through current_user, which a client
--      cannot influence. clinical_outcome_8h becomes set-once (null -> value); a recorded value cannot be rewritten.
--   4. complete_visit(): author_user_id := auth.uid(), author_role := 'admin' for a manager else the staff member's role,
--      locked_at := now(). staff_id stays the ASSIGNMENT. A manager completing a visit is the author with role admin.
--   5. visit_reports_integrity_guard (008) replaced: the lock is keyed on locked_at (not on bookings.status), so reverting the
--      booking no longer unlocks a report. DELETE is refused for every application caller (008 allowed admins; 015 supersedes).
--   6. bookings_completed_status_guard: a booking that has a visit report cannot leave status 'completed'.
--
-- What is NOT changed: data values, RLS policies, grants, the amendment table (017 changes who may amend).
-- LIMITATIONS: the DB owner / SQL editor / service_role (no auth.uid(), role is not anon/authenticated) can still update a locked
-- report; this cannot be prevented from SQL. A blocked statement rolls back its transaction, so it is not logged (see 015).
--
-- Reverse SQL (executable version: docs/STAGING_PLAN.md ROLLBACK 016):
--   drop trigger visit_reports_authorship_lock on public.visit_reports; drop function public.visit_reports_authorship_lock();
--   drop trigger bookings_completed_status_guard on public.bookings; drop function public.bookings_completed_status_guard();
--   re-run 003_complete_visit.sql and 008_visit_report_integrity.sql (restores both functions);
--   alter table public.visit_reports drop column author_user_id, drop column author_role, drop column locked_at;  -- loses authorship

alter table public.visit_reports
  add column if not exists author_user_id uuid,
  add column if not exists author_role    text,
  add column if not exists locked_at      timestamptz;

-- ---- BACKFILL (idempotent; only fills NULLs) ------------------------------------------------------------------
update public.visit_reports vr
   set author_user_id = s.auth_user_id,
       author_role    = s.role
  from public.medical_staff s
 where s.id = vr.staff_id and vr.author_role is null and vr.author_user_id is null;

update public.visit_reports vr
   set locked_at = vr.created_at
  from public.bookings b
 where b.id = vr.booking_id and b.status = 'completed' and vr.locked_at is null;
-- ---- END BACKFILL ---------------------------------------------------------------------------------------------

-- role of a login, readable regardless of the caller's column grants
create or replace function public._author_role_of(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when public._is_jwt_admin() and p_uid = auth.uid() then 'admin'
              else (select s.role from public.medical_staff s where s.auth_user_id = p_uid limit 1) end
$$;
revoke all on function public._author_role_of(uuid) from public, anon;
grant execute on function public._author_role_of(uuid) to authenticated;

create or replace function public.visit_reports_authorship_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon','authenticated') then
    return new;                       -- complete_visit (SECURITY DEFINER), migrations, owner
  end if;
  if tg_op = 'INSERT' then
    new.author_user_id := auth.uid();
    new.author_role    := public._author_role_of(auth.uid());
    new.locked_at      := null;       -- only complete_visit locks
  else
    new.author_user_id := old.author_user_id;
    new.author_role    := old.author_role;
    new.locked_at      := old.locked_at;
    if old.clinical_outcome_8h is not null and new.clinical_outcome_8h is distinct from old.clinical_outcome_8h then
      raise exception 'the 8h clinical outcome was already recorded and cannot be rewritten' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.visit_reports_authorship_lock() from public, anon, authenticated;
drop trigger if exists visit_reports_authorship_lock on public.visit_reports;
create trigger visit_reports_authorship_lock before insert or update on public.visit_reports
  for each row execute function public.visit_reports_authorship_lock();

-- ---- complete_visit: the manager who documents is the author ------------------------------------------------------
create or replace function public.complete_visit(p_booking_id bigint, p_payload jsonb)
returns public.visit_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  b        public.bookings;
  r        public.visit_reports;
  v_admin  boolean := coalesce((((select auth.jwt()) -> 'app_metadata') ->> 'is_admin')::boolean, false);
  v_role   text;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if b.staff_id is distinct from public.current_staff_id() and not v_admin then
    raise exception 'not your booking' using errcode = '42501';
  end if;
  if b.status <> 'scheduled' or b.approval_status <> 'confirmed' then
    raise exception 'illegal state' using errcode = '55000';
  end if;
  if v_admin then
    v_role := 'admin';
  else
    select s.role into v_role from public.medical_staff s where s.id = b.staff_id;
  end if;

  insert into public.visit_reports (
    booking_id, patient_id, staff_id, visit_date,
    systolic_bp, diastolic_bp, blood_sugar, pulse, temperature, oxygen_saturation,
    performed_blood_draw, performed_injection, performed_infusion,
    performed_dressing_change, performed_catheter_change,
    treatment_summary, patient_signature_data,
    author_user_id, author_role, locked_at)
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
    auth.uid(), v_role, now())
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
    patient_signature_data = excluded.patient_signature_data,
    author_user_id = excluded.author_user_id,      -- whoever finalises the documentation is its author
    author_role = excluded.author_role,
    locked_at = excluded.locked_at
  returning * into r;

  update public.bookings
     set status = 'completed', workflow_status = 'assigned'
   where id = p_booking_id;
  return r;
end;
$$;
revoke all on function public.complete_visit(bigint, jsonb) from public, anon;
grant execute on function public.complete_visit(bigint, jsonb) to authenticated;

-- ---- 008 guard replaced: lock keyed on locked_at, no deletes ---------------------------------------------------
create or replace function public.visit_reports_integrity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := public._is_jwt_admin();
  b       public.bookings;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'a visit report is never deleted (void it instead)' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.booking_id is distinct from old.booking_id
       or new.patient_id is distinct from old.patient_id
       or new.staff_id is distinct from old.staff_id then
      raise exception 'visit report identity (booking, patient, staff) is immutable' using errcode = '42501';
    end if;
  end if;

  select * into b from public.bookings where id = new.booking_id;
  if not found then
    raise exception 'booking not found' using errcode = '23503';
  end if;
  if new.patient_id is distinct from b.patient_id or new.staff_id is distinct from b.staff_id then
    raise exception 'visit report must match the booking''s patient and staff member' using errcode = '42501';
  end if;
  if not v_admin and b.staff_id is distinct from public.current_staff_id() then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if b.approval_status <> 'confirmed' or b.status <> 'scheduled' then
      raise exception 'a report may only be created for a confirmed, scheduled visit' using errcode = '55000';
    end if;
  elsif old.locked_at is not null or b.status = 'cancelled' then
    -- locked (complete_visit sets locked_at; reverting the booking does NOT unlock): only the follow-up outcome and the
    -- archive / void markers (018) may change; the content changes only through amendments (017)
    if (to_jsonb(new) - 'clinical_outcome_8h' - 'archived_at' - 'archived_by' - 'archive_reason' - 'voided_at' - 'voided_by' - 'void_reason')
       is distinct from
       (to_jsonb(old) - 'clinical_outcome_8h' - 'archived_at' - 'archived_by' - 'archive_reason' - 'voided_at' - 'voided_by' - 'void_reason') then
      raise exception 'a completed visit report is locked; correct it with an amendment by its author' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.visit_reports_integrity_guard() from public, anon, authenticated;

-- ---- a booking with a report never leaves 'completed' ---------------------------------------------------------
create or replace function public.bookings_completed_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'completed' and new.status is distinct from 'completed'
     and exists (select 1 from public.visit_reports vr where vr.booking_id = old.id) then
    raise exception 'a completed visit that has a report cannot be reopened or cancelled' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.bookings_completed_status_guard() from public, anon, authenticated;
drop trigger if exists bookings_completed_status_guard on public.bookings;
create trigger bookings_completed_status_guard before update of status on public.bookings
  for each row execute function public.bookings_completed_status_guard();
