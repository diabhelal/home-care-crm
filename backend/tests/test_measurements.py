"""POST /patients/{id}/measurements: a reading added outside a booking (proposed/020)."""
from datetime import timedelta

from tests.conftest import H, NOW, local, req

TAKEN = (NOW - timedelta(days=1)).isoformat()


def assigned_world(world):
    """patient p1 requests, admin approves, booking is assigned to staff 1 (Nurse A)."""
    b = world.client.post("/bookings/request", json=req(local(18, 9), staff_id=1), headers=H("patient")).json()
    world.client.post(f"/admin/bookings/{b['id']}/approve", headers=H("admin"))
    return b


def body(**kw):
    return {"measured_at": TAKEN, "systolic_bp": 130, "pulse": 80, **kw}


def test_assigned_staff_adds_a_reading_and_both_times_are_kept(world):
    assigned_world(world)
    r = world.client.post("/patients/p1/measurements", json=body(note="  מדידה בבית  "), headers=H("staff1"))
    assert r.status_code == 201
    m = r.json()["measurement"]
    assert m["patient_id"] == "p1" and m["systolic_bp"] == 130 and m["note"] == "מדידה בבית"
    assert m["measured_at"].startswith((NOW - timedelta(days=1)).strftime("%Y-%m-%d"))   # the time the user gave
    assert str(m["recorded_at"]).startswith(NOW.strftime("%Y-%m-%d"))                      # the server's entry time
    assert m["recorded_by"] == "staff-1" and m["recorded_by_role"] == "nurse"


def test_client_cannot_set_the_entry_time_or_author(world):
    assigned_world(world)
    r = world.client.post("/patients/p1/measurements", headers=H("staff1"),
                          json=body(recorded_at="2001-01-01T00:00:00Z", recorded_by="x", recorded_by_role="admin"))
    m = r.json()["measurement"]
    assert m["recorded_by"] == "staff-1" and m["recorded_by_role"] == "nurse" and str(m["recorded_at"]).startswith("2026")


def test_unassigned_staff_gets_403_and_nothing_is_stored(world):
    assigned_world(world)
    r = world.client.post("/patients/p1/measurements", json=body(), headers=H("staff2"))
    assert r.status_code == 403 and world.repo.measurements == []


def test_patient_cannot_write(world):
    assigned_world(world)
    r = world.client.post("/patients/p1/measurements", json=body(), headers=H("patient"))
    assert r.status_code == 403 and world.repo.measurements == []


def test_cancelled_booking_is_not_a_care_relationship(world):
    b = assigned_world(world)
    world.client.post(f"/admin/bookings/{b['id']}/cancel", headers=H("admin"))
    r = world.client.post("/patients/p1/measurements", json=body(), headers=H("staff1"))
    assert r.status_code == 403


def test_admin_can_add(world):
    r = world.client.post("/patients/p9/measurements", json=body(), headers=H("admin"))
    assert r.status_code == 201 and r.json()["measurement"]["recorded_by_role"] == "admin"


def test_validation(world):
    assigned_world(world)
    post = lambda **kw: world.client.post("/patients/p1/measurements", json=body(**kw), headers=H("staff1"))
    assert post(measured_at="2026-10-13T09:00:00").status_code == 422                       # no timezone
    assert post(systolic_bp=999).status_code == 422                                          # out of range
    assert post(measured_at=(NOW + timedelta(hours=1)).isoformat()).status_code == 400       # future
    assert world.client.post("/patients/p1/measurements", headers=H("staff1"),
                             json={"measured_at": TAKEN, "note": "רק הערה"}).status_code == 422   # no value
    assert world.repo.measurements == []


def test_requires_a_token(world):
    assert world.client.post("/patients/p1/measurements", json=body()).status_code == 401


def test_a_completed_visit_report_is_untouched(world):
    b = assigned_world(world)
    world.client.post(f"/staff/bookings/{b['id']}/check-in", headers=H("staff1"))
    done = world.client.post(f"/staff/visits/{b['id']}/complete", headers=H("staff1"),
                             json={"treatment_summary": "ביקור", "pulse": 70}).json()["report"]
    before = dict(world.repo.get_visit_report(done["id"]))
    world.client.post("/patients/p1/measurements", json=body(pulse=95), headers=H("staff1"))
    assert world.repo.get_visit_report(done["id"]) == before


def test_several_readings_in_one_visit_keep_their_visit_link_and_repeats_are_allowed(world):
    b = assigned_world(world)
    for i, sys_bp in enumerate((150, 140, 130, 130)):          # start / middle / end / a repeat of the same value
        t = (NOW - timedelta(hours=4 - i)).isoformat()
        r = world.client.post("/patients/p1/measurements", json=body(booking_id=b["id"], measured_at=t, systolic_bp=sys_bp),
                              headers=H("staff1"))
        assert r.status_code == 201 and r.json()["measurement"]["booking_id"] == b["id"]
    world.client.post("/patients/p1/measurements", json=body(), headers=H("staff1"))   # standalone: no link
    rows = world.repo.measurements
    assert [m["systolic_bp"] for m in rows] == [150, 140, 130, 130, 130]
    assert [m.get("booking_id") for m in rows] == [b["id"]] * 4 + [None]


def test_a_reading_cannot_be_linked_to_a_visit_of_another_patient_or_a_missing_one(world):
    assigned_world(world)
    r = world.client.post("/patients/p1/measurements", json=body(booking_id=99999), headers=H("staff1"))
    assert r.status_code == 400 and world.repo.measurements == []
