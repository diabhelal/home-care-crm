// INDEPENDENT verification of the draft EXPORT (security). APP_JS=/path/to/app.js node --test verify-export.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const APP = process.env.APP_JS;
const SRC = fs.readFileSync(APP, "utf8");
const KEY = "visitReportOfflineQueue";
const tick = () => new Promise((r) => setImmediate(r));
function storage() { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, keys: () => Object.keys(s), raw: () => s }; }
function page(st, userId, confirms) {
  const blobs = [], downloads = [], prompts = [];
  class FakeBlob { constructor(parts, opts) { this.text = parts.join(""); this.type = opts && opts.type; blobs.push(this); } }
  const doc = { createElement: () => { const a = { click: () => downloads.push({ href: a.href, name: a.download }), remove() {} }; return a; }, body: { appendChild() {}, prepend() {} }, getElementById: () => null };
  const client = { auth: { getSession: () => Promise.resolve({ data: { session: userId ? { access_token: "t", user: { id: userId } } : null } }), onAuthStateChange: () => {} }, from() { throw new Error("x"); } };
  const ctx = vm.createContext({ console, fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }), AbortController, setTimeout, clearTimeout, Blob: FakeBlob, URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} }, document: doc,
    window: { addEventListener() {}, BACKEND_URL: "http://b.test", supabase: { createClient: () => client }, confirm: (m) => { prompts.push(m); return confirms.length ? confirms.shift() : false; } },
    navigator: { onLine: true }, localStorage: st });
  vm.runInContext(SRC, ctx, { filename: APP });
  return { ctx, blobs, downloads, prompts };
}
const d = (id) => ({ booking_id: id, staff_id: 10, patient_id: "p-" + id, treatment_summary: "SYNTH-" + id, patient_signature_data: "data:image/png;base64,SIG" + id });
function seeded() {
  const st = storage();
  st.raw()[`${KEY}:B`] = JSON.stringify([{ ...d(2), _ownerId: "B", _draftId: "x", _rev: 1 }]);           // user B's own draft
  st.raw()[`${KEY}:A`] = JSON.stringify([{ ...d(1), _ownerId: "A", _draftId: "y", _rev: 1 }]);           // user A's draft (other user, same device)
  st.raw()[KEY] = JSON.stringify([d(3)]);                                                                  // legacy shared-key draft, owner unknown
  st.raw()[`${KEY}:unreadable:123`] = "CORRUPT-RAW-SYNTH-4";                                               // unreadable backup, owner unknown
  return st;
}
test("E1 ייצוא ברירת מחדל: רק הטיוטות של המשתמש המחובר; לא של משתמש אחר, לא ישנות, לא פגומות", async () => {
  const st = seeded(); const b = page(st, "B", [true, false]); await tick();       // 1st confirm yes, 2nd (shared) NO
  b.ctx.exportOfflineDrafts();
  assert.equal(b.blobs.length, 1); const t = b.blobs[0].text;
  assert.ok(t.includes("SYNTH-2"), "own draft present");
  assert.ok(!t.includes("SYNTH-1"), "another user's keyed draft must NOT be exported");
  assert.ok(!t.includes("SYNTH-3") && !t.includes("CORRUPT-RAW-SYNTH-4"), "shared/legacy data excluded unless explicitly confirmed");
  assert.ok(!/"ownerId"/.test(t), "no owner id in the file");
});
test("E2 אזהרה לפני כל הורדה; סירוב = שום קובץ", async () => {
  const st = seeded(); const b = page(st, "B", [false]); await tick(); b.ctx.exportOfflineDrafts();
  assert.equal(b.blobs.length, 0); assert.equal(b.downloads.length, 0); assert.equal(b.prompts.length, 1);
});
test("E3 אישור שני מפורש נדרש כדי לכלול ישנות/פגומות (שעשויות להיות של אחר)", async () => {
  const st = seeded(); const b = page(st, "B", [true, true]); await tick(); b.ctx.exportOfflineDrafts();
  assert.equal(b.prompts.length, 2); assert.match(b.prompts[1], /משתמש אחר/);
  const t = b.blobs[0].text; assert.ok(t.includes("SYNTH-3") && t.includes("CORRUPT-RAW-SYNTH-4")); assert.ok(!t.includes("SYNTH-1"), "A's keyed draft never exported by B");
});
test("E4 הייצוא לא מוחק ולא מזיז דבר", async () => {
  const st = seeded(); const before = JSON.stringify(st.raw()); const b = page(st, "B", [true, true]); await tick(); b.ctx.exportOfflineDrafts();
  assert.equal(JSON.stringify(st.raw()), before);
});
test("E5 שם הקובץ בלי מזהי מטופל/משתמש", async () => {
  const st = seeded(); const b = page(st, "B", [true, false]); await tick(); b.ctx.exportOfflineDrafts();
  assert.match(b.downloads[0].name, /^offline-drafts-\d{4}-\d{2}-\d{2}\.json$/);
});
test("E6 בלי בעלים מזוהה: אין טיוטות 'own' בייצוא", async () => {
  const st = seeded(); const b = page(st, null, [true, false]); await tick(); b.ctx.exportOfflineDrafts();
  const t = b.blobs[0].text; assert.ok(!t.includes("SYNTH-1") && !t.includes("SYNTH-2"));
});
test("E7 [ידוע] הקובץ שיורד כולל חתימת מטופל בטקסט גלוי", async () => {
  const st = seeded(); const b = page(st, "B", [true, false]); await tick(); b.ctx.exportOfflineDrafts();
  console.log("   E7 signature image in plaintext inside the downloaded file:", b.blobs[0].text.includes("data:image/png;base64,SIG2") ? "YES (residual risk; protection = the warning only)" : "no"); assert.ok(true);
});
