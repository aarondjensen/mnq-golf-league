// ══════════════════════════════════════════════════════════════════
//  scheduleAutoSeed — does a playoff round advance the bracket?
// ══════════════════════════════════════════════════════════════════
//
// Why this file exists
// ────────────────────
// A playoff bracket silently stopped advancing mid-postseason. Week 15
// showed FINAL, week 16 stayed "MATCHUPS DETERMINED BY STANDINGS — TBD"
// with no tee times, and nothing threw or logged. The readiness gate for
// the previous round was a count:
//
//     if (prevResults.length < prevPWk.matches.length) break;
//
// `matches` includes the week's individual groups — the foursomes that
// eliminated players are regrouped into. A group signs its card into
// `league_group_results`, never into `league_match_results`, so
// `matchResults` can never reach that count. One individual group in a
// playoff week was enough to break out of the seeding loop forever.
//
// These tests pin the gate to what progression actually depends on: a
// result for every BRACKET match of the prior round. The db layer is
// mocked so the assertions read the schedule documents the seeder would
// have written.

import { describe, it, expect, beforeEach, vi } from "vitest";

const upserts = [];
vi.mock("../firebase", () => ({
  LEAGUE_ID: "test-league",
  db: {
    upsert: async (collection, doc) => { upserts.push({ collection, doc }); },
  },
}));

const { autoSeedIfReady } = await import("./scheduleAutoSeed");

const TEAMS = Array.from({ length: 10 }, (_, i) => ({
  id: `T${i + 1}`, name: `Team ${i + 1}`, player1: `p${i * 2 + 1}`, player2: `p${i * 2 + 2}`,
}));
const SEEDS = TEAMS.map(t => t.id);

// Twelve finished round-robin weeks, so PHASE 1's "all RR locked" gate is
// satisfied and the run reaches the playoff phase. No seeded regular-season
// weeks, so PHASE 1 itself writes nothing.
const rrWeeks = Array.from({ length: 12 }, (_, i) => ({
  week: i + 1, locked: true, matches: [], id: `w${i + 1}`,
}));

const bracketResult = (week, t1, t2, winner) => ({
  week, team1Id: t1, team2Id: t2,
  team1Points: winner === t1 ? 3 : 0,
  team2Points: winner === t2 ? 3 : 0,
  matchResultText: "2&1", matchWinnerId: winner,
});

// Round 1 (week 13): two bracket matches. Round 2 (week 14): the two
// winners meet. The bracket is deliberately tiny — this file is about the
// readiness gate, not about pairing math.
const ROUNDS = [
  { name: "Round 1", matchups: [
    { s1type: "seed", s1: 1, s2type: "seed", s2: 4 },
    { s1type: "seed", s1: 2, s2type: "seed", s2: 3 },
  ] },
  { name: "Round 2", matchups: [
    { s1type: "winner", s1: "winner_0", s2type: "winner", s2: "winner_1" },
  ] },
];

const LEAGUE_CONFIG = {
  id: "cfg", playoffRounds: ROUNDS, playoffSeeds: SEEDS,
  consolationEnabled: false, lockSeedsEnabled: false,
};

// Week 13 as played: the two bracket matches plus whatever non-bracket
// matches the caller wants alongside them.
const week13 = (extraMatches = []) => ({
  id: "w13", week: 13, isPlayoff: true, locked: true,
  matches: [
    ...extraMatches,
    { team1: "T1", team2: "T4" },
    { team1: "T2", team2: "T3" },
  ],
});
const week14 = { id: "w14", week: 14, isPlayoff: true, locked: false, matches: [] };

const INDIV_GROUP = { players: ["p11", "p12", "p13", "p14"], isIndivGroup: true, isConsolation: true };

const run = ({ extraMatches = [], results, justLockedWeek = 13 }) => autoSeedIfReady({
  justLockedWeek,
  schedule: [...rrWeeks, week13(extraMatches), week14],
  matchResults: results ?? [
    bracketResult(13, "T1", "T4", "T1"),
    bracketResult(13, "T2", "T3", "T3"),
  ],
  holeScores: {},
  teams: TEAMS,
  leagueConfig: LEAGUE_CONFIG,
});

const seededWeek = (week) => upserts
  .filter(u => u.collection === "league_schedule" && u.doc.week === week)
  .map(u => u.doc)
  .pop();

describe("autoSeedIfReady — advancing a playoff bracket", () => {
  beforeEach(() => { upserts.length = 0; });

  it("advances past a round that contains an individual group", async () => {
    // The regression. The group has no match_result and never will — the
    // bracket must still resolve from the two matches that do.
    const out = await run({ extraMatches: [INDIV_GROUP] });
    expect(out.playoff).toBe(1);
    const wk14 = seededWeek(14);
    expect(wk14.matches).toEqual([{ team1: "T1", team2: "T3" }]);
  });

  it("advances a round with no individual groups the same way", async () => {
    const out = await run({});
    expect(out.playoff).toBe(1);
    expect(seededWeek(14).matches).toEqual([{ team1: "T1", team2: "T3" }]);
  });

  it("still waits when a bracket match has no result", async () => {
    const out = await run({
      extraMatches: [INDIV_GROUP],
      results: [bracketResult(13, "T1", "T4", "T1")],
    });
    expect(out.playoff).toBe(0);
    expect(seededWeek(14)).toBeUndefined();
  });

  it("advances on a config refresh, not just on the finalizing save", async () => {
    // justLockedWeek === 0 is the "config changed, re-evaluate everything"
    // signal — the path that heals a bracket already stuck on a locked week.
    const out = await run({ extraMatches: [INDIV_GROUP], justLockedWeek: 0 });
    expect(out.playoff).toBe(1);
    expect(seededWeek(14).matches).toEqual([{ team1: "T1", team2: "T3" }]);
  });
});
