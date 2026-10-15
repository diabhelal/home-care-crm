// מסע הדגמה מלא (מטופל -> צוות -> מנהל), end-to-end, בלי DB חי בכלל.
// כל ה-Supabase (auth + REST + RPC) מוחלף ב-fake client ב-stateful שנשמר ב-localStorage
// (כדי לשרוד ניווטים בין עמודים), ונטען במקום ה-CDN של supabase-js. אפס בקשות רשת ל-Supabase.
// מוודא גם: באנר הדגמה, אפס שגיאות קונסול, ואפס בקשות ל-localhost:8000 (שירות התחזית).
// צילומי מסך של כל שלב נשמרים ב-docs/demo-proof/.
//
// הפעלה מתחת ל-hostname "demo.localhost" (כרום מפנה *.localhost ל-loopback) כדי לדמות פריסה
// מאורחת: isLocalHost() ב-app.js false, אז בדיקת הזמינות של שירות התחזית מדולגת כמו בפרודקשן.
const path = require("path");
const fs = require("fs");
const { test, expect } = require("@playwright/test");

const BASE = "http://demo.localhost:8080";
const SHOTS = path.join(__dirname, "..", "..", "docs", "demo-proof");

const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

async function setup(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  const problems = { consoleErrors: [], pageErrors: [], localhost8000: [], supabaseNetwork: [] };

  await context.route("**/@supabase/supabase-js@*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ contentType: "text/css", body: "" }));

  // ה-backend התפעולי ממוקק (route interception) — הדפדפן כותב הזמנות רק דרכו
  problems.backend = await installBackendMock(context);

  context.on("request", (req) => {
    const url = req.url();
    if (/localhost:8000|127\.0\.0\.1:8000/.test(url)) problems.localhost8000.push(url);
    if (/supabase\.co/.test(url)) problems.supabaseNetwork.push(url);
  });
  context.on("page", (p) => {
    p.on("pageerror", (e) => problems.pageErrors.push(String(e)));
    p.on("console", (m) => { 
      // serviceWorkers:"block" (כדי ש-SW לא יעקוף את ה-routes) גורם ל-register() להחזיר undefined —
      // artifact של ההרנס, לא באג באפליקציה.
      if (m.type() === "error" && !/service worker registration failed/.test(m.text())) problems.consoleErrors.push(m.text());
    });
  });
  const page = await context.newPage();
  return { context, page, problems };
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + ".png") });
}

async function expectDemoBanner(page) {
  const banner = page.locator("#demo-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("מערכת הדגמה");
  await expect(banner).toContainText("נתונים סינתטיים בלבד");
}

// מזמין תור עד פאנל האישור, מתחיל מדף הבית (שירות קודם). slotIndex — איזו שעה פנויה לבחור (תור שונה
// לכל הזמנה). viaChooser: בחירה מפורשת באיש צוות דרך staff.html (הבורר האופציונלי).
async function patientBooks(page, { name, nationalId, slotIndex, shotPrefix, viaChooser = false }) {
  await page.goto(BASE + "/index.html");
  await expectDemoBanner(page);
  const serviceCard = page.locator("#services-grid a").first();
  await expect(serviceCard).toBeVisible();
  if (shotPrefix) await shot(page, `${shotPrefix}-01-home`);
  await serviceCard.click();

  await page.waitForURL(/booking\.html/);
  if (viaChooser) {
    await page.click("#choose-staff-link");
    await page.waitForURL(/staff\.html/);
    const staffCard = page.locator(".staff-card").first();
    await expect(staffCard).toContainText("אחות הדגמה");
    if (shotPrefix) await shot(page, `${shotPrefix}-02-staff`);
    await staffCard.click();
    await page.waitForURL(/booking\.html/);
  }
  await expect(page.locator("#staff-name")).toContainText(viaChooser ? "אחות הדגמה" : "הזמינים המתאימים");
  if (!viaChooser) await expect(page.locator(".chip.selected")).toHaveCount(1); // ?purpose= מכרטיס השירות
  else await page.locator(".chip").first().click();
  await page.fill("#patient-address", "רחוב ההדגמה 1, עיר הדגמה");
  await page.locator(".date-pill").nth(1).click(); // מחר — תמיד בעתיד, בלי תלות בשעת ההרצה
  const slot = page.locator(".slot-btn:not([disabled])").nth(slotIndex);
  await expect(slot).toBeVisible();
  await slot.click();
  await expect(page.locator("#patient-details-section")).toBeVisible();
  await page.fill("#patient-name", name);
  await page.fill("#patient-national-id", nationalId);
  await page.fill("#patient-phone", "050-0000001");
  await page.fill("#notes", "הערה סינתטית");
  if (shotPrefix) await shot(page, `${shotPrefix}-03-booking-details`);
  await expect(page.locator("#confirm-btn")).toBeEnabled();
  await page.click("#confirm-btn");
  await expect(page.locator("#confirmation-panel")).toBeVisible();
  // בקשה, לא אישור: "התבקש וממתין לאישור"
  await expect(page.locator("#success-box")).toContainText("הביקור התבקש וממתין לאישור");
  await expect(page.locator("#success-box")).not.toContainText("נקבעה בהצלחה");
  await expect(page.locator("#confirmed-staff")).toContainText(viaChooser ? "אחות הדגמה" : "ייקבע עם אישור");
  await expect(page.locator("#confirmed-address")).toHaveText("רחוב ההדגמה 1, עיר הדגמה");
  if (shotPrefix) await shot(page, `${shotPrefix}-04-confirmation`);
}

test("מסע הדגמה מלא: מטופל מזמין -> צוות מתעד ביקור -> מנהל מבטל הזמנה", async ({ browser }) => {
  const { context, page, problems } = await setup(browser);
  const PATIENT_A = "מטופל הדגמה א";
  const PATIENT_B = "מטופל הדגמה ב";

  // ===== 1. מטופל א: הזמנה + "ההזמנות שלי" =====
  await patientBooks(page, { name: PATIENT_A, nationalId: "100000018", slotIndex: 0, shotPrefix: "01-patient", viaChooser: true });
  await page.click("#confirmation-panel a");
  await page.waitForURL(/my-bookings\.html/);
  await expectDemoBanner(page);
  const upcoming = page.locator("#upcoming-list .booking-item");
  await expect(upcoming).toHaveCount(1);
  await expect(upcoming.first()).toContainText("אחות הדגמה");
  await expect(upcoming.first()).toContainText("הערה סינתטית");
  await expect(upcoming.first()).toContainText("הביקור התבקש וממתין לאישור");
  await shot(page, "01-patient-05-my-bookings");

  // שמירה-ופתיחה-מחדש: אחרי רענון אותה הזמנה חוזרת
  await page.reload();
  await expect(page.locator("#upcoming-list .booking-item")).toHaveCount(1);

  // ===== 1b. מטופל ב (אורח חדש) מזמין תור נוסף — זה שהמנהל יבטל =====
  await page.evaluate(async () => { await supabaseClient.auth.signOut(); sessionStorage.clear(); });
  await patientBooks(page, { name: PATIENT_B, nationalId: "100000026", slotIndex: 1 });

  // ===== 1c. מנהל מאשר את הבקשה של א' (צוות רשאי להתחיל רק ביקור מאושר) =====
  await page.evaluate(async () => { await supabaseClient.auth.signOut(); });
  await page.goto(BASE + "/admin.html");
  await page.fill("#admin-email", "admin@demo.test");
  await page.fill("#admin-password", "demo-pass-123");
  await page.click("#admin-login-btn");
  await expect(page.locator("#work-queue")).toContainText(PATIENT_A);
  await page.locator("#work-queue tbody tr", { hasText: PATIENT_A }).getByRole("button", { name: "אישור" }).click();
  await expect(page.locator("#app-success")).toContainText("הבקשה אושרה");

  // ===== 2. צוות: כניסה -> העבודה שלי -> התחלת ביקור -> דוח עם מדדים -> היסטוריה =====
  await page.evaluate(async () => { await supabaseClient.auth.signOut(); });
  await page.goto(BASE + "/employee-login.html");
  await expectDemoBanner(page);
  await expect(page.locator("#staff-login-form")).toBeVisible();
  await shot(page, "02-employee-01-login");
  await page.fill("#staff-login-email", "nurse@demo.test");
  await page.fill("#staff-login-password", "demo-pass-123");
  await page.click("#staff-login-btn");
  await page.waitForURL(/employee\.html/);
  await expect(page.locator("#staff-app")).toBeVisible();

  const myWork = page.locator("#my-work");
  await expect(myWork).toContainText(PATIENT_A);
  await shot(page, "02-employee-02-my-work");
  const rowA = myWork.locator(".pr-card", { hasText: PATIENT_A }).first();
  await rowA.getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  await page.fill("#vr-systolic", "128");
  await page.fill("#vr-diastolic", "82");
  await page.fill("#vr-sugar", "105");
  await page.fill("#vr-pulse", "74");
  await page.fill("#vr-temp", "36.7");
  await page.fill("#vr-o2", "98");
  await page.fill("#vr-summary", "ביקור הדגמה: מדדים תקינים, אין ממצאים חריגים.");
  await shot(page, "02-employee-03-visit-report");
  await page.click("#visit-report-modal-save");
  await expect(page.locator("#visit-report-modal")).toBeHidden();
  await expect(page.locator("#app-success")).toContainText("נשמר");

  // הביקור שהושלם מופיע בהיסטוריה, עם דוח (כפתור "עריכת דוח")
  await page.locator("#my-work-history-details summary").click();
  const historyRow = page.locator("#my-work-history .pr-card", { hasText: PATIENT_A });
  await expect(historyRow).toBeVisible();
  await expect(historyRow.getByRole("button", { name: "עריכת דוח" })).toBeVisible();
  await shot(page, "02-employee-04-history");

  // שמירה-ופתיחה-מחדש: הדוח נפתח עם אותם מדדים
  await historyRow.getByRole("button", { name: "עריכת דוח" }).click();
  await expect(page.locator("#vr-systolic")).toHaveValue("128");
  await expect(page.locator("#vr-summary")).toHaveValue(/מדדים תקינים/);
  await page.click("#visit-report-modal-cancel");

  // ===== 3. מנהל: כניסה -> תור עבודה -> ביטול -> סטטוס "בוטל" =====
  await page.evaluate(async () => { await supabaseClient.auth.signOut(); });
  await page.goto(BASE + "/admin.html");
  await expectDemoBanner(page);
  await expect(page.locator("#admin-login-form")).toBeVisible();
  await shot(page, "03-admin-01-login");
  await page.fill("#admin-email", "admin@demo.test");
  await page.fill("#admin-password", "demo-pass-123");
  await page.click("#admin-login-btn");
  await expect(page.locator("#admin-app")).toBeVisible();

  const queue = page.locator("#work-queue");
  await expect(queue).toContainText(PATIENT_B);
  await expect(queue).toContainText(PATIENT_A); // הושלם — בקבוצת "הושלם"
  await shot(page, "03-admin-02-work-queue");

  const rowB = queue.locator("tbody tr", { hasText: PATIENT_B });
  await expect(rowB).toHaveCount(1);
  await expect(rowB).toContainText("בקשה חדשה");
  await rowB.getByRole("button", { name: "דחייה" }).click();
  await expect(page.locator("#app-success")).toContainText("הבקשה נדחתה");

  const cancelledGroup = queue.locator("details.queue-group", { hasText: "בוטל" });
  await expect(cancelledGroup).toHaveCount(1);
  await cancelledGroup.locator("summary").click();
  await expect(cancelledGroup.locator("tbody tr", { hasText: PATIENT_B })).toBeVisible();
  // וההזמנה של א' (שהושלמה) לא הושפעה
  await expect(queue.locator("details.queue-group", { hasText: "הושלם" }).locator("tbody tr", { hasText: PATIENT_A })).toHaveCount(1);
  await shot(page, "03-admin-03-cancelled");

  // ===== חוצה-מסע: אפס שגיאות, אפס localhost:8000, אפס רשת אמיתית ל-Supabase =====
  expect(problems.pageErrors, "uncaught page errors").toEqual([]);
  expect(problems.consoleErrors, "console errors").toEqual([]);
  expect(problems.localhost8000, "requests to predictive service on localhost:8000").toEqual([]);
  expect(problems.supabaseNetwork, "real Supabase network requests").toEqual([]);
  // ההזמנות נוצרו/נדחו רק דרך ה-backend, לא בכתיבה ישירה ל-bookings
  expect(problems.backend.requests.filter((r) => r.path === "/bookings/request" && r.method === "POST")).toHaveLength(2);
  await context.close();
});
