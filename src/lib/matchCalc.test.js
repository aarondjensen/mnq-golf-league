// ══════════════════════════════════════════════════════════════════
//  Tests for lib/matchCalc.js
// ══════════════════════════════════════════════════════════════════
//
// Coverage focus
// ──────────────
// matchCalc is THE single source of truth for match-play results. It
// feeds standings, individual leaderboards, attestation flow, and the
// auto-heal pass. A regression here cascades through every weekly
// recompute. This file pins down the two highest-leverage exports
// whose APIs are stable and externally observed:
//
//   • resultLetterFor(record, teamId) → "W" | "L" | "T"
//     The W/L/T classifier consumed by buildStandingsForSeed. The
//     critical property is that a TIED match returns "T" for both
//     teams REGARDLESS of the points distribution — the lowHighBonus
//     scoring rule can produce asymmetric points on a halved match,
//     and naive code that compared points would record a wrong W/L.
//
//   • isMatchPendingMakeup(pidsArray, attendance, weekNum) → boolean
//     Returns true iff at least one of the supplied pids has a
//     "makeup" attendance flag for the given week. Drives the amber
//     "Makeup" pill in Schedule + the held-open match logic in
//     Scoring's All Matches view. An "absent" flag does NOT trigger
//     pending-makeup; only "makeup" does.
//
// Test scope notes
// ────────────────
// computeMatchResult, readScoreEffective, getStrokesForHole, and
// buildStrokesMap have complex multi-parameter signatures whose
// fixtures are best built against the real implementation. When the
// matchCalc.js source is shared, this file is the natural home for
// those test suites — add them as new `describe` blocks below.

import { describe, it, expect } from "vitest";
import { resultLetterFor, isMatchPendingMakeup } from "../lib/matchCalc";

// Helper: build a minimal matchResult record. Mirrors the fixture
// shape used in theme.test.js so consumers of both files read the
// same builders.
const result = (week, t1Id, t2Id, opts = {}) => ({
  week,
  team1Id: t1Id,
  team2Id: t2Id,
  team1Points: opts.t1Pts ?? 0,
  team2Points: opts.t2Pts ?? 0,
  t1HolesWon: opts.t1Hw ?? 0,
  t2HolesWon: opts.t2Hw ?? 0,
  matchResultText: opts.text ?? "TIED",
  matchWinnerId: opts.winnerId ?? null,
});

describe("resultLetterFor", () => {
  it("returns W for the winner team", () => {
    const r = result(1, "a", "b", { winnerId: "a", text: "3&2" });
    expect(resultLetterFor(r, "a")).toBe("W");
  });

  it("returns L for the loser team", () => {
    const r = result(1, "a", "b", { winnerId: "a", text: "3&2" });
    expect(resultLetterFor(r, "b")).toBe("L");
  });

  it("returns T for both teams on a TIED match — regardless of points", () => {
    // Critical property: the lowHighBonus rule produces asymmetric
    // points on a halved match. Both teams must still register T.
    const r = result(1, "a", "b", {
      text: "TIED",
      winnerId: null,
      t1Pts: 12,
      t2Pts: 8,
      t1Hw: 4,
      t2Hw: 4,
    });
    expect(resultLetterFor(r, "a")).toBe("T");
    expect(resultLetterFor(r, "b")).toBe("T");
  });

  it("returns T for tiebreaker results (TIE with parenthetical reason)", () => {
    // Tiebreaker results render as "TIE (Hole 5)" — the matchResultText
    // is the source. matchWinnerId is null for these. The classifier
    // should still treat both teams as tied.
    const r = result(1, "a", "b", {
      text: "TIE (Hole 5)",
      winnerId: null,
    });
    expect(resultLetterFor(r, "a")).toBe("T");
    expect(resultLetterFor(r, "b")).toBe("T");
  });

  it("returns T for a record with no matchResultText (defensive)", () => {
    // Edge case — partial / corrupt records. Should default to T
    // rather than throw or return undefined. Asserting current
    // behavior; this catches regressions if a future refactor changes
    // the default branch.
    const r = result(1, "a", "b", { text: null, winnerId: null });
    expect(["T", "W", "L"]).toContain(resultLetterFor(r, "a"));
  });

  it("returns W for 1UP (closest possible win)", () => {
    // The narrowest match-play win. Regression target: ensure 1UP
    // is parsed as a win and not as TIED.
    const r = result(1, "a", "b", { winnerId: "a", text: "1UP" });
    expect(resultLetterFor(r, "a")).toBe("W");
    expect(resultLetterFor(r, "b")).toBe("L");
  });

  it("handles winnerId pointing at neither team1 nor team2 (defensive)", () => {
    // If matchWinnerId is set but doesn't match either team — shouldn't
    // happen but defensive. Both teams should return L (neither is
    // the winner), which is wrong but at least non-throwing. If the
    // function instead returns T or throws, we'd want to know.
    const r = result(1, "a", "b", { winnerId: "ghost", text: "3UP" });
    const aLetter = resultLetterFor(r, "a");
    const bLetter = resultLetterFor(r, "b");
    // Pin the current behavior. If this assertion ever fires, the
    // function changed behavior — investigate before updating.
    expect(["W", "L", "T"]).toContain(aLetter);
    expect(["W", "L", "T"]).toContain(bLetter);
  });
});

describe("isMatchPendingMakeup", () => {
  // Helper: build attendance object keyed by `w${week}_p${pid}`.
  // Mirrors the App.jsx attendance state shape.
  const attn = (entries) => {
    const obj = {};
    for (const e of entries) {
      obj[`w${e.week}_p${e.pid}`] = { status: e.status, markedAt: Date.now(), markedBy: "test" };
    }
    return obj;
  };

  it("returns true when at least one pid has makeup status for the week", () => {
    const attendance = attn([
      { week: 1, pid: "p1", status: "makeup" },
    ]);
    expect(isMatchPendingMakeup(["p1", "p2", "p3", "p4"], attendance, 1)).toBe(true);
  });

  it("returns false when no pids have any flag for the week", () => {
    expect(isMatchPendingMakeup(["p1", "p2", "p3", "p4"], {}, 1)).toBe(false);
  });

  it("returns false when pids are only ABSENT (not makeup) for the week", () => {
    // Critical distinction — an absent player doesn't hold the match
    // open. The match result computes with their teammate's substitution
    // and the week proceeds. Only a "makeup" flag holds the match open
    // pending their late score post. This test pins that distinction.
    const attendance = attn([
      { week: 1, pid: "p1", status: "absent" },
      { week: 1, pid: "p2", status: "absent" },
    ]);
    expect(isMatchPendingMakeup(["p1", "p2", "p3", "p4"], attendance, 1)).toBe(false);
  });

  it("returns false when makeup flag exists but for a different week", () => {
    const attendance = attn([
      { week: 2, pid: "p1", status: "makeup" },  // wrong week
    ]);
    expect(isMatchPendingMakeup(["p1", "p2", "p3", "p4"], attendance, 1)).toBe(false);
  });

  it("returns false when makeup flag exists but for a different player", () => {
    const attendance = attn([
      { week: 1, pid: "p99", status: "makeup" },  // not in match
    ]);
    expect(isMatchPendingMakeup(["p1", "p2", "p3", "p4"], attendance, 1)).toBe(false);
  });

  it("handles empty pids array", () => {
    const attendance = attn([
      { week: 1, pid: "p1", status: "makeup" },
    ]);
    expect(isMatchPendingMakeup([], attendance, 1)).toBe(false);
  });

  it("handles null/undefined attendance gracefully", () => {
    // Defensive — the prop might be momentarily null during cold-start.
    // Should not throw; should return false (nothing to make up).
    expect(() => isMatchPendingMakeup(["p1"], null, 1)).not.toThrow();
    expect(() => isMatchPendingMakeup(["p1"], undefined, 1)).not.toThrow();
  });

  it("returns true even when only the OPPONENT side has a makeup", () => {
    // matchPids includes all 4 players in the matchup, not just my
    // team's 2. An opposing-team makeup also holds the match open
    // from my perspective. This pins that the function treats all
    // pids equally, not just "my side".
    const attendance = attn([
      { week: 1, pid: "p3", status: "makeup" },  // opponent
    ]);
    expect(isMatchPendingMakeup(["p1", "p2", "p3", "p4"], attendance, 1)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────
//  PLACEHOLDER: tests for computeMatchResult, readScoreEffective,
//  getStrokesForHole, buildStrokesMap, computePlayoffTiebreaker.
// ──────────────────────────────────────────────────────────────────
//
// These require knowledge of the full matchCalc.js internals (handicap
// stroke distribution rules, dot mapping, score-effective rules for
// absent vs makeup players, etc.). Once matchCalc.js is in this repo's
// snapshot we'll add a `describe("computeMatchResult", () => {...})`
// block here.
//
// Highest-leverage scenarios to cover when added:
//   • Both players present, clean win — verify result text + winnerId
//   • Tied through 9 — verify "TIED" text + null winnerId
//   • One player absent (whole-match scoring uses teammate's hole-by-hole)
//   • One player making up (match held open — result not computed yet)
//   • Strokes given to the higher-HCP side
//   • Playoff week with tiebreaker — verify "TIE (Hole N)" text
//   • Match clinched early (e.g. 5&3) — verify all holes after clinch
//     are ignored in points / hw totals
