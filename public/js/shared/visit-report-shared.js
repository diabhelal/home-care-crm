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
async function loadAllergyBannerForVisitReport(patientId) {
  const banner = document.getElementById("vr-allergy-banner");
  const allergies = await prFetchAllergies(patientId);
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
async function loadPatientContextForRisk(patientId) {
  vrPatientContext = null;
  const { data, error } = await supabaseClient.from("patients").select("background_conditions, smoking_status").eq("id", patientId).maybeSingle();
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
