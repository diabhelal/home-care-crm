-- APPLIED to the live project on 2026-10-15 (registered via apply_migration); source: supabase/proposed.
-- (execute_sql iteration -> get_advisors -> apply_migration -> local file with the exact registered version name).
-- Additive only; no data deletion.

create or replace function public.check_in_visit(p_booking_id bigint)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  -- owner (assigned staff) or an admin; identity comes from the verified JWT, never a parameter
  -- (same rule as complete_visit in 003)
  if b.staff_id is distinct from public.current_staff_id()
     and not coalesce((((select auth.jwt()) -> 'app_metadata') ->> 'is_admin')::boolean, false) then
    raise exception 'not your booking' using errcode = '42501';
  end if;
  if b.status <> 'scheduled' or b.approval_status <> 'confirmed' then
    raise exception 'illegal state' using errcode = '55000';
  end if;
  -- idempotent: keep the first check-in time
  update public.bookings
     set checked_in_at = coalesce(checked_in_at, now()),
         workflow_status = 'in_progress'
   where id = p_booking_id
   returning * into b;
  return b;
end;
$$;

revoke all on function public.check_in_visit(bigint) from public, anon;
grant execute on function public.check_in_visit(bigint) to authenticated;
