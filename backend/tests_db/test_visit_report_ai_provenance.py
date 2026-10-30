"""AI provenance columns on visit_reports + complete_visit (proposed/014). Isolated Postgres, synthetic data only."""
import json

import psycopg

from tests_db.conftest import as_postgres, as_user
from tests_db.test_db_guards import seed
from tests_db.test_visit_report_integrity import attempt, booking

BASE = {"systolic_bp": 120, "diastolic_bp": 80, "pulse": 70, "treatment_summary": "סיכום סופי", "source_notes": "הערות מקור"}
AI = {"ai_assisted": True, "ai_edited": True, "ai_model": "claude-test", "ai_prompt_version": "visit-summary-he-v1", "ai_generation_id": "abc123"}
SEL = ("select ai_assisted, ai_edited, ai_model, ai_prompt_version, ai_generation_id, ai_approved_by, ai_approved_at, source_notes, treatment_summary "
       "from visit_reports where booking_id=%s")


def complete(db, d, payload, who="staff_user", admin=False):
    bid = booking(db, d)
    as_user(db, d[who], admin=admin)
    db.execute("select complete_visit(%s, %s::jsonb)", (bid, json.dumps(payload)))
    as_postgres(db); db.execute("select set_config('request.jwt.claims', '', true)")
    return bid, db.execute(SEL, (bid,)).fetchone()


def test_manual_completion_is_unchanged_and_not_ai_assisted(db):
    d = seed(db)
    bid, row = complete(db, d, {"treatment_summary": "ידני", "pulse": 70})
    assert row[0] is False and row[1:7] == (None,) * 6 and row[7] is None and row[8] == "ידני"
    assert db.execute("select status from bookings where id=%s", (bid,)).fetchone()[0] == "completed"


def test_ai_completion_stores_provenance_and_the_database_sets_approver_and_time(db):
    d = seed(db)
    forged = {"ai_approved_by": d["pb"], "ai_approved_at": "2000-01-01T00:00:00Z"}          # a client cannot choose who approved or when
    bid, row = complete(db, d, {**BASE, **AI, **forged})
    assert row[0] is True and row[1] is True and row[2:5] == ("claude-test", "visit-summary-he-v1", "abc123")
    assert str(row[5]) == d["staff_user"] and row[6].year > 2020
    assert row[7] == "הערות מקור" and row[8] == "סיכום סופי"
    as_postgres(db)
    assert db.execute("select count(*) from audit_log where table_name='visit_reports' and new_data->>'ai_assisted'='true'").fetchone()[0] == 1


def test_admin_completion_records_the_admin_as_approver(db):
    d = seed(db)
    _, row = complete(db, d, {**BASE, **AI}, who="admin", admin=True)
    assert str(row[5]) == d["admin"]


def test_ai_fields_without_the_flag_are_ignored(db):
    d = seed(db)
    _, row = complete(db, d, {**BASE, "ai_model": "x", "ai_generation_id": "y", "ai_edited": True})
    assert row[0] is False and row[1:7] == (None,) * 6


def test_direct_writes_cannot_forge_or_change_provenance(db):
    d = seed(db)
    bid, _ = complete(db, d, {**BASE, **AI})
    as_user(db, d["staff_user"])
    db.execute("update visit_reports set ai_assisted=false, ai_model='forged', ai_approved_by=%s, source_notes='שונה' where booking_id=%s", (d["pb"], bid))
    as_postgres(db)
    row = db.execute(SEL, (bid,)).fetchone()
    assert row[0] is True and row[2] == "claude-test" and str(row[5]) == d["staff_user"] and row[7] == "הערות מקור"
    # a direct insert claiming AI help gets the real approver; one not claiming it carries no provenance
    bid2 = booking(db, d, patient="pb", at="2030-01-07 12:00:00+00")
    as_user(db, d["staff_user"])
    db.execute("insert into visit_reports(booking_id, patient_id, staff_id, treatment_summary, ai_assisted, ai_approved_by, ai_model) values (%s,%s,%s,'x',true,%s,'m')",
               (bid2, d["pb"], d["s1"], d["pa"]))
    as_postgres(db)
    assert str(db.execute("select ai_approved_by from visit_reports where booking_id=%s", (bid2,)).fetchone()[0]) == d["staff_user"]


def test_inconsistent_ai_columns_are_rejected_by_the_constraint(db):
    d = seed(db)
    bid = booking(db, d)
    as_postgres(db); db.execute("select set_config('request.jwt.claims', '', true)")
    attempt(db, "insert into visit_reports(booking_id, patient_id, staff_id, treatment_summary, ai_assisted, ai_model) values (%s,%s,%s,'x',false,'m')",
            (bid, d["pa"], d["s1"]), psycopg.errors.CheckViolation)
