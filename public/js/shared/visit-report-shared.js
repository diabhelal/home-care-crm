// נטען ע"י admin.html ו-employee.html (סקריפט קלאסי — לא מודול ES; חולק scope עליון עם הסקריפט
// המוטבע בעמוד). חייב להיטען אחרי app.js וקודם לסקריפט המוטבע/js/admin/*.js.
// משתנים חופשיים שמסופקים ע"י כל עמוד (מוגדרים בסקריפט המוטבע, נקראים רק בזמן קריאה):
//   vrCanvas, vrCtx, vrHasSignature (קנבס חתימת מטופל), supabaseClient (app.js).
// ההבדלים הבין-עמודיים (openVisitReportModal, renderRiskPanel, loadAndRenderRisk,
// recalculateRiskAfterSave, vrCanvasPoint) נשארו בכל עמוד בכוונה.

// ----- הודעות (מאתרות את האלמנטים בזמן קריאה: #app-success / #app-error קיימים בשני העמודים) -----
function flashSuccess(msg) {
  const appSuccess = document.getElementById("app-success");
  appSuccess.classList.remove("warning");
  appSuccess.textContent = msg;
  appSuccess.classList.add("show");
  setTimeout(() => appSuccess.classList.remove("show"), 2500);
}

// כמו flashSuccess אבל בצבע כתום-אזהרה (זהה ל-.predictive-offline-banner) — לשמירה
// שהצליחה אך לא הגיעה לשרת (תור אופליין), כדי שלא תיראה זהה לשמירה מאושרת.
function flashWarning(msg) {
  const appSuccess = document.getElementById("app-success");
  appSuccess.classList.add("warning");
  appSuccess.textContent = msg;
  appSuccess.classList.add("show");
  setTimeout(() => { appSuccess.classList.remove("show"); appSuccess.classList.remove("warning"); }, 4000);
}

function flashError(msg) {
  const appError = document.getElementById("app-error");
  appError.textContent = msg;
  appError.classList.add("show");
  setTimeout(() => appError.classList.remove("show"), 4000);
}

function vrClearCanvas() {
  vrCtx.clearRect(0, 0, vrCanvas.width, vrCanvas.height);
  vrHasSignature = false;
}
function vrLoadSignature(dataUrl) {
  vrClearCanvas();
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => vrCtx.drawImage(img, 0, 0, vrCanvas.width, vrCanvas.height);
  img.src = dataUrl;
  vrHasSignature = true;
}
// באנר רגישויות בתוך מודל דוח הביקור עצמו — כדי שאח/ות/מנהל לא יתעדו ביקור בלי
// לראות את רגישויות המטופל, גם בלי לפתוח את לשונית תיק המטופל. משתמש באותה
// שליפה (prFetchAllergies, app.js) ואותו סגנון (.pr-allergy-banner) כמו ה-
// באנר בתיק המטופל (patient-record.js prRenderHeader) — לא נבנה תיעוד חדש.
async function loadAllergyBannerForVisitReport(patientId, scope) {
  const banner = document.getElementById("vr-allergy-banner");
  const allergies = await prFetchAllergies(patientId);
  if (scope && !scope.isCurrent()) return; // המודאל כבר עבר למטופל אחר
  if (allergies.length) {
    banner.style.display = "block";
    banner.className = "pr-allergy-banner";
    banner.innerHTML = "⚠️ רגישויות: " + allergies.map((a) => `${escapeHtml(a.substance)}${a.severity ? " (" + SEVERITY_LABELS[a.severity] + ")" : ""}`).join(", ");
  } else {
    banner.style.display = "none";
  }
}
// רקע רפואי (background_conditions/smoking_status) שנשלף פעם אחת בפתיחת המודל,
// ומוזן לחישוב הסיכון (תצוגה חיה + השמירה בפועל) — ר' predictive-service/main.py
// compute_risk(): מדד "צהוב" עם רקע רלוונטי מוחמר ל"אדום". null עד שהשליפה מסתיימת,
// כדי לא לחשב סיכון עם רקע חלקי/שגוי.
let vrPatientContext = null;
async function loadPatientContextForRisk(patientId, scope) {
  vrPatientContext = null;
  const { data, error } = await supabaseClient.from("patients").select("background_conditions, smoking_status").eq("id", patientId).maybeSingle();
  if (scope && !scope.isCurrent()) return; // לא כותבים רקע רפואי של מטופל אחר למשתנה המשותף
  if (error) { console.error("patient context for risk", error); vrPatientContext = { background_conditions: [], smoking_status: null }; return; }
  vrPatientContext = { background_conditions: data?.background_conditions || [], smoking_status: data?.smoking_status || null };
}
async function loadCurrentRiskForPatient(patientId) {
  const { data, error } = await supabaseClient
    .from("current_patient_risk")
    .select("*")
    .eq("patient_id", patientId)
    .maybeSingle();
  if (error) { console.error("current_patient_risk", error); return null; }
  return data;
}
function collectVitalsFromForm() {
  const num = (id) => {
    const v = document.getElementById(id).value;
    return v === "" ? null : Number(v);
  };
  return {
    systolic_bp: num("vr-systolic"),
    diastolic_bp: num("vr-diastolic"),
    blood_sugar: num("vr-sugar"),
    pulse: num("vr-pulse"),
    temperature: num("vr-temp"),
    oxygen_saturation: num("vr-o2"),
  };
}
function predictiveServiceUnavailableMessage(err) {
  return /failed to fetch|network|load failed/i.test(err?.message || "")
    ? "שירות התחזית לא זמין. יש להריץ אותו מקומית (predictive-service) על פורט 8000."
    : friendlyErrorMessage(err);
}
// הודעת משתמש לכישלון הערכת הסיכון (שלב נפרד, אחרי שהדוח כבר נשמר ואושר). הדוח נשאר שמור.
function riskAssessmentErrorMessage(err) {
  const kind = err && err.kind;
  if (kind === "predictive_unavailable") {
    return predictiveServiceUnavailableMessage({ message: "failed to fetch" }) + " דוח הביקור נשמר; הערכת הסיכון לא בוצעה.";
  }
  if (kind === "forbidden") return "אין הרשאה להעריך סיכון לדוח זה. דוח הביקור נשמר.";
  return "דוח הביקור נשמר, אך הערכת הסיכון לא הושלמה. ניתן לנסות שוב מאוחר יותר.";
}
// תיק מטופל (הלשוניות) שומר קאש בזיכרון (window.currentPatientState) כדי לא לשלוף
// מחדש מ-Supabase בכל מעבר לשונית. שמירת דוח ביקור דרך המודל הישן (טבלת ההזמנות)
// כותבת ל-DB ישירות ולא עוברת דרך הקאש הזה — בלי הרענון הזה, לשונית "ביקורים"/
// "מדדים"/"סקירה" הייתה יכולה להראות מידע ישן וליצור רושם מוטעה ש"שום דבר לא נשמר".
function refreshOpenPatientRecordIfMatching(patientId) {
  if (!window.currentPatientState || window.currentPatientState.patientId !== patientId) return;
  prInvalidate("visitReports", "bookings", "currentRisk", "alerts", "tasks", "medications");
  const activeBtn = document.querySelector(".pr-tab-btn.active");
  if (activeBtn) prSwitchTab(activeBtn.dataset.tab);
}

// היקף המטופל של מודאל דוח הביקור (משותף לעמודי המנהל והצוות)
const visitReportScope = createPatientScope();

// ----- פאנל סיכון בדוח הביקור: עותק אחד משותף (היה משוכפל ב-admin.html וב-employee.html; בעמוד הצוות חסרה שורת גיל ההערכה) -----
function renderRiskPanel(currentRisk) {
  const panel = document.getElementById("vr-risk-panel");
  if (!currentRisk) {
    panel.innerHTML = `
      <div class="risk-badge risk-badge-muted">לא נבדק</div>
      <p style="color:var(--text-muted); font-size:13px; margin:6px 0 0;">${RISK_DISCLAIMER}</p>
    `;
    return;
  }
  const trendMeta = currentRisk.trend ? TREND_META[currentRisk.trend] : null;
  const statusClass = `caregiver-status-${currentRisk.risk_level in CAREGIVER_STATUS_BY_LEVEL ? currentRisk.risk_level : "no_data"}`;
  panel.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
      ${riskBadgeHtml(currentRisk)}
      ${trendMeta ? `<span>${trendMeta.arrow} ${trendMeta.label}</span>` : `<span style="color:var(--text-muted);">אין נתון קודם להשוואת מגמה</span>`}
    </div>
    <p class="${statusClass}" style="font-weight:600; margin:8px 0 0;">
      ${escapeHtml(caregiverStatusMessage(currentRisk.risk_level, currentRisk.trend))}
    </p>
    <p style="color:var(--text-muted); font-size:13px; margin:8px 0 0;">
      נמדד ב-${formatDateHe(new Date(currentRisk.predicted_at))} ${formatTimeHe(new Date(currentRisk.predicted_at))} ·
      בתוקף עד ${formatDateHe(new Date(currentRisk.expires_at))} ${formatTimeHe(new Date(currentRisk.expires_at))} ·
      חלון חיזוי: ${currentRisk.prediction_horizon_hours} שעות
    </p>
    <p style="color:var(--text-muted); font-size:13px; margin:4px 0 0;">${RISK_DISCLAIMER}</p>
  `;
}

async function loadAndRenderRisk(patientId, scope) {
  document.getElementById("vr-risk-panel").innerHTML = `<p style="color:var(--text-muted);">טוען רמת סיכון...</p>`;
  const currentRisk = await loadCurrentRiskForPatient(patientId);
  if (scope && !scope.isCurrent()) return;
  renderRiskPanel(currentRisk);
}

// הערכת סיכון + התראה אוטומטית: בשרת בלבד (POST /visits/{id}/risk-assessment). הדפדפן לא כותב ל-risk_predictions/alerts.
// נקראת רק אחרי השלמה מאושרת; כשל = הודעה, הדוח נשאר שמור. לא כותבת לפאנל אם המודאל נפתח בינתיים למטופל אחר.
async function recalculateRiskAfterSave(patientId, savedReportId) {
  const panelIsMine = () => { const m = document.getElementById("visit-report-modal"); return m && m.style.display !== "none" && String(m.dataset.patientId) === String(patientId); };
  let out;
  try {
    out = await requestRiskAssessment(savedReportId);
  } catch (err) {
    const msg = riskAssessmentErrorMessage(err);
    if (panelIsMine()) document.getElementById("vr-risk-panel").innerHTML = `<p style="color:var(--danger);">${escapeHtml(msg)}</p>`;
    flashWarning(msg);
    return;
  }
  // אין מדדים בדוח: השרת לא יוצר רשומת סיכון מפוברקת.
  if (!out || out.risk_level === "no_data" || !out.prediction) { if (panelIsMine()) renderRiskPanel(null); return; }
  const p = out.prediction;
  if (panelIsMine()) renderRiskPanel({ risk_level: p.risk_level, trend: p.trend, predicted_at: p.predicted_at, expires_at: p.expires_at, prediction_horizon_hours: p.prediction_horizon_hours });
  prInvalidate("currentRisk", "riskHistory");
  if (out.alert) { prInvalidate("alerts"); if (typeof loadAttentionDashboard === "function") loadAttentionDashboard(); }
}


// דוח שהושלם (חתום) נפתח מתיק המטופל לצפייה בלבד: אין דריסה. ההסבר מפנה לדרכים המותרות
// (תיקון מקושר למחבר, הערה קלינית חדשה) ולא משאיר כפתור שמירה מושבת בלי הסבר.
const SIGNED_REPORT_MSG = "הביקור כבר הושלם והדוח נחתם, ולכן אי אפשר לשנות אותו. מה כן אפשר: להוסיף עוד מדידות בלשונית \"מדדים\" ועוד טיפול או הערות בלשונית \"הערות קליניות\" (כל רשומה נשמרת בנפרד עם הזמן שתבחרו, גם כמה באותו ביקור). לתקן את הדוח עצמו: לשונית \"ביקורים\" ← \"הוספת תיקון\" (למחבר הדוח; המקור נשמר).";

// ----- מדידה שנוספה לתיק מחוץ לביקור (proposed/020) -----
// זמן המדידה (measured_at, נבחר ע"י המשתמש, יכול להיות בעבר) נפרד מזמן ההזנה (recorded_at, שעון השרת).
// רשומה חדשה בלבד: לא עורכת ולא דורסת דוח ביקור, ואין עריכה או מחיקה. הרשאה נאכפת בשרת ובמסד
// (מנהל, או איש צוות המשויך למטופל). אינה נכנסת לחישוב הערכת הסיכון.
const MEASUREMENT_LIMITS = { systolic_bp: [50, 250], diastolic_bp: [30, 150], blood_sugar: [20, 600], pulse: [30, 220], temperature: [30, 45], oxygen_saturation: [50, 100] };
const MEASUREMENT_ROLE_HE = { admin: "מנהל/ת", nurse: "אח/ות", doctor: "רופא/ה", physiotherapist: "פיזיותרפיסט/ית", caregiver: "מטפל/ת" };

function localDateTimeInputValue(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

function measurementFormHtml() {
  const fields = VITALS_META.map((v) => {
    const [min, max] = MEASUREMENT_LIMITS[v.key];
    return `<div class="field"><label for="pr-m-${v.key}">${v.label}${v.unit ? ` (${v.unit})` : ""}</label>
      <input id="pr-m-${v.key}" type="number" inputmode="decimal" min="${min}" max="${max}" ${v.key === "temperature" ? 'step="0.1"' : 'step="1"'}></div>`;
  }).join("");
  return `
    <div class="pr-card" id="pr-measurement-form">
      <h3>הוספת מדידה לתיק</h3>
      <p style="color:var(--text-muted); font-size:13px; margin:0 0 8px;">מדידה שנלקחה בזמן אחר, מחוץ לביקור מתוכנן. נשמרת כרשומה חדשה; דוחות שנחתמו אינם משתנים (תיקון דוח נעשה בלשונית "ביקורים").</p>
      <div class="field"><label for="pr-m-measured-at">מתי נמדד?</label>
        <input id="pr-m-measured-at" type="datetime-local" value="${localDateTimeInputValue(new Date())}" max="${localDateTimeInputValue(new Date())}"></div>
      ${fields}
      <div class="field"><label for="pr-m-note">הערה (אופציונלי)</label><textarea id="pr-m-note" rows="2" maxlength="2000"></textarea></div>
      <div class="error-msg" id="pr-m-error" role="alert" aria-live="assertive"></div>
      <button class="btn btn-primary btn-sm" id="pr-m-add">שמירת מדידה</button>
      <p style="color:var(--text-muted); font-size:12px; margin-top:6px;">זמן ההזנה נרשם אוטומטית בשרת, יחד עם שם המזין. אין עריכה או מחיקה.</p>
    </div>`;
}

function measurementsTableHtml(rows) {
  if (!rows.length) return `<div class="empty-state">עדיין לא נוספו מדידות מחוץ לביקור</div>`;
  const head = `<tr><th scope="col">זמן המדידה</th><th scope="col">זמן ההזנה</th><th scope="col">הוזן ע"י</th>${VITALS_META.map((v) => `<th scope="col">${v.label}</th>`).join("")}<th scope="col">הערה</th></tr>`;
  const fmt = (iso) => { const d = new Date(iso); return `${formatDateHe(d)} ${formatTimeHe(d)}`; };
  const body = rows.map((m) => `<tr>
    <td>${fmt(m.measured_at)}</td><td>${fmt(m.recorded_at)}</td><td>${escapeHtml(MEASUREMENT_ROLE_HE[m.recorded_by_role] || m.recorded_by_role || "")}</td>
    ${VITALS_META.map((v) => `<td>${m[v.key] != null ? escapeHtml(String(m[v.key])) : "—"}</td>`).join("")}
    <td>${m.note ? escapeHtml(m.note) : ""}</td></tr>`).join("");
  return `<div style="overflow-x:auto;" tabindex="0" role="group" aria-label="מדידות מחוץ לביקור (ניתנת לגלילה אופקית)"><table class="admin-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function measurementErrorMessage(err) {
  if (err && err.kind === "network") return "המדידה לא נשמרה: אין חיבור לשירות. נא לנסות שוב כשהחיבור חוזר.";
  if (err && err.kind === "timeout") return "המדידה לא נשמרה: השירות לא הגיב בזמן. נא לבדוק ברשימה אם נשמרה לפני שמנסים שוב.";
  if (err && err.kind === "forbidden") return "אין הרשאה: ניתן להוסיף מדידה רק למטופל המשויך אליך (או כמנהל).";
  if (err && err.kind === "auth") return err.message;
  if (err && err.kind === "unconfigured") return "שירות השמירה אינו מוגדר. המדידה לא נשמרה.";
  if (err && err.kind === "validation") return "המדידה לא נשמרה: " + (err.message || "הערכים שהוזנו אינם תקינים.");
  return "המדידה לא נשמרה בגלל תקלה בשירות. נא לנסות שוב.";
}

// בונה את הגוף לשליחה; מחזיר { body } או { error }. תקינות הערכים נבדקת גם בשרת ובמסד.
function collectMeasurementFromForm() {
  const raw = document.getElementById("pr-m-measured-at").value;
  if (!raw) return { error: "יש לבחור מתי נמדד." };
  const when = new Date(raw);
  if (isNaN(when.getTime())) return { error: "זמן המדידה אינו תקין." };
  if (when.getTime() > Date.now() + 5 * 60 * 1000) return { error: "זמן המדידה לא יכול להיות בעתיד." };
  const body = { measured_at: when.toISOString() };
  let any = false;
  for (const v of VITALS_META) {
    const txt = document.getElementById("pr-m-" + v.key).value.trim();
    if (txt === "") continue;
    const n = Number(txt);
    const [min, max] = MEASUREMENT_LIMITS[v.key];
    if (!isFinite(n) || n < min || n > max) return { error: `${v.label}: הערך חייב להיות בין ${min} ל-${max}.` };
    body[v.key] = n; any = true;
  }
  if (!any) return { error: "יש להזין לפחות מדד אחד." };
  const note = document.getElementById("pr-m-note").value.trim();
  if (note) body.note = note;
  return { body };
}

// מצייר את אזור המדידות בתוך container (טופס + רשימה) ומחבר שמירה. rerender נקרא אחרי שמירה מאושרת בלבד.
async function renderMeasurementsSection(container, rerender) {
  const state = window.currentPatientState;
  const m = await prCached("measurements", prFetchMeasurements);
  if (window.currentPatientState !== state) return;
  if (m.missing) {
    container.innerHTML = `<div class="pr-card"><h3>מדידות מחוץ לביקור</h3><p style="color:var(--text-muted);">הוספת מדידות נוספות לתיק עדיין לא פעילה במסד הנתונים שהאתר מחובר אליו: חסר בו עדכון (מיגרציה 020) שטרם הוחל, ולכן אין היכן לשמור אותן. שום נתון קיים לא נפגע.</p></div>`;
    return;
  }
  if (m.error) {
    container.innerHTML = `<div class="pr-card"><h3>מדידות מחוץ לביקור</h3><div class="error-msg show" role="alert">לא ניתן היה לטעון את המדידות שנוספו מחוץ לביקור. היעדר רשימה אינו אומר שאין מדידות.</div></div>`;
    return;
  }
  container.innerHTML = measurementFormHtml() + `<div class="pr-card"><h3 style="margin-top:0;">מדידות שנוספו מחוץ לביקור</h3>${measurementsTableHtml(m.rows)}</div>`;
  document.getElementById("pr-m-add").addEventListener("click", async () => {
    const errEl = document.getElementById("pr-m-error");
    hideError(errEl);
    const parsed = collectMeasurementFromForm();
    if (parsed.error) { showError(errEl, parsed.error); return; }
    const btn = document.getElementById("pr-m-add");
    setButtonLoading(btn, true, "שומר...");
    try {
      await backendFetch(`/patients/${encodeURIComponent(state.patientId)}/measurements`, { method: "POST", body: parsed.body });
    } catch (err) {
      setButtonLoading(btn, false);
      showError(errEl, measurementErrorMessage(err));
      return;
    }
    if (window.currentPatientState !== state) return;
    prInvalidate("measurements");
    flashSuccess("המדידה נשמרה בתיק");
    rerender();
  });
}
