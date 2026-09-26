// ===== פניות מהאתר (טופס "יצירת קשר" בדף הבית, index.html) =====
// Classic script בכוונה (לא <script type="module">) — אותו נימוק כמו js/admin/staff.js
// ו-js/admin/patients.js: נטען לפני admin.html, חולק scope עליון עם app.js/config.js.
//
// patient_contacts תומכת בשרשור דו-כיווני (is_from_patient: true=מטופל, false=צוות) —
// תשובת מנהל היא פשוט שורה נוספת עם is_from_patient=false על אותו patient_id, לא
// מנגנון נפרד. status ('open'/'archived') נוסף כדי לתמוך ב"סימון כטופל → ארכיון".
let contactsFilterStatus = "open";

async function loadContacts() {
  const tbody = document.getElementById("contacts-tbody");
  tbody.innerHTML = `<tr><td colspan="6"><div class="loading-row"><span class="spinner spinner-dark"></span><span>טוען...</span></div></td></tr>`;
  let data, error;
  try {
    ({ data, error } = await supabaseClient
      .from("patient_contacts")
      .select("*, patients(full_name, phone)")
      .eq("is_from_patient", true)
      .eq("status", contactsFilterStatus)
      .order("created_at", { ascending: false }));
  } catch (err) {
    error = err;
  }
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6">${friendlyErrorMessage(error)}</td></tr>`;
    return;
  }
  tbody.innerHTML = "";
  (data || []).forEach((c) => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.setAttribute("role", "button");
    tr.setAttribute("tabindex", "0");
    const createdAt = new Date(c.created_at);
    tr.innerHTML = `
      <td>${formatDateHe(createdAt)} ${formatTimeHe(createdAt)}</td>
      <td>${escapeHtml(c.patients?.full_name || "—")}</td>
      <td>${escapeHtml(c.patients?.phone || "—")}</td>
      <td>${escapeHtml(c.subject || "—")}</td>
      <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(c.body)}</td>
      <td><span class="status-badge ${c.status === "archived" ? "completed" : "scheduled"}">${c.status === "archived" ? "בארכיון" : "פתוחה"}</span></td>
    `;
    const open = () => openContactModal(c);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    tbody.appendChild(tr);
  });
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${contactsFilterStatus === "archived" ? "אין פניות בארכיון" : "אין פניות פתוחות"}</td></tr>`;
  }
}

function wireContactsFilterTabs() {
  const openBtn = document.getElementById("contacts-filter-open");
  const archivedBtn = document.getElementById("contacts-filter-archived");
  const setFilter = (status) => {
    contactsFilterStatus = status;
    openBtn.classList.toggle("selected", status === "open");
    openBtn.setAttribute("aria-pressed", String(status === "open"));
    archivedBtn.classList.toggle("selected", status === "archived");
    archivedBtn.setAttribute("aria-pressed", String(status === "archived"));
    loadContacts();
  };
  openBtn.addEventListener("click", () => setFilter("open"));
  archivedBtn.addEventListener("click", () => setFilter("archived"));
}

// שרשור מלא לפי patient_id (כולל תשובות צוות קודמות, אם היו) — לא רק ההודעה שנלחצה
async function openContactModal(contact) {
  const modal = document.getElementById("contact-modal");
  const threadEl = document.getElementById("contact-modal-thread");
  const errEl = document.getElementById("contact-modal-error");
  hideError(errEl);
  document.getElementById("contact-modal-reply").value = "";
  document.getElementById("contact-modal-patient-id").value = contact.patient_id;
  document.getElementById("contact-modal-contact-id").value = contact.id;
  document.getElementById("contact-modal-patient").textContent =
    `${contact.patients?.full_name || "—"} · ${contact.patients?.phone || "—"}`;
  updateToggleStatusButton(contact.status);
  threadEl.innerHTML = `<div class="loading-row"><span class="spinner spinner-dark"></span><span>טוען שרשור...</span></div>`;
  modal.style.display = "flex";

  const { data: thread, error } = await supabaseClient
    .from("patient_contacts")
    .select("*")
    .eq("patient_id", contact.patient_id)
    .order("created_at", { ascending: true });

  if (error) {
    threadEl.innerHTML = "";
    showError(errEl, friendlyErrorMessage(error));
    return;
  }
  threadEl.innerHTML = (thread || []).map((m) => `
    <div style="align-self:${m.is_from_patient ? "flex-start" : "flex-end"}; max-width:85%; background:${m.is_from_patient ? "var(--border)" : "var(--primary-light)"}; border-radius:var(--radius-sm); padding:10px 12px;">
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">${m.is_from_patient ? "מטופל/ת" : "צוות"} · ${formatDateHe(new Date(m.created_at))} ${formatTimeHe(new Date(m.created_at))}${m.subject ? " · " + escapeHtml(m.subject) : ""}</div>
      <div style="white-space:pre-wrap;">${escapeHtml(m.body)}</div>
    </div>
  `).join("");
  threadEl.scrollTop = threadEl.scrollHeight;
}

function updateToggleStatusButton(status) {
  const btn = document.getElementById("contact-modal-toggle-status");
  btn.textContent = status === "archived" ? "החזרה לפתוחות" : "סימון כטופל";
  btn.dataset.currentStatus = status;
}

function closeContactModal() {
  document.getElementById("contact-modal").style.display = "none";
}

function wireContactModal() {
  document.getElementById("contact-modal-cancel").addEventListener("click", closeContactModal);

  document.getElementById("contact-modal-send").addEventListener("click", async () => {
    const btn = document.getElementById("contact-modal-send");
    const errEl = document.getElementById("contact-modal-error");
    hideError(errEl);
    const textarea = document.getElementById("contact-modal-reply");
    const body = textarea.value.trim();
    if (!body) { showError(errEl, "יש להזין טקסט למענה"); return; }
    const patientId = document.getElementById("contact-modal-patient-id").value;

    setButtonLoading(btn, true, "שולח...");
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient.from("patient_contacts").insert({
      patient_id: patientId,
      is_from_patient: false,
      channel: "message",
      body,
      created_by: user?.id || null,
    });
    setButtonLoading(btn, false);
    if (error) { showError(errEl, friendlyErrorMessage(error)); return; }
    textarea.value = "";
    const contact = { patient_id: patientId, patients: { full_name: document.getElementById("contact-modal-patient").textContent } };
    await openContactModal({ ...contact, id: document.getElementById("contact-modal-contact-id").value, status: document.getElementById("contact-modal-toggle-status").dataset.currentStatus });
  });

  document.getElementById("contact-modal-toggle-status").addEventListener("click", async () => {
    const btn = document.getElementById("contact-modal-toggle-status");
    const errEl = document.getElementById("contact-modal-error");
    hideError(errEl);
    const contactId = document.getElementById("contact-modal-contact-id").value;
    const nextStatus = btn.dataset.currentStatus === "archived" ? "open" : "archived";
    setButtonLoading(btn, true, "מעדכן...");
    const { error } = await supabaseClient.from("patient_contacts").update({ status: nextStatus }).eq("id", contactId);
    setButtonLoading(btn, false);
    if (error) { showError(errEl, friendlyErrorMessage(error)); return; }
    updateToggleStatusButton(nextStatus);
    closeContactModal();
    loadContacts();
  });

  document.getElementById("contact-modal-delete").addEventListener("click", async () => {
    if (!confirm("למחוק את הפנייה הזו? הפעולה בלתי הפיכה.")) return;
    const btn = document.getElementById("contact-modal-delete");
    const errEl = document.getElementById("contact-modal-error");
    hideError(errEl);
    const contactId = document.getElementById("contact-modal-contact-id").value;
    setButtonLoading(btn, true, "מוחק...");
    const { error } = await supabaseClient.from("patient_contacts").delete().eq("id", contactId);
    setButtonLoading(btn, false);
    if (error) { showError(errEl, friendlyErrorMessage(error)); return; }
    closeContactModal();
    loadContacts();
  });
}
