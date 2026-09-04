# home-care-crm

CRM לחברת שירותי טיפול רפואי וביקורי בית. מטופל מתחבר, בוחר איש/אשת צוות רפואי, בוחר מטרת ביקור, ובוחר תאריך/שעה מתוך הזמנים הפנויים של איש הצוות.

ראה [PLAN.md](./PLAN.md) לתוכנית העבודה המלאה והחלטות העיצוב.

## Stack
- **DB/Auth/API**: Supabase (Postgres + Auth + Data API). פרויקט: `home-care-crm`, ref `qqeupktyadjxqoxkstnl`, region `eu-central-1`.
- **Frontend**: HTML + CSS סטטיים, JS מינימלי (`supabase-js` מ-CDN, ללא build step).
- **עיצוב**: מבנה המסכים תוכנן ב-Stitch (project id `10674010542604110227`) לפני המימוש ב-HTML/CSS.

## מודל זהות: הזמנה כמו טיסה/אוכל, בלי הרשמה
אין מסך התחברות עם אימייל+סיסמה. הזרימה היא "הזמנה" בסגנון הזמנת טיסה/משלוח אוכל: המטופל גולש חופשי (רואה שירותים, בוחר איש צוות, תאריך ושעה) בלי שום פרטים, ורק בשלב אישור ההזמנה (בדף `booking.html`) ממלא שם/טלפון/כתובת — בדיוק כמו "פרטי הזמנה" בקופה.

מאחורי הקלעים: בכל טעינת עמוד (`ensureGuestSession()` ב-`app.js`) נוצר session אנונימי שקוף דרך `supabaseClient.auth.signInAnonymously()` (Supabase Auth "Anonymous Sign-ins", הופעל דרך `enable_anonymous_sign_ins = true` ב-`supabase/config.toml` ונדחף לפרויקט עם `supabase config push`). זה נותן `auth.uid()` אמיתי כבר מהרגע הראשון, כך שמדיניות ה-RLS הקיימות (predicate על `auth.uid()`) ממשיכות לעבוד בלי שינוי — גם למשתמש שלא "נרשם" בפועל. ⚠️ שים לב: `supabase config push` דוחף את **כל** מקטע ה-`[auth]` מ-config.toml המקומי (לא רק את השדה שרוצים לשנות) — זה שינה בפועל גם הגדרות MFA/אישור אימייל שהיו קיימות בפרויקט. ראה PLAN.md.

הזהות הזו היא per-browser (guest checkout) — אין דרך להיכנס לאותה היסטוריית הזמנות ממכשיר/דפדפן אחר. זה תואם את המודל המבוקש ולא נחשב באג.

## מבנה סכמה (public schema)
- `patients` — מטופלים. `id` = `auth.users.id` (1:1, כולל למשתמשים אנונימיים). נוצר/מתעדכן (`upsert`) רק בשלב אישור ההזמנה. RLS: כל מטופל רואה/עורך רק את עצמו.
- `medical_staff` — צוות רפואי + זמינות שבועית (`available_weekdays`, `work_start_time`, `work_end_time`, `slot_duration_minutes`). אין טבלת "משבצות" נפרדת — זמנים פנויים מחושבים בצד לקוח: שעות עבודה מוגדרות פחות הזמנות קיימות ב-`bookings` לאותו `staff_id`/יום.
- `bookings` — הזמנות. `unique(staff_id, scheduled_at)` מונע הזמנה כפולה. RLS: מטופל רואה/יוצר/מעדכן (לרוב לביטול, `status='cancelled'`) רק הזמנות שהוא בעליהן.

כל 3 הטבלאות: RLS מופעל, מדיניות עם `to authenticated` + predicate בעלות, GRANT מפורש (`anon` ללא גישה כלל).

## Supabase CLI workflow (חשוב!)
- הפרויקט **מקושר** (`supabase link`) ל-`qqeupktyadjxqoxkstnl`. אין סביבת פיתוח מקומית עם Docker (`supabase start` לא נבדק/לא זמין בסביבה זו) — עובדים ישירות מול ה-DB המרוחק.
- שינויי סכמה: קודם `execute_sql` (MCP) לאיטרציה, אחר כך `supabase migration new <name>` ליצירת קובץ migration ידני תחת `supabase/migrations/`, ואז `supabase migration repair <version> --status applied` כדי לסמן שהוא כבר הוחל בפועל (כי לא עברנו דרך `db push`).
- **לפני** יצירת migration: להריץ `get_advisors` (security + performance) ולתקן ממצאים.
- `supabase db pull` דורש Docker (shadow db) — לא זמין כאן; לכן migrations נכתבות ידנית.

## דאטה סינתטי
- 10 מטופלים (עם משתמשי `auth.users` אמיתיים, נוצרו דרך Admin API עם `sb_secret_...` — ראה היסטוריית שיחה; הסיסמה לכל המשתמשים הסינתטיים נמסרה בצ'אט, לא נשמרת כאן בקובץ; אימיילים בפורמט `*.test@example.com`).
- 5 אנשי צוות (אחות, אחות, רופא, פיזיותרפיסט, מטפל/ת סיעודי/ת) עם זמינות שונה.
- 20 הזמנות (עבר/עתיד, סטטוסים מגוונים: scheduled/completed/cancelled).

## פאנל ניהול (admin.html)
משתמש אמיתי (לא anonymous) עם התחברות אימייל+סיסמה רגילה, מסומן כאדמין דרך `app_metadata.is_admin = true` (נקבע רק ע"י Admin API עם ה-service_role key — לא ניתן לעריכה ע"י המשתמש עצמו, בניגוד ל-`user_metadata`). מדיניות RLS נפרדות (`admin_full_access_*`) בודקות `(auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean` ונותנות גישה מלאה (select/insert/update/delete) לכל 3 הטבלאות — נוספו כ-policies נוספות (permissive, OR עם המדיניות הקיימות של המטופלים/אורחים, לא מחליפות אותן). האדמין מנהל: כל ההזמנות (כולל שינוי סטטוס), צוות רפואי (הוספה/עריכה/מחיקה/זמינות), וצפייה במטופלים. קישור "כניסת מנהל" בתחתית `index.html`. פרטי הכניסה נמסרו למשתמש בצ'אט (לא נשמרים כאן בקובץ).

## Frontend
תיקיית `public/`: `index.html` (עמוד נחיתה + קטלוג שירותים, ללא התחברות), `staff.html` (בחירת איש צוות, תומך ב-`?role=` לסינון), `booking.html` (מטרת ביקור + תאריך/שעה פנויים + טופס פרטי המטופל בסוף), `my-bookings.html` (ההזמנות של ה-guest הנוכחי), `styles.css`, `app.js` (supabase client, `ensureGuestSession()`, `savePatientDetails()`, לוגיקת חישוב זמנים פנויים).

מפתח ה-API בפרונט הוא **publishable key בלבד** (`sb_publishable_...`) — לעולם לא ה-secret key.

## הרצה מקומית
פתיחת `public/index.html` ישירות בדפדפן, או שרת סטטי פשוט (`python3 -m http.server`) מתוך `public/`.
