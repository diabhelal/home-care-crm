# E2E — הפעלה

יש כאן 5 קבצי בדיקה, משני סוגים:

**בטוחים — לא נוגעים ב-DB חי בכלל (supabaseClient ממוקק), רצים אוטומטית ב-CI בכל push:**
- `xss-escaping.spec.js`
- `my-work-pagination.spec.js`
- `booking-taken-slots.spec.js`
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
npm run test:e2e                                    # כל 5 הקבצים
npx playwright test tests/e2e/xss-escaping.spec.js   # קובץ בודד
```

## ב-CI
`.github/workflows/ci.yml` מפצל את זה לשני jobs: `e2e-safe` (3 הקבצים הבטוחים, רץ אוטומטית בכל push) ו-`e2e-live-db` (2 הקבצים שנוגעים ב-DB, `workflow_dispatch` ידני בלבד).

## סטטוס — כנות לגבי מה שבוצע ומה שלא
`booking.spec.js`/`visit-report.spec.js` נכתבו מול הקוד/ה-selectors האמיתיים בפרויקט (לא ניחוש) ועברו בדיקת syntax (`node --check`).
**הם לא הורצו בפועל עד הסוף** — כי זה דורש פרויקט Supabase נפרד לבדיקות (עם דאטה סינתטית תקנית) שאין היום, והרצה מול הפרויקט האמיתי הייתה יוצרת הזמנות/דוחות מזויפים בדאטה אמיתית. זו החלטה שרק המשתמש/ת יכול/ה לקחת (ליצור פרויקט בדיקה נפרד, או לקבל שהטסטים ירוצו מול production בזהירות).

שלושת הקבצים הבטוחים (`xss-escaping.spec.js`, `my-work-pagination.spec.js`, `booking-taken-slots.spec.js`) **כן רצים בפועל** (מקומית וב-CI) ועוברים — הם לא תלויים ב-DB בכלל.
