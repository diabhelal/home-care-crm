// טיוטת סיכום AI לדוח ביקור (opt-in). כלל ברזל: הטיוטה היא הצעה בלבד — לא נשמרת, לא חותמת ולא משלימה ביקור.
// שום אחסון קבוע בדפדפן לטיוטות (רק זיכרון הדף; נמחק בסגירת המודאל). כשל/כיבוי של ה-AI לא חוסמים תיעוד ידני.
// מקור הטיוטה: מדדים, פרוצדורות והערות כפי שהוקלדו בטופס (נתונים שלא נשמרו עדיין). הערות המקור לעולם לא נדרסות.
// נשען על backendFetch (app.js) ועל שדות הטופס הקיימים (vr-*). נטען ב-employee.html וב-admin.html.
const AiSummary = (() => {
  const SOURCE_IDS = ["vr-systolic", "vr-diastolic", "vr-sugar", "vr-pulse", "vr-temp", "vr-o2", "vr-summary"];
  const FIELD_MAP = { systolic_bp: "vr-systolic", diastolic_bp: "vr-diastolic", blood_sugar: "vr-sugar", pulse: "vr-pulse", temperature: "vr-temp", oxygen_saturation: "vr-o2" };
  let enabled = false;
  let st;
  const $ = (id) => document.getElementById(id);

  function fresh() {
    return { seq: 0, loading: false, draft: null, originalText: "", edited: false, approved: false, outdated: false, sourceFp: null, confirmReplace: false };
  }

  function snapshot() {
    const s = { notes: $("vr-summary").value.trim() };
    Object.entries(FIELD_MAP).forEach(([key, id]) => {
      const v = $(id).value;
      s[key] = v === "" ? null : Number(v);        // חסר ≠ 0
    });
    document.querySelectorAll("#vr-procedures input[data-proc]").forEach((cb) => { s[cb.dataset.proc] = !!cb.checked; });
    return s;
  }
  const fp = (s) => JSON.stringify(s);

  function setStatus(text, kind) {
    const el = $("vr-ai-status");
    el.textContent = text || "";
    el.className = "ai-status" + (kind ? " ai-" + kind : "");
  }

  function render() {
    const gen = $("vr-ai-generate");
    $("vr-ai-draft-wrap").hidden = !st.draft;
    gen.disabled = st.loading;
    gen.textContent = st.loading ? "יוצר טיוטה..." : st.confirmReplace ? "אישור החלפת הטיוטה (העריכות שלך בטיוטה יימחקו)" : st.draft ? "יצירה מחדש" : "יצירת טיוטת סיכום AI";
    const badge = $("vr-ai-badge");
    if (!st.draft) { badge.hidden = true; return; }
    badge.hidden = false;
    badge.textContent = st.outdated ? "טיוטה מיושנת — המקור השתנה" : st.approved ? "אושרה כסיכום הסופי" : "טיוטת AI שלא אושרה";
    badge.className = "ai-badge " + (st.outdated ? "ai-badge-stale" : st.approved ? "ai-badge-ok" : "ai-badge-draft");
    $("vr-ai-approve").disabled = st.outdated || st.approved || !$("vr-ai-draft").value.trim();
    $("vr-ai-approve").textContent = st.approved ? "אושרה ✓" : "אישור הטיוטה כסיכום הסופי";
  }

  function resetState() {
    st = fresh();
    if (!enabled) return;
    $("vr-ai-draft").value = "";
    $("vr-ai-warnings").innerHTML = "";
    setStatus("");
    render();
  }

  function onSourceChange() {
    if (!enabled || !st.draft || st.outdated) return;
    if (fp(snapshot()) !== st.sourceFp) {
      st.outdated = true; st.approved = false;          // שינוי במקור מבטל אישור וסוגר את הטיוטה לשמירה
      setStatus("פרטי הביקור או ההערות השתנו אחרי יצירת הטיוטה: הטיוטה מיושנת ואינה מאושרת. אפשר ליצור מחדש, להסיר אותה או להמשיך בתיעוד ידני.", "warn");
      render();
    }
  }

  async function generate() {
    if (st.loading) return;                              // מניעת בקשות כפולות מלחיצות חוזרות
    if (st.draft && st.edited && !st.confirmReplace) {   // יצירה מחדש לא דורסת עריכות בלי אישור מפורש
      st.confirmReplace = true; render(); return;
    }
    st.confirmReplace = false;
    const snap = snapshot();
    if (!snap.notes) { setStatus("יש להזין הערות ביקור (שדה הסיכום) לפני יצירת טיוטה. אפשר גם להמשיך בתיעוד ידני.", "error"); render(); return; }
    const bookingId = Number($("vr-booking-id").value);
    const mySeq = ++st.seq;
    st.loading = true; setStatus("יוצר טיוטה... אפשר להמשיך לתעד ידנית בינתיים.", "info"); render();
    let res = null, err = null;
    try {
      res = await backendFetch(`/staff/visits/${encodeURIComponent(bookingId)}/summary-draft`, { method: "POST", body: snap, timeoutMs: 35000 });
    } catch (e) { err = e; }
    if (mySeq !== st.seq) return;                        // תגובה מאוחרת של בקשה ישנה / מודאל שנסגר — מתעלמים
    st.loading = false;
    if (err || !res || typeof res.draft_text !== "string") {
      const offline = err && ["network", "timeout", "unconfigured"].includes(err.kind);
      setStatus(`${offline ? "לא ניתן להתחבר לשירות ה-AI כרגע." : ((err && err.message) || "יצירת הטיוטה נכשלה.")} אפשר לנסות שוב, או להמשיך בתיעוד ידני — הביקור אינו תלוי ב-AI.`, "error");
      render(); return;
    }
    if (fp(snapshot()) !== fp(snap)) {                   // המקור השתנה בזמן היצירה: לא מציגים טיוטה שאינה תואמת
      setStatus("פרטי הביקור או ההערות השתנו בזמן יצירת הטיוטה, ולכן היא לא הוצגה. אפשר ליצור מחדש.", "warn");
      render(); return;
    }
    st.draft = { token: res.generation_token, id: res.generation_id, model: res.model };
    st.originalText = res.draft_text; st.edited = false; st.approved = false; st.outdated = false; st.sourceFp = fp(snap);
    $("vr-ai-draft").value = res.draft_text;
    $("vr-ai-warnings").innerHTML = (res.warnings || []).map((w) => `<li>${escapeHtml(String(w))}</li>`).join("");
    setStatus("הטיוטה מוכנה. סקרו אותה מול הנתונים שהוזנו, ערכו, ואשרו כדי להשתמש בה כסיכום הסופי.", "info");
    render();
  }

  function approve() {
    if (!st.draft || st.outdated) return;
    if (!$("vr-ai-draft").value.trim()) return;
    st.approved = true;
    setStatus("הטיוטה אושרה כסיכום הסופי. היא תישמר רק כשתשלימו את הביקור; הערות המקור יישמרו בנפרד.", "ok");
    render();
  }

  function discard() {
    st.seq++; st.loading = false;                        // מבטל גם בקשה שבדרך
    const keepEnabled = enabled;
    st = fresh(); if (keepEnabled) { $("vr-ai-draft").value = ""; $("vr-ai-warnings").innerHTML = ""; setStatus("הטיוטה הוסרה. אפשר להמשיך בתיעוד ידני."); render(); }
  }

  // נקרא לפני שמירת הדוח. לעולם לא חוסם שמירה ידנית: חוסם רק כשקיימת טיוטה שנשארה באמצע (לא אושרה / מיושנת).
  function beforeSave() {
    if (!enabled || !st.draft) return { ok: true, extras: null };
    if (st.outdated) return { ok: false, error: "טיוטת ה-AI מיושנת (המקור השתנה). צרו אותה מחדש או הסירו אותה לפני השמירה." };
    if (!st.approved) return { ok: false, error: 'יש טיוטת AI שלא אושרה. אשרו אותה ("אישור הטיוטה כסיכום הסופי") או הסירו אותה לפני השמירה.' };
    return { ok: true, extras: { source_notes: $("vr-summary").value.trim(), treatment_summary: $("vr-ai-draft").value.trim(), ai: { generation_token: st.draft.token, approved: true } } };
  }

  function init() {
    enabled = window.AI_SUMMARY_ENABLED === true && !!$("vr-ai") && !!$("visit-report-modal");
    st = fresh();
    if (!enabled) return;
    $("vr-ai").hidden = false;
    $("vr-ai-generate").addEventListener("click", generate);
    $("vr-ai-approve").addEventListener("click", approve);
    $("vr-ai-discard").addEventListener("click", discard);
    $("vr-ai-draft").addEventListener("input", () => {
      if (!st.draft) return;
      st.edited = $("vr-ai-draft").value !== st.originalText;
      if (st.approved) { st.approved = false; setStatus("הטיוטה נערכה: האישור בוטל. יש לאשר מחדש.", "warn"); }
      render();
    });
    SOURCE_IDS.forEach((id) => { $(id).addEventListener("input", onSourceChange); });
    $("vr-procedures").addEventListener("change", onSourceChange);
    // איפוס בכל פתיחה/סגירה של המודאל (לא נשמר כלום בין דוחות)
    new MutationObserver(() => resetState()).observe($("visit-report-modal"), { attributes: true, attributeFilter: ["style"] });
    render();
  }

  return { init, beforeSave, _state: () => st };
})();
document.addEventListener("DOMContentLoaded", () => AiSummary.init());
if (document.readyState !== "loading") AiSummary.init();
