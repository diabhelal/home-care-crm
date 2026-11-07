// A booking request must never be presented as approved unless approval_status is explicitly "confirmed".
// Synthetic data only. Extracts the pure function from public/i18n.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "../../public/i18n.js"), "utf8");
const m = SRC.match(/function bookingDisplayState\(b\) \{[\s\S]*?\n\}/);
assert.ok(m, "bookingDisplayState not found in public/i18n.js");
const bookingDisplayState = new Function(`${m[0]}; return bookingDisplayState;`)();

test("missing approval_status is treated as a pending request, never confirmed", () => {
  assert.equal(bookingDisplayState({ status: "scheduled" }), "requested");
  assert.equal(bookingDisplayState({}), "requested");
});

test("only an explicit confirmed approval shows as confirmed", () => {
  assert.equal(bookingDisplayState({ status: "scheduled", approval_status: "confirmed" }), "confirmed");
  assert.equal(bookingDisplayState({ status: "scheduled", approval_status: "requested" }), "requested");
});

test("rejected, cancelled and completed keep their states", () => {
  assert.equal(bookingDisplayState({ status: "scheduled", approval_status: "rejected" }), "rejected");
  assert.equal(bookingDisplayState({ status: "cancelled", approval_status: "confirmed" }), "cancelled");
  assert.equal(bookingDisplayState({ status: "completed", approval_status: "confirmed" }), "completed");
});
