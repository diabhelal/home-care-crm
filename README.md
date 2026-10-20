# Home Care CRM

A booking and visit-management platform for a home healthcare service. Patients book home visits with nurses, doctors, physiotherapists, or caregivers with no registration step (a guest-checkout flow, similar to booking a flight); staff document each visit's vitals and procedures; an admin panel manages staff, bookings, and a rule-based clinical decision-support layer for vitals trends and capacity planning.

> **Status:** working prototype / portfolio project with **synthetic data only**, not a certified medical device or a production healthcare deployment. Staff are nurses only (configurable in `public/config.js`). For a reviewer: start with [`docs/DEMO.md`](docs/DEMO.md) (walkthrough) and [`docs/REVIEW.md`](docs/REVIEW.md) (what is tested, what is rule-based vs. ML, security). See [Disclaimer](#disclaimer--medical-risk-functionality) and [Known Limitations](#known-limitations).

---

## Table of Contents

- [Overview & Purpose](#overview--purpose)
- [Main Features](#main-features)
- [Workflows](#workflows)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Database](#database)
- [Home-Visit Booking Flow](#home-visit-booking-flow)
- [Visit Reports & Vital-Sign Tracking](#visit-reports--vital-sign-tracking)
- [Predictive / Decision-Support Engine](#predictive--decision-support-engine)
- [Security Architecture](#security-architecture)
- [Installation & Local Setup](#installation--local-setup)
- [Environment Variables](#environment-variables)
- [Running the Application](#running-the-application)
- [Project Structure](#project-structure)
- [Known Limitations](#known-limitations)
- [Future Development / Roadmap](#future-development--roadmap)
- [Disclaimer — Medical Risk Functionality](#disclaimer--medical-risk-functionality)

---

## Overview & Purpose

Home care agencies coordinate visiting nurses, doctors, physiotherapists, and caregivers with patients who need in-home medical attention. This project is a small CRM for that workflow: a public booking site for patients, and an admin panel for staff to manage schedules, record visit data, and get lightweight, rule-based flags when a patient's vitals look concerning.

It was built as a hands-on exercise in designing a real Postgres/RLS security model, a guest-checkout identity pattern, and an honestly-scoped "decision support" feature — deliberately choosing transparent rule-based logic over a fabricated machine-learning claim where no trained/validated model exists.

## Main Features

- **No-registration patient booking, service first** — choose a service (default: general check-up), an address, a day and a time; name / national ID / phone are asked only at the final step (an anonymous Supabase Auth session is created transparently in the background). The booking is a **request**: it shows "requested — waiting for approval" with an order number until an admin approves it.
- **Server-side availability** — computed by the Python backend from each nurse's weekly schedule, existing bookings and a **30-minute travel buffer** between visits. Days without free slots are greyed out.
- **Admin approval lifecycle** — approve / reject / reassign / cancel, with conflict checks enforced both in the backend and by database triggers.
- **Staff field actions** — "next visit" card with navigation and call buttons, check-in (**server time**, not browser time), and atomic visit completion.
- **Visit reports** — vitals, procedures, treatment summary and an on-screen patient signature. Works **offline**: drafts are stored per user on the device and synced when the network returns (deleted only after a confirmed save).
- **Optional history saving for patients** — after booking, a patient may save their history with **email + password**, or with **phone + SMS code** (the SMS option is built and tested but hidden behind `SMS_LOGIN_ENABLED` in `public/config.js` until an SMS provider is configured). Booking never requires an account.
- **Rule-based risk assessment** (Green/Yellow/Red) with trend detection, attested server-side before it is stored (see Security). Labelled "rule-based — demonstration" in the UI.
- **Admin panel** — bookings, staff, patients and their records, capacity forecast, alerts.
- **Healthcare-style Hebrew RTL design** (Heebo, navy/mint palette), responsive down to phone width, installable as a PWA.

## Workflows

**Patient (guest, no login):**
1. Land on the homepage and choose a service.
2. Enter the visit address, then pick a day and a time that has free slots.
3. Enter name, national ID, phone — the only point personal details are collected — and confirm. The request is sent to the backend (idempotent: a retry never creates a duplicate).
4. See "requested — waiting for approval" and an order number; follow the status (requested → confirmed → in progress → completed) in "My Bookings", or cancel.
5. Optionally save the history by email or SMS to see bookings from another device.

**Nurse (own login, `employee.html`):**
1. Sees only the patients/bookings assigned to them (enforced by RLS).
2. Opens "next visit" → navigate / call → check in (server time).
3. Records vitals, procedures, summary and signature, then saves; the risk level and trend are recalculated server-side. Works offline.

**Admin (`admin.html`):**
- Approves, rejects, reassigns or cancels booking requests; manages staff and availability; views patients and records; sees alerts and a capacity forecast.

## Architecture

```
                    ┌─────────────────────────────┐
                    │  public/ (static site)       │
                    │  HTML + CSS + vanilla JS     │
                    └──┬──────────┬────────────┬──┘
        reads (RLS)    │          │ writes     │ live risk preview,
        supabase-js,   │          │ (user JWT) │ capacity forecast
        publishable key│          ▼            ▼
                       │   ┌────────────────┐  ┌──────────────────────┐
                       │   │ backend/        │─▶│ predictive-service/   │
                       │   │ Python/FastAPI  │  │ Python/FastAPI        │
                       │   │ port 8001       │  │ port 8000, rule-based │
                       │   └───────┬────────┘  └──────────────────────┘
                       ▼           │ caller's JWT (RLS kept)
                ┌─────────────────────────────────┐
                │ Supabase: Postgres + Auth + RLS   │
                │ + Edge Function create-staff-login│
                └─────────────────────────────────┘
```

Neither Python service is hosted yet; both run locally.



- The frontend is a set of static HTML pages. **Reads** go to Supabase's REST API (PostgREST) through `supabase-js`; **writes to bookings, visit reports, risk predictions and alerts go through the Python backend (`backend/`)** — the browser has no direct write path to those tables.
- All data access control is enforced in the database via **Row Level Security (RLS)** policies, not in application code.
- A separate, **local-only** Python service (`predictive-service/`) provides the rule-based risk/trend/capacity calculations over HTTP. It holds no database connection and no patient data of its own — it receives numbers (from the browser for the live preview and capacity forecast, and from the backend when a risk assessment is stored) and returns a classification.
- A GitHub Actions CI pipeline (`.github/workflows/ci.yml`) runs, on every push/PR: a secret scan over the whole git history, the JS unit tests, the `predictive-service` pytest suite, the `backend` pytest suite plus its isolated-database tests (`backend/tests_db`, throwaway local Postgres), and 16 mocked Playwright specs. There is no separate staging/production environment yet (see [Known Limitations](#known-limitations)).

### Python backend for operational logic (`backend/`)

Booking and visit-lifecycle writes go through a separate **FastAPI** service, not straight to the database:

```
browser ──(Bearer = Supabase session JWT)──▶ backend/ (FastAPI) ──(caller's JWT, RLS preserved)──▶ Supabase
                                                  │
                                                  └─ HTTP ─▶ predictive-service/ (rule-based clinical engine)
```

- **What it owns:** booking request validation + idempotency, availability with a fixed 30-minute travel buffer, staff eligibility and auto-assignment, admin approve / reject / reassign / cancel, server-generated check-in time, atomic visit completion, and the clinical-outcome update.
- **What it does not do:** it never uses a `service_role` key, never trusts a user/staff id from the request body, and does not contain clinical formulas (those stay in `predictive-service/`).
- **Database remains authoritative:** unique index + proposed trigger guards (`supabase/proposed/`) enforce slots, buffer, ownership and the approval state in SQL, so a direct PostgREST call cannot bypass them. Browser availability is advisory.
- **Status:** implemented and tested (pytest + an isolated local PostgreSQL + a live end-to-end cycle). The SQL in `supabase/proposed/001–007` **was applied to the live Supabase project on 2026-10-15** (recorded in `supabase/migrations/`). The backend still has to be **run** (locally `uvicorn app.main:app --port 8001`) and is **not hosted** yet. See `backend/README.md` and `docs/WORKPLAN.md`.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Static HTML5 + CSS3 + vanilla JavaScript (ES2017+), no framework, no build step, no bundler |
| Frontend/DB client | [`supabase-js`](https://github.com/supabase/supabase-js) v2, loaded from a CDN `<script>` tag |
| Database | PostgreSQL (managed by Supabase) |
| Auth | Supabase Auth — anonymous sign-ins for patients (optionally upgraded to email/password or phone+SMS), email/password for admin and staff |
| API layer | Supabase PostgREST Data API for reads; **FastAPI backend (`backend/`) for booking and visit-lifecycle writes** |
| Access control | PostgreSQL Row Level Security (RLS) policies |
| Decision-support service | Python 3, [FastAPI](https://fastapi.tiangolo.com/), [Pydantic](https://docs.pydantic.dev/), served by [Uvicorn](https://www.uvicorn.org/) |
| Fonts | Google Fonts (Heebo) |

**Not currently used, despite being common in comparable stacks:** React or any frontend framework, TanStack Query, Supabase Realtime, Docker. The operational backend is Python/FastAPI (not Node). Tests: `node --test` (57), Playwright (mocked, 55 tests), `pytest` for the backend (139) and the predictive service (17), plus 95 database tests on an isolated local Postgres.

## Database

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

## Home-Visit Booking Flow

1. On every page load, `ensureGuestSession()` (`public/app.js`) creates an anonymous Supabase session if none exists, so every visitor has a real `auth.uid()` and ownership-based RLS works without a visible login.
2. On `booking.html` the patient picks a service, enters the address, and the page asks the backend (`GET /availability`) for each day's free slots; days with none are disabled. Slots already include the 30-minute travel buffer.
3. After choosing a slot, the patient enters name / national ID / phone. Details are saved to `patients` (RLS-scoped), then `POST /bookings/request` is sent with an **idempotency key**, so a retry after a network failure does not create a second booking.
4. The booking is created as `requested`. An admin approves / rejects / reassigns it; database triggers refuse overlapping slots, buffer violations and self-approval even if the API is bypassed.
5. `my-bookings.html` shows the patient's bookings with an order number and status steps, and allows cancellation through the backend.

## Visit Reports & Vital-Sign Tracking

From the admin panel, opening a booking's visit-report form lets staff record: systolic/diastolic blood pressure, blood sugar, pulse, temperature, oxygen saturation; which of five procedures were performed; a free-text treatment summary; and a signature captured live on an HTML `<canvas>` and stored as a base64 PNG data URL. Saving performs an `upsert` keyed on the booking, so a report can be created once and edited later. Patients can view (read-only) their own saved reports from `my-bookings.html`; all patient-supplied and staff-entered text is HTML-escaped before rendering to prevent stored XSS.

## Predictive / Decision-Support Engine

**This is explicitly rule-based decision support, not a trained or validated machine-learning system for diagnosing medical events.** The distinction matters and is maintained throughout the codebase and this document.

The `predictive-service` (Python/FastAPI, `predictive-service/main.py`) exposes:

13 endpoints exist in `main.py`; the ones the frontend actually calls today:

| Endpoint | What it does |
|---|---|
| `POST /predict/capacity` | Arithmetic forecast: `(visits_this_month / active_patients) × (active_patients × (1 + growth_rate))`, rounded — an estimate of next month's expected visit volume, used for supply/staffing planning in the admin dashboard. |
| `POST /predict/risk-level` | Classifies a single set of vitals into Green/Yellow/Red using fixed, hand-written clinical threshold bands per vital (e.g. oxygen saturation <90% = red), optionally escalated by background medical conditions/smoking status. The overall result is the worst band among whichever vitals were supplied. |
| `POST /predict/risk-assessment` | The persisted version used by the app: classifies the current vitals, and if a previous visit's vitals are supplied, compares the two results to derive a `trend` (`improving`/`stable`/`worsening`). Always returns `probability: null` — explained below. |
| `POST /predict/vitals-forecast` | Forecasts a single vital's next value: linear regression by default, or an ARIMA time-series model once enough history points exist for that patient (superseded the earlier, now-removed `/predict/vitals-trend`). |
| `POST /predict/baseline` | Compares a patient's recent vitals against their own historical baseline per vital, flagging sudden changes or a worsening trend. |
| `POST /predict/medical-warning` | Aggregates baseline/anomaly/trend/risk signals across a patient's full vitals history into one combined "אבחון מקיף" result. |
| `POST /plan/generate-visits` | Given a service plan's date range and preferred weekdays, returns the concrete dates to create `service_plan_visits` rows for. |
| `POST /alerts/evaluate` | Rule-based check of whether a new risk reading should raise a clinical alert (e.g. new Red, worsening trend, repeated abnormal). |

Endpoints that exist but have no current caller in the frontend (kept as working, intentionally-scoped API surface, not dead code — see the code comments in `ml_targets.py`): `/predict/anomalies`, `/predict/vitals-timeseries`, `/predict/future-event`, `/train/{target}/{algorithm}`.

**Time-aware risk history:** every risk assessment is stored as an immutable, timestamped row in `risk_predictions` with an explicit `prediction_horizon_hours` (default 8) and a computed `expires_at`. A patient's "current risk" is derived — via the `current_patient_risk` view — as their most recent *non-expired* assessment. An assessment that has passed its horizon silently stops counting as current (it is never inferred to mean the patient remains high-risk indefinitely), and a newer assessment always supersedes an older one even before the older one's horizon has elapsed. Older rows remain queryable as history; none are ever overwritten.

**What this system deliberately does *not* do:**
- It does not predict specific future medical events (e.g. a heart attack or a hypoglycemic episode) — the repository contains no outcome-labeled dataset (no field anywhere records a real historical adverse-event outcome), so no such classifier could be trained or validated here, and none was built.
- `risk_predictions.probability` exists as a schema field reserved for a genuine future trained model, but is `null` in every row produced by the current rule-based logic — it is never fabricated.
- `risk_predictions.confidence` is **not** a statistical/medical probability; it is the fraction of the six vitals that were actually supplied for that reading (a data-completeness score), documented as such directly on the database column.
- There is no paging or "emergency" workflow: alert rows are generated server-side and shown on screen (dashboards, patient record), and a risk badge is a passive indicator that a human must look at; nothing is pushed by email, SMS or phone to staff or patients.

### What is machine learning and what is not

| Mechanism | Location | Kind | Honest status |
|---|---|---|---|
| Per-vital risk level (green/yellow/red) and background-condition escalation | `main.py` `classify_*`, `compute_risk` | **Hand-written clinical rules** | Active. Generic thresholds, not validated for this project; see `CLINICAL_THRESHOLDS_FOR_REVIEW.md` |
| Trend vs. previous visit | `compute_trend` | Rule (level comparison) | Active |
| Personal baseline, sudden change, persistent abnormal, anomalies | `clinical_baseline.py` | **Descriptive statistics** (median, rate of change, fixed thresholds) | Active; no trained model |
| Vital forecast | `main.py` `_linear_forecast`, `timeseries.py` | **Linear regression**; **ARIMA(1,1,0)** (statsmodels) when ≥ 8 measurements | Active; classical statistics, not a learned clinical model |
| Capacity forecast | `/predict/capacity` | Arithmetic projection (growth rate) | Active |
| Future-event classifiers (Logistic Regression / Decision Tree / Random Forest / KNN) | `ml_targets.py` | **Supervised ML (scikit-learn)** | **Architecture only — no model is trained** (`models/` is empty) because no labelled clinical-outcome data exists. Returns `model_available=false` rather than inventing a probability |
| LSTM | `lstm_interface.py` | Placeholder | Not implemented (needs far more longitudinal data) |

So the system today is a **rule-based decision-support tool with classical statistics**. It is not a trained ML product and must not be described as one. The risk panel is labelled "rule-based risk assessment — demonstration only".

## Security Architecture

- **RLS is the access-control layer.** All 16 application tables have RLS enabled; policies scope patients to their own rows via `auth.uid()`, staff to their assigned patients via a `current_staff_id()`/`is_my_patient()` pair of `SECURITY DEFINER` helper functions, and a separate permissive admin policy checks `(auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean` — `app_metadata` (unlike `user_metadata`) can only be set via the privileged Auth Admin API, so a user can never grant themselves admin.
- **Least-privilege table grants.** The `anon` Postgres role has zero grants on every application table (Supabase's default table privileges were explicitly revoked); `authenticated` is granted only the specific commands each table actually needs (e.g. `patients` has no `DELETE` grant at all). A grant-drift bug was found and fixed during a later audit — see `supabase/migrations/20260925074016_*.sql`.
- **A real backend component exists: `create-staff-login` (Supabase Edge Function).** Provisioning a login for a staff member requires the service-role key (to call the Auth Admin API), which must never run in the browser — this one deployed, always-on Deno function holds it instead, checks the caller is an admin, and invites the staff member by email. It is one of two server-side components: the other is the Python backend (`backend/`), which performs the booking, visit and clinical-record writes with the caller's own JWT and no service key. The browser still reads from Supabase directly (RLS-scoped).
- **Publishable-key-only frontend.** The browser only ever holds Supabase's public `sb_publishable_...` key (`public/config.js`); the service-role key is never present in any client-side file, and is used only inside the Edge Function above (server-side) and out-of-band (via the Supabase MCP/Admin API during setup) to create synthetic auth users and flag the admin account.
- **Security-invoker views.** The `current_patient_risk` view is explicitly created with `security_invoker = true` — without it, Postgres views default to running with the view creator's privileges, which would silently bypass RLS for anyone querying it (this was caught by Supabase's automated security advisor during development and fixed before shipping).
- **XSS mitigation.** Free-text fields rendered back to patients (e.g. a visit report's treatment summary) are HTML-escaped before insertion into the DOM; a captured signature is only rendered if it matches the expected `data:image/png;base64,` format.
- **No direct browser writes to critical tables.** Bookings, visit reports, risk predictions and alerts are written by the backend using the caller's own JWT (never a `service_role` key); database triggers and column-level grants block the same writes from the browser. Risk predictions and alerts must carry an HMAC attestation produced by the backend; the secret lives only in a database table and in `backend/.env`, never in git.
- **Repository hygiene.** CI scans the whole git history for secrets, Dependabot is enabled, workflow permissions are `contents: read`, dependencies are pinned (`supabase-js@2.118.0`, `backend/requirements.lock.txt`), and `SECURITY.md` describes how to report an issue.
- **Pre-commit secret scanning.** A git hook (`.githooks/pre-commit`, opt-in via `git config core.hooksPath .githooks`) blocks commits containing patterns resembling Supabase secret keys, private-key headers, AWS keys, or generic password/token assignments.
- **Anonymous booking is a deliberate trade-off, not an oversight.** Because there is no registration step, anyone can create bookings with unverified name/phone/address data; Supabase Auth's IP-based rate limits apply, but no CAPTCHA is currently configured.

## Installation & Local Setup

### Prerequisites

- Python 3.12+ (the backend was developed and tested on 3.13), Node.js 20+ (for the Playwright and unit tests)
- A modern web browser
- A Supabase project (or access to the existing one) with the migrations in `supabase/migrations/` applied
- [Supabase CLI](https://supabase.com/docs/guides/cli) (only needed if you're managing schema migrations yourself)

### 1. Clone the repository

```bash
git clone https://github.com/diabhelal/home-care-crm.git
cd home-care-crm
```

### 2. Configure the frontend's Supabase connection

Edit `public/config.js` with your own Supabase project's values:

```js
window.SUPABASE_URL = "<YOUR_SUPABASE_PROJECT_URL>";
window.SUPABASE_ANON_KEY = "<YOUR_SUPABASE_PUBLISHABLE_KEY>";
```

> This file currently holds these values as plain JS globals rather than being generated from an env file — there is no frontend build step to inject environment variables into. Treat these as the frontend's configuration point; only the **publishable** key belongs here, never a secret/service-role key.

### 3. Set up the Python services

Operational backend (needed for booking, approval, check-in and visit completion):

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt   # exact versions: requirements.lock.txt
cp .env.example .env   # fill SUPABASE_URL, SUPABASE_ANON_KEY, ALLOWED_ORIGINS, RISK_ATTESTATION_SECRET (git-ignored)
```

Predictive (risk) service — optional, rule-based clinical engine:


```bash
cd predictive-service
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Apply database migrations

If you're pointing at a fresh Supabase project:

```bash
supabase link --project-ref <YOUR_PROJECT_REF>
# Migrations in this repo were applied through the Supabase MCP (`apply_migration`) and the same SQL was
# saved under supabase/migrations/ with the recorded version names (see CLAUDE.md for the workflow).
# A fresh project needs every supabase/migrations/*.sql applied in order (23 files). Do not run
# `supabase config push` casually: it overwrites the whole [auth] section.
```

## Environment Variables

The static frontend has no build step, so its configuration lives in `public/config.js` (publishable key only). The Python backend reads environment variables from `backend/.env` (git-ignored; template: `backend/.env.example`). The predictive service takes no configuration.

| Variable | Used by | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (`SUPABASE_ANON_KEY` in the backend) | `public/config.js`; `backend/.env` | Project URL and the **publishable** key - safe for the browser |
| `ALLOWED_ORIGINS` | `backend/.env` | CORS origins allowed to call the backend (no wildcards) |
| `RISK_ATTESTATION_SECRET` | `backend/.env` and the DB row `server_secrets.risk_attestation_secret` | HMAC key for risk predictions and alerts (>= 32 random bytes). Required for risk writes; never in git |
| `SUPABASE_JWT_SECRET` | `backend/.env` | Only for legacy HS256 tokens; ES256/RS256 tokens are verified with the project's JWKS |
| `PREDICTIVE_SERVICE_URL` | `backend/.env` | Where the backend reaches `predictive-service/` (default `http://localhost:8000`) |
| `TRAVEL_BUFFER_MINUTES`, `OFFERED_PURPOSES`, `ELIGIBLE_ROLES`, `BUSINESS_TIMEZONE` | `backend/.env` | Business rules (defaults: 30, five purposes, `nurse`, `Asia/Jerusalem`) |
| `BACKEND_URL`, `SMS_LOGIN_ENABLED`, `DEMO_MODE` | `public/config.js` | Backend address (localhost only by default), phone+SMS option (off), demo banner (on) |
| `SUPABASE_SERVICE_ROLE_KEY` | Never used by the app or stored in the repo | Only the `create-staff-login` Edge Function (server-side) holds a service key; **never place one in `public/` or any client-served file** |

Full variable list and defaults: `backend/README.md`.

## Running the Application

**Frontend** (static file server, from the `public/` directory):

```bash
cd public
python3 -m http.server 8080
```
Then open `http://localhost:8080/index.html`.

**Backend** (required for booking; from `backend/`, after creating `.env`):

```bash
cd backend && source .venv/bin/activate
uvicorn app.main:app --port 8001 --env-file .env
```
Health check: `http://localhost:8001/healthz`. Without it the site shows "service unavailable" when booking, by design.

**Tests** (commands and last verified results are in `HANDOFF.md` and `docs/REVIEW.md`):

```bash
node --test tests/unit/*.test.js
ls tests/e2e/*.spec.js | grep -vE "/(booking|visit-report)\.spec\.js$" | xargs npx playwright test   # never booking/visit-report against the live project
cd backend && pytest -q --ignore=tests_db && pytest tests_db -q
```

**Predictive service:**

```bash
cd predictive-service
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```
Health check: `http://localhost:8000/health`. Interactive API docs (auto-generated by FastAPI): `http://localhost:8000/docs`.

The admin/staff dashboards' capacity/risk features call `window.PREDICTIVE_SERVICE_URL` (single source of truth, `public/config.js`, defaults to `http://localhost:8000`) — the predictive service must be running locally for those specific features to work; a background health check (`app.js`) shows a page-wide banner if it isn't, instead of each button failing silently. The rest of the app functions without it.

## Project Structure

```
home-care-crm/
├── public/                   # Static frontend — no build step
│   ├── index.html            # Landing page + service catalog + public contact form
│   ├── staff.html            # Staff selection (supports ?role= filter)
│   ├── booking.html          # Purpose/date/time selection + guest checkout form
│   ├── my-bookings.html      # Patient's own bookings, status, saved reports, optional email/SMS history saving
│   ├── admin.html            # Admin panel (work queue, staff, patients, contacts, patient records)
│   ├── employee.html         # Staff/nurse panel ("My Work" + patient records, same predictive features)
│   ├── employee-login.html   # Staff email/password login + password reset
│   ├── js/admin/             # admin.html's modularized sections: staff.js, patients.js, capacity.js,
│   │                         #   contacts.js, work-queue.js, patient-record.js (11-tab patient record)
│   ├── app.js                # Shared Supabase client, session handling, offline queue, formatting helpers
│   ├── slot-calculation.js   # Pure slot-availability logic (unit-tested independently)
│   ├── config.js              # Supabase URL + publishable key + predictive-service URL
│   ├── service-worker.js / manifest.json  # PWA: offline app-shell caching, installability
│   └── styles.css            # Shared design system
├── backend/                  # Python/FastAPI operational backend: booking, availability, approval, check-in, completion, risk
│   ├── app/, tests/ (unit), tests_db/ (isolated local Postgres), scripts/verify_proposed_sql.py
├── predictive-service/       # Local-only Python decision-support API (13 endpoints)
│   ├── main.py, clinical_baseline.py, timeseries.py, ml_targets.py, lstm_interface.py
│   └── requirements.txt / requirements-dev.txt / tests/
├── supabase/
│   ├── config.toml            # Supabase CLI project config (incl. Auth settings)
│   ├── functions/create-staff-login/  # Edge Function: provisions a staff Auth login (holds service-role key)
│   ├── migrations/            # 23 ordered, applied SQL migrations
│   └── proposed/              # SQL 001–007 as reviewed before application (+ APPLIED.md)
├── docs/                      # DEMO.md, REVIEW.md, WORKPLAN.md, STAGING_PLAN.md, demo-proof/ screenshots
├── HANDOFF.md, SECURITY.md    # Current state / next steps; vulnerability reporting
├── tests/unit/, tests/e2e/   # node:test unit tests + Playwright E2E specs (see tests/e2e/README.md)
├── .github/workflows/ci.yml  # Unit tests on every push; E2E split safe/live-DB (see tests/e2e/README.md)
├── .githooks/pre-commit       # Optional secret-scanning git hook
├── CLAUDE.md / AGENTS.md      # AI-assistant working notes for this project
├── PLAN.md                    # Original MVP planning notes — historical, see its banner
└── README.md
```

## Known Limitations

Being transparent about what's *not* built, since the goal of this README is accuracy over ambition:

- **Two roles exist (admin, staff), not fully-general RBAC.** Real staff/nurse logins exist (`employee.html`/`employee-login.html`) with their own RLS-enforced scope (`current_staff_id()`/`is_my_patient()` — a staff member sees only their assigned patients/bookings), distinct from the single shared admin role. There's no finer-grained permission system beyond that (no "family member" role, no per-staff feature toggles, and the admin/staff patient-record UIs intentionally differ in which tabs/actions are exposed rather than being driven by a configurable permission model).
- **No client-side data-fetching/caching layer.** All data **reads** are direct `supabase-js` calls per page load (writes to critical tables go through the backend); there is no TanStack Query, no optimistic UI updates, and no Supabase Realtime subscriptions — the UI does not update live when another user changes data.
- **Automated tests exist; two live-database E2E specs are never run.** JS unit tests, backend and predictive-service pytest, database tests on an isolated local Postgres, and the mocked Playwright suite run in CI. `booking.spec.js` and `visit-report.spec.js` write real rows, need a dedicated test Supabase project that does not exist yet, and must **not** be run against the live project. One booking cycle (request, approve, check-in, complete, cancel) was run manually against the real project and backend on 2026-10-15; it was not saved as an automated test (`docs/REVIEW.md`). See `tests/e2e/README.md`.
- **No external emergency notification.** Alerts are created server-side and shown in the admin/staff dashboards (plus an in-app banner for new booking requests), but nothing pushes an email, SMS or page; a Red risk badge needs a human to look at it. Email/SMS notifications for staff would require an external provider.
- **Background medical conditions are now used in risk scoring, but only as an escalation rule.** A Yellow vital is escalated to Red when a relevant background condition or smoking status is present (see `predictive-service/main.py`, `BACKGROUND_ESCALATION_VITALS`); it never touches an already-Green or already-Red vital, and it's still a hand-written rule, not a learned model.
- **Guest identity is per-browser by default.** A patient can opt in to cross-device access by saving the history with an email + password (works today) or with phone + SMS code. The SMS option is built and tested against a mock, but disabled (`SMS_LOGIN_ENABLED = false`) because no SMS provider is configured yet (`[auth.sms] enable_signup = false`).
- **Two Supabase Auth project-level settings** (leaked-password protection, additional MFA methods) show as advisory warnings and haven't been enabled.

- **Backend not hosted.** The Python backend works locally against the live Supabase project; booking from the site requires it to be running. A hosted deployment needs HTTPS, `BACKEND_URL` in `public/config.js`, the backend origin in the CSP `connect-src`, and CORS (`ALLOWED_ORIGINS`).
- **Three hardening migrations are written and tested but NOT yet applied to the live database:** `supabase/proposed/008` (visit-report integrity guard), `009` (deactivate instead of delete staff; no cascade of history) and `010` (overlap/travel-buffer enforcement on booking updates). They were verified only on an isolated local Postgres with synthetic data. Until they are applied, the live database still cascades history when a staff member is deleted, and a direct administrator write can bypass the booking-conflict check. The site code that supports them (staff deactivation, offline-draft sync) works with or without them. See `supabase/proposed/APPLIED.md` and `HANDOFF.md`.
- **Risk colour status:** `supabase/proposed/011` (not yet applied to the live database) makes the traffic-light status show the latest assessment with its age instead of disappearing 8 hours after the visit. The predictive service runs locally and manually; without it no new assessment is produced.
- **Medical-record keeping (written and tested, not yet applied to the live database):** `supabase/proposed/012` (append-only amendments to completed visit reports; the original is never edited) and `013` (archive a patient instead of deleting; administrator-only full-record export that always writes an append-only access log). The retention period and the legal grounds for disclosure are legal decisions: nothing is deleted automatically and the system makes no claim of legal compliance.
- **Travel buffer is a constant (30 min)**, not computed travel time; proximity ranking needs staff/patient coordinates and a geocoder (a no-op geocoder is the default).
- **Offline drafts live in `localStorage`** (namespaced per user, unencrypted). This is logical separation, not encryption.
- **Completed visit reports are read-only** in the UI; corrections should be new clinical notes.
- **Demo mode** (`DEMO_MODE` in `config.js`) shows a "synthetic data only" banner. Real patients additionally require a privacy policy, terms and informed consent under Israeli law, hosting with HTTPS, and a security review.

## Future Development / Roadmap

Roughly in order of likely value:

1. Real RBAC: distinct staff/nurse, admin, and (if patient portals are added) family-member roles with scoped RLS policies per role.
2. A dedicated test Supabase project so the existing Playwright E2E specs (`tests/e2e/`) can actually run — in CI and locally — instead of sitting unexecuted.
3. A live-update layer (Supabase Realtime or a client-side caching/query library) so admin views reflect changes without a manual refresh.
4. An audit trail for who viewed or changed a patient's clinical data and when.
5. A patient data retention/deletion mechanism.
6. Configure a real SMS provider (plus CAPTCHA and rate limits), then set `SMS_LOGIN_ENABLED = true` — the phone+SMS flow is already implemented.
7. If a genuine outcome-labeled dataset is ever collected, a properly trained and *validated* statistical/ML model as a distinct, clearly-labeled addition alongside (not replacing) the current rule-based layer.

## Disclaimer — Medical Risk Functionality

The Green/Yellow/Red risk indicator, trend detection, and vitals-trend forecasting in this project are **decision-support and prototype functionality only**. They are hand-written threshold rules and arithmetic, not a clinically validated diagnostic tool, and must never be treated as a substitute for the judgment of a qualified healthcare professional. This system does not predict, diagnose, or provide any clinical probability of specific medical events (including but not limited to heart attacks or hypoglycemic episodes), and contains no automatic emergency-alerting capability. Do not use this project, as-is, to make real clinical decisions.
