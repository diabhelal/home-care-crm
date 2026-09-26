// Acceptance test: משתמש/ת עם Service Worker פעיל מגרסה קודמת מקבל/ת התראת
// "גרסה חדשה זמינה" ועובר/ת לגרסה החדשה בלחיצה — בלי מחיקת cache ידנית, ובלי
// activation אגרסיבי (skipWaiting אוטומטי) שיכול לשבור לשונית פתוחה עם JS ישן
// בזיכרון. זו בדיוק הבעיה שגרמה לבלבול חוזר בשיחה הזו ("לא רואה שינויים") —
// המבחן הזה קיים כדי שזה לא יקרה שוב בלי שיתפס באופן אוטומטי.
//
// עובד על עותק זמני של public/ (לא על הפרויקט האמיתי) כי הטסט צריך לשנות בפועל
// את service-worker.js "בין גרסאות" כדי לדמות דיפלוי חדש.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const PORT = 8097;
let tmpDir, serverProc;

function startStaticServer(dir, port) {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", ["-m", "http.server", String(port)], { cwd: dir });
    const onErr = (d) => { if (String(d).includes("Address already in use")) reject(new Error("port busy")); };
    proc.stderr.on("data", onErr);
    setTimeout(resolve, 600);
    proc.on("error", reject);
    serverProc = proc;
  });
}

async function mockSupabaseCdn(page) {
  await page.route("**/@supabase/supabase-js@2", (route) => {
    route.fulfill({
      contentType: "application/javascript",
      body: `window.supabase = { createClient: () => ({
        auth: { getSession: () => Promise.resolve({ data: { session: null } }), signInAnonymously: () => Promise.resolve({ data: { user: { id: "u1" } }, error: null }) },
        from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
      }) };`,
    });
  });
}

test.beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-update-test-"));
  const srcPublic = path.join(__dirname, "..", "..", "public");
  fs.cpSync(srcPublic, tmpDir, { recursive: true });
  await startStaticServer(tmpDir, PORT);
});

test.afterAll(() => {
  if (serverProc) serverProc.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Service Worker: worker חדש לא משתלט אוטומטית על לשונית פתוחה, ומציג באנר עדכון עד שהמשתמש/ת מבקש/ת לרענן", async ({ page }) => {
  await mockSupabaseCdn(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // 1) ביקור ראשון — רישום SW ראשוני. בשלב הזה אסור להופיע שום באנר עדכון (אין
  // "גרסה קודמת" להחליף) ואסור לקרות reload לא-רצוני (זה בדיוק ה-regression שנתפס).
  const navigations = [];
  page.on("framenavigated", (f) => navigations.push(f.url()));
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== undefined);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(300);
  expect(navigations.length).toBeLessThanOrEqual(1); // אין reload עצמי בביקור ראשון

  // 2) לוודא שהעמוד בפועל נשלט ע"י ה-SW (reload פשוט אחד כדי להיכנס לשליטה)
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect(page.locator("#sw-update-banner")).not.toBeVisible();
  navigations.length = 0; // מעכשיו סופרים רק ניווטים לא-מכוונים; ה-reload הידני למעלה כבר נספר

  // 3) מדמים דיפלוי חדש: קובץ SW משתנה בפועל על הדיסק (לא רק CACHE_VERSION —
  // הדפדפן מזהה "worker חדש" לפי diff בייטים של הקובץ עצמו)
  const swPath = path.join(tmpDir, "service-worker.js");
  const swContent = fs.readFileSync(swPath, "utf8");
  fs.writeFileSync(swPath, swContent.replace("home-care-crm-shell-v4", "home-care-crm-shell-v4-TEST-NEXT"));

  // 4) מכריחים בדיקת עדכון (בדפדפן אמיתי זה קורה אוטומטית בניווטים הבאים)
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg.update();
  });

  // 5) הבאנר חייב להופיע — זו הדרישה המרכזית: לא activation שקט, לא ניחוש
  // hard-refresh מהמשתמש/ת
  await expect(page.locator("#sw-update-banner")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#sw-update-btn")).toBeVisible();

  // 6) הלשונית עדיין לא אמורה להירענן לבד — רק אחרי לחיצה מפורשת
  expect(navigations.length).toBe(0);

  // 7) לחיצה על "רענון עכשיו" → controllerchange → reload יחיד, מבוקר
  const navPromise = page.waitForEvent("framenavigated", { timeout: 10000 });
  await page.click("#sw-update-btn");
  await navPromise;
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.readyState === "complete");

  // 8) אחרי הרענון: cache ישן נמחק, הגרסה החדשה פעילה
  const cacheKeys = await page.evaluate(() => caches.keys());
  expect(cacheKeys).toContain("home-care-crm-shell-v4-TEST-NEXT");
  expect(cacheKeys).not.toContain("home-care-crm-shell-v4");

  expect(errors).toEqual([]);
});
