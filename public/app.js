// לוגיקה משותפת לכל דפי המערכת
const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

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
  return supabaseClient.from("patients").upsert({
    id: user.id,
    full_name: details.full_name,
    phone: details.phone,
    address: details.address,
  });
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

// הופך שגיאות רשת (למשל אין חיבור לאינטרנט) להודעה ברורה בעברית
function friendlyErrorMessage(err) {
  const msg = err?.message || String(err);
  if (/failed to fetch|network|load failed|ERR_/i.test(msg)) {
    return "בעיית חיבור לאינטרנט. נא לבדוק את החיבור ולנסות שוב.";
  }
  return msg;
}
