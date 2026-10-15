// מסע מובייל מלא (400x800, עברית) מקצה לקצה, על fake supabase-js + backend ממוקק. אפס DB חי.
// מטופל מבקש ביקור -> מנהל מאשר -> צוות רואה, ניווט/התקשרות, צ'ק-אין (שעת שרת) -> צוות משלים דוח עם
// מדדים וחתימה כשהרשת למטה (טיוטה נשמרת) -> הרשת חוזרת, הטיוטה מסתנכרנת ויורדת -> המטופל רואה "הושלם".
// בנוסף: החלפת משתמש באותו מכשיר לא חושפת/מסנכרנת טיוטה של אחר, כפל הזמנה = הודעת התנגשות בלי הזמנה,
// פעולות לא מורשות (צוות לא משויך / מטופל אחר) = שגיאה ברורה בלי שינוי, בלי גלישה אופקית, ויעדי מגע >= 44px.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock, SLOT_TAKEN_MSG } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const VIEWPORT = { width: 400, height: 800 };
const NAME = "מטופלת ניידת";
const PHONE = "050-0000002";
const ADDRESS = "רחוב הבדיקה 5, עיר";
const STAFF_SESSION = { user: { id: "staff-user-1", is_anonymous: false, app_metadata: {} } };
const ADMIN_SESSION = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };

async function setup(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@2", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  const ctl = await installBackendMock(context);
  const problems = { page: [], console: [] };
  context.on("page", (p) => {
    p.on("pageerror", (e) => problems.page.push(String(e)));
    p.on("console", (m) => {
      if (m.type() === "error" && !/service worker registration failed|Failed to load resource|net::ERR/.test(m.text())) problems.console.push(m.text());
    });
  });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept()); // confirm() של ביטול
  return { context, page, ctl, problems };
}

const dbOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db") || "{}"));
const setDb = (page, fn) => page.evaluate((src) => {
  const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
  new Function("db", src)(db);
  localStorage.setItem("__demo_db", JSON.stringify(db));
}, fn);
const sessionRaw = (page) => page.evaluate(() => localStorage.getItem("__demo_session"));
const useSession = (page, session) => page.evaluate((s) => {
  if (s) localStorage.setItem("__demo_session", typeof s === "string" ? s : JSON.stringify(s));
  else localStorage.removeItem("__demo_session");
}, session);
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

// כל אלמנט אינטראקטיבי גלוי בתוך ה-viewport/המסמך שגובהו < 44px (קישורי טקסט בתוך פסקה פטורים).
async function smallTargets(page, scopeSelector = "body") {
  return page.evaluate((scope) => {
    const root = document.querySelector(scope) || document.body;
    const out = [];
    root.querySelectorAll("button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, [role=button]").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (el.tagName === "A" && el.closest("p, li, .consent, footer") && cs.display === "inline") return;
      if (el.closest("[hidden]")) return;
      if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()}#${el.id || ""}.${(el.className || "").toString().slice(0, 40)} "${(el.textContent || el.value || "").trim().slice(0, 20)}" h=${Math.round(r.height)}`);
    });
    return out;
  }, scopeSelector);
}

async function fillBooking(page, { slotIndex = 0, name = NAME, nationalId = "100000018" } = {}) {
  await page.goto(BASE + "/index.html");
  await page.locator("#services-grid a").first().click();
  await page.waitForURL(/booking\.html\?purpose=/);
  await expect(page.locator("#staff-name")).toContainText("הזמינים המתאימים");
  await page.fill("#patient-address", ADDRESS);
  await page.locator(".date-pill").nth(1).click(); // מחר
  const slot = page.locator(".slot-btn:not([disabled])").nth(slotIndex);
  await expect(slot).toBeVisible();
  await slot.click();
  await page.fill("#patient-name", name);
  await page.fill("#patient-national-id", nationalId);
  await page.fill("#patient-phone", PHONE);
}

async function drawSignature(page) {
  const box = await page.locator("#vr-signature-canvas").boundingBox();
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 80, { steps: 5 });
  await page.mouse.move(box.x + 140, box.y + 30, { steps: 5 });
  await page.mouse.up();
}

test("מסע מובייל מלא: בקשה -> אישור מנהל -> צוות (ניווט/התקשרות/צ'ק-אין) -> השלמה אופליין -> סנכרון -> מטופל רואה 'הושלם'", async ({ browser }) => {
  const { context, page, ctl, problems } = await setup(browser);

  // ===== 1. מטופל מבקש ביקור =====
  await fillBooking(page);
  expect(await noOverflow(page)).toBe(true);
  await page.click("#confirm-btn");
  await expect(page.locator("#success-box")).toHaveText("הביקור התבקש וממתין לאישור");
  expect(await noOverflow(page)).toBe(true);
  const patientSession = await sessionRaw(page);
  let db = await dbOf(page);
  expect(db.bookings).toHaveLength(1);
  const bookingId = db.bookings[0].id;
  expect(db.bookings[0].approval_status).toBe("requested");
  const patientId = db.bookings[0].patient_id;

  // ===== 2. כפל הזמנה: משבצת נתפסה בינתיים => הודעת התנגשות, לא נוצרה הזמנה =====
  await fillBooking(page, { slotIndex: 0, name: NAME, nationalId: "100000018" });
  const takenAt = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("__demo_db"));
    const first = db.medical_staff[0];
    const now = new Date(); now.setDate(now.getDate() + 1);
    // המשבצת הראשונה הפנויה אחרי 08:00 שנתפסה בבקשה הראשונה = 09:00 של מחר
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0).toISOString();
    db.bookings.push({ id: ++db.seq, patient_id: "other-patient", staff_id: first.id, visit_purpose: "checkup", scheduled_at: at, status: "scheduled", approval_status: "confirmed", workflow_status: "assigned" });
    localStorage.setItem("__demo_db", JSON.stringify(db));
    return at;
  });
  expect(takenAt).toBeTruthy();
  await page.click("#confirm-btn");
  await expect(page.locator("#error-box")).toContainText(SLOT_TAKEN_MSG);
  await expect(page.locator("#confirmation-panel")).toBeHidden();
  db = await dbOf(page);
  expect(db.bookings.filter((b) => b.patient_id === patientId)).toHaveLength(1);
  expect(db.bookings.filter((b) => b.patient_id !== "other-patient")).toHaveLength(1);

  // ===== 3. מנהל מאשר (דרך ה-backend) =====
  await useSession(page, ADMIN_SESSION);
  await page.goto(BASE + "/admin.html");
  const queue = page.locator("#work-queue");
  await expect(queue).toContainText(NAME);
  expect(await noOverflow(page)).toBe(true);
  await queue.locator("tbody tr", { hasText: NAME }).getByRole("button", { name: "אישור" }).click();
  await expect(page.locator("#app-success")).toContainText("הבקשה אושרה");
  const approve = ctl.requests.find((r) => r.path === `/admin/bookings/${bookingId}/approve`);
  expect(approve.headers.authorization).toMatch(/^Bearer fake-jwt-admin-user-1/);
  db = await dbOf(page);
  expect(db.bookings.find((b) => b.id === bookingId).approval_status).toBe("confirmed");

  // ===== 4. צוות: כרטיס הביקור, ניווט/התקשרות, צ'ק-אין (שעת שרת) =====
  await useSession(page, STAFF_SESSION);
  await page.goto(BASE + "/employee.html");
  await expect(page.locator("#staff-app")).toBeVisible();
  const card = page.locator("#my-work .pr-card").first();
  await expect(card).toContainText(NAME);
  const nav = card.locator('[data-field-action="navigate"]');
  await expect(nav).toHaveAttribute("href", /waze\.com\/ul\?q=/);
  await expect(card.locator('[data-field-action="call"]')).toHaveAttribute("href", "tel:0500000002");
  expect(await noOverflow(page)).toBe(true);
  await card.getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  expect(ctl.checkIns).toBe(1);
  db = await dbOf(page);
  const checked = db.bookings.find((b) => b.id === bookingId);
  expect(checked.workflow_status).toBe("in_progress");
  expect(new Date(checked.checked_in_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000); // חותמת השרת
  expect(await noOverflow(page)).toBe(true);

  // ===== 5. השלמה כשהרשת למטה: הטיוטה נשמרת, אין השלמה =====
  ctl.down = true;
  await page.fill("#vr-systolic", "128");
  await page.fill("#vr-diastolic", "82");
  await page.fill("#vr-pulse", "74");
  await page.fill("#vr-temp", "36.7");
  await page.fill("#vr-o2", "98");
  await page.fill("#vr-summary", "ביקור מובייל: מדדים תקינים.");
  await drawSignature(page);
  await page.click("#visit-report-modal-save");
  await expect(page.locator("#visit-report-modal")).toBeHidden();
  await expect(page.locator("#offline-draft-banner")).toContainText("שמור מקומית");
  const draftKey = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith("visitReportOfflineQueue")));
  expect(draftKey).toBe("visitReportOfflineQueue:staff-user-1");
  const queued = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), draftKey);
  expect(queued).toHaveLength(1);
  expect(queued[0].booking_id).toBe(bookingId);
  expect(queued[0].patient_signature_data).toMatch(/^data:image\/png/);
  expect(queued[0].systolic_bp).toBe(128);
  db = await dbOf(page);
  expect(db.bookings.find((b) => b.id === bookingId).status).toBe("scheduled");
  expect(db.visit_reports || []).toHaveLength(0);
  expect(ctl.completes).toHaveLength(0);

  // ===== 6. החלפת משתמש באותו מכשיר (הרשת חזרה): הטיוטה של הצוות לא נחשפת ולא מסונכרנת =====
  ctl.down = false;
  const completeReqsBefore = ctl.requests.filter((r) => r.path.endsWith("/complete")).length;
  await useSession(page, patientSession);
  await page.goto(BASE + "/my-bookings.html");
  await expect(page.locator("#upcoming-list .booking-item")).toHaveCount(1);
  await expect(page.locator("#offline-draft-banner")).toBeHidden(); // לא רואה טיוטה של הצוות
  const asPatient = await page.evaluate(async () => {
    const r = await flushOfflineQueue();
    return { count: getQueuedDraftCount(), synced: r.synced, failed: r.failed };
  });
  expect(asPatient).toEqual({ count: 0, synced: 0, failed: 0 });
  expect(ctl.requests.filter((r) => r.path.endsWith("/complete")).length).toBe(completeReqsBefore);
  expect(await page.evaluate((k) => localStorage.getItem(k) !== null, draftKey)).toBe(true); // עדיין אצל הצוות

  // ===== 7. הצוות חוזר: הטיוטה מסתנכרנת, יורדת מהתור, הביקור הושלם =====
  await useSession(page, STAFF_SESSION);
  await page.goto(BASE + "/employee.html");
  await expect.poll(() => ctl.completes.length).toBe(1);
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), draftKey)).toBeNull();
  const sent = ctl.completes[0];
  expect(sent.booking_id).toBe(bookingId);
  expect(sent.body.systolic_bp).toBe(128);
  expect(sent.body.treatment_summary).toBe("ביקור מובייל: מדדים תקינים.");
  expect(sent.body.patient_signature_data).toMatch(/^data:image\/png/);
  expect(sent.body).not.toHaveProperty("patient_id");
  expect(sent.body).not.toHaveProperty("staff_id");
  const completeReq = ctl.requests.filter((r) => r.path === `/staff/visits/${bookingId}/complete`).pop();
  expect(completeReq.headers.authorization).toMatch(/^Bearer fake-jwt-staff-user-1/);
  db = await dbOf(page);
  expect(db.bookings.find((b) => b.id === bookingId).status).toBe("completed");
  expect(db.visit_reports).toHaveLength(1);
  // אפס כתיבה ישירה של הדפדפן ל-bookings/visit_reports בכל המסע
  const writes = await page.evaluate(() => JSON.parse(localStorage.getItem("__write_log") || "[]"));
  expect(writes.filter((w) => w.table === "bookings" || w.table === "visit_reports")).toEqual([]);
  // הערכת הסיכון אחרי הסנכרון נעשית בשרת בלבד: אפס כתיבה ישירה ל-risk_predictions/alerts
  expect(writes.filter((w) => w.table === "risk_predictions" || w.table === "alerts")).toEqual([]);
  await expect.poll(() => ctl.risks.length).toBe(1);

  // ===== 8. המטופל רואה "הושלם" =====
  await useSession(page, patientSession);
  await page.goto(BASE + "/my-bookings.html");
  const done = page.locator("#past-list .booking-item").first();
  await expect(done).toContainText(`הזמנה #${bookingId}`);
  await expect(done.locator(".status-badge")).toHaveText("בוצע");
  await expect(done).toContainText("סיכום: ביקור מובייל: מדדים תקינים.");
  await expect(page.locator("#upcoming-list .booking-item")).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);

  expect(problems.page).toEqual([]);
  expect(problems.console).toEqual([]);
  await context.close();
});

const P = { id: "p-1", full_name: "דנה כהן", phone: "050-123 4567", address: "הרצל 5, חיפה" };
const at = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const bk = (o) => ({ status: "scheduled", workflow_status: "assigned", visit_purpose: "checkup", staff_id: 1, approval_status: "confirmed", visit_address: "הרצל 5, חיפה", ...o });

async function seed(page, { patients = [P], bookings, session, staff2 = false }) {
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ patients, bookings, session, staff2 }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.patients = patients; db.bookings = bookings; db.seq = 500;
    if (staff2) db.medical_staff.push({ id: 2, full_name: "אחות שנייה", role: "nurse", is_active: true, auth_user_id: "staff-user-2", available_weekdays: [0, 1, 2, 3, 4, 5, 6], work_start_time: "08:00:00", work_end_time: "16:00:00", slot_duration_minutes: 60 });
    localStorage.setItem("__demo_db", JSON.stringify(db));
    localStorage.setItem("__demo_session", JSON.stringify(session));
    localStorage.setItem("__write_log", "[]");
  }, { patients, bookings, session, staff2 });
}

test("פעולות לא מורשות: צוות לא משויך מקבל 403 עם הודעה ברורה; מטופל אחר לא מבטל; כשל רשת לא מציג 'בוטל'", async ({ browser }) => {
  const { context, page, ctl } = await setup(browser);

  // --- צוות: התצוגה ישנה (stale) — ההזמנה כבר הועברה לאיש צוות אחר ---
  await seed(page, {
    bookings: [bk({ id: 1, patient_id: "p-1", scheduled_at: at(1), workflow_status: "in_progress", checked_in_at: at(0) })],
    session: STAFF_SESSION, staff2: true,
  });
  await page.goto(BASE + "/employee.html");
  await expect(page.locator("#staff-app")).toBeVisible();
  const card = page.locator("#my-work .pr-card").first();
  await expect(card).toContainText("דנה כהן");
  await setDb(page, "db.bookings[0].staff_id = 2;"); // הועברה לאחות אחרת, הדף עדיין פתוח
  await card.getByRole("button", { name: "המשך ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  await page.fill("#vr-summary", "ניסיון לא מורשה");
  await page.click("#visit-report-modal-save");
  await expect(page.locator("#visit-report-modal-error")).toContainText("אינה משויכת אליך");
  await expect(page.locator("#visit-report-modal")).toBeVisible(); // הנתונים נשארו בטופס
  await expect(page.locator("#vr-summary")).toHaveValue("ניסיון לא מורשה");
  let db = await dbOf(page);
  expect(db.bookings[0].status).toBe("scheduled");
  expect(db.visit_reports || []).toHaveLength(0);
  expect(ctl.completes).toHaveLength(0);
  expect(await page.evaluate(() => getQueuedDraftCount())).toBe(0);
  expect(await noOverflow(page)).toBe(true);

  // --- מטופל: ביטול בכשל רשת => שגיאה ו"בוטל" לא מוצג; אחר כך הצלחה ---
  await useSession(page, { user: { id: "guest-me", is_anonymous: true, app_metadata: {} } });
  await setDb(page, `db.bookings = [{ id: 11, patient_id: "guest-me", staff_id: 1, visit_purpose: "checkup", scheduled_at: ${JSON.stringify(at(30))}, status: "scheduled", approval_status: "requested", workflow_status: "assigned", visit_address: "x 1, y" },
    { id: 12, patient_id: "guest-me", staff_id: 1, visit_purpose: "checkup", scheduled_at: ${JSON.stringify(at(50))}, status: "scheduled", approval_status: "requested", workflow_status: "assigned", visit_address: "x 2, y" }];`);
  await page.goto(BASE + "/my-bookings.html");
  const items = page.locator("#upcoming-list .booking-item");
  await expect(items).toHaveCount(2);
  ctl.down = true;
  await items.first().getByRole("button", { name: /ביטול/ }).click();
  await expect(page.locator("#error-box, .error-msg").filter({ hasText: /לא נשמרה|אינו זמין|שגיאה/ }).first()).toBeVisible();
  await expect(page.locator("#upcoming-list")).not.toContainText("בוטל");
  expect((await dbOf(page)).bookings.find((b) => b.id === 11).status).toBe("scheduled");
  ctl.down = false;
  await items.first().getByRole("button", { name: /ביטול/ }).click();
  await expect.poll(async () => (await dbOf(page)).bookings.find((b) => b.id === 11).status).toBe("cancelled");
  expect(ctl.cancels).toEqual([{ scope: "patient", id: 11 }]);
  await expect(page.locator("#past-list")).toContainText("בוטל");

  // --- מטופל אחר: ההזמנה עברה לבעלות אחרת בזמן שהרשימה פתוחה => 404 ברור, בלי שינוי ---
  await page.reload();
  await expect(page.locator("#upcoming-list .booking-item")).toHaveCount(1);
  await setDb(page, "db.bookings.find((b) => b.id === 12).patient_id = 'someone-else';");
  await page.locator("#upcoming-list .booking-item").first().getByRole("button", { name: /ביטול/ }).click();
  await expect(page.locator("#error-box")).toContainText("ההזמנה לא נמצאה");
  expect((await dbOf(page)).bookings.find((b) => b.id === 12).status).toBe("scheduled");
  expect(ctl.cancels).toEqual([{ scope: "patient", id: 11 }]);
  const writes = await page.evaluate(() => JSON.parse(localStorage.getItem("__write_log") || "[]"));
  expect(writes.filter((w) => w.table === "bookings")).toEqual([]);
  await context.close();
});

test("400px: בלי גלישה אופקית ויעדי מגע >= 44px במסכי המפתח (הזמנה, ההזמנות שלי, העבודה שלי, דוח ביקור)", async ({ browser }) => {
  const { context, page } = await setup(browser);
  await fillBooking(page);
  expect(await noOverflow(page)).toBe(true);
  expect(await smallTargets(page, "main")).toEqual([]);

  await seed(page, {
    bookings: [
      bk({ id: 1, patient_id: "p-1", scheduled_at: at(2) }),
      bk({ id: 2, patient_id: "guest-me", scheduled_at: at(30), approval_status: "requested" }),
    ],
    session: { user: { id: "guest-me", is_anonymous: true, app_metadata: {} } },
  });
  await page.goto(BASE + "/my-bookings.html");
  await expect(page.locator("#upcoming-list .booking-item")).toHaveCount(1);
  expect(await noOverflow(page)).toBe(true);
  expect(await smallTargets(page, "main")).toEqual([]);

  await useSession(page, STAFF_SESSION);
  await page.goto(BASE + "/employee.html");
  await expect(page.locator("#my-work .pr-card").first()).toContainText("דנה כהן");
  expect(await noOverflow(page)).toBe(true);
  expect(await smallTargets(page, "#my-work")).toEqual([]);
  await page.locator("#my-work .pr-card").first().getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  expect(await smallTargets(page, "#visit-report-modal")).toEqual([]);
  await expect(page.locator("#visit-report-modal-save")).toBeInViewport();
  await context.close();
});
