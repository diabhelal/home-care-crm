# WORKPLAN — מסלול הזמנה, עבודת שטח, ארכיטקטורת Python

> רשימת עבודה אחת. עדכון אחרון: 2026-10-17. **מצב:** כל הבלוקים למטה הושלמו; SQL 001–007 הוחל על הפרויקט החי ב-2026-10-15 (ר' `supabase/proposed/APPLIED.md`) וכל העבודה נמצאת ב-`main` ב-GitHub. הסעיפים שמתארים "מצב לפני" או "טרם הוחל" שמורים כהיסטוריה של התכנון, ומסומנים ככאלה. מה שנותר: `HANDOFF.md`.

## בלוק 1 — בדיקת מצב **לפני העבודה** (היסטורי; הטבלה אינה מצב נוכחי)
| תחום | מצב בפועל |
|---|---|
| **הזמנה** | הדפדפן כותב ישירות ל-`bookings` (booking.html). אין מושג "התבקש" מול "אושר". המסלול מתחיל בבחירת איש צוות. |
| **זמינות** | חישוב בדפדפן (`slot-calculation.js` + RPC `taken_slots`): מתחשב רק במשבצות תפוסות, **בלי זמן נסיעה**. |
| **שיבוץ** | ידני (מנהל משנה `staff_id` מהדפדפן). אין שיבוץ אוטומטי לפי התאמה/עומס. |
| **התחלת ביקור** | `workflow_status='in_progress'` מהדפדפן. **אין חותמת זמן מהשרת.** |
| **שמירת דוח** | 2 כתיבות נפרדות מהדפדפן (`visit_reports` ואז `bookings.status`) ב-3 מקומות. **לא אטומי.** |
| **טיוטות אופליין** | `localStorage` במפתח **גלובלי אחד** (`visitReportOfflineQueue`). אין הפרדה בין משתמשים ואין ניקוי בהתנתקות. |
| **Python** | `predictive-service` בלבד: ללא אימות וללא DB, חישובים קליניים. הזמנות לא שם. |
| **Edge Function** | `create-staff-login` (Deno/TS) — לפי האפיון עוברת ל-Python ללא כפילות. |

## ארכיטקטורה מוצעת
- `backend/` — FastAPI חדש, **נפרד** מ-`predictive-service/` (לוגיקה תפעולית ≠ לוגיקה קלינית).
- שני השירותים לא חולקים קוד קליני. נוסחאות קליניות וסוכנים קיימים לא משתנים.
- אימות: JWT של Supabase מאומת בשרת; הזהות נלקחת מהטוקן, לא מגוף הבקשה. כתיבה למסד עם הטוקן של המשתמש, כך ש-RLS נשמר.
- מרווח נסיעה: קבוע (30 דקות) + אישור מנהל, עד שיהיה חישוב נסיעה אמיתי.

## בלוקים
| # | בלוק | מצב | הוכחה |
|---|---|---|---|
| 1 | הגנת טיוטות (מפתח לפי משתמש; לא נמחק מידע שטרם נשמר) | **הושלם** | בדיקות יחידה ו-`mobile-journey.spec.js` |
| 2 | שמירת דוח אטומית (RPC) + חותמת זמן שרת | **הושלם והוחל** (001–003, 2026-10-15) | `backend/tests_db` + מחזור חי |
| 3 | Backend Python: הזמנה, זמינות+מרווח, שיבוץ, אישור/דחייה/שיבוץ מחדש, ביטול | **הושלם** | `backend/tests` (137) |
| 3א | חיבור הדפדפן ל-API (אין נתיב כתיבה עוקף; בלי backend הזמנה נכשלת בהודעה ברורה) | **הושלם** | `backend-booking.spec.js`, `admin-lifecycle.spec.js` |
| 4 | עבודת צוות: ביקור הבא, ניווט, התקשרות, check-in, השלמה | **הושלם** | `staff-field-actions.spec.js`, `mobile-journey.spec.js` |
| 5 | הגנות DB על `bookings` (005), חיזוי/התראות בשרת עם HMAC (006), כפיית זהות כותב (007) | **הושלם והוחל** (2026-10-15) | `backend/tests_db` (47) |
| 6 | עיצוב (Heebo, נייבי+מנטה) ומסע מובייל | **הושלם** | צילומי מסך ב-`docs/demo-proof/`; בדיקת נגישות WCAG מלאה (axe) **לא בוצעה** |
| 7 | שמירת היסטוריה למטופל באימייל או בטלפון+SMS | אימייל **פעיל**; SMS **בנוי ובדוק על מוק, כבוי** (`SMS_LOGIN_ENABLED=false`) | `patient-account.spec.js` |

## פערים שנדרשים לפני שירות אמיתי (לא בהיקף העבודה הזאת)
מדיניות פרטיות והסכמה מדעת, אירוח backend עם HTTPS ו-CORS מוגדר, מפתחות, ספק אימייל/SMS,
סביבת staging, בדיקת חדירה, ושקילה של הצפנת/מחיקת מידע קליני בצד הלקוח.

## ממצאי בדיקה (נסגרו)
- `staff_busy_blocks` המוצע חשף כתובות/קואורדינטות של מטופלים אחרים לכל משתמש מחובר ← תוקן: מחזיר את הכתובת המבוקשת בלבד כשיש התאמה, ללא קואורדינטות (בדיקות ב-`backend/tests/test_privacy.py`).
- `complete_visit` המוצע לא איפשר השלמה ע"י מנהל ← תוקן: בעלים או `is_admin` מה-JWT.

## נותר (נכון ל-2026-10-17)
1. ~~סקירה והחלה של `supabase/proposed/*.sql`~~ - **הוחל ב-2026-10-15** על הפרויקט החי (לא על staging נפרד, שאינו קיים).
2. ~~חיבור הדפדפן ל-API~~ - **הושלם**.
3. ~~מטופל יכול להכניס ישירות ל-`bookings`~~ - **נסגר** בטריגרי 005 (הוחלו).
4. עדיין פתוח: אירוח ה-backend (HTTPS, `BACKEND_URL`, CSP, CORS), staging נפרד, MFA, ספק SMS, החלפת `RISK_ATTESTATION_SECRET`, מסמכים משפטיים, בדיקת חדירה, והרצת `backend` pytest ב-CI. ר' `HANDOFF.md`.

## כתיבות ישירות שנותרו
נכון ל-2026-10-15 (אחרי סגירת "התחלת ביקור" של מנהל ו-`clinical_outcome_8h`). נסרק: כל `supabaseClient.from(...).insert/update/upsert/delete`, `storage.upload`, `functions.invoke` ב-`public/`.

**נסגר במשימה זו:** (1) `work-queue.js startVisit` ← `POST /staff/bookings/{id}/check-in` עם JWT של מנהל (פונקציית `check_in_visit` מקבלת בעלים-או-מנהל כמו `complete_visit`). (2) `visit_reports.update({clinical_outcome_8h})` ב-`employee.html` וב-`patient-record.js` ← `PATCH /visits/{report_id}/clinical-outcome` (צוות משויך או מנהל; ערך מול ה-CHECK; כתיבה עם ה-JWT של הקורא, RLS נשמר; 403/404/422).

**(a) מחזור חיי הזמנה/ביקור: אפס כתיבות ישירות בדפדפן** (`bookings`, `visit_reports`). אומת ב-`__write_log` בבדיקות `admin-lifecycle`, `staff-field-actions`, `mobile-journey`.
הערה: ברמת ה-DB מדיניות `staff_update_assigned_bookings` / `bookings_update_own` / `staff_full_access_own_visit_reports` עדיין מאפשרות כתיבה ל-PostgREST ישיר; הגנת זה היא `supabase/proposed/005_booking_write_guards.sql` (טריגרים), **שהוחלה ב-2026-10-15**.

| # | קובץ:שורה | טבלה / פעולה | מי יכול | הגנה (RLS / guard) | סיווג |
|---|---|---|---|---|---|
| 1 | `public/index.html:191` | `patient_contacts` insert (פנייה מהאתר) | מטופל/אורח (anon-session) | `patient_insert_own_contacts`: `patient_id = auth.uid()` ו-`is_from_patient = true` | (c) |
| 2 | `public/app.js:444` | `patients` upsert (פרטי מטופל בשלב אישור) | מטופל/אורח לשורה שלו | `patients_insert_own` / `patients_update_own` (`id = auth.uid()`); טריגר audit | (c) |
| 3 | `public/my-bookings.html:254` | `service_plans` insert (בקשת תוכנית) | מטופל | `patient_insert_own_service_plans`: בעלים ו-`status='requested'` | (b) |
| 4 | `public/my-bookings.html:308` | `patient_contacts` insert | מטופל | `patient_insert_own_contacts` | (c) |
| 5 | `public/js/admin/contacts.js:127` / `:148` / `:163` | `patient_contacts` insert / update status / delete | מנהל | `admin_full_access_patient_contacts` | (b) |
| 6 | `public/js/admin/staff.js:116` | `medical_staff` delete | מנהל | `admin_full_access_medical_staff` | (c) |
| 7 | `public/js/admin/staff.js:199-200` | `medical_staff` update / insert | מנהל | `admin_full_access_medical_staff` (יצירת כניסה: Edge Function `create-staff-login`, ללא service_role בדפדפן) | (c) |
| 8 | `public/js/admin/patients.js:84` | `patients` update (רקע, עישון) | מנהל | `admin_full_access_patients`; audit | (b) |
| 9 | `public/js/admin/patient-record.js:156` | `patients` update (פרופיל) | מנהל (צוות: אין מדיניות update על `patients`, מסונן) | `admin_full_access_patients`; audit | (b) |
| 10 | `public/js/admin/patient-record.js:515` | `patient_medical_history` upsert | מנהל | `admin_full_access_patient_medical_history`; audit | (b) |
| 11 | `public/js/admin/patient-record.js:530` | `patient_allergies` insert | מנהל | `admin_full_access_patient_allergies`; audit | (b) |
| 12 | `public/js/admin/patient-record.js:572`, `public/employee.html:1059` | `medication_events` insert | מנהל / צוות למטופל משויך | `admin_full_access_medication_events` / `staff_insert_assigned_medication_events` (`is_my_patient`) | (b) |
| 13 | `public/js/admin/patient-record.js:617`, `:711`, `:649` | `service_plans` update status / insert; `service_plan_visits` upsert | מנהל | `admin_full_access_service_plans` / `_service_plan_visits`; audit על `service_plans` | (b) |
| 14 | `public/js/admin/patient-record.js:771`, `public/employee.html:1101` | `clinical_notes` insert | מנהל / צוות משויך | `admin_insert_clinical_notes` / `staff_insert_assigned_clinical_notes` (append-only: אין update/delete) | (b) |
| 15 | `public/js/admin/patient-record.js:814-817` | `patient-documents` storage upload + `patient_documents` insert | מנהל | `admin_full_access_patient_documents[_storage]` (bucket פרטי) | (b) |
| 16 | `public/js/admin/patient-record.js:843`, `:850`, `public/employee.html:1124`, `:1131` | `alerts` update (acknowledged / resolved) | מנהל / צוות משויך | `admin_full_access_alerts` / `staff_update_assigned_alerts`; **הדפדפן שולח רק `status`**; טריגר `alerts_guard_update` (006, טרם הוחל) כופה `acknowledged_by/at := auth.uid()/now()` ומונע שינוי תוכן ההתראה | (b) — נסגר בקוד, ממתין להחלת 006 |
| 17 | `public/js/admin/patient-record.js:863`, `:877`, `public/employee.html:1144`, `:1155` | `tasks` insert / update (completed) | מנהל / צוות משויך | `admin_full_access_tasks` / `staff_insert|update_assigned_tasks`; **הדפדפן לא שולח `created_by`/`completed_*`**; טריגרים `tasks_guard_insert/update` (006, טרם הוחלו) כופים `auth.uid()`/`now()` | (b) — נסגר בקוד, ממתין להחלת 006 |
| ~~18~~ | ~~`patient-record.js:1005`, `employee.html:585`~~ | ~~`alerts` insert~~ | — | **נסגר (הוחל 2026-10-15):** `POST /patients/{id}/auto-alert` + `POST /visits/{id}/risk-assessment` ← פונקציית `record_auto_alert` / `record_risk_prediction` (חתימת HMAC מהשרת); `revoke insert on alerts` ב-`proposed/006` (טרם הוחל) | נסגר |
| ~~19~~ | ~~`admin.html:693`, `employee.html:622`~~ | ~~`risk_predictions` insert~~ | — | **נסגר (הוחל 2026-10-15):** `POST /visits/{id}/risk-assessment` ← `record_risk_prediction` (SECURITY DEFINER; `created_by`/`predicted_at`/`expires_at`/`patient_id`/`input_features` נגזרים בשרת); `revoke insert` ב-`proposed/006` (טרם הוחל) | נסגר |

### עדכון: זיוף נתונים קליניים (#16-#19) נסגר — `proposed/006_server_side_risk_and_alerts.sql`
- **עיצוב:** `backend/app/risk.py` (אורקסטרציה בלבד; הכללים/ספים/נוסחאות נשארים ב-`predictive-service/` ללא שינוי) טוען דוח+הקשר מטופל+דוח קודם עם JWT של הקורא, קורא ל-`/predict/risk-assessment` ול-`/alerts/evaluate` ב-HTTP, חותם את התוצאה ב-HMAC (`RISK_ATTESTATION_SECRET`) וקורא לפונקציית DB אחת (`record_risk_prediction`) שכותבת תחזית+התראה באותה טרנזקציה. פונקציית SECURITY DEFINER נגישה ל-`authenticated` ב-RPC, ולכן החתימה היא מה שמונע מלקוח לזייף `risk_level`; הסוד נשמר בטבלה `server_secrets` שאין אליה גישה דרך ה-API.
- **סטטוס:** 006 **הוחל** ב-2026-10-15, הסוד הוכנס ל-`server_secrets`, וה-insert הישיר נשלל. הגדרת `PREDICTIVE_SERVICE_URL`/`RISK_ATTESTATION_SECRET` בשרת מאורח עדיין נדרשת (ה-backend לא מאורח).
- נשארים פתוחים: `alerts` delete למנהל/צוות משויך (מחיקת התראה), `tasks.title/due_at` ניתנים לעריכה ע"י צוות משויך (מכוון), ו-`patient_documents`/יתר הטבלאות (b) לא נגעו.

### סיכוני זיוף (b) — תיאור מקורי (לפני 006)
- **`risk_predictions` (#19)**: `risk_level`, `confidence`, `expires_at`, `model_version`, `input_features`, `created_by` נשלחים מהדפדפן. כל איש צוות משויך (או מנהל) יכול להכניס דירוג סיכון שרירותי שייראה כתוצר המנוע, כולל `model_version` מזויף, ו-`current_patient_risk` מציג אותו. גם `input_features` לא חייב להתאים ל-`visit_report_id`.
- **`alerts` insert (#18)**: `alert_type`/`severity`/`message`/`risk_prediction_id` מהלקוח; ניתן להוסיף התראת "קריטית" או להצמיד אותה לתחזית שאינה של המטופל.
- **`tasks`/`alerts` update**: `completed_by`/`acknowledged_by`/`*_at` נקבעים בדפדפן (זמן לקוח, מזהה מהלקוח), ללא trigger שכופה `auth.uid()`/`now()`.
- **צעד בטוח**: endpoint ב-backend (`POST /visits/{report_id}/risk` ו-`POST /patients/{id}/alerts/auto`) שקורא ל-predictive-service (או מחשב ב-backend), גוזר `created_by` מה-JWT, `predicted_at`/`expires_at` משעון השרת, `visit_report_id` מאומת מול הדוח והמטופל, וכותב דרך פונקציית `SECURITY DEFINER` (כמו `complete_visit`); אחר כך `revoke insert on risk_predictions from authenticated` ובדיקות `tests_db`. עבור `tasks`/`alerts` update: trigger additive שמציב `completed_by := auth.uid()`, `*_at := now()`. מיגרציה = workflow מאושר בלבד.
- (a)/(c) ללא פער זיוף ממשי: כתיבות הבעלים מוגבלות ל-`auth.uid()`; `patient_contacts`/`service_plans` מאלצים `is_from_patient`/`status='requested'` ב-`with check`.
