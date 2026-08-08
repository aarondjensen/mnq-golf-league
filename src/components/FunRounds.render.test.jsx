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
import { FunRounds, SpotManager } from "./FunRounds.jsx";
import { slotKey } from "../lib/funRounds";

const CLAIMABLE = "Open spot — tap to claim";
const giveUp = (name) => `${name} — tap to give up`;
const manageable = (label) => `${label} — tap to manage spot`;

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

  it("lets a player give up their own spot but not someone else's", () => {
    const html = render({
      funRounds: [round({ slots: { [slotKey(0, 0)]: "p1", [slotKey(0, 1)]: "p2" } })],
    });
    expect(html).toContain(giveUp("Jensen"));
    expect(html).not.toContain(giveUp("Vigo"));
    expect(html).toContain("You&#x27;re In");
  });

  it("routes EVERY spot to the manager for a commissioner", () => {
    // Occupied or open, a commissioner's tap opens the picker — that's
    // where assign, swap and clear all live.
    const html = render({
      isComm: true,
      leagueUser: { playerId: "p3", isCommissioner: true },
      funRounds: [round({ groupCount: 1, slots: { [slotKey(0, 0)]: "p1", [slotKey(0, 1)]: "p2" } })],
    });
    expect(html).toContain(manageable("Jensen"));
    expect(html).toContain(manageable("Vigo"));
    expect(html).toContain(manageable("Open"));
    // The player-only affordances are gone for them.
    expect(html).not.toContain(giveUp("Jensen"));
    expect(html).not.toContain(CLAIMABLE);
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
    expect(html).not.toContain(giveUp("Jensen"));
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

describe("SpotManager — the commissioner's assign / swap / clear popup", () => {
  const grid = [["p1", "p2", null, null], ["p3", null, null, null]];
  const r = round({ groupCount: 2 });
  const manager = (g, s) => renderToStaticMarkup(
    <SpotManager
      round={r} g={g} s={s} players={players} grid={grid}
      onAssign={() => {}} onClear={() => {}} onClose={() => {}}
    />
  );

  it("names the spot by tee time and position", () => {
    expect(manager(1, 2)).toContain("4:36 PM · Spot 3");
  });

  it("lists every player, so anyone can be seated", () => {
    const html = manager(0, 2);
    expect(html).toContain("Aaron Jensen");
    expect(html).toContain("Bob Vigo");
    expect(html).toContain("Cal Stevens");
  });

  it("labels a seated player as a SWAP, with the group they'd come from", () => {
    // Tapping them trades places; saying so before the tap is the whole
    // point — a silent swap is indistinguishable from a bug.
    const html = manager(0, 2);
    expect(html).toContain("swap · group 1");   // p1/p2 sit in group 1
    expect(html).toContain("swap · group 2");   // p3 sits in group 2
  });

  it("marks the current occupant and does not offer them as a choice", () => {
    const html = manager(0, 0);
    expect(html).toContain("here now");
    expect(html).toContain("disabled");
  });

  it("offers Clear only on an occupied spot", () => {
    expect(manager(0, 0)).toContain("Clear this spot");
    expect(manager(0, 2)).not.toContain("Clear this spot");
  });

  it("explains what tapping a name will do, per spot state", () => {
    expect(manager(0, 0)).toContain("swap or replace");
    expect(manager(0, 2)).toContain("Pick a player for this spot");
  });
});

// ── Hole-by-hole scoring ─────────────────────────────────────────
//
// A fun group scores through GroupScoring — the same screen a playoff
// foursome uses once its team is knocked out. These pin that the view
// actually swaps in, that the league-only features are OFF (there is no
// week to be absent from and nothing to sign for), and that scores read
// back out of the fun store rather than league hole_scores.
describe("FunRounds — scoring a group", () => {
  const PARS = [4, 4, 4, 3, 5, 4, 4, 3, 5];
  const HCPS = [1, 3, 5, 7, 9, 11, 13, 15, 17];
  const course = { name: "T", frontPars: PARS, backPars: PARS, frontHcps: HCPS, backHcps: HCPS };
  const seatedRound = round({
    groupCount: 1,
    slots: { [slotKey(0, 0)]: "p1", [slotKey(0, 1)]: "p2" },
  });

  // renderToStaticMarkup can't tap the Score button, so drive the view
  // the way the button does — FunRounds decides from its own state, and
  // the reachable proxy is rendering with a group already scoring is not
  // possible without a click. Instead assert the entry points here and
  // let GroupScoring's own behavior be covered through Scoring.
  it("offers Score on a group that has players", () => {
    const html = render({ funRounds: [seatedRound], course, funScores: [] });
    expect(html).toContain("Score group 1");
    expect(html).not.toContain("disabled=\"\" aria-label=\"Score group 1\"");
  });

  it("disables Score before the course has loaded", () => {
    // Without pars there is nothing to score against, and the hole strip
    // would render against fabricated pars.
    const html = render({ funRounds: [seatedRound], course: null, funScores: [] });
    expect(html).toContain("Score group 1");
    expect(html).toContain("disabled");
  });

  it("reads posted scores back from the fun store, in map form", () => {
    // Storage is a hole-keyed MAP so per-hole writes merge; the summary
    // under the group proves the read path understands it.
    const html = render({
      funRounds: [seatedRound], course,
      funScores: [{ roundId: "r1", playerId: "p1", holes: { 0: 4, 1: 4, 2: 4 } }],
    });
    expect(html).toContain("thru 3");
    expect(html).toContain("Leaderboard");
  });

  it("still reads a card stored in the older array form", () => {
    const html = render({
      funRounds: [seatedRound], course,
      funScores: [{ roundId: "r1", playerId: "p1", holes: [4, 4, 4, 0, 0, 0, 0, 0, 0] }],
    });
    expect(html).toContain("thru 3");
  });
});

// ── Row layout ───────────────────────────────────────────────────
//
// The tee-sheet row used to be one line: time, four spots, Score. Spots
// carry a min-width so names stay readable, so a foursome plus the time
// and the button needed ~406px — more than a phone card's ~300px — and
// the card's overflow:hidden clipped the Score button out of sight
// behind the last spot. These pin the shape that prevents it.
describe("FunRounds — tee sheet row can't overflow", () => {
  const html = () => render({
    funRounds: [round({ groupCount: 1, groupSize: 4 })],
    course: { frontPars: [4,4,4,3,5,4,4,3,5], backPars: [4,4,4,3,5,4,4,3,5],
              frontHcps: [1,3,5,7,9,11,13,15,17], backHcps: [1,3,5,7,9,11,13,15,17] },
  });

  it("puts Score on the tee-time line, above the spots", () => {
    // Order in the markup is the guard: if Score ever moves back into
    // the spots row, it competes for width again.
    const h = html();
    expect(h.indexOf("Score group 1")).toBeLessThan(h.indexOf("Open spot"));
  });

  it("lets the spots wrap instead of overflowing the card", () => {
    // A fivesome, or a very narrow phone, wraps to a second line rather
    // than pushing a control outside the card.
    expect(html()).toContain("flex-wrap:wrap");
  });

  it("still renders every spot and the Score button", () => {
    const h = html();
    expect(count(h, ">Open<")).toBe(4);
    expect(h).toContain("Score group 1");
  });
});
