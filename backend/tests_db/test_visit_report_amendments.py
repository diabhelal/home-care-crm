"""Append-only amendments to completed visit reports (proposed/012). Isolated Postgres, synthetic data only."""
import json

import psycopg
import pytest

from tests_db.conftest import as_postgres, as_user, new_uuid
from tests_db.test_db_guards import seed
from tests_db.test_visit_report_integrity import COMPLETE, attempt, booking

INS = "insert into visit_report_amendments(visit_report_id, patient_id, reason, corrections) values (%s,%s,%s,%s::jsonb) returning id"


def report(db, d):
    bid = booking(db, d)
    as_user(db, d["staff_user"])
    return db.execute("select id from complete_visit(%s, %s::jsonb)", (bid, COMPLETE)).fetchone()[0]


def test_staff_amends_a_completed_report_and_the_original_is_untouched(db):
    d = seed(db); rid = report(db, d)
    as_user(db, d["staff_user"])
    aid = db.execute(INS, (rid, d["pb"], "טעות הקלדה בלחץ דם", json.dumps({"systolic_bp": 135}))).fetchone()[0]
    row = db.execute("select patient_id, amended_by, amended_by_role, reason, created_at from visit_report_amendments where id=%s", (aid,)).fetchone()
    assert str(row[0]) == d["pa"]                         # patient taken from the report even though the client sent another
    assert str(row[1]) == d["staff_user"] and row[2] == "nurse" and row[4] is not None
    assert db.execute("select systolic_bp from visit_reports where id=%s", (rid,)).fetchone()[0] == 120   # original kept
    as_postgres(db)
    assert db.execute("select count(*) from audit_log where table_name='visit_report_amendments'").fetchone()[0] == 1


def test_amendments_are_append_only_even_for_admin(db):
    d = seed(db); rid = report(db, d)
    as_user(db, d["admin"], admin=True)
    aid = db.execute(INS, (rid, d["pa"], "הבהרה", "{}")).fetchone()[0]
    attempt(db, "update visit_report_amendments set reason='שונה' where id=%s", (aid,), psycopg.errors.InsufficientPrivilege)
    attempt(db, "delete from visit_report_amendments where id=%s", (aid,), psycopg.errors.InsufficientPrivilege)


def test_other_nurse_and_patients_cannot_write(db):
    d = seed(db); rid = report(db, d)
    other = new_uuid()
    as_postgres(db)
    db.execute("insert into auth.users(id) values (%s)", (other,))
    db.execute("insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id) values ('אחות ג','nurse',60,%s)", (other,))
    as_user(db, other)
    attempt(db, INS, (rid, d["pa"], "ניסיון", "{}"), psycopg.errors.InsufficientPrivilege)
    as_user(db, d["pa"])
    attempt(db, INS, (rid, d["pa"], "ניסיון", "{}"), psycopg.errors.InsufficientPrivilege)


def test_validation_of_reason_and_corrections(db):
    d = seed(db); rid = report(db, d)
    as_user(db, d["staff_user"])
    attempt(db, INS, (rid, d["pa"], "  ", "{}"), psycopg.errors.CheckViolation)                                  # reason mandatory
    attempt(db, INS, (rid, d["pa"], "סיבה", json.dumps({"systolic_bp": 999})), psycopg.errors.CheckViolation)  # out of range
    attempt(db, INS, (rid, d["pa"], "סיבה", json.dumps({"staff_id": 1})), psycopg.errors.InvalidParameterValue)  # field not correctable
    attempt(db, INS, (rid, d["pa"], "סיבה", json.dumps({"pulse": "fast"})), psycopg.errors.InvalidParameterValue)
    attempt(db, INS, (rid, d["pa"], "סיבה", json.dumps([1])), psycopg.errors.InvalidParameterValue)
    assert db.execute(INS, (rid, d["pa"], "תיקון סיכום", json.dumps({"treatment_summary": "סיכום מתוקן", "pulse": 72}))).fetchone()[0]


def test_visibility_staff_assigned_patient_own_and_others_none(db):
    d = seed(db); rid = report(db, d)
    as_user(db, d["staff_user"]); db.execute(INS, (rid, d["pa"], "הבהרה", "{}"))
    for who, expected in (("staff_user", 1), ("pa", 1), ("pb", 0)):
        as_user(db, d[who]); assert db.execute("select count(*) from visit_report_amendments").fetchone()[0] == expected, who
    as_user(db, d["admin"], admin=True); assert db.execute("select count(*) from visit_report_amendments").fetchone()[0] == 1


def test_a_report_with_amendments_cannot_be_erased_by_a_cascade(db):
    d = seed(db); rid = report(db, d)
    as_user(db, d["staff_user"]); db.execute(INS, (rid, d["pa"], "הבהרה", "{}"))
    as_postgres(db)
    db.execute("select set_config('request.jwt.claims', '', true)")     # a privileged delete (authenticated has no DELETE on patients)
    attempt(db, "delete from patients where id=%s", (d["pa"],), psycopg.errors.RestrictViolation)
    assert db.execute("select count(*) from visit_reports where id=%s", (rid,)).fetchone()[0] == 1
