// INDEPENDENT verification of the offline visit-report draft workflow (not written by the implementer).
// Usage: APP_JS=/path/to/public/app.js node --test verify-drafts.test.js
// Loads the REAL app.js in a vm with a fake localStorage / fetch. Synthetic data only. No network, no DB.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const APP = process.env.APP_JS || "/Users/helaldiab/home-care-crm/public/app.js";
const SRC = fs.readFileSync(APP, "utf8");
const KEY = "visitReportOfflineQueue";
const tick = () => new Promise((r) => setImmediate(r));

function storageFactory({ failWritesFor } = {}) {
  const store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { if (failWritesFor && k.startsWith(failWritesFor)) throw new Error("QuotaExceededError"); store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    keys: () => Object.keys(store), raw: () => store,
  };
}
// respond(init, call) -> {status, body} | throws TypeError (network). Default = verified success echoing booking_id.
function loadPage(storage, { userId, respond, onRequest } = {}) {
  const calls = [];
  const client = { auth: { getSession: () => Promise.resolve({ data: { session: userId ? { access_token: "tok-" + userId, user: { id: userId } } : null } }), onAuthStateChange: () => {} },
    from() { throw new Error("no direct DB access"); } };
  const fetchMock = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const m = /visits\/(\d+)\/complete/.exec(url); const bookingId = m ? Number(m[1]) : null;
    const call = { url, who: (init.headers.Authorization || "").replace("Bearer tok-", ""), body, bookingId }; calls.push(call);
    if (onRequest) await onRequest(call);
    const r = respond ? await respond(init, call) : { status: 200, body: { report: { id: 100 + bookingId, booking_id: bookingId } } };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  const ctx = vm.createContext({ console, fetch: fetchMock, AbortController, setTimeout, clearTimeout,
    window: { addEventListener: () => {}, BACKEND_URL: "http://backend.test", supabase: { createClient: () => client } },
    navigator: { onLine: true }, localStorage: storage });
  vm.runInContext(SRC, ctx, { filename: APP });
  return { ctx, calls };
}
const draft = (id, extra = {}) => ({ booking_id: id, staff_id: 10, patient_id: "p-" + id, treatment_summary: "SYNTH-" + id, patient_signature_data: "data:image/png;base64,SIG" + id, ...extra });
const ownQueue = (s, uid) => JSON.parse(s.getItem(`${KEY}:${uid}`) || "[]");
const anyKeyHas = (s, text) => s.keys().some((k) => (s.getItem(k) || "").includes(text));

// ---------------- DATA LOSS: nothing is deleted before verified server persistence ----------------
test("L1 שמירה ללא חיבור: הטיוטה נשמרת ונשארת כשהרשת נופלת בסנכרון", async () => {
  const s = storageFactory(); const a = loadPage(s, { userId: "A", respond: async () => { throw new TypeError("Failed to fetch"); } }); await tick();
  a.ctx.queueVisitReportDraft(draft(1));
  const r = await a.ctx.flushOfflineQueue();
  assert.equal(r.synced, 0); assert.equal(ownQueue(s, "A").length, 1); assert.ok(anyKeyHas(s, "SYNTH-1"));
});
for (const [name, status, body] of [["500", 500, {}], ["401", 401, {}], ["403", 403, { code: "forbidden" }], ["422", 422, { detail: "x" }], ["409 לא ניתן לאימות", 409, { code: "conflict" }], ["502", 502, {}]]) {
  test(`L2 כשל שרת ${name}: הטיוטה לא נמחקת`, async () => {
    const s = storageFactory(); const a = loadPage(s, { userId: "A", respond: async () => ({ status, body }) }); await tick();
    a.ctx.queueVisitReportDraft(draft(2)); await a.ctx.flushOfflineQueue();
    assert.equal(ownQueue(s, "A").length, 1, "draft must survive a " + name);
  });
}
test("L3a הצלחה מאומתת (report.id + booking_id תואם) מסירה את הטיוטה", async () => {
  const s = storageFactory(); const a = loadPage(s, { userId: "A" }); await tick();
  a.ctx.queueVisitReportDraft(draft(3)); const r = await a.ctx.flushOfflineQueue();
  assert.equal(r.synced, 1); assert.equal(ownQueue(s, "A").length, 0);
});
test("L3b עריכה חדשה בזמן הסנכרון: רק הגרסה שנשלחה מוסרת, הגרסה החדשה נשמרת", async () => {
  const s = storageFactory(); let a;
  a = loadPage(s, { userId: "A", onRequest: async () => { a.ctx.queueVisitReportDraft(draft(4, { treatment_summary: "SYNTH-4-NEWER" })); } }); await tick();
  a.ctx.queueVisitReportDraft(draft(4)); await a.ctx.flushOfflineQueue();
  const q = ownQueue(s, "A"); assert.equal(q.length, 1, "newer revision must remain"); assert.equal(q[0].treatment_summary, "SYNTH-4-NEWER");
});
test("L10 תשובת 200 ריקה ({}), בלי דוח שנשמר: הטיוטה חייבת להישאר", async () => {
  const s = storageFactory(); const a = loadPage(s, { userId: "A", respond: async () => ({ status: 200, body: {} }) }); await tick();
  a.ctx.queueVisitReportDraft(draft(5)); await a.ctx.flushOfflineQueue();
  assert.equal(ownQueue(s, "A").length, 1, "a bare 200 does not prove the report was saved");
});
test("L11 תשובת 200 עם booking_id אחר: הטיוטה חייבת להישאר", async () => {
  const s = storageFactory(); const a = loadPage(s, { userId: "A", respond: async () => ({ status: 200, body: { report: { id: 7, booking_id: 999 } } }) }); await tick();
  a.ctx.queueVisitReportDraft(draft(6)); await a.ctx.flushOfflineQueue();
  assert.equal(ownQueue(s, "A").length, 1);
});
test("L9 שני סנכרונים מקבילים: בקשה אחת לכל טיוטה (בלי שליחה כפולה)", async () => {
  const s = storageFactory(); const a = loadPage(s, { userId: "A" }); await tick();
  a.ctx.queueVisitReportDraft(draft(7)); await Promise.all([a.ctx.flushOfflineQueue(), a.ctx.flushOfflineQueue()]);
  assert.equal(a.calls.filter((c) => c.bookingId === 7).length, 1);
});
test("L8 כשל כתיבה לאחסון (quota): נזרקת שגיאה, לא מוצג 'נשמר', והתור הקיים לא נפגע", async () => {
  const s = storageFactory({ failWritesFor: KEY + ":A" }); const pre = JSON.stringify([draft(8)]); s.raw()[`${KEY}:A`] = pre; const a = loadPage(s, { userId: "A" }); await tick();
  assert.throws(() => a.ctx.queueVisitReportDraft(draft(9)));
  assert.equal(s.getItem(`${KEY}:A`), pre, "existing queue untouched after failed write");
});
test("L7 התאוששות: אחסון פגום לא נדרס, והמקור נשמר בעותק גיבוי", async () => {
  const s = storageFactory(); s.raw()[`${KEY}:A`] = "{CORRUPT-RAW-SYNTH"; const a = loadPage(s, { userId: "A" }); await tick();
  try { a.ctx.queueVisitReportDraft(draft(10)); } catch (e) { /* refusing is acceptable */ }
  assert.ok(anyKeyHas(s, "CORRUPT-RAW-SYNTH"), "the unreadable original must still exist somewhere");
});

// ---------------- LOGOUT / LOGIN / ACCOUNT SWITCH / LEGACY ----------------
test("L4 התנתקות: טיוטת A לא נמחקת מהמכשיר", async () => {
  const s = storageFactory(); const a = loadPage(s, { userId: "A" }); await tick();
  a.ctx.queueVisitReportDraft(draft(11)); a.ctx.setOfflineQueueOwner(null);
  assert.ok(anyKeyHas(s, "SYNTH-11"), "logout must not delete an unsynchronized draft");
});
test("L5 החלפת חשבון: B לא רואה ולא שולח את הטיוטה של A; הטיוטה של A נשמרת", async () => {
  const s = storageFactory(); const a = loadPage(s, { userId: "A" }); await tick(); a.ctx.queueVisitReportDraft(draft(12));
  const b = loadPage(s, { userId: "B" }); await tick();
  assert.equal(b.ctx.getQueuedDraftCount(), 0); await b.ctx.flushOfflineQueue();
  assert.equal(b.calls.filter((c) => c.bookingId === 12).length, 0, "B must not submit A's draft");
  assert.equal(ownQueue(s, "A").length, 1);
});
test("L6a טיוטה ממפתח משותף ישן: 403 אצל משתמש אחר משאיר אותה במקומה", async () => {
  const s = storageFactory(); s.raw()[KEY] = JSON.stringify([draft(13)]);
  const b = loadPage(s, { userId: "B", respond: async (i, c) => (c.who === "A" ? { status: 200, body: { report: { id: 1, booking_id: c.bookingId } } } : { status: 403, body: { code: "forbidden" } }) }); await tick();
  await b.ctx.flushOfflineQueue(); assert.equal(JSON.parse(s.getItem(KEY)).length, 1);
});
test("L6b טיוטה ישנה נמחקת רק אחרי הצלחה מאומתת של הבעלים", async () => {
  const s = storageFactory(); s.raw()[KEY] = JSON.stringify([draft(14)]);
  const a = loadPage(s, { userId: "A" }); await tick(); await a.ctx.flushOfflineQueue();
  assert.equal(JSON.parse(s.getItem(KEY) || "[]").length, 0);
});

// ---------------- PRIVACY (new requirements) ----------------
test("P1 שמירה בלי בעלים (לפני טעינת session / אחרי התנתקות): חייבת להידחות ולא לכתוב למפתח המשותף", async () => {
  const s = storageFactory(); const a = loadPage(s, { userId: null }); await tick();
  let threw = false; try { a.ctx.queueVisitReportDraft(draft(15)); } catch (e) { threw = true; }
  assert.ok(threw && !anyKeyHas(s, "SYNTH-15"), "no-owner save must be refused (shared key is readable by every user)");
});
test("P2 כל טיוטה נושאת מזהה בעלים (_ownerId)", async () => {
  const s = storageFactory(); const a = loadPage(s, { userId: "A" }); await tick(); a.ctx.queueVisitReportDraft(draft(16));
  assert.equal(ownQueue(s, "A")[0]._ownerId, "A");
});
test("P3 [ידוע, לא נדרש כאן] נתונים קליניים בטקסט גלוי באחסון המקומי", async () => {
  const s = storageFactory(); const a = loadPage(s, { userId: "A" }); await tick(); a.ctx.queueVisitReportDraft(draft(17));
  const plain = anyKeyHas(s, "SYNTH-17") && anyKeyHas(s, "data:image/png;base64");
  console.log("   P3 plaintext at rest:", plain ? "YES (known residual risk, encryption is design-only)" : "no");
  assert.ok(true);
});
