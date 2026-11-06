# Repository status, branch and PR map

> Snapshot **2026-11-06**, `main` @ `78d93fa` (after #39, #40, #42, the three bug-fix PRs #43/#45/#44 and #35). Describes the repository as a whole so a reviewer does not have to reconstruct it from 40 branches.

**תקציר בעברית:** `main` כולל את הבסיס היציב, חבילת האיחוד (#39), קונפיג הפריסה (#40), מדידה מחוץ לביקור (#42) עם שיוך אופציונלי לביקור (#47), שלושה תיקוני באגים (#43, #45, #44), השהיית שירות (#35), תיקון XSS שמור ב-`escapeHtml` ועוד (#48), עדכון `certifi` הקריטי (#17), הסוכנים והאפיון באנגלית (#49) ו-#23 (מסגרת סוכנים, מוזג על ידי הבעלים). **אף מיגרציה לא הוחלה על מסד חי (008-021 הן הצעות; 019 חייבת לבוא לפני 020), ולא בוצעה פריסה ציבורית.** נשארו פתוחים: #34, #21, #18, ו-Dependabot (ללא התראת אבטחה פתוחה).

## 1. Where to start (reviewer path)
| What | Where |
|---|---|
| Project overview, features, architecture | [`README.md`](../README.md) |
| This map | `docs/REPO_STATUS.md` |
| Stabilisation plan, findings and Go/No-Go checklist (Hebrew) | [`docs/STABILIZATION_PLAN.md`](STABILIZATION_PLAN.md) |
| Demo walkthrough | [`docs/DEMO.md`](DEMO.md) |
| Database model, risk engine, security | [`docs/DATABASE.md`](DATABASE.md), [`docs/RISK_ENGINE.md`](RISK_ENGINE.md), [`docs/SECURITY_ARCHITECTURE.md`](SECURITY_ARCHITECTURE.md) |
| Medical-record integrity rules and owner decisions | `docs/RECORD_INTEGRITY.md` (on PR #30) |
| Handoff for the next working session | `HANDOFF.md`, `docs/SESSION_HANDOFF.md` (branch `docs/session-handoff`) |

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

Then **#40** (`72134f6`): `render.yaml` (manual deploys only, no auto-deploy trigger anywhere), `scripts/make_release.py`, predictive `ALLOWED_ORIGINS`/`DISABLE_TRAINING`, DEPLOY.md. Earlier merges: #19 (README and docs), #20, #22, #26 (patient isolation), #36 (`docs/SPECIFICATION.md`). Version: `CACHE_VERSION` **v58**, `APP_BUILD` **2026-11-06.58**. Two tests were corrected during integration (no product change): `comprehensive-wording` now starts the patient scope like the real modal; `staff-field-actions` pins the clock to 10:00 (it failed in the hour before local midnight, also on the old `main`).

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

## 3. Open pull requests (each merge needs explicit owner approval)
| PR | Branch | Content | Disposition |
|---|---|---|---|
| #34 | `docs/session-handoff` | Handoff docs, agents, settings | Batch B: conflicts in `CLAUDE.md`/`HANDOFF.md`; overlaps #23 |
| #21 | `docs/archive-historical-plans` | Archives two old plans | Retarget base to `main` (its base #19 is merged) |
| #18 | `feature/llm-clinical-summary` | Opt-in AI visit summary (synthetic only), migration `014` | **Deferred** (lecturer: no new AI component); branch kept |
| 13× | `dependabot/...` | Routine dependency bumps (#15 is superseded by #17) | No open security alert; review `fastapi` (#13) and `pandas>=3` (#7) individually after the demo |

## 4. Branches
**Merged into `main` (0 unique commits; deletion needs separate owner approval, none has been deleted):** `feature/patient-measurements`, `feature/service-availability`, `fix/completed-report-guidance`, `fix/session-resilience`, `fix/reset-protect-drafts`, `chore/playwright-fail-on-busy-port`, `codex/predictive-response-contract-main`, `docs/project-specification`, `docs/readme-overhaul`, `docs/revert-spec-driven-extras`, `docs/spec-driven-workflow`, `feature/backend-booking-reliability`, `feature/cross-patient-isolation`, `feature/predictive-input-and-wording`, `feature/record-integrity-sql`, `feature/trend-forecast-button-fix`, `fix/ci-postgres-restrict-violation`, `fix/draft-409-same-risk-assessment`, `fix/offline-drafts-5xx-visibility`, `fix/service-worker-shell-and-api-cache`, `fix/ui-no-physical-delete`, `integration/release-1`, `chore/deploy-config` (18).

**Keep (unique work):** `feature/offline-draft-safety` (3 commits, no PR: owner capture, server-ack-only removal, export controls; needs a PR and version coordination), `fix/ui-clinical-safety-visibility` (1 WIP commit: visible load failures and risk result), `feature/llm-clinical-summary` (#18), `feature/service-availability` (#35), `docs/session-handoff` (#34), `feature/agents-framework` (#23), `docs/archive-historical-plans` (#21) (#40).

**Decide:** `codex/predictive-response-contract` is the original of #28 (same 87-line change, stacked on older branches). Superseded; keep until the owner decides.

## 5. Database migrations (none is applied by this work)
| Files | State | Where |
|---|---|---|
| `001`–`007` | **Applied** to the live project on 2026-10-15 (also in `supabase/migrations/`) | `main` |
| `008`–`013` | Written, tested on isolated Postgres, **not applied** | `main` (`supabase/proposed/`) |
| `014` | AI-summary migration, reserved | #18 |
| `015`–`019` | Written, tested on isolated Postgres 16 and 18, **not applied** | `main` (`supabase/proposed/`) |
| `020` | Measurements outside a booking, **not applied** (tested on isolated Postgres and on the local stack) | `main` (`supabase/proposed/`) |
| `021` | Service pause, **not applied** | `main` (`supabase/proposed/`) |
A fresh project (the planned demo database) takes `supabase/migrations/*.sql` (23 files) and then `008`–`021` (except `014`) in order; `backend/scripts/verify_proposed_sql.py` does exactly this on a throwaway Postgres. Applying anything to a remote database needs a separate owner approval, a verified backup and one file at a time.

**Demo project (separate from the live project):** `home-care-crm-demo` has migrations 001-007 + 008-013, 015-021 applied (2026-11-07), synthetic data only. The live project `qqeupktyadjxqoxkstnl` is unchanged. Not yet hosted: the Render services and the static site are waiting for the owner's Render and Cloudflare accounts.

## 6. Test evidence (2026-11-06)
| Checkout | Unit | Backend `pytest` | `tests_db` | Mocked Playwright (Chromium, serial) | Predictive |
|---|---|---|---|---|---|
| integration branch (= `main` @ `777191e` content) | 74/74 | 182 passed | 197/197 (+ `verify_proposed_sql.py`: 23 migrations + 18 proposed files, all post-flight checks OK) | 87 passed | 38 passed |
| `main` @ `78d93fa` (all five scopes merged; verified on the PR heads before each merge) | 74/74 | 202 passed | 219/219 (+ `verify_proposed_sql.py`: 23 migrations + 20 proposed files, OK) | 108 passed | 38 passed |
| `main`, GitHub Actions | green | green | green (PG 16 and 18) | green | green |
`check_docs.py`: 20 documents, 0 problems. Both FastAPI services were started with the Render start commands (`/healthz`, `/health` OK; a foreign CORS origin is rejected; `/train` returns 403 when `DISABLE_TRAINING=1`).

What these cover, in the requested order: patient request, admin approval/assignment, check-in with server time, documentation and completion (`demo-journey`, `mobile-journey`, `backend-booking`, `admin-lifecycle`, `staff-field-actions`); authorization (staff not assigned gets 403, another patient cannot cancel: `backend-booking`/`mobile-journey`; RLS, column grants and ownership: `tests_db`); cancellation by patient and admin; page refresh (`mobile-journey`, `demo-journey`); network failure (no "confirmed" without server confirmation: `backend-booking`; draft kept, "not confirmed by the server" after 5xx: `offline-queue-5xx`); offline completion then sync (`mobile-journey`, `offline-queue*`); patient isolation (`cross-patient-isolation`); report saving independent of the risk service (`backend/tests/test_risk.py`: 503 `predictive_unavailable`, report survives).

**Not covered locally:** a real Supabase stack (PostgREST, Auth/JWT, Edge Function) with the real backend and a real browser. There is no Docker in this environment; that first full-stack run happens on the demo environment. `booking.spec.js`/`visit-report.spec.js` (manual, need a real project), axe/screen-reader checks, and a real-device mobile pass were not run.

## 7. Remaining work and open items
- **Cloud deployment prerequisites (owner):** a separate demo Supabase project; Render account and a budget decision (backend Starter about $7/month, or Free with sleep); Cloudflare Pages on a `release` branch; then migrations to the demo project, deploy, a full browser run against the public URL. See `DEPLOY.md`.
- **Not applied (owner approval):** migrations `008`–`019`/`021` anywhere; Auth hardening in the Supabase dashboard (MFA, password length, CAPTCHA for anonymous sign-in, leaked-password protection); a new attestation secret per environment.
- **Clinical wording (needs a clinician):** the UI says "מצב תקין" for green; an audit reported one predictive endpoint maps "no data" to a low-concern message (not re-verified). No thresholds were changed.
- **CI coverage gap:** `cross-patient-isolation.spec.js`, `trend-forecast.spec.js` and `comprehensive-wording.spec.js` are not in `ci.yml`.
- **Models:** no trained ML model. `ml_targets.py`, `statsmodels`, `scikit-learn` are in active use and are not to be removed; `lstm_interface.py` is a placeholder; SMS login is dormant.
- **Open product findings:** the risk result after saving a visit report is written to an already closed modal (`fix/ui-clinical-safety-visibility` holds unfinished work); known gaps are listed in `HANDOFF.md`.

### 7a. Release review register (2026-11-07, read-only reviews of `main` `2d788f7`; evidence in the reviewers' file:line notes)
**Fixed on branch `fix/release-blockers`:** `escapeHtml` did not escape quotes although values are placed in `value="..."`/`data-path="..."` attributes (stored XSS from staff-entered text, `public/app.js`); two unescaped fallback labels (`work-queue.js`, `staff.js`); `cross-patient-isolation` and `comprehensive-wording` specs were in no CI job; `DEPLOY.md` contradictions (auto-deploy vs `release` branch, manual `connect-src`, stale status).
**Needs an owner decision (clinical output, not changed):** `predictive-service/main.py` ~L740: when the latest history entry has no vitals, `current_risk` is `no_data` but `short_term_concern` is `low` (missing data reads as low concern; recommended: `unknown`); `docs/CLINICAL_THRESHOLDS_FOR_REVIEW.md` says systolic red is `>=180` while the code uses `>180`.
**Live-schema gaps closed only by proposed migrations (not applied anywhere):** staff can write/edit/delete `visit_reports` directly through PostgREST (008 + 016); booking status/overlap guards (009, 010); `old_data` is always NULL in `audit_log` because `tg_op` is compared in lower case (015); cancelled/rejected bookings keep chart access (019). The separate demo project must receive 008-013, 015-021 in the documented order.
**Fixed on `fix/review-findings`:** predictive service CORS default is now local dev origins only (was `*`) and its list inputs are bounded; per-request `httpx.Client` is now closed (`backend/app/main.py` `ctx`); `Idempotency-Key` (128) and `patient_signature_data` (400,000 chars) are bounded; Render installs `backend/requirements.runtime.lock.txt` (28 runtime packages, no pytest/local Postgres) and `predictive-service/requirements.lock.txt` (verified on Python 3.13.9, 39 tests pass).
**Deferred (P2/P3):** predictive service still has no authentication (training is off via `DISABLE_TRAINING=1`; backend verifies HMAC attestations before saving any risk result); retried `complete` returns 409 (the client already verifies and recovers); approve/reject is last-write-wins; `/healthz` is liveness only; CI has no dependency audit; mocked e2e specs are not integration tests; `trend-forecast.spec.js` is flaky and not in CI; 1-5 mocked e2e specs fail intermittently on clean `main` under load or around midnight.

## 8. What is deliberately not on GitHub
`.env` files, `keys.txt`, `supabase/.temp`, local Claude settings, database backups and git bundles in the owner's home directory, Python virtual environments and `node_modules`, regenerated screenshots in temporary worktrees. A scan of the working tree and of the whole history on 2026-11-06 found no keys, tokens or passwords (the only matches are the secret scanner's own patterns).
