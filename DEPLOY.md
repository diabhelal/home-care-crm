# פריסה ל-Railway — פיתוח (dev) וייצור (main)

> **סטטוס (2026-11-17): פרוס.** Production: https://frontend-production-0440d7b9.up.railway.app (backend https://backend-production-e1ac9b22.up.railway.app), `main` (frontend `62e1ba7`, backend `07570cc` מ-2026-11-22), מסד `qqeupktyadjxqoxkstnl` (37 מיגרציות). Development: https://frontend-development-673a40e7.up.railway.app, `dev`, מסד `home-care-crm-dev` (`byzukgywqllqvetzadxy`, 37 מיגרציות, נתונים סינתטיים). Railway על תוכנית Trial (קרדיט חד-פעמי; השירותים נעצרים כשהוא נגמר — שדרוג ל-Hobby ‏$5/חודש מחזיר אותם). **הפריסה לא מאשרת שימוש במטופלים אמיתיים** (באנר ההדגמה נשאר). פירוט: "מצב הפריסה" בסוף המסמך.

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
| שלמות דוח, הגנה על דוח חתום, תיקון רק ע"י המחבר | 008, 012, 016, 017 | 008–013, 015–018, 021, 022 לפי הסדר | **הוחלו 2026-11-17** |
| מניעת התנגשות הזמנות בעדכון | 010 | כנ"ל | **הוחלה 2026-11-17** |
| השבתת צוות במקום מחיקה, ארכיון/ביטול רשומות, חסימת מחיקה פיזית, יומן ביקורת | 009, 013, 015, 018 | כנ"ל | **הוחלו 2026-11-17** |
| סטטוס סיכון תמיד גלוי | 011 | כנ"ל | **הוחלה 2026-11-17** |
| השהיית שירות (זמינות) | 021 (ה-backend מתנהג כ"הכול זמין" אם הטבלה חסרה) | כנ"ל | **הוחלה 2026-11-17** |
| הרשאות מצומצמות: אין מחיקה/TRUNCATE ב-`service_availability`, אין ל-`anon` גישה ל-`risk_predictions` | 022 (רק שלילת הרשאות) | כנ"ל | **הוחלה 2026-11-17** |

**dev:** מסד חדש וריק — מחילים את 25 הקבצים שב-`supabase/migrations/` ואחריהם 008, 009, 010, 011, 012, 013, 015, 016, 017, 018, 021, 022 (014 שמורה). **בוצע ב-2026-11-16** על `byzukgywqllqvetzadxy`. לקח: ב-Supabase אמיתי הרשאות ברירת המחדל של `public` נותנות ל-`anon`/`authenticated` הכול על כל טבלה חדשה, ולכן קובץ שרק מעניק בלי לשלול קודם משאיר הרשאות עודפות; `backend/tests_db/bootstrap.sql` מדמה זאת מאז, ו-022 סוגרת את שני המקרים שנמצאו. אחר כך `server_secrets`, bucket `patient-documents`, ומשתמשים סינתטיים בלבד.

**prod:** לפני כל דבר: גיבוי `supabase db dump` (סכמה ונתונים) מחוץ לריפו + ספירת שורות, ובדיקה בקריאה בלבד שהרשומות הקיימות עומדות באילוצים החדשים. אחר כך 008, 009, 010, 011, 012, 013, 015, 016, 017, 018, 021, 022 **אחת-אחת**, כל אחת באישור, עם post-flight מ-`docs/STAGING_PLAN.md` ו-advisors; רק אחרי הצלחה הקובץ עובר ל-`supabase/migrations/` בשם הגרסה הרשומה ומעדכנים את `docs/MIGRATION_LEDGER.md`. **שחזור:** בלוק ה-ROLLBACK של כל קובץ מתאים רק לפני שנכתבו רשומות חדשות; אחרי זה ההחלטה היא שחזור מהגיבוי, לא "drop". rollback של האפליקציה לא מחזיר שינויי מסד.

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


## מצב הפריסה (2026-11-17)

| סביבה | כתובת | קוד | מסד | הערות |
|---|---|---|---|---|
| production | https://frontend-production-0440d7b9.up.railway.app | `main`: frontend `62e1ba7`, backend `07570cc` | `qqeupktyadjxqoxkstnl` | דלוק תמיד (בלי שינה), אירופה (`europe-west4`), backend https://backend-production-e1ac9b22.up.railway.app |
| development | https://frontend-development-673a40e7.up.railway.app | `dev`: frontend `622fde0`, backend `fac48da` | `byzukgywqllqvetzadxy` | שינה כשאין שימוש; באנר "סביבת בדיקות"; נתונים סינתטיים בלבד |

- **איך נפרס:** `railway up` מייצוא נקי של הקומיט (`git archive`), לכל שירות בנפרד עם `--environment` ו-`--service` מפורשים. **אין חיבור GitHub ב-Railway** (אין `source`, אין repo triggers), ולכן מיזוג ל-`main`/`dev` לא פורס כלום. לפריסה אוטומטית: לאשר את Railway GitHub App על הריפו ואז `railway service source connect` (production: לבחור "Wait for CI").
- **פריסה חדשה (ידנית):** `git archive origin/main | tar -x -C <dir>` ← `cd <dir>` ← `railway up --ci --environment production --service backend` ואז `--service frontend`. לבדיקת עלות: `railway usage`.
- **עדכוני תלויות (2026-11-18):** Dependabot ‏#72, ‏#74, ‏#75, ‏#76 (fastapi 0.162.2 ב-backend, typing-inspection, psycopg-binary לבדיקות, Playwright 1.65) שולבו דרך #85 ל-`dev` ו-#86 ל-`main`: CI ירוק, backend 254/254, tests_db 234/234, JS 88/88, זרימה סינתטית ב-Development ‏26/26; נפרס רק ה-backend (ה-frontend לא מושפע). ב-production נבדקו health, דפים, CORS ו-401 בלי התחברות (בלי שינוי נתונים). **#73 ו-#77 נשארו פתוחים:** הם משנים את `predictive-service/requirements*.txt`, שרשומים ב-`docs/MODEL_PRESERVATION_BASELINE.json`, ולכן דורשים החלטת בעלים.
- **עדכוני תלויות (2026-11-22):** Dependabot ‏#89, ‏#91–#94 (Playwright 1.65.1, psycopg-binary 3.3.9 לבדיקות, tzdata 2026.6, websockets 17.4, anyio 4.16.0) שולבו דרך #97 ל-`dev` ו-#98 ל-`main`: CI ירוק (16/16), backend 254/254, שני קובצי ה-lock הותקנו נקי. נפרס רק ה-backend (Development `fac48da`, Production `07570cc`); נבדקו `/healthz` 200, `/readyz` 200, `/availability` 401 והאתר 200. **#90 (pydantic-core 2.50.4) נשאר פתוח:** הבנייה נכשלת כי pydantic 2.14.1 מחייב pydantic-core==2.50.1; דורש עדכון pydantic יחד איתו.
- **טיוטת סיכום AI (FR-AI-02, 2026-11-22):** מופעלת **רק ב-Development**. ב-backend של development הוגדרו `AI_SUMMARY_ENABLED=true` ו-`OPENAI_API_KEY` (משתני Railway, לא ב-git). ב-production אין מפתח ואין דגל, ולכן `/features` מחזיר `ai_summary: false` והכפתור מוסתר. הפעלה ב-production היא החלטה פתוחה (O-12).
- **מיגרציות:** 008–013, 015–018, 021, 022 הוחלו על production ב-2026-11-17, אחת-אחת (`supabase db push` של קובץ אחד בכל פעם), גרסאות `20261117200001`–`20261117200012`; לפני כן גיבוי מלא (`~/Documents/home-care-crm-archive/db-backup-2026-11-17/`, נבדק בשחזור מקומי + חזרה על כל 12 המיגרציות על עותק הנתונים: 26/26 post-flight, אפס שורות שהשתנו). אחרי ההחלה: 26/26 post-flight על production; ספירות השורות זהות לפני ואחרי. ב-dev סומנו אותן גרסאות כ-applied (`migration repair`), ולכן שתי הסביבות עם אותה היסטוריה (37).
- **סודות:** `RISK_ATTESTATION_SECRET` הוחלף ב-production (ערך חדש, שונה מ-dev), נשמר רק ב-Keychain של הבעלים, ב-`server_secrets` וב-Railway. ה-backend המקומי הישן עם הערך הקודם לא יכול עוד לרשום הערכות סיכון ל-production.
- **Auth production:** Site URL = כתובת ה-production; כתובות ה-localhost הקיימות נשארו ברשימת ההפניות. `create-staff-login` נפרס מחדש עם `ALLOWED_ORIGINS` = כתובת ה-production. התחברות אורח (anonymous) דלוקה.
- **חשבונות:** המנהל = החשבון הקיים של הבעלים. חשבונות QA (`admin.qa@example.test`, `nurse.qa@example.test`) שימשו לבדיקת הקבלה ואז **נחסמו להתחברות**; "אחות QA (סינתטי)" **הושבתה**. רשומות ה-QA (אורח, ביקור שהושלם, הזמנה שבוטלה, 3 מדידות) נשארות ומסומנות "QA (סינתטי)" — המערכת חוסמת מחיקה בכוונה.
- **בדיקות קבלה על production:** אבטחה 21/21 (כותרות, CSP, CORS כולל דחיית כתובת ה-dev, 401/404, HTTPS); זרימה מלאה 28/28 (הזמנת אורח, אי-כפילות, אישור ושיבוץ, צ'ק-אין, מדידות חוזרות ובודדת, תיעוד והשלמה, הערכת סיכון, שמירה אחרי רענון, דוח חתום נעול, אין מחיקה, תוצאת 8 שעות פעם אחת, חסימת גישה לא מורשית, ביטול); דפדפן אמיתי 8/8.
- **ידוע/פתוח:** מייל הזמנה לעובדים דרך השירות המובנה של Supabase מוגבל (רק לחברי הצוות בפרויקט, מעט בשעה) — לפני הזמנת עובדים אמיתיים לחבר SMTP. אין במסך יצירת מנהל נוסף. ה-Advisor של Supabase: אזהרות בלבד (anonymous sign-ins, MFA, leaked-password protection), בלי שגיאות. הכותרת `Server: railway-hikari` היא של Railway עצמו.
- **החזרה לאחור:** אתר — Railway → השירות → Deployments → Redeploy לפריסה הקודמת, או פריסה ידנית של commit קודם. מסד — לפני שנכתבו רשומות חדשות: בלוקי ה-ROLLBACK ב-`docs/STAGING_PLAN.md` בסדר הפוך; אחרי: שחזור מהגיבוי (פעולה הרסנית — באישור נפרד).
