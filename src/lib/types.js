// ══════════════════════════════════════════════════════════════════
//  Global types — MnQ Golf League
// ══════════════════════════════════════════════════════════════════
//
// JSDoc typedefs that VS Code, JetBrains, and other editors pick up
// automatically for IntelliSense, auto-import, and prop-name catch.
// We deliberately did NOT migrate the whole codebase to TypeScript
// (~13K LOC of React, plus the cost of build-tool churn during an
// active season). This file is the lightweight middle ground.
//
// How to use a typedef in a file
// ──────────────────────────────
// In any .js or .jsx file:
//
//   /** @type {import('./lib/types').Player} */
//   const myPlayer = players.find(p => p.id === pid);
//
// Or annotate a function parameter:
//
//   /** @param {import('./lib/types').Team} team */
//   function renderTeam(team) { ... }
//
// Or — most useful — declare props for a component:
//
//   /**
//    * @param {{
//    *   players: import('./lib/types').Player[],
//    *   teams: import('./lib/types').Team[],
//    *   onSelect: (pid: string) => void,
//    * }} props
//    */
//   function MyComponent({ players, teams, onSelect }) { ... }
//
// Editor catches typos in `players[i].handicapindex` (missing capital)
// at edit time. No build step. No runtime cost.
//
// Maintenance discipline
// ──────────────────────
// When a Firestore document shape changes, update this file in the
// SAME commit. The whole point is that typedefs stay in sync with
// reality; an out-of-date typedef is worse than no typedef because
// it shows green check marks on wrong code.

// ──────────────────────────────────────────────────────────────────
//  Player / Member / Team
// ──────────────────────────────────────────────────────────────────

/**
 * A league player. Keyed by `id` in the `league_players` collection.
 * Status: "active" players show up in standings, scoring, etc.
 * "inactive" players are hidden from active views but kept for
 * historical-round attribution.
 *
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} name
 * @property {number} handicapIndex            Current rolling handicap.
 * @property {number} [startingHandicapIndex]  Season-start handicap; preserved for retroactive HCP lookups.
 * @property {"active" | "inactive"} [status]  Defaults to "active" when omitted.
 * @property {string} [league_id]              Always equals LEAGUE_ID in single-league deployments.
 * @property {number} [season]                 Season year (2026 etc).
 */

/**
 * An auth member — a real human signed into the app, linked (or not yet)
 * to a Player. Members can be commissioner without being a player.
 *
 * @typedef {Object} Member
 * @property {string} id            Firebase auth uid.
 * @property {string} email
 * @property {string} [displayName]
 * @property {string | null} [playerId]  Link to Player.id; null until joined.
 * @property {boolean} [isComm]    Commissioner flag — gates admin features.
 * @property {string} [league_id]
 */

/**
 * A team — two players. Names like "Stevens / Vigo". The same player
 * never appears on two active teams in the same season.
 *
 * @typedef {Object} Team
 * @property {string} id
 * @property {string} name
 * @property {string} player1      Player.id
 * @property {string} player2      Player.id
 * @property {string} [league_id]
 */

// ──────────────────────────────────────────────────────────────────
//  Schedule & match-play results
// ──────────────────────────────────────────────────────────────────

/**
 * A single matchup within a scheduled week — two teams paired.
 *
 * @typedef {Object} Match
 * @property {string} team1        Team.id
 * @property {string} team2        Team.id
 */

/**
 * A scheduled week. Stored in `league_schedule`. Many flags drive the
 * UI's interpretation — see the constitution's "Schedule structure by
 * flags, not hardcoded week numbers" principle.
 *
 * @typedef {Object} ScheduleWeek
 * @property {string} id
 * @property {number} week           1-indexed week number within the season.
 * @property {string} date           YYYY-MM-DD format.
 * @property {Match[]} [matches]
 * @property {boolean} [locked]      Once true, week's results no longer recalc on handicap drift.
 * @property {boolean} [rainedOut]   Must be explicitly false to clear — `merge: true` writes won't drop the prop.
 * @property {boolean} [seeded]      Seeded-pairing week (record-mode only).
 * @property {boolean} [isPlayoff]   Playoff weeks — DO NOT derive from week number thresholds, ONLY from this flag.
 * @property {number} [makeupFor]    If set: this week is a makeup, this is the rained-out week it replaces.
 */

/**
 * A persisted match-play result. Stored in `league_match_results`.
 * The matchResultText string is the human-readable result like "3&2",
 * "1UP", "TIED", or "TIE (Hole 5)" for tiebreakers. matchWinnerId is
 * null on any tied outcome — both the simple TIED case and the
 * tiebreaker "TIE (Hole N)" case.
 *
 * @typedef {Object} MatchResult
 * @property {string} id
 * @property {number} week
 * @property {string} team1Id
 * @property {string} team2Id
 * @property {string} matchResultText                  "3&2" | "1UP" | "TIED" | "TIE (Hole 5)" etc.
 * @property {string | null} matchWinnerId             null when tied.
 * @property {number} team1Points
 * @property {number} team2Points
 * @property {number} [t1HolesWon]
 * @property {number} [t2HolesWon]
 * @property {string} [signedBy]                       Player.id of the scorer who signed.
 * @property {boolean} [attested]                      All non-signing players attested.
 * @property {string[]} [attestedBy]                   Player.ids of attesters so far.
 * @property {string} [league_id]
 */

// ──────────────────────────────────────────────────────────────────
//  Per-hole scoring
// ──────────────────────────────────────────────────────────────────

/**
 * One score: one player, one hole, one week. Stored in
 * `league_hole_scores`. Key reminder: `hole` is 0-indexed (h=0..8)
 * regardless of which side is being played. Display layer converts
 * to course-hole numbers (10-18 for the back nine).
 *
 * @typedef {Object} HoleScore
 * @property {string} id           Conventionally `w${week}_p${pid}_h${hole}`.
 * @property {number} week
 * @property {string} player_id
 * @property {number} hole         0-8 (NOT the course-hole number).
 * @property {number} score        Strokes taken; absent players' rows have score=0 with _habsent=1.
 * @property {number} [_habsent]   1 marks "this is an absent-player substitution row".
 * @property {number} season
 * @property {string} [league_id]
 */

/**
 * Player attendance for a future week. The presence of a record is
 * the signal; clearing means deletion. Status "absent" = teammate's
 * scores substitute for theirs at match-calc time. Status "makeup" =
 * match is held open pending their late score post.
 *
 * @typedef {Object} AttendanceFlag
 * @property {"absent" | "makeup"} status
 * @property {number} markedAt    Timestamp ms.
 * @property {string} markedBy    Player.id (or "commish" if a commish flagged on behalf).
 */

/**
 * Flat attendance lookup as held in App.jsx state. Keys: `w${week}_p${pid}`.
 *
 * @typedef {Record<string, AttendanceFlag>} AttendanceMap
 */

// ──────────────────────────────────────────────────────────────────
//  Course & league config
// ──────────────────────────────────────────────────────────────────

/**
 * Per-hole course metadata. holes[0..8] is the front nine; holes[9..17]
 * is the back nine. Both par and handicap (1=hardest, 18=easiest within
 * the side) are required for scoring math.
 *
 * @typedef {Object} CourseHole
 * @property {number} par
 * @property {number} handicap     1-18 within the full course.
 * @property {number} [yardage]
 */

/**
 * @typedef {Object} Course
 * @property {string} name
 * @property {CourseHole[]} holes              18 entries.
 * @property {number} [frontPar]               Sum of holes[0..8].par; cached.
 * @property {number} [backPar]                Sum of holes[9..17].par; cached.
 */

/**
 * The single per-league config doc. Stored at `league_config/{LEAGUE_ID}_config`.
 *
 * @typedef {Object} LeagueConfig
 * @property {number} [year]
 * @property {string} [startTime]
 * @property {"points" | "record"} [standingsMethod]
 * @property {string} [inviteCode]
 * @property {{ name: string, weeks: number[] }[]} [playoffRounds]
 * @property {string[][][]} [customSeedWeeks]        customSeedWeeks[weekIdx][matchIdx] = [seed1, seed2]
 * @property {string[]} [lockedSeeds]                Team.ids in current seed order; static snapshot.
 * @property {boolean} [individualEvent]             default true.
 */

/**
 * Scoring rules — point distribution, low-net bonus, etc.
 *
 * @typedef {Object} ScoringRules
 * @property {number} [recentN]                   Window size for HCP calc.
 * @property {number} [bestN]                     Best-of count within window.
 * @property {Record<string, number>} [points]    Per-result point payouts, keyed by result text.
 */

// ──────────────────────────────────────────────────────────────────
//  App-state derived types
// ──────────────────────────────────────────────────────────────────

/**
 * What the auth/membership layer hands down. Used by feature pages as
 * `leagueUser`. Aaron's commissioner mode toggles cause `playerId` to
 * temporarily reflect an impersonated player while `isComm` remains
 * true — keep both fields in mind when gating commish-only UI vs
 * acting-as-X behavior.
 *
 * @typedef {Object} LeagueUser
 * @property {string} uid               Firebase auth uid.
 * @property {string | null} playerId   Real or impersonated Player.id.
 * @property {boolean} isComm           Real-commish flag (NOT impersonation state).
 * @property {string} [email]
 * @property {string} [displayName]
 */

// ──────────────────────────────────────────────────────────────────
//  Computation outputs
// ──────────────────────────────────────────────────────────────────

/**
 * A single row produced by buildStandingsForSeed in theme.jsx.
 * Sort order depends on the standingsMethod argument:
 *   "points" → points desc, then hw desc.
 *   "record" → win% desc, then w desc, then l asc, then hw desc.
 *
 * @typedef {Object} StandingsRow
 * @property {string} teamId
 * @property {number} points
 * @property {number} w
 * @property {number} l
 * @property {number} t
 * @property {number} hw              Total holes won across counted weeks.
 * @property {number} gp              Games played (counts only matches that yielded W, L, or T).
 */

/**
 * Output of calcPlayerHcp.
 *
 * @typedef {number | null} Handicap  Integer relative to par; null when no rounds in window.
 */

// Empty export keeps this a module file. Required because the
// typedef-only export pattern is otherwise indistinguishable from a
// script file in some tools.
export {};
