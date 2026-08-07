// ══════════════════════════════════════════════════════════════════
//  FunRounds — does the tee sheet actually render, for every viewer?
// ══════════════════════════════════════════════════════════════════
//
// Same rationale and technique as Scoring.render.test.jsx: the pure
// logic in lib/funRounds.js is covered by funRounds.test.js, but that
// can't catch a branch that renders nothing for a whole class of viewer.
// The interesting viewers here are (commissioner | player) × (empty |
// populated) × (upcoming | past), plus the "am I signed up" state that
// decides which button a player is shown.
//
// renderToStaticMarkup runs the component body and its hooks without
// jsdom. Effects don't run, which is fine — nothing rendered depends on
// one (the single useEffect just reports popup state upward).

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FunRounds } from "./FunRounds.jsx";

const players = [
  { id: "p1", name: "Aaron Jensen" },
  { id: "p2", name: "Bob Vigo" },
  { id: "p3", name: "Cal Stevens" },
  { id: "p4", name: "Dan Marks" },
  { id: "p5", name: "Ed Novak" },
];

// Fixed "today" is not available to the component (it calls splitFunRounds
// with the real clock), so the fixtures use dates far enough from any
// plausible run date to stay unambiguous.
const FUTURE = "Dec 30";
const PAST = "Jan 2";
const YEAR = new Date().getFullYear();

const round = (over = {}) => ({
  id: "r1",
  season: YEAR,
  date: FUTURE,
  startTime: "4:28 PM",
  teeInterval: 8,
  groupSize: 4,
  side: "front",
  signups: [],
  createdAt: 1,
  ...over,
});

const baseProps = {
  players,
  funRounds: [],
  leagueUser: { playerId: "p1", isCommissioner: false },
  isComm: false,
  saveFunRound: async () => ({}),
  deleteFunRound: async () => true,
  leagueConfig: { year: YEAR, startTime: "4:28 PM", teeInterval: 8 },
  season: YEAR,
};

const render = (props) => renderToStaticMarkup(<FunRounds {...baseProps} {...props} />);

describe("FunRounds — empty state", () => {
  it("gives the commissioner the create button", () => {
    const html = render({ isComm: true });
    expect(html).toContain("Tee Time");
    expect(html).toContain("No fun rounds yet");
  });

  it("does not offer a player the create button", () => {
    const html = render({ isComm: false });
    expect(html).toContain("No fun rounds yet");
    expect(html).not.toContain("+ Tee Time");
  });

  it("always states that nothing here counts toward league math", () => {
    // This sentence is the feature's contract with the player. If it ever
    // disappears, "does my 39 count?" becomes folklore again.
    expect(render({ isComm: true })).toContain("standings, handicaps, or stats");
  });
});

describe("FunRounds — tee sheet", () => {
  it("renders one tee time per group, in signup order", () => {
    const html = render({
      funRounds: [round({ signups: ["p1", "p2", "p3", "p4", "p5"] })],
    });
    expect(html).toContain("4:28 PM");
    expect(html).toContain("4:36 PM");
    // Last names, matching how the rest of the app lists golfers.
    expect(html).toContain("Jensen");
    expect(html).toContain("Novak");
    expect(html).toContain("5 players");
    expect(html).toContain("2 groups");
  });

  it("says so plainly when nobody has signed up", () => {
    const html = render({ funRounds: [round()] });
    expect(html).toContain("No one signed up yet");
    expect(html).toContain("4:28 PM");
  });

  it("renders the round's name and notes when present", () => {
    const html = render({
      funRounds: [round({ title: "Labor Day Scramble", notes: "Bring cash for skins" })],
    });
    expect(html).toContain("Labor Day Scramble");
    expect(html).toContain("Bring cash for skins");
  });

  it("hides a cancelled round entirely", () => {
    const html = render({
      funRounds: [round({ title: "Called Off", cancelled: true })],
    });
    expect(html).not.toContain("Called Off");
    expect(html).toContain("No fun rounds yet");
  });
});

describe("FunRounds — signup affordance", () => {
  it("offers I'm In to a player who has not signed up", () => {
    const html = render({ funRounds: [round({ signups: ["p2"] })] });
    expect(html).toContain("I&#x27;m In");
    expect(html).not.toContain("Drop Out");
  });

  it("offers Drop Out to a player who has", () => {
    const html = render({ funRounds: [round({ signups: ["p1"] })] });
    expect(html).toContain("Drop Out");
    expect(html).toContain("You&#x27;re In");
  });

  it("offers nothing to a viewer with no linked player", () => {
    // An unlinked member (or the commissioner viewing before joining a
    // team) has no Player.id to sign up, so the button must not appear —
    // tapping it could only write a null into signups.
    const html = render({
      leagueUser: { playerId: null, isCommissioner: false },
      funRounds: [round()],
    });
    expect(html).not.toContain("I&#x27;m In");
    expect(html).not.toContain("Drop Out");
  });
});

describe("FunRounds — past rounds", () => {
  const past = [round({ id: "old", date: PAST, signups: ["p1", "p2"] })];

  it("files a past round under Past and drops its signup button", () => {
    const html = render({ funRounds: past });
    expect(html).toContain("Past");
    expect(html).toContain("Jensen");
    expect(html).not.toContain("Drop Out");
    expect(html).not.toContain("I&#x27;m In");
  });

  it("lets the commissioner delete a past round but not edit it", () => {
    const html = render({ isComm: true, funRounds: past });
    expect(html).toContain("Delete");
    expect(html).not.toContain(">Edit<");
  });

  it("lets the commissioner edit an upcoming round", () => {
    const html = render({ isComm: true, funRounds: [round()] });
    expect(html).toContain(">Edit<");
  });
});
