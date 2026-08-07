// ══════════════════════════════════════════════════════════════════
//  Schedule — which filter the tab opens on
// ══════════════════════════════════════════════════════════════════
//
// The tab defaults to Fun when a fun round is coming up, and to the
// normal schedule otherwise. Two failure modes are worth pinning:
//
//   • a stale round from months ago quietly hijacking the tab forever,
//     which is why the gate is UPCOMING rather than "any round exists"
//   • the default arriving only via an effect, which would show My
//     Schedule for a frame and then swap. Seeding useState from the
//     default is what prevents that, and a static render — which never
//     runs effects — is exactly the tool that proves it.
//
// renderToStaticMarkup can't click, so what happens after the user taps
// a filter isn't covered here.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ScheduleView from "./Schedule.jsx";
import { slotKey } from "../lib/funRounds";

const PARS = [4, 4, 4, 3, 5, 4, 4, 3, 5];
const HCPS = [1, 3, 5, 7, 9, 11, 13, 15, 17];
const YEAR = new Date().getFullYear();

const players = [
  { id: "p1", name: "Aaron Jensen", handicapIndex: 4 },
  { id: "p2", name: "Bob Vigo", handicapIndex: 6 },
  { id: "p3", name: "Cal Stevens", handicapIndex: 8 },
  { id: "p4", name: "Dan Marks", handicapIndex: 2 },
];

const teams = [
  { id: "T1", name: "Jensen / Vigo", player1: "p1", player2: "p2" },
  { id: "T2", name: "Stevens / Marks", player1: "p3", player2: "p4" },
];

const schedule = [
  { week: 1, side: "front", date: "Apr 21", locked: false, matches: [{ team1: "T1", team2: "T2" }] },
];

// "Dec 30" and "Jan 2" sit far enough from any plausible run date that
// upcoming-vs-past is unambiguous whenever the suite runs.
const funRound = (over = {}) => ({
  id: "r1", season: YEAR, date: "Dec 30", startTime: "4:28 PM",
  teeInterval: 8, groupCount: 3, groupSize: 4, side: "front",
  slots: { [slotKey(0, 0)]: "p1" }, createdAt: 1,
  ...over,
});

const baseProps = {
  schedule, teams, players,
  matchResults: [], groupResults: [], attendance: {}, funScores: [],
  leagueUser: { playerId: "p1", isCommissioner: false },
  leagueConfig: { year: YEAR, startTime: "4:28 PM", teeInterval: 8 },
  course: { name: "Test GC", frontPars: PARS, backPars: PARS, frontHcps: HCPS, backHcps: HCPS },
  scoringRules: { hcpRecentCount: 8, hcpBestCount: 6 },
  fetchWeekScores: async () => ({}),
  fetchAllScores: async () => ({}),
  saveScore: async () => ({}),
  saveMatchResult: async () => ({}),
  saveAttendance: async () => ({}),
  saveFunRound: async () => ({}),
  deleteFunRound: async () => true,
  saveFunScores: async () => true,
  isComm: false,
  dataLoaded: { players: true, teams: true, schedule: true },
  funRounds: [],
  season: YEAR,
};

const render = (props) => renderToStaticMarkup(<ScheduleView {...baseProps} {...props} />);

// The fun view's standing disclaimer is the cleanest marker that the
// body is the tee-sheet list rather than the week list.
const FUN_BODY = "standings, handicaps, or stats";

describe("Schedule tab default", () => {
  it("opens on the normal schedule when there are no fun rounds", () => {
    const html = render({});
    expect(html).not.toContain(FUN_BODY);
    expect(html).toContain("Opponent");
  });

  it("opens on Fun when a fun round is coming up", () => {
    const html = render({ funRounds: [funRound()] });
    expect(html).toContain(FUN_BODY);
    expect(html).toContain("4:28 PM");
    // The week list is swapped out, not merely appended to.
    expect(html).not.toContain("Opponent");
  });

  it("does NOT open on Fun for a round that has already been played", () => {
    // A round from months ago must not hijack this tab forever.
    const html = render({ funRounds: [funRound({ date: "Jan 2" })] });
    expect(html).not.toContain(FUN_BODY);
    expect(html).toContain("Opponent");
  });

  it("ignores a cancelled round when picking the default", () => {
    const html = render({ funRounds: [funRound({ cancelled: true })] });
    expect(html).not.toContain(FUN_BODY);
  });

  it("opens on Fun if any one round is upcoming, past ones notwithstanding", () => {
    const html = render({
      funRounds: [funRound({ id: "old", date: "Jan 2" }), funRound({ id: "next" })],
    });
    expect(html).toContain(FUN_BODY);
  });

  it("still offers the way back to the schedule", () => {
    // Defaulting into Fun must not strand anyone there.
    const html = render({ funRounds: [funRound()] });
    expect(html).toContain("My Schedule");
    expect(html).toContain("Full League");
    expect(html).toContain(">Fun<");
  });

  it("does not default the commissioner into an empty Fun tab", () => {
    // The commissioner always SEES the Fun filter, but with nothing
    // posted there's nothing to open onto.
    const html = render({ isComm: true, funRounds: [] });
    expect(html).toContain(">Fun<");
    expect(html).not.toContain(FUN_BODY);
  });

  it("reaches Fun even with no schedule generated at all", () => {
    // The offseason is when casual rounds matter most, so the
    // empty-schedule state must not swallow the fun view.
    const html = render({ schedule: [], funRounds: [funRound()] });
    expect(html).toContain(FUN_BODY);
    expect(html).not.toContain("No schedule yet");
  });
});
