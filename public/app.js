// לוגיקה משותפת לכל דפי המערכת
const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// PWA: רישום ה-service worker (מעטפת אפליקציה אופליין בלבד — ר' הערה ב-service-worker.js
// לגבי למה נתוני Supabase לעולם לא נכנסים למטמון הזה).
//
// מדיניות עדכון: לא activation אגרסיבי (skipWaiting אוטומטי) שיכול ליצור אי-תאמה
// בין HTML/JS ישן שכבר בזיכרון של לשונית פתוחה לבין cache חדש. במקום זה: banner
// "גרסה חדשה זמינה" גלוי כשיש worker חדש ב-waiting, והמשתמש/ת בוחר/ת מתי לרענן —
// visibility of system status אמיתי, לא ניחוש/hard-refresh ידני.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // reload על controllerchange מותר אך ורק אחרי שהמשתמש/ת בעצמם ביקשו עדכון
    // (לחצו על כפתור הבאנר) — controllerchange יכול לירות גם בביקור ראשון רגיל
    // (בלי SW קודם בכלל), ורענון אוטומטי אז היה בדיוק ה-activation האגרסיבי שרצינו
    // למנוע. ר' bug שנתפס ע"י טסט my-work-pagination.spec.js.
    let updateRequested = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!updateRequested) return;
      updateRequested = false;
      location.reload();
    });

    navigator.serviceWorker.register("service-worker.js").then((reg) => {
      const promptUpdate = (worker) => {
        let banner = document.getElementById("sw-update-banner");
        if (!banner) {
          banner = document.createElement("div");
          banner.id = "sw-update-banner";
          banner.className = "predictive-offline-banner";
          banner.setAttribute("role", "status");
          banner.innerHTML = `<span>🔄 גרסה חדשה זמינה</span> <button type="button" id="sw-update-btn" style="margin-inline-start:10px; text-decoration:underline; background:none; border:none; color:inherit; font:inherit; cursor:pointer; min-height:24px;">רענון עכשיו</button>`;
          document.body.prepend(banner);
        }
        banner.style.display = "block";
        document.getElementById("sw-update-btn").onclick = () => {
          updateRequested = true;
          worker.postMessage({ type: "SKIP_WAITING" });
        };
      };

      if (reg.waiting) promptUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          // "installed" + כבר יש controller = worker חדש מחליף גרסה קיימת (לא ההתקנה
          // הראשונה) — זה בדיוק המצב שדורש הודעה למשתמש/ת, לא activation שקט.
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            promptUpdate(newWorker);
          }
        });
      });
    }).catch((err) => {
      console.error("service worker registration failed", err);
    });
  });
}

// ===== Offline Draft Queue: visit_reports =====
// כשהשמירה ל-Supabase נכשלת בגלל היעדר רשת (לא שגיאת ולידציה/הרשאה אמיתית), שומרים
// את הדוח מקומית ב-localStorage במקום לאבד אותו, ומנסים שוב אוטומטית ברגע שהחיבור
// חוזר (או בטעינת עמוד הבאה). שימושי בשטח כשאחות מאבדת קליטה תוך כדי ביקור.
const OFFLINE_QUEUE_KEY = "visitReportOfflineQueue";

// הפרדת טיוטות בין משתמשים: כל משתמש מחובר שומר ב-localStorage במפתח משלו
// (visitReportOfflineQueue:<auth uid>), כך שמשתמש אחר באותו דפדפן לא רואה ולא מסנכרן
// את הטיוטות שלו. זו הפרדה לוגית בלבד — localStorage אינו מוצפן וניתן לקריאה ע"י
// כל מי שיש לו גישה לפרופיל הדפדפן — ולא הגנת מידע מלאה. המפתח הישן (ללא uid) נשאר
// נקרא לצורך סנכרון (RLS מחליט מי רשאי לכתוב) ונמחק רק לאחר שמירה מוצלחת.
let offlineQueueOwnerId = null;

function setOfflineQueueOwner(uid) {
  offlineQueueOwnerId = uid || null;
}

function offlineQueueKey() {
  return offlineQueueOwnerId ? `${OFFLINE_QUEUE_KEY}:${offlineQueueOwnerId}` : OFFLINE_QUEUE_KEY;
}

function isNetworkError(err) {
  const msg = err?.message || String(err);
  return /failed to fetch|network|load failed|networkerror/i.test(msg);
}

// הודעה מדויקת אחרי סנכרון תור אופליין — משותפת בין admin.html/employee.html כדי
// שכישלון חלקי (מדדים נשמרו, סימון "הושלם" עדיין לא) לא יוצג כהצלחה מלאה סתמית.
function offlineQueueFlushMessage(synced, partial) {
  if (synced > 0 && partial > 0) {
    return `${synced} דוחות ביקור סונכרנו בהצלחה · ${partial} נשמרו אך סימון "הושלם" עדיין ממתין לחיבור, ינוסה שוב אוטומטית`;
  }
  if (partial > 0) {
    return `${partial} דוחות ביקור נשמרו, אך סימון "הושלם" עדיין ממתין לחיבור — ינוסה שוב אוטומטית`;
  }
  return `${synced} דוחות ביקור שנשמרו במכשיר סונכרנו בהצלחה`;
}

function getOfflineQueue(key = offlineQueueKey()) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch (e) {
    return [];
  }
}

function setOfflineQueue(queue, key = offlineQueueKey()) {
  try {
    if (!queue.length && key !== OFFLINE_QUEUE_KEY) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(queue));
  } catch (e) {
    console.error("offline queue save failed", e);
  }
}

// טיוטה חדשה לאותה הזמנה (booking_id) מחליפה טיוטה קודמת שממתינה לה — לא מצטברות כפילויות.
function queueVisitReportDraft(payload) {
  const queue = getOfflineQueue().filter((d) => d.booking_id !== payload.booking_id);
  queue.push({ ...payload, _queuedAt: new Date().toISOString() });
  setOfflineQueue(queue);
}

function getQueuedDraftCount() {
  return getOfflineQueue().length;
}

// מנסה לסנכרן את כל התור מול Supabase (upsert לפי booking_id — בטוח לקרוא שוב ושוב).
// מחזירה {synced, failed, partial} כדי שהקורא יוכל להציג משוב מדויק למשתמש/ת.
// "partial": הדוח (מדדים/סיכום) נשמר בהצלחה, אבל סימון ההזמנה כ"הושלם" נכשל —
// נשאר בתור לניסיון חוזר (עם _markCompleted, לא מוסר) ולא נספר כ-synced מלא, כדי
// שכישלון חלקי לא ייעלם בשקט כאילו הכול הצליח.
// offlineQueueSyncing: true רק בזמן שסנכרון בפועל רץ (לא כשהתור פשוט ממתין) —
// updateOfflineDraftBanner() קוראת בזה כדי להראות מצב-ביניים "מסנכרן..." שקוף,
// בלי תשתית נוספת מעבר לדגל הזה.
let offlineQueueSyncing = false;

async function flushOfflineQueue() {
  const ownKey = offlineQueueKey();
  const own = await flushOfflineQueueKey(ownKey);
  // טיוטות ממפתח ישן (לפני הפרדת משתמשים): מנסים לסנכרן, אך רק מה שנשמר בפועל נמחק
  // ממנו. משתמש שאינו הבעלים נכשל ב-RLS והטיוטה נשארת במקומה, ללא אובדן וללא העברה.
  if (ownKey !== OFFLINE_QUEUE_KEY && getOfflineQueue(OFFLINE_QUEUE_KEY).length) {
    const legacy = await flushOfflineQueueKey(OFFLINE_QUEUE_KEY);
    return { synced: own.synced + legacy.synced, failed: own.failed + legacy.failed, partial: own.partial + legacy.partial };
  }
  return own;
}

async function flushOfflineQueueKey(queueKey) {
  const queue = getOfflineQueue(queueKey);
  if (!queue.length) return { synced: 0, failed: 0, partial: 0 };
  offlineQueueSyncing = true;
  if (typeof document !== "undefined") updateOfflineDraftBanner();
  let synced = 0;
  let partial = 0;
  const stillPending = [];
  for (const draft of queue) {
    const { _queuedAt, _markCompleted, ...payload } = draft;
    try {
      const { error } = await supabaseClient.from("visit_reports").upsert(payload, { onConflict: "booking_id" });
      if (error) {
        stillPending.push(draft); // שגיאת שרת אמיתית (למשל RLS/ולידציה) — לא רשת, לא ננסה בלולאה אינסופית בשקט
        continue;
      }
      // אם "לסמן כהושלם" היה מסומן בזמן השמירה האופליין, משלימים את זה עכשיו —
      // לא רק שומרים את המדדים, אלא מכבדים את מה שהאחות באמת ביקשה.
      if (_markCompleted) {
        const { error: statusError } = await supabaseClient.from("bookings").update({ status: "completed" }).eq("id", payload.booking_id);
        if (statusError) {
          // הדוח עצמו כבר נשמר (upsert לפי booking_id — ניסיון חוזר לא יוצר כפילות),
          // רק סימון "הושלם" נכשל. משאירים את אותה טיוטה בתור (עם _markCompleted) כדי
          // שהניסיון הבא ישלים רק את זה — לא סופרים synced עד ששני החלקים הצליחו.
          stillPending.push(draft);
          partial++;
          continue;
        }
      }
      synced++;
    } catch (err) {
      stillPending.push(draft); // עדיין אין רשת
    }
  }
  setOfflineQueue(stillPending, queueKey);
  offlineQueueSyncing = false;
  if (typeof document !== "undefined") updateOfflineDraftBanner();
  return { synced, failed: stillPending.length, partial };
}

// מעקב אחרי המשתמש המחובר: קובע לאיזה מפתח נכתבות/נקראות הטיוטות. התנתקות לא מוחקת
// טיוטות שטרם נשמרו (אובדן מידע) — היא רק מפסיקה להציג ולסנכרן אותן למשתמש אחר.
if (typeof supabaseClient !== "undefined" && supabaseClient.auth && typeof supabaseClient.auth.getSession === "function") {
  supabaseClient.auth.getSession()
    .then(({ data }) => { setOfflineQueueOwner(data && data.session && data.session.user ? data.session.user.id : null); })
    .catch(() => {});
  if (typeof supabaseClient.auth.onAuthStateChange === "function") {
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      setOfflineQueueOwner(session && session.user ? session.user.id : null);
      if (typeof document !== "undefined" && typeof updateOfflineDraftBanner === "function") updateOfflineDraftBanner();
    });
  }
}

window.addEventListener("online", async () => {
  const { synced, partial } = await flushOfflineQueue();
  updateOfflineDraftBanner();
  if ((synced > 0 || partial > 0) && typeof window.onOfflineQueueFlushed === "function") {
    window.onOfflineQueueFlushed(synced, partial);
  }
});

const ROLE_LABELS = {
  nurse: "אח/ות",
  doctor: "רופא/ה",
  physiotherapist: "פיזיותרפיסט/ית",
  caregiver: "מטפל/ת סיעודי/ת",
};

const ROLE_DESCRIPTIONS = {
  nurse: "טיפול בפצעים, מתן תרופות ובדיקות דם — בבית שלך",
  doctor: "ביקור רפואי כללי, אבחון ומעקב מצב בריאותי",
  physiotherapist: "שיקום תנועה וטיפול פיזיותרפי בבית",
  caregiver: "סיוע וליווי סיעודי יומיומי",
};

const ROLE_ICONS = {
  nurse: "💉",
  doctor: "🩺",
  physiotherapist: "🏃",
  caregiver: "🤝",
};

const PURPOSE_LABELS = {
  checkup: "בדיקה כללית",
  wound_care: "טיפול בפצע",
  blood_test: "בדיקת דם",
  medication: "מתן תרופות",
  physiotherapy: "פיזיותרפיה",
  other: "אחר",
};

const STATUS_LABELS = {
  scheduled: "מתוכנן",
  completed: "הושלם",
  cancelled: "בוטל",
};

const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const WEEKDAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

const VITALS_META = [
  { key: "systolic_bp", label: 'ל"ד סיסטולי', unit: "" },
  { key: "diastolic_bp", label: 'ל"ד דיאסטולי', unit: "" },
  { key: "blood_sugar", label: "סוכר", unit: "mg/dL" },
  { key: "pulse", label: "דופק", unit: "BPM" },
  { key: "temperature", label: "חום גוף", unit: "°C" },
  { key: "oxygen_saturation", label: "סטורציה", unit: "%" },
];

const CONDITION_META = [
  { key: "diabetes", label: "סוכרת" },
  { key: "hypertension", label: "יתר לחץ דם" },
  { key: "heart_failure", label: "אי ספיקת לב" },
];

function conditionsLabel(conditions) {
  if (!conditions || conditions.length === 0) return "—";
  return conditions.map((c) => CONDITION_META.find((m) => m.key === c)?.label || c).join(", ");
}

const SMOKING_STATUS_HE = { never: "אף פעם לא עישן/ה", former: "עישן/ה בעבר", current: "מעשן/ת כיום" };

function smokingStatusLabel(status) {
  return status ? (SMOKING_STATUS_HE[status] || status) : null;
}

const PROCEDURE_META = [
  { key: "performed_blood_draw", label: "בדיקת דם / איסוף דגימות" },
  { key: "performed_injection", label: "מתן זריקה" },
  { key: "performed_infusion", label: "מתן עירוי נוזלים/תרופה" },
  { key: "performed_dressing_change", label: "החלפת חבישה" },
  { key: "performed_catheter_change", label: "החלפת קטטר/זונדה" },
];

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

const RISK_LEVEL_HE = { green: "ירוק", yellow: "צהוב", red: "אדום", no_data: "אין נתונים" };
const RISK_BADGE_CLASS = { green: "risk-badge-green", yellow: "risk-badge-yellow", red: "risk-badge-red", no_data: "risk-badge-muted" };
const TREND_META = {
  improving: { arrow: "📉", label: "משתפר" },
  stable: { arrow: "➡️", label: "יציב" },
  worsening: { arrow: "📈", label: "מחמיר" },
};
const RISK_DISCLAIMER = "הערכת סיכון מבוססת כללים — הדגמה בלבד. כלי תמיכה בקבלת החלטות, אינו אבחון רפואי או קביעת מצב חירום.";

// משפט תמציתי בעברית פשוטה למטפל/ת, נגזר אך ורק מרמת הסיכון והמגמה שכבר חושבו —
// לא נתון חדש, רק ניסוח קריא של מה שכבר קיים ב-risk_level/trend.
const CAREGIVER_STATUS_BY_LEVEL = {
  red: "המטופל/ת במצב מסוכן",
  yellow: "סכנה ממוצעת — יש לעקוב מקרוב",
  green: "מצב תקין",
  no_data: "אין מספיק נתונים להערכה",
};
const CAREGIVER_TREND_SUFFIX = {
  worsening: " (המצב מחמיר)",
  improving: " (המצב משתפר)",
  stable: " (מצב יציב)",
};

function caregiverStatusMessage(level, trend) {
  const base = CAREGIVER_STATUS_BY_LEVEL[level] || CAREGIVER_STATUS_BY_LEVEL.no_data;
  if (trend && level !== "no_data") {
    return base + (CAREGIVER_TREND_SUFFIX[trend] || "");
  }
  return base;
}

// תג רמת סיכון קטן לשימוש בטבלאות (למשל עמודת "רמת סיכון" בטבלת ההזמנות)
function riskBadgeHtml(currentRisk) {
  if (!currentRisk) {
    return `<span class="risk-badge risk-badge-muted">לא נבדק</span>`;
  }
  const cls = RISK_BADGE_CLASS[currentRisk.risk_level] || "risk-badge-muted";
  return `<span class="risk-badge ${cls}">${RISK_LEVEL_HE[currentRisk.risk_level] || currentRisk.risk_level}</span>`;
}

// בונה תצוגת HTML (read-only) לדוח ביקור, לשימוש במסך "ההזמנות שלי" של המטופל
function visitReportDetailsHtml(report) {
  const vitalsHtml = VITALS_META.map((v) => {
    const val = report[v.key];
    if (val === null || val === undefined) return "";
    return `<div class="vr-vital"><span class="vr-vital-label">${v.label}</span><span class="vr-vital-value">${val}${v.unit ? " " + v.unit : ""}</span></div>`;
  }).join("");

  const proceduresHtml = PROCEDURE_META.filter((p) => report[p.key]).map((p) => `<li>${p.label}</li>`).join("");
  const date = new Date(report.visit_date);

  return `
    <div class="visit-report-card">
      <div class="meta">בוצע ב-${formatDateHe(date)} ${formatTimeHe(date)}</div>
      ${vitalsHtml ? `<div class="vr-vitals-grid">${vitalsHtml}</div>` : ""}
      ${proceduresHtml ? `<div class="vr-procedures"><strong>פרוצדורות שבוצעו:</strong><ul>${proceduresHtml}</ul></div>` : ""}
      <div class="vr-summary"><strong>סיכום:</strong> ${escapeHtml(report.treatment_summary)}</div>
      ${report.patient_signature_data && report.patient_signature_data.startsWith("data:image/png;base64,") ? `<div class="vr-signature"><strong>חתימת מטופל:</strong><br><img src="${report.patient_signature_data}" alt="חתימת מטופל"></div>` : ""}
    </div>
  `;
}

function formatAvailability(staff) {
  const days = (staff.available_weekdays || []).slice().sort().map((d) => WEEKDAY_SHORT[d]).join(", ");
  const start = staff.work_start_time?.slice(0, 5);
  const end = staff.work_end_time?.slice(0, 5);
  return `ימים ${days} · ${start}–${end}`;
}

function formatDateHe(date) {
  return date.toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
}

function formatTimeHe(date) {
  return date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

// מבטיח זהות אורח (guest) בלי מסך התחברות: אם אין session פעיל, נוצר session אנונימי
// שקוף למשתמש (בדיוק כמו גלישה חופשית באתר הזמנת טיסות לפני ש"נכנסים לקופה").
// ה-RLS בבסיס הנתונים ממשיך לעבוד כרגיל כי גם למשתמש אנונימי יש auth.uid() אמיתי.
async function ensureGuestSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) return session.user;
  const { data, error } = await supabaseClient.auth.signInAnonymously();
  if (error) {
    console.error("guest session error", error);
    return null;
  }
  return data.user;
}

// יוצר/מעדכן את שורת המטופל עם הפרטים שהוזנו בשלב אישור ההזמנה (upsert)
async function savePatientDetails(user, details) {
  const payload = { id: user.id, full_name: details.full_name };
  // שדות אופציונליים (phone/address/national_id) רק אם סופקו בפועל — לא דורסים ערך
  // קיים בקריאה חלקית (למשל טופס "יצירת קשר" בדף הבית ששולח רק שם, לא כתובת).
  if (details.phone) payload.phone = details.phone;
  if (details.address) payload.address = details.address;
  if (details.national_id) payload.national_id = details.national_id;
  return supabaseClient.from("patients").upsert(payload);
}

function wireReset(buttonId = "reset-btn") {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    sessionStorage.clear();
    window.location.href = "index.html";
  });
}

function showError(el, message) {
  el.textContent = message;
  el.classList.add("show");
}

function hideError(el) {
  el.classList.remove("show");
}

// מציג/מסתיר מצב טעינה על כפתור (עם ספינר) בלי לאבד את הטקסט המקורי
function setButtonLoading(btn, isLoading, loadingText) {
  if (isLoading) {
    if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${loadingText}</span>`;
  } else {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.textContent = btn.dataset.originalText || btn.textContent;
    delete btn.dataset.originalText;
  }
}

// מציג שורת טעינה (ספינר + טקסט) בתוך קונטיינר, לשימוש בזמן טעינת רשימות
function showLoadingRow(container, text) {
  container.innerHTML = `<div class="loading-row" role="status"><span class="spinner spinner-dark" aria-hidden="true"></span><span>${text}</span></div>`;
}

// ===== תיק מטופל: תוויות משותפות =====
const SEVERITY_LABELS = { mild: "קלה", moderate: "בינונית", severe: "חמורה" };
const NOTE_TYPE_LABELS = { nursing: "הערת אחות/אח", medical: "הערה רפואית", follow_up: "מעקב", general: "כללי" };
const ROUTE_LABELS = { oral: "פומי", iv: "תוך-ורידי", im: "תוך-שרירי", sc: "תת-עורי", inhaled: "שאיפה", topical: "מקומי", other: "אחר" };
const SERVICE_PLAN_STATUS_LABELS = {
  requested: "התבקש", pending_approval: "ממתין לאישור", active: "פעיל",
  paused: "מושהה", completed: "הושלם", cancelled: "בוטל",
};
const ALERT_TYPE_LABELS = {
  new_red: "התראת סיכון אדום", worsening_trend: "מגמת החמרה", vital_anomaly: "חריגה במדד", repeated_abnormal: "חריגות חוזרות",
};
const RISK_LEVEL_ORDER = { red: 3, yellow: 2, green: 1, no_data: 0 };

function calcAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const diffMs = Date.now() - dob.getTime();
  return Math.floor(diffMs / (365.25 * 24 * 3600 * 1000));
}

// ===== מצב לקוח בזיכרון בלבד לתיק המטופל הפתוח =====
// לא ב-localStorage בכוונה: מידע קליני לא אמור לשבת באחסון דפדפן קבוע. המטרה היחידה
// כאן היא למנוע קריאת רשת חוזרת ל-Supabase כשעוברים בין הלשוניות של אותו תיק פתוח —
// המידע עצמו כבר נשלף פעם אחת בלגיטימיות, רק לא נשלף שוב על כל החלפת לשונית.
// מתאפס לגמרי במעבר למטופל אחר, ומבוטל (invalidate) לשדה ספציפי אחרי כל כתיבה עליו.
window.currentPatientState = null;

function prResetState(patientId) {
  window.currentPatientState = {
    patientId,
    patient: null, allergies: null, medicalHistory: null, currentRisk: null,
    bookings: null, visitReports: null, medications: null, servicePlans: null,
    servicePlanVisits: null, clinicalNotes: null, documents: null, alerts: null,
    tasks: null, auditLog: null,
  };
}

function prInvalidate(...keys) {
  if (!window.currentPatientState) return;
  keys.forEach((k) => { window.currentPatientState[k] = null; });
}

// ===== שליפות תיק מטופל — משותף בין admin.html ו-employee.html =====
// היה קוד כמעט-זהה משוכפל בשני הקבצים (כל אחד הגדיר את זה בעצמו) — אוחד לכאן,
// מקור אחד. פועל מול window.currentPatientState.patientId, כמו prCached שקורא לזה.
async function prFetchPatient() {
  const { data, error } = await supabaseClient.from("patients").select("*").eq("id", window.currentPatientState.patientId).single();
  if (error) throw error;
  return data;
}
async function prFetchAllergies(patientId = window.currentPatientState.patientId) {
  const { data, error } = await supabaseClient.from("patient_allergies").select("*").eq("patient_id", patientId).order("created_at", { ascending: false });
  if (error) { console.error("patient_allergies", error); return []; }
  return data || [];
}
async function prFetchMedicalHistory() {
  const { data, error } = await supabaseClient.from("patient_medical_history").select("*").eq("patient_id", window.currentPatientState.patientId).maybeSingle();
  if (error) { console.error("patient_medical_history", error); return null; }
  return data;
}
async function prFetchBookings() {
  const { data, error } = await supabaseClient.from("bookings").select("*, medical_staff(full_name, role)").eq("patient_id", window.currentPatientState.patientId).order("scheduled_at", { ascending: false });
  if (error) { console.error("bookings", error); return []; }
  return data || [];
}
async function prFetchVisitReports() {
  const { data, error } = await supabaseClient.from("visit_reports").select("*").eq("patient_id", window.currentPatientState.patientId).order("visit_date", { ascending: false });
  if (error) { console.error("visit_reports", error); return []; }
  return data || [];
}
async function prFetchMedications() {
  const { data, error } = await supabaseClient.from("medication_events").select("*").eq("patient_id", window.currentPatientState.patientId).order("administered_at", { ascending: false });
  if (error) { console.error("medication_events", error); return []; }
  return data || [];
}
async function prFetchServicePlans() {
  const { data, error } = await supabaseClient.from("service_plans").select("*").eq("patient_id", window.currentPatientState.patientId).order("created_at", { ascending: false });
  if (error) { console.error("service_plans", error); return []; }
  return data || [];
}
async function prFetchClinicalNotes() {
  const { data, error } = await supabaseClient.from("clinical_notes").select("*").eq("patient_id", window.currentPatientState.patientId).order("created_at", { ascending: false });
  if (error) { console.error("clinical_notes", error); return []; }
  return data || [];
}
async function prFetchDocuments() {
  const { data, error } = await supabaseClient.from("patient_documents").select("*").eq("patient_id", window.currentPatientState.patientId).order("created_at", { ascending: false });
  if (error) { console.error("patient_documents", error); return []; }
  return data || [];
}
async function prFetchAlerts() {
  const { data, error } = await supabaseClient.from("alerts").select("*").eq("patient_id", window.currentPatientState.patientId).order("created_at", { ascending: false });
  if (error) { console.error("alerts", error); return []; }
  return data || [];
}
async function prFetchTasks() {
  const { data, error } = await supabaseClient.from("tasks").select("*").eq("patient_id", window.currentPatientState.patientId).order("due_at", { ascending: true });
  if (error) { console.error("tasks", error); return []; }
  return data || [];
}

// ===== נגישות מודלים: focus-trap + Escape לסגירה + החזרת פוקוס =====
// גנרי לכל .modal-overlay עם role="dialog" — לא תלוי בתוכן ספציפי של מודל.
function setupModalAccessibility(modalEl) {
  let lastFocused = null;
  const getFocusable = () => Array.from(modalEl.querySelectorAll(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
  )).filter((el) => el.offsetParent !== null);

  const observer = new MutationObserver(() => {
    const isOpen = modalEl.style.display !== "none" && modalEl.style.display !== "";
    if (isOpen && !modalEl.dataset.a11yOpen) {
      modalEl.dataset.a11yOpen = "1";
      lastFocused = document.activeElement;
      const focusable = getFocusable();
      if (focusable[0]) focusable[0].focus();
    } else if (!isOpen && modalEl.dataset.a11yOpen) {
      delete modalEl.dataset.a11yOpen;
      if (lastFocused && document.body.contains(lastFocused)) lastFocused.focus();
    }
  });
  observer.observe(modalEl, { attributes: true, attributeFilter: ["style"] });

  modalEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      modalEl.style.display = "none";
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = getFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

function setupAllModalsAccessibility() {
  document.querySelectorAll('.modal-overlay[role="dialog"]').forEach(setupModalAccessibility);
}

async function prCached(key, fetchFn) {
  const state = window.currentPatientState;
  if (state[key] !== null) return state[key];
  state[key] = await fetchFn();
  return state[key];
}

// הופך שגיאות רשת (למשל אין חיבור לאינטרנט) להודעה ברורה בעברית.
// err עשוי להיות Error רגיל, PostgrestError של supabase-js, מחרוזת, או משהו אחר —
// String(err) על אובייקט בלי .message תקין מדפיס "[object Object]" למשתמש, אז יש
// ברירת מחדל כללית וקריאה במקום זאת (לא JSON גולמי — גם הוא לא ידידותי למשתמש).
function friendlyErrorMessage(err) {
  let msg;
  if (typeof err === "string" && err.trim()) {
    msg = err;
  } else if (err && typeof err.message === "string" && err.message.trim()) {
    msg = err.message;
  } else {
    msg = "אירעה שגיאה לא צפויה. נא לנסות שוב.";
  }
  if (/failed to fetch|network|load failed|ERR_/i.test(msg)) {
    return "בעיית חיבור לאינטרנט. נא לבדוק את החיבור ולנסות שוב.";
  }
  return msg;
}

// ===== באנר זמינות שירות התחזית =====
// שירות predictive-service הוא תהליך Python מקומי שמופעל ידנית, לא שירות שרץ תמיד.
// במקום שכל כפתור (תחזית מגמה / אבחון מקיף / תצוגה חיה) יגלה בנפרד רק בלחיצה
// שהשירות לא זמין, בודקים פעם אחת ברקע ומציגים באנר קבוע וברור בראש העמוד —
// "no button may fail silently" ברמת העמוד כולו, לא רק ברמת כפתור בודד.
// שמירה מרכזית: באתר מאורח שירות התחזית (localhost) לא קיים, ולכן קריאות אליו
// מקבלות מיד 503 סינתטי במקום ERR_CONNECTION_REFUSED בקונסולה. קוד הקורא כבר
// מטפל ב-!res.ok ומציג "השירות אינו זמין".
(function guardPredictiveServiceFetch() {
  if (typeof window === "undefined" || typeof window.fetch !== "function" || typeof Response === "undefined") return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const base = window.PREDICTIVE_SERVICE_URL || "";
      const hostedOrigin = !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
      if (base && hostedOrigin && /localhost|127\.0\.0\.1/.test(base) && url.startsWith(base)) {
        return Promise.resolve(new Response(JSON.stringify({ detail: "predictive service unavailable in hosted demo" }), { status: 503, headers: { "Content-Type": "application/json" } }));
      }
    } catch (e) { /* נופלים ל-fetch המקורי */ }
    return nativeFetch(input, init);
  };
})();

// ===== שמירה על כפתור "תחזית מגמת מדדים": מעט היסטוריה = הודעה ברורה, לפני כל קריאה =====
// המאזין רשום בשלב ה-capture ברמת ה-document, ולכן רץ לפני ה-handler של הכפתור עצמו
// (ב-admin.html). כשיש פחות מ-3 מדידות היסטוריות עוצרים את ההמשך ומציגים הודעה —
// לא כשל שקט ולא קריאה מיותרת לשירות התחזית.
const TREND_MIN_HISTORY = 3;
const TREND_LOW_DATA_MESSAGE = "אנליזה בשלב איסוף נתונים. נדרשות לפחות 3 מדידות היסטוריות להצגת גרף החיזוי הרפואי";
if (typeof document !== "undefined" && typeof document.addEventListener === "function") document.addEventListener("click", async (e) => {
  const btn = e.target && e.target.closest ? e.target.closest("#vr-check-trend-btn") : null;
  if (!btn || btn.dataset.trendChecked === "1") return;
  const modal = document.getElementById("visit-report-modal");
  const patientId = modal && modal.dataset ? modal.dataset.patientId : null;
  const resultEl = document.getElementById("vr-trend-result");
  if (!patientId || !resultEl || typeof supabaseClient === "undefined") return;
  e.stopImmediatePropagation();
  e.preventDefault();
  try {
    const { data, error } = await supabaseClient.from("visit_reports").select("id").eq("patient_id", patientId);
    if (error) throw error;
    if ((data || []).length < TREND_MIN_HISTORY) {
      resultEl.textContent = "";
      const p = document.createElement("p");
      p.setAttribute("role", "status");
      p.style.color = "var(--text-muted)";
      p.textContent = TREND_LOW_DATA_MESSAGE;
      resultEl.appendChild(p);
      return;
    }
  } catch (err) {
    // אי אפשר לברר כמה מדידות יש — לא חוסמים, נותנים ל-handler הרגיל לטפל (כולל הודעת שגיאה)
  }
  btn.dataset.trendChecked = "1";
  try { btn.click(); } finally { delete btn.dataset.trendChecked; }
}, true);

function isLocalHost() {
  return ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
}

// שירות התחזית רץ מקומית בלבד. בפריסה מאורחת (https) הכתובת localhost לא נגישה
// מהדפדפן של המבקר, ולכן אין טעם להציג לכל מבקר באנר "לא זמין" — מדלגים עליו.
async function checkPredictiveServiceHealth() {
  if (!isLocalHost() && /localhost|127\.0\.0\.1/.test(window.PREDICTIVE_SERVICE_URL || "")) return;
  let banner = document.getElementById("predictive-offline-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "predictive-offline-banner";
    banner.className = "predictive-offline-banner";
    banner.setAttribute("role", "status");
    banner.textContent = "⚠️ שירות התחזיות אינו זמין כרגע — תחזיות ומגמות לא יוצגו עד שהשירות יופעל.";
    banner.style.display = "none";
    document.body.prepend(banner);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${window.PREDICTIVE_SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    banner.style.display = res.ok ? "none" : "block";
  } catch (err) {
    banner.style.display = "block";
  }
}

// באנר הדגמה: מוצג כשהאתר רץ במצב DEMO_MODE (config.js), אחרת לא.
function showDemoBanner() {
  if (!window.DEMO_MODE || document.getElementById("demo-banner")) return;
  const banner = document.createElement("div");
  banner.id = "demo-banner";
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-label", "הודעת הדגמה");
  banner.style.cssText = "background:var(--primary-light);color:var(--primary-dark);text-align:center;padding:10px 16px;font-size:14px;font-weight:600;border-bottom:1px solid var(--border);";
  banner.append("מערכת הדגמה — נתונים סינתטיים בלבד. אל תזינו מידע אישי או רפואי אמיתי. ");
  const link = document.createElement("a");
  link.href = "demo-notice.html";
  link.textContent = "פרטים";
  link.style.color = "inherit";
  banner.append(link);
  document.body.prepend(banner);
}

function initPredictiveServiceHealthCheck() {
  showDemoBanner();
  checkPredictiveServiceHealth();
  updateOfflineDraftBanner();
  setInterval(() => { checkPredictiveServiceHealth(); updateOfflineDraftBanner(); }, 45000);
}

// ===== באנר "דוחות ממתינים לסנכרון" =====
// getQueuedDraftCount() (למעלה) חושב ומעולם לא הוצג — עכשיו יש לו שימוש אמיתי:
// כשיש טיוטות שמורות מקומית (למשל אחות שאיבדה קליטה תוך כדי ביקור), רואים את
// זה בבירור בראש העמוד, לא רק אחרי שה-online event יורה מאחורי הקלעים.
function updateOfflineDraftBanner() {
  let banner = document.getElementById("offline-draft-banner");
  const count = getQueuedDraftCount();
  if (!count && !offlineQueueSyncing) { if (banner) banner.style.display = "none"; return; }
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "offline-draft-banner";
    banner.className = "predictive-offline-banner";
    banner.setAttribute("role", "status");
    document.body.prepend(banner);
  }
  banner.textContent = offlineQueueSyncing
    ? "📶 מסנכרן דוחות ביקור שמורים מקומית..."
    : count === 1
      ? "📶 דוח ביקור אחד שמור מקומית וממתין לסנכרון — יסונכרן אוטומטית כשהחיבור יחזור."
      : `📶 ${count} דוחות ביקור שמורים מקומית וממתינים לסנכרון — יסונכרנו אוטומטית כשהחיבור יחזור.`;
  banner.style.display = "block";
}

// ===== התראת הזמנות חדשות (בתוך האפליקציה בלבד) =====
// סקר כל 60 שניות כשהלשונית גלויה. lastSeen לכל משתמש ב-localStorage. כשלים שקטים.
// עובד רק כשהעמוד פתוח בדפדפן — התראה כשהוא סגור תדרוש אימייל/SMS בעתיד.
function startNewBookingWatcher({ scope, staffId } = {}) {
  if (window.__newBookingWatcher) return window.__newBookingWatcher;
  const userKey = scope === "admin" ? "admin" : "staff-" + (staffId || "");
  const storeKey = "newBookingLastSeen:" + userKey;
  const baseTitle = document.title;
  const POLL_MS = 60000;
  let items = [];
  let timer = null;
  let notifiedIds = new Set();
  let box = null;

  function getLastSeen() {
    try {
      const v = localStorage.getItem(storeKey);
      if (v && !isNaN(Date.parse(v))) return v;
    } catch (e) {}
    return new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  }
  function setLastSeen(iso) {
    try { localStorage.setItem(storeKey, iso); } catch (e) {}
  }

  function ensureBox() {
    if (box && box.isConnected) return box;
    const main = document.getElementById("main-content");
    if (!main) return null;
    box = document.createElement("div");
    box.id = "new-booking-banner";
    box.className = "card card-compact";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.style.marginBottom = "16px";
    box.hidden = true;
    const h1 = main.querySelector("h1");
    if (h1 && h1.nextSibling) main.insertBefore(box, h1.nextSibling); else main.prepend(box);
    return box;
  }

  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    if (cls === "nb-hint") { e.style.fontSize = "14px"; e.style.color = "var(--text-muted)"; e.style.marginTop = "6px"; }
    return e;
  }

  function render() {
    const b = ensureBox();
    if (!b) return;
    const n = items.length;
    document.title = n > 0 ? `(${n}) ${baseTitle}` : baseTitle;
    b.textContent = "";
    if (n === 0) { b.hidden = true; return; }
    b.hidden = false;
    b.appendChild(el("strong", `📅 יש ${n} ביקורים חדשים`));
    const ul = el("ul");
    ul.style.margin = "8px 0";
    ul.style.paddingInlineStart = "20px";
    items.slice(0, 5).forEach((r) => {
      const when = r.scheduled_at ? new Date(r.scheduled_at) : null;
      const whenTxt = when && !isNaN(when) ? `${formatDateHe(when)} ${formatTimeHe(when)}` : "";
      const name = (r.patients && r.patients.full_name) || "מטופל/ת";
      const purpose = PURPOSE_LABELS[r.visit_purpose] || "";
      ul.appendChild(el("li", [name, purpose, whenTxt].filter(Boolean).join(" · ")));
    });
    b.appendChild(ul);
    if (n > 5) b.appendChild(el("div", `ועוד ${n - 5}...`, "nb-hint"));
    const row = el("div", null, "actions-row");
    row.style.justifyContent = "flex-start";
    const read = el("button", "סימון כנקרא", "btn btn-primary btn-sm");
    read.type = "button";
    read.id = "new-booking-mark-read";
    read.addEventListener("click", () => {
      const newest = items.reduce((m, r) => (r.created_at > m ? r.created_at : m), getLastSeen());
      setLastSeen(newest);
      items = [];
      render();
    });
    row.appendChild(read);
    if (scope === "admin") {
      const go = el("button", "מעבר לתור העבודה", "btn btn-ghost btn-sm");
      go.type = "button";
      go.addEventListener("click", () => {
        const q = document.getElementById("work-queue");
        if (q && q.scrollIntoView) q.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      row.appendChild(go);
    }
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      const nb = el("button", "הפעלת התראות בדפדפן", "btn btn-ghost btn-sm");
      nb.type = "button";
      nb.id = "new-booking-enable-notify";
      nb.addEventListener("click", async () => {
        try { await Notification.requestPermission(); } catch (e) {}
        render();
      });
      row.appendChild(nb);
    }
    b.appendChild(row);
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      b.appendChild(el("div", "התראות הדפדפן פועלות רק כשהעמוד פתוח בדפדפן. התראה כשהעמוד סגור תדרוש אימייל/SMS בעתיד.", "nb-hint"));
    }
  }

  function maybeNotify(fresh) {
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if (document.visibilityState === "visible") return;
      const unseen = fresh.filter((r) => !notifiedIds.has(r.id));
      if (!unseen.length) return;
      unseen.forEach((r) => notifiedIds.add(r.id));
      new Notification(`יש ${unseen.length} ביקורים חדשים`, { body: "נקבעו ביקורים חדשים במערכת." });
    } catch (e) {}
  }

  async function poll() {
    try {
      if (typeof supabaseClient === "undefined") return;
      if (navigator.onLine === false) return;
      let q = supabaseClient
        .from("bookings")
        .select("id, created_at, scheduled_at, visit_purpose, staff_id, patient_id, patients(full_name)")
        .eq("status", "scheduled")
        .gt("created_at", getLastSeen())
        .order("created_at", { ascending: false })
        .limit(50);
      if (scope !== "admin" && staffId != null) q = q.eq("staff_id", staffId);
      const { data, error } = await q;
      if (error || !Array.isArray(data)) return;
      items = data;
      render();
      maybeNotify(data);
    } catch (e) { /* שקט */ }
  }

  function start() {
    stop();
    timer = setInterval(() => { if (document.visibilityState === "visible") poll(); }, POLL_MS);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") poll();
  });
  start();
  poll();
  window.__newBookingWatcher = { poll, stop };
  return window.__newBookingWatcher;
}
