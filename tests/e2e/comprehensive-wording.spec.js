// ניתוח מדדים ומגמות (הדגמה): ניסוח כן, בריחת HTML, יחידות, ואף פעם לא "מודל מאומן".
// fake supabase-js + backend ממוקק + שירות תחזית ממוקק (predictive.test). אפס DB חי, אפס localhost:8000.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const P1 = { id: "p-1", full_name: "דנה כהן", phone: "050-123 4567", address: "הרצל 5, חיפה" };
const ADMIN = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };
const EVIL = `<img src=x onerror="window.__xss=1">`;

const WARNING = {
  current_risk: { level: "green", level_label: "ירוק", flagged_vitals: [] },
  trend: null,
  status_message: "מצב תקין", // הטקסט האמיתי שהשרת מחזיר לרמה ירוקה (CAREGIVER_STATUS_BY_LEVEL)
  baseline_analysis: [
    { vital: EVIL, baseline: "<b>1</b>", latest_value: 80, deviation: 2, number_of_measurements: 3,
      sudden_change: false, worsening_trend: false, persistent_abnormal: false },
    { vital: "pulse", baseline: 72, latest_value: 80, deviation: 8, number_of_measurements: 12,
      sudden_change: false, worsening_trend: false, persistent_abnormal: false },
  ],
  detected_anomalies: [],
  trigger_events: [
    { vital: EVIL, severity: "high", reason: EVIL, current_value: EVIL, baseline: null, deviation: null,
      hours_since_trigger: EVIL, decay_window_hours: 8, decay_factor: 0.5, still_active: true },
  ],
  vital_forecasts: [
    { vital: "blood_sugar", method: "linear", model_available: true, predicted_value: 110, direction: "יציב",
      confidence_interval: null, number_of_measurements: 4 },
  ],
  future_event_models: [
    { target: "hospitalization", label_he: "אשפוז", algorithm: "random_forest", model_available: true,
      probability: 0.42, status: "ready" },
    { target: "fall", label_he: "נפילה", algorithm: "knn", model_available: false, probability: null,
      status: "collecting_ground_truth" },
  ],
  short_term_concern: "low",
  risk_window_hours: 8,
  reassessment_recommended_in_hours: EVIL,
  contributing_factors: [],
  explanation: "אין חריגה",
};

async function open(browser, warning = WARNING) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await installBackendMock(context);
  await context.route("http://predictive.test/predict/medical-warning", (route) => route.fulfill({
    contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(warning),
  }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ session, P1 }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.patients = [P1]; db.bookings = [{ id: 3, patient_id: "p-1", staff_id: 1, visit_purpose: "checkup", status: "scheduled",
      workflow_status: "assigned", approval_status: "confirmed", visit_address: P1.address, scheduled_at: new Date(Date.now() + 3600e3).toISOString() }];
    db.visit_reports = [{ id: 9, booking_id: 3, patient_id: "p-1", staff_id: 1, visit_date: new Date().toISOString(), pulse: 80 }];
    db.seq = 500;
    localStorage.setItem("__demo_db", JSON.stringify(db));
    localStorage.setItem("__demo_session", JSON.stringify(session));
  }, { session: ADMIN, P1 });
  await page.goto(BASE + "/admin.html");
  await expect(page.locator("#work-queue")).toContainText("דנה כהן");
  await page.evaluate(() => { window.PREDICTIVE_SERVICE_URL = "http://predictive.test"; });
  await page.evaluate(() => { visitReportModal.dataset.patientId = "p-1"; visitReportScope.start("p-1"); });
  return { page, errors };
}

test("הכפתור מנוסח כהדגמה ולא כאבחון/ML", async ({ browser }) => {
  const { page } = await open(browser);
  const btn = page.locator("#vr-comprehensive-btn");
  await expect(btn).toHaveText("ניתוח מדדים ומגמות (הדגמה)");
  await expect(btn).not.toContainText("ML");
  await expect(btn).not.toContainText("אבחון");
});

test("תוצאה: הצהרת הדגמה, ללא ✅/מצב תקין, יחידות, מדגם קטן, ללא טווח ודאות, ללא 'מודל מאומן'", async ({ browser }) => {
  const { page, errors } = await open(browser);
  await page.evaluate(() => document.getElementById("vr-comprehensive-btn").click());
  const res = page.locator("#vr-comprehensive-result");
  await expect(res).toContainText("הדגמה: כלי תומך החלטה מבוסס כללים וסטטיסטיקה. אינו אבחנה ואינו תחליף לשיקול דעת קליני.");
  await expect(res).toContainText("לא זוהתה חריגה לפי הכללים");
  await expect(res).not.toContainText("✅");
  await expect(res).not.toContainText("מצב תקין");
  await expect(res).not.toContainText("מודל מאומן");
  await expect(res).toContainText("ניסיוני, לא מאומת קלינית");
  await expect(res).toContainText("נפילה: לא זמין");
  await expect(res).toContainText("דופק");
  await expect(res).toContainText("72 BPM");
  await expect(res).toContainText("סוכר");
  await expect(res).toContainText("110 mg/dL");
  await expect(res).toContainText("ללא טווח ודאות");
  await expect(res).toContainText("מדגם קטן");
  expect(errors).toEqual([]);
});

test("אין נתונים להערכה (no_data) לא מוצג כ'לא זוהתה חריגה' ולא כירוק", async ({ browser }) => {
  const noData = { ...WARNING, current_risk: { level: "no_data", level_label: "אין נתונים", flagged_vitals: [] },
    status_message: "לא ניתן להעריך — אין נתונים", short_term_concern: "insufficient_data", explanation: "אין מספיק נתונים להערכה: לא הוזנו מדדים." };
  const { page, errors } = await open(browser, noData);
  await page.evaluate(() => document.getElementById("vr-comprehensive-btn").click());
  const res = page.locator("#vr-comprehensive-result");
  await expect(res).toContainText("אין מספיק נתונים להערכה");
  await expect(res).not.toContainText("לא זוהתה חריגה");
  await expect(res).not.toContainText("✅");
  await expect(res).not.toContainText("דאגה נמוכה");
  await expect(res).not.toContainText("רמת דאגה לטווח קצר: נמוכה");
  expect(errors).toEqual([]);
});

test("ערכי שרת זדוניים עוברים בריחת HTML (אין אלמנט img, אין xss)", async ({ browser }) => {
  const { page, errors } = await open(browser);
  await page.evaluate(() => document.getElementById("vr-comprehensive-btn").click());
  await expect(page.locator("#vr-comprehensive-result")).toContainText("הדגמה:");
  await expect(page.locator("#vr-comprehensive-result img")).toHaveCount(0);
  await expect(page.locator("#vr-comprehensive-result b")).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});
