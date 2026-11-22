"""FR-AI-02: LLM visit-summary draft. Off by default, admin/assigned staff only, identifiers never sent,
numbers verified against the source, provider failures fail closed, nothing written to the DB."""
import json
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai_summary import (OpenAISummaryClient, build_user_message, redact_free_text,
                            validate_numbers)
from app.config import Settings
from app.fake_repo import FakeRepo
from app.main import create_app
from app.models import Staff
from app.risk import FakePredictiveClient
from tests.conftest import NOW, H, MapVerifier, claims, local, req

FAKE_KEY = "-".join(["test", "only", "not", "a", "key"])
REPORT = {"treatment_summary": "המטופל רגוע. טלפון בת: 050-1234567, ת.ז 123456789, mail a.b@example.com",
          "systolic_bp": 120, "diastolic_bp": 80, "pulse": 70, "temperature": 36.6,
          "oxygen_saturation": 98, "blood_sugar": 100, "performed_injection": True}
GOOD_DRAFT = "בוצע ביקור. לחץ דם 120/80, דופק 70, חום 36.6, סטורציה 98, סוכר 100. בוצעה זריקה."


class Provider:
    """MockTransport handler recording what was sent to the provider."""

    def __init__(self, status=200, content=GOOD_DRAFT, exc=None):
        self.status, self.content, self.exc, self.calls = status, content, exc, []

    def __call__(self, request: httpx.Request):
        self.calls.append(request)
        if self.exc:
            raise self.exc
        if self.status != 200:
            return httpx.Response(self.status, json={"error": {"message": "secret provider detail"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": self.content}}]})


def make_world(enabled=True, key=FAKE_KEY, provider=None):
    repo = FakeRepo([Staff(1, "Nurse A", "nurse", auth_user_id="staff-1"),
                     Staff(2, "Nurse B", "nurse", auth_user_id="staff-2")], now=lambda: NOW)
    v = MapVerifier()
    v.tokens.update({"patient": claims("p1", anon=True), "admin": claims("a1", admin=True),
                     "staff1": claims("staff-1"), "staff2": claims("staff-2")})
    provider = provider or Provider()
    cfg = Settings(ai_summary_enabled=enabled, openai_api_key=key)
    client = OpenAISummaryClient(key or "unused", "test-model", transport=httpx.MockTransport(provider))
    app = create_app(cfg, verifier=v, repo_factory=lambda jwt: repo, clock=lambda: NOW,
                     predictive_client=FakePredictiveClient(), summary_client=client)
    tc = TestClient(app)
    bid = tc.post("/bookings/request", json=req(local(18, 9), staff_id=1), headers=H("patient")).json()["id"]
    tc.post(f"/admin/bookings/{bid}/approve", headers=H("admin"))
    assert tc.post(f"/staff/visits/{bid}/complete", json=REPORT, headers=H("staff1")).status_code == 200
    return type("W", (), {"client": tc, "repo": repo, "provider": provider, "rid": bid})()


def _summary(w, who="staff1", rid=None):
    return w.client.post(f"/visits/{rid or w.rid}/ai-summary", headers=H(who))


@pytest.mark.parametrize("enabled,key", [(False, FAKE_KEY), (True, ""), (False, "")])
def test_off_by_default_404_and_no_outbound_call(enabled, key):
    w = make_world(enabled=enabled, key=key)
    r = _summary(w, "admin")
    assert r.status_code == 404 and r.json()["code"] == "ai_summary_disabled"
    assert w.provider.calls == []
    assert w.client.get("/features").json() == {"ai_summary": False}


def test_settings_default_is_off_and_key_never_in_repr():
    s = Settings.from_env({"OPENAI_API_KEY": FAKE_KEY})
    assert s.ai_summary_active is False
    assert FAKE_KEY not in repr(s)
    assert Settings.from_env({"OPENAI_API_KEY": FAKE_KEY, "AI_SUMMARY_ENABLED": "true"}).ai_summary_active


def test_features_on():
    assert make_world().client.get("/features").json() == {"ai_summary": True}


def test_assigned_staff_and_admin_get_draft_nothing_written():
    w = make_world()
    before = json.dumps(w.repo.reports, sort_keys=True, default=str)
    for who in ("staff1", "admin"):
        r = _summary(w, who)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["draft"] == GOOD_DRAFT and body["saved"] is False and body["model"] == "test-model"
    assert json.dumps(w.repo.reports, sort_keys=True, default=str) == before


def test_other_staff_and_patient_403_no_outbound_call():
    w = make_world()
    assert _summary(w, "staff2").status_code == 403
    assert _summary(w, "patient").status_code == 403
    assert w.provider.calls == []


def test_requires_auth_and_missing_report_404():
    w = make_world()
    assert w.client.post(f"/visits/{w.rid}/ai-summary").status_code == 401
    assert _summary(w, "admin", rid=9999).status_code == 404


def test_payload_has_no_identifiers_and_redacts_free_text():
    w = make_world()
    assert _summary(w).status_code == 200
    sent = json.loads(w.provider.calls[0].content)
    assert sent["store"] is False
    text = json.dumps(sent, ensure_ascii=False)
    for leaked in ("050-1234567", "1234567", "123456789", "a.b@example.com", "p1", "staff_id", "patient_id",
                   "Herzl", "Nurse A"):
        assert leaked not in text, leaked
    assert "[הוסר]" in text and "120" in text and "זריקה" in text
    assert w.provider.calls[0].headers["Authorization"] == f"Bearer {FAKE_KEY}"


def test_invented_number_is_rejected_without_returning_text():
    w = make_world(provider=Provider(content="לחץ דם 150/95, מומלץ 2 כדורים"))
    r = _summary(w)
    assert r.status_code == 422 and r.json()["code"] == "ai_summary_unverified"
    assert "150" not in r.text and "כדורים" not in r.text


@pytest.mark.parametrize("provider", [Provider(status=500), Provider(status=401), Provider(status=429),
                                      Provider(exc=httpx.ReadTimeout("t")), Provider(content="")])
def test_provider_failure_503_and_logs_nothing_sensitive(provider, caplog):
    w = make_world(provider=provider)
    with caplog.at_level(logging.DEBUG):
        r = _summary(w)
    assert r.status_code == 503 and r.json()["code"] == "ai_unavailable"
    assert "secret provider detail" not in r.text
    logs = caplog.text
    for s in (FAKE_KEY, "secret provider detail", "רגוע", "120"):
        assert s not in logs


def test_helpers():
    assert redact_free_text("call 03-5551234 or +972 50 123 4567, dose 5") == "call [הוסר] or [הוסר], dose 5"
    src = build_user_message({"visit_date": "2026-11-20T10:00:00", "pulse": 70.0, "temperature": 36.6})
    assert "20.11.2026" in src and "70" in src and "70.0" not in src
    assert validate_numbers("ב-20.11.2026 דופק 70, חום 36.60", src)
    assert not validate_numbers("דופק 71", src)
