// כפתור "תחזית מגמת מדדים" (admin.html, מודאל דוח ביקור): מרוץ בין מטופלים, כשל שירות שלא נבלע,
// כשל חלקי, לחיצה כפולה, תיוג "הדגמה" ו-escape. fake supabase-js + backend + שירות תחזית ממוקקים, אפס DB חי.
const { test, expect } = require("@playwright/test");
const { fakeSupabaseSource } = require("./helpers/fake-supabase");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const PREDICT = "http://predict.test:8000";
const ADMIN = { user: { id: "admin-user-1", is_anonymous: false, app_metadata: { is_admin: true } } };
const PA = { id: "p-1", full_name: "אלף כהן", phone: "050-111 1111", address: "הרצל 5, חיפה" };
const PB = { id: "p-2", full_name: "בית לוי", phone: "050-222 2222", address: "הנשיא 9, חיפה" };
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const bk = (o) => ({ status: "scheduled", workflow_status: "assigned", approval_status: "confirmed", staff_id: 1, visit_purpose: "checkup", ...o });
const rep = (id, pid, daysAgo, v) => ({ id, patient_id: pid, booking_id: 900 + id, visit_date: new Date(Date.now() - daysAgo * 86400000).toISOString(), ...v });
const ok = (value, extra = {}) => ({ status: 200, json: { model_available: true, predicted_value: value, method: "linear", direction: null, confidence_interval: null, ...extra } });

// patient A: pulse 100-102 (+ temperature when withTemp); patient B: pulse 60-62
function reports(withTemp) {
  return [
    rep(1, "p-1", 3, { pulse: 100, ...(withTemp ? { temperature: 36.5 } : {}) }),
    rep(2, "p-1", 2, { pulse: 101, ...(withTemp ? { temperature: 36.6 } : {}) }),
    rep(3, "p-1", 1, { pulse: 102, ...(withTemp ? { temperature: 36.7 } : {}) }),
    rep(4, "p-2", 3, { pulse: 60 }), rep(5, "p-2", 2, { pulse: 61 }), rep(6, "p-2", 1, { pulse: 62 }),
  ];
}

// handler(body) -> { status, json } | { abort:true }; אפשר להחזיר Promise כדי להחזיק תשובה
async function setup(browser, { handler, withTemp = false, rawReports = null }) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@*", (r) => r.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
  // config.js מכריח את כתובת שירות התחזית לכתובת שאינה localhost, אחרת שמירת האתר המאורח מחזירה 503 סינתטי
  await installBackendMock(context, { extraConfig: `window.PREDICTIVE_SERVICE_URL = "${PREDICT}";` });
  const calls = [];
  await context.route(PREDICT + "/**", async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "Content-Type", "access-control-allow-methods": "GET, POST, OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (!req.url().includes("/predict/vitals-forecast")) return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: "{}" });
    const body = req.postDataJSON();
    calls.push({ vital: body.vital, firstValue: body.points[0].value });
    const out = await handler(body);
    if (out && out.abort) return route.abort("connectionrefused");
    return route.fulfill({ status: out.status, headers: cors, contentType: "application/json", body: JSON.stringify(out.json) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/index.html");
  await page.evaluate(({ ADMIN, PA, PB, bks, reps }) => {
    const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
    db.patients = [PA, PB]; db.bookings = bks; db.visit_reports = reps; db.seq = 500;
    localStorage.setItem("__demo_db", JSON.stringify(db));
    localStorage.setItem("__demo_session", JSON.stringify(ADMIN));
    localStorage.setItem("__write_log", "[]");
  }, { ADMIN, PA, PB,
    bks: [bk({ id: 7, patient_id: "p-1", scheduled_at: inHours(1) }), bk({ id: 8, patient_id: "p-2", scheduled_at: inHours(2) })],
    reps: rawReports || reports(withTemp) });
  await page.goto(BASE + "/admin.html");
  await expect(page.locator("#work-queue")).toContainText("אלף כהן");
  await expect(page.locator("#work-queue")).toContainText("בית לוי");
  return { context, page, calls, errors };
}
const openFor = async (page, name) => {
  await page.locator("#work-queue tbody tr", { hasText: name }).getByRole("button", { name: "התחלת ביקור" }).click();
  await expect(page.locator("#visit-report-modal")).toBeVisible();
};
const modalPatient = (page) => page.evaluate(() => document.getElementById("visit-report-modal").dataset.patientId);

test("תחזית: תשובה של מטופל א' שמגיעה אחרי החלפת המודאל למטופל ב' לא מוצגת", async ({ browser }) => {
  let release; const gate = new Promise((res) => (release = res));
  const { page, calls, errors } = await setup(browser, {
    handler: async (body) => { const isA = body.points[0].value >= 100; if (isA) await gate; return ok(isA ? 111 : 222); },
  });
  await openFor(page, "אלף כהן");
  await page.click("#vr-check-trend-btn");
  await expect.poll(() => calls.length).toBe(1); // הבקשה של א' בדרך והתשובה מוחזקת
  await page.click("#visit-report-modal-cancel");
  await openFor(page, "בית לוי");
  expect(await modalPatient(page)).toBe("p-2");
  await expect(page.locator("#vr-trend-result")).toHaveText("");
  release(); // התשובה של א' מגיעה עכשיו, בזמן שהמודאל מציג את ב'
  await expect(page.locator("#vr-check-trend-btn")).toBeEnabled();
  await page.waitForTimeout(400);
  await expect(page.locator("#vr-trend-result")).toHaveText("");
  expect(await page.locator("#vr-check-trend-btn").getAttribute("aria-busy")).toBeNull();
  // והכפתור של ב' עובד כרגיל
  await page.click("#vr-check-trend-btn");
  await expect(page.locator("#vr-trend-result")).toContainText("222");
  await expect(page.locator("#vr-trend-result")).not.toContainText("111");
  expect(errors).toEqual([]);
});

test("תחזית: מודאל שנסגר באמצע חישוב לא מקבל תוצאה, והכפתור משתחרר", async ({ browser }) => {
  let release; const gate = new Promise((res) => (release = res));
  const { page, calls } = await setup(browser, { handler: async () => { await gate; return ok(111); } });
  await openFor(page, "אלף כהן");
  await page.click("#vr-check-trend-btn");
  await expect.poll(() => calls.length).toBe(1);
  await page.click("#visit-report-modal-cancel");
  release();
  await page.waitForTimeout(400);
  await expect(page.locator("#vr-trend-result")).toHaveText("");
  await expect(page.locator("#vr-check-trend-btn")).toBeEnabled();
});

test("תחזית: כשל שירות (503) בכל המדדים מוצג כשגיאה ברורה ולא כ'אין מספיק היסטוריה'", async ({ browser }) => {
  const { page } = await setup(browser, { handler: async () => ({ status: 503, json: { detail: "down" } }) });
  await openFor(page, "אלף כהן");
  await page.click("#vr-check-trend-btn");
  const result = page.locator("#vr-trend-result");
  await expect(result).toContainText("לא ניתן היה לחשב");
  await expect(result).not.toContainText("אין מספיק היסטוריית");
  await expect(result.locator("[role=alert]")).toHaveCount(1);
  await expect(page.locator("#vr-check-trend-btn")).toBeEnabled();
});

test("תחזית: model_available=false בכל המדדים מוצג כשגיאה עם הסיבה, לא כמעט נתונים", async ({ browser }) => {
  const { page } = await setup(browser, { handler: async () => ({ status: 200, json: { model_available: false, predicted_value: null, reason: "סיבה מהשרת" } }) });
  await openFor(page, "אלף כהן");
  await page.click("#vr-check-trend-btn");
  await expect(page.locator("#vr-trend-result")).toContainText("לא ניתן היה לחשב");
  await expect(page.locator("#vr-trend-result")).toContainText("סיבה מהשרת");
  await expect(page.locator("#vr-trend-result")).not.toContainText("אין מספיק היסטוריית");
});

test("תחזית: כשל חלקי מציג את המדד שהצליח ושורה מפורשת 'לא חושב' למדד שנכשל", async ({ browser }) => {
  const { page } = await setup(browser, {
    withTemp: true,
    handler: async (body) => (body.vital === "temperature" ? { status: 500, json: { detail: "boom" } } : ok(111)),
  });
  await openFor(page, "אלף כהן");
  await page.click("#vr-check-trend-btn");
  const result = page.locator("#vr-trend-result");
  await expect(result.locator("table")).toContainText("דופק");
  await expect(result.locator("table")).toContainText("111");
  await expect(result).toContainText("לא חושבו");
  await expect(result).toContainText("חום גוף");
});

test("תחזית: לחיצה כפולה באותו רגע שולחת קריאה אחת בלבד לכל מדד", async ({ browser }) => {
  const { page, calls } = await setup(browser, { handler: async () => ok(111) });
  await openFor(page, "אלף כהן");
  await page.evaluate(() => { const b = document.getElementById("vr-check-trend-btn"); b.click(); b.click(); });
  await expect(page.locator("#vr-trend-result")).toContainText("111");
  expect(calls.length).toBe(1); // מדד אחד עם היסטוריה (דופק)
});

test("תחזית: פחות מ-3 דוחות מציג הודעת איסוף נתונים ואינו קורא לשירות", async ({ browser }) => {
  const { page, calls } = await setup(browser, {
    handler: async () => ok(111),
    rawReports: [rep(1, "p-1", 2, { pulse: 100 }), rep(2, "p-1", 1, { pulse: 101 })],
  });
  await openFor(page, "אלף כהן");
  await page.click("#vr-check-trend-btn");
  await expect(page.locator("#vr-trend-result")).toContainText("שלב איסוף נתונים");
  expect(calls.length).toBe(0);
});

test("תחזית: התוצאה מסומנת 'הדגמה / תמיכה בהחלטה', עם מספר המדידות והמדידה האחרונה, וערכי שרת עוברים escape", async ({ browser }) => {
  const { page, errors } = await setup(browser, {
    handler: async () => ok(111, { direction: "<img src=x onerror=window.__xss=1>" }),
  });
  await openFor(page, "אלף כהן");
  await page.click("#vr-check-trend-btn");
  const result = page.locator("#vr-trend-result");
  await expect(result).toContainText("הדגמה");
  await expect(result).toContainText("אינו אבחנה");
  await expect(result.locator("table")).toContainText("3 מדידות");
  await expect(result.locator("table")).toContainText("אחרונה");
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(result.locator("img")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("תחזית: שירות שלא עונה בזמן נקטע בהודעה ברורה והכפתור חוזר לפעול", async ({ browser }) => {
  test.setTimeout(60000);
  const { page } = await setup(browser, { handler: () => new Promise(() => {}) }); // לעולם לא עונה
  await page.addInitScript(() => { window.__TREND_TIMEOUT_MS = 1500; });
  await page.reload();
  await expect(page.locator("#work-queue")).toContainText("אלף כהן");
  await openFor(page, "אלף כהן");
  await page.click("#vr-check-trend-btn");
  await expect(page.locator("#vr-trend-result")).toContainText("לא הגיב בזמן", { timeout: 15000 });
  await expect(page.locator("#vr-check-trend-btn")).toBeEnabled();
});

test("תחזית: הודעת 'איסוף נתונים' של מטופל א' לא נכתבת אם המודאל עבר למטופל ב' בזמן ספירת הדוחות", async ({ browser }) => {
  const { page, calls } = await setup(browser, {
    handler: async () => ok(111),
    // לא-א' יש רק 2 דוחות (פחות מ-3), ולכן ה-listener ב-app.js כותב הודעת איסוף נתונים
    rawReports: [rep(1, "p-1", 2, { pulse: 100 }), rep(2, "p-1", 1, { pulse: 101 }),
      rep(4, "p-2", 3, { pulse: 60 }), rep(5, "p-2", 2, { pulse: 61 }), rep(6, "p-2", 1, { pulse: 62 })],
  });
  await openFor(page, "אלף כהן");
  // מחזיקים את שאילתת הספירה של ה-listener (select("id")) עד שנשחרר אותה
  await page.evaluate(() => {
    let release; window.__gate = new Promise((r) => (release = r)); window.__release = release;
    const orig = supabaseClient.from.bind(supabaseClient);
    supabaseClient.from = (t) => {
      const b = orig(t);
      if (t !== "visit_reports") return b;
      const sel = b.select.bind(b);
      b.select = (cols, ...rest) => {
        const q = sel(cols, ...rest);
        if (cols === "id") { const eq = q.eq.bind(q); q.eq = (...a) => { const p = eq(...a); return window.__gate.then(() => p); }; }
        return q;
      };
      return b;
    };
  });
  await page.click("#vr-check-trend-btn");
  await page.click("#visit-report-modal-cancel");
  await openFor(page, "בית לוי");
  expect(await modalPatient(page)).toBe("p-2");
  await page.evaluate(() => window.__release());
  await page.waitForTimeout(400);
  await expect(page.locator("#vr-trend-result")).toHaveText("");
  expect(calls.length).toBe(0);
});

test("תחזית: מדד עם מדידה אחת בלבד מוצג כ'לא חושב' ולא נעלם בשקט", async ({ browser }) => {
  const { page } = await setup(browser, {
    handler: async () => ok(111),
    rawReports: [rep(1, "p-1", 3, { pulse: 100 }), rep(2, "p-1", 2, { pulse: 101, temperature: 36.6 }), rep(3, "p-1", 1, { pulse: 102 })],
  });
  await openFor(page, "אלף כהן");
  await page.click("#vr-check-trend-btn");
  const result = page.locator("#vr-trend-result");
  await expect(result.locator("table")).toContainText("דופק");
  await expect(result).toContainText("מדידה אחת בלבד");
  await expect(result).toContainText("חום גוף");
});

test("תחזית: ערך חסר מהשירות (predicted_value=null) אינו מוצג כ'null' אלא ככשל מפורש", async ({ browser }) => {
  const { page } = await setup(browser, { handler: async () => ok(null) });
  await openFor(page, "אלף כהן");
  await page.click("#vr-check-trend-btn");
  const result = page.locator("#vr-trend-result");
  await expect(result).toContainText("לא ניתן היה לחשב");
  await expect(result).toContainText("השירות לא החזיר ערך");
  await expect(result).not.toContainText("null");
});

test("תחזית: המדידה האחרונה מוצגת עם שנה וגיל בימים", async ({ browser }) => {
  const { page } = await setup(browser, { handler: async () => ok(111) });
  await openFor(page, "אלף כהן");
  await page.click("#vr-check-trend-btn");
  const cell = page.locator("#vr-trend-result table tbody td").last();
  await expect(cell).toContainText(String(new Date().getFullYear()));
  await expect(cell).toContainText("לפני יום");
});
