// ══════════════════════════════════════════════════════════════════
//  funScores.test.js
// ══════════════════════════════════════════════════════════════════
//
// Two things matter here. First, the partial-card rule: a fun round is
// casual and cards get abandoned, so a card thru 5 has to read as a
// real number rather than a fictional one. Second, the leaderboard
// ordering, which is the only place several near-identical scores get
// compared and the only place a sort bug would look plausible.

import { describe, it, expect } from "vitest";
import {
  funScoreId,
  normalizeHoles,
  indexFunScores,
  readFunCard,
  holesPlayed,
  isCardComplete,
  funRoundSide,
  funRoundLine,
  funPlayerHcp,
  buildFunLeaderboard,
  roundHasScores,
  formatToPar,
  funSpotSummary,
} from "./funScores";

const PARS = [4, 4, 4, 3, 5, 4, 4, 3, 5];        // 36
const HCPS = [1, 3, 5, 7, 9, 11, 13, 15, 17];
const course = { frontPars: PARS, backPars: PARS, frontHcps: HCPS, backHcps: HCPS };

const evenCard = [...PARS];                       // exactly par on every hole

describe("normalizeHoles", () => {
  it("always returns nine integers", () => {
    expect(normalizeHoles(undefined)).toHaveLength(9);
    expect(normalizeHoles([5, 4])).toEqual([5, 4, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("reads junk as unentered rather than letting it into a total", () => {
    expect(normalizeHoles([null, "", NaN, -3, 0, 4.5, 100, "6", 4]))
      .toEqual([0, 0, 0, 0, 0, 0, 0, 6, 4]);
  });

  it("truncates anything past nine holes", () => {
    expect(normalizeHoles(new Array(18).fill(4))).toHaveLength(9);
  });

  it("is not confused by a non-array", () => {
    expect(normalizeHoles("45444")).toEqual(new Array(9).fill(0));
  });
});

describe("indexFunScores / readFunCard", () => {
  it("keys cards by round and player", () => {
    const index = indexFunScores([
      { roundId: "r1", playerId: "p1", holes: evenCard },
      { roundId: "r2", playerId: "p1", holes: [5, 5, 5, 5, 5, 5, 5, 5, 5] },
    ]);
    expect(readFunCard(index, "r1", "p1")).toEqual(evenCard);
    expect(readFunCard(index, "r2", "p1")[0]).toBe(5);
  });

  it("returns an empty card for a player who hasn't posted", () => {
    expect(readFunCard({}, "r1", "nobody")).toEqual(new Array(9).fill(0));
  });

  it("skips malformed docs", () => {
    const index = indexFunScores([null, {}, { roundId: "r1" }, { playerId: "p1" }]);
    expect(index).toEqual({});
  });

  it("survives a null doc list", () => {
    expect(indexFunScores(null)).toEqual({});
  });
});

describe("funScoreId", () => {
  it("is deterministic, so re-saving a card overwrites it", () => {
    expect(funScoreId("r1", "p1")).toBe(funScoreId("r1", "p1"));
    expect(funScoreId("r1", "p1")).not.toBe(funScoreId("r1", "p2"));
    expect(funScoreId("r1", "p1")).not.toBe(funScoreId("r2", "p1"));
  });
});

describe("holesPlayed / isCardComplete", () => {
  it("counts only posted holes", () => {
    expect(holesPlayed([4, 4, 4, 0, 0, 0, 0, 0, 0])).toBe(3);
    expect(holesPlayed(undefined)).toBe(0);
  });

  it("knows a full card from a partial one", () => {
    expect(isCardComplete(evenCard)).toBe(true);
    expect(isCardComplete([4, 4, 4, 0, 0, 0, 0, 0, 0])).toBe(false);
  });
});

describe("funRoundSide", () => {
  it("picks the back nine's pars when the round is on the back", () => {
    const backCourse = { ...course, backPars: [5, 5, 5, 5, 5, 5, 5, 5, 5] };
    expect(funRoundSide({ side: "back" }, backCourse).pars[0]).toBe(5);
    expect(funRoundSide({ side: "back" }, backCourse).side).toBe("back");
  });

  it("defaults to the front nine", () => {
    expect(funRoundSide({}, course).side).toBe("front");
    expect(funRoundSide({ side: "nonsense" }, course).side).toBe("front");
  });

  it("returns nulls when the course hasn't loaded", () => {
    expect(funRoundSide({ side: "front" }, null).pars).toBeNull();
  });
});

describe("funRoundLine", () => {
  it("scores a scratch player's even card as level", () => {
    const line = funRoundLine(evenCard, PARS, HCPS, 0);
    expect(line.played).toBe(true);
    expect(line.gross).toBe(36);
    expect(line.grossToPar).toBe(0);
    expect(line.netToPar).toBe(0);
    expect(line.holesPlayed).toBe(9);
  });

  it("applies the player's strokes to a full card", () => {
    // A 4-handicap shooting even par is 4 under net.
    const line = funRoundLine(evenCard, PARS, HCPS, 4);
    expect(line.grossToPar).toBe(0);
    expect(line.netToPar).toBe(-4);
  });

  it("scores a PARTIAL card against only the holes played", () => {
    // Thru 3 at even par is E, not a fictional -27 against a full 36.
    const partial = [4, 4, 4, 0, 0, 0, 0, 0, 0];
    const line = funRoundLine(partial, PARS, HCPS, 0);
    expect(line.holesPlayed).toBe(3);
    expect(line.gross).toBe(12);
    expect(line.grossToPar).toBe(0);
  });

  it("gives a partial card only the strokes that fall on holes played", () => {
    // HCPS puts stroke holes at index 0,1,2 for a 3-handicap (1,3,5 are
    // the three lowest indexes), so a card thru 3 gets all 3 strokes.
    const partial = [4, 4, 4, 0, 0, 0, 0, 0, 0];
    expect(funRoundLine(partial, PARS, HCPS, 3).netToPar).toBe(-3);
    // Thru the LAST three holes instead, the same handicap earns none of
    // them — those are the easiest holes on the side.
    const late = [0, 0, 0, 0, 0, 0, 4, 3, 5];
    expect(funRoundLine(late, PARS, HCPS, 3).netToPar).toBe(0);
  });

  it("reports an empty card as unplayed rather than as level par", () => {
    const line = funRoundLine(new Array(9).fill(0), PARS, HCPS, 0);
    expect(line.played).toBe(false);
    expect(line.holesPlayed).toBe(0);
  });

  it("falls back to sane pars when the course hasn't loaded", () => {
    // Shouldn't throw while course data is still in flight.
    expect(() => funRoundLine(evenCard, null, null, 0)).not.toThrow();
  });
});

describe("funPlayerHcp", () => {
  it("rounds, matching every other card in the app", () => {
    expect(funPlayerHcp({ handicapIndex: 7.6 })).toBe(8);
    expect(funPlayerHcp({ handicapIndex: -1.2 })).toBe(-1);
  });

  it("treats a missing handicap as scratch", () => {
    expect(funPlayerHcp({})).toBe(0);
    expect(funPlayerHcp(null)).toBe(0);
  });
});

describe("buildFunLeaderboard", () => {
  const players = [
    { id: "p1", name: "Aaron Jensen", handicapIndex: 0 },
    { id: "p2", name: "Bob Vigo", handicapIndex: 0 },
    { id: "p3", name: "Cal Stevens", handicapIndex: 0 },
    { id: "p4", name: "Dan Marks", handicapIndex: 0 },
  ];
  const grid = [["p1", "p2"], ["p3", "p4"]];
  const over = (n) => { const c = [...PARS]; c[0] += n; return c; };

  const board = (index) => buildFunLeaderboard({
    grid, index, roundId: "r1", players, pars: PARS, hcps: HCPS,
  });

  it("sorts best net first", () => {
    const rows = board(indexFunScores([
      { roundId: "r1", playerId: "p1", holes: over(3) },
      { roundId: "r1", playerId: "p2", holes: over(1) },
      { roundId: "r1", playerId: "p3", holes: over(2) },
      { roundId: "r1", playerId: "p4", holes: evenCard },
    ]));
    expect(rows.map(r => r.pid)).toEqual(["p4", "p2", "p3", "p1"]);
  });

  it("ranks on NET, not gross", () => {
    // p2 shoots four worse gross but gets six strokes.
    const withHcp = [
      { id: "p1", name: "Aaron Jensen", handicapIndex: 0 },
      { id: "p2", name: "Bob Vigo", handicapIndex: 6 },
    ];
    const rows = buildFunLeaderboard({
      grid: [["p1", "p2"]],
      index: indexFunScores([
        { roundId: "r1", playerId: "p1", holes: evenCard },
        { roundId: "r1", playerId: "p2", holes: over(4) },
      ]),
      roundId: "r1", players: withHcp, pars: PARS, hcps: HCPS,
    });
    expect(rows[0].pid).toBe("p2");
    expect(rows[0].line.netToPar).toBe(-2);
  });

  it("keeps players with no card, at the bottom", () => {
    // The sheet says they're playing; dropping them would read as a bug
    // rather than as "hasn't posted."
    const rows = board(indexFunScores([{ roundId: "r1", playerId: "p3", holes: evenCard }]));
    expect(rows).toHaveLength(4);
    expect(rows[0].pid).toBe("p3");
    expect(rows.slice(1).every(r => r.line.played === false)).toBe(true);
  });

  it("breaks a net tie on gross, then on holes played", () => {
    const rows = buildFunLeaderboard({
      grid: [["p1", "p2"]],
      index: indexFunScores([
        { roundId: "r1", playerId: "p1", holes: [4, 4, 4, 0, 0, 0, 0, 0, 0] }, // E thru 3
        { roundId: "r1", playerId: "p2", holes: evenCard },                     // E thru 9
      ]),
      roundId: "r1", players, pars: PARS, hcps: HCPS,
    });
    // Same net (E) and same gross-to-par (E), so the completed round wins.
    expect(rows[0].pid).toBe("p2");
  });

  it("ignores empty spots on the sheet", () => {
    const rows = buildFunLeaderboard({
      grid: [["p1", null, null, null]],
      index: {}, roundId: "r1", players, pars: PARS, hcps: HCPS,
    });
    expect(rows).toHaveLength(1);
  });

  it("labels which group each player is in", () => {
    const rows = board({});
    expect(rows.find(r => r.pid === "p3").groupIdx).toBe(1);
  });

  it("names an unknown player rather than crashing", () => {
    const rows = buildFunLeaderboard({
      grid: [["ghost"]], index: {}, roundId: "r1", players, pars: PARS, hcps: HCPS,
    });
    expect(rows[0].name).toBe("Unknown");
  });
});

describe("roundHasScores", () => {
  const grid = [["p1", "p2"]];

  it("is false before anyone posts", () => {
    expect(roundHasScores({ grid, index: {}, roundId: "r1" })).toBe(false);
  });

  it("is true after a single hole", () => {
    const index = indexFunScores([{ roundId: "r1", playerId: "p2", holes: [5] }]);
    expect(roundHasScores({ grid, index, roundId: "r1" })).toBe(true);
  });

  it("does not count another round's scores", () => {
    const index = indexFunScores([{ roundId: "OTHER", playerId: "p1", holes: evenCard }]);
    expect(roundHasScores({ grid, index, roundId: "r1" })).toBe(false);
  });
});

describe("funSpotSummary", () => {
  const player = { id: "p1", name: "Aaron Jensen", handicapIndex: 0 };
  const index = (holes) => indexFunScores([{ roundId: "r1", playerId: "p1", holes }]);

  it("marks a completed card with F rather than 'thru 9'", () => {
    expect(funSpotSummary(index(evenCard), "r1", "p1", PARS, HCPS, player)).toBe("E · F");
  });

  it("reports a partial card's progress", () => {
    const partial = [5, 4, 4, 0, 0, 0, 0, 0, 0];
    expect(funSpotSummary(index(partial), "r1", "p1", PARS, HCPS, player)).toBe("+1 · thru 3");
  });

  it("returns null for a player with no card, so nothing renders", () => {
    expect(funSpotSummary({}, "r1", "p1", PARS, HCPS, player)).toBeNull();
  });
});

describe("formatToPar", () => {
  it("renders the app's usual to-par forms", () => {
    expect(formatToPar(3)).toBe("+3");
    expect(formatToPar(0)).toBe("E");
    expect(formatToPar(-2)).toBe("-2");
    expect(formatToPar(undefined)).toBe("—");
  });
});
