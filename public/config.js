// מפתח publishable (ציבורי) בלבד — לעולם לא secret key בצד לקוח
window.SUPABASE_URL = "https://qqeupktyadjxqoxkstnl.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_qHCGgd5ssfUAiUBdqu8Bzg_PFq4lq-Q";

// מקור יחיד לכתובת שירות התחזית המקומי — קודם היה מוכפל בקוד-קשיח בתוך
// admin.html וגם employee.html בנפרד (סיכון לסטייה בין השניים). שירות מקומי
// בלבד (Python, מופעל ידנית) — לא זמין תמיד, ר' predictiveServiceHealthCheck ב-app.js.
window.PREDICTIVE_SERVICE_URL = "http://localhost:8000";
