// בדיקת רגרסיה: booking.html מקבל זמינות מה-backend (GET /availability) — לא מחשב בדפדפן ולא
// קורא ל-RPC taken_slots. הבדיקה מוודאת את חוזה ה-JS: הפרמטרים (start/end/staff_id), שמשבצת
// שהשרת לא החזיר (תפוסה / בתוך מרווח נסיעה) לא מוצגת, ושהמשבצות שחזרו ניתנות לבחירה.
// הלוגיקה בפועל (התנגשות, מרווח נסיעה) נבדקת ב-backend/tests (pytest).
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");

test("booking.html: זמינות מה-backend עם staff_id/start/end נכונים; משבצת שלא הוחזרה לא מוצגת", async ({ page }) => {
  let availabilityUrl = null;
  // Supabase ממוקק: בלי יצירת משתמשי אורח בפרויקט החי
  await page.route("**/@supabase/supabase-js@2", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await page.route("**/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()) + '\nwindow.BACKEND_URL = "http://localhost:8001";\n' });
  });
  await page.route("http://localhost:8001/**", async (route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "Authorization, Content-Type, Idempotency-Key" };
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    availabilityUrl = new URL(req.url());
    // 10:00 (מקומי) תפוס ולכן לא מוחזר; 09:00 ו-11:00 פנויות
    const d = new Date(availabilityUrl.searchParams.get("start") + "T00:00:00");
    const at = (h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
    return route.fulfill({ status: 200, headers: cors, contentType: "application/json",
      body: JSON.stringify({ slots: [{ start: at(9), staff_ids: [1] }, { start: at(11), staff_ids: [1] }], travel_buffer_minutes: 30 }) });
  });

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
  await page.locator(".date-pill").first().click();
  await expect(page.locator(".slot-btn")).toHaveCount(2);

  expect(availabilityUrl.pathname).toBe("/availability");
  expect(availabilityUrl.searchParams.get("staff_id")).toBe("1");
  expect(availabilityUrl.searchParams.get("start")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(availabilityUrl.searchParams.get("end")).toBe(availabilityUrl.searchParams.get("start"));

  await expect(page.locator(".slot-btn", { hasText: "10:00" })).toHaveCount(0);
  await expect(page.locator(".slot-btn", { hasText: "09:00" })).toBeEnabled();
});
