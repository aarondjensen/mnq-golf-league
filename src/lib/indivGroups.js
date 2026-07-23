// ══════════════════════════════════════════════════════════════════
//  indivGroups — playoff individual-group (foursome) support.
// ══════════════════════════════════════════════════════════════════
//
// Why this file exists
// ────────────────────
// Once a TEAM is knocked out of the match-play bracket, its two players are
// no longer a "team" for pairing purposes. The commissioner can opt to
// dissolve every eliminated team into the INDIVIDUAL pool and regroup those
// players into fresh foursomes ordered by REVERSE individual-tournament
// standing (worst cumulative net tees off first). Still-alive bye teams keep
// playing as teams; only eliminated teams individualize. See the three-way
// split in scheduleAutoSeed.js / Admin.handleSeedWeek.
//
// Everything here is pure (no React, no Firestore) so it can be unit-tested
// and shared by BOTH auto-seed resolvers without divergence — the same
// duplicate-resolver discipline the bracket logic already follows.
//
// Single source of truth
// ──────────────────────
// `computeIndividualBoard` is the canonical cumulative-net calc for the
// individual tournament. Standings.jsx's IndividualEventView consumes the
// SAME function so the leaderboard the players see and the ordering the
// pairing uses can never drift. It is a faithful port of the net-to-par math
// that lived inline in IndividualEventView: per-round handicap resolved from
// history BEFORE that week, net-to-par over holes actually played, integer
// end-to-end so per-round values sum to the cumulative totals exactly.

import { calcPlayerHcp, resolveIndivRound } from "../theme";
import { buildStrokesMap } from "./matchCalc";

// ── computeIndividualBoard ─────────────────────────────────────────
// Canonical individual-tournament board. Returns ONE row per player with the
// cumulative ranking metrics; the caller decides how to sort/slice.
//
// Params (all read-only):
//   players       — [{ id, name, handicapIndex }]
//   scores        — flat hole-score map keyed `w{week}_p{pid}_h{hole}` plus the
//                   makeup / withdrawal namespaces resolveIndivRound reads.
//   playoffWeeks  — the playoff weeks to accumulate over, ALREADY sorted and
//                   filtered by the caller. To rank "as of" a given week, pass
//                   only the weeks STRICTLY BEFORE it.
//   course        — { frontPars, backPars, frontHcps, backHcps }
//   scoringRules  — { hcpRecentCount, hcpBestCount }
//   allRounds     — { [pid]: [{ season, week, ... }] } rounds history for the
//                   retroactive per-week handicap (same source recalcHandicaps
//                   feeds p.handicapIndex from).
//   leagueConfig  — { year } for the season stamp on the handicap lookup.
//
// Returns: [{
//   pid, name, totalNetToPar, totalGrossToPar, totalGross,
//   roundsPlayed, totalHolesPlayed, withdrew, wdRound, startHcp
// }]  — UNSORTED (input order).
export function computeIndividualBoard({
  players = [],
  scores = {},
  playoffWeeks = [],
  course = null,
  scoringRules = null,
  allRounds = null,
  leagueConfig = null,
}) {
  if (!course || !players.length || !playoffWeeks.length) {
    // No course or no rounds to accumulate — every player is a zero row so
    // downstream ranking still has stable, deterministic input.
    return players.map(p => ({
      pid: p.id, name: p.name || "",
      totalNetToPar: 0, totalGrossToPar: 0, totalGross: 0,
      roundsPlayed: 0, totalHolesPlayed: 0,
      withdrew: false, wdRound: null,
      startHcp: p.handicapIndex ?? 0,
    }));
  }

  const frontPars = course.frontPars || [];
  const frontPar = frontPars.reduce((a, b) => a + b, 0);
  const recentN = scoringRules?.hcpRecentCount ?? 8;
  const bestN = scoringRules?.hcpBestCount ?? 6;
  const season = leagueConfig?.year || new Date().getFullYear();

  // Player's 9-hole handicap as of RIGHT BEFORE (season, week), using only
  // rounds strictly before that point — matches App.jsx:recalcHandicaps, the
  // single source of truth for p.handicapIndex everywhere else.
  const handicapBeforeWeek = (p, asOfSeason, asOfWeek) => {
    const priorRounds = ((allRounds && allRounds[p.id]) || []).filter(r =>
      r.season < asOfSeason || (r.season === asOfSeason && r.week < asOfWeek)
    );
    const idx = calcPlayerHcp(priorRounds, recentN, bestN, frontPar);
    return idx ?? (p.handicapIndex ?? 0);
  };

  const sortedWeeks = [...playoffWeeks].sort((a, b) => a.week - b.week);
  const firstWk = sortedWeeks[0];

  return players.map(p => {
    let totalGross = 0;
    let totalNetToPar = 0;
    let totalGrossToPar = 0;
    let totalHolesPlayed = 0;
    let roundsPlayed = 0;

    // Stable tournament-reference handicap (into Round 1), for display parity
    // with the leaderboard HCP column. Falls back to current index pre-tourney.
    const startHcp = firstWk
      ? handicapBeforeWeek(p, season, firstWk.week)
      : (calcPlayerHcp((allRounds && allRounds[p.id]) || [], recentN, bestN, frontPar) ?? (p.handicapIndex ?? 0));

    let withdrew = false;
    let wdRound = null;

    for (const wk of sortedWeeks) {
      const side = wk.side || "front";
      const ir = resolveIndivRound(scores, wk.week, p.id);

      if (ir.withdrawn && !withdrew) {
        withdrew = true;
        wdRound = wk.week;
      }
      if (withdrew) continue;
      if (ir.mode === "none") continue;

      const gross = ir.gross;
      const holesPlayed = ir.holesPlayed;
      const playedHoles = Object.keys(ir.holes || {}).map(Number);
      const roundHcp = handicapBeforeWeek(p, season, wk.week);

      const sideHcps = side === "front" ? course?.frontHcps : course?.backHcps;
      const hcps = (Array.isArray(sideHcps) && sideHcps.length === 9)
        ? sideHcps
        : [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const sidePars = side === "front" ? course?.frontPars : course?.backPars;
      const pars = (Array.isArray(sidePars) && sidePars.length === 9)
        ? sidePars
        : [4, 4, 4, 3, 5, 4, 4, 3, 5];

      let parPlayed, signedStrokes;
      if (ir.totalOnly) {
        parPlayed = pars.reduce((a, b) => a + b, 0);
        signedStrokes = roundHcp;
      } else {
        const strokeMap = buildStrokesMap(roundHcp, hcps);
        let strokesOnPlayed = 0;
        for (const h of playedHoles) strokesOnPlayed += strokeMap[h] || 0;
        signedStrokes = roundHcp < 0 ? -strokesOnPlayed : strokesOnPlayed;
        parPlayed = 0;
        for (const h of playedHoles) parPlayed += pars[h] || 4;
      }
      const netToPar = gross - parPlayed - signedStrokes;
      const grossToPar = gross - parPlayed;

      totalGross += gross;
      totalNetToPar += netToPar;
      totalGrossToPar += grossToPar;
      totalHolesPlayed += holesPlayed;
      roundsPlayed++;
    }

    return {
      pid: p.id, name: p.name || "",
      totalNetToPar, totalGrossToPar, totalGross,
      roundsPlayed, totalHolesPlayed,
      withdrew, wdRound, startHcp,
    };
  });
}

// ── rankIndividualBoard ────────────────────────────────────────────
// Turn a board into an ordered list of pids, BEST → WORST — i.e. leaderboard
// order (rank #1 first). This is exactly the order the leaderboard renders in
// its Net lens, so "reverse of the leaderboard" downstream is just this
// reversed.
//
// Ordering, best → worst:
//   1. Players who have posted at least one round, by totalNetToPar ascending
//      (lower = better). Tie-break: more holes played, then name, then pid.
//   2. Players who have not posted a round yet (roundsPlayed === 0, not WD).
//   3. Withdrawn players last (they're out of contention).
export function rankIndividualBoard(board = []) {
  const bucketOf = (r) => (r.withdrew ? 2 : r.roundsPlayed > 0 ? 0 : 1);
  return [...board].sort((a, b) => {
    const ba = bucketOf(a), bb = bucketOf(b);
    if (ba !== bb) return ba - bb;
    if (ba === 0) {
      if (a.totalNetToPar !== b.totalNetToPar) return a.totalNetToPar - b.totalNetToPar;
      if (a.totalHolesPlayed !== b.totalHolesPlayed) return b.totalHolesPlayed - a.totalHolesPlayed;
    }
    const an = a.name || "", bn = b.name || "";
    if (an !== bn) return an < bn ? -1 : 1;
    return a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0;
  }).map(r => r.pid);
}

// ── computeEliminatedTeamIds ───────────────────────────────────────
// A team is ELIMINATED once it has LOST a bracket match in any playoff week
// strictly BEFORE `uptoWeek`. Consolation and individual-group matches never
// count — only real bracket matches feed elimination, mirroring how bracket
// progression already isolates them (isConsolation / isIndivGroup flags).
//
// Tie handling matches the bracket: a TIED result advances team1 (the higher
// seed), so team2 is the loser on a tie.
//
// Returns a Set of eliminated team ids.
export function computeEliminatedTeamIds({ schedule = [], matchResults = [], uptoWeek }) {
  const elim = new Set();
  const weeks = (schedule || [])
    .filter(s => s.isPlayoff === true && typeof s.week === "number" && s.week < uptoWeek)
    .sort((a, b) => a.week - b.week);

  for (const wk of weeks) {
    const bracket = (wk.matches || []).filter(
      m => !m.isConsolation && !m.isIndivGroup && m.team1 && m.team2
    );
    for (const m of bracket) {
      const r = (matchResults || []).find(
        x => x.week === wk.week && x.team1Id === m.team1 && x.team2Id === m.team2
      );
      if (!r) continue;
      const d = (r.team1Points || 0) - (r.team2Points || 0);
      const loser = d >= 0 ? m.team2 : m.team1;
      if (loser) elim.add(loser);
    }
  }
  return elim;
}

// ── pairEliminatedIndividuals ──────────────────────────────────────
// Group eliminated players into foursomes by REVERSE leaderboard order (worst
// cumulative net first). `rankOrderPids` is the full BEST→WORST leaderboard
// order (from rankIndividualBoard); we reverse it and chunk the eliminated
// pool into groups of four.
//
// Eliminations happen a whole TEAM (two players) at a time, so the eliminated
// pool is always even → a group is a foursome or, at most, a trailing
// twosome; never a threesome or a lone single. The final-single guard is
// purely defensive (bad data): a stray odd player merges up rather than tee
// off alone.
//
// Returns an array of groups, each an array of 2–4 pids, in tee order
// (worst-ranked group first).
export function pairEliminatedIndividuals(eliminatedPids = [], rankOrderPids = []) {
  const clean = (eliminatedPids || []).filter(Boolean);
  if (clean.length === 0) return [];

  // Lower rank index = better (nearer the top of the leaderboard).
  const rank = new Map((rankOrderPids || []).map((pid, i) => [pid, i]));
  const ordered = [...clean].sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : Infinity;
    const rb = rank.has(b) ? rank.get(b) : Infinity;
    // REVERSE leaderboard: worst (highest rank index) first.
    if (ra !== rb) return rb - ra;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const groups = [];
  for (let i = 0; i < ordered.length; i += 4) {
    groups.push(ordered.slice(i, i + 4));
  }
  // Defensive: a lone trailing single (only possible with malformed input)
  // merges into the previous group so nobody tees off alone.
  if (groups.length > 1 && groups[groups.length - 1].length === 1) {
    const last = groups.pop();
    groups[groups.length - 1].push(...last);
  }
  return groups;
}

// ── buildEliminatedIndivGroups ─────────────────────────────────────
// Convenience the resolvers call: given everything needed to rank the field
// and identify eliminated teams for `week`, produce the ready-to-write
// individual-group matches plus the eliminated-team set (so the caller can
// exclude those teams from the alive-bye team consolation pairing).
//
// An individual-group match is shaped:
//   { players: [pid,pid,pid(,pid)], isConsolation: true, isIndivGroup: true }
// — isConsolation keeps it in the non-bracket bucket (tees before the bracket,
// never feeds progression); isIndivGroup drives the individual rendering /
// scoring path. There is NO team1/team2 and NO match result.
//
// Returns { indivMatches, eliminatedTeamIds, eliminatedPids }.
export function buildEliminatedIndivGroups({
  week,
  teams = [],
  schedule = [],
  matchResults = [],
  players = [],
  scores = {},
  course = null,
  scoringRules = null,
  allRounds = null,
  leagueConfig = null,
}) {
  const eliminatedTeamIds = computeEliminatedTeamIds({ schedule, matchResults, uptoWeek: week });

  const eliminatedPids = [];
  for (const t of teams || []) {
    if (!eliminatedTeamIds.has(t.id)) continue;
    if (t.player1) eliminatedPids.push(t.player1);
    if (t.player2) eliminatedPids.push(t.player2);
  }
  if (eliminatedPids.length === 0) {
    return { indivMatches: [], eliminatedTeamIds, eliminatedPids: [] };
  }

  // Rank off the SAME cumulative-net calc the leaderboard uses, accumulated
  // over completed playoff weeks strictly before this one.
  const priorPlayoffWeeks = (schedule || [])
    .filter(wk => wk.isPlayoff === true && !wk.rainedOut && wk.week < week && (wk.matches?.length > 0))
    .sort((a, b) => a.week - b.week);
  const board = computeIndividualBoard({
    players, scores, playoffWeeks: priorPlayoffWeeks,
    course, scoringRules, allRounds, leagueConfig,
  });
  const rankOrderPids = rankIndividualBoard(board);

  const groups = pairEliminatedIndividuals(eliminatedPids, rankOrderPids);
  const indivMatches = groups.map(g => ({
    players: g,
    isConsolation: true,
    isIndivGroup: true,
  }));

  return { indivMatches, eliminatedTeamIds, eliminatedPids };
}
