// ══════════════════════════════════════════════════════════════════
//  Scoring view — does it render at all, for every kind of viewer?
// ══════════════════════════════════════════════════════════════════
//
// Why this exists
// ───────────────
// The Scoring tab shipped completely blank for anyone whose team had been
// knocked out of the playoff bracket. Nothing threw and nothing logged: the
// individual-group branch had been placed BELOW `if (!t1 || !t2) return null`,
// a pre-existing guard for the two-team match view. A golfer in an individual
// group has no t1/t2, so the component returned null and the tab rendered
// empty — the unit tests were all green the whole time, because they only
// covered pure functions.
//
// So this file asserts the one thing those tests couldn't: that the component
// actually produces output for each viewer the app can put in front of it.
// It is deliberately shallow — it pins "renders something", not layout. Any
// future early return that swallows a whole viewer class fails here.
//
// Server rendering (not jsdom) keeps this dependency-free: renderToStaticMarkup
// runs the component body and its hooks, which is all we need to catch a
// null-return or a throw. Effects don't run, and that's fine.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LiveScoringView from "./Scoring.jsx";

const PARS = [4, 4, 4, 3, 5, 4, 4, 3, 5];
const HCPS = [1, 3, 5, 7, 9, 11, 13, 15, 17];
const WEEK = 15;

const players = Array.from({ length: 10 }, (_, i) => ({
  id: `p${i + 1}`, name: `First Last${i + 1}`, handicapIndex: 8 + (i % 4),
}));

const teams = [
  { id: "T1", name: "One / Two", player1: "p1", player2: "p2" },
  { id: "T2", name: "Three / Four", player1: "p3", player2: "p4" },
  { id: "T3", name: "Five / Six", player1: "p5", player2: "p6" },
  { id: "T4", name: "Seven / Eight", player1: "p7", player2: "p8" },
  { id: "T5", name: "Nine / Ten", player1: "p9", player2: "p10" },
];

// A playoff week shaped like the real one: individual groups tee off first
// (the seeder prepends them), bracket matches take the later slots.
const schedule = [{
  week: WEEK, isPlayoff: true, side: "front", date: "Jul 28", locked: false,
  matches: [
    { players: ["p7", "p8", "p9", "p10"], isConsolation: true, isIndivGroup: true },
    { team1: "T1", team2: "T2" },
    { team1: "T3", team2: "T5" },
  ],
}];

const baseProps = {
  players, teams, schedule,
  holeScores: {}, matchResults: [], groupResults: [], ctpData: [], attendance: {},
  course: { name: "Test GC", frontPars: PARS, backPars: PARS, frontHcps: HCPS, backHcps: HCPS },
  scoringRules: { hcpRecentCount: 8, hcpBestCount: 6 },
  leagueConfig: {
    year: 2026, startTime: "4:28 PM", teeInterval: 8,
    playoffRounds: [{ name: "Round 1", matchups: [] }],
    consolationEnabled: true, individualizeEliminated: true,
  },
  forceWeek: WEEK, openAllMatches: false, openFinalize: false, commMode: false,
  saveScore() {}, saveMatchResult() {}, deleteMatchResult() {},
  saveGroupResult() {}, deleteGroupResult() {}, saveCtp() {}, saveAttendance() {},
  setLiveWeek() {}, fetchWeekScores: async () => ({}),
  saveWeekSchedule() {}, setWeekSchedule() {}, deleteWeekSchedule() {}, applyScheduleOps() {},
  onAllMatchesOpened() {}, onFinalizeOpened() {}, onForceWeekUsed() {},
  setPopupOpen() {}, recalcHandicaps() {}, clearWeekData() {}, autoSeedIfReady: async () => ({}),
};

const renderFor = (leagueUser, extra = {}) =>
  renderToStaticMarkup(<LiveScoringView {...baseProps} {...extra} leagueUser={leagueUser} />);

describe("LiveScoringView renders for every viewer", () => {
  it("a golfer on a bracket team", () => {
    const html = renderFor({ playerId: "p1", isCommissioner: false });
    expect(html.length).toBeGreaterThan(0);
  });

  it("a golfer in an individual group", () => {
    // The regression: this returned "" because the group branch sat below
    // the two-team guard. p7's team is not in the bracket — they only exist
    // in the individual group.
    const html = renderFor({ playerId: "p7", isCommissioner: false });
    expect(html.length).toBeGreaterThan(0);
    // All four golfers in the group get a score card — the marker that this
    // is the group view and not the (nonexistent) match view for p7.
    ["Last7", "Last8", "Last9", "Last10"].forEach(n => expect(html).toContain(n));
  });

  it("the commissioner viewing a group they are not in", () => {
    const html = renderFor(
      { playerId: "p1", isCommissioner: true },
      { isComm: true, openAllMatches: true },
    );
    expect(html.length).toBeGreaterThan(0);
  });

  it("a user with no player link", () => {
    const html = renderFor({ playerId: null, isCommissioner: false });
    expect(html.length).toBeGreaterThan(0);
  });

  it("a golfer with no match and no group", () => {
    const html = renderFor({ playerId: "unknown-pid", isCommissioner: false });
    expect(html.length).toBeGreaterThan(0);
  });

  it("a golfer in a group where someone is marked absent", () => {
    // Absent writes the withdrawal sentinel; the view must still render (and
    // must not wait on the absent golfer to complete a card).
    const html = renderFor(
      { playerId: "p7", isCommissioner: false },
      { holeScores: { [`w${WEEK}_pp10_hindivwd`]: 1 } },
    );
    expect(html.length).toBeGreaterThan(0);
  });

  it("a golfer in a group whose card is already signed", () => {
    const html = renderFor(
      { playerId: "p8", isCommissioner: false },
      { groupResults: [{
          week: WEEK, players: ["p7", "p8", "p9", "p10"],
          signedByPlayerId: "p7", attestedBy: [], attested: false,
        }] },
    );
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("Attest");
  });

  // ── Undo an absence after the group card is signed ──────────────────
  // The bug: a golfer marked absent, whose group played and signed without
  // them, tapped Undo days later so they could post a makeup round — and the
  // scoring screen immediately asked them to ATTEST a card they were never
  // on. What they owe is scores. The attest prompt only makes sense for the
  // golfers whose rounds the signature actually covered.
  const signedCard = (extra = {}) => ({
    week: WEEK, players: ["p7", "p8", "p9", "p10"],
    signedByPlayerId: "p7", attestedBy: [], attested: false,
    ...extra,
  });
  // Full 9-hole cards for the three who played; p10 was the absent one.
  const playedScores = {};
  ["p7", "p8", "p9"].forEach(pid => {
    for (let h = 0; h < 9; h++) playedScores[`w${WEEK}_p${pid}_h${h}`] = 5;
  });

  it("asks a golfer who undid an absence for scores, not an attestation", () => {
    const html = renderFor(
      { playerId: "p10", isCommissioner: false },
      {
        holeScores: playedScores,
        groupResults: [signedCard({ roundPids: ["p7", "p8", "p9"] })],
      },
    );
    expect(html).toContain("Missing scores");
    expect(html).not.toContain("Attest Scorecard");
    // The card can't be final while a round is still outstanding.
    expect(html).toContain("awaiting a makeup round");
  });

  it("infers the covered rounds on a card signed before roundPids existed", () => {
    const html = renderFor(
      { playerId: "p10", isCommissioner: false },
      { holeScores: playedScores, groupResults: [signedCard()] },
    );
    expect(html).toContain("Missing scores");
    expect(html).not.toContain("Attest Scorecard");
  });

  it("offers the makeup golfer a signature once their card is full", () => {
    const withMakeup = { ...playedScores };
    for (let h = 0; h < 9; h++) withMakeup[`w${WEEK}_p${"p10"}_h${h}`] = 4;
    const html = renderFor(
      { playerId: "p10", isCommissioner: false },
      {
        holeScores: withMakeup,
        groupResults: [signedCard({ roundPids: ["p7", "p8", "p9"] })],
      },
    );
    expect(html).toContain("Sign Scorecard");
    expect(html).not.toContain("Attest Scorecard");
    expect(html).not.toContain("Missing scores");
  });

  it("still asks the golfers the signature covered to attest", () => {
    const html = renderFor(
      { playerId: "p8", isCommissioner: false },
      {
        holeScores: playedScores,
        groupResults: [signedCard({ roundPids: ["p7", "p8", "p9"] })],
      },
    );
    expect(html).toContain("Attest Scorecard");
    expect(html).not.toContain("Missing scores");
  });

  it("shows the trophy on a playoff week and hides it otherwise", () => {
    const html = renderFor({ playerId: "p1", isCommissioner: false });
    expect(html).toContain("Individual tournament");

    const regular = [{ ...schedule[0], isPlayoff: false, seeded: false }];
    const off = renderFor({ playerId: "p1", isCommissioner: false }, { schedule: regular });
    expect(off).not.toContain("Individual tournament");
  });

  it("hides the trophy when the individual event is switched off", () => {
    const html = renderFor(
      { playerId: "p1", isCommissioner: false },
      { leagueConfig: { ...baseProps.leagueConfig, individualEvent: false } },
    );
    expect(html).not.toContain("Individual tournament");
  });

  it("a locked week", () => {
    const locked = [{ ...schedule[0], locked: true }];
    const html = renderFor({ playerId: "p7", isCommissioner: false }, { schedule: locked });
    expect(html.length).toBeGreaterThan(0);
  });
});
