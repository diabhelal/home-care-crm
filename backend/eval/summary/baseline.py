"""NON-LLM baseline (deterministic template). Labelled 'baseline' everywhere it is reported; it is NOT the AI feature."""
from __future__ import annotations

from app.summary import PROCEDURE_LABELS, VITAL_META


def baseline_draft(src: dict) -> dict:
    parts = []
    vit = [f"{VITAL_META[k][0]} {v} {VITAL_META[k][1]}" for k, v in src["vitals"].items() if v is not None and k in VITAL_META]
    parts.append("מדדים שנמדדו בביקור: " + ", ".join(vit) + "." if vit else "לא הוזנו מדדים בביקור.")
    procs = [PROCEDURE_LABELS[k] for k in src["procedures"] if k in PROCEDURE_LABELS]
    parts.append("פעולות שתועדו כמבוצעות: " + ", ".join(procs) + "." if procs else "לא תועדו פעולות שבוצעו.")
    parts.append('לפי הערות הצוות: "' + src["notes"].strip() + '"')
    return {"draft_text": " ".join(parts), "warnings": []}
