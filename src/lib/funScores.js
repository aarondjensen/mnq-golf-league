// ══════════════════════════════════════════════════════════════════
//  lib/funScores.js — scores for fun rounds
// ══════════════════════════════════════════════════════════════════
//
// Fun rounds get a real scorecard: nine holes, stroke dots, net to par,
// and a leaderboard for the round. What they do NOT get is any effect
// on the league.
//
// The boundary, stated once so nobody has to trace it
// ───────────────────────────────────────────────────
// These scores live in `league_fun_scores`, keyed by ROUND id — there
// is no `week` and no `season`-week pairing anywhere in the shape, so
// none of the handicap, standings, or stats paths can read them even by
// accident. Specifically:
//
//   • calcPlayerHcp / recalcHandicaps read `league_hole_scores`. Nothing
//     here is ever written there, so a fun round cannot move a handicap.
//   • fetchAllScores / fetchSeasonScores build from `league_hole_scores`
//     too, so Stats and the individual board never see these.
//   • Standings reads match results, which fun rounds don't produce.
//
// Handicaps flow the OTHER way: a player's current handicapIndex is READ
// to compute their net. That direction is safe — reading a handicap
// can't change one — but it does mean a fun round's net is computed
// against the handicap the player carries TODAY, not one reconstructed
// as of the round date. For a casual round that's the honest simple
// answer; league weeks use buildHistoricalPlayers precisely because
// their numbers have to stay stable retroactively, and these don't.
//
// Net-to-par math is NOT reimplemented here. It calls computeRoundLine
// from lib/indivGroups.js, the same function the playoff individual
// board, the live group card, and the group scorecard all use. That
// function takes a round already resolved by resolveIndivRound, so the
// one thing this file does is shape a fun round's hole array into that
// same `ir` form. A second copy of "strokes on holes actually played"
// is exactly the drift indivGroups.js's header warns about.

import { computeRoundLine } from "./indivGroups";

export const FUN_HOLES = 9;

/** Doc id for one player's card on one round. Deterministic: re-saving overwrites. */
export function funScoreId(roundId, pid) {
  return `funsc_${roundId}_${pid}`;
}

/**
 * Coerce stored/edited holes to exactly 9 integers, 0 meaning "no score
 * yet". Golf scores are small positive integers; anything else (null,
 * "", NaN, a 3-digit fat finger) reads as unentered rather than
 * poisoning a total.
 *
 * Accepts BOTH shapes:
 *   • a map keyed by hole index — `{ "0": 5, "3": 4 }` — how it's stored
 *   • an array — the original shape, still read so cards entered before
 *     the switch keep working
 *
 * Why a map on the way in: hole-by-hole entry writes one hole per tap,
 * and Firestore merges nested maps key by key but replaces arrays
 * wholesale. With an array, two quick taps would both read the same
 * stale card and the second write would erase the first hole — scores
 * silently vanishing mid-round. Same reasoning as `slots` on the tee
 * sheet. Internally everything downstream still works on an array,
 * which is what all the scoring math wants.
 */
export function normalizeHoles(raw) {
  const out = new Array(FUN_HOLES).fill(0);
  if (!raw || typeof raw !== "object") return out;
  for (let h = 0; h < FUN_HOLES; h++) {
    const n = Number(Array.isArray(raw) ? raw[h] : raw[h] ?? raw[String(h)]);
    out[h] = Number.isInteger(n) && n > 0 && n < 100 ? n : 0;
  }
  return out;
}

/**
 * The single-hole patch a tap persists. Merged into `holes`, so it
 * touches that one key and nothing else.
 */
export function funHolePatch(hole, value) {
  const n = Number(value);
  return { [String(hole)]: Number.isInteger(n) && n > 0 && n < 100 ? n : 0 };
}

/**
 * Shape a fun card into the `ir` form resolveIndivRound produces, so
 * anything built to read a league round can read a fun one. The league
 * store has makeup and total-only namespaces; a fun round has neither,
 * so this is only ever the "live" or "none" case.
 */
export function funRoundIr(holes) {
  const card = normalizeHoles(holes);
  const played = {};
  let gross = 0;
  let count = 0;
  for (let h = 0; h < FUN_HOLES; h++) {
    if (card[h] > 0) { played[h] = card[h]; gross += card[h]; count++; }
  }
  return count > 0
    ? { withdrawn: false, mode: "live", holes: played, gross, holesPlayed: count, totalOnly: false }
    : { withdrawn: false, mode: "none", holes: {}, gross: 0, holesPlayed: 0, totalOnly: false };
}

/** Flat lookup keyed `${roundId}_${pid}` → 9 holes, built from the raw docs. */
export function indexFunScores(docs) {
  const index = {};
  for (const d of docs || []) {
    if (!d || !d.roundId || !d.playerId) continue;
    index[`${d.roundId}_${d.playerId}`] = normalizeHoles(d.holes);
  }
  return index;
}

export function readFunCard(index, roundId, pid) {
  return normalizeHoles(index?.[`${roundId}_${pid}`]);
}

export function holesPlayed(holes) {
  return normalizeHoles(holes).filter(n => n > 0).length;
}

export function isCardComplete(holes) {
  return holesPlayed(holes) === FUN_HOLES;
}

/** Which nine, and the pars/hcps for it. Returns nulls when course data hasn't loaded. */
export function funRoundSide(round, course) {
  const side = round?.side === "back" ? "back" : "front";
  const pars = course ? (side === "back" ? course.backPars : course.frontPars) : null;
  const hcps = course ? (side === "back" ? course.backHcps : course.frontHcps) : null;
  return { side, pars, hcps };
}

/**
 * One player's line for one fun round.
 *
 * Shapes the hole array into the `ir` form resolveIndivRound produces,
 * then defers to computeRoundLine — so a partial card scores against
 * the par of the holes actually played and only the strokes falling on
 * them, identically to every other card in the app.
 *
 * @returns {{ gross, netToPar, grossToPar, holesPlayed, played }}
 */
export function funRoundLine(holes, pars, hcps, roundHcp = 0) {
  return computeRoundLine({ ir: funRoundIr(holes), pars, hcps, roundHcp });
}

/** The 9-hole handicap to score a player against. Rounded, matching every other card. */
export function funPlayerHcp(player) {
  return Math.round(Number(player?.handicapIndex) || 0);
}

/**
 * Leaderboard for one round: one row per player seated on the tee
 * sheet, sorted best net first.
 *
 * Players with no card yet are INCLUDED, at the bottom — the sheet
 * says they're playing, so their absence from the board would read as
 * a bug rather than as "hasn't posted."
 *
 * Sort: played before unplayed, then net to par, then gross to par,
 * then more holes played (a completed 9 outranks a partial on the same
 * number), then name for a stable finish.
 *
 * @returns {{ pid, name, groupIdx, line, hcp, holes }[]}
 */
export function buildFunLeaderboard({ grid, index, roundId, players, pars, hcps }) {
  const byId = new Map((players || []).map(p => [p.id, p]));
  const rows = [];
  (grid || []).forEach((spots, groupIdx) => {
    for (const pid of spots) {
      if (!pid) continue;
      const player = byId.get(pid);
      const holes = readFunCard(index, roundId, pid);
      const hcp = funPlayerHcp(player);
      rows.push({
        pid,
        name: player?.name || "Unknown",
        groupIdx,
        hcp,
        holes,
        line: funRoundLine(holes, pars, hcps, hcp),
      });
    }
  });

  rows.sort((a, b) => {
    if (a.line.played !== b.line.played) return a.line.played ? -1 : 1;
    if (!a.line.played) return a.name.localeCompare(b.name);
    if (a.line.netToPar !== b.line.netToPar) return a.line.netToPar - b.line.netToPar;
    if (a.line.grossToPar !== b.line.grossToPar) return a.line.grossToPar - b.line.grossToPar;
    if (a.line.holesPlayed !== b.line.holesPlayed) return b.line.holesPlayed - a.line.holesPlayed;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

/** True when anyone on the sheet has posted at least one hole. */
export function roundHasScores({ grid, index, roundId }) {
  for (const spots of grid || []) {
    for (const pid of spots) {
      if (pid && holesPlayed(readFunCard(index, roundId, pid)) > 0) return true;
    }
  }
  return false;
}

/** "+3" / "E" / "-2" — the app's usual to-par rendering. */
export function formatToPar(n) {
  if (!Number.isFinite(n)) return "—";
  if (n > 0) return `+${n}`;
  if (n === 0) return "E";
  return `${n}`;
}

/**
 * Compact net summary for one player, shown under their tee group.
 * Returns null when they haven't posted a hole — the caller renders
 * nothing rather than a row of dashes under every unplayed group.
 */
export function funSpotSummary(index, roundId, pid, pars, hcps, player) {
  const card = readFunCard(index, roundId, pid);
  if (holesPlayed(card) === 0) return null;
  const line = funRoundLine(card, pars, hcps, funPlayerHcp(player));
  return `${formatToPar(line.netToPar)} · ${line.holesPlayed === FUN_HOLES ? "F" : `thru ${line.holesPlayed}`}`;
}
