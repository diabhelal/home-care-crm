// טסט יחידה ל-public/js/shared/visit-report-shared.js (סקריפט קלאסי, ללא exports) —
// מורץ בתוך vm context עם document/friendlyErrorMessage מדומים.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

// visit-report-shared.js תלוי ב-createPatientScope (נטען לפניו בדפים האמיתיים).
const SCOPE_SRC = fs.readFileSync(path.join(__dirname, "../../public/js/shared/patient-scope.js"), "utf8");
const SRC = fs.readFileSync(path.join(__dirname, "../../public/js/shared/visit-report-shared.js"), "utf8");

function load(values = {}) {
  const ctx = {
    friendlyErrorMessage: () => "FRIENDLY",
    document: { getElementById: (id) => ({ value: values[id] ?? "" }) },
  };
  vm.createContext(ctx);
  vm.runInContext(SCOPE_SRC, ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

test("collectVitalsFromForm: empty -> null, numeric strings -> Number", () => {
  const ctx = load({ "vr-systolic": "120", "vr-diastolic": "", "vr-sugar": "5.5", "vr-pulse": "72", "vr-temp": "", "vr-o2": "98" });
  const v = ctx.collectVitalsFromForm();
  assert.equal(v.systolic_bp, 120);
  assert.equal(v.diastolic_bp, null);
  assert.equal(v.blood_sugar, 5.5);
  assert.equal(v.temperature, null);
  assert.equal(v.oxygen_saturation, 98);
});

test("predictiveServiceUnavailableMessage: network errors vs other errors", () => {
  const ctx = load();
  assert.match(ctx.predictiveServiceUnavailableMessage(new Error("Failed to fetch")), /predictive-service/);
  assert.equal(ctx.predictiveServiceUnavailableMessage(new Error("boom")), "FRIENDLY");
  assert.equal(ctx.predictiveServiceUnavailableMessage(null), "FRIENDLY");
});

test("mergeMeasurementsIntoVisits: מדידות שנוספו מוצגות יחד עם הביקורים, החדש ראשון, בלי להתנגש במזהי הדוחות ובלי לשנות את המקור", () => {
  const ctx = load();
  const visits = [{ id: 1, visit_date: "2026-11-05T10:00:00Z", pulse: 80 }];
  const ms = [
    { id: 1, booking_id: 7, measured_at: "2026-11-05T09:00:00Z", pulse: 90 },
    { id: 2, booking_id: null, measured_at: "2026-11-06T09:00:00Z", pulse: 70 },
    { id: 3, booking_id: 7, measured_at: "2026-11-05T09:30:00Z", pulse: 90 },   // אותו ערך בדיוק פעמיים: לא נבלע
  ];
  const out = ctx.mergeMeasurementsIntoVisits(visits, ms);
  assert.deepEqual(Array.from(out, (r) => r.id), ["m2", 1, "m3", "m1"]);
  assert.equal(out.filter((r) => r._measurement).length, 3);
  assert.equal(out.find((r) => r.id === 1)._measurement, undefined);
  assert.equal(visits.length, 1);                       // הקלט לא שונה
  assert.equal(ms[0].id, 1);
  assert.deepEqual(Array.from(ctx.mergeMeasurementsIntoVisits(visits, null)), visits);
  assert.deepEqual(Array.from(ctx.mergeMeasurementsIntoVisits(null, [])), []);
});
