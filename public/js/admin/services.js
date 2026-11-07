// ===== זמינות שירותים (השהיה זמנית של סוג ביקור) =====
// המנהל יכול להשהות סוג ביקור (למשל בדיקות דם) לטווח תאריכים או עד לחידוש ידני, עם הודעה שמוצגת למטופל.
// שירות שאינו מוצע בכלל נשאר נשלט ע"י SERVICE_CONFIG (config.js) / OFFERED_PURPOSES (backend).
// אין מחיקה: משהים וחודשים. הזמנות קיימות לא נפגעות; ההשהיה חוסמת הזמנות חדשות (בטופס, ב-API וב-DB).
// Classic script (כמו שאר js/admin/*): משתמש ב-supabaseClient, PURPOSE_LABELS, escapeHtml, showError וכו' מ-app.js.
let serviceRowsCache = {}; // purpose -> שורת service_availability

function servicePauseSummary(row) {
  if (!row || !row.is_paused) return { paused: false, text: "זמין" };
  const from = row.paused_from, until = row.paused_until;
  let range;
  if (from && until) range = `${formatDateIsoHe(from)}–${formatDateIsoHe(until)}`;
  else if (from) range = `מ-${formatDateIsoHe(from)} עד לחידוש`;
  else if (until) range = `עד ${formatDateIsoHe(until)}`;
  else range = "עד לחידוש ידני";
  return { paused: true, text: `מושהה · ${range}` };
}

function formatDateIsoHe(iso) { // "2031-03-05" -> "05/03/2031" (בלי המרת אזור זמן)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || "");
}

function offeredServicePurposes() {
  return (window.SERVICE_CONFIG && window.SERVICE_CONFIG.purposes) || Object.keys(PURPOSE_LABELS);
}

async function loadServiceAvailability() {
  const tbody = document.getElementById("services-tbody");
  tbody.innerHTML = `<tr><td colspan="4"><div class="loading-row"><span class="spinner spinner-dark"></span><span>טוען...</span></div></td></tr>`;
  let data, error;
  try {
    ({ data, error } = await supabaseClient.from("service_availability").select("*"));
  } catch (err) { error = err; }
  if (error) {
    // טבלה שעדיין לא הוחלה במסד: אומרים זאת במפורש במקום להציג "הכול זמין"
    tbody.innerHTML = `<tr><td colspan="4">לא ניתן לטעון את זמינות השירותים. ${escapeHtml(friendlyErrorMessage(error))}</td></tr>`;
    return;
  }
  serviceRowsCache = {};
  (data || []).forEach((r) => { serviceRowsCache[r.purpose] = r; });
  tbody.innerHTML = "";
  offeredServicePurposes().forEach((purpose) => {
    const row = serviceRowsCache[purpose];
    const sum = servicePauseSummary(row);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(PURPOSE_LABELS[purpose] || purpose)}</td>
      <td><span class="status-badge ${sum.paused ? "paused" : "scheduled"}">${escapeHtml(sum.text)}</span></td>
      <td>${escapeHtml(sum.paused ? (row.public_message || "") : "")}</td>
      <td></td>`;
    const actions = tr.lastElementChild;
    const pauseBtn = document.createElement("button");
    pauseBtn.className = "btn btn-secondary btn-sm";
    pauseBtn.textContent = sum.paused ? "עריכת השהיה" : "השהיית שירות";
    pauseBtn.addEventListener("click", () => openServiceModal(purpose));
    actions.appendChild(pauseBtn);
    if (sum.paused) {
      const resumeBtn = document.createElement("button");
      resumeBtn.className = "btn btn-primary btn-sm";
      resumeBtn.textContent = "חידוש השירות";
      resumeBtn.addEventListener("click", () => resumeService(purpose, resumeBtn));
      actions.appendChild(resumeBtn);
    }
    tbody.appendChild(tr);
  });
}

function openServiceModal(purpose) {
  const row = serviceRowsCache[purpose];
  document.getElementById("service-purpose").value = purpose;
  document.getElementById("service-modal-title").textContent = `השהיית שירות: ${PURPOSE_LABELS[purpose] || purpose}`;
  document.getElementById("service-from").value = row?.paused_from || "";
  document.getElementById("service-until").value = row?.paused_until || "";
  document.getElementById("service-message").value = row?.public_message || "";
  hideError(document.getElementById("service-modal-error"));
  document.getElementById("service-modal").style.display = "flex";
}

// תקינות הקלט — נבדקת גם ב-DB (check constraints); כאן כדי לתת הודעה ברורה לפני השליחה
function validateServicePause({ from, until, message }) {
  if (from && until && from > until) return "תאריך הסיום לפני תאריך ההתחלה";
  if (message && message.length > 200) return "ההודעה ארוכה מ-200 תווים";
  return null;
}

document.getElementById("service-modal-cancel").addEventListener("click", () => {
  document.getElementById("service-modal").style.display = "none";
});

document.getElementById("service-modal-save").addEventListener("click", async () => {
  const modalError = document.getElementById("service-modal-error");
  hideError(modalError);
  const purpose = document.getElementById("service-purpose").value;
  const from = document.getElementById("service-from").value || null;
  const until = document.getElementById("service-until").value || null;
  const message = document.getElementById("service-message").value.trim() || null;
  const problem = validateServicePause({ from, until, message });
  if (problem) { showError(modalError, problem); return; }
  const btn = document.getElementById("service-modal-save");
  setButtonLoading(btn, true, "שומר...");
  let error;
  try {
    ({ error } = await supabaseClient.from("service_availability").upsert(
      { purpose, is_paused: true, paused_from: from, paused_until: until, public_message: message },
      { onConflict: "purpose" }));
  } catch (err) { error = err; }
  setButtonLoading(btn, false);
  if (error) { showError(modalError, friendlyErrorMessage(error)); return; }
  document.getElementById("service-modal").style.display = "none";
  flashSuccess("השירות הושהה. הזמנות קיימות לא בוטלו; הזמנות חדשות לתקופה זו נחסמות.");
  loadServiceAvailability();
});

async function resumeService(purpose, btn) {
  if (!confirm(`לחדש את השירות "${PURPOSE_LABELS[purpose] || purpose}"? מטופלים יוכלו להזמין אותו שוב.`)) return;
  hideError(appError);
  setButtonLoading(btn, true, "מעדכן...");
  let error;
  try {
    ({ error } = await supabaseClient.from("service_availability").update({ is_paused: false }).eq("purpose", purpose));
  } catch (err) { error = err; }
  setButtonLoading(btn, false);
  if (error) { showError(appError, friendlyErrorMessage(error)); return; }
  flashSuccess("השירות חודש");
  loadServiceAvailability();
}
