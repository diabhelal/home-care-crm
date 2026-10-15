// מסלול ההזמנה מול ה-backend (FastAPI) ממוקק + Supabase ממוקק, בלי DB חי ובלי שרת אמיתי.
// מכסה: שירות קודם -> בקשה (לא "אושר"), כשל backend = אין אישור ואין הזמנה, 409 וטעינת שעות מחדש,
// Idempotency-Key זהה בניסיון חוזר, אישור/דחייה/שיבוץ ע"י מנהל, ושאין כתיבה ישירה ל-bookings.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock, overrideConfig, SLOT_TAKEN_MSG } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";

async function setup(browser, { backendUrl } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  await context.route("**/@supabase/supabase-js@2", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  let ctl = null;
  if (backendUrl === "") await overrideConfig(context, "");
  else ctl = await installBackendMock(context);
  const problems = { page: [], console: [] };
  context.on("page", (p) => {
    p.on("pageerror", (e) => problems.page.push(String(e)));
    p.on("console", (m) => {
      // כשלי רשת מכוונים (backend מנותק) מופיעים בקונסול כ-"Failed to load resource"
      if (m.type() === "error" && !/service worker registration failed|Failed to load resource|net::ERR/.test(m.text())) problems.console.push(m.text());
    });
  });
  const page = await context.newPage();
  return { context, page, ctl, problems };
}

const dbOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db") || "{}"));
const writeLog = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__write_log") || "[]"));

// עובר ממסך הבית דרך כרטיס שירות עד שנבחרה שעה ופרטי המטופל מולאו (בלי ללחוץ אישור)
async function fillBooking(page, { slotIndex = 0, name = "מטופל בדיקה", nationalId = "100000018" } = {}) {
  await page.goto(BASE + "/index.html");
  await page.locator("#services-grid a").first().click();
  await page.waitForURL(/booking\.html\?purpose=/);
  await expect(page.locator("#staff-name")).toContainText("הזמינים המתאימים");
  await page.fill("#patient-address", "רחוב הבדיקה 5, עיר");
  await page.locator(".date-pill").nth(1).click();
  const slot = page.locator(".slot-btn").nth(slotIndex);
  await expect(slot).toBeVisible();
  await slot.click();
  await page.fill("#patient-name", name);
  await page.fill("#patient-national-id", nationalId);
  await page.fill("#patient-phone", "050-0000002");
}

test("שירות קודם: בקשה נשלחת ל-backend, מוצג 'התבקש וממתין לאישור' ולא 'אושר', ואין כתיבה ישירה ל-bookings", async ({ browser }) => {
  const { context, page, ctl, problems } = await setup(browser);
  await fillBooking(page);
  await page.click("#confirm-btn");
  await expect(page.locator("#confirmation-panel")).toBeVisible();
  await expect(page.locator("#success-box")).toHaveText("הביקור התבקש וממתין לאישור");
  await expect(page.locator("#confirmation-panel")).not.toContainText("הביקור אושר");
  await expect(page.locator("#confirmation-panel")).not.toContainText("נקבעה בהצלחה");

  const post = ctl.requests.filter((r) => r.method === "POST" && r.path === "/bookings/request");
  expect(post).toHaveLength(1);
  expect(post[0].headers.authorization).toMatch(/^Bearer fake-jwt-guest-/);
  expect(post[0].headers["idempotency-key"]).toBeTruthy();
  // הזהות מהטוקן בלבד — אין patient_id בגוף; בלי איש צוות מסוים אין staff_id
  expect(post[0].body).not.toHaveProperty("patient_id");
  expect(post[0].body).not.toHaveProperty("staff_id");
  expect(post[0].body.purpose).toBeTruthy();
  expect(post[0].body.address).toBe("רחוב הבדיקה 5, עיר");
  // זמינות נשאבה מהשרת, בלי staff_id (השיבוץ האוטומטי)
  expect(ctl.availabilityCalls.length).toBeGreaterThan(0);
  expect(ctl.availabilityCalls[0]).not.toHaveProperty("staff_id");

  // הדפדפן לא כתב ל-bookings בעצמו
  expect((await writeLog(page)).filter((w) => w.table === "bookings")).toEqual([]);
  expect((await dbOf(page)).bookings).toHaveLength(1);

  // "ההזמנות שלי": מצב בקשה ברור
  await page.click("#confirmation-panel a");
  await page.waitForURL(/my-bookings\.html/);
  const item = page.locator("#upcoming-list .booking-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("הביקור התבקש וממתין לאישור");
  await expect(item.locator(".status-badge")).toHaveText("ממתין לאישור");
  expect(problems.page).toEqual([]);
  expect(problems.console).toEqual([]);
  await context.close();
});

test("backend לא זמין: הודעת כשל ברורה, בלי פאנל אישור ובלי הזמנה", async ({ browser }) => {
  const { context, page, ctl } = await setup(browser);
  await fillBooking(page);
  ctl.down = true;
  await page.click("#confirm-btn");
  await expect(page.locator("#error-box")).toBeVisible();
  await expect(page.locator("#error-box")).toContainText("לא נשמרה הזמנה");
  await expect(page.locator("#confirmation-panel")).toBeHidden();
  await expect(page.locator("#success-box")).toBeHidden();
  await expect(page.locator("#confirm-btn")).toBeEnabled(); // אפשר לנסות שוב
  expect((await dbOf(page)).bookings || []).toHaveLength(0);
  expect((await writeLog(page)).filter((w) => w.table === "bookings")).toEqual([]);
  await context.close();
});

test("BACKEND_URL ריק (מארח לא מוגדר): 'שירות אינו זמין', אין בקשות ואין הזמנה", async ({ browser }) => {
  const { context, page } = await setup(browser, { backendUrl: "" });
  await page.goto(BASE + "/booking.html?purpose=checkup");
  await page.fill("#patient-address", "רחוב הבדיקה 5, עיר");
  await page.locator(".date-pill").nth(1).click();
  await expect(page.locator("#error-box")).toContainText("שירות ההזמנות אינו זמין");
  await expect(page.locator(".slot-btn")).toHaveCount(0);
  await expect(page.locator("#confirm-btn")).toBeDisabled();
  await expect(page.locator("#confirmation-panel")).toBeHidden();
  expect((await dbOf(page)).bookings || []).toHaveLength(0);
  await context.close();
});

test("409 (משבצת נתפסה): הודעת השרת מוצגת, אין אישור, והשעות נטענות מחדש בלי המשבצת התפוסה", async ({ browser }) => {
  const { context, page, ctl } = await setup(browser);
  await fillBooking(page, { slotIndex: 0 });
  const chosen = await page.locator(".slot-btn.selected").textContent();
  const callsBefore = ctl.availabilityCalls.length;
  // מטופל אחר תופס את המשבצת בינתיים
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("__demo_db"));
    const first = db.medical_staff[0];
    const now = new Date(); now.setDate(now.getDate() + 1);
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0, 0).toISOString();
    db.bookings = [...(db.bookings || []), { id: ++db.seq, patient_id: "other", staff_id: first.id, visit_purpose: "checkup", scheduled_at: at, status: "scheduled", approval_status: "confirmed", workflow_status: "assigned" }];
    localStorage.setItem("__demo_db", JSON.stringify(db));
  });
  await page.click("#confirm-btn");
  await expect(page.locator("#error-box")).toContainText(SLOT_TAKEN_MSG);
  await expect(page.locator("#confirmation-panel")).toBeHidden();
  await expect.poll(() => ctl.availabilityCalls.length).toBeGreaterThan(callsBefore);
  await expect(page.locator(".slot-btn", { hasText: chosen.trim() })).toHaveCount(0);
  await expect(page.locator("#confirm-btn")).toBeDisabled(); // צריך לבחור שעה חדשה
  expect(((await dbOf(page)).bookings || []).filter((b) => b.patient_id !== "other")).toHaveLength(0);
  await context.close();
});

test("ניסיון חוזר אחרי איבוד תשובה שולח אותו Idempotency-Key ולא יוצר הזמנה כפולה", async ({ browser }) => {
  const { context, page, ctl } = await setup(browser);
  await fillBooking(page);
  ctl.dropResponseNext = 1; // השרת שומר, אבל הרשת נופלת לפני שהתשובה מגיעה
  await page.click("#confirm-btn");
  await expect(page.locator("#error-box")).toContainText("לא נשמרה הזמנה"); // מבחינת המשתמש: לא ידוע/נכשל
  await expect(page.locator("#confirmation-panel")).toBeHidden();
  await expect(page.locator("#confirm-btn")).toBeEnabled();
  await page.click("#confirm-btn");
  await expect(page.locator("#confirmation-panel")).toBeVisible();

  const posts = ctl.requests.filter((r) => r.method === "POST" && r.path === "/bookings/request");
  expect(posts).toHaveLength(2);
  expect(posts[0].headers["idempotency-key"]).toBeTruthy();
  expect(posts[1].headers["idempotency-key"]).toBe(posts[0].headers["idempotency-key"]);
  expect(ctl.created).toBe(1);
  expect((await dbOf(page)).bookings).toHaveLength(1);
  await context.close();
});

test("מנהל: בקשות מוצגות ראשונות ומסומנות, אישור הופך ל'אושר' אצל המטופל, ודחייה מציגה 'לא אושרה' עם הזמנה מחדש", async ({ browser }) => {
  const { context, page, ctl } = await setup(browser);
  // שתי בקשות מאורחים שונים
  await fillBooking(page, { slotIndex: 0, name: "מטופל אישור", nationalId: "100000018" });
  await page.click("#confirm-btn");
  await expect(page.locator("#confirmation-panel")).toBeVisible();
  const sessionA = await page.evaluate(() => localStorage.getItem("__demo_session"));
  await page.evaluate(async () => { await supabaseClient.auth.signOut(); sessionStorage.clear(); });
  await fillBooking(page, { slotIndex: 1, name: "מטופל דחייה", nationalId: "100000026" });
  await page.click("#confirm-btn");
  await expect(page.locator("#confirmation-panel")).toBeVisible();
  const sessionB = await page.evaluate(() => localStorage.getItem("__demo_session"));

  await page.evaluate(async () => { await supabaseClient.auth.signOut(); });
  await page.goto(BASE + "/admin.html");
  await page.fill("#admin-email", "admin@demo.test");
  await page.fill("#admin-password", "demo-pass-123");
  await page.click("#admin-login-btn");
  const queue = page.locator("#work-queue");
  await expect(queue).toContainText("מטופל אישור");

  // הבקשות בקבוצה הראשונה ומסומנות
  const firstGroup = queue.locator("details.queue-group").first();
  await expect(firstGroup).toContainText("בקשות ממתינות לאישור");
  await expect(firstGroup.locator("tbody tr")).toHaveCount(2);
  await expect(firstGroup.locator("tbody tr").first()).toContainText("בקשה חדשה");

  await firstGroup.locator("tbody tr", { hasText: "מטופל אישור" }).getByRole("button", { name: "אישור" }).click();
  await expect(page.locator("#app-success")).toContainText("הבקשה אושרה");
  await expect(firstGroup.locator("tbody tr")).toHaveCount(1);
  await expect(queue.locator("details.queue-group", { hasText: "משויך" }).locator("tbody tr", { hasText: "מטופל אישור" })).toHaveCount(1);
  // הבקשה אושרה דרך ה-backend עם JWT של המנהל
  const approve = ctl.requests.find((r) => r.path.endsWith("/approve"));
  expect(approve.headers.authorization).toMatch(/^Bearer fake-jwt-admin-user-1/);
  // הדחייה
  await queue.locator("details.queue-group").first().locator("tbody tr", { hasText: "מטופל דחייה" }).getByRole("button", { name: "דחייה" }).click();
  await expect(page.locator("#app-success")).toContainText("הבקשה נדחתה");

  // אין כתיבה ישירה של approval/staff מהדפדפן
  expect((await writeLog(page)).filter((w) => w.table === "bookings" && w.op !== "select")).toEqual([]);
  const db = await dbOf(page);
  expect(db.bookings.map((b) => b.approval_status).sort()).toEqual(["confirmed", "rejected"]);

  // המטופלים רואים את המצב
  await page.evaluate((s) => localStorage.setItem("__demo_session", s), sessionA);
  await page.goto(BASE + "/my-bookings.html");
  await expect(page.locator("#upcoming-list .booking-item")).toContainText("אושר");
  await expect(page.locator("#upcoming-list .booking-item .status-badge")).toHaveText("אושר");
  await expect(page.locator("#upcoming-list")).not.toContainText("ממתין לאישור");

  await page.evaluate((s) => localStorage.setItem("__demo_session", s), sessionB);
  await page.goto(BASE + "/my-bookings.html");
  const rejected = page.locator("#past-list .booking-item");
  await expect(rejected).toHaveCount(1);
  await expect(rejected).toContainText("הבקשה לא אושרה");
  await rejected.getByRole("button", { name: "הזמנה חוזרת" }).or(rejected.locator("button.btn-secondary").first()).first().click();
  await page.waitForURL(/booking\.html/);
  await expect(page.locator("#staff-name")).toContainText("הזמינים המתאימים"); // בלי איש צוות מסוים
  await context.close();
});

test("מנהל: שיבוץ מחדש מתנגש -> הודעת ה-backend (409) מוצגת בשורה ואין כתיבה ישירה", async ({ browser }) => {
  const { context, page, ctl } = await setup(browser);
  await fillBooking(page, { slotIndex: 0, name: "מטופל שיבוץ", nationalId: "100000018" });
  await page.click("#confirm-btn");
  await expect(page.locator("#confirmation-panel")).toBeVisible();
  // איש צוות שני שכבר תפוס באותו מועד
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("__demo_db"));
    const mine = db.bookings[0];
    db.medical_staff.push({ id: 2, full_name: "אח שני", role: "nurse", is_active: true, available_weekdays: [0,1,2,3,4,5,6], work_start_time: "08:00:00", work_end_time: "16:00:00", slot_duration_minutes: 60 });
    db.bookings.push({ id: ++db.seq, patient_id: "other", staff_id: 2, visit_purpose: "checkup", scheduled_at: mine.scheduled_at, status: "scheduled", approval_status: "confirmed", workflow_status: "assigned" });
    localStorage.setItem("__demo_db", JSON.stringify(db));
  });
  await page.evaluate(async () => { await supabaseClient.auth.signOut(); });
  await page.goto(BASE + "/admin.html");
  await page.fill("#admin-email", "admin@demo.test");
  await page.fill("#admin-password", "demo-pass-123");
  await page.click("#admin-login-btn");
  const row = page.locator("#work-queue tbody tr", { hasText: "מטופל שיבוץ" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "שינוי שיוך" }).click();
  await row.locator("select").selectOption("2");
  await expect(row.locator(".error-msg")).toContainText(SLOT_TAKEN_MSG);
  const call = ctl.requests.find((r) => r.path.endsWith("/reassign"));
  expect(call.body).toEqual({ staff_id: 2 });
  expect((await dbOf(page)).bookings[0].staff_id).toBe(1);
  expect((await writeLog(page)).filter((w) => w.table === "bookings")).toHaveLength(0);
  await context.close();
});
