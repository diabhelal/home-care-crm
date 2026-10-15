-- PROPOSED, NOT APPLIED. Review before applying; follow the CLAUDE.md migration workflow
-- (execute_sql iteration -> get_advisors -> apply_migration -> local file with the exact registered version name).
-- Additive only; no data deletion. Requires 001 (approval_status, visit_address, checked_in_at).
--
-- Purpose: make the DATABASE the authority for booking writes, so no write path (direct
-- PostgREST call from a browser, an old frontend, or the Python backend using the
-- caller's JWT) can bypass the approval state model, slot uniqueness or the travel buffer.
--
-- Identity always comes from auth.uid() / the JWT, never from a column the caller supplies.
-- Rows written with no JWT subject (migrations, the SQL editor) are not restricted.

create or replace function public.bookings_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := coalesce((((select auth.jwt()) -> 'app_metadata') ->> 'is_admin')::boolean, false);
  v_dur   interval;
  v_buf   interval := interval '30 minutes';   -- keep in sync with backend TRAVEL_BUFFER_MINUTES
  v_addr  text := nullif(lower(regexp_replace(btrim(coalesce(new.visit_address, '')), '\s+', ' ', 'g')), '');
begin
  if auth.uid() is not null and not v_admin then
    -- a caller cannot self-approve or pre-fill server-generated fields
    new.approval_status := 'requested';
    new.checked_in_at := null;
  end if;

  -- serialise concurrent requests for the same staff member
  select make_interval(mins => slot_duration_minutes) into v_dur
    from public.medical_staff where id = new.staff_id for update;
  if v_dur is null then
    raise exception 'unknown staff member' using errcode = '23503';
  end if;

  if exists (
    select 1 from public.bookings b
     where b.staff_id = new.staff_id
       and b.status <> 'cancelled' and b.approval_status <> 'rejected'
       and (
         -- overlapping visit
         tstzrange(b.scheduled_at, b.scheduled_at + v_dur) && tstzrange(new.scheduled_at, new.scheduled_at + v_dur)
         or (
           -- too little travel time between visits at different/unknown addresses
           coalesce(v_addr, '') is distinct from
             coalesce(nullif(lower(regexp_replace(btrim(coalesce(b.visit_address, '')), '\s+', ' ', 'g')), ''), '#none')
           and tstzrange(b.scheduled_at - v_buf, b.scheduled_at + v_dur + v_buf)
               && tstzrange(new.scheduled_at, new.scheduled_at + v_dur)
         )
       )
  ) then
    -- 23505 so existing clients map it to the "slot taken" message
    raise exception 'staff member not available at this time' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_guard_insert on public.bookings;
create trigger bookings_guard_insert before insert on public.bookings
  for each row execute function public.bookings_guard_insert();

create or replace function public.bookings_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := coalesce((((select auth.jwt()) -> 'app_metadata') ->> 'is_admin')::boolean, false);
begin
  if auth.uid() is null or v_admin then
    return new;
  end if;

  if old.staff_id is not distinct from public.current_staff_id() then
    -- assigned staff: may only progress the visit (workflow/status/check-in)
    if new.patient_id is distinct from old.patient_id
       or new.staff_id is distinct from old.staff_id
       or new.scheduled_at is distinct from old.scheduled_at
       or new.approval_status is distinct from old.approval_status
       or new.visit_address is distinct from old.visit_address
       or new.visit_purpose is distinct from old.visit_purpose then
      raise exception 'staff may not change booking identity, time or approval' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.patient_id = auth.uid() then
    -- patient: may only cancel their own still-scheduled booking
    if new.status = 'cancelled' and old.status = 'scheduled'
       and new.staff_id is not distinct from old.staff_id
       and new.patient_id is not distinct from old.patient_id
       and new.scheduled_at is not distinct from old.scheduled_at
       and new.approval_status is not distinct from old.approval_status
       and new.workflow_status is not distinct from old.workflow_status
       and new.checked_in_at is not distinct from old.checked_in_at then
      return new;
    end if;
    raise exception 'patients may only cancel a scheduled booking' using errcode = '42501';
  end if;

  raise exception 'not allowed' using errcode = '42501';
end;
$$;

drop trigger if exists bookings_guard_update on public.bookings;
create trigger bookings_guard_update before update on public.bookings
  for each row execute function public.bookings_guard_update();

revoke all on function public.bookings_guard_insert() from public, anon, authenticated;
revoke all on function public.bookings_guard_update() from public, anon, authenticated;
