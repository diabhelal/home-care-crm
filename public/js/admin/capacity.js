// ===== תחזית קיבולת (שירות Python מקומי) — הוצא מ-admin.html לצורך תחזוקה =====
// Classic script בכוונה (לא <script type="module">) — אותו נימוק כמו js/admin/staff.js
// ו-js/admin/patients.js: נטען לפני admin.html, חולק scope עליון עם app.js/config.js.
// הקטע הזה עצמאי לגמרי — רק event listener אחד, בלי שום פונקציה שקטעים אחרים קוראים לה.
// PREDICTIVE_SERVICE_URL מוגדר ב-config.js (מקור יחיד, לא כפול בין admin/employee).

document.getElementById("capacity-forecast-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("capacity-forecast-result");
  const btn = document.getElementById("capacity-forecast-btn");
  resultEl.innerHTML = "";
  setButtonLoading(btn, true, "מחשב...");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  try {
    const [visitsRes, patientsRes] = await Promise.all([
      supabaseClient.from("bookings").select("id", { count: "exact", head: true })
        .eq("status", "completed").gte("scheduled_at", monthStart).lt("scheduled_at", monthEnd),
      supabaseClient.from("patients").select("id", { count: "exact", head: true }),
    ]);
    if (visitsRes.error) throw visitsRes.error;
    if (patientsRes.error) throw patientsRes.error;

    const visitsThisMonth = visitsRes.count || 0;
    const activePatients = patientsRes.count || 0;
    if (!activePatients) {
      resultEl.innerHTML = `<p style="color:var(--text-muted);">אין מטופלים פעילים במערכת — לא ניתן לחשב תחזית.</p>`;
      return;
    }

    const growthRate = Number(document.getElementById("capacity-growth-rate").value) / 100;
    const res = await fetch(`${PREDICTIVE_SERVICE_URL}/predict/capacity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visits_this_month: visitsThisMonth, active_patients: activePatients, growth_rate: growthRate }),
    });
    if (!res.ok) throw new Error(`שירות התחזית החזיר שגיאה (${res.status})`);
    const data = await res.json();
    resultEl.innerHTML = `
      <p style="font-weight:700; color:var(--primary-dark); margin:0 0 4px;">${data.message}</p>
      <p style="color:var(--text-muted); font-size:14px; margin:0;">ביקורים החודש: ${visitsThisMonth} · מטופלים פעילים: ${activePatients} · ממוצע ביקורים למטופל: ${data.avg_visits_per_patient.toFixed(2)}</p>
    `;
  } catch (err) {
    const isConnRefused = /failed to fetch|network|load failed/i.test(err?.message || "");
    resultEl.innerHTML = `<p style="color:var(--danger);">${isConnRefused ? "שירות התחזית לא זמין. יש להריץ אותו מקומית (predictive-service) על פורט 8000." : friendlyErrorMessage(err)}</p>`;
  } finally {
    setButtonLoading(btn, false);
  }
});
