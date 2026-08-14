// ══════════════════════════════════════════════════════════════════
//  individualRounds — makeups, withdrawals, and the sentinels for both.
// ══════════════════════════════════════════════════════════════════
//
// The individual event's own namespace: a round played on another night, a
// player who withdrew, a player who never showed. These live as sentinel hole
// VALUES rather than as flags, so classifying a hole is the only safe way to
// read one.
//
// Split out of lib/league.js, which was itself split out of theme.jsx. One
// 861-line file holding handicaps, standings, seeding, brackets and score
// classification was a big improvement on 1,108 mixed ones, and still coarser
// than Bourbon Cup and WBC, which both split their domain by concern. These
// clusters barely referenced each other, so the split is along seams that were
// already there.
//
// Pure: no React, no Firestore, no DOM.

// ── Individual-event makeup rounds & withdrawals (Path 2 namespace) ────────
// Playoff edge case: a player who can't play on League Night is marked absent
// so their TEAM match proceeds with the present teammate covering both slots
// (the _habsent sentinel). Match play can't be made up — it's head-to-head and
// time-bound. Their INDIVIDUAL tournament round CAN be made up on another day,
// and that makeup round must also feed the player's handicap.
//
// Those two truths (absent for the match / played a real round for the event)
// would collide if they shared the _h{0..8} + _habsent keys, so the makeup
// round lives in its OWN key namespace inside league_hole_scores. The team
// match never reads these, so a makeup can never disturb an already-decided
// match. Each rides in as a normal hole-score doc via saveScore(week, pid,
// hole, score) — the `hole` field is what distinguishes them:
//
//   hole "m0".."m8"  →  key _hm0.._hm8   — a full (or partial) 9-hole makeup card
//   hole "mtotal"    →  key _hmtotal     — a total-only makeup (gross only, no holes)
//   hole "indivwd"   →  key _hindivwd    — explicit withdrawal from the event (=1)
//
// A makeup round (hole card OR total) counts toward BOTH the individual
// leaderboard and the handicap calc (calcPlayerHcp needs a gross, not per-hole
// detail). A total-only makeup counts everywhere a gross suffices but is
// intentionally invisible to the per-hole Stats boards — there's no
// distribution to attribute and fabricating one would inject fake birdies/pars.
// Withdrawal (_hindivwd) is the SINGLE SOURCE OF TRUTH for "out of the
// individual event"; the view no longer infers withdrawal from _habsent.
export const IND_MAKEUP_HOLE_RE = /^m[0-8]$/;   // "m0".."m8"
export const IND_MAKEUP_TOTAL = "mtotal";       // hole value for a total-only makeup
export const IND_WITHDRAW = "indivwd";          // hole value for the withdrawal sentinel
export const IND_ABSENT = "absent";             // hole value for the team-match absent sentinel

// Classify a raw hole-score doc's `hole` field into a score-type tag. Used by
// App.jsx:aggregateRounds (doc shape) so makeup / withdrawal / absent docs are
// no longer miscounted as ordinary holes:
//   'real'         — a normal 0..8 hole that builds the League-Night round
//   'makeupHole'   — one hole of a 9-hole makeup card
//   'makeupTotal'  — a total-only makeup (its score IS the round gross)
//   'withdraw'     — the individual-event withdrawal sentinel (not a score)
//   'absent'       — the team-match absent sentinel (not a score)
//   'ignore'       — anything unrecognized (never counted)
export function classifyScoreHole(hole) {
  if (typeof hole === "number") return (hole >= 0 && hole <= 8) ? "real" : "ignore";
  const s = String(hole);
  if (/^[0-8]$/.test(s)) return "real";
  if (s === IND_ABSENT) return "absent";
  if (s === IND_WITHDRAW) return "withdraw";
  if (s === IND_MAKEUP_TOTAL) return "makeupTotal";
  if (IND_MAKEUP_HOLE_RE.test(s)) return "makeupHole";
  return "ignore";
}

// Resolve a player's individual-event round for a given week from the FLAT
// score map (the { `w{week}_p{pid}_h{hole}`: score } shape used by Scoring,
// Standings' live leaderboard, and Stats). Read-side single source of truth,
// mirroring classifyScoreHole on the doc side so the two can never drift.
//
// Returns { withdrawn, mode, holes, gross, holesPlayed, totalOnly }:
//   withdrawn   — player withdrew from the event this week (independent of scores)
//   mode        — 'live' | 'makeupHoles' | 'makeupTotal' | 'none'
//   holes       — { [h]: grossOnHole } for holes with a score ({} for total-only)
//   gross       — round gross (sum of holes, or the entered total)
//   holesPlayed — count of holes with a score (9 for total-only: it's a full round)
//   totalOnly   — true when the round is a bare total with no hole detail
//
// Resolution order: a real League-Night card (any _h{0..8}) wins; then a
// makeup hole card (_hm{0..8}); then a total-only makeup (_hmtotal). Withdrawal
// is reported independently so a withdrawn player ranks WD even if a stray
// prior score exists.
export function resolveIndivRound(scores, week, pid) {
  const at = (suffix) => scores[`w${week}_p${pid}_h${suffix}`];
  const withdrawn = at(IND_WITHDRAW) === 1;

  // Real League-Night holes (0-indexed h=0..8).
  const realHoles = {};
  let realCount = 0, realGross = 0;
  for (let h = 0; h <= 8; h++) {
    const s = at(h);
    if (s && s > 0) { realHoles[h] = s; realCount++; realGross += s; }
  }
  if (realCount > 0) {
    return { withdrawn, mode: "live", holes: realHoles, gross: realGross, holesPlayed: realCount, totalOnly: false };
  }

  // Makeup hole card.
  const mkHoles = {};
  let mkCount = 0, mkGross = 0;
  for (let h = 0; h <= 8; h++) {
    const s = at(`m${h}`);
    if (s && s > 0) { mkHoles[h] = s; mkCount++; mkGross += s; }
  }
  if (mkCount > 0) {
    return { withdrawn, mode: "makeupHoles", holes: mkHoles, gross: mkGross, holesPlayed: mkCount, totalOnly: false };
  }

  // Total-only makeup — a full round with no per-hole detail.
  const total = at(IND_MAKEUP_TOTAL);
  if (total && total > 0) {
    return { withdrawn, mode: "makeupTotal", holes: {}, gross: total, holesPlayed: 9, totalOnly: true };
  }

  return { withdrawn, mode: "none", holes: {}, gross: 0, holesPlayed: 0, totalOnly: false };
}
