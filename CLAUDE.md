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
המטופל גולש חופשי בלי פרטים, וממלא שם/טלפון/כתובת רק בשלב אישור ההזמנה (`booking.html`). מאחורי הקלעים: `ensureGuestSession()` (`app.js`) יוצר session אנונימי שקוף (`signInAnonymously()`) — נותן `auth.uid()` אמיתי מהרגע הראשון, ה-RLS עובד ללא שינוי. הזהות היא per-browser; יש תשתית אופציונלית לקישור טלפון+OTP לגישה חוצת-מכשירים (`my-bookings.html`) אך היא לא פעילה — אין ספק SMS מוגדר (`[auth.sms] enable_signup = false`).

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
`node --test tests/unit/*.test.js` (JS) + `pytest` (`predictive-service/`) רצים על כל push. Playwright ב-`tests/e2e/`: 3 ספקים ממוקקים (בלי DB חי) רצים אוטומטית; `booking.spec.js`/`visit-report.spec.js` נוגעים ב-DB חי, `workflow_dispatch` בלבד, לא אומתו בפועל (דורש פרויקט Supabase ייעודי לבדיקות שעדיין לא קיים).
