-- PROPOSED, NOT APPLIED. Review before applying; follow the CLAUDE.md migration workflow
-- (execute_sql iteration -> get_advisors -> apply_migration -> local file with the exact registered version name).
-- Additive only; no data deletion.

-- Lets the backend (acting with a patient's JWT) see WHEN a staff member is busy, for
-- travel-buffer checks, WITHOUT exposing other patients' rows or PII.
-- Privacy: other patients' addresses and coordinates never leave the database. The
-- caller passes the address it wants to book; the function returns that same string
-- (never the stored one) only for blocks whose stored address matches it, and NULL
-- otherwise. Coordinates are never returned.
-- Normalisation mirrors backend/app/scheduling.py::norm_address (lower + collapse whitespace).
create or replace function public.staff_busy_blocks(
  p_staff_id bigint, p_from timestamptz, p_to timestamptz, p_address text default null)
returns table (id bigint, staff_id bigint, scheduled_at timestamptz, status text,
               visit_address text)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.staff_id, b.scheduled_at, b.status,
         case when p_address is not null
                and btrim(p_address) <> ''
                and lower(regexp_replace(btrim(b.visit_address), '\s+', ' ', 'g'))
                  = lower(regexp_replace(btrim(p_address), '\s+', ' ', 'g'))
              then p_address end as visit_address
    from public.bookings b
   where b.staff_id = p_staff_id and b.status <> 'cancelled'
     and b.approval_status <> 'rejected'
     and b.scheduled_at >= p_from and b.scheduled_at < p_to;
$$;

revoke all on function public.staff_busy_blocks(bigint, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.staff_busy_blocks(bigint, timestamptz, timestamptz, text) to authenticated;
