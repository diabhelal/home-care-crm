// פעולות שטח לצוות ("העבודה שלי"): כתובת/ניווט/התקשרות, התחלת ביקור דרך ה-backend (חותמת שרת),
// בלי כתיבה ישירה ל-bookings, ביקור ממתין לאישור בלי כפתור התחלה, XSS, ובלי גלישה אופקית ב-400px.
// fake supabase-js + backend ממוקק; אפס DB חי.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";

async function setup(browser, viewport = { width: 1000, height: 800 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await context.route("**/@supabase/supabase-js@*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  const backend = await installBackendMock(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { context, page, backend, errors };
}

function inHours(h) { return new Date(Date.now() + h * 3600 * 1000).toISOString(); }

async function seed(page, { patients, bookings, allergies = [] }) {
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ patients, bookings, allergies }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.patients = patients; db.bookings = bookings; db.patient_allergies = allergies;
    db.seq = 500;
    localStorage.setItem("__demo_db", JSON.stringify(db));
    localStorage.setItem("__demo_session", JSON.stringify({ user: { id: "staff-user-1", is_anonymous: false, app_metadata: {} } }));
    localStorage.setItem("__write_log", "[]");
  }, { patients, bookings, allergies });
  await page.goto(BASE + "/employee.html");
  await expect(page.locator("#staff-app")).toBeVisible();
}

const P1 = { id: "p-1", full_name: "דנה כהן", phone: "050-123 4567", address: "הרצל 5, חיפה" };
const base = (o) => ({ status: "scheduled", workflow_status: "assigned", visit_purpose: "checkup", staff_id: 1, ...o });

test("כרטיס הביקור הבא: כתובת, אלרגיות, ניווט והתקשרות עם href נכון", async ({ browser }) => {
  const { page, errors } = await setup(browser);
  await seed(page, {
    patients: [P1],
    bookings: [base({ id: 1, patient_id: "p-1", scheduled_at: inHours(2), approval_status: "confirmed", visit_address: "ביאליק 10, תל אביב" })],
    allergies: [{ patient_id: "p-1", substance: "פניצילין", severity: "severe" }],
  });
  const card = page.locator("#my-work .pr-card").first();
  await expect(card).toContainText("דנה כהן");
  await expect(card).toContainText("ביאליק 10, תל אביב"); // visit_address גובר על כתובת המטופל
  await expect(card).toContainText("אלרגיות: פניצילין");
  const nav = card.locator('[data-field-action="navigate"]');
  await expect(nav).toHaveAttribute("href", "https://waze.com/ul?q=" + encodeURIComponent("ביאליק 10, תל אביב") + "&navigate=yes");
  await expect(nav).toHaveAttribute("target", "_blank");
  await expect(nav).toHaveAttribute("rel", /noopener/);
  await expect(card.locator('[data-field-action="call"]')).toHaveAttribute("href", "tel:0501234567");
  const h = await nav.evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(44);
  expect(errors).toEqual([]);
});

test("בלי כתובת/טלפון: ניווט והתקשרות מושבתים עם הסבר", async ({ browser }) => {
  const { page } = await setup(browser);
  await seed(page, {
    patients: [{ id: "p-2", full_name: "ללא פרטים", phone: "", address: null }],
    bookings: [base({ id: 2, patient_id: "p-2", scheduled_at: inHours(2), approval_status: "confirmed" })],
  });
  const card = page.locator("#my-work .pr-card").first();
  await expect(card.locator('[data-field-action="navigate"]')).toHaveCount(0);
  await expect(card.locator('[aria-disabled="true"]').first()).toContainText("אין כתובת");
  await expect(card).toContainText("אין טלפון");
});

test("התחלת ביקור מצליחה: שעת שרת על הכרטיס, המודאל נפתח, אפס כתיבה ישירה ל-bookings", async ({ browser }) => {
  const { page, backend } = await setup(browser);
  await seed(page, { patients: [P1], bookings: [base({ id: 3, patient_id: "p-1", scheduled_at: inHours(1), approval_status: "confirmed" })] });
  const card = page.locator("#my-work .pr-card").first();
  await card.getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  await expect(card.locator(".my-work-checkin-time")).toContainText(/התחיל ב-\d{1,2}:\d{2}/);
  await expect(card.getByRole("button", { name: "המשך ביקור" })).toBeVisible();
  expect(backend.requests.filter((r) => r.path === "/staff/bookings/3/check-in" && r.method === "POST")).toHaveLength(1);
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem("__write_log") || "[]"));
  expect(log.filter((w) => w.table === "bookings")).toEqual([]);
  // לחיצה חוזרת: רק פותחת מחדש, בלי קריאה נוספת
  await page.click("#visit-report-modal-cancel");
  await card.getByRole("button", { name: "המשך ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  expect(backend.checkIns).toBe(1);
});

test("כשל check-in: הודעת שגיאה, לא מסומן כהתחיל, אין מודאל, אפשר לנסות שוב", async ({ browser }) => {
  const { page, backend } = await setup(browser);
  await seed(page, { patients: [P1], bookings: [base({ id: 4, patient_id: "p-1", scheduled_at: inHours(1), approval_status: "confirmed" })] });
  backend.checkInFail = "abort";
  const card = page.locator("#my-work .pr-card").first();
  await card.getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(card.locator(".my-work-checkin-error")).toContainText("לא ניתן להתחיל את הביקור");
  await expect(page.locator("#visit-report-modal")).toBeHidden();
  await expect(card.locator(".my-work-checkin-time")).toHaveText("");
  const retry = card.getByRole("button", { name: "נסה שוב" });
  await expect(retry).toBeEnabled();
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db")).bookings.find((b) => b.id === 4));
  expect(db.workflow_status).toBe("assigned");
  backend.checkInFail = null;
  await retry.click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
});

test("הזמנה ממתינה לאישור: תווית, בלי כפתור התחלה; נדחתה לא מוצגת", async ({ browser }) => {
  const { page } = await setup(browser);
  await seed(page, {
    patients: [P1, { ...P1, id: "p-5", full_name: "נדחה כהן" }],
    bookings: [
      base({ id: 5, patient_id: "p-1", scheduled_at: inHours(1), approval_status: "requested" }),
      base({ id: 6, patient_id: "p-5", scheduled_at: inHours(2), approval_status: "rejected" }),
    ],
  });
  const card = page.locator("#my-work .pr-card", { hasText: "דנה כהן" }).first();
  await expect(card).toContainText("ממתין לאישור מנהל");
  await expect(card.getByRole("button", { name: /התחלת ביקור|המשך ביקור/ })).toHaveCount(0);
  await expect(page.locator("#my-work")).not.toContainText("נדחה כהן");
});

test("XSS: שם וכתובת זדוניים מוצגים כטקסט ולא מבוצעים", async ({ browser }) => {
  const { page, errors } = await setup(browser);
  await seed(page, {
    patients: [{ id: "p-x", full_name: '<img src=x onerror="window.__xss=1">', phone: "050", address: '"><script>window.__xss=1</script>' }],
    bookings: [base({ id: 7, patient_id: "p-x", scheduled_at: inHours(1), approval_status: "confirmed" })],
    allergies: [{ patient_id: "p-x", substance: "<b onmouseover=window.__xss=1>x</b>" }],
  });
  const card = page.locator("#my-work .pr-card").first();
  await expect(card).toContainText("<img src=x");
  await expect(card).toContainText("<script>window.__xss=1</script>");
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(card.locator("img, script, b")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("400px: אין גלישה אופקית, כפתורי המודאל נגישים ושדות >=44px", async ({ browser }) => {
  const { page } = await setup(browser, { width: 400, height: 760 });
  await seed(page, {
    patients: [{ ...P1, full_name: "שם ארוך מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד", address: "כתובת-ארוכה-במיוחד-בלי-רווחים-".repeat(6) }],
    bookings: [base({ id: 8, patient_id: "p-1", scheduled_at: inHours(1), approval_status: "confirmed" })],
  });
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(await noOverflow()).toBe(true);
  await page.locator("#my-work .pr-card").first().getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  expect(await noOverflow()).toBe(true);
  await expect(page.locator("#visit-report-modal-save")).toBeInViewport();
  for (const id of ["vr-systolic", "vr-temp", "vr-summary"]) {
    const h = await page.locator("#" + id).evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(44);
  }
  expect(await page.locator("#vr-systolic").getAttribute("inputmode")).toBe("numeric");
});

test("אופליין + כשל באחסון המקומי: שגיאה אמיתית, הטופס נשאר פתוח עם הנתונים, ואין 'נשמר מקומית'", async ({ browser }) => {
  const { page, backend } = await setup(browser);
  await seed(page, { patients: [P1], bookings: [base({ id: 3, patient_id: "p-1", scheduled_at: inHours(1), approval_status: "confirmed" })] });
  await page.locator("#my-work .pr-card").first().getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  await page.fill("#vr-summary", "סיכום סינתטי חשוב");
  backend.completeFail = "abort";                       // אין רשת לשרת
  await page.evaluate(() => {                           // והאחסון המקומי מסרב לכתיבה
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith("visitReportOfflineQueue")) throw new Error("QuotaExceededError");
      return orig.call(this, k, v);
    };
  });
  await page.click("#visit-report-modal-save");
  await expect(page.locator("#visit-report-modal-error")).toContainText("הדוח לא נשמר");
  await expect(page.locator("#visit-report-modal")).toBeVisible();
  await expect(page.locator("#vr-summary")).toHaveValue("סיכום סינתטי חשוב");
  await expect(page.locator("body")).not.toContainText("הדוח נשמר מקומית");
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("visitReportOfflineQueue")))).toBe(false);
});

test("אופליין עם אחסון תקין: 'נשמר מקומית' מוצג רק אחרי שהטיוטה נשמרה בפועל", async ({ browser }) => {
  const { page, backend } = await setup(browser);
  await seed(page, { patients: [P1], bookings: [base({ id: 3, patient_id: "p-1", scheduled_at: inHours(1), approval_status: "confirmed" })] });
  await page.locator("#my-work .pr-card").first().getByRole("button", { name: "התחלת ביקור" }).click();
  await page.fill("#vr-summary", "סיכום סינתטי");
  backend.completeFail = "abort";
  await page.click("#visit-report-modal-save");
  await expect(page.locator("body")).toContainText("הדוח נשמר מקומית");
  const stored = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("visitReportOfflineQueue")).map(([, v]) => JSON.parse(v)));
  expect(stored).toHaveLength(1);
  expect(stored[0][0].treatment_summary).toBe("סיכום סינתטי");
  expect(stored[0][0]._rev).toBe(1);
});
