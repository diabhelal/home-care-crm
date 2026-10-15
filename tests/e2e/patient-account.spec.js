// חשבון אופציונלי (אימייל+סיסמה), מספר הזמנה ושלבי סטטוס — fake supabase-js stateful, בלי DB חי.
// כל ה-Supabase (auth + REST + RPC) מוחלף ב-fake client ב-stateful שנשמר ב-localStorage
// (כדי לשרוד ניווטים בין עמודים), ונטען במקום ה-CDN של supabase-js. אפס בקשות רשת ל-Supabase.
// מוודא גם: באנר הדגמה, אפס שגיאות קונסול, ואפס בקשות ל-localhost:8000 (שירות התחזית).
// צילומי מסך של כל שלב נשמרים ב-docs/demo-proof/.
//
// הפעלה מתחת ל-hostname "demo.localhost" (כרום מפנה *.localhost ל-loopback) כדי לדמות פריסה
// מאורחת: isLocalHost() ב-app.js false, אז בדיקת הזמינות של שירות התחזית מדולגת כמו בפרודקשן.
const path = require("path");
const fs = require("fs");
const { test, expect } = require("@playwright/test");
const { installBackendMock } = require("./helpers/backend-mock");

const BASE = "http://demo.localhost:8080";
const SHOTS = path.join(__dirname, "..", "..", "docs", "demo-proof");

// ---- fake supabase-js (מוזרק כסקריפט; רץ בדפדפן) ----
function fakeSupabaseSource() {
  return `(${function () {
    const KEY = "__demo_db", SKEY = "__demo_session";
    const load = () => {
      try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
      return {
        seq: 100,
        medical_staff: [{
          id: 1, full_name: "אחות הדגמה", role: "nurse", specialization: "טיפול בפצעים",
          phone: "050-0000000", is_active: true, auth_user_id: "staff-user-1",
          available_weekdays: [0, 1, 2, 3, 4, 5, 6], work_start_time: "08:00:00", work_end_time: "16:00:00",
          slot_duration_minutes: 60,
        }],
      };
    };
    const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
    const session = () => { try { return JSON.parse(localStorage.getItem(SKEY) || "null"); } catch (e) { return null; } };
    const setSession = (s) => (s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY));
    const table = (db, name) => (db[name] = db[name] || []);
    const cmp = (a, op, b) => {
      if (op === "eq") return String(a) === String(b);
      if (op === "neq") return String(a) !== String(b);
      if (op === "gte") return a >= b;
      if (op === "lte") return a <= b;
      if (op === "lt") return a < b;
      if (op === "gt") return a > b;
      if (op === "ilike") return String(a ?? "").toLowerCase().includes(String(b).replace(/%/g, "").toLowerCase());
      return true;
    };
    const parseOr = (s) => s.split(",").map((part) => {
      const i = part.indexOf("."), j = part.indexOf(".", i + 1);
      return { f: part.slice(0, i), op: part.slice(i + 1, j), v: part.slice(j + 1) };
    });

    function builder(name) {
      const q = { name, op: "select", filters: [], order: null, limit: null, range: null, single: false, maybe: false, cols: "*", opts: {}, payload: null, conflict: null };
      const api = {
        select(cols, opts) { q.cols = cols || "*"; q.opts = opts || {}; return api; },
        insert(p) { q.op = "insert"; q.payload = p; return api; },
        update(p) { q.op = "update"; q.payload = p; return api; },
        upsert(p, o) { q.op = "upsert"; q.payload = p; q.conflict = (o && o.onConflict) || "id"; return api; },
        delete() { q.op = "delete"; return api; },
        eq(f, v) { q.filters.push((r) => cmp(r[f], "eq", v)); return api; },
        neq(f, v) { q.filters.push((r) => cmp(r[f], "neq", v)); return api; },
        gte(f, v) { q.filters.push((r) => cmp(r[f], "gte", v)); return api; },
        lte(f, v) { q.filters.push((r) => cmp(r[f], "lte", v)); return api; },
        in(f, arr) { q.filters.push((r) => arr.includes(r[f])); return api; },
        or(s) { const cs = parseOr(s); q.filters.push((r) => cs.some((c) => cmp(r[c.f], c.op, c.v))); return api; },
        order(f, o) { q.order = { f, asc: !o || o.ascending !== false }; return api; },
        limit(n) { q.limit = n; return api; },
        range(a, b) { q.range = [a, b]; return api; },
        single() { q.single = true; return api; },
        maybeSingle() { q.maybe = true; return api; },
        then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
      };
      function join(db, rows) {
        return rows.map((r) => {
          const o = { ...r };
          if (name === "bookings") {
            if (/patients\(/.test(q.cols)) o.patients = table(db, "patients").find((p) => p.id === r.patient_id) || null;
            if (/medical_staff\(/.test(q.cols)) o.medical_staff = table(db, "medical_staff").find((s) => s.id === r.staff_id) || null;
            if (/visit_reports\(/.test(q.cols)) o.visit_reports = table(db, "visit_reports").filter((v) => v.booking_id === r.id);
          }
          return o;
        });
      }
      function run() {
        const db = load();
        const sess = session();
        const rows = table(db, name);
        const matching = () => rows.filter((r) => q.filters.every((f) => f(r)));
        const finish = (data) => {
          if (q.single || q.maybe) {
            const arr = Array.isArray(data) ? data : [data];
            if (!arr.length || arr[0] == null) return q.single ? { data: null, error: { message: "no rows", code: "PGRST116" } } : { data: null, error: null };
            return { data: arr[0], error: null };
          }
          return { data, error: null };
        };
        if (q.op === "insert") {
          const list = Array.isArray(q.payload) ? q.payload : [q.payload];
          const out = [];
          for (const p of list) {
            const row = { ...p };
            if (name === "bookings") {
              if (rows.some((b) => b.staff_id === row.staff_id && b.scheduled_at === row.scheduled_at && b.status !== "cancelled"))
                return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
              row.status = "scheduled"; row.workflow_status = "unassigned";
            }
            if (row.id === undefined && name !== "patients") row.id = ++db.seq;
            row.created_at = new Date().toISOString();
            rows.push(row); out.push(row);
          }
          save(db);
          return finish(out);
        }
        if (q.op === "upsert") {
          const list = Array.isArray(q.payload) ? q.payload : [q.payload];
          const out = [];
          for (const p of list) {
            const existing = rows.find((r) => r[q.conflict] === p[q.conflict]);
            if (existing) { Object.assign(existing, p); out.push(existing); }
            else { const row = { ...p }; if (row.id === undefined) row.id = ++db.seq; row.created_at = new Date().toISOString(); rows.push(row); out.push(row); }
          }
          save(db);
          return finish(out);
        }
        if (q.op === "update") {
          const hit = matching(); hit.forEach((r) => Object.assign(r, q.payload)); save(db);
          return finish(hit);
        }
        if (q.op === "delete") {
          db[name] = rows.filter((r) => !q.filters.every((f) => f(r))); save(db);
          return { data: null, error: null };
        }
        // select — RLS מדומה: מטופל אנונימי רואה רק הזמנות/דוחות שלו
        let list = matching();
        if (sess && /^(guest|user)-/.test(String(sess.user.id))) {
          if (name === "bookings") list = list.filter((b) => b.patient_id === sess.user.id);
          if (name === "patients") list = list.filter((p) => p.id === sess.user.id);
        }
        if (q.order) list.sort((a, b) => (a[q.order.f] > b[q.order.f] ? 1 : a[q.order.f] < b[q.order.f] ? -1 : 0) * (q.order.asc ? 1 : -1));
        if (q.opts.count === "exact" && q.opts.head) return { data: null, count: list.length, error: null };
        if (q.range) list = list.slice(q.range[0], q.range[1] + 1);
        if (q.limit != null) list = list.slice(0, q.limit);
        return finish(join(db, list));
      }
      return api;
    }

    const client = {
      from: (name) => builder(name),
      rpc(fn, args) {
        if (fn === "taken_slots") {
          const db = load();
          const data = table(db, "bookings")
            .filter((b) => b.staff_id === args.p_staff_id && b.status !== "cancelled" && b.scheduled_at >= args.p_from && b.scheduled_at < args.p_to)
            .map((b) => ({ scheduled_at: b.scheduled_at }));
          return Promise.resolve({ data, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      auth: {
        getSession: () => Promise.resolve({ data: { session: session() ? { user: session().user, access_token: ["fake", "jwt", session().user.id].join("-") } : null } }),
        getUser: () => Promise.resolve({ data: { user: session() ? session().user : null } }),
        signInAnonymously() {
          const db = load(); const id = "guest-" + (++db.seq); save(db);
          const user = { id, is_anonymous: true, app_metadata: {} };
          setSession({ user });
          return Promise.resolve({ data: { user }, error: null });
        },
        signInWithPassword({ email, password }) {
          const users = {
            "nurse@demo.test": { id: "staff-user-1", app_metadata: {} },
            "admin@demo.test": { id: "admin-user-1", app_metadata: { is_admin: true } },
          };
          const db0 = load(); const reg = (db0.users || {})[email];
          if (reg && reg.password === password) {
            const user = { id: reg.id, is_anonymous: false, email, app_metadata: {} };
            setSession({ user });
            return Promise.resolve({ data: { user }, error: null });
          }
          if (!users[email] || password !== "demo-pass-123") return Promise.resolve({ data: { user: null }, error: { message: "Invalid login credentials" } });
          const user = { ...users[email], is_anonymous: false, email };
          setSession({ user });
          return Promise.resolve({ data: { user }, error: null });
        },
        signOut() { setSession(null); return Promise.resolve({ error: null }); },
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        updateUser({ email, password }) {
          const s = session(); if (!s) return Promise.resolve({ data: { user: null }, error: { message: "no session" } });
          if (password && password.length < 8) return Promise.resolve({ data: { user: null }, error: { message: "Password should be at least 8 characters" } });
          if (localStorage.getItem("__require_confirm")) return Promise.resolve({ data: { user: { ...s.user, new_email: email } }, error: null });
          const db = load(); db.users = db.users || {}; db.users[email] = { id: s.user.id, password }; save(db);
          s.user = { ...s.user, email, is_anonymous: false }; setSession(s);
          return Promise.resolve({ data: { user: s.user }, error: null });
        },
        resetPasswordForEmail: () => Promise.resolve({ error: null }),
      },
    };
    window.supabase = { createClient: () => client };
  }})();`;
}

async function setup(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  const problems = { consoleErrors: [], pageErrors: [], localhost8000: [], supabaseNetwork: [] };

  await context.route("**/@supabase/supabase-js@2", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeSupabaseSource() }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ contentType: "text/css", body: "" }));

  // הזמנות נכתבות רק דרך ה-backend הממוקק (route interception), לא בכתיבה ישירה ל-bookings
  await installBackendMock(context);

  context.on("request", (req) => {
    const url = req.url();
    if (/localhost:8000|127\.0\.0\.1:8000/.test(url)) problems.localhost8000.push(url);
    if (/supabase\.co/.test(url)) problems.supabaseNetwork.push(url);
  });
  context.on("page", (p) => {
    p.on("pageerror", (e) => problems.pageErrors.push(String(e)));
    p.on("console", (m) => { 
      // serviceWorkers:"block" (כדי ש-SW לא יעקוף את ה-routes) גורם ל-register() להחזיר undefined —
      // artifact של ההרנס, לא באג באפליקציה.
      if (m.type() === "error" && !/service worker registration failed/.test(m.text())) problems.consoleErrors.push(m.text());
    });
  });
  const page = await context.newPage();
  return { context, page, problems };
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + ".png") });
}

async function expectDemoBanner(page) {
  const banner = page.locator("#demo-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("מערכת הדגמה");
  await expect(banner).toContainText("נתונים סינתטיים בלבד");
}

// מזמין תור עד פאנל האישור, מתחיל מדף הבית. slotIndex — איזו שעה פנויה לבחור (תור שונה לכל הזמנה).
async function patientBooks(page, { name, nationalId, slotIndex, shotPrefix }) {
  await page.goto(BASE + "/index.html");
  await expectDemoBanner(page);
  const serviceCard = page.locator("#services-grid a").first();
  await expect(serviceCard).toBeVisible();
  if (shotPrefix) await shot(page, `${shotPrefix}-01-home`);
  await serviceCard.click();

  await page.waitForURL(/booking\.html/);
  await page.click("#choose-staff-link"); // בורר אופציונלי של איש צוות מסוים
  await page.waitForURL(/staff\.html/);
  const staffCard = page.locator(".staff-card").first();
  await expect(staffCard).toContainText("אחות הדגמה");
  if (shotPrefix) await shot(page, `${shotPrefix}-02-staff`);
  await staffCard.click();

  await page.waitForURL(/booking\.html/);
  await page.locator(".chip").first().click();
  await page.fill("#patient-address", "רחוב ההדגמה 1, עיר הדגמה");
  await page.locator(".date-pill").nth(1).click(); // מחר — תמיד בעתיד, בלי תלות בשעת ההרצה
  const slot = page.locator(".slot-btn:not([disabled])").nth(slotIndex);
  await expect(slot).toBeVisible();
  await slot.click();
  await expect(page.locator("#patient-details-section")).toBeVisible();
  await page.fill("#patient-name", name);
  await page.fill("#patient-national-id", nationalId);
  await page.fill("#patient-phone", "050-0000001");
  await page.fill("#notes", "הערה סינתטית");
  if (shotPrefix) await shot(page, `${shotPrefix}-03-booking-details`);
  await expect(page.locator("#confirm-btn")).toBeEnabled();
  await page.click("#confirm-btn");
  await expect(page.locator("#confirmation-panel")).toBeVisible();
  await expect(page.locator("#success-box")).toHaveText("הביקור התבקש וממתין לאישור");
  await expect(page.locator("#confirmed-staff")).toContainText("אחות הדגמה");
  await expect(page.locator("#confirmed-address")).toHaveText("רחוב ההדגמה 1, עיר הדגמה");
  if (shotPrefix) await shot(page, `${shotPrefix}-04-confirmation`);
}


test("שדרוג אורח לחשבון שומר הזמנות, כניסה ממכשיר שני, מספר הזמנה וסטטוס", async ({ browser }) => {
  const { context, page, problems } = await setup(browser);
  await patientBooks(page, { name: "מטופל חשבון", nationalId: "100000018", slotIndex: 0 });
  await expect(page.locator("#confirmed-order")).toHaveText(/הזמנה #\d+/);
  const orderText = (await page.locator("#confirmed-order").textContent()).trim();

  // שדרוג: סיסמה קצרה נדחית, תקינה מצליחה
  await page.fill("#account-email", "patient@demo.test");
  await page.fill("#account-password", "short");
  await page.click("#account-save-btn");
  await expect(page.locator("#account-error")).toBeVisible();
  await page.fill("#account-password", "longenough1");
  await page.click("#account-save-btn");
  await expect(page.locator("#account-success")).toContainText("החשבון נשמר");

  await page.click("#confirmation-panel a");
  await page.waitForURL(/my-bookings\.html/);
  const item = page.locator("#upcoming-list .booking-item");
  await expect(item).toHaveCount(1);
  await expect(item.first()).toContainText(orderText);
  await expect(item.first().locator("ol.steps")).toHaveAttribute("aria-label", /ממתין לאישור/);
  await expect(item.first()).toContainText("הביקור התבקש וממתין לאישור");
  await expect(item.first().locator(".step.active")).toHaveText("התקבלה");
  await expect(page.locator("#account-signout-btn")).toBeVisible();
  await expect(page.locator("#account-card-host")).toContainText("patient@demo.test");

  // "מכשיר שני": הקשר חדש עם אותו DB (שרת), בלי session
  const dbState = await page.evaluate(() => localStorage.getItem("__demo_db"));
  const second = await setup(browser);
  await second.context.addInitScript((db) => { if (!localStorage.getItem("__demo_db")) localStorage.setItem("__demo_db", db); }, dbState);
  await second.page.goto(BASE + "/my-bookings.html");
  await expect(second.page.locator("#upcoming-list .booking-item")).toHaveCount(0);
  await second.page.click("#account-signin-toggle");
  await second.page.fill("#signin-email", "patient@demo.test");
  await second.page.fill("#signin-password", "wrong-password");
  await second.page.click("#signin-btn");
  await expect(second.page.locator("#signin-error")).toBeVisible();
  await second.page.fill("#signin-password", "longenough1");
  await second.page.click("#signin-btn");
  await expect(second.page.locator("#upcoming-list .booking-item")).toHaveCount(1);
  await expect(second.page.locator("#upcoming-list .booking-item").first()).toContainText(orderText);

  // התנתקות: חוזר לאורח חדש בלי היסטוריה
  await second.page.click("#account-signout-btn");
  await expect(second.page.locator("#account-signin-toggle")).toBeVisible();
  await expect(second.page.locator("#upcoming-list .booking-item")).toHaveCount(0);

  // ממשק הטלפון הלא פעיל הוסר
  await expect(second.page.locator("#phone-link-card")).toHaveCount(0);

  for (const pr of [problems, second.problems]) {
    expect(pr.consoleErrors).toEqual([]);
    expect(pr.pageErrors).toEqual([]);
    expect(pr.supabaseNetwork).toEqual([]);
  }
  await context.close(); await second.context.close();
});

test("תשלום כאורח עובד בלי חשבון, ושלבי סטטוס מתעדכנים לפי workflow_status", async ({ browser }) => {
  const { context, page, problems } = await setup(browser);
  await patientBooks(page, { name: "מטופל אורח", nationalId: "100000018", slotIndex: 1 });
  // מדלגים על כרטיס החשבון ועוברים ישר להזמנות
  await page.click("#confirmation-panel a");
  await page.waitForURL(/my-bookings\.html/);
  await expect(page.locator("#upcoming-list .booking-item")).toHaveCount(1);
  await expect(page.locator("#account-upgrade")).toBeVisible();

  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("__demo_db"));
    db.bookings.forEach((b) => { b.approval_status = "confirmed"; b.workflow_status = "in_progress"; });
    localStorage.setItem("__demo_db", JSON.stringify(db));
  });
  await page.reload();
  await expect(page.locator("#upcoming-list .step.active")).toContainText("בדרך אליכם");

  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("__demo_db"));
    db.bookings.forEach((b) => (b.status = "cancelled"));
    localStorage.setItem("__demo_db", JSON.stringify(db));
  });
  await page.reload();
  await expect(page.locator("#past-list .booking-item").first()).toContainText("בוטלה");

  // אישור אימייל נדרש: הודעה ברורה
  await page.evaluate(() => localStorage.setItem("__require_confirm", "1"));
  expect(problems.consoleErrors).toEqual([]);
  expect(problems.pageErrors).toEqual([]);
  await context.close();
});
