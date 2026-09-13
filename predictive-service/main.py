"""שירות Python מקומי למודלי תחזית: קיבולת/מלאי (ליבה ראשונה), מגמת מדדים, רמת סיכון.
הרצה: uvicorn main:app --reload --port 8000
הפרונט (admin.html) קורא ל-endpoints האלה דרך fetch, ומציג את התוצאה בדשבורד הניהול.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import ml_targets
from clinical_baseline import compute_baseline, compute_trigger_event, detect_anomaly, weighted_severity
from timeseries import forecast_arima

app = FastAPI(title="home-care-crm predictive service")

# שירות מקומי בלבד לצורך פיתוח: מאפשר קריאה מכל origin (כולל file:// ו-http://localhost:*)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CapacityForecastRequest(BaseModel):
    visits_this_month: int = Field(..., ge=0, description="כמות ביקורי בית שבוצעו בחודש הנוכחי")
    active_patients: int = Field(..., gt=0, description="כמות המטופלים הפעילים כרגע במערכת")
    growth_rate: float = Field(..., gt=-1, description="אחוז צמיחה משוער לחודש הבא, לדוגמה 0.05 עבור 5%")


class CapacityForecastResponse(BaseModel):
    avg_visits_per_patient: float
    predicted_patients: float
    predicted_visits: int
    message: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict/capacity", response_model=CapacityForecastResponse)
def predict_capacity(req: CapacityForecastRequest):
    avg_visits_per_patient = req.visits_this_month / req.active_patients
    predicted_patients = req.active_patients * (1 + req.growth_rate)
    predicted_visits = round(predicted_patients * avg_visits_per_patient)

    return CapacityForecastResponse(
        avg_visits_per_patient=avg_visits_per_patient,
        predicted_patients=predicted_patients,
        predicted_visits=predicted_visits,
        message=f"חזוי לחודש הבא: {predicted_visits} ביקורים. מומלץ לוודא מלאי של לפחות {predicted_visits} ערכות בדיקות דם.",
    )


# ===== רמת סיכון (Green/Yellow/Red) =====
# עצי החלטה פשוטים (טווחים קליניים כלליים, לא אבחון רפואי) לכל מדד בנפרד.
# רמת הסיכון הכוללת = הרמה החמורה ביותר מבין המדדים שנמדדו בפועל בביקור.
#
# הערה לגבי הטווחים: ה-Field bounds על VitalsInput (למטה) בודקים סבירות קלט בלבד
# ("האם זה מדד אנושי אפשרי בכלל" — זהים בכוונה לטווחי ה-CHECK ב-DB ולבדיקת הקלט ב-admin.html),
# בעוד שהפונקציות classify_* כאן בודקות משהו אחר — "האם המדד הזה מדאיג קלינית" — בתוך
# הטווח הסביר. לכן ערך כמו סיסטולי 250 עובר את הבדיקה בקלט אך מסווג "red" — זו התנהגות
# רצויה, לא חוסר עקביות. אין לשנות טווח אחד כדי "ליישר" אותו עם השני.

def classify_systolic_bp(v: float) -> str:
    if v < 85 or v > 180:
        return "red"
    if v < 90 or v >= 140:
        return "yellow"
    return "green"


def classify_diastolic_bp(v: float) -> str:
    if v < 55 or v >= 100:
        return "red"
    if v < 60 or v >= 90:
        return "yellow"
    return "green"


def classify_blood_sugar(v: float) -> str:
    if v < 54 or v > 250:
        return "red"
    if v < 70 or v > 140:
        return "yellow"
    return "green"


def classify_pulse(v: float) -> str:
    if v < 50 or v > 120:
        return "red"
    if v < 60 or v > 100:
        return "yellow"
    return "green"


def classify_temperature(v: float) -> str:
    if v < 35.5 or v > 38.5:
        return "red"
    if v < 36.0 or v > 37.5:
        return "yellow"
    return "green"


def classify_oxygen_saturation(v: float) -> str:
    if v < 90:
        return "red"
    if v < 95:
        return "yellow"
    return "green"


VITAL_CLASSIFIERS = {
    "systolic_bp": (classify_systolic_bp, 'ל"ד סיסטולי'),
    "diastolic_bp": (classify_diastolic_bp, 'ל"ד דיאסטולי'),
    "blood_sugar": (classify_blood_sugar, "סוכר"),
    "pulse": (classify_pulse, "דופק"),
    "temperature": (classify_temperature, "חום גוף"),
    "oxygen_saturation": (classify_oxygen_saturation, "סטורציה"),
}

LEVEL_RANK = {"green": 0, "yellow": 1, "red": 2}
LEVEL_LABELS = {"green": "ירוק", "yellow": "צהוב", "red": "אדום", "no_data": "אין נתונים"}


class VitalsInput(BaseModel):
    systolic_bp: Optional[float] = Field(None, ge=50, le=250)
    diastolic_bp: Optional[float] = Field(None, ge=30, le=150)
    blood_sugar: Optional[float] = Field(None, ge=20, le=600)
    pulse: Optional[float] = Field(None, ge=30, le=220)
    temperature: Optional[float] = Field(None, ge=30.0, le=45.0)
    oxygen_saturation: Optional[float] = Field(None, ge=50, le=100)


class FlaggedVital(BaseModel):
    vital: str
    label: str
    value: float
    level: str


class RiskLevelResponse(BaseModel):
    level: str
    level_label: str
    flagged_vitals: list[FlaggedVital]


def compute_risk(vitals: VitalsInput):
    """מחזיר (worst_level_or_None, flagged_vitals) על סמך המדדים שסופקו בפועל."""
    worst = None
    flagged = []
    for key, (classify, label) in VITAL_CLASSIFIERS.items():
        value = getattr(vitals, key)
        if value is None:
            continue
        level = classify(value)
        if worst is None or LEVEL_RANK[level] > LEVEL_RANK[worst]:
            worst = level
        if level != "green":
            flagged.append(FlaggedVital(vital=key, label=label, value=value, level=level))
    return worst, flagged


@app.post("/predict/risk-level", response_model=RiskLevelResponse)
def predict_risk_level(vitals: VitalsInput):
    worst, flagged = compute_risk(vitals)
    if worst is None:
        return RiskLevelResponse(level="no_data", level_label=LEVEL_LABELS["no_data"], flagged_vitals=[])
    return RiskLevelResponse(level=worst, level_label=LEVEL_LABELS[worst], flagged_vitals=flagged)


# ===== הערכת סיכון מודעת-זמן (Tier 1: rule/trend-based decision support) =====
# משווה את הקריאה הנוכחית לקריאה הקודמת של אותו מטופל כדי לגזור מגמה, לצד רמת הסיכון
# הרגילה. confidence = שלמות קלט (לא הסתברות). probability תמיד null — אין מודל ML
# מאומן בפרויקט הזה; ר' הערה ב-migration ובתגובת ה-endpoint.

class RiskAssessmentRequest(BaseModel):
    current: VitalsInput
    previous: Optional[VitalsInput] = None
    prediction_horizon_hours: int = Field(8, gt=0)


class RiskAssessmentResponse(BaseModel):
    risk_level: str
    level_label: str
    flagged_vitals: list[FlaggedVital]
    trend: Optional[str]
    confidence: float
    probability: Optional[float] = None
    prediction_horizon_hours: int
    model_version: str = "rule-based-v1"


@app.post("/predict/risk-assessment", response_model=RiskAssessmentResponse)
def predict_risk_assessment(req: RiskAssessmentRequest):
    worst, flagged = compute_risk(req.current)
    level = worst or "no_data"

    trend = None
    if req.previous is not None:
        prev_worst, _ = compute_risk(req.previous)
        if prev_worst is not None and worst is not None:
            if LEVEL_RANK[worst] > LEVEL_RANK[prev_worst]:
                trend = "worsening"
            elif LEVEL_RANK[worst] < LEVEL_RANK[prev_worst]:
                trend = "improving"
            else:
                trend = "stable"

    provided = sum(1 for key in VITAL_CLASSIFIERS if getattr(req.current, key) is not None)
    confidence = round(provided / len(VITAL_CLASSIFIERS), 3)

    return RiskAssessmentResponse(
        risk_level=level,
        level_label=LEVEL_LABELS[level],
        flagged_vitals=flagged,
        trend=trend,
        confidence=confidence,
        probability=None,
        prediction_horizon_hours=req.prediction_horizon_hours,
    )


# ===== מגמת מדדים (Linear Regression) =====
# רגרסיה ליניארית פשוטה (least squares) על סדרת נקודות היסטוריות של מדד בודד,
# לחיזוי הערך הצפוי בביקור הבא. גנרי לכל מדד — הצד הקורא (JS) שולח את הנקודות.

class TrendPoint(BaseModel):
    x: float
    y: float


class TrendForecastRequest(BaseModel):
    points: list[TrendPoint]
    next_x: Optional[float] = None


class TrendForecastResponse(BaseModel):
    slope: float
    intercept: float
    predicted_next_y: float
    direction: str


@app.post("/predict/vitals-trend", response_model=TrendForecastResponse)
def predict_vitals_trend(req: TrendForecastRequest):
    n = len(req.points)
    if n < 2:
        raise HTTPException(status_code=400, detail="נדרשות לפחות 2 נקודות היסטוריה לחישוב מגמה")

    xs = [p.x for p in req.points]
    ys = [p.y for p in req.points]
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    denominator = sum((x - mean_x) ** 2 for x in xs)
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denominator if denominator else 0.0
    intercept = mean_y - slope * mean_x

    next_x = req.next_x if req.next_x is not None else xs[-1] + (xs[-1] - xs[-2])
    predicted_next_y = slope * next_x + intercept

    direction = "יציב"
    if abs(slope) > 1e-9:
        direction = "עולה" if slope > 0 else "יורד"

    return TrendForecastResponse(
        slope=round(slope, 4),
        intercept=round(intercept, 4),
        predicted_next_y=round(predicted_next_y, 2),
        direction=direction,
    )


# ============================================================================
# שכבת ML/Time-Series מקומית — הכל רץ בתוך predictive-service, בלי שום API בתשלום,
# בלי LLM. שלושה סוגי רכיבים:
#   1) שדרוג רגרסיה ליניארית (timestamp אמיתי) + baseline + anomaly detection —
#      פועלים במלואם כבר היום, על דאטה שכבר קיים.
#   2) ARIMA לחיזוי סדרה עתית — פועל כשיש מספיק היסטוריה (כרגע: לרוב לא, ר' דוח).
#   3) Logistic Regression / Decision Tree / Random Forest / KNN — ארכיטקטורה
#      אמיתית ופעילה, אך תמיד model_available=False כי אין דאטה מתויג עם תוצאה
#      קלינית אמיתית בפרויקט הזה. שום מקום לא ממציא הסתברות.
# ============================================================================


class VitalPoint(BaseModel):
    measured_at: datetime
    value: float


class VitalHistoryEntry(BaseModel):
    measured_at: datetime
    systolic_bp: Optional[float] = None
    diastolic_bp: Optional[float] = None
    blood_sugar: Optional[float] = None
    pulse: Optional[float] = None
    temperature: Optional[float] = None
    oxygen_saturation: Optional[float] = None


class PatientContextInput(BaseModel):
    age: Optional[int] = None
    background_conditions: list[str] = []
    smoking_status: Optional[str] = None


# ===== 1. רגרסיה ליניארית מודעת-זמן (timestamp אמיתי, לא אינדקס) =====
# מוסיפה, לא מחליפה: /predict/vitals-trend (אינדקס) נשאר בדיוק כפי שהיה.

_HORIZON_HOURS = {"8h": 8.0, "24h": 24.0, "72h": 72.0}


class VitalsForecastRequest(BaseModel):
    points: list[VitalPoint]
    horizon: str = Field("next", pattern="^(next|8h|24h|72h)$")
    vital: Optional[str] = None


class VitalsForecastResponse(BaseModel):
    vital: Optional[str] = None
    predicted_value: Optional[float] = None
    slope_per_hour: Optional[float] = None
    direction: Optional[str] = None
    forecast_horizon: str
    number_of_measurements: int
    model_available: bool


def _linear_forecast(points: list[dict], horizon: str) -> dict:
    pts = sorted(points, key=lambda p: p["measured_at"])
    n = len(pts)
    result = {
        "predicted_value": None,
        "slope_per_hour": None,
        "direction": None,
        "forecast_horizon": horizon,
        "number_of_measurements": n,
        "model_available": False,
    }
    if n < 2:
        return result

    t0 = pts[0]["measured_at"]
    xs = [(p["measured_at"] - t0).total_seconds() / 3600 for p in pts]  # שעות אמיתיות
    ys = [p["value"] for p in pts]
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    denominator = sum((x - mean_x) ** 2 for x in xs)
    if denominator == 0:
        return result
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denominator
    intercept = mean_y - slope * mean_x

    last_x = xs[-1]
    if horizon == "next":
        gaps = [xs[i] - xs[i - 1] for i in range(1, n)]
        target_x = last_x + (sum(gaps) / len(gaps) if gaps else 1.0)
    else:
        target_x = last_x + _HORIZON_HOURS[horizon]

    predicted = slope * target_x + intercept
    direction = "יציב"
    if abs(slope) > 1e-9:
        direction = "עולה" if slope > 0 else "יורד"

    result.update(
        {
            "predicted_value": round(predicted, 2),
            "slope_per_hour": round(slope, 4),
            "direction": direction,
            "model_available": True,
        }
    )
    return result


@app.post("/predict/vitals-forecast", response_model=VitalsForecastResponse)
def predict_vitals_forecast(req: VitalsForecastRequest):
    points = [{"measured_at": p.measured_at, "value": p.value} for p in req.points]
    result = _linear_forecast(points, req.horizon)
    result["vital"] = req.vital
    return VitalsForecastResponse(**result)


# ===== 2. Baseline אישי =====

class BaselineAnalysisResponse(BaseModel):
    vital: str
    baseline: Optional[float] = None
    latest_value: Optional[float] = None
    deviation: Optional[float] = None
    deviation_pct: Optional[float] = None
    rate_of_change_per_hour: Optional[float] = None
    sudden_change: bool
    persistent_abnormal: bool
    worsening_trend: bool
    number_of_measurements: int


class VitalHistoryRequest(BaseModel):
    vital: str
    points: list[VitalPoint]


def _with_persistent_abnormal(vital: str, points: list[dict], info: dict) -> dict:
    classify_fn = VITAL_CLASSIFIERS.get(vital, (None, None))[0]
    if classify_fn and len(points) >= 2:
        pts_sorted = sorted(points, key=lambda p: p["measured_at"])
        last_two = [classify_fn(p["value"]) for p in pts_sorted[-2:]]
        info["persistent_abnormal"] = all(lvl != "green" for lvl in last_two)
    return info


@app.post("/predict/baseline", response_model=BaselineAnalysisResponse)
def predict_baseline(req: VitalHistoryRequest):
    points = [{"measured_at": p.measured_at, "value": p.value} for p in req.points]
    info = compute_baseline(req.vital, points)
    info = _with_persistent_abnormal(req.vital, points, info)
    return BaselineAnalysisResponse(**info)


# ===== 3. Anomaly detection =====

class AnomalyResponse(BaseModel):
    vital: str
    anomaly_detected: bool
    severity: Optional[str] = None
    reason: Optional[str] = None
    current_value: Optional[float] = None
    baseline: Optional[float] = None
    deviation: Optional[float] = None


class MultiVitalHistoryRequest(BaseModel):
    history: list[VitalHistoryEntry]


@app.post("/predict/anomalies", response_model=list[AnomalyResponse])
def predict_anomalies(req: MultiVitalHistoryRequest):
    anomalies = []
    for vital_key, (classify_fn, _label) in VITAL_CLASSIFIERS.items():
        points = [
            {"measured_at": e.measured_at, "value": getattr(e, vital_key)}
            for e in req.history
            if getattr(e, vital_key) is not None
        ]
        result = detect_anomaly(vital_key, points, classify_fn=classify_fn)
        if result:
            anomalies.append(AnomalyResponse(**result))
    return anomalies


# ===== 4. Time series (ARIMA) =====

class TimeseriesForecastRequest(BaseModel):
    vital: str
    points: list[VitalPoint]
    horizon_hours: float = 24


class TimeseriesForecastResponse(BaseModel):
    vital: str
    model_available: bool
    predicted_value: Optional[float] = None
    confidence_interval: Optional[list[float]] = None
    horizon_hours: float
    number_of_measurements: int
    reason: Optional[str] = None


@app.post("/predict/vitals-timeseries", response_model=TimeseriesForecastResponse)
def predict_vitals_timeseries(req: TimeseriesForecastRequest):
    points = [{"measured_at": p.measured_at, "value": p.value} for p in req.points]
    result = forecast_arima(req.vital, points, req.horizon_hours)
    return TimeseriesForecastResponse(**result)


# ===== 5. Future-event models (Logistic Regression / Decision Tree / Random Forest / KNN) =====

class FutureEventRequest(BaseModel):
    target: str
    algorithm: str = "logistic_regression"
    features: dict


class FutureEventResponse(BaseModel):
    target: str
    label_he: str
    algorithm: str
    horizon_hours: int
    model_available: bool
    probability: Optional[float] = None
    predicted_class: Optional[bool] = None
    reason: Optional[str] = None


@app.post("/predict/future-event", response_model=FutureEventResponse)
def predict_future_event_endpoint(req: FutureEventRequest):
    try:
        result = ml_targets.predict_future_event(req.target, req.algorithm, req.features)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return FutureEventResponse(**result)


class TrainModelRequest(BaseModel):
    X: list[dict]
    y: list[int]


@app.post("/train/{target}/{algorithm}")
def train_model_endpoint(target: str, algorithm: str, req: TrainModelRequest):
    """אימון אמיתי — קיים כארכיטקטורה. שום דבר בפרויקט הזה לא קורא לאנדפוינט הזה
    כרגע כי אין דאטה מתויג עם תוצאה קלינית אמיתית לאימון (ר' ml_targets.py)."""
    try:
        metrics = ml_targets.train_model(target, algorithm, req.X, req.y)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"target": target, "algorithm": algorithm, "trained": True, "metrics": metrics}


# ===== 6. אנדפוינט מאוחד: /predict/medical-warning =====

class MedicalWarningRequest(BaseModel):
    patient_context: PatientContextInput
    history: list[VitalHistoryEntry]
    horizon: str = Field("24h", pattern="^(next|8h|24h|72h)$")


class TriggerEventResponse(BaseModel):
    vital: str
    severity: str
    reason: str
    current_value: float
    baseline: Optional[float] = None
    deviation: Optional[float] = None
    hours_since_trigger: float
    decay_window_hours: float
    decay_factor: float
    still_active: bool


class MedicalWarningResponse(BaseModel):
    current_risk: RiskLevelResponse
    trend: Optional[str] = None
    baseline_analysis: list[BaselineAnalysisResponse]
    detected_anomalies: list[AnomalyResponse]
    trigger_events: list[TriggerEventResponse]
    numeric_forecasts: list[VitalsForecastResponse]
    timeseries_forecasts: list[TimeseriesForecastResponse]
    future_event_models: list[FutureEventResponse]
    short_term_concern: str
    risk_window_hours: float
    reassessment_recommended_in_hours: float
    contributing_factors: list[str]
    explanation: str


_CONCERN_HE = {"low": "נמוכה", "moderate": "בינונית", "high": "גבוהה"}
_REASSESS_HOURS_BY_CONCERN = {"high": 2.0, "moderate": 6.0, "low": 24.0}


@app.post("/predict/medical-warning", response_model=MedicalWarningResponse)
def predict_medical_warning(req: MedicalWarningRequest):
    history_sorted = sorted(req.history, key=lambda e: e.measured_at)
    if not history_sorted:
        raise HTTPException(status_code=400, detail="נדרשת לפחות מדידה אחת")

    latest = history_sorted[-1]
    previous = history_sorted[-2] if len(history_sorted) >= 2 else None

    latest_vitals_dict = {k: getattr(latest, k) for k in VITAL_CLASSIFIERS}
    current_vitals = VitalsInput(**latest_vitals_dict)
    worst, flagged = compute_risk(current_vitals)
    current_risk = (
        RiskLevelResponse(level="no_data", level_label=LEVEL_LABELS["no_data"], flagged_vitals=[])
        if worst is None
        else RiskLevelResponse(level=worst, level_label=LEVEL_LABELS[worst], flagged_vitals=flagged)
    )

    trend = None
    if previous is not None:
        prev_vitals = VitalsInput(**{k: getattr(previous, k) for k in VITAL_CLASSIFIERS})
        prev_worst, _ = compute_risk(prev_vitals)
        if prev_worst is not None and worst is not None:
            if LEVEL_RANK[worst] > LEVEL_RANK[prev_worst]:
                trend = "worsening"
            elif LEVEL_RANK[worst] < LEVEL_RANK[prev_worst]:
                trend = "improving"
            else:
                trend = "stable"

    baseline_list: list[BaselineAnalysisResponse] = []
    anomalies_list: list[AnomalyResponse] = []
    trigger_list: list[TriggerEventResponse] = []
    forecasts_list: list[VitalsForecastResponse] = []
    timeseries_list: list[TimeseriesForecastResponse] = []

    ts_horizon_hours = _HORIZON_HOURS.get(req.horizon, 24.0)
    forecast_horizon = req.horizon if req.horizon in _HORIZON_HOURS else "next"
    now = datetime.now(timezone.utc)

    for vital_key, (classify_fn, _label) in VITAL_CLASSIFIERS.items():
        points = [
            {"measured_at": e.measured_at, "value": getattr(e, vital_key)}
            for e in history_sorted
            if getattr(e, vital_key) is not None
        ]
        if not points:
            continue

        info = compute_baseline(vital_key, points)
        info = _with_persistent_abnormal(vital_key, points, info)
        baseline_list.append(BaselineAnalysisResponse(**info))

        anomaly = detect_anomaly(vital_key, points, classify_fn=classify_fn)
        if anomaly:
            anomalies_list.append(AnomalyResponse(**anomaly))

        # trigger_events: אותה זיהוי חריגה, אבל דועך עם הזמן (time decay) — ר' clinical_baseline.py
        trigger = compute_trigger_event(vital_key, points, classify_fn, now)
        if trigger:
            trigger_list.append(TriggerEventResponse(**trigger))

        forecast = _linear_forecast(points, forecast_horizon)
        forecast["vital"] = vital_key
        forecasts_list.append(VitalsForecastResponse(**forecast))

        ts = forecast_arima(vital_key, points, ts_horizon_hours)
        timeseries_list.append(TimeseriesForecastResponse(**ts))

    features = ml_targets.build_feature_vector(
        req.patient_context.model_dump(),
        {k: v for k, v in latest_vitals_dict.items() if v is not None},
        {b.vital: {"deviation": b.deviation} for b in baseline_list},
    )
    future_events: list[FutureEventResponse] = []
    for target in ml_targets.TARGET_DEFINITIONS:
        for algorithm in ml_targets.ALGORITHMS:
            result = ml_targets.predict_future_event(target, algorithm, features)
            future_events.append(FutureEventResponse(**result))

    # short_term_concern נגזר אך ורק מהכלל הקבוע + מהטריגרים הדועכים בזמן — אף פעם לא
    # ממודל ML (שממילא כולם model_available=False כרגע). זה מה שנותן את התנהגות ה"דעיכה":
    # טריגר שדעך לגמרי כבר לא מופיע ב-trigger_list, ולכן לא יכול להעלות את רמת הדאגה.
    if current_risk.level == "red" or any(t.severity == "high" for t in trigger_list):
        concern = "high"
    elif current_risk.level == "yellow" or any(t.severity == "medium" for t in trigger_list):
        concern = "moderate"
    else:
        concern = "low"

    risk_window_hours = max([t.decay_window_hours for t in trigger_list], default=24.0)
    reassessment_hours = _REASSESS_HOURS_BY_CONCERN[concern]

    contributing_factors = [
        f"{fv.label}: {fv.value} ({LEVEL_LABELS[fv.level]})" for fv in current_risk.flagged_vitals
    ]
    contributing_factors += [f"{t.vital}: {t.reason}" for t in trigger_list]
    if req.patient_context.smoking_status == "current":
        contributing_factors.append("מעשן/ת כיום")
    for cond in req.patient_context.background_conditions:
        contributing_factors.append(f"רקע רפואי: {cond}")

    # explanation: משפט תבנית מובנה מנתונים שכבר חושבו — לא קריאת AI/LLM חיצונית.
    explanation_parts = []
    if trigger_list:
        top = max(trigger_list, key=lambda t: weighted_severity(t.model_dump()))
        explanation_parts.append(f"זוהה {top.reason} במדד {top.vital} (לפני כ-{top.hours_since_trigger} שעות).")
    if trend == "worsening":
        explanation_parts.append("המגמה הכללית מחמירה לעומת המדידה הקודמת.")
    elif trend == "improving":
        explanation_parts.append("המגמה הכללית משתפרת לעומת המדידה הקודמת.")
    explanation_parts.append(f"רמת הסיכון הנוכחית: {current_risk.level_label}.")
    explanation_parts.append(f"רמת דאגה לטווח קצר: {_CONCERN_HE[concern]}.")
    explanation = " ".join(explanation_parts)

    return MedicalWarningResponse(
        current_risk=current_risk,
        trend=trend,
        baseline_analysis=baseline_list,
        detected_anomalies=anomalies_list,
        trigger_events=trigger_list,
        numeric_forecasts=forecasts_list,
        timeseries_forecasts=timeseries_list,
        future_event_models=future_events,
        short_term_concern=concern,
        risk_window_hours=risk_window_hours,
        reassessment_recommended_in_hours=reassessment_hours,
        contributing_factors=contributing_factors,
        explanation=explanation,
    )
