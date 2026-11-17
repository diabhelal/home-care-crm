-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration.
-- Only REVOKEs, plus re-stating the grants that are already intended. No row, column, policy or function body changes.
-- Depends on: risk_predictions (20260911221420) + 006, 015 (delete/truncate revokes), 021 (service_availability).
--
-- Why: on hosted Supabase, the default privileges of schema `public` give anon, authenticated and service_role ALL on
-- every NEW table/sequence and EXECUTE on every NEW function. A migration that only GRANTs what it wants therefore keeps
-- the extra privileges. Found on the dev project (home-care-crm-dev, 2026-11-16) after applying the repo SQL:
--   * risk_predictions: anon had select/insert/update/references/trigger; authenticated had update/references/trigger.
--     (The live project already has authenticated = SELECT only and nothing for anon - corrected by hand in the past,
--     never in a migration. On the live project this part is a no-op.)
--   * service_availability (021): authenticated kept DELETE/TRUNCATE/REFERENCES/TRIGGER although 021 says "no DELETE";
--     its trigger-only functions were executable by anon/authenticated.
-- RLS already limited rows, but privileges are the outer wall (TRUNCATE is not subject to RLS at all).
--
-- Kept, unchanged: authenticated SELECT on risk_predictions (RLS: admin, or staff for an assigned patient); risk rows are
-- written only by record_risk_prediction() (SECURITY DEFINER, 006). authenticated SELECT/INSERT/UPDATE on
-- service_availability (RLS: read for every signed-in user, insert/update for admins only = pause/resume in admin).
-- list_service_pauses() stays executable by anon (the public booking page).
-- Idempotent: safe to re-run; safe on a database that already applied 021.
--
-- Reverse SQL: see docs/STAGING_PLAN.md (ROLLBACK 022).

revoke all on public.risk_predictions from anon, public;
revoke insert, update, delete, truncate, references, trigger on public.risk_predictions from authenticated;
grant select on public.risk_predictions to authenticated;
revoke all on sequence public.risk_predictions_id_seq from anon, public;

revoke all on public.service_availability from anon, public;
revoke delete, truncate, references, trigger on public.service_availability from authenticated;
grant select, insert, update on public.service_availability to authenticated;

-- trigger-only functions: a trigger fires without EXECUTE for the caller (same pattern as 015's guards)
revoke all on function public.service_availability_stamp() from public, anon, authenticated;
revoke all on function public.service_availability_audit() from public, anon, authenticated;
revoke all on function public.bookings_service_pause_guard() from public, anon, authenticated;
