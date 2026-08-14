// ══════════════════════════════════════════════════════════════════
//  lib/funRounds.js — "fun" rounds: casual tee times outside the
//  official league schedule.
// ══════════════════════════════════════════════════════════════════
//
// What a fun round IS
// ───────────────────
// A date the league isn't otherwise playing, on which the commissioner
// ACTIVATES some number of tee times — often fewer than a league night
// needs — and players CLAIM a specific spot in a specific group by
// tapping it. Tee times fall out of the start time + interval. That's
// the whole feature: it's a tee-time creator, not a competition.
//
// The tee sheet is the model. There's no waitlist, no join queue, and
// no auto-assignment: a spot is either open or it has a name on it, and
// what you see is what the course will see.
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

import { formatTeeTime } from "./matches";
import { parseScheduleDate, formatScheduleDate, compareScheduleDateToToday } from "./scheduleDate";

// Foursome is the default and the overwhelmingly common case; the form
// allows 2–6 for the occasional twosome or fivesome the course permits.
export const FUN_GROUP_SIZE = 4;
export const FUN_GROUP_SIZE_MIN = 2;
export const FUN_GROUP_SIZE_MAX = 6;
export const FUN_TEE_INTERVAL = 8;

// How many tee times the commissioner activates. Some weeks the league
// only books three. The cap is a sanity bound, not a course rule.
export const FUN_GROUP_COUNT = 3;
export const FUN_GROUP_COUNT_MIN = 1;
export const FUN_GROUP_COUNT_MAX = 12;

// ── The tee sheet ─────────────────────────────────────────────────
//
// The commissioner activates N tee times of M spots each; a player
// claims ONE SPECIFIC SPOT by tapping it. So the stored shape has to
// name positions, not record arrival order.
//
// `slots` is a FLAT MAP keyed "g0_s2" (group 0, spot 2) → Player.id.
// Not a nested array, and the difference is load-bearing rather than
// stylistic:
//
//   Firestore's setDoc(..., {merge:true}) merges nested MAPS key by key
//   but replaces ARRAYS wholesale. With an array-of-arrays, two players
//   tapping open spots at the same moment would each write the entire
//   grid from their own slightly-stale copy, and the later write would
//   erase the earlier claim. The player would watch their name vanish a
//   second after tapping. With a flat map, a claim writes exactly
//   { slots: { g0_s2: "p7" } } and touches one key — concurrent claims
//   on different spots can't collide at all.
//
// A released spot is written as null rather than deleted: a merge write
// has no way to remove a key, and "null means open" costs one check on
// read. Read paths must therefore treat null and missing identically.
//
// Two people tapping the SAME open spot in the same instant is still
// last-write-wins. That's a race the UI makes hard to hit (spots
// disable the moment a claim lands via the live subscription) and the
// stakes are a casual tee time, so it isn't worth a transaction.

export function slotKey(groupIdx, spotIdx) {
  return `g${groupIdx}_s${spotIdx}`;
}

const SLOT_KEY_RE = /^g(\d+)_s(\d+)$/;

export function funGroupSize(round) {
  const n = Number(round?.groupSize);
  if (!Number.isInteger(n)) return FUN_GROUP_SIZE;
  return Math.min(FUN_GROUP_SIZE_MAX, Math.max(FUN_GROUP_SIZE_MIN, n));
}

export function funGroupCount(round) {
  const n = Number(round?.groupCount);
  if (!Number.isInteger(n)) return FUN_GROUP_COUNT;
  return Math.min(FUN_GROUP_COUNT_MAX, Math.max(FUN_GROUP_COUNT_MIN, n));
}

export function funTeeInterval(round) {
  const n = Number(round?.teeInterval);
  if (!Number.isInteger(n) || n < 1 || n > 60) return FUN_TEE_INTERVAL;
  return n;
}

function rawSlots(round) {
  const raw = round?.slots;
  return (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : null;
}

/**
 * The tee sheet as a grid: grid[groupIdx][spotIdx] = Player.id | null.
 * Always exactly groupCount × groupSize, so callers can index it
 * without bounds checks.
 *
 * Claims outside the current grid (left behind when the commissioner
 * shrinks the sheet) are ignored, and a player appearing twice keeps
 * only their first spot in reading order — neither should happen, but
 * a tee sheet that renders someone in two groups at once is worse than
 * one that quietly picks the earlier spot.
 */
export function readSlots(round) {
  const groups = funGroupCount(round);
  const size = funGroupSize(round);
  const grid = Array.from({ length: groups }, () => Array.from({ length: size }, () => null));
  const raw = rawSlots(round);
  const seen = new Set();
  let placed = 0;

  if (raw) {
    for (let g = 0; g < groups; g++) {
      for (let s = 0; s < size; s++) {
        const pid = raw[slotKey(g, s)];
        if (typeof pid !== "string" || !pid || seen.has(pid)) continue;
        seen.add(pid);
        grid[g][s] = pid;
        placed++;
      }
    }
  }

  // Compatibility with the first cut of this feature, which stored an
  // ordered `signups` array and derived groups from it. Read-only, and
  // only when there is no slot data to prefer — the first claim written
  // against such a round migrates it. Safe to delete once no round in
  // Firestore carries a `signups` field.
  if (placed === 0 && Array.isArray(round?.signups)) {
    let i = 0;
    for (const pid of round.signups) {
      if (typeof pid !== "string" || !pid || seen.has(pid)) continue;
      const g = Math.floor(i / size);
      if (g >= groups) break;
      seen.add(pid);
      grid[g][i % size] = pid;
      i++;
    }
  }

  return grid;
}

/**
 * The tee sheet as the UI renders it: one entry per activated tee time,
 * each with its clock time and its spots.
 *
 * Unlike the previous signup-order model this ALWAYS returns groupCount
 * entries, including entirely empty ones — an activated tee time with
 * nobody in it is the whole point of the screen.
 *
 * @returns {{ idx: number, teeTime: string, spots: (string|null)[] }[]}
 */
export function buildFunGroups(round) {
  const interval = funTeeInterval(round);
  return readSlots(round).map((spots, idx) => ({
    idx,
    teeTime: formatTeeTime(round?.startTime, idx, interval),
    spots,
  }));
}

/** Where is this player sitting? `null` when they haven't claimed a spot. */
export function findPlayerSlot(round, pid) {
  if (!pid) return null;
  const grid = readSlots(round);
  for (let g = 0; g < grid.length; g++) {
    for (let s = 0; s < grid[g].length; s++) {
      if (grid[g][s] === pid) return { g, s };
    }
  }
  return null;
}

export function isSignedUp(round, pid) {
  return findPlayerSlot(round, pid) !== null;
}

/** { filled, total } across the whole sheet — drives the header count. */
export function funRoundCounts(round) {
  const grid = readSlots(round);
  let filled = 0;
  for (const row of grid) for (const pid of row) if (pid) filled++;
  return { filled, total: grid.length * (grid[0]?.length || 0) };
}

// ── Write patches ─────────────────────────────────────────────────
//
// Each returns a partial DOC to merge — `{ slots, guests? }` — or null
// when the action isn't legal. Pure; the caller decides whether to
// persist. They all share one shape so a caller can persist any of them
// the same way and can't accidentally pass a bare slots map where a
// compound one was meant.

/**
 * Claim (g, s) for a player. Returns null if the spot is taken by
 * someone else or the coordinates are off the sheet.
 *
 * Claiming while already seated MOVES the player: the patch releases
 * their old spot in the same write. One player can't hold two spots on
 * one tee sheet, and doing it in a single merge means there's no
 * instant where they hold both or neither.
 */
export function claimSlotPatch(round, pid, g, s) {
  if (!pid) return null;
  const grid = readSlots(round);
  if (!grid[g] || g < 0 || s < 0 || s >= grid[g].length) return null;
  const occupant = grid[g][s];
  if (occupant && occupant !== pid) return null;
  const slots = { [slotKey(g, s)]: pid };
  const prior = findPlayerSlot(round, pid);
  if (prior && !(prior.g === g && prior.s === s)) slots[slotKey(prior.g, prior.s)] = null;
  return { slots };
}

/**
 * Commissioner action: put `pid` in (g, s), whoever is there now.
 *
 * One function covers assign, move and swap, because they're the same
 * operation seen from different starting states:
 *
 *   player off the sheet  → empty spot  = assign
 *   player off the sheet  → taken spot  = replace (the occupant comes off)
 *   player on the sheet   → empty spot  = move
 *   player on the sheet   → taken spot  = SWAP (they trade places)
 *
 * The swap case is why the occupant goes into the mover's old spot
 * rather than being dropped: "Dan and Ed are in the wrong groups" is one
 * tap, not a clear-and-two-assigns that leaves the sheet briefly wrong.
 *
 * Still a single merge patch, so no intermediate state is ever visible
 * to anyone else watching the sheet.
 */
export function assignSlotPatch(round, pid, g, s) {
  if (!pid) return null;
  const grid = readSlots(round);
  if (!grid[g] || g < 0 || s < 0 || s >= grid[g].length) return null;
  const occupant = grid[g][s];
  if (occupant === pid) return null;   // already sitting there — nothing to do
  const from = findPlayerSlot(round, pid);
  const slots = { [slotKey(g, s)]: pid };
  // When the mover came from elsewhere, their old spot receives whoever
  // they displaced — or null if the target was empty.
  if (from) slots[slotKey(from.g, from.s)] = occupant;
  const patch = { slots };
  // A guest who is REPLACED leaves the sheet entirely, so their record
  // goes too. A guest who is SWAPPED just moves — `from` is set, they
  // land in the mover's old spot, and their record must survive.
  if (isGuestId(occupant) && !from) patch.guests = { [occupant]: null };
  return patch;
}

// ── Guests ────────────────────────────────────────────────────────
//
// Fun rounds are not members-only: someone brings a friend. A guest
// occupies a spot exactly like a member does, so `slots` still holds a
// plain id string — the difference is the id carries a `guest_` prefix
// and their details live in a `guests` map on the round:
//
//   guests: { guest_ab12: { name, hcp, invitedBy, addedAt } }
//
// Keeping the slot value a string is what makes this cheap: readSlots,
// claimSlotPatch, assignSlotPatch and the whole tee-sheet grid are
// unchanged and never learn that guests exist. Only NAME and HANDICAP
// lookups have to know, and those go through rosterFor below, which
// hands the rest of the app a list of player-shaped objects.
//
// A guest is deliberately not a league_players row. They have no
// season, no team, no handicap history, and creating one would put a
// stranger into the roster that drives standings and handicaps — the
// exact boundary this whole feature is built to respect.

export const GUEST_PREFIX = "guest_";

export function isGuestId(id) {
  return typeof id === "string" && id.startsWith(GUEST_PREFIX);
}

export function newGuestId() {
  return `${GUEST_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** The round's guest map, normalized. Cleared entries read as absent. */
export function readGuests(round) {
  const raw = round?.guests;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!isGuestId(id) || !v || typeof v !== "object") continue;
    const name = typeof v.name === "string" ? v.name.trim() : "";
    if (!name) continue;
    const hcp = Number(v.hcp);
    out[id] = {
      name,
      hcp: Number.isFinite(hcp) ? Math.round(hcp) : 0,
      invitedBy: typeof v.invitedBy === "string" ? v.invitedBy : null,
      addedAt: Number(v.addedAt) || 0,
    };
  }
  return out;
}

/**
 * Everyone who can appear on this round's sheet: the league's players
 * plus the round's guests, shaped alike so name and handicap lookups
 * don't branch. Guests carry `isGuest` for the UI to mark them, and
 * `invitedBy` so the member who brought them can take them back out.
 */
export function rosterFor(round, players) {
  const guests = readGuests(round);
  const asPlayers = Object.entries(guests).map(([id, g]) => ({
    id,
    name: g.name,
    handicapIndex: g.hcp,
    isGuest: true,
    invitedBy: g.invitedBy,
  }));
  return [...(players || []), ...asPlayers];
}

/** Who may take a guest back off the sheet: whoever brought them. */
export function canRemoveGuest(round, id, pid) {
  if (!isGuestId(id) || !pid) return false;
  const g = readGuests(round)[id];
  return !!g && g.invitedBy === pid;
}

/**
 * Seat a guest in ONE SPECIFIC spot. Returns the full doc patch — both
 * maps in ONE write, so a guest can never exist without a seat or hold
 * a seat without a name.
 *
 * The coordinates are explicit because the member picks the spot: the
 * guest goes exactly where the tapped "Open" was, the same as claiming
 * for yourself. Returns null for a nameless guest, coordinates off the
 * sheet, or a spot somebody took first — which the caller shows as
 * "that spot was just taken".
 */
export function addGuestPatch(round, groupIdx, spotIdx, guest, id = newGuestId()) {
  const name = String(guest?.name || "").trim();
  if (!name) return null;
  const grid = readSlots(round);
  const row = grid[groupIdx];
  if (!row || spotIdx < 0 || spotIdx >= row.length) return null;
  if (row[spotIdx]) return null;
  const hcp = Number(guest?.hcp);
  return {
    slots: { [slotKey(groupIdx, spotIdx)]: id },
    guests: {
      [id]: {
        name,
        hcp: Number.isFinite(hcp) ? Math.round(hcp) : 0,
        invitedBy: guest?.invitedBy || null,
        addedAt: guest?.addedAt || 0,
      },
    },
  };
}

/**
 * Correct a guest's name or handicap. A name is typed on a phone, on a
 * tee, by someone in a hurry — it will be wrong sometimes, and the
 * person it's wrong about isn't in the league to fix it themselves.
 *
 * Writes only the two editable fields. The merge preserves invitedBy
 * and addedAt, so correcting a typo can't quietly transfer ownership of
 * a guest to whoever happened to fix it.
 */
export function updateGuestPatch(round, id, fields) {
  if (!isGuestId(id)) return null;
  if (!readGuests(round)[id]) return null;
  const name = String(fields?.name || "").trim();
  if (!name) return null;
  const hcp = Number(fields?.hcp);
  return { guests: { [id]: { name, hcp: Number.isFinite(hcp) ? Math.round(hcp) : 0 } } };
}

/**
 * Free a spot. Returns the full doc patch, or null when it's already
 * open.
 *
 * When the occupant is a guest their entry is dropped in the same
 * write. They exist only to fill that seat, so leaving the record
 * behind would grow the doc with every friend anyone ever brought.
 */
export function releaseSlotPatch(round, g, s) {
  const grid = readSlots(round);
  const occupant = grid[g]?.[s];
  if (!occupant) return null;
  const patch = { slots: { [slotKey(g, s)]: null } };
  if (isGuestId(occupant)) patch.guests = { [occupant]: null };
  return patch;
}

/**
 * Nulls for every claim that a resize would strand — call it when the
 * commissioner shrinks the sheet.
 *
 * Without this, dropping from 4 tee times to 3 and back to 4 would
 * resurrect the 4th group's original claims, seating people at a tee
 * time they were removed from and never re-confirmed. Junk keys are
 * cleared too, so a hand-edited doc can't keep haunting the round.
 */
export function pruneSlotsPatch(round, nextGroupCount, nextGroupSize) {
  const raw = rawSlots(round);
  if (!raw) return {};
  const patch = {};
  for (const key of Object.keys(raw)) {
    if (raw[key] === null || raw[key] === undefined) continue;
    const m = SLOT_KEY_RE.exec(key);
    if (!m) { patch[key] = null; continue; }
    if (Number(m[1]) >= nextGroupCount || Number(m[2]) >= nextGroupSize) patch[key] = null;
  }
  return patch;
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

/** Is this round being played today? */
export function isFunRoundToday(round, fallbackYear, today = new Date()) {
  return compareScheduleDateToToday(round?.date, round?.season || fallbackYear, today) === 0;
}

/**
 * The group a player should be scoring — the reason a full foursome
 * "just shows up" in its players' Scoring tab with no button to press.
 *
 * A group qualifies only when it is FULL. A half-empty group is still
 * being filled; putting a scorecard in front of someone before their
 * playing partners exist would be jumping the gun, and the tee sheet is
 * what they need to look at instead.
 *
 * Order of preference:
 *   1. the soonest round still to be played (today counts)
 *   2. failing that, the most recent PAST round where this player's card
 *      is unfinished — a group that finished at dusk and posts the next
 *      morning still needs somewhere to do it, and with no Score button
 *      this is the only way back in. Bounded by "unfinished" so a
 *      completed round stops resurfacing once it's done.
 *
 * @returns {{ round: object, groupIdx: number, pids: string[] } | null}
 */
export function findMyFullGroup(funRounds, pid, fallbackYear, isCardComplete, today = new Date()) {
  if (!pid) return null;
  const { upcoming, past } = splitFunRounds(funRounds, fallbackYear, today);

  const groupIn = (round) => {
    const groups = buildFunGroups(round);
    for (const g of groups) {
      if (g.spots.includes(pid) && g.spots.every(Boolean)) {
        return { round, groupIdx: g.idx, pids: g.spots };
      }
    }
    return null;
  };

  for (const r of upcoming) {
    const hit = groupIn(r);
    if (hit) return hit;
  }
  for (const r of past) {
    const hit = groupIn(r);
    if (hit && typeof isCardComplete === "function" && !isCardComplete(r, pid)) return hit;
  }
  return null;
}

/**
 * Is there a fun round still to be played? This is the gate every tab
 * uses to decide whether to DEFAULT to the Fun view, and it is
 * deliberately about upcoming rounds rather than "any round exists" —
 * a round from three months ago must not hijack a tab forever.
 */
export function hasUpcomingFunRound(funRounds, fallbackYear, today = new Date()) {
  return splitFunRounds(funRounds, fallbackYear, today).upcoming.length > 0;
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
  const gc = Number(draft?.groupCount);
  if (!Number.isInteger(gc) || gc < FUN_GROUP_COUNT_MIN || gc > FUN_GROUP_COUNT_MAX) {
    errors.push(`Tee times must be ${FUN_GROUP_COUNT_MIN}–${FUN_GROUP_COUNT_MAX}.`);
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
