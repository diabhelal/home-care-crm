"""ניתוח בסיס אישי (baseline) וזיהוי חריגות (anomaly detection) — סטטיסטיקה טהורה
על היסטוריית מדידות אמיתית (timestamp + value) של מדד בודד אצל מטופל נתון.
אין כאן שום מודל מאומן ואין כאן שום הסתברות — רק חשבון על נתונים שכבר נמדדו.
"""

import statistics
from datetime import datetime

# כיוון החמרה עבור כל מדד: "up" = עלייה מדאיגה, "down" = ירידה מדאיגה.
# היוריסטיקה גלויה ופשוטה, לא סף קליני מאומת — משמשת רק לדגל "worsening_trend".
CONCERNING_DIRECTION = {
    "systolic_bp": "up",
    "diastolic_bp": "up",
    "blood_sugar": "up",
    "pulse": "up",
    "temperature": "up",
    "oxygen_saturation": "down",
}

# קצב שינוי לשעה שנחשב חריג פר מדד — סף פיזיולוגי גס, לא מאומת קלינית.
UNUSUAL_RATE_PER_HOUR = {
    "systolic_bp": 20,
    "diastolic_bp": 15,
    "blood_sugar": 40,
    "pulse": 25,
    "temperature": 1.0,
    "oxygen_saturation": 5,
}


def _sorted_by_time(points: list[dict]) -> list[dict]:
    return sorted(points, key=lambda p: p["measured_at"])


def compute_baseline(vital: str, points: list[dict]) -> dict:
    """points: [{"measured_at": datetime, "value": float}, ...], לא בהכרח ממוינים.
    הבסיס (baseline) = החציון של כל ההיסטוריה *לפני* המדידה האחרונה — כדי שהמדידה
    האחרונה תיבדק מול מה שהיה "נורמלי" לפניה, לא מול עצמה.
    """
    pts = _sorted_by_time(points)
    n = len(pts)
    result = {
        "vital": vital,
        "baseline": None,
        "latest_value": None,
        "deviation": None,
        "deviation_pct": None,
        "rate_of_change_per_hour": None,
        "sudden_change": False,
        "persistent_abnormal": False,
        "worsening_trend": False,
        "number_of_measurements": n,
    }
    if n == 0:
        return result

    values = [p["value"] for p in pts]
    latest = values[-1]
    result["latest_value"] = latest
    if n == 1:
        return result

    rate = rate_of_change_per_hour(pts)
    result["rate_of_change_per_hour"] = round(rate, 3) if rate is not None else None

    baseline_source = values[:-1]
    baseline = statistics.median(baseline_source)
    deviation = latest - baseline
    result["baseline"] = round(baseline, 2)
    result["deviation"] = round(deviation, 2)
    result["deviation_pct"] = round((deviation / baseline) * 100, 1) if baseline else None

    if len(baseline_source) >= 2:
        spread = statistics.pstdev(baseline_source)
        if spread > 0 and abs(deviation) > 2 * spread:
            result["sudden_change"] = True

    direction = CONCERNING_DIRECTION.get(vital)
    pct = result["deviation_pct"]
    if pct is not None:
        if direction == "up" and deviation > 0 and pct > 15:
            result["worsening_trend"] = True
        elif direction == "down" and deviation < 0 and pct < -10:
            result["worsening_trend"] = True

    return result


def rate_of_change_per_hour(points: list[dict]) -> float | None:
    pts = _sorted_by_time(points)
    if len(pts) < 2:
        return None
    p_prev, p_last = pts[-2], pts[-1]
    hours = (p_last["measured_at"] - p_prev["measured_at"]).total_seconds() / 3600
    if hours <= 0:
        return None
    return (p_last["value"] - p_prev["value"]) / hours


def detect_anomaly(vital: str, points: list[dict], classify_fn=None) -> dict | None:
    """מחזיר dict חריגה אם זוהתה חריגה, אחרת None.
    classify_fn (אופציונלי): הפונקציה classify_* המתאימה מ-main.py (green/yellow/red),
    לזיהוי "persistent_abnormal" לפי הרמזור הקיים — בלי לשכפל את הטווחים כאן.
    """
    baseline_info = compute_baseline(vital, points)
    if baseline_info["number_of_measurements"] < 2:
        return None

    pts = _sorted_by_time(points)
    reasons = []
    severity = "low"

    if baseline_info["sudden_change"]:
        reasons.append("שינוי חד לעומת הבסיס האישי")
        severity = "medium"

    if baseline_info["worsening_trend"]:
        reasons.append("מגמת החמרה עקבית לעומת הבסיס")
        severity = "medium"

    rate = rate_of_change_per_hour(pts)
    threshold = UNUSUAL_RATE_PER_HOUR.get(vital)
    if rate is not None and threshold is not None and abs(rate) > threshold:
        reasons.append(f"קצב שינוי חריג ({round(rate, 1)} ליחידה לשעה)")
        severity = "high"

    if classify_fn is not None and len(pts) >= 2:
        last_two_levels = [classify_fn(p["value"]) for p in pts[-2:]]
        if all(lvl != "green" for lvl in last_two_levels):
            reasons.append("שתי מדידות אחרונות לפחות מחוץ לטווח התקין")
            if any(lvl == "red" for lvl in last_two_levels):
                severity = "high"

    # גם אם אין עדיין מגמה/קצב חריג (למשל שתי מדידות בודדות רחוקות בזמן), מדידה
    # אחרונה שעצמה אדומה היא כשלעצמה חריגה שראוי לדווח עליה — לא מחכים לשתי מדידות.
    if classify_fn is not None:
        latest_level = classify_fn(pts[-1]["value"])
        if latest_level == "red" and not reasons:
            reasons.append("המדידה האחרונה בטווח האדום")
            severity = "high"
        elif latest_level == "red":
            severity = "high"

    if not reasons:
        return None

    return {
        "vital": vital,
        "anomaly_detected": True,
        "severity": severity,
        "reason": "; ".join(reasons),
        "current_value": baseline_info["latest_value"],
        "baseline": baseline_info["baseline"],
        "deviation": baseline_info["deviation"],
    }


# ===== דעיכת סיכון לאורך זמן (time decay) =====
# חלון הדעיכה (שעות) שאחריו טריגר חד-פעמי מפסיק להשפיע על הסיכון, אם לא נמשך.
# היוריסטיקה גלויה: מדדים "מהירים" (סוכר) דועכים מהר, מדדים "איטיים" יותר (חום) לאט יותר.
DECAY_WINDOW_HOURS = {
    "blood_sugar": 8,
    "systolic_bp": 12,
    "diastolic_bp": 12,
    "pulse": 12,
    "oxygen_saturation": 12,
    "temperature": 24,
}

SEVERITY_WEIGHT = {"low": 1, "medium": 2, "high": 3}


def compute_trigger_event(vital: str, points: list[dict], classify_fn, now: datetime) -> dict | None:
    """עוטף detect_anomaly בהיגיון דעיכה בזמן: טריגר חדש מקבל משקל מלא (decay_factor=1),
    ודועך ליניארית עד 0 בתוך DECAY_WINDOW_HOURS של המדד — אלא אם המדידה האחרונה עדיין
    חורגת בפועל (persistent), ואז לא מדעיכים משהו שעדיין קורה. כשהדעיכה מגיעה ל-0
    (ולא נמשכת) האירוע נחשב פג-תוקף ומוחזר None — "expire" כמבוקש.
    """
    anomaly = detect_anomaly(vital, points, classify_fn=classify_fn)
    if anomaly is None:
        return None

    pts = _sorted_by_time(points)
    triggered_at = pts[-1]["measured_at"]
    hours_since = max(0.0, (now - triggered_at).total_seconds() / 3600)
    window = DECAY_WINDOW_HOURS.get(vital, 12)

    still_abnormal = classify_fn is not None and classify_fn(pts[-1]["value"]) != "green"
    decay_factor = 1.0 if still_abnormal else max(0.0, 1.0 - hours_since / window)

    if decay_factor <= 0:
        return None

    anomaly["hours_since_trigger"] = round(hours_since, 2)
    anomaly["decay_window_hours"] = window
    anomaly["decay_factor"] = round(decay_factor, 3)
    anomaly["still_active"] = True
    return anomaly


def weighted_severity(trigger: dict) -> float:
    """חומרה משוקללת-בדעיכה, לשימוש בחישוב short_term_concern המצטבר."""
    return SEVERITY_WEIGHT.get(trigger.get("severity"), 1) * trigger.get("decay_factor", 1.0)
