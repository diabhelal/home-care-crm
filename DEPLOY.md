# פריסה ל-Railway — פיתוח (dev) וייצור (main)

> **סטטוס (2026-11-13): הכנה בלבד (שלב A). שום משאב ענן לא נוצר ושום דבר לא נפרס.** הקבצים בריפו מוכנים ונבדקים ב-CI (ה-job `containers`). יצירת פרויקט Railway, פרויקט Supabase לפיתוח, החלת מיגרציות ופריסה דורשים אישור מפורש של הבעלים (שלבים B ו-C למטה).

> **היקף:** הדגמה עם **נתונים סינתטיים בלבד**. זה לא שירות לטיפול רפואי אמיתי. ר' [מה נשאר לשירות אמיתי](#מה-נשאר-לשירות-אמיתי).

## ארכיטקטורה

```
דפדפן ──► frontend (Caddy, dist/ מ-make_release.py, כותרות אבטחה מ-public/_headers)
   │
   ├──► Supabase (Auth + DB, RLS)                                   [קריאות, התחברות]
   └─(JWT)─► backend (FastAPI, $PORT ציבורי) ──► Supabase (JWT של המשתמש, RLS נשמר)   [כל הכתיבות להזמנות/דוחות/מדידות/סיכון]
                 └─► predictive-service (127.0.0.1:8000 בתוך אותו קונטיינר, לא ציבורי)
```

| סביבה ב-Railway | שירות | ענף GitHub | Dockerfile (`RAILWAY_DOCKERFILE_PATH`) | בדיקת בריאות | Supabase |
|---|---|---|---|---|---|
| `development` | `frontend` | `dev` | `Dockerfile.web` | `/` | `home-care-crm-dev` (חדש, Free, נתונים סינתטיים) |
| `development` | `backend` | `dev` | `backend/Dockerfile.railway` | `/healthz` | `home-care-crm-dev` |
| `production` | `frontend` | `main` | `Dockerfile.web` | `/` | `home-care-crm` (`qqeupktyadjxqoxkstnl`) |
| `production` | `backend` | `main` | `backend/Dockerfile.railway` | `/healthz` | `home-care-crm` (`qqeupktyadjxqoxkstnl`) |

- **שירות התחזית בתוך ה-backend:** `deploy/start-backend.sh` מריץ אותו על `127.0.0.1:8000` בלולאת הפעלה מחדש (קריסה שלו לא מפילה את ה-backend), ואת ה-backend כתהליך הראשי על `$PORT`. `tini -g` מעביר SIGTERM לכל התהליכים. `DISABLE_TRAINING=1` קבוע בתמונה.
- **הדפדפן לא פונה לשירות התחזית ישירות:** `PREDICTIVE_SERVICE_URL` שווה ל-`BACKEND_URL`, וה-backend חושף את המסלולים `POST /predict/{risk-assessment,medical-warning,vitals-forecast,baseline,capacity}` ו-`POST /plan/generate-visits` (`backend/app/predict_proxy.py`). כל אחד דורש JWT; `capacity` ו-`plan/generate-visits` למנהל בלבד; ארבעת מסלולי המטופל דורשים גם `X-Patient-Id` של מטופל שגלוי למשתמש לפי RLS (אחות משויכת או מנהל). הגוף מועבר כמו שהוא (אין שינוי בנוסחאות), עד 64KB. `/train/*` לא מנותב. `GET /predict/health` מחזיר רק `ok`/`unavailable`.
- **תקלה בשירות התחזית לא חוסמת תיעוד:** השלמת ביקור ושמירת מדידה לא קוראות לשירות התחזית. הערכת סיכון היא קריאה נפרדת שמחזירה 503 `predictive_unavailable` והדוח נשאר שמור (נבדק ב-`backend/tests/test_predict_proxy.py`, ב-`tests/e2e/risk-server-side.spec.js` וב-`deploy/container-smoke.sh`).
- **אין קבצים מקומיים חשובים בקונטיינר:** מסמכים נשמרים ב-Supabase Storage (`patient-documents`); הכתיבה היחידה לדיסק (`ml_targets.py`, קבצי מודל) שייכת לאימון, שכבוי.
- **אין מיגרציות אוטומטיות:** שום build או הפעלה לא מריצים מיגרציה, seed או reset.

## משתני סביבה (שמות מאומתים בקוד; ערכים נכנסים ב-Railway בלבד, לא בריפו ולא בצ'אט)

| שירות | משתנה | סוג | development | production |
|---|---|---|---|---|
| backend | `SUPABASE_URL` | ציבורי | כתובת `home-care-crm-dev` | `https://qqeupktyadjxqoxkstnl.supabase.co` |
| backend | `SUPABASE_ANON_KEY` | ציבורי (publishable בלבד) | של dev | של prod |
| backend | `ALLOWED_ORIGINS` | הגדרה | כתובת ה-frontend של dev בדיוק | כתובת ה-frontend של prod בדיוק |
| backend | `RISK_ATTESTATION_SECRET` | **סוד** | ערך אקראי חדש, זהה ל-`server_secrets` ב-dev | ערך אקראי חדש (החלפה), זהה ל-`server_secrets` ב-prod |
| backend | `PREDICTIVE_TIMEOUT_SECONDS` | אופציונלי | 5 | 5 |
| backend | `RAILWAY_DOCKERFILE_PATH` | הגדרה | `backend/Dockerfile.railway` | אותו דבר |
| frontend | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BACKEND_URL` | ציבורי (בזמן build) | של dev | של prod |
| frontend | `APP_ENV` | הגדרה | `development` (באנר "סביבת בדיקות") | `production` |
| frontend | `RAILWAY_DOCKERFILE_PATH` | הגדרה | `Dockerfile.web` | אותו דבר |
| Edge Function `create-staff-login` | `ALLOWED_ORIGINS` | סוד פונקציה ב-Supabase | כתובת ה-frontend של dev | כתובת ה-frontend של prod |

`PREDICTIVE_SERVICE_URL` ו-`DISABLE_TRAINING` קבועים בתמונה ואינם משתני בעלים. `make_release.py` דוחה: מפתח סודי, כתובת שאינה https, localhost או כתובת `*.railway.internal`, ו-`APP_ENV` לא מוכר.

**הזנת הסוד בלי להציג אותו:** `openssl rand -hex 32 | pbcopy` ← הדבקה בלשונית Variables של שירות ה-backend (בסביבה הנכונה) ← אותו ערך נכתב ל-`server_secrets` במסד של אותה סביבה בפקודת SQL מאושרת. לא מדפיסים, לא מצלמים ולא שומרים בקובץ. כל סביבה מקבלת ערך משלה.

**בידוד:** סביבת production נוצרת **ריקה** (לא העתקה של development) והמשתנים מוזנים מחדש. אחרי יצירה: `railway variables --environment <env> --service <svc> --kv` ובדיקה שאין בסביבה אחת אף כתובת או מפתח של השנייה.

## מיגרציות לפי סביבה

סטטוס הריפו (2026-11-13): 25 קבצים ב-`supabase/migrations/`, כולל **019** (`20261107130647_staff_access_active_relationship.sql`) ו-**020** (`20261107131226_patient_measurements.sql`), שנרשמו כמוחלות על `qqeupktyadjxqoxkstnl` ב-2026-11-07 (ר' `supabase/proposed/APPLIED.md`). הקבצים זהים להצעות למעט שורת הכותרת. **המצב החי עצמו יאומת בקריאה בלבד (`supabase migration list --linked`) לפני כל החלה, באישור.**

**תלויות 019/020:** 019 מחליפה רק את `is_my_patient` (גישת צוות רק עם קשר טיפולי פעיל: לא הזמנה מבוטלת או נדחית). 020 יוצרת את `patient_measurements` (append-only; `booking_id` אופציונלי וחייב להיות הזמנה של אותו מטופל; כתיבה רק למנהל או לאחות משויכת לפי `is_my_patient`). 020 תלויה ב-019 (מאוחר יותר) וב-`_is_jwt_admin` (007). אף אחת מ-008–018/021 לא מגדירה מחדש את `is_my_patient` ולא נוגעת ב-`patient_measurements`, ולכן הסדר "019, 020 ואז 008–018, 021" תקין. זה בדיוק הסדר שבודק `backend/scripts/verify_proposed_sql.py` (מיגרציות ואז ההצעות; עבר ב-2026-11-13) וגם `backend/tests_db` (223 עברו ב-2026-11-13).

| דרישה בבדיקת הקבלה | מה הקוד צריך | dev (`home-care-crm-dev`, ריק) | prod (`qqeupktyadjxqoxkstnl`) |
|---|---|---|---|
| מדידות חוזרות, בנפרד או מקושרות לביקור | 020 (+019) | יוחלו עם כל `supabase/migrations` | **רשומות כמוחלות** (לאמת בקריאה) |
| גישת אחות למטופלים משויכים בלבד | 019 | כנ"ל | **רשומה כמוחלת** (לאמת) |
| שלמות דוח, הגנה על דוח חתום, תיקון רק ע"י המחבר | 008, 012, 016, 017 | 008–013, 015–018, 021 לפי הסדר | **לא הוחלו** — נדרשות |
| מניעת התנגשות הזמנות בעדכון | 010 | כנ"ל | **לא הוחלה** — נדרשת |
| השבתת צוות במקום מחיקה, ארכיון/ביטול רשומות, חסימת מחיקה פיזית, יומן ביקורת | 009, 013, 015, 018 | כנ"ל | **לא הוחלו** — נדרשות |
| סטטוס סיכון תמיד גלוי | 011 | כנ"ל | **לא הוחלה** — נדרשת |
| השהיית שירות (זמינות) | 021 (ה-backend מתנהג כ"הכול זמין" אם הטבלה חסרה) | כנ"ל | **לא הוחלה** — נדרשת |

**dev:** מסד חדש וריק — מחילים את 25 הקבצים שב-`supabase/migrations/` ואחריהם 008, 009, 010, 011, 012, 013, 015, 016, 017, 018, 021 (014 שמורה). אחר כך `server_secrets`, bucket `patient-documents`, ומשתמשים סינתטיים בלבד.

**prod:** לפני כל דבר: גיבוי `supabase db dump` (סכמה ונתונים) מחוץ לריפו + ספירת שורות, ובדיקה בקריאה בלבד שהרשומות הקיימות עומדות באילוצים החדשים. אחר כך 008, 009, 010, 011, 012, 013, 015, 016, 017, 018, 021 **אחת-אחת**, כל אחת באישור, עם post-flight מ-`docs/STAGING_PLAN.md` ו-advisors; רק אחרי הצלחה הקובץ עובר ל-`supabase/migrations/` בשם הגרסה הרשומה ומעדכנים את `docs/MIGRATION_LEDGER.md`. **שחזור:** בלוק ה-ROLLBACK של כל קובץ מתאים רק לפני שנכתבו רשומות חדשות; אחרי זה ההחלטה היא שחזור מהגיבוי, לא "drop". rollback של האפליקציה לא מחזיר שינויי מסד.

## עלות משוערת (Railway Hobby)

תמחור Railway: מנוי 5$ לחודש שכולל 5$ שימוש; RAM 10$ ל-GB לחודש, vCPU 20$ לחודש, תעבורה יוצאת 0.05$ ל-GB.

| רכיב | הנחה | $ לחודש |
|---|---|---|
| backend prod (כולל תחזית) | כ-0.35GB RAM, כ-0.02 vCPU ממוצע | כ-3.9 |
| frontend prod (Caddy) | כ-0.03GB | כ-0.3 |
| dev (שני השירותים) | Serverless (נרדם כשאין שימוש), כ-30% מהזמן | כ-1.3 |
| תעבורה | פחות מ-5GB | פחות מ-0.25 |
| **סה"כ שימוש** | | **כ-6$** ← חשבון כ-**6–8$ לחודש** (המנוי + מה שמעל ה-5$ הכלולים) |
| Supabase | שני הפרויקטים ב-Free | 0$ (פרויקט Free נרדם אחרי 7 ימים בלי שימוש; מעירים מהדשבורד) |

סיכונים: חישובי ARIMA כבדים או תעבורה גבוהה מעלים CPU. **בקרת הוצאות:** Soft limit של 10$ = אימייל בלבד, השירותים ממשיכים. Hard limit של 15$ = **השירותים יורדים** עד המחזור הבא או עד הגדלת התקרה (מינימום 10$).

## זרימת עבודה

ענף עבודה ← PR ל-`dev` ← development נפרס מ-`dev` ← בדיקה בכתובת dev ← PR מ-`dev` ל-`main` ← production. בתחילת הדרך production **ללא פריסה אוטומטית** (Deploy ידני של commit מאושר); אחרי האימות הראשון נחליט אם להפעיל פריסה אחרי מיזוג עם "Wait for CI". לא force-push לענפים משותפים. בכל שינוי בקבצי הקליינט: להעלות `CACHE_VERSION` ב-`public/service-worker.js` ו-`APP_BUILD` ב-`public/config.js`.

## שלבים

### שלב A — הכנה (הושלם בענף `deploy/railway`)
- [x] `backend/Dockerfile.railway`, `deploy/start-backend.sh`, `Dockerfile.web`, `.dockerignore`.
- [x] `make_release.py` מייצר `dist/Caddyfile` מ-`public/_headers` (CSP, HSTS, nosniff, frame DENY, noindex, `service-worker.js` ב-no-cache, 404, בלי רשימת תיקיות) ו-`APP_ENV`.
- [x] מסלולי תחזית מאומתים ב-backend, כותרות `Authorization`/`X-Patient-Id` מה-fetch wrapper ב-`public/app.js`.
- [x] `create-staff-login`: מקורות מ-`ALLOWED_ORIGINS` (סוד פונקציה) בנוסף ל-localhost.
- [x] CI job `containers` (`deploy/container-smoke.sh`): שני התהליכים עולים תוך 60 שניות, בריאות, 401 בלי טוקן, `/train` 404, האזנה פרטית של התחזית, CORS, קריסת התחזית לא מפילה את ה-backend והיא עולה שוב תוך 15 שניות, כיבוי נקי תוך פחות מ-10 שניות, כותרות האתר.

### שלב B — development (אחרי אישור מרוכז)
1. הבעלים: חשבון Railway (Hobby), `brew install railway`, `railway login`.
2. Supabase: יצירת `home-care-crm-dev` (Free, eu-central-1) והחלה לפי הטבלה למעלה; Auth Site URL ו-Redirect URLs לכתובת ה-frontend של dev; `supabase secrets set ALLOWED_ORIGINS=...` ופריסת `create-staff-login` לפרויקט dev בלבד.
3. Railway: פרויקט `home-care-crm`, סביבה `development`, שירותים `backend` ו-`frontend` מהריפו, **ענף `dev` לכל שירות** (לאמת ב-`railway status --json`), המשתנים, Healthcheck, דומיין ציבורי, Serverless.
4. פריסה: backend קודם, אחר כך frontend (צריך את `BACKEND_URL`). לפני כל פעולה מרוחקת: לציין `--project`, `--environment` ו-`--service` במפורש ולבדוק את ה-ref של Supabase.
5. בדיקות קבלה בכתובת dev (סעיף למטה).

### שלב C — production (אישור נפרד אחרי קבלת dev)
1. גיבוי ומיגרציות prod לפי הטבלה; החלפת `RISK_ATTESTATION_SECRET`; Auth URLs; `create-staff-login` עם `ALLOWED_ORIGINS`.
2. סביבת `production` ריקה, ענף `main` לכל שירות, משתנים חדשים, בדיקת בידוד, פריסה ידנית של commit מאושר. רישום ה-SHA של frontend ושל backend.
3. בדיקה עם חשבונות סינתטיים ייעודיים בלבד. **לא** reset, seed או ניקוי מול prod.

### מעבר בלי לאבד טיוטות
טיוטות לא מסונכרנות נשמרות ב-`localStorage` לפי מקור (כתובת). טיוטה שנשמרה ב-`localhost` **לא** תופיע בכתובת החדשה. לפני המעבר: לפתוח את דף הצוות המקומי ולוודא שאין טיוטות ממתינות לסנכרון; אם יש, לסנכרן אותן מקומית מול המסד הנכון. אין לנקות מטמון או אחסון של האתר המקומי לפני זה.

## בדיקות קבלה (מסומנות: ממוקק / מבודד / סביבה ציבורית)
- **מטופל:** בחירת שירות ← בקשת הזמנה ← "ממתין לאישור" ← רואה רק את ההזמנות שלו ← ביטול.
- **מנהל:** התחברות ← אישור ושיוך ← התנגשות נדחית ← השהיית שירות מכובדת.
- **צוות:** רואה רק מטופלים משויכים ← check-in ← מדידות חוזרות (בנפרד ומקושרות לביקור) ← השלמת ביקור, הדוח נשאר אחרי רענון ← דוח חתום נעול.
- **אמינות:** שמירה שנכשלה לא מציגה הצלחה; ניסיון חוזר לא יוצר כפילות; תחזית למטה לא חוסמת שמירה; טיוטה לא מקוונת מסתנכרנת.
- **אבטחה:** HTTPS, כותרות, CORS (מקור זר נדחה), מסלולי תחזית 401 בלי טוקן, אין כתובות dev או localhost ב-prod, נתוני dev לא מגיעים ל-prod.

## שחזור (rollback)
- **אפליקציה:** ב-Railway, Deployments ← הפריסה הקודמת ← Redeploy. רושמים איזה SHA רץ בכל שירות.
- **מסד:** ר' "מיגרציות לפי סביבה" למעלה. גיבוי לפני כל שינוי; rollback של האפליקציה לא מחזיר את המסד.
- **חריגת תקציב:** Hard limit מוריד שירותים; מעלים את התקרה או מחכים למחזור הבא, ואם שירות לא חוזר: Redeploy.

## סימון הדגמה
- [x] באנר "מערכת הדגמה — נתונים סינתטיים בלבד" (`DEMO_MODE`), ובנוסף "סביבת בדיקות (DEVELOPMENT)" כש-`APP_ENV=development`.
- [x] `public/demo-notice.html`, `robots.txt` ו-`X-Robots-Tag: noindex`.
- [x] רכיב הסיכון מתויג: "הערכת סיכון מבוססת כללים — הדגמה בלבד".

## מה נשאר לשירות אמיתי
1. **משפטי:** מדיניות פרטיות, תנאי שימוש, הסכמה מדעת, רישום מאגר ואחראי הגנת פרטיות (חוק הגנת הפרטיות, תיקון 13, ותקנות אבטחת מידע). נדרש ייעוץ משפטי.
2. **קליני:** כללים בלבד, לא מכשיר רפואי מאושר.
3. **זהות:** ספק SMS (הממשק בנוי, כבוי ב-`SMS_LOGIN_ENABLED`), MFA למנהל ולצוות, אימות אימייל.
4. **תפעול:** ניטור והתראות, בדיקת שחזור מגיבוי, תהליך תגובה לאירוע אבטחה; Supabase בתוכנית בתשלום לגיבויים יומיים.
5. **בדיקות:** בדיקת חדירה חיצונית, נגישות (WCAG 2.2 AA), ניסוי עם משתמשים אמיתיים.
6. **תוכן:** שם עסק, פרטי קשר אמיתיים, תמונות מורשות.
