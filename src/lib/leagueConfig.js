// ══════════════════════════════════════════════════════════════════
//  leagueConfig — the shape of a season, and how it is stored.
// ══════════════════════════════════════════════════════════════════
//
// The fixed dimensions of the league and the (de)serialization that gets
// customSeedWeeks past Firestore's refusal to nest arrays. Constants and the
// storage shape sit together because changing either one is the same job:
// deciding what a season IS.
//
// Split out of lib/league.js, which was itself split out of theme.jsx. One
// 861-line file holding handicaps, standings, seeding, brackets and score
// classification was a big improvement on 1,108 mixed ones, and still coarser
// than Bourbon Cup and WBC, which both split their domain by concern. These
// clusters barely referenced each other, so the split is along seams that were
// already there.
//
// Pure: no React, no Firestore, no DOM.

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

// ── customSeedWeeks Firestore (de)serialization ──────────────────────
// In memory, customSeedWeeks is an array-of-arrays:
//   [ [ {s1,s2}, ... ],  // week 1 pairings
//     [ {s1,s2}, ... ],  // week 2 pairings
//     ... ]
// Firestore rejects directly nested arrays ("Nested arrays are not
// supported"), so any write carrying this raw shape throws and is
// silently swallowed by db.upsert — the edits never persist and reset to
// defaults on reload. We persist each week (an array) as a Firestore-legal
// map { pairs: [...] } and unwrap it on read. Every in-memory reader keeps
// using the nested-array shape. Both helpers are idempotent and tolerant of
// either shape so legacy/partial documents read and re-save safely.
export function serializeSeedWeeks(weeks) {
  if (!Array.isArray(weeks)) return weeks;
  return weeks.map(wk => (Array.isArray(wk) ? { pairs: wk } : wk));
}
export function deserializeSeedWeeks(weeks) {
  if (!Array.isArray(weeks)) return weeks;
  return weeks.map(wk => (wk && Array.isArray(wk.pairs) ? wk.pairs : wk));
}
// Normalize a league_config document loaded from Firestore back into the
// in-memory shape the rest of the app expects.
export function deserializeLeagueConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return cfg;
  if (!("customSeedWeeks" in cfg)) return cfg;
  return { ...cfg, customSeedWeeks: deserializeSeedWeeks(cfg.customSeedWeeks) };
}
