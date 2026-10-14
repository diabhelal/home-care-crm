# HANDOFF — מצב הפרויקט ומה הלאה

> קובץ מעבר בין שיחות. מקור האמת לקוד הוא git; לתהליך הפריסה — [DEPLOY.md](./DEPLOY.md).
> עודכן: 2026-10-15.

## איפה אנחנו
- **מוצר:** אב-טיפוס עובד, מוכן להפצה כ**הדגמה בלבד** (נתונים סינטטיים). לא שירות לטיפול רפואי אמיתי.
- **DB (Supabase `qqeupktyadjxqoxkstnl`):** פעיל, 17 טבלאות, 15 מיגרציות רשומות. נתונים סינטטיים: 20 מטופלים, 6 צוות, 29 הזמנות, 12 דוחות ביקור.
- **עיצוב:** סבב תיקון ב-2026-10 החזיר מראה רפואי רגוע (פלטה קרירה, Heebo, כפתורים 44px+).
- **נגישות:** סבב WCAG 2.2 AA בוצע (ר' git log).
- **הדגמה:** `DEMO_MODE` ב-`public/config.js`, באנר + `demo-notice.html`, `robots.txt` ו-`X-Robots-Tag: noindex`.

## חוקים קבועים (אל תעקוף)
1. **אסור להריץ** `tests/e2e/booking.spec.js` ו-`tests/e2e/visit-report.spec.js` מול ה-DB החי. הם `workflow_dispatch` בלבד ודורשים פרויקט בדיקות נפרד. (בשיחה הקודמת הורצו בטעות; לא נכתבו נתונים, אך נוצרו משתמשי אורח.)
2. **`supabase config push` דורס את כל מקטע `[auth]`** — הגדרות Auth נעשות ידנית בדאשבורד.
3. שינוי סכמה: `execute_sql` ← `get_advisors` ← migration מאושר ← קובץ migration מקומי עם אותה גרסה. מציגים SQL ומחכים לאישור.
4. אין סודות בקוד/ב-git. `keys.txt` מוחרג. מפתח `service_role` לעולם לא בקליינט.
5. שינוי בקבצי קליינט סטטיים ← להעלות `CACHE_VERSION` ב-`public/service-worker.js`.
6. לפני push: `git status`, סריקת סודות על ה-diff, אישור שאין מיגרציות/נתוני מטופלים אמיתיים.

## מה נשאר
**להוצאת הדגמה לאוויר (DEPLOY.md):**
- [ ] פרויקט Cloudflare Pages (`public/`), דומיין.
- [ ] Supabase: Site URL / Redirect URLs, Leaked password protection, תוכנית בתשלום, בדיקת CORS של `create-staff-login`.
- [ ] CSP: לוודא שאין הפרות ב-DevTools ולהחליף `Content-Security-Policy-Report-Only` ל-`Content-Security-Policy` ב-`public/_headers`.
- [ ] משתמש מנהל להדגמה (דרך דאשבורד, `is_admin` דרך Admin API/SQL).

**לשירות אמיתי (לא בהיקף ההדגמה):** מדיניות פרטיות ותנאי שימוש (ייעוץ משפטי, תיקון 13), אירוח שירות התחזית או הסרתו, ספק SMS + MFA, סביבת staging נפרדת, ניטור וגיבויים, בדיקת חדירה.

## איך מפעילים מקומית
```
cd public && python3 -m http.server 8080
cd predictive-service && source .venv/bin/activate && uvicorn main:app --reload --port 8000
node --test tests/unit/*.test.js
npx playwright test tests/e2e/xss-escaping.spec.js tests/e2e/my-work-pagination.spec.js tests/e2e/booking-taken-slots.spec.js tests/e2e/sw-update.spec.js tests/e2e/overhaul-regressions.spec.js
```
