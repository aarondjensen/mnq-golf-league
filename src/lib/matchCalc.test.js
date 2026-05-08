// ══════════════════════════════════════════════════════════════════
//  Tests for src/lib/matchCalc.js — resultLetterFor.
// ══════════════════════════════════════════════════════════════════
//
// Coverage scope
// ──────────────
// This file currently tests `resultLetterFor` only, which is the W/L/T
// classifier consumed by every standings-shaped piece of UI in the app
// (theme's buildStandingsForSeed, Schedule's row tally, Standings page,
// Players page record). Its behavior is small and unambiguous, so it
// deserves complete coverage even without the rest of matchCalc tested.
//
// Other matchCalc functions worth covering eventually
// ───────────────────────────────────────────────────
// `computeMatchResult` is the single most important function in the
// app — it produces the saved match_result snapshot that everything
// else aggregates over. It deserves comprehensive tests:
//
//   • match-play status calculation (1UP, 3&2, AS) per scoring rule
//   • playoff tiebreaker (closest-to-pin / longest drive / etc. depending
//     on leagueConfig.playoffTiebreaker)
//   • absent-player substitution logic (readScoreEffective patches)
//   • points calculation across scoring rules (winnerTakesAll, lowHighBonus,
//     teamNetTotal — the legacy modes)
//   • TIED match-play under each scoring rule
//
// Adding those requires being deliberate about test fixtures (a full
// pars/hcps/players/scoringRules input is non-trivial to construct).
// Punted to a future round dedicated to matchCalc test coverage.

import { describe, it, expect } from "vitest";
import { resultLetterFor } from "./matchCalc";

// Helper: build a minimal match-result object with just the fields
// resultLetterFor reads. Anything else is irrelevant to its decision.
const r = (opts) => ({
  matchResultText: opts.text,
  matchWinnerId: opts.winnerId ?? null,
  ...opts,
});

describe("resultLetterFor", () => {
  describe("happy path", () => {
    it("returns 'W' for the winning team", () => {
      const result = r({ text: "3&2", winnerId: "alpha" });
      expect(resultLetterFor(result, "alpha")).toBe("W");
    });

    it("returns 'L' for the losing team", () => {
      const result = r({ text: "3&2", winnerId: "alpha" });
      expect(resultLetterFor(result, "beta")).toBe("L");
    });

    it("returns 'T' for both teams on a TIED match", () => {
      const result = r({ text: "TIED", winnerId: null });
      expect(resultLetterFor(result, "alpha")).toBe("T");
      expect(resultLetterFor(result, "beta")).toBe("T");
    });
  });

  describe("the lowHighBonus regression — TIED with asymmetric points", () => {
    // Audit note from theme.jsx:
    //   "In lowHighBonus and legacy teamNetTotal data, a TIED match-play
    //    row can carry asymmetric points (e.g. bonus split unevenly), and
    //    using the points delta would give one team a W and the other an
    //    L on a tied match."
    //
    // resultLetterFor's contract is that it ONLY reads matchResultText
    // and matchWinnerId — not points. These tests pin that contract.

    it("ignores team1Points/team2Points when matchResultText is TIED", () => {
      // Crafted so that a naive points-comparison would flag alpha as winner.
      const result = {
        matchResultText: "TIED",
        matchWinnerId: null,
        team1Id: "alpha",
        team2Id: "beta",
        team1Points: 12,    // higher
        team2Points: 8,     // lower
      };
      expect(resultLetterFor(result, "alpha")).toBe("T");
      expect(resultLetterFor(result, "beta")).toBe("T");
    });

    it("ignores t1HolesWon/t2HolesWon when TIED", () => {
      const result = {
        matchResultText: "TIED",
        matchWinnerId: null,
        t1HolesWon: 4,
        t2HolesWon: 4,
      };
      expect(resultLetterFor(result, "anything")).toBe("T");
    });
  });

  describe("playoff tiebreaker variants", () => {
    // Playoffs can produce match results like "TIE (Hole 5)" which
    // indicate a tiebreaker (closest-to-pin or longest drive on a
    // designated hole) decided the match. The matchResultText starts
    // with "TIE (" but matchWinnerId IS set. resultLetterFor should
    // return W/L based on matchWinnerId, NOT T — because the match
    // was decided.

    it("returns W/L (not T) when matchWinnerId is set despite TIE-like result text", () => {
      // Note: the bare "TIED" is what triggers the T branch. "TIE (Hole 5)"
      // does NOT match strictly equal "TIED", so it falls through to the
      // matchWinnerId-based W/L decision. Pin this so future work doesn't
      // accidentally check `text.startsWith("TIE")` and break playoffs.
      const result = r({ text: "TIE (Hole 5)", winnerId: "alpha" });
      expect(resultLetterFor(result, "alpha")).toBe("W");
      expect(resultLetterFor(result, "beta")).toBe("L");
    });
  });

  describe("nullish input handling", () => {
    it("returns null for null match result", () => {
      expect(resultLetterFor(null, "alpha")).toBeNull();
    });

    it("returns null for undefined match result", () => {
      expect(resultLetterFor(undefined, "alpha")).toBeNull();
    });

    it("returns null when matchWinnerId is unset and text isn't TIED (degenerate match)", () => {
      // A match-result row in this state shouldn't normally exist (it
      // would mean "neither tied nor decided"), but be defensive — a
      // partially-saved doc could theoretically appear during a write
      // race. The expected behavior: don't credit either side.
      const result = r({ text: "1UP", winnerId: null });
      expect(resultLetterFor(result, "alpha")).toBeNull();
    });
  });

  describe("does NOT short-circuit on team1Id/team2Id matching", () => {
    // Defensive: resultLetterFor should look at matchWinnerId, not
    // team1Id/team2Id. If a row had matchWinnerId === team2Id but the
    // teamId being asked about is team1Id, the answer should be L.

    it("returns L when teamId equals team1Id but team2Id won", () => {
      const result = {
        matchResultText: "5UP",
        matchWinnerId: "team-b",
        team1Id: "team-a",
        team2Id: "team-b",
      };
      expect(resultLetterFor(result, "team-a")).toBe("L");
    });
  });
});
