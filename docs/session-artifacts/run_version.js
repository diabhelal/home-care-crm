// READ-ONLY comparison harness: same scenarios on any extracted version. Mocked supabase, synthetic data, no live DB.
const R = "/Users/helaldiab/home-care-crm";
const { chromium } = require(R + "/node_modules/@playwright/test");
const { fakeSupabaseSource } = require(R + "/tests/e2e/helpers/fake-supabase");
const { spawn } = require("child_process");
const [,, name, dir, port] = process.argv;
const BASE = `http://demo.localhost:${port}`;
const now = () => new Date().toISOString();
const PA = { id: "p-1", full_name: "אלף כהן", phone: "050-111", address: "x", background_conditions: ["diabetes"], smoking_status: "smoker", date_of_birth: "1950-01-01" };
const PB = { id: "p-2", full_name: "בית לוי", phone: "050-222", address: "y", background_conditions: [], smoking_status: "never", date_of_birth: "1990-01-01" };
const bk = (id, pid, p) => ({ id, patient_id: pid, staff_id: 1, status: "scheduled", workflow_status: "assigned", approval_status: "confirmed", visit_purpose: "checkup", scheduled_at: new Date(Date.now() + 3600e3).toISOString(), patients: p, medical_staff: { id: 1, full_name: "אחות הדגמה" } });
const out = {};
(async () => {
  const srv = spawn("python3", ["-m", "http.server", port, "--directory", dir + "/public"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 900));
  const browser = await chromium.launch();
  async function fresh() {
    const ctx = await browser.newContext({ serviceWorkers: "block", locale: "he-IL", viewport: { width: 1100, height: 900 } });
    await ctx.route("**/@supabase/supabase-js@*", (r) => r.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
    await ctx.route(/(localhost|127\.0\.0\.1):(8000|8001)/, (r) => r.fulfill({ status: 503, body: "{}" }));
    const page = await ctx.newPage();
    await page.goto(BASE + "/index.html");
    await page.evaluate(({ PA, PB, n }) => {
      const db = {}; db.seq = 500; db.patients = [PA, PB];
      db.medical_staff = [{ id: 1, full_name: "אחות הדגמה", role: "nurse", is_active: true, auth_user_id: "staff-user-1", available_weekdays: [0,1,2,3,4,5,6], work_start_time: "08:00:00", work_end_time: "16:00:00", slot_duration_minutes: 60 }];
      db.bookings = []; db.visit_reports = [];
      db.patient_allergies = [{ id: 1, patient_id: "p-1", substance: "אגוזים", severity: "mild", created_at: n }, { id: 2, patient_id: "p-2", substance: "פניצילין", severity: "severe", created_at: n }];
      const risk = (pid, lvl) => ({ id: pid === "p-1" ? 1 : 2, patient_id: pid, risk_level: lvl, trend: null, predicted_at: n, expires_at: new Date(Date.now() + 8 * 3600e3).toISOString(), prediction_horizon_hours: 8, created_at: n });
      db.current_patient_risk = [risk("p-1", "red"), risk("p-2", "green")]; db.risk_predictions = [risk("p-1", "red"), risk("p-2", "green")];
      localStorage.setItem("__demo_db", JSON.stringify(db));
      localStorage.setItem("__demo_session", JSON.stringify({ user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } }));
    }, { PA, PB, n: now() });
    await page.goto(BASE + "/admin.html"); await page.waitForTimeout(700);
    return { ctx, page };
  }
  const gate = (page, tables) => page.evaluate((tables) => {
    let rel; window.__gate = new Promise((r) => (rel = r)); window.__rel = rel;
    const orig = supabaseClient.from.bind(supabaseClient);
    supabaseClient.from = (t) => { const b = orig(t); if (tables && !tables.includes(t)) return b; const sel = b.select.bind(b);
      b.select = (...a) => { const q = sel(...a); const eq = q.eq.bind(q);
        q.eq = (c, v) => { const p = eq(c, v); if (String(v) === "p-1") { const th = p.then.bind(p); p.then = (res, rej) => window.__gate.then(() => th(res, rej)); } return p; }; return q; }; return b; };
  }, tables);
  const open = (page, id) => page.evaluate(({ id, bkA, bkB }) => { const b = id === 1 ? bkA : bkB; openVisitReportModal(b, null); }, { id, bkA: bk(7, "p-1", PA), bkB: bk(8, "p-2", PB) });
  async function scenario(label, fn) { const { ctx, page } = await fresh(); try { out[label] = await fn(page); } catch (e) { out[label] = "n/a (" + String(e.message).split("\n")[0].slice(0, 60) + ")"; } await ctx.close(); }

  await scenario("R2 vrPatientContext", async (page) => { await gate(page, ["patients"]); await open(page, 1); await open(page, 2); await page.waitForTimeout(300); await page.evaluate(() => window.__rel()); await page.waitForTimeout(500);
    const ctxv = await page.evaluate(() => JSON.stringify(vrPatientContext)); return ctxv.includes("diabetes") ? "BUG (A's data under B)" : "ok"; });
  await scenario("R3 risk panel", async (page) => { await gate(page, ["current_patient_risk", "risk_predictions"]); await open(page, 1); await open(page, 2); await page.waitForTimeout(400);
    const before = await page.locator("#vr-risk-panel").innerText(); await page.evaluate(() => window.__rel()); await page.waitForTimeout(600); const after = await page.locator("#vr-risk-panel").innerText();
    return after !== before ? "BUG (panel changed to A)" : "ok"; });
  await scenario("R1 allergy banner", async (page) => { await gate(page, ["patient_allergies"]); await open(page, 1); await open(page, 2); await page.waitForTimeout(400);
    const before = await page.locator("#vr-allergy-banner").innerText().catch(() => "(none)"); await page.evaluate(() => window.__rel()); await page.waitForTimeout(600);
    const after = await page.locator("#vr-allergy-banner").innerText().catch(() => "(none)"); if (before === "(none)" && after === "(none)") return "n/a (feature not present)"; return after !== before ? "BUG (banner replaced)" : "ok"; });
  await scenario("R5 patient record header", async (page) => { await gate(page, null); await page.evaluate(() => { window.__a = openPatientRecord("p-1"); });
    await page.evaluate(async () => { await openPatientRecord("p-2"); }); await page.waitForTimeout(500); await page.evaluate(() => window.__rel()); await page.waitForTimeout(900);
    const hdr = await page.locator("#pr-header").innerText(); return hdr.includes("אלף כהן") ? "BUG (A's header over B)" : hdr.includes("בית לוי") ? "ok" : "n/a (header empty)"; });
  await scenario("D1 draft stored in plaintext", async (page) => { const r = await page.evaluate(() => { const d = { booking_id: 7, patient_id: "p-1", staff_id: 1, treatment_summary: "סינתטי-סיכום", patient_signature_data: "data:image/png;base64,SIG", pulse: 80 };
      try { if (typeof setOfflineQueueOwner === "function") setOfflineQueueOwner("user-a"); queueVisitReportDraft(d); } catch (e) { return "ERR " + e.message; }
      const keys = Object.keys(localStorage).filter((k) => k.toLowerCase().includes("offline")); const txt = keys.map((k) => localStorage.getItem(k)).join(""); return { keys, plain: txt.includes("סינתטי-סיכום") && txt.includes("SIG") }; });
    return typeof r === "string" ? r : (r.plain ? "plaintext" : "not plaintext") + "; keys=" + r.keys.join("|"); });
  await scenario("D3 write with no owner -> shared key", async (page) => { const r = await page.evaluate(() => { const d = { booking_id: 7, patient_id: "p-1", staff_id: 1, treatment_summary: "x" };
      try { if (typeof setOfflineQueueOwner === "function") setOfflineQueueOwner(null); queueVisitReportDraft(d); } catch (e) { return "refused: " + (e.name || e.message); }
      return Object.keys(localStorage).filter((k) => k.toLowerCase().includes("offline")).join("|"); }); return r.startsWith("refused") ? r : "wrote to " + r; });

  await scenario("T1 trend btn, predictive svc DOWN", async (page) => {
    await page.context().route(/(localhost|127\.0\.0\.1):(8000|8001)/, (r) => r.abort("connectionrefused"));
    await page.evaluate(() => { const db = JSON.parse(localStorage.getItem("__demo_db")); const d = (n) => new Date(Date.now() - n * 86400000).toISOString();
      db.visit_reports = [{ id: 1, patient_id: "p-1", booking_id: 91, staff_id: 1, visit_date: d(3), pulse: 100 }, { id: 2, patient_id: "p-1", booking_id: 92, staff_id: 1, visit_date: d(2), pulse: 101 }, { id: 3, patient_id: "p-1", booking_id: 93, staff_id: 1, visit_date: d(1), pulse: 102 }];
      localStorage.setItem("__demo_db", JSON.stringify(db)); });
    await open(page, 1); await page.click("#vr-check-trend-btn"); await page.waitForTimeout(900);
    const t = (await page.locator("#vr-trend-result").innerText()).replace(/\s+/g, " ").slice(0, 70);
    return (/לא זמין|שירות התחזית/.test(t) && !/אין מספיק/.test(t) ? "clear message: " : "MISLEADING: ") + t; });
  await browser.close(); srv.kill();
  console.log("### " + name); for (const [k, v] of Object.entries(out)) console.log("  " + k.padEnd(34) + v);
})().catch((e) => { console.log("FATAL", name, e.message); process.exit(1); });
