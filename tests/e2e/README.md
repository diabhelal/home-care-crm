# E2E — הפעלה

יש כאן 12 קבצי בדיקה, משני סוגים:

**בטוחים — לא נוגעים ב-DB חי בכלל (supabaseClient ממוקק), רצים אוטומטית ב-CI בכל push:**
- `xss-escaping.spec.js`
- `my-work-pagination.spec.js`
- `booking-taken-slots.spec.js`
- `staff-convenience.spec.js` — נוחות הזמנה למטופל על fake supabase-js: שורת "הזמינות הקרובה" בכרטיסי הצוות, סינון לפי תפקיד ויום, וכפתור "הזמן שוב" ב-my-bookings שמעביר ל-booking עם איש הצוות והמטרה.
- `new-booking-notification.spec.js` — התראת הזמנות חדשות בתוך האפליקציה (צוות + מנהל) על fake supabase-js: באנר לפי lastSeen, מונה ותחילית כותרת, "סימון כנקרא", ובלי באנר כשאין הזמנות.
- `overhaul-regressions.spec.js` — רגרסיות מסריקת QA אחרי ה-design/UX overhaul (היסטוריית "העבודה שלי" כוללת ביקורים שהושלמו היום; באנר זמינות השירות לא מכסה את כפתורי ההדר)
- `patient-account.spec.js` — חשבון אופציונלי (אימייל+סיסמה) על fake supabase-js: שדרוג אורח שומר הזמנות, כניסה ממכשיר שני, התנתקות, מספר הזמנה ושלבי סטטוס, והזמנה כאורח בלי חשבון.
- `demo-journey.spec.js` — מסע ההדגמה המלא מקצה לקצה על fake supabase-js stateful (בלי DB חי): מטופל (דף בית -> צוות -> הזמנה -> אישור -> "ההזמנות שלי"), צוות (כניסה -> "העבודה שלי" -> התחלת ביקור -> דוח עם מדדים -> היסטוריה), מנהל (כניסה -> תור עבודה -> ביטול -> סטטוס "בוטל"). בודק גם באנר הדגמה, אפס שגיאות קונסול ואפס בקשות ל-localhost:8000. שומר צילומי מסך ל-`docs/demo-proof/`.
- `backend-booking.spec.js` — מסלול ההזמנה מול ה-backend (FastAPI) ממוקק ב-route interception (`helpers/backend-mock.js`) + fake Supabase (`helpers/fake-supabase.js`): שירות קודם -> בקשה "התבקש וממתין לאישור" (לא "אושר"), backend נופל = הודעת כשל ללא פאנל אישור וללא הזמנה, `BACKEND_URL` ריק = "שירות אינו זמין", 409 משבצת נתפסה + טעינת שעות מחדש, Idempotency-Key זהה בניסיון חוזר, אישור/דחייה/שיבוץ מחדש ע"י מנהל, ואפס כתיבה ישירה ל-`bookings` מהדפדפן (`__write_log`).
- `sw-update.spec.js` — acceptance test אמיתי למחזור החיים של ה-Service Worker: worker חדש לא משתלט אוטומטית על לשונית פתוחה עם JS ישן בזיכרון (אין `skipWaiting` אוטומטי), מוצג באנר "גרסה חדשה זמינה" כשיש worker חדש ב-waiting, ורק לחיצה מפורשת מפעילה עדכון+רענון מבוקר. רץ על עותק זמני של `public/` (לא על הפרויקט האמיתי) כדי לדמות דיפלוי חדש בפועל (שינוי אמיתי בבייטים של `service-worker.js`).

**נוגעים ב-DB חי — יוצרים הזמנות/דוחות אמיתיים, לא רצים אוטומטית בכוונה:**
- `booking.spec.js` — רץ תמיד (כשמריצים ידנית), דורש רק שיהיה לפחות איש/אשת צוות פעיל/ה אחד/ת בפרויקט הבדיקה עם זמינות פנויה.
- `visit-report.spec.js` — **מדלג אוטומטית** אם `E2E_STAFF_EMAIL`/`E2E_STAFF_PASSWORD` לא הוגדרו כמשתני סביבה (לעולם לא hardcoded בקוד):
  ```
  E2E_STAFF_EMAIL=nurse@test.example E2E_STAFF_PASSWORD=... npm run test:e2e
  ```

⚠️ **לפני הרצת 2 הקבצים האלה**: ודא ש-`public/config.js` מצביע על פרויקט Supabase **ייעודי לבדיקות**, לא על הפרויקט האמיתי (`qqeupktyadjxqoxkstnl`).

## התקנה חד-פעמית
```
npm install
npx playwright install chromium
```

## הרצה
```
npm run test:e2e                                    # כל הקבצים
npx playwright test tests/e2e/xss-escaping.spec.js   # קובץ בודד
```

## ב-CI
`.github/workflows/ci.yml` מפצל את זה לשני jobs: `e2e-safe` (הקבצים הבטוחים, רץ אוטומטית בכל push) ו-`e2e-live-db` (2 הקבצים שנוגעים ב-DB, `workflow_dispatch` ידני בלבד).

## סטטוס — כנות לגבי מה שבוצע ומה שלא
`booking.spec.js`/`visit-report.spec.js` נכתבו מול הקוד/ה-selectors האמיתיים בפרויקט (לא ניחוש) ועברו בדיקת syntax (`node --check`).
**הם לא הורצו בפועל עד הסוף** — כי זה דורש פרויקט Supabase נפרד לבדיקות (עם דאטה סינתטית תקנית) שאין היום, והרצה מול הפרויקט האמיתי הייתה יוצרת הזמנות/דוחות מזויפים בדאטה אמיתית. זו החלטה שרק המשתמש/ת יכול/ה לקחת (ליצור פרויקט בדיקה נפרד, או לקבל שהטסטים ירוצו מול production בזהירות).

שלושת הקבצים הבטוחים (`xss-escaping.spec.js`, `my-work-pagination.spec.js`, `booking-taken-slots.spec.js`) **כן רצים בפועל** (מקומית וב-CI) ועוברים — הם לא תלויים ב-DB בכלל.
