import { useState, useEffect } from "react";
import { K, Card } from "../theme";
import {
  registerForPush,
  unsubscribeFromPush,
  getNotificationPermissionState,
  isStandalonePWA,
  isIOSPushCapable,
  checkSubscriptionStatus,
} from "../lib/notifications";

// ─────────────────────────────────────────────────────────────────────────
//  Toggle — simple iOS-style on/off switch
// ─────────────────────────────────────────────────────────────────────────
// Self-contained, inline-styled to match the app. `on` drives the visual
// state; `onChange` fires on tap; `busy` disables interaction mid-request.
function Toggle({ on, busy, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
      disabled={busy}
      style={{
        width: 52,
        height: 30,
        borderRadius: 15,
        border: "none",
        padding: 0,
        background: on ? K.grn : K.bdr,
        position: "relative",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
        transition: "background .2s ease",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 25 : 3,
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "#fff",
          transition: "left .2s ease",
          boxShadow: "0 1px 3px rgba(0,0,0,.3)",
        }}
      />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  NotificationsSettings — More-tab page for managing push notifications
// ─────────────────────────────────────────────────────────────────────────
// Single-purpose surface that owns the entire user-facing permission
// dance. Meaningful flows:
//
//   (1) User on supported browser/native → master toggle (off → enable,
//       on → disable) plus a reference list of the alerts they'll receive.
//   (2) User has denied → explanatory state with troubleshooting hint. No
//       toggle — the browser won't re-prompt after a denial; the user must
//       go to browser settings to undo.
//   (3) Browser doesn't support push → explanatory "not supported" state.
//
// On iOS specifically there's a Phase 0 that fires before any of these:
// if the app isn't running as a standalone PWA (and isn't the native app),
// push doesn't work, so we show "install to home screen first."
export default function NotificationsSettings({ leagueUser, appToast }) {
  const [permission, setPermission] = useState("default");
  // Whether the user has an active token registration in Firestore.
  // Distinct from browser permission state because the user can disable
  // notifications in our app (deleting the token) without revoking the
  // browser permission — and re-enable later without a re-prompt. The
  // UI status reflects subscribed-ness, not permission alone.
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [iosOk, setIosOk] = useState(true);

  useEffect(() => {
    setPermission(getNotificationPermissionState());
    setStandalone(isStandalonePWA());
    setIosOk(isIOSPushCapable());
    // Check Firestore for an existing token — covers the case where
    // the user previously enabled notifications on this device, killed
    // the app, and reopened it. We want the UI to show "On" instead
    // of asking them to re-enable when they've already done so.
    if (leagueUser?.playerId) {
      checkSubscriptionStatus(leagueUser.playerId).then(setSubscribed);
    }
  }, [leagueUser?.playerId]);

  const handleEnable = async () => {
    if (!leagueUser?.playerId) {
      appToast?.("You need to be linked to a player to enable notifications", "error");
      return;
    }
    setBusy(true);
    const result = await registerForPush(leagueUser.playerId);
    setBusy(false);
    setPermission(getNotificationPermissionState());
    if (result.success) {
      setSubscribed(true);
      appToast?.("Notifications enabled", "success");
    } else if (result.state === "denied" || result.state === "unsupported") {
      // Both are expected outcomes that the status card on this page
      // already explains clearly. Skipping the toast avoids the big
      // red error banner for what's really just an informational state.
      // The card text below the toggle does the explaining.
    } else {
      // Truly unexpected failure (VAPID key missing, SW registration
      // failed, FCM token fetch errored). These need debugging attention,
      // so the error toast IS appropriate here.
      appToast?.(`Couldn't enable: ${result.error || result.state}`, "error");
    }
  };

  const handleDisable = async () => {
    if (!leagueUser?.playerId) return;
    setBusy(true);
    await unsubscribeFromPush(leagueUser.playerId);
    setBusy(false);
    setSubscribed(false);
    setPermission(getNotificationPermissionState());
    appToast?.("Notifications disabled", "success");
  };

  // Tapping the toggle: if currently on, disable; if off, enable.
  const handleToggle = () => {
    if (busy) return;
    if (subscribed) handleDisable();
    else handleEnable();
  };

  // Notification types the user will receive. Titles only — they're
  // descriptive enough; sub-text was noise on a settings list that's
  // really a quick reference.
  const TYPES = [
    { icon: "🏆", title: "Weekly results finalized" },
    { icon: "✍️", title: "Time to attest your scorecard" },
    { icon: "🌧️", title: "Week rained out" },
    { icon: "👋", title: "Player marked out in your match" },
  ];

  // ──────────────────────────────────────────────────────────────────────
  //  State 0: iOS user not on PWA — push won't work, show install prompt
  // ──────────────────────────────────────────────────────────────────────
  // Detection is best-effort. On iOS Safari tabs, navigator.standalone is
  // false; the user must "Add to Home Screen" then open from there. If
  // they're on iOS 16.3 or earlier, push isn't available at all regardless
  // of installation status — surface that separately.
  if (!iosOk) {
    return (
      <div>
        <Card style={{ padding: "16px 18px", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: K.t1, marginBottom: 6 }}>
            iOS update required
          </div>
          <div style={{ fontSize: 12, color: K.t2, lineHeight: 1.5 }}>
            Push notifications require iOS 16.4 or later. Update your device in Settings → General → Software Update to enable them.
          </div>
        </Card>
      </div>
    );
  }

  // Detect if we should show the iOS "install to home screen" nudge.
  // Only relevant when (a) we appear to be on iOS Safari, (b) not running
  // as standalone PWA, and (c) the permission state is "unsupported"
  // (iOS Safari surfaces no Notification API in a regular tab).
  const isLikelyIOSSafari = /iPhone|iPad|iPod/.test(navigator.userAgent || "");
  const needsInstall = isLikelyIOSSafari && !standalone && permission === "unsupported";

  if (needsInstall) {
    return (
      <div>
        <Card style={{ padding: "16px 18px", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: K.t1, marginBottom: 6 }}>
            Install to home screen first
          </div>
          <div style={{ fontSize: 12, color: K.t2, lineHeight: 1.5, marginBottom: 12 }}>
            On iPhone, push notifications only work when the app is installed to your home screen. Here's how:
          </div>
          <ol style={{ fontSize: 12, color: K.t2, lineHeight: 1.6, paddingLeft: 20, margin: 0 }}>
            <li>Tap the <strong style={{ color: K.t1 }}>Share</strong> button at the bottom of Safari.</li>
            <li>Scroll down and tap <strong style={{ color: K.t1 }}>Add to Home Screen</strong>.</li>
            <li>Open the app from your home screen (not from Safari).</li>
            <li>Return to this Notifications page and turn the switch on.</li>
          </ol>
        </Card>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Main flow
  // ──────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Status card — adapts to current state. Note this reads
          `subscribed`, not `permission` — they can diverge if the user
          disables in our app without revoking browser permission. */}
      <Card style={{ padding: "14px 18px", marginBottom: 12 }}>
        {permission === "denied" ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: K.warn, marginBottom: 4 }}>
              Blocked
            </div>
            <div style={{ fontSize: 12, color: K.t2, lineHeight: 1.5 }}>
              You blocked notifications previously. To re-enable, go to your device or browser settings, find this app, and allow notifications — then return to this page.
            </div>
          </>
        ) : permission === "unsupported" ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: K.t1, marginBottom: 4 }}>
              Not supported
            </div>
            <div style={{ fontSize: 12, color: K.t2, lineHeight: 1.5 }}>
              This browser doesn't support push notifications. Try Chrome, Safari (iOS 16.4+ installed to home screen), or Edge.
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: subscribed ? K.grn : K.t1 }}>
                {subscribed ? "Notifications on" : "Notifications off"}
              </div>
              <div style={{ fontSize: 12, color: K.t2, lineHeight: 1.5, marginTop: 2 }}>
                {subscribed
                  ? "You'll get push notifications for the events below."
                  : "Turn on to get push notifications for the events below."}
              </div>
            </div>
            <Toggle on={subscribed} busy={busy} onChange={handleToggle} />
          </div>
        )}
      </Card>

      {/* List of notification types — titles only, icons for rhythm */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {TYPES.map((t, i) => (
          <Card key={i} style={{ padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{t.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: K.t1 }}>{t.title}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Per-device note — important for users who use the app on multiple
          devices (phone + work laptop, etc.). Each device gets its own
          token; enabling on one doesn't enable on the other. */}
      <div style={{ fontSize: 10, color: K.t3, lineHeight: 1.5, marginTop: 12, padding: "0 4px" }}>
        Notifications are device-specific. If you want them on both your phone and laptop, turn them on separately on each.
      </div>
    </div>
  );
}
