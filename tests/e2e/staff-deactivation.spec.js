// השבתת איש צוות במקום מחיקה: ההיסטוריה נשמרת, מושבת לא מוצג למטופלים, ומחיקה שה-DB מסרב לה (RESTRICT) מקבלת
// הודעה ברורה. fake supabase-js + backend ממוקק, אפס DB חי.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const ADMIN = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };
const P1 = { id: "p-1", full_name: "דנה כהן", phone: "050-123 4567", address: "הרצל 5, חיפה" };
const staffRow = (id, name, active) => ({ id, full_name: name, role: "nurse", specialization: "", phone: "050-0000000", is_active: active,
  available_weekdays: [0, 1, 2, 3, 4, 5, 6], work_start_time: "08:00:00", work_end_time: "16:00:00", slot_duration_minutes: 60 });

async function setup(browser, { admin }) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await installBackendMock(context);
  const page = await context.newPage();
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ admin, ADMIN, P1, rows }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.medical_staff = rows; db.patients = [P1]; db.seq = 500;
    db.bookings = [{ id: 7, patient_id: "p-1", staff_id: 2, visit_purpose: "checkup", status: "completed", workflow_status: "assigned",
      approval_status: "confirmed", visit_address: "הרצל 5, חיפה", scheduled_at: new Date(Date.now() - 86400000).toISOString() }];
    localStorage.setItem("__demo_db", JSON.stringify(db));
    if (admin) localStorage.setItem("__demo_session", JSON.stringify(ADMIN));
  }, { admin, ADMIN, P1, rows: [staffRow(1, "אחות פעילה", true), staffRow(2, "אחות מושבתת", false)] });
  return { context, page };
}

test("מנהל: השבתה שומרת את ההיסטוריה ומשנה רק is_active; הפעלה מחדש זמינה", async ({ browser }) => {
  const { page } = await setup(browser, { admin: true });
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/admin.html");
  const active = page.locator("#staff-table tbody tr", { hasText: "אחות פעילה" });
  const inactive = page.locator("#staff-table tbody tr", { hasText: "אחות מושבתת" });
  await expect(active.getByRole("button", { name: "השבתה" })).toBeVisible();
  await expect(inactive.getByRole("button", { name: "הפעלה" })).toBeVisible();
  await active.getByRole("button", { name: "השבתה" }).click();
  await expect(page.locator("#app-success")).toContainText("ההיסטוריה נשמרה");
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db")));
  expect(db.medical_staff.find((s) => s.id === 1).is_active).toBe(false);
  expect(db.medical_staff).toHaveLength(2);        // לא נמחק
  expect(db.bookings).toHaveLength(1);              // ההיסטוריה שלמה
});

test("מנהל: מחיקה ש-DB מסרב לה (RESTRICT 23001) מציגה הודעה שמפנה להשבתה, והשורה נשארת", async ({ browser }) => {
  const { page } = await setup(browser, { admin: true });
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/admin.html");
  await expect(page.locator("#staff-table")).toContainText("אחות מושבתת");
  await page.evaluate(() => {
    // ה-fake מוחק בלי FK; מדמים את תשובת PostgREST כשהמפתח הזר חוסם
    const from = supabaseClient.from.bind(supabaseClient);
    supabaseClient.from = (n) => {
      const api = from(n);
      if (n === "medical_staff") api.delete = () => ({ eq: () => Promise.resolve({ error: { code: "23001", message: "violates RESTRICT" } }) });
      return api;
    };
  });
  await page.locator("#staff-table tbody tr", { hasText: "אחות מושבתת" }).getByRole("button", { name: "מחיקה" }).click();
  await expect(page.locator("#app-error")).toContainText("השתמשו ב");
  await expect(page.locator("#app-error")).toContainText("השבתה");
  await expect(page.locator("#staff-table")).toContainText("אחות מושבתת");
});

test("מטופל: איש צוות מושבת לא מוצג ברשימת הבחירה, גם אם יש לו היסטוריה", async ({ browser }) => {
  const { page } = await setup(browser, { admin: false });
  await page.goto(BASE + "/staff.html");
  await expect(page.locator("#staff-grid")).toContainText("אחות פעילה");
  await expect(page.locator("body")).not.toContainText("אחות מושבתת");
});
