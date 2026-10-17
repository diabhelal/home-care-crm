-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration
-- (then copy to supabase/migrations/ under the exact registered version name; see supabase/proposed/APPLIED.md).
-- Additive only; no data deletion; RLS policies and table grants are NOT changed.
-- Depends on: 20260911145909 (visit_reports), 20261015154029 (bookings.approval_status),
--             20261015155238 (public._is_jwt_admin), current_staff_id() (init).
--
-- Problem (CONFIRMED on an isolated database with the real migrations): the staff policy on visit_reports only checks
-- staff_id = current_staff_id(). A nurse calling the Data API directly could therefore
--   * insert a report for a booking that was never approved (approval_status='requested'),
--   * attach a report to another patient (patient_id differing from the booking's),
--   * attach a report to another nurse's booking,
--   * edit the clinical content of a completed report,
--   * delete her own reports (the audit trigger only covers INSERT/UPDATE).
-- complete_visit() (SECURITY DEFINER) already enforces the right rules, but the table itself did not.
--
-- This trigger makes the TABLE enforce the same rules, so every write path obeys them, including the
-- Python backend's complete_visit() (which runs with the caller's JWT, so the checks below still apply to it).
-- For callers WITH a JWT subject (auth.uid() is not null):
--   INSERT: the booking must exist, be confirmed and still 'scheduled'; patient_id and staff_id must equal the
--           booking's; the caller must be the assigned staff member or an admin.
--   UPDATE: booking_id / patient_id / staff_id are immutable. Clinical content may change only while the booking is
--           still 'scheduled' (complete_visit upserts before it marks the booking completed). Once the booking is
--           completed or cancelled only clinical_outcome_8h (the 8h follow-up, written through the backend) may change.
--   DELETE: admin only (staff may never delete a clinical report).
-- Rows written with no JWT subject (migrations, SQL editor, service role) are NOT restricted, as in 005/006/007.
--
-- Reverse SQL:
--   drop trigger if exists visit_reports_integrity_guard on public.visit_reports;
--   drop function if exists public.visit_reports_integrity_guard();

create or replace function public.visit_reports_integrity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := public._is_jwt_admin();
  b       public.bookings;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if not v_admin then
      raise exception 'only an administrator may delete a visit report' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.booking_id is distinct from old.booking_id
       or new.patient_id is distinct from old.patient_id
       or new.staff_id is distinct from old.staff_id then
      raise exception 'visit report identity (booking, patient, staff) is immutable' using errcode = '42501';
    end if;
  end if;

  select * into b from public.bookings where id = new.booking_id;
  if not found then
    raise exception 'booking not found' using errcode = '23503';
  end if;
  if new.patient_id is distinct from b.patient_id or new.staff_id is distinct from b.staff_id then
    raise exception 'visit report must match the booking''s patient and staff member' using errcode = '42501';
  end if;
  if not v_admin and b.staff_id is distinct from public.current_staff_id() then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if b.approval_status <> 'confirmed' or b.status <> 'scheduled' then
      raise exception 'a report may only be created for a confirmed, scheduled visit' using errcode = '55000';
    end if;
  elsif b.status <> 'scheduled' then
    -- completed/cancelled: only the follow-up outcome may change
    if (to_jsonb(new) - 'clinical_outcome_8h') is distinct from (to_jsonb(old) - 'clinical_outcome_8h') then
      raise exception 'a completed visit report is locked; only the clinical outcome may be recorded' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.visit_reports_integrity_guard() from public, anon, authenticated;

drop trigger if exists visit_reports_integrity_guard on public.visit_reports;
create trigger visit_reports_integrity_guard before insert or update or delete on public.visit_reports
  for each row execute function public.visit_reports_integrity_guard();
