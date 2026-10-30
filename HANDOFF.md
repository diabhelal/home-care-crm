# HANDOFF — מצב הפרויקט ומה הלאה

> לשיחה חדשה: `git clone https://github.com/diabhelal/home-care-crm.git` (הריפו **ציבורי** מ-2026-10-17, לבקשת הבעלים כדי שמרצה יוכל לצפות; היה פרטי ב-15–17.10) ← קרא `CLAUDE.md` (סעיף "מצב נוכחי") ואת הקובץ הזה.
> עודכן: 2026-10-31. מקור האמת לקוד: git. פירוט: `docs/WORKPLAN.md`, `docs/REVIEW.md`, `docs/DEMO.md`, `docs/STAGING_PLAN.md`.

## להמשכת עבודה בשיחה חדשה (קרא קודם) — עודכן 2026-10-31
**איך מתחילים:** פתח ב-Cursor את התיקייה `/Users/helaldiab/home-care-crm` (התיקייה היחידה לעבודה). בשיחה חדשה: "קרא `HANDOFF.md` ו-`CLAUDE.md` והמשך מהמצב שם".

**מיקום ומצב:**
- **ענף פעיל:** `feature/llm-clinical-summary` (ה-commit האחרון: `git log -1`). **PR #18 פתוח, לא ממוזג:** https://github.com/diabhelal/home-care-crm/pull/18 · `main` נשאר על `fbd69e5` (בלי פיצ'ר ה-AI). מדיניות (`CLAUDE.md`): כל פיצ'ר בענף + PR; בלי push ישיר ל-`main`; בלי מיזוג אלא אם הבעלים ביקש.
- **תיקיות על המחשב:** `~/home-care-crm` = הפרויקט הפעיל. `~/Desktop/Home Care CRM/הפרויקט העדכני` = קיצור אליו. `~/Desktop/Home Care CRM/home-care-crm-for-review` = עותק לביקורת ישן (גרסת 15.10, בלי Git, ללא קבצים ייחודיים; לא לשלוח למרצה). `~/Desktop/Home Care CRM/עותקים ישנים (לא לעבוד בהם)` = ריקה. `~/.codex/.chatgpt-projects/.../home-care-crm` = עותק ChatGPT/Codex בניהול האפליקציה (עבודה חלופית שלא שולבה, מגובה). `~/Documents/home-care-crm-archive/` = גיבויים בלבד. `~/aiakilov-crm` = פרויקט אחר, לא קשור. **לא נמחק/הוזז כלום.**

**הושלם (בענף/ב-PR, ובחלקו כבר ב-`main`):** תיקוני אופליין, השבתת צוות, היסטוריית מדידות, תיקון דוח כרשומה חדשה, ארכיון + הוצאת תיק משפטית, צבעי סיכון עם גיל, סקילים וסוכן סקירה, ופיצ'ר סיכום AI (backend + UI + חבילת הערכה + תיעוד `docs/AI_SUMMARY.md`).

**בדיקות (הורצו 2026-10-31 00:12 על commit הענף):** backend 207 · DB מבודד 101 · `verify_proposed_sql.py` OK · predictive 17 · יחידה 57 · Playwright ממוקק 67/67. **כישלון תלוי-שעה:** `staff-field-actions › ממתינה לאישור` נכשל ב-2026-10-30 ב-23:49 (גם על `main` נקי), ועובר ב-00:12 — הבדיקה יוצרת ביקורים ל-שעה/שעתיים מעכשיו ונשברת בין 23:00 לחצות (תיקון: הקפאת זמן בטסט; לא בוצע). CI על PR #18 ירוק.

**הערכת LLM:** **לא הורצה.** נמדד רק baseline דטרמיניסטי (`backend/eval/summary/results/`). דרוש: מפתח API + תקציב מאושר (מומלץ $2; הערכה $0.15–0.75 לסיבוב) + הרצה מפורשת `--confirm-real-provider`. סקירה אנושית (אח/ות מוסמכ/ת) טרם בוצעה. הפרומפט לא כוון לפי סט ההערכה הסופי; כל שינוי אחרי הרצת heldout יירשם ב-`results/heldout-log.md`. **אם מפתח הוגדר בטרמינל — הוא נעלם בסגירתו; יש להגדיר שוב** (הוראות: `backend/eval/summary/README.md`).

**מיגרציות ופריסה:**
- **אומת ב-2026-10-31 (קריאה בלבד):** ב-DB החי (`qqeupktyadjxqoxkstnl`) רשומות 23 מיגרציות, האחרונה `20261015155238`. **008–014 לא הוחלו.** הפרויקט החי לא שונה.
- הבעלים אישר להחיל 009 ו-010 (2026-10-20); **ההחלה בוטלה בשלב האישור בכלי ולא בוצעה.** אישור נוסף נדרש לפני כל החלה (אחת בכל פעם, עם אימות; 008 תשתנה לפי הבקשה הפתוחה למטה).
- **גיבוי:** אין גיבוי פלטפורמה. גיבוי נתונים ידני (אומת מול ה-DB) ב-`~/Documents/home-care-crm-archive/db-backup-2026-10-20/`; קוד: תג `pre-migrations-008-010-2026-10-20` + bundle ב-`system-backup-2026-10-20/`; קבצים מקומיים שאינם ב-Git (הגדרות, `.env`, טיוטות): `local-only-backup-2026-10-31/` (הרשאות 700/600; תוכנם לא מוצג ולא הועלה).
- **פריסת האתר/ה-backend: לא ידוע ולא נבדק** אם יש פריסה כלשהי; לא בוצעה פריסה על ידי העוזר. שירות החיזוי רץ ידנית ומקומית; הערכת סיכון אחרונה במסד החי: 2026-09-19. תקופת שמירה ועילות חשיפה: החלטה משפטית.

**הגדרות להפעלה מחדש (שמות בלבד, בלי ערכים):**
- `git config core.hooksPath .githooks` (hook סריקת סודות); סביבות Python: `cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt -r requirements-dev.txt` (וכך גם ב-`predictive-service`); `npm install` בשורש.
- `backend/.env` (לא ב-Git): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ALLOWED_ORIGINS`, `RISK_ATTESTATION_SECRET`, ולפיצ'ר AI בלבד: `SUMMARY_ENABLED`, `SUMMARY_DB_PROVENANCE_READY` (true רק אחרי מיגרציה 014), `LLM_API_KEY`, `LLM_MODEL`, `SUMMARY_SIGNING_SECRET`; ב-`public/config.js`: `AI_SUMMARY_ENABLED` (ברירת מחדל false). שרתים: `cd public && python3 -m http.server 8080`; `cd backend && uvicorn app.main:app --port 8001 --env-file .env`.
- בתיקיית השורש קיים `keys.txt` (מחוץ ל-Git, מתעלם ב-`.gitignore`, מעולם לא ב-commit; מקורו לא ידוע לעוזר): בדוק אם הוא מכיל סודות והחלט אם להשאירו.

**בקשה פתוחה:** לאפשר לאיש הצוות שרשם דוח ביקור לעדכן אותו (תוכן), כל עדכון ביומן הביקורת עם הערך הישן. מיגרציה 008 כפי שכתובה נועלת דוח שהושלם; יש לשנות אותה + הממשק ולהציג לבעלים את ה-SQL לפני החלה.

**המשימה הבאה (לפי עדיפות):** (1) הבעלים בודק/ממזג PR #18 או מבקש שינויים; (2) הרצת הערכת LLM אחרי מפתח ותקציב, וסקירה אנושית; (3) מימוש עדכון דוח על ידי כותבו (008 מתוקנת) ואחר כך אישור להחלת 008–010 (ו-011–014 לפי הצורך) על ה-DB החי; (4) אירוח backend + שירות חיזוי עם HTTPS; (5) החלטות מוצר (חשיפת זהות צוות למטופל, מחיר ואזור שירות) והחלטה משפטית על שמירה; (6) תיקון הטסט התלוי-שעה.
- תיקיות `.agents/`, `.codex/agents/medical-records-reviewer.toml` ושתי טיוטות העיצוב ב-`docs/` אינן בריפו (גובו מקומית; לא להוסיף ל-commit).

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
מופעל (אומת ב-API ב-2026-10-17): Dependabot security updates, **Secret scanning + Push protection**, סריקת סודות בכל ה-history ב-CI (`secret-scan`), `permissions: contents: read`. **Branch protection על `main` לא הופעל**, אבל מ-2026-10-30 העבודה היא בענף + PR לכל פיצ'ר (הוראת הבעלים; ר' `CLAUDE.md`). מומלץ להפעיל גם הגנת ענף כדי לאכוף זאת. ההגנה על סודות נשענת גם על ה-hook המקומי (`git config core.hooksPath .githooks`). אם הריפו יוחזר ל-private בתוכנית החינמית, Secret scanning/Push protection/Branch protection יפסיקו להיות זמינים.

## חוקים קבועים
1. אין push/פריסה/שינוי DB בלי אישור מפורש (SQL: מציגים, בודקים על Postgres מבודד, ורק אז מבקשים). `supabase config push` דורס את כל `[auth]`.
2. **אסור** להריץ `booking.spec.js`/`visit-report.spec.js` מול ה-DB החי.
3. לא לשנות נוסחאות/סוכנים ב-`predictive-service/`. הערכת הסיכון מסומנת "מבוססת כללים — הדגמה".
4. ה-hook ב-`.githooks/pre-commit` חוסם `secret = "..."`; לא עוקפים — בונים ערכי בדיקה בזמן ריצה.
5. בכל שינוי קליינט: להעלות `CACHE_VERSION` (`public/service-worker.js`) ו-`APP_BUILD` (`public/config.js`).
6. לפני שאומרים "תוקן": לבדוק בדפדפן אמיתי מול החי באותו מסלול שהמשתמש עושה (לא רק מוקים).

## בדיקות (אחרון ידוע)
JS 57/57 · Playwright (ממוקק) 67/67 (ב-2026-10-30 23:49 אחת נכשלה: תלוית-שעה, ר' למעלה) · backend 207/207 · DB מבודד 101/101 · predictive 17/17 (הורצו ב-2026-10-17) · אימות SQL כולל rollback OK. **CI ב-GitHub מריץ**: סריקת סודות, JS, predictive-service, `backend` (`backend/tests` + `backend/tests_db`) ו-15 קבצי Playwright ממוקקים.

## נותר
- [ ] **כניסה/שמירת היסטוריה בטלפון (SMS)**: הממשק בנוי ובדוק (ממוקק), מוסתר מאחורי `window.SMS_LOGIN_ENABLED = false` ב-`public/config.js`. להפעלה: ספק SMS (Twilio וכד') ב-Supabase Authentication ← Providers ← Phone, קאפצ'ה, בדיקת מגבלות קצב; ורק אז `true`. אם משתמשים ב-`config push`, לבדוק diff כי הוא דורס את כל `[auth]`.
- [ ] **להחיל `supabase/proposed/008_visit_report_integrity.sql`** (טריגר שמונע כתיבה ישירה ל-`visit_reports` שעוקפת אישור/התאמת הזמנה-מטופל-איש צוות, נועל דוח שהושלם ומונע מחיקה ע"י צוות). נבדק רק על Postgres מבודד (58 בדיקות DB); לא הוחל על הפרויקט החי — דורש אישור, ואז העתקה ל-`supabase/migrations/` בשם הגרסה הרשום.
- [ ] **להחיל `supabase/proposed/009_staff_deactivate_not_delete.sql`** (אחרי 008): מחיקת איש צוות עם היסטוריה נחסמת (RESTRICT), מושבת לא מקבל שיבוצים חדשים, והיסטוריית המטופל ממשיכה להציג את שמו. ה-UI כבר מציע "השבתה"; ללא המיגרציה המחיקה עדיין מוחקת בשרשרת במסד החי — דורש אישור.
- [ ] **להחיל `supabase/proposed/010_booking_update_conflict_guard.sql`** (אחרי 008–009): בדיקת חפיפה ומרווח נסיעה גם בעדכון הזמנה (שעה/עובד/הפעלה מחדש/כתובת), גם למנהל ובכתיבה ישירה, עם נעילת איש הצוות נגד מרוצים. נבדק רק על Postgres מבודד; לא הוחל על הפרויקט החי. בלוקי ה-ROLLBACK של 008–010 נוספו ל-`docs/STAGING_PLAN.md`.
- [ ] **להחיל `supabase/proposed/011_risk_status_always_visible.sql`**: ה-view `current_patient_risk` החזיר רק חיזוי של 8 השעות האחרונות, ולכן צבע הסיכון נעלם 8 שעות אחרי הביקור (במסד החי כרגע אף מטופל לא מציג צבע). אחרי המיגרציה מוצגת תמיד ההערכה האחרונה עם גיל, מעל 24 שעות "מיושן", וכשנשמר דוח חדש שטרם הוערך מוצג גם זה. קוד הממשק כבר ב-`main` ופועל גם בלי המיגרציה (מציג את מה שה-view מחזיר). **שירות החיזוי (`predictive-service`) רץ ידנית ומקומית**: ההערכה האחרונה במסד החי נשמרה ב-2026-09-19, כלומר אחרי המעבר ל-backend היא לא רצה; בלי שירות פעיל (ובסוד האטסטציה) צבעים חדשים לא ייווצרו.
- [ ] **להחיל `supabase/proposed/012_visit_report_amendments.sql`** (טבלה חדשה append-only: תיקון/הבהרה לדוח ביקור שהושלם כרשומה חדשה, בלי לערוך את המקור). קוד הממשק (טופס "הוספת תיקון") כבר ב-`main`; בלי המיגרציה השמירה תיכשל עם הודעה ברורה.
- [ ] **להחיל `supabase/proposed/013_patient_archive_and_record_export.sql`** (ארכיון מטופל במקום מחיקה, והוצאת תיק מלא למנהל בלבד עם יומן גישה append-only). **תקופת השמירה והעילות לבקשה הן החלטה משפטית** — המערכת לא מוחקת אוטומטית ואינה מצהירה על עמידה בחוק. קוד הממשק כבר ב-`main`; בלי המיגרציה הכפתורים יציגו כשל ברור.
- [ ] **סיכום AI לדוח ביקור** (ענף `feature/llm-clinical-summary`, PR פתוח; opt-in, כבוי): נדרש להחיל `supabase/proposed/014_visit_report_ai_provenance.sql` (אישור הבעלים) כדי שמקור ה-AI יתועד; הפעלה דורשת `SUMMARY_ENABLED`, `LLM_API_KEY`, `SUMMARY_SIGNING_SECRET` בשרת ו-`AI_SUMMARY_ENABLED` ב-`config.js`. **הערכה אמיתית מול ספק עדיין לא הורצה** (ר' `backend/eval/summary/README.md`); נתונים סינתטיים בלבד.
- [ ] ניקוי נתוני בדיקה שיצרתי בפרויקט החי: הזמנות מבוטלות #49 ו-#51, שורות מטופל "בדיקת מערכת…" ומשתמשי אורח אנונימיים (~220) — **רק באישור**.
- [ ] אירוח backend (HTTPS), `BACKEND_URL`, CSP `connect-src`, CORS.
- [ ] MFA + Leaked password protection (דאשבורד), החלפת סוד האטסטציה.
- [ ] משפטי: פרטיות, תנאי שימוש, הסכמה מדעת; בדיקת חדירה.
- [ ] תזכורות לצוות כשהאתר סגור (אימייל/SMS) — דורש ספק חיצוני.

## פערים ידועים
מרווח נסיעה קבוע (30 דק') ולא זמן נסיעה; קרבה לפי מיקום לא פעילה (קואורדינטות צוות פרטיות); טיוטות אופליין ב-`localStorage` ללא הצפנה; דוח שהושלם נעול לעריכה; מחיקת התראות ע"י מנהל אפשרית.
