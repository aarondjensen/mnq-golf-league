// ══════════════════════════════════════════════════════════════════
//  lib/seasonPhase.js — "is the season over?"
// ══════════════════════════════════════════════════════════════════
//
// Three tabs need to agree on this, and each one used to answer it a
// slightly different way:
//
//   • Standings picks its default view from it.
//   • Schedule decides whether to open on Fun.
//   • Scoring decides whether it's still a league-week scoring screen.
//
// A season is over when the FINAL POSTSEASON ROUND IS FINALIZED — the
// last playoff week that was actually played is locked. Not "every week
// is locked": a mid-season week left open for a makeup is a normal
// state of affairs and must not keep the season alive forever after the
// bracket has crowned a champion.
//
// Consistent with the rest of the app, this reads flags rather than
// week numbers (see the constitution's "schedule structure by flags,
// not hardcoded week numbers"). A league with no playoff weeks
// configured falls back to its last played week, so this still answers
// sensibly for a season that's purely round-robin.

/**
 * @param {import('./types').ScheduleWeek[]} schedule
 * @returns {boolean}
 */
export function isSeasonComplete(schedule) {
  // Rained-out weeks and weeks with no matchups never happened, so they
  // can neither end the season nor hold it open.
  const played = (schedule || []).filter(
    wk => wk && wk.rainedOut !== true && (wk.matches?.length || 0) > 0
  );
  if (!played.length) return false;

  const playoffs = played.filter(wk => wk.isPlayoff === true);
  const pool = playoffs.length ? playoffs : played;
  const final = pool.reduce((latest, wk) => (wk.week > latest.week ? wk : latest));
  return final.locked === true;
}
