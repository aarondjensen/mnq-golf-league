// ══════════════════════════════════════════════════════════════════
//  GroupScoring — one screen, two stores
// ══════════════════════════════════════════════════════════════════
//
// This component now serves both a playoff individual group (scores in
// the week-keyed league store) and a fun-round tee group (scores in the
// round's own card). The risks worth pinning:
//
//   • the extraction silently changing the playoff path — so the
//     default, store-less behavior is asserted directly
//   • the fun path reading league scores, or vice versa
//   • league-only features (Absent / Making Up, Sign / Attest) leaking
//     onto a fun round, where there is no week to be absent from and
//     nothing to vouch for

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupScoring } from "./GroupScoring.jsx";
import { funRoundIr } from "../lib/funScores";

const PARS = [4, 4, 4, 3, 5, 4, 4, 3, 5];
const HCPS = [1, 3, 5, 7, 9, 11, 13, 15, 17];

const players = [
  { id: "p1", name: "Aaron Jensen", handicapIndex: 4 },
  { id: "p2", name: "Bob Vigo", handicapIndex: 0 },
];
const playerMap = Object.fromEntries(players.map(p => [p.id, p]));

const base = {
  pids: ["p1", "p2"],
  week: 16,
  side: "front",
  pars: PARS,
  hcps: HCPS,
  playerMap,
  holeScores: {},
  saveScore: () => {},
  isWeekLocked: false,
  viewerPid: "p1",
  onBack: () => {},
  toast: null,
  setToast: () => {},
  isComm: false,
};

const render = (props) => renderToStaticMarkup(<GroupScoring {...base} {...props} />);

describe("GroupScoring — the league (week-keyed) path, unchanged", () => {
  it("reads scores out of the week store by default", () => {
    const html = render({ holeScores: { "w16_pp1_h0": 5, "w16_pp2_h0": 3 } });
    expect(html).toContain("Jensen");
    expect(html).toContain("Vigo");
    // Hole strip is present — this is the hole-by-hole screen.
    expect(html).toContain("Hole");
  });

  it("offers Absent / Making Up", () => {
    const html = render({});
    expect(html).toContain("Absent");
    expect(html).toContain("Makeup");
  });

  it("offers Sign Scorecard once every card is full", () => {
    const full = {};
    for (const pid of ["p1", "p2"]) for (let h = 0; h < 9; h++) full[`w16_p${pid}_h${h}`] = 4;
    const html = render({ holeScores: full, isComm: true });
    expect(html).toContain("Sign Scorecard");
  });
});

describe("GroupScoring — the fun-round path", () => {
  // A store over a plain card map, exactly the shape FunRounds builds.
  const cards = { p1: [5, 4, 4, 0, 0, 0, 0, 0, 0], p2: [] };
  const store = {
    get: (pid, h) => cards[pid]?.[h] || 0,
    set: () => {},
  };
  const funProps = {
    scoreStore: store,
    resolveRound: (pid) => funRoundIr(cards[pid]),
    allowAttendance: false,
    allowSigning: false,
    holeScores: {},        // deliberately empty — nothing may come from here
    week: 0,
  };

  it("reads scores from the injected store, not the league one", () => {
    const html = render(funProps);
    expect(html).toContain("Jensen");
    expect(html).toContain("Hole");
  });

  it("hides Absent / Making Up — there is no league week to miss", () => {
    const html = render(funProps);
    expect(html).not.toContain("Makeup");
    expect(html).not.toContain(">Absent<");
  });

  it("hides Sign / Attest even with every card complete", () => {
    // Nothing here feeds a competition, so there is nothing to vouch for.
    const fullCards = { p1: [4, 4, 4, 3, 5, 4, 4, 3, 5], p2: [4, 4, 4, 3, 5, 4, 4, 3, 5] };
    const html = render({
      ...funProps,
      scoreStore: { get: (pid, h) => fullCards[pid][h], set: () => {} },
      resolveRound: (pid) => funRoundIr(fullCards[pid]),
      isComm: true,
    });
    expect(html).not.toContain("Sign Scorecard");
    expect(html).not.toContain("Attest");
  });

  it("does not leak league scores in when a store is supplied", () => {
    // Plant week-keyed scores the league path WOULD read, then check the
    // derived lines: p1's card comes from the store (5,4,4 → thru 3) and
    // p2 has no card there at all. If the league store leaked in, p2
    // would read "thru 1" off that planted 9.
    const html = render({
      ...funProps,
      holeScores: { "w0_pp1_h0": 9, "w0_pp2_h0": 9 },
    });
    expect(html).toContain("thru 3");
    expect(html).not.toContain("thru 1");
  });

  it("renders a header supplied by the caller", () => {
    const html = render({ ...funProps, header: <div>Fun Round · Dec 30</div> });
    expect(html).toContain("Fun Round · Dec 30");
  });
});
