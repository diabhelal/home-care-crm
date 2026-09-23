// טסטי יחידה ל-Offline Draft Queue (queueVisitReportDraft/flushOfflineQueue/
// offlineQueueFlushMessage, public/app.js) — במיוחד כישלון חלקי: upsert(visit_reports)
// מצליח אבל update(bookings.status='completed') נכשל, ולא נבלע בשקט כ"synced".
//
// public/app.js לא נכתב כמודול CommonJS (משתמשים בו כ-<script> קלאסי שחולק scope
// עם שאר הדפים, ר' הערות ארכיטקטורה ב-js/admin/*.js) — אי אפשר require() אותו
// ישירות (window is not defined, ואין module.exports). כדי לבדוק אותו בלי לשנות
// את המבנה שלו, מריצים את קוד המקור שלו בתוך vm context עם window/navigator/
// localStorage/supabaseClient מדומים: הצהרות function (לא const) בקוד המקור
// נדבקות ל-context object בדיוק כמו global function declaration בדפדפן.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const APP_JS_SOURCE = fs.readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");

// עצמים שנוצרים בתוך vm context אחר (App.js רץ שם) מקבלים Object.prototype שונה
// מזה של ה-realm של הטסט עצמו — assert.deepEqual/deepStrictEqual מתייחס לזה כ"לא
// reference-equal" גם כששני האובייקטים זהים מבחינה מבנית (בעיה ידועה של Node vm).
// משווים שדה-שדה במקום, כדי להישאר עם node:assert/strict הרגיל בלי תלות חדשה.
function assertFlushResult(result, expected, message) {
  assert.equal(result.synced, expected.synced, message);
  assert.equal(result.failed, expected.failed, message);
  assert.equal(result.partial, expected.partial, message);
}

function createLocalStorageShim() {
  let store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

// fakeDb.visitReportsUpsertResult / bookingsUpdateResult נקבעים מחדש בכל טסט כדי
// לדמות הצלחה/כישלון בכל שלב; fakeDb.calls עוקב אחרי כל קריאה בפועל (לבדיקת
// "ניסיון חוזר בלי כפילויות" — כמה פעמים כל טבלה נקראה בפועל).
function createContext() {
  const fakeDb = {
    visitReportsUpsertResult: { error: null },
    bookingsUpdateResult: { error: null },
    calls: [],
  };
  const fakeSupabaseClient = {
    from(table) {
      if (table === "visit_reports") {
        return {
          upsert: (payload, opts) => {
            fakeDb.calls.push({ table: "visit_reports", payload, opts });
            return Promise.resolve(fakeDb.visitReportsUpsertResult);
          },
        };
      }
      if (table === "bookings") {
        return {
          update: (fields) => ({
            eq: (col, val) => {
              fakeDb.calls.push({ table: "bookings", fields, col, val });
              return Promise.resolve(fakeDb.bookingsUpdateResult);
            },
          }),
        };
      }
      throw new Error("unexpected table in test: " + table);
    },
  };
  const ctx = vm.createContext({
    console,
    window: { addEventListener: () => {}, supabase: { createClient: () => fakeSupabaseClient } },
    navigator: { onLine: true },
    localStorage: createLocalStorageShim(),
  });
  vm.runInContext(APP_JS_SOURCE, ctx, { filename: "public/app.js" });
  return { ctx, fakeDb };
}

test("flushOfflineQueue: הצלחה מלאה (בלי markCompleted) — נספר synced, התור מתרוקן", async () => {
  const { ctx } = createContext();
  ctx.queueVisitReportDraft({ booking_id: 1, patient_id: "p1", treatment_summary: "טופל" });
  const result = await ctx.flushOfflineQueue();
  assertFlushResult(result, { synced: 1, failed: 0, partial: 0 });
  assert.equal(ctx.getQueuedDraftCount(), 0);
});

test("flushOfflineQueue: markCompleted מוגדר וגם visit_reports וגם bookings מצליחים — synced מלא", async () => {
  const { ctx, fakeDb } = createContext();
  ctx.queueVisitReportDraft({ booking_id: 2, patient_id: "p2", treatment_summary: "טופל", _markCompleted: true });
  const result = await ctx.flushOfflineQueue();
  assertFlushResult(result, { synced: 1, failed: 0, partial: 0 });
  assert.equal(ctx.getQueuedDraftCount(), 0);
  const bookingsCall = fakeDb.calls.find((c) => c.table === "bookings");
  assert.ok(bookingsCall, "bookings.update היה אמור להיקרא");
  assert.equal(bookingsCall.fields.status, "completed");
});

test("flushOfflineQueue: כישלון חלקי — visit_reports נשמר אך bookings.update נכשל, לא נספר synced ולא נעלם מהתור", async () => {
  const { ctx, fakeDb } = createContext();
  fakeDb.bookingsUpdateResult = { error: { message: "network-ish failure" } };
  ctx.queueVisitReportDraft({ booking_id: 3, patient_id: "p3", treatment_summary: "טופל", _markCompleted: true });

  const result = await ctx.flushOfflineQueue();
  assertFlushResult(result, { synced: 0, failed: 1, partial: 1 }, "כישלון חלקי לא אמור להיספר כ-synced מלא");
  assert.equal(ctx.getQueuedDraftCount(), 1, "הטיוטה אמורה להישאר בתור לניסיון חוזר");
  const remaining = ctx.getOfflineQueue()[0];
  assert.equal(remaining.booking_id, 3);
  assert.equal(remaining._markCompleted, true, "_markCompleted צריך להישאר כדי שהניסיון הבא ישלים רק את זה");
});

test("flushOfflineQueue: ניסיון חוזר אחרי כישלון חלקי מצליח בלי ליצור כפילות בתור", async () => {
  const { ctx, fakeDb } = createContext();
  fakeDb.bookingsUpdateResult = { error: { message: "still down" } };
  ctx.queueVisitReportDraft({ booking_id: 4, patient_id: "p4", treatment_summary: "טופל", _markCompleted: true });
  await ctx.flushOfflineQueue();
  assert.equal(ctx.getQueuedDraftCount(), 1);

  fakeDb.bookingsUpdateResult = { error: null }; // "החיבור חזר"
  const result2 = await ctx.flushOfflineQueue();
  assertFlushResult(result2, { synced: 1, failed: 0, partial: 0 });
  assert.equal(ctx.getQueuedDraftCount(), 0, "אין כפילות — הטיוטה היחידה סונכרנה וירדה מהתור");

  const bookingsCalls = fakeDb.calls.filter((c) => c.table === "bookings" && c.val === 4);
  assert.equal(bookingsCalls.length, 2, "bookings.update נקרא פעמיים (כישלון + הצלחה) על אותה הזמנה, לא נוצרו רשומות נוספות");
});

test("flushOfflineQueue: שגיאת רשת אמיתית (upsert זורק) — נשאר בתור, לא נספר synced/partial", async () => {
  const { ctx } = createContext();
  ctx.queueVisitReportDraft({ booking_id: 5, patient_id: "p5", treatment_summary: "טופל" });

  // מדמים throw (לא {error:...}) — בדיוק כמו TypeError: Failed to fetch באמת.
  // window.supabase.createClient() תמיד מחזיר את אותו fakeSupabaseClient (singleton
  // בהגדרת createContext), אז שינוי .from עליו כאן משפיע ישירות על מה ש-flushOfflineQueue
  // (שמחזיק את אותו supabaseClient מה-const המקורי) יקבל.
  ctx.window.supabase.createClient().from = (table) => {
    if (table === "visit_reports") {
      return { upsert: () => Promise.reject(new Error("Failed to fetch")) };
    }
    throw new Error("unexpected table in test: " + table);
  };

  const result = await ctx.flushOfflineQueue();
  assertFlushResult(result, { synced: 0, failed: 1, partial: 0 });
  assert.equal(ctx.getQueuedDraftCount(), 1);
});

test("queueVisitReportDraft: טיוטה חדשה לאותה הזמנה מחליפה את הקודמת, לא מצטברת כפילות", () => {
  const { ctx } = createContext();
  ctx.queueVisitReportDraft({ booking_id: 6, treatment_summary: "גרסה 1" });
  ctx.queueVisitReportDraft({ booking_id: 6, treatment_summary: "גרסה 2" });
  const queue = ctx.getOfflineQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].treatment_summary, "גרסה 2");
});

test("offlineQueueFlushMessage: מנוסח נכון לכל שילוב synced/partial", () => {
  const { ctx } = createContext();
  assert.match(ctx.offlineQueueFlushMessage(3, 0), /3 דוחות/);
  assert.doesNotMatch(ctx.offlineQueueFlushMessage(3, 0), /הושלם.*ממתין|ממתין.*הושלם/);
  assert.match(ctx.offlineQueueFlushMessage(0, 2), /2.*נשמרו/);
  assert.match(ctx.offlineQueueFlushMessage(0, 2), /הושלם/);
  const both = ctx.offlineQueueFlushMessage(1, 1);
  assert.match(both, /1 דוחות/);
  assert.match(both, /1 נשמרו/);
});
