// ══════════════════════════════════════════════════════════════════
//  autoHealMatchResults — opportunistic drift correction for
//  saved match_result documents.
// ══════════════════════════════════════════════════════════════════
//
// Why this exists
// ───────────────
// Each match_result document on Firestore is a SNAPSHOT of the
// match-play calculation at the moment Sign Scorecard fired (or
// Schedule → Edit Scores → Save & Re-sign re-snapshotted it). The
// expanded scorecard, by contrast, ALWAYS recomputes live from the
// current hole_scores. Three things can leave the saved snapshot
// out of step with what computeMatchResult would now produce:
//
//   1. Legacy code paths. Records signed long ago under earlier
//      matchCalc.js logic that has since been corrected (e.g. the
//      lowHighBonus tied-match-with-asymmetric-points fix).
//   2. Retroactive config changes. A commissioner editing scoring
//      rules mid-season changes how every prior week's points are
//      meant to be tallied.
//   3. Rare write races leaving a partial save behind.
//
// In any of those cases the match summary row would show the saved
// (drifted) values while the expanded scorecard shows the recomputed
// (correct) values for the same match — a disorienting inconsistency.
//
// What this does
// ──────────────
// For every match_result the caller has scores for in their local
// cache, recompute the calc and compare against the saved fields.
// On drift, write a corrected document. The save is fire-and-forget
// to match the prior inline-effect behavior (Firestore's realtime
// subscription will deliver the update; if a write fails, the next
// effect run will retry).
//
// Why it's a function and not an inline effect anymore
// ───────────────────────────────────────────────────
// Schedule.jsx and Standings.jsx had byte-identical inline effects
// — the only difference was the per-view scores cache name. The
// duplication risked the two implementations drifting apart over
// time; consolidating into one function eliminates that risk and
// makes future tweaks a one-place change.
//
// Per-mount Set, not module-level
// ───────────────────────────────
// The caller owns the `healedIds` Set and creates one per-mount
// via useRef(new Set()). A module-level Set was considered for
// cross-view dedup (Schedule and Standings sharing one Set so
// they don't both write the same correction), but rejected:
// per-mount Sets give resilience against silent saveMatchResult
// failures, since a failure in one view leaves the other view's
// Set fresh and able to retry. Duplicate writes are idempotent
// (same data) and harmless.
//
// Caller responsibility
// ─────────────────────
// Trigger this inside a useEffect with the same dep set the inline
// effect used previously: matchResults, scoresByWeek (the per-week
// hole-score cache), course, scoringRules, leagueConfig,
// saveMatchResult, schedule, teams, players, seedMap.

import { computeMatchResult } from "./matchCalc";
import { getWeekSide, getPlayerHcpAtWeek } from "../theme";

/**
 * Detect drift in saved match_result docs and write corrections.
 *
 * @param {Object}   args
 * @param {Array}    args.matchResults       all matchResults from Firestore
 * @param {Object}   args.scoresByWeek       { [weekNum]: { wN_pX_hY: score } }
 *                                           populated by the caller's view
 *                                           (Schedule.matchScores,
 *                                           Standings.weekScores, etc.)
 * @param {Array}    args.schedule
 * @param {Array}    args.teams
 * @param {Array}    args.players
 * @param {Object}   args.course
 * @param {Object}   args.scoringRules
 * @param {Object}   args.leagueConfig
 * @param {Object}   args.seedMap            from buildSeedMap; passed in so
 *                                           caller controls the seed source
 *                                           (locked snapshot vs derived)
 * @param {Set}      args.healedIds          per-mount Set tracking which
 *                                           result.id values have already
 *                                           been processed this mount
 * @param {Function} args.saveMatchResult    App.jsx's saveMatchResult callback
 * @returns {void}
 */
export function autoHealMatchResults({
  matchResults,
  scoresByWeek,
  schedule,
  teams,
  players,
  course,
  scoringRules,
  leagueConfig,
  seedMap,
  healedIds,
  saveMatchResult,
  // Season-wide rounds keyed by playerId, format:
  //   { [pid]: [{ season, week, gross }, ...] (sorted oldest-first) }
  // Required for retroactive handicap reconstruction. When absent, this
  // function bails (no-op) rather than fall back to current handicaps,
  // because using current handicaps on historical matches causes
  // retroactive standings drift (the bug this entire rewrite fixes).
  allRoundsByPid,
  // Current season number; used to filter prior rounds.
  season,
}) {
  // Bail early if any required input isn't ready yet. Auto-heal is purely
  // opportunistic — if data is still loading, do nothing and the next
  // effect run will catch it.
  if (!course || !scoringRules || !leagueConfig || !saveMatchResult) return;
  if (!matchResults || !matchResults.length) return;
  if (!scoresByWeek) return;
  // Critical: without season-wide rounds we can't compute retroactive
  // handicaps. The pre-rewrite version of this function called
  // computeMatchResult with current-day handicaps, which retroactively
  // rewrote past match outcomes when handicaps drifted. We make that
  // class of bug impossible by requiring the data needed to do it right.
  if (!allRoundsByPid || !season) return;

  const recentN = scoringRules?.hcpRecentCount ?? 8;
  const bestN = scoringRules?.hcpBestCount ?? 6;
  const frontPar = (course.frontPars || []).reduce((a, b) => a + b, 0) || 36;

  matchResults.forEach(r => {
    if (!r || !r.id || healedIds.has(r.id)) return;

    const wkScores = scoresByWeek[r.week];
    if (!wkScores) return;

    const wk = schedule.find(s => s.week === r.week);
    if (!wk || wk.rainedOut) return;

    const side = wk.side || getWeekSide(r.week);
    const pars = side === 'front' ? course.frontPars : course.backPars;
    const hcps = side === 'front' ? course.frontHcps : course.backHcps;
    if (!pars || !hcps) return;

    // Build the historical players array — same shape as `players`, but
    // each player's handicapIndex is what they had GOING INTO this week.
    // computeMatchResult uses handicapIndex for both the low/high pairing
    // sort AND the per-hole stroke allocation, so this is the single
    // input change that makes recompute produce historically-correct
    // outcomes regardless of how handicaps have drifted since.
    //
    // Fallback chain (in order of preference):
    //   1. Retroactive calc from prior rounds → fully accurate
    //   2. p.startingHandicapIndex → commissioner-set value, used for
    //      players with no prior rounds (week 1, mid-season joiners)
    //   3. p.handicapIndex → today's value, used only as last resort
    //      because it has drifted from the historical reality
    const historicalPlayers = players.map(p => {
      const retroHcp = getPlayerHcpAtWeek({
        playerId: p.id,
        week: r.week,
        season,
        allRoundsByPid,
        recentN,
        bestN,
        frontPar,
      });
      if (retroHcp !== null) {
        return { ...p, handicapIndex: retroHcp };
      }
      if (p.startingHandicapIndex !== undefined && p.startingHandicapIndex !== null && p.startingHandicapIndex !== "") {
        return { ...p, handicapIndex: parseFloat(p.startingHandicapIndex) };
      }
      // Last resort — current handicapIndex. Best we can do without
      // either prior rounds or a starting-hcp override on the player.
      return p;
    });

    try {
      const calc = computeMatchResult({
        match: { team1: r.team1Id, team2: r.team2Id },
        week: r.week,
        isPlayoff: wk.isPlayoff === true,
        teams,
        players: historicalPlayers,
        holeScores: wkScores,
        pars,
        hcps,
        scoringRules,
        leagueConfig,
        seedMap,
      });

      // Drift fingerprint — every calc-derived field that consumers display
      // or aggregate over. If ANY of these differ, the saved snapshot is
      // out of step with current scoring rules / scores / config and
      // needs a re-write. Note: workflow fields (id, signedByPlayerId,
      // attestedBy, attested, finalizedByTeamId, week) are PRESERVED via
      // the spread on save below — the calc only overrides the
      // calculation-derived fields.
      const drifted = (
        calc.matchResultText !== r.matchResultText ||
        calc.t1HolesWon !== r.t1HolesWon ||
        calc.t2HolesWon !== r.t2HolesWon ||
        calc.team1Points !== r.team1Points ||
        calc.team2Points !== r.team2Points ||
        calc.matchWinnerId !== r.matchWinnerId ||
        calc.t1Total !== r.t1Total ||
        calc.t2Total !== r.t2Total
      );

      if (drifted) {
        // Add to the dedupe Set BEFORE firing the save. This is intentional
        // — even if the save fails, we don't want to keep retrying inside
        // the same mount's effect loop on subscription updates. A retry
        // happens naturally on the next mount (page navigation away and
        // back, or full page refresh).
        healedIds.add(r.id);
        saveMatchResult({ ...r, ...calc });
      }
    } catch (e) {
      // Auto-heal is opportunistic. If computeMatchResult throws (e.g.
      // because a player record was deleted, a team was reassigned, etc.)
      // we just skip this record; the inline expanded scorecard will
      // throw the same error in its own catch path and degrade visibly.
    }
  });
}
