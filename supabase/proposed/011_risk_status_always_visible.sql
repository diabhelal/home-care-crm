-- PROPOSED, NOT APPLIED to the live project. Review -> isolated-Postgres tests -> get_advisors -> apply_migration
-- (then copy to supabase/migrations/ under the exact registered version name; see supabase/proposed/APPLIED.md).
-- Redefines ONE view (CREATE OR REPLACE VIEW, columns appended); no table, row or grant is changed or deleted.
-- Depends on: risk_predictions, visit_reports (init / 20260911221420).
--
-- Problem (CONFIRMED on the live project, read-only): current_patient_risk only returned predictions with
-- expires_at > now(), and every prediction expires 8 hours after the visit (expires_at = predicted_at + the 8h horizon).
-- So the traffic-light status of every patient silently vanished 8 hours after the visit: on 2026-10-20 the view returned
-- no row at all although 21 predictions exist. The 8h value is the forecast horizon, not "how long the last status is
-- valid"; a RED status must not disappear, and an old GREEN must not look current.
--
-- Change: the view returns the LATEST prediction per patient regardless of expiry, plus three appended columns:
--   age_hours             hours since the prediction was made;
--   is_stale              true when the prediction is older than 24 hours (the UI labels it "outdated");
--   newer_report_exists   true when a visit report was saved after the prediction (assessment missing/failed/pending).
-- Every prediction row stays in risk_predictions forever (history/archive); nothing is deleted.
-- security_invoker stays on, so the caller's RLS on risk_predictions and visit_reports still applies.
--
-- Reverse SQL (restores the previous definition):
--   create or replace view public.current_patient_risk with (security_invoker = true) as
--     select distinct on (patient_id) patient_id, risk_level, trend, confidence, probability, predicted_at, expires_at,
--            prediction_horizon_hours, visit_report_id
--       from public.risk_predictions where expires_at > now() order by patient_id, predicted_at desc;
--   -- (dropping the three appended columns requires DROP VIEW + CREATE VIEW + re-grant select to authenticated)

create or replace view public.current_patient_risk with (security_invoker = true) as
  select distinct on (rp.patient_id)
    rp.patient_id,
    rp.risk_level,
    rp.trend,
    rp.confidence,
    rp.probability,
    rp.predicted_at,
    rp.expires_at,
    rp.prediction_horizon_hours,
    rp.visit_report_id,
    extract(epoch from (now() - rp.predicted_at)) / 3600.0 as age_hours,
    (now() - rp.predicted_at) > interval '24 hours' as is_stale,
    exists (select 1 from public.visit_reports vr
             where vr.patient_id = rp.patient_id and vr.created_at > rp.predicted_at) as newer_report_exists
  from public.risk_predictions rp
  order by rp.patient_id, rp.predicted_at desc;
