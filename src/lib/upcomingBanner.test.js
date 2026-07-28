import { describe, it, expect } from "vitest";
import { computeUpcomingBanner } from "./upcomingBanner";

// ── Fixtures ───────────────────────────────────────────────────────
// Two teams of two. `me` is p1 on team A.
const players = [
  { id: "p1", name: "Aaron Jensen" },
  { id: "p2", name: "Bob Miller" },
  { id: "p3", name: "Carl Smith" },
  { id: "p4", name: "Dan Jones" },
  { id: "p5", name: "Ed Baker" },
  { id: "p6", name: "Frank Ott" },
];
const teams = [
  { id: "tA", name: "Jensen / Miller", player1: "p1", player2: "p2" },
  { id: "tB", name: "Smith / Jones", player1: "p3", player2: "p4" },
];
const leagueConfig = { startTime: "4:28 PM", teeInterval: 8 };

const call = (schedule, playerId = "p1") =>
  computeUpcomingBanner({ schedule, teams, players, playerId, leagueConfig });

describe("computeUpcomingBanner — team match", () => {
  it("returns the tee time and opponent last names for my match", () => {
    const b = call([
      { week: 5, date: "Jun 2", side: "back", matches: [
        { team1: "tB", team2: "tA" },
      ] },
    ]);
    expect(b).toMatchObject({
      week: 5, date: "Jun 2", side: "back",
      teeTime: "4:28", isIndivGroup: false,
      oppName1: "Smith", oppName2: "Jones",
    });
  });

  it("offsets the tee time by the match's position in the week", () => {
    const b = call([
      { week: 5, matches: [
        { team1: "tX", team2: "tY" },
        { team1: "tA", team2: "tB" },
      ] },
    ]);
    expect(b.teeTime).toBe("4:36");
  });

  it("skips locked and rained-out weeks", () => {
    const b = call([
      { week: 3, locked: true, matches: [{ team1: "tA", team2: "tB" }] },
      { week: 4, rainedOut: true, matches: [{ team1: "tA", team2: "tB" }] },
      { week: 5, matches: [{ team1: "tA", team2: "tB" }] },
    ]);
    expect(b.week).toBe(5);
  });

  it("returns null when I'm not in the current week at all", () => {
    expect(call([{ week: 5, matches: [{ team1: "tB", team2: "tC" }] }])).toBeNull();
  });
});

describe("computeUpcomingBanner — individual group", () => {
  // The regression: my team is knocked out of the bracket, so the seeder
  // wrote me into a players-only foursome with no team1/team2. The banner
  // used to go blank for the rest of the playoffs.
  const playoffWeek = {
    week: 12, date: "Aug 4", side: "front", isPlayoff: true,
    matches: [
      { players: ["p1", "p2", "p5", "p6"], isConsolation: true, isIndivGroup: true },
      { team1: "tB", team2: "tC" },
    ],
  };

  it("shows my tee time when I'm in an individual group", () => {
    const b = call([playoffWeek]);
    expect(b).toMatchObject({
      week: 12, date: "Aug 4", side: "front",
      teeTime: "4:28", isIndivGroup: true,
    });
  });

  it("lists my playing partners, not me", () => {
    expect(call([playoffWeek]).groupNames).toEqual(["Miller", "Baker", "Ott"]);
  });

  it("finds the group even for a player with no team", () => {
    const b = computeUpcomingBanner({
      schedule: [playoffWeek], teams, players, playerId: "p5", leagueConfig,
    });
    expect(b.isIndivGroup).toBe(true);
    expect(b.groupNames).toEqual(["Jensen", "Miller", "Ott"]);
  });

  it("prefers a real match over a group when both somehow exist", () => {
    const b = call([{ week: 12, matches: [
      { players: ["p1", "p2", "p5", "p6"], isIndivGroup: true },
      { team1: "tA", team2: "tB" },
    ] }]);
    expect(b.isIndivGroup).toBe(false);
    expect(b.teeTime).toBe("4:36");
  });

  it("renders an unknown partner as TBD rather than dropping the banner", () => {
    const b = call([{ week: 12, matches: [
      { players: ["p1", "pGone"], isIndivGroup: true },
    ] }]);
    expect(b.groupNames).toEqual(["TBD"]);
  });
});

describe("computeUpcomingBanner — guards", () => {
  it("returns null with no player id", () => {
    expect(computeUpcomingBanner({ schedule: [{ week: 1, matches: [] }], teams, players, playerId: null })).toBeNull();
  });

  it("returns null with an empty schedule", () => {
    expect(call([])).toBeNull();
  });

  it("skips weeks that have no matches written yet", () => {
    const b = call([
      { week: 4, matches: [] },
      { week: 5, matches: [{ team1: "tA", team2: "tB" }] },
    ]);
    expect(b.week).toBe(5);
  });

  it("falls back to the default start time when config is missing", () => {
    const b = computeUpcomingBanner({
      schedule: [{ week: 5, matches: [{ team1: "tA", team2: "tB" }] }],
      teams, players, playerId: "p1", leagueConfig: null,
    });
    expect(b.teeTime).toBe("4:28");
  });
});
