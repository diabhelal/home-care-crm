"""Pausing a visit type (proposed/021). Isolated Postgres, synthetic data only.

Rules: only an administrator changes the list; nothing is deleted; a pause blocks NEW bookings (and a change of purpose
or time by a non-admin) for the paused dates, but never cancelling, never existing bookings, and never an administrator."""
import psycopg

from tests_db.conftest import as_postgres, as_user
from tests_db.test_db_guards import seed
from tests_db.test_visit_report_integrity import attempt

DENIED = psycopg.errors.InsufficientPrivilege      # 42501
CHECK = psycopg.errors.CheckViolation              # 23514
PAUSED = "SV001"

DAY_IN = "2031-03-10 09:00:00+00"      # inside the pause window
DAY_OUT = "2031-03-20 09:00:00+00"     # after it
DAY_BEFORE = "2031-03-01 09:00:00+00"  # before it


def pause(db, purpose="blood_test", frm="2031-03-05", until="2031-03-15", message="אין בדיקות דם בתקופה זו"):
    as_postgres(db)
    db.execute("insert into service_availability(purpose,is_paused,paused_from,paused_until,public_message) values (%s,true,%s,%s,%s)",
               (purpose, frm, until, message))


def book(db, patient, staff, at, purpose="blood_test", addr="רחוב 1"):
    return db.execute(
        "insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address) values (%s,%s,%s,%s,%s) returning id",
        (patient, staff, purpose, at, addr)).fetchone()[0]


def sqlstate_of(db, sql, params=()):
    db.execute("savepoint sp")
    try:
        db.execute(sql, params)
    except psycopg.Error as e:
        db.execute("rollback to savepoint sp")
        return e.sqlstate
    db.execute("release savepoint sp")
    return None


def test_no_row_means_available_as_before(db):
    d = seed(db)
    as_user(db, d["pa"])
    assert book(db, d["pa"], d["s1"], DAY_IN)


def test_a_patient_cannot_book_a_paused_service_inside_the_window_only(db):
    d = seed(db); pause(db)
    as_user(db, d["pa"])
    assert sqlstate_of(db, "insert into bookings(patient_id,staff_id,visit_purpose,scheduled_at,visit_address) values (%s,%s,'blood_test',%s,'x')",
                       (d["pa"], d["s1"], DAY_IN)) == PAUSED
    assert book(db, d["pa"], d["s1"], DAY_BEFORE, addr="a")          # before the window
    assert book(db, d["pa"], d["s1"], DAY_OUT, addr="b")             # after it
    assert book(db, d["pa"], d["s2"], DAY_IN, purpose="checkup")     # another service, same dates


def test_pause_boundaries_are_inclusive_in_business_time(db):
    d = seed(db); pause(db, frm="2031-03-05", until="2031-03-15")
    as_user(db, d["pa"])
    # 2031-03-04 22:30 UTC = 2031-03-05 00:30 in Asia/Jerusalem (UTC+2 in March, before DST) -> first paused day
    assert sqlstate_of(db, "insert into bookings(patient_id,staff_id,visit_purpose,scheduled_at,visit_address) values (%s,%s,'blood_test','2031-03-04 22:30:00+00','x')",
                       (d["pa"], d["s1"])) == PAUSED
    assert sqlstate_of(db, "insert into bookings(patient_id,staff_id,visit_purpose,scheduled_at,visit_address) values (%s,%s,'blood_test','2031-03-15 12:00:00+00','y')",
                       (d["pa"], d["s1"])) == PAUSED
    assert sqlstate_of(db, "insert into bookings(patient_id,staff_id,visit_purpose,scheduled_at,visit_address) values (%s,%s,'blood_test','2031-03-16 12:00:00+00','z')",
                       (d["pa"], d["s1"])) is None


def test_open_ended_pause_blocks_every_date_until_resumed(db):
    d = seed(db); pause(db, frm=None, until=None)
    as_user(db, d["pa"])
    assert sqlstate_of(db, "insert into bookings(patient_id,staff_id,visit_purpose,scheduled_at,visit_address) values (%s,%s,'blood_test',%s,'x')",
                       (d["pa"], d["s1"], DAY_OUT)) == PAUSED
    as_user(db, d["admin"], admin=True)
    db.execute("update service_availability set is_paused = false where purpose = 'blood_test'")
    as_user(db, d["pa"])
    assert book(db, d["pa"], d["s1"], DAY_OUT)


def test_existing_bookings_survive_and_can_still_be_cancelled(db):
    d = seed(db)
    as_user(db, d["pa"]); bid = book(db, d["pa"], d["s1"], DAY_IN)
    pause(db)
    as_user(db, d["pa"])
    assert db.execute("update bookings set status='cancelled' where id=%s", (bid,)).rowcount == 1
    as_postgres(db)
    assert db.execute("select count(*) from bookings where id=%s", (bid,)).fetchone()[0] == 1


def test_a_patient_cannot_move_a_booking_into_the_pause_or_switch_to_the_paused_service(db):
    d = seed(db)
    as_user(db, d["pa"]); bid = book(db, d["pa"], d["s1"], DAY_IN, purpose="checkup")
    pause(db)
    as_user(db, d["pa"])
    # refused either by the existing column guard (005: 42501) or by the pause guard (SV001) - never accepted
    assert sqlstate_of(db, "update bookings set visit_purpose='blood_test' where id=%s", (bid,)) in ("42501", PAUSED)
    assert sqlstate_of(db, "update bookings set scheduled_at=%s where id=%s", ("2031-03-11 09:00:00+00", bid)) in ("42501", PAUSED)
    as_postgres(db)
    # the trigger itself, exercised as the table owner without an admin claim (no JWT)
    db.execute("select set_config('request.jwt.claims', '', true)")
    assert sqlstate_of(db, "update bookings set visit_purpose='blood_test' where id=%s", (bid,)) == PAUSED


def test_an_administrator_can_still_book_a_paused_service(db):
    d = seed(db); pause(db)
    as_user(db, d["admin"], admin=True)
    assert book(db, d["pa"], d["s1"], DAY_IN)


def test_only_an_administrator_changes_the_list_and_nothing_can_be_deleted(db):
    d = seed(db)
    as_user(db, d["pa"])
    assert sqlstate_of(db, "insert into service_availability(purpose,is_paused) values ('blood_test',true)") == "42501"   # RLS
    as_user(db, d["staff_user"])
    assert sqlstate_of(db, "insert into service_availability(purpose,is_paused) values ('blood_test',true)") == "42501"
    as_user(db, d["admin"], admin=True)
    db.execute("insert into service_availability(purpose,is_paused) values ('blood_test',true)")
    attempt(db, "delete from service_availability where purpose='blood_test'", (), DENIED)
    as_postgres(db)
    assert db.execute("select count(*) from service_availability").fetchone()[0] == 1


def test_everyone_signed_in_can_read_the_list_but_anon_cannot(db):
    d = seed(db); pause(db)
    as_user(db, d["pa"])
    assert db.execute("select public_message from service_availability").fetchone()[0] == "אין בדיקות דם בתקופה זו"
    as_postgres(db)
    db.execute("select set_config('request.jwt.claims', '', true)")
    db.execute("set local role anon")
    assert sqlstate_of(db, "select 1 from service_availability") == "42501"


def test_actor_and_time_come_from_the_server_and_changes_are_audited(db):
    d = seed(db)
    as_postgres(db); forged = d["pb"]
    as_user(db, d["admin"], admin=True)
    db.execute("insert into service_availability(purpose,is_paused,updated_by,updated_at,public_message) values ('blood_test',true,%s,'2000-01-01','  הודעה  ')", (forged,))
    as_postgres(db)
    by, at, msg = db.execute("select updated_by, updated_at, public_message from service_availability").fetchone()
    assert str(by) == d["admin"] and at.year > 2000 and msg == "הודעה"
    as_user(db, d["admin"], admin=True)
    db.execute("update service_availability set is_paused=false where purpose='blood_test'")
    as_postgres(db)
    actions = [r[0] for r in db.execute("select action from audit_log where table_name='service_availability' order by id").fetchall()]
    assert actions == ["insert", "update"]


def test_constraints_reject_bad_input(db):
    d = seed(db)
    as_user(db, d["admin"], admin=True)
    attempt(db, "insert into service_availability(purpose,is_paused) values ('not_a_service',true)", (), CHECK)
    attempt(db, "insert into service_availability(purpose,is_paused,paused_from,paused_until) values ('checkup',true,'2031-03-10','2031-03-01')", (), CHECK)
    attempt(db, "insert into service_availability(purpose,is_paused,public_message) values ('checkup',true,%s)", ("x" * 201,), CHECK)
    db.execute("insert into service_availability(purpose,is_paused) values ('checkup',true)")
    assert sqlstate_of(db, "update service_availability set purpose='other' where purpose='checkup'") == "55000"


def test_a_visitor_without_a_session_sees_only_the_public_part_of_paused_rows(db):
    d = seed(db); pause(db)
    as_postgres(db)
    db.execute("insert into service_availability(purpose,is_paused) values ('checkup',false)")      # resumed: must not be listed
    db.execute("select set_config('request.jwt.claims', '', true)")
    db.execute("set local role anon")
    rows = db.execute("select * from list_service_pauses()").fetchall()
    assert len(rows) == 1 and rows[0][0] == "blood_test" and rows[0][3] == "אין בדיקות דם בתקופה זו"
    assert [c.name for c in db.execute("select * from list_service_pauses()").description] == ["purpose", "paused_from", "paused_until", "public_message"]
    assert sqlstate_of(db, "select 1 from service_availability") == "42501"                            # the table itself stays closed
