// ══════════════════════════════════════════════════════════════════
//  Tests for theme.jsx's buildStandingsForSeed.
// ══════════════════════════════════════════════════════════════════
//
// Coverage focus
// ──────────────
// The standings sort is the highest-leverage pure function in the app —
// downstream of it sit the Standings page rank, the playoff seed map,
// the auto-seed flow's seeded-week pairings, and bracket positioning.
// A regression here ripples through the entire UI.
//
// In particular, this file pins down the regression scenario from the
// May 8 audit round:
//
//   Two teams perfectly tied on 2-0-0 record but with different
//   holes-won totals (10 vs 8). The league rule says holes-won breaks
//   the tie. A previous round of this audit accidentally removed that
//   4th-step tiebreaker; standings showed the wrong team at #1 before
//   it was caught.
//
// Test strategy
// ─────────────
// Each test builds minimal team + matchResult fixtures that exercise
// exactly one branch of the sort logic. No fixtures share state — every
// test is self-contained for clarity. resultLetterFor IS imported from
// matchCalc; that means these tests transitively depend on its
// correctness. If matchCalc.test.js's resultLetterFor tests pass, this
// file's expectations are pinned correctly.

import { describe, it, expect } from "vitest";
import { buildStandingsForSeed, isIndivGroupMatch, scorableMatches, weekFullyAttested, matchPids } from "./theme";

// Helpers that build fixtures concisely. Default values match what
// computeMatchResult would produce for typical matches.
const team = (id, name = `Team ${id}`) => ({ id, name });
const result = (week, t1Id, t2Id, opts = {}) => ({
  week,
  team1Id: t1Id,
  team2Id: t2Id,
  team1Points: opts.t1Pts ?? 0,
  team2Points: opts.t2Pts ?? 0,
  t1HolesWon: opts.t1Hw ?? 0,
  t2HolesWon: opts.t2Hw ?? 0,
  // matchResultText drives resultLetterFor's W/L/T determination.
  // matchWinnerId is the team ID of the W team (or null/undefined for ties).
  matchResultText: opts.text ?? "TIED",
  matchWinnerId: opts.winnerId ?? null,
  ...opts,
});
const lockedWeek = (week, locked = true) => ({ week, locked });

describe("buildStandingsForSeed", () => {
  describe("output shape", () => {
    it("returns one entry per team with the expected fields", () => {
      const teams = [team("a"), team("b")];
      const r = buildStandingsForSeed(teams, [], [], "points");
      expect(r).toHaveLength(2);
      // Each entry has the canonical shape — guards against accidental
      // field rename which would break consumers downstream silently.
      r.forEach(s => {
        expect(s).toHaveProperty("teamId");
        expect(s).toHaveProperty("points");
        expect(s).toHaveProperty("w");
        expect(s).toHaveProperty("l");
        expect(s).toHaveProperty("t");
        expect(s).toHaveProperty("hw");
        expect(s).toHaveProperty("gp");
      });
    });

    it("starts every team at zero with no results", () => {
      const teams = [team("a"), team("b")];
      const r = buildStandingsForSeed(teams, [], [], "points");
      r.forEach(s => {
        expect(s.points).toBe(0);
        expect(s.w).toBe(0);
        expect(s.l).toBe(0);
        expect(s.t).toBe(0);
        expect(s.hw).toBe(0);
        expect(s.gp).toBe(0);
      });
    });
  });

  describe("locked-week filtering (lockedOnly mode)", () => {
    it("skips results for unlocked weeks when lockedOnly is true (default)", () => {
      const teams = [team("a"), team("b")];
      const schedule = [
        lockedWeek(1, false),  // unlocked — should be ignored
        lockedWeek(2, true),   // locked — should count
      ];
      const results = [
        result(1, "a", "b", { t1Pts: 100, winnerId: "a", text: "5UP" }),  // ignored
        result(2, "a", "b", { t2Pts: 50, winnerId: "b", text: "2UP" }),
      ];
      const r = buildStandingsForSeed(teams, results, schedule, "points");
      const a = r.find(s => s.teamId === "a");
      const b = r.find(s => s.teamId === "b");
      // Only week 2 counts. b should have the 50 points.
      expect(b.points).toBe(50);
      expect(a.points).toBe(0);
    });

    it("skips internal lock filter when lockedOnly is false (caller pre-filtered)", () => {
      // Standings.jsx calls with lockedOnly: false because it pre-filters
      // to lockedResults. In that mode, we trust the caller — no schedule
      // lookup happens, so an unlocked-week result that slips through
      // would still be counted.
      const teams = [team("a"), team("b")];
      const results = [
        result(1, "a", "b", { t1Pts: 30, winnerId: "a", text: "3&2" }),
      ];
      // Pass schedule but lockedOnly: false should ignore it.
      const r = buildStandingsForSeed(teams, results, [], "points", false);
      const a = r.find(s => s.teamId === "a");
      expect(a.points).toBe(30);
    });

    it("skips results whose week has no schedule entry", () => {
      const teams = [team("a"), team("b")];
      // Week 99 doesn't exist in the schedule — orphan result. Should be
      // filtered out (an undefined wk fails the `!rWeek` guard).
      const schedule = [lockedWeek(1, true)];
      const results = [
        result(99, "a", "b", { t1Pts: 100, winnerId: "a", text: "9UP" }),
      ];
      const r = buildStandingsForSeed(teams, results, schedule, "points");
      const a = r.find(s => s.teamId === "a");
      expect(a.points).toBe(0);
    });
  });

  describe("W/L/T tally from match-play result", () => {
    it("counts a TIED match as T for both teams (not W/L by points)", () => {
      // The lowHighBonus scoring rule can produce a TIED match-play
      // result with asymmetric points — e.g., one team gets bonus
      // points from a low-net round even though the match itself was
      // halved. Naive code would compare points and award W/L; the
      // canonical rule (resultLetterFor) returns "T" for both teams.
      const teams = [team("a"), team("b")];
      const schedule = [lockedWeek(1)];
      const results = [
        result(1, "a", "b", {
          text: "TIED",
          winnerId: null,
          t1Pts: 12,  // higher
          t2Pts: 8,   // lower — but match was tied on holes
          t1Hw: 4,
          t2Hw: 4,
        }),
      ];
      const r = buildStandingsForSeed(teams, results, schedule, "points");
      const a = r.find(s => s.teamId === "a");
      const b = r.find(s => s.teamId === "b");
      expect(a.t).toBe(1);
      expect(b.t).toBe(1);
      expect(a.w).toBe(0);
      expect(a.l).toBe(0);
      expect(b.w).toBe(0);
      expect(b.l).toBe(0);
      // Points still asymmetric — sort order will use the points.
      expect(a.points).toBe(12);
      expect(b.points).toBe(8);
    });

    it("counts a normal win/loss correctly", () => {
      const teams = [team("a"), team("b")];
      const schedule = [lockedWeek(1)];
      const results = [
        result(1, "a", "b", {
          text: "3&2",
          winnerId: "a",
          t1Pts: 15,
          t2Pts: 5,
          t1Hw: 6,
          t2Hw: 1,
        }),
      ];
      const r = buildStandingsForSeed(teams, results, schedule, "points");
      const a = r.find(s => s.teamId === "a");
      const b = r.find(s => s.teamId === "b");
      expect(a.w).toBe(1);
      expect(a.l).toBe(0);
      expect(a.gp).toBe(1);
      expect(b.l).toBe(1);
      expect(b.w).toBe(0);
      expect(b.gp).toBe(1);
    });
  });

  describe("points-mode sorting", () => {
    it("orders teams by total points (descending)", () => {
      const teams = [team("a"), team("b"), team("c")];
      const schedule = [lockedWeek(1)];
      const results = [
        result(1, "a", "b", { t1Pts: 5, t2Pts: 15, winnerId: "b", text: "3UP" }),
        result(1, "c", "a", { t1Pts: 20, t2Pts: 10, winnerId: "c", text: "5&3" }),
      ];
      const r = buildStandingsForSeed(teams, results, schedule, "points");
      // c: 20, b: 15, a: 15.   tiebreaker: hw (b has 5, a has 0 — b wins)
      // Wait — let me recompute. b's hw from match 1: t2Hw default 0.
      // a's hw from match 1: t1Hw default 0; from match 2: t2Hw default 0.
      // c's hw from match 2: t1Hw default 0.
      // All hw are 0 → identical. Tied 15-15 between a and b.
      // Tied teams fall through to insertion order (Object.values returns
      // teams in their iteration order).
      //
      // To make this test deterministic, set explicit hw values:
      //
      // Re-doing with explicit hw — see next test.
      expect(r[0].teamId).toBe("c");  // 20 points
      expect(r[0].points).toBe(20);
    });

    it("breaks points-mode ties by holes won (hw)", () => {
      const teams = [team("a"), team("b"), team("c")];
      const schedule = [lockedWeek(1)];
      const results = [
        // a and b end tied on 15 points but a has more hw
        result(1, "a", "c", { t1Pts: 15, t2Pts: 5, t1Hw: 6, t2Hw: 0, winnerId: "a", text: "6&3" }),
        result(1, "b", "c", { t1Pts: 15, t2Pts: 5, t1Hw: 4, t2Hw: 1, winnerId: "b", text: "3&2" }),
      ];
      const r = buildStandingsForSeed(teams, results, schedule, "points");
      // a and b both at 15 points. a has 6 hw, b has 4. a should be first.
      expect(r[0].teamId).toBe("a");
      expect(r[1].teamId).toBe("b");
      expect(r[2].teamId).toBe("c");
    });
  });

  describe("record-mode sorting", () => {
    it("orders by win % descending (primary)", () => {
      const teams = [team("a"), team("b"), team("c")];
      const schedule = [lockedWeek(1), lockedWeek(2)];
      const results = [
        // a: 2-0-0, win% = 1.0
        result(1, "a", "b", { winnerId: "a", text: "2UP", t1Hw: 3 }),
        result(2, "a", "c", { winnerId: "a", text: "1UP", t1Hw: 2 }),
        // b: 0-1-0, win% = 0.0
        // c: 0-1-0, win% = 0.0
      ];
      const r = buildStandingsForSeed(teams, results, schedule, "record");
      expect(r[0].teamId).toBe("a");
    });

    it("breaks ties by wins, then losses, then holes won", () => {
      // The full 4-step chain: win% → wins → losses → hw
      const teams = [team("a"), team("b"), team("c")];
      const schedule = [lockedWeek(1), lockedWeek(2)];
      const results = [
        // a: 1-0-1, b: 1-0-1 — same win%, same wins, same losses.
        // Differentiated by hw.
        result(1, "a", "c", { winnerId: "a", text: "5UP", t1Hw: 5 }),
        result(2, "a", "b", { text: "TIED", winnerId: null, t1Hw: 4, t2Hw: 4 }),
        result(1, "b", "c", { winnerId: "b", text: "1UP", t1Hw: 1 }),  // b: 1 win, 5 hw total
      ];
      // Recompute totals:
      //   a: 1W (vs c), 1T (vs b). hw: 5+4 = 9
      //   b: 1W (vs c), 1T (vs a). hw: 4+1 = 5
      //   c: 0-2-0. hw: 0+0 = 0
      // a and b tied on win% (0.75), wins (1), losses (0), ties (1).
      // hw breaks: a (9) > b (5). a should be first.
      const r = buildStandingsForSeed(teams, results, schedule, "record");
      expect(r[0].teamId).toBe("a");
      expect(r[1].teamId).toBe("b");
      expect(r[2].teamId).toBe("c");
    });

    // ★ Regression test for the May 8 audit issue ★
    it("uses holes-won to break a perfect 2-0-0 tie (regression: empty 4th step)", () => {
      // Two teams both at 2-0-0 with identical W-L-T but different hw.
      // The audit's previous round accidentally removed the 4th
      // tiebreaker; standings showed the wrong team at #1.
      //
      // This test pins the league's actual rule: when records are
      // tied, holes-won breaks it. Specifically reproduces the screenshot
      // from the user's bug report:
      //
      //   STEVENS / VIGO        2-0-0   8 holes won
      //   RHOADES / JENSEN     2-0-0   10 holes won  ← should be #1
      const teams = [team("stevens"), team("rhoades")];
      const schedule = [lockedWeek(1), lockedWeek(2)];
      const results = [
        // Stevens beats two opponents with low hw totals
        result(1, "stevens", "filler1", { winnerId: "stevens", text: "2UP", t1Hw: 4 }),
        result(2, "stevens", "filler2", { winnerId: "stevens", text: "2UP", t1Hw: 4 }),
        // Rhoades beats two opponents with higher hw totals
        result(1, "rhoades", "filler3", { winnerId: "rhoades", text: "5&3", t1Hw: 5 }),
        result(2, "rhoades", "filler4", { winnerId: "rhoades", text: "5&3", t1Hw: 5 }),
      ];
      // Add filler teams so the results have valid team1Id/team2Id; their
      // ranking doesn't matter for this test.
      teams.push(team("filler1"), team("filler2"), team("filler3"), team("filler4"));
      const r = buildStandingsForSeed(teams, results, schedule, "record");
      // Filter to just the contested teams (filler ranks vary)
      const stevens = r.find(s => s.teamId === "stevens");
      const rhoades = r.find(s => s.teamId === "rhoades");
      // Both 2-0-0
      expect(stevens.w).toBe(2);
      expect(stevens.l).toBe(0);
      expect(rhoades.w).toBe(2);
      expect(rhoades.l).toBe(0);
      // hw differs
      expect(stevens.hw).toBe(8);
      expect(rhoades.hw).toBe(10);
      // Critical assertion: rhoades should rank ABOVE stevens
      const stevensIdx = r.findIndex(s => s.teamId === "stevens");
      const rhoadesIdx = r.findIndex(s => s.teamId === "rhoades");
      expect(rhoadesIdx).toBeLessThan(stevensIdx);
    });
  });

  describe("edge cases", () => {
    it("handles empty teams array", () => {
      const r = buildStandingsForSeed([], [], [], "points");
      expect(r).toEqual([]);
    });

    it("handles null/undefined matchResults gracefully", () => {
      const teams = [team("a")];
      const schedule = [lockedWeek(1)];
      // Null and undefined results should be silently skipped, not throw
      const results = [null, undefined, result(1, "a", "a", { t1Pts: 0 })];
      expect(() => buildStandingsForSeed(teams, results, schedule, "points")).not.toThrow();
    });

    it("ignores results referencing teams that don't exist", () => {
      const teams = [team("a")];
      const schedule = [lockedWeek(1)];
      const results = [
        result(1, "a", "ghost", { t1Pts: 10, winnerId: "a", text: "2UP", t1Hw: 3 }),
      ];
      const r = buildStandingsForSeed(teams, results, schedule, "points");
      const a = r.find(s => s.teamId === "a");
      // Even though "ghost" doesn't exist as a team, "a" still gets credit.
      // This is by design — the function attributes points/wins to the
      // teams it knows about and silently drops anything for unknown IDs.
      expect(a.points).toBe(10);
      expect(a.w).toBe(1);
    });
  });
});

// ══════════════════════════════════════════════════════════════════
//  Individual-group guards
// ══════════════════════════════════════════════════════════════════
//
// Why these are pinned
// ────────────────────
// A playoff individual group (eliminated players regrouped into a foursome)
// carries `players` and NO team1/team2, and NEVER produces a match_result.
// Every "is this week done / ready to finalize" check in the app runs over
// scorableMatches for exactly that reason — the original bug was a week that
// could never be finalized because it was waiting on a result that would
// never be written.
describe("isIndivGroupMatch", () => {
  it("is true only for the explicit flag", () => {
    expect(isIndivGroupMatch({ isIndivGroup: true, players: ["p1"] })).toBe(true);
    expect(isIndivGroupMatch({ team1: "A", team2: "B" })).toBe(false);
    // A team consolation match is NOT an individual group — it still has two
    // teams and still produces a result.
    expect(isIndivGroupMatch({ team1: "A", team2: "B", isConsolation: true })).toBe(false);
    expect(isIndivGroupMatch(null)).toBe(false);
    expect(isIndivGroupMatch(undefined)).toBe(false);
  });
});

describe("scorableMatches", () => {
  const bracket = { team1: "A", team2: "B" };
  const consolation = { team1: "C", team2: "D", isConsolation: true };
  const group = { players: ["p1", "p2", "p3", "p4"], isConsolation: true, isIndivGroup: true };

  it("drops individual groups and keeps every real match", () => {
    expect(scorableMatches([group, consolation, bracket])).toEqual([consolation, bracket]);
  });

  it("keeps team consolation matches (they do produce results)", () => {
    expect(scorableMatches([consolation])).toEqual([consolation]);
  });

  it("tolerates null/undefined", () => {
    expect(scorableMatches(null)).toEqual([]);
    expect(scorableMatches(undefined)).toEqual([]);
  });
});

describe("weekFullyAttested", () => {
  const group = { players: ["p1", "p2", "p3", "p4"], isConsolation: true, isIndivGroup: true };
  const attested = (week, t1, t2) => ({ week, team1Id: t1, team2Id: t2, attested: true });

  it("ignores an individual group when judging the week", () => {
    const wk = { week: 15, matches: [group, { team1: "A", team2: "B" }] };
    // Regression: before individual groups were excluded, this returned false
    // forever and the finalize banner never appeared for the week.
    expect(weekFullyAttested(wk, [attested(15, "A", "B")])).toBe(true);
  });

  it("is false while any real match is unattested", () => {
    const wk = { week: 15, matches: [group, { team1: "A", team2: "B" }, { team1: "C", team2: "D" }] };
    expect(weekFullyAttested(wk, [attested(15, "A", "B")])).toBe(false);
  });

  it("does not count a signed-but-unattested result", () => {
    const wk = { week: 15, matches: [{ team1: "A", team2: "B" }] };
    const signedOnly = [{ week: 15, team1Id: "A", team2Id: "B", attested: false }];
    expect(weekFullyAttested(wk, signedOnly)).toBe(false);
  });

  it("is false for a week with nothing to attest", () => {
    // Only individual groups: there is no signature to wait for, so the week
    // is not "ready to finalize" on the strength of attestation.
    expect(weekFullyAttested({ week: 15, matches: [group] }, [])).toBe(false);
    expect(weekFullyAttested({ week: 15, matches: [] }, [])).toBe(false);
    expect(weekFullyAttested({ week: 15 }, [])).toBe(false);
  });

  it("does not match a result from another week", () => {
    const wk = { week: 15, matches: [{ team1: "A", team2: "B" }] };
    expect(weekFullyAttested(wk, [attested(14, "A", "B")])).toBe(false);
  });
});

describe("matchPids on an individual group", () => {
  it("returns the explicit players array, no team lookup", () => {
    const teams = [{ id: "A", player1: "p9", player2: "p8" }];
    const group = { players: ["p1", "p2", "p3", "p4"], isIndivGroup: true };
    expect(matchPids(group, teams)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("still resolves team rosters for a normal match", () => {
    const teams = [
      { id: "A", player1: "p1", player2: "p2" },
      { id: "B", player1: "p3", player2: "p4" },
    ];
    expect(matchPids({ team1: "A", team2: "B" }, teams)).toEqual(["p1", "p2", "p3", "p4"]);
  });
});
