// ══════════════════════════════════════════════════════════════════
//  Scoring — what it lands on once the season is over
// ══════════════════════════════════════════════════════════════════
//
// The bug this pins: `currentWeek` falls back to the LAST playable week
// when nothing is unlocked, so after the final postseason round is
// finalized the Scoring tab parked forever on week 16's locked scores —
// a dead end with nothing scorable on it.
//
// Now, when the season is done and a fun round is still to be played,
// Scoring opens on that round instead. The other three views stay one
// tap away, and nothing changes while the season is live.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LiveScoringView from "./Scoring.jsx";
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

const match = [{ team1: "T1", team2: "T2" }];

// Week 16 finalized — the season is over and Scoring has nothing live.
const seasonOver = [
  { week: 15, side: "front", date: "Jul 28", locked: true, matches: match },
  { week: 16, side: "back", date: "Aug 4", isPlayoff: true, locked: true, matches: match },
];

// Same season, final round still being played.
const seasonLive = [
  { week: 15, side: "front", date: "Jul 28", locked: true, matches: match },
  { week: 16, side: "back", date: "Aug 4", isPlayoff: true, locked: false, matches: match },
];

const funRound = (over = {}) => ({
  id: "r1", season: YEAR, date: "Dec 30", startTime: "4:28 PM",
  teeInterval: 8, groupCount: 3, groupSize: 4, side: "front",
  slots: { [slotKey(0, 0)]: "p1" }, createdAt: 1,
  ...over,
});

const baseProps = {
  players, teams,
  schedule: seasonOver,
  holeScores: {}, matchResults: [], groupResults: [], ctpData: [], attendance: {},
  course: { name: "Test GC", frontPars: PARS, backPars: PARS, frontHcps: HCPS, backHcps: HCPS },
  scoringRules: { hcpRecentCount: 8, hcpBestCount: 6 },
  leagueConfig: { year: YEAR, startTime: "4:28 PM", teeInterval: 8 },
  leagueUser: { playerId: "p1", isCommissioner: false },
  isComm: false, commMode: false,
  fetchSeasonScores: async () => ({}),
  fetchAllScores: async () => ({}),
  fetchWeekScores: async () => ({}),
  saveScore: async () => ({}),
  saveMatchResult: async () => ({}),
  deleteMatchResult: async () => true,
  saveGroupResult: async () => ({}),
  deleteGroupResult: async () => true,
  saveCtp: async () => ({}),
  saveAttendance: async () => ({}),
  saveWeekSchedule: async () => ({}),
  setWeekSchedule: async () => ({}),
  deleteWeekSchedule: async () => true,
  saveFunRound: async () => ({}),
  deleteFunRound: async () => true,
  saveFunScores: async () => true,
  setLiveWeek: () => {},
  setPopupOpen: () => {},
  funRounds: [],
  funScores: [],
  season: YEAR,
};

const render = (props) => renderToStaticMarkup(<LiveScoringView {...baseProps} {...props} />);

// The fun view's standing disclaimer marks the tee-sheet body.
const FUN_BODY = "standings, handicaps, or stats";

describe("Scoring tab after the season ends", () => {
  it("opens on the fun round instead of week 16's locked scores", () => {
    const html = render({ funRounds: [funRound()] });
    expect(html).toContain(FUN_BODY);
    expect(html).toContain("4:28 PM");
  });

  it("offers the Fun view alongside the existing three", () => {
    const html = render({ funRounds: [funRound()] });
    expect(html).toContain("My Match");
    expect(html).toContain("All Matches");
    expect(html).toContain("Low Net");
    expect(html).toContain(">Fun<");
  });

  it("hides the Fun view entirely when no round has been posted", () => {
    const html = render({ funRounds: [] });
    expect(html).not.toContain(">Fun<");
    expect(html).not.toContain(FUN_BODY);
  });

  it("stays on the league week while the postseason is still live", () => {
    // Mid-playoffs, scoring the round being played outranks a casual one.
    const html = render({ schedule: seasonLive, funRounds: [funRound()] });
    expect(html).not.toContain(FUN_BODY);
  });

  it("does not open on Fun for a round already played", () => {
    const html = render({ funRounds: [funRound({ date: "Jan 2" })] });
    expect(html).not.toContain(FUN_BODY);
  });

  it("still offers Fun for a past round, so a group can post late", () => {
    // Not the landing view, but reachable — dusk finishes get entered
    // the next morning.
    const html = render({ funRounds: [funRound({ date: "Jan 2" })] });
    expect(html).toContain(">Fun<");
  });
});

// ── Individual tournament trophy ─────────────────────────────────
//
// The trophy opens the individual leaderboard, and it was gated only on
// "the current week is a playoff week". Since `currentWeek` falls back
// to the last playable week once nothing is unlocked, a finished season
// left `weekSch` pointing at the final playoff round forever — so the
// trophy outlived the tournament it belonged to, on a page with nothing
// left to score.
const TROPHY = "Individual tournament leaderboard";

describe("Scoring — individual tournament trophy", () => {
  it("offers the trophy while the postseason is being played", () => {
    const html = render({ schedule: seasonLive });
    expect(html).toContain(TROPHY);
  });

  it("hides it once the final postseason round is finalized", () => {
    const html = render({ schedule: seasonOver });
    expect(html).not.toContain(TROPHY);
  });

  it("hides it on the Fun view too", () => {
    // ViewToggle renders on the fun view as well, so a trophy gated only
    // on the stale playoff week would have followed it there.
    const html = render({ schedule: seasonOver, funRounds: [funRound()] });
    expect(html).toContain(FUN_BODY);
    expect(html).not.toContain(TROPHY);
  });

  it("stays hidden for a league that runs no individual event", () => {
    const html = render({
      schedule: seasonLive,
      leagueConfig: { year: YEAR, individualEvent: false },
    });
    expect(html).not.toContain(TROPHY);
  });

  it("is absent during the regular season, as before", () => {
    const regular = [{ week: 3, side: "front", date: "May 5", locked: false, matches: match }];
    expect(render({ schedule: regular })).not.toContain(TROPHY);
  });
});
