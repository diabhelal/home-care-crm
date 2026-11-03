---
name: release-checklist
description: Use at the end of every development task in home-care-crm - run the right tests, bump cache versions, update counts/docs, commit and push with verification. Covers the repository's standing push rules.
---

# End-of-task checklist

1. **Tests** (run what the change touches, ideally all):
   - `node --test tests/unit/*.test.js`
   - `ls tests/e2e/*.spec.js | grep -vE "/(booking|visit-report)\.spec\.js$" | xargs npx playwright test` (then `git checkout -- docs/demo-proof`; the run regenerates screenshots). **Never** run `booking.spec.js` / `visit-report.spec.js` against the live database.
   - `cd backend && source .venv/bin/activate && python -m pytest -q --ignore=tests_db && python -m pytest tests_db -q`; `python scripts/verify_proposed_sql.py` after SQL changes.
   - `cd predictive-service && source .venv/bin/activate && python -m pytest -q` (its own venv).
2. **Client changes**: bump `CACHE_VERSION` in `public/service-worker.js` and `APP_BUILD` in `public/config.js`.
3. **Docs**: update the test counts in `HANDOFF.md`, `docs/REVIEW.md`, `README.md`; say clearly which migrations are written but **not applied** to the live database.
4. **Commit** only the files of this task (not `docs/design-preview.html` / `docs/hero-options.html`); add the Co-Authored-By line; the pre-commit hook scans for secrets and is never bypassed (`--no-verify` is forbidden).
5. **Branch + Pull Request, never a direct push to `main`** (owner instruction of 2026-10-30, which replaced the earlier direct-push rule): work on `feature/<name>`, `git push -u origin <branch>`, open the PR into `main` with `gh pr create` (what changed, tests and results, migrations not applied). Verify with `gh pr view` and that CI is green on the PR. Do not merge it; the owner merges unless they said otherwise.
6. **Report** plainly: what changed, tests with real numbers, what is applied vs only in GitHub, what remains. If a push or test fails, say so; the task is not done.

Not covered by the standing permission: push to `main`, merging the PR, force-push, history rewrite, repository visibility changes, database changes or migrations on the live project, deployments.
