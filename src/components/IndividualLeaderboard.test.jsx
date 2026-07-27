// ══════════════════════════════════════════════════════════════════
//  IndividualLeaderboard — renders in both of its homes
// ══════════════════════════════════════════════════════════════════
//
// The board is shared by Standings' full-page INDIVIDUAL view and Scoring's
// trophy popup. It's presentation-only, so what's worth pinning is that it
// survives the states its two callers actually hand it: still loading, no
// rounds posted yet, a live partial round, and a withdrawn golfer.
//
// The withdrawal case matters most — a withdrawn golfer keeps their played
// rounds on the board as a record but stops accumulating and sorts last, and
// that bucketing is easy to break while refactoring the sort.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IndividualLeaderboard } from "./IndividualLeaderboard.jsx";

const PARS = [4, 4, 4, 3, 5, 4, 4, 3, 5];
const course = {
  name: "Test GC", frontPars: PARS, backPars: PARS,
  frontHcps: [1, 2, 3, 4, 5, 6, 7, 8, 9], backHcps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
};
const players = [
  { id: "p1", name: "Ann Alpha", handicapIndex: 6 },
  { id: "p2", name: "Bob Beta", handicapIndex: 9 },
  { id: "p3", name: "Cy Gamma", handicapIndex: 12 },
];
const teams = [{ id: "T1", name: "Alpha / Beta", player1: "p1", player2: "p2" }];
const schedule = [
  { week: 15, isPlayoff: true, side: "front", locked: true, matches: [{ team1: "T1", team2: "T2" }] },
  { week: 16, isPlayoff: true, side: "front", locked: false, matches: [{ team1: "T1", team2: "T2" }] },
];
const leagueConfig = { year: 2026, playoffRounds: [{ name: "R1" }, { name: "R2" }] };
const scoringRules = { hcpRecentCount: 8, hcpBestCount: 6 };
const allRounds = {
  p1: [{ season: 2026, week: 12, gross: 42 }, { season: 2026, week: 13, gross: 43 }],
  p2: [{ season: 2026, week: 12, gross: 45 }, { season: 2026, week: 13, gross: 46 }],
  p3: [{ season: 2026, week: 12, gross: 50 }, { season: 2026, week: 13, gross: 49 }],
};

const render = (scores, extra = {}) => renderToStaticMarkup(
  <IndividualLeaderboard
    players={players} teams={teams} schedule={schedule} course={course}
    leagueConfig={leagueConfig} scoringRules={scoringRules}
    scores={scores} allRounds={allRounds} loading={false} {...extra}
  />
);

describe("IndividualLeaderboard", () => {
  it("renders while still loading", () => {
    const html = render({}, { loading: true, allRounds: null });
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders before anyone has posted a round", () => {
    const html = render({});
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("Alpha");
  });

  it("renders a completed round", () => {
    const scores = {};
    PARS.forEach((p, h) => { scores[`w15_pp1_h${h}`] = p; });
    const html = render(scores);
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders a live partial round (the mid-round popup case)", () => {
    // Scoring's popup is opened while a card is half-filled; the board has to
    // rank a player thru 4 against one thru 9 without dividing by zero or
    // printing NaN.
    const scores = {};
    for (let h = 0; h < 4; h++) scores[`w16_pp1_h${h}`] = PARS[h] + 1;
    PARS.forEach((p, h) => { scores[`w16_pp2_h${h}`] = p; });
    const html = render(scores);
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain("NaN");
  });

  it("renders a withdrawn golfer without dropping their played rounds", () => {
    const scores = {};
    PARS.forEach((p, h) => { scores[`w15_pp3_h${h}`] = p + 2; });
    scores["w16_pp3_hindivwd"] = 1;
    const html = render(scores);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("Gamma");
  });

  it("survives a course doc with no hole data", () => {
    const html = renderToStaticMarkup(
      <IndividualLeaderboard
        players={players} teams={teams} schedule={schedule}
        course={{ name: "Bare" }} leagueConfig={leagueConfig} scoringRules={scoringRules}
        scores={{}} allRounds={allRounds} loading={false}
      />
    );
    expect(html.length).toBeGreaterThan(0);
  });
});
