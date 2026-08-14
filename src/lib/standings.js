// ══════════════════════════════════════════════════════════════════
//  standings — the table, and the points that sort it.
// ══════════════════════════════════════════════════════════════════
//
// The canonical standings calculator. The Standings page rank, the playoff seed
// map, the auto-seed pairings and bracket positioning all sit downstream of it,
// which makes it the highest-leverage pure function in the app.
//
// Its long explanation of the two calling modes and the tiebreaker chains used
// to sit ~300 lines above the function it describes. It is attached now.
//
// Split out of lib/league.js, which was itself split out of theme.jsx. One
// 861-line file holding handicaps, standings, seeding, brackets and score
// classification was a big improvement on 1,108 mixed ones, and still coarser
// than Bourbon Cup and WBC, which both split their domain by concern. These
// clusters barely referenced each other, so the split is along seams that were
// already there.
//
// Pure: no React, no Firestore, no DOM.

import { resultLetterFor } from "./matchCalc";

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
