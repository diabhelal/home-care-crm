# Database (Supabase / Postgres)

> **Current state, verified 2026-10-31 (read-only):** the live project `qqeupktyadjxqoxkstnl` had **23 migrations registered** (last `20261015155238`); on 2026-11-07 proposals `019` and `020` were applied (now **25 registered**, last `20261107131226`). Proposals `008`–`013` (and `014`, in PR #18) are written and tested on an isolated local Postgres but are **not applied**; see [Migration status](#migration-status). Overview and how to run: [README](../README.md).

All tables live in the `public` schema, have RLS enabled, and follow a consistent access pattern: patients can read/write only their own rows (`auth.uid()` ownership check), and a separate `admin_full_access_*` policy grants an admin account (flagged via `app_metadata.is_admin`, settable only through the Auth Admin API) full access across all tables. The `anon` Postgres role has **no** grants on any application table — every request must carry a valid Supabase session (anonymous or authenticated).

| Table | Purpose |
|---|---|
| `patients` | One row per patient, 1:1 with `auth.users` (including anonymous guest users). Name, phone, address, date of birth, national ID, emergency contact, and background medical conditions (`text[]`, e.g. diabetes/hypertension/heart failure). |
| `medical_staff` | Staff directory: name, role, specialization, weekly availability window, appointment slot length, active flag, and (since the real staff-login system) an `auth_user_id` linking a staff row to its own Supabase Auth account. |
| `bookings` | A scheduled visit: patient, staff member, purpose, date/time, `status` (`scheduled`/`completed`/`cancelled`), and a separate `workflow_status` (`unassigned`/`assigned`/`in_progress`) that drives the admin/staff work-queue views. A partial unique index on `(staff_id, scheduled_at)` (excluding cancelled rows) prevents double-booking while still letting a cancelled slot be rebooked. |
| `visit_reports` | One report per completed/scheduled booking (1:1 via a unique `booking_id`): six vital signs (each with a plausible-range `CHECK` constraint), five procedure flags, a free-text treatment summary, a `clinical_outcome_8h` follow-up field, and a base64-encoded captured signature image. |
| `risk_predictions` | Append-only log of rule-based risk assessments: risk level, trend vs. the previous visit, a time-bound expiry, and the exact input vitals snapshot. Never updated or treated as a permanent patient label — see below. |
| `patient_allergies`, `patient_medical_history`, `clinical_notes`, `medication_events` | The Patient Medical Record module: structured allergy/anamnesis data, append-only clinical notes, and a medication administration log — each patient-scoped, RLS-protected, and editable from the admin/staff patient-record tabs. |
| `service_plans`, `service_plan_visits` | Recurring-visit plans (frequency, preferred weekdays/time) and the individual planned-visit rows generated from a plan via the predictive service's `/plan/generate-visits` endpoint. |
| `patient_documents`, `patient_contacts` | Uploaded documents (private Storage bucket) and a patient↔admin message thread (also used by the public "יצירת קשר" contact form on `index.html`). |
| `alerts`, `tasks` | System-raised clinical alerts (e.g. a new Red risk reading) and staff follow-up tasks, surfaced in the "מי דורש תשומת לב" admin dashboard and each patient record's Alerts tab. |
| `audit_log` | Append-only change log (old/new row snapshots) written automatically by a `SECURITY DEFINER` trigger on updates to sensitive tables — never written to directly. |

16 tables in total, plus a `current_patient_risk` database view (defined with `security_invoker` so it respects RLS rather than bypassing it) that resolves each patient's *current, non-expired* risk assessment — the most recent prediction whose validity window hasn't elapsed.

23 migrations are recorded under `supabase/migrations/` and match the live project one-to-one (run `ls supabase/migrations/`). The first 16 are the original schema, identity-model pivot, visit reports, risk predictions, the Patient Medical Record module, staff login and security follow-ups. The last 7 (`001–007`, applied on 2026-10-15) add the approval lifecycle (`approval_status`: requested / confirmed / rejected), visit address and check-in columns, atomic completion functions, **trigger guards on `bookings`** (no self-approval, no double booking, 30-minute buffer), server-attested risk predictions and alerts (HMAC), and writer-identity enforcement on clinical notes.

## Migration status

| Range | What it is | State |
|---|---|---|
| 16 original migrations (`supabase/migrations/`, Aug-Sep 2026) | schema, identity model, visit reports, risk predictions, patient record module, staff login, security follow-ups | **applied** |
| `001`-`007` (`supabase/proposed/` -> `supabase/migrations/`, applied 2026-10-15) | approval lifecycle, visit address + check-in, atomic completion, booking guards, server-attested risk/alerts, authorship | **applied** (post-flight verified; recorded under the registered versions) |
| `008` visit-report integrity | a trigger: a report only for a confirmed visit with matching patient/staff, identity immutable, completed content locked, admin-only delete | **not applied** (isolated-Postgres tests only). *Open request:* let the staff member who wrote a report update it; `008` as written locks completed content, so it must be changed first |
| `009` deactivate instead of delete staff | `ON DELETE RESTRICT` on the staff foreign keys, no new assignments to inactive staff, one narrow SELECT policy so a patient's history keeps the staff name | **not applied** (approved by the owner on 2026-10-20; the apply was cancelled at the tool prompt, nothing changed) |
| `010` booking update conflict guard | overlap and 30-minute buffer enforced on UPDATE too (time, staff, address, reactivation), for every caller including admins | **not applied** (approved, same cancellation) |
| `011` risk status always visible | `current_patient_risk` returns the latest assessment with `age_hours`, `is_stale`, `newer_report_exists` instead of dropping it after 8 hours | **not applied** |
| `012` visit-report amendments | append-only amendments (correction / clarification) pointing at the original report | **not applied** |
| `013` patient archive + record export | archive columns on `patients`, admin-only `export_patient_record()` that always writes an append-only access log | **not applied**; the retention period and the legal grounds for disclosure are legal decisions (nothing is deleted automatically, no claim of legal compliance) |

Per-file status, rollback blocks and the apply procedure: [`supabase/proposed/APPLIED.md`](../supabase/proposed/APPLIED.md), [`STAGING_PLAN.md`](STAGING_PLAN.md) section 6 and `backend/scripts/verify_proposed_sql.py` (applies every migration + proposal, re-applies, runs post-flight checks and the rollbacks on a throwaway Postgres).

**Effect of not applying them today:** deleting a staff member still cascades away their bookings and reports; a direct administrator write can bypass the booking-conflict check; the traffic-light risk status disappears 8 hours after a visit; the client features that depend on `009`/`011`/`012`/`013` (deactivate button, amendment form, archive/export) are on `main` but their database part is missing, so by design they show a clear error or less information (this behaviour is covered by mocked tests, not exercised against the live database). Recovery: the live database has **no platform backup** on the current plan; a manual data copy and a code bundle exist (see [HANDOFF](../HANDOFF.md)).

**Rule:** never apply a migration to the live project without the owner's explicit approval, one migration at a time, with a verification after each.
