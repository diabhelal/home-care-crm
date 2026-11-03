// התנתקות עם טיוטות לא-מסונכרנות: אישור בעברית עם הספירה, ביטול משאיר בעמוד, ואישור לא מוחק את הטיוטות.
// fake supabase-js + backend ממוקק; אפס DB חי.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const LEGACY_KEY = "visitReportOfflineQueue";

async function open(browser) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, serviceWorkers: "block" });
  await context.route("**/@supabase/supabase-js@*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await installBackendMock(context);
  const page = await context.newPage();
  await page.goto(BASE + "/index.html");
  await page.evaluate((key) => {
    localStorage.setItem("__demo_session", JSON.stringify({ user: { id: "staff-user-1", is_anonymous: false, app_metadata: {} } }));
    localStorage.setItem(key, JSON.stringify([{ booking_id: 1, patient_id: "p-1", treatment_summary: "x" }]));
    localStorage.setItem(key + ":unreadable:123", "{broken");
  }, LEGACY_KEY);
  await page.goto(BASE + "/employee.html");
  await expect(page.locator("#staff-app")).toBeVisible();
  return page;
}

test("התנתקות עם טיוטות: ביטול משאיר בעמוד, והטיוטות לא נמחקות", async ({ browser }) => {
  const page = await open(browser);
  const banner = page.locator("#offline-draft-banner");
  await expect(banner).toContainText("טיוטות ישנות");
  await expect(banner).toContainText("גיבויי טיוטה");
  await expect(page.locator("#export-drafts-btn")).toBeVisible();

  let message = "";
  page.once("dialog", async (d) => { message = d.message(); await d.dismiss(); });
  await page.locator("#staff-logout-btn").click();
  expect(message).toContain("2 טיוטות");
  expect(message).toContain("לא תמחק");
  await expect(page.locator("#staff-app")).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k) !== null, LEGACY_KEY)).toBe(true);
});

test("התנתקות עם טיוטות: אישור מנתק אך הטיוטות נשארות במכשיר", async ({ browser }) => {
  const page = await open(browser);
  page.once("dialog", (d) => d.accept());
  await page.locator("#staff-logout-btn").click();
  await page.waitForURL(/employee-login\.html/);
  expect(await page.evaluate((k) => localStorage.getItem(k) !== null && localStorage.getItem(k + ":unreadable:123") === "{broken", LEGACY_KEY)).toBe(true);
});
