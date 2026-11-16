# Repository status, branch and PR map

> Updated **2026-11-08**, `main` = submission tag [`v1.0`](https://github.com/diabhelal/home-care-crm/releases/tag/v1.0). On GitHub only `main` remains and there are **no open pull requests**. Sections 2, 6 and 7a keep the earlier merge history and evidence for reference.

**תקציר בעברית:** `main` (תג `v1.0`) כולל את כל העבודה שמוזגה, כולל ייצוב ובטיחות (#68), מטריצת הרשאות, ledger מיגרציות ו-`/readyz` (#69) וסנכרון מסמכים (#70). **על המסד החי הוחלו רק 001-007, 019 ו-020 (25 מיגרציות רשומות); 008-013, 015-018 ו-021 הן הצעות. לא בוצעה פריסה ציבורית.** ב-2026-11-08, באישור הבעלים, נמחקו ב-GitHub כל הענפים שמוזגו, ונסגרו בלי מיזוג #34, #21, #18 ו-Dependabot. העבודה שלא מוזגה שמורה בגיבוי הפרטי של הבעלים.

## 1. Where to start (reviewer path)
| What | Where |
|---|---|
| Project overview, features, architecture | [`README.md`](../README.md) |
| This map | `docs/REPO_STATUS.md` |
| Stabilisation plan, findings and Go/No-Go checklist (Hebrew) | [`docs/STABILIZATION_PLAN.md`](STABILIZATION_PLAN.md) |
| Demo walkthrough | [`docs/DEMO.md`](DEMO.md) |
| Database model, risk engine, security | [`docs/DATABASE.md`](DATABASE.md), [`docs/RISK_ENGINE.md`](RISK_ENGINE.md), [`docs/SECURITY_ARCHITECTURE.md`](SECURITY_ARCHITECTURE.md) |
| Medical-record integrity rules and owner decisions | [`docs/RECORD_INTEGRITY.md`](RECORD_INTEGRITY.md) |
| Handoff for the next working session | [`HANDOFF.md`](../HANDOFF.md) |

Run the tests (none of them touches a live database):
```
node --test tests/unit/*.test.js
cd backend && pytest -q --ignore=tests_db && pytest tests_db -q      # tests_db uses a throwaway local Postgres
ls tests/e2e/*.spec.js | grep -vE "/(booking|visit-report)\.spec\.js$" | xargs npx playwright test --workers=1
```
`booking.spec.js` / `visit-report.spec.js` talk to a real Supabase project and must **never** be run against the live project. Playwright runs serially on port 8080; since PR #29 it fails loudly if that port is already taken.

## 2. What is in `main`
`main` @ `78d93fa`. Integration PR **#39** (`777191e`) merged these ten PRs in one reviewed batch (CI green on the combined result; owner approved the batch):

| PR | What it brought |
|---|---|
| #38 | Removed the unrequested spec-driven workflow additions of #37; `docs/SPECIFICATION.md` kept |
| #29 | Playwright fails loudly when port 8080 is busy (no stale-server reuse) |
| #28 | Strict validation of the predictive risk response before it is signed/stored |
| #24 | Predictive service rejects NaN/Infinity; neutral wording; "no data" is not "normal" |
| #25 | Precise 23505 mapping, 409/502 handlers, newest-first history reads |
| #27 | After a 409 verified as "same", the risk assessment is still requested |
| #33 | After 5xx/timeout: "not confirmed by the server", content kept, safe "retry now" |
| #32 | Admin scripts in the cached shell; other origins are never cached |
| #31 | No physical delete of staff / patient messages in the UI; amendment form only for the author |
| #30 | **Proposed** SQL 015–019 + DB tests + rollback blocks (files only, not applied) |

Then **#40** (`72134f6`): `render.yaml` (later replaced by the Railway setup, 2026-11-13; manual deploys only, no auto-deploy trigger anywhere), `scripts/make_release.py`, predictive `ALLOWED_ORIGINS`/`DISABLE_TRAINING`, DEPLOY.md. Earlier merges: #19 (README and docs), #20, #22, #26 (patient isolation), #36 (`docs/SPECIFICATION.md`). Version: `CACHE_VERSION` **v58**, `APP_BUILD` **2026-11-06.58**. Two tests were corrected during integration (no product change): `comprehensive-wording` now starts the patient scope like the real modal; `staff-field-actions` pins the clock to 10:00 (it failed in the hour before local midnight, also on the old `main`).

After #39, #40 (`72134f6`), approved batch of 2026-11-06 (each PR merged only after green CI against the then-current `main`):

| PR | Merge commit | What it brought |
|---|---|---|
| #42 | `5a33814` | Add a vital-sign measurement to the patient chart outside a booking: append-only table (proposed SQL `020`, **not applied**), `POST /patients/{id}/measurements`, form + list in the vitals tab (admin and staff). `measured_at` (user) is separate from `recorded_at`/author (server); admin or assigned staff; no edit/delete; signed reports untouched; not used by the risk engine |
| #43 | `324fd86` | Fix: the "completed report is locked" explanation was erased at once on the admin screen; the message now states what can be done instead |
| #45 | `582063b` | Fix: connectivity failures during the session check no longer send a signed-in user to the login form (staff and admin); denied states still do; plain-language messages |
| #44 | `1674c2e` | Fix: `reset.html` counts unsynchronized drafts, warns, offers a JSON backup and never touches localStorage |
| #35 | `78d93fa` | Admin can pause a service (e.g. blood tests) with a patient-facing message, enforced in the form, backend and trigger (proposed SQL `021`, **not applied**; the admin section shows "cannot load" until it is) |
| #47 | `35d7ae6` | Measurements: optional link to the patient's own visit (`booking_id` in proposed `020`; the guard rejects another patient's visit), several readings per visit, repeats kept |
| #17 | `2d788f7` | `certifi` 2026.10.18 in `backend/requirements.lock.txt` (GitHub critical advisory; 0 open alerts) |
| #48 | `10419e2` | `escapeHtml` escapes quotes (stored XSS in attributes), two unescaped labels, two more specs in CI, `DEPLOY.md` consistency |
| #49 | `4f06cfd` | Specification and agent documents in English; `check_docs.py` accepts English status keywords |

Version: `CACHE_VERSION` **v63**, `APP_BUILD` **2026-11-06.63**.

Then, on 2026-11-07 (each after green CI and owner approval): **#68** stabilisation (unknown approval shown as "requested", patients no longer choose staff, error text escaped, predictive `/train` default-deny, sign-out keeps unsent drafts, dependency-audit CI job); **#69** role × table access matrix test, migration ledger, backend `/readyz`; **#70** docs sync and cache bump. Current version: `CACHE_VERSION` **v72**, `APP_BUILD` **2026-11-07.72**, tagged **`v1.0`**.

## 3. Pull requests
**None open (2026-11-08).** Closed without merging, by owner decision:

| PR | Content | Where the code is kept |
|---|---|---|
| #18 | Opt-in AI visit summary (synthetic only), migration `014`; deferred (lecturer: no new AI component) | branch `feature/llm-clinical-summary` in the owner's backup |
| #21 | Archive of two historical plans | branch `docs/archive-historical-plans` in the backup |
| #34 | Outdated session-handoff docs (merging would roll back newer `CLAUDE.md`/`HANDOFF.md`) | branch `docs/session-handoff` in the backup |
| 14× | Dependabot dependency bumps (several major versions, e.g. `pandas` 3, `actions/checkout` 7) | not kept; Dependabot reopens newer versions. CI `dependency-audit` reports 0 known vulnerabilities |

## 4. Branches and backup
**On GitHub:** only `main`. All branches already merged into `main` were deleted on 2026-11-08 with owner approval (their commits are in `main`; each can be restored from its PR page). This includes `release`; it is recreated from the approved commit when deployment starts (see `DEPLOY.md`).

**Unmerged work, deleted from GitHub and kept in the owner's backup:** `feature/offline-draft-safety` (owner capture, server-ack-only removal, export controls), `fix/ui-clinical-safety-visibility` (WIP: visible load failures and risk result), `feature/llm-clinical-summary` (#18), `docs/session-handoff` (#34), `docs/archive-historical-plans` (#21), `codex/predictive-response-contract` (superseded original of #28).

**Backup (2026-11-08):** a private repository `diabhelal/home-care-crm-backup` and the same folder on the owner's machine: a bundle of the whole repository, a bundle of the six unmerged branches, uncommitted changes from every working copy, and restore instructions. `keys.txt` is deliberately not included.

**Local worktrees (owner's machine, not on GitHub):** clean worktrees were removed on 2026-11-08; 21 remain because they hold uncommitted changes or a commit that is on no branch (all of it copied into the backup).

## 5. Database migrations (none is applied by this work)
| Files | State | Where |
|---|---|---|
| `001`–`007` | **Applied** to the live project on 2026-10-15 (also in `supabase/migrations/`) | `main` |
| `008`–`013` | Written, tested on isolated Postgres, **not applied** | `main` (`supabase/proposed/`) |
| `014` | AI-summary migration, reserved | closed PR #18 (in the owner's backup) |
| `015`–`018` | Written, tested on isolated Postgres 16 and 18, **not applied** | `main` (`supabase/proposed/`) |
| `019` | Staff access by active care relationship, **applied to the live project 2026-11-07** (registered `20261107130647`) | `main` (`supabase/migrations/`) |
| `020` | Measurements outside a booking, **applied to the live project 2026-11-07** (registered `20261107131226`, after 019) | `main` (`supabase/migrations/`) |
| `021` | Service pause, **not applied** | `main` (`supabase/proposed/`) |
`docs/MIGRATION_LEDGER.md` (generated by `scripts/migration_ledger.py`, checked in CI) lists every file with a hash of its SQL; the registered copies of `001`–`007`, `019`, `020` are SQL-identical to their `supabase/proposed/` sources (only header comments differ). It reads the repository, not the live database. A fresh project (the planned demo database) takes `supabase/migrations/*.sql` (25 files) and then `008`–`013`, `015`–`018`, `021` in order; `backend/scripts/verify_proposed_sql.py` does exactly this on a throwaway Postgres. Applying anything to a remote database needs a separate owner approval, a verified backup and one file at a time.

**Demo project:** `home-care-crm-demo` was **deleted on 2026-11-08** at the owner's request. Railway deployment (prepared 2026-11-13, not deployed, see `DEPLOY.md`): development uses a new, empty Supabase project `home-care-crm-dev` (to be created only after approval) that takes the 25 migration files and then `008`–`013`, `015`–`018`, `021`; production uses `qqeupktyadjxqoxkstnl` and needs `008`–`013`, `015`–`018`, `021` one at a time after a backup. `019`/`020` are recorded as applied there; that is re-verified read-only before any change. `DEPLOY.md` maps each acceptance requirement to the migrations it needs.

## 6. Test evidence
**Current (2026-11-07, `main` `cd8c913` content, the code of `v1.0`):** JS unit 83 · backend 215 · `tests_db` 223 · mocked Playwright 100 (23 spec files, the CI set) · predictive 48; CI green on `main`. Earlier evidence:

| Checkout | Unit | Backend `pytest` | `tests_db` | Mocked Playwright (Chromium, serial) | Predictive |
|---|---|---|---|---|---|
| integration branch (= `main` @ `777191e` content) | 74/74 | 182 passed | 197/197 (+ `verify_proposed_sql.py`: 23 migrations + 18 proposed files, all post-flight checks OK) | 87 passed | 38 passed |
| `main` @ `78d93fa` (all five scopes merged; verified on the PR heads before each merge) | 74/74 | 202 passed | 219/219 (+ `verify_proposed_sql.py`: 23 migrations + 20 proposed files, OK) | 108 passed | 38 passed |
| `main`, GitHub Actions | green | green | green (PG 16 and 18) | green | green |
`check_docs.py`: 20 documents, 0 problems. Both FastAPI services were started with their start commands (`/healthz`, `/health` OK; a foreign CORS origin is rejected; `/train` returns 403 when `DISABLE_TRAINING=1`). Since 2026-11-13 the Railway images are built and checked in CI (`deploy/container-smoke.sh`).

What these cover, in the requested order: patient request, admin approval/assignment, check-in with server time, documentation and completion (`demo-journey`, `mobile-journey`, `backend-booking`, `admin-lifecycle`, `staff-field-actions`); authorization (staff not assigned gets 403, another patient cannot cancel: `backend-booking`/`mobile-journey`; RLS, column grants and ownership: `tests_db`); cancellation by patient and admin; page refresh (`mobile-journey`, `demo-journey`); network failure (no "confirmed" without server confirmation: `backend-booking`; draft kept, "not confirmed by the server" after 5xx: `offline-queue-5xx`); offline completion then sync (`mobile-journey`, `offline-queue*`); patient isolation (`cross-patient-isolation`); report saving independent of the risk service (`backend/tests/test_risk.py`: 503 `predictive_unavailable`, report survives).

**Not covered locally:** a real Supabase stack (PostgREST, Auth/JWT, Edge Function) with the real backend and a real browser. There is no Docker in this environment; that first full-stack run happens on the demo environment. `booking.spec.js`/`visit-report.spec.js` (manual, need a real project), axe/screen-reader checks, and a real-device mobile pass were not run.

## 7. Remaining work and open items
- **Cloud deployment (owner approval):** Railway with two environments (`development` from `dev`, `production` from `main`), each with `frontend` (Caddy) and `backend` (FastAPI + private predictive service); estimated $6–8/month. Prepared in the repo (Dockerfiles, CI job `containers`); creating the Railway project, the dev Supabase project, migrations and deploys each need approval. See `DEPLOY.md`.
- **Not applied (owner approval):** migrations `008`–`018` and `021` on the live project; Auth hardening in the Supabase dashboard (MFA, password length, CAPTCHA for anonymous sign-in, leaked-password protection); a new attestation secret per environment.
- **Clinical wording (needs a clinician):** the UI says "מצב תקין" for green; an audit reported one predictive endpoint maps "no data" to a low-concern message (not re-verified). No thresholds were changed.
- **CI coverage:** every mocked spec runs by glob except `booking`/`visit-report` (live database) and `trend-forecast` (flaky, excluded on purpose).
- **Models:** no trained ML model. `ml_targets.py`, `statsmodels`, `scikit-learn` are in active use and are not to be removed; `lstm_interface.py` is a placeholder; SMS login is dormant.
- **Open product findings:** the risk result after saving a visit report is written to an already closed modal (unfinished work on `fix/ui-clinical-safety-visibility`, kept in the owner's backup); known gaps are listed in `HANDOFF.md`.

### 7a. Release review register (2026-11-07, read-only reviews of `main` `2d788f7`; evidence in the reviewers' file:line notes)
**Fixed on branch `fix/release-blockers`:** `escapeHtml` did not escape quotes although values are placed in `value="..."`/`data-path="..."` attributes (stored XSS from staff-entered text, `public/app.js`); two unescaped fallback labels (`work-queue.js`, `staff.js`); `cross-patient-isolation` and `comprehensive-wording` specs were in no CI job; `DEPLOY.md` contradictions (auto-deploy vs `release` branch, manual `connect-src`, stale status).
**Fixed on `fix/insufficient-data-presentation` (owner-approved 2026-11-07):** missing data is shown as "אין מספיק נתונים להערכה" (`short_term_concern: insufficient_data`), not as low concern; alerts from available measurements are preserved; regression tests added. **Deferred clinical-review items (not required to close this fix):** (1) the systolic red boundary (`CLINICAL_THRESHOLDS_FOR_REVIEW.md` says `>= 180`, code `> 180`; behaviour 179 yellow, 180 yellow, 181 red, pinned by a test, unchanged); (2) the reassessment intervals 2/6/24 hours for high/moderate/low are not clinically validated and are not in the thresholds document; the insufficient-data state has no interval by owner decision.
**Live-schema gaps closed only by proposed migrations (not applied anywhere):** staff can write/edit/delete `visit_reports` directly through PostgREST (008 + 016); booking status/overlap guards (009, 010); `old_data` is always NULL in `audit_log` because `tg_op` is compared in lower case (015); cancelled/rejected bookings keep chart access (019). The separate demo project must receive 008-013, 015-021 in the documented order.
**Fixed on `fix/review-findings`:** predictive service CORS default is now local dev origins only (was `*`) and its list inputs are bounded; per-request `httpx.Client` is now closed (`backend/app/main.py` `ctx`); `Idempotency-Key` (128) and `patient_signature_data` (400,000 chars) are bounded; Render installs `backend/requirements.runtime.lock.txt` (28 runtime packages, no pytest/local Postgres) and `predictive-service/requirements.lock.txt` (verified on Python 3.13.9, 39 tests pass).
**Deferred (P2/P3):** the predictive service's prediction routes are still unauthenticated because the browser calls them directly (no patient identifiers are sent; backend verifies HMAC attestations before saving any risk result); `/train/*` is now default-deny (needs `PREDICTIVE_TRAINING_KEY` + `X-Service-Key`, and `DISABLE_TRAINING=1` still closes it) and CORS is limited to GET/POST + Content-Type; retried `complete` returns 409 (the client already verifies and recovers); approve/reject is last-write-wins; `/healthz` is liveness only; mocked e2e specs are not integration tests; `trend-forecast.spec.js` is flaky and explicitly excluded in CI (every other mocked spec now runs by glob; `dependency-audit` job runs pip-audit + npm audit); 1-5 mocked e2e specs fail intermittently on clean `main` under load or around midnight.

## 8. What is deliberately not on GitHub
`.env` files, `keys.txt`, `supabase/.temp`, local Claude settings, database backups and git bundles in the owner's home directory (the 2026-11-08 code backup is in a separate private repository), Python virtual environments and `node_modules`, regenerated screenshots in temporary worktrees. A scan of the working tree and of the whole history on 2026-11-06 found no keys, tokens or passwords (the only matches are the secret scanner's own patterns).
