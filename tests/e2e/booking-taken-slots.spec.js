// בדיקת רגרסיה: booking.html משתמש ב-RPC taken_slots() (ולא ב-select ישיר על
// bookings) כדי לחשב אילו שעות תפוסות. select ישיר היה נכשל בשקט (RLS על bookings
// מסתיר הזמנות של מטופלים אחרים במכוון — bookings_select_own), והיה גורם לכל שעה
// להיראות פנויה גם כשהיא תפוסה. הבדיקה הזו רק מוודאת את ה-contract בצד ה-JS (שם ה-
// RPC ופרמטרים נכונים) עם supabaseClient.rpc מדומה — התיקון בפועל (partial unique
// index + RPC SECURITY DEFINER) אומת בנפרד, ידנית, מול ה-DB האמיתי (ר' migration
// 20260923135337_fix_bookings_cancelled_slot_reuse_and_slot_availability_rpc.sql).
const { test, expect } = require("@playwright/test");

test("booking.html: loadSlots קורא ל-taken_slots RPC עם staff_id/from/to נכונים, ומסמן את השעה שחוזרת כ-disabled", async ({ page }) => {
  await page.goto("/staff.html");
  await page.evaluate(() => {
    sessionStorage.setItem("selected_staff", JSON.stringify({
      id: 1, full_name: "בדיקה", role: "nurse",
      available_weekdays: [0, 1, 2, 3, 4, 5, 6],
      work_start_time: "08:00:00", work_end_time: "16:00:00",
      slot_duration_minutes: 60,
    }));
  });
  await page.goto("/booking.html");
  await page.waitForSelector(".date-pill", { timeout: 10000 });

  const rpcCall = await page.evaluate(async () => {
    let capturedArgs = null;
    const realRpc = supabaseClient.rpc.bind(supabaseClient);
    supabaseClient.rpc = (fn, args) => {
      if (fn === "taken_slots") {
        capturedArgs = args;
        // מדמים ש-10:00 (מקומי) תפוס — מחזירים אותו timestamp שה-DOM אמור להתאים אליו.
        const takenDate = new Date();
        takenDate.setHours(10, 0, 0, 0);
        return Promise.resolve({ data: [{ scheduled_at: takenDate.toISOString() }], error: null });
      }
      return realRpc(fn, args);
    };
    document.querySelector(".date-pill")?.click();
    await new Promise((r) => setTimeout(r, 500));
    return capturedArgs;
  });

  expect(rpcCall).not.toBeNull();
  expect(rpcCall.p_staff_id).toBe(1);
  expect(typeof rpcCall.p_from).toBe("string");
  expect(typeof rpcCall.p_to).toBe("string");

  const slot10 = page.locator(".slot-btn", { hasText: "10:00" });
  await expect(slot10).toBeDisabled();
});
