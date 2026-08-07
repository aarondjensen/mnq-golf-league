// ══════════════════════════════════════════════════════════════════
//  Fun-round scoring — does the card render, and does the round card
//  surface the scores once they exist?
// ══════════════════════════════════════════════════════════════════
//
// The arithmetic is covered by funScores.test.js. What's left, and what
// only a render can catch: the entry grid labelling the right holes for
// the nine being played (a back-nine card numbered 1-9 would have people
// entering scores against the wrong hole), the leaderboard appearing
// only once somebody has posted, and the Score button being offered to
// the right viewers.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FunScoreEntry, FunLeaderboard } from "./FunScorecard.jsx";
import { FunRounds } from "./FunRounds.jsx";
import { slotKey } from "../lib/funRounds";
import { buildFunLeaderboard, indexFunScores } from "../lib/funScores";

const PARS = [4, 4, 4, 3, 5, 4, 4, 3, 5];
const HCPS = [1, 3, 5, 7, 9, 11, 13, 15, 17];
const course = { name: "Test GC", frontPars: PARS, backPars: PARS, frontHcps: HCPS, backHcps: HCPS };
const YEAR = new Date().getFullYear();

const players = [
  { id: "p1", name: "Aaron Jensen", handicapIndex: 4 },
  { id: "p2", name: "Bob Vigo", handicapIndex: 0 },
  { id: "p3", name: "Cal Stevens", handicapIndex: 9 },
];

const round = (over = {}) => ({
  id: "r1", season: YEAR, date: "Dec 30", startTime: "4:28 PM",
  teeInterval: 8, groupCount: 2, groupSize: 4, side: "front",
  slots: { [slotKey(0, 0)]: "p1", [slotKey(0, 1)]: "p2" },
  createdAt: 1,
  ...over,
});

describe("FunScoreEntry", () => {
  const entry = (props = {}) => renderToStaticMarkup(
    <FunScoreEntry
      round={round()} groupIdx={0} pids={["p1", "p2", null, null]}
      players={players} pars={PARS} hcps={HCPS} side="front"
      index={{}} onSave={async () => true} onClose={() => {}}
      {...props}
    />
  );

  it("renders a row of nine inputs per seated player", () => {
    const html = entry();
    expect(html).toContain("Jensen");
    expect(html).toContain("Vigo");
    // Nine holes x two players, and nothing for the two empty spots.
    expect(html.split("<input").length - 1).toBe(18);
  });

  it("numbers the holes 1-9 on the front", () => {
    const html = entry({ side: "front" });
    expect(html).toContain("Jensen hole 1");
    expect(html).toContain("Jensen hole 9");
  });

  it("numbers the holes 10-18 on the back", () => {
    // A back-nine card numbered 1-9 would have people entering scores
    // against the wrong hole on the card in their hand.
    const html = entry({ side: "back", round: round({ side: "back" }) });
    expect(html).toContain("Jensen hole 10");
    expect(html).toContain("Jensen hole 18");
    expect(html).not.toContain("Jensen hole 1<");
    expect(html).toContain("Back 9");
  });

  it("shows each player's handicap so the strokes are explicable", () => {
    const html = entry();
    expect(html).toContain("HCP 4");
    expect(html).toContain("HCP 0");
  });

  it("pre-fills existing scores and shows the running line", () => {
    const html = entry({
      index: indexFunScores([{ roundId: "r1", playerId: "p2", holes: [5, 4, 4, 0, 0, 0, 0, 0, 0] }]),
    });
    expect(html).toContain('value="5"');
    expect(html).toContain("thru 3");
  });

  it("says so rather than rendering a broken grid when the course is missing", () => {
    const html = entry({ pars: null, hcps: null });
    expect(html).toContain("Course data hasn&#x27;t loaded");
    expect(html).not.toContain("<input");
  });
});

describe("FunLeaderboard", () => {
  const rowsFor = (docs) => buildFunLeaderboard({
    grid: [["p1", "p2"]],
    index: indexFunScores(docs),
    roundId: "r1", players, pars: PARS, hcps: HCPS,
  });

  it("renders nothing until somebody posts", () => {
    const html = renderToStaticMarkup(<FunLeaderboard rows={rowsFor([])} myPid="p1" />);
    expect(html).toBe("");
  });

  it("lists posted players with gross, net and thru", () => {
    const html = renderToStaticMarkup(
      <FunLeaderboard rows={rowsFor([{ roundId: "r1", playerId: "p2", holes: PARS }])} myPid="p1" />
    );
    expect(html).toContain("Vigo");
    expect(html).toContain("36");   // gross
    expect(html).toContain(">E<");  // net to par
    expect(html).toContain(">F<");  // completed round
  });

  it("keeps an unposted player visible with dashes", () => {
    const html = renderToStaticMarkup(
      <FunLeaderboard rows={rowsFor([{ roundId: "r1", playerId: "p2", holes: PARS }])} myPid="p1" />
    );
    expect(html).toContain("Jensen");
    expect(html).toContain("—");
  });
});

describe("FunRounds — scoring on the round card", () => {
  const baseProps = {
    players,
    funRounds: [round()],
    leagueUser: { playerId: "p1", isCommissioner: false },
    isComm: false,
    saveFunRound: async () => ({}),
    deleteFunRound: async () => true,
    saveFunScores: async () => true,
    leagueConfig: { year: YEAR, startTime: "4:28 PM", teeInterval: 8 },
    season: YEAR,
    course,
    funScores: [],
  };
  const render = (props) => renderToStaticMarkup(<FunRounds {...baseProps} {...props} />);

  it("offers a Score button per tee time", () => {
    const html = render({});
    expect(html).toContain("Score group 1");
  });

  it("does not offer scoring to a viewer with no linked player", () => {
    const html = render({ leagueUser: { playerId: null, isCommissioner: false } });
    expect(html).toContain("disabled");
    expect(html).toContain("Score");
  });

  it("shows no leaderboard on a round nobody has scored", () => {
    expect(render({})).not.toContain("Leaderboard");
  });

  it("surfaces the leaderboard and per-player lines once scores exist", () => {
    const html = render({
      funScores: [{ roundId: "r1", playerId: "p2", holes: PARS }],
    });
    expect(html).toContain("Leaderboard");
    expect(html).toContain("Vigo");
    expect(html).toContain("E · F");
  });

  it("still scores a past round — dusk finishes get posted next morning", () => {
    const html = render({
      funRounds: [round({ date: "Jan 2" })],
      funScores: [{ roundId: "r1", playerId: "p2", holes: PARS }],
    });
    expect(html).toContain("Past");
    expect(html).toContain("Score group 1");
    expect(html).toContain("Leaderboard");
  });
});
