// בדיקות הפרדת משתמשים בתור הטיוטות (public/app.js): משתמש B באותו דפדפן לא רואה ולא
// מסנכרן טיוטות של A; התנתקות לא מוחקת מידע שטרם נשמר; מפתח ישן נמחק רק אחרי שמירה.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const APP_JS_SOURCE = fs.readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");

function sharedStorage() {
  let store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    keys: () => Object.keys(store),
  };
}

// כל "טעינת עמוד" = context חדש עם אותו localStorage. השרת המדומה (backend) מחליט לפי
// allowedStaff אם הטוקן/המשתמש רשאי להשלים את ההזמנה (403 אחרת) — כמו JWT + בעלות אמיתיים.
function loadPage(storage, { userId, allowedUser, networkDown = false }) {
  const calls = [];
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: userId ? { access_token: "tok-" + userId, user: { id: userId } } : null } }),
      onAuthStateChange: () => {},
    },
    from() { throw new Error("no direct DB access expected"); },
  };
  const fetchMock = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : null });
    if (networkDown) throw new TypeError("Failed to fetch");
    const who = (init.headers.Authorization || "").replace("Bearer tok-", "");
    if (allowedUser !== undefined && who !== allowedUser) {
      return { ok: false, status: 403, json: async () => ({ code: "forbidden", detail: "ההזמנה אינה משויכת אליך" }) };
    }
    return { ok: true, status: 200, json: async () => ({ report: { id: 1 } }) };
  };
  const ctx = vm.createContext({
    console, fetch: fetchMock, AbortController, setTimeout, clearTimeout,
    window: { addEventListener: () => {}, BACKEND_URL: "http://backend.test", supabase: { createClient: () => client } },
    navigator: { onLine: true },
    localStorage: storage,
  });
  vm.runInContext(APP_JS_SOURCE, ctx, { filename: "public/app.js" });
  return { ctx, calls };
}

const tick = () => new Promise((r) => setImmediate(r));

test("טיוטה של משתמש A לא נראית ולא מסונכרנת אצל משתמש B באותו דפדפן", async () => {
  const storage = sharedStorage();
  const a = loadPage(storage, { userId: "user-a" });
  await tick();
  a.ctx.queueVisitReportDraft({ booking_id: 1, staff_id: 10, treatment_summary: "A" });
  assert.equal(a.ctx.getQueuedDraftCount(), 1);

  const b = loadPage(storage, { userId: "user-b" });
  await tick();
  assert.equal(b.ctx.getQueuedDraftCount(), 0, "B לא אמור לראות את הטיוטה של A");
  const result = await b.ctx.flushOfflineQueue();
  assert.equal(result.synced, 0);
  assert.equal(b.calls.length, 0, "B לא אמור לשלוח את הטיוטה של A לשרת");

  const a2 = loadPage(storage, { userId: "user-a" });
  await tick();
  assert.equal(a2.ctx.getQueuedDraftCount(), 1, "הטיוטה של A נשמרה (לא נמחקה בהחלפת משתמש)");
});

test("סנכרון מוצלח מרוקן רק את התור של המשתמש ומסיר את המפתח", async () => {
  const storage = sharedStorage();
  const a = loadPage(storage, { userId: "user-a" });
  await tick();
  a.ctx.queueVisitReportDraft({ booking_id: 2, staff_id: 10, treatment_summary: "A" });
  assert.ok(storage.keys().some((k) => k.endsWith(":user-a")));
  const result = await a.ctx.flushOfflineQueue();
  assert.equal(result.synced, 1);
  assert.equal(a.ctx.getQueuedDraftCount(), 0);
  assert.ok(!storage.keys().some((k) => k.endsWith(":user-a")), "מפתח ריק מוסר");
});

test("טיוטה ממפתח ישן שנכשלת ב-RLS נשארת (לא אובדת, לא מועברת)", async () => {
  const storage = sharedStorage();
  storage.setItem("visitReportOfflineQueue", JSON.stringify([{ booking_id: 3, staff_id: 99, treatment_summary: "legacy" }]));
  const b = loadPage(storage, { userId: "user-b", allowedUser: "user-a" });
  await tick();
  const result = await b.ctx.flushOfflineQueue();
  assert.equal(result.synced, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.errors[0].kind, "forbidden");
  const legacy = JSON.parse(storage.getItem("visitReportOfflineQueue"));
  assert.equal(legacy.length, 1, "הטיוטה הישנה נשארת במקומה");
});

test("טיוטה ממפתח ישן נמחקת רק אחרי שמירה מוצלחת", async () => {
  const storage = sharedStorage();
  storage.setItem("visitReportOfflineQueue", JSON.stringify([{ booking_id: 4, staff_id: 10, treatment_summary: "legacy" }]));
  const a = loadPage(storage, { userId: "user-a", allowedUser: "user-a" });
  await tick();
  const result = await a.ctx.flushOfflineQueue();
  assert.equal(result.synced, 1);
  assert.equal(JSON.parse(storage.getItem("visitReportOfflineQueue") || "[]").length, 0);
});

test("משתמש B בכישלון 403 על מפתח ישן — A עדיין מקבל את הטיוטה שלו ומסנכרן אותה", async () => {
  const storage = sharedStorage();
  storage.setItem("visitReportOfflineQueue", JSON.stringify([{ booking_id: 5, staff_id: 10, treatment_summary: "legacy" }]));
  const b = loadPage(storage, { userId: "user-b", allowedUser: "user-a" });
  await tick();
  const rb = await b.ctx.flushOfflineQueue();
  assert.equal(rb.synced, 0);
  assert.equal(rb.errors[0].kind, "forbidden");
  assert.equal(JSON.parse(storage.getItem("visitReportOfflineQueue")).length, 1, "403 משאיר את הטיוטה");
  const a = loadPage(storage, { userId: "user-a", allowedUser: "user-a" });
  await tick();
  const ra = await a.ctx.flushOfflineQueue();
  assert.equal(ra.synced, 1);
  assert.equal(JSON.parse(storage.getItem("visitReportOfflineQueue") || "[]").length, 0);
});

test("התור של A נשאר כשהרשת נופלת; B לא מסנכרן ולא מייצר בקשות על הטיוטה של A", async () => {
  const storage = sharedStorage();
  const a = loadPage(storage, { userId: "user-a", networkDown: true });
  await tick();
  a.ctx.queueVisitReportDraft({ booking_id: 6, staff_id: 10, treatment_summary: "A offline" });
  const r = await a.ctx.flushOfflineQueue();
  assert.equal(r.synced, 0);
  assert.equal(a.ctx.getQueuedDraftCount(), 1);
  const b = loadPage(storage, { userId: "user-b" });
  await tick();
  await b.ctx.flushOfflineQueue();
  assert.equal(b.calls.length, 0);
  assert.ok(storage.keys().some((k) => k.endsWith(":user-a")));
});
