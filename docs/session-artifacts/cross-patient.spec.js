// REPRODUCTION ONLY (scratchpad, not in the repo). Mocked supabase + backend + predictive service, zero live DB.
// Each test states the CORRECT behaviour; a failure = the bug is reproduced.
const R = "/Users/helaldiab/home-care-crm";
const { test, expect } = require(R + "/node_modules/@playwright/test");
const { fakeSupabaseSource } = require(R + "/tests/e2e/helpers/fake-supabase");
const { installBackendMock } = require(R + "/tests/e2e/helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const PREDICT = "http://predict.test:8000";
const ADMIN = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };
const PA = { id: "p-1", full_name: "אלף כהן", phone: "050-111 1111", address: "הרצל 5, חיפה", background_conditions: ["diabetes"], smoking_status: "smoker", date_of_birth: "1950-01-01" };
const PB = { id: "p-2", full_name: "בית לוי", phone: "050-222 2222", address: "הנשיא 9, חיפה", background_conditions: [], smoking_status: "never", date_of_birth: "1990-01-01" };
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const bk = (o) => ({ status: "scheduled", workflow_status: "assigned", approval_status: "confirmed", staff_id: 1, visit_purpose: "checkup", ...o });
const rep = (id, pid, daysAgo, pulse) => ({ id, patient_id: pid, booking_id: 900 + id, visit_date: new Date(Date.now() - daysAgo * 86400000).toISOString(), pulse });
const now = () => new Date().toISOString();

async function setup(browser, { predictHandler } = {}) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@*", (r) => r.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
  await installBackendMock(context, { extraConfig: `window.PREDICTIVE_SERVICE_URL = "${PREDICT}";` });
  await context.route(PREDICT + "/**", async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const out = predictHandler ? await predictHandler(req) : null;
    return route.fulfill({ status: out ? out.status : 200, headers: cors, contentType: "application/json", body: JSON.stringify(out ? out.json : {}) });
  });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ ADMIN, PA, PB, bks, reps, allergies, risks }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.patients = [PA, PB]; db.bookings = bks; db.visit_reports = reps; db.seq = 500;
    db.patient_allergies = allergies; db.current_patient_risk = risks;
    localStorage.setItem("__demo_db", JSON.stringify(db));
    localStorage.setItem("__demo_session", JSON.stringify(ADMIN));
    localStorage.setItem("__write_log", "[]");
  }, { ADMIN, PA, PB,
    bks: [bk({ id: 7, patient_id: "p-1", scheduled_at: inHours(1) }), bk({ id: 8, patient_id: "p-2", scheduled_at: inHours(2) })],
    reps: [rep(1, "p-1", 3, 100), rep(2, "p-1", 2, 101), rep(3, "p-1", 1, 102), rep(4, "p-2", 3, 60), rep(5, "p-2", 2, 61), rep(6, "p-2", 1, 62)],
    allergies: [{ id: 1, patient_id: "p-1", substance: "אגוזים", severity: "mild", created_at: now() }, { id: 2, patient_id: "p-2", substance: "פניצילין", severity: "severe", created_at: now() }],
    risks: [{ patient_id: "p-1", risk_level: "red", trend: null, predicted_at: now(), expires_at: inHours(8), prediction_horizon_hours: 8 },
            { patient_id: "p-2", risk_level: "green", trend: null, predicted_at: now(), expires_at: inHours(8), prediction_horizon_hours: 8 }] });
  await page.goto(BASE + "/admin.html");
  await expect(page.locator("#work-queue")).toContainText("אלף כהן");
  await expect(page.locator("#work-queue")).toContainText("בית לוי");
  return { page, errors };
}
const openFor = async (page, name) => {
  await page.locator("#work-queue tbody tr", { hasText: name }).getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
};
// מחזיק את כל שאילתות ה-supabase של מטופל א' (eq(..., "p-1")) בטבלאות הנתונות עד לשחרור
const gatePatientA = (page, tables) => page.evaluate((tables) => {
  let release; window.__gate = new Promise((r) => (release = r)); window.__release = release;
  const orig = supabaseClient.from.bind(supabaseClient);
  supabaseClient.from = (t) => {
    const b = orig(t);
    if (!tables.includes(t)) return b;
    const sel = b.select.bind(b);
    b.select = (...a) => {
      const q = sel(...a); const eq = q.eq.bind(q);
      q.eq = (col, val) => { const p = eq(col, val); if (String(val) === "p-1") { const th = p.then.bind(p); p.then = (res, rej) => window.__gate.then(() => th(res, rej)); } return p; };
      return q;
    };
    return b;
  };
}, tables);
const switchToB = async (page) => { await page.click("#visit-report-modal-cancel"); await openFor(page, "בית לוי"); };

test("R1 באנר הרגישויות: תשובה מאוחרת של א' לא דורסת את הרגישויות של ב' (פניצילין)", async ({ browser }) => {
  const { page } = await setup(browser);
  await gatePatientA(page, ["patient_allergies"]);
  await openFor(page, "אלף כהן");
  await switchToB(page);
  await expect(page.locator("#vr-allergy-banner")).toContainText("פניצילין"); // רגישות ב' נטענה
  await page.evaluate(() => window.__release());
  await page.waitForTimeout(500);
  const txt = await page.locator("#vr-allergy-banner").innerText();
  const shown = await page.locator("#vr-allergy-banner").isVisible();
  console.log("R1 banner after release:", JSON.stringify({ shown, txt }));
  expect(shown).toBe(true);
  expect(txt).toContain("פניצילין");
  expect(txt).not.toContain("אגוזים");
});

test("R2 הרקע הרפואי לחישוב סיכון (vrPatientContext): נשאר של ב' גם אחרי תשובה מאוחרת של א'", async ({ browser }) => {
  const { page } = await setup(browser);
  await gatePatientA(page, ["patients"]);
  await openFor(page, "אלף כהן");
  await switchToB(page);
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => JSON.stringify(vrPatientContext));
  await page.evaluate(() => window.__release());
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => JSON.stringify(vrPatientContext));
  console.log("R2 vrPatientContext before/after release:", before, "|", after);
  expect(JSON.parse(after).background_conditions).toEqual([]); // ב' ללא רקע; "diabetes" = של א'
  expect(JSON.parse(after).smoking_status).toBe("never");
});

test("R3 פאנל הסיכון: תשובה מאוחרת של א' (אדום) לא מוצגת בדוח של ב' (ירוק)", async ({ browser }) => {
  const { page } = await setup(browser);
  await gatePatientA(page, ["current_patient_risk"]);
  await openFor(page, "אלף כהן");
  await switchToB(page);
  await page.waitForTimeout(400);
  const before = await page.locator("#vr-risk-panel").innerText();
  await page.evaluate(() => window.__release());
  await page.waitForTimeout(500);
  const after = await page.locator("#vr-risk-panel").innerText();
  console.log("R3 risk panel before:", JSON.stringify(before), "| after:", JSON.stringify(after));
  expect(after).toBe(before);
});

test("R4 אבחון מקיף: תוצאה מאוחרת של א' לא מוצגת בדוח של ב'", async ({ browser }) => {
  let release; const gate = new Promise((r) => (release = r));
  const full = (tag) => ({ status: 200, json: { status_message: "סטטוס " + tag, current_risk: { level: "green" }, short_term_concern: "low", explanation: "הסבר " + tag,
    reassessment_recommended_in_hours: 8, risk_window_hours: 8, trigger_events: [], baseline_analysis: [], vital_forecasts: [], future_event_models: [] } });
  const { page } = await setup(browser, { predictHandler: async (req) => {
    if (!req.url().includes("/predict/medical-warning")) return null;
    const isA = req.postDataJSON().history[0].pulse >= 100;
    if (isA) await gate;
    return full(isA ? "של-א" : "של-ב");
  } });
  await openFor(page, "אלף כהן");
  await page.click("#vr-comprehensive-btn");
  await page.waitForTimeout(300);
  await page.click("#visit-report-modal-cancel");
  await openFor(page, "בית לוי");
  const before = await page.locator("#vr-comprehensive-result").innerText();
  release();
  await page.waitForTimeout(600);
  const after = await page.locator("#vr-comprehensive-result").innerText();
  console.log("R4 comprehensive before:", JSON.stringify(before), "| after:", JSON.stringify(after));
  expect(after).not.toContain("של-א");
});

test("R1b banner staged log", async ({ browser }) => {
  const { page } = await setup(browser);
  await gatePatientA(page, ["patient_allergies"]);
  await openFor(page, "אלף כהן");
  await page.waitForTimeout(300);
  console.log("R1b after open A (A held):", JSON.stringify({ vis: await page.locator("#vr-allergy-banner").isVisible(), txt: await page.locator("#vr-allergy-banner").innerText() }));
  await switchToB(page);
  await page.waitForTimeout(500);
  console.log("R1b after open B (before release):", JSON.stringify({ vis: await page.locator("#vr-allergy-banner").isVisible(), txt: await page.locator("#vr-allergy-banner").innerText(), pid: await page.evaluate(() => document.getElementById("visit-report-modal").dataset.patientId) }));
  await page.evaluate(() => window.__release());
  await page.waitForTimeout(500);
  console.log("R1b after release:", JSON.stringify({ vis: await page.locator("#vr-allergy-banner").isVisible(), txt: await page.locator("#vr-allergy-banner").innerText() }));
});

test("R5 תיק מטופל: כותרת/אלרגיות/לשוניות של א' (תשובה מאוחרת) לא מוצגות מתחת לתיק של ב'", async ({ browser }) => {
  const { page } = await setup(browser);
  // מחזיקים את כל שאילתות א' בכל הטבלאות עד לשחרור
  await page.evaluate(() => {
    let release; window.__gate = new Promise((r) => (release = r)); window.__release = release;
    const orig = supabaseClient.from.bind(supabaseClient);
    supabaseClient.from = (t) => {
      const b = orig(t); const sel = b.select.bind(b);
      b.select = (...a) => { const q = sel(...a); const eq = q.eq.bind(q);
        q.eq = (col, val) => { const p = eq(col, val); if (String(val) === "p-1") { const th = p.then.bind(p); p.then = (res, rej) => window.__gate.then(() => th(res, rej)); } return p; };
        return q; };
      return b;
    };
  });
  await page.evaluate(() => { window.__openA = openPatientRecord("p-1"); }); // לא ממתינים: תשובת א' מוחזקת
  await page.evaluate(async () => { await openPatientRecord("p-2"); });
  await page.waitForTimeout(500);
  const stage = async () => ({
    stateId: await page.evaluate(() => window.currentPatientState.patientId),
    header: (await page.locator("#pr-header").innerText()).slice(0, 80).replace(/\n/g, " | "),
    banner: await page.locator("#pr-allergy-banner").isVisible() ? (await page.locator("#pr-allergy-banner").innerText()).slice(0, 60) : "(hidden)",
    tab: (await page.locator("#pr-tab-content").innerText()).slice(0, 100).replace(/\n/g, " | "),
  });
  const before = await stage();
  await page.evaluate(() => window.__release());
  await page.waitForTimeout(800);
  const after = await stage();
  console.log("R5 before release:", JSON.stringify(before));
  console.log("R5 after release :", JSON.stringify(after));
  expect(after.stateId).toBe("p-2");
  expect(after.header).toContain("בית לוי");
  expect(after.header).not.toContain("אלף כהן");
});
