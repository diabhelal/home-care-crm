---
name: clinical-safety-review
description: Use when a change touches visit reports, vital signs, the red/yellow/green risk status, alerts, patient records, archive/export, or user-facing medical wording in home-care-crm. A checklist that protects record integrity, privacy and honest claims.
---

# Clinical safety and record-integrity review

This is a prototype with synthetic data, not a medical device. Review as if real patients were affected.

## Record integrity (medical-record rules)
- A completed visit report is **never edited or deleted**. Corrections are new append-only amendments pointing at the original; the original stays visible next to the corrected value.
- New measurements **append**; nothing overwrites an older one. History is ordered by time and shows change versus the previous value.
- Patients and staff are **archived, never deleted**. A full-record export is administrator-only and always writes an append-only access log (who, when, for whom, on what basis).
- Authorship, time and role are set by the server (triggers), never trusted from the client.
- Deleting a staff member must not cascade away history (deactivate with `is_active=false` instead).

## Risk status (traffic light)
- Thresholds and rules live only in `predictive-service`; the browser and the backend do **not** re-implement them. The UI may show arithmetic (delta, age) but not a clinical classification.
- RED = dangerous value (e.g. critical pulse), YELLOW = borderline, GREEN = normal, and the latest status is always shown **with its age**; older than 24 h is labelled outdated; a newer report without an assessment is flagged. A red must never silently disappear, an old green must not look current.
- It is rule-based, labelled "demo / decision support", not a diagnosis. No trained ML exists; do not claim otherwise.

## Privacy and security
- No real data, secrets or `.env` in git. Public repo.
- Patients must not see internal staff allocation or dispatch data unless a product decision says so. Minimal exposure of medical data; RLS per role; no `anon` access.
- Browser storage is not encryption: offline drafts are separated per user only logically.
- Do not claim legal compliance (retention period, grounds for disclosure) - those are legal decisions.

## UX honesty
- Never show "saved" unless the write really succeeded (storage failure and server failure must be visible).
- Hebrew/RTL first, Arabic and English kept in sync; touch targets 44px; errors state what happened and what to do.
