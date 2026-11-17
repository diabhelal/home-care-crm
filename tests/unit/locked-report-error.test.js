// עריכה של דוח חתום / רשומה מבוטלת שנדחתה במסד (SQLSTATE 55000): PostgREST מחזיר עליה HTTP 500.
// היא לא תקלת חיבור (אין "נסו שוב"), ומוצגת הודעה בעברית שמסבירה מה לעשות - לא טקסט אנגלי גולמי. (public/app.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");
function load() {
  const client = { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => {} }, from() { throw new Error("no db"); } };
  const ctx = vm.createContext({ console, fetch: async () => ({}), AbortController, setTimeout, clearTimeout,
    window: { addEventListener: () => {}, supabase: { createClient: () => client } }, navigator: { onLine: true },
    document: { createElement: () => ({}) }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  vm.runInContext(SRC, ctx, { filename: "public/app.js" });
  return ctx;
}

// כך supabase-js מחזיר את השגיאה מ-PostgREST (status 500, code 55000, הודעת הטריגר באנגלית)
const pgErr = (message) => ({ status: 500, code: "55000", message, details: null, hint: null });

test("דוח חתום: לא נחשב תקלת חיבור למרות HTTP 500", () => {
  const { isConnectivityError } = load();
  assert.equal(isConnectivityError(pgErr("a completed visit report is locked; correct it with an amendment by its author")), false);
});

test("דוח חתום: הודעה בעברית עם הדרך הנכונה (תיקון לדוח), בלי הטקסט האנגלי של המסד", () => {
  const { friendlyErrorMessage } = load();
  const msg = friendlyErrorMessage(pgErr("a completed visit report is locked; correct it with an amendment by its author"));
  assert.match(msg, /נעול/);
  assert.match(msg, /תיקון לדוח/);
  assert.doesNotMatch(msg, /locked|amendment/);
});

test("תוצאת 8 שעות שכבר נרשמה ורשומה מבוטלת: הודעות ייעודיות", () => {
  const { friendlyErrorMessage } = load();
  assert.match(friendlyErrorMessage(pgErr("the 8h clinical outcome was already recorded and cannot be rewritten")), /כבר נרשמה/);
  assert.match(friendlyErrorMessage(pgErr("a voided record cannot be changed again")), /שבוטלה/);
  assert.match(friendlyErrorMessage(pgErr("something else")), /אינה אפשרית/);
});

test("אין הרשאה (42501) גם הוא לא תקלת חיבור; 5xx אמיתי ותקלת רשת עדיין כן", () => {
  const { isConnectivityError } = load();
  assert.equal(isConnectivityError({ status: 500, code: "42501", message: "permission denied" }), false);
  assert.equal(isConnectivityError({ status: 503, message: "Service Unavailable" }), true);
  assert.equal(isConnectivityError({ status: 0, name: "TypeError", message: "Failed to fetch" }), true);
});

test("שגיאות רגילות לא השתנו: מחרוזת מוצגת כמו שהיא, ושגיאת רשת מתורגמת", () => {
  const { friendlyErrorMessage } = load();
  assert.equal(friendlyErrorMessage("הודעה רגילה"), "הודעה רגילה");
  assert.match(friendlyErrorMessage({ message: "Failed to fetch" }), /בעיית חיבור/);
});
