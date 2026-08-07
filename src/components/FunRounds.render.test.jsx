// ══════════════════════════════════════════════════════════════════
//  FunRounds — does the tee sheet render, and is the right spot
//  tappable for the right viewer?
// ══════════════════════════════════════════════════════════════════
//
// Same technique as Scoring.render.test.jsx. The pure logic is covered
// by funRounds.test.js; what that can't catch is a spot rendering as
// inert markup for someone who should be able to tap it, or — worse —
// as a live button for someone who shouldn't.
//
// The Spot component gives every interactive spot an aria-label, so
// "is this tappable" is directly assertable from static markup rather
// than inferred from styling. Those labels are the contract this file
// leans on.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FunRounds } from "./FunRounds.jsx";
import { slotKey } from "../lib/funRounds";

const CLAIMABLE = "Open spot — tap to claim";
const removable = (name) => `${name} — tap to remove`;

const players = [
  { id: "p1", name: "Aaron Jensen" },
  { id: "p2", name: "Bob Vigo" },
  { id: "p3", name: "Cal Stevens" },
];

// Dates far enough from any plausible run date to stay unambiguous.
const FUTURE = "Dec 30";
const PAST = "Jan 2";
const YEAR = new Date().getFullYear();

const round = (over = {}) => ({
  id: "r1",
  season: YEAR,
  date: FUTURE,
  startTime: "4:28 PM",
  teeInterval: 8,
  groupCount: 3,
  groupSize: 4,
  side: "front",
  slots: {},
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
const count = (html, needle) => html.split(needle).length - 1;

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

describe("FunRounds — the tee sheet", () => {
  it("renders every activated tee time, empty ones included", () => {
    // The old model only drew groups that had players in them. Here an
    // empty tee time is exactly what a player is scanning for.
    const html = render({ funRounds: [round({ groupCount: 3 })] });
    expect(html).toContain("4:28 PM");
    expect(html).toContain("4:36 PM");
    expect(html).toContain("4:44 PM");
    expect(html).toContain("3 tee times");
    expect(count(html, ">Open<")).toBe(12);
  });

  it("honors a smaller sheet — three tee times, not a league-night eight", () => {
    const html = render({ funRounds: [round({ groupCount: 3, groupSize: 4 })] });
    expect(html).not.toContain("4:52 PM");
    expect(html).toContain("0 of 12 spots filled");
  });

  it("shows a claimed spot as the player's name in position", () => {
    const html = render({
      funRounds: [round({ slots: { [slotKey(1, 2)]: "p2" } })],
    });
    expect(html).toContain("Vigo");
    expect(html).toContain("1 of 12 spots filled");
    expect(count(html, ">Open<")).toBe(11);
  });

  it("renders the round's name and notes when present", () => {
    const html = render({
      funRounds: [round({ title: "Labor Day Scramble", notes: "Bring cash for skins" })],
    });
    expect(html).toContain("Labor Day Scramble");
    expect(html).toContain("Bring cash for skins");
  });

  it("hides a cancelled round entirely", () => {
    const html = render({ funRounds: [round({ title: "Called Off", cancelled: true })] });
    expect(html).not.toContain("Called Off");
    expect(html).toContain("No fun rounds yet");
  });

  it("still seats people from a legacy signups round", () => {
    const html = render({
      funRounds: [round({ slots: undefined, signups: ["p1", "p2"] })],
    });
    expect(html).toContain("Jensen");
    expect(html).toContain("Vigo");
  });
});

describe("FunRounds — who can tap what", () => {
  it("makes every open spot claimable for a linked player", () => {
    const html = render({ funRounds: [round({ groupCount: 2 })] });
    expect(count(html, CLAIMABLE)).toBe(8);
  });

  it("lets a player release their own spot but not someone else's", () => {
    const html = render({
      funRounds: [round({ slots: { [slotKey(0, 0)]: "p1", [slotKey(0, 1)]: "p2" } })],
    });
    expect(html).toContain(removable("Jensen"));
    expect(html).not.toContain(removable("Vigo"));
    expect(html).toContain("You&#x27;re In");
  });

  it("lets the commissioner clear anyone's spot", () => {
    const html = render({
      isComm: true,
      leagueUser: { playerId: "p3", isCommissioner: true },
      funRounds: [round({ slots: { [slotKey(0, 0)]: "p1", [slotKey(0, 1)]: "p2" } })],
    });
    expect(html).toContain(removable("Jensen"));
    expect(html).toContain(removable("Vigo"));
  });

  it("offers nothing tappable to a viewer with no linked player", () => {
    // An unlinked member has no Player.id to put in a slot, so every spot
    // must be inert — a tap could only write a null.
    const html = render({
      leagueUser: { playerId: null, isCommissioner: false },
      funRounds: [round()],
    });
    expect(html).not.toContain(CLAIMABLE);
    expect(html).toContain("Link your player");
    // The sheet itself still renders — they can see who's playing.
    expect(html).toContain(">Open<");
    expect(html).toContain("4:28 PM");
  });
});

describe("FunRounds — past rounds", () => {
  const past = [round({ id: "old", date: PAST, slots: { [slotKey(0, 0)]: "p1" } })];

  it("files a past round under Past and freezes its sheet", () => {
    const html = render({ funRounds: past });
    expect(html).toContain("Past");
    expect(html).toContain("Jensen");
    expect(html).not.toContain(CLAIMABLE);
    expect(html).not.toContain(removable("Jensen"));
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
