// ─────────────────────────────────────────────────────────────────────────────
//  lib/scheduleDate.js — single source of truth for schedule date handling
// ─────────────────────────────────────────────────────────────────────────────
//
// `wk.date` throughout the app is stored as a short readable string like
// "Apr 21" (produced by toLocaleDateString('en-US', { month: 'short', day:
// 'numeric' }) in Admin's schedule generator and rain-out flow).
//
// Multiple callers used to roll their own parser, with two known bugs:
//   1. Standings.jsx live-leaderboard polling compared an ISO `2026-04-29`
//      string against `"Apr 21"` lexicographically — always returned true,
//      so the LIVE badge / 20s polling never engaged.
//   2. Schedule.jsx ICS export tried `wk.date.split('/')` first, which never
//      matches the stored format (dead branch falling through to the working
//      "Apr 21" parser).
//
// All schedule-date math now goes through these helpers.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Parse a stored schedule date string into a Date in local time. Tolerant of
// either "Apr 21" (canonical) or "4/21" (legacy/manual). Returns null on
// anything we can't parse — callers should treat null as "no scheduled date."
export function parseScheduleDate(dateStr, year) {
  if (!dateStr) return null;
  const yr = year || new Date().getFullYear();

  // "Apr 21" / "April 21" — canonical
  const parts = String(dateStr).trim().split(/\s+/);
  if (parts.length === 2) {
    const monKey = parts[0].slice(0, 3).toLowerCase();
    const m = MONTHS[monKey];
    const d = parseInt(parts[1], 10);
    if (m !== undefined && d > 0 && d <= 31) {
      return new Date(yr, m, d);
    }
  }

  // "4/21" — legacy fallback
  const slashParts = String(dateStr).trim().split('/').map(s => parseInt(s, 10));
  if (slashParts.length === 2 && slashParts[0] > 0 && slashParts[1] > 0) {
    return new Date(yr, slashParts[0] - 1, slashParts[1]);
  }

  return null;
}

// Produce the canonical stored format from a Date.
export function formatScheduleDate(date) {
  if (!date || isNaN(date.getTime())) return "";
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Compare a stored schedule date to "today" on day boundary in local time.
// Returns -1 if scheduled date is earlier than today, 0 if same day, 1 if
// later. Returns null when the date can't be parsed (caller must handle).
//
// This replaces the ISO-vs-readable string compare that was silently broken.
export function compareScheduleDateToToday(dateStr, year, today = new Date()) {
  const sched = parseScheduleDate(dateStr, year);
  if (!sched) return null;
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const schedMidnight = new Date(sched.getFullYear(), sched.getMonth(), sched.getDate());
  if (schedMidnight < todayMidnight) return -1;
  if (schedMidnight > todayMidnight) return 1;
  return 0;
}

// Convenience: true when scheduled date is today or earlier. Used by the
// live-leaderboard "is the final round actually being played today?" check.
export function isScheduleDateAtOrPast(dateStr, year, today = new Date()) {
  const cmp = compareScheduleDateToToday(dateStr, year, today);
  return cmp !== null && cmp <= 0;
}
