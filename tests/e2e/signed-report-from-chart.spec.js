// דוח שהושלם (חתום) שנפתח מתוך תיק המטופל: ההסבר חייב להיות גלוי (לא נמחק מיד אחרי שהוצג), השמירה חסומה
// (אין דריסה), והפנייה לדרכים המותרות: תיקון מקושר (למחבר), מדדים והערות קליניות. fake supabase-js + backend ממוקק.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const ADMIN = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };
const STAFF = { user: { id: "staff-user-1", is_anonymous: false, app_metadata: {} } };
const P1 = { id: "p-1", full_name: "דנה כהן", phone: "050-123 4567", address: "הרצל 5, חיפה" };
const day = 86400e3;
const BOOKING = { id: 7, patient_id: "p-1", staff_id: 1, visit_purpose: "checkup", status: "completed", workflow_status: "assigned",
  approval_status: "confirmed", visit_address: "הרצל 5, חיפה", scheduled_at: new Date(Date.now() - day).toISOString() };
const SIGNED = { id: 1, booking_id: 7, patient_id: "p-1", staff_id: 1, author_user_id: "staff-user-1", visit_date: new Date(Date.now() - day).toISOString(),
  treatment_summary: "ביקור שהושלם", systolic_bp: 140, diastolic_bp: 90, pulse: 80, locked_at: new Date(Date.now() - day).toISOString() };

async function open(browser, as) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await installBackendMock(context);
  const page = await context.newPage();
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ session, P1, BOOKING, SIGNED }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.patients = [P1]; db.bookings = [BOOKING]; db.visit_reports = [SIGNED]; db.seq = 500;
    localStorage.setItem("__demo_db", JSON.stringify(db));
    localStorage.setItem("__demo_session", JSON.stringify(session));
    localStorage.setItem("__write_log", "[]");
  }, { session: as === "admin" ? ADMIN : STAFF, P1, BOOKING, SIGNED });
  await page.goto(BASE + (as === "admin" ? "/admin.html" : "/employee.html"));
  if (as === "admin") await expect(page.locator("#work-queue")).toBeVisible(); else await expect(page.locator("#staff-app")).toBeVisible();
  await page.evaluate(() => openPatientRecord("p-1"));
  await page.getByRole("button", { name: "ביקורים", exact: true }).click();
  await page.getByRole("button", { name: "פתיחת הדוח המלא" }).click();
  return page;
}

for (const who of ["admin", "staff"]) {
  test(`${who}: דוח חתום שנפתח מהתיק - הסבר גלוי, שמירה חסומה, והפנייה לדרכים המותרות`, async ({ browser }) => {
    const page = await open(browser, who);
    const err = page.locator("#visit-report-modal-error");
    await expect(err).toBeVisible();                                           // לא נמחק מיד אחרי שהוצג
    await expect(err).toContainText("הביקור כבר הושלם");
    await expect(err).toContainText("תיקון");                                   // הדרך לתיקון מקושר (למחבר)
    await expect(err).toContainText("הערות קליניות");
    await expect(page.locator("#visit-report-modal-save")).toBeDisabled();
    const db = await page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db")));
    expect(db.visit_reports).toHaveLength(1);
    expect(db.visit_reports[0]).toMatchObject({ id: 1, systolic_bp: 140, treatment_summary: "ביקור שהושלם" });
    const writes = await page.evaluate(() => JSON.parse(localStorage.getItem("__write_log") || "[]").map((w) => w.table));
    expect(writes).toEqual([]);                                                // פתיחה בלבד: שום כתיבה
  });
}
