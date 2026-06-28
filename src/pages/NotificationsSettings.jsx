import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { K, FS, FW, Card } from "../theme";
import {
  linkGoogleAccount,
  linkAppleAccount,
  getLinkedProviders,
  NATIVE_APPLE_ENABLED,
} from "../firebase";
import {
  registerForPush,
  unsubscribeFromPush,
  getNotificationPermissionState,
  isStandalonePWA,
  isIOSPushCapable,
  checkSubscriptionStatus,
} from "../lib/notifications";

// ─────────────────────────────────────────────────────────────────────────
//  Brand marks — compliant logos for the sign-in-method rows
// ─────────────────────────────────────────────────────────────────────────
// Google: the official four-color "G". Apple: the standard monochrome mark.
// Kept as inline SVGs (no network fetch, theme-independent) so the rows match
// each provider's brand guidance — Google's multicolor G, Apple's solid logo.
function GoogleMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#34A853" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#FBBC05" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
function AppleMark({ size = 18, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={color}>
      <path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.02-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.9-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.88 2.65 3.22 2.6 1.29-.05 1.78-.83 3.34-.83 1.56 0 2 .83 3.37.81 1.39-.03 2.27-1.27 3.12-2.53.98-1.45 1.39-2.85 1.41-2.92-.03-.01-2.71-1.04-2.74-4.12zM14.6 4.38c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.26.68-2.99 1.54-.66.76-1.23 1.97-1.08 3.14 1.14.09 2.3-.58 3.01-1.43z" />
    </svg>
  );
}

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

  // Sign-in-method linking state. `linked` mirrors auth.currentUser's
  // providerData; `linkBusy` tracks which provider's link request is in
  // flight so only that row shows a spinner / disables.
  const [linked, setLinked] = useState({ google: false, apple: false });
  const [linkBusy, setLinkBusy] = useState(null); // "google" | "apple" | null

  useEffect(() => {
    setPermission(getNotificationPermissionState());
    setStandalone(isStandalonePWA());
    setIosOk(isIOSPushCapable());
    // Refresh linked-provider state when the page opens.
    setLinked(getLinkedProviders());
    // Check Firestore for an existing token — covers the case where
    // the user previously enabled notifications on this device, killed
    // the app, and reopened it. We want the UI to show "On" instead
    // of asking them to re-enable when they've already done so.
    if (leagueUser?.playerId) {
      checkSubscriptionStatus(leagueUser.playerId).then(setSubscribed);
    }
  }, [leagueUser?.playerId]);

  // Link a second provider to the current Firebase user. On success both
  // sign-in methods resolve to one uid → one league_members doc → one team.
  // The thrown errors are already mapped to readable strings in firebase.js.
  const handleLink = async (provider) => {
    if (linkBusy) return;
    setLinkBusy(provider);
    try {
      if (provider === "google") await linkGoogleAccount();
      else await linkAppleAccount();
      setLinked(getLinkedProviders());
      appToast?.(`${provider === "google" ? "Google" : "Apple"} linked`, "success");
    } catch (e) {
      // Treat user-cancelled popups as a silent no-op (no red banner for an
      // intentional dismissal); surface everything else.
      const cancelled =
        e?.code === "auth/popup-closed-by-user" ||
        e?.code === "auth/cancelled-popup-request" ||
        e?.code === "auth/user-cancelled";
      if (!cancelled) appToast?.(e?.message || "Could not link that sign-in method.", "error");
    } finally {
      setLinkBusy(null);
    }
  };

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
  //  Sign-in methods — link Google + Apple to one account (one team)
  // ──────────────────────────────────────────────────────────────────────
  // Rendered in every state (push capability is irrelevant to linking), so
  // it's defined once here and dropped into each return branch below. Each
  // row shows the provider's compliant logo + name, and either a "Linked"
  // badge or a "Link" button that attaches that provider to the current uid.
  const ProviderRow = ({ id, name, mark }) => {
    const isLinked = linked[id];
    const rowBusy = linkBusy === id;
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "4px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ display: "flex", flexShrink: 0 }}>{mark}</span>
          <span style={{ fontSize: FS.base, fontWeight: FW.semibold, color: K.t1 }}>{name}</span>
        </div>
        {isLinked ? (
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: FS.sm, fontWeight: FW.bold, color: K.grn, flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={K.grn} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
            Linked
          </span>
        ) : (
          <button
            type="button"
            onClick={() => handleLink(id)}
            disabled={!!linkBusy}
            style={{
              flexShrink: 0,
              padding: "7px 16px",
              borderRadius: 8,
              border: "none",
              cursor: linkBusy ? "default" : "pointer",
              background: K.act,
              color: K.bg,
              fontSize: FS.sm,
              fontWeight: FW.bold,
              opacity: linkBusy && !rowBusy ? 0.5 : rowBusy ? 0.7 : 1,
            }}
          >
            {rowBusy ? "Linking…" : "Link"}
          </button>
        )}
      </div>
    );
  };

  // Apple row visibility: always on web/PWA (popup link works); on native
  // only when native Apple is enabled, OR when it's already linked (a state
  // that can only display "Linked" and never triggers the throwing path).
  const showAppleRow =
    !Capacitor.isNativePlatform() || NATIVE_APPLE_ENABLED || linked.apple;

  const signInMethods = (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: FS.xs, fontWeight: FW.bold, color: K.t3, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 4px 8px" }}>
        Sign-in methods
      </div>
      <Card style={{ padding: "12px 15px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ProviderRow id="google" name="Google" mark={<GoogleMark size={18} />} />
          {/* Apple row is hidden on native until native Apple is enabled
              (see NATIVE_APPLE_ENABLED in firebase.js) so the in-review /
              shipped native binary never shows a Link button that would throw
              on tap. Still shown if Apple is somehow already linked — that
              state is informational only and can't error. Web/PWA always
              shows it (linkWithPopup works there). */}
          {showAppleRow && (
            <>
              <div style={{ borderTop: `1px solid ${K.bdr}` }} />
              <ProviderRow id="apple" name="Apple" mark={<AppleMark size={18} color={K.t1} />} />
            </>
          )}
        </div>
      </Card>
      <div style={{ fontSize: 10, color: K.t3, lineHeight: 1.5, marginTop: 8, padding: "0 4px" }}>
        Link both so Google and Apple sign you into the same account and team. Apple's "Hide My Email" means this can't happen automatically — it has to be done here while you're signed in.
      </div>
    </div>
  );

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
        {signInMethods}
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
        {signInMethods}
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

      {signInMethods}
    </div>
  );
}
