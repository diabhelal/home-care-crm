// escapeHtml (public/app.js) must be safe inside double-quoted attributes too (stored-XSS fix). Synthetic strings only.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");
function load() {
  const client = { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => {} }, from() { throw new Error("no db"); } };
  // minimal DOM: textContent -> innerHTML escaping & < > exactly like a browser
  const fakeDiv = { set textContent(v) { this._t = String(v); }, get innerHTML() { return this._t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); } };
  const ctx = vm.createContext({ console, fetch: async () => ({}), AbortController, setTimeout, clearTimeout,
    window: { addEventListener: () => {}, supabase: { createClient: () => client } }, navigator: { onLine: true },
    document: { createElement: () => Object.create(fakeDiv) }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  vm.runInContext(SRC, ctx, { filename: "public/app.js" });
  return ctx;
}

test("גרשיים מנוטרלים כך שערך בתוך value=\"...\" לא יכול לצאת מהמאפיין", () => {
  const { escapeHtml } = load();
  const evil = 'x" autofocus onfocus="alert(1)';
  const out = escapeHtml(evil);
  assert.ok(!out.includes('"'), out);
  assert.equal(escapeHtml("a'b"), "a&#39;b");
  assert.equal(escapeHtml("<b>&"), "&lt;b&gt;&amp;");
  assert.equal(escapeHtml('<img src=x onerror="1">').includes("<"), false);
});
