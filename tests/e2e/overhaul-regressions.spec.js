// בדיקות רגרסיה אחרי "design/UX overhaul" (26.9): שני באגים אמיתיים שנמצאו בסריקת QA.
// ממוקדות supabaseClient בלבד (בלי DB חי), כמו שאר הספקים הממוקקים.
const { test, expect } = require("@playwright/test");

// ---- 1. "העבודה שלי" (employee.html): ביקור שהושלם *היום* נעלם לגמרי -------------------
// "החלון הפעיל" מסנן status='scheduled', וההיסטוריה סוננה רק scheduled_at < תחילת היום —
// ביקור שהושלם היום לא נכנס לאף אחד מהשניים, ואי אפשר היה לפתוח אותו שוב לעריכת הדוח.
// התיקון: ההיסטוריה = scheduled_at < היום *או* status <> 'scheduled'.
test("העבודה שלי: שאילתת ההיסטוריה (ושאילתת הספירה) כוללת גם ביקורים שאינם status=scheduled של היום", async ({ page }) => {
  await page.route("**/@supabase/supabase-js@2", (route) => {
    route.fulfill({
      contentType: "application/javascript",
      body: "window.supabase = { createClient: () => window.__fakeSupabaseClient };",
    });
  });
  await page.addInitScript(() => {
    window.__orFilters = [];
    window.__bookingsHandler = () => ({
      select: (cols, opts) => {
        if (opts && opts.count === "exact" && opts.head) {
          return { or: (f) => { window.__orFilters.push(["count", f]); return Promise.resolve({ count: 1, error: null }); } };
        }
        return {
          eq: () => ({ or: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
          or: (f) => ({ order: () => ({ range: () => { window.__orFilters.push(["history", f]); return Promise.resolve({ data: [], error: null }); } }) }),
        };
      },
    });
    window.__fakeSupabaseClient = {
      auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "fake-staff-user" } } } }) },
      from(table) {
        if (table === "medical_staff") {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 1, full_name: "Test Staff", role: "nurse", is_active: true }, error: null }) }) }) };
        }
        if (table === "bookings") return window.__bookingsHandler();
        if (table === "current_patient_risk") return { select: () => Promise.resolve({ data: [], error: null }) };
        if (table === "tasks" || table === "alerts") return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
        throw new Error("unexpected table in test: " + table);
      },
    };
  });
  await page.goto("/employee.html");
  await page.waitForFunction(() => typeof window.loadMyBookings === "function");
  await page.waitForSelector("#my-work-history-details");
  await page.click("#my-work-history-details summary");
  await page.waitForFunction(() => window.__orFilters.some((x) => x[0] === "history"));

  const filters = await page.evaluate(() => window.__orFilters);
  const count = filters.find((x) => x[0] === "count")[1];
  const history = filters.find((x) => x[0] === "history")[1];
  for (const f of [count, history]) {
    expect(f).toMatch(/scheduled_at\.lt\./);
    expect(f).toContain("status.neq.scheduled");
  }
});

// ---- 2. באנר זמינות ה-predictive-service (sticky, z-index:500) כיסה את כפתורי ההדר ----
// .app-header הוא sticky ב-top:0 (z-index:40); הבאנר גם sticky ב-top:0 עם z-index גבוה
// יותר ולכן כיסה את "התנתקות"/"האתר הציבורי" ברגע שגוללים (ובמובייל — את כל ההדר).
// שירות התחזית מקומי ולרוב כבוי, כך שהבאנר מופיע כמעט תמיד.
test("admin: אחרי גלילה באנר 'שירות התחזית לא זמין' לא מכסה את כפתורי ההדר", async ({ page }) => {
  await page.goto("/admin.html");
  await page.evaluate(() => {
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("admin-app").style.display = "flex";
    // מוודא שהבאנר קיים (checkPredictiveServiceHealth יוצר אותו) ושיש מספיק גובה לגלילה
    document.getElementById("predictive-offline-banner") || checkPredictiveServiceHealth();
    const spacer = document.createElement("div");
    spacer.style.height = "3000px";
    document.querySelector("main").appendChild(spacer);
  });
  await page.waitForSelector("#predictive-offline-banner", { state: "attached" });
  await page.evaluate(() => {
    document.getElementById("predictive-offline-banner").style.display = "block";
    window.scrollTo({ top: 1200, behavior: "instant" });
  });

  const result = await page.evaluate(() => {
    const btn = document.getElementById("admin-logout-btn");
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      bannerPosition: getComputedStyle(document.getElementById("predictive-offline-banner")).position,
      headerButtonReachable: hit === btn || btn.contains(hit),
    };
  });
  expect(result.bannerPosition).not.toBe("sticky");
  expect(result.bannerPosition).not.toBe("fixed");
  expect(result.headerButtonReachable).toBe(true);
});
