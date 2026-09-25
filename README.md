# AIAKILOV — Home Care CRM

A booking and visit-management platform for a home healthcare service. Patients book home visits with nurses, doctors, physiotherapists, or caregivers with no registration step (a guest-checkout flow, similar to booking a flight); staff document each visit's vitals and procedures; an admin panel manages staff, bookings, and a rule-based clinical decision-support layer for vitals trends and capacity planning.

> **Status:** working prototype / portfolio project, not a certified medical device or a production healthcare deployment. See [Disclaimer](#disclaimer--medical-risk-functionality) and [Known Limitations](#known-limitations).

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

- **No-registration patient booking** — browse services, pick a staff member, pick an open time slot, and only enter name/phone/address at final confirmation (an anonymous Supabase Auth session is created transparently in the background).
- **Staff/service catalog** with role-based filtering (nurse, doctor, physiotherapist, caregiver).
- **Availability-aware time-slot generation** computed client-side from each staff member's weekly schedule minus their existing bookings.
- **Patient self-service booking management** — view upcoming/past bookings, cancel a booking.
- **Visit reports** — vitals, procedures performed, treatment summary, and an on-screen captured patient signature, tied to a specific booking.
- **Admin panel** — manage bookings (status changes), manage staff (add/edit/delete + availability), view patients and edit their background medical conditions, view/author visit reports.
- **Rule-based risk assessment** (Green/Yellow/Red) computed from a visit's vitals, with a time-bound validity window and trend detection against the patient's previous visit.
- **Capacity forecasting** — a simple formula projecting next month's expected visit volume from current volume, patient count, and an assumed growth rate.
- **Password recovery** for the admin account via Supabase Auth's standard email-link flow.

## Workflows

**Patient (guest, no login):**
1. Land on the homepage, browse services by staff role.
2. Pick a staff member (optionally pre-filtered by role).
3. Pick a visit purpose, a date, and an open time slot.
4. Enter name/phone/address and confirm — this is the only point personal details are collected.
5. View or cancel bookings later from "My Bookings" (tied to that browser's anonymous session — there is no cross-device login for patients).

**Nurse/Staff (via the admin panel, using a shared admin login):**
1. Log in with the admin email/password account.
2. Open a booking, fill in vitals, procedures performed, a treatment summary, and capture the patient's signature.
3. Save the report — this recalculates the patient's rule-based risk level and trend automatically.
4. Mark a booking complete or cancelled.

**Admin:**
- Everything staff can do, plus: add/edit/deactivate/delete staff members and their weekly availability; view all patients and edit their recorded background conditions; view all bookings across all patients; run a capacity forecast for the next month.

There is currently a **single shared admin role** — see [RBAC status](#known-limitations) for why "nurse" and "admin" are not yet separate accounts.

## Architecture

```
┌─────────────────────────┐         ┌──────────────────────────┐
│   public/ (static site)  │         │  predictive-service/      │
│   HTML + CSS + vanilla JS │  fetch  │  Python / FastAPI         │
│   (no build step, no      │───────▶│  (local-only, port 8000)  │
│    framework)              │         │  rule-based risk models  │
└───────────┬───────────────┘         └──────────────────────────┘
            │ supabase-js (publishable key only)
            ▼
┌──────────────────────────────────────────────┐
│                  Supabase                      │
│  Postgres + Auth + PostgREST Data API + RLS     │
└──────────────────────────────────────────────┘
```

- The frontend is a set of static HTML pages that talk **directly** to Supabase's auto-generated REST API (PostgREST) using `supabase-js` from the browser — there is no application backend server for the CRM itself.
- All data access control is enforced in the database via **Row Level Security (RLS)** policies, not in application code.
- A small, separate, **local-only** Python service (`predictive-service/`) provides the rule-based risk/trend/capacity calculations over HTTP. It holds no database connection and no patient data of its own — the frontend sends it numbers, it sends back a classification.
- A GitHub Actions CI pipeline (`.github/workflows/ci.yml`) runs JS and Python unit tests on every push/PR; there is no separate staging/production environment configuration at this time (see [Known Limitations](#known-limitations)).

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Static HTML5 + CSS3 + vanilla JavaScript (ES2017+), no framework, no build step, no bundler |
| Frontend/DB client | [`supabase-js`](https://github.com/supabase/supabase-js) v2, loaded from a CDN `<script>` tag |
| Database | PostgreSQL (managed by Supabase) |
| Auth | Supabase Auth — anonymous sign-ins for patients, email/password for the admin account |
| API layer | Supabase's auto-generated PostgREST Data API (no custom backend routes) |
| Access control | PostgreSQL Row Level Security (RLS) policies |
| Decision-support service | Python 3, [FastAPI](https://fastapi.tiangolo.com/), [Pydantic](https://docs.pydantic.dev/), served by [Uvicorn](https://www.uvicorn.org/) |
| Fonts | Google Fonts (Inter, Manrope) |

**Not currently used, despite being common in comparable stacks:** React or any frontend framework, TanStack Query, Supabase Realtime, a Node/Express/Flask backend, Docker. GitHub Actions CI (`.github/workflows/ci.yml`) runs the unit test suites (`node --test`, `pytest`) on every push, plus a manually-triggered Playwright E2E job.

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

13 migrations currently exist under `supabase/migrations/` (run `ls supabase/migrations/` for the exact list) — the original schema, the identity-model pivot, visit reports, the risk-prediction system, the full Patient Medical Record module (10 tables in one migration), real staff/nurse login, and several targeted follow-ups including two grant-drift security fixes.

## Home-Visit Booking Flow

1. On every page load, `ensureGuestSession()` (`public/app.js`) checks for an existing Supabase session and, if none exists, transparently calls `supabaseClient.auth.signInAnonymously()`. This gives every visitor a real `auth.uid()` from the first click, so ownership-based RLS policies work without a visible login step.
2. The patient browses `staff.html` (optionally filtered by role via a `?role=` query param) and picks a staff member.
3. On `booking.html`, available dates are generated from the staff member's `available_weekdays`; available time slots for a chosen date are computed **client-side** as: the staff member's working hours, divided into `slot_duration_minutes` increments, minus any slot already present in `bookings` for that staff member on that day. Past and already-taken slots are disabled.
4. On confirming, the patient's name/phone/address are `upsert`ed into `patients`, then a row is inserted into `bookings`. The `(staff_id, scheduled_at)` unique constraint provides a server-side guarantee against a double-booking race condition; the client shows a friendly "someone just took that slot" message and refreshes if it occurs.
5. `my-bookings.html` shows the guest's own upcoming and past bookings (via RLS-scoped `SELECT`) and allows cancellation (an `UPDATE` to `status = 'cancelled'`, not a delete).

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
- No automatic alerting, paging, or "emergency" workflow exists anywhere — a risk badge is a passive, on-screen indicator that a human must look at; nothing pushes a notification to staff or patients.

## Security Architecture

- **RLS is the access-control layer.** All 16 application tables have RLS enabled; policies scope patients to their own rows via `auth.uid()`, staff to their assigned patients via a `current_staff_id()`/`is_my_patient()` pair of `SECURITY DEFINER` helper functions, and a separate permissive admin policy checks `(auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean` — `app_metadata` (unlike `user_metadata`) can only be set via the privileged Auth Admin API, so a user can never grant themselves admin.
- **Least-privilege table grants.** The `anon` Postgres role has zero grants on every application table (Supabase's default table privileges were explicitly revoked); `authenticated` is granted only the specific commands each table actually needs (e.g. `patients` has no `DELETE` grant at all). A grant-drift bug was found and fixed during a later audit — see `supabase/migrations/20260925074016_*.sql`.
- **A real backend component exists: `create-staff-login` (Supabase Edge Function).** Provisioning a login for a staff member requires the service-role key (to call the Auth Admin API), which must never run in the browser — this one deployed, always-on Deno function holds it instead, checks the caller is an admin, and invites the staff member by email. It's the one place in this project that isn't "frontend talks directly to Supabase" — everything else still is.
- **Publishable-key-only frontend.** The browser only ever holds Supabase's public `sb_publishable_...` key (`public/config.js`); the service-role key is never present in any client-side file, and is used only inside the Edge Function above (server-side) and out-of-band (via the Supabase MCP/Admin API during setup) to create synthetic auth users and flag the admin account.
- **Security-invoker views.** The `current_patient_risk` view is explicitly created with `security_invoker = true` — without it, Postgres views default to running with the view creator's privileges, which would silently bypass RLS for anyone querying it (this was caught by Supabase's automated security advisor during development and fixed before shipping).
- **XSS mitigation.** Free-text fields rendered back to patients (e.g. a visit report's treatment summary) are HTML-escaped before insertion into the DOM; a captured signature is only rendered if it matches the expected `data:image/png;base64,` format.
- **Pre-commit secret scanning.** A git hook (`.githooks/pre-commit`, opt-in via `git config core.hooksPath .githooks`) blocks commits containing patterns resembling Supabase secret keys, private-key headers, AWS keys, or generic password/token assignments.
- **Anonymous booking is a deliberate trade-off, not an oversight.** Because there is no registration step, anyone can create bookings with unverified name/phone/address data; Supabase Auth's IP-based rate limits apply, but no CAPTCHA is currently configured.

## Installation & Local Setup

### Prerequisites

- Python 3.10+
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

### 3. Set up the predictive service

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
# Migrations in this repo were applied via `execute_sql` + `supabase migration new` +
# `supabase migration repair --status applied` rather than `db push` (see supabase/migrations/
# and CLAUDE.md for the exact workflow this project followed).
```

## Environment Variables

**No `.env` file is used by this project today** — the frontend has no build step to consume one, and the predictive service currently takes no configuration at all. The table below lists the values that *would* need to be supplied if you deploy your own instance; placeholder names only.

| Variable | Used by | Purpose |
|---|---|---|
| `SUPABASE_URL` | `public/config.js` (hardcoded, not env-driven) | Your Supabase project's API URL |
| `SUPABASE_PUBLISHABLE_KEY` | `public/config.js` (hardcoded, not env-driven) | Supabase's public/anon API key — safe for the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Used only out-of-band (Admin API calls during setup), never in any committed file | Required only for privileged one-off operations like creating synthetic users or setting `app_metadata.is_admin` — **never place this in `public/` or any client-served file** |

## Running the Application

**Frontend** (static file server, from the `public/` directory):

```bash
cd public
python3 -m http.server 8080
```
Then open `http://localhost:8080/index.html`.

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
│   ├── my-bookings.html      # Patient's own bookings + saved visit reports + optional phone linking
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
├── predictive-service/       # Local-only Python decision-support API (13 endpoints)
│   ├── main.py, clinical_baseline.py, timeseries.py, ml_targets.py, lstm_interface.py
│   └── requirements.txt / requirements-dev.txt / tests/
├── supabase/
│   ├── config.toml            # Supabase CLI project config (incl. Auth settings)
│   ├── functions/create-staff-login/  # Edge Function: provisions a staff Auth login (holds service-role key)
│   └── migrations/            # 13 ordered, applied SQL migrations
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
- **No client-side data-fetching/caching layer.** All data fetching is direct `supabase-js` calls per page load; there is no TanStack Query, no optimistic UI updates, and no Supabase Realtime subscriptions — the UI does not update live when another user changes data.
- **Automated tests exist; 3 of 5 E2E specs run in CI, 2 remain unverified.** Unit tests (`tests/unit/`, JS; `predictive-service/tests/`, Python) run on every push/PR via GitHub Actions CI. Of the 5 Playwright E2E specs (`tests/e2e/`), 3 use a mocked Supabase client and run automatically on every push; the other 2 (`booking.spec.js`, `visit-report.spec.js`) write real bookings/reports and require a dedicated test Supabase project that hasn't been set up yet — those two are gated to manual `workflow_dispatch` only and have never actually been executed; treat them as unverified. See `tests/e2e/README.md`.
- **No emergency/alerting mechanism.** As covered above, a Red risk badge is passive and manual-review-only.
- **Background medical conditions are now used in risk scoring, but only as an escalation rule.** A Yellow vital is escalated to Red when a relevant background condition or smoking status is present (see `predictive-service/main.py`, `BACKGROUND_ESCALATION_VITALS`); it never touches an already-Green or already-Red vital, and it's still a hand-written rule, not a learned model.
- **Guest identity is per-browser by default.** A patient cannot access their booking history from a different device or browser out of the box. Optional phone+OTP identity-linking infrastructure exists (`public/my-bookings.html`, Supabase Auth's anonymous-upgrade flow) so a patient *can* opt in to cross-device access, but it's inert today — no real SMS provider is configured (`[auth.sms] enable_signup = false` in `supabase/config.toml`), so the phone-linking UI is present but non-functional until one is wired up.
- **Two Supabase Auth project-level settings** (leaked-password protection, additional MFA methods) show as advisory warnings and haven't been enabled.

## Future Development / Roadmap

Roughly in order of likely value:

1. Real RBAC: distinct staff/nurse, admin, and (if patient portals are added) family-member roles with scoped RLS policies per role.
2. A dedicated test Supabase project so the existing Playwright E2E specs (`tests/e2e/`) can actually run — in CI and locally — instead of sitting unexecuted.
3. A live-update layer (Supabase Realtime or a client-side caching/query library) so admin views reflect changes without a manual refresh.
4. An audit trail for who viewed or changed a patient's clinical data and when.
5. A patient data retention/deletion mechanism.
6. A real SMS provider for the phone+OTP identity-linking flow that already exists in the code but is currently inert.
7. If a genuine outcome-labeled dataset is ever collected, a properly trained and *validated* statistical/ML model as a distinct, clearly-labeled addition alongside (not replacing) the current rule-based layer.

## Disclaimer — Medical Risk Functionality

The Green/Yellow/Red risk indicator, trend detection, and vitals-trend forecasting in this project are **decision-support and prototype functionality only**. They are hand-written threshold rules and arithmetic, not a clinically validated diagnostic tool, and must never be treated as a substitute for the judgment of a qualified healthcare professional. This system does not predict, diagnose, or provide any clinical probability of specific medical events (including but not limited to heart attacks or hypoglycemic episodes), and contains no automatic emergency-alerting capability. Do not use this project, as-is, to make real clinical decisions.
