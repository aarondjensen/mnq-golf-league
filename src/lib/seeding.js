// ══════════════════════════════════════════════════════════════════
//  seeding — who plays whom, and in what order.
// ══════════════════════════════════════════════════════════════════
//
// Seed maps for the regular season and the playoffs, the bracket ordering the
// tee sheet reads, which playoff round is "now", and the pairing that gives the
// knocked-out teams a tee time without repeating matchups.
//
// Split out of lib/league.js, which was itself split out of theme.jsx. One
// 861-line file holding handicaps, standings, seeding, brackets and score
// classification was a big improvement on 1,108 mixed ones, and still coarser
// than Bourbon Cup and WBC, which both split their domain by concern. These
// clusters barely referenced each other, so the split is along seams that were
// already there.
//
// Pure: no React, no Firestore, no DOM.

import { buildStandingsForSeed } from "./standings";
import { matchPids } from "./matches";

// ── Bracket position vs. tee position ─────────────────────────────────────
// A playoff week's `matches` array is TEE ORDER: index 0 tees first. It used
// to double as BRACKET order — matchups[0] was the championship, and the next
// round's `winner_0` meant "winner of the first bracket match in the array".
// Those two meanings collided the moment anyone reordered tee times: dragging
// the championship to the last tee slot in Admin silently made it the 3rd-place
// game on the podium and re-pointed the next round's winner references.
//
// `bracketIdx` is now stamped on every bracket match at seed time and holds its
// index in the round's configured matchups. Tee order is free to be anything;
// bracket identity travels with the match. Legacy matches seeded before the
// field existed fall back to array position, which is exactly what they meant.
//
// Callers: the seeders (winner_N / loser_N resolution), and the bracket view
// (matchups[0] is the championship, later ones are placement games).
export function orderByBracketIdx(matches = []) {
  return (matches || [])
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const ai = Number.isInteger(a.m?.bracketIdx) ? a.m.bracketIdx : a.i;
      const bi = Number.isInteger(b.m?.bracketIdx) ? b.m.bracketIdx : b.i;
      return ai !== bi ? ai - bi : a.i - b.i;
    })
    .map(x => x.m);
}

// ── Which playoff round is "now"? ─────────────────────────────────────────
// The first round whose week hasn't been finalized; once every round is done,
// the last round that has one. `playoffWeeks` is the playoff schedule in week
// order, index-aligned to `playoffRounds` exactly the way the bracket view
// aligns them when it builds its columns.
//
// Drives the bracket's opening scroll position. By Round 4 the current round
// sits well off-screen to the right of a horizontally-scrolling bracket, and
// opening on Round 1 mid-playoffs is never what anyone wants. Rounds
// configured without a scheduled week are skipped rather than treated as
// current — opening on an empty column helps nobody.
export function currentPlayoffRoundIdx(playoffRounds = [], playoffWeeks = []) {
  const n = playoffRounds.length;
  if (n <= 1) return 0;
  let lastWithWeek = 0;
  for (let i = 0; i < n; i++) {
    const wk = playoffWeeks[i];
    if (!wk) continue;
    lastWithWeek = i;
    if (wk.locked !== true) return i;
  }
  return lastWithWeek;
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

// ── Shared utility: { teamId -> PLAYOFF seed number (1 = best) } ──
// Playoff seeds are a SEPARATE snapshot from lockedSeeds:
//   • lockedSeeds  → round-robin only (weeks 1–9). Drives the seeded
//                    regular-season weeks. Built by buildSeedMap above.
//   • playoffSeeds → the FULL regular season (round-robin + seeded weeks).
//                    Frozen the moment the regular season finishes and NEVER
//                    recomputed once the playoffs begin — the #1 seed stays #1
//                    through every round, like any other sport.
// Prefers the frozen leagueConfig.playoffSeeds when present + complete.
// Otherwise derives a LIVE preview from full-season standings built ONLY from
// locked, NON-playoff weeks. Playoff-week results are deliberately excluded so
// that even the fallback path can never reseed the bracket mid-playoffs.
export function buildPlayoffSeedMap(teams, matchResults, schedule, leagueConfig) {
  const playoffSeeds = leagueConfig?.playoffSeeds;
  if (playoffSeeds && Array.isArray(playoffSeeds) && playoffSeeds.length === teams.length) {
    const map = {};
    playoffSeeds.forEach((tid, i) => { map[tid] = i + 1; });
    return map;
  }
  const nonPlayoffLocked = new Set(
    (schedule || []).filter(s => s.locked === true && s.isPlayoff !== true).map(s => s.week)
  );
  const rsResults = (matchResults || []).filter(r => r && nonPlayoffLocked.has(r.week));
  const standings = buildStandingsForSeed(teams, rsResults, schedule, leagueConfig?.standingsMethod, false);
  const map = {};
  standings.forEach((s, i) => { map[s.teamId] = i + 1; });
  return map;
}

// Regular-season final seed order (team-id array, index 0 = #1 seed) from the
// FULL regular season — round-robin + seeded weeks, locked non-playoff only.
// Shared by autoSeed's freeze path and Admin's "Lock Playoff Seeds" capture so
// both compute the playoff seeding identically.
export function computeRegularSeasonSeeds(teams, matchResults, schedule, standingsMethod) {
  const nonPlayoffLocked = new Set(
    (schedule || []).filter(s => s.locked === true && s.isPlayoff !== true).map(s => s.week)
  );
  const rsResults = (matchResults || []).filter(r => r && nonPlayoffLocked.has(r.week));
  return buildStandingsForSeed(teams, rsResults, schedule, standingsMethod, false).map(s => s.teamId);
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
export function pairNonBracketTeams(allTeams, bracketMatches, priorMatchups, options = {}) {
  const { optimize = null, coOccurrence = null, teams = null, seedOrder = null, excludeTeamIds = null } = options;

  const bracketTeamIds = new Set();
  (bracketMatches || []).forEach(m => {
    if (m.team1) bracketTeamIds.add(m.team1);
    if (m.team2) bracketTeamIds.add(m.team2);
  });
  // excludeTeamIds: teams that must NOT be paired as teams this week — used
  // when eliminated teams have been dissolved into individual foursomes
  // (individualizeEliminated). They're neither in the bracket nor available
  // for a team consolation match, so drop them from the remaining pool.
  const exclude = excludeTeamIds instanceof Set ? excludeTeamIds : new Set(excludeTeamIds || []);
  const remainingRaw = (allTeams || []).map(t => t.id).filter(id => !bracketTeamIds.has(id) && !exclude.has(id));

  // ── Non-optimize: simple standings-order pairing ──
  // Order the leftover teams by the provided seed/standings order (best→worst)
  // and pair neighbors (1v2, 3v4, …). Odd count → the lowest-ranked leftover
  // draws the bye. No repeat-avoidance — that's exactly what "optimize" adds.
  if (optimize === false) {
    const rank = new Map((seedOrder || []).map((id, i) => [id, i]));
    const ordered = [...remainingRaw].sort((a, b) => {
      const ra = rank.has(a) ? rank.get(a) : Infinity;
      const rb = rank.has(b) ? rank.get(b) : Infinity;
      if (ra !== rb) return ra - rb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const pairs = [];
    for (let i = 0; i + 1 < ordered.length; i += 2) {
      pairs.push({ team1: ordered[i], team2: ordered[i + 1] });
    }
    const bye = ordered.length % 2 === 1 ? ordered[ordered.length - 1] : null;
    return { pairs, bye };
  }

  // ── Optimize (and legacy default): minimum-cost matching ──
  // Deterministic order (team id sort) so re-running produces the same pairings.
  const remaining = [...remainingRaw].sort();
  const n = remaining.length;
  if (n < 2) return { pairs: [], bye: n === 1 ? remaining[0] : null };

  // Cost of pairing two leftover teams into one consolation group:
  //   • optimize === true → minimize repeat PLAYER-pair groupings. Teams i and j
  //     form a new four-player group; the players within each team are already
  //     permanent teammates, so the only NEW co-occurrences are the CROSS pairs
  //     (a player from i with a player from j). Cost = how often those cross
  //     pairs have already shared a group this season (from `coOccurrence`).
  //     This is the finer-grained "haven't played together much".
  //   • otherwise (legacy / no options) → minimize repeat TEAM-vs-TEAM meetings.
  let costIJ;
  if (optimize === true && coOccurrence) {
    const teamById = new Map((teams || []).map(t => [t.id, t]));
    const ck = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
    const crossCost = (idA, idB) => {
      const ta = teamById.get(idA), tb = teamById.get(idB);
      const aP = [ta?.player1, ta?.player2].filter(Boolean);
      const bP = [tb?.player1, tb?.player2].filter(Boolean);
      let c = 0;
      for (const x of aP) for (const y of bP) c += (coOccurrence[ck(x, y)] || 0);
      return c;
    };
    costIJ = (i, j) => crossCost(remaining[i], remaining[j]);
  } else {
    const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
    const counts = {};
    (priorMatchups || []).forEach(m => {
      if (!m.team1 || !m.team2) return;
      const k = pairKey(m.team1, m.team2);
      counts[k] = (counts[k] || 0) + 1;
    });
    costIJ = (i, j) => counts[pairKey(remaining[i], remaining[j])] || 0;
  }

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

// Count how often each PAIR of players has shared a group (tee time / match)
// across every prior week. A "group" is a match's roster, resolved via matchPids
// so it honors explicit consolation `players` arrays as well as team rosters.
// Used by the "optimize" consolation mode to pair leftover teams so their players
// have played together the least. Keyed by canonical "pidA|pidB" (sorted).
export function buildPlayerCoOccurrence(schedule, currentWeek, teams) {
  const counts = {};
  const key = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
  (schedule || []).forEach(wk => {
    if (typeof wk.week !== "number" || wk.week >= currentWeek) return;
    if (wk.rainedOut) return;
    (wk.matches || []).forEach(m => {
      const pids = matchPids(m, teams);
      for (let i = 0; i < pids.length; i++) {
        for (let j = i + 1; j < pids.length; j++) {
          const k = key(pids[i], pids[j]);
          counts[k] = (counts[k] || 0) + 1;
        }
      }
    });
  });
  return counts;
}
