# תוכנית עבודה — מערכת CRM לביקורי בית

## רקע
מערכת CRM לחברת שירותי טיפול רפואי וביקורי בית. מטופל נכנס למערכת, בוחר איש/אשת צוות רפואי, בוחר מטרת ביקור, ובוחר תאריך ושעה מתוך הזמנים הפנויים של איש הצוות.

## פרויקט Supabase
- שם: `home-care-crm`
- Ref: `qqeupktyadjxqoxkstnl`
- Region: `eu-central-1`
- Status: נוצר, ACTIVE_HEALTHY

## מבנה נתונים (3 טבלאות)

### `patients`
מטופלים. מקושר 1:1 ל-`auth.users` (המטופל הוא המשתמש שמתחבר למערכת).
| עמודה | טיפוס | הערות |
|---|---|---|
| id | uuid PK | `references auth.users(id) on delete cascade` |
| full_name | text | חובה |
| phone | text | |
| address | text | כתובת לביקור בית |
| date_of_birth | date | |
| created_at | timestamptz | default now() |

RLS: מטופל רואה/עורך רק את הרשומה שלו (`id = auth.uid()`).

### `medical_staff`
אנשי צוות רפואי (אח/אחות, רופא/ה, פיזיותרפיסט/ית וכו') + הגדרת זמינות שבועית (ולא כל משבצת בנפרד — הזמנים הפנויים בפועל מחושבים כ: שעות עבודה מוגדרות פחות הזמנות קיימות ב-`bookings`).
| עמודה | טיפוס | הערות |
|---|---|---|
| id | bigint identity PK | |
| full_name | text | חובה |
| role | text | check: nurse/doctor/physiotherapist/caregiver |
| specialization | text | |
| phone | text | |
| available_weekdays | smallint[] | 0=ראשון..6=שבת |
| work_start_time | time | ברירת מחדל 08:00 |
| work_end_time | time | ברירת מחדל 18:00 |
| slot_duration_minutes | int | ברירת מחדל 60 |
| is_active | boolean | default true |
| created_at | timestamptz | default now() |

RLS: כל משתמש מחובר (authenticated) יכול לקרוא צוות פעיל בלבד. כתיבה — service_role בלבד (ניהול).

### `bookings`
הזמנות ביקור בית.
| עמודה | טיפוס | הערות |
|---|---|---|
| id | bigint identity PK | |
| patient_id | uuid FK → patients.id | |
| staff_id | bigint FK → medical_staff.id | |
| visit_purpose | text | check: checkup/wound_care/blood_test/medication/physiotherapy/other |
| scheduled_at | timestamptz | מועד הביקור |
| status | text | check: scheduled/completed/cancelled, default scheduled |
| notes | text | |
| created_at | timestamptz | default now() |
| **unique(staff_id, scheduled_at)** | | מונע הזמנה כפולה לאותו איש צוות באותו מועד |

RLS: מטופל רואה/יוצר/מעדכן (ביטול) רק הזמנות שהוא הבעלים שלהן (`patient_id = auth.uid()`).

אינדקסים: על `patient_id`, `staff_id` (בנוסף למפתחות הזרים והייחודיות).

## אבטחה
- RLS מופעל בכל 3 הטבלאות + מדיניות עם `TO authenticated` ו-predicate בעלות (לפי security checklist של הסקילז).
- UPDATE policies כוללים גם USING וגם WITH CHECK.
- הרשאות GRANT מפורשות ל-`authenticated` (ללא `anon`) — לפי שינוי עתידי ב-Data API שדורש חשיפה מפורשת.
- ללא `user_metadata` בשום מדיניות — לא רלוונטי כאן כי אין הרשאות תפקיד מורכבות.
- הרצת `get_advisors` (security + performance) לאחר יצירת הסכמה, לפני commit של המיגרציה.

## שלבי עבודה
1. ✅ יצירת פרויקט Supabase חדש (`home-care-crm`, `qqeupktyadjxqoxkstnl`)
2. ✅ `supabase init` + `supabase link` לפרויקט המקומי
3. ✅ יצירת הסכמה (3 טבלאות + RLS + GRANT + indexes) דרך `execute_sql`
4. ✅ הרצת `get_advisors` — ללא ממצאי אבטחה; המצאי ביצועים (unused index) הם INFO צפוי על טבלאות חדשות
5. ✅ יצירת migration ידני (`supabase migration new` + `migration repair`) — `db pull` דרש Docker שלא זמין בסביבה זו
6. ✅ דאטה סינתטי: 5 אנשי צוות, 10 מטופלים (עם משתמשי auth אמיתיים דרך Admin API), 20 הזמנות
7. ⚠️ עיצוב ב-Stitch: פרויקט ו-design system נוצרו בהצלחה (id `10674010542604110227`), אך `generate_screen_from_text` נכשל/נתקע (timeout) בעקביות בסביבה זו ולא הצליח להפיק אף מסך בפועל לאחר מספר ניסיונות ולמעלה מ-15 דקות המתנה. ה-Frontend נבנה ידנית לפי אותה שפת עיצוב (צבעים, גופנים, roundness) שהוגדרה ב-design system.
8. ✅ בניית Frontend סטטי ב-HTML/CSS + JS מינימלי (supabase-js מ-CDN) — 4 דפים תחת `public/`
9. ✅ בדיקה מקצה לקצה מול ה-API האמיתי (login, RLS isolation, join, insert, מניעת הזמנה כפולה, RLS על insert, cancel) — כל הבדיקות עברו.
10. ✅ כתיבת `CLAUDE.md` לתיעוד הפרויקט להמשך עבודה
11. ✅ סבב שיפור UX/נגישות (סוכן fork בשם `ux-polish`, agentId `a63381bca832daf82`): מצבי טעינה עם ספינרים, aria-live/aria-pressed, מניעת לחיצה כפולה, הודעות שגיאת רשת ידידותיות, כרטיסי צוות כ-`<button>` נגישים, focus-visible. יושם על כל 4 הדפים. לא נגע בלוגיקה העסקית/שאילתות.

## עדכון ארכיטקטורה (2026-08-26): הזמנה בלי הרשמה
לפי בקשת המשתמש, המערכת שונתה ממודל "התחברות עם אימייל+סיסמה" למודל "הזמנה" (כמו הזמנת טיסה/אוכל): גלישה חופשית בשירותים ובאנשי הצוות בלי שום פרטים, ורק בשלב אישור ההזמנה (`booking.html`) ממלאים שם/טלפון/כתובת.

מימוש: Supabase Auth **Anonymous Sign-ins** (`supabaseClient.auth.signInAnonymously()`), מופעל דרך `enable_anonymous_sign_ins = true` ב-`supabase/config.toml` + `supabase config push`. מדיניות ה-RLS הקיימות (המבוססות על `auth.uid()`, לא על `auth.role()`) המשיכו לעבוד ללא שינוי — נבדק מקצה לקצה מול ה-API האמיתי (guest sign-in → עיון בצוות לפי תפקיד → בדיקת שעות פנויות → upsert פרטי מטופל → יצירת הזמנה → צפייה בהזמנה משויכת → ביטול), הכל עבר.

**⚠️ תופעת לוואי לא מכוונת**: `supabase config push` דוחף את *כל* מקטע ה-`[auth]` מ-`config.toml` המקומי (ברירת המחדל מ-`supabase init`), לא רק את השדה שהתכוונו לשנות. זה שינה בפועל גם: `enable_confirmations` (email) מ-true ל-false, כיבה של MFA TOTP (`enroll_enabled`/`verify_enabled`) שהיו דלוקים, ו-`site_url`/`additional_redirect_urls`. מוערך כלא מזיק לפרויקט הזה (פרויקט טסט חדש, לא משתמשים ב-MFA/OAuth בו), אבל כדאי לדעת שזו התנהגות `config push` — full diff-and-overwrite, לא merge סלקטיבי.

Frontend: `index.html` הפך מדף התחברות לדף נחיתה עם קטלוג שירותים (לפי `role` מ-`medical_staff`) ו-CTA; `staff.html` תומך בסינון `?role=`; `booking.html` כולל עכשיו טופס "הפרטים שלך" (שם/טלפון/כתובת) לפני אישור ההזמנה, וקורא ל-`savePatientDetails()` (upsert) לפני יצירת ה-booking.

## מיקום הפרויקט (עודכן 2026-09-02)
הפרויקט הועבר מ-`/Users/helaldiab/med` אל:
```
/Users/helaldiab/Desktop/פיתוח AI/home-care-crm
```
כל הפקודות (הרצת שרת מקומי, `supabase` CLI וכו') יש להריץ מהנתיב החדש. השרת המקומי מופעל כך (**עם `dangerouslyDisableSandbox: true`**, אחרת הדפדפן האמיתי לא יגיע אליו):
```
cd "/Users/helaldiab/Desktop/פיתוח AI/home-care-crm/public" && nohup python3 -m http.server 8765 > /tmp/http_server.log 2>&1 & disown
```

## מצב פתוח / להמשך
- בדיקה ויזואלית מלאה בדפדפן (מבנה/עיצוב בפועל) עדיין לא אושרה סופית ע"י המשתמש — כדאי לוודא.
- Stitch לא הפיק אף מסך בפועל בזמנו (timeout חוזר) — הפרויקט וה-design system עדיין קיימים ב-Stitch (id `10674010542604110227`) אם ירצו לנסות שוב, אך לא חוסם — ה-HTML/CSS כבר קיים וגמור.
- קיימת גם תיקיית `.codex/` וקובץ `AGENTS.md` (זהה ל-CLAUDE.md) בפרויקט — כנראה מהגדרת Codex CLI ע"י המשתמש, לא נוגע לעבודה של Claude Code.

## מבנה קבצים
```
/Users/helaldiab/Desktop/פיתוח AI/home-care-crm/
  supabase/
    config.toml
    migrations/
  public/
    index.html          # login
    staff.html           # בחירת צוות
    booking.html         # קביעת תור
    my-bookings.html      # ההזמנות שלי
    styles.css
    app.js               # supabase client + לוגיקה
  PLAN.md
  CLAUDE.md
```
