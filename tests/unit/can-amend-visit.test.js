// כלל בעלים: רק המחבר המקורי מתקן דוח (public/app.js canAmendVisit). נתונים סינתטיים בלבד.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");
function page(uid) {
  const client = { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => {} }, from() { throw new Error("no db"); } };
  const ctx = vm.createContext({ console, fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }), AbortController, setTimeout, clearTimeout,
    window: { addEventListener: () => {}, supabase: { createClient: () => client } }, navigator: { onLine: true }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  vm.runInContext(SRC, ctx, { filename: "public/app.js" });
  ctx.setOfflineQueueOwner(uid);
  return ctx;
}

test("הכותב המקורי (author_user_id) רשאי; אחר לא - גם מנהל", () => {
  const p = page("u-author");
  assert.equal(p.canAmendVisit({ id: 1, staff_id: 5, author_user_id: "u-author" }), true);
  assert.equal(p.canAmendVisit({ id: 1, staff_id: 5, author_user_id: "u-other" }, { staffId: 5 }), false);   // השיוך לא עוקף מחבר מוכר
});

test("בלי מחבר מוכר: איש צוות רשאי רק לדוח המשויך אליו; מנהל (בלי staffId) אף פעם", () => {
  const p = page("u-nurse");
  assert.equal(p.canAmendVisit({ id: 2, staff_id: 5, author_user_id: null }, { staffId: 5 }), true);
  assert.equal(p.canAmendVisit({ id: 2, staff_id: 6 }, { staffId: 5 }), false);
  assert.equal(p.canAmendVisit({ id: 2, staff_id: 5 }), false);
});

test("בלי משתמש מחובר אין תיקון", () => {
  const p = page(null);
  assert.equal(p.canAmendVisit({ id: 3, staff_id: 5, author_user_id: "u-author" }), false);
});

test("אין טופס כשאין הרשאה, ויש הסבר; הרשימה המקורית נשמרת", () => {
  const p = page("u-x");
  const html = p.amendmentBlockHtml({ id: 9 }, [], false);
  assert.ok(!html.includes("amend-form")); assert.ok(html.includes("רק למי שתיעד"));
  assert.ok(p.amendmentBlockHtml({ id: 9 }, [], true).includes("amend-form"));
});
