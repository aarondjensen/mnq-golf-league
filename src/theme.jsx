// ══════════════════════════════════════════════════════════════
//  CONSTANTS & UTILITIES
// ══════════════════════════════════════════════════════════════
export const SEASON_WEEKS = 16;
export const REGULAR_WEEKS = 14;
export const TEAMS_COUNT = 10;
export const TEE_INTERVAL = 8;

export const DEFAULT_SCORING = {
  matchWin: 3, matchTie: 1.5, matchLoss: 0,
  totalNetBonusWin: 3, totalNetBonusTie: 1.5, totalNetBonusLoss: 0,
  playoffMatchWin: 5, playoffMatchTie: 2.5, playoffMatchLoss: 0,
  playoffBonusWin: 3, playoffBonusTie: 1.5, playoffBonusLoss: 0,
  hcpRecentCount: 8, hcpBestCount: 6, hcpMethod: "gross9",
};

export function calcCourseHandicap(index, slope, rating, par) {
  if (!slope || !rating) return Math.round(index);
  return Math.round((index * slope / 113) + (rating - par));
}
export function calcNineHandicap(ch) { return Math.round(ch / 2); }
export function getTeeTime(idx) {
  const d = new Date(2026, 0, 1, 16, 28);
  d.setMinutes(d.getMinutes() + idx * TEE_INTERVAL);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
export function getWeekSide(weekNum) { return weekNum % 2 === 1 ? 'front' : 'back'; }
export function calcDifferential(gross, rating, slope) { return (113 / slope) * (gross - rating); }
export function calcLeagueHandicap(grossScores, par, recentCount, bestCount) {
  if (!grossScores.length) return null;
  const recent = grossScores.slice(-recentCount);
  if (!recent.length) return null;
  const sorted = [...recent].sort((a, b) => a - b);
  const best = sorted.slice(0, Math.min(bestCount, sorted.length));
  const avg = best.reduce((a, b) => a + b, 0) / best.length;
  return Math.round(avg - par);
}

// ══════════════════════════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════════════════════════
export const K = {
  bg: "#0b1829", card: "#111f36", cardHi: "#182d4a", inp: "#0d1e35",
  bdr: "#1e3a5f", acc: "#c8cfd8", accDim: "#8b95a3",
  act: "#d4a017", actHov: "#c2900f",
  grn: "#34d399", grnDim: "#059669", red: "#f87171",
  warn: "#fbbf24", t1: "#f1f5f9", t2: "#94a3b8", t3: "#475569",
  gold: "#fbbf24", silver: "#94a3b8", bronze: "#d97706",
};

export const FONTS = "https://fonts.googleapis.com/css2?family=League+Spartan:wght@300;400;500;600;700;800&display=swap";

export const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body { overscroll-behavior: none; background: ${K.bg}; letter-spacing: 0.4px; }
  input, select, textarea, button { font-family: 'League Spartan', sans-serif; letter-spacing: 0.4px; font-size: 15px; }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: ${K.bdr}; border-radius: 4px; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
  .fi { animation: fadeIn .35s ease both; }
  .pu { animation: pulse 1.8s ease-in-out infinite; }
  input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
  input[type=number] { -moz-appearance: textfield; }
  .hole-input:focus { outline: 2px solid ${K.acc}; outline-offset: -1px; background: ${K.cardHi} !important; }
  .app-shell { min-height: 100vh; background: ${K.bg}; color: ${K.t1}; font-family: 'League Spartan', sans-serif; display: flex; flex-direction: column; font-size: 15px; letter-spacing: 0.4px; }
  .app-header { padding: 12px 20px; background: linear-gradient(135deg, ${K.card}, ${K.bg}); border-bottom: 1px solid ${K.bdr}; display: flex; justify-content: center; align-items: center; position: relative; }
  .app-body { display: flex; flex: 1; justify-content: center; }
  .main-content { padding: 12px 14px; padding-bottom: 74px; max-width: 900px; width: 100%; margin: 0 auto; }
  .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; background: ${K.card}f0; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-top: 1px solid ${K.bdr}; display: flex; justify-content: space-around; padding: 6px 0 12px; z-index: 100; max-width: 900px; margin: 0 auto; }
  .admin-grid { display: flex; flex-direction: column; gap: 6px; }
  .admin-sections-grid { display: flex; flex-direction: column; gap: 6px; }
  .players-grid { display: flex; flex-direction: column; gap: 4px; }
  .scoring-grid { display: flex; flex-direction: column; gap: 10px; }
  .schedule-weeks { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 12px; }
  .standings-grid { display: flex; flex-direction: column; gap: 6px; }
  @media (min-width: 768px) {
    .main-content { padding: 24px 32px; padding-bottom: 80px; margin: 0 auto; }
    .admin-sections-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .players-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .scoring-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .standings-grid { max-width: 700px; margin: 0 auto; }
  }
  @media (min-width: 1100px) {
    .main-content { padding: 28px 40px; padding-bottom: 80px; }
    .admin-sections-grid { grid-template-columns: repeat(3, 1fr); }
    .players-grid { display: grid; grid-template-columns: repeat(3, 1fr); }
  }
`;

// ── SVG Icons (Lucide-style, stroke-based) ──
export const I = {
  trophy: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>,
  flag: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>,
  calendar: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>,
  barChart: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>,
  target: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  settings: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>,
  user: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  users: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  mapPin: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>,
  ruler: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>,
  key: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.3 9.3"/><path d="M18.5 5.5 21 3"/></svg>,
  arrowLeft: (s = 14, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>,
  ellipsis: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" fill={c}/><circle cx="5" cy="12" r="1" fill={c}/><circle cx="19" cy="12" r="1" fill={c}/></svg>,
};

// ── Shared UI components ──
export const Pill = ({ children, color = K.acc, style, ...rest }) => (
  <span style={{ fontSize: 11, fontWeight: 600, color, background: color + "14", padding: "2px 8px", borderRadius: 4, letterSpacing: .6, textTransform: "uppercase", ...style }} {...rest}>{children}</span>
);
export const BackBtn = ({ onClick }) => (
  <button onClick={onClick} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.t2, fontSize: 13, padding: "7px 14px", cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 5, letterSpacing: .4 }}>{I.arrowLeft(13, K.t2)} Back</button>
);
export const SaveBtn = ({ onClick, label = "Save" }) => (
  <button onClick={onClick} style={{ background: K.act, border: "none", borderRadius: 6, color: K.bg, fontSize: 13, padding: "7px 16px", cursor: "pointer", fontWeight: 600, letterSpacing: .4 }}>{label}</button>
);
export const SectionTitle = ({ children }) => (
  <div style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 22, fontWeight: 700, color: K.t1, letterSpacing: .6, marginBottom: 14 }}>{children}</div>
);
export const SubLabel = ({ children, color = K.acc, style }) => (
  <div style={{ fontSize: 11, fontWeight: 600, color, textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 6, ...style }}>{children}</div>
);
export const Card = ({ children, highlight, style, ...rest }) => (
  <div style={{ background: K.card, borderRadius: 10, border: `1px solid ${highlight ? K.acc + '40' : K.bdr}`, padding: "13px 15px", ...style }} {...rest}>{children}</div>
);
export const EmptyState = ({ icon, title, subtitle }) => (
  <div style={{ textAlign: "center", padding: 40 }}>
    <div style={{ marginBottom: 12, display: "flex", justifyContent: "center", opacity: .4 }}>{typeof icon === "string" ? I[icon]?.(40, K.t3) || null : icon}</div>
    <div style={{ color: K.t2, fontSize: 15, fontWeight: 500, letterSpacing: .4 }}>{title}</div>
    {subtitle && <div style={{ color: K.t3, fontSize: 13, marginTop: 4, letterSpacing: .3 }}>{subtitle}</div>}
  </div>
);
