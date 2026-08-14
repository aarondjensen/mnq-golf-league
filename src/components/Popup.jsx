// ══════════════════════════════════════════════════════════════════
//  Popup + ConfirmModal — shared modal chrome for every popup in
//  the app. Replaces 8 bespoke inline implementations that had
//  drifted across three backdrop opacities, five z-index ranges,
//  and four padding values.
//
//  Public exports
//  ──────────────
//    • Popup           — base wrapper: backdrop, centering, frame,
//                        ESC close, optional ✕, scroll lock. Owns
//                        everything outside the inner content.
//    • ConfirmModal    — wraps Popup with the canonical confirm UI
//                        (title + message + Cancel / Confirm buttons).
//                        Two API styles supported: legacy Admin pattern
//                        (modal={state}) and inline props.
//
//  Canonical z-index ladder
//  ────────────────────────
//    • content   →  500  (Edit Scores, Full Scorecard, CTP, Player Picker)
//    • modal     →  900  (confirm-on-top-of-content)
//    • Toasts and overlay banners live at 1000+ and stack above modals.
//  Pass a number to override, or one of the strings "content" / "modal".
//
//  Migration cheat-sheet
//  ─────────────────────
//  Before:
//    <div onClick={onClose} style={{ position: "fixed", inset: 0,
//      background: "rgba(0,0,0,.6)", zIndex: 500 }} />
//    <div style={{ position: "fixed", inset: 0, zIndex: 550, display:
//      "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
//      <div onClick={e => e.stopPropagation()} style={{ background: K.bg,
//        border: `1px solid ${K.bdr}`, borderRadius: 14, padding: 20,
//        width: "100%", maxWidth: 360 }}>
//        {/* contents */}
//      </div>
//    </div>
//  After:
//    <Popup onClose={onClose} maxWidth={360}>
//      {/* contents */}
//    </Popup>
//
//  Notes
//  ─────
//  • The body scroll lock uses the same `data-popup` attribute the
//    existing code relies on for pull-to-refresh suppression, so no
//    behavior change there.
//  • Stop-propagation on the inner card is automatic — children can
//    click freely without closing the popup.
//  • The Finalize popup in Scoring.jsx intentionally does NOT use this
//    component. Its confetti layer between backdrop and content + its
//    result-color border are part of the celebration moment design.
// ══════════════════════════════════════════════════════════════════

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { K, FS, FW } from "../theme";

const Z_MAP = { content: 500, modal: 900 };
const STD_BACKDROP = "rgba(0, 0, 0, 0.65)";

export function Popup({
  onClose,
  maxWidth = 420,
  zIndex = "content",
  showClose = false,
  noBackdropClose = false,
  noEscClose = false,
  padding = 16,
  outerPadding = 16,
  innerStyle,
  children,
}) {
  const z = typeof zIndex === "number" ? zIndex : (Z_MAP[zIndex] || 500);

  // ESC key closes the popup unless explicitly disabled. Only registers
  // when onClose is provided — keeps the listener footprint minimal.
  //
  // `noBackdropClose` implies it. A modal that refuses a stray click outside
  // itself is a blocking or destructive one, and every reason it refuses the
  // click applies to a stray keypress. Both flags stay because the reverse is
  // not true: a popup can want ESC off while still dismissing on the backdrop.
  // All three apps share this rule.
  const escCloses = !noEscClose && !noBackdropClose;
  useEffect(() => {
    if (!onClose || !escCloses) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, escCloses]);

  const handleBackdrop = () => {
    if (!noBackdropClose && onClose) onClose();
  };

  const overlay = (
    <div
      onClick={handleBackdrop}
      data-popup
      // .popup-root carries the app's typography. The portal below moves this
      // subtree out of .app-shell, so without the class it would inherit the
      // browser's default font, size, spacing and casing instead of the app's.
      className="popup-root"
      style={{
        position: "fixed",
        inset: 0,
        background: STD_BACKDROP,
        zIndex: z,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Safe-area insets keep the card clear of the notch and the home
        // indicator on iOS, where the webview viewport spans the whole screen.
        padding: outerPadding,
        paddingTop: `calc(${outerPadding}px + env(safe-area-inset-top, 0px))`,
        paddingBottom: `calc(${outerPadding}px + env(safe-area-inset-bottom, 0px))`,
        overscrollBehavior: "contain",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: K.bg,
          border: `1px solid ${K.bdr}`,
          borderRadius: 14,
          width: "100%",
          maxWidth,
          // The card is the height-capped frame; the SCROLLER is inside it.
          // That's what keeps the ✕ reachable — see below.
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.4)",
          ...innerStyle,
        }}
      >
        {showClose && onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              width: 32,
              height: 32,
              borderRadius: 8,
              background: K.bg,
              border: "none",
              color: K.t3,
              fontSize: FS.lg,
              fontWeight: FW.semibold,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              // Above the scroller, which is its own stacking context — see below.
              zIndex: 2,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        )}
        {/* Scrolling happens HERE, not on the card. When the card itself was
            the scroller, the absolutely-positioned ✕ scrolled away with the
            content — on a tall popup (the individual leaderboard) it left no
            way to close at all. Now the ✕ is pinned to a non-scrolling frame
            and the content moves underneath it.

            position:relative + zIndex:0 makes the scroller its own stacking
            context, which is what keeps the ✕ VISIBLE as well as present. The
            individual tournament board sticks its title + column headers at
            zIndex 3 over an opaque background; as a plain sibling of the ✕
            (zIndex 2) that header simply painted over the button, hiding it
            entirely. Isolating the scroller caps every z-index inside the
            content — sticky headers, dropdown menus, whatever a future popup
            puts in here — below the close affordance, so no child can bury it. */}
        <div style={{ padding, overflowY: "auto", overscrollBehavior: "contain", flex: 1, minHeight: 0, position: "relative", zIndex: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );

  // Portalled to <body> rather than rendered in place. Every popup is a
  // descendant of .app-body, which scrolls inside a fixed, overflow-hidden
  // .app-shell — and WebKit clips fixed-position descendants of a clipping
  // ancestor, so the overlay was being cropped to the body region instead of
  // covering the viewport. Short popups never revealed it (they fit inside the
  // cropped area); the full-height leaderboard did, appearing tucked behind
  // the header and the bottom nav with its close button off-screen. A portal
  // takes the overlay out of that subtree entirely, so it covers the app
  // chrome and its z-index competes at the document root.
  return typeof document !== "undefined"
    ? createPortal(overlay, document.body)
    : overlay;
}

// ──────────────────────────────────────────────────────────────────
//  ConfirmModal — the canonical title / message / Cancel / Confirm
//  modal. Z-index defaults to "modal" so a confirm raised from inside
//  another popup naturally stacks on top.
//
//  Two API styles, both supported:
//
//    Legacy (Admin pattern):
//      <ConfirmModal modal={confirmModal} />
//      where confirmModal is { title, message, onConfirm, onCancel,
//      confirmLabel, cancelLabel, destructive, eyebrow } or null.
//
//    Inline props (Scoring pattern, slightly cleaner):
//      <ConfirmModal title="..." message="..." onConfirm={..}
//        onCancel={..} variant="danger" />
//
//  Renders nothing when neither title nor message is present (or
//  when `modal` is explicitly null) — matches the Admin gate exactly.
//
//  destructive=true and variant="danger" both render a red confirm
//  button — keep both for backward compatibility.
// ──────────────────────────────────────────────────────────────────
export function ConfirmModal(props) {
  // Pick the data source: prefer explicit `modal` prop if provided
  // (even when null — that's the legacy nullable-state pattern), fall
  // back to inline props otherwise.
  const m = "modal" in props ? props.modal : props;
  if (!m) return null;
  if (!m.title && !m.message) return null;

  const isDanger = m.destructive === true || m.variant === "danger";
  const confirmBg = isDanger ? K.red : K.act;
  const confirmFg = isDanger ? "#fff" : K.bg;
  const handleCancel = m.onCancel || (() => {});

  return (
    <Popup
      onClose={handleCancel}
      maxWidth={340}
      zIndex="modal"
      padding={20}
    >
      {m.eyebrow && (
        <div style={{
          fontSize: FS.xs, fontWeight: FW.bold, color: K.act,
          letterSpacing: 1.5, textTransform: "uppercase",
          marginBottom: 10,
        }}>{m.eyebrow}</div>
      )}
      <div style={{
        fontSize: FS.base, fontWeight: FW.bold, color: K.t1,
        marginBottom: m.message ? 6 : 16,
      }}>{m.title}</div>
      {m.message && (
        <div style={{
          fontSize: FS.sm, color: K.t2, lineHeight: 1.5,
          marginBottom: 16, whiteSpace: "pre-line",
        }}>{m.message}</div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleCancel}
          style={{
            flex: 1, padding: 12, borderRadius: 10,
            background: K.inp, border: `1px solid ${K.bdr}`,
            color: K.t2, fontSize: FS.base, fontWeight: FW.bold,
            cursor: "pointer",
          }}
        >
          {m.cancelLabel || "Cancel"}
        </button>
        <button
          onClick={m.onConfirm}
          style={{
            flex: 1, padding: 12, borderRadius: 10,
            background: confirmBg, border: "none",
            color: confirmFg, fontSize: FS.base, fontWeight: FW.bold,
            cursor: "pointer",
          }}
        >
          {m.confirmLabel || "Confirm"}
        </button>
      </div>
    </Popup>
  );
}
