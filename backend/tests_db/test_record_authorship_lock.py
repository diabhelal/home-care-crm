"""Visit report authorship + lock (proposed/016). Owner rules 2 and 7: the person who documents is the author (a manager who
completes a visit is the author with role admin); a completed report is locked by locked_at, not by the booking status.
Isolated Postgres, synthetic data only."""
import json
import pathlib
import threading
import time

import psycopg
import pytest

from tests_db.conftest import ROOT, as_postgres, as_user, new_uuid
from tests_db.test_block_physical_deletes import no_jwt
from tests_db.test_db_guards import seed
from tests_db.test_visit_report_integrity import COMPLETE, DIRECT, attempt, booking

LOCKED = psycopg.errors.ObjectNotInPrerequisiteState
CONTENT_UPDATES = ["update visit_reports set treatment_summary='אחר' where id=%s",
                   "update visit_reports set pulse=40 where id=%s",
                   "update visit_reports set performed_injection=true where id=%s",
                   "update visit_reports set patient_signature_data='x' where id=%s"]


def completed(db, d, by="staff_user", **kw):
    bid = booking(db, d, **kw)
    as_user(db, d[by], admin=(by == "admin"))
    row = db.execute("select id from complete_visit(%s, %s::jsonb)", (bid, COMPLETE)).fetchone()
    return bid, row[0]


def author(db, rid):
    as_postgres(db)
    return db.execute("select author_user_id::text, author_role, locked_at is not null, staff_id from visit_reports where id=%s", (rid,)).fetchone()


def test_assigned_nurse_completing_a_visit_is_its_author_and_the_report_is_locked(db):
    d = seed(db); _, rid = completed(db, d)
    assert author(db, rid) == (d["staff_user"], "nurse", True, d["s1"])


def test_manager_completing_a_visit_is_the_author_with_role_admin_staff_id_stays_the_assignment(db):
    d = seed(db); _, rid = completed(db, d, by="admin")
    assert author(db, rid) == (d["admin"], "admin", True, d["s1"])           # owner rule 7: NOT the assigned nurse


def test_direct_draft_insert_cannot_claim_authorship_or_lock(db):
    d = seed(db); bid = booking(db, d)
    as_user(db, d["staff_user"])
    rid = db.execute("insert into visit_reports(booking_id, patient_id, staff_id, treatment_summary, author_user_id, author_role, locked_at) "
                     "values (%s,%s,%s,'סינתטי',%s,'admin',now()) returning id", (bid, d["pa"], d["s1"], d["admin"])).fetchone()[0]
    assert author(db, rid) == (d["staff_user"], "nurse", False, d["s1"])      # server wins; draft is not locked


def test_admin_direct_insert_is_authored_by_the_admin(db):
    d = seed(db); bid = booking(db, d)
    as_user(db, d["admin"], admin=True)
    rid = db.execute(DIRECT, (bid, d["pa"], d["s1"])).fetchone()[0]
    assert author(db, rid)[:2] == (d["admin"], "admin")


@pytest.mark.parametrize("who", ["staff_user", "admin"])
def test_client_cannot_rewrite_authorship_or_unlock_a_report(db, who):
    d = seed(db); _, rid = completed(db, d)
    as_user(db, d[who], admin=(who == "admin"))
    before = author(db, rid); as_user(db, d[who], admin=(who == "admin"))
    db.execute("update visit_reports set author_user_id=%s, author_role='admin', locked_at=null where id=%s", (d["admin"], rid))
    assert author(db, rid) == before                                          # silently kept; the lock did not open


@pytest.mark.parametrize("who", ["staff_user", "admin"])
@pytest.mark.parametrize("sql", CONTENT_UPDATES)
def test_locked_content_cannot_be_updated_by_author_assignee_or_admin(db, who, sql):
    d = seed(db); _, rid = completed(db, d)
    as_user(db, d[who], admin=(who == "admin"))
    attempt(db, sql, (rid,), LOCKED)


def test_reverting_the_booking_status_does_not_unlock_the_report(db):
    d = seed(db); bid, rid = completed(db, d)
    no_jwt(db)
    db.execute("alter table bookings disable trigger bookings_completed_status_guard")   # even if the status were forced back (owner)
    db.execute("update bookings set status='scheduled' where id=%s", (bid,))
    db.execute("alter table bookings enable trigger bookings_completed_status_guard")
    for who in ("staff_user", "admin"):
        as_user(db, d[who], admin=(who == "admin"))
        attempt(db, CONTENT_UPDATES[0], (rid,), LOCKED)                         # 008 would have allowed this: locked_at is the lock now


@pytest.mark.parametrize("who", ["staff_user", "admin"])
@pytest.mark.parametrize("target", ["scheduled", "cancelled"])
def test_booking_with_a_report_cannot_leave_completed(db, who, target):
    d = seed(db); bid, _ = completed(db, d)
    as_user(db, d[who], admin=(who == "admin"))
    db.execute("savepoint sp")
    with pytest.raises((LOCKED, psycopg.errors.InsufficientPrivilege)):
        db.execute("update bookings set status=%s where id=%s", (target, bid))
    db.execute("rollback to savepoint sp")
    as_postgres(db)
    assert db.execute("select status from bookings where id=%s", (bid,)).fetchone()[0] == "completed"


def test_booking_revert_is_refused_by_the_new_guard_itself(db):
    d = seed(db); bid, _ = completed(db, d)
    no_jwt(db)
    with pytest.raises(LOCKED, match="cannot be reopened"):
        db.execute("update bookings set status='scheduled' where id=%s", (bid,))


def test_clinical_outcome_is_set_once(db):
    d = seed(db); _, rid = completed(db, d)
    as_user(db, d["staff_user"])
    db.execute("update visit_reports set clinical_outcome_8h='none' where id=%s", (rid,))
    db.execute("update visit_reports set clinical_outcome_8h='none' where id=%s", (rid,))       # same value: idempotent
    attempt(db, "update visit_reports set clinical_outcome_8h='hypoglycemia' where id=%s", (rid,), LOCKED)
    as_user(db, d["admin"], admin=True)
    attempt(db, "update visit_reports set clinical_outcome_8h='hypoglycemia' where id=%s", (rid,), LOCKED)


def test_other_nurse_patient_and_deactivated_nurse_cannot_touch_a_locked_report(db):
    d = seed(db); _, rid = completed(db, d)
    other = new_uuid()
    as_postgres(db)
    db.execute("insert into auth.users(id) values (%s)", (other,))
    db.execute("insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id) values ('אחות ג','nurse',60,%s)", (other,))
    for who in (other, d["pa"]):
        as_user(db, who)
        assert db.execute("update visit_reports set clinical_outcome_8h='none' where id=%s", (rid,)).rowcount == 0
        assert db.execute("update visit_reports set treatment_summary='x' where id=%s", (rid,)).rowcount == 0
    no_jwt(db); db.execute("update medical_staff set is_active=false where id=%s", (d["s1"],))
    as_user(db, d["staff_user"])                                                # deactivated author: no access to write at all
    assert db.execute("update visit_reports set clinical_outcome_8h='none' where id=%s", (rid,)).rowcount == 0    # RLS needs an ACTIVE staff
    assert db.execute(CONTENT_UPDATES[0], (rid,)).rowcount == 0


def test_owner_without_jwt_can_still_maintain_a_locked_report_documented_limitation(db):
    d = seed(db); _, rid = completed(db, d)
    no_jwt(db)
    assert db.execute("update visit_reports set treatment_summary='תיקון מנהל מערכת' where id=%s", (rid,)).rowcount == 1


def test_legacy_rows_are_backfilled_with_the_staff_login_as_author_and_locked(db):
    d = seed(db); bid, rid = completed(db, d)
    no_jwt(db)
    db.execute("update visit_reports set author_user_id=null, author_role=null, locked_at=null where id=%s", (rid,))   # look like a pre-016 row
    # a legacy report of a staff member WITHOUT a login stays unattributed (nobody may amend it)
    b2 = booking(db, d, patient="pb", staff="s2", at="2030-01-07 12:00:00+00")
    no_jwt(db)
    r2 = db.execute("insert into visit_reports(booking_id, patient_id, staff_id, treatment_summary) values (%s,%s,%s,'ישן') returning id", (b2, d["pb"], d["s2"])).fetchone()[0]
    db.execute("update bookings set status='completed' where id=%s", (b2,))
    sql = (ROOT / "supabase" / "proposed" / "016_visit_report_authorship_and_lock.sql").read_text(encoding="utf-8")
    db.execute(sql)                                                             # re-running the file is the backfill (and proves it is re-runnable)
    assert author(db, rid) == (d["staff_user"], "nurse", True, d["s1"])
    assert author(db, r2) == (None, "nurse", True, d["s2"])


# ---------------------------------------------------------------- concurrency (separate committed transactions)
def purge_committed(pg_uri, users, patient, staff):
    """Remove rows a concurrency test committed to the shared server. Needs superuser triggers off (session_replication_role=replica):
    the app-facing guards deliberately forbid deleting these records."""
    with psycopg.connect(pg_uri, autocommit=True) as c:
        c.execute("set session_replication_role = replica")
        for t in ("visit_report_amendments", "risk_predictions", "visit_reports", "bookings"):
            c.execute(f"delete from public.{t} where patient_id = %s" if t != "bookings" else "delete from public.bookings where patient_id = %s", (patient,))
        c.execute("delete from public.audit_log where actor_id = any(%s::uuid[]) or new_data ->> 'patient_id' = %s", (users, str(patient)))
        c.execute("delete from public.patients where id = %s", (patient,))
        c.execute("delete from public.medical_staff where id = %s", (staff,))
        c.execute("delete from auth.users where id = any(%s::uuid[])", (users,))


def _conn(pg_uri, sub, admin=False, role="authenticated"):
    c = psycopg.connect(pg_uri, autocommit=False)
    claims = json.dumps({"sub": sub, "role": "authenticated", "app_metadata": {"is_admin": admin}})
    c.execute("select set_config('request.jwt.claims', %s, false)", (claims,))
    c.execute(f"set role {role}")
    c.commit()
    return c


def test_concurrent_completion_and_admin_edit_of_the_draft_cannot_leave_an_edited_locked_report(pg_uri):
    admin, pa, nurse = new_uuid(), new_uuid(), new_uuid()
    with psycopg.connect(pg_uri, autocommit=True) as c:
        for u in (admin, pa, nurse):
            c.execute("insert into auth.users(id) values (%s)", (u,))
        c.execute("insert into patients(id, full_name, phone, address) values (%s,'מטופל','050','רחוב 1')", (pa,))
        sid = c.execute("insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id) values ('אחות','nurse',60,%s) returning id", (nurse,)).fetchone()[0]
        bid = c.execute("insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address, approval_status) "
                        "values (%s,%s,'checkup','2031-03-03 08:00+00','רחוב 1','confirmed') returning id", (pa, sid)).fetchone()[0]
        rid = c.execute("insert into visit_reports(booking_id, patient_id, staff_id, treatment_summary) values (%s,%s,%s,'טיוטה') returning id", (bid, pa, sid)).fetchone()[0]
    c1, c2 = _conn(pg_uri, nurse), _conn(pg_uri, admin, admin=True)
    out = {}

    def editor():
        try:
            c2.execute("update visit_reports set treatment_summary='עריכה במקביל' where id=%s", (rid,)); c2.commit(); out["e"] = "committed"
        except psycopg.Error as e:
            c2.rollback(); out["e"] = type(e).__name__
    try:
        c1.execute("select complete_visit(%s, %s::jsonb)", (bid, COMPLETE))     # holds the row, uncommitted
        t = threading.Thread(target=editor); t.start(); time.sleep(0.6)
        assert "e" not in out, "the edit did not wait for the completing transaction"
        c1.commit(); t.join(10)
        assert not t.is_alive()
    finally:
        c1.close(); c2.close()
    try:
        with psycopg.connect(pg_uri, autocommit=True) as c:
            summary, locked = c.execute("select treatment_summary, locked_at is not null from visit_reports where id=%s", (rid,)).fetchone()
        assert out["e"] == "ObjectNotInPrerequisiteState" and summary == "סינתטי" and locked
    finally:
        purge_committed(pg_uri, [admin, pa, nurse], pa, sid)
