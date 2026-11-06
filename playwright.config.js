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
  // Locally, parallel workers make 3-5 random mocked specs fail on every run (they pass 96/96 serially, verified twice
  // on 2026-11-07); CI runs on a small runner with its default and is stable. Serial locally = deterministic.
  workers: process.env.CI ? undefined : 1,
  use: {
    baseURL: "http://127.0.0.1:8080",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "python3 -m http.server 8080 --directory public",
    url: "http://127.0.0.1:8080/index.html",
    // לא משתמשים בשרת קיים בשקט: שרת ישן על 8080 (למשל מענף/worktree אחר) הגיש קוד לא נכון
    // וגרם לכשלי שווא. אם הפורט תפוס, Playwright נכשל בקול רם. להרצה מכוונת מול שרת קיים: PW_REUSE_SERVER=1.
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    cwd: __dirname,
  },
});
