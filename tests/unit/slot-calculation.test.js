// טסטי יחידה לחישוב משבצות זמן פנויות (computeAvailableSlots, public/app.js).
// Node builtin test runner — אין תלות חיצונית, בהתאם ל"בלי build step" של הפרויקט.
// הרצה: node --test tests/unit/

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeAvailableSlots } = require("../../public/slot-calculation.js");

const DAY = "2026-09-21"; // יום שני, לא רלוונטי לחישוב עצמו (רק תאריך בסיס)

test("מייצר משבצות לאורך כל יום העבודה, במרווחים הנכונים", () => {
  const slots = computeAvailableSlots({
    date: new Date(DAY),
    workStartTime: "08:00",
    workEndTime: "10:00",
    slotDurationMinutes: 30,
    takenTimes: [],
    now: new Date("2026-01-01"), // בעבר הרחוק - שום משבצת לא "עברה"
  });
  assert.equal(slots.length, 4); // 08:00, 08:30, 09:00, 09:30
  assert.equal(slots[0].time.getHours(), 8);
  assert.equal(slots[0].time.getMinutes(), 0);
  assert.equal(slots[3].time.getHours(), 9);
  assert.equal(slots[3].time.getMinutes(), 30);
  assert.ok(slots.every((s) => s.available));
});

test("לא חורג מעבר לשעת סיום העבודה (משבצת חלקית לא נכללת)", () => {
  // 08:00-09:15 עם משבצות של 30 דק' -> רק 08:00 ו-08:30 נכנסות במלואן
  const slots = computeAvailableSlots({
    date: new Date(DAY),
    workStartTime: "08:00",
    workEndTime: "09:15",
    slotDurationMinutes: 30,
    takenTimes: [],
    now: new Date("2026-01-01"),
  });
  assert.equal(slots.length, 2);
});

test("מסמן משבצת תפוסה (מתוך bookings קיימים) כ-available:false", () => {
  const slots = computeAvailableSlots({
    date: new Date(DAY),
    workStartTime: "08:00",
    workEndTime: "10:00",
    slotDurationMinutes: 60,
    takenTimes: [new Date(`${DAY}T09:00:00`)],
    now: new Date("2026-01-01"),
  });
  assert.equal(slots.length, 2);
  assert.equal(slots[0].available, true); // 08:00
  assert.equal(slots[1].available, false); // 09:00 - תפוס
});

test("מסמן משבצת שכבר עברה (לעומת now) כ-available:false", () => {
  const slots = computeAvailableSlots({
    date: new Date(DAY),
    workStartTime: "08:00",
    workEndTime: "10:00",
    slotDurationMinutes: 60,
    takenTimes: [],
    now: new Date(`${DAY}T09:30:00`), // אחרי 08:00 ואחרי 09:00
  });
  assert.equal(slots[0].available, false); // 08:00 - עבר
  assert.equal(slots[1].available, false); // 09:00 - עבר
});

test("takenTimes מקבל גם ISO string וגם Date, לא רק Date", () => {
  const slots = computeAvailableSlots({
    date: new Date(DAY),
    workStartTime: "08:00",
    workEndTime: "09:00",
    slotDurationMinutes: 60,
    takenTimes: [`${DAY}T08:00:00`], // string, לא אובייקט Date
    now: new Date("2026-01-01"),
  });
  assert.equal(slots[0].available, false);
});

test("יום עבודה ריק (start === end) לא מייצר אף משבצת, לא קורס", () => {
  const slots = computeAvailableSlots({
    date: new Date(DAY),
    workStartTime: "08:00",
    workEndTime: "08:00",
    slotDurationMinutes: 30,
    takenTimes: [],
    now: new Date("2026-01-01"),
  });
  assert.equal(slots.length, 0);
});
