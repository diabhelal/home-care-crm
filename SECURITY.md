# Security policy

This repository is a **demonstration / prototype** of a home-care booking CRM. It uses
**synthetic data only** and is **not** approved for real patients (see `docs/REVIEW.md`).

## Reporting a vulnerability
Please do not open a public issue for a security problem. Use GitHub's
**Security → Report a vulnerability** (private advisory) on this repository, or contact the owner directly.
Include steps to reproduce and the affected file/endpoint. You can expect an acknowledgement within a few days.

## Scope notes
- The publishable Supabase key in `public/config.js` is public by design; data access is enforced by RLS,
  column grants and database triggers (`supabase/migrations/`).
- No `service_role`/secret key must ever be committed. A pre-commit hook (`.githooks/pre-commit`, enable with
  `git config core.hooksPath .githooks`) and a CI secret scan guard this.
- The backend (`backend/`) verifies Supabase JWTs and never trusts identifiers sent by the client.
