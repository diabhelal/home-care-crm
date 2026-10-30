"""Scoring for the visit-summary evaluation. Pure functions, no network.

AUTOMATIC metrics here are partly regex-based proxies. They do NOT replace human annotation: the unsupported-claim rate and the Hebrew
clarity/usefulness must be confirmed by a human reviewer (manual_review.csv + aggregate_manual.py). An LLM is never used as a judge.
"""
from __future__ import annotations

import re
import statistics
from typing import Optional

from app.summary import SourceVisit, allowed_numbers

_NUM = re.compile(r"\d+(?:[.,]\d+)?")
# Patterns that signal an UNSUPPORTED claim when the draft makes them and the source never says them (checked against the source notes).
GLOBAL_PROXY = {
    "claims_normal": re.compile(r"תקין|תקינים|נורמלי"),
    "claims_stable": re.compile(r"יציב"),
    "claims_well": re.compile(r"מרגיש[ה]?\s+טוב|בריא|מצב\s+טוב|מצוין"),
    "diagnosis": re.compile(r"אבחנה|מאובחנ|סובל[ת]?\s+מ|סוכרת|יתר\s+לחץ\s+דם|זיהום|דלקת"),
    "recommendation": re.compile(r"מומלץ|יש\s+לעקוב|כדאי\s+ל|להמשיך\s+מעקב|יש\s+להמשיך"),
    "medication": re.compile(r"אקמול|אספירין|אנטיביוטי|אינסולין|\d+\s*(מ\"ג|מ״ג)"),
}


def fact_hit(text: str, fact: dict) -> bool:
    return any(re.search(rx, text, re.S) for rx in fact["any_of"])


def sentences(text: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+|\n+", text) if p.strip()]
    return parts


def score_case(case: dict, text: str, warnings: Optional[list[str]] = None) -> dict:
    src = case["source"]
    sv = SourceVisit(vitals={k: v for k, v in src["vitals"].items() if v is not None}, procedures=tuple(src["procedures"]), notes=src["notes"], visit_time=src.get("visit_time"))
    allowed = allowed_numbers(sv)
    req = case["required_facts"]
    hits = [f for f in req if fact_hit(text, f)]
    missing = [f["id"] for f in req if f not in hits]
    nums = [n.replace(",", ".") for n in _NUM.findall(text)]
    bad_nums = [n for n in nums if n not in allowed and n.lstrip("0") not in allowed]
    forb = [{"id": x["id"], "critical": x["critical"]} for x in case["forbidden"] if fact_hit(text, x)]
    glob = [name for name, rx in GLOBAL_PROXY.items() if rx.search(text) and not rx.search(src["notes"])]
    # a global hit already covered by an explicit forbidden hit is not double counted below
    crit_missing = [f["id"] for f in req if f.get("critical") and f["id"] in missing]
    critical = bool(bad_nums) or any(x["critical"] for x in forb) or bool(glob and {"claims_normal", "claims_stable", "claims_well", "diagnosis", "medication"} & set(glob))
    warn_ok = None
    if case.get("expect_warning"):
        warn_ok = bool(warnings) and any(len(w) > 0 for w in warnings)
    return {
        "required_total": len(req), "required_hit": len(hits), "missing": missing, "critical_missing": crit_missing,
        "numbers_total": len(nums), "numbers_supported": len(nums) - len(bad_nums), "unsupported_numbers": bad_nums,
        "forbidden_hits": forb, "global_proxy_hits": glob, "sentences": len(sentences(text)),
        "critical_error": critical, "warning_expected": bool(case.get("expect_warning")), "warning_present": warn_ok,
    }


def aggregate(rows: list[dict]) -> dict:
    """rows: [{'score': score_case(...)|None, 'ok': bool, 'latency_ms': float|None, 'input_tokens':.., 'output_tokens':.., 'error': str|None}]"""
    scored = [r for r in rows if r.get("score")]
    rt = sum(r["score"]["required_total"] for r in scored); rh = sum(r["score"]["required_hit"] for r in scored)
    nt = sum(r["score"]["numbers_total"] for r in scored); ns = sum(r["score"]["numbers_supported"] for r in scored)
    sent = sum(r["score"]["sentences"] for r in scored)
    unsup = sum(len(r["score"]["forbidden_hits"]) + len(r["score"]["global_proxy_hits"]) + len(r["score"]["unsupported_numbers"]) for r in scored)
    expect_w = [r for r in scored if r["score"]["warning_expected"]]
    lat = [r["latency_ms"] for r in rows if r.get("latency_ms") is not None]
    it = [r["input_tokens"] for r in rows if r.get("input_tokens") is not None]
    ot = [r["output_tokens"] for r in rows if r.get("output_tokens") is not None]
    def pct(v, p): return round(sorted(v)[min(len(v) - 1, int(len(v) * p))], 1) if v else None
    return {
        "cases_total": len(rows), "cases_with_a_draft": len(scored), "cases_failed": len(rows) - len(scored),
        "success_rate": round(len(scored) / len(rows), 3) if rows else None,
        "required_fact_recall": round(rh / rt, 3) if rt else None, "required_facts": f"{rh}/{rt}",
        "numerical_accuracy": round(ns / nt, 3) if nt else None, "numbers_in_drafts": f"{ns}/{nt}",
        "unsupported_claim_rate_PROXY": round(unsup / sent, 3) if sent else None, "unsupported_signals": unsup, "sentences": sent,
        "critical_error_cases": sum(r["score"]["critical_error"] for r in scored),
        "critical_error_case_rate": round(sum(r["score"]["critical_error"] for r in scored) / len(scored), 3) if scored else None,
        "critical_missing_fact_cases": sum(bool(r["score"]["critical_missing"]) for r in scored),
        "warning_recall_on_expected": (round(sum(bool(r["score"]["warning_present"]) for r in expect_w) / len(expect_w), 3) if expect_w else None),
        "latency_ms_mean": round(statistics.mean(lat), 1) if lat else None, "latency_ms_p50": pct(lat, 0.5), "latency_ms_p95": pct(lat, 0.95),
        "input_tokens_total": sum(it) if it else None, "output_tokens_total": sum(ot) if ot else None,
        "failures_by_code": {c: sum(1 for r in rows if r.get("error") == c) for c in sorted({r["error"] for r in rows if r.get("error")})},
    }
