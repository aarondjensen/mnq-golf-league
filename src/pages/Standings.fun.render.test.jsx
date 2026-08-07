// ══════════════════════════════════════════════════════════════════
//  Standings — the primary toggle bar with FUN on it
// ══════════════════════════════════════════════════════════════════
//
// The FUN tab is gated (players see it only once a round exists;
// commissioners always do) and the bar itself collapses when there is
// only one thing on it. Those are exactly the conditions that are easy
// to get subtly wrong and impossible to notice in a unit test of the
// helpers, because the bug shows up as a button that is missing — or
// present with nothing behind it.
//
// renderToStaticMarkup can't click, so this pins which buttons the bar
// OFFERS in each configuration, not what happens after a tap.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StandingsView from "./Standings.jsx";

const PARS = [4, 4, 4, 3, 5, 4, 4, 3, 5];
const HCPS = [1, 3, 5, 7, 9, 11, 13, 15, 17];
const YEAR = new Date().getFullYear();

const players = Array.from({ length: 4 }, (_, i) => ({
  id: `p${i + 1}`, name: `First Last${i + 1}`, handicapIndex: 8,
}));

const teams = [
  { id: "T1", name: "One / Two", player1: "p1", player2: "p2" },
  { id: "T2", name: "Three / Four", player1: "p3", player2: "p4" },
];

const regularOnlySchedule = [
  { week: 1, side: "front", date: "Apr 21", locked: true, matches: [{ team1: "T1", team2: "T2" }] },
];

const withPlayoffs = [
  ...regularOnlySchedule,
  { week: 2, side: "back", date: "Aug 4", isPlayoff: true, matches: [{ team1: "T1", team2: "T2" }] },
];

const funRound = {
  id: "r1", season: YEAR, date: "Dec 30", startTime: "4:28 PM",
  teeInterval: 8, groupCount: 3, groupSize: 4, side: "front", slots: {}, createdAt: 1,
};

const baseProps = {
  teams, players,
  matchResults: [],
  schedule: regularOnlySchedule,
  leagueConfig: { year: YEAR, individualEvent: false },
  course: { name: "Test GC", frontPars: PARS, backPars: PARS, frontHcps: HCPS, backHcps: HCPS },
  scoringRules: { hcpRecentCount: 8, hcpBestCount: 6 },
  fetchSeasonScores: async () => ({}),
  fetchWeekScores: async () => ({}),
  fetchAllScores: async () => ({}),
  saveMatchResult: async () => ({}),
  dataLoaded: { players: true, teams: true, schedule: true },
  leagueUser: { playerId: "p1", isCommissioner: false },
  isComm: false,
  funRounds: [],
  saveFunRound: async () => ({}),
  deleteFunRound: async () => true,
  season: YEAR,
};

const render = (props) => renderToStaticMarkup(<StandingsView {...baseProps} {...props} />);

describe("Standings primary toggle — FUN", () => {
  it("shows no toggle bar at all when there are no playoffs and no fun rounds", () => {
    // A lone "Regular Season" button is noise; the page should just be
    // the standings.
    const html = render({});
    expect(html).not.toContain("REGULAR SEASON");
    expect(html).not.toContain("FUN");
  });

  it("raises the bar for a player as soon as a fun round exists", () => {
    const html = render({ funRounds: [funRound] });
    expect(html).toContain("REGULAR SEASON");
    expect(html).toContain("FUN");
    // Still no playoffs configured, so that button stays off the bar.
    expect(html).not.toContain("POSTSEASON");
  });

  it("always offers the commissioner FUN, since the empty state is the entry point", () => {
    const html = render({ isComm: true, funRounds: [] });
    expect(html).toContain("FUN");
  });

  it("hides FUN from a player when the only fun round is cancelled", () => {
    const html = render({ funRounds: [{ ...funRound, cancelled: true }] });
    expect(html).not.toContain("FUN");
  });

  it("shows all three when the league has playoffs and fun rounds", () => {
    const html = render({ schedule: withPlayoffs, funRounds: [funRound] });
    expect(html).toContain("REGULAR SEASON");
    expect(html).toContain("POSTSEASON");
    expect(html).toContain("FUN");
  });

  it("still renders the standings body with the bar present", () => {
    // Guards against the toggle work swallowing the default view — the
    // page must not become a bar with nothing under it.
    const html = render({ funRounds: [funRound] });
    expect(html).toContain("Team");
    expect(html).toContain("Pts");
  });
});
