"""Staff access to a patient's chart follows an ACTIVE care relationship (proposed/019). Isolated Postgres, synthetic data only.

Before 019 any booking - even a cancelled or rejected one - gave the assigned staff member permanent access to the whole chart."""
from tests_db.conftest import as_user
from tests_db.test_block_physical_deletes import no_jwt
from tests_db.test_db_guards import seed
from tests_db.test_visit_report_integrity import COMPLETE, booking


def can_read_patient(db, user, patient):
    as_user(db, user)
    return db.execute("select count(*) from patients where id = %s", (patient,)).fetchone()[0] == 1


def test_confirmed_booking_gives_access_and_other_patients_stay_hidden(db):
    d = seed(db); booking(db, d)
    assert can_read_patient(db, d["staff_user"], d["pa"])
    assert not can_read_patient(db, d["staff_user"], d["pb"])


def test_cancelled_booking_removes_access(db):
    d = seed(db); bid = booking(db, d)
    no_jwt(db); db.execute("update bookings set status = 'cancelled' where id = %s", (bid,))
    assert not can_read_patient(db, d["staff_user"], d["pa"])


def test_rejected_booking_removes_access(db):
    d = seed(db); bid = booking(db, d, confirmed=False)
    no_jwt(db); db.execute("update bookings set approval_status = 'rejected' where id = %s", (bid,))
    assert not can_read_patient(db, d["staff_user"], d["pa"])


def test_requested_booking_keeps_access_until_decided_documented_default(db):
    d = seed(db); booking(db, d, confirmed=False)
    assert can_read_patient(db, d["staff_user"], d["pa"])


def test_completed_visit_keeps_access_to_the_history_she_documented(db):
    d = seed(db); bid = booking(db, d)
    as_user(db, d["staff_user"])
    db.execute("select id from complete_visit(%s, %s::jsonb)", (bid, COMPLETE))
    assert can_read_patient(db, d["staff_user"], d["pa"])


def test_one_active_booking_is_enough_even_if_an_older_one_was_cancelled(db):
    d = seed(db); old = booking(db, d)
    no_jwt(db); db.execute("update bookings set status = 'cancelled' where id = %s", (old,))
    booking(db, d, at="2031-02-01 09:00+00")
    assert can_read_patient(db, d["staff_user"], d["pa"])
