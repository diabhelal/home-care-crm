"""Real-Postgres checks of the project migrations + proposed SQL, with synthetic data only."""
import psycopg
import pytest

from tests_db.conftest import as_postgres, as_user, new_uuid

T0 = "2030-01-07 08:00:00+00"  # a Monday 08:00 UTC; slot=60min


def seed(db):
    as_postgres(db)
    pa, pb, admin, staff_user = new_uuid(), new_uuid(), new_uuid(), new_uuid()
    for u in (pa, pb, admin, staff_user):
        db.execute("insert into auth.users(id) values (%s)", (u,))
    db.execute("insert into patients(id, full_name, phone, address) values (%s,'מטופל א','050','רחוב 1'),(%s,'מטופל ב','051','רחוב 2')", (pa, pb))
    s1 = db.execute("insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id) values ('אחות א','nurse',60,%s) returning id", (staff_user,)).fetchone()[0]
    s2 = db.execute("insert into medical_staff(full_name, role, slot_duration_minutes) values ('אחות ב','nurse',60) returning id").fetchone()[0]
    return dict(pa=pa, pb=pb, admin=admin, staff_user=staff_user, s1=s1, s2=s2)


def insert_booking(db, patient, staff, at, addr="רחוב 1", key=None):
    return db.execute(
        "insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address, idempotency_key) "
        "values (%s,%s,'checkup',%s,%s,%s) returning id, approval_status",
        (patient, staff, at, addr, key)).fetchone()


def test_patient_insert_is_forced_to_requested(db):
    d = seed(db)
    as_user(db, d["pa"])
    # patient tries to self-approve via a direct insert
    row = db.execute(
        "insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address, approval_status) "
        "values (%s,%s,'checkup',%s,'רחוב 1','confirmed') returning approval_status", (d["pa"], d["s1"], T0)).fetchone()
    assert row[0] == "requested"


def test_double_booking_same_slot_is_blocked(db):
    d = seed(db)
    as_user(db, d["pa"]); insert_booking(db, d["pa"], d["s1"], T0)
    as_user(db, d["pb"])
    with pytest.raises(psycopg.errors.UniqueViolation):
        insert_booking(db, d["pb"], d["s1"], T0, addr="רחוב 2")


def test_travel_buffer_enforced_in_db(db):
    d = seed(db)
    as_user(db, d["pa"]); insert_booking(db, d["pa"], d["s1"], T0, addr="רחוב 1")   # 08:00-09:00
    as_user(db, d["pb"])
    with pytest.raises(psycopg.errors.UniqueViolation):                              # 09:20 different address
        insert_booking(db, d["pb"], d["s1"], "2030-01-07 09:20:00+00", addr="רחוב 2")


def test_buffer_ok_after_30_minutes_and_same_address_back_to_back(db):
    d = seed(db)
    as_user(db, d["pa"]); insert_booking(db, d["pa"], d["s1"], T0, addr="רחוב 1")
    as_user(db, d["pb"])
    assert insert_booking(db, d["pb"], d["s1"], "2030-01-07 09:30:00+00", addr="רחוב 2")
    as_user(db, d["pa"])
    assert insert_booking(db, d["pa"], d["s2"], "2030-01-07 08:00:00+00", addr="רחוב 1")


def test_patient_cannot_change_staff_or_approval_on_update(db):
    d = seed(db)
    as_user(db, d["pa"]); bid, _ = insert_booking(db, d["pa"], d["s1"], T0)
    for sql in ("update bookings set approval_status='confirmed' where id=%s",
                "update bookings set staff_id=%s where id=%s"):
        db.execute("savepoint sp")
        args = (bid,) if "approval" in sql else (d["s2"], bid)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            db.execute(sql, args)
        db.execute("rollback to savepoint sp")


def test_patient_can_cancel_own_scheduled_booking(db):
    d = seed(db)
    as_user(db, d["pa"]); bid, _ = insert_booking(db, d["pa"], d["s1"], T0)
    db.execute("update bookings set status='cancelled' where id=%s", (bid,))
    assert db.execute("select status from bookings where id=%s", (bid,)).fetchone()[0] == "cancelled"


def test_other_patient_cannot_see_or_touch_booking(db):
    d = seed(db)
    as_user(db, d["pa"]); bid, _ = insert_booking(db, d["pa"], d["s1"], T0)
    as_user(db, d["pb"])
    assert db.execute("select count(*) from bookings where id=%s", (bid,)).fetchone()[0] == 0
    db.execute("update bookings set status='cancelled' where id=%s", (bid,))
    as_postgres(db)
    assert db.execute("select status from bookings where id=%s", (bid,)).fetchone()[0] == "scheduled"


def test_admin_can_approve_and_reject(db):
    d = seed(db)
    as_user(db, d["pa"]); bid, _ = insert_booking(db, d["pa"], d["s1"], T0)
    as_user(db, d["admin"], admin=True)
    db.execute("update bookings set approval_status='confirmed' where id=%s", (bid,))
    assert db.execute("select approval_status from bookings where id=%s", (bid,)).fetchone()[0] == "confirmed"


def test_check_in_rejected_for_non_assigned_user(db):
    d = seed(db)
    as_user(db, d["pa"]); bid, _ = insert_booking(db, d["pa"], d["s1"], T0)
    as_user(db, d["admin"], admin=True)
    db.execute("update bookings set approval_status='confirmed' where id=%s", (bid,))
    as_user(db, d["pb"])
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("select check_in_visit(%s)", (bid,))


def test_check_in_and_complete_atomic_by_assigned_staff(db):
    d = seed(db)
    as_user(db, d["pa"]); bid, _ = insert_booking(db, d["pa"], d["s1"], T0)
    as_user(db, d["admin"], admin=True)
    db.execute("update bookings set approval_status='confirmed' where id=%s", (bid,))
    as_user(db, d["staff_user"])
    first = db.execute("select checked_in_at from check_in_visit(%s)", (bid,)).fetchone()[0]
    second = db.execute("select checked_in_at from check_in_visit(%s)", (bid,)).fetchone()[0]
    assert first is not None and first == second
    rep = db.execute("select treatment_summary from complete_visit(%s, %s::jsonb)",
                     (bid, '{"systolic_bp":120,"diastolic_bp":80,"pulse":70,"treatment_summary":"סינתטי"}')).fetchone()
    assert rep[0] == "סינתטי"
    assert db.execute("select status from bookings where id=%s", (bid,)).fetchone()[0] == "completed"


def test_complete_rejects_unconfirmed_and_bad_vitals_atomically(db):
    d = seed(db)
    as_user(db, d["pa"]); bid, _ = insert_booking(db, d["pa"], d["s1"], T0)       # still 'requested'
    as_user(db, d["staff_user"])
    db.execute("savepoint sp")
    with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):  # approval_status is not confirmed
        db.execute("select complete_visit(%s, '{\"treatment_summary\":\"x\"}'::jsonb)", (bid,))
    db.execute("rollback to savepoint sp")
    as_user(db, d["admin"], admin=True)
    db.execute("update bookings set approval_status='confirmed' where id=%s", (bid,))
    as_user(db, d["staff_user"])
    db.execute("savepoint sp2")
    with pytest.raises(psycopg.errors.CheckViolation):                               # systolic out of range
        db.execute("select complete_visit(%s, '{\"systolic_bp\":999,\"treatment_summary\":\"x\"}'::jsonb)", (bid,))
    db.execute("rollback to savepoint sp2")
    as_postgres(db)
    assert db.execute("select status from bookings where id=%s", (bid,)).fetchone()[0] == "scheduled"
    assert db.execute("select count(*) from visit_reports where booking_id=%s", (bid,)).fetchone()[0] == 0


def test_staff_busy_blocks_never_reveals_other_patients_address(db):
    d = seed(db)
    as_user(db, d["pa"]); insert_booking(db, d["pa"], d["s1"], T0, addr="Secret St 5, Haifa")
    as_user(db, d["pb"])
    rows = db.execute("select visit_address from staff_busy_blocks(%s,%s,%s,%s)",
                      (d["s1"], "2030-01-07 00:00:00+00", "2030-01-08 00:00:00+00", "Other St 1")).fetchall()
    assert rows == [(None,)]
    rows = db.execute("select visit_address from staff_busy_blocks(%s,%s,%s,%s)",
                      (d["s1"], "2030-01-07 00:00:00+00", "2030-01-08 00:00:00+00", " secret st 5,  HAIFA")).fetchall()
    assert rows == [(" secret st 5,  HAIFA",)]


def test_guest_cannot_read_staff_pii_columns(db):
    d = seed(db)
    as_user(db, d["pb"])
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("select national_id from medical_staff")


def test_anon_has_no_access_to_bookings(db):
    seed(db)
    as_user(db, new_uuid(), role="anon")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("select * from bookings")


def test_cancel_frees_slot_for_rebooking(db):
    d = seed(db)
    as_user(db, d["pa"]); bid, _ = insert_booking(db, d["pa"], d["s1"], T0)
    db.execute("update bookings set status='cancelled' where id=%s", (bid,))
    as_user(db, d["pb"])
    assert insert_booking(db, d["pb"], d["s1"], T0, addr="רחוב 2")


def test_patient_cannot_cancel_completed_booking(db):
    d = seed(db)
    as_user(db, d["pa"]); bid, _ = insert_booking(db, d["pa"], d["s1"], T0)
    as_postgres(db)
    db.execute("select set_config('request.jwt.claims', '', true)")  # privileged write, no JWT subject
    db.execute("update bookings set approval_status='confirmed', status='completed' where id=%s", (bid,))
    as_user(db, d["pa"])
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("update bookings set status='cancelled' where id=%s", (bid,))


def test_admin_can_cancel_any_scheduled_booking(db):
    d = seed(db)
    as_user(db, d["pa"]); bid, _ = insert_booking(db, d["pa"], d["s1"], T0)
    as_user(db, d["admin"], admin=True)
    db.execute("update bookings set status='cancelled' where id=%s", (bid,))
    assert db.execute("select status from bookings where id=%s", (bid,)).fetchone()[0] == "cancelled"


def _confirmed_booking(db, d):
    as_user(db, d["pa"]); bid, _ = insert_booking(db, d["pa"], d["s1"], T0)
    as_user(db, d["admin"], admin=True)
    db.execute("update bookings set approval_status='confirmed' where id=%s", (bid,))
    return bid


def test_check_in_by_admin_allowed_keeps_first_time(db):
    d = seed(db)
    bid = _confirmed_booking(db, d)
    as_user(db, d["admin"], admin=True)
    first = db.execute("select checked_in_at from check_in_visit(%s)", (bid,)).fetchone()[0]
    as_user(db, d["staff_user"])
    second = db.execute("select checked_in_at from check_in_visit(%s)", (bid,)).fetchone()[0]
    assert first is not None and first == second
    assert db.execute("select staff_id from bookings where id=%s", (bid,)).fetchone()[0] == d["s1"]


def test_check_in_by_patient_owner_still_rejected(db):
    d = seed(db)
    bid = _confirmed_booking(db, d)
    as_user(db, d["pa"])
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("select check_in_visit(%s)", (bid,))


def _report_id(db, d):
    bid = _confirmed_booking(db, d)
    as_user(db, d["staff_user"])
    return db.execute("select id from complete_visit(%s, '{\"treatment_summary\":\"x\"}'::jsonb)", (bid,)).fetchone()[0]


def test_clinical_outcome_rls_owner_admin_and_check_constraint(db):
    d = seed(db)
    rid = _report_id(db, d)
    other = new_uuid()
    as_postgres(db)
    db.execute("insert into auth.users(id) values (%s)", (other,))
    db.execute("insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id) values ('אחות ג','nurse',60,%s)", (other,))
    # owner staff
    as_user(db, d["staff_user"])
    db.execute("update visit_reports set clinical_outcome_8h='none' where id=%s", (rid,))
    # admin
    as_user(db, d["admin"], admin=True)
    db.execute("update visit_reports set clinical_outcome_8h='hypoglycemia' where id=%s", (rid,))
    # other staff: RLS filters the row, nothing changes
    as_user(db, other)
    db.execute("update visit_reports set clinical_outcome_8h='none' where id=%s", (rid,))
    as_postgres(db)
    assert db.execute("select clinical_outcome_8h from visit_reports where id=%s", (rid,)).fetchone()[0] == "hypoglycemia"
    # constraint
    as_user(db, d["admin"], admin=True)
    db.execute("savepoint sp")
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("update visit_reports set clinical_outcome_8h='bogus' where id=%s", (rid,))
    db.execute("rollback to savepoint sp")
