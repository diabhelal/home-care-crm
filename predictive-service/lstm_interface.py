"""ממשק מוכן (placeholder) למודל LSTM עתידי לחיזוי סדרות עתיות. לא ממומש בפועל —
לפי הנחיה מפורשת: LSTM דורש דאטה אורכי אמיתי בהיקף גדול משמעותית ממה שקיים בפרויקט
כרגע (כלל בסיס הנתונים מכיל 2 שורות visit_reports בסה"כ, בזמן כתיבת הקובץ הזה)
כדי להצדיק רשת נוירונים — פחות מזה יגרום ל-overfitting חמור בלי שום ערך אמיתי.

כשיגיע הזמן (מאות-אלפי מדידות אמיתיות לפחות), forecast_lstm אמור לקבל אותו חוזה
קלט/פלט בדיוק כמו timeseries.forecast_arima, כדי שאפשר יהיה להחליף/להשוות בין
המודלים בלי לשנות את הקוד הקורא:

    def forecast_lstm(vital: str, points: list[dict], horizon_hours: float) -> dict:
        # points: [{"measured_at": datetime, "value": float}, ...]
        # דורש ספריית deep learning (torch/tensorflow) שאינה מותקנת בפרויקט כיום.
        # יחזיר: {"vital", "model_available", "predicted_value", "confidence_interval",
        #          "horizon_hours", "number_of_measurements", "reason"}
        ...
"""


def forecast_lstm(vital: str, points: list, horizon_hours: float) -> dict:
    raise NotImplementedError(
        "LSTM אינו ממומש בפרויקט הזה כרגע — נדרש מאגר דאטה אורכי גדול משמעותית "
        "ממה שקיים היום כדי להצדיק רשת נוירונים. ר' תיעוד המודול לחוזה הפונקציה "
        "הצפוי כשהדאטה יהיה זמין."
    )
