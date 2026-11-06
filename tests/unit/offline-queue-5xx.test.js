// טיוטות אחרי כשל שרת (5xx / timeout): התוכן נשמר במכשיר ולא נמחק, המשתמש רואה במפורש שלא התקבל אישור שמירה מהשרת,
// ויש ניסיון חוזר בלי אובדן מידע. נתונים סינתטיים בלבד. (public/app.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const APP_JS_SOURCE = fs.readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");

function storageShim() {
  const store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    keys: () => Object.keys(store), raw: store,
  };
}

// DOM מינימלי - מספיק לבאנר: id, role, style, textContent, replaceChildren, addEventListener
function fakeDocument() {
  const byId = {};
  const el = (tag) => {
    const n = { tag, style: {}, attrs: {}, listeners: {}, children: [], disabled: false, _text: "" };
    n.setAttribute = (k, v) => { n.attrs[k] = v; };
    n.addEventListener = (ev, fn) => { n.listeners[ev] = fn; };
    n.replaceChildren = (...kids) => { n.children = kids; n._text = ""; };
    Object.defineProperty(n, "textContent", { get: () => n._text + n.children.map((c) => c.textContent).join(""), set: (v) => { n._text = String(v); n.children = []; } });
    return n;
  };
  const doc = {
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => el(tag),
    body: { prepend: (n) => { byId[n.id] = n; } },
  };
  return doc;
}

async function createPage({ userId = "user-a", storage = storageShim() } = {}) {
  const state = { respond: null, calls: [] };
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "tok-" + userId, user: { id: userId } } } }),
      onAuthStateChange: (cb) => { state.authCb = cb; },
    },
    from() { return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }; },
  };
  const fetchMock = async (url, init) => {
    state.calls.push({ url });
    if (/risk-assessment/.test(url)) return { ok: true, status: 200, json: async () => ({ risk_level: "green" }) };
    const r = state.respond ? await state.respond({ url }) : null;
    if (r === "abort") { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
    if (r) return { ok: r.status < 300, status: r.status, json: async () => r.json || {} };
    return { ok: true, status: 200, json: async () => ({ report: { id: 500 } }) };
  };
  const document = fakeDocument();
  const ctx = vm.createContext({
    console: { ...console, error: () => {} }, fetch: fetchMock, AbortController, setTimeout, clearTimeout, document,
    window: { addEventListener: () => {}, BACKEND_URL: "http://backend.test", supabase: { createClient: () => client } },
    navigator: { onLine: true }, localStorage: storage,
  });
  vm.runInContext(APP_JS_SOURCE, ctx, { filename: "public/app.js" });
  await new Promise((r) => setImmediate(r));
  return { ctx, state, storage, document };
}
const draft = (id, extra = {}) => ({ booking_id: id, patient_id: "p" + id, staff_id: 7, treatment_summary: "תוכן קליני סינתטי " + id, systolic_bp: 121, _markCompleted: true, ...extra });
const stored = (p) => JSON.parse(p.storage.getItem("visitReportOfflineQueue:user-a") || "[]");
const banner = (p) => p.document.getElementById("offline-draft-banner");

test("5xx: הטיוטה נשמרת בייט-לבייט, מוחזרת שגיאה מפורשת 'לא אושר בשרת', ושום דבר לא נמחק", async () => {
  const p = await createPage();
  const d = draft(1);
  p.ctx.queueVisitReportDraft(d);
  const before = JSON.stringify(stored(p));
  p.state.respond = async () => ({ status: 500, json: {} });
  const r = await p.ctx.flushOfflineQueue();
  assert.equal(r.synced, 0);
  assert.equal(JSON.stringify(stored(p)), before);                                   // התוכן זהה לחלוטין
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].kind, "server");
  assert.equal(r.errors[0].retryable, true);
  assert.match(r.errors[0].message, /לא אישר את שמירת הדוח/);
  assert.match(r.errors[0].message, /לא נמחק/);
  assert.match(r.errors[0].message, /500/);
});

test("5xx חוזר שוב ושוב לא מוחק ולא מכפיל; ניסיון חוזר מוצלח שולח ומסיר רק אחרי אישור", async () => {
  const p = await createPage();
  p.ctx.queueVisitReportDraft(draft(1));
  const before = JSON.stringify(stored(p));
  p.state.respond = async () => ({ status: 503, json: {} });
  for (let i = 0; i < 3; i++) await p.ctx.flushOfflineQueue();
  assert.equal(JSON.stringify(stored(p)), before);
  p.state.respond = null;                                                            // השרת חזר
  const r = await p.ctx.flushOfflineQueue();
  assert.equal(r.synced, 1);
  assert.equal(stored(p).length, 0);
  assert.equal(p.ctx.getOfflineQueueLastErrors().length, 0);                         // האזהרה נעלמת רק אחרי הצלחה
});

test("timeout: הודעה שאומרת שלא ידוע אם נשמר, הטיוטה נשארת", async () => {
  const p = await createPage();
  p.ctx.queueVisitReportDraft(draft(1));
  p.state.respond = async () => "abort";
  const r = await p.ctx.flushOfflineQueue();
  assert.equal(r.errors[0].kind, "timeout");
  assert.match(r.errors[0].message, /לא ידוע אם הדוח נשמר/);
  assert.equal(stored(p).length, 1);
});

test("אין חיבור (network) אינו מוצג כשגיאת שרת - הבאנר הרגיל 'ממתין לסנכרון' נשאר", async () => {
  const p = await createPage();
  p.ctx.queueVisitReportDraft(draft(1));
  p.state.respond = async () => { throw new TypeError("Failed to fetch"); };
  const r = await p.ctx.flushOfflineQueue();
  assert.equal(r.errors.length, 0);
  p.ctx.updateOfflineDraftBanner();
  assert.match(banner(p).textContent, /ממתין לסנכרון/);
  assert.equal(banner(p).attrs.role, "status");
});

test("הבאנר אחרי 5xx: אזהרה מפורשת, התוכן לא אבד, וכפתור 'נסה שוב עכשיו' שמסנכרן בלי אובדן", async () => {
  const p = await createPage();
  p.ctx.queueVisitReportDraft(draft(1)); p.ctx.queueVisitReportDraft(draft(2));
  p.state.respond = async () => ({ status: 500, json: {} });
  await p.ctx.flushOfflineQueue();
  p.ctx.updateOfflineDraftBanner();
  const b = banner(p);
  assert.equal(b.attrs.role, "alert");
  assert.match(b.textContent, /2 דוחות ביקור לא אושרו בשרת/);
  assert.match(b.textContent, /התוכן לא אבד ולא נמחק/);
  const retry = b.children.find((c) => c.tag === "button");
  assert.ok(retry, "retry button present");
  assert.match(retry.textContent, /נסה שוב/);
  p.state.respond = null;                                                            // השרת חזר, המשתמש לוחץ
  await retry.listeners.click();
  assert.equal(stored(p).length, 0);
  assert.equal(banner(p).style.display, "none");
});

test("החלפת משתמש מנקה אזהרות של המשתמש הקודם והטיוטות שלו נשארות שמורות", async () => {
  const p = await createPage();
  p.ctx.queueVisitReportDraft(draft(1));
  p.state.respond = async () => ({ status: 500, json: {} });
  await p.ctx.flushOfflineQueue();
  assert.equal(p.ctx.getOfflineQueueLastErrors().length, 1);
  p.ctx.setOfflineQueueOwner("user-b");
  assert.equal(p.ctx.getOfflineQueueLastErrors().length, 0);
  assert.equal(p.ctx.getQueuedDraftCount(), 0);                                      // B לא רואה טיוטות של A
  assert.equal(JSON.parse(p.storage.getItem("visitReportOfflineQueue:user-a")).length, 1);   // ושל A נשארו
});

test("reportOfflineQueueResult מעביר את הודעת 'לא אושר בשרת' לעמוד", async () => {
  const p = await createPage();
  const seen = [];
  p.ctx.window.onOfflineQueueError = (message) => seen.push(message);
  p.ctx.queueVisitReportDraft(draft(1));
  p.state.respond = async () => ({ status: 502, json: {} });
  p.ctx.reportOfflineQueueResult(await p.ctx.flushOfflineQueue());
  assert.equal(seen.length, 1);
  assert.match(seen[0], /לא אישר את שמירת הדוח/);
});
