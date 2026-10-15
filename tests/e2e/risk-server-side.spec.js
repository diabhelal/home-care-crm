// הערכת סיכון והתראות נכתבות בשרת בלבד: הדפדפן לא כותב ל-risk_predictions/alerts (ולא שולח
// acknowledged_by/completed_by/*_at). fake supabase-js + backend ממוקק; אפס DB חי.
//  - אחרי השלמה מאושרת: POST /visits/{id}/risk-assessment עם JWT, בלי גוף עם ערכים מהלקוח.
//  - שירות התחזית למטה (503): הדוח נשאר שמור/הושלם, הודעה בעברית, לא נשמרה הערכה מזויפת.
//  - התראה אוטומטית נוצרת "בשרת" ומופיעה; אפס insert ל-alerts מהדפדפן.
//  - אישור התראה/השלמת משימה: רק status נשלח.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const P1 = { id: "p-1", full_name: "דנה כהן", phone: "050-123 4567", address: "הרצל 5, חיפה" };
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const STAFF = { user: { id: "staff-user-1", is_anonymous: false, app_metadata: {} } };
const ADMIN = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };

async function setup(browser, { session, page: pageName, extra = {} }) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  const ctl = await installBackendMock(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ session, P1, booking, extra }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.patients = [P1]; db.bookings = [booking]; db.visit_reports = []; db.seq = 500;
    Object.assign(db, extra);
    localStorage.setItem("__demo_db", JSON.stringify(db));
    localStorage.setItem("__demo_session", JSON.stringify(session));
    localStorage.setItem("__write_log", "[]");
  }, { session, P1, extra, booking: { id: 3, patient_id: "p-1", staff_id: 1, visit_purpose: "checkup", status: "scheduled",
      workflow_status: "assigned", approval_status: "confirmed", visit_address: P1.address, scheduled_at: inHours(1) } });
  await page.goto(BASE + "/" + pageName);
  return { context, page, ctl, errors };
}

const writes = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__write_log") || "[]"));
const dbOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db") || "{}"));

async function completeVisitAsStaff(page) {
  const card = page.locator("#my-work .pr-card").first();
  await card.getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  await page.fill("#vr-systolic", "185");
  await page.fill("#vr-diastolic", "110");
  await page.fill("#vr-pulse", "92");
  await page.fill("#vr-summary", "בדיקה: לחץ דם גבוה.");
  await page.click("#visit-report-modal-save");
  await expect(page.locator("#visit-report-modal")).toBeHidden();
}

test("צוות: אחרי השלמה מאושרת ההערכה נשמרת בשרת; אפס insert ל-risk_predictions/alerts מהדפדפן", async ({ browser }) => {
  const { page, ctl, errors } = await setup(browser, { session: STAFF, page: "employee.html" });
  ctl.riskLevel = "red";
  ctl.riskAlert = { alert_type: "new_red", severity: "high", message: "מצב אדום" };
  await expect(page.locator("#staff-app")).toBeVisible();
  await completeVisitAsStaff(page);

  await expect.poll(() => ctl.risks.length).toBe(1);
  expect(ctl.completes).toHaveLength(1);
  const reportId = (await dbOf(page)).visit_reports[0].id;
  const req = ctl.requests.find((r) => r.path === `/visits/${reportId}/risk-assessment` && r.method === "POST");
  expect(req.headers.authorization).toMatch(/^Bearer fake-jwt-staff-user-1/);
  expect(req.body).toBeNull(); // בלי risk_level/created_by/זמנים מהלקוח
  // הסדר: השלמה לפני הערכת סיכון
  const order = ctl.requests.map((r) => r.path);
  expect(order.indexOf(`/staff/visits/3/complete`)).toBeLessThan(order.indexOf(`/visits/${reportId}/risk-assessment`));

  const db = await dbOf(page);
  expect(db.risk_predictions).toHaveLength(1);
  expect(db.risk_predictions[0].created_by).toBe("staff-user-1");
  expect(db.alerts).toHaveLength(1);
  expect(db.bookings[0].status).toBe("completed");
  const w = await writes(page);
  expect(w.filter((x) => ["risk_predictions", "alerts", "tasks", "bookings", "visit_reports"].includes(x.table))).toEqual([]);
  expect(errors).toEqual([]);
});

test("שירות התחזית למטה (503): הדוח נשאר מושלם, הודעה בעברית, לא נכתבה הערכה", async ({ browser }) => {
  const { page, ctl, errors } = await setup(browser, { session: STAFF, page: "employee.html" });
  ctl.riskFail = 503;
  await expect(page.locator("#staff-app")).toBeVisible();
  await completeVisitAsStaff(page);

  await expect(page.locator("#app-success")).toContainText("הערכת הסיכון לא בוצעה");
  expect(ctl.completes).toHaveLength(1);
  const db = await dbOf(page);
  expect(db.bookings[0].status).toBe("completed");   // הדוח לא בוטל
  expect(db.visit_reports).toHaveLength(1);
  expect(db.risk_predictions || []).toEqual([]);
  expect(db.alerts || []).toEqual([]);
  const w = await writes(page);
  expect(w.filter((x) => x.table === "risk_predictions" || x.table === "alerts")).toEqual([]);
  expect(errors).toEqual([]);
});

test("אין מדדים בדוח (no_data): לא נשמרת הערכה מפוברקת", async ({ browser }) => {
  const { page, ctl } = await setup(browser, { session: STAFF, page: "employee.html" });
  ctl.riskLevel = "no_data";
  await expect(page.locator("#staff-app")).toBeVisible();
  const card = page.locator("#my-work .pr-card").first();
  await card.getByRole("button", { name: "התחלת ביקור" }).click();
  await page.fill("#vr-summary", "ללא מדדים");
  await page.click("#visit-report-modal-save");
  await expect(page.locator("#visit-report-modal")).toBeHidden();
  await expect.poll(() => ctl.requests.filter((r) => /risk-assessment$/.test(r.path)).length).toBe(1);
  const db = await dbOf(page);
  expect(db.risk_predictions || []).toEqual([]);
});

test("אישור התראה והשלמת משימה: נשלח רק status (בלי acknowledged_by/completed_by/זמני לקוח)", async ({ browser }) => {
  const { page } = await setup(browser, {
    session: STAFF, page: "employee.html",
    extra: { alerts: [{ id: 41, patient_id: "p-1", alert_type: "new_red", severity: "high", message: "אדום", status: "open", created_at: new Date().toISOString() }] },
  });
  await expect(page.locator("#staff-app")).toBeVisible();
  // קריאה ישירה לפונקציית הדף כדי לא לתלות את הבדיקה בניווט לתיק המטופל
  await page.evaluate(() => { window.currentPatientState = { patientId: "p-1" }; });
  const patch = await page.evaluate(async () => {
    const seen = [];
    const orig = supabaseClient.from.bind(supabaseClient);
    supabaseClient.from = (t) => {
      const b = orig(t);
      const upd = b.update.bind(b);
      b.update = (p) => { seen.push({ table: t, payload: p }); return upd(p); };
      return b;
    };
    await prAckAlert(41, document.createElement("button"));
    await prCompleteTask(77, document.createElement("button"));
    return seen;
  });
  expect(patch).toEqual([
    { table: "alerts", payload: { status: "acknowledged" } },
    { table: "tasks", payload: { status: "completed" } },
  ]);
});

test("מנהל: אבחון מקיף יוצר התראה דרך השרת (auto-alert), אפס insert ל-alerts מהדפדפן", async ({ browser }) => {
  const { page, ctl, context } = await setup(browser, { session: ADMIN, page: "admin.html",
    extra: { visit_reports: [{ id: 9, booking_id: 3, patient_id: "p-1", staff_id: 1, visit_date: new Date().toISOString(),
      systolic_bp: 150, diastolic_bp: 95, pulse: 100 }] } });
  ctl.autoAlertResponse = { alert_type: "worsening_trend", severity: "medium", message: "מגמת החמרה" };
  await context.route("http://predictive.test/predict/medical-warning", (route) => route.fulfill({
    contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({
      current_risk: { level: "yellow", level_label: "צהוב", flagged_vitals: [] }, trend: "worsening",
      status_message: "מגמת החמרה", baseline_analysis: [], detected_anomalies: [], trigger_events: [],
      vital_forecasts: [], future_event_models: [], short_term_concern: "low", risk_window_hours: 8,
      reassessment_recommended_in_hours: 24, contributing_factors: [], explanation: "x" }),
  }));
  await expect(page.locator("#work-queue")).toContainText("דנה כהן");
  await page.evaluate(() => { window.PREDICTIVE_SERVICE_URL = "http://predictive.test"; });
  await page.evaluate(() => { visitReportModal.dataset.patientId = "p-1"; });
  await page.evaluate(() => document.getElementById("vr-comprehensive-btn").click());
  await expect.poll(() => ctl.autoAlerts).toEqual(["p-1"]);
  const db = await dbOf(page);
  expect(db.alerts).toHaveLength(1);
  expect((await writes(page)).filter((x) => x.table === "alerts" || x.table === "risk_predictions")).toEqual([]);
});
