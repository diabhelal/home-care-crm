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
  document: { createElement: () => { let t = ""; return { set textContent(v) { t = String(v); }, get innerHTML() { return t; } }; } },
  window: { addEventListener: () => {}, supabase: { createClient: () => client } }, navigator: { onLine: true },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
});
vm.runInContext(APP_JS_SOURCE, ctx, { filename: "public/app.js" });

const v = (iso, o) => ({ visit_date: iso, ...o });
const week1 = v("2026-10-13T08:00:00Z", { systolic_bp: 140, diastolic_bp: 90, pulse: 88, blood_sugar: 110 });
const week2 = v("2026-10-20T08:00:00Z", { systolic_bp: 125, diastolic_bp: 90, pulse: 92 });

test("שתי בדיקות: שתיהן נשמרות, החדשה למעלה, והשינוי מול הקודמת", () => {
  const rows = ctx.vitalsHistoryRows([week1, week2]);           // הסדר בקלט לא משנה
  assert.equal(rows.length, 2);
  assert.equal(rows[0].visit, week2); assert.equal(rows[1].visit, week1);
  const cell = (row, key) => row.cells.find((c) => c.key === key);
  assert.equal(cell(rows[1], "systolic_bp").value, 140); assert.equal(cell(rows[1], "systolic_bp").delta, null);   // הראשונה: אין קודמת
  assert.equal(cell(rows[0], "systolic_bp").delta, -15);
  assert.equal(cell(rows[0], "diastolic_bp").delta, 0);
  assert.equal(cell(rows[0], "pulse").delta, 4);
  assert.equal(cell(rows[0], "blood_sugar").value, null);        // לא נמדד בשבוע השני: אין דריסה ואין השוואה שגויה
});

test("השוואה לפי המדידה הקודמת של אותו מדד, גם אם מדד נדלג בביקור ביניים", () => {
  const mid = v("2026-10-16T08:00:00Z", { pulse: 70 });
  const rows = ctx.vitalsHistoryRows([week1, mid, week2]);
  const pulse = (r) => r.cells.find((c) => c.key === "pulse");
  assert.deepEqual(rows.map((r) => pulse(r).delta), [22, -18, null]);
  const sugar = rows.map((r) => r.cells.find((c) => c.key === "blood_sugar"));
  assert.deepEqual(sugar.map((c) => c.value), [null, null, 110]);
});

test("טבלה: מציגה את שני התאריכים, חצי שינוי, ו'—' למדד חסר; בלי נתונים: הודעה", () => {
  const html = ctx.vitalsHistoryTableHtml([week1, week2]);
  assert.match(html, /▼ -15/); assert.match(html, /▲ \+4/); assert.match(html, /＝/);
  assert.match(html, /<strong>140<\/strong>/); assert.match(html, /<strong>125<\/strong>/);
  assert.match(html, /—/);
  assert.ok(html.indexOf("125") < html.indexOf("140"), "החדש למעלה");
  assert.match(ctx.vitalsHistoryTableHtml([]), /אין עדיין מדידות/);
  assert.match(ctx.vitalsHistoryTableHtml([v("2026-10-13T08:00:00Z", {})]), /אין עדיין מדידות/);
});

test("ערכים עשרוניים: ההפרש מעוגל לספרה אחת", () => {
  const rows = ctx.vitalsHistoryRows([v("2026-10-13T08:00:00Z", { temperature: 36.6 }), v("2026-10-20T08:00:00Z", { temperature: 37.4 })]);
  assert.equal(rows[0].cells.find((c) => c.key === "temperature").delta, 0.8);
});

test("תיקון בדיעבד: הערך המתוקן מוצג מסומן, המקורי נשמר ונראה, וההשוואה לפי הערך המתוקן", () => {
  const visits = [{ id: 1, ...week1 }, { id: 2, ...week2 }];
  const amendments = [{ visit_report_id: 1, created_at: "2026-10-21T08:00:00Z", reason: "טעות הקלדה", corrections: { systolic_bp: 135 } }];
  const rows = ctx.vitalsHistoryRows(visits, amendments);
  const sys = (r) => r.cells.find((c) => c.key === "systolic_bp");
  assert.equal(sys(rows[1]).value, 135); assert.equal(sys(rows[1]).original, 140); assert.equal(sys(rows[1]).corrected, true);
  assert.equal(sys(rows[0]).delta, -10);                       // 125 מול 135 (המתוקן), לא מול 140
  const html = ctx.vitalsHistoryTableHtml(visits, amendments);
  assert.match(html, /✎ מקור 140/); assert.match(html, /<strong>135<\/strong>/);
  // תיקון אחרון קובע; ללא תיקון לא מסומן
  const two = amendments.concat([{ visit_report_id: 1, created_at: "2026-10-22T08:00:00Z", reason: "שוב", corrections: { systolic_bp: 138 } }]);
  assert.equal(ctx.vitalsHistoryRows(visits, two)[1].cells.find((c) => c.key === "systolic_bp").value, 138);
  assert.equal(sys(ctx.vitalsHistoryRows(visits, [])[0]).corrected, false);
});
