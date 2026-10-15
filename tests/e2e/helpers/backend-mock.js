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
  "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
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
    checkInFail: null,     // מספר סטטוס HTTP לכישלון check-in, או 'abort' לניתוק רשת
    checkIns: 0,
    completeFail: null,    // מספר סטטוס HTTP לכישלון complete, או 'abort' לניתוק רשת לפני עיבוד
    completes: [],         // גופי בקשות complete שעובדו בהצלחה (booking_id + body)
    outcomeFail: null,     // מספר סטטוס HTTP לכישלון PATCH clinical-outcome, או 'abort'
    outcomes: [],          // { report_id, value } שעובדו בהצלחה
    cancels: [],           // { scope: 'patient'|'admin', id } שעובדו בהצלחה
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

    const ci = path.match(/^\/staff\/bookings\/(\d+)\/check-in$/);
    if (req.method() === "POST" && ci) {
      if (ctl.checkInFail === "abort") return route.abort("connectionreset");
      if (ctl.checkInFail) return json(ctl.checkInFail, { code: "error", detail: "שגיאת בדיקה" });
      const result = await inPage(({ id }) => {
        const sess = JSON.parse(localStorage.getItem("__demo_session") || "null");
        if (!sess) return { status: 401 };
        const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
        const row = (db.bookings || []).find((b) => b.id === Number(id));
        if (!row) return { status: 404, detail: "ההזמנה לא נמצאה" };
        const isAdmin = (sess.user.app_metadata || {}).is_admin === true;  // כמו ב-backend: מנהל מורשה (JWT בלבד)
        const me = (db.medical_staff || []).find((s) => s.auth_user_id === sess.user.id);
        if (!isAdmin && !me) return { status: 403, detail: "נדרשת הרשאת צוות" };
        if (!isAdmin && row.staff_id !== me.id) return { status: 403, detail: "ההזמנה אינה משויכת אליך" };
        if (row.approval_status && row.approval_status !== "confirmed") return { status: 409, detail: "ההזמנה טרם אושרה" };
        if (!row.checked_in_at) row.checked_in_at = new Date().toISOString();
        row.workflow_status = "in_progress";
        localStorage.setItem("__demo_db", JSON.stringify(db));
        return { status: 200, row };
      }, { id: ci[1] });
      if (result.status !== 200) return json(result.status, { code: "error", detail: result.detail });
      ctl.checkIns++;
      return json(200, { ...result.row, display_state: "in_progress" });
    }

    // ---- תוצאה קלינית בדיעבד — משקף PATCH /visits/{id}/clinical-outcome (צוות משויך או מנהל)
    const oc = path.match(/^\/visits\/(\d+)\/clinical-outcome$/);
    if (req.method() === "PATCH" && oc) {
      if (ctl.outcomeFail === "abort") return route.abort("connectionreset");
      if (ctl.outcomeFail) return json(ctl.outcomeFail, { code: "error", detail: "שגיאת בדיקה" });
      const ALLOWED = ["none", "hypoglycemia", "severe_hyperglycemia", "respiratory_deterioration", "hemodynamic_deterioration"];
      const result = await inPage(({ id, body, ALLOWED }) => {
        const sess = JSON.parse(localStorage.getItem("__demo_session") || "null");
        if (!sess) return { status: 401 };
        const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
        const isAdmin = (sess.user.app_metadata || {}).is_admin === true;
        const staff = (db.medical_staff || []).find((s) => s.auth_user_id === sess.user.id && s.is_active !== false);
        if (!isAdmin && !staff) return { status: 403, detail: "נדרשת הרשאת צוות" };
        const rep = (db.visit_reports || []).find((v) => v.id === Number(id));
        if (!rep) return { status: 404, detail: "דוח הביקור לא נמצא" };
        const bk = (db.bookings || []).find((b) => b.id === rep.booking_id);
        if (!isAdmin && (!bk || bk.staff_id !== staff.id)) return { status: 403, detail: "דוח הביקור אינו משויך אליך" };
        const v = body && body.clinical_outcome_8h;
        if (v !== null && v !== undefined && !ALLOWED.includes(v)) return { status: 422, detail: "ערך לא תקין" };
        rep.clinical_outcome_8h = v == null ? null : v;
        localStorage.setItem("__demo_db", JSON.stringify(db));
        return { status: 200, rep };
      }, { id: oc[1], body, ALLOWED });
      if (result.status !== 200) return json(result.status, { code: "error", detail: result.detail });
      ctl.outcomes.push({ report_id: Number(oc[1]), value: body.clinical_outcome_8h ?? null });
      return json(200, { report: { id: result.rep.id, booking_id: result.rep.booking_id, clinical_outcome_8h: result.rep.clinical_outcome_8h } });
    }

    // ---- ביטול (מטופל-בעלים / מנהל) — משקף backend/app/service.py cancel_own / cancel_admin
    const cn = path.match(/^\/(admin\/)?bookings\/(\d+)\/cancel$/);
    if (req.method() === "POST" && cn) {
      const scope = cn[1] ? "admin" : "patient";
      const result = await inPage(({ id, scope }) => {
        const sess = JSON.parse(localStorage.getItem("__demo_session") || "null");
        if (!sess) return { status: 401 };
        const isAdmin = (sess.user.app_metadata || {}).is_admin === true;
        if (scope === "admin" && !isAdmin) return { status: 403, code: "forbidden", detail: "נדרשת הרשאת מנהל" };
        const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
        const row = (db.bookings || []).find((b) => b.id === Number(id));
        if (!row || (scope === "patient" && row.patient_id !== sess.user.id)) return { status: 404, code: "not_found", detail: "ההזמנה לא נמצאה" };
        if (row.status === "cancelled") return { status: 200, row };
        if (row.status === "completed") return { status: 409, code: "illegal_transition", detail: "ביקור שהושלם לא ניתן לביטול" };
        if (scope === "patient" && row.checked_in_at) return { status: 409, code: "illegal_transition", detail: "הביקור כבר החל ולא ניתן לבטלו" };
        row.status = "cancelled";
        localStorage.setItem("__demo_db", JSON.stringify(db));
        return { status: 200, row };
      }, { id: cn[2], scope });
      if (result.status !== 200) return json(result.status, { code: result.code || "error", detail: result.detail });
      ctl.cancels.push({ scope, id: Number(cn[2]) });
      return json(200, { ...result.row, display_state: "cancelled" });
    }

    // ---- השלמת ביקור (אטומי: דוח + status=completed) — משקף POST /staff/visits/{id}/complete
    const cm = path.match(/^\/staff\/visits\/(\d+)\/complete$/);
    if (req.method() === "POST" && cm) {
      if (ctl.completeFail === "abort") return route.abort("connectionreset");
      if (ctl.completeFail) return json(ctl.completeFail, { code: "error", detail: "שגיאת בדיקה" });
      const result = await inPage(({ id, body }) => {
        const sess = JSON.parse(localStorage.getItem("__demo_session") || "null");
        if (!sess) return { status: 401 };
        const db = JSON.parse(localStorage.getItem("__demo_db") || "{}");
        const isAdmin = (sess.user.app_metadata || {}).is_admin === true;
        const staff = (db.medical_staff || []).find((s) => s.auth_user_id === sess.user.id && s.is_active !== false);
        if (!isAdmin && !staff) return { status: 403, code: "forbidden", detail: "נדרשת הרשאת צוות" };
        const row = (db.bookings || []).find((b) => b.id === Number(id));
        if (!row) return { status: 404, code: "not_found", detail: "ההזמנה לא נמצאה" };
        if (!isAdmin && row.staff_id !== staff.id) return { status: 403, code: "forbidden", detail: "ההזמנה אינה משויכת אליך" };
        if ((row.approval_status || "confirmed") !== "confirmed") return { status: 409, code: "illegal_transition", detail: "ההזמנה לא אושרה" };
        if (row.status !== "scheduled") return { status: 409, code: "illegal_transition", detail: "מעבר לא חוקי (status)" };
        if (!body || !String(body.treatment_summary || "").trim()) return { status: 422, code: "validation", detail: "treatment_summary" };
        db.visit_reports = db.visit_reports || [];
        const report = {
          ...body, id: ++db.seq, booking_id: row.id, patient_id: row.patient_id, staff_id: row.staff_id,
          visit_date: new Date().toISOString(),
        };
        db.visit_reports = db.visit_reports.filter((v) => v.booking_id !== row.id).concat(report);
        row.status = "completed"; row.workflow_status = "assigned";
        localStorage.setItem("__demo_db", JSON.stringify(db));
        return { status: 200, report };
      }, { id: cm[1], body });
      if (result.status !== 200) return json(result.status, { code: result.code || "error", detail: result.detail });
      ctl.completes.push({ booking_id: Number(cm[1]), body });
      return json(200, { report: result.report });
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
