// "האם זה עדיין אותו מטופל?": כל טעינה אסינכרונית שכותבת למסך בודקת scope.isCurrent() אחרי כל המתנה,
// כך שתשובה מאוחרת של מטופל א' לא מוצגת ולא נשמרת אחרי שהמסך עבר למטופל ב' (או נסגר).
// start(patientId) מתחיל היקף חדש ומבטל כל היקף קודם; reset() מבטל הכול (סגירת מודאל).
function createPatientScope() {
  let seq = 0;
  let current = null;
  const snapshot = () => {
    const mySeq = seq;
    const myPatient = current;
    return { patientId: myPatient, isCurrent: () => seq === mySeq && current === myPatient && myPatient !== null };
  };
  return {
    start(patientId) { seq += 1; current = patientId == null ? null : String(patientId); return snapshot(); },
    reset() { seq += 1; current = null; },
    snapshot,
  };
}
