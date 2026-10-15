"""Clinical risk ORCHESTRATION (not clinical logic).

This module only (1) loads the context the browser used to load, (2) asks the predictive
service (over HTTP, existing endpoints, unchanged) for the assessment / alert evaluation,
(3) signs the result with a server-held secret and (4) hands it to ONE SECURITY DEFINER SQL
function (`record_risk_prediction` / `record_auto_alert`) that is the only writer of
risk_predictions and alerts. Thresholds, formulas and alert rules live in predictive-service
and are never re-implemented here.

Why signing: a SECURITY DEFINER function is callable by any signed-in user over PostgREST.
The HMAC attestation (secret known only to the backend and stored in a table nobody can read)
proves the assessment really came from this server, so a client cannot call the RPC with a
forged risk_level.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import time
from datetime import datetime, timezone
from typing import Callable, Optional, Protocol

import httpx

from .errors import DomainError, forbidden, not_found
from .models import Identity, Staff

VITAL_KEYS = ("systolic_bp", "diastolic_bp", "blood_sugar", "pulse", "temperature",
              "oxygen_saturation")
RISK_HORIZON_HOURS = 8           # same value the browser sent
ATTESTATION_TTL_SECONDS = 300    # keep in sync with the SQL function

UNAVAILABLE_MSG = ("שירות התחזית אינו זמין כרגע. הדוח נשמר כראוי; "
                   "הערכת הסיכון לא בוצעה ולא נשמרה — ניתן לנסות שוב מאוחר יותר.")


class PredictiveUnavailable(Exception):
    """Predictive service down, timed out, or answered with an error."""


class PredictiveClient(Protocol):
    def risk_assessment(self, body: dict) -> dict: ...
    def evaluate_alert(self, body: dict) -> dict: ...
    def medical_warning(self, body: dict) -> dict: ...


class HttpPredictiveClient:
    """Calls the existing predictive-service endpoints. `transport` is injectable."""

    def __init__(self, base_url: str, timeout: float = 5.0,
                 transport: httpx.BaseTransport | None = None):
        self._client = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout,
                                    transport=transport)

    def _post(self, path: str, body: dict) -> dict:
        try:
            r = self._client.post(path, json=body)
        except httpx.HTTPError as e:  # connect/timeout/protocol
            raise PredictiveUnavailable(str(e)) from e
        if r.status_code >= 400:
            raise PredictiveUnavailable(f"predictive service answered {r.status_code}")
        try:
            data = r.json()
        except ValueError as e:
            raise PredictiveUnavailable("non-JSON response") from e
        if not isinstance(data, dict):
            raise PredictiveUnavailable("unexpected response shape")
        return data

    def risk_assessment(self, body): return self._post("/predict/risk-assessment", body)
    def evaluate_alert(self, body): return self._post("/alerts/evaluate", body)
    def medical_warning(self, body): return self._post("/predict/medical-warning", body)


class FakePredictiveClient:
    """Scripted responses for tests; records every request body."""

    def __init__(self):
        self.down = False
        self.alert_down = False
        self.risk_response: dict = {
            "risk_level": "green", "level_label": "תקין", "flagged_vitals": [], "trend": None,
            "status_message": "המדדים תקינים", "confidence": 1.0, "probability": None,
            "prediction_horizon_hours": RISK_HORIZON_HOURS, "model_version": "rule-based-v1"}
        self.alert_response: dict = {"alert_type": None, "severity": None, "message": None}
        self.warning_response: dict = {
            "current_risk": {"level": "green", "level_label": "תקין", "flagged_vitals": []},
            "trend": None, "status_message": "המדדים תקינים", "trigger_events": []}
        self.risk_calls: list[dict] = []
        self.alert_calls: list[dict] = []
        self.warning_calls: list[dict] = []

    def risk_assessment(self, body):
        self.risk_calls.append(body)
        if self.down:
            raise PredictiveUnavailable("down")
        return self.risk_response

    def evaluate_alert(self, body):
        self.alert_calls.append(body)
        if self.down or self.alert_down:
            raise PredictiveUnavailable("down")
        return self.alert_response

    def medical_warning(self, body):
        self.warning_calls.append(body)
        if self.down:
            raise PredictiveUnavailable("down")
        return self.warning_response


# ---- attestation ---------------------------------------------------------------

def sign_attestation(secret: str, payload: dict) -> dict:
    """{'payload': <exact JSON text>, 'sig': hex HMAC-SHA256}. The SQL function verifies the
    HMAC over the exact text, then parses it, so no canonicalisation is needed."""
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    sig = hmac.new(secret.encode(), text.encode(), hashlib.sha256).hexdigest()
    return {"payload": text, "sig": sig}


def verify_attestation(secret: str, att: dict) -> dict:
    """Mirror of the SQL verification (used by FakeRepo)."""
    want = hmac.new(secret.encode(), att["payload"].encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(want, att.get("sig", "")):
        raise forbidden("אימות תוצאת ההערכה נכשל")
    return json.loads(att["payload"])


# ---- service -------------------------------------------------------------------

def _vitals(row: Optional[dict]) -> Optional[dict]:
    if row is None:
        return None
    return {k: row.get(k) for k in VITAL_KEYS}


def age_from_dob(dob: Optional[str], now: datetime) -> Optional[int]:
    """Same formula the browser used: floor((now - dob) / 365.25 days)."""
    if not dob:
        return None
    d = datetime.fromisoformat(dob[:10]).replace(tzinfo=timezone.utc)
    return math.floor((now - d).total_seconds() / (365.25 * 24 * 3600))


class RiskService:
    def __init__(self, repo, client: PredictiveClient, secret: str,
                 clock: Callable[[], datetime] | None = None):
        self.repo, self.client, self.secret = repo, client, secret
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def _sign(self, uid: str, payload: dict) -> dict:
        if not self.secret:
            raise DomainError(503, "risk_not_configured", "הערכת סיכון אינה מוגדרת בשרת")
        body = {"v": 1, "uid": str(uid).lower(), "iat": int(self.clock().timestamp()), **payload}
        return sign_attestation(self.secret, body)

    def _evaluate_alert(self, risk_level, trend, status_message, trigger_events) -> Optional[dict]:
        """Same request the browser sent. Failure => no alert (as before), never an error."""
        try:
            ev = self.client.evaluate_alert({
                "risk_level": risk_level, "trend": trend,
                "status_message": status_message, "trigger_events": trigger_events})
        except PredictiveUnavailable:
            return None
        if not ev.get("alert_type"):
            return None
        return {"alert_type": ev["alert_type"], "severity": ev.get("severity"),
                "message": ev.get("message")}

    # POST /visits/{report_id}/risk-assessment
    def assess_visit(self, who: Identity, staff: Optional[Staff], report_id: int) -> dict:
        rep = self.repo.get_report_for_risk(report_id)   # caller JWT: RLS decides visibility
        if rep is None:
            raise not_found("דוח הביקור לא נמצא")
        if not who.is_admin:
            b = self.repo.get_booking(rep.get("booking_id"))
            if staff is None or b is None or b.staff_id != staff.id:
                raise forbidden("דוח הביקור אינו משויך אליך")
        patient_id = rep["patient_id"]
        ctx = self.repo.get_patient_risk_context(patient_id)
        previous = self.repo.get_previous_report(patient_id, report_id)
        body = {
            "current": _vitals(rep),
            "previous": _vitals(previous),
            "prediction_horizon_hours": RISK_HORIZON_HOURS,
            "patient_context": {
                "background_conditions": (ctx or {}).get("background_conditions") or [],
                "smoking_status": (ctx or {}).get("smoking_status") or None,
            },
        }
        try:
            a = self.client.risk_assessment(body)
        except PredictiveUnavailable:
            raise DomainError(503, "predictive_unavailable", UNAVAILABLE_MSG)

        level = a.get("risk_level")
        if level == "no_data":   # no vitals: never persist a fabricated record
            return {"risk_level": "no_data", "prediction": None, "alert": None,
                    "created": False, "alert_evaluated": False}
        alert = self._evaluate_alert(level, a.get("trend"), a.get("status_message"), [])
        att = self._sign(who.user_id, {
            "kind": "risk", "report_id": report_id, "risk_level": level,
            "trend": a.get("trend"), "confidence": a.get("confidence"),
            "probability": a.get("probability"),
            "horizon_hours": a.get("prediction_horizon_hours", RISK_HORIZON_HOURS),
            "model_version": a.get("model_version") or "rule-based-v1",
            "alert": alert,
        })
        stored = self.repo.record_risk_prediction(report_id, att)
        return {"risk_level": level, "trend": a.get("trend"),
                "status_message": a.get("status_message"),
                "prediction": stored.get("prediction"), "alert": stored.get("alert"),
                "created": bool(stored.get("created")), "alert_evaluated": alert is not None}

    # POST /patients/{patient_id}/auto-alert  (comprehensive diagnosis -> alert)
    def auto_alert(self, who: Identity, patient_id: str) -> dict:
        ctx = self.repo.get_patient_risk_context(patient_id)
        if ctx is None:   # RLS hides patients that are not assigned to this staff member
            raise not_found("המטופל לא נמצא")
        reports = self.repo.list_patient_reports(patient_id)
        if not reports:
            raise DomainError(409, "no_history", "אין היסטוריית מדידות למטופל זה עדיין.")
        body = {
            "patient_context": {
                "age": age_from_dob(ctx.get("date_of_birth"), self.clock()),
                "background_conditions": ctx.get("background_conditions") or [],
                "smoking_status": ctx.get("smoking_status") or None,
            },
            "history": [{"measured_at": r["visit_date"], **{k: r.get(k) for k in VITAL_KEYS}}
                        for r in reports],
            "horizon": "8h",
        }
        try:
            w = self.client.medical_warning(body)
        except PredictiveUnavailable:
            raise DomainError(503, "predictive_unavailable", UNAVAILABLE_MSG)
        level = (w.get("current_risk") or {}).get("level")
        alert = self._evaluate_alert(level, w.get("trend"), w.get("status_message"),
                                     w.get("trigger_events") or [])
        if alert is None:
            return {"risk_level": level, "alert": None, "created": False}
        att = self._sign(who.user_id, {"kind": "alert", "patient_id": patient_id,
                                       "risk_level": level, "alert": alert})
        stored = self.repo.record_auto_alert(patient_id, att)
        return {"risk_level": level, "alert": stored.get("alert"),
                "created": bool(stored.get("created"))}
