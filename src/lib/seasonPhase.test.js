import { describe, it, expect } from "vitest";
import { isSeasonComplete } from "./seasonPhase";

const wk = (over) => ({ matches: [{ team1: "T1", team2: "T2" }], ...over });

describe("isSeasonComplete", () => {
  it("is false for an empty or unbuilt schedule", () => {
    expect(isSeasonComplete([])).toBe(false);
    expect(isSeasonComplete(null)).toBe(false);
    expect(isSeasonComplete([{ week: 1, matches: [] }])).toBe(false);
  });

  it("is false while the final playoff round is unlocked", () => {
    expect(isSeasonComplete([
      wk({ week: 15, isPlayoff: true, locked: true }),
      wk({ week: 16, isPlayoff: true, locked: false }),
    ])).toBe(false);
  });

  it("is true once the final playoff round is locked", () => {
    expect(isSeasonComplete([
      wk({ week: 15, isPlayoff: true, locked: true }),
      wk({ week: 16, isPlayoff: true, locked: true }),
    ])).toBe(true);
  });

  it("does not care about an unlocked mid-season week left open for a makeup", () => {
    // The whole reason this isn't `every(locked)`: one stray open week
    // must not keep the season alive after the bracket has crowned a
    // champion.
    expect(isSeasonComplete([
      wk({ week: 4, locked: false }),
      wk({ week: 14, locked: true }),
      wk({ week: 16, isPlayoff: true, locked: true }),
    ])).toBe(true);
  });

  it("ignores a rained-out final week and judges by the last one played", () => {
    expect(isSeasonComplete([
      wk({ week: 15, isPlayoff: true, locked: true }),
      wk({ week: 16, isPlayoff: true, rainedOut: true, locked: false }),
    ])).toBe(true);
  });

  it("ignores a scheduled-but-unseeded playoff week with no matchups yet", () => {
    expect(isSeasonComplete([
      wk({ week: 15, isPlayoff: true, locked: true }),
      { week: 16, isPlayoff: true, matches: [], locked: false },
    ])).toBe(true);
  });

  it("is not fooled by regular weeks running later than the playoffs", () => {
    // A makeup week numbered after the final can exist; the playoff
    // round is still what ends the season.
    expect(isSeasonComplete([
      wk({ week: 16, isPlayoff: true, locked: true }),
      wk({ week: 17, makeupFor: 4, locked: false }),
    ])).toBe(true);
  });

  it("falls back to the last played week when there are no playoffs at all", () => {
    expect(isSeasonComplete([
      wk({ week: 13, locked: true }),
      wk({ week: 14, locked: true }),
    ])).toBe(true);
    expect(isSeasonComplete([
      wk({ week: 13, locked: true }),
      wk({ week: 14, locked: false }),
    ])).toBe(false);
  });

  it("does not depend on array order", () => {
    expect(isSeasonComplete([
      wk({ week: 16, isPlayoff: true, locked: true }),
      wk({ week: 15, isPlayoff: true, locked: true }),
    ])).toBe(true);
  });
});
