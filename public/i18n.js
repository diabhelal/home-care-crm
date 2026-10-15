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
      skipToContent: "דלגו לתוכן הראשי", navMainLabel: "ניווט ראשי", navFooterLabel: "קישורי תחתית",
    },
    index: {
      title: "בית חם — טיפול רפואי עד הבית",
      heroEyebrow: "🏠 פותרים לך את הבעיה בבית",
      heroTitle: "טיפול רפואי מקצועי, ישירות לביתך",
      heroSubtitle: "אחיות ואחים מוסמכים מגיעים אליכם הביתה — בדיקות, טיפול בפצעים, בדיקות דם ומתן תרופות. קובעים תוך דקות, בלי הרשמה ובלי סיסמה.",
      heroCta: "לתיאום ביקור",
      heroPhotoAlt: "אחות בודקת לחץ דם למטופלת, בחיוך",
      footerNote: "למקרה חירום – מד\"א 101. הפרטים שתמסרו משמשים רק לתיאום הביקור ולא מועברים לגורם שלישי.",
      serviceLinkText: "לצפייה בזמינות ←",
      howTitle: "איך זה עובד",
      howStep1Title: "בוחרים אחות או אח", howStep1Text: "לפי הזמינות שמתאימה לכם",
      howStep2Title: "בוחרים תאריך ושעה", howStep2Text: "מתוך הזמנים הפנויים בפועל, בזמן אמת",
      howStep3Title: "ממלאים פרטים ומאשרים", howStep3Text: "שם, טלפון וכתובת — וזהו, ההזמנה נקבעה",
      contactIntro: "שאלה לפני שקובעים ביקור? לפניות שאינן דחופות — למקרה חירום רפואי יש לפנות ישירות לשירותי החירום.",
      contactNameLabel: "שם מלא", contactPhoneLabel: "טלפון (אופציונלי, לחזרה אליכם)",
      contactSubjectLabel: "נושא", contactSubjectPlaceholder: "אופציונלי",
      contactBodyLabel: "הודעה", contactSubmit: "שליחת פנייה",
      footerTagline: "טיפול רפואי מקצועי, ישירות לביתך.",
      footerStaffLogin: "כניסת צוות רפואי", footerAdminLogin: "כניסת מנהל",
      loadingServices: "טוען שירותים...", errLoadingServices: "שגיאה בטעינת השירותים",
      contactValidation: "יש להזין שם מלא והודעה", contactConnError: "שגיאה ביצירת חיבור. נסו שוב.",
      contactSending: "שולח...", contactSuccess: "הפנייה נשלחה, נחזור אליכם בהקדם.",
    },
    staff: {
      title: "בית חם — בחירת אחות או אח",
      step1: "1. בחירת אחות או אח", step2: "2. הזמנה ופרטים",
      pageTitle: "אצל איזו אחות או אח תרצו לקבוע ביקור?",
      subtitle: "בחרו אחות או אח פנויים לפי זמינות",
      showAllStaff: "← הצגת כל האחיות והאחים",
      nextAvail: "הזמינות הקרובה: {when} {time}",
      noAvail: "אין זמינות בשבועיים הקרובים",
      today: "היום", tomorrow: "מחר",
      roleFilterLabel: "תפקיד", roleAll: "כל התפקידים",
      dayFilterLabel: "זמין ביום", dayAny: "כל יום",
      noMatch: "אין אחיות או אחים שמתאימים לסינון שנבחר.",
      loadingStaff: "טוען רשימת אחיות ואחים...",
      errLoadingStaff: "שגיאה בטעינת הרשימה: ",
      emptyState: "לא נמצאו אחיות או אחים זמינים כרגע.",
      roleFilterTitle: "{role} זמינים לביקור בית",
    },
    booking: {
      title: "בית חם — קביעת תור",
      h1Hidden: "קביעת תור — בית חם",
      staffLabel: "אחות או אח:", changeStaff: "החלפת אחות או אח",
      purposeTitle: "מטרת הביקור", dateTitle: "תאריך", timeTitle: "שעה פנויה",
      noSlots: "אין שעות פנויות בתאריך זה. נסו תאריך אחר.",
      noDatesAvailable: "אין ימים זמינים לאחות או אח זה.",
      detailsTitle: "עוד רגע וסיימנו — מלאו פרטים",
      detailsSubtitle: "נשמש רק כדי לתאם את הביקור — בלי הרשמה ובלי סיסמה. שדות עם * הם חובה.",
      nameLabel: "שם מלא *", namePlaceholder: "לדוגמה: ישראל ישראלי",
      idLabel: "תעודת זהות *", idPlaceholder: "9 ספרות",
      idHelp: "משמשת לזיהוי מדויק שלך בתיק הרפואי שלך במערכת — לא ישותפו עם צד שלישי.",
      phoneLabel: "טלפון *",
      addressLabel: "כתובת לביקור *", addressPlaceholder: "רחוב, מספר בית ועיר",
      notesLabel: "הערות (אופציונלי)", notesPlaceholder: "לדוגמה: יש להתקשר לפני ההגעה",
      trustStrip: "🔒 צוות מוסמך ומנוסה · הפרטים שלך משמשים רק לתיאום הביקור ואינם נמסרים לגורם שלישי",
      confirmButton: "אישור הזמנה",
      loadingSlots: "טוען שעות פנויות...", errLoadingSlots: "שגיאה בטעינת שעות פנויות: ",
      fillAllFields: "נא למלא שם מלא, תעודת זהות, טלפון וכתובת לביקור.",
      invalidId: "תעודת זהות צריכה להכיל בין 5 ל-9 ספרות.",
      savingBooking: "שומר הזמנה...",
      slotTaken: "המטפל אינו פנוי בשעה זו, אנא בחר משבצת זמן אחרת",
      errSavingBooking: "שגיאה בשמירת ההזמנה: ",
      confirmedTitle: "ההזמנה נקבעה בהצלחה!",
      confirmedPurposeLabel: "מטרת הביקור:", confirmedWhenLabel: "מועד:", confirmedAddressLabel: "כתובת:",
      confirmedGoToBookings: "מעבר להזמנות שלי",
    },
    account: {
      saveTitle: "שמרו את ההיסטוריה שלכם",
      saveIntro: "אפשר ליצור חשבון עם אימייל וסיסמה כדי לראות את ההזמנות גם ממכשיר אחר. זה אופציונלי — ההזמנה כבר נשמרה.",
      emailLabel: "אימייל", passwordLabel: "סיסמה (לפחות 8 תווים)",
      saveButton: "שמירת ההיסטוריה", saving: "שומר...",
      invalidEmail: "יש להזין כתובת אימייל תקינה", pwTooShort: "הסיסמה חייבת להכיל לפחות 8 תווים",
      upgraded: "החשבון נשמר. ההזמנות שלכם זמינות מעכשיו גם ממכשיר אחר.",
      confirmEmail: "שלחנו הודעת אישור לכתובת האימייל. יש ללחוץ על הקישור בהודעה כדי להשלים את שמירת החשבון.",
      haveAccount: "יש לי חשבון — כניסה", signInButton: "כניסה", signingIn: "נכנס...",
      signedInAs: "מחוברים כ-{email}", signOut: "התנתקות",
      orderLabel: "הזמנה #{id}", statusAria: "סטטוס ההזמנה: {step}",
      stepReceived: "התקבלה", stepAssigned: "נקבעה", stepInProgress: "בדרך אליכם / בביצוע", stepDone: "בוצעה", stepCancelled: "בוטלה",
    },
    myBookings: {
      title: "בית חם — ההזמנות שלי",
      h1: "ההזמנות שלי",
      signInButton: "התחברות",
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
      rebookButton: "הזמן שוב",
      noPastPlanRequests: "אין בקשות שירות קודמות.",
      fillServiceFields: "יש להזין סוג שירות ותאריך התחלה",
      sending: "שולח...", serviceRequestSuccess: "הבקשה נשלחה — הצוות שלנו יבדוק ויחזור אליך.",
      signingIn: "מתחבר...",
      messagesTitle: "ההודעות שלי",
      messagesEmpty: "אין הודעות עדיין. אפשר לשלוח פנייה מדף הבית.",
      messageReplyLabel: "הוספת הודעה", messageReplyPlaceholder: "כתיבת הודעה לצוות...",
      messageSendButton: "שליחת הודעה", messageEmptyError: "יש להזין טקסט להודעה",
      messageFromMe: "אני", messageFromStaff: "צוות",
    },
  },

  en: {
    roleLabels: { nurse: "Nurse", doctor: "Doctor", physiotherapist: "Physiotherapist", caregiver: "Caregiver" },
    roleDescriptions: {
      nurse: "Wound care, medication administration and blood tests — at home",
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
      skipToContent: "Skip to main content", navMainLabel: "Main navigation", navFooterLabel: "Footer links",
    },
    index: {
      title: "Warm Home — Home Medical Care",
      heroEyebrow: "🏠 We solve the problem for you, at home",
      heroTitle: "Professional medical care, straight to your door",
      heroSubtitle: "Licensed nurses come to your home — checkups, wound care, blood tests and medication administration. Book in minutes, no sign-up and no password.",
      heroCta: "Book a Visit",
      heroPhotoAlt: "A smiling nurse checking a patient's blood pressure",
      footerNote: "For a medical emergency call Magen David Adom 101. The details you provide are used only to arrange your visit and are not shared with third parties.",
      serviceLinkText: "View availability →",
      howTitle: "How It Works",
      howStep1Title: "Choose your nurse", howStep1Text: "By the availability that suits you",
      howStep2Title: "Choose a date and time", howStep2Text: "From actual available slots, in real time",
      howStep3Title: "Fill in your details and confirm", howStep3Text: "Name, phone and address — and that's it, your visit is booked",
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
      step1: "1. Choose Nurse", step2: "2. Booking & Details",
      pageTitle: "Which nurse would you like to book?",
      subtitle: "Choose an available nurse by availability",
      showAllStaff: "← Show all nurses",
      nextAvail: "Next availability: {when} {time}",
      noAvail: "No availability in the next two weeks",
      today: "Today", tomorrow: "Tomorrow",
      roleFilterLabel: "Role", roleAll: "All roles",
      dayFilterLabel: "Available on", dayAny: "Any day",
      noMatch: "No nurses match the selected filters.",
      loadingStaff: "Loading nurses...",
      errLoadingStaff: "Error loading list: ",
      emptyState: "No available nurses found right now.",
      roleFilterTitle: "{role} available for home visits",
    },
    booking: {
      title: "Warm Home — Book a Visit",
      h1Hidden: "Book a Visit — Warm Home",
      staffLabel: "Nurse:", changeStaff: "Change nurse",
      purposeTitle: "Visit Purpose", dateTitle: "Date", timeTitle: "Available Time",
      noSlots: "No available times on this date. Try another date.",
      noDatesAvailable: "No available days for this nurse.",
      detailsTitle: "Almost done — your details",
      detailsSubtitle: "Used only to coordinate your visit — no sign-up, no password. Fields marked * are required.",
      nameLabel: "Full name *", namePlaceholder: "e.g. John Smith",
      idLabel: "National ID *", idPlaceholder: "9 digits",
      idHelp: "Used to identify you accurately in your medical record — never shared with third parties.",
      phoneLabel: "Phone *",
      addressLabel: "Visit address *", addressPlaceholder: "Street, house number and city",
      notesLabel: "Notes (optional)", notesPlaceholder: "e.g. Please call before arriving",
      trustStrip: "🔒 Qualified, experienced nurses · Your details are used only to coordinate the visit and are never shared with third parties",
      confirmButton: "Confirm Booking",
      loadingSlots: "Loading available times...", errLoadingSlots: "Error loading available times: ",
      fillAllFields: "Please fill in your full name, national ID, phone and visit address.",
      invalidId: "National ID must contain between 5 and 9 digits.",
      savingBooking: "Saving booking...",
      slotTaken: "Sorry, this time slot was just taken. Please choose another time.",
      errSavingBooking: "Error saving booking: ",
      confirmedTitle: "Your visit has been booked successfully!",
      confirmedPurposeLabel: "Visit purpose:", confirmedWhenLabel: "When:", confirmedAddressLabel: "Address:",
      confirmedGoToBookings: "Go to My Bookings",
    },
    account: {
      saveTitle: "Save your history",
      saveIntro: "Create an account with an email and password to see your bookings from another device too. Optional — your booking is already saved.",
      emailLabel: "Email", passwordLabel: "Password (at least 8 characters)",
      saveButton: "Save my history", saving: "Saving...",
      invalidEmail: "Please enter a valid email address", pwTooShort: "Password must be at least 8 characters",
      upgraded: "Account saved. Your bookings are now available from another device too.",
      confirmEmail: "We sent a confirmation message to your email. Click the link in it to finish saving your account.",
      haveAccount: "I have an account — sign in", signInButton: "Sign in", signingIn: "Signing in...",
      signedInAs: "Signed in as {email}", signOut: "Sign out",
      orderLabel: "Booking #{id}", statusAria: "Booking status: {step}",
      stepReceived: "Received", stepAssigned: "Scheduled", stepInProgress: "On the way / in progress", stepDone: "Completed", stepCancelled: "Cancelled",
    },
    myBookings: {
      title: "Warm Home — My Bookings",
      h1: "My Bookings",
      signInButton: "Sign in",
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
      rebookButton: "Book again",
      noPastPlanRequests: "No previous service requests.",
      fillServiceFields: "Please enter a service type and start date",
      sending: "Sending...", serviceRequestSuccess: "Your request has been sent — our team will review it and get back to you.",
      signingIn: "Signing in...",
      messagesTitle: "My Messages",
      messagesEmpty: "No messages yet. You can send an inquiry from the homepage.",
      messageReplyLabel: "Add a message", messageReplyPlaceholder: "Write a message to the team...",
      messageSendButton: "Send Message", messageEmptyError: "Please enter a message",
      messageFromMe: "Me", messageFromStaff: "Staff",
    },
  },

  ar: {
    roleLabels: { nurse: "ممرض/ة", doctor: "طبيب/ة", physiotherapist: "أخصائي/ة علاج طبيعي", caregiver: "مقدم/ة رعاية" },
    roleDescriptions: {
      nurse: "العناية بالجروح وإعطاء الأدوية وفحوصات الدم — في منزلك",
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
      skipToContent: "انتقل إلى المحتوى الرئيسي", navMainLabel: "التنقل الرئيسي", navFooterLabel: "روابط التذييل",
    },
    index: {
      title: "بيت دافئ — رعاية طبية منزلية",
      heroEyebrow: "🏠 نحلّ لك المشكلة، في المنزل",
      heroTitle: "رعاية طبية احترافية، مباشرة إلى بابك",
      heroSubtitle: "ممرضات وممرضون مرخّصون يصلون إلى منزلكم — فحوصات، عناية بالجروح، فحوصات دم وإعطاء أدوية. احجز خلال دقائق، دون تسجيل ودون كلمة مرور.",
      heroCta: "حجز زيارة",
      heroPhotoAlt: "ممرضة مبتسمة تفحص ضغط دم المريضة",
      footerNote: "في حالة طوارئ طبية اتصلوا بنجمة داود الحمراء 101. تُستخدم التفاصيل التي تقدمونها لتنسيق الزيارة فقط ولا تُشارك مع أطراف ثالثة.",
      serviceLinkText: "عرض التوفر ←",
      howTitle: "كيف يعمل",
      howStep1Title: "اختر ممرضًا أو ممرضة", howStep1Text: "حسب التوفر الذي يناسبك",
      howStep2Title: "اختر التاريخ والوقت", howStep2Text: "من الأوقات المتاحة فعليًا، في الوقت الفعلي",
      howStep3Title: "أدخل بياناتك وأكّد", howStep3Text: "الاسم والهاتف والعنوان — وهذا كل شيء، تم تأكيد الحجز",
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
      title: "بيت دافئ — اختيار الممرض/ة",
      step1: "1. اختيار الممرض/ة", step2: "2. الحجز والتفاصيل",
      pageTitle: "عند أي ممرض أو ممرضة ترغب بحجز زيارة؟",
      subtitle: "اختر ممرضًا أو ممرضة متاحًا حسب التوفر",
      showAllStaff: "← عرض جميع الممرضين",
      nextAvail: "أقرب موعد متاح: {when} {time}",
      noAvail: "لا توجد مواعيد متاحة خلال الأسبوعين القادمين",
      today: "اليوم", tomorrow: "غدًا",
      roleFilterLabel: "الدور", roleAll: "كل الأدوار",
      dayFilterLabel: "متاح في يوم", dayAny: "أي يوم",
      noMatch: "لا يوجد ممرضون يطابقون عوامل التصفية المحددة.",
      loadingStaff: "جارٍ تحميل قائمة الطاقم...",
      errLoadingStaff: "خطأ في تحميل قائمة الطاقم: ",
      emptyState: "لم يتم العثور على ممرضين متاحين حاليًا.",
      roleFilterTitle: "{role} متاحون للزيارات المنزلية",
    },
    booking: {
      title: "بيت دافئ — حجز موعد",
      h1Hidden: "حجز موعد — بيت دافئ",
      staffLabel: "الممرض/ة:", changeStaff: "تغيير الممرض/ة",
      purposeTitle: "غرض الزيارة", dateTitle: "التاريخ", timeTitle: "الوقت المتاح",
      noSlots: "لا توجد أوقات متاحة في هذا التاريخ. جرّب تاريخًا آخر.",
      noDatesAvailable: "لا توجد أيام متاحة لهذا الممرض/ة.",
      detailsTitle: "على وشك الانتهاء — بياناتك",
      detailsSubtitle: "تُستخدم فقط لتنسيق زيارتك — دون تسجيل ودون كلمة مرور. الحقول المعلّمة بـ * إلزامية.",
      nameLabel: "الاسم الكامل *", namePlaceholder: "مثال: محمد أحمد",
      idLabel: "رقم الهوية *", idPlaceholder: "9 أرقام",
      idHelp: "تُستخدم للتعرف الدقيق عليك في سجلك الطبي — لن تُشارك مع أي جهة خارجية.",
      phoneLabel: "الهاتف *",
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
      confirmedTitle: "تم حجز زيارتك بنجاح!",
      confirmedPurposeLabel: "غرض الزيارة:", confirmedWhenLabel: "الموعد:", confirmedAddressLabel: "العنوان:",
      confirmedGoToBookings: "الانتقال إلى حجوزاتي",
    },
    account: {
      saveTitle: "احفظ سجلّك",
      saveIntro: "يمكنك إنشاء حساب بالبريد الإلكتروني وكلمة مرور لرؤية حجوزاتك من جهاز آخر أيضًا. اختياري — حجزك محفوظ بالفعل.",
      emailLabel: "البريد الإلكتروني", passwordLabel: "كلمة المرور (8 أحرف على الأقل)",
      saveButton: "حفظ السجل", saving: "جارٍ الحفظ...",
      invalidEmail: "يرجى إدخال بريد إلكتروني صالح", pwTooShort: "يجب أن تحتوي كلمة المرور على 8 أحرف على الأقل",
      upgraded: "تم حفظ الحساب. حجوزاتك متاحة الآن من جهاز آخر أيضًا.",
      confirmEmail: "أرسلنا رسالة تأكيد إلى بريدك الإلكتروني. اضغط على الرابط فيها لإكمال حفظ الحساب.",
      haveAccount: "لدي حساب — تسجيل الدخول", signInButton: "دخول", signingIn: "جارٍ الدخول...",
      signedInAs: "مسجّل الدخول باسم {email}", signOut: "تسجيل الخروج",
      orderLabel: "حجز رقم #{id}", statusAria: "حالة الحجز: {step}",
      stepReceived: "تم الاستلام", stepAssigned: "تم تحديد الموعد", stepInProgress: "في الطريق إليكم / قيد التنفيذ", stepDone: "تم التنفيذ", stepCancelled: "ملغى",
    },
    myBookings: {
      title: "بيت دافئ — حجوزاتي",
      h1: "حجوزاتي",
      signInButton: "تسجيل الدخول",
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
      rebookButton: "احجز مرة أخرى",
      noPastPlanRequests: "لا توجد طلبات خدمة سابقة.",
      fillServiceFields: "يرجى إدخال نوع الخدمة وتاريخ البدء",
      sending: "جارٍ الإرسال...", serviceRequestSuccess: "تم إرسال طلبك — سيقوم طاقمنا بمراجعته والتواصل معك.",
      signingIn: "جارٍ تسجيل الدخول...",
      messagesTitle: "رسائلي",
      messagesEmpty: "لا توجد رسائل بعد. يمكنك إرسال استفسار من الصفحة الرئيسية.",
      messageReplyLabel: "إضافة رسالة", messageReplyPlaceholder: "اكتب رسالة للطاقم...",
      messageSendButton: "إرسال الرسالة", messageEmptyError: "يرجى إدخال نص الرسالة",
      messageFromMe: "أنا", messageFromStaff: "الطاقم",
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

// בורר שפה קומפקטי — <select> סמנטי יחיד במקום 3 כפתורים שווי-משקל (נגיש מהקופסה,
// בלי JS מותאם אישית להרכבת dropdown/focus-trap).
function renderLangSwitch() {
  const nav = document.querySelector(".app-header nav");
  if (!nav || nav.querySelector(".lang-switch")) return;
  const select = document.createElement("select");
  select.className = "lang-switch";
  select.setAttribute("aria-label", "שפה / Language / اللغة");
  const current = getLang();
  SUPPORTED_LANGS.forEach((code) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = LANG_FULL_NAMES[code];
    if (code === current) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => { if (select.value !== getLang()) setLang(select.value); });
  nav.appendChild(select);
}


// ===== חשבון אופציונלי (אימייל+סיסמה) ומעקב סטטוס הזמנה =====
// משדרג את אותו משתמש אנונימי (updateUser) — אותו auth.uid(), ההזמנות נשמרות.
// opts: { showUpgrade, allowSignIn, onChange }
function renderAccountCard(host, user, opts) {
  opts = opts || {};
  host.innerHTML = "";
  if (!user) return;
  if (!user.is_anonymous && user.email) {
    host.innerHTML = `<div class="card card-compact" style="margin-bottom:16px;"><p style="margin:0 0 10px;">${escapeHtml(tf("account.signedInAs", { email: user.email }))}</p><button type="button" class="btn btn-secondary btn-sm" id="account-signout-btn">${t("account.signOut")}</button></div>`;
    document.getElementById("account-signout-btn").addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      try { sessionStorage.clear(); } catch (e) {}
      location.reload();
    });
    return;
  }
  const showUpgrade = opts.showUpgrade !== false;
  const parts = [];
  if (showUpgrade) {
    parts.push(`<div class="card card-compact" style="margin-bottom:16px;" id="account-upgrade">
      <div class="section-title" style="margin-top:0;">${t("account.saveTitle")}</div>
      <p style="color:var(--text-muted); margin-top:0;">${t("account.saveIntro")}</p>
      <div class="field"><label for="account-email">${t("account.emailLabel")}</label><input type="email" id="account-email" autocomplete="email" dir="ltr"></div>
      <div class="field"><label for="account-password">${t("account.passwordLabel")}</label><input type="password" id="account-password" autocomplete="new-password" minlength="8" dir="ltr"></div>
      <div class="error-msg" id="account-error" role="alert" aria-live="assertive"></div>
      <div class="success-msg" id="account-success" role="status" aria-live="polite"></div>
      <button type="button" class="btn btn-primary btn-sm" id="account-save-btn">${t("account.saveButton")}</button>
    </div>`);
  }
  if (opts.allowSignIn) {
    parts.push(`<div class="card card-compact" style="margin-bottom:16px;" id="account-signin">
      <a href="#" id="account-signin-toggle">${t("account.haveAccount")}</a>
      <div id="account-signin-form" style="display:none; margin-top:10px;">
        <div class="field"><label for="signin-email">${t("account.emailLabel")}</label><input type="email" id="signin-email" autocomplete="email" dir="ltr"></div>
        <div class="field"><label for="signin-password">${t("account.passwordLabel")}</label><input type="password" id="signin-password" autocomplete="current-password" dir="ltr"></div>
        <div class="error-msg" id="signin-error" role="alert" aria-live="assertive"></div>
        <button type="button" class="btn btn-primary btn-sm" id="signin-btn">${t("account.signInButton")}</button>
      </div>
    </div>`);
  }
  host.innerHTML = parts.join("");

  const saveBtn = document.getElementById("account-save-btn");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    const errEl = document.getElementById("account-error");
    const okEl = document.getElementById("account-success");
    hideError(errEl); okEl.classList.remove("show");
    const email = document.getElementById("account-email").value.trim();
    const password = document.getElementById("account-password").value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showError(errEl, t("account.invalidEmail")); return; }
    if (password.length < 8) { showError(errEl, t("account.pwTooShort")); return; }
    setButtonLoading(saveBtn, true, t("account.saving"));
    let res;
    try { res = await supabaseClient.auth.updateUser({ email, password }); } catch (err) { res = { error: err }; }
    setButtonLoading(saveBtn, false);
    if (res.error) { showError(errEl, friendlyErrorMessageLocalized(res.error)); return; }
    const u = res.data && res.data.user;
    const pending = !u || u.is_anonymous === true || !!u.new_email;
    okEl.textContent = pending ? t("account.confirmEmail") : t("account.upgraded");
    okEl.classList.add("show");
    document.getElementById("account-email").value = "";
    document.getElementById("account-password").value = "";
    if (!pending && opts.onChange) opts.onChange();
  });

  const toggle = document.getElementById("account-signin-toggle");
  if (toggle) {
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("account-signin-form").style.display = "block";
      document.getElementById("signin-email").focus();
    });
    document.getElementById("signin-btn").addEventListener("click", async () => {
      const errEl = document.getElementById("signin-error");
      hideError(errEl);
      const email = document.getElementById("signin-email").value.trim();
      const password = document.getElementById("signin-password").value;
      if (!email || !password) { showError(errEl, t("account.invalidEmail")); return; }
      const btn = document.getElementById("signin-btn");
      setButtonLoading(btn, true, t("account.signingIn"));
      let res;
      try { res = await supabaseClient.auth.signInWithPassword({ email, password }); } catch (err) { res = { error: err }; }
      setButtonLoading(btn, false);
      if (res.error) { showError(errEl, friendlyErrorMessageLocalized(res.error)); return; }
      location.reload();
    });
  }
}

// שלבי סטטוס ידידותיים למטופל מתוך status + workflow_status הקיימים
function bookingStatusStepsHtml(b) {
  const label = (k) => t("account." + k);
  if (b.status === "cancelled") {
    return `<span class="status-badge cancelled" aria-label="${escapeHtml(tf("account.statusAria", { step: label("stepCancelled") }))}">${label("stepCancelled")}</span>`;
  }
  const keys = ["stepReceived", "stepAssigned", "stepInProgress", "stepDone"];
  let cur = 0;
  if (b.status === "completed") cur = 3;
  else if (b.workflow_status === "in_progress") cur = 2;
  else if (b.workflow_status === "assigned") cur = 1;
  const items = keys.map((k, i) => {
    const cls = i < cur || (i === cur && cur === 3) ? "done" : i === cur ? "active" : "";
    return `<li class="step ${cls}"${i === cur ? ' aria-current="step"' : ""}>${label(k)}</li>`;
  }).join("");
  return `<ol class="steps" style="margin:6px 0 0; padding:0; list-style:none; flex-wrap:wrap; justify-content:flex-start;" aria-label="${escapeHtml(tf("account.statusAria", { step: label(keys[cur]) }))}">${items}</ol>`;
}
