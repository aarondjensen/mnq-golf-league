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
// 1st (index 0) to last. Field `gp` (games played) is retained for
// completeness (the old record-mode sort computed win % from it); no
// consumer outside this file reads it directly.
//
// Tiebreaker chains
// ─────────────────
// `points` mode (default):
//     1. higher total points
//     2. more holes won (hw)
//
// `record` mode (`standingsMethod === "record"`):
//     1. higher record points (2 per win, 1 per tie — see recordPoints)
//     2. more holes won (hw)
//     3. head-to-head record points among the tied teams, if applicable
//        (mini-table over matches within the tied group; see the inline
//        comment in buildStandingsForSeed for why it's not pairwise).
//
// W/L/T comes from match-play result via `resultLetterFor`, NOT from a points
// comparison. In lowHighBonus and legacy teamNetTotal data a TIED match-play
// row can carry asymmetric points (e.g. bonus split unevenly), and using the
// points delta would falsely give one team a W and the other an L on a tied
// match. Standings still SORT by points in points mode, so unequal points
// still drive ranking — only the W-L-T column is corrected.
// ── Canonical "who plays in this match" resolver ──────────────────────────
// Regular and bracket matches derive their four players from the two team
// records (team1/team2). Consolation matches — the non-bracket playoff matches
// for knocked-out teams — may instead carry an explicit `players` array, since
// those players can be re-paired into ad-hoc groups that ignore team lines.
// When `players` is present it wins; otherwise we fall back to the team rosters.
// Single source of truth so scoring, the Low Net board, and the individual
// tournament always agree on a match's roster regardless of how it was formed.
// `match.sides` (optional) holds the competing sub-groups, e.g. [[pA,pB],[pC,pD]]
// for a 2v2; absent means the group shares a tee time with no head-to-head.
export function matchPids(match, teams) {
  if (!match) return [];
  if (Array.isArray(match.players) && match.players.length) {
    return match.players.filter(Boolean);
  }
  const t1 = (teams || []).find(t => t.id === match.team1);
  const t2 = (teams || []).find(t => t.id === match.team2);
  return [t1?.player1, t1?.player2, t2?.player1, t2?.player2].filter(Boolean);
}

// ── Individual-event makeup rounds & withdrawals (Path 2 namespace) ────────
// Playoff edge case: a player who can't play on League Night is marked absent
// so their TEAM match proceeds with the present teammate covering both slots
// (the _habsent sentinel). Match play can't be made up — it's head-to-head and
// time-bound. Their INDIVIDUAL tournament round CAN be made up on another day,
// and that makeup round must also feed the player's handicap.
//
// Those two truths (absent for the match / played a real round for the event)
// would collide if they shared the _h{0..8} + _habsent keys, so the makeup
// round lives in its OWN key namespace inside league_hole_scores. The team
// match never reads these, so a makeup can never disturb an already-decided
// match. Each rides in as a normal hole-score doc via saveScore(week, pid,
// hole, score) — the `hole` field is what distinguishes them:
//
//   hole "m0".."m8"  →  key _hm0.._hm8   — a full (or partial) 9-hole makeup card
//   hole "mtotal"    →  key _hmtotal     — a total-only makeup (gross only, no holes)
//   hole "indivwd"   →  key _hindivwd    — explicit withdrawal from the event (=1)
//
// A makeup round (hole card OR total) counts toward BOTH the individual
// leaderboard and the handicap calc (calcPlayerHcp needs a gross, not per-hole
// detail). A total-only makeup counts everywhere a gross suffices but is
// intentionally invisible to the per-hole Stats boards — there's no
// distribution to attribute and fabricating one would inject fake birdies/pars.
// Withdrawal (_hindivwd) is the SINGLE SOURCE OF TRUTH for "out of the
// individual event"; the view no longer infers withdrawal from _habsent.
export const IND_MAKEUP_HOLE_RE = /^m[0-8]$/;   // "m0".."m8"
export const IND_MAKEUP_TOTAL = "mtotal";       // hole value for a total-only makeup
export const IND_WITHDRAW = "indivwd";          // hole value for the withdrawal sentinel
export const IND_ABSENT = "absent";             // hole value for the team-match absent sentinel

// Classify a raw hole-score doc's `hole` field into a score-type tag. Used by
// App.jsx:aggregateRounds (doc shape) so makeup / withdrawal / absent docs are
// no longer miscounted as ordinary holes:
//   'real'         — a normal 0..8 hole that builds the League-Night round
//   'makeupHole'   — one hole of a 9-hole makeup card
//   'makeupTotal'  — a total-only makeup (its score IS the round gross)
//   'withdraw'     — the individual-event withdrawal sentinel (not a score)
//   'absent'       — the team-match absent sentinel (not a score)
//   'ignore'       — anything unrecognized (never counted)
export function classifyScoreHole(hole) {
  if (typeof hole === "number") return (hole >= 0 && hole <= 8) ? "real" : "ignore";
  const s = String(hole);
  if (/^[0-8]$/.test(s)) return "real";
  if (s === IND_ABSENT) return "absent";
  if (s === IND_WITHDRAW) return "withdraw";
  if (s === IND_MAKEUP_TOTAL) return "makeupTotal";
  if (IND_MAKEUP_HOLE_RE.test(s)) return "makeupHole";
  return "ignore";
}

// Resolve a player's individual-event round for a given week from the FLAT
// score map (the { `w{week}_p{pid}_h{hole}`: score } shape used by Scoring,
// Standings' live leaderboard, and Stats). Read-side single source of truth,
// mirroring classifyScoreHole on the doc side so the two can never drift.
//
// Returns { withdrawn, mode, holes, gross, holesPlayed, totalOnly }:
//   withdrawn   — player withdrew from the event this week (independent of scores)
//   mode        — 'live' | 'makeupHoles' | 'makeupTotal' | 'none'
//   holes       — { [h]: grossOnHole } for holes with a score ({} for total-only)
//   gross       — round gross (sum of holes, or the entered total)
//   holesPlayed — count of holes with a score (9 for total-only: it's a full round)
//   totalOnly   — true when the round is a bare total with no hole detail
//
// Resolution order: a real League-Night card (any _h{0..8}) wins; then a
// makeup hole card (_hm{0..8}); then a total-only makeup (_hmtotal). Withdrawal
// is reported independently so a withdrawn player ranks WD even if a stray
// prior score exists.
export function resolveIndivRound(scores, week, pid) {
  const at = (suffix) => scores[`w${week}_p${pid}_h${suffix}`];
  const withdrawn = at(IND_WITHDRAW) === 1;

  // Real League-Night holes (0-indexed h=0..8).
  const realHoles = {};
  let realCount = 0, realGross = 0;
  for (let h = 0; h <= 8; h++) {
    const s = at(h);
    if (s && s > 0) { realHoles[h] = s; realCount++; realGross += s; }
  }
  if (realCount > 0) {
    return { withdrawn, mode: "live", holes: realHoles, gross: realGross, holesPlayed: realCount, totalOnly: false };
  }

  // Makeup hole card.
  const mkHoles = {};
  let mkCount = 0, mkGross = 0;
  for (let h = 0; h <= 8; h++) {
    const s = at(`m${h}`);
    if (s && s > 0) { mkHoles[h] = s; mkCount++; mkGross += s; }
  }
  if (mkCount > 0) {
    return { withdrawn, mode: "makeupHoles", holes: mkHoles, gross: mkGross, holesPlayed: mkCount, totalOnly: false };
  }

  // Total-only makeup — a full round with no per-hole detail.
  const total = at(IND_MAKEUP_TOTAL);
  if (total && total > 0) {
    return { withdrawn, mode: "makeupTotal", holes: {}, gross: total, holesPlayed: 9, totalOnly: true };
  }

  return { withdrawn, mode: "none", holes: {}, gross: 0, holesPlayed: 0, totalOnly: false };
}

// ── Canonical record-points scale ─────────────────────────────────────────
// Standings points derive from the match-play record: 2 per win, 1 per tie,
// 0 per loss — whole numbers by design so the Standings Pts column never
// shows decimals. Deliberately NOT tied to scoringRules.matchWin/matchTie
// (those price the individual match lines in lowHighBonus scoring, 3/1.5)
// and NOT the stored per-match team points (which sum three independent
// point lines per week). Single source of truth: Standings display and the
// record-mode sort below both call recordPoints so they can never disagree.
// If this scale ever needs to be commissioner-configurable, add record-
// points fields to leagueConfig and cfgFromLeague rather than reusing the
// match-line rules.
export const RECORD_PTS_WIN = 2;
export const RECORD_PTS_TIE = 1;
export const recordPoints = (s) => (s?.w || 0) * RECORD_PTS_WIN + (s?.t || 0) * RECORD_PTS_TIE;

export function buildStandingsForSeed(teams, matchResults, schedule, standingsMethod, lockedOnly = true) {
  const pts = {};
  teams.forEach(t => { pts[t.id] = { teamId: t.id, points: 0, w: 0, l: 0, t: 0, hw: 0, gp: 0 }; });
  // Per-match result letters, captured under the same lockedOnly filter as
  // the season totals — consumed by the record-mode head-to-head tiebreaker
  // below so h2h can never be built from a different result set than the
  // standings themselves.
  const h2hRows = [];
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
    if (pts[r.team1Id] && pts[r.team2Id]) h2hRows.push({ t1: r.team1Id, t2: r.team2Id, l1: t1Letter, l2: t2Letter });
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
    // Record-mode chain — 3 steps:
    //   1. higher record points (2 per win, 1 per tie — recordPoints above)
    //   2. more holes won (hw)
    //   3. head-to-head record points among the tied teams (if applicable)
    //
    // Step 1+2 replaced the older 4-step win % chain ((w + 0.5*t)/gp →
    // wins → losses → hw). Win % and record points order identically when
    // every team has the same games played, but diverge with unequal gp
    // (rainouts / makeups) — the league counts absolute points, not
    // percentage.
    //
    // Step 3 is NOT a pairwise comparator — with 3+ tied teams, pairwise
    // h2h can be non-transitive (A beat B, B beat C, C beat A) and would
    // make Array.sort order-dependent. Instead: sort by steps 1–2, then
    // partition into groups tied on BOTH, and within each group build a
    // mini-table of record points counting only matches where both teams
    // are in the tied group. Teams still tied after that keep their
    // existing order (sort is stable in all modern engines).
    //
    // If your league has `lockedSeeds` set in leagueConfig (Admin → Config
    // → Lock Seeds toggle), and that snapshot was captured under the older
    // chain, Schedule's seeding can disagree with Standings's live
    // ordering. The fix is to recompute the snapshot:
    //   • Admin → Config → toggle Lock Seeds off, then back on, OR
    //   • Firestore console → edit league_2026_config → delete the
    //     `lockedSeeds` field (buildSeedMap falls through to live compute)
    arr.sort((a, b) => recordPoints(b) - recordPoints(a) || b.hw - a.hw);
    const resolved = [];
    let i = 0;
    while (i < arr.length) {
      let j = i + 1;
      while (j < arr.length && recordPoints(arr[j]) === recordPoints(arr[i]) && arr[j].hw === arr[i].hw) j++;
      const group = arr.slice(i, j);
      if (group.length > 1) {
        const ids = new Set(group.map(g => g.teamId));
        const h2h = {};
        group.forEach(g => { h2h[g.teamId] = 0; });
        h2hRows.forEach(m => {
          if (!ids.has(m.t1) || !ids.has(m.t2)) return;
          h2h[m.t1] += m.l1 === "W" ? RECORD_PTS_WIN : m.l1 === "T" ? RECORD_PTS_TIE : 0;
          h2h[m.t2] += m.l2 === "W" ? RECORD_PTS_WIN : m.l2 === "T" ? RECORD_PTS_TIE : 0;
        });
        group.sort((a, b) => h2h[b.teamId] - h2h[a.teamId]);
      }
      resolved.push(...group);
      i = j;
    }
    return resolved;
  } else {
    arr.sort((a, b) => b.points - a.points || b.hw - a.hw);
  }
  return arr;
}

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
  const { optimize = null, coOccurrence = null, teams = null, seedOrder = null } = options;

  const bracketTeamIds = new Set();
  (bracketMatches || []).forEach(m => {
    if (m.team1) bracketTeamIds.add(m.team1);
    if (m.team2) bracketTeamIds.add(m.team2);
  });
  const remainingRaw = (allTeams || []).map(t => t.id).filter(id => !bracketTeamIds.has(id));

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
