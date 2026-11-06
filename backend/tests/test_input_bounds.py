"""Bounded inputs and per-request resource release (review findings F2/F3/F6)."""
import pytest
from pydantic import ValidationError

from app.models import VisitReportIn
from tests.conftest import H, local, req


def test_oversized_idempotency_key_is_rejected(world):
    r = world.client.post("/bookings/request", json=req(local(18, 9), staff_id=1),
                          headers={**H("patient"), "Idempotency-Key": "k" * 129})
    assert r.status_code == 422


def test_normal_idempotency_key_still_works(world):
    r = world.client.post("/bookings/request", json=req(local(18, 9), staff_id=1),
                          headers={**H("patient"), "Idempotency-Key": "k" * 128})
    assert r.status_code in (200, 201)


def test_oversized_signature_is_rejected_and_a_normal_one_is_accepted():
    base = {"treatment_summary": "x", "systolic_bp": 120}
    with pytest.raises(ValidationError):
        VisitReportIn(**base, patient_signature_data="data:image/png;base64," + "A" * 400_001)
    assert VisitReportIn(**base, patient_signature_data="data:image/png;base64," + "A" * 50_000).patient_signature_data


def test_request_scoped_repo_is_closed_after_each_request(world):
    closed = []
    world.repo.close = lambda: closed.append(1)          # SupabaseRepo owns an httpx client; fakes have none
    world.client.post("/bookings/request", json=req(local(18, 9), staff_id=1), headers=H("patient"))
    assert closed == [1]
