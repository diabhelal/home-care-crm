-- PROPOSED, NOT APPLIED. Review before applying; follow the CLAUDE.md migration workflow
-- (execute_sql iteration -> get_advisors -> apply_migration -> local file with the exact registered version name).
-- Additive only; no data deletion.

-- Existing rows default to 'confirmed' so current behaviour does not change.
-- The new backend explicitly inserts 'requested'.
-- NOTE: until the frontend stops inserting directly, a direct PostgREST insert by a
-- patient still gets 'confirmed'; closing that requires routing inserts through the backend.
alter table public.bookings
  add column if not exists approval_status text not null default 'confirmed'
    check (approval_status in ('requested','confirmed','rejected')),
  add column if not exists visit_address text,
  add column if not exists visit_lat double precision,
  add column if not exists visit_lng double precision,
  add column if not exists checked_in_at timestamptz,
  add column if not exists idempotency_key text;

-- One idempotency key per patient (NULLs are not constrained).
create unique index if not exists bookings_patient_idempotency_key_uidx
  on public.bookings (patient_id, idempotency_key)
  where idempotency_key is not null;

-- Optional base location of staff, used only for proximity ranking.
alter table public.medical_staff
  add column if not exists base_lat double precision,
  add column if not exists base_lng double precision;
