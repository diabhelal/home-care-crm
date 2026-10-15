// ניסיון חוזר להערכת סיכון אחרי השלמה מאושרת בסנכרון אופליין (public/app.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const APP_JS_SOURCE = fs.readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");

function sharedStorage() {
  const store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    keys: () => Object.keys(store),
  };
}

// riskBehaviour: () => "ok" | "network" | 403 | 404 | 503 | 500 — נקרא לכל קריאת risk-assessment.
function loadPage(storage, { userId, riskBehaviour = () => "ok" }) {
  const calls = [];
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "tok-" + userId, user: { id: userId } } } }),
      onAuthStateChange: () => {},
    },
    from() { throw new Error("no direct DB access expected"); },
  };
  const fetchMock = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    if (url.includes("/complete")) return { ok: true, status: 200, json: async () => ({ report: { id: 77 } }) };
    const b = riskBehaviour();
    if (b === "network") throw new TypeError("Failed to fetch");
    if (b === "ok") return { ok: true, status: 200, json: async () => ({ risk_level: "green" }) };
    const code = b === 503 ? "predictive_unavailable" : null;
    return { ok: false, status: b, json: async () => ({ code, detail: "x" }) };
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
const riskCalls = (p) => p.calls.filter((c) => c.url.includes("/risk-assessment"));
const pendingKeys = (st) => st.keys().filter((k) => k.startsWith("visitRiskPending"));

async function completeWithRiskFailure(storage, userId, failure) {
  const p = loadPage(storage, { userId, riskBehaviour: () => failure });
  await tick();
  p.ctx.queueVisitReportDraft({ booking_id: 5, staff_id: 1, treatment_summary: "x", systolic_bp: 190 });
  return p;
}

test("כשל סיכון אחרי השלמה: נשמר ללא ערכים קליניים, והשלמה לא מתבטלת", async () => {
  const st = sharedStorage();
  const p = await completeWithRiskFailure(st, "user-a", "network");
  const r = await p.ctx.flushOfflineQueue();
  assert.equal(r.synced, 1, "הדוח הושלם");
  assert.equal(p.ctx.getQueuedDraftCount(), 0, "הטיוטה ירדה מהתור");
  const keys = pendingKeys(st);
  assert.deepEqual(keys, ["visitRiskPending:user-a"]);
  const raw = JSON.parse(st.getItem(keys[0]));
  assert.equal(raw.length, 1);
  assert.deepEqual(Object.keys(raw[0]).sort(), ["booking_id", "queuedAt", "report_id"]);
  assert.equal(raw[0].report_id, 77);
  assert.ok(!st.getItem(keys[0]).includes("190"), "אין ערכים קליניים");
});

test("ניסיון חוזר מצליח: הרשומה יורדת", async () => {
  const st = sharedStorage();
  const p1 = await completeWithRiskFailure(st, "user-a", 503);
  await p1.ctx.flushOfflineQueue();
  assert.equal(pendingKeys(st).length, 1, "503 נשמר");
  const p2 = loadPage(st, { userId: "user-a", riskBehaviour: () => "ok" });
  await tick();
  await p2.ctx.flushOfflineQueue();
  assert.equal(riskCalls(p2).length, 1);
  assert.equal(pendingKeys(st).length, 0);
});

test("רשת/5xx משאירים ברשימה", async () => {
  for (const fail of ["network", 500, 503]) {
    const st = sharedStorage();
    const p1 = await completeWithRiskFailure(st, "user-a", fail);
    await p1.ctx.flushOfflineQueue();
    const p2 = loadPage(st, { userId: "user-a", riskBehaviour: () => fail });
    await tick();
    await p2.ctx.flushOfflineQueue();
    assert.equal(JSON.parse(st.getItem("visitRiskPending:user-a")).length, 1, String(fail));
  }
});

test("משתמש B לא רואה ולא מנסה את הרשימה של A", async () => {
  const st = sharedStorage();
  const a = await completeWithRiskFailure(st, "user-a", "network");
  await a.ctx.flushOfflineQueue();
  const b = loadPage(st, { userId: "user-b", riskBehaviour: () => "ok" });
  await tick();
  await b.ctx.flushOfflineQueue();
  assert.equal(riskCalls(b).length, 0);
  assert.equal(JSON.parse(st.getItem("visitRiskPending:user-a")).length, 1, "של A נשארת");
  assert.equal(st.getItem("visitRiskPending:user-b"), null);
});

test("403 בניסיון חוזר מסיר את הרשומה; 404 גם", async () => {
  for (const code of [403, 404]) {
    const st = sharedStorage();
    const p1 = await completeWithRiskFailure(st, "user-a", "network");
    await p1.ctx.flushOfflineQueue();
    const p2 = loadPage(st, { userId: "user-a", riskBehaviour: () => code });
    await tick();
    await p2.ctx.flushOfflineQueue();
    assert.equal(riskCalls(p2).length, 1);
    assert.equal(pendingKeys(st).length, 0, String(code));
  }
});

test("403 מיידי אחרי ההשלמה לא נשמר כלל", async () => {
  const st = sharedStorage();
  const p = await completeWithRiskFailure(st, "user-a", 403);
  const r = await p.ctx.flushOfflineQueue();
  assert.equal(r.synced, 1);
  assert.equal(pendingKeys(st).length, 0);
});
