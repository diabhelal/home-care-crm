-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration
-- (then copy to supabase/migrations/ under the exact registered version name; see supabase/proposed/APPLIED.md).
-- Additive columns (six nullable marker columns on 8 tables, supersedes_id on 4) + triggers + helper functions; clinical_notes_authorship
-- (007) is replaced. log_audit_change is NOT changed (015 already records 'archive'/'void'). No row is changed or deleted.
-- Depends on: 013 (patients.archived_at), 015 (block_physical_delete, audit_log actions), 016 (visit_reports author/lock; its
--             guard already lets the archive/void markers change), 017, 20261015155238 (_is_jwt_admin, authorship triggers).
--
-- OWNER RULES: (1) a medical record is never physically deleted - "delete" means ARCHIVE or VOID (015 blocks the DELETE);
--              (2) only the ORIGINAL AUTHOR archives or voids their own record, always with a reason, from an ACTIVE account;
--              (3) a correction is a NEW record that points at the old one (supersedes_id) and the old one is voided - the content
--                  of an append-only record never changes; (6) nobody inherits another person's records.
--
-- What it does
--   1. Adds archived_at/archived_by/archive_reason and voided_at/voided_by/void_reason to 8 tables (names match what 015/016 expect).
--      CHECK: a marker without actor and a non-blank reason is impossible.
--   2. record_lifecycle_guard (BEFORE UPDATE) for application callers:
--        * the actor and the time are set by the server (client values are ignored);
--        * archive/void require a non-blank reason;  VOID IS IRREVERSIBLE;  archive may be undone by the same permitted actor
--          (the audit trigger keeps old and new);  an existing reason/actor cannot be edited;
--        * who may do it: mode 'author' = the row's author column equals auth.uid() AND the account is active;
--                         mode 'admin'  = a JWT administrator (patient_contacts: inbound patient messages, so the author is the patient);
--        * 'immutable' tables (patient_allergies, medication_events, patient_documents, clinical_notes): every other column is frozen,
--          so the ONLY way to correct them is a new row (supersedes_id) + void of the old one.
--   3. Column-level UPDATE grants limited to the six marker columns (+ author-only UPDATE policies) on the four immutable tables,
--      so a nurse can void her own note without any general UPDATE right. clinical_notes_authorship (007) is replaced so that an
--      UPDATE is no longer rejected outright; the guard above is what restricts it.
--   4. supersedes_id (self FK, ON DELETE RESTRICT) on the four immutable tables.
--   5. bookings cannot be created or re-pointed (patient/staff/time) for an ARCHIVED patient (013). Cancelling/completing is untouched.
--   6. Audit triggers (insert+update) on the clinical tables that had none: clinical_notes, medication_events, patient_documents,
--      tasks, patient_contacts, alerts, service_plan_visits. DELETE cannot be audited: a blocked DELETE rolls back with its
--      transaction (see 015) - it is visible only in the Postgres/API logs.
--
-- What is NOT changed: data values, existing RLS policies, existing grants, clinical formulas. patient_medical_history stays a single
-- row per patient whose history lives only in audit_log (old_data is recorded since 015) - documented limitation.
-- OPEN OWNER DECISIONS (defaults chosen here, easy to change): service_plans/tasks content stays editable (only the markers are
-- guarded); patient_contacts are archived by any administrator; un-archive is allowed, un-void is not.
-- LIMITATIONS: the DB owner / SQL editor / service_role (no auth.uid()) can still update rows; old rows whose author has no login
-- (author column NULL) cannot be archived/voided by anyone in the app - an owner decision per case.
--
-- Reverse SQL (executable version: docs/STAGING_PLAN.md ROLLBACK 018). WARNING: dropping the columns loses archive/void history;
-- the audit_log keeps old/new copies, but export first.

-- ------------------------------------------------------------------ 0. prerequisites
do $$
begin
  if to_regprocedure('public.block_physical_delete()') is null then
    raise exception '018 requires 015 (block_physical_delete) to be applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'visit_reports' and column_name = 'locked_at') then
    raise exception '018 requires 016 (visit_reports.locked_at) to be applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'patients' and column_name = 'archived_at') then
    raise exception '018 requires 013 (patients.archived_at) to be applied first';
  end if;
end $$;

-- ------------------------------------------------------------------ 1. columns + CHECK
do $$
declare
  t text;
begin
  foreach t in array array['visit_reports','patient_allergies','medication_events','patient_documents',
                           'clinical_notes','service_plans','tasks','patient_contacts']
  loop
    execute format('alter table public.%I
                      add column if not exists archived_at    timestamptz,
                      add column if not exists archived_by    uuid,
                      add column if not exists archive_reason text,
                      add column if not exists voided_at      timestamptz,
                      add column if not exists voided_by      uuid,
                      add column if not exists void_reason    text', t);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_lifecycle_check');
    execute format('alter table public.%I add constraint %I check (
                      (archived_at is null or (archived_by is not null and nullif(btrim(archive_reason), '''') is not null))
                      and (voided_at is null or (voided_by is not null and nullif(btrim(void_reason), '''') is not null)))',
                   t, t || '_lifecycle_check');
  end loop;
end $$;

-- ------------------------------------------------------------------ 2. supersedes_id (correction = new row)
do $$
declare
  t text;
begin
  foreach t in array array['patient_allergies','medication_events','patient_documents','clinical_notes']
  loop
    execute format('alter table public.%I add column if not exists supersedes_id bigint', t);
    if not exists (select 1 from pg_constraint where conname = t || '_supersedes_fk') then
      execute format('alter table public.%I add constraint %I foreign key (supersedes_id) references public.%I(id) on delete restrict',
                     t, t || '_supersedes_fk', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------ 3. active-account helper (readable whatever the caller's column grants)
create or replace function public._is_active_account(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.medical_staff s where s.auth_user_id = p_uid)
      then (select s.is_active from public.medical_staff s where s.auth_user_id = p_uid limit 1)
    else public._is_jwt_admin() and p_uid = auth.uid()
  end
$$;
revoke all on function public._is_active_account(uuid) from public, anon;
grant execute on function public._is_active_account(uuid) to authenticated;

-- ------------------------------------------------------------------ 4. the lifecycle guard
-- trigger arguments: [0] author column ('' = none), [1] 'author' | 'admin', [2] 'immutable' | 'free'
create or replace function public.record_lifecycle_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_author_col text := tg_argv[0];
  v_mode       text := tg_argv[1];
  v_content    text := tg_argv[2];
  o            jsonb := to_jsonb(old);
  n            jsonb := to_jsonb(new);
  v_uid        uuid  := auth.uid();
  c_life       constant text[] := array['archived_at','archived_by','archive_reason','voided_at','voided_by','void_reason'];
  c_server     constant text[] := array['updated_at','updated_by'];
  v_changed    boolean;
  k            text;
begin
  if v_uid is null or current_user not in ('anon','authenticated') then
    return new;                         -- migrations, owner, service_role: not restricted (see LIMITATIONS)
  end if;

  if v_content = 'immutable' and (n - c_life - c_server) is distinct from (o - c_life - c_server) then
    raise exception 'the content of this record cannot be changed; void it and add a corrected record (supersedes_id)'
      using errcode = '55000';
  end if;

  v_changed := false;
  foreach k in array c_life loop
    if (n ->> k) is distinct from (o ->> k) then
      v_changed := true;
    end if;
  end loop;
  if not v_changed then
    return new;
  end if;

  -- who may archive / void
  if v_mode = 'admin' then
    if not public._is_jwt_admin() then
      raise exception 'only an administrator may archive this record' using errcode = '42501';
    end if;
  elsif (o ->> v_author_col) is distinct from v_uid::text then
    raise exception 'only the original author may archive or void this record' using errcode = '42501';
  end if;
  if not public._is_active_account(v_uid) then
    raise exception 'archiving or voiding requires an active account' using errcode = '42501';
  end if;

  -- void: irreversible, set once
  if o ->> 'voided_at' is not null then
    raise exception 'a voided record cannot be changed again' using errcode = '55000';
  end if;
  if new.voided_at is not null then
    if nullif(btrim(coalesce(new.void_reason, '')), '') is null then
      raise exception 'a reason is required to void a record' using errcode = '23514';
    end if;
    new.voided_at := now();
    new.voided_by := v_uid;
  elsif new.voided_by is not null or new.void_reason is not null then
    raise exception 'void_reason/voided_by can only be set together with voided_at' using errcode = '55000';
  end if;

  -- archive: set once with a reason; may be undone (cleared) by the same permitted actor
  if o ->> 'archived_at' is null then
    if new.archived_at is not null then
      if nullif(btrim(coalesce(new.archive_reason, '')), '') is null then
        raise exception 'a reason is required to archive a record' using errcode = '23514';
      end if;
      new.archived_at := now();
      new.archived_by := v_uid;
    elsif new.archived_by is not null or new.archive_reason is not null then
      raise exception 'archive_reason/archived_by can only be set together with archived_at' using errcode = '55000';
    end if;
  elsif new.archived_at is null then
    new.archived_by := null;            -- restored; audit_log keeps the old values
    new.archive_reason := null;
  elsif (n ->> 'archived_at') is distinct from (o ->> 'archived_at')
     or new.archived_by is distinct from old.archived_by
     or new.archive_reason is distinct from old.archive_reason then
    raise exception 'an existing archive record cannot be edited' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.record_lifecycle_guard() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in select * from (values
      ('visit_reports',    'author_user_id', 'author', 'free'),
      ('patient_allergies','created_by',     'author', 'immutable'),
      ('medication_events','created_by',     'author', 'immutable'),
      ('patient_documents','uploaded_by',    'author', 'immutable'),
      ('clinical_notes',   'author_id',      'author', 'immutable'),
      ('service_plans',    'created_by',     'author', 'free'),
      ('tasks',            'created_by',     'author', 'free'),
      ('patient_contacts', '',               'admin',  'free')) as c(tbl, author_col, mode, content)
  loop
    execute format('drop trigger if exists record_lifecycle_guard on public.%I', r.tbl);
    execute format('create trigger record_lifecycle_guard before update on public.%I '
                   'for each row execute function public.record_lifecycle_guard(%L, %L, %L)',
                   r.tbl, r.author_col, r.mode, r.content);
  end loop;
end $$;

-- ------------------------------------------------------------------ 5. clinical_notes: allow the guarded lifecycle UPDATE
-- (007 rejected every UPDATE; the content is now frozen by record_lifecycle_guard and by the column-level grant below.)
create or replace function public.clinical_notes_authorship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- DELETE only happens through the patient's ON DELETE CASCADE (blocked since 015); returning NEW would be NULL and skip it.
  if tg_op = 'DELETE' then
    return old;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    return new;                         -- only the archive/void markers are updatable (grant + record_lifecycle_guard)
  end if;
  new.author_id := auth.uid();
  new.created_at := now();
  if public._is_jwt_admin() then
    new.author_role := 'admin';
  else
    select role into v_role from public.medical_staff where auth_user_id = auth.uid() limit 1;
    if v_role is not null then
      new.author_role := v_role;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.clinical_notes_authorship() from public, anon, authenticated;

-- ------------------------------------------------------------------ 6. marker-only UPDATE for authors of the immutable tables
do $$
declare
  r record;
begin
  for r in select * from (values
      ('patient_allergies','created_by'), ('medication_events','created_by'),
      ('patient_documents','uploaded_by'), ('clinical_notes','author_id')) as c(tbl, author_col)
  loop
    execute format('grant update (archived_at, archived_by, archive_reason, voided_at, voided_by, void_reason) on public.%I to authenticated', r.tbl);
    execute format('drop policy if exists %I on public.%I', 'author_lifecycle_update_' || r.tbl, r.tbl);
    execute format('create policy %I on public.%I for update to authenticated '
                   'using (%I = (select auth.uid())) with check (%I = (select auth.uid()))',
                   'author_lifecycle_update_' || r.tbl, r.tbl, r.author_col, r.author_col);
  end loop;
end $$;

-- ------------------------------------------------------------------ 7. no new/moved bookings for an archived patient
create or replace function public.bookings_block_archived_patient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.patients p where p.id = new.patient_id and p.archived_at is not null) then
    raise exception 'the patient file is archived; restore it before creating or moving a booking' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.bookings_block_archived_patient() from public, anon, authenticated;
drop trigger if exists bookings_block_archived_patient_insert on public.bookings;
create trigger bookings_block_archived_patient_insert before insert on public.bookings
  for each row execute function public.bookings_block_archived_patient();
drop trigger if exists bookings_block_archived_patient_update on public.bookings;
create trigger bookings_block_archived_patient_update before update of patient_id, staff_id, scheduled_at on public.bookings
  for each row execute function public.bookings_block_archived_patient();

-- ------------------------------------------------------------------ 8. audit triggers where missing (insert + update)
do $$
declare
  t text;
begin
  foreach t in array array['clinical_notes','medication_events','patient_documents','tasks','patient_contacts','alerts','service_plan_visits']
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format('create trigger %I after insert or update on public.%I for each row execute function public.log_audit_change()',
                   'audit_' || t, t);
  end loop;
end $$;
