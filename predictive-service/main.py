"""שירות Python מקומי למודלי תחזית: קיבולת/מלאי (ליבה ראשונה), מגמת מדדים, רמת סיכון.
הרצה: uvicorn main:app --reload --port 8000
הפרונט (admin.html) קורא ל-endpoints האלה דרך fetch, ומציג את התוצאה בדשבורד הניהול.
"""

from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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
    growth_rate: float = Field(..., description="אחוז צמיחה משוער לחודש הבא, לדוגמה 0.05 עבור 5%")


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

def classify_systolic_bp(v: float) -> str:
    if v < 85 or v >= 160:
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
    if v < 70 or v > 180:
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
    systolic_bp: Optional[float] = None
    diastolic_bp: Optional[float] = None
    blood_sugar: Optional[float] = None
    pulse: Optional[float] = None
    temperature: Optional[float] = None
    oxygen_saturation: Optional[float] = None


class FlaggedVital(BaseModel):
    vital: str
    label: str
    value: float
    level: str


class RiskLevelResponse(BaseModel):
    level: str
    level_label: str
    flagged_vitals: list[FlaggedVital]


@app.post("/predict/risk-level", response_model=RiskLevelResponse)
def predict_risk_level(vitals: VitalsInput):
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

    if worst is None:
        return RiskLevelResponse(level="no_data", level_label=LEVEL_LABELS["no_data"], flagged_vitals=[])
    return RiskLevelResponse(level=worst, level_label=LEVEL_LABELS[worst], flagged_vitals=flagged)


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
