// ─────────────────────────────────────────────────────────────────────────
//  firebase-messaging-sw.js — MnQ Golf push notification service worker
// ─────────────────────────────────────────────────────────────────────────
// Lives in /public/firebase-messaging-sw.js so Vite serves it at the root
// path /firebase-messaging-sw.js — Firebase Cloud Messaging requires the
// service worker to be at the root (not /assets/, not /public/) so the
// browser can register it with the correct scope.
//
// Why compat SDK: Service Worker context doesn't support ES module imports
// reliably across older browsers (iOS 16.4 Safari being the relevant edge
// case). The compat (UMD) build works via importScripts(), which is the
// vetted SW-compatible pattern Firebase docs use.
//
// IMPORTANT: This file is NOT processed by Vite. Any env vars or imports
// must be hardcoded here. Update the firebaseConfig block if the project
// id ever changes.

importScripts("https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js");

// ─── Firebase config — mirrors client config in src/firebase.js ──────────
// Keep these in sync if the underlying project ever changes. The typo
// "mnq-golf-leage" in the project id is intentional and matches the
// existing Firestore project.
firebase.initializeApp({
  apiKey: "AIzaSyDW3tTWxOlrPoKiflmlh_6JPLe8vbvVEUE",
  authDomain: "mnq-golf-leage.firebaseapp.com",
  projectId: "mnq-golf-leage",
  storageBucket: "mnq-golf-leage.firebasestorage.app",
  messagingSenderId: "367374056990",
  appId: "1:367374056990:web:70133948f9b2760558780f",
});

const messaging = firebase.messaging();

// ─── Badge state — tracked in IndexedDB via a simple key/value store ────
// We can't use localStorage from a service worker. The badge count needs
// to survive SW restart (Chrome aggressively recycles SWs after 30s idle),
// so a simple IDB key/value pattern is used. Falls back to a no-op if
// IDB isn't available (very old browser; should never hit in practice).
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

// Apply the badge to the home-screen icon. Works on installed PWAs on:
//   - iOS 16.4+ Safari
//   - Chrome Android (installed)
//   - macOS Safari (PWA)
// No-ops gracefully on browsers without Badging API.
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

// ─── Background message handler — fires when app is closed/backgrounded ──
// Foreground messages are handled in src/lib/notifications.js because the
// FCM SDK splits the two contexts. Both paths should produce the same
// visible notification, so the payload shape is mirrored.
//
// Payload contract from Cloud Functions:
//   notification: { title, body }
//   data: { type, week?, matchId?, url? } — type drives the click target
messaging.onBackgroundMessage(async (payload) => {
  const { title = "MnQ Golf", body = "" } = payload.notification || {};
  const data = payload.data || {};

  // Increment badge before showing — by the time the user sees it the
  // count is already correct.
  const current = await getBadgeCount();
  const next = current + 1;
  await setBadgeCount(next);
  await applyBadge(next);

  return self.registration.showNotification(title, {
    body,
    icon: "/favicon/web-app-manifest-192x192.png",
    badge: "/favicon/web-app-manifest-192x192.png",
    data,
    // tag groups notifications of the same type so only the most recent
    // is shown — e.g. two rain-out notifications from a flaky commish
    // toggle don't pile up.
    tag: data.type || "default",
    // renotify=true makes the device buzz even when a same-tag notification
    // is being replaced. Otherwise the user might miss the update.
    renotify: true,
  });
});

// ─── Click handler — focuses the existing tab or opens a new one ─────────
// Clears the badge count on the assumption that opening the app means
// the user has seen pending notifications. The app can also clear the
// badge via postMessage if there's a more accurate moment to do so.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // Map notification type → in-app URL so taps land on the relevant tab.
  // Falls back to the app root which shows the default tab (Players).
  const urlMap = {
    week_finalized: "/?tab=standings",
    attest_ready: "/?tab=scoring",
    rained_out: "/?tab=schedule",
    attendance_marked: "/?tab=schedule",
  };
  const target = data.url || urlMap[data.type] || "/";

  event.waitUntil((async () => {
    // Try to focus an existing tab first; only open a new one if none exists.
    // Mobile users almost always have exactly one open instance, so this
    // is the right path most of the time.
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

// ─── Postmessage from the page — lets the app actively clear the badge ──
// E.g. when the user opens the Notifications settings or views standings
// after a finalize-week notification. Saves a SW restart vs waiting for
// the next push to recompute.
self.addEventListener("message", async (event) => {
  if (event.data?.type === "CLEAR_BADGE") {
    await setBadgeCount(0);
    await applyBadge(0);
  }
});
