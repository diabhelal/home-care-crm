# HANDOFF — מצב הפרויקט ומה הלאה

> קובץ מעבר בין שיחות. מקור האמת לקוד: git. פירוט: `docs/WORKPLAN.md`, `docs/REVIEW.md`, `docs/DEMO.md`, `docs/STAGING_PLAN.md`.
> עודכן: 2026-10-15. **הכול מקומי: לא נדחף ל-GitHub (commits מקומיים בלבד), לא נפרס, ה-DB החי לא שונה.**

## איפה אנחנו
- **מוצר:** אב-טיפוס יציב להדגמה עם נתונים סינתטיים. לא מוכן למטופלים אמיתיים.
- **צוות:** אחים בלבד (אין רופאים/פיזיותרפיסטים). `SERVICE_CONFIG` ב-`public/config.js` שולט במה שמוצג.
- **עיצוב:** פלטה כחול כהה (`#0F172A`/`#1E3A8A`) + מנטה לפעולות (`#047857`), רקע `#F8FAFC`, פונט Inter/Manrope. הבעלים דחה שכתובים עיצוביים חוזרים; **לא לשנות עיצוב בלי תצוגה מקדימה ואישור**.
- **DB חי (Supabase `qqeupktyadjxqoxkstnl`):** 16 מיגרציות רשומות, נתונים סינתטיים. **לא הוחל עליו כלום מ-`supabase/proposed/`.**

## ארכיטקטורה (בקצרה)
- `public/` סטטי (HTML/CSS/JS). `backend/` FastAPI חדש לפעולות תפעוליות (הזמנה, זמינות+מרווח 30 דק', אישור/דחייה/שיבוץ/ביטול, check-in עם זמן שרת, השלמת ביקור אטומית, תוצאה קלינית, חיזוי סיכון והתראות).
- `predictive-service/` נשאר כמות שהוא (כללים קליניים + רגרסיה/ARIMA; אין ML מאומן). **לא לשנות נוסחאות.**
- הדפדפן לא כותב ל-`bookings`/`visit_reports`/`risk_predictions`/`alerts` (0 כתיבות ישירות, נבדק).
- `supabase/proposed/001-007` = SQL מוצע (לא מופעל): עמודות אישור/כתובת/check-in, פונקציות check-in/complete, טריגרים שמגינים על `bookings`, כתיבת חיזוי/התראה בשרת עם HMAC, כפיית זהות כותב.

## בדיקות (מקומי)
```
node --test tests/unit/*.test.js
ls tests/e2e/*.spec.js | grep -vE "/(booking|visit-report)\.spec\.js$" | xargs npx playwright test
cd backend && source .venv/bin/activate && pytest -q --ignore=tests_db && pytest tests_db -q
```
אחרון ידוע: JS 29/29, Playwright 42/42, backend 132/132, DB מבודד 37/37, predictive 17/17.

## חוקים קבועים
1. **אסור להריץ** `tests/e2e/booking.spec.js` ו-`visit-report.spec.js` מול ה-DB החי.
2. אין push, פריסה או שינוי ב-DB החי בלי אישור מפורש של הבעלים. SQL חדש: מציגים, בודקים על Postgres מבודד, ורק אז מבקשים אישור.
3. `supabase config push` דורס את כל מקטע `[auth]`: הגדרות Auth ידנית בדאשבורד.
4. ה-hook ב-`.githooks/pre-commit` חוסם `secret = "..."`/`password: "..."`; לא עוקפים, בונים ערכי בדיקה בזמן ריצה.
5. שינוי בקבצי קליינט ← להעלות `CACHE_VERSION` ב-`public/service-worker.js` (כעת v31+).
6. לא להמציא טענות (24/7, "מוסמך" וכד'); הערכת הסיכון תמיד מסומנת "מבוססת כללים — הדגמה".

## נותר
- [ ] להחיל `supabase/proposed/001-007` על **פרויקט staging נפרד** (ר' `docs/STAGING_PLAN.md`), להריץ מסע מלא על PostgREST אמיתי.
- [ ] אירוח backend עם HTTPS, `BACKEND_URL`, CSP `connect-src`, CORS.
- [ ] MFA ו-Leaked password protection (דאשבורד), ניקוי ~173 משתמשי אורח ישנים (מחיקה באישור).
- [ ] משפטי: פרטיות, תנאי שימוש, הסכמה מדעת. בדיקת חדירה.
- [ ] טיוטות עיצוב שלא בריפו: `docs/design-preview.html`, `docs/hero-options.html` (אפשר למחוק).

## פערים ידועים
מחיקת התראות ועריכת כותרת משימה עדיין אפשריות (007 מצמצם). מרווח נסיעה קבוע, לא זמן נסיעה. טיוטות אופליין ב-`localStorage` ללא הצפנה.
