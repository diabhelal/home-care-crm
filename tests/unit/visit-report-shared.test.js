// טסט יחידה ל-public/js/shared/visit-report-shared.js (סקריפט קלאסי, ללא exports) —
// מורץ בתוך vm context עם document/friendlyErrorMessage מדומים.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "../../public/js/shared/visit-report-shared.js"), "utf8");

function load(values = {}) {
  const ctx = {
    friendlyErrorMessage: () => "FRIENDLY",
    document: { getElementById: (id) => ({ value: values[id] ?? "" }) },
  };
  vm.createContext(ctx);
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
