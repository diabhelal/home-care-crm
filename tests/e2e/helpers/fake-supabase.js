// fake supabase-js stateful (נשמר ב-localStorage) — משותף לבדיקות e2e בלי DB חי.
// נוסף: __write_log ב-localStorage מתעד כל פעולת כתיבה (insert/update/upsert/delete) לפי טבלה,
// כדי שבדיקות יוכלו לוודא שהדפדפן לא כותב ל-bookings ישירות בזרימת הבקשה/אישור.
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
        if (q.op !== "select") {
          try {
            const log = JSON.parse(localStorage.getItem("__write_log") || "[]");
            log.push({ table: name, op: q.op });
            localStorage.setItem("__write_log", JSON.stringify(log));
          } catch (e) {}
        }
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
            if (name === "visit_report_amendments") {   // מה שהטריגר בשרת עושה: מטופל מהדוח, מחבר ותפקיד מהשרת
              const rep = table(db, "visit_reports").find((r) => r.id === row.visit_report_id);
              row.patient_id = rep ? rep.patient_id : row.patient_id;
              row.amended_by = (session() && session().user && session().user.id) || null;
              row.amended_by_role = (session() && session().user && session().user.app_metadata && session().user.app_metadata.is_admin) ? "admin" : "nurse";
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
        if (sess && sess.user.is_anonymous) {
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
        if (fn === "export_patient_record") {   // כמו הפונקציה בשרת: מנהל בלבד, רושמת ביומן הגישה ומחזירה את התיק
          const db = load();
          const u = session() && session().user;
          if (!(u && u.app_metadata && u.app_metadata.is_admin)) return Promise.resolve({ data: null, error: { code: "42501", message: "only an administrator may export a patient record" } });
          const pid = args.p_patient_id;
          const mine = (t) => table(db, t).filter((r) => r.patient_id === pid);
          const rec = {
            patient: table(db, "patients").find((x) => x.id === pid) || { id: pid },
            allergies: mine("patient_allergies"), bookings: mine("bookings"), visit_reports: mine("visit_reports"),
            visit_report_amendments: mine("visit_report_amendments"), risk_predictions: mine("risk_predictions"),
            alerts: mine("alerts"), tasks: mine("tasks"), clinical_notes: mine("clinical_notes"), medication_events: mine("medication_events"),
          };
          const log = { id: ++db.seq, patient_id: pid, requester_type: args.p_requester_type, requester_name: args.p_requester_name || null,
            basis: args.p_basis, exported_by: u.id, exported_at: new Date().toISOString(),
            scope: Object.fromEntries(Object.entries(rec).filter(([k]) => k !== "patient").map(([k, v]) => [k, v.length])) };
          table(db, "record_access_log").push(log);
          save(db);
          return Promise.resolve({ data: { ...rec, export: { log_id: log.id, exported_at: log.exported_at, exported_by: u.id,
            requester_type: log.requester_type, requester_name: log.requester_name, basis: log.basis, scope: log.scope } }, error: null });
        }
        if (fn === "taken_slots") {
          const db = load();
          const data = table(db, "bookings")
            .filter((b) => b.staff_id === args.p_staff_id && b.status !== "cancelled" && b.scheduled_at >= args.p_from && b.scheduled_at < args.p_to)
            .map((b) => ({ scheduled_at: b.scheduled_at }));
          return Promise.resolve({ data, error: null });
        }
        if (fn === "admin_list_staff") return Promise.resolve({ data: table(load(), "medical_staff"), error: null });
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
          if (!users[email] || password !== "demo-pass-123") return Promise.resolve({ data: { user: null }, error: { message: "Invalid login credentials" } });
          const user = { ...users[email], is_anonymous: false, email };
          setSession({ user });
          return Promise.resolve({ data: { user }, error: null });
        },
        signOut() { setSession(null); return Promise.resolve({ error: null }); },
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        updateUser: () => Promise.resolve({ error: null }),
        resetPasswordForEmail: () => Promise.resolve({ error: null }),
      },
    };
    window.supabase = { createClient: () => client };
  }})();`;
}


module.exports = { fakeSupabaseSource };
