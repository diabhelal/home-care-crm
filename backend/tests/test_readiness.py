"""/healthz is liveness only; /readyz reports whether Supabase is reachable (503 otherwise), without leaking details."""
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def _client(probe):
    return TestClient(create_app(Settings(), verifier=object(), repo_factory=lambda jwt: None,
                                 predictive_client=object(), readiness_probe=probe))


def test_healthz_is_liveness_only():
    def boom():
        raise AssertionError("liveness must not call the dependency probe")
    r = _client(boom).get("/healthz")
    assert r.status_code == 200 and r.json() == {"ok": True}


def test_readyz_ok_when_supabase_reachable():
    r = _client(lambda: True).get("/readyz")
    assert r.status_code == 200 and r.json() == {"ok": True, "checks": {"supabase": "ok"}}


def test_readyz_503_when_unreachable_or_probe_raises():
    assert _client(lambda: False).get("/readyz").status_code == 503
    def raises():
        raise RuntimeError("connection details that must not leak")
    r = _client(raises).get("/readyz")
    assert r.status_code == 503
    assert r.json() == {"ok": False, "checks": {"supabase": "unavailable"}}
    assert "connection details" not in r.text


def test_readyz_not_ready_without_configuration():
    # default probe with no SUPABASE_URL configured: not ready, and no network call is attempted
    c = TestClient(create_app(Settings(supabase_url=""), verifier=object(), repo_factory=lambda jwt: None,
                              predictive_client=object()))
    assert c.get("/readyz").status_code == 503
