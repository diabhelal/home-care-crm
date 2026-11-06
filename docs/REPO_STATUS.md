# Repository status, branch and PR map

> Snapshot **2026-11-06**, `main` @ `777191e` (after the integration merge #39). Describes the repository as a whole so a reviewer does not have to reconstruct it from 40 branches.

**תקציר בעברית:** `main` כולל כעת את הבסיס היציב ואת חבילת האיחוד הראשונה (10 PR-ים, מוזגו ב-#39 באישור הבעלים; CI ירוק על התוצאה המשולבת). נשארו פתוחים: #40 (קונפיג פריסה), חבילה ב' (#35, #34, #21, #23) ו-#18 (נדחה; סיכום LLM). אף מיגרציה לא הוחלה על מסד חי; לא בוצעה פריסה ציבורית.

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
`main` @ `777191e`. Integration PR **#39** merged these ten PRs in one reviewed batch (CI green on the combined result; owner approved the batch):

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

Earlier merges: #19 (README and docs), #20, #22, #26 (patient isolation), #36 (`docs/SPECIFICATION.md`). Version: `CACHE_VERSION` **v58**, `APP_BUILD` **2026-11-06.58**. Two tests were corrected during integration (no product change): `comprehensive-wording` now starts the patient scope like the real modal; `staff-field-actions` pins the clock to 10:00 (it failed in the hour before local midnight, also on the old `main`).

## 3. Open pull requests (each merge needs explicit owner approval)
| PR | Branch | Content | Disposition |
|---|---|---|---|
| #40 | `chore/deploy-config` | `render.yaml` (manual deploys), `scripts/make_release.py`, predictive CORS/`DISABLE_TRAINING`, DEPLOY.md | CI green, no workflow or deployment trigger touched; ready for approval |
| #35 | `feature/service-availability` | Admin can pause a service (proposed SQL `021`, not applied) | Batch B: update from `main`, bump version, add `js/admin/services.js` to the shell |
| #34 | `docs/session-handoff` | Handoff docs, agents, settings | Batch B: conflicts in `CLAUDE.md`/`HANDOFF.md`; overlaps #23 |
| #23 | `feature/agents-framework` | Agent framework | Batch B / deferred: not needed for the demo |
| #21 | `docs/archive-historical-plans` | Archives two old plans | Retarget base to `main` (its base #19 is merged) |
| #18 | `feature/llm-clinical-summary` | Opt-in AI visit summary (synthetic only), migration `014` | **Deferred** (lecturer: no new AI component); branch kept |
| 15× | `dependabot/...` | Dependency bumps | Triage only those touching deployed requirements; one GitHub "critical" advisory not yet reviewed |

## 4. Branches
**Merged into `main` (0 unique commits; proposed for deletion only after owner approval):** `chore/playwright-fail-on-busy-port`, `codex/predictive-response-contract-main`, `docs/project-specification`, `docs/readme-overhaul`, `docs/revert-spec-driven-extras`, `docs/spec-driven-workflow`, `feature/backend-booking-reliability`, `feature/cross-patient-isolation`, `feature/predictive-input-and-wording`, `feature/record-integrity-sql`, `feature/trend-forecast-button-fix`, `fix/ci-postgres-restrict-violation`, `fix/draft-409-same-risk-assessment`, `fix/offline-drafts-5xx-visibility`, `fix/service-worker-shell-and-api-cache`, `fix/ui-no-physical-delete`, `integration/release-1` (17).

**Keep (unique work):** `feature/offline-draft-safety` (3 commits, no PR: owner capture, server-ack-only removal, export controls; needs a PR and version coordination), `fix/ui-clinical-safety-visibility` (1 WIP commit: visible load failures and risk result), `feature/llm-clinical-summary` (#18), `feature/service-availability` (#35), `docs/session-handoff` (#34), `feature/agents-framework` (#23), `docs/archive-historical-plans` (#21), `chore/deploy-config` (#40).

**Decide:** `codex/predictive-response-contract` is the original of #28 (same 87-line change, stacked on older branches). Superseded; keep until the owner decides.

## 5. Database migrations (none is applied by this work)
| Files | State | Where |
|---|---|---|
| `001`–`007` | **Applied** to the live project on 2026-10-15 (also in `supabase/migrations/`) | `main` |
| `008`–`013` | Written, tested on isolated Postgres, **not applied** | `main` (`supabase/proposed/`) |
| `014` | AI-summary migration, reserved | #18 |
| `015`–`019` | Written, tested on isolated Postgres 16 and 18, **not applied** | `main` (`supabase/proposed/`) |
| `021` | Service pause, **not applied** | #35 |
A fresh project (the planned demo database) takes `supabase/migrations/*.sql` (23 files) and then `008`–`019` in order; `backend/scripts/verify_proposed_sql.py` does exactly this on a throwaway Postgres. Applying anything to a remote database needs a separate owner approval, a verified backup and one file at a time.

## 6. Test evidence (2026-11-06)
| Checkout | Unit | Backend `pytest` | `tests_db` | Mocked Playwright (Chromium, serial) | Predictive |
|---|---|---|---|---|---|
| integration branch (= `main` @ `777191e` content) | 74/74 | 182 passed | 197/197 (+ `verify_proposed_sql.py`: 23 migrations + 18 proposed files, all post-flight checks OK) | 87 passed | 38 passed |
| `main` @ `777191e`, GitHub Actions | green | green | green (PG 16 and 18) | green | green |
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

## 8. What is deliberately not on GitHub
`.env` files, `keys.txt`, `supabase/.temp`, local Claude settings, database backups and git bundles in the owner's home directory, Python virtual environments and `node_modules`, regenerated screenshots in temporary worktrees. A scan of the working tree and of the whole history on 2026-11-06 found no keys, tokens or passwords (the only matches are the secret scanner's own patterns).
