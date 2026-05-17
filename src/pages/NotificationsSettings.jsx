import { useState, useEffect } from "react";
import { K, Card, SubLabel } from "../theme";
import {
  registerForPush,
  unsubscribeFromPush,
  getNotificationPermissionState,
  isStandalonePWA,
  isIOSPushCapable,
} from "../lib/notifications";

// ─────────────────────────────────────────────────────────────────────────
//  NotificationsSettings — More-tab page for managing push notifications
// ─────────────────────────────────────────────────────────────────────────
// Single-purpose surface that owns the entire user-facing permission
// dance. Three meaningful flows:
//
//   (1) User on supported browser, never asked → big Enable button.
//   (2) User has granted → confirmation + list of notification types
//       they'll receive + a Disable button.
//   (3) User has denied (or browser doesn't support) → explanatory
//       state with troubleshooting hint. NO Enable button — the
//       browser won't re-prompt after a denial; user must go to
//       browser settings to undo.
//
// On iOS specifically there's a Phase 0 that fires before any of these:
// if the app isn't running as a standalone PWA, push doesn't work at all,
// so we show "install to home screen first" with brief steps.
export default function NotificationsSettings({ leagueUser, appToast }) {
  const [permission, setPermission] = useState("default");
  const [busy, setBusy] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [iosOk, setIosOk] = useState(true);

  useEffect(() => {
    setPermission(getNotificationPermissionState());
    setStandalone(isStandalonePWA());
    setIosOk(isIOSPushCapable());
  }, []);

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
      appToast?.("Notifications enabled", "success");
    } else if (result.state === "denied" || result.state === "unsupported") {
      // Both are expected outcomes that the status card on this page
      // already explains clearly. Skipping the toast avoids the big
      // red error banner for what's really just an informational state.
      // The card text below the button does the explaining.
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
    setPermission(getNotificationPermissionState());
    appToast?.("Notifications disabled", "success");
  };

  // Notification types the user will receive. Pulled into a const so it's
  // easy to add/remove as we ship more triggers without touching the JSX.
  // Phase 1 ships infrastructure only; Phase 2 wires these triggers up.
  const TYPES = [
    {
      icon: "🏆",
      title: "Weekly results finalized",
      body: "When the commissioner closes out the week, you'll see the recap.",
    },
    {
      icon: "✍️",
      title: "Time to attest your scorecard",
      body: "After all scores are in, you'll be reminded to sign off on your match.",
    },
    {
      icon: "🌧️",
      title: "Week rained out",
      body: "If the commissioner calls off league night, you'll know right away.",
    },
    {
      icon: "👋",
      title: "Player marked out in your match",
      body: "When someone in your match marks themselves Absent or Making Up.",
    },
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
            <li>Return to this Notifications page and tap Enable.</li>
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
      {/* Status card — adapts copy + button to current permission state */}
      <Card style={{ padding: "16px 18px", marginBottom: 12 }}>
        {permission === "granted" ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: K.grn, marginBottom: 4 }}>
              ✓ Enabled
            </div>
            <div style={{ fontSize: 12, color: K.t2, lineHeight: 1.5, marginBottom: 14 }}>
              You'll get push notifications for the events below.
            </div>
            <button
              onClick={handleDisable}
              disabled={busy}
              style={{
                width: "100%", padding: "10px", borderRadius: 8,
                background: "transparent", border: `1px solid ${K.bdr}`,
                color: K.t2, fontSize: 13, fontWeight: 700,
                cursor: busy ? "default" : "pointer", opacity: busy ? .5 : 1,
              }}
            >
              {busy ? "..." : "Disable notifications"}
            </button>
          </>
        ) : permission === "denied" ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: K.warn, marginBottom: 4 }}>
              Blocked
            </div>
            <div style={{ fontSize: 12, color: K.t2, lineHeight: 1.5 }}>
              You blocked notifications previously. To re-enable, go to your browser settings, find this site, and allow notifications — then refresh this page.
            </div>
          </>
        ) : permission === "unsupported" ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: K.t1, marginBottom: 4 }}>
              Not supported
            </div>
            <div style={{ fontSize: 12, color: K.t2, lineHeight: 1.5 }}>
              Your browser doesn't support push notifications. Try Chrome, Safari (iOS 16.4+ installed to home screen), or Edge.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: K.t1, marginBottom: 4 }}>
              Stay in the loop
            </div>
            <div style={{ fontSize: 12, color: K.t2, lineHeight: 1.5, marginBottom: 14 }}>
              Get notified when league nights are rained out, when results are finalized, and when it's time to attest your scorecard.
            </div>
            <button
              onClick={handleEnable}
              disabled={busy}
              style={{
                width: "100%", padding: "11px", borderRadius: 8,
                background: K.act, border: "none",
                color: K.bg, fontSize: 14, fontWeight: 800,
                letterSpacing: .5, cursor: busy ? "default" : "pointer",
                opacity: busy ? .5 : 1,
              }}
            >
              {busy ? "..." : "Enable notifications"}
            </button>
          </>
        )}
      </Card>

      {/* What you'll get — explanatory list of trigger types */}
      <SubLabel>What you'll get</SubLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {TYPES.map((t, i) => (
          <Card key={i} style={{ padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{t.icon}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: K.t1, marginBottom: 2 }}>{t.title}</div>
                <div style={{ fontSize: 11, color: K.t2, lineHeight: 1.4 }}>{t.body}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Per-device note — important for users who use the app on multiple
          devices (phone + work laptop, etc.). Each device gets its own
          token; enabling on one doesn't enable on the other. */}
      <div style={{ fontSize: 10, color: K.t3, lineHeight: 1.5, marginTop: 12, padding: "0 4px" }}>
        Notifications are device-specific. If you want them on both your phone and laptop, enable them separately on each.
      </div>
    </div>
  );
}
