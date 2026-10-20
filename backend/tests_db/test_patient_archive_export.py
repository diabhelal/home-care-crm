"""Patient archive + legal export with a mandatory access log (proposed/013). Isolated Postgres, synthetic data only."""
import json

import psycopg
import pytest

from tests_db.conftest import as_postgres, as_user
from tests_db.test_db_guards import seed
from tests_db.test_visit_report_amendments import INS
from tests_db.test_visit_report_integrity import COMPLETE, attempt, booking

EXPORT = "select export_patient_record(%s, %s, %s, %s)"


def full_record(db, d):
    bid = booking(db, d)
    as_user(db, d["staff_user"])
    rid = db.execute("select id from complete_visit(%s, %s::jsonb)", (bid, COMPLETE)).fetchone()[0]
    db.execute(INS, (rid, d["pa"], "הבהרה", json.dumps({"pulse": 71})))
    as_postgres(db); db.execute("select set_config('request.jwt.claims', '', true)")
    db.execute("insert into risk_predictions(patient_id, visit_report_id, input_features, risk_level, expires_at) values (%s,%s,'{}','yellow', now() + interval '8 hours')", (d["pa"], rid))
    return rid


def test_only_admin_can_archive_and_restore_server_sets_actor_and_time(db):
    d = seed(db)
    as_user(db, d["pa"])                                   # the patient can update her own row, but not the archive columns
    attempt(db, "update patients set archived_at=now(), archive_reason='נסיון' where id=%s", (d["pa"],), psycopg.errors.InsufficientPrivilege)
    as_user(db, d["staff_user"])                           # staff cannot update patients at all (RLS hides the row from UPDATE)
    assert db.execute("update patients set archived_at=now(), archive_reason='נסיון' where id=%s", (d["pa"],)).rowcount == 0
    as_user(db, d["admin"], admin=True)
    attempt(db, "update patients set archived_at=now() where id=%s", (d["pa"],), psycopg.errors.CheckViolation)           # reason required
    db.execute("update patients set archived_at='2000-01-01', archived_by=%s, archive_reason='סיום טיפול' where id=%s", (d["pb"], d["pa"]))
    row = db.execute("select archived_at > now() - interval '1 minute', archived_by, archive_reason from patients where id=%s", (d["pa"],)).fetchone()
    assert row[0] is True and str(row[1]) == d["admin"] and row[2] == "סיום טיפול"                      # time and actor are the server's
    db.execute("update patients set archived_at=null where id=%s", (d["pa"],))
    assert db.execute("select archived_by, archive_reason from patients where id=%s", (d["pa"],)).fetchone() == (None, None)
    as_postgres(db)
    assert db.execute("select count(*) from audit_log where table_name='patients' and row_id=%s and new_data->>'archive_reason' = 'סיום טיפול'", (d["pa"],)).fetchone()[0] == 1


def test_archived_patient_history_remains_fully_readable(db):
    d = seed(db); rid = full_record(db, d)
    as_user(db, d["admin"], admin=True)
    db.execute("update patients set archived_at=now(), archive_reason='סיום טיפול' where id=%s", (d["pa"],))
    assert db.execute("select count(*) from visit_reports where patient_id=%s", (d["pa"],)).fetchone()[0] == 1
    assert db.execute("select count(*) from risk_predictions where patient_id=%s", (d["pa"],)).fetchone()[0] == 1


def test_export_returns_the_whole_record_and_logs_the_request_in_the_same_transaction(db):
    d = seed(db); full_record(db, d)
    as_user(db, d["admin"], admin=True)
    out = db.execute(EXPORT, (d["pa"], "legal", "עו\"ד דנה לוי", "צו בית משפט 123/26")).fetchone()[0]
    assert out["patient"]["id"] == d["pa"]
    for key, n in (("visit_reports", 1), ("visit_report_amendments", 1), ("risk_predictions", 1), ("bookings", 1)):
        assert len(out[key]) == n, key
    assert out["visit_report_amendments"][0]["corrections"] == {"pulse": 71}          # the amendment AND (below) the original are both present
    assert out["visit_reports"][0]["pulse"] == 70
    assert out["audit_log"], "audit trail of the patient's records is part of the export"
    ex = out["export"]
    assert ex["requester_type"] == "legal" and ex["basis"] == "צו בית משפט 123/26" and ex["exported_by"] == d["admin"]
    log = db.execute("select requester_type, requester_name, basis, exported_by, scope from record_access_log where patient_id=%s", (d["pa"],)).fetchall()
    assert len(log) == 1 and str(log[0][3]) == d["admin"] and log[0][4]["visit_reports"] == 1


def test_export_is_admin_only_requires_a_basis_and_leaves_no_trace_when_refused(db):
    d = seed(db); full_record(db, d)
    for who in ("pa", "staff_user", "pb"):
        as_user(db, d[who])
        attempt(db, EXPORT, (d["pa"], "patient", "x", "בקשת מטופל"), psycopg.errors.InsufficientPrivilege)
    as_user(db, d["admin"], admin=True)
    attempt(db, EXPORT, (d["pa"], "legal", "x", "  "), psycopg.errors.InvalidParameterValue)
    attempt(db, EXPORT, (d["pa"], "friend", "x", "בקשה"), psycopg.errors.InvalidParameterValue)
    attempt(db, EXPORT, ("00000000-0000-4000-8000-0000000000aa", "legal", "x", "בקשה"), psycopg.errors.NoDataFound)
    as_postgres(db)
    assert db.execute("select count(*) from record_access_log").fetchone()[0] == 0


def test_access_log_is_append_only_and_unreadable_to_non_admins(db):
    d = seed(db); full_record(db, d)
    as_user(db, d["admin"], admin=True)
    db.execute(EXPORT, (d["pa"], "patient", "המטופל", "בקשת המטופל לעיין בתיק"))
    attempt(db, "update record_access_log set basis='שונה'", (), psycopg.errors.InsufficientPrivilege)
    attempt(db, "delete from record_access_log", (), psycopg.errors.InsufficientPrivilege)
    attempt(db, "insert into record_access_log(patient_id, requester_type, basis, exported_by) values (%s,'other','x y z',%s)", (d["pa"], d["admin"]), psycopg.errors.InsufficientPrivilege)
    for who in ("pa", "staff_user"):
        as_user(db, d[who]); assert db.execute("select count(*) from record_access_log").fetchone()[0] == 0


def test_a_patient_with_an_export_history_cannot_be_erased(db):
    d = seed(db)
    as_user(db, d["admin"], admin=True)
    db.execute(EXPORT, (d["pb"], "legal", "x", "בקשה משפטית"))
    as_postgres(db); db.execute("select set_config('request.jwt.claims', '', true)")
    attempt(db, "delete from patients where id=%s", (d["pb"],), psycopg.errors.RestrictViolation)
