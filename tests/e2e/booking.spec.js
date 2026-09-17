// E2E: זרימת הזמנה מלאה כאורח/ת — בחירת צוות -> מטרה -> תאריך -> שעה -> פרטים -> אישור.
// דורש Supabase project עם דאטה סינתטית (לפחות איש/אשת צוות פעיל/ה אחד/ת) — ר' README.md
// באותה תיקייה. לא רץ מול production ללא כוונה מפורשת: ודא ש-public/config.js מצביע
// על פרויקט בדיקה, לא על הפרויקט האמיתי, לפני הרצה.
const { test, expect } = require("@playwright/test");

test("מטופל אורח יכול להזמין ביקור מקצה לקצה", async ({ page }) => {
  await page.goto("/staff.html");

  const firstStaffCard = page.locator(".staff-card").first();
  await expect(firstStaffCard).toBeVisible({ timeout: 15000 });
  await firstStaffCard.click();

  await expect(page).toHaveURL(/booking\.html/);

  const firstPurposeChip = page.locator(".chip").first();
  await expect(firstPurposeChip).toBeVisible({ timeout: 15000 });
  await firstPurposeChip.click();

  const firstDatePill = page.locator(".date-pill").first();
  await expect(firstDatePill).toBeVisible({ timeout: 15000 });
  await firstDatePill.click();

  const firstAvailableSlot = page.locator(".slot-btn:not([disabled])").first();
  await expect(firstAvailableSlot).toBeVisible({ timeout: 15000 });
  await firstAvailableSlot.click();

  // חשיפה הדרגתית: טופס הפרטים מופיע רק אחרי בחירת מטרה+תאריך+שעה
  await expect(page.locator("#patient-details-section")).toBeVisible();
  await page.fill("#patient-name", "בדיקת E2E");
  await page.fill("#patient-national-id", "123456782");
  await page.fill("#patient-phone", "0501234567");
  await page.fill("#patient-address", "רחוב הבדיקה 1, תל אביב");

  await page.click("#confirm-btn");

  // הצלחה: מעבר ל-my-bookings.html או הודעת הצלחה במקום (בהתאם למימוש הנוכחי)
  await expect(page).toHaveURL(/my-bookings\.html/, { timeout: 15000 });
});
