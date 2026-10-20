#!/usr/bin/env python3
"""Verify supabase/migrations + supabase/proposed on a THROWAWAY local Postgres (never a live project).

  cd backend && source .venv/bin/activate && python scripts/verify_proposed_sql.py

Steps: (1) bootstrap Supabase shims, (2) apply migrations then proposed 001..007 in order,
(3) re-apply the proposed files (idempotency), (4) run the post-flight assertions of
docs/STAGING_PLAN.md, (5) run the ROLLBACK blocks of that plan in reverse order inside a
transaction and assert the objects are gone / grants restored. Exit code 0 only if all pass.
"""
import pathlib
import re
import sys
import tempfile

import psycopg

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOTSTRAP = ROOT / "backend" / "tests_db" / "bootstrap.sql"
PLAN = ROOT / "docs" / "STAGING_PLAN.md"
PROPOSED_ORDER = ["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011", "012"]

# (description, sql returning a single boolean that must be TRUE)
POSTFLIGHT = [
    ("unique index: one idempotency key per patient",
     "select to_regclass('public.bookings_patient_idempotency_key_uidx') is not null"),
    ("unique index: no double booking of an active slot",
     "select to_regclass('public.bookings_staff_id_scheduled_at_active_key') is not null"),
    ("booking guard triggers exist (005)",
     "select count(*) = 2 from pg_trigger where not tgisinternal and tgname in ('bookings_guard_insert','bookings_guard_update')"),
    ("alert/task guard triggers exist (006)",
     "select count(*) = 3 from pg_trigger where not tgisinternal and tgname in ('alerts_guard_update','tasks_guard_insert','tasks_guard_update')"),
    ("authorship + alert-delete guard triggers exist (007)",
     "select count(*) = 8 from pg_trigger where not tgisinternal and tgname in ('medication_events_authorship',"
     "'service_plans_authorship','patient_allergies_authorship','patient_documents_authorship',"
     "'patient_medical_history_authorship','service_plan_visits_authorship','clinical_notes_authorship','alerts_guard_delete')"),
    ("anon has NO table privileges in public",
     "select not exists (select 1 from information_schema.role_table_grants where grantee='anon' and table_schema='public')"),
    ("anon has NO execute on any public function (SECURITY DEFINER or not, ours)",
     "select not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' "
     "and p.proname in ('record_risk_prediction','record_auto_alert','check_in_visit','complete_visit','staff_busy_blocks',"
     "'admin_list_staff','_verify_server_attestation','_insert_auto_alert','_hmac_sha256','_is_jwt_admin') "
     "and has_function_privilege('anon', p.oid, 'execute'))"),
    ("record_risk_prediction not executable by anon, executable by authenticated",
     "select not has_function_privilege('anon','public.record_risk_prediction(bigint,jsonb)','execute') "
     "and has_function_privilege('authenticated','public.record_risk_prediction(bigint,jsonb)','execute')"),
    ("internal helpers not executable by authenticated",
     "select not has_function_privilege('authenticated','public._verify_server_attestation(jsonb)','execute') "
     "and not has_function_privilege('authenticated','public._hmac_sha256(bytea,bytea)','execute')"),
    ("no direct INSERT on risk_predictions / alerts for authenticated",
     "select not has_table_privilege('authenticated','public.risk_predictions','insert') "
     "and not has_table_privilege('authenticated','public.alerts','insert')"),
    ("server_secrets unreachable for anon/authenticated, RLS on",
     "select not has_table_privilege('authenticated','public.server_secrets','select') "
     "and not has_table_privilege('anon','public.server_secrets','select') "
     "and (select relrowsecurity from pg_class where oid='public.server_secrets'::regclass)"),
    ("clinical_notes still insert-only for authenticated",
     "select has_table_privilege('authenticated','public.clinical_notes','insert') "
     "and not has_table_privilege('authenticated','public.clinical_notes','update') "
     "and not has_table_privilege('authenticated','public.clinical_notes','delete')"),
    ("staff PII columns not readable by authenticated (guests/patients)",
     "select not has_column_privilege('authenticated','public.medical_staff','national_id','select') "
     "and not has_column_privilege('authenticated','public.medical_staff','email','select') "
     "and has_column_privilege('authenticated','public.medical_staff','full_name','select')"),
    ("008 visit_reports integrity trigger exists",
     "select count(*) = 1 from pg_trigger where not tgisinternal and tgname = 'visit_reports_integrity_guard'"),
    ("009 staff FKs are RESTRICT, inactive-staff trigger and history policy exist",
     "select (select count(*) from pg_constraint where conname in ('bookings_staff_id_fkey','visit_reports_staff_id_fkey') and confdeltype = 'r') = 2 "
     "and exists (select 1 from pg_trigger where not tgisinternal and tgname = 'bookings_assign_active_staff_guard') "
     "and exists (select 1 from pg_policies where tablename = 'medical_staff' and policyname = 'medical_staff_select_own_history')"),
    ("010 booking update conflict trigger exists",
     "select count(*) = 1 from pg_trigger where not tgisinternal and tgname = 'bookings_update_conflict_guard'"),
    ("011 risk status view returns the latest prediction with staleness columns",
     "select (select count(*) from information_schema.columns where table_schema='public' and table_name='current_patient_risk' "
     "and column_name in ('age_hours','is_stale','newer_report_exists')) = 3 "
     "and has_table_privilege('authenticated','public.current_patient_risk','select') "
     "and not has_table_privilege('anon','public.current_patient_risk','select')"),
    ("012 amendments table: RLS on, append-only grants for authenticated, nothing for anon",
     "select (select relrowsecurity from pg_class where oid='public.visit_report_amendments'::regclass) "
     "and has_table_privilege('authenticated','public.visit_report_amendments','insert') "
     "and not has_table_privilege('authenticated','public.visit_report_amendments','update') "
     "and not has_table_privilege('authenticated','public.visit_report_amendments','delete') "
     "and not has_table_privilege('anon','public.visit_report_amendments','select')"),
    ("RLS enabled on every public table",
     "select not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace "
     "where n.nspname='public' and c.relkind='r' and not c.relrowsecurity)"),
]

# (description, sql that must be TRUE after running the rollback blocks of the given file)
ROLLBACK_EXPECT = {
    "012": [("012 table and function gone", "select to_regclass('public.visit_report_amendments') is null "
                                           "and to_regprocedure('public.visit_report_amendments_guard()') is null")],
    "011": [("011 view back to the previous definition (no staleness columns, still selectable)",
             "select (select count(*) from information_schema.columns where table_schema='public' and table_name='current_patient_risk' "
             "and column_name in ('age_hours','is_stale','newer_report_exists')) = 0 "
             "and has_table_privilege('authenticated','public.current_patient_risk','select')")],
    "010": [("010 trigger gone", "select count(*) = 0 from pg_trigger where tgname = 'bookings_update_conflict_guard'")],
    "009": [("009 objects gone, FKs cascade again",
             "select count(*) = 0 from pg_trigger where tgname = 'bookings_assign_active_staff_guard' "
             "and (select count(*) from pg_constraint where conname in ('bookings_staff_id_fkey','visit_reports_staff_id_fkey') and confdeltype = 'c') = 2")],
    "008": [("008 trigger gone", "select count(*) = 0 from pg_trigger where tgname = 'visit_reports_integrity_guard'")],
    "007": [("007 triggers gone", "select count(*) = 0 from pg_trigger where tgname like '%\\_authorship' escape '\\' or tgname = 'alerts_guard_delete'"),
            ("007 helper gone", "select to_regprocedure('public._is_jwt_admin()') is null")],
    "006": [("006 functions gone", "select to_regprocedure('public.record_risk_prediction(bigint,jsonb)') is null"),
            ("006 triggers gone", "select count(*) = 0 from pg_trigger where tgname in ('alerts_guard_update','tasks_guard_insert','tasks_guard_update')"),
            ("006 insert grants restored (pre-006 state)",
             "select has_table_privilege('authenticated','public.risk_predictions','insert') and has_table_privilege('authenticated','public.alerts','insert')")],
    "005": [("005 triggers gone", "select count(*) = 0 from pg_trigger where tgname in ('bookings_guard_insert','bookings_guard_update')")],
    "004": [("004 function gone", "select to_regprocedure('public.staff_busy_blocks(bigint,timestamptz,timestamptz,text)') is null")],
    "003": [("003 function gone", "select to_regprocedure('public.complete_visit(bigint,jsonb)') is null")],
    "002": [("002 function gone", "select to_regprocedure('public.check_in_visit(bigint)') is null")],
    "001": [("001 index gone", "select to_regclass('public.bookings_patient_idempotency_key_uidx') is null"),
            ("001 columns gone", "select count(*) = 0 from information_schema.columns where table_schema='public' and table_name='bookings' "
                                 "and column_name in ('approval_status','visit_address','visit_lat','visit_lng','checked_in_at','idempotency_key')")],
}


def sql_files():
    mig = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
    prop = []
    for n in PROPOSED_ORDER:
        m = sorted((ROOT / "supabase" / "proposed").glob(f"{n}_*.sql"))
        if len(m) != 1:
            raise SystemExit(f"expected exactly one proposed file for {n}, found {len(m)}")
        prop.append(m[0])
    return mig, prop


def rollback_blocks(plan_text):
    """ROLLBACK blocks are fenced ```sql blocks whose first line is `-- ROLLBACK 00N`."""
    out = {}
    for m in re.finditer(r"```sql\n-- ROLLBACK (\d{3})\n(.*?)```", plan_text, re.S):
        out[m.group(1)] = m.group(2)
    return out


def postflight_failures(conn):
    bad = []
    for desc, sql in POSTFLIGHT:
        ok = conn.execute(sql).fetchone()[0]
        if ok is not True:
            bad.append(desc)
    return bad


def rollback_failures(conn, plan_text):
    """Runs inside the caller's transaction (caller rolls back)."""
    blocks = rollback_blocks(plan_text)
    bad = []
    for n in reversed(PROPOSED_ORDER):
        if n not in blocks:
            bad.append(f"no ROLLBACK block for {n} in docs/STAGING_PLAN.md")
            continue
        try:
            conn.execute("savepoint rb")
            conn.execute(blocks[n])
            for desc, sql in ROLLBACK_EXPECT[n]:
                if conn.execute(sql).fetchone()[0] is not True:
                    bad.append(f"after rollback {n}: {desc}")
        except Exception as e:
            conn.execute("rollback to savepoint rb")
            bad.append(f"rollback {n} raised: {e}")
    return bad


def main():
    import pixeltable_pgserver as pgserver
    mig, prop = sql_files()
    tmp = pathlib.Path(tempfile.mkdtemp()) / "pg"
    srv = pgserver.get_server(tmp, cleanup_mode="stop")
    failures = []
    try:
        with psycopg.connect(srv.get_uri(), autocommit=True) as c:
            c.execute(BOOTSTRAP.read_text(encoding="utf-8"))
            for f in mig + prop:
                c.execute(f.read_text(encoding="utf-8"))
            print(f"applied {len(mig)} migrations + {len(prop)} proposed files")
            for f in prop:   # idempotency: the proposed files are meant to be re-runnable
                try:
                    c.execute(f.read_text(encoding="utf-8"))
                except Exception as e:
                    failures.append(f"re-apply {f.name} failed: {e}")
            failures += [f"post-flight: {d}" for d in postflight_failures(c)]
            c.autocommit = False
            failures += rollback_failures(c, PLAN.read_text(encoding="utf-8"))
            c.rollback()
    finally:
        srv.cleanup()
    for f in failures:
        print("FAIL:", f)
    print("OK" if not failures else f"{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
