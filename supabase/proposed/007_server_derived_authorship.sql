-- PROPOSED, NOT APPLIED. Review before applying; follow the CLAUDE.md migration workflow
-- (execute_sql iteration -> get_advisors -> apply_migration -> local file with the exact registered version name).
-- Additive only; no data deletion; no change to RLS policies or table grants (who may read/write is unchanged).
-- Depends on: 20260913220259 (medical record tables), current_staff_id() (init). Independent of 001-006.
--
-- Problem: clinical-adjacent tables accept client-supplied authorship/identity
-- (created_by / author_id / uploaded_by / updated_by, client timestamps, and re-pointing patient_id on update).
--
-- After this migration, for callers WITH a JWT subject (auth.uid() is not null):
--   * INSERT: authorship column := auth.uid(); created_at/updated_at := now().
--   * UPDATE: authorship columns are not client-writable (created_by/author_id/uploaded_by keep the old value;
--     updated_by/updated_at := auth.uid()/now()); identity columns (patient_id, service_plan_id,
--     storage_path, created_at) cannot change.
--   * clinical_notes stays insert-only (no update/delete grant is touched). author_role is derived: 'admin' for
--     admins, otherwise the caller's medical_staff.role; if neither applies the client value is kept.
--   * alerts: DELETE is admin-only (staff may acknowledge/resolve via UPDATE, never delete).
-- Rows written with no JWT subject (migrations, SQL editor, service role) are NOT restricted.
--
-- Reverse SQL: see docs/STAGING_PLAN.md (drop trigger ...; drop function ...).

-- ---------------------------------------------------------------- shared helper
create or replace function public._is_jwt_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((((select auth.jwt()) -> 'app_metadata') ->> 'is_admin')::boolean, false)
$$;
revoke all on function public._is_jwt_admin() from public, anon;
grant execute on function public._is_jwt_admin() to authenticated;

-- ---------------------------------------------------------------- generic per-table guards
-- medication_events, service_plans, patient_allergies: created_by + created_at, patient_id immutable.
create or replace function public.authorship_guard_created_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if new.patient_id is distinct from old.patient_id then
      raise exception 'patient_id is immutable' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.authorship_guard_created_by() from public, anon, authenticated;

drop trigger if exists medication_events_authorship on public.medication_events;
create trigger medication_events_authorship before insert or update on public.medication_events
  for each row execute function public.authorship_guard_created_by();
drop trigger if exists service_plans_authorship on public.service_plans;
create trigger service_plans_authorship before insert or update on public.service_plans
  for each row execute function public.authorship_guard_created_by();
drop trigger if exists patient_allergies_authorship on public.patient_allergies;
create trigger patient_allergies_authorship before insert or update on public.patient_allergies
  for each row execute function public.authorship_guard_created_by();

-- patient_documents: uploaded_by + created_at; patient_id and storage_path immutable.
create or replace function public.patient_documents_authorship()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.uploaded_by := auth.uid();
    new.created_at := now();
  else
    if new.patient_id is distinct from old.patient_id
       or new.storage_path is distinct from old.storage_path then
      raise exception 'document identity is immutable' using errcode = '42501';
    end if;
    new.uploaded_by := old.uploaded_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.patient_documents_authorship() from public, anon, authenticated;
drop trigger if exists patient_documents_authorship on public.patient_documents;
create trigger patient_documents_authorship before insert or update on public.patient_documents
  for each row execute function public.patient_documents_authorship();

-- patient_medical_history: updated_by/updated_at always server-derived (upsert fires both paths).
create or replace function public.patient_medical_history_authorship()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.patient_id is distinct from old.patient_id then
    raise exception 'patient_id is immutable' using errcode = '42501';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.patient_medical_history_authorship() from public, anon, authenticated;
drop trigger if exists patient_medical_history_authorship on public.patient_medical_history;
create trigger patient_medical_history_authorship before insert or update on public.patient_medical_history
  for each row execute function public.patient_medical_history_authorship();

-- service_plan_visits: no authorship column; only created_at and the parent plan are identity.
create or replace function public.service_plan_visits_authorship()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    if new.service_plan_id is distinct from old.service_plan_id then
      raise exception 'service_plan_id is immutable' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.service_plan_visits_authorship() from public, anon, authenticated;
drop trigger if exists service_plan_visits_authorship on public.service_plan_visits;
create trigger service_plan_visits_authorship before insert or update on public.service_plan_visits
  for each row execute function public.service_plan_visits_authorship();

-- clinical_notes: INSERT only (there is no update/delete grant; the trigger is defence in depth).
-- SECURITY DEFINER only to read medical_staff.role regardless of the caller's column grants.
create or replace function public.clinical_notes_authorship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- DELETE only happens through the patient's ON DELETE CASCADE (authenticated has no DELETE
  -- grant on clinical_notes). Returning NEW here would be NULL and silently skip the cascade.
  if tg_op = 'DELETE' then
    return old;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'clinical notes are append-only' using errcode = '42501';
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
drop trigger if exists clinical_notes_authorship on public.clinical_notes;
create trigger clinical_notes_authorship before insert or update or delete on public.clinical_notes
  for each row execute function public.clinical_notes_authorship();

-- ---------------------------------------------------------------- alerts: admin-only delete
-- Note: a patient delete cascades to alerts; only admins can delete patients, so that path stays allowed.
create or replace function public.alerts_guard_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or public._is_jwt_admin() then
    return old;
  end if;
  raise exception 'only an administrator may delete alerts' using errcode = '42501';
end;
$$;
revoke all on function public.alerts_guard_delete() from public, anon, authenticated;
drop trigger if exists alerts_guard_delete on public.alerts;
create trigger alerts_guard_delete before delete on public.alerts
  for each row execute function public.alerts_guard_delete();
