import json
from datetime import datetime, timezone

import httpx
import pytest

from app.errors import SlotTakenError
from app.models import Booking
from app.supabase_repo import SupabaseRepo

JWT = "caller.jwt.value"


def make(handler):
    return SupabaseRepo("https://x.supabase.co", "anon-key", JWT,
                        transport=httpx.MockTransport(handler))


def test_insert_uses_caller_jwt_and_path():
    seen = {}
    def h(req):
        seen["req"] = req
        row = json.loads(req.content)
        return httpx.Response(201, json=[{**row, "id": 5}])
    b = Booking(None, "p1", 1, "checkup", datetime(2026, 10, 18, 6, tzinfo=timezone.utc),
                visit_address="A st", idempotency_key="k")
    out = make(h).insert_booking(b)
    r = seen["req"]
    assert r.method == "POST" and str(r.url) == "https://x.supabase.co/rest/v1/bookings"
    assert r.headers["authorization"] == f"Bearer {JWT}"
    assert r.headers["apikey"] == "anon-key"
    assert r.headers["prefer"] == "return=representation"
    body = json.loads(r.content)
    assert body["approval_status"] == "requested" and body["idempotency_key"] == "k"
    assert out.id == 5


def test_unique_violation_maps():
    def h(req):
        return httpx.Response(409, json={"code": "23505", "message": "duplicate key"})
    b = Booking(None, "p1", 1, "checkup", datetime(2026, 10, 18, 6, tzinfo=timezone.utc))
    with pytest.raises(SlotTakenError):
        make(h).insert_booking(b)


def test_get_staff_query_filters():
    seen = {}
    def h(req):
        seen["url"] = req.url
        return httpx.Response(200, json=[])
    assert make(h).get_staff_by_auth_user("u-1") is None
    assert seen["url"].params["auth_user_id"] == "eq.u-1"
    assert "service_role" not in str(seen)


def test_rpc_check_in_and_complete():
    calls = []
    def h(req):
        calls.append((req.url.path, json.loads(req.content), req.headers["authorization"]))
        if req.url.path.endswith("check_in_visit"):
            return httpx.Response(200, json={
                "id": 1, "patient_id": "p", "staff_id": 1, "visit_purpose": "checkup",
                "scheduled_at": "2026-10-18T06:00:00+00:00",
                "checked_in_at": "2026-10-18T06:01:00+00:00"})
        return httpx.Response(200, json={"booking_id": 1})
    repo = make(h)
    assert repo.check_in(1).checked_in_at is not None
    repo.complete_visit_atomic(1, {"treatment_summary": "x"})
    assert calls[0][:2] == ("/rest/v1/rpc/check_in_visit", {"p_booking_id": 1})
    assert calls[1][:2] == ("/rest/v1/rpc/complete_visit",
                            {"p_booking_id": 1, "p_payload": {"treatment_summary": "x"}})
    assert all(c[2] == f"Bearer {JWT}" for c in calls)


def test_update_patch_filter():
    seen = {}
    def h(req):
        seen["req"] = req
        return httpx.Response(200, json=[{
            "id": 3, "patient_id": "p", "staff_id": 2, "visit_purpose": "checkup",
            "scheduled_at": "2026-10-18T06:00:00Z", "approval_status": "confirmed"}])
    out = make(h).update_booking(3, {"approval_status": "confirmed"})
    assert seen["req"].method == "PATCH" and seen["req"].url.params["id"] == "eq.3"
    assert out.approval_status == "confirmed"


def test_update_cancel_patch_body_and_rls_empty_result():
    import pytest
    from app.errors import DomainError
    seen = {}
    def h(req):
        seen["body"] = req.content
        return httpx.Response(200, json=[])
    with pytest.raises(DomainError) as e:
        make(h).update_booking(3, {"status": "cancelled"})
    assert e.value.status == 403 and seen["body"] == b'{"status":"cancelled"}'


def test_db_errors_map_to_domain_errors():
    import pytest
    from app.errors import DomainError
    for pg, status in (("42501", 403), ("55000", 409), ("P0002", 404)):
        def h(req, pg=pg):
            return httpx.Response(400, json={"code": pg, "message": "x"})
        with pytest.raises(DomainError) as e:
            make(h).complete_visit_atomic(1, {})
        assert e.value.status == status
