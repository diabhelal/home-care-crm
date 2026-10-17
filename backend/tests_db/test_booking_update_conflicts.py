"""Overlap / 30-minute travel-buffer enforcement on booking UPDATEs (proposed/010), incl. administrators, direct
writes and concurrent operations. Isolated Postgres, synthetic data only."""
import json
import threading
import time

import psycopg
import pytest

from tests_db.conftest import as_postgres, as_user, new_uuid
from tests_db.test_db_guards import insert_booking, seed

CONFLICT = psycopg.errors.UniqueViolation        # SQLSTATE 23505 -> backend "slot taken"
T = lambda hhmm: f"2030-01-07 {hhmm}:00+00"       # a Monday, slot = 60 min, buffer = 30 min


def two_bookings(db, d, t1="08:00", t2="12:00", a1="רחוב 1", a2="רחוב 2", s2="s1"):
    """Booking 1 (patient A) and booking 2 (patient B), both active, no conflict between them."""
    as_user(db, d["pa"]); b1, _ = insert_booking(db, d["pa"], d["s1"], T(t1), addr=a1)
    as_user(db, d["pb"]); b2, _ = insert_booking(db, d["pb"], d[s2], T(t2), addr=a2)
    return b1, b2


def admin_update(db, d, sql, params):
    as_user(db, d["admin"], admin=True)
    db.execute("savepoint sp")
    try:
        db.execute(sql, params)
        db.execute("release savepoint sp")
        return None
    except psycopg.Error as e:
        db.execute("rollback to savepoint sp")
        return e


def test_time_change_into_overlap_is_rejected_for_admin(db):
    d = seed(db); _, b2 = two_bookings(db, d)
    assert isinstance(admin_update(db, d, "update bookings set scheduled_at=%s where id=%s", (T("08:30"), b2)), CONFLICT)


def test_time_change_violating_travel_buffer_is_rejected_but_exact_boundary_is_allowed(db):
    d = seed(db); _, b2 = two_bookings(db, d)                       # booking 1: 08:00-09:00 at address 1
    assert isinstance(admin_update(db, d, "update bookings set scheduled_at=%s where id=%s", (T("09:29"), b2)), CONFLICT)
    assert admin_update(db, d, "update bookings set scheduled_at=%s where id=%s", (T("09:30"), b2)) is None   # exactly 30 min after the end
    assert isinstance(admin_update(db, d, "update bookings set scheduled_at=%s where id=%s", (T("06:31"), b2)), CONFLICT)  # ends 07:31, 29 min before 08:00
    assert admin_update(db, d, "update bookings set scheduled_at=%s where id=%s", (T("06:30"), b2)) is None   # ends 07:30, exactly 30 min before


def test_same_address_back_to_back_is_allowed_but_overlap_is_not(db):
    d = seed(db); _, b2 = two_bookings(db, d, a1="רחוב 1", a2="רחוב 1")        # explicit existing exception of the policy
    assert admin_update(db, d, "update bookings set scheduled_at=%s where id=%s", (T("09:00"), b2)) is None
    assert isinstance(admin_update(db, d, "update bookings set scheduled_at=%s where id=%s", (T("08:59"), b2)), CONFLICT)


def test_changing_the_address_can_not_dodge_or_create_a_buffer_conflict(db):
    d = seed(db); _, b2 = two_bookings(db, d, a1="רחוב 1", a2="רחוב 1")
    assert admin_update(db, d, "update bookings set scheduled_at=%s where id=%s", (T("09:00"), b2)) is None
    assert isinstance(admin_update(db, d, "update bookings set visit_address=%s where id=%s", ("רחוב אחר", b2)), CONFLICT)


def test_reassignment_to_an_occupied_staff_member_is_rejected_and_to_a_free_one_is_allowed(db):
    d = seed(db)
    as_user(db, d["pa"]); insert_booking(db, d["pa"], d["s1"], T("08:00"))
    as_user(db, d["pb"]); b2, _ = insert_booking(db, d["pb"], d["s2"], T("08:30"), addr="רחוב 2")
    assert isinstance(admin_update(db, d, "update bookings set staff_id=%s where id=%s", (d["s1"], b2)), CONFLICT)
    as_postgres(db); db.execute("insert into medical_staff(full_name, role, slot_duration_minutes) values ('אחות ג','nurse',60)")
    s3 = db.execute("select max(id) from medical_staff").fetchone()[0]
    assert admin_update(db, d, "update bookings set staff_id=%s where id=%s", (s3, b2)) is None


def test_reactivating_a_conflicting_booking_is_rejected(db):
    d = seed(db)
    as_user(db, d["pa"]); b1, _ = insert_booking(db, d["pa"], d["s1"], T("08:00"))
    as_user(db, d["admin"], admin=True); db.execute("update bookings set status='cancelled' where id=%s", (b1,))
    as_user(db, d["pb"]); insert_booking(db, d["pb"], d["s1"], T("08:20"), addr="רחוב 2")     # takes the freed time (overlapping, not identical)
    assert isinstance(admin_update(db, d, "update bookings set status='scheduled' where id=%s", (b1,)), CONFLICT)
    # a rejected booking coming back to life is checked the same way
    as_user(db, d["pa"]); b3, _ = insert_booking(db, d["pa"], d["s2"], T("08:00"))
    as_user(db, d["admin"], admin=True); db.execute("update bookings set approval_status='rejected' where id=%s", (b3,))
    as_user(db, d["pb"]); insert_booking(db, d["pb"], d["s2"], T("08:20"), addr="רחוב 2")
    assert isinstance(admin_update(db, d, "update bookings set approval_status='confirmed' where id=%s", (b3,)), CONFLICT)


def test_valid_and_unchanged_updates_succeed(db):
    d = seed(db); b1, b2 = two_bookings(db, d)
    assert admin_update(db, d, "update bookings set scheduled_at=%s where id=%s", (T("14:00"), b2)) is None
    assert admin_update(db, d, "update bookings set scheduled_at=scheduled_at, staff_id=staff_id, notes='הערה' where id=%s", (b2,)) is None
    assert admin_update(db, d, "update bookings set approval_status='confirmed' where id=%s", (b1,)) is None
    assert admin_update(db, d, "update bookings set status='completed' where id=%s", (b1,)) is None


def test_legacy_rows_already_closer_than_the_buffer_stay_editable(db):
    d = seed(db)
    as_user(db, d["pa"]); insert_booking(db, d["pa"], d["s1"], T("08:00"))
    as_postgres(db)
    db.execute("alter table bookings disable trigger bookings_guard_insert")      # simulate pre-guard legacy data
    as_user(db, d["pb"])
    as_postgres(db)
    db.execute("insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address) values (%s,%s,'checkup',%s,'רחוב 2')",
               (d["pb"], d["s1"], T("09:10")))
    db.execute("alter table bookings enable trigger bookings_guard_insert")
    b2 = db.execute("select id from bookings where scheduled_at=%s", (T("09:10"),)).fetchone()[0]
    assert admin_update(db, d, "update bookings set notes='ללא שינוי זמן' , approval_status='confirmed' where id=%s", (b2,)) is None
    assert isinstance(admin_update(db, d, "update bookings set scheduled_at=%s where id=%s", (T("09:20"), b2)), CONFLICT)   # moving it is validated


def test_superuser_without_jwt_cannot_bypass_either(db):
    d = seed(db); _, b2 = two_bookings(db, d)
    as_postgres(db); db.execute("select set_config('request.jwt.claims', '', true)")
    db.execute("savepoint sp")
    with pytest.raises(CONFLICT):
        db.execute("update bookings set scheduled_at=%s where id=%s", (T("08:30"), b2))
    db.execute("rollback to savepoint sp")


# ---- concurrency: separate committed transactions on the shared isolated server -------------------
def _seed_committed(pg_uri, n_staff):
    admin, pa, pb = new_uuid(), new_uuid(), new_uuid()
    with psycopg.connect(pg_uri, autocommit=True) as c:
        for u in (admin, pa, pb):
            c.execute("insert into auth.users(id) values (%s)", (u,))
        c.execute("insert into patients(id, full_name, phone, address) values (%s,'מטופל א','050','רחוב 1'),(%s,'מטופל ב','051','רחוב 2')", (pa, pb))
        staff = [c.execute("insert into medical_staff(full_name, role, slot_duration_minutes) values ('צוות','nurse',60) returning id").fetchone()[0]
                 for _ in range(n_staff)]
    return admin, pa, pb, staff


def _cleanup(pg_uri, admin, pa, pb, staff):
    with psycopg.connect(pg_uri, autocommit=True) as c:
        c.execute("delete from patients where id in (%s,%s)", (pa, pb))          # cascades the bookings
        c.execute("delete from medical_staff where id = any(%s)", (staff,))
        c.execute("delete from auth.users where id in (%s,%s,%s)", (admin, pa, pb))


def _admin_conn(pg_uri, admin):
    c = psycopg.connect(pg_uri, autocommit=False)
    claims = json.dumps({"sub": admin, "role": "authenticated", "app_metadata": {"is_admin": True}})
    c.execute("select set_config('request.jwt.claims', %s, false)", (claims,))
    c.execute("set role authenticated")
    c.commit()
    return c


def _race(pg_uri, admin, first_sql, first_params, second_sql, second_params):
    """first runs and stays uncommitted; second starts meanwhile (must wait on the staff lock); then first commits."""
    c1, c2 = _admin_conn(pg_uri, admin), _admin_conn(pg_uri, admin)
    outcome = {}

    def second():
        try:
            c2.execute(second_sql, second_params); c2.commit(); outcome["second"] = "committed"
        except psycopg.Error as e:
            c2.rollback(); outcome["second"] = type(e).__name__

    try:
        c1.execute(first_sql, first_params)                      # holds the lock, uncommitted
        t = threading.Thread(target=second); t.start()
        time.sleep(0.6)                                          # second is now blocked on the same staff row
        assert "second" not in outcome, "second statement did not wait for the first transaction"
        c1.commit(); t.join(10)
        assert not t.is_alive()
    finally:
        c1.close(); c2.close()
    return outcome["second"]


def test_concurrent_reassignments_into_the_same_staff_member_cannot_both_commit(pg_uri):
    admin, pa, pb, staff = _seed_committed(pg_uri, 3)
    try:
        s_target, s_a, s_b = staff
        with psycopg.connect(pg_uri, autocommit=True) as c:
            ba = c.execute("insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address) values (%s,%s,'checkup',%s,'רחוב 1') returning id", (pa, s_a, T("08:00"))).fetchone()[0]
            bb = c.execute("insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address) values (%s,%s,'checkup',%s,'רחוב 2') returning id", (pb, s_b, T("08:30"))).fetchone()[0]
        second = _race(pg_uri, admin, "update bookings set staff_id=%s where id=%s", (s_target, ba),
                       "update bookings set staff_id=%s where id=%s", (s_target, bb))
        assert second == "UniqueViolation"
        with psycopg.connect(pg_uri, autocommit=True) as c:
            assert c.execute("select count(*) from bookings where staff_id=%s", (s_target,)).fetchone()[0] == 1
    finally:
        _cleanup(pg_uri, admin, pa, pb, staff)


def test_concurrent_time_changes_into_the_same_window_cannot_both_commit(pg_uri):
    admin, pa, pb, staff = _seed_committed(pg_uri, 1)
    try:
        (s,) = staff
        with psycopg.connect(pg_uri, autocommit=True) as c:
            ba = c.execute("insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address) values (%s,%s,'checkup',%s,'רחוב 1') returning id", (pa, s, T("08:00"))).fetchone()[0]
            bb = c.execute("insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address) values (%s,%s,'checkup',%s,'רחוב 2') returning id", (pb, s, T("13:00"))).fetchone()[0]
        second = _race(pg_uri, admin, "update bookings set scheduled_at=%s where id=%s", (T("16:00"), ba),
                       "update bookings set scheduled_at=%s where id=%s", (T("16:30"), bb))
        assert second == "UniqueViolation"
        with psycopg.connect(pg_uri, autocommit=True) as c:
            assert sorted(r[0].strftime("%H:%M") for r in c.execute("select scheduled_at at time zone 'UTC' from bookings where staff_id=%s", (s,)).fetchall()) == ["13:00", "16:00"]
    finally:
        _cleanup(pg_uri, admin, pa, pb, staff)


def test_a_concurrent_insert_and_a_reassignment_into_the_same_window_cannot_both_commit(pg_uri):
    admin, pa, pb, staff = _seed_committed(pg_uri, 2)
    try:
        s_target, s_other = staff
        with psycopg.connect(pg_uri, autocommit=True) as c:
            bb = c.execute("insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address) values (%s,%s,'checkup',%s,'רחוב 2') returning id", (pb, s_other, T("10:00"))).fetchone()[0]
        second = _race(pg_uri, admin,
                       "insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address) values (%s,%s,'checkup',%s,'רחוב 1')", (pa, s_target, T("10:10")),
                       "update bookings set staff_id=%s where id=%s", (s_target, bb))
        assert second == "UniqueViolation"
    finally:
        _cleanup(pg_uri, admin, pa, pb, staff)
