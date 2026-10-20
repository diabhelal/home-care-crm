// מפתח publishable (ציבורי) בלבד — לעולם לא secret key בצד לקוח
window.SUPABASE_URL = "https://qqeupktyadjxqoxkstnl.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_qHCGgd5ssfUAiUBdqu8Bzg_PFq4lq-Q";

// מקור יחיד לכתובת שירות התחזית המקומי — קודם היה מוכפל בקוד-קשיח בתוך
// admin.html וגם employee.html בנפרד (סיכון לסטייה בין השניים). שירות מקומי
// בלבד (Python, מופעל ידנית) — לא זמין תמיד, ר' predictiveServiceHealthCheck ב-app.js.
window.PREDICTIVE_SERVICE_URL = "http://localhost:8000";

// מצב הדגמה: מציג באנר "אל תזינו מידע אמיתי" בכל עמוד. לכבות (false) רק כשיש
// מדיניות פרטיות, תנאי שימוש והסכמה מדעת — ר' DEPLOY.md, "מה נשאר לשירות אמיתי".
window.DEMO_MODE = true;

// כניסה/שמירת היסטוריה בטלפון עם קוד SMS (בנוסף לאימייל). כבוי עד שמוגדר ספק SMS ב-Supabase
// (Authentication ← Providers ← Phone) — ר' HANDOFF.md. כשהוא false הממשק מוסתר לגמרי.
window.SMS_LOGIN_ENABLED = false;

// השירותים שהעסק מציע בפועל כרגע (מקור יחיד, הפיך כשהצוות יגדל): רק אחיות/אחים.
// להוספת תפקיד (למשל "doctor") או מטרת ביקור — מוסיפים כאן; פאנל מנהל/צוות לא מושפע.
window.SERVICE_CONFIG = { roles: ["nurse"], purposes: ["checkup", "wound_care", "blood_test", "medication", "other"] };

// כתובת ה-backend התפעולי (FastAPI, backend/): הזמנות, זמינות ואישור/דחייה/שיבוץ.
// ברירת מחדל רק בהרצה מקומית. בכל מארח אחר חובה להגדיר כתובת HTTPS מפורשת כאן —
// אם היא ריקה, הזמנה מציגה "השירות אינו זמין" ולא כותבת כלום (אין נתיב כתיבה עוקף).
window.BACKEND_URL = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ? "http://localhost:8001" : "";

// מזהה גרסה שמוצג בתחתית העמודים (קטן): מאפשר לראות מיד אם הדפדפן מגיש קבצים ישנים מהמטמון.
window.APP_BUILD = "2026-10-20.47";
