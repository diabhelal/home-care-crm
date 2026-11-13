// פריסה מאורחת (Railway): שירות התחזית פנימי בתוך ה-backend, ו-PREDICTIVE_SERVICE_URL = BACKEND_URL.
// כל קריאת דפדפן לשירות התחזית עוברת דרך ה-backend עם טוקן המשתמש, ובמסלולים של מטופל גם X-Patient-Id.
// בדיקת הזמינות פונה ל-/predict/health. מקומית (כתובת אחרת) לא נשלחות כותרות נוספות. fake supabase + backend ממוקק.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const BACKEND = "http://backend.test";   // לא localhost: באתר מאורח כתובת localhost מדולגת בכוונה
const P1 = { id: "p-1", full_name: "דנה כהן", phone: "050-123 4567", address: "הרצל 5, חיפה" };
const ADMIN = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "Authorization, Content-Type, X-Patient-Id" };

async function setup(browser, predictiveUrl) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await installBackendMock(context, { backendUrl: BACKEND, extraConfig: `window.PREDICTIVE_SERVICE_URL = ${JSON.stringify(predictiveUrl)};` });
  const seen = [];
  const capture = (route) => {
    const r = route.request();
    seen.push({ path: new URL(r.url()).pathname, method: r.method(), headers: r.headers() });
    if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (r.url().endsWith("/health")) return route.fulfill({ contentType: "application/json", headers: CORS, body: '{"status":"ok"}' });
    return route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify({
      current_risk: { level: "green", level_label: "תקין", flagged_vitals: [] }, trend: null, status_message: "תקין",
      baseline_analysis: [], detected_anomalies: [], trigger_events: [], vital_forecasts: [], future_event_models: [],
      short_term_concern: "low", risk_window_hours: 8, reassessment_recommended_in_hours: 24, contributing_factors: [], explanation: "x" }) });
  };
  await context.route(predictiveUrl + "/predict/**", capture);
  await context.route(predictiveUrl + "/health", capture);
  const page = await context.newPage();
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ P1, ADMIN }) => {
    const db = { patients: [P1], bookings: [], visit_reports: [{ id: 9, booking_id: 3, patient_id: "p-1", staff_id: 1,
      visit_date: new Date().toISOString(), systolic_bp: 150, diastolic_bp: 95, pulse: 100 }], seq: 500 };
    localStorage.setItem("__demo_db", JSON.stringify(db));
    localStorage.setItem("__demo_session", JSON.stringify(ADMIN));
  }, { P1, ADMIN });
  await page.goto(BASE + "/admin.html");
  return { context, page, seen };
}

async function comprehensive(page) {
  await page.evaluate(() => { visitReportModal.dataset.patientId = "p-1"; visitReportScope.start("p-1"); });
  await page.evaluate(() => document.getElementById("vr-comprehensive-btn").click());
}

test("דרך ה-backend: טוקן משתמש + X-Patient-Id, ובדיקת זמינות ב-/predict/health", async ({ browser }) => {
  const { context, page, seen } = await setup(browser, BACKEND);
  await expect.poll(() => seen.some((s) => s.path === "/predict/health")).toBe(true);
  await comprehensive(page);
  await expect.poll(() => seen.find((s) => s.path === "/predict/medical-warning" && s.method === "POST")).toBeTruthy();
  const call = seen.find((s) => s.path === "/predict/medical-warning" && s.method === "POST");
  expect(call.headers["authorization"]).toBe("Bearer fake-jwt-admin-user-1");
  expect(call.headers["x-patient-id"]).toBe("p-1");
  expect(seen.some((s) => s.path === "/health")).toBe(false);
  await context.close();
});

test("שירות תחזית בכתובת נפרדת (מקומי): בלי כותרות נוספות, כמו קודם", async ({ browser }) => {
  const { context, page, seen } = await setup(browser, "http://predictive.test");
  await comprehensive(page);
  await expect.poll(() => seen.find((s) => s.path === "/predict/medical-warning" && s.method === "POST")).toBeTruthy();
  const call = seen.find((s) => s.path === "/predict/medical-warning" && s.method === "POST");
  expect(call.headers["authorization"]).toBeUndefined();
  expect(call.headers["x-patient-id"]).toBeUndefined();
  await context.close();
});
