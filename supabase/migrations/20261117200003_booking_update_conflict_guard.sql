-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration
-- (then copy to supabase/migrations/ under the exact registered version name; see supabase/proposed/APPLIED.md).
-- Additive only (one function + one trigger); no data is modified or deleted. RLS policies and grants are NOT changed.
-- Depends on: 20261015154829 (bookings_guard_insert: the rules this migration extends to UPDATE), 20261015154029.
--
-- Problem (CONFIRMED on an isolated database): bookings_guard_insert enforces overlap and the 30-minute travel buffer only on
-- INSERT, and bookings_guard_update returns immediately for administrators. A direct write that changes scheduled_at,
-- staff_id (reassignment) or re-activates a cancelled/rejected booking could therefore create overlapping visits or break the
-- travel buffer. The only protection on UPDATE was the unique index on (staff_id, scheduled_at), which catches identical start
-- times only. The Python backend checks availability before it updates, but that check-then-write is not atomic.
--
-- This trigger applies the SAME rule as bookings_guard_insert to every UPDATE that can change who is occupied when:
--   * the booking occupies availability after the update (status <> 'cancelled' and approval_status <> 'rejected'), AND
--   * something relevant changed: staff_id, scheduled_at, visit_address (it decides the same-address buffer exemption), or the
--     booking was NOT occupying before (cancelled/rejected -> active again).
-- Other updates (notes, workflow_status/check-in, approving, completing, an unchanged time/staff) are not re-validated, so
-- legacy rows that already sit closer than the buffer stay editable. The booking being updated is excluded from the comparison
-- (b.id <> new.id). Applies to ALL callers, administrators and the SQL editor included (like the insert guard).
--
-- Rule (unchanged business policy, identical to 005 - exceptions stated explicitly):
--   * any overlap with another active booking of the same staff member is rejected;
--   * a gap shorter than 30 minutes to another active booking is rejected unless BOTH visits have the same non-empty
--     normalised visit_address (same-address back-to-back is allowed; an unknown address counts as different);
--   * every existing booking is assumed to last the staff member's current slot_duration_minutes (bookings store no duration);
--   * cancelled and rejected bookings never block.
-- Atomicity: the staff row is locked (SELECT ... FOR UPDATE, the same lock bookings_guard_insert takes) before the check, so
-- concurrent inserts, time changes and reassignments targeting the same staff member are serialised and the loser re-reads the
-- winner's committed row. Only one staff row is locked per statement, so there is no lock-order deadlock.
-- Error: SQLSTATE 23505 (same as insert) which the backend already maps to the "slot taken" conflict response.
--
-- Reverse SQL:
--   drop trigger if exists bookings_update_conflict_guard on public.bookings;
--   drop function if exists public.bookings_update_conflict_guard();

create or replace function public.bookings_update_conflict_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dur  interval;
  v_buf  interval := interval '30 minutes';   -- keep in sync with bookings_guard_insert / backend TRAVEL_BUFFER_MINUTES
  v_addr text := nullif(lower(regexp_replace(btrim(coalesce(new.visit_address, '')), '\s+', ' ', 'g')), '');
  v_now_active boolean := new.status <> 'cancelled' and new.approval_status <> 'rejected';
  v_was_active boolean := old.status <> 'cancelled' and old.approval_status <> 'rejected';
begin
  if not v_now_active or new.staff_id is null then
    return new;
  end if;
  if v_was_active
     and new.staff_id is not distinct from old.staff_id
     and new.scheduled_at is not distinct from old.scheduled_at
     and new.visit_address is not distinct from old.visit_address then
    return new;
  end if;

  select make_interval(mins => slot_duration_minutes) into v_dur
    from public.medical_staff where id = new.staff_id for update;
  if v_dur is null then
    raise exception 'unknown staff member' using errcode = '23503';
  end if;

  if exists (
    select 1 from public.bookings b
     where b.staff_id = new.staff_id
       and b.id <> new.id
       and b.status <> 'cancelled' and b.approval_status <> 'rejected'
       and (
         tstzrange(b.scheduled_at, b.scheduled_at + v_dur) && tstzrange(new.scheduled_at, new.scheduled_at + v_dur)
         or (
           coalesce(v_addr, '') is distinct from
             coalesce(nullif(lower(regexp_replace(btrim(coalesce(b.visit_address, '')), '\s+', ' ', 'g')), ''), '#none')
           and tstzrange(b.scheduled_at - v_buf, b.scheduled_at + v_dur + v_buf)
               && tstzrange(new.scheduled_at, new.scheduled_at + v_dur)
         )
       )
  ) then
    raise exception 'staff member not available at this time' using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function public.bookings_update_conflict_guard() from public, anon, authenticated;

drop trigger if exists bookings_update_conflict_guard on public.bookings;
create trigger bookings_update_conflict_guard
  before update of staff_id, scheduled_at, visit_address, status, approval_status on public.bookings
  for each row execute function public.bookings_update_conflict_guard();
