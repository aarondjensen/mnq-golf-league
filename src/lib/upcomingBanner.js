// ══════════════════════════════════════════════════════════════════
//  upcomingBanner — "your current week" banner data.
// ══════════════════════════════════════════════════════════════════
//
// The app-level banner that shows the signed-in player their tee time for the
// current week (rendered above Standings / Schedule). Pure so it can be unit
// tested: App.jsx passes the already-loaded collections in and renders the
// returned shape.
//
// Two ways a player has a tee time
// ────────────────────────────────
//   1. A TEAM MATCH — my team is team1 or team2 of a match in the week.
//   2. An INDIVIDUAL GROUP — once my team is knocked out of the playoff
//      bracket the seeder dissolves it into the individual pool and regroups
//      those players into foursomes (see lib/indivGroups.js). Those matches
//      carry `players: [pid,...]` and NO team1/team2.
//
// Case 2 used to make the banner vanish for the rest of the playoffs: the
// lookup only asked "is my team in this match?", found nothing, and bailed —
// so an eliminated player lost the one place the app told them when they tee
// off, even though Schedule's My Schedule row had a purpose-built individual
// row for exactly this. Both surfaces now answer the same question the same
// way (theme.isIndivGroupMatch).
//
// "Current week" is the first week that is neither rained out nor locked and
// has matches written. If I'm in NEITHER a match nor a group that week (a bye,
// or the week isn't seeded for me yet) there is no banner — we deliberately do
// not skip ahead to a later week, because a tee time three weeks out is not
// what "current week" means.

import { isIndivGroupMatch } from "./matches";

// Last name only, matching the banner's compact two/three-line right column.
const lastName = (name) => (name || "").trim().split(/\s+/).filter(Boolean).pop() || "";

// Returns null when there's nothing to show, otherwise:
//   {
//     week, date, side, teeTime, teeMinutes,
//     isIndivGroup,                       // false → team match, true → group
//     opp, oppName1, oppName2,            // team match only
//     groupNames,                         // individual group only (the OTHER
//   }                                     // golfers in my foursome)
export function computeUpcomingBanner({
  schedule = [],
  teams = [],
  players = [],
  playerId = null,
  leagueConfig = null,
}) {
  if (!playerId || !schedule.length) return null;

  const myTeam = teams.find(t => t.player1 === playerId || t.player2 === playerId) || null;

  for (const wk of schedule) {
    if (wk.rainedOut) continue;
    if (!wk.matches || wk.matches.length === 0) continue;
    if (wk.locked) continue;

    const myMatch = myTeam
      ? wk.matches.find(m => !isIndivGroupMatch(m) && (m.team1 === myTeam.id || m.team2 === myTeam.id))
      : null;
    // Only look for a group when there's no match — a player can't be in both,
    // and the match is the richer card when they are.
    const myGroup = !myMatch
      ? wk.matches.find(m => isIndivGroupMatch(m) && (m.players || []).includes(playerId))
      : null;
    if (!myMatch && !myGroup) return null;

    // Tee order is the match's position in the week's list — the same rule
    // the Schedule's tee time formatter uses. Individual groups are written
    // ahead of the bracket, so this lands them on the early tees.
    const entry = myMatch || myGroup;
    const idx = wk.matches.indexOf(entry);
    const base = leagueConfig?.startTime ?? "4:28 PM";
    const interval = leagueConfig?.teeInterval ?? 8;
    const [timePart, ampm] = base.split(' ');
    const [h, m] = timePart.split(':').map(Number);
    const mins = (ampm === 'PM' && h !== 12 ? h + 12 : h) * 60 + m + idx * interval;
    const hr = Math.floor(mins / 60) % 12 || 12;
    const mn = mins % 60;
    const teeTime = `${hr}:${String(mn).padStart(2, '0')}`;

    const common = { week: wk.week, date: wk.date, side: wk.side, teeTime, teeMinutes: mins };

    if (myGroup) {
      const others = (myGroup.players || []).filter(pid => pid && pid !== playerId);
      const groupNames = others.map(pid => {
        const p = players.find(x => x.id === pid);
        return p ? lastName(p.name) : "TBD";
      });
      return { ...common, isIndivGroup: true, groupNames };
    }

    const oppId = myMatch.team1 === myTeam.id ? myMatch.team2 : myMatch.team1;
    const opp = teams.find(t => t.id === oppId);
    const oppP1 = opp ? players.find(p => p.id === opp.player1) : null;
    const oppP2 = opp ? players.find(p => p.id === opp.player2) : null;
    return {
      ...common,
      isIndivGroup: false,
      opp: opp?.name || "TBD",
      oppName1: oppP1 ? lastName(oppP1.name) : "TBD",
      oppName2: oppP2 ? lastName(oppP2.name) : "TBD",
    };
  }

  return null;
}
