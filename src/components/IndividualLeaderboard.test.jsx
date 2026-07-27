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
import { IndividualLeaderboard, IndividualRoundCard, IndividualRoundsPanel } from "./IndividualLeaderboard.jsx";

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

  // ── Absent from the match, made up the individual round ────────────
  // A golfer misses League Night. The TEAM match records them absent
  // (_habsent), and their individual round is played later and entered into
  // the makeup namespace (_hm0.._hm8).
  //
  // The expanded card used to read through readScoreEffective with the
  // golfer's teammate supplied as the OPPOSING side. teammateOf then finds no
  // teammate on the golfer's own side, so readScore falls through to its
  // both-absent branch and IMPUTES a net-bogey card — par + 1 + strokes on
  // every hole. The row above showed the correct makeup total while the card
  // below it showed a synthetic round that was never played.
  //
  // Concretely, for the fixture below: the real makeup card is 33 gross / 29
  // net; the imputed one was 49 / 45. Those are the numbers the screenshot
  // that reported this bug showed.
  describe("absent from the match, made up the individual round", () => {
    // Stroke indexes chosen so a 4-handicap draws strokes on holes 1/3/5/9 —
    // which is what makes the imputed card come out at 49 rather than 45.
    const wkCourse = {
      name: "Test GC",
      frontPars: [5, 3, 4, 4, 4, 3, 4, 4, 5], backPars: [5, 3, 4, 4, 4, 3, 4, 4, 5],
      frontHcps: [2, 8, 3, 7, 4, 6, 5, 9, 1], backHcps: [2, 8, 3, 7, 4, 6, 5, 9, 1],
    };
    const wkSchedule = [{ week: 16, isPlayoff: true, side: "front", locked: false, matches: [{ team1: "T1", team2: "T2" }] }];
    const wkRounds = {
      p1: [{ season: 2026, week: 12, gross: 40 }, { season: 2026, week: 13, gross: 40 }],
      p2: [{ season: 2026, week: 12, gross: 45 }],
    };
    const scores = { "w16_pp1_habsent": 1 };
    [4, 3, 4, 4, 4, 3, 4, 3, 4].forEach((v, h) => { scores[`w16_pp1_hm${h}`] = v; });  // real makeup: 33

    const card = () => renderToStaticMarkup(
      <IndividualRoundCard
        pid="p1" week={16} schedule={wkSchedule} course={wkCourse}
        players={players} scoringRules={scoringRules} leagueConfig={leagueConfig}
        allRounds={wkRounds} scores={scores}
      />
    );

    it("shows the round the golfer actually played", () => {
      expect(card()).toContain(">33<");
    });

    it("does not impute a net-bogey card", () => {
      // 49 gross / 45 net is what the both-absent impute produced here.
      const html = card();
      expect(html).not.toContain(">49<");
      expect(html).not.toContain(">45<");
    });

    it("labels it a makeup, so it reads as intentionally different from the match card", () => {
      expect(card()).toContain("Makeup");
    });

    it("still marks the round with the makeup superscript on the board", () => {
      // Lowercase in the markup; the app's uppercase transform renders it "M".
      const html = renderToStaticMarkup(
        <IndividualLeaderboard
          players={players} teams={teams} schedule={wkSchedule} course={wkCourse}
          leagueConfig={leagueConfig} scoringRules={scoringRules}
          scores={scores} allRounds={wkRounds} loading={false}
        />
      );
      expect(html).toMatch(/<sup[^>]*>m<\/sup>/);
      expect(html).toContain("makeup round");
    });
  });

  it("renders a total-only makeup as a summary, not invented holes", () => {
    // A total-only makeup has a gross and nothing else. Drawing nine cells
    // would mean fabricating hole scores.
    const scores = { "w15_pp1_hmtotal": 44 };
    const html = renderToStaticMarkup(
      <IndividualRoundCard
        pid="p1" week={15} schedule={schedule} course={course}
        players={players} scoringRules={scoringRules} leagueConfig={leagueConfig}
        allRounds={allRounds} scores={scores}
      />
    );
    expect(html).toContain("total only");
    expect(html).toContain("44");
    expect(html).not.toContain("HOLE");
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

// ══════════════════════════════════════════════════════════════════
//  IndividualRoundsPanel — browsing a golfer's rounds
// ══════════════════════════════════════════════════════════════════
//
// The expanded row lets a golfer step through any round they've posted, or
// stack them all. Which rounds are OFFERED is the part worth pinning: only
// posted ones, because an empty round has no card and a tab that does nothing
// is worse than no tab.
describe("IndividualRoundsPanel", () => {
  const PARS9 = [4, 4, 4, 3, 5, 4, 4, 3, 5];
  const c = {
    name: "T", frontPars: PARS9, backPars: PARS9,
    frontHcps: [1, 2, 3, 4, 5, 6, 7, 8, 9], backHcps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  };
  const sched = [
    { week: 15, isPlayoff: true, side: "front", locked: true, matches: [{ team1: "T1", team2: "T2" }] },
    { week: 16, isPlayoff: true, side: "front", locked: true, matches: [{ team1: "T1", team2: "T2" }] },
    { week: 17, isPlayoff: true, side: "front", locked: false, matches: [{ team1: "T1", team2: "T2" }] },
  ];
  const pw = sched;
  const rnds = { p1: [{ season: 2026, week: 12, gross: 40 }] };

  // Posted rounds in weeks 15 and 17; week 16 was missed. Grosses are chosen
  // to avoid colliding with anything else the card prints — 36 would have
  // matched the PAR row's total, which made an earlier version of these tests
  // pass for the wrong reason.
  const scores = {};
  PARS9.forEach((v, h) => { scores[`w15_pp1_h${h}`] = v; });
  scores["w15_pp1_h0"] = PARS9[0] + 2;                                 // 38
  PARS9.forEach((v, h) => { scores[`w17_pp1_h${h}`] = v + 1; });       // 45
  const posted = [{ week: 15 }, { week: 17 }];

  const panel = (selected, rounds = posted, menuOpen = false) => renderToStaticMarkup(
    <IndividualRoundsPanel
      pid="p1" rounds={rounds} playoffWeeks={pw} selected={selected} onSelect={() => {}} menuOpen={menuOpen}
      schedule={sched} course={c} players={[{ id: "p1", name: "Ann Alpha", handicapIndex: 4 }]}
      scoringRules={{ hcpRecentCount: 8, hcpBestCount: 6 }} leagueConfig={{ year: 2026 }}
      allRounds={rnds} scores={scores}
    />
  );

  it("hangs the picker off the card heading, not a row above it", () => {
    // The whole point of the dropdown: no control row, so the scorecard keeps
    // the vertical space on a phone.
    const html = panel(15);
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain("Round 1");     // heading names the round on show
  });

  it("offers every posted round plus All when the menu is open", () => {
    const html = panel(15, posted, true);
    expect(html).toContain("Round 1");
    expect(html).toContain("Round 3");     // week 17 is the third playoff round
    expect(html).toContain("All rounds");
  });

  it("does not offer a round the golfer never posted", () => {
    // Week 16 is round 2 and was missed — no card exists, so no option.
    expect(panel(15, posted, true)).not.toContain("Round 2");
  });

  it("marks the current selection in the open menu", () => {
    expect(panel(17, posted, true)).toContain('aria-selected="true"');
  });

  it("shows only the selected round's card", () => {
    // Week 15 was played in 36, week 17 in 45.
    const html = panel(15);
    expect(html).toContain(">38<");
    expect(html).not.toContain(">45<");
  });

  it("switches to another round when selected", () => {
    const html = panel(17);
    expect(html).toContain(">45<");
    expect(html).not.toContain(">38<");
  });

  it("stacks every posted round under All", () => {
    const html = panel("all");
    expect(html).toContain(">38<");
    expect(html).toContain(">45<");
    // Each card carries its own round heading, so stacked cards stay readable.
    expect(html).toContain("Round 1");
    expect(html).toContain("Round 3");
  });

  it("leaves the heading as plain text when there is only one round", () => {
    // Nothing to pick, so no dropdown affordance — and no "All rounds", which
    // with a single round would just be a second name for the same card.
    const html = panel(15, [{ week: 15 }], true);
    expect(html).not.toContain("aria-haspopup");
    expect(html).not.toContain("All rounds");
    expect(html).toContain(">38<");
  });

  it("falls back to the latest round when the selection is stale", () => {
    // A re-seed can move weeks under a selection that's already open.
    const html = panel(99);
    expect(html).toContain(">45<");
  });

  it("renders nothing when no rounds have been posted", () => {
    expect(panel(15, [])).toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════
//  Board header — one sticky block
// ══════════════════════════════════════════════════════════════════
//
// The title, the Net/Gross lens line and the column headers all travel
// together as a single sticky element. Sticking them separately puts two or
// three elements at top:0 fighting for the same space, and a long board is
// exactly where you stop being able to remember which column is which.
//
// Note: the auto-scroll that brings a newly-expanded row into view runs in an
// effect, so it isn't covered here — server rendering doesn't run effects.
describe("board header", () => {
  const PARS9 = [4, 4, 4, 3, 5, 4, 4, 3, 5];
  const c = { name: "T", frontPars: PARS9, backPars: PARS9, frontHcps: [1,2,3,4,5,6,7,8,9], backHcps: [1,2,3,4,5,6,7,8,9] };
  const sched = [{ week: 15, isPlayoff: true, side: "front", locked: false, matches: [{ team1: "T1", team2: "T2" }] }];
  const board = (extra = {}) => renderToStaticMarkup(
    <IndividualLeaderboard
      players={players} teams={teams} schedule={sched} course={c}
      leagueConfig={{ year: 2026, playoffRounds: [{ name: "R1" }] }}
      scoringRules={{ hcpRecentCount: 8, hcpBestCount: 6 }}
      scores={{}} allRounds={allRounds} loading={false} {...extra}
    />
  );

  it("carries the column headers inside the sticky block", () => {
    const html = board();
    const hdr = html.indexOf("data-board-header");
    expect(hdr).toBeGreaterThan(-1);
    expect(html).toContain("position:sticky");
    // Column labels come after the sticky opener and before the first row.
    const player = html.indexOf(">Player<");
    const firstRow = html.indexOf("Alpha");
    expect(player).toBeGreaterThan(hdr);
    expect(player).toBeLessThan(firstRow);
    ["Total", "Thru", "R1"].forEach(l => expect(html).toContain(`>${l}<`));
  });

  it("renders a centered title when the caller supplies one", () => {
    const html = board({ title: "Individual Tournament" });
    expect(html).toContain("Individual Tournament");
    const i = html.indexOf("Individual Tournament");
    // The title's own wrapper is centered, and sits inside the sticky block.
    expect(html.lastIndexOf("text-align:center", i)).toBeGreaterThan(html.indexOf("data-board-header"));
  });

  it("omits the title entirely when the caller has its own", () => {
    // Standings renders the board under its own page chrome.
    expect(board()).not.toContain("Individual Tournament");
  });

  it("sticks exactly one element, not a title and a header separately", () => {
    const html = board({ title: "Individual Tournament" });
    expect(html.split("position:sticky").length - 1).toBe(1);
  });
});
