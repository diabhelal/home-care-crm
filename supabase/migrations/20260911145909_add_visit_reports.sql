-- דוחות ביקור בית (אומדן סיעודי): מדדים רפואיים, פרוצדורות שבוצעו, סיכום וחתימת מטופל.
-- נוצר ע"י אדמין/צוות דרך פאנל הניהול, המטופל רואה בלבד (read-only).

create table public.visit_reports (
  id bigint generated always as identity primary key,
  booking_id bigint not null unique references public.bookings(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  staff_id bigint not null references public.medical_staff(id) on delete cascade,
  visit_date timestamptz not null default now(),
  systolic_bp int check (systolic_bp between 50 and 250),
  diastolic_bp int check (diastolic_bp between 30 and 150),
  blood_sugar int check (blood_sugar between 20 and 600),
  pulse int check (pulse between 30 and 220),
  temperature numeric(4,1) check (temperature between 30.0 and 45.0),
  oxygen_saturation int check (oxygen_saturation between 50 and 100),
  performed_blood_draw boolean not null default false,
  performed_injection boolean not null default false,
  performed_infusion boolean not null default false,
  performed_dressing_change boolean not null default false,
  performed_catheter_change boolean not null default false,
  treatment_summary text not null,
  patient_signature_data text,
  created_at timestamptz not null default now()
);

create index visit_reports_patient_id_idx on public.visit_reports (patient_id);
create index visit_reports_staff_id_idx on public.visit_reports (staff_id);

-- RLS
alter table public.visit_reports enable row level security;

create policy "visit_reports_select_own" on public.visit_reports
  for select to authenticated
  using ((select auth.uid()) = patient_id);

create policy "admin_full_access_visit_reports" on public.visit_reports
  for all to authenticated
  using (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin')::boolean, false))
  with check (coalesce((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin')::boolean, false));

-- Explicit Data API grants (anon: no access; authenticated: per RLS above —
-- patients get select via visit_reports_select_own, admin gets all via admin_full_access_visit_reports)
grant select, insert, update, delete on public.visit_reports to authenticated;
grant usage, select on sequence public.visit_reports_id_seq to authenticated;
