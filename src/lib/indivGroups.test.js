// ══════════════════════════════════════════════════════════════════
//  Tests for lib/indivGroups.js
// ══════════════════════════════════════════════════════════════════
//
// Coverage focus
// ──────────────
// The pure engine behind playoff individual-group foursomes. Two pieces
// carry the risk:
//
//   • computeEliminatedTeamIds — a team is out once it LOSES a bracket
//     match. Consolation / individual-group matches must NEVER count, and a
//     TIED result must eliminate team2 (higher seed team1 advances).
//
//   • pairEliminatedIndividuals — groups the eliminated pool by REVERSE
//     leaderboard order (worst net first) into foursomes with at most a
//     trailing twosome. Since teams die two-at-a-time the pool is always
//     even; we still pin the defensive single-merge for malformed input.
//
// computeIndividualBoard's net math is exercised indirectly (it's the ported,
// already-shipped IndividualEventView calc); here we pin the empty/degenerate
// guard and the ranking order the pairing depends on.

import { describe, it, expect } from "vitest";
import {
  computeEliminatedTeamIds,
  pairEliminatedIndividuals,
  rankIndividualBoard,
  computeIndividualBoard,
  buildEliminatedIndivGroups,
  buildPlayoffNonBracketMatches,
} from "./indivGroups";

// ── computeEliminatedTeamIds ───────────────────────────────────────
describe("computeEliminatedTeamIds", () => {
  const schedule = [
    { week: 9, isPlayoff: false },
    {
      week: 10, isPlayoff: true, matches: [
        { team1: "A", team2: "J" },              // bracket
        { team1: "B", team2: "I" },              // bracket
        { players: ["p1", "p2"], isIndivGroup: true, isConsolation: true }, // ignored
      ],
    },
    {
      week: 11, isPlayoff: true, matches: [
        { team1: "A", team2: "B" },              // bracket
        { team1: "C", team2: "D", isConsolation: true }, // consolation — ignored
      ],
    },
  ];
  const matchResults = [
    { week: 10, team1Id: "A", team2Id: "J", team1Points: 2, team2Points: 0 }, // J out
    { week: 10, team1Id: "B", team2Id: "I", team1Points: 1, team2Points: 1 }, // tie → I out
    { week: 11, team1Id: "A", team2Id: "B", team1Points: 0, team2Points: 2 }, // A out
    { week: 11, team1Id: "C", team2Id: "D", team1Points: 2, team2Points: 0 }, // consolation, ignored
  ];

  it("collects bracket losers strictly before uptoWeek", () => {
    const out = computeEliminatedTeamIds({ schedule, matchResults, uptoWeek: 11 });
    // Only week 10 counts when asking "as of week 11".
    expect([...out].sort()).toEqual(["I", "J"]);
  });

  it("eliminates team2 on a TIED result (team1/higher seed advances)", () => {
    const out = computeEliminatedTeamIds({ schedule, matchResults, uptoWeek: 11 });
    expect(out.has("I")).toBe(true);   // lost on the tie
    expect(out.has("B")).toBe(false);  // advanced on the tie
  });

  it("never counts consolation or individual-group matches", () => {
    const out = computeEliminatedTeamIds({ schedule, matchResults, uptoWeek: 12 });
    expect(out.has("D")).toBe(false);  // consolation loser, not eliminated
    expect(out.has("p1")).toBe(false); // indiv-group pids are not teams
  });

  it("accumulates across rounds as of a later week", () => {
    const out = computeEliminatedTeamIds({ schedule, matchResults, uptoWeek: 12 });
    expect([...out].sort()).toEqual(["A", "I", "J"]);
  });
});

// ── pairEliminatedIndividuals ──────────────────────────────────────
describe("pairEliminatedIndividuals", () => {
  // Leaderboard order best→worst.
  const rankOrder = ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"];

  it("groups eight eliminated players into two reverse-ordered foursomes", () => {
    const groups = pairEliminatedIndividuals(rankOrder.slice(), rankOrder);
    expect(groups).toHaveLength(2);
    // Worst four tee off first.
    expect(groups[0]).toEqual(["b8", "b7", "b6", "b5"]);
    expect(groups[1]).toEqual(["b4", "b3", "b2", "b1"]);
  });

  it("leaves a trailing twosome when six are eliminated (never a 3 or 5)", () => {
    const elim = ["b3", "b4", "b5", "b6", "b7", "b8"];
    const groups = pairEliminatedIndividuals(elim, rankOrder);
    expect(groups.map(g => g.length)).toEqual([4, 2]);
    expect(groups[0]).toEqual(["b8", "b7", "b6", "b5"]);
    expect(groups[1]).toEqual(["b4", "b3"]);
  });

  it("orders strictly by reverse net even when the eliminated set is scattered", () => {
    const elim = ["b2", "b8", "b5", "b1"];
    const groups = pairEliminatedIndividuals(elim, rankOrder);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(["b8", "b5", "b2", "b1"]);
  });

  it("returns [] for an empty pool", () => {
    expect(pairEliminatedIndividuals([], rankOrder)).toEqual([]);
  });

  it("defensively merges a lone single up into the previous group", () => {
    // Malformed odd count (shouldn't happen in the real bracket).
    const elim = ["b1", "b2", "b3", "b4", "b5"];
    const groups = pairEliminatedIndividuals(elim, rankOrder);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(["b5", "b4", "b3", "b2", "b1"]);
  });
});

// ── rankIndividualBoard ────────────────────────────────────────────
describe("rankIndividualBoard", () => {
  it("orders played rounds by net asc, then unplayed, then withdrawn last", () => {
    const board = [
      { pid: "wd", name: "W", totalNetToPar: -5, roundsPlayed: 3, totalHolesPlayed: 27, withdrew: true },
      { pid: "unp", name: "U", totalNetToPar: 0, roundsPlayed: 0, totalHolesPlayed: 0, withdrew: false },
      { pid: "good", name: "G", totalNetToPar: -3, roundsPlayed: 2, totalHolesPlayed: 18, withdrew: false },
      { pid: "bad", name: "B", totalNetToPar: 4, roundsPlayed: 2, totalHolesPlayed: 18, withdrew: false },
    ];
    expect(rankIndividualBoard(board)).toEqual(["good", "bad", "unp", "wd"]);
  });

  it("breaks a net tie by more holes played", () => {
    const board = [
      { pid: "thru9", name: "A", totalNetToPar: 1, roundsPlayed: 1, totalHolesPlayed: 9, withdrew: false },
      { pid: "thru4", name: "B", totalNetToPar: 1, roundsPlayed: 1, totalHolesPlayed: 4, withdrew: false },
    ];
    expect(rankIndividualBoard(board)).toEqual(["thru9", "thru4"]);
  });
});

// ── computeIndividualBoard (guard) ─────────────────────────────────
describe("computeIndividualBoard", () => {
  it("returns stable zero rows when there is no course or no weeks", () => {
    const players = [{ id: "p1", name: "One", handicapIndex: 4 }];
    const out = computeIndividualBoard({ players, playoffWeeks: [], course: null });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ pid: "p1", totalNetToPar: 0, roundsPlayed: 0, startHcp: 4 });
  });
});

// ── buildEliminatedIndivGroups (integration) ───────────────────────
describe("buildEliminatedIndivGroups", () => {
  it("produces isIndivGroup matches only for eliminated teams", () => {
    const teams = [
      { id: "A", player1: "a1", player2: "a2" },
      { id: "B", player1: "b1", player2: "b2" },
      { id: "J", player1: "j1", player2: "j2" }, // eliminated
      { id: "I", player1: "i1", player2: "i2" }, // eliminated
    ];
    const schedule = [
      {
        week: 10, isPlayoff: true, matches: [
          { team1: "A", team2: "J" },
          { team1: "B", team2: "I" },
        ],
      },
      { week: 11, isPlayoff: true, matches: [] },
    ];
    const matchResults = [
      { week: 10, team1Id: "A", team2Id: "J", team1Points: 2, team2Points: 0 },
      { week: 10, team1Id: "B", team2Id: "I", team1Points: 2, team2Points: 0 },
    ];
    const { indivMatches, eliminatedTeamIds } = buildEliminatedIndivGroups({
      week: 11, teams, schedule, matchResults,
      players: teams.flatMap(t => [
        { id: t.player1, name: t.player1 },
        { id: t.player2, name: t.player2 },
      ]),
      scores: {}, course: null, scoringRules: null, allRounds: null, leagueConfig: null,
    });
    expect([...eliminatedTeamIds].sort()).toEqual(["I", "J"]);
    // 4 eliminated players → one foursome, flagged.
    expect(indivMatches).toHaveLength(1);
    expect(indivMatches[0].isIndivGroup).toBe(true);
    expect(indivMatches[0].isConsolation).toBe(true);
    expect(indivMatches[0].team1).toBeUndefined();
    expect(indivMatches[0].players.slice().sort()).toEqual(["i1", "i2", "j1", "j2"]);
  });

  it("returns nothing when no team has been eliminated yet", () => {
    const out = buildEliminatedIndivGroups({
      week: 10, teams: [{ id: "A", player1: "a1", player2: "a2" }],
      schedule: [{ week: 10, isPlayoff: true, matches: [] }],
      matchResults: [], players: [], scores: {},
    });
    expect(out.indivMatches).toEqual([]);
    expect(out.eliminatedPids).toEqual([]);
  });
});

// ── buildPlayoffNonBracketMatches (three-way split) ────────────────
describe("buildPlayoffNonBracketMatches", () => {
  // Six teams. Week 10 bracket: A/B advance (bracket week 11), J & I lost.
  // Week 11: bracket = A vs B; non-bracket pool = {C, D (alive byes), J, I (eliminated)}.
  const teams = [
    { id: "A", player1: "a1", player2: "a2" },
    { id: "B", player1: "b1", player2: "b2" },
    { id: "C", player1: "c1", player2: "c2" },
    { id: "D", player1: "d1", player2: "d2" },
    { id: "J", player1: "j1", player2: "j2" },
    { id: "I", player1: "i1", player2: "i2" },
  ];
  const schedule = [
    {
      week: 10, isPlayoff: true, matches: [
        { team1: "A", team2: "J" },
        { team1: "B", team2: "I" },
      ],
    },
    { week: 11, isPlayoff: true, matches: [] },
  ];
  const matchResults = [
    { week: 10, team1Id: "A", team2Id: "J", team1Points: 2, team2Points: 0 },
    { week: 10, team1Id: "B", team2Id: "I", team1Points: 2, team2Points: 0 },
  ];
  const bracketMatches = [{ team1: "A", team2: "B" }];
  const playoffSeeds = ["A", "B", "C", "D", "J", "I"];

  it("returns [] when consolation is disabled", () => {
    const out = buildPlayoffNonBracketMatches({
      week: 11, teams, schedule, matchResults, players: [], scores: {},
      leagueConfig: { consolationEnabled: false }, bracketMatches, playoffSeeds,
    });
    expect(out).toEqual([]);
  });

  it("pairs ALL non-bracket teams as teams when individualize is off", () => {
    const out = buildPlayoffNonBracketMatches({
      week: 11, teams, schedule, matchResults, players: [], scores: {},
      leagueConfig: { consolationEnabled: true, individualizeEliminated: false },
      bracketMatches, playoffSeeds,
    });
    // No individual groups; C/D/J/I all paired as teams (2 team matches).
    expect(out.every(m => !m.isIndivGroup)).toBe(true);
    expect(out.every(m => m.isConsolation === true)).toBe(true);
    const placed = new Set(out.flatMap(m => [m.team1, m.team2]));
    expect([...placed].sort()).toEqual(["C", "D", "I", "J"]);
  });

  it("splits eliminated → individual foursome, alive byes → team match, when on", () => {
    const players = teams.flatMap(t => [
      { id: t.player1, name: t.player1 }, { id: t.player2, name: t.player2 },
    ]);
    const out = buildPlayoffNonBracketMatches({
      week: 11, teams, schedule, matchResults, players, scores: {},
      course: null, scoringRules: null, allRounds: null,
      leagueConfig: { consolationEnabled: true, individualizeEliminated: true },
      bracketMatches, playoffSeeds,
    });
    const indiv = out.filter(m => m.isIndivGroup);
    const teamMatches = out.filter(m => !m.isIndivGroup);

    // Eliminated J + I → one four-player individual group.
    expect(indiv).toHaveLength(1);
    expect(indiv[0].players.slice().sort()).toEqual(["i1", "i2", "j1", "j2"]);

    // Eliminated teams must NOT appear in any team consolation match.
    const teamPlaced = new Set(teamMatches.flatMap(m => [m.team1, m.team2]));
    expect(teamPlaced.has("J")).toBe(false);
    expect(teamPlaced.has("I")).toBe(false);
    // Alive byes C & D still pair as a team.
    expect([...teamPlaced].sort()).toEqual(["C", "D"]);

    // Tee order: individual groups first, then team consolation.
    expect(out[0].isIndivGroup).toBe(true);
  });
});
