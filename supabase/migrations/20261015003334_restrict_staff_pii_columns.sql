-- Staff PII (national_id, email, phone) must not be readable by patients/guests.
-- RLS filters rows, not columns, so use column-level privileges instead.
revoke select on public.medical_staff from authenticated;

grant select (id, full_name, role, specialization, available_weekdays,
              work_start_time, work_end_time, slot_duration_minutes,
              is_active, created_at, auth_user_id)
  on public.medical_staff to authenticated;

-- Admins still need the full row (edit form): expose it only via a function
-- that checks is_admin from the JWT.
create or replace function public.admin_list_staff()
returns setof public.medical_staff
language sql
stable
security definer
set search_path = public
as $$
  select * from public.medical_staff
  where coalesce((((select auth.jwt()) -> 'app_metadata') ->> 'is_admin')::boolean, false)
  order by id;
$$;

revoke execute on function public.admin_list_staff() from public, anon;
grant execute on function public.admin_list_staff() to authenticated;
