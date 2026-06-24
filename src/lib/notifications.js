// ─────────────────────────────────────────────────────────────────────────
//  src/lib/notifications.js — push notification client helpers
// ─────────────────────────────────────────────────────────────────────────
// Owns the entire client-side push lifecycle:
//   1. Service worker registration
//   2. Permission request flow
//   3. FCM token acquisition
//   4. Token persistence to Firestore (so Cloud Functions can target it)
//   5. Foreground message rendering (FCM doesn't auto-show in foreground)
//   6. Unsubscribe / token revocation
//
// The Cloud Functions side reads from `league_notifications_tokens` keyed
// by playerId, sending the push to every token saved against a player.
// Multi-device support comes for free: each browser (work laptop + phone
// PWA, etc.) gets its own token and is added independently.
//
// Module load policy: firebase/messaging is imported DYNAMICALLY inside
// the functions that use it, NOT at the top of this file. This matters
// because importing firebase/messaging synchronously can fail on iOS
// Safari < 16.4 / non-secure contexts / browsers without Notification
// API — that failure would propagate to the consumer (the route module
// in NotificationsSettings.jsx) and cause the entire page chunk to fail
// to evaluate. Dynamic imports contain the failure to the specific
// function call, so the page always renders even when push is unsupported.

import { db, LEAGUE_ID, getMessagingInstance } from "../firebase";
import { Capacitor } from "@capacitor/core";

// ─── Native push (Capacitor) ─────────────────────────────────────────────
// On native (iOS/Android) the web service-worker + web-push path below does
// not exist (no service workers in a WebView app). We use
// @capacitor-firebase/messaging, which returns a real FCM token on BOTH
// platforms, stored in the SAME league_notifications_tokens collection so
// the Cloud Functions send logic is unchanged — except that native tokens
// carry `native: true`, which the functions use (3c) to attach a
// notification block so the OS displays the alert when backgrounded.
// Dynamic import keeps the plugin out of the web bundle's critical path.
const loadNativeMessaging = async () => {
  const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
  return FirebaseMessaging;
};

// Remember who registered this session so a later FCM token rotation
// (tokenReceived) can be re-persisted against the right player. The token
// is stable for months, so the main path is register-time; this just keeps
// it fresh if it rotates while the app is open.
let _lastRegisteredPlayerId = null;

// Persist a native FCM token in the same shape as the web path, plus
// native:true + platform so the admin view and Cloud Functions can tell
// native devices apart.
const storeNativeToken = async (playerId, token) => {
  const tokenHash = await sha256Short(token);
  const docId = `${LEAGUE_ID}_p${playerId}_${tokenHash}`;
  const platform = Capacitor.getPlatform(); // "ios" | "android"
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  await db.upsert("league_notifications_tokens", {
    id: docId,
    league_id: LEAGUE_ID,
    playerId,
    token,
    userAgent: ua.slice(0, 200),
    isIOS: platform === "ios",
    isStandalone: true, // a native app is always "standalone"
    native: true,
    platform,
    registeredAt: Date.now(),
    lastSeenAt: Date.now(),
  });
};

// Native registration: request permission via the plugin, get the FCM
// token, persist it. Returns the same { success, state, error } shape the
// settings page already handles.
const registerForPushNative = async (playerId) => {
  try {
    const FirebaseMessaging = await loadNativeMessaging();
    const perm = await FirebaseMessaging.requestPermissions();
    if (perm?.receive !== "granted") {
      // "denied" | "prompt" | "prompt-with-rationale"
      return { success: false, state: perm?.receive === "denied" ? "denied" : "default" };
    }
    const { token } = await FirebaseMessaging.getToken();
    if (!token) return { success: false, state: "no_token" };
    await storeNativeToken(playerId, token);
    _lastRegisteredPlayerId = playerId;
    return { success: true, state: "granted", token };
  } catch (e) {
    console.error("native registerForPush failed:", e);
    return { success: false, state: "error", error: e?.message || String(e) };
  }
};

// ─── VAPID public key ───────────────────────────────────────────────────
// Generated in Firebase Console: Project Settings → Cloud Messaging →
// Web configuration → "Web Push certificates" → Generate key pair.
// The PUBLIC key goes here (safe to commit). The PRIVATE key stays in
// Cloud Functions and is never exposed to the browser.
//
// REPLACE this placeholder with the public key from Firebase Console
// before deploying. The app will work without it (in-app state is sane)
// but no push notifications will ever fire until this is filled in.
const VAPID_PUBLIC_KEY = "BPHCLmvYDg5QBwHFnMVIn5aLeQHY2BTk2UHtihRVeA114PdrUEMBiBuB7UF81vJ4Fvc-cKvJUjccJSEVv8JWVKw";

// ─── Permission state ───────────────────────────────────────────────────
// Returns one of:
//   "unsupported" — browser lacks Notification API or SW or Push API
//   "default"     — never asked
//   "granted"     — user said yes
//   "denied"      — user said no (can't re-prompt; must direct to settings)
export const getNotificationPermissionState = () => {
  // Native: push IS supported, but the real permission is async (the plugin
  // must be queried). This sync function can't await, so return "default"
  // — that drives the settings page to show the "Enable" button, and the
  // actual prompt happens when registerForPush() runs. The subscribed state
  // (whether a token exists) is the real source of truth and comes from
  // checkSubscriptionStatus(), which works natively unchanged. Never return
  // "unsupported" here on native — that would wrongly show the browser
  // "not supported" copy and the iOS install nudge inside a real app.
  if (Capacitor.isNativePlatform()) return "default";
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return "unsupported";
  }
  return Notification.permission; // "default" | "granted" | "denied"
};

// ─── Service worker registration ───────────────────────────────────────
// Idempotent: registers once and caches the registration for token requests.
// Registration is at /firebase-messaging-sw.js (Vite serves /public/ at root).
// scope: "/" so the SW controls the whole app.
//
// Returns the registration, or an object { error: string } on failure so
// the caller can surface a meaningful error message. Most common failure
// is a 404 (the SW file wasn't deployed — likely the public/firebase-
// messaging-sw.js wasn't copied into the local repo's public/ folder).
let _swRegistration = null;
const registerServiceWorker = async () => {
  if (_swRegistration) return _swRegistration;
  if (!("serviceWorker" in navigator)) {
    return { error: "Service Worker not supported by this browser" };
  }
  try {
    _swRegistration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js",
      { scope: "/" }
    );
    return _swRegistration;
  } catch (e) {
    // Capture both common failures: SecurityError (HTTPS missing),
    // TypeError (file not found or wrong MIME), bad scope, etc.
    const detail = e?.message || String(e);
    console.error("Service worker registration failed:", detail, e);
    return { error: detail };
  }
};

// ─── Main entry point: register for push notifications ─────────────────
// Returns { success: boolean, state: string, error?: string }
// state is one of: "granted", "denied", "unsupported", "no_token", "error"
//
// Call this from the Notifications settings page when the user taps "Enable."
// Triggered by user gesture so iOS Safari shows the permission prompt
// (it suppresses requestPermission() calls that aren't user-initiated).
export const registerForPush = async (playerId) => {
  if (!playerId) {
    return { success: false, state: "error", error: "missing playerId" };
  }
  // Native uses the Capacitor FCM plugin; the web service-worker flow below
  // can't run in a WebView app.
  if (Capacitor.isNativePlatform()) {
    return registerForPushNative(playerId);
  }
  if (getNotificationPermissionState() === "unsupported") {
    return { success: false, state: "unsupported" };
  }

  // Ask permission. If already granted, this is a no-op that returns "granted".
  // If denied, the browser refuses to re-prompt — user must go to browser
  // settings to undo. We surface that state distinctly so the UI can show
  // "you've blocked notifications, here's how to unblock."
  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch (e) {
    return { success: false, state: "error", error: e.message };
  }
  if (permission !== "granted") {
    return { success: false, state: permission };
  }

  // Register SW (or get cached registration) and check FCM support
  const reg = await registerServiceWorker();
  if (!reg || reg.error) {
    return {
      success: false,
      state: "error",
      error: reg?.error ? `Service worker: ${reg.error}` : "sw_registration_failed",
    };
  }

  const messaging = await getMessagingInstance();
  if (!messaging) return { success: false, state: "unsupported" };

  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.startsWith("REPLACE")) {
    console.warn("VAPID public key not configured — push won't fire");
    return { success: false, state: "error", error: "vapid_key_missing" };
  }

  // Acquire FCM token. This call:
  //   1. Subscribes the SW to the FCM push endpoint
  //   2. Returns a token uniquely identifying this browser instance
  //   3. Stable across SW restarts; rotates infrequently (months)
  let token;
  try {
    const { getToken } = await import("firebase/messaging");
    token = await getToken(messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: reg,
    });
  } catch (e) {
    console.error("FCM getToken failed:", e);
    return { success: false, state: "error", error: e.message };
  }
  if (!token) return { success: false, state: "no_token" };

  // Persist token to Firestore so Cloud Functions can target this device.
  // Doc id encodes (player, token-hash) so a player with multiple devices
  // gets multiple docs; revoking one doesn't affect the others.
  // Hash because raw FCM tokens are ~160 chars — too long for a clean doc id.
  const tokenHash = await sha256Short(token);
  const docId = `${LEAGUE_ID}_p${playerId}_${tokenHash}`;
  // Capture device context at registration time so the commissioner's
  // notifications admin view can distinguish iOS PWA from desktop from
  // Android, and spot iOS users who somehow registered without the
  // standalone install (which is required for push to actually work on
  // iOS). Both flags are point-in-time snapshots — if the user later
  // uninstalls the PWA we have no way to detect, but that's a rare
  // edge case for this league's purposes.
  const ua = navigator.userAgent || "";
  const isIOSDevice = /iPhone|iPad|iPod/.test(ua);
  await db.upsert("league_notifications_tokens", {
    id: docId,
    league_id: LEAGUE_ID,
    playerId,
    token,
    userAgent: ua.slice(0, 200), // helps Aaron debug stale tokens
    isIOS: isIOSDevice,
    isStandalone: isStandalonePWA(),
    registeredAt: Date.now(),
    lastSeenAt: Date.now(),
  });

  return { success: true, state: "granted", token };
};

// ─── Subscription status check ──────────────────────────────────────────
// Returns true if there's at least one active token registered for this
// player. Used by the settings page on mount to show the correct state
// — distinct from browser permission, which stays "granted" forever once
// given and can't tell us whether the user actively unsubscribed.
export const checkSubscriptionStatus = async (playerId) => {
  if (!playerId) return false;
  try {
    const docs = await db.get("league_notifications_tokens", [
      { field: "league_id", op: "==", value: LEAGUE_ID },
      { field: "playerId", op: "==", value: playerId },
    ]);
    return docs.length > 0;
  } catch (e) {
    console.warn("checkSubscriptionStatus failed:", e);
    return false;
  }
};

// ─── Send a test push to ourselves ──────────────────────────────────────
// Calls the sendTestPush Cloud Function (defined in functions/index.js)
// with the current user's playerId so the user can verify their setup
// without going through the Firebase Console. The Cloud Function looks
// up all tokens for the player and fires a push to each — so a user
// with both phone + laptop registered will see the test on both.
//
// Dynamic-imports firebase/functions to avoid bundling the Functions SDK
// (~10KB) into the main app bundle when it's only needed by this one button.
export const triggerTestPush = async (playerId) => {
  if (!playerId) return { success: false, error: "missing playerId" };
  try {
    const [{ getFunctions, httpsCallable }, { getApp }] = await Promise.all([
      import("firebase/functions"),
      import("firebase/app"),
    ]);
    const functions = getFunctions(getApp());
    const fn = httpsCallable(functions, "sendTestPush");
    const result = await fn({
      playerId,
      message: "Test push from MnQ Golf — your setup works!",
    });
    return { success: true, result: result.data };
  } catch (e) {
    console.error("triggerTestPush failed:", e);
    return { success: false, error: e?.message || String(e) };
  }
};

// ─── Unsubscribe ────────────────────────────────────────────────────────
// Two phases: delete the token on the FCM side (stops the push endpoint
// from accepting messages for this device) AND delete the Firestore doc
// (stops Cloud Functions from trying to send). Both are best-effort —
// if one fails, the user is still functionally unsubscribed in the UI.
export const unsubscribeFromPush = async (playerId) => {
  if (Capacitor.isNativePlatform()) {
    // Delete the FCM token at the native layer so the device stops being a
    // valid push target, then fall through to the shared Firestore cleanup.
    try {
      const FirebaseMessaging = await loadNativeMessaging();
      await FirebaseMessaging.deleteToken();
    } catch (e) { console.warn("native deleteToken failed:", e); }
    _lastRegisteredPlayerId = null;
  } else {
    const messaging = await getMessagingInstance();
    if (messaging) {
      try {
        const { deleteToken } = await import("firebase/messaging");
        await deleteToken(messaging);
      } catch (e) { console.warn("deleteToken failed:", e); }
    }
  }
  // Clean up all token docs for this player. Multi-device users get all
  // their devices unsubscribed at once — which is the right behavior since
  // the toggle is a per-user preference, not per-device.
  if (playerId) {
    const docs = await db.get("league_notifications_tokens", [
      { field: "league_id", op: "==", value: LEAGUE_ID },
      { field: "playerId", op: "==", value: playerId },
    ]);
    await Promise.all(docs.map(d => db.deleteDoc("league_notifications_tokens", d.id)));
  }
  return { success: true };
};

// ─── Foreground message handler ────────────────────────────────────────
// FCM splits foreground vs background message delivery: when the app tab
// is open and focused, onMessage fires INSTEAD OF the SW's onBackgroundMessage.
// To keep behavior consistent (push always shows a notification regardless
// of app state) we re-render the notification here using the same payload.
//
// Call this once from App.jsx on mount.
let _foregroundUnsub = null;
export const initForegroundNotifications = async () => {
  if (_foregroundUnsub) return; // idempotent

  // Native: wire the plugin listeners. The OS auto-displays notification-
  // format messages when the app is backgrounded (that's why 3c adds the
  // notification block for native tokens). Here we (a) keep the stored
  // token fresh if FCM rotates it mid-session, and (b) deep-link when the
  // user taps a notification (data.url like "/#standings").
  if (Capacitor.isNativePlatform()) {
    try {
      const FirebaseMessaging = await loadNativeMessaging();
      await FirebaseMessaging.addListener("tokenReceived", async ({ token }) => {
        try {
          if (_lastRegisteredPlayerId && token) {
            await storeNativeToken(_lastRegisteredPlayerId, token);
          }
        } catch (e) { console.warn("native token refresh failed:", e); }
      });
      await FirebaseMessaging.addListener("notificationActionPerformed", (event) => {
        const url = event?.notification?.data?.url;
        if (url && typeof window !== "undefined") {
          // Normalize to a hash route (e.g. "/#standings" → "#standings").
          const hash = url.startsWith("#") ? url : `#${url.replace(/^\/?#?/, "")}`;
          window.location.hash = hash;
        }
      });
      _foregroundUnsub = () => {}; // mark initialized
    } catch (e) {
      console.warn("native notification listeners failed:", e);
    }
    return;
  }

  const messaging = await getMessagingInstance();
  if (!messaging) return;
  const { onMessage } = await import("firebase/messaging");
  _foregroundUnsub = onMessage(messaging, (payload) => {
    const { title = "MnQ Golf", body = "" } = payload.notification || {};
    const data = payload.data || {};
    // Use the SW registration's showNotification (not new Notification(...))
    // because the latter is restricted/inconsistent across browsers.
    if (_swRegistration) {
      _swRegistration.showNotification(title, {
        body,
        icon: "/favicon/web-app-manifest-192x192.png",
        badge: "/favicon/web-app-manifest-192x192.png",
        data,
        tag: data.type || "default",
        renotify: true,
      });
    }
  });
};

// ─── App badge management from page context ───────────────────────────
// Call this when the user opens the app or navigates to a page that
// "consumes" pending notifications. Sends a message to the SW which
// owns the canonical badge state (counts survive SW restart via IDB).
export const clearAppBadge = async () => {
  if (typeof navigator === "undefined") return;
  // Try direct API first — works on the page context too on most browsers
  if (navigator.clearAppBadge) {
    try { await navigator.clearAppBadge(); } catch { /* swallow */ }
  }
  // And tell the SW so its IDB state is reset too
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "CLEAR_BADGE" });
  }
};

// ─── Detect installed PWA ──────────────────────────────────────────────
// iOS specifically: web push only works when launched from the home
// screen, NOT in a regular Safari tab. This helper drives the "install
// to home screen first" onboarding nudge.
export const isStandalonePWA = () => {
  if (typeof window === "undefined") return false;
  // iOS-specific: navigator.standalone is the only reliable signal there.
  // Chrome/Edge/Firefox use the standard display-mode media query.
  return (
    window.navigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
};

// ─── iOS Safari version detection ──────────────────────────────────────
// Push on iOS requires 16.4+. Below that the install-to-home-screen
// onboarding should explain that an OS upgrade is needed.
export const isIOSPushCapable = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  if (!isIOS) return true; // non-iOS users are pre-qualified
  const match = ua.match(/OS (\d+)_(\d+)/);
  if (!match) return false;
  const [major, minor] = [parseInt(match[1], 10), parseInt(match[2], 10)];
  return major > 16 || (major === 16 && minor >= 4);
};

// ─── Helpers ───────────────────────────────────────────────────────────
// Short hash of the FCM token used as part of the doc id. Web Crypto
// SHA-256 is universally available; we take the first 16 hex chars
// (64 bits) which is plenty for collision avoidance at our scale.
const sha256Short = async (input) => {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
};
