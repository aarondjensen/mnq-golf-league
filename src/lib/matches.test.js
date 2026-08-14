// ══════════════════════════════════════════════════════════════════
//  matches — who is in one, and whether its week is done
// ══════════════════════════════════════════════════════════════════
//
// The individual-group identity helpers and the two week-completion predicates.
// A group record has no team1Id/team2Id, so the lookups that pair results to
// matches will happily match undefined to undefined if these get it wrong.
//
// Split out of league.test.js when lib/league.js became seven modules. Tests
// live next to the code they cover here, and a single 626-line file covering
// five of them was not that.

import { describe, it, expect } from "vitest";
import { isIndivGroupMatch, indivGroupKey, findGroupResult, weekFullyAttested, weekFullyScored, matchPids } from "./matches";

describe("isIndivGroupMatch", () => {
  it("is true only for the explicit flag", () => {
    expect(isIndivGroupMatch({ isIndivGroup: true, players: ["p1"] })).toBe(true);
    expect(isIndivGroupMatch({ team1: "A", team2: "B" })).toBe(false);
    // A team consolation match is NOT an individual group — it still has two
    // teams and still produces a match_result.
    expect(isIndivGroupMatch({ team1: "A", team2: "B", isConsolation: true })).toBe(false);
    expect(isIndivGroupMatch(null)).toBe(false);
    expect(isIndivGroupMatch(undefined)).toBe(false);
  });
});

// ── orderByBracketIdx ──────────────────────────────────────────────
// Tee order and bracket position are different things. A week's `matches`
// array is tee order — the championship deliberately tees LAST — while
// `bracketIdx` says where a match sits in the round's configured bracket.
// Reading bracket meaning off array position is what made a reordered tee
// sheet crown the wrong team and repoint winner_N.

describe("indivGroupKey", () => {
  it("is order-independent so a re-seed doesn't orphan the signature", () => {
    expect(indivGroupKey({ players: ["p3", "p1", "p2"] }))
      .toBe(indivGroupKey({ players: ["p1", "p2", "p3"] }));
  });

  it("changes when the roster changes", () => {
    expect(indivGroupKey({ players: ["p1", "p2"] }))
      .not.toBe(indivGroupKey({ players: ["p1", "p3"] }));
  });

  it("is empty for a non-group", () => {
    expect(indivGroupKey({ team1: "A", team2: "B" })).toBe("");
    expect(indivGroupKey(null)).toBe("");
  });
});

describe("findGroupResult", () => {
  const group = { players: ["p2", "p1"], isIndivGroup: true };
  const rec = { week: 15, players: ["p1", "p2"], signedByPlayerId: "p1", attested: true };

  it("matches on the roster regardless of stored order", () => {
    expect(findGroupResult([rec], 15, group)).toBe(rec);
  });

  it("does not match another week", () => {
    expect(findGroupResult([rec], 14, group)).toBe(null);
  });

  it("does not match a different roster", () => {
    expect(findGroupResult([rec], 15, { players: ["p1", "p3"], isIndivGroup: true })).toBe(null);
  });

  it("never matches a non-group (empty key)", () => {
    // Guards the undefined-to-undefined trap that motivated the separate
    // collection in the first place.
    expect(findGroupResult([rec], 15, { team1: undefined, team2: undefined })).toBe(null);
  });
});

describe("weekFullyAttested", () => {
  const group = { players: ["p1", "p2", "p3", "p4"], isConsolation: true, isIndivGroup: true };
  const match = { team1: "A", team2: "B" };
  const attestedMatch = { week: 15, team1Id: "A", team2Id: "B", attested: true };
  const attestedGroup = { week: 15, players: ["p1", "p2", "p3", "p4"], signedByPlayerId: "p1", attested: true };
  const signedGroup = { ...attestedGroup, attested: false };
  const wk = { week: 15, matches: [group, match] };

  it("is true only when the match AND the group are attested", () => {
    expect(weekFullyAttested(wk, [attestedMatch], [attestedGroup])).toBe(true);
  });

  it("is false when the group is signed but not attested", () => {
    // The individual tournament is scored off these cards, so an unattested
    // group holds the week exactly as an unattested match does.
    expect(weekFullyAttested(wk, [attestedMatch], [signedGroup])).toBe(false);
  });

  it("is false when the group has no record at all", () => {
    expect(weekFullyAttested(wk, [attestedMatch], [])).toBe(false);
  });

  it("is false when the match is unattested even if the group is done", () => {
    expect(weekFullyAttested(wk, [], [attestedGroup])).toBe(false);
  });

  it("does not count a result from another week", () => {
    const stale = { ...attestedGroup, week: 14 };
    expect(weekFullyAttested(wk, [attestedMatch], [stale])).toBe(false);
  });

  it("is false for a week with nothing in it", () => {
    expect(weekFullyAttested({ week: 15, matches: [] }, [], [])).toBe(false);
    expect(weekFullyAttested({ week: 15 }, [], [])).toBe(false);
  });

  it("handles a groups-only week", () => {
    const groupsOnly = { week: 15, matches: [group] };
    expect(weekFullyAttested(groupsOnly, [], [attestedGroup])).toBe(true);
    expect(weekFullyAttested(groupsOnly, [], [signedGroup])).toBe(false);
  });
});

describe("weekFullyScored", () => {
  const group = { players: ["p1", "p2"], isIndivGroup: true };
  const match = { team1: "A", team2: "B" };
  const wk = { week: 15, matches: [group, match] };
  const signedMatch = { week: 15, team1Id: "A", team2Id: "B", attested: false };
  const signedGroup = { week: 15, players: ["p1", "p2"], signedByPlayerId: "p1", attested: false };

  it("accepts signed-but-unattested cards of both kinds", () => {
    expect(weekFullyScored(wk, [signedMatch], [signedGroup])).toBe(true);
  });

  it("is false when a group has not signed", () => {
    expect(weekFullyScored(wk, [signedMatch], [])).toBe(false);
  });

  it("is false when a match has no result", () => {
    expect(weekFullyScored(wk, [], [signedGroup])).toBe(false);
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

// ══════════════════════════════════════════════════════════════════
//  App typography reaches portalled popups
// ══════════════════════════════════════════════════════════════════
//
// Popups portal to <body>, outside .app-shell. The app's font face, size,
// letter-spacing and uppercasing are inherited from that shell, so the
// typography rule has to name BOTH roots or every popup silently renders in
// the browser's default face. Splitting them back apart is an easy tidy-up to
// make while refactoring the stylesheet, and the result looks "just slightly
// off" rather than obviously broken — so it's pinned.
