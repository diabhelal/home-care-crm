# How it works: workflows, booking flow, visit reports

> Moved out of the README on 2026-10-31 so the README stays short; content kept, with the visit-report description corrected to the current implementation. Overview: [README](../README.md).

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

## Home-Visit Booking Flow

1. On every page load, `ensureGuestSession()` (`public/app.js`) creates an anonymous Supabase session if none exists, so every visitor has a real `auth.uid()` and ownership-based RLS works without a visible login.
2. On `booking.html` the patient picks a service, enters the address, and the page asks the backend (`GET /availability`) for each day's free slots; days with none are disabled. Slots already include the 30-minute travel buffer.
3. After choosing a slot, the patient enters name / national ID / phone. Details are saved to `patients` (RLS-scoped), then `POST /bookings/request` is sent with an **idempotency key**, so a retry after a network failure does not create a second booking.
4. The booking is created as `requested`. An admin approves / rejects / reassigns it; database triggers refuse overlapping slots, buffer violations and self-approval even if the API is bypassed.
5. `my-bookings.html` shows the patient's bookings with an order number and status steps, and allows cancellation through the backend.

## Visit Reports & Vital-Sign Tracking

From the admin or staff panel, opening a booking's visit-report form lets staff record: systolic/diastolic blood pressure, blood sugar, pulse, temperature, oxygen saturation; which of five procedures were performed; a free-text treatment summary; and a signature captured live on an HTML `<canvas>` and stored as a base64 PNG data URL. Saving goes through the backend (`POST /staff/visits/{id}/complete`): the report and the booking's `completed` status are written atomically (an upsert keyed on the booking). In the UI a completed visit is read-only; corrections are meant to be recorded as amendments (migration `012`, not applied to the live database) or clinical notes. Patients can view (read-only) their own saved reports from `my-bookings.html`; all patient-supplied and staff-entered text is HTML-escaped before rendering to prevent stored XSS.

## Setup details (prerequisites and migrations on a new project)

#### Prerequisites

- Python 3.12+ (the backend was developed and tested on 3.13), Node.js 20+ (for the Playwright and unit tests)
- A modern web browser
- A Supabase project (or access to the existing one) with the migrations in `supabase/migrations/` applied
- [Supabase CLI](https://supabase.com/docs/guides/cli) (only needed if you're managing schema migrations yourself)

#### 1. Clone the repository

```bash
git clone https://github.com/diabhelal/home-care-crm.git
cd home-care-crm
```

#### 2. Configure the frontend's Supabase connection

Edit `public/config.js` with your own Supabase project's values:

```js
window.SUPABASE_URL = "<YOUR_SUPABASE_PROJECT_URL>";
window.SUPABASE_ANON_KEY = "<YOUR_SUPABASE_PUBLISHABLE_KEY>";
```

> This file currently holds these values as plain JS globals rather than being generated from an env file — there is no frontend build step to inject environment variables into. Treat these as the frontend's configuration point; only the **publishable** key belongs here, never a secret/service-role key.

#### 3. Set up the Python services

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

#### 4. Apply database migrations

If you're pointing at a fresh Supabase project:

```bash
supabase link --project-ref <YOUR_PROJECT_REF>
# Migrations in this repo were applied through the Supabase MCP (`apply_migration`) and the same SQL was
# saved under supabase/migrations/ with the recorded version names (see CLAUDE.md for the workflow).
# A fresh project needs every supabase/migrations/*.sql applied in order (23 files). Do not run
# `supabase config push` casually: it overwrites the whole [auth] section.
```

## Full environment variable table


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

## Original project-structure tree (frontend file by file)


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
