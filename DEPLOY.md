# תוכנית פריסה — גרסת הדגמה (Demo)

> **היקף:** פריסה של הדגמה עם **נתונים סינטטיים בלבד**. זה לא שירות לטיפול רפואי אמיתי.
> שירות אמיתי דורש תהליך נפרד (משפטי, תשתית, אימות) — ר' [מה נשאר לשירות אמיתי](#מה-נשאר-לשירות-אמיתי).

## ארכיטקטורה בפרודקשן

```
דפדפן ──► אירוח סטטי (תיקיית public/) ──► Supabase (DB + Auth + Edge Function)   [קריאות]
   │
   └─(JWT)─► backend/ (FastAPI, HTTPS) ──► Supabase (RLS נשמר)                  [כל הכתיבות להזמנות/דוחות/סיכון]
                     └─► predictive-service/ (Python, כללים קליניים)
```

אין build step לאתר: מעלים את התיקייה `public/` כמו שהיא.

> ⚠️ **האתר הסטטי לבדו אינו מספיק.** הזמנה, אישור, check-in, השלמת ביקור והערכת סיכון עוברים דרך `backend/`; הדפדפן לא כותב ישירות לטבלאות האלה. בלי backend מאורח (HTTPS) הזמנה מציגה "השירות אינו זמין" (בכוונה). **ה-backend אינו מאורח היום** ורץ מקומית בלבד - ר' שלב 3א.

## בחירת אירוח (המלצה: Cloudflare Pages)

| אפשרות | יתרון | הערה |
|---|---|---|
| **Cloudflare Pages** (מומלץ) | חינם, HTTPS, קורא `public/_headers`, CDN | Build command ריק, output directory: `public` |
| Netlify | זהה | Publish directory: `public` |
| GitHub Pages | פשוט | **לא** קורא `_headers` — בלי כותרות אבטחה, לא מומלץ |

## שלבים

### 1. הכנה (מקומי, פעם אחת)
- [ ] בדיקות ירוקות: `node --test tests/unit/*.test.js`; Playwright הממוקק (`ls tests/e2e/*.spec.js | grep -vE "/(booking|visit-report)\.spec\.js$" | xargs npx playwright test`); `cd backend && pytest -q --ignore=tests_db && pytest tests_db -q`.
- [ ] סריקת סודות על ה-diff (ה-hook `.githooks/pre-commit` וה-job `secret-scan` ב-CI): אין `service_role` ואין סיסמאות.
- [ ] `public/config.js` מכיל **רק** מפתח publishable.

### 2. Supabase — הגדרות (בדאשבורד, לא ב-`config push`)
> ⚠️ `supabase config push` דורס את כל מקטע `[auth]`. את ההגדרות הבאות עושים **ידנית בדאשבורד**.

- [ ] **תוכנית:** לשדרג מ-Free (הפרויקט כבר הושהה פעם אחת מחוסר פעילות). בתוכנית בתשלום יש גם גיבויים יומיים.
- [ ] **Authentication ← URL Configuration:** `Site URL` = כתובת האתר המאורח; להוסיף ל-Redirect URLs את אותה כתובת.
- [ ] **Authentication ← Providers:** לוודא ש-Anonymous sign-ins דלוק (נדרש לזהות האורח). *אופציונלי:* ספק Phone (SMS) - נדרש רק להפעלת `SMS_LOGIN_ENABLED` ב-`public/config.js` (כבוי כברירת מחדל; כולל קאפצ'ה ומגבלות קצב לפני הפעלה).
- [ ] **Authentication ← Password protection:** להפעיל Leaked password protection.
- [ ] **Edge Function `create-staff-login`:** לוודא שה-CORS מתיר את הדומיין החדש (לבדוק בקוד ה-Function, מקור ה-Origin).
- [ ] משתמש מנהל: ליצור בדאשבורד דרך Auth ← Add user, ואז להגדיר `app_metadata.is_admin = true` (רק דרך Admin API/SQL). סיסמה נמסרת בצ'אט בלבד, לא בקובץ.

### 3. אירוח
- [ ] ליצור פרויקט Cloudflare Pages מחובר לריפו `diabhelal/home-care-crm`, branch `main`.
- [ ] Build command: *(ריק)*. Output directory: `public`.
- [ ] לא להגדיר משתני סביבה סודיים (אין צורך — הקליינט משתמש רק במפתח publishable).

### 3א. אירוח ה-backend (חובה לפני שהאתר יכול לקבל הזמנות)
- [ ] לארח את `backend/` (FastAPI) מאחורי **HTTPS בלבד**; ההוראות והמשתנים ב-`backend/README.md` (סעיפי Environment, Deployment requirements).
- [ ] משתנים בסוד-סטור של המארח (לא בריפו): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ALLOWED_ORIGINS` (המקור המדויק של האתר, בלי wildcard), `RISK_ATTESTATION_SECRET` (**להחליף לערך חדש**; הערך המקורי הופיע בשיחת עבודה ויש לעדכן גם את השורה ב-`server_secrets`), `PREDICTIVE_SERVICE_URL`.
- [ ] להגדיר `window.BACKEND_URL` ב-`public/config.js` לכתובת ה-HTTPS של ה-backend, ולהוסיף אותה ל-`connect-src` ב-`public/_headers` (אחרת ה-CSP יחסום את הקריאות).
- [ ] שירות התחזית (`predictive-service/`) חייב להיות נגיש ל-backend; אם לא, הערכת סיכון מחזירה 503 ולא נכתב דבר (הדוח עצמו נשמר).

### 4. דומיין
- [ ] לחבר דומיין מותאם (או להשתמש ב-`*.pages.dev` להדגמה).
- [ ] לעדכן `Site URL` ב-Supabase לכתובת הסופית (שלב 2).

### 5. כותרות אבטחה (CSP)
`public/_headers` כולל כותרות אבטחה ו-CSP במצב **אכיפה** (`Content-Security-Policy`, לא Report-Only):
- [ ] לפתוח כל עמוד עם DevTools ולוודא שאין הפרות CSP בקונסולה (אחרי הוספת `BACKEND_URL` ל-`connect-src`, שלב 3א).
- [ ] שימו לב: `'unsafe-inline'` נדרש כי יש סקריפטים ו-style inline. לשיפור עתידי: nonce/hash.

### 6. בדיקות אחרי פריסה (Smoke)
- [ ] דף הבית נטען, תמונה ופונטים מופיעים.
- [ ] תיאום ביקור מלא: שירות → כתובת → תאריך/שעה → פרטים → "התבקש וממתין לאישור" + מספר הזמנה → "ההזמנות שלי"; אישור ע"י מנהל; check-in והשלמת דוח ע"י אחות.
- [ ] כניסת צוות וכניסת מנהל (עם משתמשי הבדיקה), פתיחת תיק מטופל ודוח ביקור.
- [ ] טופס יצירת קשר עובד ומופיע בפאנל המנהל.
- [ ] Service Worker: רענון קשיח אחרי עדכון ללא שגיאות.
- [ ] באנר "שירות התחזיות אינו זמין" מוצג בצורה תקינה אם שירות התחזית לא מאורח.

### 7. סימון הדגמה
- [ ] `public/demo-notice.html` — עמוד הבהרה, מקושר מהפוטר.
- [ ] `robots.txt` + `X-Robots-Tag: noindex` — האתר לא יופיע בחיפוש.
- [x] באנר "מערכת הדגמה — נתונים סינתטיים בלבד" בראש כל עמוד (דגל `DEMO_MODE` ב-`public/config.js`).
- [x] רכיב הסיכון מתויג בממשק: "הערכת סיכון מבוססת כללים — הדגמה בלבד".
- [x] שירות התחזית: בפריסה מאורחת בדיקת הזמינות שלו מדולגת (אין תלות ב-`localhost`); כפתורים שתלויים בו מציגים הודעת "השירות אינו זמין" בלחיצה.

## פיתוח שוטף (אחרי העלייה)
- כל push ל-`main` נפרס אוטומטית. מומלץ להגן על `main` (PR + CI ירוק).
- שינוי סכמה: ה-workflow הקיים (`execute_sql` ← advisors ← migration מאושר). עדיף על פרויקט staging נפרד לפני פרודקשן.
- בכל שינוי בקבצי הקליינט: להעלות `CACHE_VERSION` ב-`public/service-worker.js`.

## מה נשאר לשירות אמיתי
דברים שהפריסה הזאת **לא** פותרת:

1. **משפטי:** מדיניות פרטיות, תנאי שימוש, הסכמה מדעת, רישום מאגר/אחראי הגנת פרטיות, בהתאם לחוק הגנת הפרטיות (תיקון 13) ותקנות אבטחת מידע. נדרש ייעוץ משפטי.
2. **backend ושירות התחזית:** לארח את `backend/` (שלב 3א) ואת `predictive-service/` מאחורי אימות. כללים בלבד, לא מכשיר רפואי מאושר.
3. **זהות:** ספק SMS (הממשק בנוי, כבוי ב-`SMS_LOGIN_ENABLED`), MFA למנהל ולצוות, אימות אימייל, החלפת `RISK_ATTESTATION_SECRET`.
4. **סביבות:** פרויקט staging נפרד; בדיקות DB חי (`booking.spec`, `visit-report.spec`) רק מולו.
5. **תפעול:** ניטור/התראות, בדיקת שחזור מגיבוי, תהליך תגובה לאירוע אבטחה.
6. **בדיקות:** בדיקת חדירה חיצונית, בדיקת נגישות (WCAG 2.2 AA), ניסוי עם משתמשים אמיתיים.
7. **תוכן:** שם עסק, פרטי קשר אמיתיים, תמונות מורשות.
