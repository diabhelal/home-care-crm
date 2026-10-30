# Evaluation of the AI visit-summary draft

**Status of results: see `results/`. A real-provider evaluation has NOT been run unless a `measured-real-provider` run folder exists.**
This evaluation does not establish clinical validity or readiness for real patients. Synthetic, fictional data only.

## What is evaluated
The draft produced by `POST /staff/visits/{id}/summary-draft` (prompt `visit-summary-he-v1`, `backend/app/summary.py`): a short Hebrew summary of ONE visit
from vitals (with units), procedures recorded as performed, and the nurse's raw notes. The same validation as the product is applied (shape, Hebrew,
length, every number must come from the source); a draft rejected by it counts as a failure, it is not hidden.

## Dataset (`cases.json`, v1.0, built by `build_cases.py`)
- 32 fictional Hebrew cases: **10 `dev`** (used to develop/tune the prompt) and **22 `heldout`** (final evaluation only).
- Edge cases: missing vitals, partial vitals, negation, sparse notes, conflicting information (form vs notes, form vs checkbox), decimals, numbers inside notes,
  0-like values, mixed Hebrew/English/abbreviations, symptoms reported by family, long notes, and instruction-like text inside the notes (prompt injection).
- Annotation per case: `required_facts` (regex alternatives; a fact is preserved when one matches), `forbidden` (must not be invented), `expect_warning`.
  Facts marked `critical` are those whose omission/inversion would materially misrepresent the visit.
- No identifiers: `build_cases.py` refuses notes that look like an id number, a phone number or an e-mail (a NAME cannot be detected automatically; the cases contain none by construction).
- **Held-out discipline:** do not tune the prompt using `heldout` results. If the prompt changes after a heldout run, record it in `results/heldout-log.md`, bump `PROMPT_VERSION`, and re-run; report both.

## Metrics
1. **Unsupported-claim rate**: AUTOMATIC PROXY = (forbidden-claim hits + out-of-source global patterns [normal/stable/well/diagnosis/recommendation/medication] + numbers not in the source) / sentences.
   The real rate comes from the human annotation (`supported_by_source` = N) via `aggregate_manual.py`. **Both are reported; the proxy is never presented as the real rate.**
2. **Required-fact recall**: preserved required facts / annotated required facts (regex match).
3. **Numerical accuracy**: numbers in drafts that exist in the source / all numbers in drafts. Required numeric facts are part of recall.
4. **Critical errors**: cases with a critical forbidden hit, an unsupported number, or a global proxy hit of normal/stable/well/diagnosis/medication; plus cases that miss a critical required fact.
5. **Hebrew clarity and usefulness**: human rubric (`rubric_he_clarity.md`), reviewer role recorded. **Pending until a human fills `manual_review.csv`.**
6. **Operational**: success rate (incl. drafts rejected by validation), latency mean/p50/p95, token usage and an estimated cost (only when a real provider ran).
An LLM judge is **not** used.

## Systems compared
- `baseline`: a deterministic non-LLM template (measurements + procedures + the notes quoted). Labelled baseline in every output; it is not the product.
- `anthropic`: the real provider, explicit run only (below).
- `mock`: harness self-test only; its numbers are meaningless and labelled so.

## Commands (from `backend/`)
```
python eval/summary/build_cases.py                                    # regenerate cases.json
python eval/summary/run_eval.py --system baseline --split all         # reproducible, no key
LLM_API_KEY=... python eval/summary/run_eval.py --system anthropic --split dev --confirm-real-provider
LLM_API_KEY=... python eval/summary/run_eval.py --system anthropic --split heldout --confirm-real-provider
python eval/summary/aggregate_manual.py results/<run>/manual_review.csv   # after a human filled the CSV
```
Each run folder has `run.json` (dataset version, model, prompt version, settings, date, commit), `outputs.jsonl` (every case, including failures), `metrics.json`, `report.md`
(failure examples), and `manual_review.csv`. Software tests (`pytest`) use mocks only and never call a provider.

## Running the REAL evaluation (budget-approved only)
Model: `claude-sonnet-5-5` (current id per https://platform.claude.com/docs/en/about-claude/models/overview; pricing $2 / $10 per million input / output tokens).
Set the key in your own terminal so it never appears in chat, Git or a file (zsh; in bash use `read -s -p "key: " LLM_API_KEY`):
```
cd backend && source .venv/bin/activate
read -s "LLM_API_KEY?Paste the key (hidden): " && export LLM_API_KEY
python eval/summary/run_eval.py --system anthropic --split dev --confirm-real-provider
# held-out set: only when the prompt is final (see "Held-out discipline")
python eval/summary/run_eval.py --system anthropic --split heldout --confirm-real-provider
unset LLM_API_KEY
```
Set a spend limit on the key/workspace in the Anthropic Console first. Do not put the key in `.env` for this, in shell history, or in a commit (`.env` is git-ignored but a typed `export KEY=...` line lands in history; `read -s` does not).
Cost: the 32 cases send about 20-40k input tokens in total (about $0.04-$0.08) and produce output that depends on the model's thinking: about $0.10 if ~300 output tokens per case, up to $0.64 at the 2000-token cap (`LLM_MAX_OUTPUT_TOKENS`, which also bounds thinking; raising it to 4000 doubles the worst case). **Expect about $0.15-$0.75 for one full pass; budget $2 to allow dev + heldout + one rerun.** The run prints `estimated_cost_usd` from the tokens the API reports.
Human review: open `results/<run>/manual_review.csv`, fill `supported_by_source`, `critical_error`, `reviewer_role` (e.g. "registered nurse") and the 1-5 scores per `rubric_he_clarity.md`, then `python eval/summary/aggregate_manual.py results/<run>/manual_review.csv`.

## Limitations
- Regex annotation under-counts paraphrases (recall may be understated) and cannot judge meaning: that is why a human review is required.
- 32 cases are small: confidence intervals are wide; results indicate trends, not guarantees. No claim of "zero hallucinations".
- Fictional notes are shorter and cleaner than real documentation; real-world performance is unknown.
- The input to the model is only the current visit (no history, no background); a different input contract needs a new evaluation.
