// טסטי יחידה ל-Offline Draft Queue (queueVisitReportDraft/flushOfflineQueue, public/app.js).
// הסנכרון עובד רק דרך ה-backend: POST /staff/visits/{booking_id}/complete (backendFetch).
// אין עוד כתיבה ישירה ל-visit_reports/bookings. טיוטה נמחקת *רק* אחרי תשובת הצלחה מאושרת.
//
// public/app.js הוא <script> קלאסי (ללא module.exports), לכן מריצים אותו בתוך vm context עם
// window/localStorage/supabaseClient/fetch מדומים. הצהרות function נדבקות ל-context.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const APP_JS_SOURCE = fs.readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");

function createLocalStorageShim() {
  let store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

// backend.respond(url, init) => {status, json} | throws (רשת). backend.calls עוקב אחרי כל בקשה.
async function createContext({ userId = "user-1" } = {}) {
  const backend = {
    calls: [],
    respond: () => ({ status: 200, json: { report: { id: 1 } } }),
  };
  // הדוח השמור בשרת כפי שהוא נקרא לאימות אחרי 409: row=null => אין דוח; throws => שגיאת קריאה.
  const reportRead = { row: null, throws: false };
  const supabaseClient = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "tok-" + userId, user: { id: userId } } } }),
      onAuthStateChange: () => {},
    },
    from(table) {
      if (table !== "visit_reports") throw new Error("unexpected table in test: " + table);
      return { select: () => ({ eq: () => ({ maybeSingle: () => {
        if (reportRead.throws) return Promise.reject(new Error("Failed to fetch"));
        return Promise.resolve({ data: reportRead.row, error: null });
      } }) }) };
    },
  };
  const fetchMock = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
    backend.calls.push(call);
    const r = backend.respond(url, call); // may throw => network error
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
  };
  const ctx = vm.createContext({
    console, fetch: fetchMock, AbortController, setTimeout, clearTimeout,
    window: { addEventListener: () => {}, BACKEND_URL: "http://backend.test", supabase: { createClient: () => supabaseClient } },
    navigator: { onLine: true },
    localStorage: createLocalStorageShim(),
  });
  vm.runInContext(APP_JS_SOURCE, ctx, { filename: "public/app.js" });
  await new Promise((r) => setImmediate(r)); // getSession() resolves => queue owner set
  return { ctx, backend, reportRead };
}

const draft = (id, extra = {}) => ({
  booking_id: id, patient_id: "p" + id, staff_id: 7, treatment_summary: "טופל", systolic_bp: 120,
  diastolic_bp: 80, patient_signature_data: "data:image/png;base64,AAA=", performed_injection: true, ...extra,
});

test("flush: הצלחה מאושרת — קריאה אחת ל-complete, התור מתרוקן, הזהות רק ב-Authorization", async () => {
  const { ctx, backend } = await createContext();
  ctx.queueVisitReportDraft(draft(1));
  const r = await ctx.flushOfflineQueue();
  assert.equal(r.synced, 1); assert.equal(r.failed, 0); assert.equal(r.partial, 0);
  assert.equal(ctx.getQueuedDraftCount(), 0);
  const completes = backend.calls.filter((x) => /\/complete$/.test(x.url));
  assert.equal(completes.length, 1);
  const c = completes[0];
  assert.equal(c.url, "http://backend.test/staff/visits/1/complete");
  assert.equal(c.method, "POST");
  assert.equal(c.headers.Authorization, "Bearer tok-user-1");
  assert.equal(c.body.treatment_summary, "טופל");
  assert.equal(c.body.performed_injection, true);
  assert.equal(c.body.patient_signature_data, "data:image/png;base64,AAA=");
  for (const k of ["patient_id", "staff_id", "booking_id", "_queuedAt"]) {
    assert.ok(!(k in c.body), k + " לא נשלח — הזהות מה-JWT בלבד");
  }
});

test("flush: הערכת סיכון נקראת רק אחרי השלמה מאושרת (בשרת), וכישלון שלה לא מחזיר את הטיוטה", async () => {
  const { ctx, backend } = await createContext();
  backend.respond = (url) => url.endsWith("/risk-assessment")
    ? { status: 503, json: { code: "predictive_unavailable", detail: "x" } }
    : { status: 200, json: { report: { id: 77 } } };
  ctx.queueVisitReportDraft(draft(5));
  const r = await ctx.flushOfflineQueue();
  assert.equal(r.synced, 1); assert.equal(r.failed, 0);
  assert.equal(ctx.getQueuedDraftCount(), 0);
  assert.deepEqual(backend.calls.map((x) => x.url), [
    "http://backend.test/staff/visits/5/complete",
    "http://backend.test/visits/77/risk-assessment",
  ]);
  assert.equal(backend.calls[1].body, null);   // בלי ערכים מהלקוח
});

test("flush: אין כתיבה ישירה ל-Supabase (visit_reports/bookings)", async () => {
  const { ctx } = await createContext();
  const client = ctx.window.supabase.createClient();
  client.from = () => { throw new Error("direct DB access is forbidden in flush"); };
  ctx.queueVisitReportDraft(draft(2));
  const r = await ctx.flushOfflineQueue();
  assert.equal(r.synced, 1);
});

test("flush: שגיאת רשת — הטיוטה נשארת; ניסיון חוזר אחרי שהרשת חוזרת מצליח וממחק", async () => {
  const { ctx, backend } = await createContext();
  ctx.queueVisitReportDraft(draft(3));
  backend.respond = () => { throw new TypeError("Failed to fetch"); };
  const r1 = await ctx.flushOfflineQueue();
  assert.equal(r1.synced, 0); assert.equal(r1.failed, 1); assert.equal(r1.errors.length, 0);
  assert.equal(ctx.getQueuedDraftCount(), 1);
  assert.equal(ctx.getOfflineQueue()[0].booking_id, 3);

  backend.respond = () => ({ status: 200, json: { report: { id: 9 } } });
  const r2 = await ctx.flushOfflineQueue();
  assert.equal(r2.synced, 1);
  assert.equal(ctx.getQueuedDraftCount(), 0);
});

test("flush: טיוטה נמחקת רק אחרי הצלחה — כשל 500 משאיר אותה", async () => {
  const { ctx, backend } = await createContext();
  ctx.queueVisitReportDraft(draft(4));
  backend.respond = () => ({ status: 500, json: { detail: "boom" } });
  const r = await ctx.flushOfflineQueue();
  assert.equal(r.synced, 0); assert.equal(ctx.getQueuedDraftCount(), 1);
});

test("flush: 403 — הטיוטה נשארת והודעה ברורה מוחזרת", async () => {
  const { ctx, backend } = await createContext();
  ctx.queueVisitReportDraft(draft(5));
  backend.respond = () => ({ status: 403, json: { code: "forbidden", detail: "ההזמנה אינה משויכת אליך" } });
  const r = await ctx.flushOfflineQueue();
  assert.equal(r.synced, 0); assert.equal(r.failed, 1);
  assert.equal(ctx.getQueuedDraftCount(), 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].kind, "forbidden");
  assert.match(r.errors[0].message, /אינה משויכת אליך/);
  assert.match(r.errors[0].message, /נשמר במכשיר/);
});

test("flush: 401 — הטיוטה נשארת עם הודעת התחברות", async () => {
  const { ctx, backend } = await createContext();
  ctx.queueVisitReportDraft(draft(6));
  backend.respond = () => ({ status: 401, json: { code: "unauthorized", detail: "x" } });
  const r = await ctx.flushOfflineQueue();
  assert.equal(ctx.getQueuedDraftCount(), 1);
  assert.equal(r.errors[0].kind, "auth");
  assert.match(r.errors[0].message, /התחבר/);
});

test("flush: 409 — הטיוטה נשארת (גם כשאין אימות שההזמנה הושלמה)", async () => {
  const { ctx, backend } = await createContext();
  ctx.queueVisitReportDraft(draft(7));
  backend.respond = () => ({ status: 409, json: { code: "illegal_transition", detail: "ההזמנה לא אושרה" } });
  const r = await ctx.flushOfflineQueue();
  assert.equal(r.synced, 0); assert.equal(ctx.getQueuedDraftCount(), 1);
  assert.equal(r.errors[0].kind, "conflict");
  assert.match(r.errors[0].message, /ההזמנה לא אושרה/);
});

test("flush: 409 והדוח בשרת זהה לטיוטה (תשובה אבדה) => הטיוטה יורדת", async () => {
  const { ctx, backend, reportRead } = await createContext();
  const d = draft(8);
  ctx.queueVisitReportDraft(d);
  backend.respond = () => ({ status: 409, json: { code: "illegal_transition", detail: "מעבר לא חוקי" } });
  reportRead.row = { ...d, temperature: null, blood_sugar: null, pulse: null, oxygen_saturation: null,
    performed_blood_draw: false, performed_infusion: false, performed_dressing_change: false, performed_catheter_change: false };
  const r = await ctx.flushOfflineQueue();
  assert.equal(r.synced, 1); assert.equal(ctx.getQueuedDraftCount(), 0);
});

test("flush: 409 והדוח בשרת שונה מהטיוטה => הטיוטה נשארת ומדווח קונפליקט", async () => {
  const { ctx, backend, reportRead } = await createContext();
  const d = draft(8);
  ctx.queueVisitReportDraft(d);
  backend.respond = () => ({ status: 409, json: { code: "illegal_transition", detail: "מעבר לא חוקי" } });
  reportRead.row = { ...d, treatment_summary: "סיכום אחר שנשמר בשרת" };
  const r = await ctx.flushOfflineQueue();
  assert.equal(r.synced, 0); assert.equal(ctx.getQueuedDraftCount(), 1);
  assert.equal(r.errors[0].kind, "conflict");
  assert.match(r.errors[0].message, /שונה מהטיוטה/);
});

test("flush: 409 ואין דוח בשרת / שגיאת קריאה => הטיוטה נשארת (לא מאומת)", async () => {
  const { ctx, backend, reportRead } = await createContext();
  ctx.queueVisitReportDraft(draft(9));
  backend.respond = () => ({ status: 409, json: { code: "illegal_transition", detail: "x" } });
  let r = await ctx.flushOfflineQueue();                       // row=null: ההזמנה "הושלמה" אך אין דוח של הטיוטה
  assert.equal(r.synced, 0); assert.equal(ctx.getQueuedDraftCount(), 1);
  assert.match(r.errors[0].message, /לא ניתן היה לאמת/);
  reportRead.throws = true;
  r = await ctx.flushOfflineQueue();
  assert.equal(r.synced, 0); assert.equal(ctx.getQueuedDraftCount(), 1);
});

test("flush: כשל חלקי בין טיוטות — מצליחה יורדת, כושלת נשארת", async () => {
  const { ctx, backend } = await createContext();
  ctx.queueVisitReportDraft(draft(10));
  ctx.queueVisitReportDraft(draft(11));
  backend.respond = (url) => url.endsWith("/10/complete")
    ? { status: 200, json: { report: { id: 1 } } }
    : { status: 403, json: { code: "forbidden", detail: "אין הרשאה" } };
  const r = await ctx.flushOfflineQueue();
  assert.equal(r.synced, 1); assert.equal(r.failed, 1);
  const left = ctx.getOfflineQueue();
  assert.equal(left.length, 1); assert.equal(left[0].booking_id, 11);
});

test("flush: טיוטה ישנה עם _markCompleted=false לא נשלחת ולא נמחקת", async () => {
  const { ctx, backend } = await createContext();
  ctx.queueVisitReportDraft(draft(12, { _markCompleted: false }));
  const r = await ctx.flushOfflineQueue();
  assert.equal(backend.calls.length, 0);
  assert.equal(ctx.getQueuedDraftCount(), 1);
  assert.equal(r.errors[0].kind, "unsupported");
});

test("submitVisitCompletion: זורק BackendError מסוג network כשאין רשת", async () => {
  const { ctx, backend } = await createContext();
  backend.respond = () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(() => ctx.submitVisitCompletion(draft(13)), (e) => e.kind === "network");
  assert.equal(ctx.isRetryableCompletionError({ kind: "network" }), true);
  assert.equal(ctx.isRetryableCompletionError({ kind: "forbidden" }), false);
});

test("queueVisitReportDraft: טיוטה חדשה לאותה הזמנה מחליפה את הקודמת, לא מצטברת כפילות", async () => {
  const { ctx } = await createContext();
  ctx.queueVisitReportDraft({ booking_id: 6, treatment_summary: "גרסה 1" });
  ctx.queueVisitReportDraft({ booking_id: 6, treatment_summary: "גרסה 2" });
  const queue = ctx.getOfflineQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].treatment_summary, "גרסה 2");
});

test("offlineQueueFlushMessage: מנוסח נכון לכל שילוב synced/partial", async () => {
  const { ctx } = await createContext();
  assert.match(ctx.offlineQueueFlushMessage(3, 0), /3 דוחות/);
  assert.match(ctx.offlineQueueFlushMessage(0, 2), /2.*נשמרו/);
  const both = ctx.offlineQueueFlushMessage(1, 1);
  assert.match(both, /1 דוחות/);
});
