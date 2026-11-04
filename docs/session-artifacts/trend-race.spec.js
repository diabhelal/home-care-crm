// REPRODUCTION ONLY (scratchpad, not part of the repo): does patient A's in-flight trend
// forecast get rendered after the modal was switched to patient B? Mocked supabase + backend + predictive service.
const { test, expect } = require("/Users/helaldiab/home-care-crm/node_modules/@playwright/test");
const { fakeSupabaseSource } = require("/Users/helaldiab/home-care-crm/tests/e2e/helpers/fake-supabase");
const { installBackendMock } = require("/Users/helaldiab/home-care-crm/tests/e2e/helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const PREDICT = "http://predict.test:8000";
const ADMIN = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };
const PA = { id: "p-1", full_name: "אלף כהן", phone: "050-111 1111", address: "הרצל 5, חיפה" };
const PB = { id: "p-2", full_name: "בית לוי", phone: "050-222 2222", address: "הנשיא 9, חיפה" };
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const bk = (o) => ({ status: "scheduled", workflow_status: "assigned", approval_status: "confirmed", staff_id: 1, visit_purpose: "checkup", ...o });
const rep = (id, pid, daysAgo, pulse) => ({ id, patient_id: pid, booking_id: 900 + id, visit_date: new Date(Date.now() - daysAgo * 86400000).toISOString(), pulse });

test("trend result of patient A must not appear after the modal switched to patient B", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@*", (r) => r.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
  await installBackendMock(context, { extraConfig: `window.PREDICTIVE_SERVICE_URL = "${PREDICT}";` });
  let release; const gate = new Promise((res) => (release = res));
  const forecastCalls = [];
  await context.route(PREDICT + "/**", async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (!req.url().includes("/predict/vitals-forecast")) return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: "{}" });
    const body = req.postDataJSON();
    const isA = body.points[0].value >= 100;
    forecastCalls.push(isA ? "A" : "B");
    if (isA) await gate; // patient A's response is held until released
    return route.fulfill({ status: 200, headers: cors, contentType: "application/json",
      body: JSON.stringify({ model_available: true, predicted_value: isA ? 111 : 222, method: "linear", direction: null, confidence_interval: null, number_of_measurements: body.points.length }) });
  });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ ADMIN, PA, PB, bks, reps }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.patients = [PA, PB]; db.bookings = bks; db.visit_reports = reps; db.seq = 500;
    localStorage.setItem("__demo_db", JSON.stringify(db));
    localStorage.setItem("__demo_session", JSON.stringify(ADMIN));
    localStorage.setItem("__write_log", "[]");
  }, { ADMIN, PA, PB,
    bks: [bk({ id: 7, patient_id: "p-1", scheduled_at: inHours(1) }), bk({ id: 8, patient_id: "p-2", scheduled_at: inHours(2) })],
    reps: [rep(1, "p-1", 3, 100), rep(2, "p-1", 2, 101), rep(3, "p-1", 1, 102), rep(4, "p-2", 3, 60), rep(5, "p-2", 2, 61), rep(6, "p-2", 1, 62)] });
  await page.goto(BASE + "/admin.html");
  await expect(page.locator("#work-queue")).toContainText("אלף כהן");
  await expect(page.locator("#work-queue")).toContainText("בית לוי");

  await page.locator("#work-queue tbody tr", { hasText: "אלף כהן" }).getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  expect(await page.evaluate(() => document.getElementById("visit-report-modal").dataset.patientId)).toBe("p-1");
  await page.click("#vr-check-trend-btn");
  await expect.poll(() => forecastCalls.length).toBe(1); // A's request is in flight and held

  await page.click("#visit-report-modal-cancel");
  await page.locator("#work-queue tbody tr", { hasText: "בית לוי" }).getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  const modalPatient = await page.evaluate(() => document.getElementById("visit-report-modal").dataset.patientId);
  console.log("modal patient before release:", modalPatient, "| result html before release:", JSON.stringify(await page.locator("#vr-trend-result").innerHTML()));
  expect(modalPatient).toBe("p-2");

  release(); // A's forecast now arrives while the modal shows patient B
  await expect(page.locator("#vr-check-trend-btn")).toBeEnabled();
  await page.waitForTimeout(500);
  const finalHtml = await page.locator("#vr-trend-result").innerText();
  console.log("modal patient after release:", await page.evaluate(() => document.getElementById("visit-report-modal").dataset.patientId));
  console.log("trend result text after release:", JSON.stringify(finalHtml));
  expect(errors).toEqual([]);
  expect(finalHtml).not.toContain("111"); // 111 = patient A's predicted value
});
