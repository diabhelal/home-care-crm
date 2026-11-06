// הפעלה ותקלות חיבור: תקלת רשת/שרת בזמן אימות החשבון לא מוציאה משתמש מחובר למסך ההתחברות ולא חושפת מידע מוגן,
// ואילו חשבון לא פעיל / לא איש צוות / אין הפעלה כן מובילים להתחברות. תוכן שלא נשמר נשאר בכשל שאפשר להתאושש ממנו.
// fake supabase-js + backend ממוקק; אפס DB חי.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const ADMIN = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };
const STAFF = { user: { id: "staff-user-1", is_anonymous: false, app_metadata: {} } };
const P1 = { id: "p-1", full_name: "דנה כהן", phone: "050-123 4567", address: "הרצל 5, חיפה" };
const NURSE = { id: 1, full_name: "אחות א", role: "nurse", auth_user_id: "staff-user-1", is_active: true };
const FUTURE = new Date(Date.now() + 30 * 3600e3).toISOString();
const BOOKING = { id: 7, patient_id: "p-1", staff_id: 1, visit_purpose: "checkup", status: "scheduled", workflow_status: "assigned",
  approval_status: "confirmed", visit_address: "הרצל 5, חיפה", scheduled_at: FUTURE };

async function newPage(browser, { session, medical_staff = [NURSE], failTables = {}, failAuth = 0 }) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  const ctl = await installBackendMock(context);
  const page = await context.newPage();
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ session, medical_staff, P1, BOOKING }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.patients = [P1]; db.bookings = [BOOKING]; db.medical_staff = medical_staff; db.seq = 500;
    localStorage.setItem("__demo_db", JSON.stringify(db));
    if (session) localStorage.setItem("__demo_session", JSON.stringify(session)); else localStorage.removeItem("__demo_session");
  }, { session, medical_staff, P1, BOOKING });
  await page.evaluate(({ failTables, failAuth }) => {
    localStorage.setItem("__fail_tables", JSON.stringify(failTables));
    localStorage.setItem("__fail_auth", String(failAuth));
  }, { failTables, failAuth });
  return { page, ctl };
}
const clearFailures = (page) => page.evaluate(() => { localStorage.setItem("__fail_tables", "{}"); localStorage.setItem("__fail_auth", "0"); });

test("צוות: תקלת חיבור באימות החשבון - נשארים מחוברים, בלי הפניה לכניסה ובלי מידע מוגן, ו'נסו שוב' משחזר", async ({ browser }) => {
  const { page } = await newPage(browser, { session: STAFF, failTables: { medical_staff: -1 } });
  await page.goto(BASE + "/employee.html");
  await expect(page.locator("#session-check-failure")).toBeVisible();
  await expect(page.locator("#session-check-failure")).toContainText("לא נותקתם");
  expect(page.url()).toContain("employee.html");                                            // לא הופנה לכניסה
  await expect(page.locator("#staff-app")).toBeHidden();                                    // שום מידע מוגן לא מוצג
  expect(await page.evaluate(() => !!localStorage.getItem("__demo_session"))).toBe(true);    // ההפעלה נשמרה
  await clearFailures(page);
  await page.click("#session-check-retry");
  await expect(page.locator("#staff-app")).toBeVisible();
  await expect(page.locator("#session-check-failure")).toBeHidden();
});

test("צוות: חשבון לא פעיל, חשבון שאינו איש צוות, ובלי הפעלה - מופנים להתחברות (לא מתבלבלים עם תקלת חיבור)", async ({ browser }) => {
  for (const [label, opts] of [
    ["לא פעיל", { session: STAFF, medical_staff: [{ ...NURSE, is_active: false }] }],
    ["לא איש צוות", { session: STAFF, medical_staff: [] }],
    ["בלי הפעלה", { session: null }],
  ]) {
    const { page } = await newPage(browser, opts);
    await page.goto(BASE + "/employee.html");
    await page.waitForURL(/employee-login\.html/, { timeout: 8000 });
    await expect(page.locator("#session-check-failure"), label).toHaveCount(0);
  }
});

test("מנהל: תקלת חיבור בקריאת ההפעלה - בלי טופס כניסה ובלי נתונים, ו'נסו שוב' משחזר", async ({ browser }) => {
  const { page } = await newPage(browser, { session: ADMIN, failAuth: -1 });
  await page.goto(BASE + "/admin.html");
  await expect(page.locator("#session-check-failure")).toBeVisible();
  await expect(page.locator("#login-screen")).toBeHidden();                                  // לא מבקשים להקליד סיסמה מחדש
  await expect(page.locator("#admin-app")).toBeHidden();                                     // בלי מידע מוגן
  await clearFailures(page);
  await page.click("#session-check-retry");
  await expect(page.locator("#admin-app")).toBeVisible();
  await expect(page.locator("#work-queue")).toContainText("דנה כהן");
});

test("מנהל: בלי הפעלה או משתמש שאינו מנהל - מסך כניסה רגיל", async ({ browser }) => {
  for (const session of [null, STAFF]) {
    const { page } = await newPage(browser, { session });
    await page.goto(BASE + "/admin.html");
    await expect(page.locator("#login-screen")).toBeVisible();
    await expect(page.locator("#admin-app")).toBeHidden();
    await expect(page.locator("#session-check-failure")).toHaveCount(0);
  }
});

test("כשל שרת זמני בשמירת דוח: התוכן נשמר בטיוטה מקומית, לא מוצג כשמור, ושמירה חוזרת מצליחה בלי כפילות", async ({ browser }) => {
  const { page, ctl } = await newPage(browser, { session: STAFF });
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("__demo_db")); const b = db.bookings[0];
    b.workflow_status = "in_progress"; b.checked_in_at = new Date().toISOString(); b.scheduled_at = new Date().toISOString();
    localStorage.setItem("__demo_db", JSON.stringify(db));
  });
  await page.goto(BASE + "/employee.html");
  await expect(page.locator("#staff-app")).toBeVisible();
  await page.getByRole("button", { name: /המשך ביקור|עריכת דוח|דוח ביקור/ }).first().click();
  await page.fill("#vr-pulse", "72");
  await page.fill("#vr-summary", "סיכום שלא יאבד בכשל זמני");
  ctl.completeFail = 500;
  await page.click("#visit-report-modal-save");
  await expect(page.locator("body")).toContainText("לא אושר בשרת");                          // לא מוצג כ"נשמר"
  const stored = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("visitReportOfflineQueue")).map(([, v]) => JSON.parse(v)));
  expect(stored.flat().map((d) => d.treatment_summary)).toContain("סיכום שלא יאבד בכשל זמני");   // התוכן נשמר
  ctl.completeFail = null;
  await page.reload();
  await expect(page.locator("#staff-app")).toBeVisible();
  await expect.poll(() => ctl.completes.length, { timeout: 10000 }).toBe(1);                  // סונכרן פעם אחת
});
