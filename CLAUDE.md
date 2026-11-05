# home-care-crm

CRM לחברת שירותי טיפול רפואי וביקורי בית. מטופל מתחבר, בוחר איש/אשת צוות רפואי, בוחר מטרת ביקור, ובוחר תאריך/שעה מתוך הזמנים הפנויים של איש הצוות. צוות (מנהל/אחות/רופא) מתעד ביקורים, מדדים וסיכון קליני; מנוע Python מקומי מחשב תחזיות מבוססות-כללים.

ראה [README.md](./README.md) למסמך המלא (ארכיטקטורה, סכמה, אבטחה) — זה קובץ אוריינטציה תמציתי. [PLAN.md](./PLAN.md) הוא היסטורי (MVP המקורי, הושלם).

## Stack
- **DB/Auth/API**: Supabase (Postgres + Auth + Data API + RLS). פרויקט: `home-care-crm`, ref `qqeupktyadjxqoxkstnl`, region `eu-central-1`.
- **Frontend**: HTML + CSS סטטיים, JS מינימלי (`supabase-js` מ-CDN, ללא build step, ללא framework). `public/js/admin/*.js` — חלק מ-`admin.html` שפוצל לקבצים, נטענים כ-`<script>` קלאסי לפני admin.html עצמו (חולקים scope עליון, לא ES modules — סדר טעינה קריטי).
- **שירות תחזית**: Python/FastAPI מקומי בלבד (`predictive-service/`), לא רץ תמיד — מופעל ידנית (`uvicorn main:app --port 8000`). כללים קליניים כתובים ביד (thresholds/regression/ARIMA), לא ML מאומן. יש באנר זמינות בכל עמוד (`checkPredictiveServiceHealth`, app.js) שמתריע אם השירות כבוי.
- **Edge Function**: `create-staff-login` (Supabase, Deno) — הרכיב היחיד עם service_role key בזמן ריצה, יוצר כניסת Auth לאיש צוות.
- **עיצוב**: מערכת עיצוב אחידה ב-`public/styles.css` (טוקני צבע CSS custom properties, 44px touch targets, RTL).

## מודל זהות: הזמנה כמו טיסה/אוכל, בלי הרשמה (למטופל)
המטופל גולש חופשי בלי פרטים, וממלא שם/טלפון/כתובת רק בשלב אישור ההזמנה (`booking.html`). מאחורי הקלעים: `ensureGuestSession()` (`app.js`) יוצר session אנונימי שקוף (`signInAnonymously()`) — נותן `auth.uid()` אמיתי מהרגע הראשון, ה-RLS עובד ללא שינוי. הזהות היא per-browser; יש תשתית אופציונלית לקישור טלפון+OTP לגישה חוצת-מכשירים (`my-bookings.html`) אך היא לא פעילה — אין ספק SMS מוגדר (`[auth.sms] enable_signup = false`). ממשק הטלפון+SMS קיים ב-`renderAccountCard` (`public/i18n.js`) ומוסתר ע"י `SMS_LOGIN_ENABLED=false` ב-`config.js`.

⚠️ `supabase config push` דוחף את **כל** מקטע ה-`[auth]` מ-config.toml המקומי, לא רק שדה בודד — ר' PLAN.md להיסטוריה.

## שני תפקידים אמיתיים: מנהל וצוות
- **מנהל** (`admin.html`): התחברות אימייל+סיסמה, `app_metadata.is_admin = true` (רק דרך Admin API). מדיניות `admin_full_access_*` נותנות גישה מלאה לכל הטבלאות.
- **צוות/אחות** (`employee.html` + `employee-login.html`): כניסה אמיתית משלו (`medical_staff.auth_user_id`), מוגבל ע"י RLS למטופלים המשויכים אליו/ה בלבד (`current_staff_id()`/`is_my_patient()` — פונקציות `SECURITY DEFINER`, גישה רק ל-`authenticated`).

## סכמה: 16 טבלאות + view (public schema)
ליבת ההזמנות: `patients`, `medical_staff`, `bookings` (`workflow_status` נפרד מ-`status`; partial unique index על `(staff_id, scheduled_at) where status<>'cancelled'` — מונע הזמנה כפולה אבל מאפשר להזמין מחדש תור שבוטל).
תיק מטופל רפואי: `visit_reports`, `risk_predictions` (+ view `current_patient_risk`, `security_invoker=true`), `patient_allergies`, `patient_medical_history`, `clinical_notes`, `medication_events`, `service_plans`, `service_plan_visits`, `patient_documents`, `patient_contacts`, `alerts`, `tasks`, `audit_log` (append-only, נכתב רק ע"י trigger).

כל הטבלאות: RLS מופעל, `anon` ללא שום גישה, `authenticated` מקבל רק את ההרשאות שכל migration מתעדת (ר' תקרית ב-2026-09-25: migration אחת שכחה `revoke` לפני `grant` והשאירה הרשאות פתוחות מדי על 11 טבלאות — תוקן).

## Supabase CLI workflow (חשוב!)
- הפרויקט **מקושר** (`supabase link`). אין Docker בסביבה זו — עובדים ישירות מול ה-DB המרוחק.
- שינויי סכמה: `execute_sql` (MCP) לאיטרציה → `get_advisors` (security+performance) לפני ולאחרי → `apply_migration` (MCP, גם מריץ וגם רושם ב-`supabase_migrations.schema_migrations`) → קובץ migration מקומי **עם אותו שם-גרסה בדיוק** שה-MCP רשם (לא `supabase migration new`'s timestamp משלו — הם לא זהים).
- `supabase migration repair`/`migration list` (ה-CLI עצמו) לא זמינים בסביבה זו — נתקעים (בעיית רשת לחיבור Postgres ישיר, לא סיסמה). לאמת סנכרון ישירות מול `supabase_migrations.schema_migrations` via `execute_sql`.

## דאטה סינתטי
מטופלים/צוות/הזמנות עם משתמשי `auth.users` אמיתיים (נוצרו דרך Admin API). סיסמאות אמיתיות (מנהל/צוות) נמסרות רק בצ'אט — לעולם לא בקובץ.

## הרצה מקומית
```
cd public && python3 -m http.server 8080          # frontend
cd predictive-service && source .venv/bin/activate && uvicorn main:app --reload --port 8000   # תחזית (אופציונלי)
```

## טסטים / CI
CI (`.github/workflows/ci.yml`) מריץ על כל push: סריקת סודות על כל ההיסטוריה, `node --test tests/unit/*.test.js`, `pytest` של `predictive-service/`, `pytest` של `backend/` (כולל `backend/tests_db` על Postgres חד-פעמי, ה-job `backend-tests`), ו-16 קבצי Playwright ממוקקים (בלי DB חי). `booking.spec.js`/`visit-report.spec.js` נוגעים ב-DB חי, `workflow_dispatch` בלבד, לא הורצו (דורש פרויקט Supabase ייעודי לבדיקות שעדיין לא קיים) ואסור להריצם מול הפרויקט החי.

## הוראה קבועה: ענף ו-PR לכל פיצ'ר (הוראת הבעלים, 2026-10-30; מחליפה את ההוראה מ-2026-10-17 על push ישיר ל-main)
כל פיצ'ר או תיקון מפותח **בענף נפרד** (`feature/<שם>`), גם בעבודה לבד. בסיום, אחרי בדיקות מתאימות (`node --test tests/unit/*.test.js`, Playwright הממוקק, `pytest` לפי מה שנגע): commit, `git push -u origin <branch>`, ופתיחת **Pull Request אל `main`** (`gh pr create`) עם תיאור: מה השתנה, בדיקות ותוצאותיהן, מיגרציות שלא הוחלו. אימות: `gh pr view` ו-CI ירוק על ה-PR.
- **אסור:** push ישיר ל-`main`, מיזוג ה-PR (הבעלים ממזג אלא אם אמר אחרת במפורש), force-push, שכתוב היסטוריה, שינוי נראות הריפו, שינויי DB/מיגרציות על הפרויקט החי, פריסה, והעלאת סודות (ה-hook ב-`.githooks/pre-commit` נשאר; לא עוקפים עם `--no-verify`).
- אם בדיקות או push נכשלים - דווח במפורש והמשימה **לא** הושלמה.
- טיוטות מקומיות (`docs/design-preview.html`, `docs/hero-options.html`) ותיקיות כלים שאינן שלנו (`.agents/`, `.codex/`) נשארות מחוץ ל-commit.

## הוראה קבועה: תיעוד הוא חלק מהפיתוח (הוראת הבעלים, 2026-11-05)
בכל שינוי משמעותי בקוד, ב-SQL, בבדיקות או בהתנהגות, **באותו ענף ובאותו PR**:
1. לבדוק את ההשפעה על `README.md` ועל המסמכים הטכניים הרלוונטיים (`docs/`, `backend/README.md`, `tests/e2e/README.md`, `HANDOFF.md`).
2. לעדכן את מה שהושפע: תיאור יכולות, דיאגרמת הארכיטקטורה, פקודות והרצה, מספרי בדיקות (רק מספרים שנמדדו בפועל, עם תאריך ו-commit), טבלת הסטטוס.
3. להפריד תמיד בין **מה שמוזג ל-`main`** לבין PR פתוח, SQL מוצע שלא הוחל, ותכנון. אסור לתאר מיגרציה מוצעת כמוחלת, או ניסוי כחיזוי מאומת קלינית. אין לטעון עמידה בתקנים (HIPAA וכד'), "מוכן לייצור" או תוקף קליני בלי ראיה.
4. **לעדכן גם את הדרישה וקריטריוני הקבלה הרלוונטיים ב-`docs/SPECIFICATION.md`** (מזהה קבוע, סטטוס לפי מה שמומש ונבדק בלבד, הפניות לבדיקות ולמימוש); החלטה חדשה של הבעלים נרשמת שם בסעיף 11.
5. להריץ `python scripts/check_docs.py` (קישורים, עוגנים, נתיבים ותג ה-CI; רץ גם ב-CI).
6. **בדוח הסיום של כל משימה לציין במפורש:** "תיעוד עודכן: <אילו קבצים>" או "לא נדרש עדכון תיעוד כי <סיבה>". שינוי קטן (תיקון טעות, בדיקה בלבד) לא מחייב עריכת README, ולא עורכים README רק כדי לסמן וי.
בענף מסמכים נפרד אפשר לעדכן את `docs/REPO_STATUS.md` (מפת ענפים ו-PR); הוא המקור לסטטוס, וה-README מצביע עליו.

## הוראה קבועה: פיתוח מונחה-אפיון — Spec-Driven (הוראת הבעלים, 2026-11-05)
התהליך המלא ב-`docs/specs/README.md`; מקור הדרישות והסטטוס ב-`docs/SPECIFICATION.md`. בקצרה:
1. **שינוי משמעותי מתחיל באפיון פיצ'ר** (`docs/specs/NNN-שם/spec.md`, אחר כך `plan.md` ו-`tasks.md`) לפי התבניות ב-`docs/specs/_template/`. **שער 1: אין כתיבת קוד לשינוי כזה לפני שהבעלים אישר את האפיון.** מה נחשב משמעותי ומה פטור: ב-`docs/specs/README.md`.
2. **כל קריטריון קבלה ממופה לבדיקה**; כל PR מציין את מזהי הדרישות שהוא נוגע בהן (תבנית ה-PR ב-`.github/pull_request_template.md`).
3. **Claude לא בוחר מדיניות עסקית, קלינית, משפטית או מוצרית.** מדיניות שלא הוכרעה נרשמת כהחלטה פתוחה `O-nn` עם אפשרויות והמלצה, וממתינה לבעלים.
4. הסטטוס ב-`SPECIFICATION.md` משקף רק מה שמומש ונבדק; הצעת SQL שלא הוחלה נשארת "מתוכננת". מיזוג, פריסה ושינוי במסד החי: רק באישור מפורש.
5. פיצ'ר שפותח לפני התהליך מתועד בדיעבד ומסומן כך.

## מצב נוכחי (אוקטובר 2026) — קרא לפני עבודה
- **Backend תפעולי (Python/FastAPI) ב-`backend/`**: הזמנה, זמינות+מרווח נסיעה 30 דק', אישור/דחייה/שיבוץ/ביטול, check-in עם זמן שרת, השלמת ביקור אטומית, חיזוי סיכון והתראות. **הדפדפן לא כותב ישירות ל-`bookings`/`visit_reports`/`risk_predictions`/`alerts`** — הכול דרך `backendFetch` (`public/app.js`). **בלי ה-backend רץ אי אפשר להזמין** (הודעת כשל, בכוונה).
- **SQL שהוחל על הפרויקט ב-2026-10-15** (001–007: עמודות אישור/כתובת/check-in, פונקציות, טריגרי הגנה על `bookings`, כתיבת חיזוי/התראה בשרת עם HMAC, כפיית זהות כותב). רשום ב-`supabase/migrations/` וב-`supabase/proposed/APPLIED.md`. סוד האטסטציה נמצא בטבלה `server_secrets` (לא ב-git) ובערך `RISK_ATTESTATION_SECRET` ב-`backend/.env` (מחוץ ל-git; לקרוא מה-DB דרך SQL editor כשמשחזרים סביבה).
- **הרצה מקומית**: `cd public && python3 -m http.server 8080` ; `cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8001 --env-file .env` (צור `.env` מ-`backend/.env.example`) ; שירות התחזית (אופציונלי) `cd predictive-service && uvicorn main:app --port 8000`.
- **בדיקות**: `node --test tests/unit/*.test.js` ; `ls tests/e2e/*.spec.js | grep -vE "/(booking|visit-report)\.spec\.js$" | xargs npx playwright test` ; `cd backend && pytest -q --ignore=tests_db && pytest tests_db -q` (Postgres מקומי חד-פעמי, ללא Docker; `pip install -r requirements-dev.txt`).
- **אסור**: להריץ `tests/e2e/booking.spec.js`/`visit-report.spec.js` מול ה-DB החי; לשנות נוסחאות ב-`predictive-service/`; להחליש RLS; לשים סוד ב-git (ה-hook ב-`.githooks/pre-commit` חוסם; לא עוקפים).
- **Service Worker**: רשת-תחילה עם מטמון לאופליין; בכל שינוי בקבצי קליינט להעלות `CACHE_VERSION` ב-`public/service-worker.js` וגם `APP_BUILD` ב-`public/config.js` (מוצג בתחתית העמוד). אם דפדפן מגיש קבצים ישנים: `http://localhost:8080/reset.html`.
- **צוות**: אחים/אחיות בלבד; `SERVICE_CONFIG` ב-`public/config.js` קובע תפקידים ושירותים שמוצגים.
- **הערכת סיכון**: כללים קליניים + סטטיסטיקה קלאסית. **אין מודל ML מאומן.** מסומן "הדגמה" בממשק.
- **מצב מעקב עבודה**: `HANDOFF.md` (מצב והמשך), `docs/WORKPLAN.md`, `docs/STAGING_PLAN.md`, `docs/REVIEW.md`, `docs/DEMO.md`.
