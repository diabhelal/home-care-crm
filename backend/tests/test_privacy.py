"""Other patients' addresses/coordinates must never leave the repository layer."""
from datetime import timedelta

from app.fake_repo import FakeRepo
from app.models import Booking, Staff
from tests.conftest import local


def _repo():
    r = FakeRepo()
    r.staff[1] = Staff(1, "A", "nurse", slot_minutes=60)
    r.bookings[1] = Booking(1, "other-patient", 1, "checkup", local(18, 10),
                            visit_address="Secret St 5, Haifa", visit_lat=32.8, visit_lng=34.99)
    return r


def test_other_patient_address_and_coords_are_hidden():
    out = _repo().list_active_bookings(1, local(18, 9), local(18, 12), "Different St 1")
    assert len(out) == 1
    assert out[0].visit_address is None
    assert out[0].visit_lat is None and out[0].visit_lng is None


def test_matching_address_is_visible_only_as_the_requested_string():
    out = _repo().list_active_bookings(1, local(18, 9), local(18, 12), "  secret st 5,   HAIFA ")
    assert out[0].visit_address == "  secret st 5,   HAIFA "  # echo of the caller's own input


def test_no_address_requested_reveals_nothing():
    out = _repo().list_active_bookings(1, local(18, 9), local(18, 12))
    assert out[0].visit_address is None
