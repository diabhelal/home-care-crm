// E2E: כניסת צוות -> פתיחת ביקור מ"העבודה שלי" -> מילוי דוח ביקור -> שמירה.
// דורש פרטי כניסה אמיתיים של איש/אשת צוות בפרויקט הבדיקה (לא production!) דרך משתני
// סביבה E2E_STAFF_EMAIL/E2E_STAFF_PASSWORD — לעולם לא hardcoded בקוד. אם לא הוגדרו,
// הטסט מדלג בבירור (test.skip) במקום להיכשל בלי הסבר. ר' tests/e2e/README.md.
const { test, expect } = require("@playwright/test");

const EMAIL = process.env.E2E_STAFF_EMAIL;
const PASSWORD = process.env.E2E_STAFF_PASSWORD;

test.skip(!EMAIL || !PASSWORD, "E2E_STAFF_EMAIL/E2E_STAFF_PASSWORD לא הוגדרו — מדלג על טסט שדורש כניסה אמיתית");

test("איש צוות יכול למלא ולשמור דוח ביקור", async ({ page }) => {
  await page.goto("/employee-login.html");
  await page.fill("#staff-login-email", EMAIL);
  await page.fill("#staff-login-password", PASSWORD);
  await page.click("#staff-login-btn");

  await expect(page).toHaveURL(/employee\.html/, { timeout: 15000 });

  // "העבודה שלי": פותחים את "הביקור הבא" או ביקור מתוכנן ראשון, אם קיים
  const startVisitBtn = page.getByRole("button", { name: /התחלת ביקור|המשך ביקור|עריכת תיק/ }).first();
  await expect(startVisitBtn).toBeVisible({ timeout: 15000 });
  await startVisitBtn.click();

  await expect(page.locator("#visit-report-modal")).toBeVisible();

  await page.fill("#vr-pulse", "75");
  await page.fill("#vr-summary", `דוח בדיקת E2E — ${new Date().toISOString()}`);

  await page.click("#visit-report-modal-save");

  // הצלחה: המודל נסגר (אין כשל שקט — אם היה נכשל, הודעת שגיאה הייתה נשארת גלויה)
  await expect(page.locator("#visit-report-modal")).toBeHidden({ timeout: 15000 });
  await expect(page.locator("#visit-report-modal-error")).not.toHaveClass(/show/);
});
