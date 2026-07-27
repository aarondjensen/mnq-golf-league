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
  computeRoundLine,
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

  // Elimination reads matchWinnerId (via bracketOutcome), the same field every
  // W-L-T display uses. A points compare disagrees with the app in both
  // directions under lowHighBonus, which awards three independent point lines.
  it("eliminates the side matchWinnerId says lost, not the one with fewer points", () => {
    const sch = [{ week: 10, isPlayoff: true, matches: [{ team1: "A", team2: "J" }] }];
    // A won the match but J walked away with more total points.
    const res = [{
      week: 10, team1Id: "A", team2Id: "J",
      team1Points: 1, team2Points: 4,
      matchResultText: "2UP", matchWinnerId: "A",
    }];
    const out = computeEliminatedTeamIds({ schedule: sch, matchResults: res, uptoWeek: 11 });
    expect(out.has("J")).toBe(true);
    expect(out.has("A")).toBe(false);
  });

  it("does not eliminate the higher seed on a TIED match that gave team2 more points", () => {
    const sch = [{ week: 10, isPlayoff: true, matches: [{ team1: "A", team2: "J" }] }];
    const res = [{
      week: 10, team1Id: "A", team2Id: "J",
      team1Points: 1, team2Points: 3,
      matchResultText: "TIED", matchWinnerId: null,
    }];
    const out = computeEliminatedTeamIds({ schedule: sch, matchResults: res, uptoWeek: 11 });
    expect(out.has("J")).toBe(true);   // tie → higher seed advances
    expect(out.has("A")).toBe(false);
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

  // ── Standing tiers ───────────────────────────────────────────────
  // rankIndividualBoard sorts golfers with no net score to the BOTTOM of the
  // leaderboard; reversing then promoted them to the FRONT of the tee sheet,
  // seating withdrawn golfers — who aren't playing at all — in the first group
  // ahead of the entire live field.
  it("seats withdrawn golfers last instead of first", () => {
    // b7 and b8 are the two worst nets, but both have withdrawn.
    const groups = pairEliminatedIndividuals(rankOrder.slice(), rankOrder, {
      withdrawnPids: ["b7", "b8"],
    });
    expect(groups[0]).toEqual(["b6", "b5", "b4", "b3"]);
    expect(groups[1]).toEqual(["b2", "b1", "b8", "b7"]);
  });

  it("seats golfers with no standing after the ranked field but ahead of withdrawals", () => {
    const groups = pairEliminatedIndividuals(rankOrder.slice(), rankOrder, {
      noStandingPids: ["b6"],
      withdrawnPids: ["b8"],
    });
    // Ranked worst-first (b7, b5..b1), then the no-standing golfer, then the
    // withdrawal at the very back of the tee sheet.
    expect([...groups[0], ...groups[1]]).toEqual(
      ["b7", "b5", "b4", "b3", "b2", "b1", "b6", "b8"]
    );
  });

  it("accepts Sets as well as arrays for the tier options", () => {
    const groups = pairEliminatedIndividuals(rankOrder.slice(), rankOrder, {
      withdrawnPids: new Set(["b7", "b8"]),
    });
    expect(groups[0]).toEqual(["b6", "b5", "b4", "b3"]);
  });

  it("is unchanged from plain reverse order when no options are passed", () => {
    const withOpts = pairEliminatedIndividuals(rankOrder.slice(), rankOrder, {});
    const without = pairEliminatedIndividuals(rankOrder.slice(), rankOrder);
    expect(withOpts).toEqual(without);
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

// ── computeRoundLine ───────────────────────────────────────────────
// The per-round net calc shared by the group card, the group scorecard and
// the cumulative leaderboard. The rule that carries the risk: a PARTIAL round
// scores against the par of the holes actually played and only the strokes
// falling on those holes — otherwise a card thru 5 reads as a fictional -12
// and an in-progress group card lies about who's leading.
describe("computeRoundLine", () => {
  const pars = [4, 4, 4, 3, 5, 4, 4, 3, 5];       // par 36
  const hcps = [1, 2, 3, 4, 5, 6, 7, 8, 9];       // stroke order = hole order

  const irFrom = (holes, extra = {}) => ({
    withdrawn: false, mode: "live", holes,
    gross: Object.values(holes).reduce((a, b) => a + b, 0),
    holesPlayed: Object.keys(holes).length,
    totalOnly: false,
    ...extra,
  });

  it("returns an unplayed line for mode 'none'", () => {
    const out = computeRoundLine({ ir: { mode: "none", holes: {}, gross: 0, holesPlayed: 0 }, pars, hcps, roundHcp: 5 });
    expect(out.played).toBe(false);
    expect(out.gross).toBe(0);
    expect(out.netToPar).toBe(0);
  });

  it("scores a full scratch round against full par", () => {
    const holes = {};
    pars.forEach((p, i) => { holes[i] = p; });
    const out = computeRoundLine({ ir: irFrom(holes), pars, hcps, roundHcp: 0 });
    expect(out.gross).toBe(36);
    expect(out.grossToPar).toBe(0);
    expect(out.netToPar).toBe(0);
    expect(out.holesPlayed).toBe(9);
  });

  it("applies handicap strokes to a full round", () => {
    const holes = {};
    pars.forEach((p, i) => { holes[i] = p + 1; });   // bogey every hole → 45
    const out = computeRoundLine({ ir: irFrom(holes), pars, hcps, roundHcp: 4 });
    expect(out.gross).toBe(45);
    expect(out.grossToPar).toBe(9);
    expect(out.netToPar).toBe(5);                    // 9 over, 4 strokes back
  });

  it("scores a partial round against only the holes played", () => {
    // Holes 0-2 (par 4/4/4 = 12), bogey each → gross 15. Handicap 9 gives a
    // stroke on every hole, so 3 strokes land on the 3 holes played.
    const out = computeRoundLine({ ir: irFrom({ 0: 5, 1: 5, 2: 5 }), pars, hcps, roundHcp: 9 });
    expect(out.gross).toBe(15);
    expect(out.grossToPar).toBe(3);
    expect(out.netToPar).toBe(0);
    expect(out.holesPlayed).toBe(3);
  });

  it("counts only the strokes that fall on holes played", () => {
    // Handicap 2 → strokes on holes with hcp index 1 and 2 (holes 0 and 1).
    // Playing holes 5-7 only means NO strokes apply.
    const out = computeRoundLine({ ir: irFrom({ 5: 4, 6: 4, 7: 3 }), pars, hcps, roundHcp: 2 });
    expect(out.grossToPar).toBe(0);
    expect(out.netToPar).toBe(0);                    // no strokes on 6,7,8
  });

  it("uses full par and the whole handicap for a total-only makeup", () => {
    const ir = { withdrawn: false, mode: "makeupTotal", holes: {}, gross: 44, holesPlayed: 9, totalOnly: true };
    const out = computeRoundLine({ ir, pars, hcps, roundHcp: 6 });
    expect(out.grossToPar).toBe(8);                  // 44 - 36
    expect(out.netToPar).toBe(2);                    // 8 - 6
    expect(out.totalOnly).toBe(true);
  });

  it("subtracts strokes for a plus handicap instead of adding them", () => {
    // roundHcp < 0 → the golfer GIVES strokes back, so net is worse than gross.
    const holes = {};
    pars.forEach((p, i) => { holes[i] = p; });
    const out = computeRoundLine({ ir: irFrom(holes), pars, hcps, roundHcp: -2 });
    expect(out.grossToPar).toBe(0);
    expect(out.netToPar).toBe(2);
  });

  it("falls back to standard pars/hcps when the course is missing", () => {
    const out = computeRoundLine({ ir: irFrom({ 0: 4 }), pars: null, hcps: null, roundHcp: 0 });
    expect(out.played).toBe(true);
    expect(out.gross).toBe(4);
  });
});

// ── Withdrawal is final ────────────────────────────────────────────
// A golfer marked absent in a knocked-out foursome is withdrawn from the
// individual tournament (the Absent button writes the _hindivwd sentinel).
// The rule the commissioner confirmed: the withdrawal is FINAL. They may
// still tee off in later weeks — they're still in the eliminated pool and
// still get a tee time — but nothing they post from that point counts toward
// the individual tournament, and they rank below everyone still in it.
//
// Both halves are load-bearing and easy to break: dropping the `withdrew`
// latch would silently re-admit them on the strength of a later round, and
// dropping the ranking bucket would leave a withdrawn golfer sitting mid-table
// on a truncated total.
describe("withdrawal is final", () => {
  const course = {
    frontPars: [4, 4, 4, 3, 5, 4, 4, 3, 5],
    backPars: [4, 4, 4, 3, 5, 4, 4, 3, 5],
    frontHcps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    backHcps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  };
  const playoffWeeks = [
    { week: 15, isPlayoff: true, side: "front" },
    { week: 16, isPlayoff: true, side: "front" },
  ];
  const scoringRules = { hcpRecentCount: 8, hcpBestCount: 6 };
  // Scratch golfers so net === gross-to-par and the arithmetic is obvious.
  const players = [{ id: "quit", name: "Quinn Quit" }, { id: "stay", name: "Sam Stay" }];
  const allRounds = { quit: [], stay: [] };

  // Week 15: both play even par (36). Quinn is then marked absent in week 15.
  // Week 16: both play even par again — Quinn really did tee off.
  const scores = {};
  for (const pid of ["quit", "stay"]) {
    for (const wk of [15, 16]) {
      course.frontPars.forEach((par, h) => { scores[`w${wk}_p${pid}_h${h}`] = par; });
    }
  }
  scores["w15_pquit_hindivwd"] = 1;

  const boardFor = (pid) => computeIndividualBoard({
    players, scores, playoffWeeks, course, scoringRules, allRounds,
    leagueConfig: { year: 2026 },
  }).find(r => r.pid === pid);

  it("counts nothing from the withdrawal week onward", () => {
    const quit = boardFor("quit");
    expect(quit.withdrew).toBe(true);
    expect(quit.wdRound).toBe(15);
    // Week 15 is the withdrawal week and week 16 is after it — neither counts,
    // even though week 16 has a full 9-hole card on file.
    expect(quit.roundsPlayed).toBe(0);
    expect(quit.totalGross).toBe(0);
    expect(quit.totalNetToPar).toBe(0);
  });

  it("still counts both rounds for a golfer who didn't withdraw", () => {
    const stay = boardFor("stay");
    expect(stay.withdrew).toBe(false);
    expect(stay.roundsPlayed).toBe(2);
    expect(stay.totalGross).toBe(72);
  });

  it("ranks the withdrawn golfer last, below players with no rounds at all", () => {
    const board = computeIndividualBoard({
      players: [...players, { id: "never", name: "Ned Never" }],
      scores, playoffWeeks, course, scoringRules,
      allRounds: { ...allRounds, never: [] },
      leagueConfig: { year: 2026 },
    });
    // Best → worst: posted a round, then no rounds yet, then withdrawn.
    expect(rankIndividualBoard(board)).toEqual(["stay", "never", "quit"]);
  });

  it("does not withdraw a golfer whose sentinel is on a different week", () => {
    // Per-week sentinel: the flag written in week 15 must not leak backwards
    // into a board that only covers week 16.
    const laterOnly = computeIndividualBoard({
      players, scores, playoffWeeks: [{ week: 16, isPlayoff: true, side: "front" }],
      course, scoringRules, allRounds, leagueConfig: { year: 2026 },
    }).find(r => r.pid === "quit");
    expect(laterOnly.withdrew).toBe(false);
    expect(laterOnly.roundsPlayed).toBe(1);
  });
});

// ── Tee order end-to-end (withdrawn golfers seated last) ───────────
// The unit test above pins pairEliminatedIndividuals' tier logic; this pins
// that buildEliminatedIndivGroups actually DERIVES the tiers from the board
// and passes them through. Without the wiring the tier options default to
// empty and the reverse ordering promotes withdrawals to the first group —
// the bug this covers.
describe("buildEliminatedIndivGroups tee order", () => {
  const course = {
    frontPars: [4, 4, 4, 3, 5, 4, 4, 3, 5],
    backPars: [4, 4, 4, 3, 5, 4, 4, 3, 5],
    frontHcps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    backHcps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  };
  const scoringRules = { hcpRecentCount: 8, hcpBestCount: 6 };
  // Two teams, both knocked out in week 15. Scratch golfers, so net to par is
  // just (gross - 36) and the intended order is unambiguous.
  const teams = [
    { id: "J", player1: "hi", player2: "lo" },
    { id: "I", player1: "wd", player2: "mid" },
  ];
  const players = [
    { id: "hi", name: "Hy Score" },    // +9 — worst net, should tee off FIRST
    { id: "lo", name: "Lo Score" },    // -4 — best net, should tee off LAST
    { id: "mid", name: "Mid Dell" },   // +2
    { id: "wd", name: "Willa Drew" },  // withdrew — no standing at all
  ];
  const allRounds = { hi: [], lo: [], mid: [], wd: [] };

  const schedule = [
    { week: 15, isPlayoff: true, side: "front", matches: [
      { team1: "A", team2: "J" },
      { team1: "B", team2: "I" },
    ] },
    { week: 16, isPlayoff: true, side: "front", matches: [] },
  ];
  const matchResults = [
    { week: 15, team1Id: "A", team2Id: "J", matchWinnerId: "A", matchResultText: "3UP" },
    { week: 15, team1Id: "B", team2Id: "I", matchWinnerId: "B", matchResultText: "2UP" },
  ];

  // Week 15 cards: par on every hole, then adjust hole 0 to set each net.
  const scores = {};
  for (const pid of ["hi", "lo", "mid", "wd"]) {
    course.frontPars.forEach((par, h) => { scores[`w15_p${pid}_h${h}`] = par; });
  }
  scores["w15_phi_h0"] = 4 + 9;    // +9
  scores["w15_plo_h0"] = 4 - 4;    // -4
  scores["w15_pmid_h0"] = 4 + 2;   // +2
  scores["w15_pwd_hindivwd"] = 1;  // withdrew — her card doesn't count

  it("orders worst-net first and puts the withdrawn golfer at the back", () => {
    const { indivMatches } = buildEliminatedIndivGroups({
      week: 16, teams, schedule, matchResults, players, scores,
      course, scoringRules, allRounds, leagueConfig: { year: 2026 },
    });
    expect(indivMatches).toHaveLength(1);
    expect(indivMatches[0].players).toEqual(["hi", "mid", "lo", "wd"]);
  });
});
