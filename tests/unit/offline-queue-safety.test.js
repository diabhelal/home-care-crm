// בדיקות בטיחות לתור הטיוטות (public/app.js): בעלים חובה, אישור שרת אמיתי בלבד,
// נעילות, ספירת/ייצוא טיוטות ישנות ופגומות — ושום מחיקה של טיוטה שלא סונכרנה.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const APP_JS_SOURCE = fs.readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");

function storageShim(seed = {}) {
  const store = { ...seed };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    keys: () => Object.keys(store),
    _store: store,
  };
}

function load({ userId = "user-1", seed, respond, locks } = {}) {
  const calls = [];
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: userId ? { access_token: "tok-" + userId, user: { id: userId } } : null } }),
      onAuthStateChange: () => {},
    },
    from() { throw new Error("no direct DB"); },
  };
  const fetchMock = async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    const r = respond ? respond(url) : { status: 200, json: { report: { id: 5, booking_id: 1 } } };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
  };
  const localStorage = storageShim(seed);
  const navigator = { onLine: true };
  if (locks !== undefined) navigator.locks = locks;
  const ctx = vm.createContext({
    console, fetch: fetchMock, AbortController, setTimeout, clearTimeout,
    window: { addEventListener: () => {}, BACKEND_URL: "http://backend.test", supabase: { createClient: () => client } },
    navigator, localStorage,
  });
  vm.runInContext(APP_JS_SOURCE, ctx, { filename: "public/app.js" });
  return { ctx, calls, localStorage };
}
const tick = () => new Promise((r) => setImmediate(r));
const d = (id, extra = {}) => ({ booking_id: id, patient_id: "p" + id, staff_id: 7, treatment_summary: "x", patient_signature_data: "data:image/png;base64,AA==", ...extra });
const ownKey = "visitReportOfflineQueue:user-1";

test("בלי בעלים: queueVisitReportDraft מסרב (no_owner) ולא כותב למפתח המשותף", async () => {
  const { ctx, localStorage } = load({ userId: null });
  await tick();
  assert.throws(() => ctx.queueVisitReportDraft(d(1)), (e) => e.name === "OfflineStorageError" && e.message === "no_owner");
  assert.deepEqual(localStorage.keys(), []);
});

test("saveVisitReportDraft ממתין לפתרון הסשן לפני הכתיבה (אחות מחוברת לא נחסמת)", async () => {
  const { ctx, localStorage } = load();
  // בלי tick: הסשן עדיין לא נפתר
  await ctx.saveVisitReportDraft(d(1));
  assert.equal(JSON.parse(localStorage.getItem(ownKey)).length, 1);
});

test("כל טיוטה נחתמת ב-_ownerId", async () => {
  const { ctx, localStorage } = load();
  await tick();
  ctx.queueVisitReportDraft(d(1));
  assert.equal(JSON.parse(localStorage.getItem(ownKey))[0]._ownerId, "user-1");
});

test("תשובת 200 ריקה ({}) לא מסירה את הטיוטה", async () => {
  const { ctx, localStorage } = load({ respond: () => ({ status: 200, json: {} }) });
  await tick();
  ctx.queueVisitReportDraft(d(1));
  const r = await ctx.flushOfflineQueue();
  assert.equal(r.synced, 0);
  assert.equal(JSON.parse(localStorage.getItem(ownKey)).length, 1);
  assert.match(r.errors[0].message, /הטיוטה נשמרה/);
});

test("report.id לא מספרי או booking_id לא תואם: הטיוטה נשארת", async () => {
  for (const json of [{ report: { id: "abc" } }, { report: { id: 9, booking_id: 999 } }]) {
    const { ctx, localStorage } = load({ respond: () => ({ status: 200, json }) });
    await tick();
    ctx.queueVisitReportDraft(d(1));
    const r = await ctx.flushOfflineQueue();
    assert.equal(r.synced, 0);
    assert.equal(JSON.parse(localStorage.getItem(ownKey)).length, 1);
  }
});

test("אישור תקין מסיר רק את הגרסה שנשלחה", async () => {
  let ctxRef;
  const { ctx, localStorage } = load({ respond: () => {
    ctxRef.queueVisitReportDraft(d(1, { treatment_summary: "גרסה חדשה" })); // עריכה תוך כדי שליחה
    return { status: 200, json: { report: { id: 5, booking_id: 1 } } };
  } });
  ctxRef = ctx;
  await tick();
  ctx.queueVisitReportDraft(d(1));
  const r = await ctx.flushOfflineQueue();
  assert.equal(r.synced, 1);
  const left = JSON.parse(localStorage.getItem(ownKey));
  assert.equal(left.length, 1);
  assert.equal(left[0].treatment_summary, "גרסה חדשה");
});

test("גיבויי :unreadable: וטיוטות ישנות נספרים ולא נמחקים", async () => {
  const seed = {
    visitReportOfflineQueue: JSON.stringify([d(7)]),
    [`${ownKey}:unreadable:111`]: "{broken",
    "visitReportOfflineQueue:other-user": JSON.stringify([d(8)]),
  };
  const { ctx, localStorage } = load({ seed, respond: () => ({ status: 403, json: { code: "forbidden" } }) });
  await tick();
  ctx.queueVisitReportDraft(d(1));
  const inv = ctx.getDraftInventory();
  assert.equal(inv.own, 1); assert.equal(inv.legacy, 1); assert.equal(inv.unreadable, 1); assert.equal(inv.total, 3);
  await ctx.flushOfflineQueue(); // 403 על הכול
  assert.equal(ctx.getDraftInventory().total, 3);
  assert.ok(localStorage.getItem(`${ownKey}:unreadable:111`));
  assert.ok(localStorage.getItem("visitReportOfflineQueue"));
});

test("ייצוא ברירת מחדל: רק הטיוטות של המשתמש עצמו, בלי ownerId, ולא מוחק דבר", async () => {
  const seed = {
    visitReportOfflineQueue: JSON.stringify([d(7)]), [`${ownKey}:unreadable:111`]: "{broken",
    "visitReportOfflineQueue:user-a": JSON.stringify([d(50, { treatment_summary: "סודי של A" })]),
  };
  const { ctx, localStorage } = load({ userId: "user-1", seed });
  await tick();
  ctx.queueVisitReportDraft(d(1));
  const before = JSON.stringify(localStorage._store);
  const raw = ctx.buildOfflineDraftsExport();
  const exp = JSON.parse(raw);
  assert.equal(exp.own.length, 1);
  assert.equal(exp.legacy, undefined); assert.equal(exp.unreadable, undefined);
  assert.ok(!raw.includes("סודי של A") && !raw.includes("user-a") && !raw.includes("broken"));
  assert.equal(exp.ownerId, undefined);
  assert.equal(JSON.stringify(localStorage._store), before);
  const full = JSON.parse(ctx.buildOfflineDraftsExport({ includeShared: true }));
  assert.equal(full.legacy.length, 1); assert.equal(full.unreadable[0].raw, "{broken");
  assert.ok(!JSON.stringify(full).includes("סודי של A"));
});

function exportEnv(answers) {
  const msgs = []; const blobs = []; let clicks = 0;
  const seed = { visitReportOfflineQueue: JSON.stringify([d(7)]), [`${ownKey}:unreadable:111`]: "{broken" };
  const env = load({ seed });
  env.ctx.window.confirm = (m) => { msgs.push(m); return answers.shift(); };
  env.ctx.Blob = class { constructor(parts) { blobs.push(parts.join("")); } };
  env.ctx.URL = { createObjectURL: () => "blob:x", revokeObjectURL: () => {} };
  env.ctx.document = { body: { appendChild: () => {} }, createElement: () => ({ click: () => { clicks++; }, remove: () => {}, set download(v) { this.name = v; }, get download() { return this.name; } }) };
  return { ...env, msgs, blobs, clicks: () => clicks };
}

test("ייצוא: סירוב לאזהרת plaintext = אין הורדה", async () => {
  const e = exportEnv([false]);
  await tick();
  e.ctx.queueVisitReportDraft(d(1));
  e.ctx.exportOfflineDrafts();
  assert.equal(e.blobs.length, 0); assert.equal(e.clicks(), 0);
  assert.match(e.msgs[0], /לא מוצפן/);
});

test("ייצוא: אישור ראשון בלבד = קובץ עם הטיוטות שלי בלבד; legacy רק אחרי אישור שני", async () => {
  const e = exportEnv([true, false]);
  await tick();
  e.ctx.queueVisitReportDraft(d(1));
  e.ctx.exportOfflineDrafts();
  assert.equal(e.blobs.length, 1);
  assert.equal(JSON.parse(e.blobs[0]).legacy, undefined);
  assert.equal(e.msgs.length, 2); assert.match(e.msgs[1], /משתמש אחר/);
  const e2 = exportEnv([true, true]);
  await tick();
  e2.ctx.queueVisitReportDraft(d(1));
  e2.ctx.exportOfflineDrafts();
  assert.equal(JSON.parse(e2.blobs[0]).legacy.length, 1);
  assert.ok(!/p1|patient/i.test(e2.ctx.document.createElement().download || ""));
});

test("נעילת RMW: משתמשת ב-navigator.locks כשקיים, ו-fallback כשלא", async () => {
  const names = [];
  const locks = { request: async (name, opts, cb) => { if (typeof opts === "function") { cb = opts; } names.push(name); return cb({}); } };
  const a = load({ locks });
  await tick();
  await a.ctx.saveVisitReportDraft(d(1));
  assert.ok(names.some((n) => n.includes("user-1")));
  assert.equal(JSON.parse(a.localStorage.getItem(ownKey)).length, 1);
  const b = load({});
  await tick();
  await b.ctx.saveVisitReportDraft(d(1));
  assert.equal(JSON.parse(b.localStorage.getItem(ownKey)).length, 1);
});

test("אישור התנתקות: ספירת טיוטות בהודעה, ולא מוחק דבר", async () => {
  const { ctx, localStorage } = load();
  await tick();
  ctx.queueVisitReportDraft(d(1));
  let asked = "";
  ctx.window.confirm = (m) => { asked = m; return false; };
  assert.equal(ctx.confirmSignOutWithDrafts(), false);
  assert.match(asked, /1/);
  assert.equal(JSON.parse(localStorage.getItem(ownKey)).length, 1);
});
