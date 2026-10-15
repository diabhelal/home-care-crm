"""Server-side risk assessment + automatic alerts. No network: FakePredictiveClient/FakeRepo."""
import json

import httpx
import pytest

from app.risk import (HttpPredictiveClient, PredictiveUnavailable, age_from_dob,
                      sign_attestation, verify_attestation)
from tests.conftest import H
from tests.test_api import REPORT, _confirmed

SECRET = "-".join(["throwaway", "attestation", "value"])
VITAL_KEYS = ("systolic_bp", "diastolic_bp", "blood_sugar", "pulse", "temperature",
              "oxygen_saturation")


def _completed(world, background=("diabetes",), smoking="smoker"):
    bid = _confirmed(world)
    assert world.client.post(f"/staff/visits/{bid}/complete", json=REPORT,
                             headers=H("staff1")).status_code == 200
    world.repo.reports[bid]["visit_date"] = "2026-10-14T09:00:00+00:00"
    pid = world.repo.reports[bid]["patient_id"]
    world.repo.patients[pid] = {"date_of_birth": "1950-06-15", "background_conditions": list(background),
                                "smoking_status": smoking}
    return bid, pid


def _assess(world, rid, who="staff1"):
    return world.client.post(f"/visits/{rid}/risk-assessment", headers=H(who))


def test_requires_auth(world):
    rid, _ = _completed(world)
    assert world.client.post(f"/visits/{rid}/risk-assessment").status_code == 401


def test_assigned_staff_ok_and_everything_server_derived(world):
    rid, pid = _completed(world)
    world.predictive.risk_response = {**world.predictive.risk_response, "risk_level": "red",
                                      "trend": "worsening", "status_message": "נדרש מעקב"}
    r = _assess(world, rid)
    assert r.status_code == 200, r.text
    p = r.json()["prediction"]
    stored = world.repo.predictions[0]
    assert p["patient_id"] == pid and p["visit_report_id"] == rid
    assert stored["created_by"] == "staff-1"          # from the JWT subject, never the body
    assert stored["input_features"] == {k: REPORT[k] for k in VITAL_KEYS}
    assert stored["risk_level"] == "red" and stored["trend"] == "worsening"


def test_body_cannot_forge_fields(world):
    rid, _ = _completed(world)
    r = world.client.post(f"/visits/{rid}/risk-assessment", headers=H("staff1"),
                          json={"risk_level": "green", "created_by": "victim", "patient_id": "x",
                                "model_version": "evil", "predicted_at": "1999-01-01T00:00:00Z"})
    assert r.status_code == 200
    s = world.repo.predictions[0]
    assert s["created_by"] == "staff-1" and s["model_version"] == "rule-based-v1"
    assert s["risk_level"] == "green" and s["patient_id"] != "x"


def test_other_staff_and_patient_forbidden_nothing_written(world):
    rid, _ = _completed(world)
    assert _assess(world, rid, "staff2").status_code == 403
    assert _assess(world, rid, "patient").status_code == 403
    assert world.repo.predictions == [] and world.predictive.risk_calls == []


def test_admin_ok(world):
    rid, _ = _completed(world)
    assert _assess(world, rid, "admin").status_code == 200
    assert world.repo.predictions[0]["created_by"] == "a1"


def test_unknown_report_404(world):
    assert _assess(world, 9999, "admin").status_code == 404


def test_predictive_down_503_hebrew_and_nothing_written(world):
    rid, _ = _completed(world)
    world.predictive.down = True
    r = _assess(world, rid)
    assert r.status_code == 503 and r.json()["code"] == "predictive_unavailable"
    assert "שירות התחזית" in r.json()["detail"]
    assert world.repo.predictions == [] and world.repo.alerts == []


def test_request_to_predictive_matches_old_browser_payload(world):
    rid, pid = _completed(world)
    prev_bid = 900   # an older report of the same patient is used for the trend
    world.repo.reports[prev_bid] = {"id": prev_bid, "booking_id": prev_bid, "patient_id": pid,
                                    "visit_date": "2026-10-01T09:00:00+00:00", "systolic_bp": 150,
                                    "diastolic_bp": 95, "blood_sugar": 180, "pulse": 88,
                                    "temperature": 37.2, "oxygen_saturation": 95, "extra": "ignored"}
    world.repo.reports[901] = {"id": 901, "booking_id": 901, "patient_id": "other-patient",
                               "visit_date": "2026-10-13T09:00:00+00:00", "systolic_bp": 1}
    assert _assess(world, rid).status_code == 200
    assert world.predictive.risk_calls == [{
        "current": {k: REPORT[k] for k in VITAL_KEYS},
        "previous": {"systolic_bp": 150, "diastolic_bp": 95, "blood_sugar": 180, "pulse": 88,
                     "temperature": 37.2, "oxygen_saturation": 95},
        "prediction_horizon_hours": 8,
        "patient_context": {"background_conditions": ["diabetes"], "smoking_status": "smoker"},
    }]


def test_first_report_has_previous_null_and_empty_context(world):
    rid, pid = _completed(world)
    world.repo.patients.pop(pid)
    assert _assess(world, rid).status_code == 200
    c = world.predictive.risk_calls[0]
    assert c["previous"] is None
    assert c["patient_context"] == {"background_conditions": [], "smoking_status": None}


def test_no_data_writes_nothing(world):
    rid, _ = _completed(world)
    world.predictive.risk_response = {**world.predictive.risk_response, "risk_level": "no_data"}
    r = _assess(world, rid)
    assert r.status_code == 200 and r.json()["prediction"] is None
    assert world.repo.predictions == [] and world.predictive.alert_calls == []


# ---- alert parity: the rules live in predictive-service; the backend must send what the
# browser sent and store what comes back, with the same dedupe.
def test_alert_request_matches_old_browser_payload_and_is_stored_atomically(world):
    rid, pid = _completed(world)
    world.predictive.risk_response = {**world.predictive.risk_response, "risk_level": "red",
                                      "trend": "worsening", "status_message": "אדום"}
    world.predictive.alert_response = {"alert_type": "new_red", "severity": "high", "message": "אדום"}
    r = _assess(world, rid)
    assert world.predictive.alert_calls == [{"risk_level": "red", "trend": "worsening",
                                             "status_message": "אדום", "trigger_events": []}]
    a = world.repo.alerts[0]
    assert (a["alert_type"], a["severity"], a["message"]) == ("new_red", "high", "אדום")
    assert a["patient_id"] == pid and a["risk_prediction_id"] == world.repo.predictions[0]["id"]
    assert r.json()["alert"]["alert_type"] == "new_red"


def test_open_alert_of_same_type_is_not_duplicated(world):
    rid, pid = _completed(world)
    world.predictive.alert_response = {"alert_type": "new_red", "severity": "high", "message": "m"}
    world.repo.alerts.append({"id": 1, "patient_id": pid, "alert_type": "new_red", "status": "open"})
    _assess(world, rid)
    assert len(world.repo.alerts) == 1


def test_alert_service_failure_keeps_prediction_without_alert(world):
    rid, _ = _completed(world)
    world.predictive.alert_down = True
    r = _assess(world, rid)
    assert r.status_code == 200 and r.json()["prediction"] and r.json()["alert"] is None
    assert len(world.repo.predictions) == 1 and world.repo.alerts == []


def test_persistence_failure_writes_neither(world):
    rid, _ = _completed(world)
    world.predictive.alert_response = {"alert_type": "new_red", "severity": "high", "message": "m"}
    world.repo.fail_record = True
    with pytest.raises(RuntimeError):
        _assess(world, rid)
    assert world.repo.predictions == [] and world.repo.alerts == []


def test_second_call_is_idempotent(world):
    rid, _ = _completed(world)
    world.predictive.alert_response = {"alert_type": "new_red", "severity": "high", "message": "m"}
    first = _assess(world, rid).json()
    second = _assess(world, rid).json()
    assert first["created"] is True and second["created"] is False
    assert len(world.repo.predictions) == 1 and len(world.repo.alerts) == 1


def test_missing_secret_503(world):
    from fastapi.testclient import TestClient
    from app.config import Settings
    from app.main import create_app
    rid, _ = _completed(world)
    app = create_app(Settings(), verifier=world.verifier, repo_factory=lambda j: world.repo,
                     predictive_client=world.predictive)
    r = TestClient(app).post(f"/visits/{rid}/risk-assessment", headers=H("staff1"))
    assert r.status_code == 503 and r.json()["code"] == "risk_not_configured"
    assert world.repo.predictions == []


# ---- comprehensive-diagnosis alert endpoint
def test_auto_alert_flow_and_payload(world):
    rid, pid = _completed(world)
    world.predictive.warning_response = {
        "current_risk": {"level": "yellow", "level_label": "x", "flagged_vitals": []},
        "trend": "worsening", "status_message": "מגמה", "trigger_events": [
            {"vital": "pulse", "severity": "high", "reason": "r", "decay_factor": 0.9}]}
    world.predictive.alert_response = {"alert_type": "vital_anomaly", "severity": "high", "message": "pulse: r"}
    r = world.client.post(f"/patients/{pid}/auto-alert", headers=H("admin"))
    assert r.status_code == 200 and r.json()["created"] is True
    w = world.predictive.warning_calls[0]
    assert w["horizon"] == "8h" and w["patient_context"]["background_conditions"] == ["diabetes"]
    assert w["patient_context"]["age"] == age_from_dob("1950-06-15", __import__("tests.conftest", fromlist=["NOW"]).NOW)
    assert w["history"][0]["measured_at"] == "2026-10-14T09:00:00+00:00"
    assert world.predictive.alert_calls[0]["trigger_events"][0]["vital"] == "pulse"
    a = world.repo.alerts[0]
    assert a["risk_prediction_id"] is None and a["alert_type"] == "vital_anomaly"


def test_auto_alert_errors(world):
    rid, pid = _completed(world)
    assert world.client.post(f"/patients/{pid}/auto-alert").status_code == 401
    assert world.client.post(f"/patients/{pid}/auto-alert", headers=H("patient")).status_code == 403
    assert world.client.post("/patients/nobody/auto-alert", headers=H("admin")).status_code == 404
    world.predictive.down = True
    assert world.client.post(f"/patients/{pid}/auto-alert", headers=H("admin")).status_code == 503
    assert world.repo.alerts == []


# ---- building blocks
def test_attestation_roundtrip_and_tamper():
    att = sign_attestation(SECRET, {"risk_level": "green", "uid": "u"})
    assert verify_attestation(SECRET, att)["risk_level"] == "green"
    bad = {**att, "payload": att["payload"].replace("green", "red")}
    with pytest.raises(Exception):
        verify_attestation(SECRET, bad)
    with pytest.raises(Exception):
        verify_attestation("other", att)


def _http(handler):
    return HttpPredictiveClient("http://pred:8000", 1.0, transport=httpx.MockTransport(handler))


def test_http_client_paths_and_errors():
    seen = []
    def h(req):
        seen.append((req.url.path, json.loads(req.content)))
        return httpx.Response(200, json={"ok": True})
    c = _http(h)
    c.risk_assessment({"a": 1}); c.evaluate_alert({"b": 2}); c.medical_warning({"c": 3})
    assert [p for p, _ in seen] == ["/predict/risk-assessment", "/alerts/evaluate", "/predict/medical-warning"]
    with pytest.raises(PredictiveUnavailable):
        _http(lambda r: httpx.Response(500)).risk_assessment({})
    with pytest.raises(PredictiveUnavailable):
        _http(lambda r: httpx.Response(200, text="<html>")).risk_assessment({})
    def boom(r): raise httpx.ConnectError("refused")
    with pytest.raises(PredictiveUnavailable):
        _http(boom).risk_assessment({})
