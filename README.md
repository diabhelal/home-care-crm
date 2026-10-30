# Home Care CRM

**מערכת תיאום ותיעוד ביקורי בית רפואיים (אב-טיפוס עם נתונים סינתטיים בלבד).** מטופל מבקש ביקור בלי הרשמה, מנהל מאשר ומשבץ, אחות מגיעה, מתעדת מדדים וחתימה (גם בלי קליטה), והמערכת מציגה הערכת סיכון **מבוססת כללים** (תמיכה בהחלטה, לא אבחון ולא למידת מכונה). הממשק בעברית (RTL).
תיעוד המשך העבודה והמצב המעודכן: [`HANDOFF.md`](HANDOFF.md). הדגמה למרצה: [`docs/DEMO.md`](docs/DEMO.md).

> **Status:** working prototype / portfolio project, **synthetic data only**. It is not a certified medical device and not a production healthcare deployment. See [What works and what does not](#what-works-and-what-does-not-yet) before relying on anything below.

## Contents
[The problem](#the-problem-and-who-it-is-for) · [Status](#what-works-and-what-does-not-yet) · [Features](#main-features) · [Architecture](#architecture-and-folders) · [Install, run, test](#install-run-and-test) · [Risk engine](#risk-engine-rule-based) · [AI summary (PR #18)](#ai-visit-summary-draft-not-on-main-yet) · [Database and migrations](#database-and-migrations) · [Security](#security-in-brief) · [Limitations](#known-limitations) · [Roadmap](#next-steps) · [Document map](#document-map) · [Disclaimer](#disclaimer)

## The problem and who it is for
Home-care agencies coordinate nurses, doctors, physiotherapists and caregivers who visit patients at home. Today this is often phone calls and paper: patients cannot see availability, the office double-books staff, travel time between visits is ignored, visit documentation is lost when the nurse has no signal, and nobody gets a flag when a patient's vitals look worrying.
This project is a small CRM for that workflow, for three users:
- **Patient (guest, no account):** books a visit like booking a flight; sees "requested - waiting for approval" until an admin approves.
- **Nurse / staff (own login):** sees only the patients assigned to them, starts the visit (server time), records vitals, procedures, notes and signature - offline too.
- **Admin:** approves, rejects, reassigns or cancels requests, manages staff, sees patient records, alerts and a capacity forecast.

It was built as a hands-on exercise in a real Postgres/RLS security model, a guest-checkout identity pattern, and an honestly scoped "decision support" feature: transparent rules instead of a fabricated machine-learning claim where no validated model exists.

## What works and what does not (yet)
Evidence = automated tests unless stated. Test results below were measured on `main` on 2026-10-31 (commands in [Install, run and test](#install-run-and-test)).

| State | What | Evidence / note |
|---|---|---|
| **Works on `main`** | Guest booking through the Python backend, approval lifecycle (requested / confirmed / rejected), availability with a 30-minute travel buffer, check-in with server time, atomic visit completion, offline draft sync (per user, no lost or overwritten drafts), admin and staff panels, optional history saving (email; phone+SMS built but off), rule-based risk and alerts, Hebrew RTL PWA | node 57/57, mocked Playwright 55/55 (16 files), backend 139/139, isolated-Postgres 95/95, predictive service 17/17, CI green. One full booking cycle was also run by hand against the live project on 2026-10-15 (not saved as a test) |
| **On `main`, but its database part is NOT applied** | Staff deactivation instead of deletion, measurement history table with change vs the previous visit, risk status with age / "outdated", amendments to completed reports, patient archive and legal record export | UI and tests are on `main`; the SQL (`supabase/proposed/009`, `011`, `012`, `013`) is **not applied to the live database**, so these are only partly effective there ([docs/DATABASE.md](docs/DATABASE.md)) |
| **Written and tested, NOT applied** | Migrations `008`-`013` (visit-report integrity guard, deactivate-not-delete, booking-conflict guard on updates, risk status view, amendments, archive/export) | Isolated local Postgres only. `009` and `010` were approved by the owner on 2026-10-20 but the apply was cancelled; the live database still has 23 migrations (re-checked read-only on 2026-10-31) |
| **In review, not on `main`** | AI visit-summary draft (backend, UI, migration `014`, evaluation package) | [PR #18](https://github.com/diabhelal/home-care-crm/pull/18) - open, not merged. See [AI summary](#ai-visit-summary-draft-not-on-main-yet) |
| **Not built / planned** | Hosting of the backend and predictive service with HTTPS, MFA, legal documents (privacy, consent), penetration test, a trained and validated ML model, RAG, real-time updates | [Next steps](#next-steps) |

**Known open issues:** one mocked browser test (`staff-field-actions` "pending approval") is time-of-day dependent: it failed at 23:49 local on 2026-10-30 (also on a clean `main`) and passed at 00:12 and 00:30; not fixed. The predictive service runs locally and manually (last stored assessment, checked 2026-10-20: 2026-09-19). The live database has **no platform backup** on the current plan; a manual data copy and a code bundle exist (see [HANDOFF.md](HANDOFF.md)).

## Main features
- **No-registration booking, service first** - service, address, day, time; name / national ID / phone only at the last step (an anonymous Supabase session is created in the background). The booking is a *request*; an order number is shown.
- **Server-side availability** from each nurse's weekly schedule, existing bookings and a fixed **30-minute travel buffer** (same address back-to-back is allowed; an unknown address counts as different).
- **Approval lifecycle** - approve / reject / reassign / cancel, with conflict checks in the backend and in database triggers.
- **Staff field actions** - "next visit" with navigation and call buttons, check-in (server time), atomic completion.
- **Visit reports** - six vitals, five procedures, treatment summary and an on-screen signature; works offline (drafts per user, removed only after a confirmed server save).
- **Patient history** - optional email + password after booking; phone + SMS code is built behind `SMS_LOGIN_ENABLED` (off until an SMS provider exists). Booking never requires an account.
- **Risk assessment** (Green / Yellow / Red, trend) computed server-side and attested (HMAC) before it is stored; alerts and a work queue for admin and staff.
- **Patient record** - allergies, history, notes, medication log, service plans, measurement history, timeline (on `main`; see the status table for which parts need migrations).
- **Healthcare-style Hebrew RTL design** (Heebo), responsive to phone width, installable as a PWA.

## Architecture and folders
```
 public/ (static site: HTML + CSS + vanilla JS, no build step)
   |  reads: supabase-js (publishable key, RLS)        |  writes + live risk preview
   |                                                    v
   |                                  backend/ (Python/FastAPI, :8001) --HTTP--> predictive-service/ (FastAPI, :8000, rule-based)
   v                                          | caller's JWT (RLS stays in force)
 Supabase: Postgres + Auth + RLS + Edge Function create-staff-login
```
The browser **reads** from Supabase through RLS; **writes to bookings, visit reports, risk predictions and alerts go through the backend** with the caller's own JWT (never a service key). The database stays authoritative for new bookings (unique index and triggers refuse overlaps, buffer violations and self-approval even if the API is bypassed); the same check on booking *updates* is migration `010`, not applied to the live database yet. Neither Python service is hosted; both run locally.

| Folder / file | Role |
|---|---|
| `public/` | The static frontend: pages for patient, staff and admin (`js/admin/`, `js/shared/`), shared `app.js`, PWA files |
| `backend/` | Operational backend: booking, availability, approval, check-in, completion, risk orchestration. `app/`, `tests/`, `tests_db/` (isolated Postgres), `scripts/verify_proposed_sql.py`. Details: [`backend/README.md`](backend/README.md) |
| `predictive-service/` | Local rule-based clinical engine (risk, baseline, forecast, alerts) and the inactive ML scaffolding |
| `supabase/` | `migrations/` (23, match the live project), `proposed/` (SQL proposals incl. `008`-`013`, status in `APPLIED.md`), `functions/` (Edge Function), `config.toml` |
| `tests/` | `unit/` (node) and `e2e/` (Playwright; see [`tests/e2e/README.md`](tests/e2e/README.md)) |
| `docs/` | Documentation (see the [document map](#document-map)); the file-by-file frontend tree is in [`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md) |
| `.github/workflows/ci.yml`, `.githooks/` | CI (secret scan, unit, backend + isolated DB, mocked Playwright) and an opt-in pre-commit secret scan |
| `.claude/` | Project skills and agents for the AI assistant (working aids, not part of the product) |

Technology: static HTML/CSS/vanilla JS, `supabase-js` v2 (CDN), Supabase (Postgres, Auth, RLS, PostgREST), Python/FastAPI + Pydantic + Uvicorn, Playwright and `node --test` for tests. Not used: React or any framework, a build step, Docker, Realtime.

## Install, run and test
**Prerequisites:** Python 3.12+ (developed on 3.13), Node.js 20+, a browser. The frontend in `public/config.js` already points at the project's Supabase URL with the publishable key (synthetic data); use your own project by editing it (publishable key only, never a secret).

**Fastest look, no Supabase and no backend needed** - the mocked end-to-end journey (patient -> admin -> nurse):
```bash
npm install && npx playwright install chromium
npx playwright test tests/e2e/demo-journey.spec.js        # screenshots land in docs/demo-proof/
```

**Run the system locally (three terminals):**
```bash
cd public && python3 -m http.server 8080                         # frontend: http://localhost:8080/index.html
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt          # pinned set: requirements.lock.txt
cp .env.example .env                                             # fill the values (git-ignored)
uvicorn app.main:app --port 8001 --env-file .env                 # health: http://localhost:8001/healthz
cd predictive-service && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
uvicorn main:app --port 8000                                     # optional (risk preview, capacity); health: /health
```
Without the backend, booking shows "service unavailable" by design; without the predictive service a banner says so and the rest works.

**Configuration** (no secrets in Git): the frontend reads `public/config.js` (`SUPABASE_URL`, publishable key, `BACKEND_URL`, `PREDICTIVE_SERVICE_URL`, `SMS_LOGIN_ENABLED`, `DEMO_MODE`). The backend reads `backend/.env` (template `backend/.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ALLOWED_ORIGINS`, `RISK_ATTESTATION_SECRET` (the same value as the database row `server_secrets.risk_attestation_secret`), optional `SUPABASE_JWT_SECRET`, `PREDICTIVE_SERVICE_URL`, business rules. Full list and defaults: [`backend/README.md`](backend/README.md); the complete variable table is in [`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md). A service-role key is never used by the app (only the Edge Function holds one, server-side).

**Tests** (results on `main`, 2026-10-31):
```bash
node --test tests/unit/*.test.js                                                                        # 57 pass
ls tests/e2e/*.spec.js | grep -vE "/(booking|visit-report)\.spec\.js$" | xargs npx playwright test      # 55 pass (16 files)
cd backend && source .venv/bin/activate && pytest -q --ignore=tests_db && pytest tests_db -q            # 139 and 95 pass
python scripts/verify_proposed_sql.py                                                                    # OK (apply + re-apply + rollback of every migration)
cd ../predictive-service && source .venv/bin/activate && pytest -q                                      # 17 pass
```
**Never run `booking.spec.js` or `visit-report.spec.js` against the live project** (they write real rows; they are manual-only in CI). Database migrations are applied only with the owner's approval, one at a time ([docs/DATABASE.md](docs/DATABASE.md)).

## Risk engine (rule-based)
The Green / Yellow / Red indicator, trend, baseline and forecasts are **hand-written clinical rules and classical statistics** (thresholds per vital, medians, linear regression, ARIMA from 8 measurements). **There is no trained ML model**: the supervised-learning scaffolding (`ml_targets.py`) is architecture only - `models/` is empty and it returns "model not available" instead of inventing a probability - and the LSTM file is a placeholder. The thresholds are general and not validated for this project (a document for clinician review exists). Endpoints, the "what is ML and what is not" table and the time-aware history: [`docs/RISK_ENGINE.md`](docs/RISK_ENGINE.md).

## AI visit-summary draft (not on `main` yet)
**Status: in [PR #18](https://github.com/diabhelal/home-care-crm/pull/18), open and not merged; nothing in this section is active on `main`.** It is an opt-in feature (off by default, synthetic data only): a nurse can ask an LLM for a Hebrew *draft* summary of the current visit, edit it and explicitly approve it before completing the visit through the existing path. Generation saves nothing; provenance needs migration `014` (not applied), so the feature stays closed until the owner declares it applied. The evaluation package (32 fictional Hebrew cases, dev / held-out split) has a **measured non-LLM baseline only; the real-LLM run and the human review are pending**. No clinical validity is claimed. Details, limits and cost estimate live in the PR's `docs/AI_SUMMARY.md` and `backend/eval/summary/README.md`; the docs will be on `main` after the merge.

## Database and migrations
16 tables in `public`, all with RLS; patients see their own rows, staff their assigned patients, admins everything; `anon` has no table grants. Table-by-table description, the migration table and what not applying `008`-`013` means: [`docs/DATABASE.md`](docs/DATABASE.md). Status per proposal: [`supabase/proposed/APPLIED.md`](supabase/proposed/APPLIED.md). Do not run `supabase config push` casually (it overwrites the whole `[auth]` section).

## Security in brief
RLS is the access-control layer (admin via `app_metadata.is_admin`, settable only through the Auth Admin API); the browser holds only the publishable key; no browser writes to the critical tables; risk predictions and alerts need a backend-produced HMAC; free text is HTML-escaped; CI scans the whole history for secrets and a pre-commit hook blocks them; `SECURITY.md` explains how to report an issue. Anonymous booking is a deliberate trade-off (no CAPTCHA yet). Two Supabase Auth settings (leaked-password protection, more MFA methods) are not enabled. Full text: [`docs/SECURITY_ARCHITECTURE.md`](docs/SECURITY_ARCHITECTURE.md); review and findings: [`docs/REVIEW.md`](docs/REVIEW.md).

## Known limitations
- **Prototype:** synthetic data; real use needs privacy policy and informed consent under Israeli law, hosting with HTTPS, MFA, a penetration test and legal review.
- **Hosting:** the backend and predictive service are not hosted. A hosted setup needs HTTPS, `BACKEND_URL`, the CSP `connect-src` and CORS ([`DEPLOY.md`](DEPLOY.md)).
- **Roles:** admin and staff only; no finer-grained RBAC, no family-member role.
- **No live updates:** every read is a direct call per page load (no Realtime, no query cache).
- **No external alerting:** alerts are shown on screen; nothing is sent by email, SMS or phone.
- **Offline drafts** are in `localStorage`, separated per user but **not encrypted**.
- **Guest identity is per browser** unless the patient saves the history by email (phone + SMS is built but off).
- **Travel buffer** is a constant 30 minutes, not computed travel time; proximity ranking needs coordinates and a geocoder (a no-op geocoder is the default).
- **Live-DB end-to-end specs** (`booking`, `visit-report`) need a dedicated test project that does not exist yet.
- **Demo mode** (`DEMO_MODE`) shows a "synthetic data only" banner.

## Next steps
Roughly by value. Items marked *(owner)* need a decision or approval.
1. Merge/review [PR #18](https://github.com/diabhelal/home-care-crm/pull/18) *(owner)*; run the real-LLM evaluation after a key and budget are approved, then the human review by a licensed nurse.
2. Let the staff member who wrote a report update it (changes `008` and the UI), then apply `008`-`013` to the live database one at a time with verification *(owner approval each)*.
3. Host the backend and predictive service with HTTPS so assessments are produced continuously.
4. Product decisions: whether patients may see staff identity, price and service-area information. Legal decision: record retention period and disclosure grounds.
5. A dedicated test Supabase project so the live-DB E2E specs can run; fix the time-dependent test.
6. SMS provider + CAPTCHA, MFA and leaked-password protection; a trained and *validated* model only if a real outcome-labelled dataset is ever collected.

## Document map
| Status | Document | Purpose |
|---|---|---|
| **Current** | [`HANDOFF.md`](HANDOFF.md) | Where the project stands, what is pending, how to continue (Hebrew) |
| **Current** | [`CLAUDE.md`](CLAUDE.md), `AGENTS.md` | Working rules and notes for the AI assistant (branch + PR policy, safety rules) |
| **Current** | [`docs/DATABASE.md`](docs/DATABASE.md), [`docs/RISK_ENGINE.md`](docs/RISK_ENGINE.md) | Tables and migration status; risk engine details |
| **Current** | [`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md), [`docs/SECURITY_ARCHITECTURE.md`](docs/SECURITY_ARCHITECTURE.md) | Workflows, booking flow, visit reports, full setup and variable table; the full security architecture |
| **Current** | [`docs/REVIEW.md`](docs/REVIEW.md), [`docs/DEMO.md`](docs/DEMO.md) | Professional review and tested claims; demo script for the lecturer (Hebrew) |
| **Current** | [`backend/README.md`](backend/README.md), [`tests/e2e/README.md`](tests/e2e/README.md), [`SECURITY.md`](SECURITY.md) | Backend run/config; which E2E specs are safe; vulnerability reporting |
| **Current** | [`supabase/proposed/APPLIED.md`](supabase/proposed/APPLIED.md) | Apply status of each SQL proposal |
| **Plan** | [`docs/STAGING_PLAN.md`](docs/STAGING_PLAN.md), [`DEPLOY.md`](DEPLOY.md) | Applying migrations with rollback; deployment plan (not done) |
| **Plan / history** | [`docs/WORKPLAN.md`](docs/WORKPLAN.md), [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md) | The completed backend/booking work plan; folder responsibilities and what must be preserved |
| **For a clinician** | [`predictive-service/CLINICAL_THRESHOLDS_FOR_REVIEW.md`](predictive-service/CLINICAL_THRESHOLDS_FOR_REVIEW.md) | The risk thresholds, for medical review |
| **Historical** | [`PLAN.md`](PLAN.md) | The original MVP plan (banner inside) |
| **Generated** | `docs/demo-proof/` | Screenshots regenerated by the demo test |

## Disclaimer
The risk indicator, trend detection and forecasts are **decision-support and prototype functionality only**: hand-written threshold rules and arithmetic, not a clinically validated diagnostic tool and never a substitute for a qualified healthcare professional. The system does not predict, diagnose or give a clinical probability of specific medical events, and has no automatic emergency alerting. Do not use this project, as-is, to make real clinical decisions.
