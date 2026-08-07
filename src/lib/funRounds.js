// ══════════════════════════════════════════════════════════════════
//  lib/funRounds.js — "fun" rounds: casual tee times outside the
//  official league schedule.
// ══════════════════════════════════════════════════════════════════
//
// What a fun round IS
// ───────────────────
// A commissioner-created tee time on a date the league isn't otherwise
// playing. Players sign themselves up, groups fill in join order, and
// tee times fall out of the start time + interval. That's the whole
// feature — it's a tee-time creator, not a competition.
//
// What a fun round is NOT
// ───────────────────────
// It is NOT a schedule week. Deliberately so. Fun rounds live in their
// own Firestore collection (`league_fun_rounds`) with NO `week` field,
// which is what keeps them structurally incapable of leaking into
// league math. The alternative — an `isFun` flag on `league_schedule`
// docs — would have required auditing and amending every one of the
// ~40 `schedule.filter(...)` call sites across Admin, Schedule,
// Standings, Stats, matchCalc, and scheduleAutoSeed; a single missed
// filter would silently fold a casual round into standings, handicaps,
// or the playoff seed order. A separate collection can't be missed by a
// filter that never queries it.
//
// Consequences of that isolation, stated plainly so nobody has to guess:
//   • Fun rounds never affect standings, points, or the playoff bracket.
//   • Fun rounds never affect handicaps — no hole scores are written.
//   • Fun rounds never appear in Stats.
//   • There is no scoring UI. Signup and tee times only.
//
// Dates use the SAME stored format as ScheduleWeek.date ("Sep 1", see
// lib/scheduleDate.js) so all schedule-date math in the app goes through
// one parser. The year lives on the round's `season` field, matching how
// schedule weeks resolve their year from leagueConfig.

import { formatTeeTime } from "../theme";
import { parseScheduleDate, formatScheduleDate, compareScheduleDateToToday } from "./scheduleDate";

// Foursome is the default and the overwhelmingly common case; the form
// allows 2–6 for the occasional twosome or fivesome the course permits.
export const FUN_GROUP_SIZE = 4;
export const FUN_GROUP_SIZE_MIN = 2;
export const FUN_GROUP_SIZE_MAX = 6;
export const FUN_TEE_INTERVAL = 8;

// ── Signups ───────────────────────────────────────────────────────
//
// `signups` is an ARRAY, not a set or a map, because join ORDER is the
// group assignment: the first four to sign up tee off first. Order is
// the feature, so the array is normalized (deduped, junk dropped)
// rather than sorted.

/** @param {{signups?: string[]}} round */
export function normalizeSignups(round) {
  const raw = Array.isArray(round?.signups) ? round.signups : [];
  const seen = new Set();
  const out = [];
  for (const pid of raw) {
    if (typeof pid !== "string" || !pid || seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
  }
  return out;
}

export function isSignedUp(round, pid) {
  return !!pid && normalizeSignups(round).includes(pid);
}

// Returns the NEXT signups array — pure, so the caller decides whether
// to persist. Joining appends (preserving tee order for everyone who
// signed up earlier); leaving removes without reshuffling the rest.
export function withSignup(round, pid, joining) {
  const list = normalizeSignups(round);
  if (!pid) return list;
  if (joining) return list.includes(pid) ? list : [...list, pid];
  return list.filter(x => x !== pid);
}

// ── Groups & tee times ────────────────────────────────────────────

export function funGroupSize(round) {
  const n = Number(round?.groupSize);
  if (!Number.isInteger(n)) return FUN_GROUP_SIZE;
  return Math.min(FUN_GROUP_SIZE_MAX, Math.max(FUN_GROUP_SIZE_MIN, n));
}

export function funTeeInterval(round) {
  const n = Number(round?.teeInterval);
  if (!Number.isInteger(n) || n < 1 || n > 60) return FUN_TEE_INTERVAL;
  return n;
}

/**
 * Chunk signups into tee groups, each with its computed tee time.
 * Returns [] for an empty signup list — an unfilled round shows the
 * "nobody yet" state rather than a phantom empty group.
 *
 * @returns {{ idx: number, teeTime: string, pids: string[] }[]}
 */
export function buildFunGroups(round) {
  const pids = normalizeSignups(round);
  const size = funGroupSize(round);
  const interval = funTeeInterval(round);
  const groups = [];
  for (let i = 0; i < pids.length; i += size) {
    const idx = groups.length;
    groups.push({
      idx,
      teeTime: formatTeeTime(round?.startTime, idx, interval),
      pids: pids.slice(i, i + size),
    });
  }
  return groups;
}

// ── Ordering ──────────────────────────────────────────────────────

/**
 * Split rounds into upcoming (today or later, soonest first) and past
 * (yesterday or earlier, most recent first). Cancelled rounds are
 * dropped from both.
 *
 * A round whose date can't be parsed is treated as UPCOMING. That's the
 * safe direction: a malformed date should leave the round visible and
 * fixable rather than quietly filing it under history where nobody
 * looks.
 */
export function splitFunRounds(rounds, fallbackYear, today = new Date()) {
  const upcoming = [];
  const past = [];
  for (const r of rounds || []) {
    if (!r || r.cancelled === true) continue;
    const year = r.season || fallbackYear;
    const cmp = compareScheduleDateToToday(r.date, year, today);
    (cmp === null || cmp >= 0 ? upcoming : past).push(r);
  }
  const at = (r) => parseScheduleDate(r.date, r.season || fallbackYear);
  // Unparseable dates sort last within their bucket, and ties fall back
  // to createdAt so two rounds on the same day keep a stable order.
  const cmpBy = (dir) => (a, b) => {
    const da = at(a);
    const dbb = at(b);
    if (da && dbb && da.getTime() !== dbb.getTime()) return dir * (da.getTime() - dbb.getTime());
    if (!da && dbb) return 1;
    if (da && !dbb) return -1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  };
  upcoming.sort(cmpBy(1));
  past.sort(cmpBy(-1));
  return { upcoming, past };
}

// ── Form helpers ──────────────────────────────────────────────────
//
// <input type="date"> speaks ISO ("2026-09-01"); storage speaks the
// app's canonical "Sep 1". These two convert between them, keeping the
// parsing in one place rather than inline in the form.

export function isoToScheduleDate(iso) {
  const parts = String(iso || "").split("-").map(n => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(n => !Number.isInteger(n))) return "";
  const [y, m, d] = parts;
  if (m < 1 || m > 12 || d < 1 || d > 31) return "";
  return formatScheduleDate(new Date(y, m - 1, d));
}

export function scheduleDateToIso(dateStr, year) {
  const dt = parseScheduleDate(dateStr, year);
  if (!dt) return "";
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/**
 * Coerce a typed tee time to the exact shape theme.formatTeeTime parses:
 * "4:28 PM". That function does `split(' ')` and `split(':')` with no
 * validation, so "4:28pm" — which a human will absolutely type — yields
 * an undefined meridiem and a NaN minute, and every tee time on the card
 * renders as "NaN:NaN". Normalize on the way in and the display layer
 * never sees a form it can't read.
 *
 * Returns "" when the input isn't a recognizable clock time; callers
 * pair this with validateFunRound, which rejects "".
 */
export function normalizeStartTime(value) {
  const m = String(value || "").trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!m) return "";
  const h = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  if (h < 1 || h > 12 || mins > 59) return "";
  return `${h}:${m[2]} ${m[3].toUpperCase()}`;
}

/**
 * Validate a draft before saving. Returns an array of human-readable
 * problems — empty means good to save.
 */
export function validateFunRound(draft) {
  const errors = [];
  if (!draft?.date) errors.push("Pick a date.");
  const t = String(draft?.startTime || "").trim();
  if (!/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(t)) {
    errors.push('First tee time must look like "4:28 PM".');
  } else {
    const [hh, mm] = t.split(/[:\s]/);
    const h = parseInt(hh, 10);
    const m = parseInt(mm, 10);
    if (h < 1 || h > 12 || m > 59) errors.push("First tee time isn't a real clock time.");
  }
  const gs = Number(draft?.groupSize);
  if (!Number.isInteger(gs) || gs < FUN_GROUP_SIZE_MIN || gs > FUN_GROUP_SIZE_MAX) {
    errors.push(`Players per group must be ${FUN_GROUP_SIZE_MIN}–${FUN_GROUP_SIZE_MAX}.`);
  }
  const ti = Number(draft?.teeInterval);
  if (!Number.isInteger(ti) || ti < 1 || ti > 60) {
    errors.push("Minutes between groups must be 1–60.");
  }
  return errors;
}
