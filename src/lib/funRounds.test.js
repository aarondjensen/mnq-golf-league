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
  normalizeSignups,
  isSignedUp,
  withSignup,
  buildFunGroups,
  splitFunRounds,
  isoToScheduleDate,
  scheduleDateToIso,
  validateFunRound,
  normalizeStartTime,
  funGroupSize,
  funTeeInterval,
} from "./funRounds";

const round = (over = {}) => ({
  id: "r1",
  season: 2026,
  date: "Sep 1",
  startTime: "4:28 PM",
  teeInterval: 8,
  groupSize: 4,
  signups: [],
  ...over,
});

describe("normalizeSignups", () => {
  it("preserves join order", () => {
    expect(normalizeSignups(round({ signups: ["c", "a", "b"] }))).toEqual(["c", "a", "b"]);
  });

  it("drops duplicates, keeping the FIRST occurrence", () => {
    // Keeping the first is what protects the earlier signup's tee time
    // if a double-write ever appends someone twice.
    expect(normalizeSignups(round({ signups: ["a", "b", "a"] }))).toEqual(["a", "b"]);
  });

  it("tolerates a missing or malformed signups field", () => {
    expect(normalizeSignups(round({ signups: undefined }))).toEqual([]);
    expect(normalizeSignups(round({ signups: "nope" }))).toEqual([]);
    expect(normalizeSignups(round({ signups: ["a", null, "", 7, "b"] }))).toEqual(["a", "b"]);
    expect(normalizeSignups(null)).toEqual([]);
  });
});

describe("withSignup", () => {
  it("appends a joiner to the end", () => {
    expect(withSignup(round({ signups: ["a", "b"] }), "c", true)).toEqual(["a", "b", "c"]);
  });

  it("is idempotent — joining twice does not duplicate or reorder", () => {
    const once = withSignup(round({ signups: ["a"] }), "b", true);
    expect(withSignup(round({ signups: once }), "b", true)).toEqual(["a", "b"]);
  });

  it("removes a leaver without reshuffling the others", () => {
    // b leaves out of the middle; a keeps the first slot and c moves up
    // rather than everyone being re-sorted.
    expect(withSignup(round({ signups: ["a", "b", "c"] }), "b", false)).toEqual(["a", "c"]);
  });

  it("leaving when not signed up is a no-op", () => {
    expect(withSignup(round({ signups: ["a"] }), "z", false)).toEqual(["a"]);
  });

  it("ignores a null player id", () => {
    expect(withSignup(round({ signups: ["a"] }), null, true)).toEqual(["a"]);
  });
});

describe("isSignedUp", () => {
  it("reports membership", () => {
    expect(isSignedUp(round({ signups: ["a"] }), "a")).toBe(true);
    expect(isSignedUp(round({ signups: ["a"] }), "b")).toBe(false);
  });

  it("is false for a null player id", () => {
    expect(isSignedUp(round({ signups: ["a"] }), null)).toBe(false);
  });
});

describe("buildFunGroups", () => {
  it("chunks in join order and staggers tee times by the interval", () => {
    const g = buildFunGroups(round({ signups: ["a", "b", "c", "d", "e", "f", "g", "h"] }));
    expect(g).toHaveLength(2);
    expect(g[0].pids).toEqual(["a", "b", "c", "d"]);
    expect(g[0].teeTime).toBe("4:28 PM");
    expect(g[1].pids).toEqual(["e", "f", "g", "h"]);
    expect(g[1].teeTime).toBe("4:36 PM");
  });

  it("puts a partial group last and still gives it a tee time", () => {
    const g = buildFunGroups(round({ signups: ["a", "b", "c", "d", "e"] }));
    expect(g).toHaveLength(2);
    expect(g[1].pids).toEqual(["e"]);
    expect(g[1].teeTime).toBe("4:36 PM");
  });

  it("returns no groups when nobody has signed up", () => {
    expect(buildFunGroups(round())).toEqual([]);
  });

  it("honors a non-default group size", () => {
    const g = buildFunGroups(round({ groupSize: 2, signups: ["a", "b", "c"] }));
    expect(g.map(x => x.pids)).toEqual([["a", "b"], ["c"]]);
  });

  it("rolls tee times past the hour correctly", () => {
    const g = buildFunGroups(round({
      startTime: "4:56 PM",
      teeInterval: 10,
      groupSize: 2,
      signups: ["a", "b", "c", "d"],
    }));
    expect(g[0].teeTime).toBe("4:56 PM");
    expect(g[1].teeTime).toBe("5:06 PM");
  });
});

describe("funGroupSize / funTeeInterval clamping", () => {
  it("falls back to the foursome default on junk", () => {
    expect(funGroupSize({ groupSize: undefined })).toBe(4);
    expect(funGroupSize({ groupSize: "four" })).toBe(4);
  });

  it("clamps out-of-range group sizes into 2–6", () => {
    expect(funGroupSize({ groupSize: 1 })).toBe(2);
    expect(funGroupSize({ groupSize: 99 })).toBe(6);
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
      groupSize: 2,
      signups: ["a", "b", "c"],
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
  const good = { date: "Sep 1", startTime: "4:28 PM", groupSize: 4, teeInterval: 8 };

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

  it("reports every problem at once rather than stopping at the first", () => {
    expect(validateFunRound({ date: "", startTime: "x", groupSize: 0, teeInterval: 0 })).toHaveLength(4);
  });
});
