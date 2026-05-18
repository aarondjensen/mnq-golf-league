// ─────────────────────────────────────────────────────────────────────────
//  firebase-messaging-sw.js — MnQ Golf push notification service worker
// ─────────────────────────────────────────────────────────────────────────
// Lives in /public/firebase-messaging-sw.js so Vite serves it at the root
// path /firebase-messaging-sw.js — Firebase Cloud Messaging requires the
// service worker to be at the root for scope reasons.
//
// Message-format contract with the Cloud Function side:
//   - Messages are DATA-ONLY (no FCM `notification` block).
//   - Title/body live in payload.data.title / payload.data.body.
//   - This SW is responsible for calling showNotification on every push.
//
// Rationale: FCM's auto-display behavior for notification-block messages
// is inconsistent on iOS PWA (sometimes the notification vanishes and
// onBackgroundMessage doesn't fire either). Data-only messages always
// route through this handler, giving cross-platform consistency.

importScripts("https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDW3tTWxOlrPoKiflmlh_6JPLe8vbvVEUE",
  authDomain: "mnq-golf-leage.firebaseapp.com",
  projectId: "mnq-golf-leage",
  storageBucket: "mnq-golf-leage.firebasestorage.app",
  messagingSenderId: "367374056990",
  appId: "1:367374056990:web:70133948f9b2760558780f",
});

const messaging = firebase.messaging();

// ─── Immediate activation lifecycle ─────────────────────────────────────
// Without these, a new SW waits for all existing instances of the page
// to close before taking over. On iOS PWAs in particular this almost
// never happens — users keep the PWA in the background indefinitely.
// skipWaiting + clients.claim mean a fresh deploy takes effect on the
// next page load. Critical for shipping fixes to this SW.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ─── Badge state — tracked in IndexedDB so it survives SW restarts ──
const BADGE_DB_NAME = "mnq-notif-state";
const BADGE_STORE = "kv";
const BADGE_KEY = "badge-count";

const openBadgeDB = () => new Promise((resolve, reject) => {
  if (!self.indexedDB) return reject(new Error("no idb"));
  const req = self.indexedDB.open(BADGE_DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(BADGE_STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const getBadgeCount = async () => {
  try {
    const db = await openBadgeDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(BADGE_STORE, "readonly");
      const req = tx.objectStore(BADGE_STORE).get(BADGE_KEY);
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
  } catch { return 0; }
};

const setBadgeCount = async (count) => {
  try {
    const db = await openBadgeDB();
    await new Promise((resolve) => {
      const tx = db.transaction(BADGE_STORE, "readwrite");
      tx.objectStore(BADGE_STORE).put(count, BADGE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* swallow */ }
};

const applyBadge = async (count) => {
  if (count > 0) {
    if (self.navigator.setAppBadge) {
      try { await self.navigator.setAppBadge(count); } catch { /* swallow */ }
    }
  } else {
    if (self.navigator.clearAppBadge) {
      try { await self.navigator.clearAppBadge(); } catch { /* swallow */ }
    }
  }
};

// ─── Background message handler ──────────────────────────────────────────
// Reads title/body from data block (data-only message format). Wrapped
// in try/catch so any error inside showNotification or badge update gets
// logged rather than failing silently — which is critical because iOS
// PWA push debugging is otherwise opaque. The catch also still calls
// showNotification with a fallback to ensure SOMETHING displays (iOS
// will throttle pushes if a push event arrives but no notification is
// shown).
messaging.onBackgroundMessage(async (payload) => {
  console.log("[SW] onBackgroundMessage fired", payload);
  try {
    const data = payload.data || {};
    // Data-only format: title and body live in the data block. Fall
    // back to the legacy notification-block format just in case any
    // older message is in flight.
    const title = data.title || payload.notification?.title || "MnQ Golf";
    const body = data.body || payload.notification?.body || "";

    // Increment badge before showing — visible count matches storage.
    try {
      const current = await getBadgeCount();
      const next = current + 1;
      await setBadgeCount(next);
      await applyBadge(next);
    } catch (e) {
      console.warn("[SW] Badge update failed", e);
    }

    return self.registration.showNotification(title, {
      body,
      icon: "/favicon/web-app-manifest-192x192.png",
      badge: "/favicon/web-app-manifest-192x192.png",
      data,
      tag: data.type || "default",
      renotify: true,
    });
  } catch (err) {
    console.error("[SW] onBackgroundMessage failed", err);
    // Last-ditch fallback so iOS doesn't see a silent push (which can
    // trigger origin-level push permission revocation).
    try {
      return self.registration.showNotification("MnQ Golf", {
        body: "A new update — open the app for details.",
      });
    } catch { /* truly hopeless */ }
  }
});

// ─── Click handler ──────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const urlMap = {
    week_finalized: "/?tab=standings",
    attest_ready: "/?tab=scoring",
    rained_out: "/?tab=schedule",
    attendance_marked: "/?tab=schedule",
  };
  const target = data.url || urlMap[data.type] || "/";

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({
      type: "window", includeUncontrolled: true,
    });
    await setBadgeCount(0);
    await applyBadge(0);
    for (const client of clientList) {
      if ("focus" in client) {
        try { await client.navigate(target); } catch { /* same-origin only; ignore */ }
        return client.focus();
      }
    }
    if (self.clients.openWindow) {
      return self.clients.openWindow(target);
    }
  })());
});

// ─── Page → SW message: clear badge ─────────────────────────────────────
self.addEventListener("message", async (event) => {
  if (event.data?.type === "CLEAR_BADGE") {
    await setBadgeCount(0);
    await applyBadge(0);
  }
});
