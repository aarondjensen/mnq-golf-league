// ─────────────────────────────────────────────────────────────────────────
//  firebase-messaging-sw.js — MnQ Golf push notification service worker
// ─────────────────────────────────────────────────────────────────────────
// Lives in /public/firebase-messaging-sw.js so Vite serves it at the root.
//
// Message-format contract with the Cloud Function side:
//   - DATA-ONLY messages (no FCM `notification` block)
//   - Title/body live in payload.data.title / payload.data.body
//   - data.type is the trigger kind: attest_ready, week_finalized,
//     rained_out, attendance_marked, test
//
// Badge model: "pending actions" semantics, not "unread notifications".
// Only attest_ready pushes increment the badge (those represent something
// the user needs to do). The other types are informational and don't add
// to the badge. The badge clears when the user completes the action
// (handled app-side via setAppBadge driven by app state), NOT when they
// tap the notification or open the app.

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
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ─── Badge state — IDB-backed for SW restart survival ──
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
// Reads title/body from data block. Only increments the badge for the
// attest_ready type since that's the only "you need to do something"
// notification — the other types are informational and the user shouldn't
// see a persistent red dot for them.
messaging.onBackgroundMessage(async (payload) => {
  console.log("[SW] onBackgroundMessage fired", payload);
  try {
    const data = payload.data || {};
    const title = data.title || payload.notification?.title || "MnQ Golf";
    const body = data.body || payload.notification?.body || "";

    // Badge increment is type-gated. Only attest_ready represents a
    // pending action — the rest are informational and don't change badge.
    // The app's useEffect will reconcile this count to the accurate
    // pending-attestation count when the user next opens the app, so
    // overcount from this SW-side increment self-corrects.
    if (data.type === "attest_ready") {
      try {
        const current = await getBadgeCount();
        const next = current + 1;
        await setBadgeCount(next);
        await applyBadge(next);
      } catch (e) {
        console.warn("[SW] Badge update failed", e);
      }
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
    try {
      return self.registration.showNotification("MnQ Golf", {
        body: "A new update — open the app for details.",
      });
    } catch { /* truly hopeless */ }
  }
});

// ─── Click handler ──────────────────────────────────────────────────────
// IMPORTANT: does NOT clear the badge anymore. Under the "pending actions"
// model, the badge clears only when the user completes the underlying
// action (taps Attest on a scorecard). The app handles that via its
// setAppBadge useEffect — when pendingAttestCount goes to 0, it clears.
// Tapping the notification just navigates; doesn't dismiss the obligation.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // URL map uses hash routing to match App.jsx's getTabFromHash logic —
  // the app reads window.location.hash, not query params, so /?tab=X
  // (the previous URL scheme) was silently ignored and the user always
  // landed on the default tab.
  const urlMap = {
    week_finalized: "/#standings",
    attest_ready: "/#scoring",
    rained_out: "/#schedule",
    attendance_marked: "/#schedule",
  };
  const target = data.url || urlMap[data.type] || "/";

  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({
      type: "window", includeUncontrolled: true,
    });
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

// ─── Page → SW messages ─────────────────────────────────────────────────
// CLEAR_BADGE: zero out the badge unconditionally (used for explicit
//   "user dismissed everything" flows, e.g., legacy callers).
// SET_BADGE: sync the SW's IDB count + applied badge to the value the
//   app says is canonical. Called by App.jsx whenever its pendingAttest
//   count changes, keeping the SW's "current count" in sync so subsequent
//   pushes increment from the correct starting point.
self.addEventListener("message", async (event) => {
  if (event.data?.type === "CLEAR_BADGE") {
    await setBadgeCount(0);
    await applyBadge(0);
  }
  if (event.data?.type === "SET_BADGE") {
    const count = Math.max(0, parseInt(event.data.count, 10) || 0);
    await setBadgeCount(count);
    await applyBadge(count);
  }
});
