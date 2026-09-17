// ===== תיק מטופל (Patient Medical Record) — הוצא מ-admin.html לצורך תחזוקה =====
// חיפוש, כותרת, 11 לשוניות, "מי דורש תשומת לב עכשיו", יצירת התראות. כל הקריאות
// ל-Supabase עוברות דרך RLS הקיים (admin-only לרוב הטבלאות החדשות, ראה migration).
// מטמון בזיכרון (window.currentPatientState, ר' app.js) מונע קריאת רשת חוזרת בין
// לשוניות של אותו תיק פתוח.
//
// Classic script בכוונה (לא <script type="module">) — אותו נימוק כמו js/admin/
// staff.js/patients.js/capacity.js: נטען לפני admin.html, חולק scope עליון עם
// app.js/config.js ועם שאר js/admin/*.js. openVisitReportModal/loadCurrentRiskForPatient/
// flashSuccess/flashError (מוגדרים ב-admin.html עצמו, בבלוק שנשאר שם — דוח ביקור לא
// הופרד עדיין בכוונה) נקראים רק בזמן ריצה מאוחר (לחיצת כפתור/טעינת לשונית), אחרי
// שהכל כבר נטען — forward reference בטוח, אותו דפוס שכבר אומת 3 פעמים.
//
// ⚠️ הערה טכנית חשובה שהתגלתה במיפוי לפני ההפרדה: PR_TABS למטה בונה מערך שמחזיק
// הפניה ישירה (לא קריאה, רק הפניה לשם הפונקציה) לכל 11 פונקציות ה-render — הפניה כזו
// מתבצעת "בשקיקה" (ברגע שהשורה עצמה רצה), לא רק בזמן קריאה בפועל. זו הסיבה שכל הבלוק
// הזה נשאר קובץ אחד ולא פוצל לכמה קבצים לפי לשונית: אם PR_TABS היה בקובץ נפרד שנטען
// לפני שכל 11 הפונקציות כבר קיימות, זו הייתה ReferenceError בטעינה. בתוך קובץ אחד זה
// לא בעיה כי כל ה-function-declarations (לא const-arrow) עוברות hoisting מלא.

// ----- חיפוש -----
let prSearchTimer = null;
document.getElementById("patient-search-input").addEventListener("input", () => {
  clearTimeout(prSearchTimer);
  prSearchTimer = setTimeout(prRunSearch, 300);
});

async function prRunSearch() {
  const raw = document.getElementById("patient-search-input").value.trim();
  const resultsEl = document.getElementById("patient-search-results");
  if (!raw) { resultsEl.innerHTML = ""; return; }
  const q = raw.replace(/[,()]/g, "");
  showLoadingRow(resultsEl, "מחפש...");
  const { data, error } = await supabaseClient
    .from("patients")
    .select("id, full_name, phone, national_id")
    .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,national_id.ilike.%${q}%`)
    .limit(10);
  if (error) { resultsEl.innerHTML = `<p style="color:var(--danger);">${friendlyErrorMessage(error)}</p>`; return; }
  if (!data || data.length === 0) { resultsEl.innerHTML = `<p style="color:var(--text-muted);">לא נמצאו מטופלים.</p>`; return; }
  resultsEl.innerHTML = "";
  data.forEach((p) => {
    const row = document.createElement("div");
    row.className = "pr-search-result";
    row.innerHTML = `<span>${escapeHtml(p.full_name)}</span><span style="color:var(--text-muted); font-size:13px;">${escapeHtml(p.phone || "")}${p.national_id ? " · " + escapeHtml(p.national_id) : ""}</span>`;
    row.addEventListener("click", () => openPatientRecord(p.id));
    resultsEl.appendChild(row);
  });
}

// ----- פתיחת תיק -----
async function openPatientRecord(patientId) {
  prResetState(patientId);
  document.getElementById("patient-search-results").innerHTML = "";
  document.getElementById("patient-search-input").value = "";
  document.getElementById("pr-record").style.display = "block";
  document.getElementById("pr-header").innerHTML = `<p style="color:var(--text-muted);">טוען תיק...</p>`;
  document.getElementById("pr-allergy-banner").style.display = "none";
  try {
    await prRenderHeader();
  } catch (err) {
    document.getElementById("pr-header").innerHTML = `<p style="color:var(--danger);">${friendlyErrorMessage(err)}</p>`;
    return;
  }
  prRenderTabsNav();
  prSwitchTab("overview");
  document.getElementById("pr-record").scrollIntoView({ behavior: "smooth", block: "start" });
}

// prFetch* (patient/allergies/medicalHistory/bookings/visitReports/medications/
// servicePlans/clinicalNotes/documents/alerts/tasks) עברו ל-app.js — משותפים
// עם employee.html, לא מוכפלים יותר.

// ----- כותרת + באנר רגישויות -----
async function prRenderHeader() {
  const patient = await prCached("patient", prFetchPatient);
  const allergies = await prCached("allergies", prFetchAllergies);
  const banner = document.getElementById("pr-allergy-banner");
  if (allergies.length) {
    banner.style.display = "block";
    banner.className = "pr-allergy-banner";
    banner.innerHTML = "⚠️ רגישויות: " + allergies.map((a) => `${escapeHtml(a.substance)}${a.severity ? " (" + SEVERITY_LABELS[a.severity] + ")" : ""}`).join(", ");
  } else {
    banner.style.display = "none";
  }
  const age = calcAge(patient.date_of_birth);
  const fields = [
    ["שם מלא", patient.full_name],
    ["ת.ז.", patient.national_id || "—"],
    ["תאריך לידה", patient.date_of_birth ? formatDateHe(new Date(patient.date_of_birth)) : "—"],
    ["גיל", age !== null ? age : "—"],
    ["טלפון", patient.phone || "—"],
    ["כתובת", patient.address || "—"],
    ["איש קשר לחירום", patient.emergency_contact_name ? `${patient.emergency_contact_name}${patient.emergency_contact_phone ? " · " + patient.emergency_contact_phone : ""}` : "—"],
    ["רקע רפואי", conditionsLabel(patient.background_conditions) || "—"],
    ["עישון", smokingStatusLabel(patient.smoking_status) || "—"],
  ];
  document.getElementById("pr-header").innerHTML = `
    <div class="pr-header-grid">
      ${fields.map(([label, value]) => `<div class="pr-header-field"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(String(value))}</div></div>`).join("")}
    </div>
    <div class="actions-row" style="justify-content:flex-start; margin-top:12px;">
      <button class="btn btn-secondary btn-sm" id="pr-edit-header-btn">עריכת פרטי קשר</button>
    </div>
  `;
  document.getElementById("pr-edit-header-btn").addEventListener("click", prOpenEditHeaderModal);
}

function prOpenEditHeaderModal() {
  const p = window.currentPatientState.patient;
  document.getElementById("pr-header-national-id").value = p.national_id || "";
  document.getElementById("pr-header-emergency-name").value = p.emergency_contact_name || "";
  document.getElementById("pr-header-emergency-phone").value = p.emergency_contact_phone || "";
  hideError(document.getElementById("pr-header-modal-error"));
  document.getElementById("pr-header-modal").style.display = "flex";
}
document.getElementById("pr-header-modal-cancel").addEventListener("click", () => {
  document.getElementById("pr-header-modal").style.display = "none";
});
document.getElementById("pr-header-modal-save").addEventListener("click", async () => {
  const errEl = document.getElementById("pr-header-modal-error");
  hideError(errEl);
  const btn = document.getElementById("pr-header-modal-save");
  setButtonLoading(btn, true, "שומר...");
  const { error } = await supabaseClient.from("patients").update({
    national_id: document.getElementById("pr-header-national-id").value || null,
    emergency_contact_name: document.getElementById("pr-header-emergency-name").value || null,
    emergency_contact_phone: document.getElementById("pr-header-emergency-phone").value || null,
  }).eq("id", window.currentPatientState.patientId);
  setButtonLoading(btn, false);
  if (error) { showError(errEl, friendlyErrorMessage(error)); return; }
  document.getElementById("pr-header-modal").style.display = "none";
  prInvalidate("patient");
  flashSuccess("פרטי הקשר עודכנו");
  await prRenderHeader();
});

// ----- לשוניות -----
const PR_TABS = [
  { key: "overview", label: "סקירה", render: prRenderOverviewTab },
  { key: "visits", label: "ביקורים", render: prRenderVisitsTab },
  { key: "vitals", label: "מדדים", render: prRenderVitalsTab },
  { key: "history", label: "היסטוריה רפואית", render: prRenderHistoryTab },
  { key: "meds", label: "תרופות וטיפולים", render: prRenderMedsTab },
  { key: "plan", label: "תוכנית שירות", render: prRenderPlanTab },
  { key: "appointments", label: "תורים", render: prRenderAppointmentsTab },
  { key: "notes", label: "הערות קליניות", render: prRenderNotesTab },
  { key: "documents", label: "מסמכים", render: prRenderDocumentsTab },
  { key: "alerts", label: "התראות ומשימות", render: prRenderAlertsTab },
  { key: "timeline", label: "ציר זמן", render: prRenderTimelineTab },
];

function prRenderTabsNav() {
  const nav = document.getElementById("pr-tabs");
  nav.innerHTML = "";
  PR_TABS.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pr-tab-btn";
    btn.textContent = t.label;
    btn.dataset.tab = t.key;
    btn.addEventListener("click", () => prSwitchTab(t.key));
    nav.appendChild(btn);
  });
}

async function prSwitchTab(key) {
  document.querySelectorAll(".pr-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === key));
  const content = document.getElementById("pr-tab-content");
  content.innerHTML = `<p style="color:var(--text-muted);">טוען...</p>`;
  const tab = PR_TABS.find((t) => t.key === key);
  try {
    await tab.render(content);
  } catch (err) {
    content.innerHTML = `<p style="color:var(--danger);">${friendlyErrorMessage(err)}</p>`;
  }
}

// ----- סקירה -----
// סדר עדיפות חזותי מכוון: מי המטופל (בכותרת מעל הלשוניות, כבר גלוי) → מדדים אחרונים
// → רמת סיכון → התראות/פעולות נדרשות → ביקור אחרון/הבא → מידע מנהלי (תרופות קבועות).
// מידע רפואי-קליני תמיד עם עדיפות חזותית גבוהה יותר ממידע מנהלי (כרטיס גדול/צבעוני
// למעלה, לוח זמנים ומידע רקע קטן ומאופק יותר למטה).
async function prRenderOverviewTab(content) {
  const state = window.currentPatientState;
  const [currentRisk, bookings, alerts, tasks, medHistory, visits] = await Promise.all([
    prCached("currentRisk", () => loadCurrentRiskForPatient(state.patientId)),
    prCached("bookings", prFetchBookings),
    prCached("alerts", prFetchAlerts),
    prCached("tasks", prFetchTasks),
    prCached("medicalHistory", prFetchMedicalHistory),
    prCached("visitReports", prFetchVisitReports),
  ]);
  const now = new Date();
  const upcoming = bookings.filter((b) => b.status === "scheduled" && new Date(b.scheduled_at) >= now).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const past = bookings.filter((b) => new Date(b.scheduled_at) < now).sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
  const openAlerts = alerts.filter((a) => a.status === "open");
  const openTasks = tasks.filter((t) => t.status === "pending").sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  const latestVisit = visits[0];

  const riskStatusClass = currentRisk ? `caregiver-status-${currentRisk.risk_level in CAREGIVER_STATUS_BY_LEVEL ? currentRisk.risk_level : "no_data"}` : "";
  const riskCardTone = currentRisk?.risk_level === "red" ? "border: 1.5px solid var(--danger);" : "";

  let html = "";

  // 1. מדדים אחרונים
  html += `<div class="pr-card"><h3 style="margin-top:0;">מדדים אחרונים</h3>`;
  if (latestVisit) {
    const vitalsSummary = VITALS_META.filter((m) => latestVisit[m.key] != null);
    html += `<div style="color:var(--text-muted); font-size:12px; margin-bottom:6px;">${formatDateHe(new Date(latestVisit.visit_date))} ${formatTimeHe(new Date(latestVisit.visit_date))}</div>`;
    html += vitalsSummary.length
      ? `<div style="display:flex; flex-wrap:wrap; gap:14px;">${vitalsSummary.map((v) => `<div><div style="font-size:12px; color:var(--text-muted);">${v.label}</div><div style="font-weight:700;">${latestVisit[v.key]}${v.unit}</div></div>`).join("")}</div>`
      : `<span style="color:var(--text-muted);">לא נמדדו מדדים בביקור האחרון</span>`;
  } else {
    html += `<span style="color:var(--text-muted);">אין עדיין מדידות</span>`;
  }
  html += `</div>`;

  // 2. רמת סיכון — הכרטיס הבולט ביותר בעמוד
  html += `
    <div class="pr-card" style="${riskCardTone}">
      <h3 style="margin-top:0;">רמת סיכון נוכחית</h3>
      ${currentRisk
        ? `<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">${riskBadgeHtml(currentRisk)}<strong class="${riskStatusClass}" style="font-size:15px;">${escapeHtml(caregiverStatusMessage(currentRisk.risk_level, currentRisk.trend))}</strong></div>`
        : `<span style="color:var(--text-muted);">אין הערכת סיכון עדכנית</span>`}
      <p style="color:var(--text-muted); font-size:12px; margin:8px 0 0;">${RISK_DISCLAIMER}</p>
    </div>
  `;

  // 3. התראות ופעולות נדרשות — פעילים, לא רק מונה
  html += `<div class="pr-card"><h3 style="margin-top:0;">פעולות נדרשות</h3>`;
  if (!openAlerts.length && !openTasks.length) {
    html += `<span style="color:var(--text-muted);">אין פעולות פתוחות כרגע</span>`;
  } else {
    openAlerts.forEach((a) => {
      html += `<div style="margin-bottom:4px;"><span class="pr-badge pr-badge-${a.severity}">${ALERT_TYPE_LABELS[a.alert_type] || a.alert_type}</span> ${escapeHtml(a.message)}</div>`;
    });
    openTasks.slice(0, 5).forEach((t) => {
      const overdue = new Date(t.due_at) < now;
      html += `<div style="margin-bottom:4px;">${overdue ? "⏰ באיחור — " : "🕓 "}${escapeHtml(t.title)} (${formatDateHe(new Date(t.due_at))} ${formatTimeHe(new Date(t.due_at))})</div>`;
    });
  }
  html += `<button class="btn btn-ghost btn-sm" id="pr-overview-go-alerts" style="margin-top:6px;">מעבר להתראות ומשימות</button></div>`;

  // 4. ביקורים — הקשר תזמוני
  html += `
    <div class="pr-card">
      <div style="display:flex; gap:24px; flex-wrap:wrap;">
        <div><div style="font-size:12px; color:var(--text-muted);">ביקור אחרון</div><div style="font-weight:600;">${past[0] ? formatDateHe(new Date(past[0].scheduled_at)) + " " + formatTimeHe(new Date(past[0].scheduled_at)) : "—"}</div></div>
        <div><div style="font-size:12px; color:var(--text-muted);">ביקור הבא</div><div style="font-weight:600;">${upcoming[0] ? formatDateHe(new Date(upcoming[0].scheduled_at)) + " " + formatTimeHe(new Date(upcoming[0].scheduled_at)) : "—"}</div></div>
      </div>
    </div>
  `;

  // 5. מידע מנהלי/רקע — הכי פחות בולט
  if (medHistory && (medHistory.current_medications || []).length) {
    html += `<div class="pr-card" style="color:var(--text-muted); font-size:13px;"><strong style="color:var(--text);">תרופות קבועות:</strong> ${medHistory.current_medications.map((m) => escapeHtml(m)).join(", ")}</div>`;
  }

  content.innerHTML = html;
  document.getElementById("pr-overview-go-alerts")?.addEventListener("click", () => prSwitchTab("alerts"));
}

// ----- ביקורים -----
async function prRenderVisitsTab(content) {
  const [visits, bookings] = await Promise.all([
    prCached("visitReports", prFetchVisitReports),
    prCached("bookings", prFetchBookings),
  ]);
  if (!visits.length) { content.innerHTML = `<div class="empty-state">אין עדיין ביקורים מתועדים</div>`; return; }
  content.innerHTML = visits.map((v) => {
    const booking = bookings.find((b) => b.id === v.booking_id);
    const vitalsSummary = VITALS_META.filter((m) => v[m.key] != null).map((m) => `${m.label}: ${v[m.key]}${m.unit}`).join(" · ");
    const procs = PROCEDURE_META.filter((p) => v[p.key]).map((p) => p.label).join(", ");
    return `
      <div class="pr-card">
        <div class="section-header">
          <strong>${formatDateHe(new Date(v.visit_date))} ${formatTimeHe(new Date(v.visit_date))}</strong>
          <span style="color:var(--text-muted); font-size:13px;">${escapeHtml(booking?.medical_staff?.full_name || "")}</span>
        </div>
        ${vitalsSummary ? `<div style="font-size:13px; margin-top:4px;">${vitalsSummary}</div>` : ""}
        ${procs ? `<div style="font-size:13px; color:var(--text-muted); margin-top:2px;">פעולות: ${escapeHtml(procs)}</div>` : ""}
        ${v.treatment_summary ? `<div style="font-size:13px; margin-top:4px;">${escapeHtml(v.treatment_summary)}</div>` : ""}
        <button class="btn btn-secondary btn-sm pr-visit-open" data-visit-id="${v.id}" style="margin-top:8px;">פתיחת הדוח המלא</button>
        ${clinicalOutcomeSelectHtml(v)}
      </div>
    `;
  }).join("");
  content.querySelectorAll(".pr-visit-open").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = visits.find((r) => r.id === Number(btn.dataset.visitId));
      const booking = bookings.find((b) => b.id === v.booking_id);
      if (booking) openVisitReportModal(booking, v);
    });
  });
  bindClinicalOutcomeSelects(content, visits);
}

// ===== תיעוד תוצאה קלינית בדיעבד — הדאטה המתויג היחיד שחסר כדי שמודל 6
// (predictive-service/ml_targets.py) יוכל בכלל להתחיל להתאמן פעם בעתיד. =====
const CLINICAL_OUTCOME_OPTIONS = [
  { value: "", label: "טרם תועד" },
  { value: "none", label: "תקין — לא קרה כלום חריג" },
  { value: "hypoglycemia", label: "היפוגליקמיה" },
  { value: "severe_hyperglycemia", label: "היפרגליקמיה חמורה" },
  { value: "respiratory_deterioration", label: "החמרה נשימתית" },
  { value: "hemodynamic_deterioration", label: "החמרה המודינמית (כולל הלם)" },
];

function clinicalOutcomeSelectHtml(v) {
  const options = CLINICAL_OUTCOME_OPTIONS.map(
    (o) => `<option value="${o.value}" ${(v.clinical_outcome_8h || "") === o.value ? "selected" : ""}>${o.label}</option>`
  ).join("");
  return `
    <div class="field" style="margin-top:10px;">
      <label style="font-size:12px; color:var(--text-muted);">תוצאה קלינית בתוך כ-8 שעות מהביקור (לתיעוד בדיעבד)</label>
      <div style="display:flex; align-items:center; gap:8px;">
        <select class="pr-outcome-select" data-visit-id="${v.id}" style="max-width:320px;">${options}</select>
        <span class="pr-outcome-saved" data-visit-id="${v.id}" style="font-size:12px; color:var(--success); display:none;">✓ נשמר</span>
      </div>
      <div class="error-msg pr-outcome-error" data-visit-id="${v.id}" role="alert" aria-live="assertive"></div>
    </div>
  `;
}

function bindClinicalOutcomeSelects(content, visits) {
  content.querySelectorAll(".pr-outcome-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const visitId = Number(sel.dataset.visitId);
      const errEl = content.querySelector(`.pr-outcome-error[data-visit-id="${visitId}"]`);
      const savedEl = content.querySelector(`.pr-outcome-saved[data-visit-id="${visitId}"]`);
      hideError(errEl);
      const newVal = sel.value || null;
      const { error } = await supabaseClient.from("visit_reports").update({ clinical_outcome_8h: newVal }).eq("id", visitId);
      if (error) {
        showError(errEl, friendlyErrorMessage(error));
        return;
      }
      const v = visits.find((r) => r.id === visitId);
      if (v) v.clinical_outcome_8h = newVal;
      prInvalidate("visitReports");
      savedEl.style.display = "inline";
      setTimeout(() => { savedEl.style.display = "none"; }, 2000);
    });
  });
}

// ----- מדדים -----
function prVitalChartSvg(points) {
  if (points.length < 2) return `<p style="color:var(--text-muted);">אין מספיק נתונים לגרף.</p>`;
  const width = 560, height = 160, pad = 24;
  const values = points.map((p) => p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / (points.length - 1);
  const xy = (p, i) => [pad + i * stepX, height - pad - ((p.value - min) / range) * (height - pad * 2)];
  const coords = points.map((p, i) => xy(p, i).map((n) => n.toFixed(1)).join(",")).join(" ");
  const circles = points.map((p, i) => { const [x, y] = xy(p, i); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#2f7d6e" />`; }).join("");
  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%; max-width:${width}px; height:${height}px;">
      <polyline points="${coords}" fill="none" stroke="#2f7d6e" stroke-width="2" />
      ${circles}
      <text x="2" y="14" font-size="11" fill="#5b6a67">${max}</text>
      <text x="2" y="${height - 6}" font-size="11" fill="#5b6a67">${min}</text>
    </svg>
  `;
}

async function prRenderVitalsTab(content) {
  const visits = await prCached("visitReports", prFetchVisitReports);
  if (!visits.length) { content.innerHTML = `<div class="empty-state">אין עדיין מדידות למטופל זה</div>`; return; }
  const latest = visits[0];
  const latestHtml = VITALS_META.filter((v) => latest[v.key] != null).map((v) => `<div>${v.label}: <strong>${latest[v.key]}${v.unit}</strong></div>`).join("");
  const vitalsWithData = VITALS_META.filter((v) => visits.some((r) => r[v.key] != null));

  content.innerHTML = `
    <div class="pr-card"><h3>מדידה אחרונה (${formatDateHe(new Date(latest.visit_date))} ${formatTimeHe(new Date(latest.visit_date))})</h3>${latestHtml}</div>
    <div class="pr-card">
      <div class="field" style="max-width:260px;">
        <label for="pr-vitals-select">בחירת מדד לגרף</label>
        <select id="pr-vitals-select">${vitalsWithData.map((v) => `<option value="${v.key}">${v.label}</option>`).join("")}</select>
      </div>
      <div id="pr-vitals-chart"></div>
    </div>
    <div id="pr-vitals-baseline"><p style="color:var(--text-muted);">טוען ניתוח בסיס אישי...</p></div>
  `;

  const renderChartFor = (key) => {
    const points = visits.filter((r) => r[key] != null).slice().sort((a, b) => new Date(a.visit_date) - new Date(b.visit_date)).map((r) => ({ value: r[key] }));
    document.getElementById("pr-vitals-chart").innerHTML = prVitalChartSvg(points);
  };
  const selectEl = document.getElementById("pr-vitals-select");
  if (vitalsWithData.length) {
    renderChartFor(vitalsWithData[0].key);
    selectEl.addEventListener("change", () => renderChartFor(selectEl.value));
  }

  const baselineEl = document.getElementById("pr-vitals-baseline");
  const rows = [];
  for (const v of vitalsWithData) {
    const points = visits.filter((r) => r[v.key] != null).map((r) => ({ measured_at: r.visit_date, value: r[v.key] }));
    if (points.length < 2) continue;
    try {
      const res = await fetch(`${PREDICTIVE_SERVICE_URL}/predict/baseline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vital: v.key, points }) });
      if (!res.ok) continue;
      const b = await res.json();
      rows.push(`<tr><td>${v.label}</td><td>${b.baseline ?? "—"}</td><td>${b.latest_value ?? "—"}</td><td>${b.deviation ?? "—"}</td><td>${b.worsening_trend ? "מגמת החמרה" : b.sudden_change ? "שינוי חד" : "—"}</td></tr>`);
    } catch (err) { /* predictive-service לא זמין — מדלגים על הניתוח, המדידות הגולמיות כבר מוצגות למעלה */ }
  }
  baselineEl.innerHTML = rows.length
    ? `<h3>בסיס אישי (Baseline)</h3><table class="admin-table"><thead><tr><th>מדד</th><th>בסיס</th><th>נוכחי</th><th>סטייה</th><th>דגלים</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
    : `<p style="color:var(--text-muted);">אין עדיין מספיק היסטוריה לניתוח בסיס אישי.</p>`;
}

// ----- היסטוריה רפואית + רגישויות -----
function prRenderAllergiesList() {
  const allergies = window.currentPatientState.allergies || [];
  const listEl = document.getElementById("pr-allergies-list");
  if (!listEl) return;
  listEl.innerHTML = allergies.length ? allergies.map((a) => `
    <div class="pr-card" style="margin-bottom:6px;">
      <strong>${escapeHtml(a.substance)}</strong> ${a.severity ? `<span class="pr-badge pr-badge-${a.severity === "severe" ? "high" : a.severity === "moderate" ? "medium" : "low"}">${SEVERITY_LABELS[a.severity]}</span>` : ""}
      ${a.reaction ? `<div style="color:var(--text-muted); font-size:13px;">תגובה: ${escapeHtml(a.reaction)}</div>` : ""}
    </div>
  `).join("") : `<p style="color:var(--text-muted);">לא דווחו רגישויות.</p>`;
}

async function prRenderHistoryTab(content) {
  const h = await prCached("medicalHistory", prFetchMedicalHistory);
  const val = (arr) => (arr || []).join(", ");
  content.innerHTML = `
    <div class="pr-card">
      <h3>אנמנזה</h3>
      <div class="field"><label for="pr-hist-surgeries">ניתוחים קודמים (מופרדים בפסיקים)</label><input type="text" id="pr-hist-surgeries" value="${escapeHtml(val(h?.previous_surgeries))}"></div>
      <div class="field"><label for="pr-hist-hosp">אשפוזים קודמים (מופרדים בפסיקים)</label><input type="text" id="pr-hist-hosp" value="${escapeHtml(val(h?.previous_hospitalizations))}"></div>
      <div class="field"><label for="pr-hist-meds">תרופות קבועות (מופרדות בפסיקים)</label><input type="text" id="pr-hist-meds" value="${escapeHtml(val(h?.current_medications))}"></div>
      <div class="field"><label for="pr-hist-family">היסטוריה משפחתית</label><textarea id="pr-hist-family">${escapeHtml(h?.family_history || "")}</textarea></div>
      <div class="field"><label for="pr-hist-functional">מצב תפקודי</label><input type="text" id="pr-hist-functional" value="${escapeHtml(h?.functional_status || "")}"></div>
      <div class="field"><label for="pr-hist-mobility">ניידות</label><input type="text" id="pr-hist-mobility" value="${escapeHtml(h?.mobility || "")}"></div>
      <div class="field"><label for="pr-hist-nutrition">הערות תזונה</label><input type="text" id="pr-hist-nutrition" value="${escapeHtml(h?.nutrition_notes || "")}"></div>
      <div class="field"><label for="pr-hist-additional">הערות נוספות</label><textarea id="pr-hist-additional">${escapeHtml(h?.additional_notes || "")}</textarea></div>
      <div class="error-msg" id="pr-hist-error" role="alert" aria-live="assertive"></div>
      <button class="btn btn-primary btn-sm" id="pr-hist-save">שמירה</button>
    </div>
    <div class="pr-card">
      <h3>רגישויות ואלרגיות</h3>
      <div id="pr-allergies-list"></div>
      <div class="field"><label for="pr-allergy-substance">חומר/תרופה</label><input type="text" id="pr-allergy-substance"></div>
      <div class="field"><label for="pr-allergy-reaction">תגובה</label><input type="text" id="pr-allergy-reaction"></div>
      <div class="field"><label for="pr-allergy-severity">חומרה</label>
        <select id="pr-allergy-severity"><option value="">—</option><option value="mild">קלה</option><option value="moderate">בינונית</option><option value="severe">חמורה</option></select>
      </div>
      <div class="error-msg" id="pr-allergy-error" role="alert" aria-live="assertive"></div>
      <button class="btn btn-secondary btn-sm" id="pr-allergy-add">הוספת רגישות</button>
    </div>
  `;
  prRenderAllergiesList();

  document.getElementById("pr-hist-save").addEventListener("click", async () => {
    const errEl = document.getElementById("pr-hist-error");
    hideError(errEl);
    const split = (id) => document.getElementById(id).value.split(",").map((s) => s.trim()).filter(Boolean);
    const { data: { session } } = await supabaseClient.auth.getSession();
    const payload = {
      patient_id: window.currentPatientState.patientId,
      previous_surgeries: split("pr-hist-surgeries"),
      previous_hospitalizations: split("pr-hist-hosp"),
      current_medications: split("pr-hist-meds"),
      family_history: document.getElementById("pr-hist-family").value || null,
      functional_status: document.getElementById("pr-hist-functional").value || null,
      mobility: document.getElementById("pr-hist-mobility").value || null,
      nutrition_notes: document.getElementById("pr-hist-nutrition").value || null,
      additional_notes: document.getElementById("pr-hist-additional").value || null,
      updated_by: session?.user?.id || null,
    };
    const btn = document.getElementById("pr-hist-save");
    setButtonLoading(btn, true, "שומר...");
    const { error } = await supabaseClient.from("patient_medical_history").upsert(payload, { onConflict: "patient_id" });
    setButtonLoading(btn, false);
    if (error) { showError(errEl, friendlyErrorMessage(error)); return; }
    prInvalidate("medicalHistory");
    flashSuccess("היסטוריה רפואית נשמרה");
  });

  document.getElementById("pr-allergy-add").addEventListener("click", async () => {
    const errEl = document.getElementById("pr-allergy-error");
    hideError(errEl);
    const substance = document.getElementById("pr-allergy-substance").value.trim();
    if (!substance) { showError(errEl, "יש להזין שם חומר/תרופה"); return; }
    const { data: { session } } = await supabaseClient.auth.getSession();
    const btn = document.getElementById("pr-allergy-add");
    setButtonLoading(btn, true, "מוסיף...");
    const { error } = await supabaseClient.from("patient_allergies").insert({
      patient_id: window.currentPatientState.patientId,
      substance,
      reaction: document.getElementById("pr-allergy-reaction").value || null,
      severity: document.getElementById("pr-allergy-severity").value || null,
      created_by: session?.user?.id || null,
    });
    setButtonLoading(btn, false);
    if (error) { showError(errEl, friendlyErrorMessage(error)); return; }
    prInvalidate("allergies");
    await prRenderHeader();
    prSwitchTab("history");
  });
}

// ----- תרופות וטיפולים -----
async function prRenderMedsTab(content) {
  const meds = await prCached("medications", prFetchMedications);
  content.innerHTML = `
    <div class="pr-card">
      <h3>תיעוד מתן</h3>
      <div class="field"><label for="pr-med-name">שם התרופה/טיפול</label><input type="text" id="pr-med-name"></div>
      <div class="field"><label for="pr-med-dose">מינון</label><input type="text" id="pr-med-dose"></div>
      <div class="field"><label for="pr-med-route">נתיב מתן</label>
        <select id="pr-med-route"><option value="">—</option>${Object.entries(ROUTE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      </div>
      <div class="field"><label for="pr-med-notes">הערות</label><input type="text" id="pr-med-notes"></div>
      <div class="error-msg" id="pr-med-error" role="alert" aria-live="assertive"></div>
      <button class="btn btn-primary btn-sm" id="pr-med-add">תיעוד מתן</button>
    </div>
    ${meds.length ? `<table class="admin-table"><thead><tr><th>תאריך</th><th>תרופה</th><th>מינון</th><th>נתיב</th><th>הערות</th></tr></thead><tbody>
      ${meds.map((m) => `<tr><td>${formatDateHe(new Date(m.administered_at))} ${formatTimeHe(new Date(m.administered_at))}</td><td>${escapeHtml(m.medication_name)}</td><td>${escapeHtml(m.dose || "—")}</td><td>${ROUTE_LABELS[m.route] || "—"}</td><td>${escapeHtml(m.notes || "—")}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty-state">לא תועדו טיפולים/תרופות</div>`}
  `;
  document.getElementById("pr-med-add").addEventListener("click", async () => {
    const errEl = document.getElementById("pr-med-error");
    hideError(errEl);
    const name = document.getElementById("pr-med-name").value.trim();
    if (!name) { showError(errEl, "יש להזין שם תרופה/טיפול"); return; }
    const { data: { session } } = await supabaseClient.auth.getSession();
    const btn = document.getElementById("pr-med-add");
    setButtonLoading(btn, true, "שומר...");
    const { error } = await supabaseClient.from("medication_events").insert({
      patient_id: window.currentPatientState.patientId,
      medication_name: name,
      dose: document.getElementById("pr-med-dose").value || null,
      route: document.getElementById("pr-med-route").value || null,
      notes: document.getElementById("pr-med-notes").value || null,
      created_by: session?.user?.id || null,
    });
    setButtonLoading(btn, false);
    if (error) { showError(errEl, friendlyErrorMessage(error)); return; }
    prInvalidate("medications");
    flashSuccess("התיעוד נשמר");
    prSwitchTab("meds");
  });
}

// ----- תוכנית שירות -----
function prRenderPlanList(plans) {
  const listEl = document.getElementById("pr-plan-list");
  if (!plans.length) { listEl.innerHTML = `<div class="empty-state">אין תוכניות שירות</div>`; return; }
  listEl.innerHTML = plans.map((p) => `
    <div class="pr-card">
      <div class="section-header">
        <strong>${escapeHtml(p.service_type)}</strong>
        <span class="pr-badge pr-badge-${p.status === "active" ? "resolved" : p.status === "cancelled" ? "high" : "medium"}">${SERVICE_PLAN_STATUS_LABELS[p.status]}</span>
      </div>
      <div style="color:var(--text-muted); font-size:13px;">
        ${formatDateHe(new Date(p.start_date))}${p.end_date ? " – " + formatDateHe(new Date(p.end_date)) : ""} ·
        ${(p.preferred_weekdays || []).map((d) => WEEKDAY_SHORT[d]).join(", ") || "—"} ${p.preferred_time ? "· " + p.preferred_time.slice(0, 5) : ""}
      </div>
      ${p.notes ? `<div style="font-size:13px; margin-top:4px;">${escapeHtml(p.notes)}</div>` : ""}
      <div class="actions-row" style="justify-content:flex-start; margin-top:10px; flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm pr-plan-generate" data-plan-id="${p.id}">יצירת ביקורים מתוכננים</button>
        <select class="pr-plan-status-select" data-plan-id="${p.id}">
          ${Object.entries(SERVICE_PLAN_STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${k === p.status ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>
      <div class="pr-plan-visits" id="pr-plan-visits-${p.id}"></div>
    </div>
  `).join("");

  listEl.querySelectorAll(".pr-plan-generate").forEach((btn) => btn.addEventListener("click", () => prGeneratePlanVisits(Number(btn.dataset.planId))));
  listEl.querySelectorAll(".pr-plan-status-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const { error } = await supabaseClient.from("service_plans").update({ status: sel.value }).eq("id", Number(sel.dataset.planId));
      if (error) { flashError(friendlyErrorMessage(error)); return; }
      prInvalidate("servicePlans");
      flashSuccess("סטטוס התוכנית עודכן");
    });
  });
}

async function prGeneratePlanVisits(planId) {
  const plans = window.currentPatientState.servicePlans || [];
  const plan = plans.find((p) => p.id === planId);
  if (!plan) return;
  let planned;
  try {
    const res = await fetch(`${PREDICTIVE_SERVICE_URL}/plan/generate-visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_date: plan.start_date, end_date: plan.end_date, frequency: plan.frequency,
        preferred_weekdays: plan.preferred_weekdays, preferred_time: plan.preferred_time,
        planned_visit_count: plan.planned_visit_count,
      }),
    });
    if (!res.ok) throw new Error();
    ({ planned_dates: planned } = await res.json());
  } catch (err) {
    flashError("שירות התחזית לא זמין. יש להריץ אותו מקומית (predictive-service) על פורט 8000.");
    return;
  }
  const rows = planned.map((d) => ({ service_plan_id: planId, planned_date: d, status: "planned" }));
  const { error } = await supabaseClient.from("service_plan_visits").upsert(rows, { onConflict: "service_plan_id,planned_date", ignoreDuplicates: true });
  if (error) { flashError(friendlyErrorMessage(error)); return; }
  flashSuccess(`נוצרו ${planned.length} ביקורים מתוכננים`);
  prRenderPlanVisits(planId);
}

async function prRenderPlanVisits(planId) {
  const el = document.getElementById(`pr-plan-visits-${planId}`);
  if (!el) return;
  el.innerHTML = `<p style="color:var(--text-muted); font-size:13px;">טוען...</p>`;
  const { data, error } = await supabaseClient.from("service_plan_visits").select("*").eq("service_plan_id", planId).order("planned_date");
  if (error) { el.innerHTML = friendlyErrorMessage(error); return; }
  el.innerHTML = (data && data.length)
    ? `<ul style="margin:8px 0 0; padding-inline-start:18px; font-size:13px;">${data.map((v) => `<li>${formatDateHe(new Date(v.planned_date))} ${formatTimeHe(new Date(v.planned_date))} — ${v.status}</li>`).join("")}</ul>`
    : `<p style="color:var(--text-muted); font-size:13px;">טרם נוצרו ביקורים מתוכננים.</p>`;
}

async function prRenderPlanTab(content) {
  const plans = await prCached("servicePlans", prFetchServicePlans);
  content.innerHTML = `
    <div class="pr-card">
      <h3>תוכנית שירות חדשה</h3>
      <div class="field"><label for="pr-plan-type">סוג שירות</label><input type="text" id="pr-plan-type" placeholder="לדוגמה: ביקור אחות"></div>
      <div class="field"><label for="pr-plan-start">תאריך התחלה</label><input type="date" id="pr-plan-start"></div>
      <div class="field"><label for="pr-plan-end">תאריך סיום (אופציונלי)</label><input type="date" id="pr-plan-end"></div>
      <div class="field"><label for="pr-plan-frequency">תדירות</label>
        <select id="pr-plan-frequency"><option value="weekly">שבועי</option><option value="twice_weekly">פעמיים בשבוע</option><option value="daily">יומי</option><option value="custom">מותאם אישית</option></select>
      </div>
      <div class="field"><label>ימים מועדפים</label><div class="chips" id="pr-plan-weekdays"></div></div>
      <div class="field"><label for="pr-plan-time">שעה מועדפת</label><input type="time" id="pr-plan-time" value="10:00"></div>
      <div class="field"><label for="pr-plan-count">מספר ביקורים מתוכננים</label><input type="number" id="pr-plan-count" min="1"></div>
      <div class="field"><label for="pr-plan-notes">הערות</label><input type="text" id="pr-plan-notes"></div>
      <div class="error-msg" id="pr-plan-error" role="alert" aria-live="assertive"></div>
      <button class="btn btn-primary btn-sm" id="pr-plan-create">יצירת תוכנית</button>
    </div>
    <div id="pr-plan-list"></div>
  `;
  const weekdaysEl = document.getElementById("pr-plan-weekdays");
  const selectedWeekdays = new Set();
  WEEKDAY_SHORT.forEach((label, idx) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = label;
    chip.addEventListener("click", () => {
      if (selectedWeekdays.has(idx)) { selectedWeekdays.delete(idx); chip.classList.remove("selected"); }
      else { selectedWeekdays.add(idx); chip.classList.add("selected"); }
    });
    weekdaysEl.appendChild(chip);
  });

  document.getElementById("pr-plan-create").addEventListener("click", async () => {
    const errEl = document.getElementById("pr-plan-error");
    hideError(errEl);
    const serviceType = document.getElementById("pr-plan-type").value.trim();
    const startDate = document.getElementById("pr-plan-start").value;
    if (!serviceType || !startDate) { showError(errEl, "יש להזין סוג שירות ותאריך התחלה"); return; }
    const { data: { session } } = await supabaseClient.auth.getSession();
    const btn = document.getElementById("pr-plan-create");
    setButtonLoading(btn, true, "יוצר...");
    const { error } = await supabaseClient.from("service_plans").insert({
      patient_id: window.currentPatientState.patientId,
      service_type: serviceType,
      start_date: startDate,
      end_date: document.getElementById("pr-plan-end").value || null,
      frequency: document.getElementById("pr-plan-frequency").value,
      preferred_weekdays: Array.from(selectedWeekdays),
      preferred_time: document.getElementById("pr-plan-time").value || null,
      planned_visit_count: document.getElementById("pr-plan-count").value ? Number(document.getElementById("pr-plan-count").value) : null,
      notes: document.getElementById("pr-plan-notes").value || null,
      status: "active",
      created_by: session?.user?.id || null,
    });
    setButtonLoading(btn, false);
    if (error) { showError(errEl, friendlyErrorMessage(error)); return; }
    prInvalidate("servicePlans");
    flashSuccess("תוכנית השירות נוצרה");
    prSwitchTab("plan");
  });

  prRenderPlanList(plans);
}

// ----- תורים -----
async function prRenderAppointmentsTab(content) {
  const bookings = await prCached("bookings", prFetchBookings);
  if (!bookings.length) { content.innerHTML = `<div class="empty-state">אין תורים</div>`; return; }
  content.innerHTML = `<table class="admin-table"><thead><tr><th>תאריך</th><th>איש צוות</th><th>מטרה</th><th>סטטוס</th></tr></thead><tbody>
    ${bookings.map((b) => `<tr><td>${formatDateHe(new Date(b.scheduled_at))} ${formatTimeHe(new Date(b.scheduled_at))}</td><td>${escapeHtml(b.medical_staff?.full_name || "—")}</td><td>${PURPOSE_LABELS[b.visit_purpose] || b.visit_purpose}</td><td>${STATUS_LABELS[b.status] || b.status}</td></tr>`).join("")}
  </tbody></table>`;
}

// ----- הערות קליניות -----
async function prRenderNotesTab(content) {
  const notes = await prCached("clinicalNotes", prFetchClinicalNotes);
  content.innerHTML = `
    <div class="pr-card">
      <h3>הוספת הערה</h3>
      <div class="field"><label for="pr-note-type">סוג הערה</label>
        <select id="pr-note-type">${Object.entries(NOTE_TYPE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      </div>
      <div class="field"><label for="pr-note-content">תוכן</label><textarea id="pr-note-content" rows="3"></textarea></div>
      <div class="error-msg" id="pr-note-error" role="alert" aria-live="assertive"></div>
      <button class="btn btn-primary btn-sm" id="pr-note-add">הוספת הערה</button>
      <p style="color:var(--text-muted); font-size:12px; margin-top:6px;">הערות קליניות אינן ניתנות לעריכה או מחיקה — תיקון נעשה ע"י הערה חדשה.</p>
    </div>
    ${notes.length ? notes.map((n) => `
      <div class="pr-card">
        <div class="section-header"><strong>${NOTE_TYPE_LABELS[n.note_type] || n.note_type}</strong><span style="color:var(--text-muted); font-size:12px;">${formatDateHe(new Date(n.created_at))} ${formatTimeHe(new Date(n.created_at))}</span></div>
        <p style="margin:6px 0 0;">${escapeHtml(n.content)}</p>
      </div>`).join("") : `<div class="empty-state">אין הערות קליניות</div>`}
  `;
  document.getElementById("pr-note-add").addEventListener("click", async () => {
    const errEl = document.getElementById("pr-note-error");
    hideError(errEl);
    const contentText = document.getElementById("pr-note-content").value.trim();
    if (!contentText) { showError(errEl, "יש להזין תוכן להערה"); return; }
    const { data: { session } } = await supabaseClient.auth.getSession();
    const btn = document.getElementById("pr-note-add");
    setButtonLoading(btn, true, "שומר...");
    const { error } = await supabaseClient.from("clinical_notes").insert({
      patient_id: window.currentPatientState.patientId,
      author_id: session?.user?.id || null,
      author_role: "admin",
      note_type: document.getElementById("pr-note-type").value,
      content: contentText,
    });
    setButtonLoading(btn, false);
    if (error) { showError(errEl, friendlyErrorMessage(error)); return; }
    prInvalidate("clinicalNotes");
    flashSuccess("ההערה נשמרה");
    prSwitchTab("notes");
  });
}

// ----- מסמכים -----
async function prRenderDocumentsTab(content) {
  const docs = await prCached("documents", prFetchDocuments);
  content.innerHTML = `
    <div class="pr-card">
      <h3>העלאת מסמך</h3>
      <div class="field"><label for="pr-doc-type">סוג מסמך</label><input type="text" id="pr-doc-type" placeholder="לדוגמה: הפניה, סיכום שחרור"></div>
      <div class="field"><label for="pr-doc-desc">תיאור</label><input type="text" id="pr-doc-desc"></div>
      <div class="field"><label for="pr-doc-file">קובץ</label><input type="file" id="pr-doc-file"></div>
      <div class="error-msg" id="pr-doc-error" role="alert" aria-live="assertive"></div>
      <button class="btn btn-primary btn-sm" id="pr-doc-upload">העלאה</button>
    </div>
    ${docs.length ? docs.map((d) => `
      <div class="pr-card" style="display:flex; justify-content:space-between; align-items:center;">
        <div><strong>${escapeHtml(d.document_type)}</strong>${d.description ? " — " + escapeHtml(d.description) : ""}<div style="color:var(--text-muted); font-size:12px;">${formatDateHe(new Date(d.created_at))}</div></div>
        <button class="btn btn-secondary btn-sm pr-doc-download" data-path="${escapeHtml(d.storage_path)}">הורדה</button>
      </div>`).join("") : `<div class="empty-state">אין מסמכים</div>`}
  `;
  document.getElementById("pr-doc-upload").addEventListener("click", async () => {
    const errEl = document.getElementById("pr-doc-error");
    hideError(errEl);
    const fileInput = document.getElementById("pr-doc-file");
    const file = fileInput.files[0];
    const docType = document.getElementById("pr-doc-type").value.trim();
    if (!file || !docType) { showError(errEl, "יש לבחור קובץ ולהזין סוג מסמך"); return; }
    const btn = document.getElementById("pr-doc-upload");
    setButtonLoading(btn, true, "מעלה...");
    const path = `${window.currentPatientState.patientId}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabaseClient.storage.from("patient-documents").upload(path, file);
    if (uploadError) { setButtonLoading(btn, false); showError(errEl, friendlyErrorMessage(uploadError)); return; }
    const { data: { session } } = await supabaseClient.auth.getSession();
    const { error } = await supabaseClient.from("patient_documents").insert({
      patient_id: window.currentPatientState.patientId,
      document_type: docType,
      description: document.getElementById("pr-doc-desc").value || null,
      storage_path: path,
      uploaded_by: session?.user?.id || null,
    });
    setButtonLoading(btn, false);
    if (error) { showError(errEl, friendlyErrorMessage(error)); return; }
    prInvalidate("documents");
    flashSuccess("המסמך הועלה");
    prSwitchTab("documents");
  });
  content.querySelectorAll(".pr-doc-download").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { data, error } = await supabaseClient.storage.from("patient-documents").createSignedUrl(btn.dataset.path, 60);
      if (error) { flashError(friendlyErrorMessage(error)); return; }
      window.open(data.signedUrl, "_blank");
    });
  });
}

// ----- התראות ומשימות מעקב -----
async function prAckAlert(alertId) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const { error } = await supabaseClient.from("alerts").update({ status: "acknowledged", acknowledged_by: session?.user?.id || null, acknowledged_at: new Date().toISOString() }).eq("id", alertId);
  if (error) { flashError(friendlyErrorMessage(error)); return; }
  prInvalidate("alerts"); flashSuccess("ההתראה סומנה כטופלה"); prSwitchTab("alerts"); loadAttentionDashboard();
}
async function prResolveAlert(alertId) {
  const { error } = await supabaseClient.from("alerts").update({ status: "resolved" }).eq("id", alertId);
  if (error) { flashError(friendlyErrorMessage(error)); return; }
  prInvalidate("alerts"); flashSuccess("ההתראה נסגרה"); prSwitchTab("alerts"); loadAttentionDashboard();
}
async function prCreateTask(alertId) {
  const titleEl = alertId ? document.querySelector(`.pr-task-title[data-alert-id="${alertId}"]`) : document.getElementById("pr-general-task-title");
  const dueEl = alertId ? document.querySelector(`.pr-task-due[data-alert-id="${alertId}"]`) : document.getElementById("pr-general-task-due");
  const title = titleEl.value.trim();
  const due = dueEl.value;
  if (!title || !due) { flashError("יש להזין כותרת ותאריך/שעה למשימה"); return; }
  const { data: { session } } = await supabaseClient.auth.getSession();
  const { error } = await supabaseClient.from("tasks").insert({
    patient_id: window.currentPatientState.patientId,
    alert_id: alertId,
    title,
    due_at: new Date(due).toISOString(),
    created_by: session?.user?.id || null,
  });
  if (error) { flashError(friendlyErrorMessage(error)); return; }
  prInvalidate("tasks"); flashSuccess("משימת המעקב נוצרה"); prSwitchTab("alerts");
}
async function prCompleteTask(taskId) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const { error } = await supabaseClient.from("tasks").update({ status: "completed", completed_by: session?.user?.id || null, completed_at: new Date().toISOString() }).eq("id", taskId);
  if (error) { flashError(friendlyErrorMessage(error)); return; }
  prInvalidate("tasks"); flashSuccess("המשימה הושלמה"); prSwitchTab("alerts");
}

async function prRenderAlertsTab(content) {
  const [alerts, tasks] = await Promise.all([
    prCached("alerts", prFetchAlerts),
    prCached("tasks", prFetchTasks),
  ]);
  const tasksByAlert = new Map();
  tasks.forEach((t) => {
    const key = t.alert_id || "none";
    if (!tasksByAlert.has(key)) tasksByAlert.set(key, []);
    tasksByAlert.get(key).push(t);
  });

  const alertsHtml = alerts.length ? alerts.map((a) => {
    const linkedTasks = tasksByAlert.get(a.id) || [];
    return `
    <div class="pr-card">
      <div class="section-header">
        <strong>${ALERT_TYPE_LABELS[a.alert_type] || a.alert_type}</strong>
        <span class="pr-badge pr-badge-${a.severity}">${a.severity === "high" ? "גבוהה" : a.severity === "medium" ? "בינונית" : "נמוכה"}</span>
      </div>
      <p style="margin:6px 0;">${escapeHtml(a.message)}</p>
      <div style="color:var(--text-muted); font-size:12px;">
        נוצר: ${formatDateHe(new Date(a.created_at))} ${formatTimeHe(new Date(a.created_at))}
        · <span class="pr-badge pr-badge-${a.status}">${a.status === "open" ? "פתוח" : a.status === "acknowledged" ? "טופל" : "נסגר"}</span>
      </div>
      ${a.status !== "resolved" ? `<div class="actions-row" style="justify-content:flex-start; margin-top:8px; flex-wrap:wrap;">
        ${a.status === "open" ? `<button class="btn btn-secondary btn-sm pr-alert-ack" data-alert-id="${a.id}">אישור קבלה</button>` : ""}
        <button class="btn btn-ghost btn-sm pr-alert-resolve" data-alert-id="${a.id}">סגירה</button>
      </div>` : ""}
      ${linkedTasks.length ? `<div style="margin-top:8px; font-size:13px;">${linkedTasks.map((t) => `<div>${t.status === "completed" ? "✅" : new Date(t.due_at) < new Date() ? "⏰ באיחור —" : "🕓"} ${escapeHtml(t.title)} (${formatDateHe(new Date(t.due_at))} ${formatTimeHe(new Date(t.due_at))})</div>`).join("")}</div>` : ""}
      <div class="field" style="margin-top:8px;">
        <input type="text" class="pr-task-title" data-alert-id="${a.id}" placeholder="משימת מעקב, לדוגמה: בדיקה חוזרת בעוד שעתיים">
        <input type="datetime-local" class="pr-task-due" data-alert-id="${a.id}" style="margin-top:4px; max-width:220px;">
        <button class="btn btn-secondary btn-sm pr-task-create" data-alert-id="${a.id}" style="margin-top:4px;">יצירת משימת מעקב</button>
      </div>
    </div>
  `;
  }).join("") : `<div class="empty-state">אין התראות</div>`;

  const generalTasks = tasksByAlert.get("none") || [];
  const nowTs = new Date();
  const overdue = generalTasks.filter((t) => t.status === "pending" && new Date(t.due_at) < nowTs);
  const upcoming = generalTasks.filter((t) => t.status === "pending" && new Date(t.due_at) >= nowTs);
  const completed = generalTasks.filter((t) => t.status === "completed");
  const taskRow = (t, overdueFlag) => `<div class="pr-card" style="display:flex; justify-content:space-between; align-items:center;">
    <span>${overdueFlag ? "⏰ " : ""}${escapeHtml(t.title)} — ${formatDateHe(new Date(t.due_at))} ${formatTimeHe(new Date(t.due_at))}</span>
    ${t.status === "pending" ? `<button class="btn btn-secondary btn-sm pr-task-complete" data-task-id="${t.id}">השלמה</button>` : `<span class="pr-badge pr-badge-resolved">הושלם</span>`}
  </div>`;

  content.innerHTML = `
    <h3>התראות</h3>
    ${alertsHtml}
    <h3 style="margin-top:20px;">משימות מעקב כלליות</h3>
    <div class="field" style="max-width:420px;">
      <input type="text" id="pr-general-task-title" placeholder="משימה חדשה">
      <input type="datetime-local" id="pr-general-task-due" style="margin-top:4px;">
      <button class="btn btn-secondary btn-sm" id="pr-general-task-create" style="margin-top:4px;">הוספה</button>
    </div>
    ${overdue.length ? `<h4>באיחור</h4>${overdue.map((t) => taskRow(t, true)).join("")}` : ""}
    ${upcoming.length ? `<h4>ממתינות</h4>${upcoming.map((t) => taskRow(t, false)).join("")}` : ""}
    ${completed.length ? `<h4>הושלמו</h4>${completed.map((t) => taskRow(t, false)).join("")}` : ""}
    ${!overdue.length && !upcoming.length && !completed.length ? `<div class="empty-state">אין משימות מעקב</div>` : ""}
  `;

  content.querySelectorAll(".pr-alert-ack").forEach((btn) => btn.addEventListener("click", () => prAckAlert(Number(btn.dataset.alertId))));
  content.querySelectorAll(".pr-alert-resolve").forEach((btn) => btn.addEventListener("click", () => prResolveAlert(Number(btn.dataset.alertId))));
  content.querySelectorAll(".pr-task-create").forEach((btn) => btn.addEventListener("click", () => prCreateTask(Number(btn.dataset.alertId))));
  content.querySelectorAll(".pr-task-complete").forEach((btn) => btn.addEventListener("click", () => prCompleteTask(Number(btn.dataset.taskId))));
  const generalBtn = document.getElementById("pr-general-task-create");
  if (generalBtn) generalBtn.addEventListener("click", () => prCreateTask(null));
}

// ----- ציר זמן -----
async function prRenderTimelineTab(content) {
  const [bookings, visits, meds, notes, alerts] = await Promise.all([
    prCached("bookings", prFetchBookings),
    prCached("visitReports", prFetchVisitReports),
    prCached("medications", prFetchMedications),
    prCached("clinicalNotes", prFetchClinicalNotes),
    prCached("alerts", prFetchAlerts),
  ]);
  const events = [];
  bookings.forEach((b) => events.push({ ts: new Date(b.scheduled_at), summary: `ביקור ${PURPOSE_LABELS[b.visit_purpose] || ""} — ${STATUS_LABELS[b.status] || b.status}`, icon: "📅" }));
  visits.forEach((v) => {
    const vitalsSummary = VITALS_META.filter((m) => v[m.key] != null).map((m) => `${m.label} ${v[m.key]}${m.unit}`).join(", ");
    events.push({ ts: new Date(v.visit_date), summary: `דוח ביקור נשמר${vitalsSummary ? " — " + vitalsSummary : ""}`, icon: "🩺" });
  });
  meds.forEach((m) => events.push({ ts: new Date(m.administered_at), summary: `${m.medication_name}${m.dose ? " " + m.dose : ""} ניתן`, icon: "💊" }));
  notes.forEach((n) => events.push({ ts: new Date(n.created_at), summary: `${NOTE_TYPE_LABELS[n.note_type] || ""}: ${n.content.slice(0, 80)}`, icon: "📝" }));
  alerts.forEach((a) => events.push({ ts: new Date(a.created_at), summary: `התראה: ${ALERT_TYPE_LABELS[a.alert_type] || a.alert_type}`, icon: "🚨" }));

  events.sort((a, b) => b.ts - a.ts);
  if (!events.length) { content.innerHTML = `<div class="empty-state">אין עדיין פעילות מתועדת</div>`; return; }
  content.innerHTML = `<div class="pr-timeline">${events.map((e) => `
    <div class="pr-timeline-item">
      <div class="pr-timeline-time">${e.icon} ${formatDateHe(e.ts)} ${formatTimeHe(e.ts)}</div>
      <div class="pr-timeline-summary">${escapeHtml(e.summary)}</div>
    </div>
  `).join("")}</div>`;
}

// ----- התראות: כלל יצירה (קורא ל-predictive-service, כותב ל-DB אם צריך) -----
async function maybeCreateAlert(patientId, riskLevel, trend, statusMessage, riskPredictionId, triggerEvents) {
  let evaluation;
  try {
    const res = await fetch(`${PREDICTIVE_SERVICE_URL}/alerts/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ risk_level: riskLevel, trend, status_message: statusMessage, trigger_events: triggerEvents || [] }),
    });
    if (!res.ok) return;
    evaluation = await res.json();
  } catch (err) { return; }
  if (!evaluation.alert_type) return;

  const { data: existing } = await supabaseClient.from("alerts").select("id").eq("patient_id", patientId).eq("alert_type", evaluation.alert_type).eq("status", "open").limit(1);
  if (existing && existing.length) return; // כבר קיימת התראה פתוחה מאותו סוג — לא משכפלים

  await supabaseClient.from("alerts").insert({
    patient_id: patientId,
    risk_prediction_id: riskPredictionId,
    alert_type: evaluation.alert_type,
    severity: evaluation.severity,
    message: evaluation.message,
  });
  prInvalidate("alerts");
  loadAttentionDashboard();
}

// ----- "מי דורש תשומת לב עכשיו" -----
async function loadAttentionDashboard() {
  const el = document.getElementById("attention-list");
  el.innerHTML = `<p style="color:var(--text-muted);">טוען...</p>`;
  const [{ data: risks }, { data: patientsList }, { data: openAlerts }] = await Promise.all([
    supabaseClient.from("current_patient_risk").select("*"),
    supabaseClient.from("patients").select("id, full_name"),
    supabaseClient.from("alerts").select("patient_id, severity").eq("status", "open"),
  ]);
  const riskByPatient = new Map((risks || []).map((r) => [r.patient_id, r]));
  const alertInfoByPatient = new Map();
  (openAlerts || []).forEach((a) => {
    const cur = alertInfoByPatient.get(a.patient_id) || { count: 0, hasHigh: false };
    cur.count += 1;
    if (a.severity === "high") cur.hasHigh = true;
    alertInfoByPatient.set(a.patient_id, cur);
  });

  const rows = (patientsList || []).map((p) => {
    const risk = riskByPatient.get(p.id);
    const alertInfo = alertInfoByPatient.get(p.id) || { count: 0, hasHigh: false };
    const level = risk ? risk.risk_level : "no_data";
    let score = RISK_LEVEL_ORDER[level] || 0;
    if (alertInfo.hasHigh) score += 3;
    else if (alertInfo.count) score += 1;
    if (risk?.trend === "worsening") score += 1;
    return { patient: p, risk, alertInfo, score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);

  if (!rows.length) { el.innerHTML = `<p style="color:var(--text-muted);">אין כרגע מטופלים שדורשים תשומת לב מיוחדת.</p>`; return; }

  el.innerHTML = rows.map(({ patient, risk, alertInfo }) => `
    <div class="pr-search-result" data-patient-id="${patient.id}">
      <span>${escapeHtml(patient.full_name)} ${riskBadgeHtml(risk)}</span>
      <span style="font-size:12px; color:var(--text-muted);">${alertInfo.count ? `${alertInfo.count} התראות פתוחות` : ""}</span>
    </div>
  `).join("");
  el.querySelectorAll("[data-patient-id]").forEach((row) => {
    row.addEventListener("click", () => openPatientRecord(row.dataset.patientId));
  });
}
