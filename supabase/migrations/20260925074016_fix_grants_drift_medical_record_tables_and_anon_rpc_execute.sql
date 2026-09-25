-- 1. current_staff_id()/is_my_patient(): revoke execute from PUBLIC (done in their original
--    migration) does NOT strip anon's separate default-privilege auto-grant — exact same gotcha
--    already diagnosed and fixed for taken_slots() in 20260923135416. Never backported here.
revoke execute on function public.current_staff_id() from anon;
revoke execute on function public.is_my_patient(uuid) from anon;

-- 2. 20260913220259_add_patient_medical_record.sql granted select/insert[/update/delete] to
--    authenticated WITHOUT first revoking Supabase's default arwdDxtm (full CRUD+TRUNCATE) grant
--    that new tables get automatically — unlike every other migration in this project, which does
--    revoke-then-grant. The grant statements were no-ops; live ACLs never actually narrowed.
--    Restoring exactly what each table's own migration comment already documented as intended.
revoke all on public.patient_allergies from authenticated;
revoke all on public.patient_medical_history from authenticated;
revoke all on public.clinical_notes from authenticated;
revoke all on public.medication_events from authenticated;
revoke all on public.service_plans from authenticated;
revoke all on public.service_plan_visits from authenticated;
revoke all on public.patient_documents from authenticated;
revoke all on public.patient_contacts from authenticated;
revoke all on public.alerts from authenticated;
revoke all on public.tasks from authenticated;
revoke all on public.audit_log from authenticated;

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

-- current_patient_risk view: 20260911221420 granted select to authenticated only, no revoke
-- first, and never touched anon at all — live ACL had anon=arwdDxtm (full) on the view too.
revoke all on public.current_patient_risk from anon;
revoke all on public.current_patient_risk from authenticated;
grant select on public.current_patient_risk to authenticated;
