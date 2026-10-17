"""Staff deletion must not erase history (proposed/009). Isolated Postgres, synthetic data only."""
import psycopg
import pytest

from tests_db.conftest import as_postgres, as_user
from tests_db.test_db_guards import T0, insert_booking, seed
from tests_db.test_visit_report_integrity import COMPLETE, attempt, booking

AT2 = "2030-01-07 12:00:00+00"


def completed_visit(db, d):
    bid = booking(db, d)
    as_user(db, d["staff_user"])
    rid = db.execute("select id from complete_visit(%s, %s::jsonb)", (bid, COMPLETE)).fetchone()[0]
    return bid, rid


def counts(db, bid, rid):
    as_postgres(db)
    db.execute("select set_config('request.jwt.claims', '', true)")
    return (db.execute("select count(*) from bookings where id=%s", (bid,)).fetchone()[0],
            db.execute("select count(*) from visit_reports where id=%s", (rid,)).fetchone()[0])


def test_deleting_staff_with_history_is_refused_and_history_survives(db):
    d = seed(db); bid, rid = completed_visit(db, d)
    as_user(db, d["admin"], admin=True)
    attempt(db, "delete from medical_staff where id=%s", (d["s1"],), psycopg.errors.RestrictViolation)
    assert counts(db, bid, rid) == (1, 1)


def test_even_a_superuser_cannot_cascade_away_history(db):
    d = seed(db); bid, rid = completed_visit(db, d)
    as_postgres(db)
    attempt(db, "delete from medical_staff where id=%s", (d["s1"],), psycopg.errors.RestrictViolation)
    assert counts(db, bid, rid) == (1, 1)


def test_staff_without_any_history_can_still_be_deleted(db):
    d = seed(db)
    as_user(db, d["admin"], admin=True)
    assert db.execute("delete from medical_staff where id=%s", (d["s2"],)).rowcount == 1


def test_deactivation_keeps_history_visible_to_patient_and_admin(db):
    d = seed(db); bid, rid = completed_visit(db, d)
    as_postgres(db)
    db.execute("select set_config('request.jwt.claims', '', true)")
    db.execute("update medical_staff set is_active=false where id=%s", (d["s1"],))
    as_user(db, d["pa"])
    assert db.execute("select count(*) from bookings where id=%s", (bid,)).fetchone()[0] == 1
    assert db.execute("select count(*) from visit_reports where id=%s", (rid,)).fetchone()[0] == 1
    assert db.execute("select full_name, is_active from medical_staff where id=%s", (d["s1"],)).fetchone() == ("אחות א", False)
    as_user(db, d["pb"])                                               # a patient with no booking with her still cannot see her
    assert db.execute("select count(*) from medical_staff where id=%s", (d["s1"],)).fetchone()[0] == 0
    as_user(db, d["admin"], admin=True)
    assert db.execute("select count(*) from bookings b join medical_staff s on s.id=b.staff_id where b.id=%s", (bid,)).fetchone()[0] == 1


def deactivate(db, d, key="s1"):
    as_postgres(db)
    db.execute("select set_config('request.jwt.claims', '', true)")
    db.execute("update medical_staff set is_active=false where id=%s", (d[key],))


def test_inactive_staff_gets_no_new_booking_from_patient_or_admin(db):
    d = seed(db); deactivate(db, d)
    as_user(db, d["pa"])
    attempt(db, "insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address) values (%s,%s,'checkup',%s,'רחוב 1')",
            (d["pa"], d["s1"], T0), psycopg.errors.CheckViolation)
    as_user(db, d["admin"], admin=True)
    attempt(db, "insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address) values (%s,%s,'checkup',%s,'רחוב 1')",
            (d["pa"], d["s1"], T0), psycopg.errors.CheckViolation)


def test_admin_cannot_reassign_to_inactive_staff_but_can_to_active(db):
    d = seed(db)
    as_user(db, d["pa"]); bid, _ = insert_booking(db, d["pa"], d["s1"], T0)
    deactivate(db, d, "s2")
    as_user(db, d["admin"], admin=True)
    attempt(db, "update bookings set staff_id=%s where id=%s", (d["s2"], bid), psycopg.errors.CheckViolation)
    as_postgres(db); db.execute("select set_config('request.jwt.claims', '', true)")
    db.execute("update medical_staff set is_active=true where id=%s", (d["s2"],))
    as_user(db, d["admin"], admin=True)
    db.execute("update bookings set staff_id=%s where id=%s", (d["s2"], bid))


def test_existing_bookings_of_inactive_staff_stay_manageable_by_admin(db):
    d = seed(db)
    as_user(db, d["pa"]); bid, _ = insert_booking(db, d["pa"], d["s1"], T0)
    deactivate(db, d)
    as_user(db, d["admin"], admin=True)
    db.execute("update bookings set approval_status='confirmed' where id=%s", (bid,))     # not a staff_id change: allowed
    assert db.execute("select approval_status from bookings where id=%s", (bid,)).fetchone()[0] == "confirmed"


def test_completion_path_still_works_for_active_staff_and_for_admin_after_deactivation(db):
    d = seed(db)
    bid, rid = completed_visit(db, d)                                  # active nurse completes: unchanged
    assert counts(db, bid, rid) == (1, 1)
    bid2 = booking(db, d, patient="pb", at=AT2)
    deactivate(db, d)
    as_user(db, d["staff_user"])                                       # deactivated nurse no longer acts as staff
    attempt(db, "select complete_visit(%s, %s::jsonb)", (bid2, COMPLETE), psycopg.errors.InsufficientPrivilege)
    as_user(db, d["admin"], admin=True)                                # an admin closes the open visit
    assert db.execute("select treatment_summary from complete_visit(%s, %s::jsonb)", (bid2, COMPLETE)).fetchone()[0] == "סינתטי"
