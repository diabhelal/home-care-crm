// בידוד בין מטופלים: תשובה אסינכרונית של מטופל א' שמגיעה אחרי שהמסך עבר למטופל ב' לא מוצגת ולא נשמרת בו.
// כל תרחיש מחזיק את שאילתות א' (supabase ממוקק) עד לשחרור, מחליף למטופל ב', משחרר ובודק שנשאר רק ב'.
// רץ בעמוד המנהל ובעמוד הצוות (אותו קוד משותף). fake supabase-js + backend + שירות תחזית ממוקקים; אפס DB חי.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const PREDICT = "http://predict.test:8000";
const ADMIN = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };
const STAFF = { user: { id: "staff-user-1", is_anonymous: false, app_metadata: {} } };
const PA = { id: "p-1", full_name: "אלף כהן", phone: "050-111 1111", address: "הרצל 5, חיפה", background_conditions: ["diabetes"], smoking_status: "smoker", date_of_birth: "1950-01-01" };
const PB = { id: "p-2", full_name: "בית לוי", phone: "050-222 2222", address: "הנשיא 9, חיפה", background_conditions: [], smoking_status: "never", date_of_birth: "1990-01-01" };
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const now = () => new Date().toISOString();
const booking = (id, p) => ({ id, patient_id: p.id, staff_id: 1, status: "scheduled", workflow_status: "assigned", approval_status: "confirmed",
  visit_purpose: "checkup", visit_address: p.address, scheduled_at: inHours(1), patients: p, medical_staff: { id: 1, full_name: "אחות הדגמה" } });
const rep = (id, pid, daysAgo, pulse) => ({ id, patient_id: pid, booking_id: 900 + id, staff_id: 1, visit_date: new Date(Date.now() - daysAgo * 86400000).toISOString(), pulse });
const risk = (pid, level) => ({ id: pid === "p-1" ? 1 : 2, patient_id: pid, risk_level: level, trend: null, predicted_at: now(), expires_at: inHours(8), prediction_horizon_hours: 8, created_at: now() });

async function setup(browser, role, { predictHandler } = {}) {
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
  await page.evaluate(({ session, PA, PB, a, b, risks, reps }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.patients = [PA, PB]; db.bookings = [a, b]; db.visit_reports = reps; db.seq = 500;
    db.patient_allergies = [{ id: 1, patient_id: "p-1", substance: "אגוזים", severity: "mild", created_at: new Date().toISOString() },
                            { id: 2, patient_id: "p-2", substance: "פניצילין", severity: "severe", created_at: new Date().toISOString() }];
    db.current_patient_risk = risks; db.risk_predictions = risks;
    localStorage.setItem("__demo_db", JSON.stringify(db));
    localStorage.setItem("__demo_session", JSON.stringify(session));
    localStorage.setItem("__write_log", "[]");
  }, { session: role === "admin" ? ADMIN : STAFF, PA, PB, a: booking(7, PA), b: booking(8, PB), risks: [risk("p-1", "red"), risk("p-2", "green")],
       reps: [rep(1, "p-1", 3, 100), rep(2, "p-1", 2, 101), rep(3, "p-1", 1, 102), rep(4, "p-2", 3, 60), rep(5, "p-2", 2, 61), rep(6, "p-2", 1, 62)] });
  await page.goto(BASE + (role === "admin" ? "/admin.html" : "/employee.html"));
  await page.waitForFunction(() => typeof openVisitReportModal === "function" && typeof openPatientRecord === "function");
  await page.evaluate(({ a, b }) => { window.__bkA = a; window.__bkB = b; }, { a: booking(7, PA), b: booking(8, PB) });
  return { page, errors };
}

// מחזיק את כל שאילתות מטופל א' (eq(..., "p-1")) בטבלאות הנתונות (null = כולן) עד window.__rel()
const gateA = (page, tables) => page.evaluate((tables) => {
  let rel; window.__gate = new Promise((r) => (rel = r)); window.__rel = rel;
  const orig = supabaseClient.from.bind(supabaseClient);
  supabaseClient.from = (t) => {
    const b = orig(t); if (tables && !tables.includes(t)) return b; const sel = b.select.bind(b);
    b.select = (...a) => { const q = sel(...a); const eq = q.eq.bind(q);
      q.eq = (c, v) => { const p = eq(c, v); if (String(v) === "p-1") { const th = p.then.bind(p); p.then = (res, rej) => window.__gate.then(() => th(res, rej)); } return p; };
      return q; };
    return b;
  };
}, tables);
const release = (page) => page.evaluate(() => window.__rel());
const openModal = (page, w) => page.evaluate((w) => openVisitReportModal(w === "A" ? window.__bkA : window.__bkB, null), w);
const settle = (page) => page.waitForTimeout(500);
const B_CONTEXT = { background_conditions: [], smoking_status: "never" };

for (const role of ["admin", "employee"]) {
  test.describe(`בידוד בין מטופלים (${role})`, () => {
    test("באנר הרגישויות: תשובה מאוחרת של א' לא דורסת את הרגישויות של ב'", async ({ browser }) => {
      const { page, errors } = await setup(browser, role);
      await gateA(page, ["patient_allergies"]);
      await openModal(page, "A"); await openModal(page, "B"); await settle(page);
      await expect(page.locator("#vr-allergy-banner")).toContainText("פניצילין");
      await release(page); await settle(page);
      const txt = await page.locator("#vr-allergy-banner").innerText();
      expect(txt).toContain("פניצילין"); expect(txt).not.toContain("אגוזים");
      expect(errors).toEqual([]);
    });

    test("הרקע הרפואי לחישוב סיכון נשאר של ב'", async ({ browser }) => {
      const { page } = await setup(browser, role);
      await gateA(page, ["patients"]);
      await openModal(page, "A"); await openModal(page, "B"); await settle(page);
      await release(page); await settle(page);
      expect(await page.evaluate(() => vrPatientContext)).toEqual(B_CONTEXT);
    });

    test("פאנל הסיכון של ב' (ירוק) לא מוחלף באדום של א'", async ({ browser }) => {
      const { page } = await setup(browser, role);
      await gateA(page, ["current_patient_risk", "risk_predictions"]);
      await openModal(page, "A"); await openModal(page, "B"); await settle(page);
      const before = await page.locator("#vr-risk-panel").innerText();
      expect(before).toContain("ירוק");
      await release(page); await settle(page);
      expect(await page.locator("#vr-risk-panel").innerText()).toBe(before);
    });

    test("פאנל הסיכון מציג את גיל ההערכה (נמדד ב... בתוקף עד...) גם בעמוד זה", async ({ browser }) => {
      const { page } = await setup(browser, role);
      await openModal(page, "B"); await settle(page);
      const txt = await page.locator("#vr-risk-panel").innerText();
      expect(txt).toContain("נמדד ב"); expect(txt).toContain("בתוקף עד");
    });

    test("החלפות מהירות א'→ב'→א'→ב' עם תשובות מאוחרות: נשאר רק ב'", async ({ browser }) => {
      const { page } = await setup(browser, role);
      await gateA(page, null);
      for (const w of ["A", "B", "A", "B"]) await openModal(page, w);
      await settle(page); await release(page); await settle(page);
      expect(await page.evaluate(() => vrPatientContext)).toEqual(B_CONTEXT);
      expect(await page.locator("#vr-allergy-banner").innerText()).toContain("פניצילין");
      expect(await page.locator("#vr-risk-panel").innerText()).toContain("ירוק");
    });

    test("כותרת תיק המטופל: תשובה מאוחרת של א' לא מוצגת מעל תיק ב'", async ({ browser }) => {
      const { page } = await setup(browser, role);
      await gateA(page, null);
      await page.evaluate(() => { window.__a = openPatientRecord("p-1"); });
      await page.evaluate(async () => { await openPatientRecord("p-2"); });
      await settle(page);
      await expect(page.locator("#pr-header")).toContainText("בית לוי");
      await release(page); await settle(page);
      const hdr = await page.locator("#pr-header").innerText();
      expect(hdr).toContain("בית לוי"); expect(hdr).not.toContain("אלף כהן");
      expect(await page.evaluate(() => window.currentPatientState.patientId)).toBe("p-2");
      expect(await page.locator("#pr-allergy-banner").innerText()).toContain("פניצילין");
      expect(await page.locator("#pr-tab-content").innerText()).not.toContain("אלף כהן");
    });
  });
}

test.describe("בידוד בין מטופלים (מנהל בלבד)", () => {
  test("אבחון מקיף: תוצאה מאוחרת של א' לא מוצגת בדוח של ב'", async ({ browser }) => {
    let rel; const gate = new Promise((r) => (rel = r));
    const full = (tag) => ({ status: 200, json: { status_message: "סטטוס " + tag, current_risk: { level: "green" }, short_term_concern: "low", explanation: "הסבר " + tag,
      reassessment_recommended_in_hours: 8, risk_window_hours: 8, trigger_events: [], baseline_analysis: [], vital_forecasts: [], future_event_models: [] } });
    const { page } = await setup(browser, "admin", { predictHandler: async (req) => {
      if (!req.url().includes("/predict/medical-warning")) return null;
      const isA = req.postDataJSON().history[0].pulse >= 100; if (isA) await gate; return full(isA ? "של-א" : "של-ב"); } });
    await openModal(page, "A"); await page.click("#vr-comprehensive-btn"); await page.waitForTimeout(300);
    await openModal(page, "B"); rel(); await settle(page);
    await expect(page.locator("#vr-comprehensive-result")).not.toContainText("של-א");
    await expect(page.locator("#vr-comprehensive-btn")).toBeEnabled();
  });

  test("תצוגה חיה של סיכון: תשובה מאוחרת של א' לא מוצגת בדוח של ב'", async ({ browser }) => {
    let rel; const gate = new Promise((r) => (rel = r));
    const { page } = await setup(browser, "admin", { predictHandler: async (req) => {
      if (!req.url().includes("/predict/risk-assessment")) return null;
      const isA = (req.postDataJSON().patient_context || {}).smoking_status === "smoker"; if (isA) await gate;
      return { status: 200, json: { risk_level: isA ? "red" : "green", status_message: isA ? "תצוגה-של-א" : "תצוגה-של-ב", flagged_vitals: [] } }; } });
    await openModal(page, "A"); await page.waitForTimeout(300);
    await page.fill("#vr-pulse", "180"); await page.waitForTimeout(700);
    await openModal(page, "B"); await settle(page); rel(); await settle(page);
    await expect(page.locator("#vr-risk-panel")).not.toContainText("תצוגה-של-א");
  });
});
