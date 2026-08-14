// ══════════════════════════════════════════════════════════════════
//  matches — who is in a match, and whether its week is finished.
// ══════════════════════════════════════════════════════════════════
//
// The canonical "who plays in this match" resolver, the individual-group
// identity helpers, and the two week-completion predicates. Everything here
// answers a question about a match rather than about a result.
//
// Split out of lib/league.js, which was itself split out of theme.jsx. One
// 861-line file holding handicaps, standings, seeding, brackets and score
// classification was a big improvement on 1,108 mixed ones, and still coarser
// than Bourbon Cup and WBC, which both split their domain by concern. These
// clusters barely referenced each other, so the split is along seams that were
// already there.
//
// Pure: no React, no Firestore, no DOM.

// ── Shared utility: format tee time from base time string + index ──
export function formatTeeTime(baseTime, idx, interval = 8) {
  const [timePart, ampm] = (baseTime || "4:28 PM").split(' ');
  const [h, m] = timePart.split(':').map(Number);
  let mins = (ampm === 'PM' && h !== 12 ? h + 12 : h) * 60 + m + idx * interval;
  const hr = Math.floor(mins / 60) % 12 || 12;
  const mn = mins % 60;
  const ap = Math.floor(mins / 60) >= 12 ? 'PM' : 'AM';
  return `${hr}:${String(mn).padStart(2, '0')} ${ap}`;
}

// ── Canonical "who plays in this match" resolver ──────────────────────────
// Regular and bracket matches derive their four players from the two team
// records (team1/team2). Consolation matches — the non-bracket playoff matches
// for knocked-out teams — may instead carry an explicit `players` array, since
// those players can be re-paired into ad-hoc groups that ignore team lines.
// When `players` is present it wins; otherwise we fall back to the team rosters.
// Single source of truth so scoring, the Low Net board, and the individual
// tournament always agree on a match's roster regardless of how it was formed.
// `match.sides` (optional) holds the competing sub-groups, e.g. [[pA,pB],[pC,pD]]
// for a 2v2; absent means the group shares a tee time with no head-to-head.
export function matchPids(match, teams) {
  if (!match) return [];
  if (Array.isArray(match.players) && match.players.length) {
    return match.players.filter(Boolean);
  }
  const t1 = (teams || []).find(t => t.id === match.team1);
  const t2 = (teams || []).find(t => t.id === match.team2);
  return [t1?.player1, t1?.player2, t2?.player1, t2?.player2].filter(Boolean);
}

// ── Individual-group predicate ────────────────────────────────────────────
// An individual group is a playoff tee time for players whose TEAM has been
// knocked out of the bracket (see lib/indivGroups.js). It carries a `players`
// array and NO team1/team2, because there is no head-to-head match — the four
// golfers just post individual net rounds for the individual tournament.
//
// Consequences every caller has to respect:
//   • There is no match_result document, and there never will be. Any
//     "does every match have a result / is every match attested" check must
//     skip these or the week can never be finalized.
//   • Team-shaped rendering (two halves, seeds, W-L-T records, match-play
//     center strip) has nothing to draw — `teams.find(t => t.id === undefined)`
//     resolves to undefined and the card renders as "TBD".
//
// Lives here rather than in lib/indivGroups.js so the cheap predicate is
// available to App.jsx / Admin.jsx / Schedule.jsx without pulling in the
// individual-board math those files never use.
export function isIndivGroupMatch(match) {
  return match?.isIndivGroup === true;
}

// ── Individual-group signature records ────────────────────────────────────
// An individual group signs and attests its scorecard exactly like a match
// does — the individual tournament is a real competition, so a group's card
// gets the same two-person integrity check before the week locks.
//
// The record lives in its own `league_group_results` collection rather than
// in league_match_results. A group record has no team1Id/team2Id, and the app
// is full of `find(r => r.team1Id === m.team1 && r.team2Id === m.team2)`
// lookups; for an individual group `m.team1` is undefined, so a teamless
// record sitting in the same collection would satisfy `undefined === undefined`
// and get paired with the wrong row. Separate collection, no ambiguity.
//
// Keyed by the SORTED player set, not by array index: a group's position in
// the week's match list shifts whenever the week is re-seeded, but its roster
// is what identifies it. A re-seed that changes the roster produces a
// different key, so a stale signature can never be mistaken for a current one.
export function indivGroupKey(match) {
  const pids = Array.isArray(match?.players) ? match.players.filter(Boolean) : [];
  return [...pids].sort().join("-");
}

export function indivGroupResultId(leagueId, week, match) {
  return `${leagueId}_w${week}_g${indivGroupKey(match)}`;
}

// Find the signature record for a given group in a given week, if any.
export function findGroupResult(groupResults, week, match) {
  const key = indivGroupKey(match);
  if (!key) return null;
  return (groupResults || []).find(g => g.week === week && indivGroupKey(g) === key) || null;
}

// "Every match AND every individual group in this week is signed and
// attested." Both halves gate the week: the bracket decides who advances,
// the individual groups feed the individual tournament, and neither should
// lock on unverified cards.
//
// A week with nothing at all to attest returns false — there's no signature
// to wait on, so it isn't "ready to finalize" on the strength of attestation.
//
// Shared by App.jsx's finalize banner, Admin.jsx's week list and Scoring's
// finalize pre-flight so they can never disagree about which week the
// commissioner is being told to finalize.
export function weekFullyAttested(wk, matchResults, groupResults) {
  const all = wk?.matches || [];
  if (all.length === 0) return false;
  return all.every(m => isIndivGroupMatch(m)
    ? findGroupResult(groupResults, wk.week, m)?.attested === true
    : (matchResults || []).some(r =>
        r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2 && r.attested === true
      )
  );
}

// "Every match AND every individual group in this week has a SIGNED result."
// Weaker than weekFullyAttested — attestation not required. Used by the
// finalize action's safety guard, which exists to stop a week being locked
// before it's been played.
export function weekFullyScored(wk, matchResults, groupResults) {
  const all = wk?.matches || [];
  if (all.length === 0) return false;
  return all.every(m => isIndivGroupMatch(m)
    ? !!findGroupResult(groupResults, wk.week, m)
    : (matchResults || []).some(r =>
        r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2
      )
  );
}
