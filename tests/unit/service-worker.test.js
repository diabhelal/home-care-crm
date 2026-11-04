// Service Worker (public/service-worker.js): המעטפת מכילה כל קובץ מקומי שהדפים טוענים (אחרת העמוד נשבר אופליין או מגיש
// גרסה מעורבת), ובקשות לשרתים אחרים - גם באותו hostname ופורט אחר - לעולם לא נשמרות במטמון. נתונים סינתטיים בלבד.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "../../public");
const SRC = fs.readFileSync(path.join(PUBLIC, "service-worker.js"), "utf8");

function loadSw(location = { hostname: "localhost", origin: "http://localhost:8080" }) {
  const ctx = vm.createContext({ self: { location, addEventListener() {} }, URL, caches: {}, fetch() {}, Response: {} });
  vm.runInContext(SRC + "\n;globalThis.__shell = APP_SHELL; globalThis.__isApi = isApiOrThirdParty;", ctx);
  return { shell: Array.from(ctx.__shell), isApi: ctx.__isApi };   // Array.from: מערך מהקשר ה-vm הוא ממשפחת אב-טיפוס אחרת
}

test("כל קובץ מקומי שדף במעטפת טוען ב-<script src>/<link href> נמצא ב-APP_SHELL", () => {
  const { shell } = loadSw();
  const missing = [];
  for (const page of shell.filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(PUBLIC, page), "utf8");
    for (const m of html.matchAll(/<(?:script[^>]+src|link[^>]+href)=["']([^"']+)["']/g)) {
      const ref = m[1];
      if (/^(https?:)?\/\//.test(ref) || ref.startsWith("data:") || ref.startsWith("#")) continue;
      const clean = ref.split("?")[0].replace(/^\.\//, "");
      if (!fs.existsSync(path.join(PUBLIC, clean))) continue;           // לא קובץ מקומי
      if (!/\.(js|css)$/.test(clean)) continue;                          // אייקונים/manifest נבדקים בנפרד
      if (!shell.includes(clean)) missing.push(`${page} -> ${clean}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("כל פריט ב-APP_SHELL קיים בדיסק", () => {
  const { shell } = loadSw();
  assert.deepEqual(shell.filter((f) => !fs.existsSync(path.join(PUBLIC, f))), []);
});

test("backend/שירות חיזוי באותו hostname ופורט אחר, Supabase ו-CDN לא נשמרים במטמון; האתר עצמו כן", () => {
  const { isApi } = loadSw();
  assert.equal(isApi(new URL("http://localhost:8001/availability")), true);      // היה נשמר ומוגש מיושן אופליין
  assert.equal(isApi(new URL("http://localhost:8000/predict/risk-assessment")), true);
  assert.equal(isApi(new URL("https://abc.supabase.co/rest/v1/patients")), true);
  assert.equal(isApi(new URL("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2")), true);
  assert.equal(isApi(new URL("http://localhost:8080/app.js")), false);
});
