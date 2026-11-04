// REPRODUCTION ONLY (scratchpad). Synthetic data, mocked supabase; calls the real app.js queue functions in a page.
const R = "/Users/helaldiab/home-care-crm";
const { test, expect } = require(R + "/node_modules/@playwright/test");
const { fakeSupabaseSource } = require(R + "/tests/e2e/helpers/fake-supabase");
const { installBackendMock } = require(R + "/tests/e2e/helpers/backend-mock");
const DRAFT = { booking_id: 7, patient_id: "p-1", staff_id: 1, treatment_summary: "סינתטי-סיכום-טיפול", pulse: 80,
  patient_signature_data: "data:image/png;base64,SYNTHETICSIGNATURE", _markCompleted: true };

async function open(browser) {
  const context = await browser.newContext({ serviceWorkers: "block", locale: "he-IL" });
  await context.route("**/@supabase/supabase-js@*", (r) => r.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
  await installBackendMock(context);
  const page = await context.newPage();
  await page.goto("http://demo.localhost:8080/index.html");
  await page.evaluate(() => localStorage.clear());
  return page;
}

test("D1 טיוטה לא אמורה להישמר בטקסט גלוי (מדדים, סיכום וחתימת מטופל)", async ({ browser }) => {
  const page = await open(browser);
  const raw = await page.evaluate((d) => { setOfflineQueueOwner("user-a"); queueVisitReportDraft(d); return localStorage.getItem("visitReportOfflineQueue:user-a"); }, DRAFT);
  console.log("D1 raw contains summary:", raw.includes("סינתטי-סיכום-טיפול"), "| contains signature data-url:", raw.includes("data:image/png;base64"), "| contains patient_id:", raw.includes("p-1"));
  expect(raw).not.toContain("סינתטי-סיכום-טיפול");
  expect(raw).not.toContain("data:image/png;base64");
});

test("D2 התנתקות: הטיוטה נשארת במכשיר, ומשתמש אחר באותו דפדפן יכול לקרוא אותה ישירות מה-localStorage", async ({ browser }) => {
  const page = await open(browser);
  const out = await page.evaluate((d) => {
    setOfflineQueueOwner("user-a"); queueVisitReportDraft(d);
    setOfflineQueueOwner(null); // מה ש-onAuthStateChange עושה בהתנתקות
    setOfflineQueueOwner("user-b");
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("visitReportOfflineQueue"));
    const leaked = keys.filter((k) => localStorage.getItem(k).includes("סינתטי-סיכום-טיפול"));
    return { keys, leaked, bCount: getQueuedDraftCount() };
  }, DRAFT);
  console.log("D2 keys after logout+login of user-b:", JSON.stringify(out));
  expect(out.leaked).toEqual([]); // הנדרש: אחרי התנתקות הנתונים הקליניים של user-a אינם קריאים בטקסט גלוי
});

test("D3 כתיבה בזמן שאין בעלים לתור (owner=null) נופלת למפתח המשותף", async ({ browser }) => {
  const page = await open(browser);
  const out = await page.evaluate((d) => {
    setOfflineQueueOwner(null);
    let threw = null; try { queueVisitReportDraft(d); } catch (e) { threw = String(e && e.name); }
    const shared = localStorage.getItem("visitReportOfflineQueue");
    setOfflineQueueOwner("user-b"); // משתמש אחר מתחבר
    return { threw, sharedHasDraft: !!(shared && shared.includes("סינתטי-סיכום-טיפול")), legacyQueueSeenByB: getOfflineQueue("visitReportOfflineQueue").length };
  }, DRAFT);
  console.log("D3:", JSON.stringify(out));
  expect(out.threw).not.toBeNull(); // הנדרש: סירוב לכתוב כשאין בעלים
});

test("D4 תשובת 200 בלי דוח שנשמר מוחקת את הטיוטה מהמכשיר", async ({ browser }) => {
  const page = await open(browser);
  const out = await page.evaluate(async (d) => {
    setOfflineQueueOwner("user-a"); queueVisitReportDraft({ ...d, _markCompleted: true });
    window.backendFetch = async () => ({}); // השרת "מאשר" 200 עם גוף ריק, בלי report.id
    await flushOfflineQueueDrafts();
    return { remaining: getOfflineQueue(offlineQueueKey()).length };
  }, DRAFT);
  console.log("D4 remaining drafts after a bare-200 response:", JSON.stringify(out));
  expect(out.remaining).toBe(1); // הנדרש: טיוטה נשמרת עד שהשרת מחזיר מזהה דוח שמתאים
});
