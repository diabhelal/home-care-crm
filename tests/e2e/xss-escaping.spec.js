// בדיקת רגרסיה: XSS מאוחסן דרך שם/טלפון/כתובת מטופל (נתון חופשי, מוזן ע"י אורח
// לא-מאומת בשלב ההזמנה) המוצג ב-innerHTML במסכי מנהל. נמצא בפועל ב-work-queue.js
// ו-patients.js (תיקון: עטיפה ב-escapeHtml, ר' git history). לא נוגע ב-DB בכלל —
// ממוקד את supabaseClient.from() כדי להזריק payload עוין ולבדוק את שכבת ה-rendering
// בלבד, בלי ליצור נתונים אמיתיים ובלי צורך בהתחברות מנהל אמיתית. רץ מקומית תמיד
// (לא כמו booking.spec.js/visit-report.spec.js שדורשים פרויקט Supabase ייעודי).
const { test, expect } = require("@playwright/test");

const IMG_PAYLOAD = '<img src=x onerror="window.__xss=true">';
const SCRIPT_PAYLOAD = "<script>window.__xss=true</script>";

async function openAdminAppWithoutLogin(page) {
  await page.goto("/admin.html");
  await page.evaluate(() => {
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("admin-app").style.display = "flex";
  });
}

test("תור העבודה (work-queue.js) לא מריץ HTML/סקריפט שהוזרק דרך שם/טלפון מטופל", async ({ page }) => {
  await openAdminAppWithoutLogin(page);

  const result = await page.evaluate(async ({ IMG_PAYLOAD, SCRIPT_PAYLOAD }) => {
    const realFrom = supabaseClient.from.bind(supabaseClient);
    supabaseClient.from = (table) => {
      if (table === "bookings") {
        return {
          select: () => ({
            gte: () => ({ lte: () => ({ order: () => Promise.resolve({
              data: [{
                id: 999001, status: "scheduled", workflow_status: "assigned",
                scheduled_at: new Date().toISOString(), visit_purpose: "checkup",
                patient_id: "fake-patient-id", staff_id: 1,
                patients: { full_name: IMG_PAYLOAD, phone: SCRIPT_PAYLOAD },
                medical_staff: { full_name: "Test Staff", role: "nurse" },
                visit_reports: [],
              }],
              error: null,
            }) }) }),
          }),
        };
      }
      if (table === "current_patient_risk") return { select: () => Promise.resolve({ data: [], error: null }) };
      if (table === "tasks") return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      return realFrom(table);
    };
    await loadBookings();
    supabaseClient.from = realFrom;
    const container = document.getElementById("work-queue");
    return {
      xssFired: window.__xss === true,
      hasRealImgTag: container.querySelector("img[src='x']") !== null,
      hasRealScriptTag: container.querySelector("script") !== null,
      containsEscapedPayload: container.innerHTML.includes("&lt;img src=x"),
    };
  }, { IMG_PAYLOAD, SCRIPT_PAYLOAD });

  expect(result.xssFired).toBe(false);
  expect(result.hasRealImgTag).toBe(false);
  expect(result.hasRealScriptTag).toBe(false);
  expect(result.containsEscapedPayload).toBe(true);
});

test("טבלת המטופלים (patients.js) לא מריצה HTML/סקריפט שהוזרק דרך שם/כתובת מטופל", async ({ page }) => {
  await openAdminAppWithoutLogin(page);

  const result = await page.evaluate(async ({ IMG_PAYLOAD }) => {
    const SVG_PAYLOAD = '"><svg onload="window.__xss=true">';
    const realFrom = supabaseClient.from.bind(supabaseClient);
    supabaseClient.from = (table) => {
      if (table === "patients") {
        return {
          select: () => ({
            order: () => Promise.resolve({
              data: [{
                id: "fake-patient-id", full_name: IMG_PAYLOAD, phone: "050-0000000",
                address: SVG_PAYLOAD, background_conditions: [], smoking_status: null,
              }],
              error: null,
            }),
          }),
        };
      }
      return realFrom(table);
    };
    await loadPatients();
    supabaseClient.from = realFrom;
    const tbody = document.getElementById("patients-tbody");
    return {
      xssFired: window.__xss === true,
      hasRealImgTag: tbody.querySelector("img[src='x']") !== null,
      hasRealSvgTag: tbody.querySelector("svg") !== null,
      containsEscapedPayload: tbody.innerHTML.includes("&lt;img src=x"),
    };
  }, { IMG_PAYLOAD });

  expect(result.xssFired).toBe(false);
  expect(result.hasRealImgTag).toBe(false);
  expect(result.hasRealSvgTag).toBe(false);
  expect(result.containsEscapedPayload).toBe(true);
});
