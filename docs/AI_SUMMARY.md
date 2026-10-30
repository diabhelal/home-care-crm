# AI visit-summary draft (opt-in)

**What it is.** A button in the visit-report form, "יצירת טיוטת סיכום AI", asks an LLM for a short Hebrew **draft** summary of the current visit. The nurse reviews it next to
her own notes, edits it, explicitly approves it, and completes the visit through the existing completion path. The draft is a suggestion, **not a verified clinical finding**.
**Synthetic data only in this phase. Nothing here is a privacy or clinical approval. No claim of clinical readiness.**

## Flow and guarantees
Browser → `POST /staff/visits/{booking_id}/summary-draft` (operational backend, JWT) → `app/summary.py` → `app/llm_provider.py` (Anthropic Messages API) → draft.

| Concern | How it is handled | Where |
|---|---|---|
| Disabled by default | `SUMMARY_ENABLED=false` (server) and `window.AI_SUMMARY_ENABLED=false` (`public/config.js`); the button is hidden, the endpoint answers 503 | `config.py`, `main.py`, `ai-summary.js` |
| Authentication / authorization | verified Supabase JWT; assigned nurse of THAT booking or an admin; booking must be approved and scheduled; ids in the body are ignored | `main.py`, `service.booking_for_summary` |
| Secrets | `LLM_API_KEY` and `SUMMARY_SIGNING_SECRET` only in server env; never logged or returned; provider error bodies are never surfaced | `llm_provider.py` |
| Input | current visit only: vitals with units, procedures **recorded as performed**, raw notes (≤2000 chars), booking time. Missing ≠ 0; an unchecked procedure is *not recorded* (never "not performed"). No name/id/address/phone/signature/history | `summary.py` |
| Identifiers in free text | ids (9 digits), phones, e-mails and long digit runs are refused (400) before any provider call. **A person's name cannot be detected**; the UI tells staff not to type names | `summary.find_identifiers` |
| Prompt injection | notes are sent inside one JSON field `staff_notes_untrusted`; the system prompt says to summarize them as data and never follow them | `SYSTEM_PROMPT` |
| Output | structured output (`output_config.format` JSON schema), then validated: shape, Hebrew, length, and **every number must come from the source** (otherwise 422, draft discarded) | `validate_draft` |
| Limits | rate limit per user (default 6/min), one in-flight request per user, bounded timeout and output tokens, **no automatic retries** | `SummaryLimiter`, `AnthropicProvider` |
| Logging | only generation id, status, latency, token counts. Never notes, drafts, keys, tokens | `log = logging.getLogger("summary")`, tested |
| Saving | generation **saves nothing and changes no booking**. Final text goes through `/staff/visits/{id}/complete` | `main.py` |
| UI | editable, labelled "טיוטה שלא אושרה"; original notes never overwritten; approval needed before save; any change to vitals/procedures/notes or to the draft invalidates approval; late responses ignored; no duplicate requests; regeneration never replaces edits without explicit confirmation; no persistent browser storage for drafts; manual completion always available | `public/js/shared/ai-summary.js` |
| Provenance | the server signs a token (generation id, user, booking, source fingerprint, draft hash, model, prompt version). On completion it is verified (forged/other user/other booking → 422, changed source → 409) and `ai_assisted/ai_edited/ai_model/ai_prompt_version/ai_generation_id` are stored. The **approver and time are set by the database** | `summary.verify_generation`, migration 014 |

Where the data comes from: vitals, procedures and notes are **unsaved form data** typed by the nurse; the visit time is the saved booking. The final human-approved text is stored in
`treatment_summary` (unchanged column); the original notes in `source_notes`.

## What is stored WITHOUT migration 014, and what needs it
| | Without 014 (current live database) | With 014 applied |
|---|---|---|
| Draft generation | **refused (503 `summary_db_not_ready`)** unless `SUMMARY_DB_PROVENANCE_READY=true` | works |
| Final human-approved summary | `treatment_summary` (existing column) | `treatment_summary` |
| The nurse's ORIGINAL notes (the draft's source) | **not stored** (the old `complete_visit` ignores the key) | `source_notes` |
| AI-assisted flag, edited-after-draft flag, model, prompt version, generation id | **not stored** | stored |
| Approver and approval time | **not stored** | set by the database |
| Manual documentation | works exactly as before | works exactly as before |

Because the original notes would be lost, the feature **fails closed**: the endpoint and an AI-approved completion are refused until `SUMMARY_DB_PROVENANCE_READY=true`, which must only be set after 014 is applied (needs the owner's approval; not done).

## Provenance needs migration 014 (NOT applied to the live database)
`supabase/proposed/014_visit_report_ai_provenance.sql` adds the columns and extends `complete_visit`. Without it the visit is still saved, but provenance is not; the API answers
`ai_provenance_saved: false` and the UI warns. The audit trail that exists is the existing `audit_log` trigger on `visit_reports` (it captures these columns once they exist). Tested on an isolated
Postgres only (`backend/tests_db/test_visit_report_ai_provenance.py`).

## Offline behaviour
Draft generation needs the network. Completing a visit offline works as before; if the nurse had approved a draft, the final report payload (final summary, source notes, signed token) rides in the existing
offline queue like any report. The draft itself is never stored. The token lives 7 days by default.

## Enable it (academic demo, synthetic data only)
1. Server env (`backend/.env`, never committed): `SUMMARY_ENABLED=true`, `SUMMARY_DB_PROVENANCE_READY=true` (only after 014), `LLM_API_KEY=...`, `SUMMARY_SIGNING_SECRET=<>=32 random chars>`, optional `LLM_MODEL` (default `claude-sonnet-5-5`; current ids: https://platform.claude.com/docs/en/about-claude/models/overview), `LLM_TEMPERATURE=0` if the model accepts it.
2. `public/config.js`: `window.AI_SUMMARY_ENABLED = true;`
3. Apply migration 014 (needs the owner's approval; not done), then set `SUMMARY_DB_PROVENANCE_READY=true`. Without it the feature refuses to run.
The endpoint calls the provider only when all of this is configured and fails closed (503) otherwise. If the model is unavailable the UI says so and never substitutes a template labelled as AI.

## Tests (software) vs evaluation (measurement) vs validation
- **Software tests (mocks only, no key, no cost):** `backend/tests/test_summary.py`, `test_llm_provider.py`, `test_summary_eval.py`, `backend/tests_db/test_visit_report_ai_provenance.py`, `tests/e2e/ai-summary.spec.js`.
- **Evaluation:** `backend/eval/summary/` (32 fictional Hebrew cases, dev/heldout, baseline). The deterministic baseline was measured; the **real-LLM evaluation is pending** (needs a key and an explicit run).
- **Clinical validation:** not established by anything here.

## Limitations
No guarantee against hallucination (mitigated by constrained input, validation, human review). The number check cannot judge words (a wrong word with correct numbers passes validation, hence the mandatory review).
In-process rate limiter (one backend process). Names in free text are not detectable. English-language models may phrase Hebrew inconsistently; the evaluation is the place to measure that.
