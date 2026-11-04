# SESSION HANDOFF — נקודת שמירה לסשן הבא

> **עדכון 2026-11-04 (בסוף הסשן):** המצב העדכני של כל הענפים וה-PR-ים (#18–#33), סטטוס CI, סדר מיזוג, תיאום `CACHE_VERSION` ומה עדיין פתוח נמצא ב-[`docs/REPO_STATUS.md`](REPO_STATUS.md) (על ענף #19). המסמך הזה נשאר כתיעוד של נקודת העצירה הקודמת; #20 מוזג, וההצעות 015–019 נמצאות ב-PR #30 (לא הוחלו).


> נכתב ב-2026-11-04. מקור האמת לקוד הוא Git. **שום דבר לא מוזג ל-`main`, לא נפרס, ולא בוצעה כתיבה ל-DB החי (Supabase `qqeupktyadjxqoxkstnl`) בסשן הזה** (קריאות קטלוג/ספירות בלבד). אין סודות או נתוני מטופלים במסמך.
> קרא קודם: `CLAUDE.md`, `HANDOFF.md`, ואת הקובץ הזה.

## 1. מצב בקצרה
אב-טיפוס עם נתונים סינתטיים, **לא מוכן למטופלים אמיתיים**. בסשן הזה: נבנה מערך סוכנים, תוקן באג אמיתי בכפתור התחזית, בוצעה חקירה היסטורית ואימות שלמות רשומות, והוכנו 6 קבוצות תיקונים בענפים נפרדים. לפי החלטת הבעלים: **איש הצוות הוא הסמכות העליונה על התוכן הרפואי; AI/סוכנים הם כלי עזר בלבד ונדרש אישור איש צוות; אין מחיקה פיזית של תיעוד רפואי (ארכוב בלבד); רק הכותב המקורי מתקן, בתיקון חדש שלא דורס את המקור; מנהל שמתעד ביקור הוא הכותב שלו.**

## 2. PR-ים פתוחים (כולם ירוקים, **אף אחד לא מוזג**)
| PR | ענף | תוכן | CI |
|---|---|---|---|
| #20 | `fix/ci-postgres-restrict-violation` | בדיקות DB מקבלות `ForeignKeyViolation` (PG≤17) לצד `RestrictViolation` (PG18) + נעילת RESTRICT בקטלוג + בדיקת הישרדות | ✅ |
| #22 | `feature/trend-forecast-button-fix` | כפתור "תחזית מגמת מדדים": בידוד בין מטופלים, כשל שירות לא נבלע, תיוג הדגמה (+ מיזוג #20) | ✅ |
| #23 | `feature/agents-framework` | מערך הסוכנים (`.claude/agents`, `.claude/settings.json`, skill `lessons-learned`, `docs/AGENT_TEAM.md`) (+ מיזוג #20) | ✅ |
| #24 | `feature/predictive-input-and-wording` | NaN/Infinity -> 422; "ניתוח מדדים ומגמות (הדגמה)"; "אין נתונים" ≠ "תקין"; גרסת מטמון v50 | ✅ |
| #25 | `feature/backend-booking-reliability` | מיפוי 23505 מדויק, handlers ל-409/502, `list_patient_reports` newest-first + `limit=500`, לוגים (בלי PII) | ✅ |
| #18/#19/#21 | ישנים | סיכום AI / תיעוד / ארכוב תוכניות | לא נבדקו הסשן |
**סדר מיזוג מומלץ (החלטת הבעלים, אישור נפרד לכל מיזוג):** #20 ← #22 ← #23 ← #24 ← #25. אחרי כל מיזוג: לעדכן את הבאים מול `main` ולוודא CI ירוק. צפויים קונפליקטים קטנים בשורות `CACHE_VERSION` (`public/service-worker.js`) ו-`APP_BUILD` (`public/config.js`): #22=v49, #24=v50, הטיוטות צריכות v51, בידוד v52.

## 3. ענפים שנדחפו **בלי PR** (עבודה שמורה ב-GitHub)
| ענף | מצב | בדיקות | מה חסר |
|---|---|---|---|
| `feature/offline-draft-safety` | מוכן | יחידות 74/74; סט אימות עצמאי 21/21 + ייצוא 7/7 (בקבצים ב-`docs/session-artifacts/`); דפדפן 57/57 (לפני התיקונים האחרונים); ביקורת אבטחה: PASS WITH CONDITIONS, התנאים תוקנו | להעלות `CACHE_VERSION` (v51) ו-`APP_BUILD`, להריץ Playwright ברצף (כולל `offline-draft-signout.spec.js` שלא הורץ), לפתוח PR |
| `feature/record-integrity-sql` | מוכן כהצעה | `tests_db` 174/174 על Postgres 18.4 **ו-16.14**; `verify_proposed_sql.py` OK | מיגרציות 015–017 **לא מוחלות**; חסר 018 (ארכיון/ביטול) וכל שינויי הממשק; לפתוח PR |
| `feature/cross-patient-isolation` | **WIP** | `tests/e2e/cross-patient-isolation.spec.js`: **12/14 עוברות** | 2 בדיקות כותרת תיק מטופל נכשלות: חסר guard (`StaleRecordError` + בדיקת `window.currentPatientState` אחרי כל `await` ב-`prCached` של `app.js`, `openPatientRecord`/`prRenderHeader`/`prSwitchTab` ב-`public/js/admin/patient-record.js` ובתאום ב-`employee.html`); לשים לב: נשארו awaits ישירים בלשוניות (למשל baseline ב-vitals). אחרי תיקון: bump v52 ופתיחת PR (מבוסס על #22) |

## 4. מה נעשה בסשן (תמצית)
- **כפתור התחזית:** נמצא ושוחזר מרוץ (תוצאת מטופל א' בדוח של ב'); תוקן ב-#22 עם 13 בדיקות.
- **חקירה היסטורית** (הריפו מתחיל ב-2026-09-04): מ-15.10 (28 commits) הוכנס שרת Python (backend) שדרכו עוברות כל כתיבות ההזמנה והביקור, ובלעדיו הכפתורים האלה נכשלים בכוונה (לפני כן כתבו ישירות ל-Supabase). **רגרסיה מוכחת יחידה:** `guardPredictiveServiceFetch` (62f550d) הפך כשל שירות להודעה מטעה. כל שאר הליקויים (כתיבות מאוחרות בין מטופלים, טיוטות בטקסט גלוי, NaN, מחיקות) **קיימים מראש** בכל הגרסאות שנבדקו (18.9, 26.9, 15.10, main).
- **כשל CI:** `pixeltable-pgserver` לא נעול (`>=0.3`): 0.6.0 = Postgres 18, 0.7.1 = Postgres 16.14 (`RESTRICT` -> 23503 במקום 23001). ההגנה תקינה. **מומלץ לנעול גרסה** ב-`backend/requirements-dev.txt` (לא בוצע).
- **שחזורים ממוקקים שהוכחו:** באנר רגישויות, `vrPatientContext`, פאנל סיכון, כותרת תיק, "אבחון מקיף" (כולם מרוץ), טיוטות בטקסט גלוי, מפתח משותף, 200 ריק מוחק טיוטה, NaN ב-API.

## 5. סיכונים פתוחים
1. **ה-DB החי ללא ההגנות:** `authenticated` יכול `DELETE` על `visit_reports` ועוד 10 טבלאות; FK ב-CASCADE (מחיקת איש צוות מוחקת דוחות); מיגרציות 008–013 לא הוחלו. הגנה = מיגרציות 015–017 (+008–013) באישור, אחת-אחת.
2. **בידוד בין מטופלים לא הושלם** (תיק מטופל). העמודים הפעילים עדיין חשופים.
3. טיוטות עדיין plaintext ב-localStorage (הצפנה/TTL: תכנון בלבד ב-`docs/OFFLINE_DRAFTS.md`, דורש אישור כי עלול לגרום לאובדן).
4. admin מסנכרן טיוטות ישנות (מפתח משותף) של צוות אחר; דוחות ישנים בלי מחבר (`auth_user_id` ריק) לא יהיו ניתנים לתיקון אחרי 017. **החלטות בעלים.**
5. הלקוח (`public/app.js`) ממפה 500/502 להודעה גנרית ולא מציג `detail` (MEDIUM-4 ב-#25).
6. השרת מחזיר "מצב תקין" לירוק (`CAREGIVER_STATUS_BY_LEVEL`); הממשק של "ניתוח המדדים" מסתיר אותו אך פאנלים אחרים לא.
7. GitHub דיווח על חולשה קריטית אחת בענף ברירת המחדל (Dependabot). לא נבדקה.
8. כללי `ask` ב-`.claude/settings.json` לא נבדקו בפועל; `settings.local.json` הוא per-machine.
9. ב-DB החי כרגע 25 מטופלים, 6 צוות, 33 הזמנות, 14 דוחות (ספירה בלבד); הבעלים טען שהסינתטיים נמחקו, **סתירה לא נפתרה**. אין לכתוב נתוני בדיקה לפרויקט החי.
10. `CLAUDE.md` על `main` עדיין מכיל את הוראת ה-push הישנה ל-`main`; ההוראה בתוקף: ענף + PR.

## 6. הצעדים הבאים (לפי סדר)
1. לסיים בידוד בתיק המטופל (סעיף 3), להעלות v52, לפתוח PR.
2. לטיוטות: v51, Playwright ברצף, PR. לשלמות רשומות: PR + שינויי ממשק (הסרת כפתורי מחיקה ב-`public/js/admin/staff.js` ~144 ו-`contacts.js` ~163; הסתרת טופס תיקון ממי שאינו המחבר; הצגת מחבר/ארכיון/ביטול; העלאות storage בלי upsert) + 018.
3. לטפל ב-MEDIUM-4 בלקוח; לנעול `pixeltable-pgserver`.
4. לבקש מהבעלים: מיזוג #20..#25; החלת מיגרציות (008–013 ואז 015–017, עם גיבוי ו-`get_advisors`); החלטות בסעיף 5.4.

## 7. איך להריץ ולבדוק
- שרתים: `cd public && python3 -m http.server 8080` | `cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8001 --env-file .env` | `cd predictive-service && source .venv/bin/activate && uvicorn main:app --port 8000`. (אם הדפדפן מגיש ישן: `/reset.html`.)
- בדיקות: `node --test tests/unit/*.test.js`; `ls tests/e2e/*.spec.js | grep -vE "/(booking|visit-report)\.spec\.js$" | xargs npx playwright test --workers=1` (**ברצף בלבד**, פורט 8080 קבוע; מקבילי נכשל אקראית גם על `main`; לא להריץ `booking`/`visit-report` מול ה-DB החי); `cd backend && pytest -q --ignore=tests_db && pytest tests_db -q` — להריץ גם עם Postgres 16 (venv עם `pixeltable-pgserver==0.7.1`).
- כלי אימות עצמאיים (נוצרו בסשן, ב-`docs/session-artifacts/`): `verify-drafts.test.js` + `verify-export.test.js` (`APP_JS=/path/app.js node --test ...`), `cross-patient.spec.js`/`drafts.spec.js`/`trend-race.spec.js` (שחזורים; נועדו לספריית Playwright חיצונית), `run_version.js` (אותם תרחישים על גרסאות ישנות), `fk_experiment.py`, `nan_check.py`, `trend-button-remediation-proposal.md`.

## 8. גיבויים ושימור
- חבילת git מלאה לפני התיקונים: `~/Documents/home-care-crm-archive/system-backup-2026-11-03-before-remediation.bundle`; חבילה נוספת בסוף הסשן: `.../system-backup-2026-11-04-session-end.bundle` (כל הענפים); תווית מקומית `backup/main-before-remediation-2026-11-03`.
- ענפי העבודה כולם ב-GitHub. תיקיות `.claude/worktrees/agent-*` ו-`scratchpad/wt-*` הן עותקי עבודה זמניים; כל תוכנם ב-commits שנדחפו.

## 9. אילוצים קבועים
בלי מיזוג/פריסה/כתיבה ל-DB החי/מיגרציות על החי ללא אישור מפורש; בלי push ל-`main`; בלי מחיקת רשומות או טיוטות; בלי שינוי נוסחאות קליניות וספים; בלי סודות בגיט; ענף ו-PR לכל שינוי; לדווח במפורש על כשלים; להפריד הוכח מהשערה.
