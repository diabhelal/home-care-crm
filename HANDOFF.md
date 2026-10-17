# HANDOFF — מצב הפרויקט ומה הלאה

> לשיחה חדשה: `git clone https://github.com/diabhelal/home-care-crm.git` (הריפו **ציבורי** מ-2026-10-17, לבקשת הבעלים כדי שמרצה יוכל לצפות; היה פרטי ב-15–17.10) ← קרא `CLAUDE.md` (סעיף "מצב נוכחי") ואת הקובץ הזה.
> עודכן: 2026-10-17. מקור האמת לקוד: git. פירוט: `docs/WORKPLAN.md`, `docs/REVIEW.md`, `docs/DEMO.md`, `docs/STAGING_PLAN.md`.

## איפה אנחנו
- **מוצר:** אב-טיפוס יציב עם נתונים סינתטיים; **לא מוכן למטופלים אמיתיים** (חסרים: מסמכים משפטיים, אירוח backend עם HTTPS, MFA, בדיקת חדירה).
- **DB חי (Supabase `qqeupktyadjxqoxkstnl`):** 23 מיגרציות רשומות (16 מקוריות + 001–007 שהוחלו ב-2026-10-15). שלושה ממצאים תוקנו לפני ההחלה: דליפת כתובות ב-`staff_busy_blocks`, `base_lat/lng` פרטי, ובלעת cascade ב-`clinical_notes`.
- **הזמנה (אומת מקצה לקצה מול החי):** בחירת שירות (ברירת מחדל: בדיקה כללית) ← תאריך (ימים בלי שעות מעומעמים) ← שעה ← שם/ת"ז/טלפון/כתובת ← "התבקש וממתין לאישור" + מספר הזמנה. מנהל מאשר/דוחה/משבץ; אחות מתחילה ביקור (זמן שרת) ומשלימה (אטומי, גם אופליין).
- **עיצוב:** Heebo, נייבי + מנטה (`--primary #1E3A8A`, CTA `#047857`), רקע `#F8FAFC`, משפט הפתיחה במרקר מלא. **לא לשנות עיצוב בלי תצוגה מקדימה ואישור של הבעלים** (היו כמה סבבים של דחייה).

## הרצה מקומית (3 תהליכים)
```
cd public && python3 -m http.server 8080
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env   # למלא SUPABASE_URL, SUPABASE_ANON_KEY (publishable), ALLOWED_ORIGINS=http://localhost:8080, RISK_ATTESTATION_SECRET
uvicorn app.main:app --port 8001 --env-file .env
cd predictive-service && uvicorn main:app --port 8000   # אופציונלי (חיזוי סיכון)
```
`RISK_ATTESTATION_SECRET` = הערך ב-`public.server_secrets` (name `risk_attestation_secret`); קוראים אותו ב-SQL editor. **להחליף לערך חדש לפני שימוש אמיתי** (הערך הנוכחי הופיע בשיחת עבודה).

## הגדרות מקומיות שלא בריפו
`.claude/settings.local.json` (הרשאות Claude Code, כולל הפעלת Supabase MCP) ו-`backend/.env` הם per-machine ולא נשמרים ב-git. בשיחה חדשה: לאשר/להפעיל את שרת ה-MCP של Supabase ולהוסיף הרשאה לכלי `apply_migration`/`execute_sql` רק אם צריך לשנות DB.

## הגדרות GitHub (ריפו ציבורי)
מופעל (אומת ב-API ב-2026-10-17): Dependabot security updates, **Secret scanning + Push protection**, סריקת סודות בכל ה-history ב-CI (`secret-scan`), `permissions: contents: read`. **Branch protection על `main` לא הופעל** (החלטת בעלים: כרגע עובדים ישירות על `main`; ר' הוראת ה-push האוטומטי ב-`CLAUDE.md`). ההגנה על סודות נשענת גם על ה-hook המקומי (`git config core.hooksPath .githooks`). אם הריפו יוחזר ל-private בתוכנית החינמית, Secret scanning/Push protection/Branch protection יפסיקו להיות זמינים.

## חוקים קבועים
1. אין push/פריסה/שינוי DB בלי אישור מפורש (SQL: מציגים, בודקים על Postgres מבודד, ורק אז מבקשים). `supabase config push` דורס את כל `[auth]`.
2. **אסור** להריץ `booking.spec.js`/`visit-report.spec.js` מול ה-DB החי.
3. לא לשנות נוסחאות/סוכנים ב-`predictive-service/`. הערכת הסיכון מסומנת "מבוססת כללים — הדגמה".
4. ה-hook ב-`.githooks/pre-commit` חוסם `secret = "..."`; לא עוקפים — בונים ערכי בדיקה בזמן ריצה.
5. בכל שינוי קליינט: להעלות `CACHE_VERSION` (`public/service-worker.js`) ו-`APP_BUILD` (`public/config.js`).
6. לפני שאומרים "תוקן": לבדוק בדפדפן אמיתי מול החי באותו מסלול שהמשתמש עושה (לא רק מוקים).

## בדיקות (אחרון ידוע)
JS 35/35 · Playwright (ממוקק) 46/46 · backend 137/137 · DB מבודד 47/47 · predictive 17/17 (הורצו ב-2026-10-17) · אימות SQL כולל rollback OK. **CI ב-GitHub מריץ**: סריקת סודות, JS, predictive-service, `backend` (`backend/tests` + `backend/tests_db`) ו-15 קבצי Playwright ממוקקים.

## נותר
- [ ] **כניסה/שמירת היסטוריה בטלפון (SMS)**: הממשק בנוי ובדוק (ממוקק), מוסתר מאחורי `window.SMS_LOGIN_ENABLED = false` ב-`public/config.js`. להפעלה: ספק SMS (Twilio וכד') ב-Supabase Authentication ← Providers ← Phone, קאפצ'ה, בדיקת מגבלות קצב; ורק אז `true`. אם משתמשים ב-`config push`, לבדוק diff כי הוא דורס את כל `[auth]`.
- [ ] ניקוי נתוני בדיקה שיצרתי בפרויקט החי: הזמנות מבוטלות #49 ו-#51, שורות מטופל "בדיקת מערכת…" ומשתמשי אורח אנונימיים (~220) — **רק באישור**.
- [ ] אירוח backend (HTTPS), `BACKEND_URL`, CSP `connect-src`, CORS.
- [ ] MFA + Leaked password protection (דאשבורד), החלפת סוד האטסטציה.
- [ ] משפטי: פרטיות, תנאי שימוש, הסכמה מדעת; בדיקת חדירה.
- [ ] תזכורות לצוות כשהאתר סגור (אימייל/SMS) — דורש ספק חיצוני.

## פערים ידועים
מרווח נסיעה קבוע (30 דק') ולא זמן נסיעה; קרבה לפי מיקום לא פעילה (קואורדינטות צוות פרטיות); טיוטות אופליין ב-`localStorage` ללא הצפנה; דוח שהושלם נעול לעריכה; מחיקת התראות ע"י מנהל אפשרית.
