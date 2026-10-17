// אמינות סנכרון אופליין (public/app.js): אין אובדן/דריסה של טיוטות בזמן סנכרון, כשל אחסון מוצג כשגיאה,
// הסרה אחרי אישור שרת לפי גרסה, 409 לא מוחק בלי אימות, ובידוד משתמשים בהחלפת חשבון. נתונים סינתטיים בלבד.
// הערה: מפתחות לפי משתמש והסרה אחרי סנכרון אינם הצפנה ואינם מבטיחים מחיקה מלאה של מידע מהמכשיר.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const APP_JS_SOURCE = fs.readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");

function storageShim() {
  const store = {};
  const api = {
    failWrites: false,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { if (api.failWrites) throw new Error("QuotaExceededError"); store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    keys: () => Object.keys(store),
  };
  return api;
}

async function createPage({ userId = "user-a", storage = storageShim() } = {}) {
  const state = { userId, authCb: null, calls: [], respond: null, riskGate: null };
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: state.userId ? { access_token: "tok-" + state.userId, user: { id: state.userId } } : null } }),
      onAuthStateChange: (cb) => { state.authCb = cb; },
    },
    from() { return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }; },
  };
  const fetchMock = async (url, init) => {
    const call = { url, auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : null };
    state.calls.push(call);
    if (/risk-assessment/.test(url)) {
      if (state.riskGate) await state.riskGate;
      return { ok: true, status: 200, json: async () => ({ risk_level: "green" }) };
    }
    const r = state.respond ? await state.respond(call) : null;
    if (r) return { ok: r.status < 300, status: r.status, json: async () => r.json };
    return { ok: true, status: 200, json: async () => ({ report: { id: 500 } }) };
  };
  const ctx = vm.createContext({
    console: { ...console, error: () => {} }, fetch: fetchMock, AbortController, setTimeout, clearTimeout,
    window: { addEventListener: () => {}, BACKEND_URL: "http://backend.test", supabase: { createClient: () => client } },
    navigator: { onLine: true }, localStorage: storage,
  });
  vm.runInContext(APP_JS_SOURCE, ctx, { filename: "public/app.js" });
  await new Promise((r) => setImmediate(r));
  const switchUser = (id) => { state.userId = id; state.authCb && state.authCb("SIGNED_IN", id ? { user: { id } } : null); };
  return { ctx, state, storage, switchUser };
}
const draft = (id, extra = {}) => ({ booking_id: id, patient_id: "p" + id, staff_id: 7, treatment_summary: "v1", systolic_bp: 120, _markCompleted: true, ...extra });
const queue = (p, uid = "user-a") => JSON.parse(p.storage.getItem("visitReportOfflineQueue:" + uid) || "[]");
const completes = (p) => p.state.calls.filter((c) => /\/complete$/.test(c.url));

test("1. טיוטה חדשה שנוספה בזמן סנכרון נשמרת", async () => {
  const p = await createPage();
  p.ctx.queueVisitReportDraft(draft(1));
  p.state.respond = async () => { p.ctx.queueVisitReportDraft(draft(99)); return null; };
  const r = await p.ctx.flushOfflineQueue();
  assert.equal(r.synced, 1);
  assert.deepEqual(queue(p).map((d) => d.booking_id), [99]);
});

test("2. עריכה של אותה טיוטה בזמן סנכרון שומרת את הגרסה החדשה", async () => {
  const p = await createPage();
  p.ctx.queueVisitReportDraft(draft(1));
  p.state.respond = async () => { p.ctx.queueVisitReportDraft(draft(1, { treatment_summary: "v2 (נערך בזמן סנכרון)" })); return null; };
  await p.ctx.flushOfflineQueue();
  const q = queue(p);
  assert.equal(q.length, 1);
  assert.equal(q[0].treatment_summary, "v2 (נערך בזמן סנכרון)");
  assert.equal(q[0]._rev, 2);
  assert.ok(q[0]._draftId);
});

test("3. קריאות סנכרון במקביל לא מעבדות את אותה טיוטה פעמיים", async () => {
  const p = await createPage();
  p.ctx.queueVisitReportDraft(draft(1)); p.ctx.queueVisitReportDraft(draft(2));
  const [a, b] = await Promise.all([p.ctx.flushOfflineQueue(), p.ctx.flushOfflineQueue()]);
  assert.equal(completes(p).length, 2);                // כל טיוטה נשלחה פעם אחת
  assert.equal(a.synced, 2); assert.equal(b.synced, 2); // הקריאה השנייה הצטרפה לריצה
  assert.equal(p.ctx.getQueuedDraftCount(), 0);
});

test("4. כשל אחסון מקומי נזרק כשגיאה (לא 'נשמר') ולא פוגע בטיוטות קיימות", async () => {
  const p = await createPage();
  p.ctx.queueVisitReportDraft(draft(1));
  p.storage.failWrites = true;
  assert.throws(() => p.ctx.queueVisitReportDraft(draft(2)), (e) => e.name === "OfflineStorageError");
  p.storage.failWrites = false;
  assert.deepEqual(queue(p).map((d) => d.booking_id), [1]);
  assert.match(p.ctx.offlineStorageFailureMessage(), /הדוח לא נשמר/);
});

test("5. גרסה שאושרה מוסרת לפני שהערכת הסיכון המושהית מסתיימת", async () => {
  const p = await createPage();
  p.ctx.queueVisitReportDraft(draft(1));
  let release; p.state.riskGate = new Promise((r) => { release = r; });
  const flushing = p.ctx.flushOfflineQueue();
  for (let i = 0; i < 20 && !p.state.calls.some((c) => /risk-assessment/.test(c.url)); i++) await new Promise((r) => setImmediate(r));
  assert.ok(p.state.calls.some((c) => /risk-assessment/.test(c.url)), "risk request started");
  assert.equal(p.ctx.getQueuedDraftCount(), 0);                                   // כבר הוסרה
  assert.equal(p.storage.getItem("visitReportOfflineQueue:user-a"), null);         // והמפתח נמחק
  release(); await flushing;
});

test("6. כשל רשת משאיר את כל הטיוטות; ניסיון חוזר מצליח", async () => {
  const p = await createPage();
  p.ctx.queueVisitReportDraft(draft(1)); p.ctx.queueVisitReportDraft(draft(2));
  p.state.respond = async () => { throw new TypeError("Failed to fetch"); };
  const r = await p.ctx.flushOfflineQueue();
  assert.equal(r.synced, 0); assert.equal(p.ctx.getQueuedDraftCount(), 2);
  p.state.respond = null;
  assert.equal((await p.ctx.flushOfflineQueue()).synced, 2);
  assert.equal(p.ctx.getQueuedDraftCount(), 0);
});

test("7. 409 עם תוכן שונה או לא מאומת משאיר את הטיוטה (ר' גם offline-queue.test.js)", async () => {
  const p = await createPage();
  p.ctx.queueVisitReportDraft(draft(1));
  p.state.respond = async () => ({ status: 409, json: { code: "illegal_transition", detail: "ההזמנה כבר הושלמה" } });
  const r = await p.ctx.flushOfflineQueue();   // אין דוח לאימות => לא מאומת
  assert.equal(r.synced, 0); assert.equal(p.ctx.getQueuedDraftCount(), 1);
  assert.equal(r.errors[0].kind, "conflict");
});

test("8. החלפת חשבון באמצע סנכרון: לא נשלח עם פרטי המשתמש האחר והתור של המקור נשמר", async () => {
  const p = await createPage({ userId: "user-a" });
  p.ctx.queueVisitReportDraft(draft(1)); p.ctx.queueVisitReportDraft(draft(2)); p.ctx.queueVisitReportDraft(draft(3));
  p.state.respond = async () => { p.switchUser("user-b"); return null; };           // אחרי הטיוטה הראשונה
  const r = await p.ctx.flushOfflineQueue();
  assert.equal(r.synced, 1);
  assert.equal(completes(p).length, 1);                                               // אף טוקן של B לא שימש לטיוטות של A
  assert.ok(completes(p).every((c) => c.auth === "Bearer tok-user-a"));
  assert.deepEqual(queue(p, "user-a").map((d) => d.booking_id), [2, 3]);             // נשארו ל-A
  assert.equal(p.ctx.getQueuedDraftCount(), 0);                                       // B לא רואה אותן
  assert.equal(p.storage.getItem("visitReportOfflineQueue:user-b"), null);
  assert.ok(r.errors.some((e) => e.kind === "auth"));
});

test("התנתקות: הטיוטות נשארות לבעלים ולא נראות/מסונכרנות כשאין משתמש", async () => {
  const p = await createPage({ userId: "user-a" });
  p.ctx.queueVisitReportDraft(draft(1));
  p.switchUser(null);
  assert.equal(p.ctx.getQueuedDraftCount(), 0);
  assert.equal(queue(p, "user-a").length, 1);
});

test("תוכן תור פגום לא נדרס בשקט: נשמר עותק לפני כתיבה", async () => {
  const p = await createPage();
  p.storage.setItem("visitReportOfflineQueue:user-a", "{not json");
  p.ctx.queueVisitReportDraft(draft(1));
  assert.ok(p.storage.keys().some((k) => k.startsWith("visitReportOfflineQueue:user-a:unreadable:")));
  assert.equal(queue(p).length, 1);
});
