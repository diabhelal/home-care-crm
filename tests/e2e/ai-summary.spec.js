// טיוטת סיכום AI בטופס דוח הביקור (צוות): opt-in, עריכה ואישור אנושי, ביטול אישור בשינוי מקור, תגובות מאוחרות,
// כפילויות, וכשל/כיבוי של ה-AI שאינם חוסמים תיעוד ידני. backend וספק ממוקקים — אפס רשת, אפס מפתח, אפס עלות.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const NOTES = "המטופלת דיווחה על כאב ראש קל. הוחלפה חבישה.";
const P1 = { id: "p-1", full_name: "דנה כהן", phone: "050-123 4567", address: "הרצל 5, חיפה" };
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

async function setup(browser, { ai, viewport = { width: 1000, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await context.route("**/@supabase/supabase-js@*", (route) => route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  const backend = await installBackendMock(context, { extraConfig: ai ? "window.AI_SUMMARY_ENABLED = true;" : "" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ P1, at }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.patients = [P1]; db.seq = 500;
    db.bookings = [{ id: 3, patient_id: "p-1", staff_id: 1, status: "scheduled", workflow_status: "assigned", approval_status: "confirmed", visit_purpose: "checkup", scheduled_at: at }];
    localStorage.setItem("__demo_db", JSON.stringify(db));
    localStorage.setItem("__demo_session", JSON.stringify({ user: { id: "staff-user-1", is_anonymous: false, app_metadata: {} } }));
    localStorage.setItem("__write_log", "[]");
  }, { P1, at: inHours(1) });
  await page.goto(BASE + "/employee.html");
  await expect(page.locator("#staff-app")).toBeVisible();
  await page.locator("#my-work .pr-card").first().getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  return { page, backend, errors };
}

const fill = async (page, notes = NOTES) => { await page.fill("#vr-pulse", "72"); await page.fill("#vr-summary", notes); };
const gen = (page) => page.locator("#vr-ai-generate");
const badge = (page) => page.locator("#vr-ai-badge");
const lastComplete = (b) => b.completes[b.completes.length - 1];

test("כבוי כברירת מחדל: אין פאנל AI, והשלמה ידנית עובדת בלי שדות AI", async ({ browser }) => {
  const { page, backend, errors } = await setup(browser, { ai: false });
  await expect(page.locator("#vr-ai")).toBeHidden();
  await fill(page);
  await page.click("#visit-report-modal-save");
  await expect(page.locator("#app-success")).toContainText("נשמר");
  const body = lastComplete(backend).body;
  expect(body.treatment_summary).toBe(NOTES);
  expect(body.ai).toBeUndefined(); expect(body.source_notes).toBeUndefined();
  expect(backend.summaryCalls).toHaveLength(0); expect(errors).toEqual([]);
});

test("יצירה: הטיוטה בשדה עריך ומסומן 'לא אושרה', הערות המקור נשארות, ושום דבר לא נשמר", async ({ browser }) => {
  const { page, backend } = await setup(browser, { ai: true });
  await expect(page.locator("#vr-ai")).toBeVisible();
  await fill(page);
  await gen(page).click();
  await expect(page.locator("#vr-ai-draft")).toHaveValue(/טיוטה מספר 1/);
  await expect(badge(page)).toContainText("לא אושרה");
  await expect(page.getByLabel("טיוטת AI לעריכה")).toBeEditable();
  await expect(page.locator("#vr-summary")).toHaveValue(NOTES);               // המקור לא נדרס
  await page.fill("#vr-ai-draft", "טיוטה ערוכה על ידי איש הצוות");
  await expect(page.locator("#vr-ai-draft")).toHaveValue("טיוטה ערוכה על ידי איש הצוות");
  expect(backend.completes).toHaveLength(0);                                   // היצירה לא שמרה ולא השלימה
  const sent = backend.summaryCalls[0].body;
  expect(sent).toMatchObject({ pulse: 72, systolic_bp: null, notes: NOTES, performed_dressing_change: false });   // חסר ≠ 0, בלי מזהים
  expect(Object.keys(sent).some((k) => /patient|staff|name|phone|address|signature/i.test(k))).toBe(false);
});

test("שמירה נחסמת עד אישור; אחרי אישור נשמרים הסיכום הסופי, הערות המקור והטוקן החתום", async ({ browser }) => {
  const { page, backend } = await setup(browser, { ai: true });
  await fill(page); await gen(page).click();
  await expect(page.locator("#vr-ai-draft")).toHaveValue(/טיוטה מספר 1/);
  await page.click("#visit-report-modal-save");
  await expect(page.locator("#visit-report-modal-error")).toContainText("לא אושרה");
  expect(backend.completes).toHaveLength(0);
  await page.fill("#vr-ai-draft", "סיכום סופי שנערך ואושר.");
  await page.click("#vr-ai-approve");
  await expect(badge(page)).toContainText("אושרה");
  await page.click("#visit-report-modal-save");
  await expect(page.locator("#app-success")).toContainText("נשמר");
  const body = lastComplete(backend).body;
  expect(body.treatment_summary).toBe("סיכום סופי שנערך ואושר.");
  expect(body.source_notes).toBe(NOTES);
  expect(body.ai).toEqual({ generation_token: "mock-signed-token-1", approved: true });
});

test("עריכת הטיוטה אחרי אישור מבטלת את האישור", async ({ browser }) => {
  const { page } = await setup(browser, { ai: true });
  await fill(page); await gen(page).click();
  await page.click("#vr-ai-approve");
  await expect(badge(page)).toContainText("אושרה");
  await page.type("#vr-ai-draft", " תוספת");
  await expect(badge(page)).toContainText("לא אושרה");
  await expect(page.locator("#vr-ai-approve")).toBeEnabled();
});

test("שינוי במקור (מדד/הערות/פרוצדורה) מסמן טיוטה מיושנת, מבטל אישור וחוסם שמירה עד הסרה", async ({ browser }) => {
  const { page, backend } = await setup(browser, { ai: true });
  for (const change of [() => page.fill("#vr-pulse", "99"), () => page.fill("#vr-summary", NOTES + " עוד משפט."), () => page.locator('#vr-procedures input[data-proc="performed_injection"]').check()]) {
    await fill(page); await gen(page).click();
    await page.click("#vr-ai-approve");
    await expect(badge(page)).toContainText("אושרה");
    await change();
    await expect(badge(page)).toContainText("מיושנת");
    await expect(page.locator("#vr-ai-approve")).toBeDisabled();
    await page.click("#visit-report-modal-save");
    await expect(page.locator("#visit-report-modal-error")).toContainText("מיושנת");
    expect(backend.completes).toHaveLength(0);
    await page.click("#vr-ai-discard");
    await page.reload(); await page.locator("#my-work .pr-card").first().getByRole("button", { name: /ביקור/ }).click();
    await expect(page.locator("#visit-report-modal")).toBeVisible();
  }
});

test("הסרת הטיוטה מחזירה לתיעוד ידני מלא (הערות המקור הן הסיכום)", async ({ browser }) => {
  const { page, backend } = await setup(browser, { ai: true });
  await fill(page); await gen(page).click();
  await expect(page.locator("#vr-ai-draft")).toHaveValue(/טיוטה מספר 1/);
  await page.fill("#vr-pulse", "75");                                          // מיישן
  await page.click("#vr-ai-discard");
  await page.click("#visit-report-modal-save");
  await expect(page.locator("#app-success")).toContainText("נשמר");
  const body = lastComplete(backend).body;
  expect(body.treatment_summary).toBe(NOTES); expect(body.ai).toBeUndefined(); expect(body.pulse).toBe(75);
});

test("לחיצות חוזרות לא יוצרות בקשות נוספות", async ({ browser }) => {
  const { page, backend } = await setup(browser, { ai: true });
  backend.summaryDelays = [500];
  await fill(page);
  await gen(page).click(); await gen(page).click({ force: true }); await gen(page).dblclick({ force: true });
  await expect(page.locator("#vr-ai-draft")).toHaveValue(/טיוטה מספר 1/);
  expect(backend.summaryCalls).toHaveLength(1);
});

test("תגובה מאוחרת לא מוצגת אם המקור השתנה בזמן היצירה, וגם לא אם המודאל נסגר", async ({ browser }) => {
  const { page, backend } = await setup(browser, { ai: true });
  backend.summaryDelays = [600, 600];
  await fill(page); await gen(page).click();
  await page.fill("#vr-summary", NOTES + " שינוי באמצע.");
  await expect(page.locator("#vr-ai-status")).toContainText("השתנו בזמן יצירת הטיוטה");
  await expect(page.locator("#vr-ai-draft-wrap")).toBeHidden();
  await gen(page).click();                                                     // יצירה חדשה על המקור הנוכחי
  await page.click("#visit-report-modal-cancel");                              // סוגרים לפני שהתגובה חוזרת
  await page.waitForTimeout(800);
  await page.locator("#my-work .pr-card").first().getByRole("button", { name: /ביקור/ }).click();
  await expect(page.locator("#vr-ai-draft-wrap")).toBeHidden();                // לא "דלף" למודאל הבא
  expect(backend.completes).toHaveLength(0);
});

test("כשל ה-AI: הודעה ברורה, ניסיון חוזר מצליח, וגם עם כשל אפשר להשלים ידנית", async ({ browser }) => {
  const { page, backend } = await setup(browser, { ai: true });
  backend.summaryFail = 502;
  await fill(page); await gen(page).click();
  await expect(page.locator("#vr-ai-status")).toContainText("אינו זמין");
  await expect(page.locator("#vr-ai-status")).toContainText("להמשיך בתיעוד ידני");
  await expect(gen(page)).toBeEnabled();
  backend.summaryFail = null;
  await gen(page).click();                                                     // ניסיון חוזר
  await expect(page.locator("#vr-ai-draft")).toHaveValue(/טיוטה מספר 2/);
  await page.click("#vr-ai-discard");
  backend.summaryFail = "abort";
  await gen(page).click();
  await expect(page.locator("#vr-ai-status")).toContainText("ידני");
  await page.click("#visit-report-modal-save");                                // תיעוד ידני עובד למרות הכשל
  await expect(page.locator("#app-success")).toContainText("נשמר");
  expect(lastComplete(backend).body.treatment_summary).toBe(NOTES);
});

test("יצירה מחדש לא דורסת עריכות בלי אישור מפורש", async ({ browser }) => {
  const { page, backend } = await setup(browser, { ai: true });
  await fill(page); await gen(page).click();
  await page.fill("#vr-ai-draft", "עריכה ידנית שלא רוצים לאבד");
  await gen(page).click();
  await expect(gen(page)).toContainText("אישור החלפת הטיוטה");
  expect(backend.summaryCalls).toHaveLength(1);
  await expect(page.locator("#vr-ai-draft")).toHaveValue("עריכה ידנית שלא רוצים לאבד");
  await gen(page).click();
  await expect(page.locator("#vr-ai-draft")).toHaveValue(/טיוטה מספר 2/);
  expect(backend.summaryCalls).toHaveLength(2);
});

test("אין אחסון קבוע לטיוטות: לא נכתב כלום ל-localStorage/sessionStorage מהטיוטה", async ({ browser }) => {
  const { page } = await setup(browser, { ai: true });
  const before = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
  await fill(page); await gen(page).click();
  await expect(page.locator("#vr-ai-draft")).toHaveValue(/טיוטה מספר 1/);
  const after = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
  expect(after).toBe(before);
  expect(after).not.toContain("טיוטה מספר 1");
});

test("נגישות: תוויות, ניווט מקלדת, מטרות מגע 44px ו-RTL בנייד", async ({ browser }) => {
  const { page, backend } = await setup(browser, { ai: true, viewport: { width: 400, height: 800 } });
  await fill(page);
  await gen(page).focus(); await page.keyboard.press("Enter");                 // הפעלה במקלדת
  await expect(page.locator("#vr-ai-draft")).toHaveValue(/טיוטה מספר 1/);
  expect(backend.summaryCalls).toHaveLength(1);
  await expect(page.getByLabel("טיוטת AI לעריכה")).toBeVisible();
  for (const id of ["vr-ai-generate", "vr-ai-approve", "vr-ai-discard"]) {
    const box = await page.locator("#" + id).boundingBox();
    expect(box.height, id).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("vr-ai")).direction)).toBe("rtl");
  await expect(page.locator("#vr-ai-status")).toHaveAttribute("role", "status");
});
