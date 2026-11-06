# Home Care CRM agent team

This document describes how to work with the agents in `.claude/agents/`. It is a working tool, not a substitute for tests, human medical review, or penetration testing. An AI agent does not guarantee defect-free code.

## Hierarchy
| Tier | Role | Who |
|---|---|---|
| 0 | Owner (final authority: requirements, merges, database, deployment) | you |
| 1 | Orchestrator: classifies risk, picks the minimum set of specialists, collects reports | the main Claude Code session (no agent file) |
| 2A | Specialist team | `security-privacy` (read-only), `backend-database`, `clinical-ai` (read-only); Frontend/UX: `frontend-design-integrator` (implements), `clinical-ux-accessibility-lead` (accessibility and flows); QA/Sentinel: `qa-regression-debugger` |
| 2B | Independent review board (read-only) | `audit-security`, `audit-reliability`, `medical-records-reviewer` (clinical safety) |
| 3 | Risk management and learning | skill `lessons-learned` |
| Gate | Human approval for implementation, merge, database change and deployment | you |

## Activation by risk
- **P0** security, privacy, patient safety, record integrity. **P1** backend, bookings, database consistency. **P2** analytics and AI. **P3** mobile, accessibility, flows. **P4** visual design.
- **Low:** one specialist plus a focused check. **Medium:** specialists, QA and one relevant reviewer. **High** (clinical records, RLS, authentication, migrations, clinical AI, sensitive offline storage): specialists, QA, all three reviewers, and your explicit approval.
- The orchestrator runs the reviewers separately, without passing one reviewer's findings to another, and shows their reports as they are before any summary. The orchestrator's summary is not an additional independent review.
- Agents do not launch other agents (`Agent` is blocked in every agent's configuration).

## Flow
Request → risk classification → specialists → implementation proposal → **your approval** → implementation on a `feature/*` branch → automated tests → risk-based review → report → **your release approval**. The orchestrator does not approve its own implementation.

## Review decisions
PASS · PASS WITH CONDITIONS · CHANGES REQUIRED · BLOCK. A BLOCK requires a fix and a repeat review before the change counts as approved.

## Sentinel
A role on demand, not a background process. `qa-regression-debugger` runs mocked tests, checks console and network errors, buttons and forms, synchronization and error messages, and reports with evidence without fixing code. It writes regression tests only when the task explicitly allows it. CI is what runs continuously.

## Permissions (enforced technically, not only in wording)
- Every agent defines `tools` or `disallowedTools`. All agents are blocked from `Agent` and from the Supabase MCP. Reviewers have `Read, Grep, Glob` only.
- `.claude/settings.json` (shared): `ask` for `apply_migration`, `execute_sql`, `deploy_edge_function`, `create_edge_function_secret`, `merge_branch`, `reset_branch`, `delete_branch`; `deny` for `create_project`, `pause_project`, `restore_project`.
- `ask` is not a block: approving `execute_sql` with one click can perform a write, because one tool serves both reads and writes. The current plan has no automatic Supabase backup, so every change to the live database goes through `db-migration-workflow` and your approval.

## Limitations
- The reviewers are the same model; their independence comes from instructions, tools and separate context.
- Every agent run costs tokens in a separate context. A high-risk review (3 reviewers + QA) costs several times a single conversation.
- `.codex/` mirrors the older agents and is not synchronized with the changes here. Open decision: whether to maintain it.
- `docs/` describes structure; the source of truth for permissions is the configuration files.

## Lessons learned
For a significant, proven failure: skill `lessons-learned`. New permanent rules are proposed to you only; `CLAUDE.md` is never updated automatically.

## Removed agents
Four older design agents (`medical-design-director`, `medical-color-specialist`, `medical-brand-content-designer`, `interaction-controls-designer`) were removed from the project because current work is about stability and security, not redesign (`clinical-ux-accessibility-lead` remains for accessibility). They remain in Git history and any one can be restored with `git checkout <commit-before-removal> -- .claude/agents/<name>.md`. Their Codex copies in `.codex/agents/` were left unchanged.
