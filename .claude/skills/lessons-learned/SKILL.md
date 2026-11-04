---
name: lessons-learned
description: Use after a confirmed, significant or recurring defect or incident in home-care-crm to produce a structured root-cause analysis, a regression-test proposal and, only if reusable and verified, a proposed engineering rule. Never edits CLAUDE.md or other permanent instructions by itself.
---

# Root-cause analysis and lessons learned

Use for a defect that was reproduced (or an incident with evidence). Do not use it for guesses or one-off typos. Keep hypotheses and confirmed causes apart.

## Record (one block per defect; put it in the report or in `docs/`, not in CLAUDE.md)
1. **Symptom**: what the user or test saw, with the exact error text.
2. **Triggering conditions** and the minimal reproduction.
3. **Root cause**: confirmed (how it was confirmed) or hypothesis (what would confirm it).
4. **Affected components** (files, tables, roles) and, if relevant, how long it existed and since which commit.
5. **Classification**: P0 security/privacy/clinical-data integrity; P1 backend/booking/DB consistency; P2 analytics/AI; P3 mobile/accessibility/workflow; P4 visual. Also: new defect vs recurring.
6. **Proposed correction** (smallest change) - a proposal, not a silent fix.
7. **Regression test**: which file, which assertion fails without the fix (unit in `tests/unit/`, Playwright mocked spec in `tests/e2e/`, backend test, or `backend/tests_db`). Never a test that writes to the live project.
8. **Verification evidence** after the fix (real test output) and **remaining risk**.

## Proposing a reusable rule
Only when the cause is confirmed and the rule is general. Write it as a short proposal (rule, why, how to check) for the owner to accept. Do not append to `CLAUDE.md`, skills or agents without the owner's explicit approval, and do not accumulate one-off rules. No process guarantees a defect cannot recur; the regression test is the real protection.

## Recurring-defect check
Search for the same pattern elsewhere (grep the call sites) and list them; report, do not fix them unprompted.
