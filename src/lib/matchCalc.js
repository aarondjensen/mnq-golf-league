// ─────────────────────────────────────────────────────────────────────────────
//  matchCalc.js — single source of truth for match-result calculation
// ─────────────────────────────────────────────────────────────────────────────
//
// Why this file exists
// ────────────────────
// `league_match_results` documents are a *cache* derived from `league_hole_scores`
// plus the schedule, scoring rules, and league config. They're stored separately
// for performance reasons: every Standings render reads ~100 result docs instead
// of recomputing from ~1500 raw hole-score docs.
//
// But that means whenever a writer updates hole_scores, it must also recompute
// and rewrite the corresponding match_result. Three writers do this:
//
//   1. Live Scoring's "Sign Scorecard" — Scoring.jsx finalizeMatch()
//   2. Schedule's "Edit Scores" popup — Schedule.jsx saveEditedScores()
//   3. Admin's "Force Attest" / score imports — Admin.jsx, importHistoricalData.js
//
// Before this module existed, each writer had its own copy of:
//   - getScore (reading absent flags differently — three different bugs)
//   - getStrokes (consistent, but duplicated)
//   - team-net / hole-result computation (slight numerical differences)
//   - playoff tiebreaker (duplicated, easy to drift)
//
// This module owns ALL of that. Writers pass in raw inputs and get back the
// canonical match_result fields. If two writers compute the same inputs, they
// MUST produce identical outputs — that's the invariant this file enforces.
//
//
// What this file does NOT own
// ───────────────────────────
// Workflow metadata is the caller's responsibility:
//   - signedByPlayerId (who tapped Sign Scorecard)
//   - attestedBy / attested (workflow state)
//   - finalizedByTeamId (which team triggered the finalize)
//
// These aren't derivable from scores; they're recorded by the caller and
// passed through unchanged when the result is rewritten.

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers — buildStrokesMap is exported for direct use by views that need
//  per-hole stroke allocation outside the full match-result calculation flow
//  (e.g. Schedule's Edit Scores popup renders dots above each input). The
//  rest of the helpers below stay file-local since they only make sense
//  inside computeMatchResult's calling context.
// ─────────────────────────────────────────────────────────────────────────────

// Build a stroke-allocation map for a player's net handicap. Returns
// { holeIdx → strokeCount } for the 9 holes being played. Strokes are awarded
// to the hardest hole first (lowest hcp index), wrapping around if the
// player gets more strokes than there are holes.
//
// `nh` = 9-hole net handicap (already halved from full 18-hole index).
// `hcps` = array of 9 course handicap indices for the played side.
export function buildStrokesMap(nh, hcps) {
  const sorted = hcps.map((h, i) => ({ idx: i, hcp: h })).sort((a, b) => a.hcp - b.hcp);
  const mp = {};
  let rem = Math.abs(nh);
  // First pass: one stroke per hole in HCP order
  for (const h of sorted) { if (rem <= 0) break; mp[h.idx] = (mp[h.idx] || 0) + 1; rem--; }
  // Second pass: handles >9 strokes (rare but possible for very high handicaps)
  for (const h of sorted) { if (rem <= 0) break; mp[h.idx] = (mp[h.idx] || 0) + 1; rem--; }
  return mp;
}

// Resolve a player's handicap index from the players collection. Falls back
// to 0 if the player isn't found or has no handicap. Caller is responsible
// for applying the 9-hole halving (we do that at calc time).
function getPlayerHcpIndex(pid, players) {
  const p = players.find(pl => pl.id === pid);
  return p ? Math.round(p.handicapIndex || 0) : 0;
}

// 9-hole net handicap. The stored player.handicapIndex IS already a 9-hole
// handicap — recalcHandicaps in App.jsx computes it from 9-hole gross scores
// and front-9 par (par 36), so the result is the 9-hole index directly.
// We round to integer for the strokes-map distribution. Earlier this halved
// the value assuming an 18-hole index; that gave roughly half the expected
// strokes (e.g. handicap 11 → 6 strokes instead of 11), which made the
// Standings/Schedule mini-scorecards' stroke dots disagree with the live
// scoring view (which never halved).
function getNineHoleHcp(pid, players) {
  return getPlayerHcpIndex(pid, players);
}

// Per-hole strokes a player receives. Cached strokes-map per hcp would be
// slightly faster, but the volume is low (4 players × 9 holes = 36 calls
// per match calc) and clarity wins.
function getStrokes(pid, h, players, hcps) {
  return buildStrokesMap(getNineHoleHcp(pid, players), hcps)[h] || 0;
}

// Find a player's teammate. Returns the OTHER player's pid on the same team,
// or null if pid isn't on either team or the team has only one player.
function teammateOf(pid, t1Pids, t2Pids) {
  if (t1Pids.includes(pid)) return t1Pids.find(p => p !== pid) || null;
  if (t2Pids.includes(pid)) return t2Pids.find(p => p !== pid) || null;
  return null;
}

// Absent-aware score reader. The single canonical implementation; replaces
// the four divergent versions that used to live in Scoring/Schedule/Standings.
//
//   - Player NOT absent → return their actual score from holeScores (0 if no
//     score yet, callers handle that case as "incomplete data").
//   - Player absent, teammate present → substitute teammate's score. This is
//     standard match-play "absent player gets partner's score" treatment;
//     net-points-against-the-team works out the same whether absentee plays.
//   - Player absent, teammate also absent (rare — entire side missing) →
//     impute net bogey: par + 1 + strokes-on-hole. Keeps the calculation
//     proceeding with a deterministic value rather than blanking the cell.
//
// `holeScores` is the keyed-by-string lookup the rest of the app uses:
//   `w${week}_p${pid}_h${h}` → numeric score
//   `w${week}_p${pid}_habsent` → 1 (truthy) when player marked absent
function readScore({ pid, h, week, holeScores, t1Pids, t2Pids, pars, hcps, players }) {
  const isAbsent = (p) => holeScores[`w${week}_p${p}_habsent`] === 1;
  const raw = (p) => holeScores[`w${week}_p${p}_h${h}`] || 0;
  // Drift guard: if a player has any scores recorded, trust the data over a
  // stale habsent flag. Player is only "effectively absent" when the flag is
  // set AND they have zero scores. This prevents stale absent flags (e.g. a
  // player initially marked absent who later had scores entered without the
  // flag being cleared) from causing teammate-doubling or net-bogey imputation.
  const hasAnyScore = (p) => {
    for (let i = 0; i < 9; i++) {
      if ((holeScores[`w${week}_p${p}_h${i}`] || 0) > 0) return true;
    }
    return false;
  };
  const effectivelyAbsent = (p) => isAbsent(p) && !hasAnyScore(p);
  if (effectivelyAbsent(pid)) {
    const tm = teammateOf(pid, t1Pids, t2Pids);
    if (!tm || effectivelyAbsent(tm)) {
      // Both absent — impute net bogey
      const strokesOnHole = buildStrokesMap(getNineHoleHcp(pid, players), hcps)[h] || 0;
      return (pars[h] || 4) + 1 + strokesOnHole;
    }
    return raw(tm);
  }
  return raw(pid);
}

// Absent-aware strokes reader. Mirrors readScore's substitution model: when
// a player is effectively absent and their teammate is present, the present
// teammate is "playing both positions" — both score slots use the teammate's
// gross AND the teammate's strokes. Without this, we'd compute net as
// (teammate_gross - teammate_strokes) + (teammate_gross - absent_strokes),
// which mixes the two players' handicap allocations even though only one is
// actually playing. Using the present teammate's strokes for both slots
// gives net = 2 * (teammate_gross - teammate_strokes), which is the league's
// intended absent-substitution model and matches what the live scoring view
// has always displayed.
//
// Both-absent path falls through to the player's own strokes — the impute
// (net bogey) uses pid's handicap, since there's no "playing teammate" to
// borrow strokes from.
function readStrokesEffective({ pid, h, week, holeScores, t1Pids, t2Pids, players, hcps }) {
  const isAbsent = (p) => holeScores[`w${week}_p${p}_habsent`] === 1;
  const hasAnyScore = (p) => {
    for (let i = 0; i < 9; i++) {
      if ((holeScores[`w${week}_p${p}_h${i}`] || 0) > 0) return true;
    }
    return false;
  };
  const effectivelyAbsent = (p) => isAbsent(p) && !hasAnyScore(p);
  if (effectivelyAbsent(pid)) {
    const tm = teammateOf(pid, t1Pids, t2Pids);
    if (tm && !effectivelyAbsent(tm)) {
      return getStrokes(tm, h, players, hcps);
    }
  }
  return getStrokes(pid, h, players, hcps);
}

// Per-player gross / net / thru. Mirrors Scoring.jsx getRunning(). Used to
// compute team-level totals for points allocation.
function playerTotals({ pid, week, holeScores, t1Pids, t2Pids, pars, hcps, players }) {
  let gross = 0, net = 0, thru = 0;
  for (let h = 0; h < 9; h++) {
    const s = readScore({ pid, h, week, holeScores, t1Pids, t2Pids, pars, hcps, players });
    if (s > 0) {
      gross += s;
      net += s - readStrokesEffective({ pid, h, week, holeScores, t1Pids, t2Pids, players, hcps });
      thru++;
    }
  }
  return { gross, net, thru };
}

// Per-hole match outcome. 1 = team1 wins this hole net, -1 = team2, 0 = tied.
// Aggregated across both teammates' scores using absent-aware reader.
function holeResult({ h, week, holeScores, t1Pids, t2Pids, pars, hcps, players }) {
  // Skip holes that aren't fully scored on both sides. Without this guard, an
  // unplayed hole could be "won" purely from stroke-allocation math (whichever
  // side has more strokes-on-hole nets a more negative score and would appear
  // to win a hole nobody played). Returning null lets callers (computeMatchResult,
  // Scoring's MatchRow) treat the hole as "no result yet" rather than counting
  // it for either side. readScore-substituted absent scores ARE considered
  // present (the substitution is intentional), so an absent player whose
  // teammate scored doesn't trigger the null path.
  let n1 = 0, n2 = 0, ok1 = true, ok2 = true;
  t1Pids.forEach(pid => {
    const s = readScore({ pid, h, week, holeScores, t1Pids, t2Pids, pars, hcps, players });
    if (s <= 0) ok1 = false;
    else n1 += s - readStrokesEffective({ pid, h, week, holeScores, t1Pids, t2Pids, players, hcps });
  });
  t2Pids.forEach(pid => {
    const s = readScore({ pid, h, week, holeScores, t1Pids, t2Pids, pars, hcps, players });
    if (s <= 0) ok2 = false;
    else n2 += s - readStrokesEffective({ pid, h, week, holeScores, t1Pids, t2Pids, players, hcps });
  });
  if (!ok1 || !ok2) return null;
  if (n1 < n2) return 1;
  if (n2 < n1) return -1;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Playoff tiebreaker
// ─────────────────────────────────────────────────────────────────────────────
//
// Playoff matches cannot end tied. When the regular calculation produces a
// finalStatus of 0, the configured tiebreaker rule picks a winner.
//
// Five rule types currently supported (all from leagueConfig.playoffTiebreaker):
//   "hardestHole" — walk holes in HCP order; first hole where net scores
//                   differ is the decider. Cascades through all 9 if needed.
//   "sumHoleHcpLosses" — each lost hole adds its course HCP index to the
//                        loser's penalty total. Lower total wins. Losing on
//                        easy holes (high HCP index) hurts more.
//   "lowestNet" — lower team net total wins.
//   "lowestGross" — lower team gross total wins.
//   "higherSeed" — better seed (lower number) wins.
//
// All rules fall back to seed if their primary criterion ties; final fallback
// is "t1 wins" so we never return null. Returns { winner, label } where
// winner is "t1" or "t2" and label is a short human-readable explanation
// (used in matchResultText: "TIE (Hole 3)", "TIE (Low net)", etc).
// Exported so callers (e.g. Scoring.jsx's preview screen) can resolve the same
// tiebreaker rules as the persisted result, without copy-pasting the logic.
export function computePlayoffTiebreaker({
  t1Pids, t2Pids, t1Id, t2Id,
  hr, // pre-computed holeResults array
  t1Net, t2Net, t1Gross, t2Gross,
  week, holeScores, pars, hcps, players,
  leagueConfig, seedMap,
}) {
  const tb = leagueConfig?.playoffTiebreaker || "hardestHole";
  let winner = null;
  let label = "";

  if (tb === "hardestHole") {
    // Sort by HCP index ascending (1 = hardest first), find first non-tied hole
    const holesByHcp = Array.from({ length: 9 }, (_, h) => h)
      .sort((a, b) => (hcps[a] || Infinity) - (hcps[b] || Infinity));
    let decidingHoleIdx = null;
    for (const h of holesByHcp) {
      let n1 = 0, n2 = 0;
      t1Pids.forEach(pid => {
        n1 += readScore({ pid, h, week, holeScores, t1Pids, t2Pids, pars, hcps, players })
            - readStrokesEffective({ pid, h, week, holeScores, t1Pids, t2Pids, players, hcps });
      });
      t2Pids.forEach(pid => {
        n2 += readScore({ pid, h, week, holeScores, t1Pids, t2Pids, pars, hcps, players })
            - readStrokesEffective({ pid, h, week, holeScores, t1Pids, t2Pids, players, hcps });
      });
      if (n1 < n2) { winner = "t1"; decidingHoleIdx = h; break; }
      if (n2 < n1) { winner = "t2"; decidingHoleIdx = h; break; }
    }
    label = decidingHoleIdx !== null ? `Hole ${decidingHoleIdx + 1}` : "Hole-by-HCP";
  } else if (tb === "sumHoleHcpLosses") {
    let t1LossSum = 0, t2LossSum = 0;
    for (let h = 0; h < 9; h++) {
      const hc = hcps[h] || 0;
      if (hr[h] === 1) t2LossSum += hc;
      else if (hr[h] === -1) t1LossSum += hc;
    }
    if (t1LossSum < t2LossSum) winner = "t1";
    else if (t2LossSum < t1LossSum) winner = "t2";
    label = "HCP losses";
  } else if (tb === "lowestNet") {
    if (t1Net < t2Net) winner = "t1";
    else if (t2Net < t1Net) winner = "t2";
    label = "Low net";
  } else if (tb === "lowestGross") {
    if (t1Gross < t2Gross) winner = "t1";
    else if (t2Gross < t1Gross) winner = "t2";
    label = "Low gross";
  } else if (tb === "higherSeed") {
    const s1 = Number(seedMap?.[t1Id]) || Infinity;
    const s2 = Number(seedMap?.[t2Id]) || Infinity;
    if (s1 < s2) winner = "t1";
    else if (s2 < s1) winner = "t2";
    label = "Higher seed";
  }

  // Final fallback — seed-based, then default to t1.
  if (!winner) {
    const s1 = Number(seedMap?.[t1Id]) || Infinity;
    const s2 = Number(seedMap?.[t2Id]) || Infinity;
    if (s1 !== s2) winner = s1 < s2 ? "t1" : "t2";
    else winner = "t1";
    label = "Seed";
  }

  return { winner, label };
}

// ─────────────────────────────────────────────────────────────────────────────
//  computeMatchResult — THE main export
// ─────────────────────────────────────────────────────────────────────────────
//
// Inputs (all required unless noted):
//   match: { team1, team2 }                            from schedule.matches
//   week: number                                       1-indexed week number
//   isPlayoff: boolean                                 from schedule.isPlayoff
//   teams: array of { id, player1, player2 }           collection
//   players: array of { id, name, handicapIndex }      collection
//   holeScores: object keyed by `w{w}_p{pid}_h{h}`     all weeks' scores
//   pars: number[9]                                    course pars for played side
//   hcps: number[9]                                    course HCP indices for played side
//   scoringRules: object                               point values for win/loss/tie
//   leagueConfig: object                               scoringFormat, bonusType, playoffTiebreaker
//   seedMap: object (optional)                         { teamId → seed } for playoff tiebreakers
//
// Returns the canonical match result fields ready to merge into the existing
// match_result document and persist:
//   {
//     team1Id, team2Id,
//     team1Points, team2Points,           ← awarded points (with playoff TB applied)
//     t1Total, t2Total,                   ← team net totals
//     t1HolesWon, t2HolesWon,
//     matchResultText,                    ← "2UP", "3&2", "TIED", "TIE (Low net)"
//     matchWinnerId,                      ← teamId or null for true ties
//   }
//
// Caller is responsible for adding workflow fields (id, week, signedByPlayerId,
// attestedBy, attested, finalizedByTeamId) and calling saveMatchResult.
export function computeMatchResult({
  match, week, isPlayoff,
  teams, players,
  holeScores,
  pars, hcps,
  scoringRules, leagueConfig,
  seedMap = {},
}) {
  const t1 = teams.find(t => t.id === match.team1);
  const t2 = teams.find(t => t.id === match.team2);
  if (!t1 || !t2) {
    throw new Error(`computeMatchResult: team not found (t1=${match.team1}, t2=${match.team2})`);
  }
  const t1Pids = [t1.player1, t1.player2].filter(Boolean);
  const t2Pids = [t2.player1, t2.player2].filter(Boolean);

  // Common helper-args bundle, threaded through everything below
  const ctx = { week, holeScores, t1Pids, t2Pids, pars, hcps, players };

  // ── Per-team totals ─────────────────────────────────────────────────────
  // Sum each player's gross + net across all 9 holes. readScore handles absent
  // substitution (teammate's score) automatically.
  let t1Net = 0, t2Net = 0, t1Gross = 0, t2Gross = 0;
  for (const pid of t1Pids) {
    const t = playerTotals({ pid, ...ctx });
    t1Net += t.net;
    t1Gross += t.gross;
  }
  for (const pid of t2Pids) {
    const t = playerTotals({ pid, ...ctx });
    t2Net += t.net;
    t2Gross += t.gross;
  }

  // ── Scoring rules (regular vs playoff have separate point values) ──────
  const sr = isPlayoff
    ? {
        mw: scoringRules.playoffMatchWin, mt: scoringRules.playoffMatchTie, ml: scoringRules.playoffMatchLoss,
        bw: scoringRules.playoffBonusWin, bt: scoringRules.playoffBonusTie, bl: scoringRules.playoffBonusLoss,
      }
    : {
        mw: scoringRules.matchWin, mt: scoringRules.matchTie, ml: scoringRules.matchLoss,
        bw: scoringRules.totalNetBonusWin, bt: scoringRules.totalNetBonusTie, bl: scoringRules.totalNetBonusLoss,
      };

  // ── Match-play hole-by-hole status ──────────────────────────────────────
  // Walk all 9 holes; each hole has 1 (T1 won), -1 (T2 won), 0 (tied), or
  // null (incomplete scores). matchResultText expresses the outcome in golf
  // shorthand:
  //   "5&4" — leader was up 5 with 4 to play (clinched on hole 14)
  //   "2UP" — match went 9 holes, leader finished 2 up
  //   "TIED" — match went 9 holes all-square (regular season only)
  // Computed BEFORE points allocation so the "teamNetTotal" scoring format can
  // award points based on the match-play winner (the format is now match-play:
  // combined team net per hole decides each hole, total holes won decides the
  // match). The "lowHighBonus" format ignores match-play and uses individual
  // matchups + bonus instead.
  let hw1 = 0, hw2 = 0;
  const holeResults = [];
  for (let h = 0; h < 9; h++) {
    const r = holeResult({ h, ...ctx });
    if (r === 1) hw1++;
    else if (r === -1) hw2++;
    holeResults.push(r);
  }

  // Running cumulative match status. Null hole results (incomplete scores)
  // don't change the cumulative — they leave it where it was. Without this
  // guard a null would make `cum` NaN and propagate through matchMargin.
  const runningStatus = [];
  let cum = 0;
  holeResults.forEach(r => {
    if (r !== null) cum += r;
    runningStatus.push(cum);
  });

  // Find the hole the match was clinched on, if any. A match is mathematically
  // over when a team's lead exceeds the holes remaining to play.
  let matchEndHole = 8;
  let matchMargin = Math.abs(runningStatus[8]);
  for (let h = 0; h < 9; h++) {
    const lead = Math.abs(runningStatus[h]);
    const remaining = 8 - h;
    if (lead > remaining) { matchEndHole = h; matchMargin = lead; break; }
  }
  const holesRemaining = 8 - matchEndHole;
  const finalStatus = runningStatus[8];

  let matchResultText;
  if (finalStatus === 0) matchResultText = "TIED";
  else if (holesRemaining > 0) matchResultText = `${matchMargin}&${holesRemaining}`;
  else matchResultText = `${Math.abs(finalStatus)}UP`;

  let winnerTeamId = finalStatus > 0 ? t1.id : finalStatus < 0 ? t2.id : null;

  // ── Points allocation ──────────────────────────────────────────────────
  // Two scoring formats:
  //   "teamNetTotal" — Team Net Total Match Play. Single match line; the
  //                    match-play winner (computed above from combined team
  //                    net per hole) gets the win points. Match-play TIED
  //                    means both teams get matchTie points — keeps the W/L/T
  //                    record consistent with what's displayed everywhere.
  //   "lowHighBonus" (default) — low+high paired matches plus a bonus line.
  //                              Three independent point lines per match;
  //                              decoupled from match-play winner.
  let t1Pts = 0, t2Pts = 0;
  const scoringFormat = leagueConfig?.scoringFormat || "lowHighBonus";

  if (scoringFormat === "teamNetTotal") {
    if (finalStatus > 0) { t1Pts = sr.mw; t2Pts = sr.ml; }
    else if (finalStatus < 0) { t1Pts = sr.ml; t2Pts = sr.mw; }
    else { t1Pts = sr.mt; t2Pts = sr.mt; }
  } else {
    // Pair players by handicap: lowest-hcp on each team play each other (the
    // "low" match), highest-hcp on each team play each other (the "high" match).
    // Each gets full match-win points independently.
    const t1s = [...t1Pids].sort((a, b) => getPlayerHcpIndex(a, players) - getPlayerHcpIndex(b, players));
    const t2s = [...t2Pids].sort((a, b) => getPlayerHcpIndex(a, players) - getPlayerHcpIndex(b, players));
    const pNet = (pid) => playerTotals({ pid, ...ctx }).net;
    const t1L = pNet(t1s[0]), t2L = pNet(t2s[0]), t1H = pNet(t1s[1]), t2H = pNet(t2s[1]);
    if (t1L < t2L) { t1Pts += sr.mw; t2Pts += sr.ml; } else if (t1L > t2L) { t1Pts += sr.ml; t2Pts += sr.mw; } else { t1Pts += sr.mt; t2Pts += sr.mt; }
    if (t1H < t2H) { t1Pts += sr.mw; t2Pts += sr.ml; } else if (t1H > t2H) { t1Pts += sr.ml; t2Pts += sr.mw; } else { t1Pts += sr.mt; t2Pts += sr.mt; }

    // Bonus line — three flavors of "best team total":
    //   "lowestNet"   — best individual net on each team
    //   "totalGross"  — gross strokes
    //   "teamNetTotal" (default) — combined team net
    const bonusType = leagueConfig?.bonusType || "teamNetTotal";
    let b1, b2;
    if (bonusType === "lowestNet") { b1 = Math.min(pNet(t1s[0]), pNet(t1s[1])); b2 = Math.min(pNet(t2s[0]), pNet(t2s[1])); }
    else if (bonusType === "totalGross") { b1 = t1Gross; b2 = t2Gross; }
    else { b1 = t1Net; b2 = t2Net; }
    if (b1 < b2) { t1Pts += sr.bw; t2Pts += sr.bl; }
    else if (b1 > b2) { t1Pts += sr.bl; t2Pts += sr.bw; }
    else { t1Pts += sr.bt; t2Pts += sr.bt; }
  }

  // ── Playoff tiebreaker ──────────────────────────────────────────────────
  // Playoff matches can't end TIED; if they do, apply the configured rule
  // and override both points + matchResultText. winnerTeamId starts as the
  // match-play winner (or null for TIED) and is overridden here for ties.
  let finalT1Pts = t1Pts;
  let finalT2Pts = t2Pts;

  if (isPlayoff && finalStatus === 0) {
    const { winner: tbWinner, label: tbLabel } = computePlayoffTiebreaker({
      t1Pids, t2Pids, t1Id: t1.id, t2Id: t2.id,
      hr: holeResults,
      t1Net, t2Net, t1Gross, t2Gross,
      week, holeScores, pars, hcps, players,
      leagueConfig, seedMap,
    });
    const isTeamNet = scoringFormat === "teamNetTotal";
    if (tbWinner === "t1") {
      finalT1Pts = isTeamNet ? sr.mw : sr.mw + sr.bw;
      finalT2Pts = isTeamNet ? sr.ml : sr.ml + sr.bl;
      winnerTeamId = t1.id;
    } else {
      finalT1Pts = isTeamNet ? sr.ml : sr.ml + sr.bl;
      finalT2Pts = isTeamNet ? sr.mw : sr.mw + sr.bw;
      winnerTeamId = t2.id;
    }
    matchResultText = `TIE (${tbLabel})`;
  }

  return {
    team1Id: t1.id,
    team2Id: t2.id,
    team1Points: finalT1Pts,
    team2Points: finalT2Pts,
    t1Total: t1Net,
    t2Total: t2Net,
    t1HolesWon: hw1,
    t2HolesWon: hw2,
    matchResultText,
    matchWinnerId: winnerTeamId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  readScoreEffective — exported absent-aware score reader
// ─────────────────────────────────────────────────────────────────────────────
//
// Read-side helpers that need to display per-hole scores (Schedule mini-card,
// Standings mini-card, Scoring's All-Matches expanded view) all need the same
// absent-substitution logic that computeMatchResult uses internally.
//
// Rather than duplicate that logic in three render paths, callers can use this
// exported reader. Same semantics as the internal readScore — absent player's
// score is substituted from teammate, both-absent falls back to net bogey.
//
// Inputs are positional rather than keyword-style because this is hot in render
// and called per-cell — keeps call sites concise.
export function readScoreEffective({
  pid, h, week, holeScores, t1Pids, t2Pids, pars, hcps, players,
}) {
  return readScore({ pid, h, week, holeScores, t1Pids, t2Pids, pars, hcps, players });
}

// readStrokesEffective — absent-aware strokes reader, parallel to readScoreEffective.
// Use this in render paths instead of the older getStrokesForHole when you have
// week + holeScores + t1Pids + t2Pids available (Standings/Schedule mini-cards do).
export function readStrokesEffectiveExt({
  pid, h, week, holeScores, t1Pids, t2Pids, players, hcps,
}) {
  return readStrokesEffective({ pid, h, week, holeScores, t1Pids, t2Pids, players, hcps });
}

// Exported strokes helper for the same reason — render paths need to compute
// `score - strokes` for net display, and we want exactly one source. Now
// absent-aware: when extra context (week, holeScores, t1Pids, t2Pids) is
// passed, applies the absent-substitution model. When called with just the
// minimal args it falls back to the player's own strokes (used by call sites
// that don't have week-specific context).
export function getStrokesForHole({ pid, h, players, hcps, week, holeScores, t1Pids, t2Pids }) {
  if (week !== undefined && holeScores && t1Pids && t2Pids) {
    return readStrokesEffective({ pid, h, week, holeScores, t1Pids, t2Pids, players, hcps });
  }
  return getStrokes(pid, h, players, hcps);
}

// ─────────────────────────────────────────────────────────────────────────────
//  resultLetterFor — single source of truth for W/L/T from a match result
// ─────────────────────────────────────────────────────────────────────────────
//
// Throughout the app the match status is shown as match-play (TIED, 1UP, 3&2,
// etc.). Records (W-L-T) and winner indicators must agree with that — they
// can NOT be derived from points comparison, because:
//   - lowHighBonus mode awards 3 independent point lines; a match-play TIED
//     can produce unequal team points if low+high splits differ from bonus.
//   - teamNetTotal mode now awards points from match-play, but legacy data
//     saved before that change still carries asymmetric points on TIED rows.
// Use matchResultText for the TIED check (regular season ties), then
// matchWinnerId for W/L assignment. Returns "W" | "L" | "T" | "" (no match).
export function resultLetterFor(matchResult, teamId) {
  if (!matchResult || !teamId) return "";
  // Regular-season tie — both teams get T.
  if (matchResult.matchResultText === "TIED") return "T";
  // Modern path: matchWinnerId is the canonical winner (set by computeMatchResult,
  // overridden by playoff tiebreaker). Null winner with no TIED text shouldn't
  // happen in practice, but if it does, fall through to points compare.
  if (matchResult.matchWinnerId) {
    return matchResult.matchWinnerId === teamId ? "W" : "L";
  }
  // Legacy fallback for any historical data missing matchWinnerId.
  const isT1 = matchResult.team1Id === teamId;
  const myPts = isT1 ? (matchResult.team1Points || 0) : (matchResult.team2Points || 0);
  const oppPts = isT1 ? (matchResult.team2Points || 0) : (matchResult.team1Points || 0);
  return myPts > oppPts ? "W" : myPts < oppPts ? "L" : "T";
}

// ─────────────────────────────────────────────────────────────────────────────
//  isMatchPendingMakeup — attendance-aware helper used by every match-result
//  display surface (Scoring's All Matches tile, Schedule's match rows,
//  Standings' Recent Matches). Returns true when any of the match's four
//  players is flagged "makeup" for the week.
//
//  Match calc itself doesn't need to know about this — a makeup player has
//  no scores written (no _habsent, no hole scores), so computeMatchResult
//  naturally returns an incomplete match and no result is saved. This
//  helper tells the UI to render an explanatory "PENDING MAKEUP" pill
//  instead of just "in progress" / "incomplete."
//
//  Once the makeup player posts their scores through normal Scoring,
//  computeMatchResult produces a result, auto-heal writes it to
//  league_match_results, and the surfaces start showing the real W/L/T
//  result. The badge logic checks "no saved result AND attendance flagged"
//  so the transition is automatic — no extra wiring needed.
//
//  Parameters:
//    matchPids   — array of 4 player IDs in the match
//    attendance  — the flat attendance lookup from App.jsx
//                  ({ [`w${wk}_p${pid}`]: { status, ... } })
//    week        — the week number
// ─────────────────────────────────────────────────────────────────────────────
export function isMatchPendingMakeup(matchPids, attendance, week) {
  if (!attendance || !week || !Array.isArray(matchPids) || matchPids.length === 0) {
    return false;
  }
  return matchPids.some(pid => {
    if (!pid) return false;
    return attendance[`w${week}_p${pid}`]?.status === "makeup";
  });
}
