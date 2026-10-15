// רגרסיה: הגעה מכפתור "לתיאום ביקור" (בלי שירות שנבחר מראש) לא נתקעת, ורענון שעות אחרי
// הקלדת כתובת לא מחליף את כפתורי השעות (לחיצה לא הולכת לאיבוד). ממוקק, בלי DB חי.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";

async function setup(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.route("**/@supabase/supabase-js@2", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await installBackendMock(context);
  return { context, page: await context.newPage() };
}

test("מכפתור 'לתיאום ביקור': שירות ברירת מחדל נבחר, ולחיצה על שעה חושפת שם/ת\"ז/טלפון ומאפשרת אישור", async ({ browser }) => {
  const { context, page } = await setup(browser);
  await page.goto(BASE + "/index.html");
  await page.locator("a.hero-cta").click();
  await page.waitForURL(/booking\.html$/);

  await expect(page.locator("#purpose-chips .chip.selected")).toHaveCount(1);          // ברירת מחדל
  await expect(page.locator(".date-pill.selected")).toHaveCount(1);                    // היום הראשון עם שעות
  await expect(page.locator("#patient-details-section")).toBeHidden();

  await page.locator(".slot-btn").first().click();
  await expect(page.locator("#patient-details-section")).toBeVisible();
  for (const id of ["#patient-name", "#patient-national-id", "#patient-phone", "#patient-address"]) {
    await expect(page.locator(id)).toBeVisible();
  }
  await expect(page.locator("#confirm-btn")).toBeEnabled();
  await context.close();
});

test("הקלדת כתובת ויציאה מהשדה לא מחליפה את כפתורי השעות, והלחיצה על שעה נקלטת", async ({ browser }) => {
  const { context, page } = await setup(browser);
  await page.goto(BASE + "/booking.html");
  await expect(page.locator(".slot-btn").first()).toBeVisible();

  // מסמנים את צומת ה-DOM של הכפתור: אם הוא יוחלף, הסימון ייעלם
  await page.evaluate(() => { document.querySelector(".slot-btn").__mark = "same-node"; });
  await page.fill("#patient-address", "רחוב הבדיקה 5, עיר");
  await page.locator("#patient-address").blur();            // מפעיל 'change' => רענון שעות
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => document.querySelector(".slot-btn").__mark)).toBe("same-node");

  await page.locator(".slot-btn").first().click();
  await expect(page.locator(".slot-btn.selected")).toHaveCount(1);
  await expect(page.locator("#patient-details-section")).toBeVisible();
  await context.close();
});
