"""חיזוי סדרות עתיות (Time Series) עם ARIMA — מודל קלאסי (לא רשת נוירונים), לכל מדד
בנפרד, על סמך timestamp אמיתי. ר' lstm_interface.py לממשק המיועד לעתיד.

הגבלה גלויה: ARIMA קלאסי מניח מרווחי דגימה סדירים. בהיעדר צפיפות דאטה מספקת אנחנו
מתייחסים לערכים לפי סדר כרונולוגי בלבד (לא לפי מרווח שעתי מדויק) — פישוט מוצהר,
לא מודל state-space מלא למרווחים לא-סדירים (למשל Kalman filter).
"""

MIN_POINTS_FOR_ARIMA = 8  # סף שרירותי-אך-שמרני; חיזוי ARIMA אמין דורש בפועל הרבה יותר.


def forecast_arima(vital: str, points: list[dict], horizon_hours: float) -> dict:
    pts = sorted(points, key=lambda p: p["measured_at"])
    n = len(pts)

    result = {
        "vital": vital,
        "model_available": False,
        "predicted_value": None,
        "confidence_interval": None,
        "horizon_hours": horizon_hours,
        "number_of_measurements": n,
        "reason": None,
    }

    if n < MIN_POINTS_FOR_ARIMA:
        result["reason"] = f"נדרשות לפחות {MIN_POINTS_FOR_ARIMA} מדידות היסטוריות ({n} קיימות כרגע)"
        return result

    try:
        from statsmodels.tsa.arima.model import ARIMA

        values = [p["value"] for p in pts]
        model = ARIMA(values, order=(1, 1, 0))
        fitted = model.fit()
        forecast = fitted.get_forecast(steps=1)
        predicted = float(forecast.predicted_mean[0])
        ci = forecast.conf_int(alpha=0.05)
        result["model_available"] = True
        result["predicted_value"] = round(predicted, 2)
        result["confidence_interval"] = [round(float(ci[0][0]), 2), round(float(ci[0][1]), 2)]
    except Exception as e:  # ARIMA יכול לא-להתכנס על דאטה מעט/לא סדיר — מתדרדרים בבקרה
        result["reason"] = f"ARIMA נכשל להתכנס על הדאטה הזמין: {e}"

    return result
