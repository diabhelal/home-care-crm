-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration
-- (then copy to supabase/migrations/ under the exact registered version name; see supabase/proposed/APPLIED.md).
-- ONE function replaced (is_my_patient from 20260913230732). No table, column, policy, grant or row is touched.
-- Depends on: 20260913230732 (current_staff_id, is_my_patient and the ~20 RLS policies that call it), 20261015154029 (approval_status).
--
-- Problem (evidence, 20260913230732_add_staff_identity.sql:19-25): is_my_patient(patient) is true when the staff member has ANY
-- booking with that patient - including a booking that was CANCELLED or REJECTED. That access is then permanent, and it covers the
-- whole chart (identity number, allergies, history, notes, reports) through every staff_select_assigned_* policy.
--
-- Change: the relationship counts only if the booking is still a real care relationship:
--     status <> 'cancelled'  AND  approval_status <> 'rejected'
-- That keeps: requested (awaiting approval), confirmed/scheduled and completed visits (a nurse keeps the history of patients she
-- actually treated, and may still need it for an amendment - 017). It removes: cancelled and rejected bookings.
--
-- OPEN CLINICAL / OWNER DECISIONS (defaults chosen here; each is a one-line change in the function):
--   a) 'requested' bookings keep access (the assignment flow reads the chart before approval). Stricter: require 'confirmed'.
--   b) COMPLETED visits keep access indefinitely. Stricter: a time window after the last visit (e.g. 90 days).
--   c) A deactivated staff member (medical_staff.is_active = false) is NOT excluded here, to keep this change to the one finding.
--      Owner rule 6 ("nobody inherits rights") suggests adding `and s.is_active`; decide together with how deactivated logins are handled.
--   d) The patient's own access and administrators are unaffected (separate policies).
--
-- Impact: a staff member who only has cancelled/rejected bookings with a patient loses read access to that patient's chart
-- (patients, allergies, history, notes, medications, tasks, reports ...). Reports she authored stay hers to amend (017 keys on
-- author_user_id), but she can no longer open the patient's chart through those policies.
--
-- Reverse SQL (executable version: docs/STAGING_PLAN.md ROLLBACK 019): re-create the 20260913230732 definition (any booking counts).

create or replace function public.is_my_patient(p_patient_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.bookings
    where bookings.patient_id = p_patient_id
      and bookings.staff_id = public.current_staff_id()
      and bookings.status <> 'cancelled'
      and bookings.approval_status <> 'rejected'
  );
$$;

revoke execute on function public.is_my_patient(uuid) from public;
