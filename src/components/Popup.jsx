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
  useEffect(() => {
    if (!onClose || noEscClose) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, noEscClose]);

  const handleBackdrop = () => {
    if (!noBackdropClose && onClose) onClose();
  };

  return (
    <div
      onClick={handleBackdrop}
      data-popup
      style={{
        position: "fixed",
        inset: 0,
        background: STD_BACKDROP,
        zIndex: z,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: outerPadding,
        overflowY: "auto",
        overscrollBehavior: "contain",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: K.bg,
          border: `1px solid ${K.bdr}`,
          borderRadius: 14,
          padding,
          width: "100%",
          maxWidth,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          overscrollBehavior: "contain",
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
              background: "transparent",
              border: "none",
              color: K.t3,
              fontSize: FS.lg,
              fontWeight: FW.semibold,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        )}
        {children}
      </div>
    </div>
  );
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
