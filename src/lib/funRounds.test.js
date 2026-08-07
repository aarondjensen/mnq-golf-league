// ══════════════════════════════════════════════════════════════════
//  funRounds.test.js
// ══════════════════════════════════════════════════════════════════
//
// The behavior worth pinning down here is ORDER. Signup order is the
// group assignment and the tee-time assignment, so anything that
// silently reorders `signups` moves real people to different tee times.
// Most of these tests exist to catch that.

import { describe, it, expect } from "vitest";
import {
  slotKey,
  readSlots,
  buildFunGroups,
  findPlayerSlot,
  isSignedUp,
  funRoundCounts,
  claimSlotPatch,
  releaseSlotPatch,
  pruneSlotsPatch,
  splitFunRounds,
  hasUpcomingFunRound,
  isoToScheduleDate,
  scheduleDateToIso,
  validateFunRound,
  normalizeStartTime,
  funGroupSize,
  funGroupCount,
  funTeeInterval,
} from "./funRounds";

const round = (over = {}) => ({
  id: "r1",
  season: 2026,
  date: "Sep 1",
  startTime: "4:28 PM",
  teeInterval: 8,
  groupCount: 2,
  groupSize: 4,
  slots: {},
  ...over,
});

// Convenience: build a slots map from a grid literal, so fixtures read
// like the tee sheet they represent.
const slotsFrom = (grid) => {
  const out = {};
  grid.forEach((row, g) => row.forEach((pid, s) => { out[slotKey(g, s)] = pid; }));
  return out;
};

describe("readSlots", () => {
  it("always returns a full groupCount x groupSize grid", () => {
    const grid = readSlots(round({ groupCount: 3, groupSize: 4 }));
    expect(grid).toHaveLength(3);
    expect(grid.every(row => row.length === 4)).toBe(true);
    expect(grid.flat().every(v => v === null)).toBe(true);
  });

  it("places claims at their stored coordinates, not in arrival order", () => {
    // The whole point of the model: p1 sits in the SECOND group's third
    // spot because that is the spot they tapped.
    const grid = readSlots(round({ slots: { [slotKey(1, 2)]: "p1" } }));
    expect(grid[0]).toEqual([null, null, null, null]);
    expect(grid[1]).toEqual([null, null, "p1", null]);
  });

  it("treats null and missing identically — both are an open spot", () => {
    const grid = readSlots(round({ slots: { [slotKey(0, 0)]: null } }));
    expect(grid[0][0]).toBeNull();
  });

  it("ignores claims outside the current sheet", () => {
    // Left behind when the commissioner shrank the round; must not
    // resurface just because the grid is being read.
    const grid = readSlots(round({ groupCount: 1, slots: { [slotKey(3, 0)]: "p9" } }));
    expect(grid).toHaveLength(1);
    expect(grid.flat()).not.toContain("p9");
  });

  it("seats a duplicated player only once, at their first spot", () => {
    const grid = readSlots(round({
      slots: { [slotKey(0, 1)]: "p1", [slotKey(1, 0)]: "p1" },
    }));
    expect(grid[0][1]).toBe("p1");
    expect(grid[1][0]).toBeNull();
  });

  it("ignores junk values", () => {
    const grid = readSlots(round({ slots: { [slotKey(0, 0)]: 7, [slotKey(0, 1)]: "" } }));
    expect(grid[0][0]).toBeNull();
    expect(grid[0][1]).toBeNull();
  });

  it("tolerates a missing or malformed slots field", () => {
    expect(readSlots(round({ slots: undefined })).flat().every(v => v === null)).toBe(true);
    expect(readSlots(round({ slots: "nope" })).flat().every(v => v === null)).toBe(true);
    expect(readSlots(null)).toHaveLength(3); // falls back to the default group count
  });

  it("migrates a legacy signups array when there is no slot data", () => {
    const grid = readSlots({ groupCount: 2, groupSize: 4, signups: ["a", "b", "c", "d", "e"] });
    expect(grid[0]).toEqual(["a", "b", "c", "d"]);
    expect(grid[1]).toEqual(["e", null, null, null]);
  });

  it("prefers real slot data over a stale legacy array", () => {
    const grid = readSlots({
      groupCount: 2, groupSize: 4,
      signups: ["old1", "old2"],
      slots: { [slotKey(0, 0)]: "new1" },
    });
    expect(grid[0][0]).toBe("new1");
    expect(grid.flat()).not.toContain("old1");
  });

  it("does not overflow the sheet when the legacy array is longer than it", () => {
    const grid = readSlots({ groupCount: 1, groupSize: 2, signups: ["a", "b", "c", "d"] });
    expect(grid).toHaveLength(1);
    expect(grid[0]).toEqual(["a", "b"]);
  });
});

describe("buildFunGroups", () => {
  it("returns one entry per ACTIVATED tee time, including empty ones", () => {
    // An activated-but-empty tee time is the thing a player is looking
    // for, so it must render. This is the core difference from the old
    // signup-order model, which only emitted groups that had people.
    const g = buildFunGroups(round({ groupCount: 3, slots: {} }));
    expect(g).toHaveLength(3);
    expect(g[0].spots).toEqual([null, null, null, null]);
  });

  it("staggers tee times by the interval", () => {
    const g = buildFunGroups(round({ groupCount: 3, teeInterval: 8 }));
    expect(g.map(x => x.teeTime)).toEqual(["4:28 PM", "4:36 PM", "4:44 PM"]);
  });

  it("rolls tee times past the hour correctly", () => {
    const g = buildFunGroups(round({ startTime: "4:56 PM", teeInterval: 10, groupCount: 2 }));
    expect(g.map(x => x.teeTime)).toEqual(["4:56 PM", "5:06 PM"]);
  });

  it("exposes each spot in position order", () => {
    const g = buildFunGroups(round({ slots: { [slotKey(0, 2)]: "p1" } }));
    expect(g[0].spots).toEqual([null, null, "p1", null]);
  });
});

describe("findPlayerSlot / isSignedUp / funRoundCounts", () => {
  const r = round({ slots: { [slotKey(1, 3)]: "p1" } });

  it("finds a seated player's coordinates", () => {
    expect(findPlayerSlot(r, "p1")).toEqual({ g: 1, s: 3 });
  });

  it("returns null for an unseated player or a null id", () => {
    expect(findPlayerSlot(r, "p2")).toBeNull();
    expect(findPlayerSlot(r, null)).toBeNull();
  });

  it("reports signed-up status from the sheet", () => {
    expect(isSignedUp(r, "p1")).toBe(true);
    expect(isSignedUp(r, "p2")).toBe(false);
  });

  it("counts filled spots against total capacity", () => {
    expect(funRoundCounts(r)).toEqual({ filled: 1, total: 8 });
    expect(funRoundCounts(round({ groupCount: 3, groupSize: 4 }))).toEqual({ filled: 0, total: 12 });
  });
});

describe("claimSlotPatch", () => {
  it("claims an open spot with a single-key patch", () => {
    // One key is the concurrency guarantee: a merge write of exactly this
    // object cannot disturb anyone else's spot.
    expect(claimSlotPatch(round(), "p1", 0, 2)).toEqual({ [slotKey(0, 2)]: "p1" });
  });

  it("refuses a spot held by someone else", () => {
    const r = round({ slots: { [slotKey(0, 0)]: "p2" } });
    expect(claimSlotPatch(r, "p1", 0, 0)).toBeNull();
  });

  it("moves a seated player, freeing their old spot in the same patch", () => {
    // Both keys in one merge means there is no instant where the player
    // holds two spots, or none.
    const r = round({ slots: { [slotKey(0, 0)]: "p1" } });
    expect(claimSlotPatch(r, "p1", 1, 1)).toEqual({
      [slotKey(1, 1)]: "p1",
      [slotKey(0, 0)]: null,
    });
  });

  it("is a no-op patch when re-tapping the spot you already hold", () => {
    const r = round({ slots: { [slotKey(0, 0)]: "p1" } });
    expect(claimSlotPatch(r, "p1", 0, 0)).toEqual({ [slotKey(0, 0)]: "p1" });
  });

  it("refuses coordinates off the sheet", () => {
    const r = round({ groupCount: 2, groupSize: 4 });
    expect(claimSlotPatch(r, "p1", 2, 0)).toBeNull();
    expect(claimSlotPatch(r, "p1", 0, 4)).toBeNull();
    expect(claimSlotPatch(r, "p1", -1, 0)).toBeNull();
    expect(claimSlotPatch(r, "p1", 0, -1)).toBeNull();
  });

  it("refuses a null player id", () => {
    expect(claimSlotPatch(round(), null, 0, 0)).toBeNull();
  });
});

describe("releaseSlotPatch", () => {
  it("nulls the released key", () => {
    const r = round({ slots: { [slotKey(1, 2)]: "p1" } });
    expect(releaseSlotPatch(r, 1, 2)).toEqual({ [slotKey(1, 2)]: null });
  });

  it("returns null when the spot is already open", () => {
    expect(releaseSlotPatch(round(), 0, 0)).toBeNull();
  });

  it("returns null for coordinates off the sheet", () => {
    expect(releaseSlotPatch(round({ groupCount: 1 }), 5, 0)).toBeNull();
  });
});

describe("pruneSlotsPatch", () => {
  it("nulls claims stranded by a shrink", () => {
    // Without this, shrinking to 2 tee times and later growing back to 4
    // would reseat people who were removed and never re-confirmed.
    const r = round({
      groupCount: 4,
      slots: slotsFrom([["a"], ["b"], ["c"], ["d"]]),
    });
    expect(pruneSlotsPatch(r, 2, 4)).toEqual({
      [slotKey(2, 0)]: null,
      [slotKey(3, 0)]: null,
    });
  });

  it("nulls claims stranded by a narrower group", () => {
    const r = round({ slots: { [slotKey(0, 3)]: "a", [slotKey(0, 1)]: "b" } });
    expect(pruneSlotsPatch(r, 2, 2)).toEqual({ [slotKey(0, 3)]: null });
  });

  it("leaves a pure growth alone", () => {
    const r = round({ slots: { [slotKey(0, 0)]: "a" } });
    expect(pruneSlotsPatch(r, 6, 4)).toEqual({});
  });

  it("ignores already-empty keys", () => {
    const r = round({ groupCount: 4, slots: { [slotKey(3, 0)]: null } });
    expect(pruneSlotsPatch(r, 1, 4)).toEqual({});
  });

  it("clears unparseable keys so a hand-edited doc can't haunt the round", () => {
    const r = round({ slots: { garbage: "a" } });
    expect(pruneSlotsPatch(r, 2, 4)).toEqual({ garbage: null });
  });

  it("returns an empty patch when there are no slots at all", () => {
    expect(pruneSlotsPatch(round({ slots: undefined }), 2, 4)).toEqual({});
  });
});

describe("clamping", () => {
  it("falls back to the foursome default on junk", () => {
    expect(funGroupSize({ groupSize: undefined })).toBe(4);
    expect(funGroupSize({ groupSize: "four" })).toBe(4);
  });

  it("clamps out-of-range group sizes into 2-6", () => {
    expect(funGroupSize({ groupSize: 1 })).toBe(2);
    expect(funGroupSize({ groupSize: 99 })).toBe(6);
  });

  it("clamps out-of-range tee-time counts into 1-12", () => {
    expect(funGroupCount({ groupCount: 0 })).toBe(1);
    expect(funGroupCount({ groupCount: 99 })).toBe(12);
    expect(funGroupCount({ groupCount: undefined })).toBe(3);
    expect(funGroupCount({ groupCount: 3 })).toBe(3);
  });

  it("falls back to the default interval on an out-of-range value", () => {
    expect(funTeeInterval({ teeInterval: 0 })).toBe(8);
    expect(funTeeInterval({ teeInterval: 600 })).toBe(8);
    expect(funTeeInterval({ teeInterval: 12 })).toBe(12);
  });
});

describe("splitFunRounds", () => {
  const today = new Date(2026, 8, 10); // Sep 10, 2026

  it("puts today's round in upcoming, not past", () => {
    // The round is playable right up to the moment it's played — a
    // same-day round dropping into history would hide the tee sheet on
    // exactly the day people need it.
    const { upcoming, past } = splitFunRounds([round({ date: "Sep 10" })], 2026, today);
    expect(upcoming).toHaveLength(1);
    expect(past).toHaveLength(0);
  });

  it("sorts upcoming soonest-first and past most-recent-first", () => {
    const rounds = [
      round({ id: "later", date: "Sep 20" }),
      round({ id: "soon", date: "Sep 12" }),
      round({ id: "old", date: "Aug 1" }),
      round({ id: "recent", date: "Sep 5" }),
    ];
    const { upcoming, past } = splitFunRounds(rounds, 2026, today);
    expect(upcoming.map(r => r.id)).toEqual(["soon", "later"]);
    expect(past.map(r => r.id)).toEqual(["recent", "old"]);
  });

  it("drops cancelled rounds from both buckets", () => {
    const rounds = [
      round({ id: "dead", date: "Sep 20", cancelled: true }),
      round({ id: "live", date: "Sep 20" }),
    ];
    const { upcoming, past } = splitFunRounds(rounds, 2026, today);
    expect(upcoming.map(r => r.id)).toEqual(["live"]);
    expect(past).toHaveLength(0);
  });

  it("treats an unparseable date as upcoming so it stays visible", () => {
    const { upcoming } = splitFunRounds([round({ id: "junk", date: "sometime" })], 2026, today);
    expect(upcoming.map(r => r.id)).toEqual(["junk"]);
  });

  it("breaks same-day ties by creation time", () => {
    const rounds = [
      round({ id: "second", date: "Sep 20", createdAt: 200 }),
      round({ id: "first", date: "Sep 20", createdAt: 100 }),
    ];
    const { upcoming } = splitFunRounds(rounds, 2026, today);
    expect(upcoming.map(r => r.id)).toEqual(["first", "second"]);
  });

  it("uses each round's own season for the year, not just the fallback", () => {
    // A 2025 round dated Sep 20 is in the past even though Sep 20 is in
    // the future for 2026.
    const rounds = [round({ id: "lastYear", date: "Sep 20", season: 2025 })];
    const { upcoming, past } = splitFunRounds(rounds, 2026, today);
    expect(upcoming).toHaveLength(0);
    expect(past.map(r => r.id)).toEqual(["lastYear"]);
  });

  it("handles a null list", () => {
    expect(splitFunRounds(null, 2026, today)).toEqual({ upcoming: [], past: [] });
  });
});

describe("hasUpcomingFunRound", () => {
  const today = new Date(2026, 8, 10); // Sep 10, 2026

  it("is true when a round is still to be played", () => {
    expect(hasUpcomingFunRound([round({ date: "Sep 20" })], 2026, today)).toBe(true);
  });

  it("is false when every round is in the past", () => {
    // The gate is upcoming, not "any round exists" — otherwise an old
    // round would hijack a tab's default forever.
    expect(hasUpcomingFunRound([round({ date: "Aug 1" })], 2026, today)).toBe(false);
  });

  it("counts today's round as upcoming", () => {
    expect(hasUpcomingFunRound([round({ date: "Sep 10" })], 2026, today)).toBe(true);
  });

  it("ignores cancelled rounds", () => {
    expect(hasUpcomingFunRound([round({ date: "Sep 20", cancelled: true })], 2026, today)).toBe(false);
  });

  it("is false for no rounds at all", () => {
    expect(hasUpcomingFunRound([], 2026, today)).toBe(false);
    expect(hasUpcomingFunRound(null, 2026, today)).toBe(false);
  });
});

describe("date form round-trip", () => {
  it("converts ISO to the app's stored format", () => {
    expect(isoToScheduleDate("2026-09-01")).toBe("Sep 1");
  });

  it("converts back to ISO using the round's season", () => {
    expect(scheduleDateToIso("Sep 1", 2026)).toBe("2026-09-01");
  });

  it("round-trips without drift", () => {
    expect(scheduleDateToIso(isoToScheduleDate("2026-12-25"), 2026)).toBe("2026-12-25");
  });

  it("returns empty string on junk rather than a bogus date", () => {
    expect(isoToScheduleDate("")).toBe("");
    expect(isoToScheduleDate("not-a-date")).toBe("");
    expect(isoToScheduleDate("2026-13-01")).toBe("");
    expect(scheduleDateToIso("sometime", 2026)).toBe("");
  });
});

describe("normalizeStartTime", () => {
  it("upgrades the shapes a human actually types", () => {
    expect(normalizeStartTime("4:28pm")).toBe("4:28 PM");
    expect(normalizeStartTime("4:28 pm")).toBe("4:28 PM");
    expect(normalizeStartTime("  04:28 PM ")).toBe("4:28 PM");
  });

  it("leaves an already-canonical time alone", () => {
    expect(normalizeStartTime("4:28 PM")).toBe("4:28 PM");
  });

  it("produces a form buildFunGroups can actually parse", () => {
    // This is the whole point of the normalizer: theme.formatTeeTime
    // splits on a space and would emit NaN for "4:28pm".
    const groups = buildFunGroups({
      startTime: normalizeStartTime("4:28pm"),
      teeInterval: 8,
      groupCount: 2,
      groupSize: 2,
      slots: {},
    });
    expect(groups[0].teeTime).toBe("4:28 PM");
    expect(groups[1].teeTime).toBe("4:36 PM");
  });

  it("returns empty string on junk so the validator can reject it", () => {
    expect(normalizeStartTime("16:28")).toBe("");
    expect(normalizeStartTime("13:00 PM")).toBe("");
    expect(normalizeStartTime("4:75 PM")).toBe("");
    expect(normalizeStartTime("")).toBe("");
    expect(normalizeStartTime(null)).toBe("");
  });
});

describe("validateFunRound", () => {
  const good = { date: "Sep 1", startTime: "4:28 PM", groupCount: 3, groupSize: 4, teeInterval: 8 };

  it("accepts a well-formed draft", () => {
    expect(validateFunRound(good)).toEqual([]);
  });

  it("requires a date", () => {
    expect(validateFunRound({ ...good, date: "" })).toHaveLength(1);
  });

  it("rejects a malformed tee time", () => {
    expect(validateFunRound({ ...good, startTime: "16:28" })).toHaveLength(1);
    expect(validateFunRound({ ...good, startTime: "428 PM" })).toHaveLength(1);
  });

  it("rejects an impossible clock time that still matches the shape", () => {
    expect(validateFunRound({ ...good, startTime: "13:00 PM" })).toHaveLength(1);
    expect(validateFunRound({ ...good, startTime: "4:75 PM" })).toHaveLength(1);
  });

  it("accepts lowercase am/pm and a missing space", () => {
    expect(validateFunRound({ ...good, startTime: "4:28pm" })).toEqual([]);
  });

  it("rejects out-of-range group size and interval", () => {
    expect(validateFunRound({ ...good, groupSize: 1 })).toHaveLength(1);
    expect(validateFunRound({ ...good, groupSize: 7 })).toHaveLength(1);
    expect(validateFunRound({ ...good, teeInterval: 0 })).toHaveLength(1);
    expect(validateFunRound({ ...good, teeInterval: 61 })).toHaveLength(1);
  });

  it("rejects an out-of-range tee-time count", () => {
    expect(validateFunRound({ ...good, groupCount: 0 })).toHaveLength(1);
    expect(validateFunRound({ ...good, groupCount: 13 })).toHaveLength(1);
  });

  it("reports every problem at once rather than stopping at the first", () => {
    expect(validateFunRound({ date: "", startTime: "x", groupCount: 0, groupSize: 0, teeInterval: 0 }))
      .toHaveLength(5);
  });
});
