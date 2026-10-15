"""Server-derived authorship (supabase/proposed/007). Isolated local Postgres, synthetic data only."""
import psycopg
import pytest

from tests_db.conftest import as_postgres, as_user, new_uuid
from tests_db.test_db_guards import _report_id, seed


def world(db):
    d = seed(db)
    _report_id(db, d)           # links patient pa to staff s1 (is_my_patient)
    return d


def test_medication_event_created_by_overridden(db):
    d = world(db)
    forged = new_uuid()
    as_postgres(db); db.execute("insert into auth.users(id) values (%s)", (forged,))
    as_user(db, d["staff_user"])
    row = db.execute("insert into medication_events(patient_id, medication_name, created_by, created_at) "
                     "values (%s,'x',%s,'2001-01-01') returning id, created_by, created_at", (d["pa"], forged)).fetchone()
    assert str(row[1]) == d["staff_user"]
    assert row[2].year >= 2026
    # update cannot re-attribute or re-point
    db.execute("update medication_events set created_by=%s, notes='n' where id=%s", (forged, row[0]))
    assert str(db.execute("select created_by from medication_events where id=%s", (row[0],)).fetchone()[0]) == d["staff_user"]
    as_user(db, d["admin"], admin=True)
    db.execute("savepoint sp")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("update medication_events set patient_id=%s where id=%s", (d["pb"], row[0]))
    db.execute("rollback to savepoint sp")


def test_admin_service_plan_and_visits(db):
    d = world(db)
    forged = new_uuid()
    as_postgres(db); db.execute("insert into auth.users(id) values (%s)", (forged,))
    as_user(db, d["admin"], admin=True)
    pid = db.execute("insert into service_plans(patient_id, service_type, start_date, frequency, created_by) "
                     "values (%s,'nursing','2030-01-01','weekly',%s) returning id", (d["pa"], forged)).fetchone()[0]
    assert str(db.execute("select created_by from service_plans where id=%s", (pid,)).fetchone()[0]) == d["admin"]
    db.execute("savepoint sp")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("update service_plans set patient_id=%s where id=%s", (d["pb"], pid))
    db.execute("rollback to savepoint sp")
    vid = db.execute("insert into service_plan_visits(service_plan_id, planned_date) "
                     "values (%s,'2030-01-08') returning id", (pid,)).fetchone()[0]
    pid2 = db.execute("insert into service_plans(patient_id, service_type, start_date, frequency) "
                      "values (%s,'nursing','2030-01-01','weekly') returning id", (d["pa"],)).fetchone()[0]
    db.execute("savepoint sp")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("update service_plan_visits set service_plan_id=%s where id=%s", (pid2, vid))
    db.execute("rollback to savepoint sp")
    db.execute("update service_plan_visits set status='scheduled' where id=%s", (vid,))


def test_patient_documents_and_allergies(db):
    d = world(db)
    forged = new_uuid()
    as_postgres(db); db.execute("insert into auth.users(id) values (%s)", (forged,))
    as_user(db, d["admin"], admin=True)
    doc = db.execute("insert into patient_documents(patient_id, document_type, storage_path, uploaded_by) "
                     "values (%s,'lab','p/a.pdf',%s) returning id", (d["pa"], forged)).fetchone()[0]
    assert str(db.execute("select uploaded_by from patient_documents where id=%s", (doc,)).fetchone()[0]) == d["admin"]
    for sql, args in (("update patient_documents set patient_id=%s where id=%s", (d["pb"], doc)),
                      ("update patient_documents set storage_path='other' where id=%s", (doc,))):
        db.execute("savepoint sp")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            db.execute(sql, args)
        db.execute("rollback to savepoint sp")
    al = db.execute("insert into patient_allergies(patient_id, substance, created_by) values (%s,'x',%s) returning id, created_by",
                    (d["pa"], forged)).fetchone()
    assert str(al[1]) == d["admin"]


def test_medical_history_upsert_sets_updated_by(db):
    d = world(db)
    forged = new_uuid()
    as_postgres(db); db.execute("insert into auth.users(id) values (%s)", (forged,))
    # KNOWN PRE-EXISTING ISSUE (see report): audit_patient_medical_history writes row_id=null (table has no
    # `id`) and audit_log.row_id is NOT NULL, so any write fails. Dropped inside this rolled-back
    # transaction so the authorship trigger can be exercised on its own.
    db.execute("drop trigger audit_patient_medical_history on patient_medical_history")
    as_user(db, d["admin"], admin=True)
    db.execute("insert into patient_medical_history(patient_id, updated_by, updated_at) values (%s,%s,'2001-01-01')",
               (d["pa"], forged))
    r = db.execute("select updated_by, updated_at from patient_medical_history where patient_id=%s", (d["pa"],)).fetchone()
    assert str(r[0]) == d["admin"] and r[1].year >= 2026
    db.execute("insert into patient_medical_history(patient_id, updated_by, mobility) values (%s,%s,'m') "
               "on conflict (patient_id) do update set updated_by=excluded.updated_by, mobility=excluded.mobility",
               (d["pa"], forged))
    assert str(db.execute("select updated_by from patient_medical_history where patient_id=%s", (d["pa"],)).fetchone()[0]) == d["admin"]


def test_clinical_notes_author_forced_and_insert_only(db):
    d = world(db)
    forged = new_uuid()
    as_postgres(db); db.execute("insert into auth.users(id) values (%s)", (forged,))
    as_user(db, d["staff_user"])
    r = db.execute("insert into clinical_notes(patient_id, author_id, author_role, note_type, content) "
                   "values (%s,%s,'admin','general','c') returning id, author_id, author_role", (d["pa"], forged)).fetchone()
    assert str(r[1]) == d["staff_user"] and r[2] == "nurse"
    for sql in ("update clinical_notes set content='z' where id=%s", "delete from clinical_notes where id=%s"):
        db.execute("savepoint sp")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            db.execute(sql, (r[0],))
        db.execute("rollback to savepoint sp")
    as_user(db, d["admin"], admin=True)
    r2 = db.execute("insert into clinical_notes(patient_id, note_type, content) values (%s,'general','c') returning author_role",
                    (d["pa"],)).fetchone()
    assert r2[0] == "admin"
    db.execute("savepoint sp")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("update clinical_notes set content='z' where patient_id=%s", (d["pa"],))
    db.execute("rollback to savepoint sp")


def test_alert_delete_admin_only_staff_may_resolve(db):
    d = world(db)
    as_postgres(db)
    db.execute("select set_config('request.jwt.claims', '', true)")
    aid = db.execute("insert into alerts(patient_id, alert_type, severity, message) "
                     "values (%s,'new_red','high','m') returning id", (d["pa"],)).fetchone()[0]
    as_user(db, d["staff_user"])
    db.execute("update alerts set status='resolved' where id=%s", (aid,))   # allowed
    # today RLS alone gives staff no delete policy (0 rows); the trigger is defence in depth, so
    # exercise it with a hypothetical permissive policy (rolled back with the test transaction).
    as_postgres(db)
    db.execute("create policy tmp_staff_delete on alerts for delete to authenticated using (is_my_patient(patient_id))")
    as_user(db, d["staff_user"])
    db.execute("savepoint sp")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("delete from alerts where id=%s", (aid,))
    db.execute("rollback to savepoint sp")
    as_user(db, d["admin"], admin=True)
    db.execute("delete from alerts where id=%s", (aid,))
    assert db.execute("select count(*) from alerts where id=%s", (aid,)).fetchone()[0] == 0


def test_no_jwt_subject_is_unrestricted(db):
    d = world(db)
    forged = new_uuid()
    as_postgres(db)
    db.execute("select set_config('request.jwt.claims', '', true)")   # no JWT subject
    db.execute("insert into auth.users(id) values (%s)", (forged,))
    r = db.execute("insert into medication_events(patient_id, medication_name, created_by) values (%s,'x',%s) returning created_by",
                   (d["pa"], forged)).fetchone()
    assert str(r[0]) == forged
