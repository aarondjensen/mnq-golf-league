// ══════════════════════════════════════════════════════════════════
//  seeding — bracket order, and which playoff round is now
// ══════════════════════════════════════════════════════════════════
//
// A playoff week's `matches` array is TEE ORDER, not bracket order, and the two
// disagree on purpose. Reading one as the other puts the wrong teams on screen
// in a week where that is very visible.
//
// Split out of league.test.js when lib/league.js became seven modules. Tests
// live next to the code they cover here, and a single 626-line file covering
// five of them was not that.

import { describe, it, expect } from "vitest";
import { orderByBracketIdx, currentPlayoffRoundIdx } from "./seeding";

describe("orderByBracketIdx", () => {
  it("restores config order from a reordered tee sheet", () => {
    const out = orderByBracketIdx([
      { team1: "C", team2: "D", bracketIdx: 1 },
      { team1: "A", team2: "B", bracketIdx: 0 },
    ]);
    expect(out.map(m => m.team1)).toEqual(["A", "C"]);
  });

  it("leaves matches without the field in their stored order", () => {
    // Legacy weeks: tee order WAS bracket order, so position is the answer.
    const out = orderByBracketIdx([{ team1: "C" }, { team1: "A" }]);
    expect(out.map(m => m.team1)).toEqual(["C", "A"]);
  });

  it("does not mutate the array it is given", () => {
    const input = [{ team1: "C", bracketIdx: 1 }, { team1: "A", bracketIdx: 0 }];
    orderByBracketIdx(input);
    expect(input.map(m => m.team1)).toEqual(["C", "A"]);
  });

  it("is stable for matches that share a position", () => {
    const out = orderByBracketIdx([
      { team1: "X", bracketIdx: 0 },
      { team1: "Y", bracketIdx: 0 },
    ]);
    expect(out.map(m => m.team1)).toEqual(["X", "Y"]);
  });

  it("handles empty and missing input", () => {
    expect(orderByBracketIdx([])).toEqual([]);
    expect(orderByBracketIdx()).toEqual([]);
  });
});

// ── currentPlayoffRoundIdx ─────────────────────────────────────────
// The bracket scrolls horizontally, one column per round, and always opened
// at Round 1. By the fourth round of the playoffs that meant scrolling past
// three finished rounds to reach the one being played this week. This picks
// the column to open on; the scrolling itself is a layout effect and isn't
// covered here.
describe("currentPlayoffRoundIdx", () => {
  const ROUNDS = [{ name: "Round 1" }, { name: "Round 2" }, { name: "Round 3" }, { name: "Round 4" }];
  const pwk = (week, locked) => ({ week, isPlayoff: true, locked });

  it("opens on the round in progress", () => {
    // The reported case: weeks 13-15 done, week 16 being played.
    expect(currentPlayoffRoundIdx(ROUNDS, [pwk(13, true), pwk(14, true), pwk(15, true), pwk(16, false)])).toBe(3);
  });

  it("opens on round 1 before the playoffs have been played", () => {
    expect(currentPlayoffRoundIdx(ROUNDS, [pwk(13, false), pwk(14, false), pwk(15, false), pwk(16, false)])).toBe(0);
  });

  it("opens on the middle round mid-bracket", () => {
    expect(currentPlayoffRoundIdx(ROUNDS, [pwk(13, true), pwk(14, false), pwk(15, false), pwk(16, false)])).toBe(1);
  });

  it("stays on the final round once the whole bracket is finalized", () => {
    expect(currentPlayoffRoundIdx(ROUNDS, [pwk(13, true), pwk(14, true), pwk(15, true), pwk(16, true)])).toBe(3);
  });

  it("ignores a round with no week scheduled yet", () => {
    // Round 4 is configured but unscheduled — opening on its empty column
    // would be worse than opening on the last round that exists.
    expect(currentPlayoffRoundIdx(ROUNDS, [pwk(13, true), pwk(14, true), pwk(15, true)])).toBe(2);
  });

  it("handles a single-round or unconfigured bracket", () => {
    expect(currentPlayoffRoundIdx([{ name: "Final" }], [pwk(16, true)])).toBe(0);
    expect(currentPlayoffRoundIdx([], [])).toBe(0);
    expect(currentPlayoffRoundIdx()).toBe(0);
  });
});
