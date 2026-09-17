// ===== מטופלים (תצוגה בלבד) + רקע רפואי — הוצא מ-admin.html לצורך תחזוקה =====
// Classic script בכוונה (לא <script type="module">) — אותו נימוק כמו js/admin/staff.js:
// נטען לפני admin.html כדי שה-initialization שם (Promise.all שכולל loadPatients())
// ימצא אותו מוגדר. openPatientRecord (מוגדר מאוחר יותר ב-admin.html, בבלוק "תיק
// מטופל") נקרא רק בלחיצה — סקריפטים קלאסיים חולקים scope עליון, אז זה עובד גם
// כ-forward reference בדיוק כמו לפני ההוצאה.
async function loadPatients() {
  const tbody = document.getElementById("patients-tbody");
  tbody.innerHTML = `<tr><td colspan="5"><div class="loading-row"><span class="spinner spinner-dark"></span><span>טוען...</span></div></td></tr>`;
  let data, error;
  try {
    ({ data, error } = await supabaseClient.from("patients").select("*").order("created_at", { ascending: false }));
  } catch (err) {
    error = err;
  }
  if (error) {
    tbody.innerHTML = `<tr><td colspan="5">${friendlyErrorMessage(error)}</td></tr>`;
    return;
  }
  tbody.innerHTML = "";
  (data || []).forEach((p) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.full_name}</td>
      <td>${p.phone || ""}</td>
      <td>${p.address || ""}</td>
      <td>${conditionsLabel(p.background_conditions)}${smokingStatusLabel(p.smoking_status) ? " · " + smokingStatusLabel(p.smoking_status) : ""}</td>
      <td></td>
    `;
    const actionsTd = tr.lastElementChild;
    const openBtn = document.createElement("button");
    openBtn.className = "btn btn-primary btn-sm";
    openBtn.textContent = "פתיחת תיק";
    openBtn.addEventListener("click", () => openPatientRecord(p.id));
    actionsTd.appendChild(openBtn);
    const editBtn = document.createElement("button");
    editBtn.className = "btn btn-secondary btn-sm";
    editBtn.textContent = "עריכת רקע רפואי";
    editBtn.addEventListener("click", () => openPatientConditionsModal(p));
    actionsTd.appendChild(editBtn);
    tbody.appendChild(tr);
  });
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">אין מטופלים</td></tr>`;
  }
}

const patientConditionsModal = document.getElementById("patient-conditions-modal");
const patientConditionsListEl = document.getElementById("patient-conditions-list");
CONDITION_META.forEach((c) => {
  const row = document.createElement("label");
  row.className = "procedure-row";
  row.innerHTML = `<input type="checkbox" data-condition="${c.key}"><span>${c.label}</span>`;
  patientConditionsListEl.appendChild(row);
});

function openPatientConditionsModal(patient) {
  document.getElementById("patient-conditions-id").value = patient.id;
  document.getElementById("patient-conditions-name").textContent = patient.full_name;
  const selected = new Set(patient.background_conditions || []);
  patientConditionsListEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.checked = selected.has(cb.dataset.condition);
  });
  document.getElementById("patient-smoking-status").value = patient.smoking_status || "";
  hideError(document.getElementById("patient-conditions-modal-error"));
  patientConditionsModal.style.display = "flex";
}

document.getElementById("patient-conditions-modal-cancel").addEventListener("click", () => {
  patientConditionsModal.style.display = "none";
});

document.getElementById("patient-conditions-modal-save").addEventListener("click", async () => {
  const modalError = document.getElementById("patient-conditions-modal-error");
  hideError(modalError);
  const patientId = document.getElementById("patient-conditions-id").value;
  const conditions = [...patientConditionsListEl.querySelectorAll("input[type=checkbox]:checked")].map((cb) => cb.dataset.condition);
  const smokingStatus = document.getElementById("patient-smoking-status").value || null;

  const btn = document.getElementById("patient-conditions-modal-save");
  setButtonLoading(btn, true, "שומר...");
  let error;
  try {
    ({ error } = await supabaseClient.from("patients").update({ background_conditions: conditions, smoking_status: smokingStatus }).eq("id", patientId));
  } catch (err) {
    error = err;
  } finally {
    setButtonLoading(btn, false);
  }

  if (error) { showError(modalError, friendlyErrorMessage(error)); return; }
  patientConditionsModal.style.display = "none";
  flashSuccess("הרקע הרפואי נשמר");
  loadPatients();
});
