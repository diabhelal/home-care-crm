// השהיית שירות ע"י המנהל (בדיקות דם): המטופל לא יכול לבחור אותו בתאריכים המושהים ורואה את ההודעה;
// המנהל משהה ומחדש מהממשק. fake supabase-js + backend ממוקק, אפס DB חי. הכלל נאכף גם בשרת וב-DB (pytest / tests_db).
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const ADMIN = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };
const ymd = (offsetDays) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

async function open(browser, { path, session, seed }) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@*", (route) => route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  const ctl = await installBackendMock(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ session, seed }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    Object.assign(db, seed); db.seq = db.seq || 500;
    localStorage.setItem("__demo_db", JSON.stringify(db));
    if (session) localStorage.setItem("__demo_session", JSON.stringify(session));
    localStorage.setItem("__write_log", "[]");
  }, { session, seed });
  await page.goto(BASE + path);
  return { context, page, ctl, errors };
}

test("מטופל: שירות מושהה בכל התאריכים מוצג כלא זמין עם ההודעה ולא ניתן לבחירה; שירות אחר נשאר", async ({ browser }) => {
  const { page, errors, context } = await open(browser, { path: "/booking.html", seed: {
    service_availability: [{ purpose: "blood_test", is_paused: true, paused_from: null, paused_until: null, public_message: "אין בדיקות דם החודש" }] } });
  const blood = page.locator("#purpose-chips .chip", { hasText: "בדיקת דם" });
  await expect(blood).toBeDisabled();
  await expect(blood).toContainText("זמנית לא זמין");
  await expect(blood).toContainText("אין בדיקות דם החודש");
  await expect(page.locator("#purpose-chips .chip", { hasText: "בדיקה כללית" })).toBeEnabled();
  await expect(page.locator("#purpose-chips .chip.selected")).not.toContainText("בדיקת דם");   // לא נשארים על שירות חסום
  expect(errors).toEqual([]);
  await context.close();
});

test("מטופל: השהיה לטווח תאריכים - התאריך המושהה מציג הודעה במקום שעות, תאריך אחר רגיל", async ({ browser }) => {
  const { page, errors, context } = await open(browser, { path: "/booking.html", seed: {
    service_availability: [{ purpose: "blood_test", is_paused: true, paused_from: ymd(0), paused_until: ymd(1), public_message: "חוזרים ביום ג'" }] } });
  await page.locator("#purpose-chips .chip", { hasText: "בדיקת דם" }).click();           // עדיין ניתן לבחירה: יש תאריכים פנויים
  await expect(page.locator("#purpose-chips .chip", { hasText: "בדיקת דם" })).toBeEnabled();
  const pills = page.locator(".date-pill:not([disabled])");
  await pills.first().click();                                                              // היום - מושהה
  await expect(page.locator("#no-slots")).toContainText("השירות אינו זמין בתאריך זה");
  await expect(page.locator("#no-slots")).toContainText("חוזרים ביום ג'");
  await expect(page.locator("#slot-grid .slot-btn")).toHaveCount(0);
  await page.locator("#purpose-chips .chip", { hasText: "בדיקה כללית" }).click();          // שירות אחר באותו תאריך - חוזר לרגיל
  await expect(page.locator("#no-slots")).not.toContainText("השירות אינו זמין בתאריך זה");
  expect(errors).toEqual([]);
  await context.close();
});

test("מנהל: משהה שירות עם תאריכים והודעה, ואז מחדש. ללא מחיקה", async ({ browser }) => {
  const { page, errors, context } = await open(browser, { path: "/admin.html", session: ADMIN, seed: { bookings: [], patients: [] } });
  const row = page.locator("#services-tbody tr", { hasText: "בדיקת דם" });
  await expect(row).toContainText("זמין");
  await row.getByRole("button", { name: "השהיית שירות" }).click();
  await page.locator("#service-from").fill("2031-03-05");
  await page.locator("#service-until").fill("2031-03-01");                                 // סדר שגוי
  await page.locator("#service-modal-save").click();
  await expect(page.locator("#service-modal-error")).toContainText("תאריך הסיום לפני תאריך ההתחלה");
  await page.locator("#service-until").fill("2031-03-15");
  await page.locator("#service-message").fill("חוזרים ב-16.3");
  await page.locator("#service-modal-save").click();
  await expect(page.locator("#service-modal")).toBeHidden();
  await expect(row).toContainText("מושהה");
  await expect(row).toContainText("05/03/2031–15/03/2031");
  await expect(row).toContainText("חוזרים ב-16.3");
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem("__write_log") || "[]").filter((w) => w.table === "service_availability"));
  expect(log.map((w) => w.op)).toEqual(["upsert"]);
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "חידוש השירות" }).click();
  await expect(row).toContainText("זמין");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db")).service_availability);
  expect(stored).toHaveLength(1);                                                           // השורה נשמרת (היסטוריה), רק is_paused=false
  expect(stored[0].is_paused).toBe(false);
  expect(errors).toEqual([]);
  await context.close();
});
