// ══════════════════════════════════════════════════════════════════
//  scheduleAutoSeed — auto-pair seeded regular-season weeks AND
//                     playoff rounds as their inputs become resolvable.
// ══════════════════════════════════════════════════════════════════
//
// Why this is a separate file
// ───────────────────────────
// `autoSeedIfReady` lived inline in App.jsx as a 200-line useCallback,
// the single biggest function in that file. It does a lot: detect whether
// the round-robin block is complete, compute or fetch locked seeds,
// generate seeded-week pairings, then walk through playoff rounds and
// fill in matchups as previous rounds finalize. None of that is React-
// specific — it's pure data pipeline that ends in `db.upsert` calls.
// Lifting it here makes App.jsx ~200 lines smaller and lets the seeding
// logic be unit-tested without spinning up a React tree.
//
// What the function does, phase by phase
// ──────────────────────────────────────
//
//   PHASE 0 — Sanity gate.
//     If `justLockedWeek` is truthy and not in the schedule, bail (no-op).
//     `justLockedWeek === 0` is a CONFIG REFRESH signal: re-evaluate every
//     gate from scratch (no week was just locked, but config changed and
//     might unblock a phase). Saves the caller from having to think about
//     which arg means what.
//
//   PHASE 1 — Seeded regular-season pairings.
//     If the entire round-robin block is now locked (every non-playoff
//     non-seeded week is locked, except possibly justLockedWeek which
//     we project as locked), we know seeds are stable enough to assign
//     to seeded weeks. For each seeded week that isn't already locked:
//       • If `customSeedWeeks` defines positional pairings for that
//         week, use them (commissioner-curated seed-vs-seed matchups).
//       • Otherwise, default pairings are 1v10, 2v9, 3v8, … (top vs
//         bottom). This is the standard "seed against the bracket"
//         approach for a competitive last few weeks before playoffs.
//
//   PHASE 2 — Playoff round 1.
//     If the league has playoff weeks configured AND no explicit Round 1
//     bracket is defined in playoffRounds[0], default to the same
//     1v10, 2v9, … pattern that the regular seeded weeks used. Then add
//     consolation pairings for the non-bracket teams (so everyone has
//     a match every week, even after they're eliminated from the bracket).
//     `pairNonBracketTeams` ensures consolation matches don't repeat
//     prior-week opponents when possible.
//
//   PHASE 3+ — Subsequent playoff rounds.
//     For each playoff week with an explicit `roundDef.matchups` config,
//     resolve each matchup's slots based on previous-round winners /
//     losers / fixed seed references. The resolveSlot helper handles:
//       • "seed" → fixed seed number from the seed list
//       • "winner" → previous round's winners by reference
//         (lowestWinner, nextLowestWinner, winner_<idx>)
//       • "loser" → previous round's losers (highestLoser,
//         nextHighestLoser, loser_<idx>)
//     If duplicates are detected (same team appears in two slots), log
//     and skip the duplicate matchup rather than write inconsistent data.
//     Fall back to consolation pairings for non-bracket teams.
//
// Idempotence + retries
// ─────────────────────
// Every phase is gated on "is this week already filled in?" — if a
// playoff week already has matches AND any score/result has been recorded,
// we skip. So calling this function repeatedly is safe; it's a no-op
// once the data it would write is already present.
//
// What it does NOT do
// ───────────────────
//   • Update React state. All writes go to Firestore. The realtime
//     subscription delivers the new schedule docs back to App.jsx,
//     which propagates to the rest of the tree.
//   • Track its own progress. Returns `{ seeded, playoff }` counts (or 0
//     for the "not ready" gate at the top). The caller can react to the
//     return value if needed (toast, logging) but the function itself
//     doesn't side-effect anywhere except Firestore.
//
// Caller wiring
// ─────────────
// App.jsx wraps this in a thin useCallback that bundles its refs into
// the params object — refs because the callback may fire from a
// setTimeout (e.g., saveLeagueConfig), and we need to read CURRENT
// state at call time, not the snapshot in the original closure.

import { db, LEAGUE_ID } from "../firebase";
import { buildStandingsForSeed, pairNonBracketTeams, collectPriorMatchups } from "../theme";

export async function autoSeedIfReady({
  justLockedWeek,
  schedule,
  matchResults,
  holeScores,
  teams,
  leagueConfig,
}) {
  // ── PHASE 0: Sanity gate ──
  const isConfigRefresh = justLockedWeek === 0;
  const lockedWk = isConfigRefresh ? null : schedule.find(s => s.week === justLockedWeek);
  if (!isConfigRefresh && !lockedWk) return 0;

  // Project the schedule with `justLockedWeek` already locked (it might
  // not be reflected in `schedule` yet because the realtime subscription
  // hasn't round-tripped). This makes the "all RR locked?" gate fire on
  // the correct save-call ordering.
  const projectedSchedule = isConfigRefresh ? schedule : schedule.map(s =>
    s.week === justLockedWeek ? { ...s, locked: true } : s
  );

  const lockSeedsEnabled = leagueConfig?.lockSeedsEnabled === true;
  const existingLocked = leagueConfig?.lockedSeeds;
  let seeds;

  // Compute seeds via the canonical buildStandingsForSeed (same function
  // Standings.jsx uses for live ranking, ensuring seed/standings parity).
  // Default `lockedOnly: true` means it self-filters to results from
  // locked weeks only.
  const computeSeeds = () => buildStandingsForSeed(
    teams, matchResults, projectedSchedule, leagueConfig?.standingsMethod
  ).map(s => s.teamId);

  // ── PHASE 1: Seeded regular-season pairings ──
  let seededCount = 0;
  const rrWeeks = projectedSchedule.filter(s => !s.isPlayoff && !s.seeded && !s.rainedOut);
  const allRRLocked = rrWeeks.length > 0 && rrWeeks.every(s => s.locked === true);

  if (allRRLocked) {
    // Decide between locked-snapshot seeds and freshly-computed.
    // Lock snapshot wins when (a) it's enabled, (b) it exists, (c) it
    // matches the current team count (defensive against team adds).
    const useLocked = lockSeedsEnabled && existingLocked && existingLocked.length === teams.length;
    seeds = useLocked ? existingLocked : computeSeeds();

    // First time computing under lockSeedsEnabled? Save the snapshot
    // immediately so subsequent calls use it.
    if (!useLocked && lockSeedsEnabled) {
      await db.upsert("league_config", { ...leagueConfig, id: leagueConfig?.id || `${LEAGUE_ID}_config`, league_id: LEAGUE_ID, lockedSeeds: seeds });
    }

    const n = seeds.length;
    const pairCount = Math.floor(n / 2);
    if (pairCount >= 1) {
      const seededRegWeeks = projectedSchedule.filter(s => s.seeded === true && !s.isPlayoff && !s.rainedOut).sort((a, b) => a.week - b.week);
      const customWeeks = leagueConfig?.customSeedWeeks;

      for (let si = 0; si < seededRegWeeks.length; si++) {
        const wk = seededRegWeeks[si];
        if (wk.locked === true) continue;
        const weekPairs = (customWeeks && customWeeks[si]) || null;
        const matches = [];
        if (weekPairs && weekPairs.length === pairCount) {
          // Custom pairings: seed N vs seed M as configured.
          for (const pair of weekPairs) {
            const t1 = seeds[pair.s1 - 1];
            const t2 = seeds[pair.s2 - 1];
            if (t1 && t2) matches.push({ team1: t1, team2: t2 });
          }
        } else {
          // Default: 1v10, 2v9, etc.
          for (let i = 0; i < pairCount; i++) {
            matches.push({ team1: seeds[i], team2: seeds[n - 1 - i] });
          }
        }
        if (matches.length) {
          await db.upsert("league_schedule", { ...wk, matches, league_id: LEAGUE_ID });
          seededCount++;
        }
      }
    }
  }

  // ── PHASE 2/3+: Playoff rounds ──
  let playoffCount = 0;

  const playoffWeeksList = projectedSchedule.filter(s => s.isPlayoff === true).sort((a, b) => a.week - b.week);
  if (playoffWeeksList.length === 0) {
    return { seeded: seededCount, playoff: 0 };
  }

  const playoffRoundsCfg = leagueConfig?.playoffRounds || [];
  if (playoffRoundsCfg.length === 0) {
    return { seeded: seededCount, playoff: 0 };
  }

  // Lazy seed compute: if PHASE 1 didn't run (RR not yet fully locked),
  // we still might be able to pair playoff rounds — fall through to
  // existingLocked or compute fresh.
  if (!seeds) {
    seeds = existingLocked && existingLocked.length === teams.length
      ? existingLocked
      : computeSeeds();
  }

  for (let pi = 0; pi < playoffWeeksList.length; pi++) {
    const pWk = playoffWeeksList[pi];
    if (pWk.locked === true) continue;

    // Stale-bracket guard: if matches exist AND there's any recorded
    // play (results OR raw hole scores), don't overwrite. The
    // commissioner has presumably already seeded this week and play
    // is in progress.
    const hasExistingMatches = pWk.matches && pWk.matches.length > 0;
    if (hasExistingMatches) {
      const hasAnyScoreOrResult = (matchResults || []).some(r => r.week === pWk.week)
        || Object.keys(holeScores || {}).some(k => k.startsWith(`w${pWk.week}_`));
      if (hasAnyScoreOrResult) continue;
    }

    const roundDef = playoffRoundsCfg[pi];

    // Round 1 default: if no explicit matchup config, use 1v10 / 2v9 / etc.
    if (pi === 0 && (!roundDef || !roundDef.matchups || !roundDef.matchups.length)) {
      const n = seeds.length;
      const pairCount = Math.floor(n / 2);
      if (pairCount < 1) break;
      const matches = [];
      for (let i = 0; i < pairCount; i++) {
        matches.push({ team1: seeds[i], team2: seeds[n - 1 - i] });
      }
      const priorMatchups = collectPriorMatchups(projectedSchedule, pWk.week);
      const { pairs: consolationPairs } = pairNonBracketTeams(teams, matches, priorMatchups);
      matches.push(...consolationPairs);
      await db.upsert("league_schedule", { ...pWk, matches, league_id: LEAGUE_ID });
      playoffCount++;
      continue;
    }

    if (!roundDef || !roundDef.matchups || !roundDef.matchups.length) break;

    // Resolve previous round's winners + losers (bracket only, not
    // consolation). Consolation results don't feed into bracket
    // progression.
    let prevWinners = [];
    let prevLosers = [];
    if (pi > 0) {
      const prevPWk = playoffWeeksList[pi - 1];
      // Don't proceed unless prev round is locked OR was just locked.
      if (!prevPWk.locked && prevPWk.week !== justLockedWeek) break;
      if (!prevPWk.matches || prevPWk.matches.length === 0) break;
      const prevResults = (matchResults || []).filter(r => r.week === prevPWk.week);
      if (prevResults.length < prevPWk.matches.length) break;
      const prevRoundDef = playoffRoundsCfg[pi - 1];
      const prevBracketCount = (prevRoundDef?.matchups || []).length;
      const prevBracketMatches = prevBracketCount > 0
        ? prevPWk.matches.slice(0, prevBracketCount)
        : prevPWk.matches;
      prevBracketMatches.forEach((m) => {
        const r = prevResults.find(pr => pr.team1Id === m.team1 && pr.team2Id === m.team2);
        if (r) {
          const d = (r.team1Points || 0) - (r.team2Points || 0);
          prevWinners.push(d >= 0 ? r.team1Id : r.team2Id);
          prevLosers.push(d >= 0 ? r.team2Id : r.team1Id);
        }
      });
    }

    // Slot resolver: turns a roundDef matchup spec like
    // `{ s1type: "seed", s1: 1, s2type: "winner", s2: "lowestWinner" }`
    // into actual team IDs. Returns null if the slot can't be resolved
    // (which causes the matchup to be skipped — incomplete config or
    // unfinalized prior round).
    const resolveSlot = (mu, side) => {
      const type = mu[side + "type"];
      const val = mu[side];
      if (type === "seed") {
        const seedIdx = parseInt(val) - 1;
        return seedIdx >= 0 && seedIdx < seeds.length ? seeds[seedIdx] : null;
      } else if (type === "winner") {
        if (val === "lowestWinner" || val === "lowestSeed") {
          // Lowest-seeded winner (highest seed number among winners).
          const sorted = prevWinners.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => b.rank - a.rank);
          return sorted[0]?.id || null;
        } else if (val === "nextLowestWinner" || val === "nextLowestSeed") {
          const sorted = prevWinners.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => b.rank - a.rank);
          return sorted[1]?.id || null;
        } else if (val?.startsWith("winner_")) {
          const idx = parseInt(val.split("_")[1]);
          return prevWinners[idx] || null;
        }
      } else if (type === "loser") {
        if (val === "highestLoser") {
          // Highest-seeded loser (lowest seed number among losers).
          const sorted = prevLosers.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => a.rank - b.rank);
          return sorted[0]?.id || null;
        } else if (val === "nextHighestLoser") {
          const sorted = prevLosers.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => a.rank - b.rank);
          return sorted[1]?.id || null;
        } else if (val?.startsWith("loser_")) {
          const idx = parseInt(val.split("_")[1]);
          return prevLosers[idx] || null;
        }
      }
      return null;
    };

    const bracketMatches = [];
    const usedTeamIds = new Set();
    let hasDuplicate = false;
    for (const mu of roundDef.matchups) {
      const t1 = resolveSlot(mu, "s1");
      const t2 = resolveSlot(mu, "s2");
      if (!t1 || !t2) continue;
      if (usedTeamIds.has(t1) || usedTeamIds.has(t2) || t1 === t2) {
        hasDuplicate = true;
        console.warn(
          `[autoSeedIfReady] Skipping duplicate team in Round ${pi + 1} ` +
          `(week ${pWk.week}): matchup ${JSON.stringify(mu)} resolves to ` +
          `t1=${t1} t2=${t2} — already used: ${[...usedTeamIds].join(", ")}`
        );
        continue;
      }
      usedTeamIds.add(t1);
      usedTeamIds.add(t2);
      bracketMatches.push({ team1: t1, team2: t2 });
    }

    // Don't write a partial bracket: bail unless all matchups resolved
    // (or the only failures were duplicates that we logged about).
    if (bracketMatches.length !== roundDef.matchups.length && !hasDuplicate) break;

    const priorMatchups = collectPriorMatchups(projectedSchedule, pWk.week);
    const { pairs: consolationPairs } = pairNonBracketTeams(teams, bracketMatches, priorMatchups);
    const matches = [...bracketMatches, ...consolationPairs];

    await db.upsert("league_schedule", { ...pWk, matches, league_id: LEAGUE_ID });
    playoffCount++;
  }

  return { seeded: seededCount, playoff: playoffCount };
}
