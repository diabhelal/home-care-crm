// חישוב "טהור" (בלי DOM/Supabase, בלי window) של משבצות זמן פנויות ליום נתון —
// בכוונה בקובץ נפרד מ-app.js כדי שיהיה ניתן להריץ אותו גם ב-Node לצורך בדיקות יחידה
// (ר' tests/unit/slot-calculation.test.js) בלי לדמות סביבת דפדפן. נטען בדפדפן כ-
// <script> רגיל לפני app.js (לא build step, לא module bundler).
//
// workStartTime/workEndTime בפורמט "HH:MM"; takenTimes = מערך של Date או ISO string
// של שעות תפוסות; מחזיר מערך {time: Date, available: boolean} לכל משבצת ביום.
function computeAvailableSlots({ date, workStartTime, workEndTime, slotDurationMinutes, takenTimes, now }) {
  const [startH, startM] = workStartTime.split(":").map(Number);
  const [endH, endM] = workEndTime.split(":").map(Number);
  const durationMs = slotDurationMinutes * 60 * 1000;

  const dayStart = new Date(date);
  dayStart.setHours(startH, startM, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(endH, endM, 0, 0);

  const takenSet = new Set((takenTimes || []).map((t) => (t instanceof Date ? t.getTime() : new Date(t).getTime())));
  const nowTime = (now || new Date()).getTime();

  const slots = [];
  for (let t = dayStart.getTime(); t + durationMs <= dayEnd.getTime(); t += durationMs) {
    const slotDate = new Date(t);
    slots.push({ time: slotDate, available: !takenSet.has(t) && t >= nowTime });
  }
  return slots;
}

// Node (CommonJS, בשימוש בטסטים בלבד) לצד דפדפן (global script רגיל).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeAvailableSlots };
}
