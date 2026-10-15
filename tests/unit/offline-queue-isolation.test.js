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

// כל "טעינת עמוד" = context חדש עם אותו localStorage. rlsAllowedStaff מדמה RLS: רק
// טיוטה ששייכת ל-staff_id הזה נשמרת, אחרת השרת מחזיר שגיאת הרשאה.
function loadPage(storage, { userId, rlsAllowedStaff }) {
  const calls = [];
  const client = {
    from(table) {
      return {
        upsert: (payload) => {
          calls.push({ table, payload });
          if (rlsAllowedStaff !== undefined && payload.staff_id !== rlsAllowedStaff) {
            return Promise.resolve({ error: { message: "new row violates row-level security policy" } });
          }
          return Promise.resolve({ error: null });
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session: userId ? { user: { id: userId } } : null } }),
      onAuthStateChange: () => {},
    },
  };
  const ctx = vm.createContext({
    console,
    window: { addEventListener: () => {}, supabase: { createClient: () => client } },
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
  const b = loadPage(storage, { userId: "user-b", rlsAllowedStaff: 10 });
  await tick();
  const result = await b.ctx.flushOfflineQueue();
  assert.equal(result.synced, 0);
  assert.equal(result.failed, 1);
  const legacy = JSON.parse(storage.getItem("visitReportOfflineQueue"));
  assert.equal(legacy.length, 1, "הטיוטה הישנה נשארת במקומה");
});

test("טיוטה ממפתח ישן נמחקת רק אחרי שמירה מוצלחת", async () => {
  const storage = sharedStorage();
  storage.setItem("visitReportOfflineQueue", JSON.stringify([{ booking_id: 4, staff_id: 10, treatment_summary: "legacy" }]));
  const a = loadPage(storage, { userId: "user-a", rlsAllowedStaff: 10 });
  await tick();
  const result = await a.ctx.flushOfflineQueue();
  assert.equal(result.synced, 1);
  assert.equal(JSON.parse(storage.getItem("visitReportOfflineQueue") || "[]").length, 0);
});
