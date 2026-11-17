-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration.
-- Adds ONE new table and TWO triggers; no existing row, column or grant is changed or deleted.
-- Depends on: bookings (init), _is_jwt_admin() (007), audit_log (20260913220259).
--
-- Purpose: the administrator can temporarily pause a visit type (e.g. blood tests) for a date range or until
-- further notice, with a message shown to the patient, and resume it later - without a deploy.
--   * A visit type that is NOT offered at all stays controlled by OFFERED_PURPOSES (backend) / SERVICE_CONFIG (frontend).
--   * No row for a purpose  = available (today's behaviour). A row only ever narrows availability.
--   * Pause = is_paused true, optionally limited by paused_from / paused_until (inclusive, business-timezone dates).
--   * Nothing is deleted: rows are paused/resumed (is_paused) and every change is audited. No DELETE grant.
--   * Existing bookings are NOT touched: a pause only blocks NEW bookings and reschedules by non-admins.
--     An administrator may still book a paused service on a patient's behalf (JWT is_admin bypass).
-- The booking is enforced here too (not only in the form or the API), so a direct write cannot bypass the pause.
--
-- Reverse SQL: see docs/STAGING_PLAN.md (ROLLBACK 021).

create table if not exists public.service_availability (
  purpose        text primary key
                 check (purpose in ('checkup','wound_care','blood_test','medication','physiotherapy','other')),
  is_paused      boolean not null default false,
  paused_from    date,
  paused_until   date,
  public_message text check (public_message is null or char_length(public_message) <= 200),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint service_availability_dates_ordered
    check (paused_from is null or paused_until is null or paused_from <= paused_until)
);

alter table public.service_availability enable row level security;
revoke all on public.service_availability from anon, public;
grant select, insert, update on public.service_availability to authenticated;   -- no DELETE, ever

-- every signed-in user (patients are anonymous-auth sessions) may READ the pause list: the booking form needs it
drop policy if exists service_availability_read on public.service_availability;
create policy service_availability_read on public.service_availability for select to authenticated using (true);
drop policy if exists service_availability_admin_insert on public.service_availability;
create policy service_availability_admin_insert on public.service_availability for insert to authenticated
  with check (public._is_jwt_admin());
drop policy if exists service_availability_admin_update on public.service_availability;
create policy service_availability_admin_update on public.service_availability for update to authenticated
  using (public._is_jwt_admin()) with check (public._is_jwt_admin());

-- actor and time are decided by the server, never by the client
create or replace function public.service_availability_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.public_message := nullif(btrim(new.public_message), '');
  if tg_op = 'UPDATE' and new.purpose is distinct from old.purpose then
    raise exception 'purpose cannot be changed' using errcode = '55000';
  end if;
  return new;
end;
$$;
drop trigger if exists service_availability_stamp on public.service_availability;
create trigger service_availability_stamp before insert or update on public.service_availability
  for each row execute function public.service_availability_stamp();
-- audit: same shape as log_audit_change(), but this table's key is 'purpose' (log_audit_change reads 'id')
create or replace function public.service_availability_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), lower(tg_op), tg_table_name, new.purpose,
          case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end;
$$;
revoke execute on function public.service_availability_audit() from public;
drop trigger if exists audit_service_availability on public.service_availability;
create trigger audit_service_availability after insert or update on public.service_availability
  for each row execute function public.service_availability_audit();

-- The booking page must show a pause to a first-time visitor who has no session yet, but anon keeps NO table privilege.
-- This function returns ONLY what the patient is meant to see (which service, which dates, the message) for paused rows;
-- it exposes no actor, timestamp or non-paused row.
create or replace function public.list_service_pauses()
returns table (purpose text, paused_from date, paused_until date, public_message text)
language sql stable security definer set search_path = public as $$
  select s.purpose, s.paused_from, s.paused_until, s.public_message
    from public.service_availability s where s.is_paused order by s.purpose
$$;
revoke all on function public.list_service_pauses() from public;
grant execute on function public.list_service_pauses() to anon, authenticated;

-- is the purpose paused on this calendar day?
create or replace function public.service_is_paused(p_purpose text, p_day date) returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1 from public.service_availability s
     where s.purpose = p_purpose and s.is_paused
       and (s.paused_from  is null or p_day >= s.paused_from)
       and (s.paused_until is null or p_day <= s.paused_until))
$$;
revoke all on function public.service_is_paused(text, date) from public, anon;
grant execute on function public.service_is_paused(text, date) to authenticated;

-- enforcement on the booking itself (new bookings, and a change of purpose or time by a non-admin)
create or replace function public.bookings_service_pause_guard() returns trigger
language plpgsql set search_path = public as $$
declare v_day date := (new.scheduled_at at time zone 'Asia/Jerusalem')::date;
begin
  if public._is_jwt_admin() then
    return new;
  end if;
  if new.status in ('cancelled','rejected') then   -- never block cancelling
    return new;
  end if;
  if public.service_is_paused(new.visit_purpose, v_day) then
    raise exception 'service_unavailable' using errcode = 'SV001',
      detail = coalesce((select public_message from public.service_availability where purpose = new.visit_purpose), '');
  end if;
  return new;
end;
$$;
revoke all on function public.bookings_service_pause_guard() from public, anon;
drop trigger if exists bookings_service_pause_guard_ins on public.bookings;
create trigger bookings_service_pause_guard_ins before insert on public.bookings
  for each row execute function public.bookings_service_pause_guard();
drop trigger if exists bookings_service_pause_guard_upd on public.bookings;
create trigger bookings_service_pause_guard_upd before update of visit_purpose, scheduled_at on public.bookings
  for each row when (new.visit_purpose is distinct from old.visit_purpose or new.scheduled_at is distinct from old.scheduled_at)
  execute function public.bookings_service_pause_guard();
