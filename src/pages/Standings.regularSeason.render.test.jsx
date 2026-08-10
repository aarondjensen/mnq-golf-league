// ══════════════════════════════════════════════════════════════════
//  Standings — REGULAR SEASON counts regular-season weeks only
// ══════════════════════════════════════════════════════════════════
//
// The Regular Season table used to total every LOCKED week, playoff
// weeks included, so a team that went 1-0 in the round robin and lost
// its bracket game read "1-1-0" on a tab labelled Regular Season. The
// W-L-T / Pts / HW columns and the expanded per-week list must all stop
// at the end of the regular season — postseason play lives on the
// Postseason tab.
//
// renderToStaticMarkup can't click, so the fixture leaves a
// regular-season makeup week open, which keeps the default view on
// Regular Season while a locked playoff week sits on the schedule.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StandingsView from "./Standings.jsx";

const PARS = [4, 4, 4, 3, 5, 4, 4, 3, 5];
const HCPS = [1, 3, 5, 7, 9, 11, 13, 15, 17];
const YEAR = new Date().getFullYear();

const players = [
  { id: "p1", name: "First Alpha", handicapIndex: 8 },
  { id: "p2", name: "First Bravo", handicapIndex: 8 },
  { id: "p3", name: "First Charlie", handicapIndex: 8 },
  { id: "p4", name: "First Delta", handicapIndex: 8 },
];

const teams = [
  { id: "T1", name: "Alpha / Bravo", player1: "p1", player2: "p2" },
  { id: "T2", name: "Charlie / Delta", player1: "p3", player2: "p4" },
];

// Week 1 — regular season, finalized. T1 wins.
// Week 2 — regular season makeup still open, so Regular Season stays the
//          default view (the default flips to Postseason once the last
//          regular-season week locks).
// Week 3 — playoff, finalized. T2 wins. Must NOT reach these standings.
const schedule = [
  { week: 1, side: "front", date: "Apr 21", locked: true, matches: [{ team1: "T1", team2: "T2" }] },
  { week: 2, side: "back", date: "Apr 28", locked: false, matches: [{ team1: "T1", team2: "T2" }] },
  { week: 3, side: "front", date: "Aug 4", isPlayoff: true, locked: true, matches: [{ team1: "T1", team2: "T2" }] },
];

const matchResults = [
  {
    id: "w1", week: 1, team1Id: "T1", team2Id: "T2",
    team1Points: 3, team2Points: 0, t1HolesWon: 5, t2HolesWon: 3,
  },
  {
    id: "w3", week: 3, team1Id: "T1", team2Id: "T2",
    team1Points: 0, team2Points: 3, t1HolesWon: 2, t2HolesWon: 6,
  },
];

const baseProps = {
  teams, players, matchResults, schedule,
  leagueConfig: { year: YEAR, individualEvent: false, standingsMethod: "record" },
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

// Pull the (W-L-T, HW) pair out of each standings row, in row order. The
// two live in the same stacked cell, which is the only place in the
// markup carrying an "n-n-n" string.
const recordCells = (html) => (html.match(/>(\d+-\d+-\d+)</g) || []).map(m => m.slice(1, -1));

describe("Standings — Regular Season scope", () => {
  it("counts only regular-season weeks in W-L-T", () => {
    const html = renderToStaticMarkup(<StandingsView {...baseProps} />);
    // Week 1 only: T1 1-0-0, T2 0-1-0. With the playoff week folded in
    // both teams would read 1-1-0.
    expect(recordCells(html)).toEqual(["1-0-0", "0-1-0"]);
  });

  it("keeps playoff holes-won and points out of the totals", () => {
    const html = renderToStaticMarkup(<StandingsView {...baseProps} />);
    // T1 leads on record points (2 for the win) with 5 holes won; the
    // playoff week's 2 more holes would make it 7.
    expect(html).toContain(">5<");
    expect(html).not.toContain(">7<");
  });

  it("ranks by the regular season, not the bracket result", () => {
    const html = renderToStaticMarkup(<StandingsView {...baseProps} />);
    // T1 won in the regular season and lost in the playoffs, so it sits
    // first here even though T2 beat it most recently.
    expect(html.indexOf("Alpha")).toBeLessThan(html.indexOf("Charlie"));
  });
});
