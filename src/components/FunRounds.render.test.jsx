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
import { FunRounds, SpotManager, OpenSpotChooser, GuestForm } from "./FunRounds.jsx";
import { slotKey } from "../lib/funRounds";

const CLAIMABLE = "Open spot — tap to fill";
const giveUp = (name) => `${name} — tap to give up`;
// Claimed spots now read "A. Jensen" — a bare surname is ambiguous when
// two players share one, and the tee sheet is the screen where getting
// the wrong person actually matters.
const JENSEN = "A. Jensen";
const VIGO = "B. Vigo";
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

describe("FunRounds — the card header", () => {
  // The header used to carry a "You're In" pill and a
  // "3 tee times · 5 of 12 spots filled" line. Both restated what the
  // sheet directly below already shows a name at a time, so they went.
  const mine = round({ groupCount: 2, slots: { [slotKey(0, 0)]: "p1" } });

  it("does not badge the round you're in — the sheet has your name on it", () => {
    const html = render({ funRounds: [mine] });
    expect(html).toContain(JENSEN);
    expect(html).not.toContain("You&#x27;re In");
  });

  it("does not count tee times or spots at you", () => {
    const html = render({ funRounds: [mine] });
    expect(html).not.toContain("tee times");
    expect(html).not.toContain("spots filled");
  });

  it("still says the date and the nine", () => {
    const html = render({ funRounds: [round({ title: "Twilight", side: "back" })] });
    expect(html).toContain(FUTURE);
    expect(html).toContain("Twilight");
    expect(html).toContain("Back 9");
  });
});

describe("FunRounds — where the create button lives", () => {
  // It rides in the first card's header rather than on a line of its
  // own, which means it must appear exactly once no matter how many
  // rounds are on screen — and must not vanish when there are none.
  const two = [round({ id: "r1" }), round({ id: "r2", date: "Dec 31" })];
  // The empty state's "Tap + Tee Time to set one up" says the words too,
  // so count the button itself, not the phrase.
  const BUTTON = ">+ Tee Time<";

  it("appears once for a commissioner, however many rounds there are", () => {
    const html = render({ isComm: true, funRounds: two });
    expect(count(html, BUTTON)).toBe(1);
  });

  it("stays hidden from a player", () => {
    expect(render({ isComm: false, funRounds: two })).not.toContain("+ Tee Time");
  });

  it("falls back to the intro row when there is no card to ride", () => {
    // Otherwise a commissioner who deleted every round could never make
    // another one.
    const html = render({ isComm: true, funRounds: [] });
    expect(count(html, BUTTON)).toBe(1);
  });

  it("rides a past card when every round is behind us", () => {
    const html = render({ isComm: true, funRounds: [round({ date: PAST })] });
    expect(count(html, BUTTON)).toBe(1);
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
    expect(count(html, ">Open<")).toBe(12);
  });

  it("honors a smaller sheet — three tee times, not a league-night eight", () => {
    const html = render({ funRounds: [round({ groupCount: 3, groupSize: 4 })] });
    expect(html).not.toContain("4:52 PM");
    expect(count(html, ">Open<")).toBe(12);
  });

  it("shows a claimed spot as the player's name in position", () => {
    const html = render({
      funRounds: [round({ slots: { [slotKey(1, 2)]: "p2" } })],
    });
    expect(html).toContain(VIGO);
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
    expect(html).toContain(JENSEN);
    expect(html).toContain(VIGO);
  });
});

describe("FunRounds — who can tap what", () => {
  it("makes every open spot fillable for a linked player", () => {
    const html = render({ funRounds: [round({ groupCount: 2 })] });
    expect(count(html, CLAIMABLE)).toBe(8);
  });

  it("lets a player give up their own spot but not someone else's", () => {
    const html = render({
      funRounds: [round({ slots: { [slotKey(0, 0)]: "p1", [slotKey(0, 1)]: "p2" } })],
    });
    expect(html).toContain(giveUp(JENSEN));
    expect(html).not.toContain(giveUp(VIGO));
  });

  it("routes EVERY spot to the manager for a commissioner", () => {
    // Occupied or open, a commissioner's tap opens the picker — that's
    // where assign, swap and clear all live.
    const html = render({
      isComm: true,
      leagueUser: { playerId: "p3", isCommissioner: true },
      funRounds: [round({ groupCount: 1, slots: { [slotKey(0, 0)]: "p1", [slotKey(0, 1)]: "p2" } })],
    });
    expect(html).toContain(manageable(JENSEN));
    expect(html).toContain(manageable(VIGO));
    expect(html).toContain(manageable("Open"));
    // The player-only affordances are gone for them.
    expect(html).not.toContain(giveUp(JENSEN));
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
    expect(html).toContain(JENSEN);
    expect(html).not.toContain(CLAIMABLE);
    expect(html).not.toContain(giveUp(JENSEN));
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
    expect(manager(0, 2)).toContain("Pick a player, or add a guest");
  });
});

// ── Hole-by-hole scoring ─────────────────────────────────────────
//
// A fun group scores through GroupScoring — the same screen a playoff
// foursome uses once its team is knocked out. These pin that the view
// actually swaps in, that the league-only features are OFF (there is no
// week to be absent from and nothing to sign for), and that scores read
// back out of the fun store rather than league hole_scores.
describe("FunRounds — scoring reaches players without a button", () => {
  const PARS = [4, 4, 4, 3, 5, 4, 4, 3, 5];
  const HCPS = [1, 3, 5, 7, 9, 11, 13, 15, 17];
  const course = { name: "T", frontPars: PARS, backPars: PARS, frontHcps: HCPS, backHcps: HCPS };
  const fullRound = round({
    groupCount: 1,
    slots: { [slotKey(0,0)]:"p1", [slotKey(0,1)]:"p2", [slotKey(0,2)]:"p3", [slotKey(0,3)]:"p4" },
  });
  const partial = round({ groupCount: 1, slots: { [slotKey(0,0)]:"p1" } });
  const fourPlayers = [...players, { id: "p4", name: "Dan Marks" }];

  it("has no Score button anywhere", () => {
    const h = render({ funRounds: [fullRound], players: fourPlayers, course, funScores: [] });
    expect(h).not.toContain("Score group");
    expect(h).not.toContain(">Score<");
  });

  it("marks a full group Full, so it's clear why nothing else is needed", () => {
    const h = render({ funRounds: [fullRound], players: fourPlayers, course, funScores: [] });
    expect(h).toContain("Full");
  });

  it("does not mark a partly-filled group Full", () => {
    const h = render({ funRounds: [partial], players: fourPlayers, course, funScores: [] });
    expect(h).not.toContain(">Full<");
  });

  it("opens straight onto the scorecard when Scoring asks for it", () => {
    // autoOpenMyGroup is what Scoring passes. The player is in a full
    // group, so the tee sheet is skipped entirely.
    const h = render({
      funRounds: [fullRound], players: fourPlayers, course, funScores: [],
      autoOpenMyGroup: true,
    });
    expect(h).toContain("Hole");          // the hole strip — the scoring screen
    expect(h).toContain("Back");          // …with a way back to the tee sheet
    expect(h).not.toContain("Open spot"); // not the tee sheet
  });

  it("heads the scorecard with the tee time and nothing else", () => {
    // The header used to read "FUN ROUND · Dec 30" over
    // "4:28 PM · Front 9". You reached this screen from a round you
    // claimed a spot on, so naming it back was redundant, and the hole
    // strip below is numbered — it says the nine on its own.
    const h = render({
      funRounds: [fullRound], players: fourPlayers, course, funScores: [],
      autoOpenMyGroup: true,
    });
    expect(h).toContain("4:28 PM");
    expect(h).not.toContain("Fun Round");
    expect(h).not.toContain(FUTURE);
    expect(h).not.toContain("Front 9");
    expect(h).not.toContain("Back 9");
  });

  it("keeps the round's name on the scorecard when it has one", () => {
    const h = render({
      funRounds: [round({ ...fullRound, title: "Labor Day Scramble" })],
      players: fourPlayers, course, funScores: [], autoOpenMyGroup: true,
    });
    expect(h).toContain("4:28 PM · Labor Day Scramble");
  });

  it("stays on the tee sheet when the group is not yet full", () => {
    const h = render({
      funRounds: [partial], players: fourPlayers, course, funScores: [],
      autoOpenMyGroup: true,
    });
    expect(h).toContain("Open spot");     // still claiming
    expect(h).not.toContain("Full Scorecard");
  });

  it("stays on the tee sheet for a viewer who is not in the group", () => {
    const h = render({
      funRounds: [fullRound], players: fourPlayers, course, funScores: [],
      leagueUser: { playerId: "stranger" }, autoOpenMyGroup: true,
    });
    expect(h).toContain("Full");
    expect(h).not.toContain("Full Scorecard");
  });

  it("leaves Standings and Schedule as a tee sheet", () => {
    // No autoOpenMyGroup: those tabs are for reading the sheet and
    // claiming a spot, not for scoring.
    const h = render({ funRounds: [fullRound], players: fourPlayers, course, funScores: [] });
    expect(h).not.toContain("Full Scorecard");
  });

  it("reads posted scores back from the fun store, in map form", () => {
    const h = render({
      funRounds: [fullRound], players: fourPlayers, course,
      funScores: [{ roundId: "r1", playerId: "p1", holes: { 0: 4, 1: 4, 2: 4 } }],
    });
    expect(h).toContain("thru 3");
    expect(h).toContain("Leaderboard");
  });

  it("still reads a card stored in the older array form", () => {
    const h = render({
      funRounds: [fullRound], players: fourPlayers, course,
      funScores: [{ roundId: "r1", playerId: "p1", holes: [4, 4, 4, 0, 0, 0, 0, 0, 0] }],
    });
    expect(h).toContain("thru 3");
  });
});

// ── Row layout ───────────────────────────────────────────────────
//
// The tee-sheet row used to be one line: time, four spots, Score. Spots
// carry a min-width so names stay readable, so a foursome plus the time
// and the button needed ~406px — more than a phone card's ~300px — and
// the card's overflow:hidden clipped the Score button out of sight
// behind the last spot. The button is gone now, but the shape that
// prevents overflow is still worth pinning.
describe("FunRounds — tee sheet row can't overflow", () => {
  const html = () => render({
    funRounds: [round({ groupCount: 1, groupSize: 4 })],
    course: { frontPars: [4,4,4,3,5,4,4,3,5], backPars: [4,4,4,3,5,4,4,3,5],
              frontHcps: [1,3,5,7,9,11,13,15,17], backHcps: [1,3,5,7,9,11,13,15,17] },
  });

  it("keeps the tee-time line separate from the spots row", () => {
    // Order in the markup is the guard: anything that moves back into
    // the spots row competes for width again.
    const h = html();
    expect(h.indexOf("4:28 PM")).toBeLessThan(h.indexOf("Open spot"));
  });

  it("lets the spots wrap instead of overflowing the card", () => {
    // A fivesome, or a very narrow phone, wraps to a second line rather
    // than pushing a control outside the card.
    expect(html()).toContain("flex-wrap:wrap");
  });

  it("still renders every spot", () => {
    expect(count(html(), ">Open<")).toBe(4);
  });
});

describe("FunRounds — spot labelling and size", () => {
  const seated = round({ groupCount: 1, slots: { [slotKey(0, 0)]: "p1" } });

  it("shows first initial and last name on a claimed spot", () => {
    const h = render({ funRounds: [seated] });
    expect(h).toContain("A. Jensen");
    expect(h).not.toContain(">Jensen<");
  });

  it("gives spots room for that longer name without truncating", () => {
    // "A. JENSEN" renders uppercase with letter-spacing and needs ~74px
    // of box; the floor has to clear it or every name ellipsises.
    const h = render({ funRounds: [seated] });
    expect(h).toContain("min-width:80px");
  });

  it("keeps a bigger tap target", () => {
    expect(render({ funRounds: [seated] })).toContain("padding:11px 8px");
  });
});

// ── Guests ───────────────────────────────────────────────────────
//
// Fun rounds aren't members-only. A guest occupies a spot with a
// `guest_` id and their name/handicap on the round doc, so the grid
// never learns they differ — but the UI has to, in three ways: they
// look different, only the member who brought them can remove them, and
// their name has to reach the leaderboard.
describe("FunRounds — guests", () => {
  const G = "guest_abc";
  const guested = (over = {}) => round({
    groupCount: 1,
    slots: { [slotKey(0, 0)]: "p1", [slotKey(0, 1)]: G },
    guests: { [G]: { name: "Mike Smith", hcp: 12, invitedBy: "p1", addedAt: 5 } },
    ...over,
  });

  it("has no dedicated Guest button — Open is the single entry point", () => {
    const h = render({ funRounds: [round({ groupCount: 1 })] });
    expect(h).not.toContain("+ Guest");
    expect(h).not.toContain("Add a guest to group");
    expect(h).toContain(CLAIMABLE);
  });

  it("shows the guest's name on the sheet, marked as a guest", () => {
    const h = render({ funRounds: [guested()] });
    expect(h).toContain("M. Smith");
    expect(h).toContain("M. Smith (guest)");   // the aria-label says so
    expect(h).toContain("dashed");             // …and so does the border
  });

  it("opens the editor for the member who brought them", () => {
    // Tapping used to remove outright — a destructive one-tap on a small
    // target, and no way to fix a typo in a name you typed yourself.
    const h = render({ funRounds: [guested()] });
    expect(h).toContain("M. Smith (guest) — tap to edit or remove");
  });

  it("does NOT let another member touch someone else's guest", () => {
    const h = render({
      leagueUser: { playerId: "p2" },
      funRounds: [guested()],
    });
    expect(h).toContain("M. Smith");
    expect(h).not.toContain("tap to edit or remove");
    expect(h).not.toContain("M. Smith (guest) — tap to give up");
  });

  it("still routes a guest's spot to the manager for a commissioner", () => {
    const h = render({
      isComm: true, leagueUser: { playerId: "p3", isCommissioner: true },
      funRounds: [guested()],
    });
    expect(h).toContain("M. Smith (guest) — tap to manage spot");
  });

  it("seats a guest alongside the member who brought them", () => {
    const h = render({ funRounds: [guested()] });
    expect(h).toContain("M. Smith");
    expect(h).toContain(JENSEN);
    expect(count(h, ">Open<")).toBe(2);
  });

  it("puts the guest on the round's leaderboard", () => {
    // rosterFor is what carries them through; without it the board would
    // show "Unknown" for a spot that plainly has a name on the sheet.
    const h = render({
      funRounds: [guested()],
      course: { frontPars: [4,4,4,3,5,4,4,3,5], backPars: [4,4,4,3,5,4,4,3,5],
                frontHcps: [1,3,5,7,9,11,13,15,17], backHcps: [1,3,5,7,9,11,13,15,17] },
      funScores: [{ roundId: "r1", playerId: G, holes: { 0: 4, 1: 4, 2: 4 } }],
    });
    expect(h).toContain("Leaderboard");
    expect(h).toContain("Smith");
    expect(h).not.toContain("Unknown");
  });
});

describe("FunRounds — a guest reaches the screens that need them", () => {
  const G = "guest_abc";
  const PARS = [4,4,4,3,5,4,4,3,5], HCPS = [1,3,5,7,9,11,13,15,17];
  const course = { frontPars: PARS, backPars: PARS, frontHcps: HCPS, backHcps: HCPS };
  const fourPlayers = [...players, { id: "p4", name: "Dan Marks" }];
  const fullWithGuest = round({
    groupCount: 1,
    slots: { [slotKey(0,0)]: "p1", [slotKey(0,1)]: "p2", [slotKey(0,2)]: "p3", [slotKey(0,3)]: G },
    guests: { [G]: { name: "Mike Smith", hcp: 12, invitedBy: "p1", addedAt: 5 } },
  });

  it("names the guest on the SCORECARD, not '?'", () => {
    // playerMap is built from the round's roster for exactly this — a
    // guest in the group would otherwise score as an unknown initial.
    const h = render({
      funRounds: [fullWithGuest], players: fourPlayers, course, funScores: [],
      autoOpenMyGroup: true,
    });
    expect(h).toContain("Hole");        // the scoring screen opened
    expect(h).toContain("M. Smith");
    expect(h).not.toContain(">?<");
  });

  it("carries the guest's handicap onto their scorecard row", () => {
    const h = render({
      funRounds: [fullWithGuest], players: fourPlayers, course, funScores: [],
      autoOpenMyGroup: true,
    });
    expect(h).toContain("12");
  });

  it("offers the guest in the commissioner's picker, so they can be moved", () => {
    // assignSlotPatch is id-agnostic, so a guest swaps like anyone else —
    // but only if the picker lists them.
    const h = renderToStaticMarkup(
      <SpotManager
        round={fullWithGuest} g={0} s={0}
        players={[...fourPlayers, { id: G, name: "Mike Smith", isGuest: true }]}
        grid={[["p1", "p2", "p3", G]]}
        onAssign={() => {}} onClear={() => {}} onClose={() => {}}
      />
    );
    expect(h).toContain("Mike Smith");
    expect(h).toContain("swap · group 1");
  });
});

// ── The open-spot chooser ────────────────────────────────────────
//
// Tapping "Open" asks rather than assuming: a member filling a spot
// means either "I'm playing" or "I'm bringing someone", and the app
// can't tell which. Once they already hold a spot, taking a second is
// not a thing a person can do, so only the guest option remains.
describe("OpenSpotChooser", () => {
  const chooser = (props) => renderToStaticMarkup(
    <OpenSpotChooser
      teeTime="4:36 PM" spotIdx={2} mySeat={null}
      onClaim={() => {}} onGuest={() => {}} onCancel={() => {}}
      {...props}
    />
  );

  it("offers both options to a member with no spot yet", () => {
    const h = chooser({});
    expect(h).toContain("I&#x27;m playing");
    expect(h).toContain("Add a guest");
    expect(h).toContain("Who&#x27;s taking this spot?");
  });

  it("names the spot being filled", () => {
    expect(chooser({})).toContain("4:36 PM · Spot 3");
  });

  it("offers ONLY the guest option once the member holds a spot", () => {
    const h = chooser({ mySeat: "4:28 PM" });
    expect(h).not.toContain("I&#x27;m playing");
    expect(h).toContain("Add a guest");
  });

  it("says where they're already sitting rather than just hiding a button", () => {
    // A missing option with no explanation reads as a bug.
    expect(chooser({ mySeat: "4:28 PM" })).toContain("already in this round at 4:28 PM");
  });
});

// ── The commissioner's route to a guest ──────────────────────────
//
// Reported live: a commissioner claimed a spot, tapped another Open
// expecting the guest prompt, and got the league lineup instead. Cause:
// EVERY spot routes a commissioner to the manager, so the chooser — and
// with it the only guest option — was unreachable for them.
describe("SpotManager — guests", () => {
  const manager = (props) => renderToStaticMarkup(
    <SpotManager
      round={round({ groupCount: 1 })} g={0} s={1}
      players={players} grid={[[null, null, null, null]]}
      onAssign={() => {}} onGuest={() => {}} onClear={() => {}} onClose={() => {}}
      {...props}
    />
  );

  it("offers a guest on an OPEN spot", () => {
    const h = manager({});
    expect(h).toContain("Add a guest");
    expect(h).toContain("Pick a player, or add a guest");
  });

  it("does not offer a guest on an occupied spot", () => {
    // Guests go in open spots; replacing someone with a guest is a
    // clear-then-add, not a hidden third meaning for this button.
    const h = manager({ grid: [["p1", null, null, null]], s: 0 });
    expect(h).not.toContain("Add a guest");
    expect(h).toContain("Clear this spot");
  });

  it("still lists league players alongside the guest option", () => {
    const h = manager({});
    expect(h).toContain("Aaron Jensen");
    expect(h).toContain("Add a guest");
  });
});

describe("FunRounds — a commissioner can reach the guest prompt", () => {
  it("routes an open spot to the manager, which now carries the guest option", () => {
    const h = render({
      isComm: true,
      leagueUser: { playerId: "p1", isCommissioner: true },
      funRounds: [round({ groupCount: 1, slots: { [slotKey(0, 0)]: "p1" } })],
    });
    // Their tap still goes to the manager…
    expect(h).toContain(manageable("Open"));
    // …and the chooser is not what they get.
    expect(h).not.toContain(CLAIMABLE);
  });
});

describe("GuestForm — editing an existing guest", () => {
  const guest = { name: "Mike Smth", hcp: 12, invitedBy: "p1", addedAt: 5 };
  const form = (props) => renderToStaticMarkup(
    <GuestForm teeTime="4:36 PM" spotIdx={1}
      onAdd={() => {}} onCancel={() => {}} {...props} />
  );

  it("prefills the name and handicap so a typo can be corrected", () => {
    const h = form({ guest, onRemove: () => {} });
    expect(h).toContain('value="Mike Smth"');
    expect(h).toContain('value="12"');
  });

  it("offers Save and Remove rather than Add", () => {
    const h = form({ guest, onRemove: () => {} });
    expect(h).toContain(">Save<");
    expect(h).toContain("Remove from this spot");
    expect(h).not.toContain("Add Guest");
  });

  it("is still an add form when there's no existing guest", () => {
    const h = form({});
    expect(h).toContain("Add Guest");
    expect(h).not.toContain("Remove from this spot");
    expect(h).toContain('value=""');
  });
});

describe("SpotManager — editing a guest as commissioner", () => {
  const G = "guest_abc";
  const r = round({
    groupCount: 1,
    slots: { [slotKey(0, 0)]: G },
    guests: { [G]: { name: "Mike Smith", hcp: 12, invitedBy: "p1" } },
  });
  const manager = (props) => renderToStaticMarkup(
    <SpotManager round={r} g={0} s={0} players={players} grid={[[G, null, null, null]]}
      onAssign={() => {}} onGuest={() => {}} onEditGuest={() => {}}
      onClear={() => {}} onClose={() => {}} {...props} />
  );

  it("offers Edit guest on a guest-held spot", () => {
    expect(manager({})).toContain("Edit guest");
  });

  it("does not offer it on a member's spot", () => {
    const h = renderToStaticMarkup(
      <SpotManager round={r} g={0} s={0} players={players} grid={[["p1", null, null, null]]}
        onAssign={() => {}} onGuest={() => {}} onEditGuest={() => {}}
        onClear={() => {}} onClose={() => {}} />
    );
    expect(h).not.toContain("Edit guest");
  });
});
