"""קלט לא-סופי (NaN/Infinity) חייב להידחות ב-422; גוף התגובה לעולם לא מכיל NaN/inf.
משתמשים ב-content= (גוף JSON גולמי) כי requests/httpx לא מסריאלים NaN."""

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app

client = TestClient(app, raise_server_exceptions=False)
HDR = {"content-type": "application/json"}
T = "2026-01-01T00:00:00Z"


def post(path, raw):
    return client.post(path, content=raw, headers=HDR)


def forecast(v):
    pts = f'{{"measured_at":"{T}","value":{v}}},{{"measured_at":"2026-01-01T01:00:00Z","value":80}}'
    return post("/predict/vitals-forecast", '{"points":[' + pts + '],"horizon":"next"}')


@pytest.mark.parametrize("bad", ["NaN", "Infinity", "-Infinity", "null"])
def test_forecast_rejects_non_finite_and_null(bad):
    r = forecast(bad)
    assert r.status_code == 422
    assert "detail" in r.json()


def test_forecast_missing_value_422():
    r = post("/predict/vitals-forecast", '{"points":[{"measured_at":"%s"}],"horizon":"next"}' % T)
    assert r.status_code == 422


def test_forecast_valid_200():
    assert forecast("90").status_code == 200


@pytest.mark.parametrize("bad", ["NaN", "Infinity", "-Infinity"])
def test_medical_warning_history_non_finite_422(bad):
    body = '{"patient_context":{},"history":[{"measured_at":"%s","pulse":%s}],"horizon":"24h"}' % (T, bad)
    r = post("/predict/medical-warning", body)
    assert r.status_code == 422
    assert "detail" in r.json()


def test_medical_warning_valid_200_and_finite():
    body = '{"patient_context":{},"history":[{"measured_at":"%s","pulse":80}],"horizon":"24h"}' % T
    r = post("/predict/medical-warning", body)
    assert r.status_code == 200
    json.loads(r.text, parse_constant=lambda c: pytest.fail("non-finite in response: " + c))


@pytest.mark.parametrize("bad", ["NaN", "Infinity", "-Infinity"])
def test_baseline_non_finite_422(bad):
    body = '{"vital":"pulse","points":[{"measured_at":"%s","value":%s}]}' % (T, bad)
    assert post("/predict/baseline", body).status_code == 422


@pytest.mark.parametrize("bad", ["NaN", "Infinity", "-Infinity"])
def test_anomalies_and_timeseries_non_finite_422(bad):
    assert post("/predict/anomalies", '{"history":[{"measured_at":"%s","pulse":%s}]}' % (T, bad)).status_code == 422
    body = '{"vital":"pulse","points":[{"measured_at":"%s","value":80}],"horizon_hours":%s}' % (T, bad)
    assert post("/predict/vitals-timeseries", body).status_code == 422


@pytest.mark.parametrize("bad", ["NaN", "Infinity"])
def test_capacity_and_risk_non_finite_422(bad):
    body = '{"visits_this_month":10,"active_patients":5,"growth_rate":%s}' % bad
    assert post("/predict/capacity", body).status_code == 422
    assert post("/predict/risk-level", '{"pulse":%s}' % bad).status_code == 422
    assert post("/predict/risk-assessment", '{"current":{"pulse":%s}}' % bad).status_code == 422


@pytest.mark.parametrize("bad", ["NaN", "Infinity"])
def test_future_event_features_non_finite_422(bad):
    body = '{"target":"x","features":{"age":%s}}' % bad
    assert post("/predict/future-event", body).status_code == 422


def test_train_response_is_honest_about_validation(monkeypatch):
    import ml_targets
    monkeypatch.setattr(ml_targets, "train_model", lambda t, a, X, y: {"auc": 0.5})
    monkeypatch.setenv("PREDICTIVE_TRAINING_KEY", "k" * 40)
    r = client.post("/train/anything/logistic_regression", json={"X": [{"a": 1}], "y": [0]},
                    headers={"X-Service-Key": "k" * 40})
    assert r.status_code == 200
    assert r.json()["validated"] is False
    assert "אימות קליני" in r.json()["validation_note"]


def test_training_endpoint_can_be_disabled_for_public_hosting(monkeypatch):
    import ml_targets
    called = []
    monkeypatch.setattr(ml_targets, "train_model", lambda *a: called.append(1) or {"auc": 0.5})
    monkeypatch.setenv("DISABLE_TRAINING", "1")
    r = client.post("/train/anything/logistic_regression", json={"X": [{"a": 1}], "y": [0]})
    assert r.status_code == 403 and not called


def test_training_is_denied_by_default_and_with_a_wrong_key(monkeypatch):
    import ml_targets
    called = []
    monkeypatch.setattr(ml_targets, "train_model", lambda *a: called.append(1) or {"auc": 0.5})
    monkeypatch.delenv("DISABLE_TRAINING", raising=False)
    monkeypatch.delenv("PREDICTIVE_TRAINING_KEY", raising=False)
    body = {"X": [{"a": 1}], "y": [0]}
    assert client.post("/train/anything/logistic_regression", json=body).status_code == 403          # no key configured
    monkeypatch.setenv("PREDICTIVE_TRAINING_KEY", "k" * 40)
    assert client.post("/train/anything/logistic_regression", json=body).status_code == 403          # no header
    assert client.post("/train/anything/logistic_regression", json=body,
                       headers={"X-Service-Key": "wrong"}).status_code == 403                         # wrong key
    assert not called


def test_cors_is_limited_to_get_post_and_content_type():
    pre = client.options("/predict/capacity", headers={
        "Origin": "http://localhost:8080", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"})
    assert pre.status_code == 200
    bad = client.options("/predict/capacity", headers={
        "Origin": "http://localhost:8080", "Access-Control-Request-Method": "DELETE"})
    assert bad.status_code == 400
    bad_hdr = client.options("/predict/capacity", headers={
        "Origin": "http://localhost:8080", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-anything"})
    assert bad_hdr.status_code == 400
