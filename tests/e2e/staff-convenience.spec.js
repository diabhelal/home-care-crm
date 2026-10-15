// נוחות הזמנה למטופל, בלי DB חי: (1) שורת "הזמינות הקרובה" בכרטיסי staff.html,
// (2) סינון לפי תפקיד ויום, (3) כפתור "הזמן שוב" ב-my-bookings.html שמעביר ל-booking.html
// עם איש הצוות (selected_staff ב-sessionStorage, כמו staff.html) והמטרה מסומנת מראש.
// supabase-js מוחלף ב-fake מינימלי; אפס בקשות ל-Supabase.
const { test, expect } = require("@playwright/test");

const BASE = "http://demo.localhost:8080";

function fakeSource() {
  return `(${function () {
    const mk = (id, name, role) => ({
      id, full_name: name, role, specialization: "", is_active: true,
      available_weekdays: [0, 1, 2, 3, 4, 5, 6], work_start_time: "08:00:00", work_end_time: "16:00:00",
      slot_duration_minutes: 60,
    });
    // "רופא נסתר" קיים ב-DB אך תפקידו לא מוצע (SERVICE_CONFIG) — חייב להיות מסונן בצד הלקוח
    const staff = [mk(1, "אחות תפוסה", "nurse"), mk(2, "אח פנוי", "nurse"), mk(3, "רופא נסתר", "doctor")];
    const past = new Date(); past.setDate(past.getDate() - 5); past.setHours(10, 0, 0, 0);
    const bookings = [{
      id: 9, patient_id: "guest-1", staff_id: 1, status: "completed", visit_purpose: "wound_care",
      scheduled_at: past.toISOString(), notes: null, visit_reports: [], medical_staff: staff[0],
    }];
    const rows = { medical_staff: staff, bookings };
    function builder(name) {
      const api = {
        select() { return api; }, order() { return api; }, eq() { return api; }, limit() { return api; },
        then(res, rej) { return Promise.resolve({ data: rows[name] || [], error: null }).then(res, rej); },
      };
      return api;
    }
    const user = { id: "guest-1", is_anonymous: true, app_metadata: {} };
    const client = {
      from: builder,
      rpc(fn, args) {
        if (fn !== "taken_slots") return Promise.resolve({ data: [], error: null });
        const data = [];
        if (args.p_staff_id === 1) {
          // תופס את כל השעות של היום ושל מחר
          for (let d = 0; d < 2; d++) for (let h = 8; h < 16; h++) {
            const t = new Date(); t.setHours(h, 0, 0, 0); t.setDate(t.getDate() + d);
            data.push({ scheduled_at: t.toISOString() });
          }
        }
        return Promise.resolve({ data, error: null });
      },
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      auth: {
        getSession: () => Promise.resolve({ data: { session: { user } } }),
        getUser: () => Promise.resolve({ data: { user } }),
        signInAnonymously: () => Promise.resolve({ data: { user }, error: null }),
        signOut: () => Promise.resolve({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    };
    window.supabase = { createClient: () => client };
  }})();`;
}

async function newPage(browser) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/@supabase/supabase-js@2", (r) => r.fulfill({ contentType: "application/javascript", body: fakeSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { page, errors, context };
}

test("staff.html: שורת זמינות קרובה + סינון תפקיד ויום", async ({ browser }) => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(BASE + "/staff.html");
  const cards = page.locator(".staff-card");
  await expect(cards).toHaveCount(2);

  const busy = cards.filter({ hasText: "אחות תפוסה" });
  const free = cards.filter({ hasText: "אח פנוי" });
  await expect(busy.locator(".next-avail")).toContainText("הזמינות הקרובה:");
  await expect(busy.locator(".next-avail")).not.toContainText("היום");
  await expect(busy.locator(".next-avail")).not.toContainText("מחר");
  await expect(free.locator(".next-avail")).toContainText("הזמינות הקרובה:");

  // היום תפוס לגמרי אצל האחות -> לא מופיעה כשמסננים "היום"
  await page.selectOption("#day-select", "0");
  await expect(page.locator(".staff-card", { hasText: "אחות תפוסה" })).toHaveCount(0);
  await page.selectOption("#day-select", "");
  await expect(cards).toHaveCount(2);

  // תפקיד יחיד מוצע: אין סינון תפקיד, ואין שום אזכור של רופא/פיזיותרפיה
  await expect(page.locator("#role-field")).toBeHidden();
  await expect(page.locator("body")).not.toContainText("רופא");
  await expect(page.locator("body")).not.toContainText("פיזיותרפ");
  expect(errors).toEqual([]);
  await context.close();
});

test("my-bookings.html: 'הזמן שוב' מעביר ל-booking.html עם אותו איש צוות ומטרה", async ({ browser }) => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(BASE + "/my-bookings.html");
  const btn = page.getByRole("button", { name: "הזמן שוב" });
  await expect(btn).toBeVisible();
  await btn.click();
  await page.waitForURL(/booking\.html/);
  await expect(page.locator("#staff-name")).toContainText("אחות תפוסה");
  await expect(page.locator("#purpose-chips .chip.selected")).toHaveText("טיפול בפצע");
  expect(errors).toEqual([]);
  await context.close();
});

test("index.html + booking.html: רק אחיות/אחים ושירותים מוצעים, בלי רופא/פיזיותרפיה", async ({ browser }) => {
  const { page, errors, context } = await newPage(browser);
  await page.goto(BASE + "/index.html");
  await expect(page.locator("#services-grid .service-card")).toHaveCount(4);
  await expect(page.locator("#services-grid")).toContainText("בדיקת דם");
  await expect(page.locator("body")).not.toContainText("רופא");
  await expect(page.locator("body")).not.toContainText("פיזיותרפ");

  await page.goto(BASE + "/staff.html");
  await page.locator(".staff-card").first().click();
  await page.waitForURL(/booking\.html/);
  await expect(page.locator("#purpose-chips .chip")).toHaveCount(5);
  await expect(page.locator("body")).not.toContainText("רופא");
  await expect(page.locator("body")).not.toContainText("פיזיותרפ");
  expect(errors).toEqual([]);
  await context.close();
});
