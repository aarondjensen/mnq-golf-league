// ══════════════════════════════════════════════════════════════════
//  ui.jsx — the shared components, and the icon set they draw with.
// ══════════════════════════════════════════════════════════════════
//
// Lifted out of theme.jsx, which held these alongside the design tokens and the
// whole league domain. Bourbon Cup and WBC both keep their shared chrome in
// components/ui.jsx; this is the same place, so the three can now be read
// against each other.
//
// Everything here reads colour and metrics from ../theme and nothing else, so
// the dependency runs one way: tokens, then components. Do not import a page or
// a domain module into this file.

import { K, FS, FW, LIST_GAP, CARD_RADIUS, R } from "../theme";
import { I } from "./icons";



// ── Shared UI components ──
//
// NOTE: The canonical ScoreCell lives in pages/Scoring.jsx — the prior duplicate
// here (and the unused MiniScoreCell) were removed during the audit cleanup.
// Import ScoreCell from "../pages/Scoring" if you ever need it outside of the

// SharedScorecard renderer.
export const Pill = ({ children, color = K.acc, style, ...rest }) => (
  <span style={{ fontSize: 11, fontWeight: 600, color, background: color + "14", padding: "2px 8px", borderRadius: R.xs, letterSpacing: 1.0, textTransform: "uppercase", ...style }} {...rest}>{children}</span>
);
export const BackBtn = ({ onClick }) => (
  <button onClick={onClick} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: R.sm, color: K.t2, fontSize: 13, padding: "7px 14px", cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 5, letterSpacing: .8 }}>{I.arrowLeft(13, K.t2)} Back</button>
);
export const SaveBtn = ({ onClick, label = "Save" }) => (
  <button onClick={onClick} style={{ background: K.act, border: "none", borderRadius: R.sm, color: K.bg, fontSize: 13, padding: "7px 16px", cursor: "pointer", fontWeight: 600, letterSpacing: .8 }}>{label}</button>
);
export const SectionTitle = ({ children }) => (
  <div style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 22, fontWeight: 700, color: K.t1, letterSpacing: 1.0, marginBottom: 14 }}>{children}</div>
);
export const SubLabel = ({ children, color = K.acc, style }) => (
  <div style={{ fontSize: 11, fontWeight: 600, color, textTransform: "uppercase", letterSpacing: 1.8, marginBottom: 6, ...style }}>{children}</div>
);
export const Card = ({ children, highlight, style, ...rest }) => (
  <div style={{ background: K.card, borderRadius: R.lg, border: `1px solid ${highlight ? K.acc + '40' : K.bdr}`, padding: "13px 15px", ...style }} {...rest}>{children}</div>
);
export const EmptyState = ({ icon, title, subtitle }) => (
  <div style={{ textAlign: "center", padding: 40 }}>
    <div style={{ marginBottom: 12, display: "flex", justifyContent: "center", opacity: .4 }}>{typeof icon === "string" ? I[icon]?.(40, K.t3) || null : icon}</div>
    <div style={{ color: K.t2, fontSize: 15, fontWeight: 500, letterSpacing: .8 }}>{title}</div>
    {subtitle && <div style={{ color: K.t3, fontSize: 13, marginTop: 4, letterSpacing: .7 }}>{subtitle}</div>}
  </div>
);

// ──────────────────────────────────────────────────────────────────
//  LoadingPanel — replaces the inline "Loading..." text divs that
//  used to live in 6 places (TabFallback, Auth, Stats, Schedule,
//  Standings ×2). Single source so any future tweak propagates.
//
//  `subtitle` lets callers say what's loading (e.g. "scores", "matches")
//  without rebuilding the whole panel. `size="compact"` is for use
//  INSIDE an already-mounted view (e.g. an expansion row waiting on
//  per-week data) — smaller padding, smaller font. Default is for
//  top-level page loading.
// ──────────────────────────────────────────────────────────────────
export const LoadingPanel = ({ subtitle, size = "default" }) => {
  const compact = size === "compact";
  return (
    <div
      className="pu"
      style={{
        textAlign: "center",
        padding: compact ? 10 : 40,
        color: K.t3,
        fontSize: compact ? 11 : 13,
        letterSpacing: .5,
      }}
    >
      Loading{subtitle ? ` ${subtitle}` : ""}…
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────
//  SkeletonRow / SkeletonList — gray pulsing placeholders for the
//  shape of incoming list content. Used during cold-start before the
//  first Firestore snapshot fires. Replaces the "empty state flash"
//  pattern where pages briefly render EmptyState before data arrives.
//
//  SkeletonRow is a single gray block at a given height. Pass `style`
//  to override (border-radius, background, etc.) per-page. SkeletonList
//  repeats SkeletonRow N times with consistent gap + a stagger so the
//  pulse ripples down the list rather than blinking in lockstep.
//
//  Pages decide when to render skeletons vs. EmptyState by checking
//  a `dataLoaded` flag fed from App.jsx — see App.jsx's `dataLoaded`
//  state and the subscription callbacks that flip it on first snapshot.
// ──────────────────────────────────────────────────────────────────
export const SkeletonRow = ({ height = 56, style }) => (
  <div
    style={{
      height,
      background: K.inp,
      borderRadius: CARD_RADIUS,
      animation: "skeletonPulse 1.6s ease-in-out infinite",
      ...style,
    }}
  />
);

export const SkeletonList = ({ count = 6, height = 56, gap = LIST_GAP, style }) => (
  <div style={{ display: "flex", flexDirection: "column", gap, ...style }}>
    {Array.from({ length: count }, (_, i) => (
      <SkeletonRow
        key={i}
        height={height}
        style={{ animationDelay: `${i * 0.08}s` }}
      />
    ))}
  </div>
);
