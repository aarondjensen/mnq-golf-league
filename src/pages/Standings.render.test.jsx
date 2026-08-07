// ══════════════════════════════════════════════════════════════════
//  Standings view — does the Regular Season record stop at the
//  regular season?
// ══════════════════════════════════════════════════════════════════
//
// Why this exists
// ───────────────
// The reported bug, in the reporter's own numbers: a twelve-week regular
// season showing records like "11-4" and "7-5-3" — fifteen games. Three
// playoff weeks were being counted, because the standings filtered on
// `wk.locked` alone and a finalized playoff week is locked like any other.
//
// theme.test.js pins the pure filter. That is necessary but not sufficient:
// the filter has to be the one the PAGE actually uses. The original bug was a
// component-level line (`if (wk.locked) set.add(wk.week)`), so a pure-function
// test would have stayed green through the entire regression. This file
// renders the real component over a season shaped like the real one and reads
// the record out of the markup — the assertion the reporter would make by
// looking at the page.
//
// Server rendering (renderToStaticMarkup), matching Scoring.render.test.jsx
// and IndividualLeaderboard.test.jsx: no jsdom, no testing-library. Effects
// don't run, but the standings are computed in useMemo during the render pass,
// so the numbers reach the markup.
//
// One consequence of not being able to click: `view` is whatever defaultView
// resolves to on mount, and that is "bracket" once the FINAL regular-season
// week is locked. So each fixture below leaves a trailing regular-season week
// unlocked and unplayed — an in-progress season, which is exactly when a
// reader is watching the standings anyway. The weeks under test (the locked
// regular ones and the locked playoff ones) are unaffected by it.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StandingsView from "./Standings.jsx";

const PARS = [4, 4, 4, 3, 5, 4, 4, 3, 5];
const HCPS = [1, 3, 5, 7, 9, 11, 13, 15, 17];

const PLAYED_REGULAR_WEEKS = 12;

const players = [
  { id: "p1", name: "Ann Alpha", handicapIndex: 8 },
  { id: "p2", name: "Bob Beta", handicapIndex: 8 },
  { id: "p3", name: "Cy Cee", handicapIndex: 8 },
  { id: "p4", name: "Dee Dee", handicapIndex: 8 },
];
const teams = [
  { id: "T1", name: "Alpha / Beta", player1: "p1", player2: "p2" },
  { id: "T2", name: "Cee / Dee", player1: "p3", player2: "p4" },
];

const baseProps = {
  players, teams,
  course: { name: "Test GC", frontPars: PARS, backPars: PARS, frontHcps: HCPS, backHcps: HCPS },
  scoringRules: { hcpRecentCount: 8, hcpBestCount: 6 },
  dataLoaded: { teams: true, schedule: true },
};
const leagueConfig = {
  year: 2025, standingsMethod: "record",
  regularWeeks: PLAYED_REGULAR_WEEKS,
  playoffRounds: [{ name: "R1", matchups: [] }],
};

const win = (week, winnerId, loserId) => ({
  week, team1Id: winnerId, team2Id: loserId,
  team1Points: 3, team2Points: 0, t1HolesWon: 5, t2HolesWon: 2,
  matchResultText: "3&2", matchWinnerId: winnerId,
});

const regularWeek = (week, locked = true) => ({
  week, side: "front", date: `Wk ${week}`, locked, isPlayoff: false,
  matches: [{ team1: "T1", team2: "T2" }],
});

// Every playoff week here is LOCKED — that is precisely what let them slip
// through the old `wk.locked` filter.
const playoffWeek = (week, overrides = {}) => ({
  week, side: "front", date: `Wk ${week}`, locked: true, isPlayoff: true,
  matches: [{ team1: "T1", team2: "T2", bracketIdx: 0 }],
  ...overrides,
});

const render = (schedule, matchResults) => renderToStaticMarkup(
  <StandingsView {...baseProps} schedule={schedule} matchResults={matchResults} leagueConfig={leagueConfig} />
);

// The record cell is `<div ...>{s.w}-{s.l}-{s.t}</div>`. With two teams there
// are exactly two W-L-T-shaped strings in the markup, one per row.
const recordsIn = (html) => (html.match(/>(\d+-\d+-\d+)</g) || []).map(m => m.slice(1, -1));

// Fail with the number the reporter would quote ("counting 15 weeks"), not
// just a string mismatch.
const expectGamesPlayed = (records, expected) => {
  expect(records.length).toBeGreaterThan(0);
  records.forEach(rec => {
    const games = rec.split("-").reduce((a, n) => a + Number(n), 0);
    expect(games).toBe(expected);
  });
};

describe("StandingsView — Regular Season record window", () => {
  // T1 wins all 12 played regular-season weeks; T2 wins all 3 playoff weeks.
  // If any playoff week leaks in, T1 reads 12-3-0 (15 games) — the exact
  // shape of the bug report — instead of 12-0-0.
  const results = [
    ...Array.from({ length: PLAYED_REGULAR_WEEKS }, (_, i) => win(i + 1, "T1", "T2")),
    ...[14, 15, 16].map(w => win(w, "T2", "T1")),
  ];

  it("counts only the 12 regular-season weeks, not the 3 locked playoff weeks", () => {
    const schedule = [
      ...Array.from({ length: PLAYED_REGULAR_WEEKS }, (_, i) => regularWeek(i + 1)),
      regularWeek(13, false),
      playoffWeek(14), playoffWeek(15), playoffWeek(16),
    ];
    const records = recordsIn(render(schedule, results));
    expectGamesPlayed(records, PLAYED_REGULAR_WEEKS);
    expect(records).toContain("12-0-0");
    expect(records).toContain("0-12-0");
  });

  it("still excludes a playoff week whose isPlayoff flag was never set", () => {
    // Admin's generator preserves a locked week verbatim when the playoff
    // block lands on it, so a week can hold bracket matches while carrying a
    // stale `isPlayoff: false`. isPostseasonWeek's structural fallback catches
    // it via bracketIdx / isConsolation.
    const schedule = [
      ...Array.from({ length: PLAYED_REGULAR_WEEKS }, (_, i) => regularWeek(i + 1)),
      regularWeek(13, false),
      playoffWeek(14, { isPlayoff: false }),
      playoffWeek(15, { isPlayoff: false, matches: [{ team1: "T1", team2: "T2", isConsolation: true }] }),
      playoffWeek(16, { isPlayoff: undefined }),
    ];
    expectGamesPlayed(recordsIn(render(schedule, results)), PLAYED_REGULAR_WEEKS);
  });

  it("counts every regular-season week in a season with rainouts", () => {
    // Guards the structural fallback from over-reaching. Two rainouts push
    // real regular-season play out to week 14, past the `regularWeeks: 12`
    // count. A week-NUMBER rule would wrongly drop weeks 13-14; the
    // structural rule keeps them, because they hold ordinary pairings and no
    // bracket markers.
    const rainedOut = (week) => ({ week, side: "front", date: `Wk ${week}`, rainedOut: true, matches: [] });
    const playedWeeks = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14];
    const schedule = [
      ...Array.from({ length: 6 }, (_, i) => regularWeek(i + 1)),
      rainedOut(7),
      ...Array.from({ length: 5 }, (_, i) => regularWeek(i + 8)),  // weeks 8-12
      rainedOut(13),
      regularWeek(14),
      regularWeek(15, false),
      playoffWeek(16),
    ];
    const rainySeason = [
      ...playedWeeks.map(w => win(w, "T1", "T2")),
      win(16, "T2", "T1"),
    ];
    const records = recordsIn(render(schedule, rainySeason));
    expectGamesPlayed(records, playedWeeks.length);
    expect(records).toContain("12-0-0");
  });
});
