// תצורת Playwright ל-E2E. מריץ שרת סטטי מקומי (python3 -m http.server) מתוך public/
// — לא build step לאפליקציה עצמה, רק שרת קבצים לצורך הבדיקה. מצפה שמשתני הסביבה
// SUPABASE_URL/SUPABASE_ANON_KEY (בפרויקט Supabase ייעודי לבדיקות, לא production!)
// יהיו מוגדרים אם רוצים להריץ בפועל — ר' tests/e2e/README.md.
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8080",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "python3 -m http.server 8080 --directory public",
    url: "http://127.0.0.1:8080/index.html",
    reuseExistingServer: !process.env.CI,
    cwd: __dirname,
  },
});
