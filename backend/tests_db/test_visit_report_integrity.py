"""visit_reports integrity guard (proposed/008): the TABLE enforces booking/patient/staff consistency,
approval state, immutability and delete rules for every write path. Isolated Postgres, synthetic data only."""
import psycopg
import pytest

from tests_db.conftest import as_postgres, as_user, new_uuid
from tests_db.test_db_guards import T0, insert_booking, seed

COMPLETE = '{"systolic_bp":120,"diastolic_bp":80,"pulse":70,"treatment_summary":"סינתטי"}'
DIRECT = ("insert into visit_reports(booking_id, patient_id, staff_id, treatment_summary) "
          "values (%s,%s,%s,'סינתטי') returning id")


def booking(db, d, patient="pa", staff="s1", confirmed=True, at=T0):
    as_user(db, d[patient])
    bid, _ = insert_booking(db, d[patient], d[staff], at)
    if confirmed:
        as_user(db, d["admin"], admin=True)
        db.execute("update bookings set approval_status='confirmed' where id=%s", (bid,))
    return bid


def attempt(db, sql, params, exc):
    db.execute("savepoint sp")
    with pytest.raises(exc):
        db.execute(sql, params)
    db.execute("rollback to savepoint sp")


def test_direct_insert_for_unapproved_booking_is_rejected(db):
    d = seed(db); bid = booking(db, d, confirmed=False)
    as_user(db, d["staff_user"])
    attempt(db, DIRECT, (bid, d["pa"], d["s1"]), psycopg.errors.ObjectNotInPrerequisiteState)


def test_direct_insert_with_wrong_patient_is_rejected(db):
    d = seed(db); bid = booking(db, d)
    as_user(db, d["staff_user"])
    attempt(db, DIRECT, (bid, d["pb"], d["s1"]), psycopg.errors.InsufficientPrivilege)


def test_direct_insert_for_another_nurses_booking_is_rejected(db):
    d = seed(db); bid = booking(db, d, staff="s2")
    as_user(db, d["staff_user"])                      # nurse s1 claims a booking of s2, using her own staff_id
    attempt(db, DIRECT, (bid, d["pa"], d["s1"]), psycopg.errors.InsufficientPrivilege)
    attempt(db, DIRECT, (bid, d["pa"], d["s2"]), psycopg.errors.InsufficientPrivilege)


def test_admin_cannot_attach_a_report_to_a_mismatched_patient_either(db):
    d = seed(db); bid = booking(db, d)
    as_user(db, d["admin"], admin=True)
    attempt(db, DIRECT, (bid, d["pb"], d["s1"]), psycopg.errors.InsufficientPrivilege)


def test_valid_direct_insert_for_confirmed_scheduled_booking_is_allowed(db):
    d = seed(db); bid = booking(db, d)
    as_user(db, d["staff_user"])
    assert db.execute(DIRECT, (bid, d["pa"], d["s1"])).fetchone()[0]


def test_complete_visit_path_still_works_and_can_resave_before_completion(db):
    d = seed(db); bid = booking(db, d)
    as_user(db, d["staff_user"])
    rep = db.execute("select treatment_summary from complete_visit(%s, %s::jsonb)", (bid, COMPLETE)).fetchone()
    assert rep[0] == "סינתטי"
    assert db.execute("select status from bookings where id=%s", (bid,)).fetchone()[0] == "completed"


def test_completed_report_content_is_locked_but_clinical_outcome_can_be_recorded(db):
    d = seed(db); bid = booking(db, d)
    as_user(db, d["staff_user"])
    rid = db.execute("select id from complete_visit(%s, %s::jsonb)", (bid, COMPLETE)).fetchone()[0]
    attempt(db, "update visit_reports set treatment_summary='אחר' where id=%s", (rid,), psycopg.errors.ObjectNotInPrerequisiteState)
    attempt(db, "update visit_reports set pulse=40 where id=%s", (rid,), psycopg.errors.ObjectNotInPrerequisiteState)
    db.execute("update visit_reports set clinical_outcome_8h='none' where id=%s", (rid,))
    as_user(db, d["admin"], admin=True)
    attempt(db, "update visit_reports set treatment_summary='אחר' where id=%s", (rid,), psycopg.errors.ObjectNotInPrerequisiteState)
    db.execute("update visit_reports set clinical_outcome_8h='hypoglycemia' where id=%s", (rid,))


def test_report_identity_is_immutable(db):
    d = seed(db); bid = booking(db, d)
    as_user(db, d["staff_user"])
    rid = db.execute(DIRECT, (bid, d["pa"], d["s1"])).fetchone()[0]
    attempt(db, "update visit_reports set patient_id=%s where id=%s", (d["pb"], rid), psycopg.errors.InsufficientPrivilege)
    other = booking(db, d, patient="pb", at="2030-01-07 12:00:00+00")
    as_user(db, d["staff_user"])
    attempt(db, "update visit_reports set booking_id=%s where id=%s", (other, rid), psycopg.errors.InsufficientPrivilege)


def test_staff_cannot_delete_a_report_but_admin_can(db):
    d = seed(db); bid = booking(db, d)
    as_user(db, d["staff_user"])
    rid = db.execute("select id from complete_visit(%s, %s::jsonb)", (bid, COMPLETE)).fetchone()[0]
    attempt(db, "delete from visit_reports where id=%s", (rid,), psycopg.errors.InsufficientPrivilege)
    as_postgres(db)
    assert db.execute("select count(*) from visit_reports where id=%s", (rid,)).fetchone()[0] == 1
    as_user(db, d["admin"], admin=True)
    assert db.execute("delete from visit_reports where id=%s", (rid,)).rowcount == 1


def test_other_nurse_cannot_touch_a_report(db):
    d = seed(db); bid = booking(db, d)
    as_user(db, d["staff_user"])
    rid = db.execute("select id from complete_visit(%s, %s::jsonb)", (bid, COMPLETE)).fetchone()[0]
    other = new_uuid()
    as_postgres(db)
    db.execute("insert into auth.users(id) values (%s)", (other,))
    db.execute("insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id) values ('אחות ג','nurse',60,%s)", (other,))
    as_user(db, other)
    assert db.execute("delete from visit_reports where id=%s", (rid,)).rowcount == 0     # RLS hides the row
    assert db.execute("update visit_reports set clinical_outcome_8h='none' where id=%s", (rid,)).rowcount == 0


def test_no_jwt_subject_is_unrestricted_like_other_guards(db):
    d = seed(db); bid = booking(db, d, confirmed=False)
    as_postgres(db)
    db.execute("select set_config('request.jwt.claims', '', true)")          # no JWT subject
    assert db.execute(DIRECT, (bid, d["pb"], d["s1"])).fetchone()[0]       # migrations / SQL editor are not restricted
