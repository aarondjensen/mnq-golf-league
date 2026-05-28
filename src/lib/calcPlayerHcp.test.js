// ══════════════════════════════════════════════════════════════════
//  Tests for theme.jsx's calcPlayerHcp.
// ══════════════════════════════════════════════════════════════════
//
// Coverage focus
// ──────────────
// calcPlayerHcp produces every handicap shown in the app. It's
// downstream of the per-player season trend in Players.jsx, the
// strokes-given grid in Scoring, the strokes badges on PlayerScoreCard,
// and the net-mode boards in Stats and the IndividualEvent leaderboard.
// A regression here distorts the entire app at once.
//
// Algorithm reminder
// ──────────────────
// Inputs: rounds (chronological list of {gross} or numeric grosses),
// recentN (window size, e.g. 8), bestN (rounds counted, e.g. 6), par.
//
// Output: HCP = round(average(best N grosses in last recentN rounds)) - par
//
// Special case: when there are exactly 2 rounds in the window, only the
// SINGLE BEST round is counted, not the scaled fraction. This is a
// league rule that prevents a player with two early rounds from being
// over-weighted by their better one.

import { describe, it, expect } from "vitest";
import { calcPlayerHcp } from "./theme";

describe("calcPlayerHcp", () => {
  describe("input handling", () => {
    it("returns null for empty rounds", () => {
      expect(calcPlayerHcp([], 8, 6, 36)).toBeNull();
    });

    it("returns null for null/undefined rounds", () => {
      expect(calcPlayerHcp(null, 8, 6, 36)).toBeNull();
      expect(calcPlayerHcp(undefined, 8, 6, 36)).toBeNull();
    });

    it("accepts both numeric and {gross} round shapes", () => {
      // Mixed shape — function should read .gross or accept the number
      // directly. Same result either way for the same values.
      const numeric = [40, 42, 38, 41, 39, 40, 43, 41];
      const shaped = numeric.map(g => ({ gross: g }));
      expect(calcPlayerHcp(numeric, 8, 6, 36)).toBe(calcPlayerHcp(shaped, 8, 6, 36));
    });
  });

  describe("standard 8-round window, best 6", () => {
    it("computes HCP from the best 6 of last 8 rounds", () => {
      // Grosses (par 36): 40,42,38,41,39,40,43,41
      // Best 6: 38,39,40,40,41,41 → sum 239 → avg 39.83 → round 40 → HCP 4
      const rounds = [40, 42, 38, 41, 39, 40, 43, 41];
      expect(calcPlayerHcp(rounds, 8, 6, 36)).toBe(4);
    });

    it("uses ONLY the most recent 8 rounds when more exist", () => {
      // First 3 are old "bad" rounds that should be ignored
      // Last 8 are same as above → HCP 4
      const rounds = [50, 50, 50, 40, 42, 38, 41, 39, 40, 43, 41];
      expect(calcPlayerHcp(rounds, 8, 6, 36)).toBe(4);
    });

    it("scales bestN proportionally when fewer than 8 rounds exist", () => {
      // 4 rounds in window; ratio = 6/8 = 0.75; scaledBest = round(0.75 * 4) = 3
      // Best 3 of [40,42,38,41]: 38,40,41 → sum 119 → avg 39.67 → round 40 → HCP 4
      const rounds = [40, 42, 38, 41];
      expect(calcPlayerHcp(rounds, 8, 6, 36)).toBe(4);
    });
  });

  describe("two-round special case", () => {
    it("counts ONLY the single best round when exactly 2 rounds in window", () => {
      // The league rule: with only 2 rounds, take just the best one.
      // [42, 38] → best 1 → 38 → 38 - 36 = HCP 2
      // Not the scaled fraction (which would be round(0.75 * 2) = 2 → avg
      // of both = 40 → HCP 4). The special-case keeps early-season
      // handicaps closer to a player's actual ability rather than
      // averaging in a single bad round.
      expect(calcPlayerHcp([42, 38], 8, 6, 36)).toBe(2);
    });

    it("handles a single round (special case threshold not triggered)", () => {
      // 1 round: ratio = 0.75; scaledBest = max(1, round(0.75)) = 1
      // Best 1 of [40] is 40 → 40 - 36 = HCP 4
      expect(calcPlayerHcp([40], 8, 6, 36)).toBe(4);
    });
  });

  describe("scaling for partial windows", () => {
    it("uses scaledBest = max(1, round(ratio * window)) for windows of 3+", () => {
      // 3 rounds: ratio = 0.75; round(0.75 * 3) = round(2.25) = 2
      // Best 2 of [40, 42, 38] = [38, 40] → avg 39 → HCP 3
      expect(calcPlayerHcp([40, 42, 38], 8, 6, 36)).toBe(3);
    });

    it("never lets scaledBest fall to 0 (floor at 1)", () => {
      // Hypothetical: ratio extremely small could try to round to 0.
      // The Math.max(1, ...) floor protects against this.
      // recentN=10, bestN=1, 1 round → ratio=0.1, round(0.1*1)=0 → clamped to 1
      // Best 1 of [40] = 40 → HCP 4
      expect(calcPlayerHcp([40], 10, 1, 36)).toBe(4);
    });
  });

  describe("par-relative output", () => {
    it("returns HCP relative to par (not raw average)", () => {
      // Same scores against par 36 vs par 35 differ by 1
      const rounds = [40, 42, 38, 41, 39, 40, 43, 41];
      const hcpAt36 = calcPlayerHcp(rounds, 8, 6, 36);
      const hcpAt35 = calcPlayerHcp(rounds, 8, 6, 35);
      expect(hcpAt35).toBe(hcpAt36 + 1);
    });

    it("returns 0 for an exactly-par player", () => {
      // 6 rounds all at 36 → avg 36 → 36 - 36 = 0
      const rounds = [36, 36, 36, 36, 36, 36];
      expect(calcPlayerHcp(rounds, 8, 6, 36)).toBe(0);
    });

    it("returns a negative HCP for sub-par scoring (rare but supported)", () => {
      // 6 rounds at 34 against par 36 → 34 - 36 = -2
      const rounds = [34, 34, 34, 34, 34, 34];
      expect(calcPlayerHcp(rounds, 8, 6, 36)).toBe(-2);
    });
  });

  describe("most-recent-N selection", () => {
    it("when more than recentN rounds, drops the OLDEST not the worst", () => {
      // First round is excellent (35) — would be the single best of all 9.
      // But it should be dropped because it's older than the window.
      // Last 8 are [50,50,50,50,50,50,50,50] → best 6 = all 50s → HCP 14
      const rounds = [35, 50, 50, 50, 50, 50, 50, 50, 50];
      expect(calcPlayerHcp(rounds, 8, 6, 36)).toBe(14);
    });
  });
});
