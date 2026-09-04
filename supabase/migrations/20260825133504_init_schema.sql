-- CRM ביקורי בית: סכמת בסיס (patients, medical_staff, bookings) + RLS

create table public.patients (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  address text,
  date_of_birth date,
  created_at timestamptz not null default now()
);

create table public.medical_staff (
  id bigint generated always as identity primary key,
  full_name text not null,
  role text not null check (role in ('nurse','doctor','physiotherapist','caregiver')),
  specialization text,
  phone text,
  available_weekdays smallint[] not null default '{0,1,2,3,4}',
  work_start_time time not null default '08:00',
  work_end_time time not null default '18:00',
  slot_duration_minutes int not null default 60 check (slot_duration_minutes > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.bookings (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  staff_id bigint not null references public.medical_staff(id) on delete cascade,
  visit_purpose text not null check (visit_purpose in ('checkup','wound_care','blood_test','medication','physiotherapy','other')),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  unique (staff_id, scheduled_at)
);

create index bookings_patient_id_idx on public.bookings (patient_id);
create index bookings_staff_id_idx on public.bookings (staff_id);
create index medical_staff_is_active_idx on public.medical_staff (is_active) where is_active = true;

-- RLS
alter table public.patients enable row level security;
alter table public.medical_staff enable row level security;
alter table public.bookings enable row level security;

create policy "patients_select_own" on public.patients
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "patients_insert_own" on public.patients
  for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "patients_update_own" on public.patients
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "medical_staff_select_active" on public.medical_staff
  for select to authenticated
  using (is_active = true);

create policy "bookings_select_own" on public.bookings
  for select to authenticated
  using ((select auth.uid()) = patient_id);

create policy "bookings_insert_own" on public.bookings
  for insert to authenticated
  with check ((select auth.uid()) = patient_id);

create policy "bookings_update_own" on public.bookings
  for update to authenticated
  using ((select auth.uid()) = patient_id)
  with check ((select auth.uid()) = patient_id);

-- Explicit Data API grants (anon: no access; authenticated: per RLS above)
grant usage on schema public to authenticated;
grant select, insert, update on public.patients to authenticated;
grant select on public.medical_staff to authenticated;
grant select, insert, update on public.bookings to authenticated;
grant usage, select on sequence public.medical_staff_id_seq to authenticated;
grant usage, select on sequence public.bookings_id_seq to authenticated;
