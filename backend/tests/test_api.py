from datetime import timedelta

from tests.conftest import H, NOW, local, req

NOW_LATER = NOW + timedelta(hours=1)


def test_missing_token_401(world):
    r = world.client.post("/bookings/request", json=req(local(18, 9)))
    assert r.status_code == 401


def test_invalid_token_401(world):
    r = world.client.post("/bookings/request", json=req(local(18, 9)), headers=H("nope"))
    assert r.status_code == 401


def test_guest_can_request_starts_requested(world):
    r = world.client.post("/bookings/request", json=req(local(18, 9)), headers=H("patient"))
    assert r.status_code == 201
    j = r.json()
    assert j["approval_status"] == "requested" and j["display_state"] == "requested"
    assert j["patient_id"] == "p1"


def test_spoofed_ids_ignored(world):
    body = req(local(18, 9), patient_id="victim", user_id="victim", is_admin=True,
               auth_user_id="staff-2")
    r = world.client.post("/bookings/request", json=body, headers=H("patient"))
    assert r.json()["patient_id"] == "p1"


def test_spoofed_staff_identity_in_body_ignored(world):
    b = world.client.post("/bookings/request", json=req(local(18, 9), staff_id=1),
                          headers=H("patient")).json()
    world.client.post(f"/admin/bookings/{b['id']}/approve", headers=H("admin"))
    # staff2 claims to be staff 1 in the body: still forbidden
    r = world.client.post(f"/staff/bookings/{b['id']}/check-in", json={"staff_id": 1},
                          headers=H("staff2"))
    assert r.status_code == 403


def test_purpose_not_offered(world):
    r = world.client.post("/bookings/request",
                          json=req(local(18, 9), purpose="physiotherapy"), headers=H("patient"))
    assert r.status_code == 400 and r.json()["code"] == "purpose_not_offered"


def test_address_required(world):
    body = req(local(18, 9)); body["address"] = ""
    assert world.client.post("/bookings/request", json=body, headers=H("patient")).status_code == 422
    del body["address"]
    assert world.client.post("/bookings/request", json=body, headers=H("patient")).status_code == 422


def test_idempotency_same_key_same_booking(world):
    h = H("patient", "key-1")
    a = world.client.post("/bookings/request", json=req(local(18, 9)), headers=h)
    b = world.client.post("/bookings/request", json=req(local(18, 9)), headers=h)
    assert a.status_code == 201 and b.status_code == 200
    assert a.json()["id"] == b.json()["id"]
    assert len(world.repo.bookings) == 1


def test_idempotency_scoped_per_patient(world):
    world.client.post("/bookings/request", json=req(local(18, 9)), headers=H("patient", "k"))
    r = world.client.post("/bookings/request", json=req(local(18, 11)), headers=H("patient2", "k"))
    assert r.status_code == 201 and len(world.repo.bookings) == 2


def test_double_booking_409_hebrew(world):
    world.client.post("/bookings/request", json=req(local(18, 9), staff_id=1), headers=H("patient"))
    r = world.client.post("/bookings/request", json=req(local(18, 9), staff_id=1), headers=H("patient2"))
    assert r.status_code == 409
    assert r.json()["detail"] == "המטפל אינו פנוי בשעה זו, אנא בחר משבצת זמן אחרת"


def test_db_unique_violation_maps_to_409(world, monkeypatch):
    from app.errors import SlotTakenError
    def boom(b): raise SlotTakenError()
    monkeypatch.setattr(world.repo, "insert_booking", boom)
    r = world.client.post("/bookings/request", json=req(local(18, 9), staff_id=1), headers=H("patient"))
    assert r.status_code == 409 and r.json()["code"] == "slot_taken"


def test_buffer_enforced_in_request(world):
    world.client.post("/bookings/request", json=req(local(18, 9), staff_id=1), headers=H("patient"))
    r = world.client.post("/bookings/request",
                          json=req(local(18, 10), staff_id=1, address="Other 5, Haifa"),
                          headers=H("patient2"))
    assert r.status_code == 409  # 10:00 starts right at end of 9-10 visit, other address
    r = world.client.post("/bookings/request", json=req(local(18, 10), staff_id=1),
                          headers=H("patient2"))
    assert r.status_code == 201  # same address -> no buffer


def test_non_working_day_rejected(world):
    r = world.client.post("/bookings/request", json=req(local(16, 9), staff_id=1), headers=H("patient"))
    assert r.status_code == 409


def test_non_nurse_staff_not_eligible(world):
    r = world.client.post("/bookings/request", json=req(local(18, 9), staff_id=3), headers=H("patient"))
    assert r.status_code == 400


def test_auto_assignment_deterministic_lowest_id(world):
    r = world.client.post("/bookings/request", json=req(local(18, 9)), headers=H("patient"))
    assert r.json()["staff_id"] == 1


def test_auto_assignment_prefers_lower_load(world):
    # staff 1 already has a visit that day -> staff 2 picked at a free time
    world.client.post("/bookings/request", json=req(local(18, 9), staff_id=1), headers=H("patient"))
    r = world.client.post("/bookings/request", json=req(local(18, 14)), headers=H("patient2"))
    assert r.json()["staff_id"] == 2


def test_auto_assignment_skips_busy_staff(world):
    world.client.post("/bookings/request", json=req(local(18, 9), staff_id=1), headers=H("patient"))
    r = world.client.post("/bookings/request", json=req(local(18, 9)), headers=H("patient2"))
    assert r.json()["staff_id"] == 2


def test_auto_assignment_proximity_when_coords(world):
    from dataclasses import replace
    from app.geo import NoopGeocoder
    from app.main import create_app
    from app.config import Settings
    from fastapi.testclient import TestClient
    from tests.conftest import NOW
    world.repo.staff[1] = replace(world.repo.staff[1], base_lat=32.5, base_lng=34.9)  # far
    world.repo.staff[2] = replace(world.repo.staff[2], base_lat=32.08, base_lng=34.78)  # near
    class G:
        def geocode(self, a): return (32.07, 34.79)
    app = create_app(Settings(), verifier=world.verifier, repo_factory=lambda j: world.repo,
                     geocoder=G(), clock=lambda: NOW)
    r = TestClient(app).post("/bookings/request", json=req(local(18, 9)), headers=H("patient"))
    assert r.json()["staff_id"] == 2
    assert r.json()["id"] and world.repo.bookings[r.json()["id"]].visit_lat == 32.07


def test_availability_excludes_taken_and_nonworking(world):
    world.client.post("/bookings/request", json=req(local(18, 9), staff_id=1), headers=H("patient"))
    r = world.client.get("/availability", params={"start": "2026-10-16", "end": "2026-10-18",
                                                  "staff_id": 1}, headers=H("patient"))
    starts = [s["start"] for s in r.json()["slots"]]
    assert local(18, 9).isoformat() not in starts      # taken
    assert local(18, 10).isoformat() not in starts     # unknown address treated as different -> buffer
    assert local(18, 11).isoformat() in starts
    assert not any(s.startswith("2026-10-16") or s.startswith("2026-10-17") for s in starts)


def test_availability_buffer_applies_to_different_address(world):
    world.client.post("/bookings/request", json=req(local(18, 9), staff_id=1), headers=H("patient"))
    r = world.client.get("/availability", params={
        "start": "2026-10-18", "end": "2026-10-18", "staff_id": 1,
        "address": "Herzl 1, Tel Aviv"}, headers=H("patient"))
    starts = [s["start"] for s in r.json()["slots"]]
    assert local(18, 10).isoformat() in starts  # same address
    r = world.client.get("/availability", params={
        "start": "2026-10-18", "end": "2026-10-18", "staff_id": 1,
        "address": "Elsewhere 9"}, headers=H("patient"))
    starts = [s["start"] for s in r.json()["slots"]]
    assert local(18, 10).isoformat() not in starts  # adjacent, different address
    assert local(18, 11).isoformat() in starts


def test_availability_any_nurse_lists_staff_ids(world):
    r = world.client.get("/availability", params={"start": "2026-10-18", "end": "2026-10-18"},
                         headers=H("patient"))
    assert r.json()["slots"][0]["staff_ids"] == [1, 2]  # doctor excluded


# ---- admin
def _new(world, staff_id=1, at=None):
    return world.client.post("/bookings/request",
                             json=req(at or local(18, 9), staff_id=staff_id),
                             headers=H("patient")).json()["id"]


def test_admin_routes_forbidden_for_non_admin(world):
    bid = _new(world)
    for who in ("patient", "staff1"):
        for path in ("approve", "reject"):
            assert world.client.post(f"/admin/bookings/{bid}/{path}", headers=H(who)).status_code == 403
    assert world.client.post(f"/admin/bookings/{bid}/reassign", json={"staff_id": 2},
                             headers=H("patient")).status_code == 403


def test_approve_then_reapprove_409(world):
    bid = _new(world)
    r = world.client.post(f"/admin/bookings/{bid}/approve", headers=H("admin"))
    assert r.json()["display_state"] == "confirmed"
    assert world.client.post(f"/admin/bookings/{bid}/approve", headers=H("admin")).status_code == 409
    assert world.client.post(f"/admin/bookings/{bid}/reject", headers=H("admin")).status_code == 409


def test_reject_frees_slot(world):
    bid = _new(world)
    r = world.client.post(f"/admin/bookings/{bid}/reject", headers=H("admin"))
    assert r.json()["display_state"] == "rejected"
    assert _new(world) is not None  # same slot bookable again


def test_reassign_rechecks_conflict(world):
    a = _new(world, 1)
    _new(world, 2)  # staff 2 busy at same time
    r = world.client.post(f"/admin/bookings/{a}/reassign", json={"staff_id": 2}, headers=H("admin"))
    assert r.status_code == 409


def test_reassign_rechecks_buffer(world):
    a = _new(world, 1, local(18, 9))
    world.client.post("/bookings/request",
                      json=req(local(18, 10), staff_id=2, address="Far 7, Haifa"), headers=H("patient2"))
    # moving a (9-10, Herzl) onto staff 2 who has 10-11 elsewhere -> buffer violation
    r = world.client.post(f"/admin/bookings/{a}/reassign", json={"staff_id": 2}, headers=H("admin"))
    assert r.status_code == 409


def test_reassign_ok(world):
    a = _new(world, 1)
    r = world.client.post(f"/admin/bookings/{a}/reassign", json={"staff_id": 2}, headers=H("admin"))
    assert r.status_code == 200 and r.json()["staff_id"] == 2


# ---- staff
def _confirmed(world):
    bid = _new(world)
    world.client.post(f"/admin/bookings/{bid}/approve", headers=H("admin"))
    return bid


def test_checkin_server_time_and_idempotent(world):
    from tests.conftest import NOW
    bid = _confirmed(world)
    r = world.client.post(f"/staff/bookings/{bid}/check-in",
                          json={"checked_in_at": "1999-01-01T00:00:00Z"}, headers=H("staff1"))
    assert r.status_code == 200
    assert r.json()["checked_in_at"] == NOW.isoformat()
    assert r.json()["display_state"] == "in_progress"
    r2 = world.client.post(f"/staff/bookings/{bid}/check-in", headers=H("staff1"))
    assert r2.status_code == 200 and r2.json()["checked_in_at"] == NOW.isoformat()


def test_checkin_other_staff_403_non_staff_403(world):
    bid = _confirmed(world)
    assert world.client.post(f"/staff/bookings/{bid}/check-in", headers=H("staff2")).status_code == 403
    assert world.client.post(f"/staff/bookings/{bid}/check-in", headers=H("patient")).status_code == 403


def test_checkin_unapproved_409(world):
    bid = _new(world)
    assert world.client.post(f"/staff/bookings/{bid}/check-in", headers=H("staff1")).status_code == 409


REPORT = {"treatment_summary": "ok", "systolic_bp": 120, "diastolic_bp": 80, "pulse": 70,
          "temperature": 36.6, "oxygen_saturation": 98, "blood_sugar": 100}


def test_complete_atomic_call(world):
    bid = _confirmed(world)
    r = world.client.post(f"/staff/visits/{bid}/complete", json=REPORT, headers=H("staff1"))
    assert r.status_code == 200
    assert world.repo.complete_calls == 1
    assert world.repo.bookings[bid].status == "completed"
    assert world.repo.reports[bid]["staff_id"] == 1


def test_complete_twice_409(world):
    bid = _confirmed(world)
    world.client.post(f"/staff/visits/{bid}/complete", json=REPORT, headers=H("staff1"))
    r = world.client.post(f"/staff/visits/{bid}/complete", json=REPORT, headers=H("staff1"))
    assert r.status_code == 409 and world.repo.complete_calls == 1


def test_complete_unapproved_409(world):
    bid = _new(world)
    assert world.client.post(f"/staff/visits/{bid}/complete", json=REPORT,
                             headers=H("staff1")).status_code == 409


def test_complete_other_staff_403(world):
    bid = _confirmed(world)
    assert world.client.post(f"/staff/visits/{bid}/complete", json=REPORT,
                             headers=H("staff2")).status_code == 403


import pytest

@pytest.mark.parametrize("field,val", [
    ("systolic_bp", 251), ("systolic_bp", 49), ("diastolic_bp", 151), ("diastolic_bp", 29),
    ("blood_sugar", 601), ("blood_sugar", 19), ("pulse", 29), ("pulse", 221),
    ("temperature", 45.1), ("temperature", 29.9), ("oxygen_saturation", 101),
    ("oxygen_saturation", 49),
])
def test_vitals_out_of_range_422(world, field, val):
    bid = _confirmed(world)
    r = world.client.post(f"/staff/visits/{bid}/complete", json={**REPORT, field: val},
                          headers=H("staff1"))
    assert r.status_code == 422 and world.repo.complete_calls == 0


def test_vitals_boundaries_accepted(world):
    bid = _confirmed(world)
    r = world.client.post(f"/staff/visits/{bid}/complete",
                          json={**REPORT, "systolic_bp": 250, "temperature": 30.0},
                          headers=H("staff1"))
    assert r.status_code == 200


# ---- cancel
def _cancel(world, bid, who="patient"):
    return world.client.post(f"/bookings/{bid}/cancel", headers=H(who))


def test_patient_cancels_own_requested_and_frees_slot(world):
    bid = _new(world)
    r = _cancel(world, bid)
    assert r.status_code == 200 and r.json()["display_state"] == "cancelled"
    assert world.repo.bookings[bid].status == "cancelled"
    assert _new(world) is not None  # same slot bookable again


def test_patient_cancels_confirmed(world):
    bid = _confirmed(world)
    assert _cancel(world, bid).json()["status"] == "cancelled"


def test_other_patient_cannot_cancel_404_and_nothing_changes(world):
    bid = _new(world)
    r = _cancel(world, bid, "patient2")
    assert r.status_code == 404
    assert world.repo.bookings[bid].status == "scheduled"


def test_cancel_requires_auth(world):
    bid = _new(world)
    assert world.client.post(f"/bookings/{bid}/cancel").status_code == 401


def test_staff_cannot_use_patient_cancel(world):
    bid = _confirmed(world)
    assert _cancel(world, bid, "staff1").status_code == 404
    assert world.repo.bookings[bid].status == "scheduled"


def test_cancel_completed_409(world):
    bid = _confirmed(world)
    world.client.post(f"/staff/visits/{bid}/complete", json=REPORT, headers=H("staff1"))
    assert _cancel(world, bid).status_code == 409
    assert world.client.post(f"/admin/bookings/{bid}/cancel", headers=H("admin")).status_code == 409
    assert world.repo.bookings[bid].status == "completed"


def test_patient_cannot_cancel_after_check_in_409(world):
    bid = _confirmed(world)
    world.client.post(f"/staff/bookings/{bid}/check-in", headers=H("staff1"))
    assert _cancel(world, bid).status_code == 409
    assert world.repo.bookings[bid].status == "scheduled"


def test_cancel_idempotent(world):
    bid = _new(world)
    assert _cancel(world, bid).status_code == 200
    r = _cancel(world, bid)
    assert r.status_code == 200 and r.json()["display_state"] == "cancelled"


def test_admin_cancel_ok_incl_checked_in_and_idempotent(world):
    bid = _confirmed(world)
    world.client.post(f"/staff/bookings/{bid}/check-in", headers=H("staff1"))
    r = world.client.post(f"/admin/bookings/{bid}/cancel", headers=H("admin"))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert world.client.post(f"/admin/bookings/{bid}/cancel", headers=H("admin")).status_code == 200


def test_admin_cancel_forbidden_for_non_admin_and_missing_404(world):
    bid = _new(world)
    for who in ("patient", "patient2", "staff1"):
        assert world.client.post(f"/admin/bookings/{bid}/cancel", headers=H(who)).status_code == 403
    assert world.client.post("/admin/bookings/9999/cancel", headers=H("admin")).status_code == 404
    assert world.repo.bookings[bid].status == "scheduled"


# ---- complete: browser payload contract
BROWSER_PAYLOAD = {  # exactly what employee.html/admin.html send today (+ extras to be ignored)
    "booking_id": 1, "patient_id": "p1", "staff_id": 1,
    "systolic_bp": 128, "diastolic_bp": 82, "blood_sugar": None, "pulse": 74,
    "temperature": 36.8, "oxygen_saturation": None,
    "treatment_summary": "סיכום טיפול",
    "patient_signature_data": "data:image/png;base64,iVBORw0KGgo=",
    "performed_blood_draw": True, "performed_injection": False, "performed_infusion": False,
    "performed_dressing_change": False, "performed_catheter_change": True,
}


def test_complete_accepts_browser_payload_with_nulls_and_extras(world):
    bid = _confirmed(world)
    r = world.client.post(f"/staff/visits/{bid}/complete",
                          json={**BROWSER_PAYLOAD, "staff_id": 2, "patient_id": "victim"},
                          headers=H("staff1"))
    assert r.status_code == 200
    rep = world.repo.reports[bid]
    assert rep["patient_signature_data"].startswith("data:image/png")
    assert rep["performed_catheter_change"] is True and rep["blood_sugar"] is None
    assert rep["staff_id"] == 1 and rep["patient_id"] == "p1"   # identity not taken from body
    assert r.json()["report"]["id"]


def test_complete_non_integer_vital_422(world):
    bid = _confirmed(world)
    r = world.client.post(f"/staff/visits/{bid}/complete",
                          json={**BROWSER_PAYLOAD, "blood_sugar": 105.5}, headers=H("staff1"))
    assert r.status_code == 422 and world.repo.complete_calls == 0


def test_complete_by_admin_ok_keeps_booking_staff(world):
    bid = _confirmed(world)
    r = world.client.post(f"/staff/visits/{bid}/complete", json=REPORT, headers=H("admin"))
    assert r.status_code == 200
    assert world.repo.reports[bid]["staff_id"] == 1
    assert world.repo.bookings[bid].status == "completed"


def test_complete_by_patient_403(world):
    bid = _confirmed(world)
    assert world.client.post(f"/staff/visits/{bid}/complete", json=REPORT,
                             headers=H("patient")).status_code == 403
    assert world.repo.complete_calls == 0


def test_complete_cancelled_409(world):
    bid = _confirmed(world)
    _cancel(world, bid)
    assert world.client.post(f"/staff/visits/{bid}/complete", json=REPORT,
                             headers=H("staff1")).status_code == 409


# ---- admin check-in (same endpoint, JWT identity only)
def test_checkin_by_admin_ok_server_time_and_idempotent(world):
    from tests.conftest import NOW
    bid = _confirmed(world)
    r = world.client.post(f"/staff/bookings/{bid}/check-in",
                          json={"checked_in_at": "1999-01-01T00:00:00Z"}, headers=H("admin"))
    assert r.status_code == 200
    assert r.json()["checked_in_at"] == NOW.isoformat()
    assert r.json()["display_state"] == "in_progress"
    assert world.repo.bookings[bid].staff_id == 1  # booking keeps its own staff


def test_checkin_admin_then_staff_keeps_first_time(world):
    bid = _confirmed(world)
    first = world.client.post(f"/staff/bookings/{bid}/check-in", headers=H("admin")).json()["checked_in_at"]
    world.repo._now = lambda: NOW_LATER
    again = world.client.post(f"/staff/bookings/{bid}/check-in", headers=H("staff1"))
    assert again.status_code == 200 and again.json()["checked_in_at"] == first


def test_checkin_unassigned_staff_and_patient_403_nothing_written(world):
    bid = _confirmed(world)
    assert world.client.post(f"/staff/bookings/{bid}/check-in", headers=H("staff2")).status_code == 403
    assert world.client.post(f"/staff/bookings/{bid}/check-in", headers=H("patient2")).status_code == 403
    assert world.repo.bookings[bid].checked_in_at is None


def test_checkin_admin_unapproved_409_and_missing_404(world):
    bid = _new(world)
    assert world.client.post(f"/staff/bookings/{bid}/check-in", headers=H("admin")).status_code == 409
    assert world.client.post("/staff/bookings/9999/check-in", headers=H("admin")).status_code == 404


# ---- clinical outcome
def _report(world):
    bid = _confirmed(world)
    world.client.post(f"/staff/visits/{bid}/complete", json=REPORT, headers=H("staff1"))
    return bid  # report id == booking id in FakeRepo


def _outcome(world, rid, who, val="hypoglycemia"):
    return world.client.patch(f"/visits/{rid}/clinical-outcome",
                              json={"clinical_outcome_8h": val}, headers=H(who))


def test_outcome_assigned_staff_ok(world):
    rid = _report(world)
    r = _outcome(world, rid, "staff1")
    assert r.status_code == 200 and r.json()["report"]["clinical_outcome_8h"] == "hypoglycemia"
    assert world.repo.reports[rid]["clinical_outcome_8h"] == "hypoglycemia"


def test_outcome_admin_ok_and_null_clears(world):
    rid = _report(world)
    assert _outcome(world, rid, "admin", "none").status_code == 200
    assert _outcome(world, rid, "admin", None).status_code == 200
    assert world.repo.reports[rid]["clinical_outcome_8h"] is None


def test_outcome_other_staff_and_patient_403(world):
    rid = _report(world)
    assert _outcome(world, rid, "staff2").status_code == 403
    assert _outcome(world, rid, "patient").status_code == 403
    assert "clinical_outcome_8h" not in world.repo.reports[rid]


def test_outcome_missing_report_404_and_bad_value_422(world):
    rid = _report(world)
    assert _outcome(world, 9999, "admin").status_code == 404
    assert _outcome(world, rid, "admin", "made_up").status_code == 422
    assert _outcome(world, rid, "admin", "").status_code == 422
    assert "clinical_outcome_8h" not in world.repo.reports[rid]


def test_outcome_requires_auth(world):
    rid = _report(world)
    assert world.client.patch(f"/visits/{rid}/clinical-outcome",
                              json={"clinical_outcome_8h": "none"}).status_code == 401


def test_outcome_body_cannot_smuggle_other_columns(world):
    rid = _report(world)
    r = world.client.patch(f"/visits/{rid}/clinical-outcome",
                           json={"clinical_outcome_8h": "none", "staff_id": 2, "treatment_summary": "x"},
                           headers=H("staff1"))
    assert r.status_code == 200
    assert world.repo.reports[rid]["staff_id"] == 1 and world.repo.reports[rid]["treatment_summary"] == "ok"
