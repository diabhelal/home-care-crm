# Repository status, branch and PR map

> Snapshot taken **2026-11-04** (updated after the merge of #20, #22 and #26) from GitHub (`diabhelal/home-care-crm`). This file lives on the docs branch (PR #19) and describes the repository as a whole, so a reviewer can find every piece of work without guessing. Synthetic data only; nothing here has been deployed or applied to a live database.

**תקציר בעברית:** `main` כולל את הבסיס היציב + שלושה PR-ים שמוזגו באישור הבעלים: #20 (תיקון בדיקות DB), #22 (כפתור התחזית) ו-#26 (בידוד בין מטופלים בתיק ובדוח). כל שאר העבודה נמצאת ב-PR-ים פתוחים עם CI ירוק וממתינה לאישור מיזוג. הצעות ה-SQL (008–019) **כתובות ונבדקו על Postgres מבודד אך לא הוחלו** על שום מסד חי. שום דבר לא נפרס. אין סודות, קבצי `.env`, גיבויים או מידע רפואי במאגר.

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
`main` @ `131dd85` = the working prototype (guest booking through the Python backend, approval lifecycle, availability with a travel buffer, staff field actions, offline visit-report drafts, rule-based risk assessment labelled "demo") plus three PRs merged with explicit owner approval on 2026-11-04:

| PR | Merge commit | What it brought |
|---|---|---|
| #20 | `a18af20` | Test-only: isolated-Postgres tests accept `ForeignKeyViolation` as well as `RestrictViolation` (no application code, no migrations) |

CI on `main` is green for each of these merges. Branches of merged PRs were kept (not deleted). `CACHE_VERSION` on `main` is **v52** and `APP_BUILD` **2026-11-03.52**.

Database state: migrations `001`–`007` are applied to the live project; **`008`–`019` are not applied** (see section 5). Nothing in these merges touches SQL or the live database.

## 3. Open pull requests
All PRs target `main` unless noted. CI = the repository workflow (secret scan, JS unit, Python unit, backend + isolated-database tests, mocked Playwright); the two booking/visit-report specs are manual-only and skipped.

| PR | Branch | Content | Files | CI | Depends on / conflicts |
|---|---|---|---|---|---|
| #23 | `feature/agents-framework` | 9 project agents, 4 skills, `.claude/settings.json` (DB-write rules), `docs/AGENT_TEAM.md` | 21 | green | none; `docs/session-handoff` carries identical copies |
| #24 | `feature/predictive-input-and-wording` | Predictive service rejects NaN/Infinity; neutral wording; "no data" is not "normal" | 10 | green | `CACHE_VERSION` v50 |
| #25 | `feature/backend-booking-reliability` | Precise 23505 mapping, 409/502 handlers, newest-first history reads | 10 | green | none |
| #27 | `fix/draft-409-same-risk-assessment` | After a 409 verified as "same", the risk assessment is still requested (queued on transient failure) | 4 | green | `CACHE_VERSION` v49 (collides with #22, #32, #33) |
| #28 | `codex/predictive-response-contract-main` | Validates the predictive risk response before it is signed/stored (strict contract) | 6 | green | none. Docs overlap with #19 |
| #29 | `chore/playwright-fail-on-busy-port` | Playwright no longer reuses a stale server on :8080 | 1 | green | none |
| #30 | `feature/record-integrity-sql` | **Proposed SQL 015–019** + 23 new DB tests + rollback blocks + `docs/RECORD_INTEGRITY.md` (owner decisions) — not applied | 22 | green | needs 008–013 applied first (also unapplied) |
| #31 | `fix/ui-no-physical-delete` | No delete buttons for staff / patient messages; amendment form only for the report's author | 12 | green | pairs with #30 (UI side). `CACHE_VERSION` v49 |
| #32 | `fix/service-worker-shell-and-api-cache` | Admin scripts in the cached shell; other origins on the same hostname are never cached | 3 | green | **after #26 merges, add `js/shared/patient-scope.js` to `APP_SHELL`** (the new unit test will fail until then — intended). `CACHE_VERSION` v49 |
| #33 | `fix/offline-drafts-5xx-visibility` | After 5xx/timeout the user sees "not confirmed by the server", content kept, safe "retry now" button | 4 | green | `CACHE_VERSION` v49 |
| #18 | `feature/llm-clinical-summary` | Opt-in AI visit-summary draft (synthetic data only) + reproducible evaluation; migration `014` | 51 | green | reserves migration number 014 |
| #19 | `docs/readme-overhaul` | Lecturer-facing README and per-topic docs (`DATABASE`, `RISK_ENGINE`, `SECURITY_ARCHITECTURE`, …) + this map and the stabilisation plan | 16 | green | base of #21; `HANDOFF.md`/`CLAUDE.md` overlap with `docs/session-handoff` |
| #21 | `docs/archive-historical-plans` | Archives the two historical plans | 6 | green | **base is #19** (stacked) |
| #34 | `docs/session-handoff` | Corrected `CLAUDE.md`/`HANDOFF.md` (branch + PR policy), `docs/SESSION_HANDOFF.md`, 9 agents / 4 skills / settings / Codex configs (byte-identical to #23), verification scripts | 33 | green | `CLAUDE.md`/`HANDOFF.md` overlap with #19 — small conflict expected |
| 15× | `dependabot/...` | Dependency bumps (not triaged; one GitHub "critical" advisory not yet reviewed) | — | — | — |

### Suggested merge order for what is still open (each merge needs explicit owner approval)
`#23 → #24 → #25 → #27 → #28 → #29 → #31 → #32 → #33`, then `#19 → #21 → #34`, then `#30` last, and only then a controlled, backed-up application of migrations. Before each merge: update the branch with `main`, renumber the cache version (below) and re-run the tests.

### Version-cache coordination (must be done before merging the rest)
`main` is now at `CACHE_VERSION` **v52** / `APP_BUILD` **.52** (from #26). The remaining PRs still carry older numbers, so merging them as they are would **lower** the version and reintroduce stale-cache risk. Renumber each one above 52, in merge order (one increment per merged PR).

| PR | Value on the branch | Conflict with current `main` (computed with `git merge-tree`) |
|---|---|---|
| #24 | v50 | conflict in `public/config.js`, `public/service-worker.js` (version lines only) |
| #27, #31, #33 | v49 | same two version lines only |
| #32 | v49 | same two version lines; also its `APP_SHELL` edit sits next to the line #26 already added (`js/shared/patient-scope.js`), so the shell test passes once the branch is updated from `main` |
| `feature/offline-draft-safety` (no PR) | v51 (planned) | clean today; renumber when it gets a PR |
| #18 | — | conflict in the four `backend/tests_db/*` files that #20 changed (update the branch from `main`) |
| #19, #23, #25, #28, #29, #30, #34 | — | clean |

## 4. Branches without a pull request
| Branch | Content | Status |
|---|---|---|
| `feature/offline-draft-safety` | Offline-draft safety (owner captured before lock, export controls, tests; independent verification scripts) | Ready, needs `CACHE_VERSION` coordination, full serial Playwright and a PR |
| `codex/predictive-response-contract` | Original of #28, stacked on #22/#26 | Kept for history; superseded by #28 |
| `fix/ci-postgres-restrict-violation` | Merged as #20 | Kept (not deleted) |

## 5. Database migrations (none is applied by this work)
| Files | State | Where |
|---|---|---|
| `001`–`007` | **Applied** to the live project on 2026-10-15 (also in `supabase/migrations/`) | `main` |
| `008`–`013` | Written, tested on isolated Postgres, **not applied** | `main` (`supabase/proposed/`) |
| `014` | AI-summary migration, reserved | #18 |
| `015`–`019` | Written, tested on isolated Postgres 16.14 **and** 18.4 (197 tests), **not applied** | #30 |
Applying any of them requires a separate owner approval, a verified backup and `get_advisors`, one file at a time, in order. Owner-approved access/lifecycle decisions are recorded in `docs/RECORD_INTEGRITY.md` (#30).

## 6. Test evidence (this session, 2026-11-04)
| Checkout | Unit | Backend `pytest` | `tests_db` PG 18 / PG 16 | Mocked Playwright (serial) |
|---|---|---|---|---|
| `main` @ `131dd85` (clean checkout) | 57 | 139 | 95 / 95 | 81 passed (serial; 1 intermittent failure in 1 of 3 full runs, 0 in 95 repeated runs of that file) + `sw-update` + 14/14 isolation + 13/13 trend-forecast |
| #28 | 57 | 158 | 95 / 95 | CI green |
| #27 | 60 | 139 | 95 / 95 | CI green |
| #29 | 57 | 139 | 95 / 95 | CI green |
| #31 | 61 | 139 | 95 / 95 | 55 passed + `sw-update` |
| #32 | 60 | 139 | 95 / 95 | 54 passed + `sw-update` |
| #33 | 64 | — | — | 54 passed + `sw-update` |
| #30 | — | — | **197 / 197** | CI green |
Not run: `booking.spec.js` / `visit-report.spec.js` (live database), any real-browser manual pass, accessibility tooling (axe), the live database.
Known harness notes: Playwright uses a fixed port 8080 (11 specs hard-code it); `sw-update` must run in place (it copies `public/` relative to its own path).

## 7. Remaining work and open items
- **Not applied (needs owner approval):** migrations `008`–`019`; Auth hardening in the Supabase dashboard (MFA, password length, CAPTCHA for anonymous sign-in); rotation of the attestation secret.
- **Clinical wording (needs a clinician):** the UI says "מצב תקין" for green (verified in `public/app.js`), and an audit reported that one predictive endpoint maps "no data" to a low-concern message (reported by the audit, not independently re-verified); no thresholds or formulas are changed by any PR.
- **Not started / not verified:** real-browser and accessibility pass; booking → approval → visit → documentation → completion walk-through on an isolated environment including offline and cancellations; "visit completed without a report" path (the DB function creates the report atomically — no other path was checked); legal documents (privacy, consent, retention).
- **Models:** no trained ML model exists. `ml_targets.py`, `statsmodels`, `scikit-learn` are in active use by endpoints and are **not** to be removed; `lstm_interface.py` is a placeholder kept by an earlier owner decision; SMS login is dormant and kept.
- **CI coverage gap:** the repository CI runs 16 mocked Playwright files and does **not** include `cross-patient-isolation.spec.js` or `trend-forecast.spec.js`; they were run locally and pass. Adding them to `ci.yml` is a small follow-up.
- **Intermittent test:** `trend-forecast.spec.js` "איסוף נתונים" (a gate/race scenario) failed once in a full serial run on `main` and passed in 30 + 65 repeated runs; it should be hardened, it is not a product defect found.
- **Visit-report result visibility (open finding):** after saving a visit report the risk result is written to a modal that is already closed; the nurse sees only the list refresh. A branch `fix/ui-clinical-safety-visibility` holds unfinished work for this (WIP, no PR yet).
- **Process:** 15 Dependabot PRs are untriaged; merging the PRs above still needs the version-cache renumbering described in section 3.

## 8. What is deliberately not on GitHub
`.env` files, `keys.txt`, `supabase/.temp`, local Claude settings (`.claude/settings.local.json`), database backups / git bundles in the owner's home directory, Python virtual environments and `node_modules`, regenerated screenshots in temporary worktrees. A secret scan runs in CI over the whole history.
