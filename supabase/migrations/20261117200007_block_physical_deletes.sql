-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration
-- (then copy to supabase/migrations/ under the exact registered version name; see supabase/proposed/APPLIED.md).
-- No row is changed or deleted. Changes: grants (DELETE/TRUNCATE revoked), triggers, FK delete actions, one CHECK, one function
-- replaced (log_audit_change), one storage policy replaced.
-- Depends on: 009 (staff FKs RESTRICT - asserted below, not repeated), 012 (visit_report_amendments), 013 (record_access_log),
--             20261015155238 (public._is_jwt_admin), audit_log + log_audit_change (20260913220259).
--
-- OWNER RULE: medical records are never physically deleted through application workflows ("delete" = archive/void, see 018).
--
-- Problem (CONFIRMED by catalog read on the live project, migrations 001-007 only, and on the isolated database):
--   * role authenticated has DELETE on visit_reports, patient_allergies, patient_medical_history, medication_events,
--     patient_documents, service_plans, service_plan_visits, tasks, alerts, patient_contacts, medical_staff;
--     policies admin_full_access_* (ALL) and staff_full_access_own_visit_reports (ALL) let an admin / the author delete rows.
--   * patients -> every clinical table and bookings -> visit_reports are ON DELETE CASCADE (4 more are SET NULL), so one
--     DELETE on a parent silently erases clinical history.
--   * medical_staff.auth_user_id can be re-pointed by an admin, i.e. a new login would inherit a person's rights.
--   * audit_log / record_access_log are protected only by missing grants (no guard).
--   * storage bucket policy admin_full_access_patient_documents_storage (ALL) lets an admin delete or overwrite documents.
--   * BUG in log_audit_change (found while testing): it compares tg_op = 'update' but tg_op is upper-case 'UPDATE', so
--     audit_log.old_data has NEVER been written. And it takes row_id from a column named id, so the audit trigger on
--     patient_medical_history (primary key patient_id, no id column) violates audit_log.row_id NOT NULL: every write to that
--     table fails on the isolated database with the real migrations.
--
-- What changes:
--   1. REVOKE DELETE and TRUNCATE on all medical-record tables (+ bookings, patients, medical_staff) from anon and authenticated.
--   2. block_physical_delete(): BEFORE DELETE (row) and BEFORE TRUNCATE (statement) trigger on the same tables; refuses every
--      application caller (auth.uid() is not null, or current role is anon/authenticated) - administrators included.
--   3. All FKs from patients/bookings/visit_reports/service_plans/alerts/risk_predictions to the clinical tables -> ON DELETE
--      RESTRICT (the staff FKs were done by 009; this file only asserts they are RESTRICT).
--   4. medical_staff: DELETE refused (deactivate with is_active=false); auth_user_id is immutable once set; it can be set
--      for the first time only by an administrator and only on an ACTIVE staff row.
--   5. audit_log and record_access_log: UPDATE / DELETE / TRUNCATE refused for EVERYONE (immutable_log_guard).
--   6. audit_log.action CHECK extended: insert, update, delete, archive, void, amend.
--   7. log_audit_change() replaced: old_data now recorded for update/delete, row_id falls back to patient_id (medical history),
--      action becomes 'archive' / 'void' when archived_at / voided_at is set (columns arrive in 018; harmless before).
--   8. storage.objects: the admin ALL policy on bucket patient-documents is replaced by SELECT + INSERT only. Documents can be
--      added and read, not overwritten (no upsert: the UI must upload under a unique path) or deleted through the Data/Storage API.
--
-- What is NOT changed: no data, no select/insert/update grants, no RLS policy except the one storage policy above.
--
-- LIMITATIONS (cannot be fully prevented from SQL - state them to the owner):
--   * The database owner (postgres), the SQL editor, migrations and service_role have no auth.uid(): the guards deliberately let
--     them maintain data (backfills, Edge Function create-staff-login). A superuser can also DROP/DISABLE any trigger. The FK
--     RESTRICTs still stop a cascade, and the log guards (5) also refuse the owner until the trigger is dropped on purpose.
--   * A blocked DELETE raises, which rolls back its own transaction, so the attempt itself cannot be written to audit_log
--     (an INSERT in the same transaction is undone with it). Attempts are visible only in Postgres/API logs.
--   * OPERATIONAL RISK: patients.id -> auth.users is ON DELETE CASCADE and is NOT changed. Deleting an auth.users row (Admin API,
--     anonymous-user cleanup) of a patient who has any booking or record is now REFUSED by the RESTRICT FKs (before: it erased
--     the whole record). Retire such users with patients.archived_at (013), never by deleting the Auth user.
--   * Removing storage DELETE only covers the Data/Storage API paths governed by RLS; the Storage service with the service key
--     and the dashboard can still delete objects. The isolated database has no storage service: the policy is tested through
--     RLS on storage.objects only.
--   * Synthetic-data cleanup scripts that DELETE patients/visits now fail; use a throw-away database instead.
--
-- Reverse SQL (see docs/STAGING_PLAN.md ROLLBACK 015 for the executable version):
--   drop triggers block_physical_delete / block_physical_truncate on each table and drop function public.block_physical_delete();
--   drop trigger immutable_log_guard* on audit_log, record_access_log; drop function public.immutable_log_guard();
--   drop trigger medical_staff_identity_guard on public.medical_staff; drop function public.medical_staff_identity_guard();
--   grant delete on the original tables back (list in STAGING_PLAN); restore FKs to their old actions (cascade / set null);
--   restore audit_log_action_check (insert, update) and the previous log_audit_change; restore the admin ALL storage policy.

-- ------------------------------------------------------------------ 0. prerequisite check (009)
do $$
begin
  if exists (select 1 from pg_constraint
              where conname in ('bookings_staff_id_fkey','visit_reports_staff_id_fkey') and confdeltype <> 'r') then
    raise exception '015 requires 009 (staff FKs ON DELETE RESTRICT) to be applied first';
  end if;
end $$;

-- ------------------------------------------------------------------ 1+2. revoke and trigger
create or replace function public.block_physical_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null or current_user in ('anon','authenticated') then
    raise exception 'medical records are never physically deleted (table %): archive or void instead', tg_table_name
      using errcode = '42501';
  end if;
  if tg_level = 'ROW' then
    return old;
  end if;
  return null;
end;
$$;
revoke all on function public.block_physical_delete() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'visit_reports','visit_report_amendments','patient_allergies','patient_medical_history','clinical_notes',
    'medication_events','patient_documents','service_plans','service_plan_visits','risk_predictions','alerts','tasks',
    'patient_contacts','audit_log','record_access_log','bookings','patients','medical_staff']
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('revoke delete, truncate on public.%I from anon, authenticated', t);
    execute format('drop trigger if exists block_physical_delete on public.%I', t);
    execute format('create trigger block_physical_delete before delete on public.%I '
                   'for each row execute function public.block_physical_delete()', t);
    execute format('drop trigger if exists block_physical_truncate on public.%I', t);
    execute format('create trigger block_physical_truncate before truncate on public.%I '
                   'for each statement execute function public.block_physical_delete()', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ 3. foreign keys -> RESTRICT
do $$
declare
  r      record;
  v_name text;
  v_act  "char";
begin
  for r in select * from (values
      ('bookings','patient_id','patients'),
      ('visit_reports','patient_id','patients'),
      ('visit_reports','booking_id','bookings'),
      ('risk_predictions','patient_id','patients'),
      ('risk_predictions','visit_report_id','visit_reports'),
      ('patient_allergies','patient_id','patients'),
      ('patient_medical_history','patient_id','patients'),
      ('clinical_notes','patient_id','patients'),
      ('medication_events','patient_id','patients'),
      ('medication_events','visit_report_id','visit_reports'),
      ('service_plans','patient_id','patients'),
      ('service_plan_visits','service_plan_id','service_plans'),
      ('service_plan_visits','booking_id','bookings'),
      ('patient_documents','patient_id','patients'),
      ('patient_contacts','patient_id','patients'),
      ('alerts','patient_id','patients'),
      ('alerts','risk_prediction_id','risk_predictions'),
      ('tasks','patient_id','patients'),
      ('tasks','alert_id','alerts')) as t(child, col, parent)
  loop
    select c.conname, c.confdeltype into v_name, v_act
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and array_length(c.conkey, 1) = 1
       and c.conrelid = ('public.' || r.child)::regclass
       and c.confrelid = ('public.' || r.parent)::regclass
       and a.attname = r.col;
    if v_name is null then
      raise exception 'foreign key %.% -> % not found', r.child, r.col, r.parent;
    end if;
    if v_act <> 'r' then
      execute format('alter table public.%I drop constraint %I, add constraint %I foreign key (%I) references public.%I(id) on delete restrict',
                     r.child, v_name, v_name, r.col, r.parent);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------ 4. medical_staff identity
create or replace function public.medical_staff_identity_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon','authenticated') then
    return new;                      -- owner / migrations / service_role (Edge Function create-staff-login)
  end if;
  if tg_op = 'INSERT' then
    if new.auth_user_id is not null and not public._is_jwt_admin() then
      raise exception 'only an administrator may link a login to a staff member' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.auth_user_id is distinct from old.auth_user_id then
    if old.auth_user_id is not null then
      raise exception 'the login linked to a staff member can never be changed (nobody inherits another person''s records)'
        using errcode = '42501';
    end if;
    if not public._is_jwt_admin() or not old.is_active then
      raise exception 'a login may be linked only by an administrator and only to an active staff member' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.medical_staff_identity_guard() from public, anon, authenticated;
drop trigger if exists medical_staff_identity_guard on public.medical_staff;
create trigger medical_staff_identity_guard before insert or update on public.medical_staff
  for each row execute function public.medical_staff_identity_guard();

-- ------------------------------------------------------------------ 5. immutable logs
create or replace function public.immutable_log_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only: rows cannot be changed, removed or truncated', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function public.immutable_log_guard() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['audit_log','record_access_log'] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop trigger if exists immutable_log_guard on public.%I', t);
    execute format('create trigger immutable_log_guard before update or delete on public.%I '
                   'for each row execute function public.immutable_log_guard()', t);
    execute format('drop trigger if exists immutable_log_guard_truncate on public.%I', t);
    execute format('create trigger immutable_log_guard_truncate before truncate on public.%I '
                   'for each statement execute function public.immutable_log_guard()', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ 6+7. audit_log
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('insert','update','delete','archive','void','amend'));

create or replace function public.log_audit_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action text := lower(tg_op);
  o jsonb;
  n jsonb;
begin
  if tg_op in ('UPDATE','DELETE') then o := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then n := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    if n ->> 'voided_at' is not null and o ->> 'voided_at' is null then
      v_action := 'void';
    elsif n ->> 'archived_at' is not null and o ->> 'archived_at' is null then
      v_action := 'archive';
    end if;
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), v_action, tg_table_name,
          coalesce(n ->> 'id', o ->> 'id', n ->> 'patient_id', o ->> 'patient_id'),
          o, n);
  return coalesce(new, old);
end;
$$;
revoke execute on function public.log_audit_change() from public, anon, authenticated;

-- ------------------------------------------------------------------ 8. storage: admin select + insert only
drop policy if exists "admin_full_access_patient_documents_storage" on storage.objects;
drop policy if exists "admin_select_patient_documents_storage" on storage.objects;
create policy "admin_select_patient_documents_storage" on storage.objects
  for select to authenticated
  using (bucket_id = 'patient-documents' and coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));
drop policy if exists "admin_insert_patient_documents_storage" on storage.objects;
create policy "admin_insert_patient_documents_storage" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'patient-documents' and coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));
