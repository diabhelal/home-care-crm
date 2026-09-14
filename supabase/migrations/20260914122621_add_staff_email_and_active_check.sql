-- Staff login provisioning: email field on medical_staff (used as the login identity,
-- set by admin before the "Create Staff Login" action invites the real auth account),
-- and current_staff_id() now checks is_active — deactivating a staff member revokes
-- their RLS-derived access immediately at the database level, not only at the login
-- page (defense in depth against a modified/rogue client with a still-valid session).

alter table public.medical_staff add column email text unique;

create or replace function public.current_staff_id() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.medical_staff where auth_user_id = auth.uid() and is_active = true;
$$;
