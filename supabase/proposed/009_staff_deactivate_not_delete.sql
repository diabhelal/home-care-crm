-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration
-- (then copy to supabase/migrations/ under the exact registered version name; see supabase/proposed/APPLIED.md).
-- Constraint/trigger changes plus ONE additive, narrowly scoped SELECT policy (item 3). No data is modified or deleted; grants are NOT changed.
-- Depends on: 20260825133504 (bookings, medical_staff), 20260911145909 (visit_reports).
--
-- Problem (CONFIRMED on an isolated database and on the live foreign-key metadata): bookings.staff_id and
-- visit_reports.staff_id referenced medical_staff ON DELETE CASCADE, so deleting a staff member silently erased every
-- visit assigned to them AND the clinical visit reports. History must survive a staff member leaving.
--
-- Change:
--   1. bookings.staff_id and visit_reports.staff_id -> ON DELETE RESTRICT. A staff member who has any visit or report can
--      no longer be deleted (the database refuses); the supported way to retire someone is is_active = false, which keeps
--      their bookings and reports and their name in the history. A staff member with no history can still be deleted.
--   2. A deactivated staff member cannot receive NEW assignments: trigger on bookings (insert, or update that changes
--      staff_id) requires medical_staff.is_active, for every caller that has a JWT subject (patients, staff, admins).
--      Existing bookings of that person are untouched (an admin reassigns or completes them); the booking-completion path
--      (complete_visit) is unchanged. Rows written with no JWT subject (migrations, SQL editor) are not restricted.
--   3. medical_staff_select_active only shows ACTIVE staff, so once someone is deactivated a patient's own booking history
--      would lose the staff name (the join returns null). A patient may now also read the (non-PII, column-limited) row of a
--      staff member who has a booking with THEM. Other patients still cannot see inactive staff.
--   (visit_reports.booking_id and patient deletion keep their existing CASCADE; deleting a PATIENT is a separate product decision.)
--
-- Reverse SQL:
--   drop policy if exists medical_staff_select_own_history on public.medical_staff;
--   drop trigger if exists bookings_assign_active_staff_guard on public.bookings;
--   drop function if exists public.bookings_assign_active_staff_guard();
--   alter table public.bookings drop constraint bookings_staff_id_fkey,
--     add constraint bookings_staff_id_fkey foreign key (staff_id) references public.medical_staff(id) on delete cascade;
--   alter table public.visit_reports drop constraint visit_reports_staff_id_fkey,
--     add constraint visit_reports_staff_id_fkey foreign key (staff_id) references public.medical_staff(id) on delete cascade;

alter table public.bookings
  drop constraint bookings_staff_id_fkey,
  add constraint bookings_staff_id_fkey foreign key (staff_id) references public.medical_staff(id) on delete restrict;

alter table public.visit_reports
  drop constraint visit_reports_staff_id_fkey,
  add constraint visit_reports_staff_id_fkey foreign key (staff_id) references public.medical_staff(id) on delete restrict;

create or replace function public.bookings_assign_active_staff_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' or new.staff_id is distinct from old.staff_id then
    if not exists (select 1 from public.medical_staff s where s.id = new.staff_id and s.is_active) then
      raise exception 'staff member is not active and cannot receive new assignments' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.bookings_assign_active_staff_guard() from public, anon, authenticated;

drop trigger if exists bookings_assign_active_staff_guard on public.bookings;
create trigger bookings_assign_active_staff_guard before insert or update of staff_id on public.bookings
  for each row execute function public.bookings_assign_active_staff_guard();

drop policy if exists medical_staff_select_own_history on public.medical_staff;
create policy medical_staff_select_own_history on public.medical_staff
  for select to authenticated
  using (exists (select 1 from public.bookings b
                  where b.staff_id = medical_staff.id and b.patient_id = (select auth.uid())));
