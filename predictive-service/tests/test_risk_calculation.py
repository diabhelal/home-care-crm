"""טסטי יחידה לחישוב רמת הסיכון (compute_risk) ולוגיקת המגמה (compute_trend).
הרצה: pytest tests/test_risk_calculation.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import VitalsInput, compute_risk, compute_trend, caregiver_status_message


def test_all_vitals_normal_is_green():
    vitals = VitalsInput(systolic_bp=120, diastolic_bp=80, blood_sugar=100, pulse=70, temperature=36.6, oxygen_saturation=98)
    worst, flagged = compute_risk(vitals)
    assert worst == "green"
    assert flagged == []


def test_no_vitals_provided_returns_none():
    vitals = VitalsInput()
    worst, flagged = compute_risk(vitals)
    assert worst is None
    assert flagged == []


def test_single_red_vital_dominates():
    vitals = VitalsInput(pulse=200, systolic_bp=120)  # פעימות 200 = אדום, סיסטולי 120 = ירוק
    worst, flagged = compute_risk(vitals)
    assert worst == "red"
    assert len(flagged) == 1
    assert flagged[0].vital == "pulse"
    assert flagged[0].level == "red"


def test_worst_of_multiple_vitals_wins():
    # דופק 110 = צהוב, סטורציה 85 = אדום -> הכולל צריך להיות אדום
    vitals = VitalsInput(pulse=110, oxygen_saturation=85)
    worst, _ = compute_risk(vitals)
    assert worst == "red"


def test_yellow_vital_without_background_stays_yellow():
    vitals = VitalsInput(blood_sugar=160)  # 160 בטווח הצהוב (141-250)
    worst, flagged = compute_risk(vitals)
    assert worst == "yellow"
    assert flagged[0].level == "yellow"


def test_diabetes_escalates_yellow_blood_sugar_to_red():
    vitals = VitalsInput(blood_sugar=160)
    worst, flagged = compute_risk(vitals, background_conditions=["diabetes"])
    assert worst == "red"
    assert flagged[0].level == "red"


def test_unrelated_condition_does_not_escalate():
    # אי ספיקת לב לא רלוונטית לסוכר -> אין החמרה
    vitals = VitalsInput(blood_sugar=160)
    worst, flagged = compute_risk(vitals, background_conditions=["heart_failure"])
    assert worst == "yellow"


def test_smoking_escalates_yellow_oxygen_to_red():
    vitals = VitalsInput(oxygen_saturation=92)  # צהוב (90-94)
    worst, _ = compute_risk(vitals, smoking_status="current")
    assert worst == "red"


def test_smoking_former_does_not_escalate():
    vitals = VitalsInput(oxygen_saturation=92)
    worst, _ = compute_risk(vitals, smoking_status="former")
    assert worst == "yellow"


def test_background_does_not_escalate_already_red_vital():
    # אדום נשאר אדום - לא "עולה" לרמה גבוהה יותר שלא קיימת
    vitals = VitalsInput(blood_sugar=300)  # כבר אדום (>250)
    worst, flagged = compute_risk(vitals, background_conditions=["diabetes"])
    assert worst == "red"
    assert flagged[0].level == "red"


def test_background_does_not_change_green_vital():
    vitals = VitalsInput(blood_sugar=100)  # ירוק
    worst, flagged = compute_risk(vitals, background_conditions=["diabetes"])
    assert worst == "green"
    assert flagged == []


def test_compute_trend_worsening():
    assert compute_trend("red", "yellow") == "worsening"


def test_compute_trend_improving():
    assert compute_trend("green", "yellow") == "improving"


def test_compute_trend_stable():
    assert compute_trend("yellow", "yellow") == "stable"


def test_compute_trend_none_when_missing_data():
    assert compute_trend("red", None) is None
    assert compute_trend(None, "red") is None


def test_caregiver_status_message_red_worsening():
    msg = caregiver_status_message("red", "worsening")
    assert "מסוכן" in msg
    assert "מחמיר" in msg


def test_caregiver_status_message_no_data():
    msg = caregiver_status_message("no_data", None)
    assert "אין מספיק נתונים" in msg
