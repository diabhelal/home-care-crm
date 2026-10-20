"""current_patient_risk (proposed/011): the latest traffic-light status stays visible after the 8h forecast horizon,
is flagged stale after 24h, and shows when a newer visit report has no assessment yet. Synthetic data only."""
from tests_db.conftest import as_postgres, as_user
from tests_db.test_db_guards import T0, insert_booking, seed
from tests_db.test_visit_report_integrity import COMPLETE, booking


def prediction(db, patient, report_id, level, hours_ago, trend=None):
    as_postgres(db)
    db.execute("select set_config('request.jwt.claims', '', true)")
    # in real life the assessment is made right after its report: backdate the report together with its prediction
    db.execute("update visit_reports set created_at = least(created_at, now() - make_interval(hours => %s) - interval '1 minute') where id=%s",
               (hours_ago, report_id))
    db.execute("insert into risk_predictions(patient_id, visit_report_id, predicted_at, input_features, risk_level, expires_at, trend) "
               "values (%s,%s, now() - make_interval(hours => %s), '{}'::jsonb, %s, now() - make_interval(hours => %s) + interval '8 hours', %s)",
               (patient, report_id, hours_ago, level, hours_ago, trend))


def completed_report(db, d, patient="pa", staff="s1", at=T0):
    bid = booking(db, d, patient=patient, staff=staff, at=at)
    as_user(db, d["staff_user"] if staff == "s1" else d["admin"], admin=(staff != "s1"))
    return db.execute("select id from complete_visit(%s, %s::jsonb)", (bid, COMPLETE)).fetchone()[0]


def row(db, d, who="admin"):
    as_user(db, d["admin"], admin=True)
    return db.execute("select risk_level, is_stale, newer_report_exists, age_hours from current_patient_risk where patient_id=%s", (d["pa"],)).fetchone()


def test_red_status_is_still_returned_after_the_8h_horizon_but_flagged_stale_after_24h(db):
    d = seed(db); rid = completed_report(db, d)
    prediction(db, d["pa"], rid, "red", hours_ago=10)          # past the 8h horizon (the old view returned NOTHING here)
    level, stale, newer, age = row(db, d)
    assert level == "red" and stale is False and newer is False and 9.9 < float(age) < 10.1
    prediction(db, d["pa"], rid, "red", hours_ago=72)          # an older one must not replace the latest
    assert row(db, d)[0] == "red"


def test_old_assessment_is_stale(db):
    d = seed(db); rid = completed_report(db, d)
    prediction(db, d["pa"], rid, "green", hours_ago=30)
    level, stale, _, _ = row(db, d)
    assert level == "green" and stale is True


def test_latest_prediction_wins_and_history_rows_are_all_kept(db):
    d = seed(db); rid = completed_report(db, d)
    prediction(db, d["pa"], rid, "green", hours_ago=50)
    prediction(db, d["pa"], rid, "red", hours_ago=2)
    assert row(db, d)[0] == "red"
    as_postgres(db)
    assert db.execute("select count(*) from risk_predictions where patient_id=%s", (d["pa"],)).fetchone()[0] == 2


def test_newer_report_without_assessment_is_flagged(db):
    d = seed(db); rid = completed_report(db, d)
    prediction(db, d["pa"], rid, "green", hours_ago=1)
    assert row(db, d)[2] is False
    completed_report(db, d, at="2030-01-07 12:00:00+00")       # a second visit report saved after the prediction
    assert row(db, d)[2] is True


def test_staff_sees_only_assigned_patient_status_through_rls(db):
    d = seed(db); rid = completed_report(db, d)
    prediction(db, d["pa"], rid, "yellow", hours_ago=3)
    as_user(db, d["staff_user"])
    assert db.execute("select risk_level from current_patient_risk where patient_id=%s", (d["pa"],)).fetchone()[0] == "yellow"
    as_user(db, d["pb"])                                          # another patient has no access to it
    assert db.execute("select count(*) from current_patient_risk").fetchone()[0] == 0
