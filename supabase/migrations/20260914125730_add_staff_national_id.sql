-- Employee ID number, requested directly by the admin — parallels patients.national_id
-- (no uniqueness constraint, same as that column: informational, not a login/dedup key).
alter table public.medical_staff add column national_id text;
