// מנהל: "התחלת ביקור" בתור העבודה (check-in בשרת, שעת שרת) ותיעוד תוצאה קלינית (PATCH בשרת).
// הדפדפן לא כותב ל-bookings/visit_reports ישירות (__write_log). fake supabase-js + backend ממוקק, אפס DB חי.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const ADMIN = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };
const P1 = { id: "p-1", full_name: "דנה כהן", phone: "050-123 4567", address: "הרצל 5, חיפה" };
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

async function setup(browser, { bookings, visit_reports = [] }) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  const ctl = await installBackendMock(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ bookings, visit_reports, ADMIN, P1 }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.patients = [P1]; db.bookings = bookings; db.visit_reports = visit_reports; db.seq = 500;
    localStorage.setItem("__demo_db", JSON.stringify(db));
    localStorage.setItem("__demo_session", JSON.stringify(ADMIN));
    localStorage.setItem("__write_log", "[]");
  }, { bookings, visit_reports, ADMIN, P1 });
  await page.goto(BASE + "/admin.html");
  await expect(page.locator("#work-queue")).toContainText("דנה כהן");
  return { context, page, ctl, errors };
}
const booking = (o) => ({ id: 7, patient_id: "p-1", staff_id: 1, visit_purpose: "checkup", status: "scheduled",
  workflow_status: "assigned", approval_status: "confirmed", visit_address: "הרצל 5, חיפה", scheduled_at: inHours(1), ...o });
const writes = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__write_log") || "[]")
  .filter((w) => ["bookings", "visit_reports", "risk_predictions", "alerts", "tasks"].includes(w.table)));

test("מנהל מתחיל ביקור: check-in בשרת עם JWT, שעת שרת, אפס כתיבה ישירה", async ({ browser }) => {
  const { page, ctl, errors } = await setup(browser, { bookings: [booking({})] });
  await page.locator("#work-queue tbody tr", { hasText: "דנה כהן" }).getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  await expect(page.locator("#app-success")).toContainText(/הביקור התחיל ב-\d{1,2}:\d{2}/);
  const req = ctl.requests.find((r) => r.path === "/staff/bookings/7/check-in" && r.method === "POST");
  expect(req.headers.authorization).toMatch(/^Bearer fake-jwt-admin-user-1/);
  expect(req.body).toBeNull(); // בלי חותמת זמן/זהות מהלקוח
  expect(ctl.checkIns).toBe(1);
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db")).bookings[0]);
  expect(db.workflow_status).toBe("in_progress");
  expect(db.staff_id).toBe(1);
  expect(new Date(db.checked_in_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  expect(await writes(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("כשל check-in אצל מנהל: שגיאה ברורה, לא מסומן כהתחיל, אין מודאל, אפס כתיבה ישירה", async ({ browser }) => {
  const { page, ctl } = await setup(browser, { bookings: [booking({})] });
  ctl.checkInFail = "abort";
  const row = page.locator("#work-queue tbody tr", { hasText: "דנה כהן" });
  await row.getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#app-error")).toContainText("לא ניתן להתחיל את הביקור");
  await expect(page.locator("#visit-report-modal")).toBeHidden();
  await expect(row.getByRole("button", { name: "התחלת ביקור" })).toBeEnabled();
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db")).bookings[0]);
  expect(db.workflow_status).toBe("assigned");
  expect(db.checked_in_at).toBeUndefined();
  ctl.checkInFail = 409;
  await row.getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#app-error")).toContainText("שגיאת בדיקה");
  expect(await writes(page)).toEqual([]);
});

async function openVisitsTab(page) {
  await page.evaluate(() => openPatientRecord("p-1"));
  await page.locator("#pr-tabs button", { hasText: "ביקורים" }).click();
}
const REPORT = { id: 70, booking_id: 7, patient_id: "p-1", staff_id: 1, visit_date: inHours(-3), treatment_summary: "בסדר" };

test("מנהל מתעד תוצאה קלינית דרך ה-backend (PATCH), לא בכתיבה ישירה ל-visit_reports", async ({ browser }) => {
  const { page, ctl, errors } = await setup(browser, { bookings: [booking({ status: "completed" })], visit_reports: [REPORT] });
  await openVisitsTab(page);
  const sel = page.locator("#pr-outcome-select-70");
  await sel.selectOption("hypoglycemia");
  await expect(page.locator(".pr-outcome-saved[data-visit-id='70']")).toBeVisible();
  expect(ctl.outcomes).toEqual([{ report_id: 70, value: "hypoglycemia" }]);
  const req = ctl.requests.find((r) => r.method === "PATCH");
  expect(req.path).toBe("/visits/70/clinical-outcome");
  expect(req.headers.authorization).toMatch(/^Bearer fake-jwt-admin-user-1/);
  expect(req.body).toEqual({ clinical_outcome_8h: "hypoglycemia" });
  const rep = await page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db")).visit_reports[0]);
  expect(rep.clinical_outcome_8h).toBe("hypoglycemia");
  expect(await writes(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("כשל בשמירת תוצאה קלינית: הודעה ברורה, הבחירה חוזרת, אין שינוי, אפס כתיבה ישירה", async ({ browser }) => {
  const { page, ctl } = await setup(browser, { bookings: [booking({ status: "completed" })], visit_reports: [REPORT] });
  await openVisitsTab(page);
  ctl.outcomeFail = 403;
  await page.locator("#pr-outcome-select-70").selectOption("none");
  await expect(page.locator(".pr-outcome-error[data-visit-id='70']")).toContainText("שגיאת בדיקה");
  await expect(page.locator("#pr-outcome-select-70")).toHaveValue("");
  ctl.outcomeFail = "abort";
  await page.locator("#pr-outcome-select-70").selectOption("none");
  await expect(page.locator(".pr-outcome-error[data-visit-id='70']")).toContainText("לא ניתן לשמור את התוצאה הקלינית");
  const rep = await page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db")).visit_reports[0]);
  expect(rep.clinical_outcome_8h).toBeUndefined();
  expect(ctl.outcomes).toEqual([]);
  expect(await writes(page)).toEqual([]);
});

test("תור העבודה: סיכון אדום ישן לא נעלם — מוצג עם גיל ('מיושן'), ודוח חדש שלא הוערך מסומן", async ({ browser }) => {
  const { page } = await setup(browser, { bookings: [booking({})] });
  await page.evaluate(({ old }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db"));
    db.current_patient_risk = [{ patient_id: "p-1", risk_level: "red", trend: "worsening", predicted_at: old, is_stale: true, newer_report_exists: true }];
    localStorage.setItem("__demo_db", JSON.stringify(db));
  }, { old: new Date(Date.now() - 3 * 86400000).toISOString() });
  await page.reload();
  const row = page.locator("#work-queue tbody tr", { hasText: "דנה כהן" });
  await expect(row).toContainText("אדום");
  await expect(row).toContainText("לפני 3 ימים");
  await expect(row).toContainText("מיושן");
  await expect(row).toContainText("קיים דוח חדש יותר שטרם הוערך");
});
