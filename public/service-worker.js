// Service Worker: מטמון (cache) עבור מעטפת האפליקציה הסטטית בלבד (HTML/CSS/JS/אייקונים) —
// כדי שהאתר ייטען ויעבוד אופליין ("הוספה למסך הבית"). קריאות ל-Supabase (הנתונים
// הקליניים עצמם) לעולם לא נשמרות במטמון כאן במכוון: מדד/תיק מטופל ישן שמוצג אופליין
// כאילו הוא עדכני הוא סיכון קליני ממשי, ומטופלים שונים עלולים לשתף מכשיר — לכן קריאות
// API תמיד הולכות ישירות לרשת. שמירת טיוטות אופליין (visit_reports) מטופלת בנפרד
// ב-app.js (תור-סנכרון מפורש ב-localStorage), לא כאן.

const CACHE_VERSION = "home-care-crm-shell-v4";

const APP_SHELL = [
  "index.html",
  "staff.html",
  "booking.html",
  "my-bookings.html",
  "admin.html",
  "employee.html",
  "employee-login.html",
  "styles.css",
  "app.js",
  "i18n.js",
  "config.js",
  "slot-calculation.js",
  "manifest.json",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
];

// לא קוראים ל-skipWaiting() אוטומטית כאן: worker חדש נשאר ב-waiting עד שהעמוד
// (app.js) מבקש ממנו במפורש להשתלט — כדי שלשונית פתוחה עם JS ישן בזיכרון לא
// תופעל לפתע נגד cache חדש באמצע session. ר' הערת "אין activation אגרסיבי" ב-app.js.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isApiOrThirdParty(url) {
  return url.hostname.endsWith("supabase.co") || url.hostname !== self.location.hostname;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || isApiOrThirdParty(url)) {
    return; // Supabase/predictive-service/CDN — תמיד ישירות לרשת, לא מיורט כאן
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached); // אין רשת — נופלים חזרה למטמון אם קיים
      return cached || network;
    })
  );
});
