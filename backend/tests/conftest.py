from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenVerifier
from app.config import Settings
from app.errors import unauthorized
from app.fake_repo import FakeRepo
from app.main import create_app
from app.models import Staff

TZ = ZoneInfo("Asia/Jerusalem")
NOW = datetime(2026, 10, 14, 9, 0, tzinfo=timezone.utc)


def local(day: int, hour: int, minute: int = 0, month: int = 10) -> datetime:
    """Local Israel time on 2026-<month>-<day> -> UTC."""
    return datetime(2026, month, day, hour, minute, tzinfo=TZ).astimezone(timezone.utc)


class MapVerifier:
    def __init__(self):
        self.tokens = {}

    def verify(self, token):
        if token not in self.tokens:
            raise unauthorized()
        return self.tokens[token]


def claims(sub, admin=False, anon=False):
    return {"sub": sub, "is_anonymous": anon, "app_metadata": {"is_admin": admin}}


@pytest.fixture
def world():
    repo = FakeRepo([
        Staff(1, "Nurse A", "nurse", auth_user_id="staff-1"),
        Staff(2, "Nurse B", "nurse", auth_user_id="staff-2"),
        Staff(3, "Doctor", "doctor", auth_user_id="staff-3"),
    ], now=lambda: NOW)
    v = MapVerifier()
    v.tokens.update({
        "patient": claims("p1", anon=True), "patient2": claims("p2"),
        "admin": claims("a1", admin=True),
        "staff1": claims("staff-1"), "staff2": claims("staff-2"),
    })
    app = create_app(Settings(travel_buffer_minutes=30), verifier=v,
                     repo_factory=lambda jwt: repo, clock=lambda: NOW)
    return type("W", (), {"repo": repo, "client": TestClient(app), "verifier": v})()


def H(token, key=None):
    h = {"Authorization": f"Bearer {token}"}
    if key:
        h["Idempotency-Key"] = key
    return h


def req(at, **kw):
    body = {"purpose": "checkup", "scheduled_at": at.isoformat(),
            "address": "Herzl 1, Tel Aviv", **kw}
    return body
