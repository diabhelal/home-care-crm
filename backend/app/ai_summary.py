"""LLM visit-summary DRAFT (FR-AI-02). Display only: nothing here writes to the database.

Rules (docs/SPECIFICATION.md FR-AI-02):
- off by default: active only when AI_SUMMARY_ENABLED is on AND OPENAI_API_KEY is set;
- only the assigned staff member of the report's booking, or an admin;
- only the current visit's clinical fields are sent: no name, national ID, address, phone,
  patient_id, staff_id or signature; phone/ID-like numbers and e-mails in the free text are removed;
- every number in the draft must appear in the data that was sent, otherwise the draft is rejected;
- the draft is returned to the screen for human review and is never stored.
Logs carry status codes only: never the prompt, the draft, clinical values or the key.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Callable, Optional, Protocol

import httpx

from .errors import DomainError, forbidden, not_found
from .models import Identity, Staff

log = logging.getLogger("app.ai_summary")

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
MAX_OUTPUT_TOKENS = 500

VITALS = ("systolic_bp", "diastolic_bp", "blood_sugar", "pulse", "temperature", "oxygen_saturation")
PERFORMED = ("performed_blood_draw", "performed_injection", "performed_infusion",
             "performed_dressing_change", "performed_catheter_change")

VITAL_LABELS = {"systolic_bp": "לחץ דם סיסטולי", "diastolic_bp": "לחץ דם דיאסטולי",
                "blood_sugar": "סוכר בדם", "pulse": "דופק", "temperature": "חום",
                "oxygen_saturation": "סטורציה"}
PERFORMED_LABELS = {"performed_blood_draw": "לקיחת דם", "performed_injection": "זריקה",
                    "performed_infusion": "עירוי", "performed_dressing_change": "החלפת חבישה",
                    "performed_catheter_change": "החלפת קטטר"}

SYSTEM_PROMPT = (
    "אתה עוזר תיעוד לאחות בטיפול בית. כתוב טיוטת סיכום קצרה בעברית (3-5 משפטים) של ביקור אחד, "
    "רק מהנתונים שנמסרו. אל תוסיף אבחנה, המלצת טיפול, תרופה או מידע שלא נמסר. "
    "אל תכתוב שום מספר שאינו מופיע בנתונים (גם לא מספור רשימה או יחידות זמן). "
    "אם מדד חסר, אל תזכיר אותו. זו טיוטה לבדיקה אנושית ולא מסמך רפואי."
)

UNAVAILABLE_MSG = "שירות סיכום ה-AI אינו זמין כרגע, אנא נסה שוב מאוחר יותר"
UNVERIFIED_MSG = "הטיוטה שנוצרה כללה נתון שלא הופיע בדוח ולכן נפסלה. אפשר לנסות שוב"

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_LONG_DIGITS = re.compile(r"\+?\d[\d\s\-]{5,}\d")    # phone / national-ID shaped runs
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


class AIUnavailable(Exception):
    """Any failure talking to the LLM provider. Carries no provider text."""


class SummaryClient(Protocol):
    model: str

    def complete(self, system: str, user: str) -> str: ...


class OpenAISummaryClient:
    def __init__(self, api_key: str, model: str, timeout: float = 20.0,
                 transport: Optional[httpx.BaseTransport] = None, url: str = OPENAI_URL):
        self.model, self._url = model, url
        self._client = httpx.Client(timeout=timeout, transport=transport,
                                    headers={"Authorization": f"Bearer {api_key}"})

    def complete(self, system: str, user: str) -> str:
        body = {"model": self.model, "store": False, "max_completion_tokens": MAX_OUTPUT_TOKENS,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        try:
            r = self._client.post(self._url, json=body)
        except httpx.HTTPError as e:
            log.warning("ai summary provider unreachable: %s", type(e).__name__)
            raise AIUnavailable() from None
        if r.status_code >= 400:
            log.warning("ai summary provider status=%s", r.status_code)
            raise AIUnavailable()
        try:
            text = r.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            log.warning("ai summary provider: unexpected response shape")
            raise AIUnavailable() from None
        if not isinstance(text, str) or not text.strip():
            log.warning("ai summary provider: empty draft")
            raise AIUnavailable()
        return text.strip()


def redact_free_text(text: Optional[str]) -> str:
    if not text:
        return ""
    text = _EMAIL.sub("[הוסר]", text)
    return _LONG_DIGITS.sub(lambda m: "[הוסר]" if len(re.sub(r"\D", "", m.group())) >= 7 else m.group(), text)


def _fmt(v) -> str:
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def build_user_message(report: dict) -> str:
    """The ONLY data sent to the provider. Whitelisted fields; identifiers never included."""
    lines = []
    vd = str(report.get("visit_date") or "")[:10]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", vd):
        y, m, d = vd.split("-")
        lines.append(f"תאריך הביקור: {d}.{m}.{y}")
    vitals = [f"- {VITAL_LABELS[k]}: {_fmt(report[k])}" for k in VITALS if report.get(k) is not None]
    lines.append("מדדים שנמדדו:" if vitals else "לא נמדדו מדדים.")
    lines.extend(vitals)
    done = [PERFORMED_LABELS[k] for k in PERFORMED if report.get(k)]
    lines.append("פעולות שבוצעו: " + (", ".join(done) if done else "לא סומנו פעולות"))
    note = redact_free_text(report.get("treatment_summary"))
    if note:
        lines.append(f"הערת המטפל: {note}")
    return "\n".join(lines)


def _norm(n: str) -> str:
    n = n.replace(",", ".")
    if "." in n:
        n = n.rstrip("0").rstrip(".")
    return n.lstrip("0") or "0"


def numbers_in(text: str) -> set[str]:
    return {_norm(n) for n in _NUMBER.findall(text or "")}


def validate_numbers(draft: str, source: str) -> bool:
    """Every number in the draft must appear in the data that was sent."""
    return numbers_in(draft) <= numbers_in(source)


def generate_draft(repo, who: Identity, staff: Optional[Staff], report_id: int,
                   client: SummaryClient, clock: Callable[[], datetime]) -> dict:
    rep = repo.get_report_for_summary(report_id)
    if rep is None:
        raise not_found("דוח הביקור לא נמצא")
    if not who.is_admin:
        b = repo.get_booking(rep.get("booking_id"))
        if staff is None or b is None or b.staff_id != staff.id:
            raise forbidden("דוח הביקור אינו משויך אליך")
    source = build_user_message(rep)
    try:
        draft = client.complete(SYSTEM_PROMPT, source)
    except AIUnavailable:
        raise DomainError(503, "ai_unavailable", UNAVAILABLE_MSG) from None
    if not validate_numbers(draft, source):
        log.warning("ai summary draft rejected: number not in source")
        raise DomainError(422, "ai_summary_unverified", UNVERIFIED_MSG)
    return {"draft": draft, "model": client.model, "generated_at": clock().isoformat(),
            "saved": False}
