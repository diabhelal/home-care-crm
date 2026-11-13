"""Browser -> backend -> internal predictive service pass-through (app/predict_proxy.py),
and proof that a predictive outage never blocks saving clinical documentation."""
import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.predict_proxy import ADMIN_ONLY, MAX_BODY_BYTES, PATIENT_SCOPED
from app.risk import HttpPredictiveClient
from tests.conftest import NOW, H
from tests.test_api import REPORT, _confirmed
from tests.test_measurements import assigned_world, body as measurement

BODY = {"vital": "pulse", "points": [{"measured_at": "2026-10-01T09:00:00Z", "value": 80}]}


def _pid(world):
    assigned_world(world)
    world.repo.patients["p1"] = {"date_of_birth": "1950-06-15", "background_conditions": [], "smoking_status": None}
    return "p1"


def _post(world, path, token=None, pid=None, json=BODY):
    h = H(token) if token else {}
    if pid:
        h["X-Patient-Id"] = pid
    return world.client.post(path, json=json, headers=h)


@pytest.mark.parametrize("path", sorted(ADMIN_ONLY | PATIENT_SCOPED))
def test_no_token_is_401_and_nothing_forwarded(world, path):
    assert _post(world, path, pid="p1").status_code == 401
    assert world.predictive.forward_calls == []


@pytest.mark.parametrize("path", sorted(ADMIN_ONLY | PATIENT_SCOPED))
def test_patient_token_is_403(world, path):
    pid = _pid(world)
    assert _post(world, path, "patient", pid).status_code == 403
    assert world.predictive.forward_calls == []


@pytest.mark.parametrize("path", sorted(ADMIN_ONLY))
def test_staff_cannot_use_admin_only_routes(world, path):
    assert _post(world, path, "staff1").status_code == 403
    assert _post(world, path, "admin").status_code == 200


@pytest.mark.parametrize("path", sorted(PATIENT_SCOPED))
def test_patient_scoped_requires_header_and_visible_patient(world, path):
    pid = _pid(world)
    assert _post(world, path, "staff1").status_code == 400                 # no X-Patient-Id
    assert _post(world, path, "staff1", "not-visible").status_code == 403   # RLS hides it
    assert _post(world, path, "staff1", "bad id!").status_code == 400
    assert world.predictive.forward_calls == []
    r = _post(world, path, "staff1", pid)
    assert r.status_code == 200 and r.json() == {"echo": True}
    assert world.predictive.forward_calls == [(path, BODY)]                 # body forwarded unchanged


def test_training_and_unknown_paths_are_not_routed(world):
    for path in ("/train/risk/logistic", "/predict/anomalies", "/alerts/evaluate"):
        assert _post(world, path, "admin").status_code in (404, 405)
    assert world.predictive.forward_calls == []


def test_oversized_body_is_413(world):
    big = {"vital": "pulse", "points": [{"value": 1, "pad": "x" * MAX_BODY_BYTES}]}
    assert _post(world, "/predict/capacity", "admin", json=big).status_code == 413
    assert world.predictive.forward_calls == []


def test_outage_is_503_with_code(world):
    world.predictive.down = True
    r = _post(world, "/predict/capacity", "admin")
    assert r.status_code == 503 and r.json()["code"] == "predictive_unavailable"


def test_service_validation_error_passes_through_without_input(world):
    world.predictive.forward_response = (422, {"detail": [{"loc": ["body", "x"], "msg": "bad", "type": "t"}]})
    r = _post(world, "/predict/capacity", "admin")
    assert r.status_code == 422 and "detail" in r.json()


def test_predict_health_reports_status_only(world):
    r = world.client.get("/predict/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    world.predictive.down = True
    r = world.client.get("/predict/health")
    assert r.status_code == 503 and r.json() == {"status": "unavailable"}


def test_api_docs_are_not_exposed(world):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert world.client.get(path).status_code == 404


# ---- a real HTTP client pointed at a dead port: documentation still saves ----------

@pytest.fixture
def dead_predictive_world(world):
    dead = HttpPredictiveClient("http://127.0.0.1:9", timeout=0.5)
    app = create_app(Settings(travel_buffer_minutes=30, risk_attestation_secret="-".join(["throwaway", "attestation", "value"])),
                     verifier=world.verifier, repo_factory=lambda jwt: world.repo, clock=lambda: NOW,
                     predictive_client=dead)
    world.client = TestClient(app)
    return world


def test_visit_report_saves_when_predictive_is_down(dead_predictive_world):
    w = dead_predictive_world
    bid = _confirmed(w)
    r = w.client.post(f"/staff/visits/{bid}/complete", json=REPORT, headers=H("staff1"))
    assert r.status_code == 200, r.text
    assert w.repo.reports[bid]["systolic_bp"] == REPORT["systolic_bp"]
    w.repo.patients[w.repo.reports[bid]["patient_id"]] = {"date_of_birth": "1950-06-15",
                                                          "background_conditions": [], "smoking_status": None}
    rid = w.repo.reports[bid]["id"]
    risk = w.client.post(f"/visits/{rid}/risk-assessment", headers=H("staff1"))
    assert risk.status_code == 503 and risk.json()["code"] == "predictive_unavailable"
    assert w.repo.reports[bid]["systolic_bp"] == REPORT["systolic_bp"]      # report untouched by the failed risk call


def test_measurement_saves_when_predictive_is_down(dead_predictive_world):
    w = dead_predictive_world
    assigned_world(w)
    r = w.client.post("/patients/p1/measurements", json=measurement(), headers=H("staff1"))
    assert r.status_code == 201
    assert w.client.get("/predict/health").status_code == 503


def test_http_client_forward_maps_failures():
    def handler(request: httpx.Request):
        if request.url.path == "/boom":
            return httpx.Response(500, json={"detail": "x"})
        if request.url.path == "/text":
            return httpx.Response(200, text="not json")
        return httpx.Response(200, json={"ok": request.read().decode()})
    c = HttpPredictiveClient("http://p", transport=httpx.MockTransport(handler))
    assert c.forward("/predict/capacity", {"a": 1}) == (200, {"ok": '{"a":1}'})
    from app.risk import PredictiveUnavailable
    with pytest.raises(PredictiveUnavailable):
        c.forward("/boom", {})
    with pytest.raises(PredictiveUnavailable):
        c.forward("/text", {})
