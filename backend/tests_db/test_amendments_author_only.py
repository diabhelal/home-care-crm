"""Amendments: only the ORIGINAL AUTHOR (proposed/017). Owner rules 2, 3, 6, 7. Isolated Postgres, synthetic data only."""
import json
import threading
import time

import psycopg

from tests_db.conftest import as_postgres, as_user, new_uuid
from tests_db.test_block_physical_deletes import no_jwt
from tests_db.test_db_guards import seed
from tests_db.test_record_authorship_lock import _conn, completed, purge_committed
from tests_db.test_visit_report_amendments import INS
from tests_db.test_visit_report_integrity import attempt

DENIED = psycopg.errors.InsufficientPrivilege


def amend(db, rid, d, corrections=None, reason="טעות הקלדה"):
    return db.execute(INS, (rid, d["pa"], reason, json.dumps(corrections or {"systolic_bp": 135}))).fetchone()[0]


def test_author_nurse_amends_and_previous_values_are_captured_then_chained(db):
    d = seed(db); _, rid = completed(db, d)
    as_user(db, d["staff_user"])
    a1 = amend(db, rid, d, {"systolic_bp": 135, "treatment_summary": "מתוקן"})
    a2 = amend(db, rid, d, {"systolic_bp": 130}, "תיקון נוסף")
    rows = db.execute("select previous_values, amended_by::text, amended_by_role from visit_report_amendments order by id").fetchall()
    assert rows[0][0] == {"systolic_bp": 120, "treatment_summary": "סינתטי"}          # the original values
    assert rows[1][0] == {"systolic_bp": 135}                                            # value in force before the 2nd correction
    assert rows[0][1] == d["staff_user"] and rows[0][2] == "nurse"
    assert db.execute("select systolic_bp from visit_reports where id=%s", (rid,)).fetchone()[0] == 120   # original untouched


def test_client_supplied_previous_values_are_ignored(db):
    d = seed(db); _, rid = completed(db, d)
    as_user(db, d["staff_user"])
    aid = db.execute("insert into visit_report_amendments(visit_report_id, patient_id, reason, corrections, previous_values) "
                     "values (%s,%s,'סיבה ברורה','{\"pulse\":71}','{\"pulse\":1}') returning previous_values", (rid, d["pa"])).fetchone()[0]
    assert aid == {"pulse": 70}


def test_admin_cannot_amend_a_nurses_report_not_even_with_an_empty_clarification(db):
    d = seed(db); _, rid = completed(db, d)
    as_user(db, d["admin"], admin=True)
    attempt(db, INS, (rid, d["pa"], "הבהרה", "{}"), DENIED)
    attempt(db, INS, (rid, d["pa"], "תיקון", json.dumps({"pulse": 71})), DENIED)


def test_manager_who_documented_is_the_only_one_who_may_amend_the_assigned_nurse_may_not(db):
    d = seed(db); _, rid = completed(db, d, by="admin")
    as_user(db, d["staff_user"])
    attempt(db, INS, (rid, d["pa"], "ניסיון", "{}"), DENIED)
    as_user(db, d["admin"], admin=True)
    db.execute(INS, (rid, d["pa"], "תיקון המנהל", json.dumps({"pulse": 72})))
    assert db.execute("select amended_by_role from visit_report_amendments").fetchone()[0] == "admin"


def test_demoted_admin_author_loses_the_right(db):
    d = seed(db); _, rid = completed(db, d, by="admin")
    as_user(db, d["admin"], admin=False)                               # same login, admin claim removed
    attempt(db, INS, (rid, d["pa"], "ניסיון", "{}"), DENIED)


def test_other_nurse_patient_and_deactivated_author_cannot_amend_and_nobody_inherits(db):
    d = seed(db); _, rid = completed(db, d)
    other = new_uuid()
    as_postgres(db)
    db.execute("insert into auth.users(id) values (%s)", (other,))
    db.execute("insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id) values ('אחות ג','nurse',60,%s)", (other,))
    for who in (other, d["pa"], d["pb"]):
        as_user(db, who)
        attempt(db, INS, (rid, d["pa"], "ניסיון", "{}"), DENIED)
    no_jwt(db); db.execute("update medical_staff set is_active=false where id=%s", (d["s1"],))
    as_user(db, d["staff_user"])
    attempt(db, INS, (rid, d["pa"], "ניסיון", "{}"), DENIED)             # deactivated author
    as_user(db, d["admin"], admin=True)
    attempt(db, INS, (rid, d["pa"], "ניסיון", "{}"), DENIED)             # the admin does not inherit
    assert (no_jwt(db) or db.execute("select count(*) from visit_report_amendments").fetchone()[0]) == 0


def test_reactivated_author_regains_only_their_own_right(db):
    d = seed(db); _, rid = completed(db, d)
    no_jwt(db); db.execute("update medical_staff set is_active=false where id=%s", (d["s1"],))
    db.execute("update medical_staff set is_active=true where id=%s", (d["s1"],))
    as_user(db, d["staff_user"])
    assert amend(db, rid, d)


def test_legacy_report_without_known_author_cannot_be_amended_by_anyone_in_the_application(db):
    d = seed(db); _, rid = completed(db, d)
    no_jwt(db); db.execute("update visit_reports set author_user_id=null where id=%s", (rid,))
    for who, adm in (("staff_user", False), ("admin", True)):
        as_user(db, d[who], admin=adm)
        attempt(db, INS, (rid, d["pa"], "ניסיון", "{}"), DENIED)


def test_a_draft_report_is_not_amended(db):
    d = seed(db)
    from tests_db.test_visit_report_integrity import DIRECT, booking
    bid = booking(db, d)
    as_user(db, d["staff_user"])
    rid = db.execute(DIRECT, (bid, d["pa"], d["s1"])).fetchone()[0]
    attempt(db, INS, (rid, d["pa"], "טיוטה", "{}"), psycopg.errors.ObjectNotInPrerequisiteState)


def test_reason_is_mandatory_and_amendments_stay_append_only(db):
    d = seed(db); _, rid = completed(db, d)
    as_user(db, d["staff_user"])
    attempt(db, INS, (rid, d["pa"], "  ", "{}"), psycopg.errors.CheckViolation)
    aid = amend(db, rid, d)
    attempt(db, "update visit_report_amendments set previous_values='{}' where id=%s", (aid,), DENIED)
    attempt(db, "delete from visit_report_amendments where id=%s", (aid,), DENIED)


def test_history_stays_readable_for_admin_assigned_staff_and_patient(db):
    d = seed(db); _, rid = completed(db, d)
    as_user(db, d["staff_user"]); amend(db, rid, d)
    for who, adm in (("staff_user", False), ("admin", True), ("pa", False)):
        as_user(db, d[who], admin=adm)
        assert db.execute("select count(*) from visit_report_amendments").fetchone()[0] == 1


def test_owner_without_jwt_is_not_restricted_documented_limitation(db):
    d = seed(db); _, rid = completed(db, d)
    no_jwt(db)
    assert db.execute("insert into visit_report_amendments(visit_report_id, patient_id, amended_by, reason) values (%s,%s,%s,'תחזוקה') returning id", (rid, d["pa"], d["admin"])).fetchone()


def test_concurrent_amendments_of_the_same_field_chain_their_previous_values(pg_uri):
    nurse, pa = new_uuid(), new_uuid()
    with psycopg.connect(pg_uri, autocommit=True) as c:
        for u in (nurse, pa):
            c.execute("insert into auth.users(id) values (%s)", (u,))
        c.execute("insert into patients(id, full_name, phone, address) values (%s,'מטופל','050','רחוב 1')", (pa,))
        sid = c.execute("insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id) values ('אחות','nurse',60,%s) returning id", (nurse,)).fetchone()[0]
        bid = c.execute("insert into bookings(patient_id, staff_id, visit_purpose, scheduled_at, visit_address, approval_status) values (%s,%s,'checkup','2032-03-03 08:00+00','רחוב 1','confirmed') returning id", (pa, sid)).fetchone()[0]
    c0 = _conn(pg_uri, nurse)
    rid = c0.execute("select id from complete_visit(%s, %s::jsonb)", (bid, '{"systolic_bp":120,"treatment_summary":"x"}')).fetchone()[0]
    c0.commit(); c0.close()
    c1, c2 = _conn(pg_uri, nurse), _conn(pg_uri, nurse)
    ins = "insert into visit_report_amendments(visit_report_id, patient_id, reason, corrections) values (%s,%s,'סיבה ברורה',%s::jsonb)"
    done = {}

    def second():
        c2.execute(ins, (rid, pa, '{"systolic_bp":140}')); c2.commit(); done["x"] = True
    try:
        c1.execute(ins, (rid, pa, '{"systolic_bp":130}'))
        t = threading.Thread(target=second); t.start(); time.sleep(0.6)
        assert "x" not in done, "second amendment must wait for the first (report row lock)"
        c1.commit(); t.join(10)
    finally:
        c1.close(); c2.close()
    with psycopg.connect(pg_uri, autocommit=True) as c:
        prevs = [r[0] for r in c.execute("select previous_values from visit_report_amendments where visit_report_id=%s order by id", (rid,)).fetchall()]
    purge_committed(pg_uri, [nurse, pa], pa, sid)
    assert prevs == [{"systolic_bp": 120}, {"systolic_bp": 130}]
