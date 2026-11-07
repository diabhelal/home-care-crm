// מדידה שנוספה לתיק מחוץ לביקור (proposed/020): זמן מדידה נפרד מזמן הזנה, רשומה חדשה בלבד, בלי נגיעה בדוח חתום,
// הרשאה (מנהל / צוות משויך) נאכפת בשרת, וכשלים מוצגים. fake supabase-js + backend ממוקק; אפס DB חי.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const ADMIN = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };
const STAFF = { user: { id: "staff-user-1", is_anonymous: false, app_metadata: {} } };
const P1 = { id: "p-1", full_name: "דנה כהן", phone: "050-123 4567", address: "הרצל 5, חיפה" };
const NURSE = { id: 1, full_name: "אחות א", role: "nurse", auth_user_id: "staff-user-1", is_active: true };
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const booking = (o) => ({ id: 7, patient_id: "p-1", staff_id: 1, visit_purpose: "checkup", status: "scheduled",
  workflow_status: "assigned", approval_status: "confirmed", visit_address: "הרצל 5, חיפה", scheduled_at: inHours(30), ...o });
const SIGNED = { id: 1, booking_id: 7, patient_id: "p-1", staff_id: 1, author_user_id: "staff-user-1", visit_date: new Date(Date.now() - 86400e3).toISOString(),
  treatment_summary: "ביקור שהושלם", systolic_bp: 140, diastolic_bp: 90, pulse: 80, locked_at: new Date(Date.now() - 86400e3).toISOString() };

async function setup(browser, { as = "admin", bookings = [booking()], visit_reports = [SIGNED], medical_staff = [NURSE], missing = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  const ctl = await installBackendMock(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ bookings, visit_reports, medical_staff, session, P1, missing }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.patients = [P1]; db.bookings = bookings; db.visit_reports = visit_reports; db.medical_staff = medical_staff; db.seq = 500;
    localStorage.setItem("__demo_db", JSON.stringify(db));
    localStorage.setItem("__demo_session", JSON.stringify(session));
    localStorage.setItem("__write_log", "[]");
    localStorage.setItem("__missing_tables", JSON.stringify(missing));
  }, { bookings, visit_reports, medical_staff, session: as === "admin" ? ADMIN : STAFF, P1, missing });
  if (as === "admin") {
    await page.goto(BASE + "/admin.html");
    await expect(page.locator("#work-queue")).toContainText("דנה כהן");
    await page.evaluate(() => openPatientRecord("p-1"));
  } else {
    await page.goto(BASE + "/employee.html");
    await expect(page.locator("#staff-app")).toBeVisible();
    await page.evaluate(() => openPatientRecord("p-1"));
  }
  await page.getByRole("button", { name: "מדדים", exact: true }).click();
  return { context, page, ctl, errors };
}

const local = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

for (const who of ["admin", "staff"]) {
  test(`${who}: מוסיף מדידה בזמן עבר; זמן המדידה וזמן ההזנה נפרדים; הדוח החתום לא משתנה`, async ({ browser }) => {
    const { page, ctl, errors } = await setup(browser, { as: who });
    await expect(page.locator("#pr-measurement-form")).toBeVisible();
    const earlier = new Date(Date.now() - 26 * 3600e3);
    await page.fill("#pr-m-measured-at", local(earlier));
    await page.fill("#pr-m-systolic_bp", "128");
    await page.fill("#pr-m-pulse", "74");
    await page.fill("#pr-m-note", "נמדד בבית אחרי הביקור");
    await page.click("#pr-m-add");
    const row = page.locator("#pr-measurements tbody tr").first();
    await expect(row).toContainText("128");
    await expect(row).toContainText("נמדד בבית אחרי הביקור");
    const db = await page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db")));
    const m = db.patient_measurements[0];
    expect(new Date(m.measured_at).getTime()).toBeLessThan(new Date(m.recorded_at).getTime() - 20 * 3600e3);   // שני זמנים שונים
    expect(m.recorded_by).toBe(who === "admin" ? "admin-user-1" : "staff-user-1");
    expect(ctl.measurements).toHaveLength(1);
    expect(db.visit_reports).toHaveLength(1);
    expect(db.visit_reports[0]).toMatchObject({ id: 1, systolic_bp: 140, pulse: 80, treatment_summary: "ביקור שהושלם" });   // הדוח החתום כמות שהיה
    const writes = await page.evaluate(() => JSON.parse(localStorage.getItem("__write_log") || "[]").map((w) => w.table + ":" + w.op));
    expect(writes.filter((w) => w.startsWith("visit_reports") || w.startsWith("patient_measurements"))).toEqual([]);   // הדפדפן לא כתב ישירות
    expect(errors).toEqual([]);
  });
}

test("מטופל ללא ביקורים: הטופס עדיין זמין", async ({ browser }) => {
  const { page } = await setup(browser, { visit_reports: [], bookings: [booking({ scheduled_at: inHours(30) })] });
  await expect(page.locator("#pr-tab-content")).toContainText("אין עדיין מדידות מביקורים");
  await expect(page.locator("#pr-measurement-form")).toBeVisible();
});

test("צוות לא משויך: השרת דוחה (403), הודעה ברורה ושום דבר לא נשמר", async ({ browser }) => {
  const { page } = await setup(browser, { as: "staff", bookings: [booking({ staff_id: 2 })], medical_staff: [NURSE, { ...NURSE, id: 2, auth_user_id: "other" }] });
  await page.fill("#pr-m-pulse", "70");
  await page.click("#pr-m-add");
  await expect(page.locator("#pr-m-error")).toContainText("רק למטופל המשויך אליך");
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db")));
  expect(db.patient_measurements || []).toHaveLength(0);
});

test("בדיקות צד לקוח: חובה ערך, טווח, ובלי עתיד; ללא בקשה לשרת", async ({ browser }) => {
  const { page, ctl } = await setup(browser);
  await page.click("#pr-m-add");
  await expect(page.locator("#pr-m-error")).toContainText("לפחות מדד אחד");
  await page.fill("#pr-m-pulse", "400");
  await page.click("#pr-m-add");
  await expect(page.locator("#pr-m-error")).toContainText("דופק");
  await page.fill("#pr-m-pulse", "70");
  await page.evaluate(() => { document.getElementById("pr-m-measured-at").removeAttribute("max"); });
  await page.fill("#pr-m-measured-at", local(new Date(Date.now() + 3 * 3600e3)));
  await page.click("#pr-m-add");
  await expect(page.locator("#pr-m-error")).toContainText("בעתיד");
  expect(ctl.measurements).toHaveLength(0);
});

test("כשל רשת: הודעה 'לא נשמרה', הערכים נשארים בטופס, ולא מוצגת כרשומה", async ({ browser }) => {
  const { page, ctl } = await setup(browser);
  ctl.measurementFail = "abort";
  await page.fill("#pr-m-pulse", "70");
  await page.click("#pr-m-add");
  await expect(page.locator("#pr-m-error")).toContainText("המדידה לא נשמרה");
  await expect(page.locator("#pr-m-pulse")).toHaveValue("70");
  await expect(page.locator("#pr-measurements tbody tr")).toHaveCount(0);
  ctl.measurementFail = null;
  await page.click("#pr-m-add");                                               // ניסיון חוזר מצליח
  await expect(page.locator("#pr-measurements tbody tr")).toHaveCount(1);
});

test("רענון אחרי שמירה: המדידה נשארת ברשימה", async ({ browser }) => {
  const { page } = await setup(browser);
  await page.fill("#pr-m-pulse", "66");
  await page.click("#pr-m-add");
  await expect(page.locator("#pr-measurements tbody tr")).toHaveCount(1);
  await page.reload();
  await page.evaluate(() => openPatientRecord("p-1"));
  await page.getByRole("button", { name: "מדדים", exact: true }).click();
  await expect(page.locator("#pr-measurements tbody tr")).toHaveCount(1);
});

test("אין תקרה: 1,250 מדידות של מטופל נטענות כולן (ולא רק 200 האחרונות)", async ({ browser }) => {
  const { page } = await setup(browser);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    const rows = [];
    for (let i = 1; i <= 1250; i++) rows.push({ id: 1000 + i, patient_id: "p-1", booking_id: null, measured_at: new Date(Date.now() - i * 60000).toISOString(), recorded_at: new Date().toISOString(), recorded_by_role: "admin", pulse: 60 + (i % 40) });
    db.patient_measurements = rows;
    localStorage.setItem("__demo_db", JSON.stringify(db));
    prInvalidate("measurements");
  });
  await page.getByRole("button", { name: "מדדים", exact: true }).click();
  await expect(page.locator("#pr-measurements tbody tr")).toHaveCount(1250);
});

test("מיגרציה 020 עדיין לא הוחלה: הסבר במקום טופס שבור", async ({ browser }) => {
  const { page, errors } = await setup(browser, { missing: ["patient_measurements"] });
  await expect(page.locator("#pr-measurements")).toContainText("מיגרציה 020");
  await expect(page.locator("#pr-measurement-form")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("שלוש מדידות באותו ביקור (כולל חזרה על אותו ערך) נשמרות מקושרות לביקור; מדידה עצמאית נשארת בלי קישור", async ({ browser }) => {
  const { page, ctl, errors } = await setup(browser, { as: "admin" });
  await expect(page.locator("#pr-m-booking option")).toHaveCount(2);              // "ללא ביקור" + הביקור #7
  const base = Date.now() - 3 * 3600e3;
  for (const [i, sys] of ["150", "140", "140"].entries()) {
    await page.selectOption("#pr-m-booking", "7");
    await page.fill("#pr-m-measured-at", local(new Date(base + i * 30 * 60e3)));
    await page.fill("#pr-m-systolic_bp", sys);
    await page.click("#pr-m-add");
    await expect(page.locator("#pr-measurements tbody tr")).toHaveCount(i + 1);
  }
  await page.selectOption("#pr-m-booking", "");                                    // עצמאית
  await page.fill("#pr-m-measured-at", local(new Date(base - 5 * 3600e3)));
  await page.fill("#pr-m-pulse", "70");
  await page.click("#pr-m-add");
  await expect(page.locator("#pr-measurements tbody tr")).toHaveCount(4);
  expect(ctl.measurements.map((m) => m.booking_id ?? null)).toEqual([7, 7, 7, null]);
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem("__demo_db")));
  expect(db.patient_measurements.map((m) => m.systolic_bp ?? null)).toEqual([150, 140, 140, null]);   // שום דבר לא נדרס
  expect(db.visit_reports[0]).toMatchObject({ id: 1, systolic_bp: 140 });
  expect(errors).toEqual([]);
});
