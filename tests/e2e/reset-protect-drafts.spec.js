// reset.html: הגנה על טיוטות דוחות שלא סונכרנו. בלי טיוטות - ניקוי אוטומטי והפניה; עם טיוטות -
// אזהרה עם מספר מדויק, בלי הפניה אוטומטית, גיבוי JSON, והדף לא כותב ולא מוחק מפתחות. אפס רשת/DB.
const { test, expect } = require("@playwright/test");
const fs = require("fs");

const BASE = "http://demo.localhost:8080";

async function open(browser) {
  const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  const page = await context.newPage();
  return { context, page };
}
async function seed(page, data) {
  await page.goto(BASE + "/styles.css"); // אותו origin, בלי להריץ את reset.html
  await page.evaluate((d) => { localStorage.clear(); for (const k in d) localStorage.setItem(k, d[k]); }, data);
}
const snapshot = (page) => page.evaluate(() => {
  const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
  return o;
});

test("בלי טיוטות: ניקוי אוטומטי והפניה לאתר", async ({ browser }) => {
  const { context, page } = await open(browser);
  await seed(page, { unrelated: "x" });
  await page.goto(BASE + "/reset.html");
  await expect(page.locator("#status")).toContainText("בוצע");
  await expect(page.locator("#drafts-warning")).toBeHidden();
  await page.waitForURL(/index\.html/, { timeout: 5000 });
  await context.close();
});

test("עם טיוטות: אזהרה עם מספר, בלי הפניה, גיבוי, ובלי שינוי ב-localStorage", async ({ browser }) => {
  const { context, page } = await open(browser);
  const data = {
    "visitReportOfflineQueue:u1": JSON.stringify([{ id: 1 }, { id: 2 }]),
    "visitReportOfflineQueue": JSON.stringify([{ id: 3 }]),
    "visitReportOfflineQueue:unreadable:123": "{not json",
    other: "keep",
  };
  await seed(page, data);
  const before = await snapshot(page);
  await page.goto(BASE + "/reset.html");
  await expect(page.locator("#drafts-text")).toContainText("4 טיוטות");
  await expect(page.locator("#drafts-warning")).toContainText("אל תנקו נתוני אתר");
  await page.waitForTimeout(2000);
  expect(page.url()).toContain("reset.html");

  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#backup-btn")]);
  const backup = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  expect(Object.keys(backup.localStorage).sort()).toEqual(
    ["visitReportOfflineQueue", "visitReportOfflineQueue:u1", "visitReportOfflineQueue:unreadable:123"]);
  expect(backup.localStorage["visitReportOfflineQueue:u1"]).toBe(data["visitReportOfflineQueue:u1"]);
  expect(backup.localStorage["visitReportOfflineQueue:unreadable:123"]).toBe("{not json");

  await page.click("#continue-btn");
  await expect(page.locator("#status")).toContainText("בוצע");
  await expect(page.locator("#go")).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await context.close();
});

test("ערך פגום נספר כפריט אחד", async ({ browser }) => {
  const { context, page } = await open(browser);
  await seed(page, { "visitReportOfflineQueue:u2": "garbage{" });
  await page.goto(BASE + "/reset.html");
  await expect(page.locator("#drafts-text")).toContainText("1 טיוטות");
  await context.close();
});
