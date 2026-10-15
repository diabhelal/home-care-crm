# home-care-crm backend

Operational booking logic in Python (FastAPI, Pydantic v2). Separate from `predictive-service/` (no shared code).
The server is authoritative; browser availability is advisory; DB constraints/RLS remain the last line of defense.
The service forwards the caller's JWT to PostgREST (no service_role key), so RLS is preserved.

## Run
```
cd backend
python3.13 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q
uvicorn app.main:app --port 8001
```

## Layout
`app/auth.py` JWT verification (pluggable `TokenVerifier`) - `app/state.py` transitions + `display_state` -
`app/scheduling.py` slots/buffer/ranking - `app/service.py` business rules - `app/repo.py` repository Protocol -
`app/fake_repo.py` in-memory (tests) - `app/supabase_repo.py` PostgREST via httpx - `app/geo.py` Geocoder hook - `app/main.py` routes.

## Endpoints
| Method | Path | Who |
|---|---|---|
| POST | `/bookings/request` (`Idempotency-Key` header optional) | any signed-in user incl. guests |
| GET | `/availability?start&end[&staff_id][&address]` | signed-in |
| POST | `/bookings/{id}/cancel` | the booking's patient only (404 for anyone else; 409 when completed/checked-in; idempotent) |
| POST | `/admin/bookings/{id}/approve` `/reject` `/reassign` `/cancel` | admin (`app_metadata.is_admin`); cancel: any non-completed booking, idempotent |
| POST | `/staff/bookings/{id}/check-in` | assigned staff or admin (server timestamp) |
| PATCH | `/visits/{report_id}/clinical-outcome` | assigned staff of the report's booking, or admin; body `{clinical_outcome_8h: <enum>|null>}` |
| POST | `/staff/visits/{booking_id}/complete` | assigned staff, or admin on behalf (report keeps the booking's staff_id) |
| POST | `/visits/{report_id}/risk-assessment` | assigned staff of the report's booking, or admin; no body (all inputs server-side); 503 `predictive_unavailable` writes nothing; idempotent per report |
| POST | `/patients/{patient_id}/auto-alert` | staff (assigned patient, via RLS) or admin; recomputes from stored reports (comprehensive-diagnosis alert) |

Errors: 401 no/invalid token, 403 wrong role/not owner, 409 illegal transition or slot taken
("המטפל אינו פנוי בשעה זו, אנא בחר משבצת זמן אחרת"), 422 validation.

## Environment
| Var | Meaning | Default |
|---|---|---|
| `SUPABASE_URL` | project URL | required |
| `SUPABASE_ANON_KEY` | publishable key (sent as `apikey`) | required |
| `SUPABASE_JWT_SECRET` | HS256 secret to verify user JWTs | required |
| `ALLOWED_ORIGINS` | comma-separated CORS origins | none (CORS off) |
| `TRAVEL_BUFFER_MINUTES` | buffer between visits at different addresses | 30 |
| `OFFERED_PURPOSES` | allowed visit purposes | checkup,wound_care,blood_test,medication,other |
| `ELIGIBLE_ROLES` | roles that may be booked | nurse |
| `BUSINESS_TIMEZONE` | timezone of working hours | Asia/Jerusalem |
| `PREDICTIVE_SERVICE_URL` | base URL of `predictive-service/` (called over HTTP only; unchanged service) | `http://localhost:8000` |
| `PREDICTIVE_TIMEOUT_SECONDS` | per-call timeout to the predictive service | 5 |
| `RISK_ATTESTATION_SECRET` | HMAC key (>=32 random bytes) shared with the DB row `server_secrets.risk_attestation_secret`; required for risk/alert writes | none (fail closed, 503) |

## Clinical risk orchestration (`app/risk.py`)
Separate from booking logic. The backend never re-implements thresholds/alert rules: it calls the
existing predictive-service endpoints (`/predict/risk-assessment`, `/alerts/evaluate`, `/predict/medical-warning`)
through a `PredictiveClient` (httpx; `FakePredictiveClient` in tests), signs the result and persists it with
ONE SECURITY DEFINER function (`record_risk_prediction` / `record_auto_alert`, `supabase/proposed/006`).
Browser inserts into `risk_predictions`/`alerts` are revoked by that migration. Predictive service down
=> 503 and nothing is written (the visit report itself is never affected).

## Deployment requirements
- Serve over HTTPS only; terminate TLS at the host/proxy.
- Set `ALLOWED_ORIGINS` to the exact production frontend origin(s); no wildcards.
- Secrets come from the host's secret store, never from the repo (`.env` is git-ignored).
- The production frontend must use a configured backend URL, not localhost.
- Hosting is not decided yet.

## Database
The SQL in `supabase/proposed/001–007` was applied to the live project on 2026-10-15 (see `supabase/proposed/APPLIED.md`); a fresh Supabase project needs all `supabase/migrations/*.sql` applied in order.
Known gap: until the frontend stops inserting bookings directly, a direct insert still gets `approval_status='confirmed'`.
Geocoding is a no-op by default; implement `Geocoder` to enable proximity ranking.

## Isolated database tests (never the live project)

`tests_db/` starts a throwaway local PostgreSQL (the `pixeltable-pgserver` wheel, inside
the venv — no Docker, nothing installed system-wide), stubs the Supabase `auth`/`storage`
pieces, applies the project's real `supabase/migrations/*.sql` followed by the PROPOSED
`supabase/proposed/*.sql`, and runs synthetic-data checks (approval state, travel buffer,
double booking, ownership, atomic completion, address privacy, RLS/column grants).

    cd backend && source .venv/bin/activate
    pip install -r requirements-dev.txt
    pytest tests_db -q        # database behaviour
    pytest -q --ignore=tests_db   # API/service unit tests
