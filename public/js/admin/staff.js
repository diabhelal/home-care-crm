// ===== ניהול צוות רפואי — הוצא מ-admin.html לצורך תחזוקה =====
// Classic script בכוונה (לא <script type="module">): נטען לפני admin.html עצמו (ר'
// סדר ה-<script> ב-admin.html), כדי שה-initialization שם (Promise.all שכולל
// loadStaff()) והרינדור של תור העבודה (שקורא ל-staffListCache) ימצאו את שניהם כבר
// מוגדרים — בדיוק כמו היום. ES module היה נטען *אחרי* כל הסקריפטים הקלאסיים (סדר
// טעינה שונה לגמרי בספסיפיקציה), מה שהיה שובר את סדר האתחול הקיים. סקריפטים
// קלאסיים שנטענים בסדר חולקים scope עליון משותף (כמו app.js -> admin.html היום) —
// staffListCache/loadStaff/openStaffModal/deleteStaff/createStaffLogin נשארים
// נגישים כשם חשוף (bare identifier) לשאר admin.html בדיוק כמו לפני ההוצאה הזו,
// בלי צורך ב-window.* גישור.
let staffListCache = []; // מתמלא ב-loadStaff(), נעזרים בו בתפריט שיוך-מחדש בתור העבודה

async function loadStaff() {
  const tbody = document.getElementById("staff-tbody");
  tbody.innerHTML = `<tr><td colspan="10"><div class="loading-row"><span class="spinner spinner-dark"></span><span>טוען...</span></div></td></tr>`;
  let data, error;
  try {
    ({ data, error } = await supabaseClient.from("medical_staff").select("*").order("id"));
  } catch (err) {
    error = err;
  }
  if (error) {
    tbody.innerHTML = `<tr><td colspan="10">${friendlyErrorMessage(error)}</td></tr>`;
    return;
  }
  staffListCache = data || []; // לשימוש חוזר בתפריט שיוך-מחדש בתור העבודה, בלי לשלוף שוב
  tbody.innerHTML = "";
  (data || []).forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(s.full_name)}</td>
      <td>${ROLE_LABELS[s.role] || s.role}</td>
      <td>${escapeHtml(s.specialization || "")}</td>
      <td>${escapeHtml(s.phone || "")}</td>
      <td>${(s.available_weekdays || []).map((d) => WEEKDAY_SHORT[d]).join(", ")}</td>
      <td>${s.work_start_time?.slice(0,5)}–${s.work_end_time?.slice(0,5)}</td>
      <td>${s.slot_duration_minutes} ד'</td>
      <td>${s.is_active ? "כן" : "לא"}</td>
      <td></td>
      <td></td>
    `;
    const loginTd = tr.children[8];
    if (s.auth_user_id) {
      loginTd.innerHTML = '<span class="pr-badge pr-badge-resolved">מחובר/ת</span>';
    } else if (s.email) {
      const createLoginBtn = document.createElement("button");
      createLoginBtn.className = "btn btn-secondary btn-sm";
      createLoginBtn.textContent = "יצירת כניסה";
      createLoginBtn.addEventListener("click", () => createStaffLogin(s, createLoginBtn));
      loginTd.appendChild(createLoginBtn);
    } else {
      loginTd.innerHTML = '<span style="color:var(--text-muted); font-size:12px;">יש להוסיף אימייל</span>';
    }
    const actionsTd = tr.lastElementChild;
    const editBtn = document.createElement("button");
    editBtn.className = "btn btn-secondary btn-sm";
    editBtn.textContent = "עריכה";
    editBtn.addEventListener("click", () => openStaffModal(s));
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "מחיקה";
    delBtn.addEventListener("click", () => deleteStaff(s.id, s.full_name));
    actionsTd.appendChild(editBtn);
    actionsTd.appendChild(delBtn);
    tbody.appendChild(tr);
  });
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">אין אנשי צוות</td></tr>`;
  }
}

const STAFF_LOGIN_ERROR_HE = {
  admin_only: "פעולה זו מיועדת למנהלי מערכת בלבד",
  staff_not_found: "איש הצוות לא נמצא",
  staff_missing_email: "יש להוסיף אימייל לאיש הצוות לפני יצירת כניסה",
  staff_already_linked: "לאיש צוות זה כבר יש כניסה מקושרת",
  invite_failed: "שליחת ההזמנה נכשלה",
  invite_sent_but_link_failed: "ההזמנה נשלחה אך קישור החשבון נכשל",
  not_authenticated: "יש להתחבר מחדש",
};

// קורא לפונקציית ה-Edge Function (server-side, מחזיקה service_role שם בלבד —
// לעולם לא בדפדפן) שמזמינה בפועל את איש הצוות ומקשרת את חשבון ה-Auth שלו לשורה
// המתאימה ב-medical_staff.
async function createStaffLogin(staff, btn) {
  hideError(appError);
  setButtonLoading(btn, true, "יוצר...");
  const { data, error } = await supabaseClient.functions.invoke("create-staff-login", {
    body: { staff_id: staff.id, origin: window.location.origin },
  });
  setButtonLoading(btn, false);
  // ב-supabase-js, תשובת שגיאה (סטטוס לא 2xx) מגיעה כ-error עם ה-Response הגולמי תחת
  // error.context — לא ב-data — לכן שולפים משם את קוד השגיאה שהפונקציה החזירה בגוף.
  let errorCode = data?.error || null;
  if (error && !errorCode) {
    try {
      const body = await error.context?.json?.();
      errorCode = body?.error || null;
    } catch (e) { /* אין גוף JSON תקין — נופלים ל-friendlyErrorMessage למטה */ }
  }
  if (errorCode || error) {
    flashError(STAFF_LOGIN_ERROR_HE[errorCode] || friendlyErrorMessage(error) || "שגיאה ביצירת הכניסה");
    return;
  }
  flashSuccess(`הזמנה נשלחה ל-${staff.email} — ${staff.full_name} יקבל/תקבל מייל להגדרת סיסמה`);
  loadStaff();
}

async function deleteStaff(id, name) {
  if (!confirm(`למחוק את ${name}? פעולה זו תמחק גם את כל ההזמנות המשויכות אליו/ה.`)) return;
  hideError(appError);
  let error;
  try {
    ({ error } = await supabaseClient.from("medical_staff").delete().eq("id", id));
  } catch (err) {
    error = err;
  }
  if (error) { showError(appError, friendlyErrorMessage(error)); return; }
  flashSuccess("איש הצוות נמחק");
  loadStaff();
  loadBookings();
}

// מודל הוספה/עריכה של איש צוות
const staffModal = document.getElementById("staff-modal");
const weekdaysEl = document.getElementById("staff-weekdays");
WEEKDAY_LABELS.forEach((label, idx) => {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.textContent = label;
  chip.dataset.day = idx;
  chip.setAttribute("aria-pressed", "false");
  chip.addEventListener("click", () => {
    const active = chip.classList.toggle("selected");
    chip.setAttribute("aria-pressed", String(active));
  });
  weekdaysEl.appendChild(chip);
});

function openStaffModal(staff) {
  document.getElementById("staff-modal-title").textContent = staff ? "עריכת איש צוות" : "הוספת איש צוות";
  document.getElementById("staff-id").value = staff?.id || "";
  document.getElementById("staff-full-name").value = staff?.full_name || "";
  document.getElementById("staff-role").value = staff?.role || "nurse";
  document.getElementById("staff-spec").value = staff?.specialization || "";
  document.getElementById("staff-national-id").value = staff?.national_id || "";
  document.getElementById("staff-email").value = staff?.email || "";
  document.getElementById("staff-phone").value = staff?.phone || "";
  document.getElementById("staff-start").value = staff?.work_start_time?.slice(0,5) || "08:00";
  document.getElementById("staff-end").value = staff?.work_end_time?.slice(0,5) || "16:00";
  document.getElementById("staff-duration").value = staff?.slot_duration_minutes || 60;
  document.getElementById("staff-active").checked = staff ? staff.is_active : true;
  const selectedDays = new Set(staff?.available_weekdays || [0,1,2,3,4]);
  weekdaysEl.querySelectorAll(".chip").forEach((chip) => {
    const on = selectedDays.has(Number(chip.dataset.day));
    chip.classList.toggle("selected", on);
    chip.setAttribute("aria-pressed", String(on));
  });
  hideError(document.getElementById("staff-modal-error"));
  staffModal.style.display = "flex";
}

document.getElementById("add-staff-btn").addEventListener("click", () => openStaffModal(null));
document.getElementById("staff-modal-cancel").addEventListener("click", () => { staffModal.style.display = "none"; });

document.getElementById("staff-modal-save").addEventListener("click", async () => {
  const modalError = document.getElementById("staff-modal-error");
  hideError(modalError);
  const id = document.getElementById("staff-id").value;
  const fullName = document.getElementById("staff-full-name").value.trim();
  const weekdays = [...weekdaysEl.querySelectorAll(".chip.selected")].map((c) => Number(c.dataset.day));
  if (!fullName) { showError(modalError, "נא למלא שם מלא"); return; }
  if (weekdays.length === 0) { showError(modalError, "נא לבחור לפחות יום עבודה אחד"); return; }

  const payload = {
    full_name: fullName,
    role: document.getElementById("staff-role").value,
    specialization: document.getElementById("staff-spec").value.trim() || null,
    national_id: document.getElementById("staff-national-id").value.trim() || null,
    email: document.getElementById("staff-email").value.trim() || null,
    phone: document.getElementById("staff-phone").value.trim() || null,
    available_weekdays: weekdays,
    work_start_time: document.getElementById("staff-start").value,
    work_end_time: document.getElementById("staff-end").value,
    slot_duration_minutes: Number(document.getElementById("staff-duration").value),
    is_active: document.getElementById("staff-active").checked,
  };

  const btn = document.getElementById("staff-modal-save");
  setButtonLoading(btn, true, "שומר...");
  let error;
  try {
    ({ error } = id
      ? await supabaseClient.from("medical_staff").update(payload).eq("id", id)
      : await supabaseClient.from("medical_staff").insert(payload));
  } catch (err) {
    error = err;
  } finally {
    setButtonLoading(btn, false);
  }

  if (error) { showError(modalError, friendlyErrorMessage(error)); return; }
  staffModal.style.display = "none";
  flashSuccess("איש הצוות נשמר");
  loadStaff();
});
