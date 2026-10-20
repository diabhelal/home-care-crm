// תג רמת הסיכון (public/app.js): ההערכה האחרונה מוצגת תמיד, עם גיל; מעל 24 שעות "מיושן"; דוח חדש יותר שלא הוערך מסומן.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const APP_JS_SOURCE = fs.readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");
const doc = { createElement: () => { let t = ""; return { set textContent(v) { t = String(v); }, get innerHTML() { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } }; } };
const client = { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => {} } };
const ctx = vm.createContext({
  console, setTimeout, clearTimeout, AbortController, document: doc,
  window: { addEventListener: () => {}, supabase: { createClient: () => client } }, navigator: { onLine: true },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
});
vm.runInContext(APP_JS_SOURCE, ctx, { filename: "public/app.js" });
const NOW = Date.parse("2026-10-20T12:00:00Z");
const ago = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

test("riskAgeText: דקות, שעות וימים בעברית", () => {
  assert.equal(ctx.riskAgeText(ago(0), NOW), "הרגע");
  assert.equal(ctx.riskAgeText(new Date(NOW - 5 * 60000).toISOString(), NOW), "לפני 5 דקות");
  assert.equal(ctx.riskAgeText(ago(1), NOW), "לפני שעה");
  assert.equal(ctx.riskAgeText(ago(10), NOW), "לפני 10 שעות");
  assert.equal(ctx.riskAgeText(ago(72), NOW), "לפני 3 ימים");
  assert.equal(ctx.riskAgeText("not a date", NOW), "");
});

test("אדום ישן לא נעלם: מוצג עם גיל וסימון מיושן", () => {
  const html = ctx.riskBadgeHtml({ risk_level: "red", predicted_at: ago(72), is_stale: true }, NOW);
  assert.match(html, /risk-badge-red/); assert.match(html, /risk-badge-stale/);
  assert.match(html, /אדום/); assert.match(html, /לפני 3 ימים/); assert.match(html, /מיושן/);
});

test("הערכה טרייה: ללא סימון מיושן; אחרי אופק 8 שעות עדיין לא מיושנת", () => {
  const fresh = ctx.riskBadgeHtml({ risk_level: "green", predicted_at: ago(2), is_stale: false }, NOW);
  assert.doesNotMatch(fresh, /מיושן/); assert.doesNotMatch(fresh, /risk-badge-stale/);
  const afterHorizon = ctx.riskBadgeHtml({ risk_level: "yellow", predicted_at: ago(10) }, NOW);   // בלי is_stale מהשרת: מחושב מקומית
  assert.doesNotMatch(afterHorizon, /מיושן/); assert.match(afterHorizon, /צהוב/);
  assert.match(ctx.riskBadgeHtml({ risk_level: "yellow", predicted_at: ago(30) }, NOW), /מיושן/);
});

test("דוח חדש יותר שטרם הוערך מסומן, וללא הערכה בכלל: 'לא נבדק'", () => {
  assert.match(ctx.riskBadgeHtml({ risk_level: "green", predicted_at: ago(1), newer_report_exists: true }, NOW), /קיים דוח חדש יותר שטרם הוערך/);
  assert.match(ctx.riskBadgeHtml(null, NOW), /לא נבדק/);
});
