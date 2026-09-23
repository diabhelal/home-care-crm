// ===== פניות מהאתר (טופס "יצירת קשר" בדף הבית, index.html) — תצוגה בלבד =====
// Classic script בכוונה (לא <script type="module">) — אותו נימוק כמו js/admin/staff.js
// ו-js/admin/patients.js: נטען לפני admin.html, חולק scope עליון עם app.js/config.js.
// patient_contacts כבר קיימת בסכמה עם RLS admin מלא (admin_full_access_patient_contacts) —
// זה רק מסך קריאה חדש, בלי שינוי סכמה/RLS.
async function loadContacts() {
  const tbody = document.getElementById("contacts-tbody");
  tbody.innerHTML = `<tr><td colspan="5"><div class="loading-row"><span class="spinner spinner-dark"></span><span>טוען...</span></div></td></tr>`;
  let data, error;
  try {
    ({ data, error } = await supabaseClient
      .from("patient_contacts")
      .select("*, patients(full_name, phone)")
      .order("created_at", { ascending: false }));
  } catch (err) {
    error = err;
  }
  if (error) {
    tbody.innerHTML = `<tr><td colspan="5">${friendlyErrorMessage(error)}</td></tr>`;
    return;
  }
  tbody.innerHTML = "";
  (data || []).forEach((c) => {
    const tr = document.createElement("tr");
    const createdAt = new Date(c.created_at);
    tr.innerHTML = `
      <td>${formatDateHe(createdAt)} ${formatTimeHe(createdAt)}</td>
      <td>${escapeHtml(c.patients?.full_name || "—")}</td>
      <td>${escapeHtml(c.patients?.phone || "—")}</td>
      <td>${escapeHtml(c.subject || "—")}</td>
      <td style="white-space:pre-wrap;">${escapeHtml(c.body)}</td>
    `;
    tbody.appendChild(tr);
  });
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">אין פניות</td></tr>`;
  }
}
