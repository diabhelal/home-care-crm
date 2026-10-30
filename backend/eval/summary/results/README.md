# Results

| Run | System | Status | Notes |
|---|---|---|---|
| `20261030T214729Z-baseline-all` | non-LLM template baseline | **measured (deterministic baseline, not an LLM)** | recall is 100% because the template quotes the staff notes verbatim; the 3 critical-error cases are notes with instruction-like text that the baseline copies; it never emits a warning. It shows what a trivial system scores, nothing about the AI feature. |
| (none) | LLM (`anthropic`) | **PENDING: not run** | needs `LLM_API_KEY` and an explicit `--confirm-real-provider` run (dev first, heldout last). No LLM result is reported anywhere in this repository. |

Human review (Hebrew clarity/usefulness, real unsupported-claim rate): **PENDING**, see `../README.md`.
`heldout-log.md` is created by the first real heldout run and lists every prompt version evaluated on the held-out set.
