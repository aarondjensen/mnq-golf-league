// ══════════════════════════════════════════════════════════════════
//  The boundary: fun rounds must never reach league handicaps
// ══════════════════════════════════════════════════════════════════
//
// Every other test in this repo checks behavior. This one checks a
// STRUCTURAL invariant, because that's what the guarantee actually is:
//
//   Handicaps are computed by recalcHandicaps → fetchAllScores →
//   db.get("league_hole_scores"). Fun-round cards are written to
//   db.batchUpsert("league_fun_scores"). The two collections are
//   disjoint, and no code path joins them.
//
// A behavioral test can't express that. "Post a fun score, assert the
// handicap didn't move" would pass just as happily if the wiring were
// broken but the test's fixture happened not to trigger it — the whole
// risk is a FUTURE edit adding a path that doesn't exist today. So this
// reads the source and asserts the wiring, which is the thing that would
// change.
//
// If one of these fails, do not relax the assertion. It means a fun
// round can now move somebody's league handicap, which is the one thing
// this feature promised it would never do — the promise is printed on
// the screen ("Nothing here counts toward standings, handicaps, or
// stats") and repeated in three file headers.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");

// Strip comments so a file that merely EXPLAINS the boundary in prose
// isn't mistaken for one that crosses it. Several of these files
// deliberately name both collections in their headers.
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(line => !line.trim().startsWith("//"))
    .join("\n");

const LEAGUE_SCORES = "league_hole_scores";
const FUN_SCORES = "league_fun_scores";

// Everything that implements fun rounds.
const FUN_FILES = [
  "src/lib/funRounds.js",
  "src/lib/funScores.js",
  "src/components/FunRounds.jsx",
  "src/components/FunScorecard.jsx",
];

describe("fun rounds cannot reach league handicaps", () => {
  it("no fun module touches the league score collection", () => {
    for (const f of FUN_FILES) {
      expect(code(f), `${f} references ${LEAGUE_SCORES}`).not.toContain(LEAGUE_SCORES);
    }
  });

  it("no fun module calls the league score writer", () => {
    // saveScore(week, pid, hole, value) is the only thing that writes
    // league_hole_scores. FunRounds passes a NO-OP `saveScore={() => {}}`
    // into GroupScoring (which ignores it once a scoreStore is supplied),
    // so allow that exact inert form and nothing else.
    for (const f of FUN_FILES) {
      const src = code(f).replace(/saveScore=\{\(\)\s*=>\s*\{\}\}/g, "");
      expect(src, `${f} appears to call saveScore`).not.toMatch(/\bsaveScore\s*\(/);
    }
  });

  it("no fun module calls recalcHandicaps", () => {
    for (const f of FUN_FILES) {
      expect(code(f), `${f} calls recalcHandicaps`).not.toMatch(/\brecalcHandicaps\b/);
    }
  });

  it("the handicap input chain reads the league collection and only that", () => {
    // recalcHandicaps consumes fetchAllScores, which is itself a
    // composition: loadHistoricalRounds (prior seasons) + fetchSeasonScores
    // (this one). Assert the whole chain, since checking only the outer
    // function would miss a fun-score read added to either source.
    const app = code("src/App.jsx");
    const bodyOf = (decl) => {
      const from = app.slice(app.indexOf(decl));
      return from.slice(0, from.indexOf("\n  }, ["));
    };

    const recalc = bodyOf("const recalcHandicaps");
    expect(recalc).toContain("fetchAllScores");
    expect(recalc, "recalcHandicaps reads fun scores").not.toContain(FUN_SCORES);

    const all = bodyOf("const fetchAllScores");
    expect(all).toContain("loadHistoricalRounds");
    expect(all).toContain("fetchSeasonScores");
    expect(all, "fetchAllScores reads fun scores").not.toContain(FUN_SCORES);

    // The two leaves, where the actual Firestore reads happen.
    for (const decl of ["const loadHistoricalRounds", "const fetchSeasonScores"]) {
      const leaf = bodyOf(decl);
      expect(leaf, `${decl} should read ${LEAGUE_SCORES}`).toContain(LEAGUE_SCORES);
      expect(leaf, `${decl} reads fun scores`).not.toContain(FUN_SCORES);
    }
  });

  it("fun-score state never feeds a handicap or stats path", () => {
    // The subscription that populates funScores must hand it to
    // setFunScores and nowhere else.
    const app = code("src/App.jsx");
    const subs = app.match(new RegExp(`db\\.subscribe\\("${FUN_SCORES}"[^;]*;`, "g")) || [];
    expect(subs).toHaveLength(1);
    expect(subs[0]).toContain("setFunScores");
  });

  it("a fun-round card carries no week, so week-keyed readers can't see it", () => {
    // The isolation is ultimately this: league scores are addressed
    // `w{week}_p{pid}_h{hole}` and every handicap/stats reader is built
    // on that shape. A fun card is keyed by round and has no week at all.
    const funScores = code("src/lib/funScores.js");
    expect(funScores).toContain("roundId");
    expect(funScores).not.toMatch(/w\$\{week\}/);
  });

  it("still states the guarantee on screen", () => {
    // The user-facing half of the promise. If the sentence goes, players
    // have no way to know a casual 39 is safe.
    expect(read("src/components/FunRounds.jsx"))
      .toContain("Nothing here counts toward standings, handicaps, or stats");
  });
});
