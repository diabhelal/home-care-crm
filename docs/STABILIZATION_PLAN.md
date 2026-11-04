# Home Care CRM — תוכנית ייצוב ומוכנות ל-Production (נכון ל-2026-11-04)

> מסמך התכנון שאושר על ידי הבעלים. אחריו בוצעו חלק מהשלבים (ר' `docs/REPO_STATUS.md` למצב עדכני של ענפים ו-PR-ים). בזמן כתיבת התכנון: **Plan Mode. לא נערך קובץ מקור, לא בוצע commit/push/merge/deploy, לא נגעתי ב-DB החי.** הפעולות היחידות: קריאה, `gh`/`git` לקריאה, בדיקות ממוקקות שרצו על פורטים זמניים עם פלט ל-scratchpad.
> סיווג: **VERIFIED** (נבדק בקוד/בהרצה/בגיט בסשן הזה) · **SUSPECTED** (דיווח סוכן/הסקה שלא הוכחה) · **NOT TESTED**.
> תעדוף: לפי תועלת לפרויקט — (1) מניעת אובדן/חשיפה של מידע רפואי, (2) שלמות תהליכי ליבה, (3) צמצום מורכבות, (4) הנאה ויזואלית. צוות הסוכנים נשמר ככלי הביקורת הקבוע (ר' סעיף 3).

## 1. תקציר מנהלים
1. **הסיכון הגדול ביותר הוא ב-DB החי, לא בקליינט.** `authenticated` מחזיק DELETE על `visit_reports` (VERIFIED: `supabase/migrations/20260911145909_add_visit_reports.sql:43`), מדיניות `admin_full_access_visit_reports` היא `FOR ALL`, ו-FK מסוג CASCADE קיים; מיגרציות 008–013 (ו-015–017) הן קבצי הצעה בלבד. **מצב ההחלה בפועל: UNKNOWN** (מקור יחיד: `supabase/proposed/APPLIED.md`; לא נקרא DB חי).
2. **בידוד בין מטופלים (PR #26) מאומת בבדיקות** על commit `536438f` (מכיל את head של #26, `d53ca83`): 14/14 isolation + 5/5 risk-server-side + sw-update — ר' סעיף 12. טרם נבדק בדפדפן אמיתי.
3. **תשתית הבדיקות נקייה כעת:** אין שרת ישן על 8080 (VERIFIED, `lsof`). שני "הכשלים" שדווחו התבררו כהרצה: `risk-server-side` = בדיקה מיושנת שתוקנה ב-`d53ca83`; `sw-update` נכשל רק בהעתק (נתיב `__dirname`), עובר במקום.
4. **המודלים: אין ML מאומן** (VERIFIED: אין artifacts, `local_joblib_artifacts: []`). `ml_targets.py` ו-`statsmodels` **בשימוש פעיל** ואסור להסירם בלי החלטה.
5. **המלצה אחת בסוף הדוח.**

## 2. מצב נוכחי מאומת (Baseline)
| נושא | ממצא | מקור |
|---|---|---|
| Checkout נוכחי | `codex/predictive-response-contract` @ `536438f`; עץ עבודה נקי חוץ מ-`.agents/` ו-`.codex/agents/medical-records-reviewer.toml` (לא במעקב) | `git status` |
| Worktrees (6) | ראשי; `wt-handoff` (`docs/session-handoff` 751467b); `wt-integrity` (a86d8c5); `wt-review` (detached c138fc0); `wt-contract` (a8607c7); `wt-risk-same` (`fix/draft-409-...`) | `git worktree list` |
| PR-ים פתוחים | #18,#19,#20,#21,#22,#23,#24,#25,#26,#27,#28 (+15 Dependabot) | `gh pr list` |
| #26 | head `feature/cross-patient-isolation` @ `d53ca83`, base **`feature/trend-forecast-button-fix` (#22)**, 3 קומיטים (08598fc WIP, c138fc0, d53ca83), MERGEABLE, בלי review, CI ירוק (pytest+DB, e2e, unit, secret-scan) | `gh pr view 26`, `gh pr checks 26` |
| #28 | head `codex/predictive-response-contract-main` -> main; CI: **4 בדיקות tests_db נכשלות** (`ForeignKeyViolation` במקום `RestrictViolation`) ב-4 הקבצים ש-#20 מתקן; שאר הבדיקות ירוקות | `gh pr checks 28`, log |
| CI e2e-safe | מריץ 16 קבצי spec; **לא כולל** `cross-patient-isolation` ו-`trend-forecast` | `.github/workflows/ci.yml:85` |
| playwright.config.js | `baseURL`/`webServer` קבועים על 8080; `reuseExistingServer: !CI` (שרת ישן מוגש בשקט); `fullyParallel:false` | הקובץ |

## 3. זמינות סוכנים וכלים (סיווג)
| סוכן | מצב בסשן | הערה |
|---|---|---|
| audit-security, audit-reliability, security-privacy, backend-database, clinical-ai, medical-records-reviewer, qa-regression-debugger, frontend-design-integrator, clinical-ux-accessibility-lead | **Definition-only** — קיימים כקבצים ב-`.claude/agents/`; אינם ברשימת סוגי ה-Agent שנטענו בסשן (רק general-purpose/Explore/Plan וכו') | הרצתי אותם כ-general-purpose שקיבל את קובץ ההגדרה כהוראות (הדמיה, לא טעינה מקורית) |
| 4 סוכני עיצוב שהוסרו (design-director, color, brand-content, interaction-controls) | **Definition-only מקומי בלבד**; הוסרו מ-#23 ומ-`docs/session-handoff` בהחלטת הבעלים | אין להחזיר |
| skills של הפרויקט (clinical-safety-review, db-migration-workflow, release-checklist, lessons-learned) | **Definition-only** (לא ברשימת ה-Skill של הסשן) | הוראותיהם נקראו ידנית |
**שמירת הצוות החשוב:** ליבת הצוות ל-implementation: `security-privacy` + `audit-security` (אבטחה), `backend-database` (DB/backend), `medical-records-reviewer` (שלמות רשומות), `qa-regression-debugger` (בדיקות), `clinical-ux-accessibility-lead` + `frontend-design-integrator` (ממשק), `audit-reliability`, `clinical-ai`. הצעה: להפוך אותם **לנטענים** — מקור יחיד (#23 → `main`, אישור בעלים) ובדיקה בסשן חדש מה נטען בפועל (`/agents`).

## 4. פערי ראיות (Evidence Gaps)
- מצב החלה אמיתי של 008–017 ב-DB החי; סכמה חיה מול קבצי migrations (drift) — **UNKNOWN**; דורש קריאה בלבד באישור.
- כניסת אימייל/סיסמה בפועל (`signInWithPassword`) — קוד קיים (VERIFIED: `admin.html:385`, `employee-login.html:91`); עבודה מול Supabase חי — **NOT TESTED**.
- בדיקה בדפדפן אמיתי, קורא מסך, axe-core, zoom/מקלדת — **NOT TESTED**.
- ASVS 5.0 ברמת דרישה בודדת — לא בוצע; מופה ברמת פרק בלבד (סעיף 7).
- 14 מתוך 15 PR-ים של Dependabot והחולשה ה"קריטית" — **NOT TESTED**.
- #18 (סיכום LLM, 51 קבצים), #19, #21 — **NOT TESTED** (חפיפה עם #24/#28 בקבצי docs).
- גיבוי/PITR של הפרויקט החי — **UNKNOWN**.
- Dev/Prod parity של Postgres (16 מול 18) — מאומת רק ב-CI/מקומי.

## 5. חוסמי השקה קריטיים (Critical Launch Blockers)
| # | חוסם | סטטוס | ראיה | רמת פריסה שהוא חוסם |
|---|---|---|---|---|
| B1 | מחיקה פיזית של רשומות קליניות אפשרית ל-`authenticated` + CASCADE, ללא audit על DELETE | VERIFIED בקבצים; חיות UNKNOWN-until-read | `20260911145909:43`; audit רק `after insert or update` (`20260913220259:182-190`) | 2,3 |
| B2 | `is_my_patient` ללא סינון סטטוס: כל הזמנה (גם נדחתה/בוטלה) נותנת גישה לתיק | VERIFIED (קוד) | `20260913230732_add_staff_identity.sql:19-25` | 3 (ו-2 בנתונים אמיתיים) |
| B3 | אין גיבוי/שחזור מתועד ומתורגל | VERIFIED (מסמכים: `DEPLOY.md:37`, `STAGING_PLAN.md:31`) | — | 2,3 |
| B4 | סוד אטסטציה נחשף בשיחה ולא הוחלף | SUSPECTED (`APPLIED.md`) | — | 2,3 |
| B5 | Auth: סיסמה מינימלית 6, MFA כבוי, anonymous sign-in פתוח ללא CAPTCHA (קובץ מקומי; דשבורד לא נבדק) | VERIFIED בקובץ, חי UNKNOWN | `supabase/config.toml` | 2,3 |
| B6 | טופס תיקון לדוח מוצג לכל מנהל; כפתורי מחיקה של צוות/אנשי קשר | VERIFIED | `public/app.js:602` (`canAmend=true`), `staff.js:144`, `contacts.js:163` | 3 |
| B7 | מדיניות פרטיות/הסכמה/שמירה חסרה; אין קביעה משפטית | VERIFIED העדר מסמך | `DEPLOY.md:87` | 3 |
| B8 | הצגת "מצב תקין" (green) ללא confidence; `/predict/medical-warning` עם `no_data` → "נמוכה" | VERIFIED ל-green (`public/app.js:727`); `no_data` בקצה השרת **SUSPECTED** | דוח clinical-ai | 3 |

## 6. מפת ענפים ו-PR (תלויות)
```
main
 ├─ #20 fix/ci-postgres-restrict-violation   (test-only; מתקן CI של #28)
 ├─ #22 trend-forecast-button-fix ──► #26 cross-patient-isolation   (stacked)
 ├─ #23 agents-framework (9 סוכנים; מקור יחיד)
 ├─ #24 predictive-input-and-wording    ├─ #25 backend-booking-reliability
 ├─ #27 fix/draft-409-same-risk-assessment   ├─ #28 predictive-response-contract-main
 ├─ #18 llm-clinical-summary (51 קבצים)  └─ #19 readme-overhaul ──► #21 archive-historical-plans
ללא PR: offline-draft-safety, record-integrity-sql (015-017), docs/session-handoff, codex/predictive-response-contract (מקורי, stacked)
```
- **התנגשויות צפויות:** `CACHE_VERSION`/`APP_BUILD` — #22=v49, **#27=v49**, #24=v50, טיוטות=v51, #26=v52 → לתאם במיזוג. קבצי docs (`HANDOFF.md`, `README.md`, `docs/REVIEW.md`) נוגעים ב-#19, #28 ו-`docs/session-handoff`.
- **סדר מיזוג מומלץ (כל מיזוג באישור נפרד):** #20 → #22 → #26 → #23 → #24 → #25 → #27 → #28; לבדוק #18/#19/#21 לפני.
- **מניעת אובדן:** `git diff --stat main...<branch>` לפני כל מיזוג; לא למחוק ענפים/worktrees; הענף המקורי של Codex נשמר כהוא.

## 7. הערכת אבטחה ופרטיות (מיפוי ASVS 5.0 ברמת פרק; לא ברמת דרישה)
| תחום (ASVS 5.0) | ממצא | סטטוס | מקור |
|---|---|---|---|
| Authorization / RLS | B1, B2; `admin_full_access_*` = ALL | VERIFIED | קבצי SQL למעלה |
| Authentication | סיסמה 6, אין MFA, anonymous פתוח | VERIFIED(קובץ)/UNKNOWN(חי) | `config.toml` |
| Session | טיוטות plaintext ב-localStorage גם אחרי signOut; מפתח לפי uid קיים | VERIFIED (הוכח בדוח, `app.js` ~250–420) / הצפנה — החלטת בעלים | audit-security |
| Validation / Output encoding | `innerHTML` ללא `escapeHtml` ב-`admin.html:678,689`; 72 אתרים ב-`js/admin/*` | SUSPECTED (grep) | frontend-design-integrator |
| Web frontend | CSP עם `unsafe-inline`; supabase-js מ-CDN ללא SRI | SUSPECTED | `public/_headers` |
| Logging / Errors | PostgREST URL עם מזהי מטופל עלול להיכנס ללוגים; #25 מסיר values | SUSPECTED → מטופל חלקית ב-#25 | `supabase_repo.py:95` |
| Audit | audit_log: insert/update ב-5 טבלאות, ללא DELETE/קריאות | VERIFIED (חלקית) | `20260913220259:182-190` |
| Secrets | `keys.txt`, `backend/.env` מקומיים וב-.gitignore; secret-scan ב-CI ירוק | VERIFIED | `git check-ignore`, CI |
| Config | Dependabot: חולשה "קריטית" לא נבדקה | NOT TESTED | GitHub |
**משפט:** תיקון 13, הסכמה, שמירה — סיכונים להעברה לעו"ד; אין טענת עמידה בחוק.

## 8. הערכת מסד נתונים ומיגרציות (קריאה בלבד)
`supabase/migrations/`: 23 קבצים, אחרון `20261015155238_server_derived_authorship.sql`. מקור "מוחל": `APPLIED.md` בלבד.
| מיג' | קובץ | מטרה | תלויות | מצב לפי Git | החלה בחי | הגבלת rollback |
|---|---|---|---|---|---|---|
| 008 | `008_visit_report_integrity.sql` | נעילת דוח שהושלם, חסימת מחיקה ע"י צוות | 20260911145909, 20261015154029 | proposed, `131dee2` (17.10) | UNKNOWN (APPLIED.md: לא) | הסרת טריגר |
| 009 | `009_staff_deactivate_not_delete.sql` | השבתה במקום מחיקה, RESTRICT | 008 | proposed `4315bdf` | UNKNOWN (לא) | שינוי FK |
| 010 | `010_booking_update_conflict_guard.sql` | חפיפה/נסיעה גם ב-UPDATE | 20261015154829, 008 | proposed `2a44776` | UNKNOWN (לא) | מעלה 23505 |
| 011 | `011_risk_status_always_visible.sql` | view סיכון תמיד גלוי | risk_predictions | proposed `dc882f4` | UNKNOWN (לא) | view בלבד |
| 012 | `012_visit_report_amendments.sql` | תיקונים append-only | 007 (`_is_jwt_admin`) | proposed `eae40df` | UNKNOWN (לא) | rollback מוחק טבלה עם נתונים משפטיים — חייב ארכוב קודם |
| 013 | `013_patient_archive_and_record_export.sql` | ארכיון + ייצוא + יומן גישה | 012 | proposed `e8e8e07` | UNKNOWN (לא) | כנ"ל; הקליינט כבר קורא `export_patient_record` ← נכשל חי |
| 014 | **לא קיים** | — | — | אין | — | — |
| 015 | `015_block_physical_deletes.sql` | DELETE/TRUNCATE revoked, FK RESTRICT, יומנים immutable | 009, 012, 013 | **רק** `record-integrity-sql` `6146fea` | UNKNOWN (לא) | — |
| 016 | `016_visit_report_authorship_and_lock.sql` | מחבר + `locked_at`, מנהל=מחבר | 003, 008, 015 | `f9de70b` | UNKNOWN (לא) | backfill |
| 017 | `017_amendments_author_only.sql` | תיקון ע"י מחבר בלבד + `previous_values` | 012, 016, 015 | `a86d8c5` | UNKNOWN (לא) | — |
| 018 | **לא נכתב** ("planned" בהודעת commit) | ארכיון/ביטול במקום מחיקה | 013, 015 | אין קובץ | — | — |
- בדיקות מבודדות: `verify_proposed_sql.py` (`PROPOSED_ORDER` מקודד 001–013; יש להוסיף 015–018), `backend/tests_db` (174/174 על PG16+18 לפי מסמך ההעברה — לא הורץ מחדש בסשן הזה).
- **תהליך עתידי (באישור לכל שלב):** גיבוי מאומת ← `get_advisors` ← החלה ← post-flight ← `get_advisors` ← עדכון APPLIED.md. ללא כתיבה לחי בתכנון הזה.

## 9. מודלים ולוגיקה קלינית
| רכיב | נתיב | סוג | קלט→פלט | חסר/ספים | ראיה לאימות | טענה בממשק |
|---|---|---|---|---|---|---|
| סיווג מדד בודד | `predictive-service/main.py:70-116` (`classify_*`) | כלל דטרמיניסטי | ערך→green/yellow/red | ספים בקוד; בדיקות 17/17 | `CLINICAL_THRESHOLDS_FOR_REVIEW.md` | "מבוסס כללים — הדמיה" |
| הערכת סיכון | `main.py:266-290` | כללים + worst-of | מדדים+רקע+עישון→רמה, trend, `confidence=provided/6` | `no_data` כשאין מדדים | 4,816 תגובות אומתו מול חוזה (#28) | green="מצב תקין" |
| baseline/anomaly/decay | `clinical_baseline.py` | סטטיסטיקה קלאסית/היוריסטיקה | סדרה→baseline, אנומליה | 15%, −10%, 2×SD, `DECAY_WINDOW_HOURS` — **לא אומתו קלינית** | מסמך לסקירה | — |
| תחזית ליניארית/ARIMA | `main.py` + `timeseries.py:48` | סטטיסטי (statsmodels) | ARIMA≥8 נק', ליניארי≥2 | נחסם בהיסטוריה קצרה | — | "תחזית" |
| מסווגי עתיד | `ml_targets.py` (LR/DT/RF/KNN) | **שלד ML מפוקח, ללא artifacts** | — | תמיד `model_available=false` | `local_joblib_artifacts: []` | לא מוצג כמודל פעיל |
| LSTM | `lstm_interface.py` | **Placeholder** (`NotImplementedError`) | — | — | אין import ב-`main.py` | — |
| סטטוס טקסטואלי | `public/app.js:724-729` (לקוח) + `main.py` `CAREGIVER_STATUS_BY_LEVEL` (שרת) | כפילות טקסט | רמה→משפט | no_data בלקוח: "אין מספיק נתונים להערכה" | — | green="מצב תקין" |
**תלויות (VERIFIED):** `ml_targets` מיובא `main.py:13`, בשימוש `/predict/future-event`, `/train/*` ובלולאה ב-`/predict/medical-warning` (שנקרא מ-`admin.html:729`); `statsmodels` — ARIMA פעיל; `scikit-learn`/`joblib` רק דרך `ml_targets`. **מסקנה: אין הסרה.** `lstm_interface.py` ניתן להסרה טכנית אך מחויב בשימור ע"י `MODEL_PRESERVATION_BASELINE.json` + PROJECT_MAP → החלטת בעלים.
**כפילויות סיכון (SUSPECTED, טרם אופיינו):** 3 endpoints חופפים, `classify_*` מול `clinical_baseline.py`, טקסט סטטוס בלקוח ובשרת. **תוכנית אופיין:** מטריצת קלטים (כל מדד: null/גבול/מעל וללמטה, רקע, עישון, previous, horizon 8/24, זמן עם/בלי timezone) → שמירת golden JSON (כמו 4,816 התגובות של #28) → רפקטור → השוואה בייט-ל-בייט; כשל = ביטול. **אין שינוי ספים/נוסחאות/ניסוח קליני בלי אישור.**

## 10. ניקוי קוד וארכיטקטורה (רק אחרי אופיין)
- לא להסיר: `ml_targets.py`, `statsmodels`, `scikit-learn`, `joblib` (VERIFIED בשימוש).
- SMS: **כבוי** (`public/config.js:16` `SMS_LOGIN_ENABLED=false`; `[auth.sms] enable_signup=false`), קוד ב-`i18n.js` ~681–851 (`updateUser phone`, `verifyOtp`, `signInWithOtp`) ו-`my-bookings.html` (327 שורות). זהות מטופל היום: session אנונימי per-browser (`app.js:820`); SMS = מסלול ההתאוששות היחיד חוצה-מכשירים. **לא מסירים.** תנאי להחלטה: מיפוי RLS לפי `auth.uid()` ב-`bookings`/`visit_reports` + החלטת מוצר (להפעיל עם ספק+CAPTCHA, או להקפיא ולתעד).
- כפילות קליינט: sparkline ורנדררי תיק מטופל ב-`employee.html` ו-`patient-record.js` (SUSPECTED) → `public/js/shared/`.
- inline styles (employee 93, admin 52), 81 hex, `:root` כפול — SUSPECTED (grep).
- תיעוד: `docs/DATABASE.md` ו-`docs/RISK_ENGINE.md` **קיימים ב-PR #19** (לא ב-`main` עדיין) — תוקן לאחר בדיקה; ספירות CI בתיעוד לא עקביות.
- נעילת `pixeltable-pgserver` ב-`requirements-dev.txt`.
- לכל הסרה: grep כולל tests/CI/docs + golden tests + rollback (revert של PR) + אישור.

## 11. UX ונגישות (עקרון: רגוע, פשוט, קשה לטעות)
**בטיחות קלינית ב-UI (SUSPECTED, מדוח UX; דורש אימות בדפדפן):** `employee.html:375-377` — שאילתות רגישויות/התראות מתעלמות משגיאה (כשל נראה כ"אין"); ולידציית מדדים חוסמת ערכים קריטיים אמיתיים (`employee.html:555`, `admin.html:885`: systolic <50 או >250 — **VERIFIED שהחסימה קיימת**); תוצאת סיכון נכתבת למודאל שנסגר; ביקורים שעבר מועדם לא ב"העבודה שלי"; Escape/ביטול זורק דוח ללא אישור.
**נגישות/RTL:** `aria-describedby` לשגיאות, tablist semantics, תווית לקנבס חתימה, `dir="ltr"`/`<bdi>` למספרים, `text-align:start`, `role="alert"`, `prefers-reduced-motion` — שינויים שאינם משנים מראה.
**דורשים תצוגה מקדימה ואישור עיצוב:** החלפת `confirm()`, אימוג'י→SVG, כרטיסי טבלה בנייד, רמזי כפתור מושבת. **לא מוסיפים מורכבות ויזואלית.**
**שירות ללקוח:** `booking.html:241-243` בולע כשל טעינת שעות ("אין זמינות") — SUSPECTED.

## 12. אמינות הבדיקות (Test Reliability)
| הרצה | Checkout/commit | שרת | פקודה | תוצאה |
|---|---|---|---|---|
| Unit | `codex/predictive-response-contract` @ `536438f` | — | `node --test tests/unit/*.test.js` | **57/57** |
| Mocked e2e (18 קבצי spec, בלי booking/visit-report) | `536438f`, בהעתק ל-scratchpad | `http.server` על 8092, מגיש `<local path>` | `npx playwright test -c <scratchpad>/pw.config.js --workers=1` | **81 עברו, 1 נכשל** (`sw-update` — נתיב `__dirname` בהעתק) |
| במקום (in place) | `536438f` | webServer של התצורה | `npx playwright test tests/e2e/sw-update.spec.js tests/e2e/risk-server-side.spec.js tests/e2e/cross-patient-isolation.spec.js --workers=1 --output <scratchpad>` | **20/20 עברו** |
| backend | `536438f` / `a8607c7` (main+#28) | — | `pytest backend/tests` | **158 עברו** (בשני ה-checkouts) |
| predictive | `536438f` | — | `pytest` ב-`predictive-service` | **17 עברו** |
| CI #26 (`d53ca83`) | GitHub | — | workflow `ci.yml` | **הכול ירוק** |
| CI #28 | GitHub | — | `ci.yml` | `tests_db` 4 נכשלו (**סביבתי/PG16 — #20 מתקן**), השאר ירוק |
- הבדלה: **כשלי אפליקציה** — אין שנותרו; **כשלי harness** — `reuseExistingServer`+8080 קבוע (חשף 13 כשלי שווא; השרת הישן כבר לא רץ), נתיבי `__dirname` בהעתקים; **כשלי סביבה** — PG16/18 ב-CI.
- פערים: `cross-patient-isolation` ו-`trend-forecast` לא ב-CI; אין e2e ל-`offline-draft-signout`; `booking`/`visit-report` רצים רק ידנית מול DB ייעודי (עדיין לא קיים).
- טיוטות: הסט העצמאי `verify-drafts`/`verify-export` ו-`offline-draft-signout.spec.js` (בענף `offline-draft-safety`) — **NOT TESTED בסשן הזה**.

## 13. מפת דרכים בשלבים
### Phase 0 — ראיות ויושרת Baseline
- **מטרה:** אפס הונאה בתוצאות בדיקה; מקור יחיד לסוכנים/תיעוד.
- **ממצאים:** VERIFIED — שרת 8080 ישן נעלם, תצורה שבירה (`reuseExistingServer`, פורט קבוע); `CLAUDE.md`/`HANDOFF.md` על `main` מיושנים (תוקנו רק ב-`docs/session-handoff`). SUSPECTED — drift DB.
- **שינויים:** `playwright.config.js` — פורט/`reuseExistingServer:false`; מזהה גרסה בבדיקות; PR docs (CLAUDE/HANDOFF); סנכרון סוכנים מ-#23.
- **תלויות:** #20 ל-CI. **סיכון:** נמוך. **בדיקות:** הרצה כפולה (עם/בלי שרת ישן). **קבלה:** ריצת e2e אינה תלויה בשרת קיים; סוכנים — מקור יחיד.
- **אישור:** מיזוגים, PR docs. **PR:** `chore/test-harness`, `docs/handoff-sync`. **חוסם:** כן (לאמון בתוצאות).
### Phase 1 — בטיחות מטופל, אבטחה ושלמות נתונים
- **ממצאים:** B1, B2, B3, B4, B5, B6 (סעיף 5); audit חלקי; טיוטות plaintext; `export_patient_record` נכשל חי.
- **שינויים:** (א) PR `record-integrity-sql` + הרחבת `PROPOSED_ORDER`/ROLLBACK + כתיבת 018 ו-019 (סינון `is_my_patient`) **כהצעות בלבד**; (ב) UI: הסרת מחיקה פיזית (`staff.js:144`, `contacts.js:163`) → השבתה/ארכוב, `canAmend` לפי מחבר; (ג) תיעוד גיבוי/שחזור + תרגיל על פרויקט נפרד; (ד) Dashboard: MFA/סיסמה/CAPTCHA, החלפת סוד.
- **תלויות:** גיבוי מאומת לפני כל החלה. **סיכון:** גבוה ל-9/015/018 (שינוי FK). **בדיקות:** `tests_db` PG16+18, ניסיון DELETE/TRUNCATE כל תפקיד נחסם, היסטוריה שורדת, e2e תיקונים/ארכיון. **קבלה:** 100% tests_db; אין DELETE פיזי בממשק; שחזור מוכח עם זמן.
- **אישור:** כל מיגרציה בנפרד; כל פעולת Dashboard; מדיניות שמירה. **PR:** `feature/record-integrity-sql`, `fix/ui-no-physical-delete`, `feature/rls-active-patient-access`. **חוסם:** כן (רמות 2–3).
### Phase 2 — אמינות תהליכי ליבה
- **ממצאים:** #27 (409+same), מיפוי שגיאות (#25 מכסה), flush טיוטות רק ב-online, SW חסר `js/admin/*.js`, `/availability` נשמר ב-cache, 5xx טיוטה ללא הודעה/ללא מסלול סופי.
- **שינויים:** מיזוג #25/#27 לפי סדר; PR `offline-draft-safety`; SW; הודעות כשל; מסלול "נשמר לבדיקה ידנית" (בלי מחיקה, באישור).
- **בדיקות:** unit (60 עם #27), e2e `offline-draft-signout`, סט verify. **קבלה:** אין דוח שהושלם בלי הערכת סיכון/תור ניסיון; אין 500 ללא גוף; אף טיוטה לא נמחקת בלי אישור שרת.
- **אישור:** התנהגות טיוטות (קלינית-ארגונית). **PR:** ממוזגים/קיימים. **חוסם:** חלקי.
### Phase 3 — ניקוי ופישוט ארכיטקטורה
- **ממצאים:** כפילויות קליינט, inline styles, תיעוד חסר, נעילת תלות.
- **שינויים:** איחוד ל-`public/js/shared/`, `docs/DATABASE.md`+`RISK_ENGINE.md`, נעילת `pixeltable-pgserver`; **לא נוגעים** ב-`ml_targets`/statsmodels/SMS. **תנאי:** Phase 5 characterization קודם לכל איחוד לוגיקת סיכון.
- **קבלה:** golden diff אפס; אין שינוי התנהגות. **דחיינות:** כן.
### Phase 4 — UX, נגישות, איכות חזותית
- שינויים שאינם משנים מראה קודם; שינויי עיצוב רק אחרי תצוגה מקדימה. **קבלה:** axe ללא הפרות חמורות בדפי מטופל/צוות; בדיקת מקלדת וקורא מסך; RTL עברית/ערבית. **אישור:** כל שינוי נראה.
### Phase 5 — אימות מודלים ו-QA מקיף
- סקירה קלינית של `CLINICAL_THRESHOLDS_FOR_REVIEW.md` ע"י איש צוות רפואי; golden-master לכל ה-endpoints; הוספת `cross-patient-isolation`/`trend-forecast` ל-CI; ניסוח (`no_data`, green, אי-ודאות) — **רק באישור**. **קבלה:** שחזור פלטים זהה; מסמך אישור קליני חתום.
### Phase 6 — Release Engineering
- אירוח backend HTTPS + `BACKEND_URL`/CORS/CSP, שירות חיזוי מנוהל (היום ידני), לוגים ללא PII, ניטור/health, rollback, גרסת release מזוהה (`APP_BUILD`), תוכנית אירוע, מדיניות פרטיות. **רמות:** (1) אב-טיפוס מקומי — **מוכן בתנאים**; (2) פריסה עם נתונים סינתטיים — **דורש Phase 0–2**; (3) מטופלים אמיתיים — **NO-GO עד Phase 1,5,6 + אישור משפטי/קליני/אבטחתי חיצוני**.

## 14. רישום סיכונים
| סיכון | סבירות | חומרה | הפחתה |
|---|---|---|---|
| מחיקת רשומות בחי לפני החלת 008–017 | בינונית | קריטית | החלה מבוקרת + גיבוי; עד אז — אין נתונים אמיתיים |
| גישת צוות לתיק לאחר דחייה/ביטול | גבוהה (קוד) | גבוהה | 019 + החלטה קלינית מה "טיפול פעיל" |
| איבוד טיוטה/דוח באופליין | נמוכה-בינונית | גבוהה | Phase 2 + e2e |
| אי-התאמת גרסאות SW/APP_BUILD במיזוגים | גבוהה | נמוכה | תיאום מספרים בסדר מיזוג |
| הסרת תלות פעילה (ml/statsmodels/SMS) | בינונית אם ינקו אוטומטית | גבוהה | חסימה עד אישור |
| ניסוח "תקין" מטעה | בינונית | גבוהה קלינית | אישור צוות רפואי |
| תוצאות בדיקה מטעות (harness) | הופחת | בינונית | Phase 0 |
| drift בין קבצי migrations ל-DB החי | לא ידוע | גבוהה | קריאת קטלוג בלבד באישור |

## 15. מטריצת אישורים
| פעולה | אישור בעלים |
|---|---|
| תחילת מימוש | ✔ נדרש |
| מיזוג כל PR / push ל-main / פריסה | ✔ נפרד לכל אחד |
| החלת מיגרציה / כל כתיבה או קריאה בחי | ✔ נפרד, אחרי גיבוי |
| מחיקת קבצים/תלויות משמעותיים; הסרת SMS | ✔ |
| שינוי ספים/נוסחאות/ניסוח קליני | ✔ ובדיקה של איש צוות רפואי |
| שינוי שמירת רשומות/ארכוב; נתוני מטופלים אמיתיים | ✔ |
| שינוי עיצוב נראה | ✔ אחרי תצוגה מקדימה |
| הכרזת "מוכן קלינית" | ✔ + ראיות חיצוניות |

## 16. קריטריוני קבלה (מדידים)
- **P0:** אפס תלות בשרת קיים; 100% ריצות e2e זהות בשתי הרצות ברצף. **P1:** `tests_db` 100% על PG16+PG18; אפס DELETE/TRUNCATE מוצלח כ-authenticated על טבלאות קליניות; תרגיל שחזור מתועד (זמן, שלמות). **P2:** אפס 500 ללא גוף ידוע; אפס אובדן טיוטה בתרחישי ניתוק/409/5xx; אפס דליפת בידוד ב-14 הבדיקות + החלפות מהירות. **P3:** golden diff = 0, CI ירוק. **P4:** axe — 0 critical/serious; ניווט מקלדת מלא. **P5:** כל endpoint — פלט זהה ל-baseline; אישור קליני בכתב. **P6:** בדיקת rollback, health ו-alerts פעילים, גרסה מזוהה, מדיניות פרטיות.

## 17. רשימת Go / No-Go סופית
| פריט | רמה 1 (אב-טיפוס) | רמה 2 (סינתטי, פרוס) | רמה 3 (אמיתי) |
|---|---|---|---|
| מיגרציות 008–018 הוחלו ואומתו | — | ☐ | ☐ |
| אין DELETE פיזי על רשומות רפואיות | — | ☐ | ☐ |
| גיבוי+PITR+תרגיל שחזור | — | ☐ | ☐ |
| MFA/סיסמה/CAPTCHA/סוד הוחלף | — | ☐ | ☐ |
| בידוד מטופלים — בדיקות + דפדפן אמיתי | ✔ בדיקות | ☐ דפדפן | ☐ |
| CI ירוק (כולל isolation, a11y) | ☐ | ☐ | ☐ |
| מדיניות פרטיות/הסכמה/שמירה — משפטי | — | — | ☐ |
| סקירה קלינית של מודלים וניסוחים | — | ☐ | ☐ |
| בדיקת חדירה חיצונית | — | — | ☐ |
| אירוח HTTPS, ניטור, rollback | — | ☐ | ☐ |
| אישור בעלים כתוב | ☐ | ☐ | ☐ |
**סטטוס כעת:** רמה 1 — מוכן בתנאים; רמה 2 — **לא מוכן**; רמה 3 — **NO-GO**.

## 18. המלצה
**GO TO IMPLEMENTATION PLANNING** — מוגבל ל-Phase 0 ול-Phase 1 (הצעות SQL ושינויי UI בלבד) ול-Phase 2 הקיימים כ-PR-ים; כל השאר, וכן פריסה/מיגרציות/נתונים אמיתיים, נשארים תחת שערי האישור שלמעלה ותחת **NO-GO לרמה 3**.
