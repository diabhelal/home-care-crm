// i18n לעמודים הפונים למטופל בלבד (index/staff/booking/my-bookings.html) — לא נטען
// ע"י admin.html/employee.html/employee-login.html, ולא נוגע ב-app.js בכלל: כל
// מילוני התיוג/פונקציות-הפורמט של app.js (ROLE_LABELS וכו') נשארים כמו שהם ומשמשים
// את פאנלי הצוות/הניהול ללא שינוי. כאן יש עותק עברי משלו + en/ar, ופונקציות-עטיפה
// (roleLabel וכו') שהעמודים הפונים למטופל קוראים להן במקום לדיקשנרים של app.js.
"use strict";

const LANG_STORAGE_KEY = "appLanguage";
const SUPPORTED_LANGS = ["he", "en", "ar"];
const LOCALE_BY_LANG = { he: "he-IL", en: "en-US", ar: "ar" };

function getLang() {
  let v = null;
  try { v = localStorage.getItem(LANG_STORAGE_KEY); } catch (e) { /* אחסון חסום — נופל לברירת מחדל */ }
  return SUPPORTED_LANGS.includes(v) ? v : "he";
}

function setLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return;
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch (e) { /* לא קריטי */ }
  location.reload();
}

const VITALS_ORDER = [
  { key: "systolic_bp", unit: "" },
  { key: "diastolic_bp", unit: "" },
  { key: "blood_sugar", unit: "mg/dL" },
  { key: "pulse", unit: "BPM" },
  { key: "temperature", unit: "°C" },
  { key: "oxygen_saturation", unit: "%" },
];
const PROCEDURE_ORDER = [
  "performed_blood_draw",
  "performed_injection",
  "performed_infusion",
  "performed_dressing_change",
  "performed_catheter_change",
];

const I18N_STRINGS = {
  he: {
    roleLabels: { nurse: "אח/ות", doctor: "רופא/ה", physiotherapist: "פיזיותרפיסט/ית", caregiver: "מטפל/ת סיעודי/ת" },
    roleDescriptions: {
      nurse: "טיפול בפצעים, מתן תרופות ובדיקות דם — בבית שלך",
      doctor: "ביקור רפואי כללי, אבחון ומעקב מצב בריאותי",
      physiotherapist: "שיקום תנועה וטיפול פיזיותרפי בבית",
      caregiver: "סיוע וליווי סיעודי יומיומי",
    },
    purposeLabels: { checkup: "בדיקה כללית", wound_care: "טיפול בפצע", blood_test: "בדיקת דם", medication: "מתן תרופות", physiotherapy: "פיזיותרפיה", other: "אחר" },
    statusLabels: { scheduled: "מתוכנן", completed: "הושלם", cancelled: "בוטל" },
    servicePlanStatusLabels: { requested: "התבקש", pending_approval: "ממתין לאישור", active: "פעיל", paused: "מושהה", completed: "הושלם", cancelled: "בוטל" },
    weekdayShort: ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"],
    vitalsLabels: { systolic_bp: 'ל"ד סיסטולי', diastolic_bp: 'ל"ד דיאסטולי', blood_sugar: "סוכר", pulse: "דופק", temperature: "חום גוף", oxygen_saturation: "סטורציה" },
    procedureLabels: {
      performed_blood_draw: "בדיקת דם / איסוף דגימות",
      performed_injection: "מתן זריקה",
      performed_infusion: "מתן עירוי נוזלים/תרופה",
      performed_dressing_change: "החלפת חבישה",
      performed_catheter_change: "החלפת קטטר/זונדה",
    },
    daysWord: "ימים",
    errFallback: "אירעה שגיאה לא צפויה. נא לנסות שוב.",
    errNetwork: "בעיית חיבור לאינטרנט. נא לבדוק את החיבור ולנסות שוב.",
    visitReport: { doneAt: "בוצע ב-", proceduresPerformed: "פרוצדורות שבוצעו:", summary: "סיכום:", patientSignature: "חתימת מטופל:" },
    common: {
      brand: "בית חם", navMyBookings: "ההזמנות שלי", navReset: "התחלה מחדש", navNewBooking: "קביעת ביקור חדש",
      navServices: "השירותים שלנו", navHowItWorks: "איך זה עובד", navContact: "יצירת קשר",
    },
    index: {
      title: "בית חם — טיפול רפואי עד הבית",
      heroEyebrow: "🏠 פותרים לך את הבעיה בבית",
      heroTitle: "טיפול רפואי מקצועי, ישירות לביתך",
      heroSubtitle: "אחיות, רופאים, פיזיותרפיסטים ומטפלים סיעודיים — קובעים ביקור בית תוך דקות, בלי הרשמה ובלי סיסמה.",
      heroCta: "הזמנת ביקור עכשיו",
      heroTrustSingle: "✅ איש צוות מוסמך אחד זמין כרגע",
      heroTrustPlural: "✅ {count} אנשי צוות מוסמכים זמינים כרגע",
      serviceLinkText: "לצפייה בזמינות ←",
      howTitle: "איך זה עובד",
      howStep1Title: "בוחרים איש/אשת צוות", howStep1Text: "לפי תפקיד וזמינות שמתאימה לכם",
      howStep2Title: "בוחרים תאריך ושעה", howStep2Text: "מתוך הזמנים הפנויים בפועל, בזמן אמת",
      howStep3Title: "ממלאים פרטים ומאשרים", howStep3Text: "שם, טלפון וכתובת — וזהו, ההזמנה נקבעה",
      whyTitle: "למה בית חם?",
      why1Title: "צוות מוסמך ומנוסה", why1Text: "כל אנשי הצוות מורשים ובעלי ניסיון בטיפול ביתי",
      why2Title: "קביעת תור מיידית", why2Text: "בוחרים תאריך ושעה פנויים ומקבלים אישור מיידי",
      why3Title: "בלי הרשמה מיותרת", why3Text: "מזמינים תוך דקה, הפרטים שלכם נשמרים רק אצלכם",
      ctaTitle: "מוכנים להתחיל?", ctaText: "קביעת ביקור בית לוקחת פחות מדקה — בלי הרשמה, בלי סיסמה.", ctaButton: "בואו נתחיל",
      contactTitle: "יצירת קשר",
      contactIntro: "שאלה לפני שקובעים ביקור? לפניות שאינן דחופות — למקרה חירום רפואי יש לפנות ישירות לשירותי החירום.",
      contactNameLabel: "שם מלא", contactPhoneLabel: "טלפון (אופציונלי, לחזרה אליך)",
      contactSubjectLabel: "נושא", contactSubjectPlaceholder: "אופציונלי",
      contactBodyLabel: "הודעה", contactSubmit: "שליחת פנייה",
      footerTagline: "טיפול רפואי מקצועי, ישירות לביתך.",
      footerStaffLogin: "כניסת צוות רפואי", footerAdminLogin: "כניסת מנהל",
      loadingServices: "טוען שירותים...", errLoadingServices: "שגיאה בטעינת השירותים",
      contactValidation: "יש להזין שם מלא והודעה", contactConnError: "שגיאה ביצירת חיבור. נסה/י שוב.",
      contactSending: "שולח...", contactSuccess: "הפנייה נשלחה, נחזור אליך בהקדם.",
    },
    staff: {
      title: "בית חם — בחירת איש צוות",
      step1: "1. בחירת צוות", step2: "2. הזמנה ופרטים",
      pageTitle: "למי מאנשי הצוות תרצה/י לקבוע ביקור?",
      subtitle: "בחר/י איש צוות פנוי לפי תפקיד וזמינות",
      showAllStaff: "← הצגת כל אנשי הצוות",
      loadingStaff: "טוען רשימת אנשי צוות...",
      errLoadingStaff: "שגיאה בטעינת רשימת הצוות: ",
      emptyState: "לא נמצאו אנשי צוות זמינים כרגע.",
      roleFilterTitle: "{role} זמינים לביקור בית",
    },
    booking: {
      title: "בית חם — קביעת תור",
      h1Hidden: "קביעת תור — בית חם",
      staffLabel: "איש/אשת צוות:", changeStaff: "החלפת איש צוות",
      purposeTitle: "מטרת הביקור", dateTitle: "תאריך", timeTitle: "שעה פנויה",
      noSlots: "אין שעות פנויות בתאריך זה. נסה/נסי תאריך אחר.",
      noDatesAvailable: "אין ימים זמינים לאיש צוות זה.",
      detailsTitle: "עוד רגע וסיימנו — הפרטים שלך",
      detailsSubtitle: "נשמש רק כדי לתאם את הביקור — בלי הרשמה ובלי סיסמה. שדות עם * הם חובה.",
      nameLabel: "שם מלא *", namePlaceholder: "לדוגמה: ישראל ישראלי",
      idLabel: "תעודת זהות *", idPlaceholder: "9 ספרות",
      idHelp: "משמשת לזיהוי מדויק שלך בתיק הרפואי שלך במערכת — לא נשתף עם צד שלישי.",
      phoneLabel: "טלפון *", phonePlaceholder: "050-1234567",
      addressLabel: "כתובת לביקור *", addressPlaceholder: "רחוב, מספר בית ועיר",
      notesLabel: "הערות (אופציונלי)", notesPlaceholder: "לדוגמה: יש להתקשר לפני ההגעה",
      trustStrip: "🔒 צוות מוסמך ומנוסה · הפרטים שלך משמשים רק לתיאום הביקור ואינם נמסרים לגורם שלישי",
      confirmButton: "אישור הזמנה",
      loadingSlots: "טוען שעות פנויות...", errLoadingSlots: "שגיאה בטעינת שעות פנויות: ",
      fillAllFields: "נא למלא שם מלא, תעודת זהות, טלפון וכתובת לביקור.",
      invalidId: "תעודת זהות צריכה להכיל בין 5 ל-9 ספרות.",
      savingBooking: "שומר הזמנה...",
      slotTaken: "מצטערים, השעה הזו נתפסה זה עתה. נא לבחור שעה אחרת.",
      errSavingBooking: "שגיאה בשמירת ההזמנה: ",
      bookingSuccess: "ההזמנה נקבעה בהצלחה! מעביר אותך לרשימת ההזמנות שלך...",
    },
    myBookings: {
      title: "בית חם — ההזמנות שלי",
      h1: "ההזמנות שלי",
      accessTitle: "גישה מכל מכשיר",
      phoneLinkStatusDefault: "קישור מספר טלפון מאפשר לך לגשת להזמנות שלך גם ממכשיר אחר.",
      phoneLinkStatusLinked: "מחובר/ת עם הטלפון {phone} — ניתן להיכנס מכל מכשיר איתו (בכפוף להפעלת שירות SMS).",
      phoneNumberLabel: "מספר טלפון", phonePlaceholder: "05XXXXXXXX",
      sendCodeButton: "שליחת קוד אימות",
      verifyCodeLabel: "קוד אימות", codePlaceholder: "123456",
      verifyAndLinkButton: "אימות וקישור",
      alreadyLinkedSummary: "כבר קישרת טלפון ממכשיר אחר? התחברות",
      sendCodeButtonShort: "שליחת קוד", signInButton: "התחברות",
      upcomingTitle: "ביקורים קרובים", upcomingEmpty: "אין לך ביקורים מתוכננים.",
      pastTitle: "היסטוריית ביקורים", pastEmpty: "אין היסטוריית ביקורים.",
      serviceRequestTitle: "בקשת שירות",
      serviceRequestIntro: "ביקור חד פעמי נקבע ישירות מתוך הזמנים הפנויים בפועל. שירות תקופתי (למשל פעמיים בשבוע למשך חודש) הוא בקשה שנבדקת ומאושרת על ידי הצוות שלנו.",
      serviceTypeLabel: "סוג השירות המבוקש", serviceTypePlaceholder: "לדוגמה: ביקור אחות",
      frequencyLabel: "תדירות",
      freqSingle: "חד פעמי", freqWeekly: "שבועי", freqTwiceWeekly: "פעמיים בשבוע", freqDaily: "יומי", freqCustom: "אחר",
      startDateLabel: "תאריך התחלה מבוקש",
      moreDetailsLabel: "פרטים נוספים", optionalPlaceholder: "אופציונלי",
      submitRequest: "שליחת בקשה", goToBooking: "מעבר לקביעת תור",
      loadingBookings: "טוען את ההזמנות שלך...", errLoadingBookings: "שגיאה בטעינת ההזמנות: ",
      noteLabel: "הערה: ",
      cancelButton: "ביטול", cancelConfirm: "לבטל את הביקור?", cancelling: "מבטל...",
      errCancelling: "שגיאה בביטול ההזמנה: ",
      viewReport: "צפייה בדוח ביקור", hideReport: "הסתרת דוח ביקור",
      noPastPlanRequests: "אין בקשות שירות קודמות.",
      fillServiceFields: "יש להזין סוג שירות ותאריך התחלה",
      sending: "שולח...", serviceRequestSuccess: "הבקשה נשלחה — הצוות שלנו יבדוק ויחזור אליך.",
      verifying: "מאמת...", signingIn: "מתחבר/ת...",
      invalidPhone: "יש להזין מספר טלפון תקין", missingCode: "יש להזין את הקוד שהתקבל",
    },
  },

  en: {
    roleLabels: { nurse: "Nurse", doctor: "Doctor", physiotherapist: "Physiotherapist", caregiver: "Caregiver" },
    roleDescriptions: {
      nurse: "Wound care, medication administration and blood tests — at home",
      doctor: "General medical visits, diagnosis and health monitoring",
      physiotherapist: "Mobility rehabilitation and physiotherapy at home",
      caregiver: "Daily nursing assistance and companionship",
    },
    purposeLabels: { checkup: "General checkup", wound_care: "Wound care", blood_test: "Blood test", medication: "Medication administration", physiotherapy: "Physiotherapy", other: "Other" },
    statusLabels: { scheduled: "Scheduled", completed: "Completed", cancelled: "Cancelled" },
    servicePlanStatusLabels: { requested: "Requested", pending_approval: "Pending approval", active: "Active", paused: "Paused", completed: "Completed", cancelled: "Cancelled" },
    weekdayShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    vitalsLabels: { systolic_bp: "Systolic BP", diastolic_bp: "Diastolic BP", blood_sugar: "Blood sugar", pulse: "Pulse", temperature: "Body temp.", oxygen_saturation: "O2 saturation" },
    procedureLabels: {
      performed_blood_draw: "Blood draw / sample collection",
      performed_injection: "Injection administered",
      performed_infusion: "IV fluid/medication infusion",
      performed_dressing_change: "Dressing change",
      performed_catheter_change: "Catheter/tube change",
    },
    daysWord: "Days",
    errFallback: "An unexpected error occurred. Please try again.",
    errNetwork: "Internet connection problem. Please check your connection and try again.",
    visitReport: { doneAt: "Performed on ", proceduresPerformed: "Procedures performed:", summary: "Summary:", patientSignature: "Patient signature:" },
    common: {
      brand: "Warm Home", navMyBookings: "My Bookings", navReset: "Start Over", navNewBooking: "Book a New Visit",
      navServices: "Our Services", navHowItWorks: "How It Works", navContact: "Contact Us",
    },
    index: {
      title: "Warm Home — Home Medical Care",
      heroEyebrow: "🏠 We solve the problem for you, at home",
      heroTitle: "Professional medical care, straight to your door",
      heroSubtitle: "Nurses, doctors, physiotherapists and caregivers — book a home visit in minutes, no sign-up and no password.",
      heroCta: "Book a Visit Now",
      heroTrustSingle: "✅ One qualified staff member available now",
      heroTrustPlural: "✅ {count} qualified staff members available now",
      serviceLinkText: "View availability →",
      howTitle: "How It Works",
      howStep1Title: "Choose your staff member", howStep1Text: "By role and availability that suits you",
      howStep2Title: "Choose a date and time", howStep2Text: "From actual available slots, in real time",
      howStep3Title: "Fill in your details and confirm", howStep3Text: "Name, phone and address — and that's it, your visit is booked",
      whyTitle: "Why Warm Home?",
      why1Title: "Qualified, experienced staff", why1Text: "All our staff are licensed and experienced in home care",
      why2Title: "Instant booking", why2Text: "Pick an available date and time and get instant confirmation",
      why3Title: "No unnecessary sign-up", why3Text: "Book in under a minute — your details stay with you",
      ctaTitle: "Ready to get started?", ctaText: "Booking a home visit takes less than a minute — no sign-up, no password.", ctaButton: "Let's Get Started",
      contactTitle: "Contact Us",
      contactIntro: "Have a question before booking? For non-urgent inquiries only — for a medical emergency, please contact emergency services directly.",
      contactNameLabel: "Full name", contactPhoneLabel: "Phone (optional, so we can call you back)",
      contactSubjectLabel: "Subject", contactSubjectPlaceholder: "Optional",
      contactBodyLabel: "Message", contactSubmit: "Send Message",
      footerTagline: "Professional medical care, straight to your door.",
      footerStaffLogin: "Medical Staff Login", footerAdminLogin: "Admin Login",
      loadingServices: "Loading services...", errLoadingServices: "Error loading services",
      contactValidation: "Please enter your full name and a message", contactConnError: "Connection error. Please try again.",
      contactSending: "Sending...", contactSuccess: "Your message has been sent — we'll get back to you soon.",
    },
    staff: {
      title: "Warm Home — Choose Staff",
      step1: "1. Choose Staff", step2: "2. Booking & Details",
      pageTitle: "Which staff member would you like to book?",
      subtitle: "Choose an available staff member by role and availability",
      showAllStaff: "← Show all staff",
      loadingStaff: "Loading staff list...",
      errLoadingStaff: "Error loading staff list: ",
      emptyState: "No available staff found right now.",
      roleFilterTitle: "{role} available for home visits",
    },
    booking: {
      title: "Warm Home — Book a Visit",
      h1Hidden: "Book a Visit — Warm Home",
      staffLabel: "Staff member:", changeStaff: "Change staff member",
      purposeTitle: "Visit Purpose", dateTitle: "Date", timeTitle: "Available Time",
      noSlots: "No available times on this date. Try another date.",
      noDatesAvailable: "No available days for this staff member.",
      detailsTitle: "Almost done — your details",
      detailsSubtitle: "Used only to coordinate your visit — no sign-up, no password. Fields marked * are required.",
      nameLabel: "Full name *", namePlaceholder: "e.g. John Smith",
      idLabel: "National ID *", idPlaceholder: "9 digits",
      idHelp: "Used to identify you accurately in your medical record — never shared with third parties.",
      phoneLabel: "Phone *", phonePlaceholder: "050-1234567",
      addressLabel: "Visit address *", addressPlaceholder: "Street, house number and city",
      notesLabel: "Notes (optional)", notesPlaceholder: "e.g. Please call before arriving",
      trustStrip: "🔒 Qualified, experienced staff · Your details are used only to coordinate the visit and are never shared with third parties",
      confirmButton: "Confirm Booking",
      loadingSlots: "Loading available times...", errLoadingSlots: "Error loading available times: ",
      fillAllFields: "Please fill in your full name, national ID, phone and visit address.",
      invalidId: "National ID must contain between 5 and 9 digits.",
      savingBooking: "Saving booking...",
      slotTaken: "Sorry, this time slot was just taken. Please choose another time.",
      errSavingBooking: "Error saving booking: ",
      bookingSuccess: "Your visit has been booked successfully! Redirecting you to your bookings...",
    },
    myBookings: {
      title: "Warm Home — My Bookings",
      h1: "My Bookings",
      accessTitle: "Access from any device",
      phoneLinkStatusDefault: "Linking a phone number lets you access your bookings from another device too.",
      phoneLinkStatusLinked: "Connected with phone {phone} — you can sign in from any device with it (subject to SMS service being enabled).",
      phoneNumberLabel: "Phone number", phonePlaceholder: "05XXXXXXXX",
      sendCodeButton: "Send verification code",
      verifyCodeLabel: "Verification code", codePlaceholder: "123456",
      verifyAndLinkButton: "Verify & Link",
      alreadyLinkedSummary: "Already linked a phone from another device? Sign in",
      sendCodeButtonShort: "Send code", signInButton: "Sign in",
      upcomingTitle: "Upcoming Visits", upcomingEmpty: "You have no scheduled visits.",
      pastTitle: "Visit History", pastEmpty: "No visit history.",
      serviceRequestTitle: "Service Request",
      serviceRequestIntro: "A one-time visit is booked directly from actually available times. A recurring service (e.g. twice a week for a month) is a request reviewed and approved by our staff.",
      serviceTypeLabel: "Requested service type", serviceTypePlaceholder: "e.g. Nurse visit",
      frequencyLabel: "Frequency",
      freqSingle: "One-time", freqWeekly: "Weekly", freqTwiceWeekly: "Twice a week", freqDaily: "Daily", freqCustom: "Other",
      startDateLabel: "Requested start date",
      moreDetailsLabel: "Additional details", optionalPlaceholder: "Optional",
      submitRequest: "Submit Request", goToBooking: "Go to Booking",
      loadingBookings: "Loading your bookings...", errLoadingBookings: "Error loading bookings: ",
      noteLabel: "Note: ",
      cancelButton: "Cancel", cancelConfirm: "Cancel this visit?", cancelling: "Cancelling...",
      errCancelling: "Error cancelling booking: ",
      viewReport: "View visit report", hideReport: "Hide visit report",
      noPastPlanRequests: "No previous service requests.",
      fillServiceFields: "Please enter a service type and start date",
      sending: "Sending...", serviceRequestSuccess: "Your request has been sent — our team will review it and get back to you.",
      verifying: "Verifying...", signingIn: "Signing in...",
      invalidPhone: "Please enter a valid phone number", missingCode: "Please enter the code you received",
    },
  },

  ar: {
    roleLabels: { nurse: "ممرض/ة", doctor: "طبيب/ة", physiotherapist: "أخصائي/ة علاج طبيعي", caregiver: "مقدم/ة رعاية" },
    roleDescriptions: {
      nurse: "العناية بالجروح وإعطاء الأدوية وفحوصات الدم — في منزلك",
      doctor: "زيارات طبية عامة وتشخيص ومتابعة الحالة الصحية",
      physiotherapist: "إعادة تأهيل الحركة والعلاج الطبيعي في المنزل",
      caregiver: "مساعدة ورعاية تمريضية يومية",
    },
    purposeLabels: { checkup: "فحص عام", wound_care: "العناية بالجروح", blood_test: "فحص دم", medication: "إعطاء أدوية", physiotherapy: "علاج طبيعي", other: "أخرى" },
    statusLabels: { scheduled: "مجدول", completed: "مكتمل", cancelled: "ملغى" },
    servicePlanStatusLabels: { requested: "تم الطلب", pending_approval: "بانتظار الموافقة", active: "نشط", paused: "متوقف مؤقتًا", completed: "مكتمل", cancelled: "ملغى" },
    weekdayShort: ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"],
    vitalsLabels: { systolic_bp: "ضغط الدم الانقباضي", diastolic_bp: "ضغط الدم الانبساطي", blood_sugar: "سكر الدم", pulse: "النبض", temperature: "حرارة الجسم", oxygen_saturation: "تشبع الأكسجين" },
    procedureLabels: {
      performed_blood_draw: "سحب دم / جمع عينات",
      performed_injection: "إعطاء حقنة",
      performed_infusion: "تسريب سوائل/دواء وريدي",
      performed_dressing_change: "تغيير الضماد",
      performed_catheter_change: "تغيير القسطرة/الأنبوب",
    },
    daysWord: "أيام",
    errFallback: "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.",
    errNetwork: "مشكلة في الاتصال بالإنترنت. يرجى التحقق من الاتصال والمحاولة مرة أخرى.",
    visitReport: { doneAt: "تمت في ", proceduresPerformed: "الإجراءات المنفذة:", summary: "الملخص:", patientSignature: "توقيع المريض:" },
    common: {
      brand: "بيت دافئ", navMyBookings: "حجوزاتي", navReset: "البدء من جديد", navNewBooking: "حجز زيارة جديدة",
      navServices: "خدماتنا", navHowItWorks: "كيف يعمل", navContact: "تواصل معنا",
    },
    index: {
      title: "بيت دافئ — رعاية طبية منزلية",
      heroEyebrow: "🏠 نحلّ لك المشكلة، في المنزل",
      heroTitle: "رعاية طبية احترافية، مباشرة إلى بابك",
      heroSubtitle: "ممرضون وأطباء وأخصائيو علاج طبيعي ومقدمو رعاية — احجز زيارة منزلية خلال دقائق، دون تسجيل ودون كلمة مرور.",
      heroCta: "احجز زيارة الآن",
      heroTrustSingle: "✅ عضو طاقم مؤهل واحد متاح الآن",
      heroTrustPlural: "✅ {count} من أعضاء الطاقم المؤهلين متاحون الآن",
      serviceLinkText: "عرض التوفر ←",
      howTitle: "كيف يعمل",
      howStep1Title: "اختر عضو الطاقم", howStep1Text: "حسب الدور والتوفر الذي يناسبك",
      howStep2Title: "اختر التاريخ والوقت", howStep2Text: "من الأوقات المتاحة فعليًا، في الوقت الفعلي",
      howStep3Title: "أدخل بياناتك وأكّد", howStep3Text: "الاسم والهاتف والعنوان — وهذا كل شيء، تم تأكيد الحجز",
      whyTitle: "لماذا بيت دافئ؟",
      why1Title: "طاقم مؤهل وذو خبرة", why1Text: "جميع أعضاء الطاقم مرخصون وذوو خبرة في الرعاية المنزلية",
      why2Title: "حجز فوري", why2Text: "اختر تاريخًا ووقتًا متاحين واحصل على تأكيد فوري",
      why3Title: "دون تسجيل غير ضروري", why3Text: "احجز خلال دقيقة واحدة، بياناتك تبقى معك فقط",
      ctaTitle: "هل أنت مستعد للبدء؟", ctaText: "حجز زيارة منزلية يستغرق أقل من دقيقة — دون تسجيل، دون كلمة مرور.", ctaButton: "لنبدأ",
      contactTitle: "تواصل معنا",
      contactIntro: "لديك سؤال قبل الحجز؟ للاستفسارات غير العاجلة فقط — في حالات الطوارئ الطبية يُرجى التواصل مباشرة مع خدمات الطوارئ.",
      contactNameLabel: "الاسم الكامل", contactPhoneLabel: "الهاتف (اختياري، للتواصل معك)",
      contactSubjectLabel: "الموضوع", contactSubjectPlaceholder: "اختياري",
      contactBodyLabel: "الرسالة", contactSubmit: "إرسال الرسالة",
      footerTagline: "رعاية طبية احترافية، مباشرة إلى بابك.",
      footerStaffLogin: "دخول الطاقم الطبي", footerAdminLogin: "دخول المدير",
      loadingServices: "جارٍ تحميل الخدمات...", errLoadingServices: "خطأ في تحميل الخدمات",
      contactValidation: "يرجى إدخال الاسم الكامل والرسالة", contactConnError: "خطأ في الاتصال. يرجى المحاولة مرة أخرى.",
      contactSending: "جارٍ الإرسال...", contactSuccess: "تم إرسال رسالتك — سنعاود التواصل معك قريبًا.",
    },
    staff: {
      title: "بيت دافئ — اختيار عضو الطاقم",
      step1: "1. اختيار الطاقم", step2: "2. الحجز والتفاصيل",
      pageTitle: "مع من من أعضاء الطاقم ترغب بحجز زيارة؟",
      subtitle: "اختر عضو طاقم متاحًا حسب الدور والتوفر",
      showAllStaff: "← عرض جميع أعضاء الطاقم",
      loadingStaff: "جارٍ تحميل قائمة الطاقم...",
      errLoadingStaff: "خطأ في تحميل قائمة الطاقم: ",
      emptyState: "لم يتم العثور على أعضاء طاقم متاحين حاليًا.",
      roleFilterTitle: "{role} متاحون للزيارات المنزلية",
    },
    booking: {
      title: "بيت دافئ — حجز موعد",
      h1Hidden: "حجز موعد — بيت دافئ",
      staffLabel: "عضو الطاقم:", changeStaff: "تغيير عضو الطاقم",
      purposeTitle: "غرض الزيارة", dateTitle: "التاريخ", timeTitle: "الوقت المتاح",
      noSlots: "لا توجد أوقات متاحة في هذا التاريخ. جرّب تاريخًا آخر.",
      noDatesAvailable: "لا توجد أيام متاحة لعضو الطاقم هذا.",
      detailsTitle: "على وشك الانتهاء — بياناتك",
      detailsSubtitle: "تُستخدم فقط لتنسيق زيارتك — دون تسجيل ودون كلمة مرور. الحقول المعلّمة بـ * إلزامية.",
      nameLabel: "الاسم الكامل *", namePlaceholder: "مثال: محمد أحمد",
      idLabel: "رقم الهوية *", idPlaceholder: "9 أرقام",
      idHelp: "تُستخدم للتعرف الدقيق عليك في سجلك الطبي — لن تُشارك مع أي جهة خارجية.",
      phoneLabel: "الهاتف *", phonePlaceholder: "050-1234567",
      addressLabel: "عنوان الزيارة *", addressPlaceholder: "الشارع ورقم المنزل والمدينة",
      notesLabel: "ملاحظات (اختياري)", notesPlaceholder: "مثال: يرجى الاتصال قبل الوصول",
      trustStrip: "🔒 طاقم مؤهل وذو خبرة · تُستخدم بياناتك فقط لتنسيق الزيارة ولا تُشارك مع أي جهة خارجية",
      confirmButton: "تأكيد الحجز",
      loadingSlots: "جارٍ تحميل الأوقات المتاحة...", errLoadingSlots: "خطأ في تحميل الأوقات المتاحة: ",
      fillAllFields: "يرجى إدخال الاسم الكامل ورقم الهوية والهاتف وعنوان الزيارة.",
      invalidId: "يجب أن يحتوي رقم الهوية على 5 إلى 9 أرقام.",
      savingBooking: "جارٍ حفظ الحجز...",
      slotTaken: "عذرًا، تم للتو حجز هذا الوقت. يرجى اختيار وقت آخر.",
      errSavingBooking: "خطأ في حفظ الحجز: ",
      bookingSuccess: "تم حجز زيارتك بنجاح! جارٍ تحويلك إلى حجوزاتك...",
    },
    myBookings: {
      title: "بيت دافئ — حجوزاتي",
      h1: "حجوزاتي",
      accessTitle: "الوصول من أي جهاز",
      phoneLinkStatusDefault: "ربط رقم هاتف يتيح لك الوصول إلى حجوزاتك من جهاز آخر أيضًا.",
      phoneLinkStatusLinked: "متصل برقم الهاتف {phone} — يمكنك تسجيل الدخول من أي جهاز به (رهنًا بتفعيل خدمة الرسائل النصية).",
      phoneNumberLabel: "رقم الهاتف", phonePlaceholder: "05XXXXXXXX",
      sendCodeButton: "إرسال رمز التحقق",
      verifyCodeLabel: "رمز التحقق", codePlaceholder: "123456",
      verifyAndLinkButton: "تحقّق واربط",
      alreadyLinkedSummary: "هل سبق أن ربطت هاتفًا من جهاز آخر؟ تسجيل الدخول",
      sendCodeButtonShort: "إرسال الرمز", signInButton: "تسجيل الدخول",
      upcomingTitle: "الزيارات القادمة", upcomingEmpty: "ليس لديك زيارات مجدولة.",
      pastTitle: "سجل الزيارات", pastEmpty: "لا يوجد سجل زيارات.",
      serviceRequestTitle: "طلب خدمة",
      serviceRequestIntro: "يتم حجز الزيارة لمرة واحدة مباشرة من الأوقات المتاحة فعليًا. الخدمة الدورية (مثل مرتين أسبوعيًا لمدة شهر) هي طلب تتم مراجعته والموافقة عليه من قبل طاقمنا.",
      serviceTypeLabel: "نوع الخدمة المطلوبة", serviceTypePlaceholder: "مثال: زيارة ممرضة",
      frequencyLabel: "التكرار",
      freqSingle: "لمرة واحدة", freqWeekly: "أسبوعي", freqTwiceWeekly: "مرتين أسبوعيًا", freqDaily: "يومي", freqCustom: "أخرى",
      startDateLabel: "تاريخ البدء المطلوب",
      moreDetailsLabel: "تفاصيل إضافية", optionalPlaceholder: "اختياري",
      submitRequest: "إرسال الطلب", goToBooking: "الانتقال إلى الحجز",
      loadingBookings: "جارٍ تحميل حجوزاتك...", errLoadingBookings: "خطأ في تحميل الحجوزات: ",
      noteLabel: "ملاحظة: ",
      cancelButton: "إلغاء", cancelConfirm: "هل تريد إلغاء هذه الزيارة؟", cancelling: "جارٍ الإلغاء...",
      errCancelling: "خطأ في إلغاء الحجز: ",
      viewReport: "عرض تقرير الزيارة", hideReport: "إخفاء تقرير الزيارة",
      noPastPlanRequests: "لا توجد طلبات خدمة سابقة.",
      fillServiceFields: "يرجى إدخال نوع الخدمة وتاريخ البدء",
      sending: "جارٍ الإرسال...", serviceRequestSuccess: "تم إرسال طلبك — سيقوم طاقمنا بمراجعته والتواصل معك.",
      verifying: "جارٍ التحقق...", signingIn: "جارٍ تسجيل الدخول...",
      invalidPhone: "يرجى إدخال رقم هاتف صالح", missingCode: "يرجى إدخال الرمز الذي تلقيته",
    },
  },
};

function t(key) {
  const parts = key.split(".");
  const lookup = (dict) => parts.reduce((acc, p) => (acc && typeof acc === "object" ? acc[p] : undefined), dict);
  const val = lookup(I18N_STRINGS[getLang()]);
  if (typeof val === "string") return val;
  const fallback = lookup(I18N_STRINGS.he);
  return typeof fallback === "string" ? fallback : key;
}

function tf(key, vars) {
  let s = t(key);
  if (vars) Object.keys(vars).forEach((k) => { s = s.replace(`{${k}}`, vars[k]); });
  return s;
}

function roleLabel(role) { return I18N_STRINGS[getLang()].roleLabels[role] || role; }
function roleDescription(role) { return I18N_STRINGS[getLang()].roleDescriptions[role] || ""; }
function purposeLabel(purpose) { return I18N_STRINGS[getLang()].purposeLabels[purpose] || purpose; }
function statusLabel(status) { return I18N_STRINGS[getLang()].statusLabels[status] || status; }
function servicePlanStatusLabel(status) { return I18N_STRINGS[getLang()].servicePlanStatusLabels[status] || status; }
function weekdayShortLabel(idx) { return I18N_STRINGS[getLang()].weekdayShort[idx]; }
function vitalLabel(key) { return I18N_STRINGS[getLang()].vitalsLabels[key] || key; }
function procedureLabel(key) { return I18N_STRINGS[getLang()].procedureLabels[key] || key; }

function formatDateLocalized(date) {
  return date.toLocaleDateString(LOCALE_BY_LANG[getLang()] || "he-IL", { day: "numeric", month: "numeric" });
}
function formatTimeLocalized(date) {
  return date.toLocaleTimeString(LOCALE_BY_LANG[getLang()] || "he-IL", { hour: "2-digit", minute: "2-digit" });
}

function formatAvailabilityLocalized(staff) {
  const days = (staff.available_weekdays || []).slice().sort().map((d) => weekdayShortLabel(d)).join(", ");
  const start = staff.work_start_time?.slice(0, 5);
  const end = staff.work_end_time?.slice(0, 5);
  return `${I18N_STRINGS[getLang()].daysWord} ${days} · ${start}–${end}`;
}

function friendlyErrorMessageLocalized(err) {
  const msg = (typeof friendlyErrorMessage === "function") ? friendlyErrorMessage(err) : String(err);
  const he = I18N_STRINGS.he;
  if (msg === he.errFallback) return t("errFallback");
  if (msg === he.errNetwork) return t("errNetwork");
  return msg;
}

// דורש escapeHtml מ-app.js (טעון תמיד לפני i18n.js בכל 4 העמודים הפונים למטופל)
function visitReportDetailsHtmlLocalized(report) {
  const vr = I18N_STRINGS[getLang()].visitReport;
  const vitalsHtml = VITALS_ORDER.map(({ key, unit }) => {
    const val = report[key];
    if (val === null || val === undefined) return "";
    return `<div class="vr-vital"><span class="vr-vital-label">${vitalLabel(key)}</span><span class="vr-vital-value">${val}${unit ? " " + unit : ""}</span></div>`;
  }).join("");
  const proceduresHtml = PROCEDURE_ORDER.filter((k) => report[k]).map((k) => `<li>${procedureLabel(k)}</li>`).join("");
  const date = new Date(report.visit_date);

  return `
    <div class="visit-report-card">
      <div class="meta">${vr.doneAt}${formatDateLocalized(date)} ${formatTimeLocalized(date)}</div>
      ${vitalsHtml ? `<div class="vr-vitals-grid">${vitalsHtml}</div>` : ""}
      ${proceduresHtml ? `<div class="vr-procedures"><strong>${vr.proceduresPerformed}</strong><ul>${proceduresHtml}</ul></div>` : ""}
      <div class="vr-summary"><strong>${vr.summary}</strong> ${escapeHtml(report.treatment_summary)}</div>
      ${report.patient_signature_data && report.patient_signature_data.startsWith("data:image/png;base64,") ? `<div class="vr-signature"><strong>${vr.patientSignature}</strong><br><img src="${report.patient_signature_data}" alt="${vr.patientSignature}"></div>` : ""}
    </div>
  `;
}

// מחיל data-i18n(/-placeholder/-aria-label/-alt/-title) על כל המרקאפ הסטטי שכבר
// פוענח ב-DOM. לא נוגע בתוכן שנבנה דינמית אח"כ (כרטיסים/רשימות) — אלה קוראים
// לפונקציות t()/roleLabel() וכו' ישירות בזמן היצירה.
function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.getAttribute("data-i18n-placeholder")); });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => { el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label"))); });
  root.querySelectorAll("[data-i18n-alt]").forEach((el) => { el.alt = t(el.getAttribute("data-i18n-alt")); });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.getAttribute("data-i18n-title")); });
}

const LANG_NATIVE_NAMES = { he: "עב", en: "EN", ar: "عر" };
const LANG_FULL_NAMES = { he: "עברית", en: "English", ar: "العربية" };

function renderLangSwitch() {
  const nav = document.querySelector(".app-header nav");
  if (!nav || nav.querySelector(".lang-switch")) return;
  const wrap = document.createElement("div");
  wrap.className = "lang-switch";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "שפה / Language / اللغة");
  const current = getLang();
  SUPPORTED_LANGS.forEach((code) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = LANG_NATIVE_NAMES[code];
    btn.title = LANG_FULL_NAMES[code];
    btn.setAttribute("aria-label", LANG_FULL_NAMES[code]);
    btn.lang = code;
    if (code === current) {
      btn.classList.add("active");
      btn.setAttribute("aria-current", "true");
    }
    btn.addEventListener("click", () => { if (code !== getLang()) setLang(code); });
    wrap.appendChild(btn);
  });
  nav.appendChild(wrap);
}
