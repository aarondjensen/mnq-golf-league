// ══════════════════════════════════════════════════════════════════
//  league.js — the league domain: handicaps, standings, seeding, brackets.
// ══════════════════════════════════════════════════════════════════
//
// All of this used to live in theme.jsx, above the design tokens and the shared
// components. Being in a .jsx file next to JSX meant none of it could be
// imported without dragging React in behind it, and the two concerns had no
// business sharing a module in the first place — this is the rules of the
// competition, and that was a palette.
//
// It is pure: no React, no Firestore, no DOM. That is what makes the standings
// sort, the seed map and the bracket ordering testable, and they are the
// highest-leverage functions in the app — the Standings rank, the playoff seed
// map, the auto-seed pairings and bracket positioning all sit downstream of
// them. See league.test.js.
//
// Bourbon Cup and WBC both keep their domain under src/lib/. This is that.

// ══════════════════════════════════════════════════════════════
//  CONSTANTS & UTILITIES
// ══════════════════════════════════════════════════════════════
import { resultLetterFor } from "./matchCalc";

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

// ── Shared utility: "Aaron Jensen" → "A. Jensen" ──
//
// The compact form for anywhere a full name won't fit but a bare last
// name is ambiguous — two Jensens in a league is not hypothetical.
//
// This exact expression was already written out inline in
// IndividualLeaderboard and Admin; the fun-round tee sheet would have
// been a third copy. (Schedule has a deliberately DIFFERENT rule — it
// only adds the initial when two players share a last name — so it is
// not this function and shouldn't be folded into it.)
//
// A single-word name is returned unchanged: "Cher" has no last name to
// abbreviate toward, and "C. Cher" would be worse than useless.
export function initialLastName(fullName) {
  if (!fullName) return "";
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
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

// ── Individual-group predicate ────────────────────────────────────────────
// An individual group is a playoff tee time for players whose TEAM has been
// knocked out of the bracket (see lib/indivGroups.js). It carries a `players`
// array and NO team1/team2, because there is no head-to-head match — the four
// golfers just post individual net rounds for the individual tournament.
//
// Consequences every caller has to respect:
//   • There is no match_result document, and there never will be. Any
//     "does every match have a result / is every match attested" check must
//     skip these or the week can never be finalized.
//   • Team-shaped rendering (two halves, seeds, W-L-T records, match-play
//     center strip) has nothing to draw — `teams.find(t => t.id === undefined)`
//     resolves to undefined and the card renders as "TBD".
//
// Lives here rather than in lib/indivGroups.js so the cheap predicate is
// available to App.jsx / Admin.jsx / Schedule.jsx without pulling in the
// individual-board math those files never use.
export function isIndivGroupMatch(match) {
  return match?.isIndivGroup === true;
}

// ── Individual-group signature records ────────────────────────────────────
// An individual group signs and attests its scorecard exactly like a match
// does — the individual tournament is a real competition, so a group's card
// gets the same two-person integrity check before the week locks.
//
// The record lives in its own `league_group_results` collection rather than
// in league_match_results. A group record has no team1Id/team2Id, and the app
// is full of `find(r => r.team1Id === m.team1 && r.team2Id === m.team2)`
// lookups; for an individual group `m.team1` is undefined, so a teamless
// record sitting in the same collection would satisfy `undefined === undefined`
// and get paired with the wrong row. Separate collection, no ambiguity.
//
// Keyed by the SORTED player set, not by array index: a group's position in
// the week's match list shifts whenever the week is re-seeded, but its roster
// is what identifies it. A re-seed that changes the roster produces a
// different key, so a stale signature can never be mistaken for a current one.
export function indivGroupKey(match) {
  const pids = Array.isArray(match?.players) ? match.players.filter(Boolean) : [];
  return [...pids].sort().join("-");
}

export function indivGroupResultId(leagueId, week, match) {
  return `${leagueId}_w${week}_g${indivGroupKey(match)}`;
}

// Find the signature record for a given group in a given week, if any.
export function findGroupResult(groupResults, week, match) {
  const key = indivGroupKey(match);
  if (!key) return null;
  return (groupResults || []).find(g => g.week === week && indivGroupKey(g) === key) || null;
}

// "Every match AND every individual group in this week is signed and
// attested." Both halves gate the week: the bracket decides who advances,
// the individual groups feed the individual tournament, and neither should
// lock on unverified cards.
//
// A week with nothing at all to attest returns false — there's no signature
// to wait on, so it isn't "ready to finalize" on the strength of attestation.
//
// Shared by App.jsx's finalize banner, Admin.jsx's week list and Scoring's
// finalize pre-flight so they can never disagree about which week the
// commissioner is being told to finalize.
export function weekFullyAttested(wk, matchResults, groupResults) {
  const all = wk?.matches || [];
  if (all.length === 0) return false;
  return all.every(m => isIndivGroupMatch(m)
    ? findGroupResult(groupResults, wk.week, m)?.attested === true
    : (matchResults || []).some(r =>
        r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2 && r.attested === true
      )
  );
}

// "Every match AND every individual group in this week has a SIGNED result."
// Weaker than weekFullyAttested — attestation not required. Used by the
// finalize action's safety guard, which exists to stop a week being locked
// before it's been played.
export function weekFullyScored(wk, matchResults, groupResults) {
  const all = wk?.matches || [];
  if (all.length === 0) return false;
  return all.every(m => isIndivGroupMatch(m)
    ? !!findGroupResult(groupResults, wk.week, m)
    : (matchResults || []).some(r =>
        r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2
      )
  );
}

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
