---
name: db-migration-workflow
description: Use for ANY change to the Supabase schema, policies, triggers, functions or views of home-care-crm. Enforces the project's safe path - proposed SQL, isolated Postgres tests, rollback block, explicit owner approval, then apply and register.
---

# Database change workflow (home-care-crm)

The live project (`qqeupktyadjxqoxkstnl`) holds the only real database. It has no platform backups on the current plan, so every change is additive, reversible and approved first.

## Steps
1. **Write the SQL as a proposal**: `supabase/proposed/NNN_name.sql` (next number). Header comment must state: not applied, what problem (with evidence), what changes, what is NOT changed (no data deleted, grants/policies untouched or exactly which), dependencies, and the **reverse SQL**. Make it re-runnable (`create or replace`, `drop ... if exists`, `add column if not exists`).
2. **Test on an isolated database only** (`backend/tests_db`, pixeltable-pgserver; never the live project): add tests in `backend/tests_db/test_*.py` that fail without the migration. Cover: the bad write is refused, the good path still works (e.g. `complete_visit`), RLS per role (patient/staff/admin), direct writes by admin, and concurrency when the change is about races.
3. **Register in the verify script**: add the number to `PROPOSED_ORDER`, a post-flight check, a `ROLLBACK_EXPECT` entry in `backend/scripts/verify_proposed_sql.py`, and a `-- ROLLBACK NNN` block in `docs/STAGING_PLAN.md` section 6. Run `python scripts/verify_proposed_sql.py` (apply, re-apply, post-flight, rollback must print OK).
4. **Full regression**: `pytest backend` (both parts), `node --test tests/unit/*.test.js`, mocked Playwright. Client code must keep working before AND after the migration is applied (feature-detect or tolerate missing columns).
5. **Record state**: `supabase/proposed/APPLIED.md` (row "not applied"), `HANDOFF.md` (what remains to apply), README "Known limitations" when relevant.
6. **Stop and ask the owner** before touching the live database. Show the exact SQL, the project ref, what is replaced/dropped (never drop a table or data), and the backup/recovery situation. Do not run the same SQL through another tool if one was declined.
7. **After approval**: read-only pre-checks (existing violating data, migrations list, advisors baseline), apply ONE migration at a time with `apply_migration`, verify (catalog checks + `get_advisors`), stop on any failure, then copy the file to `supabase/migrations/` under the exact registered version name and update `APPLIED.md`.

## Never
Edit an already applied migration; weaken RLS; drop tables/columns that hold clinical data; put secrets in SQL; skip the isolated test because "it is only a view".
