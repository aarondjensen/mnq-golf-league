// ══════════════════════════════════════════════════════════════════
//  theme.js — design tokens. Colours, type scale, weights, metrics.
// ══════════════════════════════════════════════════════════════════
//
// This file used to be theme.jsx, and it used to be 1,108 lines holding three
// unrelated things at once: these tokens, ten shared UI components, and the
// entire league domain — handicaps, standings, seeding, playoff brackets.
//
// That mix was not just untidy. It is what 43 of the repo's lint errors were
// (`react-refresh/only-export-components` complaining about exactly this), it
// meant a pure standings function could not be imported without pulling JSX in
// behind it, and it left Bourbon Cup and WBC — which both keep tokens, ui and
// domain apart — with no file here they could be compared against.
//
// The split is:
//   src/theme.js            these tokens (no JSX, so .js not .jsx)
//   src/components/ui.jsx   the shared components and the icon set
//   src/lib/league.js       the league domain
//
// Nothing here imports anything. That is the property worth keeping: tokens
// are the bottom of the dependency graph, and the moment this file imports a
// component the cycle starts.

// ══════════════════════════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════════════════════════
//
// `K.hcpBlue` exists because the codebase had `#3b82f6` hardcoded in 18+
// places (scorecard stroke dots, HCP pills, "Sign Scorecard" button, attest
// button, etc.). That bright pure blue clashed with the brand navy
// `K.logoBright` (#10387d) used elsewhere for the same conceptual thing.
// The token unifies them under one theme-aware color so dark/light mode and
// any future rebrand only need to touch this file.
export const getTheme = (mode = "dark") => {
  if (mode === "light") return {
    bg: "#f0f2f5", card: "#ffffff", cardHi: "#f8f9fa", inp: "#e9ecef",
    bdr: "#d1d5db", acc: "#475569", accDim: "#64748b",
    act: "#deab12", actHov: "#c99b0f",
    grn: "#059669", grnDim: "#047857", red: "#dc2626", teal: "#0d9488", logoBlue: "#153453", logoBright: "#10387d",
    // Brighter blue for handicaps and stroke dots — reads cleanly against
    // light-mode card backgrounds. Distinct from K.logoBright (navy) which is
    // used for branding (logo text, headers, badges). Matches the dark-mode
    // value so scorecard markings look the same in both themes.
    hcpBlue: "#3b82f6",
    warn: "#d97706", t1: "#111827", t2: "#4b5563", t3: "#9ca3af",
    gold: "#d97706", silver: "#6b7280", bronze: "#b45309",
    matchGrn: "#157a34",
  };
  return {
    bg: "#0b1829", card: "#111f36", cardHi: "#182d4a", inp: "#0d1e35",
    bdr: "#1e3a5f", acc: "#c8cfd8", accDim: "#8b95a3",
    act: "#deab12", actHov: "#c99b0f",
    grn: "#34d399", grnDim: "#059669", red: "#ef4444", teal: "#2dd4bf", logoBlue: "#153453", logoBright: "#10387d",
    // In dark mode, navy disappears against the dark bg, so the HCP token keeps a
    // brighter blue for legibility. The hardcoded #3b82f6 from prior code was
    // visually correct in dark mode — only wrong in light mode where it clashed
    // with the navy K.logoBright. Splitting them by mode resolves both cases.
    hcpBlue: "#3b82f6",
    warn: "#fbbf24", t1: "#f1f5f9", t2: "#94a3b8", t3: "#475569",
    gold: "#fbbf24", silver: "#94a3b8", bronze: "#d97706",
    matchGrn: "#1a8c3f",
  };
};

const _savedMode = (() => { try { return typeof window !== 'undefined' && localStorage.getItem("mnq_theme") === "dark" ? "dark" : "light"; } catch { return "light"; } })();
export const K = { ...getTheme(_savedMode) };
export function applyTheme(mode) {
  const next = getTheme(mode);
  for (const key in next) K[key] = next[key];
  for (const key in K) { if (!(key in next)) delete K[key]; }
}

export const getCSS = (k) => `
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body { overscroll-behavior: none; background: ${k.bg}; letter-spacing: 0.8px; text-transform: uppercase; min-height: 100vh; min-height: -webkit-fill-available; }
  input, select, textarea { text-transform: uppercase; }
  input, select, textarea, button { font-family: 'League Spartan', sans-serif; letter-spacing: 0.8px; font-size: 15px; text-transform: uppercase; }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: ${k.bdr}; border-radius: 4px; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
  @keyframes mnqSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  /* skeletonPulse — distinct from .pu's text pulse. Oscillates the
     background color of skeleton rows between K.inp and a slightly
     lighter shade so loading lists feel "alive" without being noisy.
     Pages stagger animation-delay per row for a gentle ripple effect. */
  @keyframes skeletonPulse { 0%, 100% { opacity: .55; } 50% { opacity: .9; } }
  input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
  input[type=number] { -moz-appearance: textfield; }
  .hole-input:focus { outline: 2px solid ${k.act}; outline-offset: -1px; background: ${k.cardHi} !important; }
  .app-shell { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: ${k.bg}; display: flex; flex-direction: column; overflow: hidden; }
  /* App typography lives on a shared selector, not on .app-shell alone,
     because popups portal to <body> and would otherwise fall outside the
     shell and inherit the browser defaults — wrong face, wrong size, no
     letter-spacing, no uppercase. Both roots must stay in this rule. */
  .app-shell, .popup-root { color: ${k.t1}; font-family: 'League Spartan', sans-serif; font-size: 15px; letter-spacing: 0.8px; text-transform: uppercase; }
  .app-header { padding: 12px 20px; padding-top: calc(12px + env(safe-area-inset-top, 0px)); background: ${k.bg}; display: flex; justify-content: center; align-items: center; position: relative; }
  .app-body { flex: 1; overflow-y: auto; overflow-x: hidden; overscroll-behavior-y: none; min-height: 0; background: ${k.bg}; }
  .main-content { padding: 12px 14px; padding-bottom: 24px; max-width: 900px; width: 100%; margin: 0 auto; box-sizing: border-box; min-height: 100%; background: ${k.bg}; }
  .bottom-nav { background: ${k.card}f0; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-top: 1px solid ${k.bdr}; display: flex; justify-content: space-around; padding: 10px 0 12px; padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 200; max-width: 900px; width: 100%; flex-shrink: 0; }
  .admin-grid { display: flex; flex-direction: column; gap: 6px; }
  .admin-sections-grid { display: flex; flex-direction: column; gap: 6px; }
  .players-grid { display: flex; flex-direction: column; gap: 6px; }
  .scoring-grid { display: flex; flex-direction: column; gap: 10px; }
  .schedule-weeks { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 12px; }
  .standings-grid { display: flex; flex-direction: column; gap: 6px; }
  @media (min-width: 768px) {
    .main-content { padding: 24px 32px; padding-bottom: 20px; margin: 0 auto; }
    .standings-grid { gap: 6px; }
    .admin-sections-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .players-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .scoring-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  }
  .fi { animation: fadeIn .35s ease both; }
  .pu { animation: pulse 1.8s ease-in-out infinite; }
`;


// ── Shared style constants for consistency ──
export const LIST_GAP = 6;        // gap between list cards
export const CARD_RADIUS = 10;    // border-radius for all list cards

// ── Type scale ───────────────────────────────────────────────────────
// Single source of truth for font sizes. The app had ~18 distinct inline
// pixel sizes that drifted into near-duplicates (11/12/13/14/15 all used
// for "body-ish" text, 16/17/18 for headings, 20/22/24/26 for big numbers).
// FS collapses those into intentional steps. Each step lists the legacy
// sizes it absorbs so the file-by-file migration knows where each number
// rounds to. The two bespoke display sizes (42, 52px) are deliberate
// one-offs and stay explicit at their call sites.
export const FS = {
  micro: 9,   // eyebrows, tiny uppercase labels, seed badges   (← 7, 8, 9)
  xs: 11,     // sub-labels, captions, pills                    (← 10, 11)
  sm: 13,     // secondary body text, compact rows              (← 12, 13)
  base: 15,   // player/team names, primary body                (← 14, 15)
  lg: 18,     // section titles, emphasis                       (← 16, 17, 18)
  xl: 20,     // hero / stat numbers                            (← 20, 22)
  xxl: 26,    // large display stats                            (← 24, 26)
};

export const NAME_SIZE = FS.base;       // 15 — player/team names in lists

// ── Weight scale ─────────────────────────────────────────────────────
// Companion to FS for font-weights. The app uses five real weights; this
// names them so call sites pick from a known set instead of scattering
// raw numbers and state-toggle ternaries. IMPORTANT: League Spartan is
// loaded at 300–800 only (see index.html). Weight 900 is NOT loaded and
// silently falls back to 800, so any `fontWeight: 900` is a no-op — those
// fold to FW.heavy during migration. (A handful exist today, including a
// latent `isActive ? 900 : 800` toggle in Scoring that renders no
// difference and needs a real emphasis cue.)
export const FW = {
  regular: 400,   // body text (rare)
  medium: 500,    // gentle emphasis
  semibold: 600,  // secondary labels, sub-headers
  bold: 700,      // names, primary emphasis (most common)
  heavy: 800,     // stat numbers, strong emphasis (also the 900 fallback)
};

export const NAME_WEIGHT = FW.bold;        // 700 — font-weight for names
export const HERO_NUM_SIZE = FS.xl;     // 20 — large stat numbers (points, CTP count, etc.)
export const HERO_NUM_WEIGHT = FW.heavy;   // 800
export const RANK_BADGE_SIZE = 28; // width/height for rank badges
export const RANK_BADGE_RADIUS = 7;
export const RANK_BADGE_FONT = FS.sm;   // 13 — number inside rank badges
// Chevron is a glyph, not text; at 14 it sits between sm (13) and base (15).
// Kept explicit at 14 for now so Phase 1 changes nothing on screen — it
// folds to FS.base during the file migration as a deliberate 1px decision.
export const CHEVRON_SIZE = 14;   // font-size for expand/collapse chevron

// The webfont the whole app is set in. Lives here rather than with the
// components because it is a design token like any other colour or size.
export const FONTS = "https://fonts.googleapis.com/css2?family=League+Spartan:wght@300;400;500;600;700;800&display=swap";

// ══════════════════════════════════════════════════════════════════
//  R — the corner-radius scale
// ══════════════════════════════════════════════════════════════════
//
// Every radius in this app started as a loose literal at a call site, and loose
// literals are how it ended up with 340 of them across 13 distinct values —
// none of which anyone chose, all of which someone typed. A 1px step is
// invisible on its own and indistinguishable from a mistake, so nothing in
// review catches it.
//
// The rungs describe a ROLE, not a size. Reach for the one whose role matches
// what you are drawing; if none fits, add a rung HERE with a note on what it is
// for, so the next person inherits a decision instead of a digit.
//
// WBC carries the same scale under the same names with its own values — the
// vocabulary is shared, the numbers are each app's own, exactly as FS is.
export const R = {
  xs:   4,   // swatches, inline marks, the tightest grid inputs
  sm:   6,   // chips, badges, small controls
  md:   8,   // the default — controls inside a card
  lg:  10,   // cards and list rows
  xl:  12,   // panels
  modal: 14, // the modal card — its own rung because it is its own thing, and
             // snapping it to 12 or 16 would restyle every popup in the app
  xxl: 16,   // bottom sheets and the largest panels
  pill: 999, // fully-rounded tracks, tags and avatars
};

// ══════════════════════════════════════════════════════════════════
//  MOTION — transition durations
// ══════════════════════════════════════════════════════════════════
//
// Three speeds, because the app was carrying seven spellings of about four.
// `transition: `opacity ${MOTION}`` rather than a literal, so a change of pace
// is one edit rather than a search.
export const MOTION_FAST = "0.15s"; // a control acknowledging a tap
export const MOTION = "0.2s";       // the default — hovers, fades, small moves
export const MOTION_SLOW = "0.4s";  // something entering or leaving the screen
