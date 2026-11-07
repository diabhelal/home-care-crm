"""Medical records are never physically deleted (proposed/015). Isolated Postgres, synthetic data only.

Owner rule 1: no application workflow (admin included) can delete a medical record; deactivating a staff member never
orphans records; nobody inherits a login. The DB owner / service_role (no auth.uid()) is NOT restricted - tested explicitly."""

import psycopg
import pytest

from tests_db.conftest import as_postgres, as_user, new_uuid
from tests_db.test_db_guards import seed
from tests_db.test_visit_report_integrity import (COMPLETE, RESTRICT_ERRORS, assert_delete_restricts, attempt, booking)

MEDICAL_TABLES = ["visit_reports", "visit_report_amendments", "patient_allergies", "patient_medical_history",
                  "clinical_notes", "medication_events", "patient_documents", "service_plans", "service_plan_visits",
                  "risk_predictions", "alerts", "tasks", "patient_contacts", "audit_log", "record_access_log"]
PROTECTED = MEDICAL_TABLES + ["bookings", "patients", "medical_staff"]


def no_jwt(db):
    as_postgres(db)
    db.execute("select set_config('request.jwt.claims', '', true)")


def full_record(db, d):
    """One row in every medical-record table for patient pa (superuser inserts, no JWT subject)."""
    bid = booking(db, d)
    as_user(db, d["staff_user"])
    rid = db.execute("select id from complete_visit(%s, %s::jsonb)", (bid, COMPLETE)).fetchone()[0]
    no_jwt(db)
    pa = d["pa"]
    db.execute("insert into visit_report_amendments(visit_report_id, patient_id, amended_by, reason, corrections) values (%s,%s,%s,'תיקון בדיקה','{}')", (rid, pa, d["staff_user"]))
    db.execute("insert into patient_allergies(patient_id, substance) values (%s,'פניצילין')", (pa,))
    db.execute("insert into patient_medical_history(patient_id, family_history) values (%s,'סינתטי')", (pa,))
    db.execute("insert into clinical_notes(patient_id, note_type, content) values (%s,'general','הערה')", (pa,))
    db.execute("insert into medication_events(patient_id, visit_report_id, medication_name) values (%s,%s,'אקמול')", (pa, rid))
    db.execute("insert into patient_documents(patient_id, document_type, storage_path) values (%s,'lab',%s)", (pa, f"{pa}/a.pdf"))
    plan = db.execute("insert into service_plans(patient_id, service_type, start_date, frequency) values (%s,'nursing','2030-01-01','weekly') returning id", (pa,)).fetchone()[0]
    db.execute("insert into service_plan_visits(service_plan_id, booking_id, planned_date) values (%s,%s,'2030-01-08')", (plan, bid))
    pred = db.execute("insert into risk_predictions(patient_id, visit_report_id, input_features, risk_level, expires_at) values (%s,%s,'{}','yellow', now() + interval '8 hours') returning id", (pa, rid)).fetchone()[0]
    alert = db.execute("insert into alerts(patient_id, risk_prediction_id, alert_type, severity, message) values (%s,%s,'new_red','high','x') returning id", (pa, pred)).fetchone()[0]
    db.execute("insert into tasks(patient_id, alert_id, title, due_at) values (%s,%s,'משימה', now())", (pa, alert))
    db.execute("insert into patient_contacts(patient_id, body) values (%s,'פנייה')", (pa,))
    db.execute("insert into record_access_log(patient_id, requester_type, basis, exported_by) values (%s,'internal','בדיקה פנימית',%s)", (pa, d["admin"]))
    return dict(bid=bid, rid=rid, plan=plan)


def count(db, table):
    as_postgres(db)
    return db.execute(f"select count(*) from public.{table}").fetchone()[0]


def test_authenticated_and_anon_have_no_delete_or_truncate_grant_on_any_medical_table(db):
    for t in PROTECTED:
        for role in ("authenticated", "anon"):
            for priv in ("delete", "truncate"):
                assert not db.execute("select has_table_privilege(%s, %s, %s)", (role, f"public.{t}", priv)).fetchone()[0], (role, t, priv)


@pytest.mark.parametrize("who", ["pa", "staff_user", "other_staff", "deactivated_staff", "admin"])
def test_no_role_can_delete_any_medical_row_even_if_the_grant_were_restored(db, who):
    """Defence in depth: put DELETE/TRUNCATE back (as a mistaken migration would) - the trigger still refuses every app caller."""
    d = seed(db); full_record(db, d)
    other = new_uuid()
    as_postgres(db)
    db.execute("insert into auth.users(id) values (%s)", (other,))
    db.execute("insert into medical_staff(full_name, role, slot_duration_minutes, auth_user_id) values ('אחות ג','nurse',60,%s)", (other,))
    if who == "deactivated_staff":
        db.execute("update medical_staff set is_active=false where id=%s", (d["s1"],))
    for t in PROTECTED:
        db.execute(f"grant delete, truncate on public.{t} to authenticated")
    users = {"pa": d["pa"], "staff_user": d["staff_user"], "other_staff": other, "deactivated_staff": d["staff_user"], "admin": d["admin"]}
    before = {t: count(db, t) for t in PROTECTED}
    as_user(db, users[who], admin=(who == "admin"))
    for t in PROTECTED:
        db.execute("savepoint sp")
        try:
            n = db.execute(f"delete from public.{t}").rowcount
            assert n == 0, f"{who} deleted {n} rows of {t}"          # RLS hid every row: nothing deleted
        except psycopg.errors.InsufficientPrivilege as e:
            assert "never physically deleted" in str(e) or "append-only" in str(e) or "permission denied" in str(e)
        db.execute("rollback to savepoint sp")
        db.execute("savepoint sp")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            db.execute(f"truncate public.{t} cascade")
        db.execute("rollback to savepoint sp")
    assert {t: count(db, t) for t in PROTECTED} == before


def test_admin_delete_is_refused_by_the_trigger_with_a_clear_message(db):
    d = seed(db); full_record(db, d)
    as_postgres(db)
    db.execute("grant delete on public.patient_allergies, public.visit_reports, public.patient_contacts to authenticated")
    as_user(db, d["admin"], admin=True)
    for t in ("patient_allergies", "visit_reports", "patient_contacts"):
        db.execute("savepoint sp")
        with pytest.raises(psycopg.errors.InsufficientPrivilege, match="never physically deleted"):
            db.execute(f"delete from public.{t}")
        db.execute("rollback to savepoint sp")


def test_deleting_a_staff_member_is_refused_even_without_history_and_deactivation_keeps_the_records(db):
    d = seed(db); ids = full_record(db, d)
    as_postgres(db)
    db.execute("grant delete on public.medical_staff to authenticated")
    as_user(db, d["admin"], admin=True)
    attempt(db, "delete from medical_staff where id=%s", (d["s2"],), psycopg.errors.InsufficientPrivilege)   # no history, still refused
    no_jwt(db)
    db.execute("update medical_staff set is_active=false where id=%s", (d["s1"],))                          # deactivate
    assert db.execute("select staff_id from visit_reports where id=%s", (ids["rid"],)).fetchone()[0] == d["s1"]
    assert db.execute("select count(*) from bookings where id=%s", (ids["bid"],)).fetchone()[0] == 1


@pytest.mark.parametrize("child,col,parent", [
    ("bookings", "patient_id", "patients"), ("visit_reports", "patient_id", "patients"), ("visit_reports", "booking_id", "bookings"),
    ("visit_reports", "staff_id", "medical_staff"), ("bookings", "staff_id", "medical_staff"),
    ("risk_predictions", "patient_id", "patients"), ("risk_predictions", "visit_report_id", "visit_reports"),
    ("patient_allergies", "patient_id", "patients"), ("patient_medical_history", "patient_id", "patients"),
    ("clinical_notes", "patient_id", "patients"), ("medication_events", "patient_id", "patients"),
    ("medication_events", "visit_report_id", "visit_reports"), ("service_plans", "patient_id", "patients"),
    ("service_plan_visits", "service_plan_id", "service_plans"), ("service_plan_visits", "booking_id", "bookings"),
    ("patient_documents", "patient_id", "patients"), ("patient_contacts", "patient_id", "patients"),
    ("alerts", "patient_id", "patients"), ("alerts", "risk_prediction_id", "risk_predictions"),
    ("tasks", "patient_id", "patients"), ("tasks", "alert_id", "alerts"),
    ("visit_report_amendments", "patient_id", "patients"), ("visit_report_amendments", "visit_report_id", "visit_reports"),
    ("record_access_log", "patient_id", "patients")])
def test_foreign_keys_to_records_are_restrict_not_cascade_or_set_null(db, child, col, parent):
    assert_delete_restricts(db, child, col, parent)


def test_even_the_owner_cannot_cascade_away_a_patients_record(db):
    d = seed(db); full_record(db, d)
    no_jwt(db)
    attempt(db, "delete from patients where id=%s", (d["pa"],), RESTRICT_ERRORS)
    attempt(db, "delete from visit_reports", (), RESTRICT_ERRORS)      # amendments/predictions/medications point at it
    attempt(db, "delete from bookings", (), RESTRICT_ERRORS)
    assert count(db, "visit_reports") == 1 and count(db, "patient_allergies") == 1


def test_owner_without_jwt_can_still_maintain_leaf_data_documented_limitation(db):
    d = seed(db); full_record(db, d)
    no_jwt(db)
    assert db.execute("delete from tasks").rowcount == 1               # service_role / SQL editor are not blocked (cannot be prevented from SQL)
    assert db.execute("delete from patient_contacts").rowcount == 1


# ---------------------------------------------------------------- medical_staff identity
def test_login_link_of_a_staff_member_is_immutable_for_admin_and_nobody_inherits(db):
    d = seed(db)
    newcomer = new_uuid()
    as_postgres(db); db.execute("insert into auth.users(id) values (%s)", (newcomer,))
    as_user(db, d["admin"], admin=True)
    attempt(db, "update medical_staff set auth_user_id=%s where id=%s", (newcomer, d["s1"]), psycopg.errors.InsufficientPrivilege)
    attempt(db, "update medical_staff set auth_user_id=null where id=%s", (d["s1"],), psycopg.errors.InsufficientPrivilege)
    no_jwt(db)
    db.execute("update medical_staff set is_active=false where id=%s", (d["s1"],))
    as_user(db, d["admin"], admin=True)
    attempt(db, "update medical_staff set auth_user_id=%s where id=%s", (newcomer, d["s1"]), psycopg.errors.InsufficientPrivilege)
    assert str(db.execute("select auth_user_id from medical_staff where id=%s", (d["s1"],)).fetchone()[0]) == d["staff_user"]


def test_first_link_only_by_admin_on_an_active_staff_row(db):
    d = seed(db)
    newcomer = new_uuid()
    as_postgres(db); db.execute("insert into auth.users(id) values (%s)", (newcomer,))
    as_user(db, d["staff_user"])                                         # a nurse cannot link anybody (RLS hides other rows)
    assert db.execute("update medical_staff set auth_user_id=%s where id=%s", (newcomer, d["s2"])).rowcount == 0
    no_jwt(db); db.execute("update medical_staff set is_active=false where id=%s", (d["s2"],))
    as_user(db, d["admin"], admin=True)
    attempt(db, "update medical_staff set auth_user_id=%s where id=%s", (newcomer, d["s2"]), psycopg.errors.InsufficientPrivilege)
    no_jwt(db); db.execute("update medical_staff set is_active=true where id=%s", (d["s2"],))
    as_user(db, d["admin"], admin=True)
    db.execute("update medical_staff set auth_user_id=%s where id=%s", (newcomer, d["s2"]))
    assert str(db.execute("select auth_user_id from medical_staff where id=%s", (d["s2"],)).fetchone()[0]) == newcomer


def test_service_role_edge_function_path_can_link_a_login(db):
    d = seed(db)
    newcomer = new_uuid()
    as_postgres(db); db.execute("insert into auth.users(id) values (%s)", (newcomer,))
    db.execute("select set_config('request.jwt.claims', '', true)")
    db.execute("update medical_staff set auth_user_id=%s where id=%s", (newcomer, d["s2"]))   # no auth.uid(): create-staff-login


# ---------------------------------------------------------------- immutable logs
def test_audit_and_access_logs_are_immutable_even_for_the_owner(db):
    d = seed(db); full_record(db, d)
    no_jwt(db)
    assert count(db, "audit_log") > 0 and count(db, "record_access_log") == 1
    for t in ("audit_log", "record_access_log"):
        attempt(db, f"update public.{t} set patient_id=patient_id" if t == "record_access_log" else f"update public.{t} set table_name=table_name", (), psycopg.errors.InsufficientPrivilege)
        attempt(db, f"delete from public.{t}", (), psycopg.errors.InsufficientPrivilege)
        attempt(db, f"truncate public.{t}", (), psycopg.errors.InsufficientPrivilege)
    as_user(db, d["admin"], admin=True)
    for t in ("audit_log", "record_access_log"):
        attempt(db, f"update public.{t} set patient_id=patient_id" if t == "record_access_log" else f"update public.{t} set table_name=table_name", (), psycopg.errors.InsufficientPrivilege)


# ---------------------------------------------------------------- audit trigger fixes
def test_audit_old_data_is_recorded_and_medical_history_can_be_written(db):
    d = seed(db)
    as_user(db, d["admin"], admin=True)
    db.execute("insert into patient_medical_history(patient_id, family_history) values (%s,'א')", (d["pa"],))     # failed before: row_id NOT NULL
    db.execute("update patient_medical_history set family_history='ב' where patient_id=%s", (d["pa"],))
    as_postgres(db)
    rows = db.execute("select action, row_id, old_data->>'family_history', new_data->>'family_history' from audit_log "
                      "where table_name='patient_medical_history' order by id").fetchall()
    assert rows == [("insert", d["pa"], None, "א"), ("update", d["pa"], "א", "ב")]


def test_audit_action_check_accepts_delete_archive_void_amend(db):
    as_postgres(db)
    for a in ("delete", "archive", "void", "amend"):
        db.execute("savepoint sp")
        db.execute("insert into audit_log(action, table_name, row_id) values (%s,'x','1')", (a,))
        db.execute("rollback to savepoint sp")
    attempt(db, "insert into audit_log(action, table_name, row_id) values ('truncate','x','1')", (), psycopg.errors.CheckViolation)


# ---------------------------------------------------------------- storage
def test_storage_bucket_admin_can_read_and_add_but_not_overwrite_or_delete(db):
    d = seed(db)
    as_postgres(db)
    db.execute("insert into storage.buckets(id, name) values ('patient-documents','patient-documents') on conflict do nothing")
    db.execute("insert into storage.objects(bucket_id, name) values ('patient-documents','p/a.pdf')")
    db.execute("grant select, insert, update, delete on storage.objects to authenticated")
    pols = db.execute("select cmd from pg_policies where schemaname='storage' and tablename='objects' and policyname like '%patient_documents_storage'").fetchall()
    assert sorted(p[0] for p in pols) == ["INSERT", "SELECT"]            # no ALL / UPDATE / DELETE policy remains
    as_user(db, d["admin"], admin=True)
    assert db.execute("select count(*) from storage.objects").fetchone()[0] == 1
    db.execute("insert into storage.objects(bucket_id, name) values ('patient-documents','p/b.pdf')")
    assert db.execute("update storage.objects set name='p/x.pdf' where name='p/a.pdf'").rowcount == 0     # overwrite/rename refused (RLS)
    assert db.execute("delete from storage.objects where name='p/a.pdf'").rowcount == 0
    as_user(db, d["staff_user"])
    assert db.execute("select count(*) from storage.objects").fetchone()[0] == 0
    attempt(db, "insert into storage.objects(bucket_id, name) values ('patient-documents','p/c.pdf')", (), psycopg.errors.InsufficientPrivilege)
    no_jwt(db)
    assert db.execute("select count(*) from storage.objects").fetchone()[0] == 2
