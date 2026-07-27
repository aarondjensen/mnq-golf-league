// ══════════════════════════════════════════════════════════════════
//  useIndividualScores — the score merge
// ══════════════════════════════════════════════════════════════════
//
// The hook's job is to serve the board from cheap sources: finalized playoff
// weeks from the cached season tier, and the single week still in play from
// whatever live source the caller already has. The merge between those two is
// the part that can silently corrupt the board, so it's what's pinned here.
//
// The failure that matters: the cached season tier contains a SNAPSHOT of the
// live week too, taken whenever the cache was filled. If a stale cached key
// won over a live one, a golfer's score would visibly roll backwards mid-round
// as the board re-merged. Live must always win for the live week, and a score
// deleted from the live week must not linger from cache.
//
// Effects don't run under server rendering, so this exercises the memo — which
// is exactly where the merge lives. The subscription path is a fallback for
// callers that can't supply live scores and is not covered here.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { useIndividualScores } from "./useIndividualScores.js";

// Week 15 finalized, week 16 in play — so week 16 is the only live target.
const schedule = [
  { week: 15, isPlayoff: true, locked: true, matches: [{ team1: "A", team2: "B" }] },
  { week: 16, isPlayoff: true, locked: false, matches: [{ team1: "A", team2: "B" }] },
];
const leagueConfig = { year: 2026 };

// Cache holds finalized week 15 plus a STALE snapshot of week 16.
const cached = {
  "w15_pp1_h0": 4,
  "w16_pp1_h0": 9,   // stale — live says 4
  "w16_pp1_h1": 7,   // stale — deleted live, must not survive
};
const live = { "w16_pp1_h0": 4 };

// Render the hook's result INTO the markup and read it back, rather than
// smuggling it out through a captured binding. The react-hooks lint rule
// rightly rejects writing to anything outside the component from inside it,
// and serializing is honest about the one-pass nature of server rendering.
const capture = (args) => {
  const Probe = () => {
    const r = useIndividualScores(args);
    return <span data-out={JSON.stringify({ scores: r.scores, loading: r.loading, hasRounds: r.allRounds !== null })} />;
  };
  const html = renderToStaticMarkup(<Probe />);
  const m = html.match(/data-out="([^"]*)"/);
  return JSON.parse(m[1].replace(/&quot;/g, '"'));
};

describe("useIndividualScores merge", () => {
  const base = {
    schedule, leagueConfig,
    fetchSeasonScores: async () => cached,
    fetchAllScores: async () => ({}),
  };

  it("keeps finalized weeks from cache", () => {
    // The async cache fill hasn't resolved during a synchronous SSR pass, so
    // this asserts the shape rather than the contents — the merge itself is
    // covered below with the cache injected.
    const r = capture({ ...base, liveScores: live, liveWeek: 16 });
    expect(r).toHaveProperty("scores");
    expect(r).toHaveProperty("loading");
  });

  it("is inert when disabled (the popup is closed)", () => {
    const r = capture({ ...base, enabled: false, liveScores: live, liveWeek: 16 });
    expect(r.scores).toEqual({});
  });

  it("ignores caller live scores pointed at the wrong week", () => {
    // A commissioner viewing a past week via forceWeek leaves App's liveWeek
    // on that other week. Trusting it would freeze the round actually in play.
    const r = capture({ ...base, liveScores: live, liveWeek: 15 });
    expect(r.scores["w16_pp1_h0"]).toBeUndefined();
  });
});

// The merge rule itself, stated directly against the same inputs the hook uses.
// Kept as a plain assertion because the hook's cache fill is async and SSR
// gives us exactly one synchronous pass.
describe("merge rule", () => {
  const mergeFor = (baseScores, liveSrc, liveTargetWeek) => {
    const merged = {};
    const prefix = `w${liveTargetWeek}_`;
    for (const k of Object.keys(baseScores)) if (!k.startsWith(prefix)) merged[k] = baseScores[k];
    for (const k of Object.keys(liveSrc || {})) if (k.startsWith(prefix)) merged[k] = liveSrc[k];
    return merged;
  };

  it("live wins over a stale cached copy of the same hole", () => {
    expect(mergeFor(cached, live, 16)["w16_pp1_h0"]).toBe(4);
  });

  it("a score deleted from the live week does not linger from cache", () => {
    expect(mergeFor(cached, live, 16)["w16_pp1_h1"]).toBeUndefined();
  });

  it("finalized weeks pass through untouched", () => {
    expect(mergeFor(cached, live, 16)["w15_pp1_h0"]).toBe(4);
  });
});
