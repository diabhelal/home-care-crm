// בדיקת רגרסיה: "העבודה שלי" (employee.html) לא הייתה מגבילה/מעמדת את שאילתת
// ההזמנות בכלל — עם staff ותיק/ה (הרבה הזמנות היסטוריות) זה יכול לחתוך בשקט ב-
// max_rows=1000 (supabase/config.toml) ולהעלים בדיוק את מה שהכי קריטי: ביקורי
// היום/הבא/בתהליך, כי המיון היה מהישן לחדש. התיקון: שאילתת "חלון פעיל" נפרדת
// (ללא הגבלת עומק היסטוריה) + היסטוריה מלאה בעימוד (lazy, נטענת רק כשפותחים).
//
// לא נוגע ב-DB אמיתי בכלל: מייצר staff/session ו-1500 הזמנות "עתיקות" מזויפות
// ב-window.__fakeSupabaseClient, ומיירט את ה-CDN של supabase-js כדי שזה יהיה ה-
// createClient היחיד שקיים מרגע הטעינה (אחרת ה-CDN האמיתי דורס את המוק ומפנה
// להתחברות אמיתית). רץ מקומית תמיד, בלי פרויקט Supabase ייעודי לבדיקות.
const { test, expect } = require("@playwright/test");

async function gotoEmployeeAppAsStaff(page) {
  await page.route("**/@supabase/supabase-js@2", (route) => {
    route.fulfill({
      contentType: "application/javascript",
      body: "window.supabase = { createClient: () => window.__fakeSupabaseClient };",
    });
  });

  await page.addInitScript(() => {
    window.__bookingsHandler = () => ({
      select: (cols, opts) => {
        if (opts && opts.count === "exact" && opts.head) return { lt: () => Promise.resolve({ count: 0, error: null }) };
        return {
          eq: () => ({ or: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
          lt: () => ({ order: () => ({ range: () => Promise.resolve({ data: [], error: null }) }) }),
        };
      },
    });
    window.__fakeSupabaseClient = {
      auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "fake-staff-user" } } } }) },
      from(table) {
        if (table === "medical_staff") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: 1, full_name: "Test Staff", role: "nurse", is_active: true }, error: null }),
              }),
            }),
          };
        }
        if (table === "bookings") return window.__bookingsHandler();
        if (table === "current_patient_risk") return { select: () => Promise.resolve({ data: [], error: null }) };
        if (table === "tasks") return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
        if (table === "alerts") return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
        throw new Error("unexpected table in test: " + table);
      },
    };
  });

  await page.goto("/employee.html");
  await page.waitForFunction(() => typeof window.loadMyBookings === "function");
}

test("העבודה שלי: ביקורי היום/מחר/בתהליך מוצגים גם עם 1500 הזמנות היסטוריות (לא נחתכים ע\"י מגבלת שורות)", async ({ page }) => {
  await gotoEmployeeAppAsStaff(page);

  const result = await page.evaluate(async () => {
    const now = new Date();
    const todayNoon = new Date(now); todayNoon.setHours(12, 0, 0, 0);
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(10, 0, 0, 0);
    const oldInProgress = new Date(now); oldInProgress.setDate(oldInProgress.getDate() - 5);

    const ancientBookings = [];
    for (let i = 0; i < 1500; i++) {
      const d = new Date(2020, 0, 1); d.setDate(d.getDate() + i);
      ancientBookings.push({
        id: 10000 + i, status: "completed", workflow_status: "assigned", scheduled_at: d.toISOString(),
        visit_purpose: "checkup", patient_id: "ancient-" + i, staff_id: 1,
        patients: { id: "ancient-" + i, full_name: "מטופל ישן " + i, phone: "050" }, visit_reports: [],
      });
    }
    const activeBookings = [
      { id: 1, status: "scheduled", workflow_status: "assigned", scheduled_at: todayNoon.toISOString(), visit_purpose: "checkup", patient_id: "today-patient", staff_id: 1, patients: { id: "today-patient", full_name: "מטופל היום", phone: "050-1" }, visit_reports: [] },
      { id: 2, status: "scheduled", workflow_status: "assigned", scheduled_at: tomorrow.toISOString(), visit_purpose: "checkup", patient_id: "tomorrow-patient", staff_id: 1, patients: { id: "tomorrow-patient", full_name: "מטופל מחר", phone: "050-2" }, visit_reports: [] },
      { id: 3, status: "scheduled", workflow_status: "in_progress", scheduled_at: oldInProgress.toISOString(), visit_purpose: "checkup", patient_id: "inprogress-patient", staff_id: 1, patients: { id: "inprogress-patient", full_name: "מטופל בתהליך", phone: "050-3" }, visit_reports: [] },
    ];

    window.__historyPageCalls = 0;
    window.__bookingsHandler = () => ({
      select: (cols, opts) => {
        if (opts && opts.count === "exact" && opts.head) return { lt: () => Promise.resolve({ count: ancientBookings.length, error: null }) };
        return {
          eq: () => ({ or: () => ({ order: () => ({ limit: () => Promise.resolve({ data: activeBookings, error: null }) }) }) }),
          lt: () => ({
            order: () => ({
              range: (from, to) => {
                window.__historyPageCalls++;
                return Promise.resolve({ data: ancientBookings.slice(from, to + 1), error: null });
              },
            }),
          }),
        };
      },
    });

    await loadMyBookings();
    const bodyText = document.getElementById("my-work").innerText;
    return {
      containsToday: bodyText.includes("מטופל היום"),
      containsTomorrow: bodyText.includes("מטופל מחר"),
      containsInProgress: bodyText.includes("מטופל בתהליך"),
      historyPageCallsBeforeExpand: window.__historyPageCalls,
    };
  });

  expect(result.containsToday).toBe(true);
  expect(result.containsTomorrow).toBe(true);
  expect(result.containsInProgress).toBe(true);
  expect(result.historyPageCallsBeforeExpand).toBe(0); // lazy: לא נטען היסטוריה לפני שפותחים

  await page.click("#my-work-history-details summary");
  await expect(page.locator("#my-work-history .pr-card")).toHaveCount(20);
  await expect(page.locator("#my-work-history-more")).toBeVisible();

  await page.click("#my-work-history-more");
  await expect(page.locator("#my-work-history .pr-card")).toHaveCount(40);
});
