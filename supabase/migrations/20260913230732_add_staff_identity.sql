-- Real per-employee/nurse identity: links a medical_staff row to a real auth.users
-- account (provisioned via the Admin API, same way the admin account and synthetic
-- patients were created — no self-service signup form), and scopes staff RLS access
-- to only their own assigned patients (via bookings.staff_id), narrower than admin's
-- full access on every table. admin_full_access_* policies are untouched.

alter table public.medical_staff add column auth_user_id uuid unique references auth.users(id);

-- current_staff_id()/is_my_patient(): SECURITY DEFINER so they can read medical_staff/
-- bookings regardless of the calling role's own RLS visibility (avoids policy recursion).
-- Both only ever return information about the CALLER's own assignment — no cross-user
-- data leakage — so, unlike log_audit_change earlier in this project, direct RPC
-- exposure to `authenticated` is intentional and harmless (needed for RLS to call them).
create or replace function public.current_staff_id() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.medical_staff where auth_user_id = auth.uid();
$$;

create or replace function public.is_my_patient(p_patient_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.bookings
    where bookings.patient_id = p_patient_id and bookings.staff_id = public.current_staff_id()
  );
$$;

revoke execute on function public.current_staff_id() from public;
revoke execute on function public.is_my_patient(uuid) from public;
grant execute on function public.current_staff_id() to authenticated;
grant execute on function public.is_my_patient(uuid) to authenticated;

create policy "staff_select_self" on public.medical_staff
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy "staff_select_assigned_bookings" on public.bookings
  for select to authenticated
  using (staff_id = public.current_staff_id());
create policy "staff_update_assigned_bookings" on public.bookings
  for update to authenticated
  using (staff_id = public.current_staff_id())
  with check (staff_id = public.current_staff_id());

create policy "staff_full_access_own_visit_reports" on public.visit_reports
  for all to authenticated
  using (staff_id = public.current_staff_id())
  with check (staff_id = public.current_staff_id());

create policy "staff_select_assigned_patients" on public.patients
  for select to authenticated
  using (public.is_my_patient(id));

create policy "staff_select_assigned_allergies" on public.patient_allergies
  for select to authenticated
  using (public.is_my_patient(patient_id));
create policy "staff_select_assigned_medical_history" on public.patient_medical_history
  for select to authenticated
  using (public.is_my_patient(patient_id));

create policy "staff_select_assigned_clinical_notes" on public.clinical_notes
  for select to authenticated
  using (public.is_my_patient(patient_id));
create policy "staff_insert_assigned_clinical_notes" on public.clinical_notes
  for insert to authenticated
  with check (public.is_my_patient(patient_id));

create policy "staff_select_assigned_medication_events" on public.medication_events
  for select to authenticated
  using (public.is_my_patient(patient_id));
create policy "staff_insert_assigned_medication_events" on public.medication_events
  for insert to authenticated
  with check (public.is_my_patient(patient_id));

create policy "staff_select_assigned_risk_predictions" on public.risk_predictions
  for select to authenticated
  using (public.is_my_patient(patient_id));
create policy "staff_insert_assigned_risk_predictions" on public.risk_predictions
  for insert to authenticated
  with check (public.is_my_patient(patient_id));

create policy "staff_select_assigned_alerts" on public.alerts
  for select to authenticated
  using (public.is_my_patient(patient_id));
create policy "staff_insert_assigned_alerts" on public.alerts
  for insert to authenticated
  with check (public.is_my_patient(patient_id));
create policy "staff_update_assigned_alerts" on public.alerts
  for update to authenticated
  using (public.is_my_patient(patient_id))
  with check (public.is_my_patient(patient_id));

create policy "staff_select_assigned_tasks" on public.tasks
  for select to authenticated
  using (public.is_my_patient(patient_id));
create policy "staff_insert_assigned_tasks" on public.tasks
  for insert to authenticated
  with check (public.is_my_patient(patient_id));
create policy "staff_update_assigned_tasks" on public.tasks
  for update to authenticated
  using (public.is_my_patient(patient_id))
  with check (public.is_my_patient(patient_id));

-- Deliberately NOT granted to staff (admin-only, per the requirement list):
-- service_plans, service_plan_visits, patient_documents, patient_contacts, audit_log.
