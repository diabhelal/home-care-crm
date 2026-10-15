// backend (FastAPI) ממוקק לבדיקות e2e: route interception ל-BACKEND_URL, בלי שרת אמיתי.
// הלוגיקה (זמינות, בקשה, idempotency, אישור/דחייה/שיבוץ) מוחלת על ה-fake Supabase שב-localStorage
// של העמוד (מפתח __demo_db), כדי שדפי המטופל/מנהל יראו את התוצאה בדיוק כמו מול DB אמיתי.
// החוזה משקף backend/app/main.py: POST /bookings/request, GET /availability, POST /admin/bookings/{id}/...
const BACKEND = "http://localhost:8001";
const SLOT_TAKEN_MSG = "המטפל אינו פנוי בשעה זו, אנא בחר משבצת זמן אחרת";

// config.js מגדיר BACKEND_URL לפי hostname; בבדיקות (demo.localhost) מכריחים את הכתובת המוק.
async function overrideConfig(context, backendUrl = BACKEND) {
  await context.route("**/config.js", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) + `\nwindow.BACKEND_URL = ${JSON.stringify(backendUrl)};\n`;
    await route.fulfill({ response: res, body, contentType: "application/javascript" });
  });
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Authorization, Content-Type, Idempotency-Key",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

async function installBackendMock(context, { backendUrl = BACKEND, configure = true } = {}) {
  if (configure) await overrideConfig(context, backendUrl);
  const ctl = {
    requests: [],          // { method, path, headers, body }
    down: false,           // true => ניתוק רשת (route.abort)
    failNext: 0,           // כמה בקשות POST /bookings/request הבאות ייכשלו ברשת (לפני שהשרת עיבד)
    dropResponseNext: 0,   // השרת מעבד ושומר, אבל התשובה אובדת (בדיוק התרחיש של idempotency)
    byKey: new Map(),      // Idempotency-Key -> booking
    created: 0,
    availabilityCalls: [],
  };

  await context.route(backendUrl + "/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const headers = req.headers();
    let body = null;
    try { body = req.postDataJSON(); } catch (e) {}
    ctl.requests.push({ method: req.method(), path, query: url.search, headers, body });
    if (ctl.down) return route.abort("connectionrefused");

    const json = (status, obj) => route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(obj) });
    if (!headers.authorization) return json(401, { code: "unauthorized", detail: "נדרשת התחברות" });
    const page = req.frame().page();

    // כל מניפולציה של ה-DB הממוקק רצה בתוך העמוד (localStorage)
    const inPage = (fn, arg) => page.evaluate(fn, arg);

    if (req.method() === "GET" && path === "/availability") {
      ctl.availabilityCalls.push(Object.fromEntries(url.searchParams));
      const start = url.searchParams.get("start");
      const staffParam = url.searchParams.get("staff_id");
      const slots = await inPage(({ start, staffParam }) => {
        const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
        const [y, m, d] = start.split("-").map(Number);
        const staff = (db.medical_staff || []).filter((s) => !staffParam || String(s.id) === staffParam);
        const bookings = (db.bookings || []).filter((b) => b.status !== "cancelled");
        const out = new Map();
        staff.forEach((s) => {
          const [sh] = s.work_start_time.split(":").map(Number);
          const [eh] = s.work_end_time.split(":").map(Number);
          for (let h = sh; h < eh; h++) {
            const at = new Date(y, m - 1, d, h, 0, 0, 0);
            if (at.getTime() <= Date.now()) continue;
            const iso = at.toISOString();
            if (bookings.some((b) => b.staff_id === s.id && b.scheduled_at === iso)) continue;
            out.set(iso, [...(out.get(iso) || []), s.id]);
          }
        });
        return [...out.entries()].sort().map(([startIso, staff_ids]) => ({ start: startIso, staff_ids }));
      }, { start, staffParam });
      return json(200, { slots, travel_buffer_minutes: 30 });
    }

    if (req.method() === "POST" && path === "/bookings/request") {
      if (ctl.failNext > 0) { ctl.failNext--; return route.abort("connectionreset"); }
      const key = headers["idempotency-key"];
      if (key && ctl.byKey.has(key)) {
        if (ctl.dropResponseNext > 0) { ctl.dropResponseNext--; return route.abort("connectionreset"); }
        return json(200, ctl.byKey.get(key));
      }
      const result = await inPage((b) => {
        const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
        const sess = JSON.parse(localStorage.getItem("__demo_session") || "null");
        db.bookings = db.bookings || [];
        const staffId = b.staff_id != null ? b.staff_id : ((db.medical_staff || [])[0] || {}).id;
        const iso = new Date(b.scheduled_at).toISOString();
        if (db.bookings.some((x) => x.staff_id === staffId && x.scheduled_at === iso && x.status !== "cancelled")) return { conflict: true };
        const row = {
          id: ++db.seq, patient_id: sess.user.id, staff_id: staffId, visit_purpose: b.purpose,
          scheduled_at: iso, status: "scheduled", approval_status: "requested", workflow_status: "assigned",
          visit_address: b.address, notes: b.notes || null, created_at: new Date().toISOString(),
        };
        db.bookings.push(row);
        localStorage.setItem("__demo_db", JSON.stringify(db));
        return { row };
      }, body);
      if (result.conflict) return json(409, { code: "slot_taken", detail: SLOT_TAKEN_MSG });
      const view = { ...result.row, display_state: "requested" };
      ctl.created++;
      if (key) ctl.byKey.set(key, view);
      if (ctl.dropResponseNext > 0) { ctl.dropResponseNext--; return route.abort("connectionreset"); }
      return json(201, view);
    }

    const m = path.match(/^\/admin\/bookings\/(\d+)\/(approve|reject|reassign)$/);
    if (req.method() === "POST" && m) {
      const result = await inPage(({ id, action, body }) => {
        const sess = JSON.parse(localStorage.getItem("__demo_session") || "null");
        if (!sess || !(sess.user.app_metadata || {}).is_admin) return { status: 403, detail: "אין הרשאה לפעולה זו" };
        const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
        const row = (db.bookings || []).find((b) => b.id === Number(id));
        if (!row) return { status: 404, detail: "ההזמנה לא נמצאה" };
        if (action === "approve" || action === "reject") {
          if ((row.approval_status || "confirmed") !== "requested") return { status: 409, code: "illegal_transition", detail: "מעבר לא חוקי" };
          if (action === "approve") row.approval_status = "confirmed";
          else { row.approval_status = "rejected"; row.status = "cancelled"; }
        } else {
          const clash = db.bookings.some((b) => b.id !== row.id && b.staff_id === body.staff_id && b.scheduled_at === row.scheduled_at && b.status !== "cancelled");
          if (clash) return { status: 409, code: "slot_taken", detail: "המטפל אינו פנוי בשעה זו, אנא בחר משבצת זמן אחרת" };
          row.staff_id = body.staff_id; row.workflow_status = "assigned";
        }
        localStorage.setItem("__demo_db", JSON.stringify(db));
        return { status: 200, row };
      }, { id: m[1], action: m[2], body });
      if (result.status !== 200) return json(result.status, { code: result.code || "error", detail: result.detail });
      return json(200, { ...result.row, display_state: result.row.approval_status === "rejected" ? "rejected" : result.row.approval_status === "requested" ? "requested" : "confirmed" });
    }

    return json(404, { code: "not_found", detail: "לא נמצא" });
  });
  return ctl;
}

module.exports = { installBackendMock, overrideConfig, BACKEND, SLOT_TAKEN_MSG };
