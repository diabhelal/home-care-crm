"""שירות Python מקומי למודלי תחזית: קיבולת/מלאי (ליבה ראשונה), מגמת מדדים, רמת סיכון.
הרצה: uvicorn main:app --reload --port 8000
הפרונט (admin.html) קורא ל-endpoints האלה דרך fetch, ומציג את התוצאה בדשבורד הניהול.
"""

from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import ai_explain

load_dotenv()  # טוען .env מקומי אם קיים; לא נכשל אם אין קובץ (המפתחות אז פשוט לא מוגדרים)

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


# ===== שכבת הסבר AI (backend-only, אופציונלית) =====
# מקבלת אך ורק פלט שכבר חושב ע"י הכללים למעלה — אף פעם לא מקור להסתברות/אבחנה/חיזוי עצמאי.
# אם אין ANTHROPIC_API_KEY מוגדר ב-.env, מחזירה ai_available=False בלי לזרוק שגיאה —
# שאר המערכת ממשיכה לעבוד רגיל בלי השכבה הזו. ר' ai_explain.py.

class PatientContext(BaseModel):
    age: Optional[int] = None
    background_conditions: list[str] = []
    smoking_status: Optional[str] = None


class CurrentStatusInput(BaseModel):
    risk_level: str
    flagged_vitals: list[FlaggedVital] = []


class TrendInput(BaseModel):
    direction: Optional[str] = None  # improving | stable | worsening | None


class ExplainRequest(BaseModel):
    patient_context: PatientContext
    current_status: CurrentStatusInput
    trend: Optional[TrendInput] = None


class ExplainResponse(BaseModel):
    explanation: str
    ai_available: bool


@app.post("/explain", response_model=ExplainResponse)
def explain(req: ExplainRequest):
    provider = ai_explain.get_provider()
    if provider is None:
        return ExplainResponse(explanation="", ai_available=False)
    try:
        text = provider.explain(req.model_dump())
    except Exception:
        # קריאה חיצונית שנכשלה לא אמורה להפיל את הבקשה — מתדרדרים בחזרה ל"אין AI זמין"
        return ExplainResponse(explanation="", ai_available=False)
    return ExplainResponse(explanation=text, ai_available=True)
