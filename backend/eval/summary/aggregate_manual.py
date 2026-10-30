#!/usr/bin/env python3
"""Aggregates a HUMAN-filled manual_review.csv. Prints 'pending' for anything the reviewer has not filled in - never a made-up score.
Usage: python eval/summary/aggregate_manual.py results/<run>/manual_review.csv
Columns: supported_by_source(Y/N/P) per sentence, critical_error(Y/N), reviewer_role, clarity_1_5 and usefulness_1_5 (rubric_he_clarity.md; fill on the first sentence row of each case)."""
import csv, json, sys, statistics


def aggregate(path: str) -> dict:
    rows = list(csv.DictReader(open(path, encoding="utf-8-sig")))
    sup = [r["supported_by_source(Y/N/P)"].strip().upper() for r in rows if r["supported_by_source(Y/N/P)"].strip()]
    crit = [r["critical_error(Y/N)"].strip().upper() for r in rows if r["critical_error(Y/N)"].strip()]
    clar = [int(r["clarity_1_5"]) for r in rows if r["clarity_1_5"].strip().isdigit()]
    use = [int(r["usefulness_1_5"]) for r in rows if r["usefulness_1_5"].strip().isdigit()]
    roles = sorted({r["reviewer_role"].strip() for r in rows if r["reviewer_role"].strip()})
    out = {"sentences_in_file": len(rows), "sentences_annotated": len(sup), "reviewer_roles": roles or "pending (no reviewer role recorded)"}
    out["unsupported_claim_rate_manual"] = round(sum(s == "N" for s in sup) / len(sup), 3) if sup else "pending"
    out["partially_supported_rate_manual"] = round(sum(s == "P" for s in sup) / len(sup), 3) if sup else "pending"
    out["critical_error_sentences_manual"] = sum(c == "Y" for c in crit) if crit else "pending"
    out["hebrew_clarity_mean_1_5"] = round(statistics.mean(clar), 2) if clar else "pending"
    out["usefulness_mean_1_5"] = round(statistics.mean(use), 2) if use else "pending"
    return out


if __name__ == "__main__":
    print(json.dumps(aggregate(sys.argv[1]), ensure_ascii=False, indent=1))
