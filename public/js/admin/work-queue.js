// ===== תור עבודה / הזמנות — הוצא מ-admin.html לצורך תחזוקה =====
// Classic script בכוונה (לא <script type="module">) — אותו נימוק כמו js/admin/
// staff.js/patients.js/capacity.js/patient-record.js: נטען לפני admin.html עצמו,
// חולק scope עליון עם app.js/config.js ועם שאר js/admin/*.js.
//
// תלויות חוצות-קבצים (כולן forward-reference בזמן ריצה בלבד — לחיצת כפתור/טעינה
// אסינכרונית, לא הפניה מיידית — בדיוק אותו דפוס שכבר אומת 4 פעמים):
// - staffListCache (js/admin/staff.js, נטען לפני הקובץ הזה) — renderQueueStaffCell.
// - openVisitReportModal (עדיין ב-admin.html, בבלוק "דוח ביקור" שנשאר שם בכוונה) —
//   startVisit + renderWorkQueueBuckets.
// - prInvalidate/prSwitchTab (prInvalidate מ-app.js, prSwitchTab מ-patient-record.js,
//   שניהם כבר טעונים לפני הקובץ הזה) — updateBookingStatus.
// - appError/flashSuccess (עדיין ב-admin.html, מוגדרים למעלה בסקריפט הראשי לפני שהוא
//   בכלל רץ, אבל נקראים כאן רק בזמן ריצה מאוחר) — startVisit/renderQueueStaffCell/
//   updateBookingStatus.
// - loadBookings() נקרא גם מ-js/admin/staff.js (deleteStaff) וגם מהאתחול ומהבלוק
//   "דוח ביקור" ב-admin.html — כל הקריאות האלה הן forward/lateral references בטוחות
//   מאותה סיבה.

// 6 קבוצות תפעוליות, נגזרות מ-status הקיים (לא משתנה) + workflow_status החדש +
// קיום task פתוח (נדרש מעקב) — בלי טבלת "בקשות" נפרדת. ר' plan: dapper-baking-shannon.
const QUEUE_BUCKETS = [
  { key: "unassigned", label: "לא משויך", icon: "🆕", openByDefault: true },
  { key: "assigned", label: "משויך", icon: "📋", openByDefault: true },
  { key: "in_progress", label: "בתהליך", icon: "🩺", openByDefault: true },
  { key: "follow_up", label: "נדרש מעקב", icon: "🔔", openByDefault: true },
  { key: "completed", label: "הושלם", icon: "✅", openByDefault: false },
  { key: "cancelled", label: "בוטל", icon: "🚫", openByDefault: false },
];

function bookingQueueBucket(b, hasOpenTask) {
  if (b.status === "cancelled") return "cancelled";
  if (b.status === "completed") return hasOpenTask ? "follow_up" : "completed";
  if (b.workflow_status === "in_progress") return "in_progress";
  if (b.workflow_status === "unassigned") return "unassigned";
  return "assigned";
}

function renderQueueStaffCell(td, b) {
  const currentLabel = `${b.medical_staff?.full_name || "—"} (${ROLE_LABELS[b.medical_staff?.role] || ""})`;
  if (b.status !== "scheduled") { td.textContent = currentLabel; return; }
  const span = document.createElement("span");
  span.textContent = currentLabel;
  const changeBtn = document.createElement("button");
  changeBtn.type = "button";
  changeBtn.className = "btn btn-ghost btn-sm";
  changeBtn.style.marginRight = "6px";
  changeBtn.textContent = "שינוי שיוך";
  changeBtn.addEventListener("click", () => {
    td.innerHTML = "";
    const select = document.createElement("select");
    select.style.maxWidth = "190px";
    select.style.minHeight = "44px";
    staffListCache.filter((s) => s.is_active).forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.full_name} (${ROLE_LABELS[s.role] || s.role})`;
      if (s.id === b.staff_id) opt.selected = true;
      select.appendChild(opt);
    });
    const errEl = document.createElement("div");
    errEl.className = "error-msg";
    errEl.style.fontSize = "12px";
    td.appendChild(select);
    td.appendChild(errEl);
    select.addEventListener("change", async () => {
      const newStaffId = Number(select.value);
      if (newStaffId === b.staff_id) return;
      select.disabled = true;
      const { error } = await supabaseClient.from("bookings").update({ staff_id: newStaffId }).eq("id", b.id);
      select.disabled = false;
      if (error) {
        errEl.textContent = /duplicate|unique/i.test(error.message || "") ? "לצוות הנבחר כבר יש תור באותו מועד — נבחר שיוך אחר" : friendlyErrorMessage(error);
        return;
      }
      flashSuccess("השיוך עודכן");
      loadBookings();
    });
  });
  td.appendChild(span);
  td.appendChild(changeBtn);
}

async function startVisit(b) {
  if (b.workflow_status !== "in_progress") {
    const { error } = await supabaseClient.from("bookings").update({ workflow_status: "in_progress" }).eq("id", b.id);
    if (error) { showError(appError, friendlyErrorMessage(error)); return; }
    b.workflow_status = "in_progress";
    loadBookings();
  }
  const report = (b.visit_reports && b.visit_reports[0]) || null;
  openVisitReportModal(b, report);
}

// תור העבודה חסום-תאריך בכוונה (לא "כל ההזמנות אי-פעם") — עם אלפי מטופלים במערכת,
// כמות הביקורים הפעילים בחלון של כמה שבועות נשארת קבועה גם כשמצטברים מטופלים
// לאורך שנים; זה מה ששומר על התצוגה שימושית בלי scroll אינסופי. חיפוש טקסט (למטה)
// הוא ה-escape hatch לכל דבר מחוץ לחלון — שאילתת שרת נפרדת, לא סינון על הכל.
const WORK_QUEUE_DAYS_BACK = 14;
const WORK_QUEUE_DAYS_FORWARD = 30;

async function fetchRiskAndTasks() {
  const [{ data: riskRows, error: riskError }, { data: openTaskRows, error: taskError }] = await Promise.all([
    supabaseClient.from("current_patient_risk").select("*"),
    supabaseClient.from("tasks").select("patient_id").eq("status", "pending"),
  ]);
  if (riskError) console.error("current_patient_risk", riskError);
  if (taskError) console.error("tasks", taskError);
  return {
    riskByPatient: new Map((riskRows || []).map((r) => [r.patient_id, r])),
    patientsWithOpenTask: new Set((openTaskRows || []).map((t) => t.patient_id)),
  };
}

function renderWorkQueueBuckets(container, bookings, riskByPatient, patientsWithOpenTask) {
  if (!bookings || !bookings.length) {
    container.innerHTML = `<p class="empty-state">אין הזמנות בטווח הזה</p>`;
    return;
  }
  const buckets = new Map(QUEUE_BUCKETS.map((qb) => [qb.key, []]));
  bookings.forEach((b) => buckets.get(bookingQueueBucket(b, patientsWithOpenTask.has(b.patient_id))).push(b));

  container.innerHTML = QUEUE_BUCKETS.map((qb) => {
    const rows = buckets.get(qb.key);
    if (!rows.length) return "";
    return `
      <details class="queue-group" ${qb.openByDefault ? "open" : ""}>
        <summary>${qb.icon} ${escapeHtml(qb.label)} <span class="queue-count">${rows.length}</span></summary>
        <div style="overflow-x:auto;">
          <table class="admin-table" style="min-width:0;">
            <thead><tr><th>מטופל</th><th>טלפון</th><th>איש צוות</th><th>מטרה</th><th>מועד</th><th>רמת סיכון</th><th>פעולות</th></tr></thead>
            <tbody data-bucket="${qb.key}"></tbody>
          </table>
        </div>
      </details>
    `;
  }).join("") || `<p class="empty-state">אין הזמנות בטווח הזה</p>`;

  QUEUE_BUCKETS.forEach((qb) => {
    const rows = buckets.get(qb.key);
    if (!rows.length) return;
    const tbody = container.querySelector(`tbody[data-bucket="${qb.key}"]`);
    rows.forEach((b) => {
      const tr = document.createElement("tr");
      const date = new Date(b.scheduled_at);
      tr.innerHTML = `
        <td>${escapeHtml(b.patients?.full_name || "—")}</td>
        <td>${escapeHtml(b.patients?.phone || "—")}</td>
        <td class="queue-staff-cell"></td>
        <td>${PURPOSE_LABELS[b.visit_purpose] || b.visit_purpose}</td>
        <td>${formatDateHe(date)} ${formatTimeHe(date)}</td>
        <td>${riskBadgeHtml(riskByPatient.get(b.patient_id))}</td>
        <td></td>
      `;
      renderQueueStaffCell(tr.querySelector(".queue-staff-cell"), b);
      const actionsTd = tr.lastElementChild;
      if (b.status === "scheduled") {
        const startBtn = document.createElement("button");
        startBtn.className = "btn btn-primary btn-sm";
        startBtn.textContent = b.workflow_status === "in_progress" ? "המשך ביקור" : "התחלת ביקור";
        startBtn.addEventListener("click", () => startVisit(b));
        const completeBtn = document.createElement("button");
        completeBtn.className = "btn btn-secondary btn-sm";
        completeBtn.textContent = "סמן כהושלם";
        completeBtn.addEventListener("click", () => updateBookingStatus(b.id, "completed"));
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn btn-danger btn-sm";
        cancelBtn.textContent = "ביטול";
        cancelBtn.addEventListener("click", () => updateBookingStatus(b.id, "cancelled"));
        actionsTd.appendChild(startBtn);
        actionsTd.appendChild(completeBtn);
        actionsTd.appendChild(cancelBtn);
      }
      if (b.status !== "cancelled") {
        const report = (b.visit_reports && b.visit_reports[0]) || null;
        const reportBtn = document.createElement("button");
        reportBtn.className = "btn btn-secondary btn-sm";
        reportBtn.textContent = report ? "עריכת דוח" : "דוח ביקור";
        reportBtn.addEventListener("click", () => openVisitReportModal(b, report));
        actionsTd.appendChild(reportBtn);
      }
      tbody.appendChild(tr);
    });
  });
}

// מונע תגובה מיושנת (חיפוש/טעינה קודמים, איטיים ברשת) מלדרוס תוצאה חדשה יותר —
// אותו דפוס בדיוק כמו loadSlotsToken ב-booking.html.
let workQueueRequestToken = 0;

async function loadBookings() {
  const requestToken = ++workQueueRequestToken;
  const container = document.getElementById("work-queue");
  container.innerHTML = `<div class="loading-row"><span class="spinner spinner-dark"></span><span>טוען...</span></div>`;
  const searchInput = document.getElementById("work-queue-search");
  if (searchInput) searchInput.value = "";

  const from = new Date(); from.setDate(from.getDate() - WORK_QUEUE_DAYS_BACK); from.setHours(0, 0, 0, 0);
  const to = new Date(); to.setDate(to.getDate() + WORK_QUEUE_DAYS_FORWARD); to.setHours(23, 59, 59, 999);

  let data, error;
  try {
    ({ data, error } = await supabaseClient
      .from("bookings")
      .select("*, patients(full_name, phone), medical_staff(full_name, role), visit_reports(*)")
      .gte("scheduled_at", from.toISOString())
      .lte("scheduled_at", to.toISOString())
      .order("scheduled_at", { ascending: false }));
  } catch (err) {
    error = err;
  }
  if (error) {
    if (requestToken !== workQueueRequestToken) return;
    container.innerHTML = `<p style="color:var(--danger);">${friendlyErrorMessage(error)}</p>`;
    return;
  }
  const { riskByPatient, patientsWithOpenTask } = await fetchRiskAndTasks();
  if (requestToken !== workQueueRequestToken) return;
  renderWorkQueueBuckets(container, data, riskByPatient, patientsWithOpenTask);
}

// חיפוש בתור העבודה: לא מסנן על מה שכבר נטען (חלון תאריכים בלבד) — שאילתת שרת
// עצמאית לפי שם/טלפון/ת.ז. מטופל, בלי הגבלת תאריך, כדי למצוא כל דבר גם מחוץ לחלון
// — ה"escape hatch" שמונע חיפוש בטבלה שטוחה של אלפי מטופלים.
async function searchWorkQueue(raw) {
  const q = raw.trim().replace(/[,()]/g, "");
  if (!q) { loadBookings(); return; }
  const requestToken = ++workQueueRequestToken;
  const container = document.getElementById("work-queue");
  container.innerHTML = `<div class="loading-row"><span class="spinner spinner-dark"></span><span>מחפש...</span></div>`;
  const { data: patients, error: patientsError } = await supabaseClient
    .from("patients")
    .select("id")
    .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,national_id.ilike.%${q}%`)
    .limit(20);
  if (requestToken !== workQueueRequestToken) return;
  if (patientsError) { container.innerHTML = `<p style="color:var(--danger);">${friendlyErrorMessage(patientsError)}</p>`; return; }
  if (!patients || !patients.length) { container.innerHTML = `<p class="empty-state">לא נמצא מטופל מתאים</p>`; return; }
  const { data, error } = await supabaseClient
    .from("bookings")
    .select("*, patients(full_name, phone), medical_staff(full_name, role), visit_reports(*)")
    .in("patient_id", patients.map((p) => p.id))
    .order("scheduled_at", { ascending: false })
    .limit(200);
  if (requestToken !== workQueueRequestToken) return;
  if (error) { container.innerHTML = `<p style="color:var(--danger);">${friendlyErrorMessage(error)}</p>`; return; }
  const { riskByPatient, patientsWithOpenTask } = await fetchRiskAndTasks();
  if (requestToken !== workQueueRequestToken) return;
  renderWorkQueueBuckets(container, data, riskByPatient, patientsWithOpenTask);
}

let workQueueSearchDebounce = null;
document.getElementById("work-queue-search").addEventListener("input", (e) => {
  clearTimeout(workQueueSearchDebounce);
  const value = e.target.value;
  workQueueSearchDebounce = setTimeout(() => searchWorkQueue(value), 300);
});

async function updateBookingStatus(id, status) {
  hideError(appError);
  let error;
  try {
    ({ error } = await supabaseClient.from("bookings").update({ status }).eq("id", id));
  } catch (err) {
    error = err;
  }
  if (error) { showError(appError, friendlyErrorMessage(error)); return; }
  flashSuccess("הסטטוס עודכן");
  loadBookings();
  if (window.currentPatientState) {
    prInvalidate("bookings", "visitReports", "currentRisk", "alerts", "tasks");
    const activeBtn = document.querySelector(".pr-tab-btn.active");
    if (activeBtn) prSwitchTab(activeBtn.dataset.tab);
  }
}
