"""שכבת הסבר AI (backend-only).

חשוב: השכבה הזו אף פעם לא מקור להסתברות, אבחנה, או חיזוי אירוע עצמאי. היא מקבלת
אך ורק פלט מובנה שכבר חושב ע"י שכבת הכללים (rules) ב-main.py, ומסבירה אותו במילים
לצוות. אם אין ספק/מפתח מוגדר (ANTHROPIC_API_KEY ב-.env), המערכת ממשיכה לעבוד רגיל
בלי שכבת ה-AI — שום נתיב אחר בשירות לא תלוי בזה.

מפתח ה-API נטען מ-.env בלבד (ראה .env.example) ואף פעם לא נחשף לצד לקוח — האנדפוינט
היחיד שנחשף לפרונט הוא /explain, שמחזיר טקסט הסבר, לא את המפתח עצמו.
"""

import json
import os
from abc import ABC, abstractmethod
from typing import Optional

SYSTEM_PROMPT = """You are a clinical decision-support explanation assistant for home-care nursing staff.

You receive ONLY structured, pre-computed data: a rule-based risk classification, a trend derived by
comparing two classifications, and relevant patient background factors. Nothing else.

Your ONLY job is to summarize and explain these provided fields in plain, concise language
(2-4 sentences) for clinical staff to quickly understand.

You MUST NOT:
- invent a probability or percentage of any kind
- invent a diagnosis
- predict or name a specific future medical event (e.g. heart attack, stroke, cardiac arrest,
  seizure, hypoglycemia) unless that exact event is already explicitly present in the input
- state or imply anything that cannot be derived directly from the provided fields
- override, contradict, or second-guess the provided risk_level or trend

If the input shows no concerning findings, say so plainly and briefly — do not invent concern
where none was flagged. Respond in Hebrew unless the input content is clearly in English."""


class ExplanationProvider(ABC):
    @abstractmethod
    def explain(self, payload: dict) -> str: ...


class AnthropicProvider(ExplanationProvider):
    def __init__(self, api_key: str, model: str):
        from anthropic import Anthropic  # יבוא עצל: התלות אופציונלית בזמן ריצה

        self._client = Anthropic(api_key=api_key)
        self._model = model

    def explain(self, payload: dict) -> str:
        message = self._client.messages.create(
            model=self._model,
            max_tokens=300,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
        return "".join(block.text for block in message.content if block.type == "text").strip()


def get_provider() -> Optional[ExplanationProvider]:
    """טוען ספק AI לפי משתני סביבה. מחזיר None אם לא הוגדר ספק/מפתח — קריאה תקינה, לא שגיאה."""
    provider_name = os.getenv("AI_PROVIDER", "").strip().lower()
    if provider_name == "anthropic":
        api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        if not api_key:
            return None
        model = os.getenv("AI_MODEL", "claude-sonnet-5").strip()
        return AnthropicProvider(api_key, model)
    return None
