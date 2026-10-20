// היסטוריית מדידות (public/app.js): כל בדיקה נשמרת, החדש למעלה, והשינוי מחושב מול המדידה הקודמת של אותו מדד.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const APP_JS_SOURCE = fs.readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");
const client = { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => {} } };
const ctx = vm.createContext({
  console, setTimeout, clearTimeout, AbortController,
  document: { createElement: () => { let t = ""; return { set textContent(v) { t = String(v); }, get innerHTML() { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }; } },
  window: { addEventListener: () => {}, supabase: { createClient: () => client } }, navigator: { onLine: true },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
});
vm.runInContext(APP_JS_SOURCE, ctx, { filename: "public/app.js" });


const record = {
  patient: { id: "11111111-aaaa", full_name: "דנה <b>כהן</b>", national_id: "123", archived_at: "2026-10-20T08:00:00Z", archive_reason: "סיום טיפול" },
  visit_reports: [{ id: 1, visit_date: "2026-10-13T08:00:00Z", systolic_bp: 140, pulse: 80, performed_injection: true, treatment_summary: "<script>alert(1)</script> טופל" }],
  visit_report_amendments: [{ visit_report_id: 1, created_at: "2026-10-14T08:00:00Z", reason: "טעות", corrections: { systolic_bp: 135 } }],
  risk_predictions: [{ predicted_at: "2026-10-13T08:05:00Z", risk_level: "red", trend: "worsening" }],
  export: { log_id: 7, exported_at: "2026-10-21T09:00:00Z", requester_type: "legal", requester_name: "עו\"ד", basis: "צו 123/26" },
};

test("מסמך ההדפסה: כולל ביקור, תיקון (והמקור), הערכת סיכון, מבקש ובסיס, ומעקר HTML", () => {
  const html = ctx.patientRecordPrintHtml(record);
  assert.match(html, /תיק מטופל מלא/); assert.match(html, /צו 123\/26/); assert.match(html, /גורם משפטי/);
  assert.match(html, /מספר רישום ביומן הגישה: 7/);
  assert.match(html, /ל"ד סיסטולי: 140/);                 // המקור
  assert.match(html, /תיקונים והבהרות/); assert.match(html, /טעות/);
  assert.match(html, /אדום/); assert.match(html, /בארכיון מאז/);
  assert.doesNotMatch(html, /<script>alert/); assert.doesNotMatch(html, /דנה <b>/);   // לא מזריק HTML
  assert.match(html, /&lt;script&gt;/);
});

test("שם קובץ: מזהה מקוצר ותאריך הוצאה", () => {
  assert.equal(ctx.patientRecordFilename(record), "patient-record-11111111-2026-10-21.json");
});
