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
        return httpx.Response(409, json={"code": "23505", "message": 'duplicate key value violates unique constraint "bookings_staff_id_scheduled_at_active_key"'})
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


def test_pause_guard_error_and_pause_list_query():
    import pytest
    from app.errors import DomainError
    with pytest.raises(DomainError) as e:
        make(lambda r: httpx.Response(400, json={"code": "SV001", "message": "service_unavailable"})).complete_visit_atomic(1, {})
    assert e.value.status == 409 and e.value.code == "service_unavailable"
    seen = {}
    def h(req):
        seen["url"] = str(req.url)
        return httpx.Response(200, json=[{"purpose": "blood_test", "paused_from": None, "paused_until": None, "public_message": "x"}])
    rows = make(h).list_service_pauses()
    assert rows[0]["purpose"] == "blood_test"
    assert "/rest/v1/service_availability" in seen["url"] and "is_paused=eq.true" in seen["url"]


def test_missing_service_availability_table_means_no_pauses_not_an_error():
    """Migration 021 may not be applied on a database yet: no table = no row for any purpose = every service is available
    (the documented default). A missing optional table must not make booking requests fail."""
    for code in ("PGRST205", "42P01"):
        rows = make(lambda r, c=code: httpx.Response(404, json={"code": c, "message": "Could not find the table 'public.service_availability' in the schema cache"})).list_service_pauses()
        assert rows == []


def test_other_failures_of_the_pause_lookup_are_still_errors():
    with pytest.raises(Exception):
        make(lambda r: httpx.Response(500, json={"code": "XX000", "message": "boom"})).list_service_pauses()
    with pytest.raises(Exception):   # a 404 for some OTHER table/route is not hidden
        make(lambda r: httpx.Response(404, json={"code": "PGRST205", "message": "Could not find the table 'public.bookings'"})).list_service_pauses()


def test_clinical_outcome_patch_uses_caller_jwt_and_only_that_column():
    seen = {}
    def h(req):
        if req.method == "PATCH":
            seen["req"] = req
            return httpx.Response(200, json=[{"id": 3, "booking_id": 9, "clinical_outcome_8h": "none"}])
        return httpx.Response(200, json=[])
    repo = make(h)
    out = repo.set_clinical_outcome(3, "none")
    r = seen["req"]
    assert str(r.url).startswith("https://x.supabase.co/rest/v1/visit_reports")
    assert r.url.params["id"] == "eq.3"
    assert json.loads(r.content) == {"clinical_outcome_8h": "none"}
    assert r.headers["authorization"] == f"Bearer {JWT}"
    assert out["clinical_outcome_8h"] == "none"


def test_clinical_outcome_rls_filtered_is_forbidden():
    from app.errors import DomainError
    repo = make(lambda req: httpx.Response(200, json=[]))
    with pytest.raises(DomainError) as e:
        repo.set_clinical_outcome(3, "none")
    assert e.value.status == 403


def test_risk_rpcs_use_caller_jwt_and_params():
    calls = []
    def h(req):
        calls.append((req.url.path, json.loads(req.content), req.headers["authorization"]))
        return httpx.Response(200, json={"prediction": {"id": 1}, "alert": None, "created": True})
    repo = make(h)
    att = {"payload": "{}", "sig": "00"}
    repo.record_risk_prediction(7, att)
    repo.record_auto_alert("pid", att)
    assert calls[0] == ("/rest/v1/rpc/record_risk_prediction", {"p_report_id": 7, "p_assessment": att}, f"Bearer {JWT}")
    assert calls[1][0] == "/rest/v1/rpc/record_auto_alert" and calls[1][1]["p_patient_id"] == "pid"


def test_risk_rpc_permission_denied_maps_to_forbidden():
    from app.errors import DomainError
    repo = make(lambda r: httpx.Response(403, json={"code": "42501", "message": "x"}))
    with pytest.raises(DomainError) as e:
        repo.record_risk_prediction(1, {})
    assert e.value.status == 403


def test_update_booking_conflict_from_the_database_guard_maps_to_slot_taken():
    # proposed/010: the DB rejects an overlapping / buffer-violating UPDATE with SQLSTATE 23505
    def h(req):
        assert req.method == "PATCH"
        return httpx.Response(409, json={"code": "23505", "message": "staff member not available at this time"})
    with pytest.raises(SlotTakenError):
        make(h).update_booking(7, {"staff_id": 2})


# ---- 23505 disambiguation. Payloads below are REPRESENTATIVE of PostgREST's error JSON
# (code/message/details/hint); they were not captured from the live database.
from app.errors import DomainError, IdempotencyConflictError  # noqa: E402


def _insert_with(payload, status=409):
    b = Booking(None, "p1", 1, "checkup", datetime(2026, 10, 18, 6, tzinfo=timezone.utc))
    return make(lambda req: httpx.Response(status, json=payload)).insert_booking(b)


def test_23505_idempotency_index_is_not_a_slot_conflict():
    with pytest.raises(IdempotencyConflictError):
        _insert_with({"code": "23505", "details": "Key (patient_id, idempotency_key)=(p1, k) already exists.",
                      "message": 'duplicate key value violates unique constraint "bookings_patient_idempotency_key_uidx"'})


def test_23505_active_slot_index_is_a_slot_conflict():
    with pytest.raises(SlotTakenError):
        _insert_with({"code": "23505", "details": "Key (staff_id, scheduled_at)=(1, 2026-10-18 06:00:00+00) already exists.",
                      "message": 'duplicate key value violates unique constraint "bookings_staff_id_scheduled_at_active_key"'})


def test_23505_guard_trigger_message_is_a_slot_conflict():
    with pytest.raises(SlotTakenError):
        _insert_with({"code": "23505", "message": "staff member not available at this time"})


def test_23505_unknown_constraint_is_a_generic_server_error_not_slot_taken():
    with pytest.raises(DomainError) as e:
        _insert_with({"code": "23505", "message": 'duplicate key value violates unique constraint "some_other_key"'})
    assert e.value.status == 500 and e.value.code == "unexpected_unique_violation"
    assert "פנוי" not in e.value.message


def test_23505_without_any_constraint_info_is_not_guessed_as_slot_taken():
    with pytest.raises(DomainError) as e:
        _insert_with({"code": "23505", "message": "duplicate key"})
    assert e.value.status == 500


def test_23505_on_non_booking_rpc_is_not_slot_taken():
    r = make(lambda req: httpx.Response(409, json={
        "code": "23505", "message": 'duplicate key value violates unique constraint "alerts_dedupe_key"'}))
    with pytest.raises(DomainError) as e:
        r.record_auto_alert("p1", {})
    assert e.value.status == 500


def test_list_patient_reports_reads_newest_first_with_limit_and_returns_ascending():
    seen = {}
    def h(req):
        seen["q"] = dict(req.url.params)
        return httpx.Response(200, json=[{"visit_date": "2026-10-03"}, {"visit_date": "2026-10-02"},
                                         {"visit_date": "2026-10-01"}])
    out = make(h).list_patient_reports("p1")
    assert seen["q"]["order"] == "visit_date.desc,id.desc" and seen["q"]["limit"] == "500"
    assert [r["visit_date"] for r in out] == ["2026-10-01", "2026-10-02", "2026-10-03"]


def test_unexpected_unique_violation_logged_without_row_values(caplog):
    import logging
    with caplog.at_level(logging.WARNING, logger="app"):
        with pytest.raises(DomainError):
            _insert_with({"code": "23505", "message": 'duplicate key value violates unique constraint "zzz_key"',
                          "details": "Key (patient_id)=(SECRET-PATIENT-ID) already exists."})
    assert "zzz_key" in caplog.text and "23505" in caplog.text and "409" in caplog.text
    assert "SECRET-PATIENT-ID" not in caplog.text


def test_previous_report_and_history_use_deterministic_order():
    seen = []
    def h(req):
        seen.append(dict(req.url.params))
        return httpx.Response(200, json=[])
    r = make(h)
    r.get_previous_report("p1", 3)
    r.list_patient_reports("p1")
    assert all(q["order"] == "visit_date.desc,id.desc" for q in seen)


def test_history_tie_is_returned_ascending():
    rows = [{"id": 9, "visit_date": "2026-10-03"}, {"id": 8, "visit_date": "2026-10-03"}]
    out = make(lambda req: httpx.Response(200, json=rows)).list_patient_reports("p1")
    assert [r["id"] for r in out] == [8, 9]


def test_add_measurement_posts_with_caller_jwt_and_iso_time():
    seen = {}
    def h(req):
        seen["req"] = req
        return httpx.Response(201, json=[{**json.loads(req.content), "id": 4, "recorded_at": "2026-10-14T09:00:00Z"}])
    taken = datetime(2026, 10, 13, 8, 30, tzinfo=timezone.utc)
    out = make(h).add_measurement("p1", {"measured_at": taken, "pulse": 80, "note": None},
                                  author_user_id="u", author_role="nurse", staff_id=1)
    r = seen["req"]
    assert r.method == "POST" and str(r.url) == "https://x.supabase.co/rest/v1/patient_measurements"
    assert r.headers["authorization"] == f"Bearer {JWT}"
    body = json.loads(r.content)
    assert body == {"patient_id": "p1", "measured_at": "2026-10-13T08:30:00+00:00", "pulse": 80}   # no author/entry time from the client
    assert out["id"] == 4


def test_add_measurement_rls_or_trigger_denial_maps_to_forbidden_and_future_to_bad_request():
    from app.errors import DomainError
    repo = make(lambda req: httpx.Response(403, json={"code": "42501", "message": "not your patient"}))
    with pytest.raises(DomainError) as e:
        repo.add_measurement("p1", {"measured_at": datetime(2026, 1, 1, tzinfo=timezone.utc), "pulse": 70},
                             author_user_id="u", author_role="nurse", staff_id=1)
    assert e.value.status == 403
    repo = make(lambda req: httpx.Response(400, json={"code": "22023", "message": "measured_at cannot be in the future"}))
    with pytest.raises(DomainError) as e:
        repo.add_measurement("p1", {"measured_at": datetime(2026, 1, 1, tzinfo=timezone.utc), "pulse": 70},
                             author_user_id="u", author_role="nurse", staff_id=1)
    assert e.value.status == 400
