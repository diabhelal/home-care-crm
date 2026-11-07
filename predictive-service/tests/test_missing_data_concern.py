"""Missing data must not read as "low concern" (owner-approved presentation fix, 2026-11-07).

Rules under test (no threshold or formula is touched):
  * latest entry without vitals AND no active trigger from earlier measurements -> short_term_concern "insufficient_data"
  * a valid alert from available measurements is preserved (red/high trigger -> "high", yellow -> "moderate")
  * green with measurements stays "low"
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import INSUFFICIENT_DATA_LABEL_HE, app, classify_systolic_bp

client = TestClient(app)
NOW = datetime.now(timezone.utc)


def warn(history):
    body = {"patient_context": {}, "history": [{"measured_at": (NOW - timedelta(hours=h)).isoformat(), **v} for h, v in history],
            "horizon": "24h"}
    r = client.post("/predict/medical-warning", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_no_vitals_at_all_is_insufficient_data_not_low():
    d = warn([(1, {})])
    assert d["current_risk"]["level"] == "no_data"
    assert d["short_term_concern"] == "insufficient_data"
    assert INSUFFICIENT_DATA_LABEL_HE in d["explanation"]
    assert "דאגה לטווח קצר: נמוכה" not in d["explanation"]
    assert d["reassessment_recommended_in_hours"] == 2.0


def test_green_measurements_remain_low_concern():
    d = warn([(1, {"systolic_bp": 120, "diastolic_bp": 80, "pulse": 70})])
    assert d["current_risk"]["level"] == "green"
    assert d["short_term_concern"] == "low"
    assert "דאגה לטווח קצר: נמוכה" in d["explanation"]


def test_yellow_and_red_current_levels_still_raise_concern():
    assert warn([(1, {"systolic_bp": 150})])["short_term_concern"] == "moderate"
    assert warn([(1, {"systolic_bp": 200})])["short_term_concern"] == "high"


def test_active_alert_from_earlier_measurements_survives_a_later_entry_without_vitals():
    # 120 -> 200 two hours apart is an active (time-decaying) trigger; a later empty entry must not erase it
    d = warn([(3, {"systolic_bp": 120}), (2, {"systolic_bp": 200}), (0.1, {})])
    assert d["current_risk"]["level"] == "no_data"
    assert d["trigger_events"], "the earlier alert must remain visible"
    assert d["short_term_concern"] == "high"


def test_single_earlier_reading_creates_no_trigger_so_the_state_is_insufficient_data():
    # existing detector behaviour (needs two points per vital); unchanged by this fix, documented here
    d = warn([(2, {"systolic_bp": 200}), (0.1, {})])
    assert d["trigger_events"] == []
    assert d["short_term_concern"] == "insufficient_data"


def test_systolic_boundary_behaviour_is_pinned_pending_owner_decision():
    """Characterization only. Code: red if > 180. CLINICAL_THRESHOLDS_FOR_REVIEW.md states >= 180. Not changed."""
    assert [classify_systolic_bp(v) for v in (179, 180, 181)] == ["yellow", "yellow", "red"]
