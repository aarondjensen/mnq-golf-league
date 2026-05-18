// ══════════════════════════════════════════════════════════════
//  CONSTANTS & UTILITIES
// ══════════════════════════════════════════════════════════════
import { resultLetterFor } from "./lib/matchCalc";

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

export function getWeekSide(weekNum) { return weekNum % 2 === 1 ? 'front' : 'back'; }

// ── Player handicap calc with proportional scaling for short histories ──
// Admin sets "best N of recent M" (e.g. best 6 of 8 → ratio 0.75).
// For a player with fewer than M rounds, scale the "best" count proportionally:
// e.g. with 4 rounds → best round(4 * 0.75) = best 3 of 4.
//
// EXCEPTION: a player with exactly 2 rounds uses best 1 of 2 instead of the
// proportional best 2 of 2. With only two rounds, "averaging both" gives a
// soft handicap that overweights any unusually high round; using just the
// best one is more representative of demonstrated skill while the player's
// history is still sparse. Once they reach 3+ rounds the standard
// proportional scaling resumes (best 2 of 3, then best 3 of 4, etc.).
//
// Accepts either an array of round objects { gross } or raw gross numbers.
export function calcPlayerHcp(rounds, recentN, bestN, par) {
  if (!rounds || !rounds.length) return null;
  const ratio = bestN / recentN;
  const actualRecent = rounds.slice(-recentN);
  let scaledBest;
  if (actualRecent.length === 2) {
    scaledBest = 1;
  } else {
    scaledBest = Math.max(1, Math.round(ratio * actualRecent.length));
  }
  const grosses = actualRecent.map(r => typeof r === 'number' ? r : r.gross);
  const sorted = [...grosses].sort((a, b) => a - b);
  const best = sorted.slice(0, scaledBest);
  const avg = best.reduce((a, b) => a + b, 0) / best.length;
  return Math.round(avg - par);
}

// ── Shared utility: extract last names from team name ──
export function lastNamesOnly(teamName) {
  if (!teamName) return "";
  return teamName.split(/\s*\/\s*/).map(part => {
    const words = part.trim().split(/\s+/);
    return words.length > 1 ? words[words.length - 1] : words[0];
  }).join(" / ");
}

// ── Shared utility: format tee time from base time string + index ──
export function formatTeeTime(baseTime, idx, interval = 8) {
  const [timePart, ampm] = (baseTime || "4:28 PM").split(' ');
  const [h, m] = timePart.split(':').map(Number);
  let mins = (ampm === 'PM' && h !== 12 ? h + 12 : h) * 60 + m + idx * interval;
  const hr = Math.floor(mins / 60) % 12 || 12;
  const mn = mins % 60;
  const ap = Math.floor(mins / 60) >= 12 ? 'PM' : 'AM';
  return `${hr}:${String(mn).padStart(2, '0')} ${ap}`;
}

// ── Shared utility: compute current standings array sorted for seeding ──
//
// The canonical standings calculator. Two callers, two slightly different needs:
//
//   1. Seeding (App.jsx auto-seed, Admin manual seed):
//      Considers ONLY locked weeks. The whole point of locked-seeds is that
//      partial mid-week scores can't drift the seed list. Pass `schedule`
//      and use the default `lockedOnly: true` — the function self-filters.
//
//   2. Standings page display (Standings.jsx):
//      Caller pre-filters its results array (e.g. to "everything", or "all
//      LOCKED weeks except the latest one" for the prevStandings comparison).
//      Pass `lockedOnly: false` and the function trusts the caller's filter.
//      `schedule` is ignored in this mode.
//
// Output shape: [{ teamId, points, w, l, t, hw, gp }, ...] sorted from
// 1st (index 0) to last. Field `gp` (games played) is needed by the record-
// mode sort to compute win %; no consumer outside this file reads it directly.
//
// Tiebreaker chains
// ─────────────────
// `points` mode (default):
//     1. higher total points
//     2. more holes won (hw)
//
// `record` mode (`standingsMethod === "record"`):
//     1. higher win % ((w + 0.5*t) / gp)
//     2. more wins
//     3. fewer losses
//     4. more holes won (hw) — the league's actual final tiebreaker rule.
//
// W/L/T comes from match-play result via `resultLetterFor`, NOT from a points
// comparison. In lowHighBonus and legacy teamNetTotal data a TIED match-play
// row can carry asymmetric points (e.g. bonus split unevenly), and using the
// points delta would falsely give one team a W and the other an L on a tied
// match. Standings still SORT by points in points mode, so unequal points
// still drive ranking — only the W-L-T column is corrected.
export function buildStandingsForSeed(teams, matchResults, schedule, standingsMethod, lockedOnly = true) {
  const pts = {};
  teams.forEach(t => { pts[t.id] = { teamId: t.id, points: 0, w: 0, l: 0, t: 0, hw: 0, gp: 0 }; });
  (matchResults || []).forEach(r => {
    if (!r) return;
    if (lockedOnly) {
      // Self-filter: skip results whose week isn't locked yet. Required for
      // seeding because mid-week partial scores must NOT influence seed
      // ordering.
      const rWeek = (schedule || []).find(s => s.week === r.week);
      if (!rWeek || !rWeek.locked) return;
    }
    if (pts[r.team1Id]) { pts[r.team1Id].points += (r.team1Points || 0); if (r.t1HolesWon !== undefined) pts[r.team1Id].hw += r.t1HolesWon; }
    if (pts[r.team2Id]) { pts[r.team2Id].points += (r.team2Points || 0); if (r.t2HolesWon !== undefined) pts[r.team2Id].hw += r.t2HolesWon; }
    const t1Letter = resultLetterFor(r, r.team1Id);
    const t2Letter = resultLetterFor(r, r.team2Id);
    if (pts[r.team1Id]) {
      if (t1Letter === "W") { pts[r.team1Id].w++; pts[r.team1Id].gp++; }
      else if (t1Letter === "L") { pts[r.team1Id].l++; pts[r.team1Id].gp++; }
      else if (t1Letter === "T") { pts[r.team1Id].t++; pts[r.team1Id].gp++; }
    }
    if (pts[r.team2Id]) {
      if (t2Letter === "W") { pts[r.team2Id].w++; pts[r.team2Id].gp++; }
      else if (t2Letter === "L") { pts[r.team2Id].l++; pts[r.team2Id].gp++; }
      else if (t2Letter === "T") { pts[r.team2Id].t++; pts[r.team2Id].gp++; }
    }
  });
  const isRecord = standingsMethod === "record";
  const arr = Object.values(pts);
  if (isRecord) {
    // Record-mode tiebreaker chain — 4 steps:
    //   1. higher win % ((w + 0.5*t) / gp)
    //   2. more wins
    //   3. fewer losses
    //   4. more holes won (hw)
    //
    // The 4th step is the league's actual tiebreaker rule — when teams are
    // perfectly tied on record, the team with the most holes won across the
    // season ranks higher. Standings.jsx had this chain in its local
    // buildStandings copy long before consolidation; theme.jsx's version
    // missed it.
    //
    // If your league has `lockedSeeds` set in leagueConfig (Admin → Config
    // → Lock Seeds toggle), and that snapshot was captured under the older
    // 3-step chain, Schedule's seeding can disagree with Standings's live
    // ordering. The fix is to recompute the snapshot:
    //   • Admin → Config → toggle Lock Seeds off, then back on, OR
    //   • Firestore console → edit league_2026_config → delete the
    //     `lockedSeeds` field (buildSeedMap falls through to live compute)
    arr.sort((a, b) => {
      const aPct = a.gp ? (a.w + a.t * 0.5) / a.gp : 0;
      const bPct = b.gp ? (b.w + b.t * 0.5) / b.gp : 0;
      if (bPct !== aPct) return bPct - aPct;
      if (b.w !== a.w) return b.w - a.w;
      if (a.l !== b.l) return a.l - b.l;
      return b.hw - a.hw;
    });
  } else {
    arr.sort((a, b) => b.points - a.points || b.hw - a.hw);
  }
  return arr;
}

// ── Shared utility: { teamId -> seed number (1 = best) } ──
// Prefers locked-seeds snapshot (leagueConfig.lockedSeeds) when present and complete.
// Otherwise derives from standings via buildStandingsForSeed, so Admin, Scoring,
// and any other caller all see the exact same seeding at any given moment.
export function buildSeedMap(teams, matchResults, schedule, leagueConfig) {
  const lockedSeeds = leagueConfig?.lockedSeeds;
  if (lockedSeeds && Array.isArray(lockedSeeds) && lockedSeeds.length === teams.length) {
    const map = {};
    lockedSeeds.forEach((tid, i) => { map[tid] = i + 1; });
    return map;
  }
  const standings = buildStandingsForSeed(teams, matchResults, schedule, leagueConfig?.standingsMethod);
  const map = {};
  standings.forEach((s, i) => { map[s.teamId] = i + 1; });
  return map;
}

// ══════════════════════════════════════════════════════════════
//  NON-BRACKET PAIRING (PLAYOFF CONSOLATION)
// ══════════════════════════════════════════════════════════════
// During playoff weeks, teams not in the official bracket still need tee times.
// This picks an optimal pairing that minimizes repeat matchups based on league history.
//
// Approach: exact minimum-weight perfect matching via bitmask DP.
//   cost(pair) = # of prior meetings between those two teams
//   objective: minimize sum of cost across all pairs
//
// For our 20-team league (and at most ~10-12 non-bracket teams during playoffs),
// the 2^N * N work is trivial — we could do 20 teams in a few ms. For typical cases
// (6-8 non-bracket teams) it's microseconds.
//
// Returns: { pairs: [{ team1, team2 }...], bye: teamId | null }
//   bye is set only when the non-bracket count is odd — the caller decides what to
//   do with the bye team.
//
// Args:
//   allTeams       — array of team docs (need .id)
//   bracketMatches — matches already slotted for the bracket: [{ team1, team2 }...]
//   priorMatchups  — flat list of prior meetings from schedule.matches of earlier
//                    weeks: [{ team1, team2 }...]. Both orientations are fine; we
//                    canonicalize the pair key.
export function pairNonBracketTeams(allTeams, bracketMatches, priorMatchups) {
  const bracketTeamIds = new Set();
  (bracketMatches || []).forEach(m => {
    if (m.team1) bracketTeamIds.add(m.team1);
    if (m.team2) bracketTeamIds.add(m.team2);
  });
  // Deterministic order (team id sort) so re-running produces the same pairings.
  const remaining = (allTeams || [])
    .map(t => t.id)
    .filter(id => !bracketTeamIds.has(id))
    .sort();
  const n = remaining.length;
  if (n < 2) return { pairs: [], bye: n === 1 ? remaining[0] : null };

  // Build meeting-count matrix keyed by canonical pair string.
  const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
  const counts = {};
  (priorMatchups || []).forEach(m => {
    if (!m.team1 || !m.team2) return;
    const k = pairKey(m.team1, m.team2);
    counts[k] = (counts[k] || 0) + 1;
  });
  const costIJ = (i, j) => counts[pairKey(remaining[i], remaining[j])] || 0;

  // Memoized DP. State = bitmask of still-unmatched indices.
  // dp[mask] = { cost, pairs: [[i, j], ...] }
  const dp = new Map();

  // For odd n, we try each index as the bye and DP on the rest.
  // For even n, we DP directly on the full mask.
  const fullMask = (1 << n) - 1;

  const solve = (mask) => {
    if (dp.has(mask)) return dp.get(mask);
    // Find lowest unmatched index
    let first = -1;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) { first = i; break; }
    }
    if (first === -1) {
      const empty = { cost: 0, pairs: [] };
      dp.set(mask, empty);
      return empty;
    }
    let best = null;
    for (let j = first + 1; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const sub = solve(mask & ~(1 << first) & ~(1 << j));
      const total = sub.cost + costIJ(first, j);
      if (!best || total < best.cost) {
        best = { cost: total, pairs: [[first, j], ...sub.pairs] };
      }
    }
    dp.set(mask, best);
    return best;
  };

  let resultPairs, byeId = null;

  if (n % 2 === 0) {
    const res = solve(fullMask);
    resultPairs = res.pairs;
  } else {
    // Try each team as bye; keep the best overall.
    let bestOverall = null;
    let bestByeIdx = -1;
    for (let byeIdx = 0; byeIdx < n; byeIdx++) {
      const maskMinusBye = fullMask & ~(1 << byeIdx);
      const res = solve(maskMinusBye);
      if (!bestOverall || res.cost < bestOverall.cost) {
        bestOverall = res;
        bestByeIdx = byeIdx;
      }
    }
    resultPairs = bestOverall.pairs;
    byeId = remaining[bestByeIdx];
  }

  const pairs = resultPairs.map(([i, j]) => ({ team1: remaining[i], team2: remaining[j] }));
  return { pairs, bye: byeId };
}

// Collect all prior matchups from the schedule up to (but not including) a given week.
// Used by pairNonBracketTeams. Walks schedule.matches for every week before currentWeek
// that has a matches array. Inclusive of seeded/RR/makeup/playoff weeks alike.
export function collectPriorMatchups(schedule, currentWeek) {
  const out = [];
  (schedule || []).forEach(wk => {
    if (typeof wk.week !== "number" || wk.week >= currentWeek) return;
    if (wk.rainedOut) return; // rained-out weeks didn't actually play
    (wk.matches || []).forEach(m => {
      if (m.team1 && m.team2) out.push({ team1: m.team1, team2: m.team2 });
    });
  });
  return out;
}

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
  .app-shell { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: ${k.bg}; color: ${k.t1}; font-family: 'League Spartan', sans-serif; display: flex; flex-direction: column; font-size: 15px; letter-spacing: 0.8px; overflow: hidden; text-transform: uppercase; }
  .app-header { padding: 12px 20px; padding-top: calc(12px + env(safe-area-inset-top, 0px)); background: ${k.bg}; display: flex; justify-content: center; align-items: center; position: relative; }
  .app-body { flex: 1; overflow-y: auto; overflow-x: hidden; overscroll-behavior-y: none; min-height: 0; background: ${k.bg}; }
  .main-content { padding: 12px 14px; padding-bottom: 24px; max-width: 900px; width: 100%; margin: 0 auto; box-sizing: border-box; min-height: 100%; background: ${k.bg}; }
  .bottom-nav { background: ${k.card}f0; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-top: 1px solid ${k.bdr}; display: flex; justify-content: space-around; padding: 8px 0 10px; padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); z-index: 200; max-width: 900px; width: 100%; flex-shrink: 0; }
  .admin-grid { display: flex; flex-direction: column; gap: 6px; }
  .admin-sections-grid { display: flex; flex-direction: column; gap: 6px; }
  .players-grid { display: flex; flex-direction: column; gap: 6px; }
  .scoring-grid { display: flex; flex-direction: column; gap: 10px; }
  .schedule-weeks { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 12px; }
  /* Score-cell text centering. Both the border (circle/square) and the
     score text use translate(-50%, -50%) to center against the same
     geometric anchor, but the text needs an additional translateY to
     compensate for League Spartan's slightly-high-sitting numeral glyphs
     within their line box. Desktop renders 1px nudge perfectly; touch
     devices (iOS Safari at 3x DPR) need a slightly larger nudge because
     Core Graphics handles sub-pixel glyph positioning differently than
     desktop browsers. pointer: coarse media query targets touch devices
     specifically — width-based queries would catch large tablets too. */
  .scorecell-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) translateY(1px); z-index: 1; line-height: 1; }
  @media (pointer: coarse) {
    .scorecell-text { transform: translate(-50%, -50%) translateY(1.5px); }
  }
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

export const FONTS = "https://fonts.googleapis.com/css2?family=League+Spartan:wght@300;400;500;600;700;800&display=swap";

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
  bell: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>,
};

// ── Shared UI components ──
//
// NOTE: The canonical ScoreCell lives in pages/Scoring.jsx — the prior duplicate
// here (and the unused MiniScoreCell) were removed during the audit cleanup.
// Import ScoreCell from "./pages/Scoring" if you ever need it outside of the
// SharedScorecard renderer.
export const Pill = ({ children, color = K.acc, style, ...rest }) => (
  <span style={{ fontSize: 11, fontWeight: 600, color, background: color + "14", padding: "2px 8px", borderRadius: 4, letterSpacing: 1.0, textTransform: "uppercase", ...style }} {...rest}>{children}</span>
);
export const BackBtn = ({ onClick }) => (
  <button onClick={onClick} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.t2, fontSize: 13, padding: "7px 14px", cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 5, letterSpacing: .8 }}>{I.arrowLeft(13, K.t2)} Back</button>
);
export const SaveBtn = ({ onClick, label = "Save" }) => (
  <button onClick={onClick} style={{ background: K.act, border: "none", borderRadius: 6, color: K.bg, fontSize: 13, padding: "7px 16px", cursor: "pointer", fontWeight: 600, letterSpacing: .8 }}>{label}</button>
);
export const SectionTitle = ({ children }) => (
  <div style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 22, fontWeight: 700, color: K.t1, letterSpacing: 1.0, marginBottom: 14 }}>{children}</div>
);
export const SubLabel = ({ children, color = K.acc, style }) => (
  <div style={{ fontSize: 11, fontWeight: 600, color, textTransform: "uppercase", letterSpacing: 1.8, marginBottom: 6, ...style }}>{children}</div>
);
export const Card = ({ children, highlight, style, ...rest }) => (
  <div style={{ background: K.card, borderRadius: 10, border: `1px solid ${highlight ? K.acc + '40' : K.bdr}`, padding: "13px 15px", ...style }} {...rest}>{children}</div>
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

// ── Shared style constants for consistency ──
export const LIST_GAP = 6;        // gap between list cards
export const CARD_RADIUS = 10;    // border-radius for all list cards
export const NAME_SIZE = 15;      // font-size for player/team names in lists
export const NAME_WEIGHT = 700;   // font-weight for names
export const HERO_NUM_SIZE = 20;  // font-size for large stat numbers (points, CTP count, etc.)
export const HERO_NUM_WEIGHT = 800;
export const RANK_BADGE_SIZE = 28; // width/height for rank badges
export const RANK_BADGE_RADIUS = 7;
export const RANK_BADGE_FONT = 13;
export const CHEVRON_SIZE = 14;   // font-size for expand/collapse chevron
