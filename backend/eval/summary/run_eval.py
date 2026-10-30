#!/usr/bin/env python3
"""Reproducible evaluation of the visit-summary draft. Run from backend/:

  python eval/summary/run_eval.py --system baseline --split all           # non-LLM baseline (deterministic)
  python eval/summary/run_eval.py --system mock --split dev                # harness self-test only (NOT a result)
  LLM_API_KEY=... python eval/summary/run_eval.py --system anthropic --split dev  --confirm-real-provider
  LLM_API_KEY=... python eval/summary/run_eval.py --system anthropic --split heldout --confirm-real-provider   # final evaluation

Real-provider runs are explicit (flag + key), send ONLY the fictional dataset, call the provider once per case (no retries) and record
model, prompt version and settings. Nothing is ever reported as measured unless it was measured here. Ordinary CI never runs the real provider.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))          # backend/
sys.path.insert(0, str(HERE))

from app.llm_provider import AnthropicProvider, FakeSummaryProvider, ProviderError   # noqa: E402
from app.summary import OUTPUT_SCHEMA, PROMPT_VERSION, SYSTEM_PROMPT, SummaryDraftIn, build_source, user_message, validate_draft   # noqa: E402
from app.errors import DomainError   # noqa: E402
from baseline import baseline_draft   # noqa: E402
from metrics import aggregate, score_case, sentences   # noqa: E402

PRICE_PER_MTOK = {"claude-sonnet-5-5": (2.0, 10.0)}   # input/output USD per 1M tokens (https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-10-30)


def load_cases(split: str, path: Path | None = None) -> tuple[dict, list[dict]]:
    ds = json.loads((path or HERE / "cases.json").read_text(encoding="utf8"))
    assert ds.get("synthetic") is True, "refusing to run: dataset is not marked synthetic"
    cases = [c for c in ds["cases"] if split == "all" or c["split"] == split]
    return ds, cases


def body_from_case(c: dict) -> SummaryDraftIn:
    s = c["source"]
    return SummaryDraftIn(**{**{k: v for k, v in s["vitals"].items() if v is not None}, **{p: True for p in s["procedures"]}, "notes": s["notes"]})


async def run_case(system: str, provider, c: dict, max_chars: int) -> dict:
    row = {"case_id": c["id"], "split": c["split"], "tags": c["tags"], "ok": False, "error": None, "draft_text": None, "warnings": [],
           "latency_ms": None, "input_tokens": None, "output_tokens": None, "score": None}
    t0 = time.monotonic()
    try:
        if system == "baseline":
            out = baseline_draft(c["source"]); text, warns = out["draft_text"], out["warnings"]
        else:
            src = build_source(body_from_case(c), None, "Asia/Jerusalem")
            res = await provider.generate(SYSTEM_PROMPT, user_message(src), OUTPUT_SCHEMA)
            row["input_tokens"], row["output_tokens"] = res.input_tokens, res.output_tokens
            text, warns = validate_draft(res.text, src, max_chars)
        row["latency_ms"] = round((time.monotonic() - t0) * 1000, 1)
        row.update(ok=True, draft_text=text, warnings=warns, score=score_case(c, text, warns))
    except ProviderError as e:
        row["error"] = f"provider_{e.code}"
    except DomainError as e:                       # the draft was rejected by the SAME validation the product uses: counted as a failure, not hidden
        row["error"] = e.code
    row["latency_ms"] = row["latency_ms"] or round((time.monotonic() - t0) * 1000, 1)
    return row


def git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=HERE, text=True).strip()
    except Exception:
        return "unknown"


def write_results(out_dir: Path, meta: dict, rows: list[dict], metrics: dict, cases: list[dict]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "run.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf8")
    (out_dir / "outputs.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf8")
    (out_dir / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=1), encoding="utf8")
    with open(out_dir / "manual_review.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["case_id", "system", "sentence_no", "sentence", "supported_by_source(Y/N/P)", "critical_error(Y/N)", "reviewer_role", "notes",
                    "clarity_1_5", "usefulness_1_5"])
        for r in rows:
            if r["draft_text"]:
                for i, s in enumerate(sentences(r["draft_text"]), 1):
                    w.writerow([r["case_id"], meta["system"], i, s, "", "", "", "", "", ""])
    fails = [r for r in rows if r["score"] and (r["score"]["critical_error"] or r["score"]["missing"] or r["score"]["forbidden_hits"])]
    md = [f"# Run {meta['run_id']}", "", f"- status: **{meta['results_status']}**", f"- system: {meta['system']} · model: {meta.get('model')} · prompt: {meta['prompt_version']} · dataset: v{meta['dataset_version']} ({meta['split']}, {len(cases)} cases)",
          f"- date (UTC): {meta['date_utc']} · commit: {meta['git_commit']}", "", "## Aggregate (automatic; proxies are marked)", ""]
    md += [f"- {k}: {v}" for k, v in metrics.items()]
    md += ["", "## Not measured here", "", "- Hebrew clarity/usefulness and the real unsupported-claim rate need the human review in `manual_review.csv` (see README). Until then they are **pending**.",
           "- Clinical validity is NOT established by this evaluation.", "", f"## Cases with a critical error, a missed required fact or a forbidden claim ({len(fails)})", ""]
    for r in fails:
        sc = r["score"]
        md += [f"### {r['case_id']} ({', '.join(r['tags'])})", f"- missing: {sc['missing']} · forbidden: {sc['forbidden_hits']} · proxy: {sc['global_proxy_hits']} · unsupported numbers: {sc['unsupported_numbers']}", f"- draft: {r['draft_text']}", ""]
    for r in rows:
        if r["error"]:
            md.append(f"- FAILED {r['case_id']}: {r['error']}")
    (out_dir / "report.md").write_text("\n".join(md) + "\n", encoding="utf8")


def main(argv=None, out_root: Path | None = None) -> Path:
    ap = argparse.ArgumentParser()
    ap.add_argument("--system", choices=["baseline", "mock", "anthropic"], required=True)
    ap.add_argument("--split", choices=["dev", "heldout", "all"], default="dev")
    ap.add_argument("--confirm-real-provider", action="store_true")
    ap.add_argument("--max-cases", type=int, default=0)
    ap.add_argument("--sleep", type=float, default=1.0, help="seconds between real provider calls")
    ap.add_argument("--cases", type=Path, default=None)
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args(argv)
    ds, cases = load_cases(a.split, a.cases)
    if a.max_cases:
        cases = cases[: a.max_cases]
    model, status, provider = None, "", None
    settings = {"temperature": os.environ.get("LLM_TEMPERATURE") or None, "max_output_tokens": int(os.environ.get("LLM_MAX_OUTPUT_TOKENS", 2000)),
                "timeout_s": float(os.environ.get("LLM_TIMEOUT_SECONDS", 25)), "retries": 0}
    if a.system == "anthropic":
        key = os.environ.get("LLM_API_KEY", "")
        if not a.confirm_real_provider or not key:
            raise SystemExit("real provider run refused: pass --confirm-real-provider and set LLM_API_KEY (synthetic dataset only)")
        model = os.environ.get("LLM_MODEL", "claude-sonnet-5-5")
        provider = AnthropicProvider(key, model, settings["timeout_s"], settings["max_output_tokens"],
                                     float(settings["temperature"]) if settings["temperature"] else None)
        status = "measured-real-provider"
    elif a.system == "mock":
        provider = FakeSummaryProvider(lambda s, u: {"draft_text": "סיכום בדיקה: ביקור התקיים.", "warnings": []})
        model, status = "fake-model", "mock-harness-test-only (NOT a result)"
    else:
        status = "baseline-deterministic (not an LLM)"

    async def go():
        rows = []
        for i, c in enumerate(cases):
            rows.append(await run_case(a.system, provider, c, 1500))
            if a.system == "anthropic" and i < len(cases) - 1:
                await asyncio.sleep(a.sleep)
        return rows
    rows = asyncio.run(go())
    metrics = aggregate(rows)
    if a.system == "anthropic" and metrics["input_tokens_total"] is not None and model in PRICE_PER_MTOK:
        pi, po = PRICE_PER_MTOK[model]
        metrics["estimated_cost_usd"] = round(metrics["input_tokens_total"] / 1e6 * pi + (metrics["output_tokens_total"] or 0) / 1e6 * po, 4)
    now = dt.datetime.now(dt.timezone.utc)
    run_id = f"{now.strftime('%Y%m%dT%H%M%SZ')}-{a.system}-{a.split}"
    meta = {"run_id": run_id, "results_status": status, "system": a.system, "model": model, "prompt_version": PROMPT_VERSION, "dataset_version": ds["dataset_version"],
            "split": a.split, "n_cases": len(cases), "date_utc": now.isoformat(timespec="seconds"), "git_commit": git_commit(), "settings": settings,
            "note": "Automatic metrics only; human review pending. Clinical validation not established."}
    out_dir = (a.out or (out_root or HERE / "results")) / run_id if not a.out else a.out
    write_results(out_dir, meta, rows, metrics, cases)
    if a.split in ("heldout", "all") and a.system in ("anthropic",):
        with open((out_root or HERE / "results") / "heldout-log.md", "a", encoding="utf8") as f:
            f.write(f"- {meta['date_utc']} · {a.system} · model {model} · prompt {PROMPT_VERSION} · split {a.split} · run {run_id}\n")
    print(f"{status}: {len(cases)} cases -> {out_dir}")
    print(json.dumps(metrics, ensure_ascii=False, indent=1))
    return out_dir


if __name__ == "__main__":
    main()
