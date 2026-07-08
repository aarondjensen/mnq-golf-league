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
//     to seeded weeks. For each seeded week that isn't already locked,
//     isn't rained out, and doesn't already have play recorded against it
//     (see the stale-bracket guard — same protection the playoff phase
//     uses, so finalizing one seeded week can't re-pair or revert another
//     that's in progress or hand-curated):
//       • If `customSeedWeeks` defines positional pairings for that
//         week, use them (commissioner-curated seed-vs-seed matchups).
//       • Otherwise, default pairings are 1v10, 2v9, 3v8, … (top vs
//         bottom). This is the standard "seed against the bracket"
//         approach for a competitive last few weeks before playoffs.
//     customSeedWeeks is indexed by position among ALL seeded reg weeks
//     (rained-out included), matching Admin's "Seed Week" and Schedule's
//     display so the three never disagree.
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
import { buildStandingsForSeed, pairNonBracketTeams, collectPriorMatchups, serializeSeedWeeks, buildPlayerCoOccurrence } from "../theme";

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

  // Live seeds: full current standings (every locked week, INCLUDING seeded
  // weeks). This is the DYNAMIC ordering used when Lock Seeds is off, where
  // "seeds update each week based on current standings" is the intended UX.
  const computeSeeds = () => buildStandingsForSeed(
    teams, matchResults, projectedSchedule, leagueConfig?.standingsMethod
  ).map(s => s.teamId);

  // Frozen seeds: standings from ROUND-ROBIN weeks ONLY (locked, non-seeded,
  // non-playoff). This is what Lock Seeds captures. The bracket must reflect
  // regular-season performance and must NOT drift once seeded play begins —
  // otherwise finalizing a seeded week re-ranks teams and reshuffles every
  // later seeded week. Excluding seeded/playoff results makes this order
  // identical whether it's computed at the end of the round robin or after
  // week 10 is already locked, so the lock self-heals even when its in-memory
  // snapshot is briefly stale. Mirrors the Admin "Lock Seeds" capture exactly.
  const computeRRSeeds = () => {
    const rrWeekNums = new Set(
      projectedSchedule
        .filter(s => !s.isPlayoff && !s.seeded && !s.rainedOut && s.locked === true)
        .map(s => s.week)
    );
    const rrResults = (matchResults || []).filter(r => rrWeekNums.has(r.week));
    return buildStandingsForSeed(
      teams, rrResults, projectedSchedule, leagueConfig?.standingsMethod, false
    ).map(s => s.teamId);
  };

  // ── PHASE 1: Seeded regular-season pairings ──
  let seededCount = 0;
  const rrWeeks = projectedSchedule.filter(s => !s.isPlayoff && !s.seeded && !s.rainedOut);
  const allRRLocked = rrWeeks.length > 0 && rrWeeks.every(s => s.locked === true);

  if (allRRLocked) {
    // Decide between locked-snapshot seeds and freshly-computed.
    // Lock snapshot wins when (a) it's enabled, (b) it exists, (c) it
    // matches the current team count (defensive against team adds).
    const useLocked = lockSeedsEnabled && existingLocked && existingLocked.length === teams.length;
    // Lock on → frozen round-robin-only order; lock off → live dynamic order.
    seeds = useLocked ? existingLocked : (lockSeedsEnabled ? computeRRSeeds() : computeSeeds());

    // First time computing under lockSeedsEnabled? Save the snapshot
    // immediately so subsequent calls use it.
    if (!useLocked && lockSeedsEnabled) {
      // Spreading ...leagueConfig carries customSeedWeeks, which is an
      // array-of-arrays and illegal in Firestore — serialize it to the
      // array-of-maps shape so this write doesn't silently fail.
      const cfgWrite = { ...leagueConfig, id: leagueConfig?.id || `${LEAGUE_ID}_config`, league_id: LEAGUE_ID, lockedSeeds: seeds };
      if ("customSeedWeeks" in cfgWrite) cfgWrite.customSeedWeeks = serializeSeedWeeks(cfgWrite.customSeedWeeks);
      await db.upsert("league_config", cfgWrite);
    }

    const n = seeds.length;
    const pairCount = Math.floor(n / 2);
    if (pairCount >= 1) {
      // Index basis for customSeedWeeks. This list must match how Admin's
      // "Seed Week" action (Admin.jsx) and Schedule.jsx's display index into
      // customSeedWeeks: position among ALL seeded regular-season weeks,
      // rained-out weeks INCLUDED. Previously this writer excluded rainedOut
      // from the basis (`!s.rainedOut`), so a single rained-out seeded week
      // shifted every later week's `si` by one — the auto-seeded pairing then
      // disagreed with the commissioner-configured pairing the readers show.
      // We still skip rainedOut weeks when writing (below); we just no longer
      // let them shift the index.
      const seededRegWeeks = projectedSchedule.filter(s => s.seeded === true && !s.isPlayoff).sort((a, b) => a.week - b.week);
      const customWeeks = leagueConfig?.customSeedWeeks;

      for (let si = 0; si < seededRegWeeks.length; si++) {
        const wk = seededRegWeeks[si];
        if (wk.locked === true) continue;
        // A rained-out seeded week never gets matches written, but it still
        // occupies an index slot above so customSeedWeeks stays aligned.
        if (wk.rainedOut) continue;

        // Stale-bracket guard — mirrors the playoff phase below. Finalizing
        // ANY week (or a config refresh via autoSeedIfReady(0)) re-runs this
        // loop and would otherwise re-upsert every unlocked seeded week. If a
        // seeded week already has matchups AND any play is recorded against it
        // (a result, or raw hole scores for a group that teed off early), the
        // commissioner has either started that week or hand-curated it — do
        // not clobber it. Without this guard, finalizing week 10 could re-pair
        // weeks 11/12 mid-round (under live/dynamic seeds) or revert a manual
        // matchup edit back to the computed pairing. `locked` alone didn't
        // cover the "in progress but not yet finalized" window.
        const hasExistingMatches = wk.matches && wk.matches.length > 0;
        if (hasExistingMatches) {
          const hasAnyScoreOrResult = (matchResults || []).some(r => r.week === wk.week)
            || Object.keys(holeScores || {}).some(k => k.startsWith(`w${wk.week}_`));
          if (hasAnyScoreOrResult) continue;
        }

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
  // existingLocked or compute fresh. Under Lock Seeds, freeze from the
  // round-robin order so playoff seeding matches the regular-season bracket.
  if (!seeds) {
    seeds = existingLocked && existingLocked.length === teams.length
      ? existingLocked
      : (lockSeedsEnabled ? computeRRSeeds() : computeSeeds());
  }

  // ── PLAYOFF SEEDS — frozen at the END of the regular season ──
  // A SEPARATE snapshot from `seeds` (round-robin only, drives seeded weeks).
  // Playoff seeds come from the FULL regular season (round-robin + seeded
  // weeks) and lock the instant the regular season finishes. They NEVER
  // recompute during the playoffs: the #1 seed stays #1 through every round.
  // Precedence:
  //   1. A stored snapshot always wins — once frozen, never overwritten. This
  //      is the hard lock that guarantees playoffs don't reseed.
  //   2. If not yet stored AND the regular season is complete, capture it now
  //      and persist so every later call reuses the exact same order.
  //   3. If the regular season is still in progress, use a LIVE preview (not
  //      persisted) so the bracket preview shows something sane pre-lock.
  // computeRSSeeds pulls from locked NON-playoff weeks on the PROJECTED
  // schedule, so it's correct on the very save that locks the final RS week.
  const existingPlayoffSeeds = leagueConfig?.playoffSeeds;
  const regularSeasonWeeks = projectedSchedule.filter(s => !s.isPlayoff && !s.rainedOut);
  const regularSeasonComplete =
    regularSeasonWeeks.length > 0 && regularSeasonWeeks.every(s => s.locked === true);
  const computeRSSeeds = () => {
    const rsWeekNums = new Set(
      projectedSchedule.filter(s => !s.isPlayoff && s.locked === true).map(s => s.week)
    );
    const rsResults = (matchResults || []).filter(r => rsWeekNums.has(r.week));
    return buildStandingsForSeed(
      teams, rsResults, projectedSchedule, leagueConfig?.standingsMethod, false
    ).map(s => s.teamId);
  };
  let playoffSeeds;
  if (existingPlayoffSeeds && existingPlayoffSeeds.length === teams.length) {
    playoffSeeds = existingPlayoffSeeds;                 // hard lock — never reseed
  } else if (regularSeasonComplete) {
    playoffSeeds = computeRSSeeds();                     // freeze now + persist
    const cfgWrite = { ...leagueConfig, id: leagueConfig?.id || `${LEAGUE_ID}_config`, league_id: LEAGUE_ID, playoffSeeds };
    if ("customSeedWeeks" in cfgWrite) cfgWrite.customSeedWeeks = serializeSeedWeeks(cfgWrite.customSeedWeeks);
    await db.upsert("league_config", cfgWrite);
  } else {
    playoffSeeds = computeRSSeeds();                     // live preview, not frozen
  }

  // Consolation is opt-in. When off, teams outside the bracket simply have no
  // match that week. When on, `optimize` chooses the pairing strategy:
  //   • optimize ON  → minimize repeat player-pair groupings across the season
  //   • optimize OFF → pair leftover teams in standings (seed) order
  const consolationEnabled = leagueConfig?.consolationEnabled === true;
  const consolationOptimize = leagueConfig?.consolationOptimize === true;
  const buildConsolation = (bracketMatches, week) => {
    if (!consolationEnabled) return [];
    const priorMatchups = collectPriorMatchups(projectedSchedule, week);
    const coOccurrence = consolationOptimize
      ? buildPlayerCoOccurrence(projectedSchedule, week, teams)
      : null;
    const { pairs } = pairNonBracketTeams(teams, bracketMatches, priorMatchups, {
      optimize: consolationOptimize, coOccurrence, teams, seedOrder: playoffSeeds,
    });
    // Tag non-bracket matches so downstream code can separate them from the
    // bracket by flag rather than array position — which lets us place them
    // FIRST (earliest tee times) while the bracket keeps the final tee times.
    return pairs.map(p => ({ ...p, isConsolation: true }));
  };

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
      const n = playoffSeeds.length;
      const pairCount = Math.floor(n / 2);
      if (pairCount < 1) break;
      const bracketMatches = [];
      for (let i = 0; i < pairCount; i++) {
        bracketMatches.push({ team1: playoffSeeds[i], team2: playoffSeeds[n - 1 - i] });
      }
      // Bracket (playoff) matches take the FINAL tee times of the week;
      // non-bracket matches go first. Order: [non-bracket..., bracket...].
      const matches = [...buildConsolation(bracketMatches, pWk.week), ...bracketMatches];
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
      // Prefer the isConsolation flag to isolate the bracket matches; fall back
      // to the old first-N-are-bracket assumption for weeks seeded before the
      // flag existed. Bracket matches keep their config order either way, so
      // winner_0/winner_1/… still line up with the prior round's matchups.
      const prevHasFlag = prevPWk.matches.some(m => m.isConsolation === true);
      const prevBracketMatches = prevHasFlag
        ? prevPWk.matches.filter(m => !m.isConsolation)
        : (prevBracketCount > 0 ? prevPWk.matches.slice(0, prevBracketCount) : prevPWk.matches);
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
        return seedIdx >= 0 && seedIdx < playoffSeeds.length ? playoffSeeds[seedIdx] : null;
      } else if (type === "winner") {
        if (val === "lowestWinner" || val === "lowestSeed") {
          // Lowest-seeded winner (highest seed number among winners).
          const sorted = prevWinners.map(id => ({ id, rank: playoffSeeds.indexOf(id) })).sort((a, b) => b.rank - a.rank);
          return sorted[0]?.id || null;
        } else if (val === "nextLowestWinner" || val === "nextLowestSeed") {
          const sorted = prevWinners.map(id => ({ id, rank: playoffSeeds.indexOf(id) })).sort((a, b) => b.rank - a.rank);
          return sorted[1]?.id || null;
        } else if (val === "highestWinner" || val === "highestSeed") {
          // Highest-seeded winner (lowest seed number among winners). With a
          // 2-team play-in feeding #1/#2, this is the OTHER winner from lowestSeed.
          const sorted = prevWinners.map(id => ({ id, rank: playoffSeeds.indexOf(id) })).sort((a, b) => a.rank - b.rank);
          return sorted[0]?.id || null;
        } else if (val === "nextHighestWinner" || val === "nextHighestSeed") {
          const sorted = prevWinners.map(id => ({ id, rank: playoffSeeds.indexOf(id) })).sort((a, b) => a.rank - b.rank);
          return sorted[1]?.id || null;
        } else if (val?.startsWith("winner_")) {
          const idx = parseInt(val.split("_")[1]);
          return prevWinners[idx] || null;
        }
      } else if (type === "loser") {
        if (val === "highestLoser") {
          // Highest-seeded loser (lowest seed number among losers).
          const sorted = prevLosers.map(id => ({ id, rank: playoffSeeds.indexOf(id) })).sort((a, b) => a.rank - b.rank);
          return sorted[0]?.id || null;
        } else if (val === "nextHighestLoser") {
          const sorted = prevLosers.map(id => ({ id, rank: playoffSeeds.indexOf(id) })).sort((a, b) => a.rank - b.rank);
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

    // Bracket (playoff) matches take the FINAL tee times of the week;
    // non-bracket matches go first. Order: [non-bracket..., bracket...].
    const matches = [...buildConsolation(bracketMatches, pWk.week), ...bracketMatches];

    await db.upsert("league_schedule", { ...pWk, matches, league_id: LEAGUE_ID });
    playoffCount++;
  }

  return { seeded: seededCount, playoff: playoffCount };
}
