// ══════════════════════════════════════════════════════════════════
//  handicap — what a player plays off, and what they played off then.
// ══════════════════════════════════════════════════════════════════
//
// Course handicaps, including the retroactive question: what was this player
// carrying GOING INTO week W? Standings, seeding and every scorecard depend on
// the answer, and getting it from "now" instead of "then" silently re-scores
// finished weeks.
//
// Split out of lib/league.js, which was itself split out of theme.jsx. One
// 861-line file holding handicaps, standings, seeding, brackets and score
// classification was a big improvement on 1,108 mixed ones, and still coarser
// than Bourbon Cup and WBC, which both split their domain by concern. These
// clusters barely referenced each other, so the split is along seams that were
// already there.
//
// Pure: no React, no Firestore, no DOM.

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

// ── Retroactive handicap: what was this player's HCP at the start of week W? ──
// Used wherever a historical match needs to be recomputed (autoHeal,
// individual leaderboard, week-comparison views, etc.). Filters
// allRoundsByPid to rounds played strictly before (season, week), then
// runs the same calcPlayerHcp routine that recalcHandicaps uses live.
// Returns null if the player has no prior rounds — callers should fall
// back to the player's current handicapIndex in that case.
//
// Critical correctness property: match outcomes computed using this
// retroactive HCP will match the outcomes that were active when the
// match was originally played, regardless of how handicaps drift later.
// This is what makes locked-week results stable even as new weeks are
// played and current handicaps shift.
export function getPlayerHcpAtWeek({ playerId, week, season, allRoundsByPid, recentN, bestN, frontPar }) {
  if (!allRoundsByPid || !playerId) return null;
  const playerRounds = allRoundsByPid[playerId] || [];
  const priorRounds = playerRounds.filter(r =>
    r.season < season || (r.season === season && r.week < week)
  );
  return calcPlayerHcp(priorRounds, recentN, bestN, frontPar);
}

// ── Single source of truth: one player's hcp GOING INTO a given week ──
// The shared fallback chain used everywhere a historical handicap is needed
// (scorecards, match recompute, stat boards): retroactive calc → sticky
// startingHandicapIndex → current handicapIndex. Returns a raw (unrounded)
// number; callers that display integers apply their own Math.round. Pass
// allRoundsByPid === null while round history is loading — the retro calc is
// skipped and the next fallback applies.
export function resolvePlayerHcpForWeek({ player, week, season, allRoundsByPid, scoringRules, course }) {
  if (!player) return 0;
  const recentN = scoringRules?.hcpRecentCount ?? 8;
  const bestN = scoringRules?.hcpBestCount ?? 6;
  const frontPar = (course?.frontPars || []).reduce((a, b) => a + b, 0) || 36;
  const retro = allRoundsByPid ? getPlayerHcpAtWeek({
    playerId: player.id,
    week,
    season,
    allRoundsByPid,
    recentN, bestN, frontPar,
  }) : null;
  if (retro !== null) return retro;
  if (player.startingHandicapIndex !== undefined && player.startingHandicapIndex !== null && player.startingHandicapIndex !== "") {
    return parseFloat(player.startingHandicapIndex);
  }
  return player.handicapIndex ?? 0;
}

// ── Single source of truth: players rewound to their GOING-INTO-WEEK hcps ──
// Returns a copy of `players` where each player's handicapIndex is replaced
// with the value they carried into `week` of `season` (via the shared
// resolvePlayerHcpForWeek chain). This is THE shared builder every historical
// scorecard / match-status renderer (Schedule, Standings) must use so they
// all agree with the result that was signed live — current handicaps drift as
// later weeks are played, which is why rendering a past match with today's
// hcps shows wrong stroke dots, hcp pills, NET totals, and a desynced MATCH
// row. Pass allRoundsByPid === null while round history is still loading; the
// retro calc is skipped and players fall back to startingHandicapIndex (or
// current), matching prior behavior. Stats.jsx uses the per-player
// resolvePlayerHcpForWeek directly since it needs many weeks for one player.
export function buildHistoricalPlayers({ players, week, season, allRoundsByPid, scoringRules, course }) {
  if (!players) return players;
  return players.map(p => ({
    ...p,
    handicapIndex: resolvePlayerHcpForWeek({ player: p, week, season, allRoundsByPid, scoringRules, course }),
  }));
}
