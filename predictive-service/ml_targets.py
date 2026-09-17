"""ארכיטקטורת מודלים מונחי-פיקוח (Logistic Regression / Decision Tree / Random Forest / KNN)
לחיזוי אירועים קליניים עתידיים בינאריים (0/1).

חשוב מאוד: אף אחד מהמודלים כאן אינו מאומן בפועל בפרויקט הזה. אין היום בבסיס הנתונים
שום שדה/טבלה שמתעד תוצאה קלינית אמיתית (לדוגמה: "האם הייתה היפוגליקמיה ב-8 השעות
שלאחר המדידה") — ר' דוח האפיון הקודם בשיחה זו. בלי דאטה מתויג כזה, אי אפשר לאמן או
לאמת אף מודל כאן באופן אחראי.

המודול הזה הוא ארכיטקטורה מוכנה, לא סימולציה:
- is_trained() / predict_future_event() בודקים אם קובץ מודל שמור קיים בדיסק (models/).
  אם לא — מוחזר model_available=False. שום קריאה ל-predict_proba של sklearn לא
  מתבצעת על מודל לא מאומן, ואף פעם לא מומצאת הסתברות.
- train_model() אמיתית, פעילה, וניתנת להפעלה עם דאטה תקין (כולל time-aware/
  patient-level split באחריות הקורא, ומדדי הערכה נכונים — לא accuracy בלבד).
  שום נתיב בפרויקט הזה לא קורא לה כרגע כי אין דאטה מתויג אמיתי — לא סינתטי.
"""

from pathlib import Path

import joblib

MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

MIN_TRAINING_ROWS = 50  # סף שרירותי-אך-סביר למודל בינארי פשוט; פחות מזה לא מאפשר split תקין

TARGET_DEFINITIONS = {
    "hypoglycemia_within_8h": {"label_he": "היפוגליקמיה בתוך 8 שעות", "horizon_hours": 8},
    "severe_hyperglycemia_within_8h": {"label_he": "היפרגליקמיה חמורה בתוך 8 שעות", "horizon_hours": 8},
    "respiratory_deterioration_within_8h": {"label_he": "החמרה נשימתית בתוך 8 שעות", "horizon_hours": 8},
    "hemodynamic_deterioration_within_8h": {"label_he": "החמרה המודינמית בתוך 8 שעות", "horizon_hours": 8},
}

ALGORITHMS = ("logistic_regression", "decision_tree", "random_forest", "knn")


def _model_path(target: str, algorithm: str) -> Path:
    return MODELS_DIR / f"{target}__{algorithm}.joblib"


def is_trained(target: str, algorithm: str) -> bool:
    return _model_path(target, algorithm).exists()


def build_feature_vector(patient_context: dict, current_vitals: dict, baseline_by_vital: dict) -> dict:
    """הופך קלט מובנה לוקטור features שטוח, לשימוש עתידי באימון/היסק.
    פונקציה טהורה (בלי תלות ב-sklearn) כדי שאפשר יהיה לבדוק אותה בנפרד."""
    features = {
        "age": patient_context.get("age"),
        "smoking_current": 1 if patient_context.get("smoking_status") == "current" else 0,
        "has_diabetes": 1 if "diabetes" in (patient_context.get("background_conditions") or []) else 0,
        "has_hypertension": 1 if "hypertension" in (patient_context.get("background_conditions") or []) else 0,
        "has_heart_failure": 1 if "heart_failure" in (patient_context.get("background_conditions") or []) else 0,
    }
    for vital, value in (current_vitals or {}).items():
        features[f"current_{vital}"] = value
    for vital, info in (baseline_by_vital or {}).items():
        features[f"{vital}_deviation"] = info.get("deviation")
    return features


def predict_future_event(target: str, algorithm: str, features: dict) -> dict:
    if target not in TARGET_DEFINITIONS:
        raise ValueError(f"יעד לא מוכר: {target}")
    if algorithm not in ALGORITHMS:
        raise ValueError(f"אלגוריתם לא מוכר: {algorithm}")

    if not is_trained(target, algorithm):
        return {
            "target": target,
            "label_he": TARGET_DEFINITIONS[target]["label_he"],
            "algorithm": algorithm,
            "horizon_hours": TARGET_DEFINITIONS[target]["horizon_hours"],
            "model_available": False,
            "status": "collecting_ground_truth",
            "probability": None,
            "predicted_class": None,
            "reason": "לא קיים מודל מאומן — נדרש דאטה עם תוצאה קלינית מתועדת לאימון",
        }

    import pandas as pd

    model = joblib.load(_model_path(target, algorithm))
    row = pd.DataFrame([features])
    proba = float(model.predict_proba(row)[0][1])
    return {
        "target": target,
        "label_he": TARGET_DEFINITIONS[target]["label_he"],
        "algorithm": algorithm,
        "horizon_hours": TARGET_DEFINITIONS[target]["horizon_hours"],
        "model_available": True,
        "status": "active",
        "probability": round(proba, 4),
        "predicted_class": bool(proba >= 0.5),
        "reason": None,
    }


def train_model(target: str, algorithm: str, X: list[dict], y: list[int]) -> dict:
    """אימון אמיתי. דורש X/y עם תוצאה קלינית מתועדת אמיתית (לא סינתטית) ברמה שמאפשרת
    time-aware / patient-level split תקין — זו אחריות הקורא *לפני* קריאה לפונקציה הזו
    (לחלק את הדאטה כך שאין דליפת מידע בין תקופות/מטופלים). שום קוד בפרויקט הזה לא
    קורא לפונקציה הזו כרגע כי אין דאטה מתויג אמיתי כזה — קיימת לשימוש עתידי.
    """
    import pandas as pd
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import (
        average_precision_score,
        f1_score,
        precision_score,
        recall_score,
        roc_auc_score,
    )
    from sklearn.model_selection import train_test_split
    from sklearn.neighbors import KNeighborsClassifier
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.tree import DecisionTreeClassifier

    if target not in TARGET_DEFINITIONS:
        raise ValueError(f"יעד לא מוכר: {target}")
    if algorithm not in ALGORITHMS:
        raise ValueError(f"אלגוריתם לא מוכר: {algorithm}")
    if len(X) < MIN_TRAINING_ROWS:
        raise ValueError(
            f"אין מספיק דאטה מתויג לאימון אחראי ({len(X)} < {MIN_TRAINING_ROWS} שורות) — "
            "אימון על כמות כזו יגרום ל-overfitting חמור."
        )

    df = pd.DataFrame(X)
    X_train, X_val, y_train, y_val = train_test_split(
        df, y, test_size=0.2, random_state=42, stratify=y
    )

    if algorithm == "logistic_regression":
        model = Pipeline([("scaler", StandardScaler()), ("clf", LogisticRegression(max_iter=1000))])
    elif algorithm == "decision_tree":
        model = DecisionTreeClassifier(max_depth=5, random_state=42)
    elif algorithm == "random_forest":
        model = RandomForestClassifier(
            n_estimators=200, max_depth=6, random_state=42, class_weight="balanced"
        )
    else:  # knn
        model = Pipeline([("scaler", StandardScaler()), ("clf", KNeighborsClassifier(n_neighbors=5))])

    model.fit(X_train, y_train)
    val_proba = model.predict_proba(X_val)[:, 1]
    val_pred = (val_proba >= 0.5).astype(int)

    metrics = {
        "recall": round(recall_score(y_val, val_pred, zero_division=0), 3),
        "precision": round(precision_score(y_val, val_pred, zero_division=0), 3),
        "f1": round(f1_score(y_val, val_pred, zero_division=0), 3),
        "roc_auc": round(roc_auc_score(y_val, val_proba), 3) if len(set(y_val)) > 1 else None,
        "pr_auc": round(average_precision_score(y_val, val_proba), 3) if len(set(y_val)) > 1 else None,
        "n_train": len(X_train),
        "n_val": len(X_val),
    }

    joblib.dump(model, _model_path(target, algorithm))
    return metrics
