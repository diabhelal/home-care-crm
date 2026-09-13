-- Patient Medical Record module: allergies, structured anamnesis, clinical notes,
-- medication log, recurring service plans, documents, patient<->org messages,
-- alerts, follow-up tasks, and a generic audit trigger for sensitive tables.
-- Applied directly against the remote project this session (execute_sql, iterated);
-- this file documents/reproduces that state, per this project's migration workflow.

alter table public.patients
  add column if not exists national_id text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text;

create table public.patient_allergies (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  substance text not null,
  reaction text,
  severity text check (severity in ('mild','moderate','severe')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.patient_medical_history (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  previous_surgeries text[] not null default '{}',
  previous_hospitalizations text[] not null default '{}',
  current_medications text[] not null default '{}',
  family_history text,
  functional_status text,
  mobility text,
  nutrition_notes text,
  additional_notes text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- Insert-only by design: clinical corrections are new notes, never silent overwrites
-- (no update/delete grant below, for anyone, admin included).
create table public.clinical_notes (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  author_id uuid references auth.users(id),
  author_role text,
  note_type text not null check (note_type in ('nursing','medical','follow_up','general')),
  content text not null,
  created_at timestamptz not null default now()
);

create table public.medication_events (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_report_id bigint references public.visit_reports(id) on delete set null,
  medication_name text not null,
  dose text,
  route text check (route in ('oral','iv','im','sc','inhaled','topical','other')),
  administered_at timestamptz not null default now(),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.service_plans (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  service_type text not null,
  start_date date not null,
  end_date date,
  frequency text not null,
  preferred_weekdays smallint[] not null default '{}',
  preferred_time time,
  planned_visit_count int,
  status text not null default 'requested'
    check (status in ('requested','pending_approval','active','paused','completed','cancelled')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Idempotent generation: the unique constraint means re-running the plan's visit
-- generator can never create duplicate occurrences for the same date.
create table public.service_plan_visits (
  id bigint generated always as identity primary key,
  service_plan_id bigint not null references public.service_plans(id) on delete cascade,
  booking_id bigint references public.bookings(id) on delete set null,
  planned_date timestamptz not null,
  status text not null default 'planned'
    check (status in ('planned','scheduled','completed','skipped','cancelled')),
  created_at timestamptz not null default now(),
  unique (service_plan_id, planned_date)
);

create table public.patient_documents (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  document_type text not null,
  description text,
  storage_path text not null,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.patient_contacts (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  is_from_patient boolean not null default false,
  channel text not null default 'message' check (channel in ('phone','message')),
  subject text,
  body text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.alerts (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  risk_prediction_id bigint references public.risk_predictions(id) on delete set null,
  alert_type text not null check (alert_type in ('new_red','worsening_trend','vital_anomaly','repeated_abnormal')),
  severity text not null check (severity in ('low','medium','high')),
  message text not null,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  alert_id bigint references public.alerts(id) on delete set null,
  title text not null,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','completed')),
  created_by uuid references auth.users(id),
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- No insert/update/delete grant to authenticated at all: only the SECURITY DEFINER
-- trigger function below writes to it (and that function's direct RPC execution is
-- revoked from anon/authenticated below, so it can only ever fire via the triggers).
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null check (action in ('insert','update')),
  table_name text not null,
  row_id text not null,
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);

create index on public.patient_allergies (patient_id);
create index on public.clinical_notes (patient_id, created_at desc);
create index on public.medication_events (patient_id, administered_at desc);
create index on public.service_plans (patient_id, status);
create index on public.service_plan_visits (service_plan_id, planned_date);
create index on public.patient_documents (patient_id);
create index on public.patient_contacts (patient_id, created_at desc);
create index on public.alerts (patient_id, status);
create index on public.tasks (patient_id, status, due_at);
create index on public.audit_log (table_name, row_id);

-- Generic audit trigger, reused on every table where an in-place UPDATE could
-- silently erase clinical history.
create or replace function public.log_audit_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), lower(tg_op), tg_table_name,
          coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id')),
          case when tg_op = 'update' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end;
$$;

-- SECURITY DEFINER functions default to EXECUTE granted to PUBLIC (= every role,
-- including anon) — revoke it explicitly so this can only ever run as a trigger,
-- never called directly via /rest/v1/rpc/log_audit_change to forge audit rows.
revoke execute on function public.log_audit_change() from public;

create trigger audit_visit_reports after insert or update on public.visit_reports
  for each row execute function public.log_audit_change();
create trigger audit_patients after insert or update on public.patients
  for each row execute function public.log_audit_change();
create trigger audit_patient_medical_history after insert or update on public.patient_medical_history
  for each row execute function public.log_audit_change();
create trigger audit_patient_allergies after insert or update on public.patient_allergies
  for each row execute function public.log_audit_change();
create trigger audit_service_plans after insert or update on public.service_plans
  for each row execute function public.log_audit_change();

-- RLS: enable + revoke anon + minimal grant to authenticated on every new table
alter table public.patient_allergies enable row level security;
alter table public.patient_medical_history enable row level security;
alter table public.clinical_notes enable row level security;
alter table public.medication_events enable row level security;
alter table public.service_plans enable row level security;
alter table public.service_plan_visits enable row level security;
alter table public.patient_documents enable row level security;
alter table public.patient_contacts enable row level security;
alter table public.alerts enable row level security;
alter table public.tasks enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.patient_allergies from anon;
revoke all on public.patient_medical_history from anon;
revoke all on public.clinical_notes from anon;
revoke all on public.medication_events from anon;
revoke all on public.service_plans from anon;
revoke all on public.service_plan_visits from anon;
revoke all on public.patient_documents from anon;
revoke all on public.patient_contacts from anon;
revoke all on public.alerts from anon;
revoke all on public.tasks from anon;
revoke all on public.audit_log from anon;

grant select, insert, update, delete on public.patient_allergies to authenticated;
grant select, insert, update, delete on public.patient_medical_history to authenticated;
grant select, insert on public.clinical_notes to authenticated;
grant select, insert, update, delete on public.medication_events to authenticated;
grant select, insert, update, delete on public.service_plans to authenticated;
grant select, insert, update, delete on public.service_plan_visits to authenticated;
grant select, insert, update, delete on public.patient_documents to authenticated;
grant select, insert on public.patient_contacts to authenticated;
grant select, insert, update, delete on public.alerts to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select on public.audit_log to authenticated;

-- Admin: existing admin_full_access_* pattern, `(select auth.jwt())` form to avoid
-- per-row re-evaluation (see the RLS initplan advisory).
create policy "admin_full_access_patient_allergies" on public.patient_allergies
  for all to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false))
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));

create policy "admin_full_access_patient_medical_history" on public.patient_medical_history
  for all to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false))
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));

create policy "admin_select_clinical_notes" on public.clinical_notes
  for select to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));
create policy "admin_insert_clinical_notes" on public.clinical_notes
  for insert to authenticated
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));

create policy "admin_full_access_medication_events" on public.medication_events
  for all to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false))
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));

create policy "admin_full_access_service_plans" on public.service_plans
  for all to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false))
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));

create policy "admin_full_access_service_plan_visits" on public.service_plan_visits
  for all to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false))
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));

create policy "admin_full_access_patient_documents" on public.patient_documents
  for all to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false))
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));

create policy "admin_full_access_alerts" on public.alerts
  for all to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false))
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));

create policy "admin_full_access_tasks" on public.tasks
  for all to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false))
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));

create policy "admin_select_audit_log" on public.audit_log
  for select to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));

-- patient_contacts: admin full access + patient self (own thread only)
create policy "admin_full_access_patient_contacts" on public.patient_contacts
  for all to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false))
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));
create policy "patient_select_own_contacts" on public.patient_contacts
  for select to authenticated
  using (patient_id = (select auth.uid()));
create policy "patient_insert_own_contacts" on public.patient_contacts
  for insert to authenticated
  with check (patient_id = (select auth.uid()) and is_from_patient = true);

-- service_plans: patient self (request only — admin manages the lifecycle after that)
create policy "patient_select_own_service_plans" on public.service_plans
  for select to authenticated
  using (patient_id = (select auth.uid()));
create policy "patient_insert_own_service_plans" on public.service_plans
  for insert to authenticated
  with check (patient_id = (select auth.uid()) and status = 'requested');

-- Documents: private Storage bucket, admin-only in Phase 1
insert into storage.buckets (id, name, public)
values ('patient-documents', 'patient-documents', false)
on conflict (id) do nothing;

create policy "admin_full_access_patient_documents_storage" on storage.objects
  for all to authenticated
  using (bucket_id = 'patient-documents' and coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false))
  with check (bucket_id = 'patient-documents' and coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false));
