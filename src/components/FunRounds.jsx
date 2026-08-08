// ══════════════════════════════════════════════════════════════════
//  FunRounds — the "FUN" view. Casual tee times outside the official
//  league schedule.
// ══════════════════════════════════════════════════════════════════
//
// Rendered in two places, identically:
//   • Standings → FUN         (third tab beside Regular Season / Postseason)
//   • Schedule  → Fun         (third filter beside My Schedule / Full League)
//
// One component, two mount points, so the two never drift the way two
// copies of the same list always eventually do.
//
// Roles
// ─────
//   • Commissioner creates a round and activates N tee times, can edit
//     or delete it, and runs the tee sheet: tapping ANY spot opens the
//     manager, where they assign a player, swap two players, or clear a
//     spot.
//   • Any linked player claims an open spot, gives up their own, or
//     moves between groups.
//
// Scoring has no button. Once a foursome fills, it appears on those
// players' Scoring tab as their card — the same way a league match
// does — which is what `autoOpenMyGroup` switches on. Standings and
// Schedule stay a tee sheet: read it, claim a spot.
//
// The logic lives in two libs, where the tests are: lib/funRounds.js
// owns the tee sheet (slots, claims, tee times, ordering) and
// lib/funScores.js owns the cards (net to par, leaderboard). This file
// is presentation plus the write calls.
//
// Scoring here is REAL — nine holes, stroke dots, net leaderboard — and
// still touches no league math. Cards go to league_fun_scores keyed by
// round, never to league_hole_scores, so no handicap, standings, or
// stats path can read them. Both lib headers spell out why that
// isolation is structural rather than a filter someone has to remember.

import { useState, useEffect, useMemo, useRef } from "react";
import { K, Pill, EmptyState, SubLabel, lastNamesOnly, LIST_GAP, CARD_RADIUS, FS, FW } from "../theme";
import { Popup, ConfirmModal } from "./Popup";
import {
  splitFunRounds,
  buildFunGroups,
  readSlots,
  findPlayerSlot,
  funRoundCounts,
  claimSlotPatch,
  assignSlotPatch,
  releaseSlotPatch,
  pruneSlotsPatch,
  findMyFullGroup,
  validateFunRound,
  normalizeStartTime,
  isoToScheduleDate,
  scheduleDateToIso,
  funGroupSize,
  funGroupCount,
  funTeeInterval,
  FUN_GROUP_SIZE,
  FUN_GROUP_COUNT,
  FUN_TEE_INTERVAL,
} from "../lib/funRounds";
import {
  funRoundSide,
  funHolePatch,
  funRoundIr,
  readFunCard,
  indexFunScores,
  buildFunLeaderboard,
  roundHasScores,
  funScoreId,
  funSpotSummary,
  isCardComplete,
  readFunCard as _readFunCard,
} from "../lib/funScores";
import { FunLeaderboard } from "./FunScorecard";
import { GroupScoring } from "./GroupScoring";

const inputStyle = {
  width: "100%", padding: 10, borderRadius: 8,
  background: K.inp, border: `1px solid ${K.bdr}`,
  color: K.t1, fontSize: FS.base, boxSizing: "border-box",
};

const fieldLabel = { fontSize: FS.xs, color: K.t3, marginBottom: 4 };

// ── The create / edit form ────────────────────────────────────────
//
// Local draft state, committed on Save. The date field is an ISO
// <input type="date"> on screen and the app's canonical "Sep 1" string
// in storage; funRounds.js owns both conversions.
function FunRoundForm({ round, season, defaults, onSave, onCancel, saving }) {
  const editing = !!round;
  const [draft, setDraft] = useState(() => ({
    title: round?.title || "",
    dateIso: round ? scheduleDateToIso(round.date, round.season || season) : "",
    startTime: round?.startTime || defaults.startTime,
    teeInterval: round ? funTeeInterval(round) : defaults.teeInterval,
    groupCount: round ? funGroupCount(round) : FUN_GROUP_COUNT,
    groupSize: round ? funGroupSize(round) : FUN_GROUP_SIZE,
    side: round?.side || "front",
    notes: round?.notes || "",
  }));
  const [errors, setErrors] = useState([]);

  const set = (patch) => setDraft(prev => ({ ...prev, ...patch }));

  const submit = () => {
    const date = isoToScheduleDate(draft.dateIso);
    const candidate = {
      title: draft.title.trim(),
      date,
      // Normalize before validating: "4:28pm" is a legitimate thing to
      // type and becomes "4:28 PM", while genuine junk becomes "" and
      // the validator below rejects it.
      startTime: normalizeStartTime(draft.startTime),
      teeInterval: Number(draft.teeInterval),
      groupCount: Number(draft.groupCount),
      groupSize: Number(draft.groupSize),
      side: draft.side,
      notes: draft.notes.trim(),
    };
    const problems = validateFunRound(candidate);
    setErrors(problems);
    if (problems.length) return;
    onSave(candidate);
  };

  return (
    <Popup onClose={onCancel} maxWidth={420} padding={20} showClose>
      <div style={{ fontSize: FS.xs, fontWeight: FW.bold, color: K.teal, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 }}>
        {editing ? "Edit Tee Time" : "New Fun Tee Time"}
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={fieldLabel}>Name (optional)</div>
        <input
          value={draft.title}
          onChange={e => set({ title: e.target.value })}
          placeholder="Labor Day Scramble"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={fieldLabel}>Date</div>
        <input type="date" value={draft.dateIso} onChange={e => set({ dateIso: e.target.value })} style={inputStyle} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={fieldLabel}>First Tee Time</div>
          <input value={draft.startTime} onChange={e => set({ startTime: e.target.value })} placeholder="4:28 PM" style={inputStyle} />
        </div>
        <div style={{ width: 96 }}>
          <div style={fieldLabel}>Min Apart</div>
          <input
            type="number" min="1" max="60"
            value={draft.teeInterval}
            onChange={e => set({ teeInterval: parseInt(e.target.value, 10) || "" })}
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={fieldLabel}>Tee Times</div>
          <input
            type="number" min="1" max="12"
            value={draft.groupCount}
            onChange={e => set({ groupCount: parseInt(e.target.value, 10) || "" })}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={fieldLabel}>Spots Each</div>
          <input
            type="number" min="2" max="6"
            value={draft.groupSize}
            onChange={e => set({ groupSize: parseInt(e.target.value, 10) || "" })}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Shrinking the sheet drops people. Say so before they tap Save,
          not after — the write is one tap away and there's no undo. */}
      {editing && (Number(draft.groupCount) < funGroupCount(round) || Number(draft.groupSize) < funGroupSize(round)) && (
        <div style={{
          marginBottom: 10, padding: "8px 10px", borderRadius: 8,
          background: K.warn + "12", border: `1px solid ${K.warn}40`,
          color: K.warn, fontSize: FS.xs, lineHeight: 1.5,
        }}>
          Shrinking the sheet removes anyone in the spots you're cutting.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={fieldLabel}>Nine</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[{ id: "front", label: "Front 9" }, { id: "back", label: "Back 9" }].map(opt => {
              const active = draft.side === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => set({ side: opt.id })}
                  style={{
                    flex: 1, padding: "10px 8px", borderRadius: 8,
                    background: active ? K.teal : K.inp,
                    border: `1px solid ${active ? K.teal : K.bdr}`,
                    color: active ? K.bg : K.t2,
                    fontSize: FS.sm, fontWeight: FW.bold, cursor: "pointer",
                  }}
                >{opt.label}</button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={fieldLabel}>Notes (optional)</div>
        <input
          value={draft.notes}
          onChange={e => set({ notes: e.target.value })}
          placeholder="Bring cash for skins"
          style={inputStyle}
        />
      </div>

      {errors.length > 0 && (
        <div style={{
          marginBottom: 12, padding: "8px 10px", borderRadius: 8,
          background: K.red + "12", border: `1px solid ${K.red}40`,
          color: K.red, fontSize: FS.xs, lineHeight: 1.6,
        }}>
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onCancel}
          style={{ padding: "12px 16px", borderRadius: 10, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: FS.base, fontWeight: FW.bold, cursor: "pointer" }}
        >Cancel</button>
        <button
          onClick={submit}
          disabled={saving}
          style={{
            flex: 1, padding: 12, borderRadius: 10,
            background: K.teal, border: "none", color: K.bg,
            fontSize: FS.base, fontWeight: FW.bold,
            cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
          }}
        >{saving ? "Saving..." : editing ? "Save Changes" : "Create Tee Time"}</button>
      </div>
    </Popup>
  );
}

// ── One spot on the tee sheet ─────────────────────────────────────
//
// Four states, and the tap target differs in each:
//   • open, and you can take it     → dashed "Open", tap to claim
//   • open, but you can't           → dashed and inert (past round, or
//                                      a viewer with no linked player)
//   • yours                         → teal, tap to give it up
//   • someone else's                → plain name, inert
//
// A COMMISSIONER overrides all of that: every spot on a live round opens
// the spot manager instead, since assigning, swapping and clearing are
// all things they may want to do to any spot, occupied or not. They
// reach their own claim through the same picker — one extra tap, in
// exchange for one predictable behavior rather than "sometimes it
// claims, sometimes it manages."
//
// `mine` is styling and `canRelease` is permission, and they are
// separate on purpose: on a PAST round your spot still reads as yours
// (teal, "You're In") but nothing on the sheet is tappable any more.
function Spot({ pid, name, mine, canClaim, canRelease, canManage, busy, onClaim, onRelease, onManage }) {
  const interactive = canManage || (!pid && canClaim) || (pid && mine && canRelease);
  const label = pid ? name : "Open";

  const base = {
    flex: "1 1 0", minWidth: 62, padding: "7px 6px", borderRadius: 7,
    fontSize: FS.xs, fontWeight: FW.bold, textAlign: "center",
    overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
    transition: "background .15s, border-color .15s",
  };

  const style = pid
    ? {
        ...base,
        background: mine ? K.teal + "1c" : K.inp,
        border: `1px solid ${mine ? K.teal + "70" : K.bdr}`,
        color: mine ? K.teal : K.t2,
      }
    : {
        ...base,
        background: "transparent",
        border: `1px dashed ${canClaim ? K.teal + "70" : K.bdr}`,
        color: canClaim ? K.teal : K.t3,
      };

  if (!interactive) return <div style={style}>{label}</div>;

  const ariaLabel = canManage
    ? `${label} — tap to manage spot`
    : pid ? `${label} — tap to give up` : "Open spot — tap to claim";

  return (
    <button
      onClick={canManage ? onManage : (pid ? onRelease : onClaim)}
      disabled={busy}
      aria-label={ariaLabel}
      style={{ ...style, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
    >{label}</button>
  );
}

// ── Commissioner spot manager ─────────────────────────────────────
//
// One popup covering assign, swap and remove, because from the
// commissioner's side they're the same question: "who should be in this
// spot?" Picking someone already on the sheet swaps the two; picking
// someone who isn't seats them (bumping the current occupant off);
// Clear empties it.
//
// Players stay listed even when they're already seated — that IS the
// swap affordance, so hiding them would remove the feature.
export function SpotManager({ round, g, s, players, grid, onAssign, onClear, onClose }) {
  const occupant = grid?.[g]?.[s] || null;
  const teeTime = buildFunGroups(round)[g]?.teeTime || "";

  // Where each player currently sits, so the list can say so rather than
  // making the commissioner cross-reference the sheet behind the popup.
  const seatOf = useMemo(() => {
    const m = {};
    (grid || []).forEach((row, gi) => row.forEach(pid => { if (pid) m[pid] = gi; }));
    return m;
  }, [grid]);

  const sorted = useMemo(
    () => [...(players || [])].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [players]
  );

  return (
    <Popup onClose={onClose} maxWidth={380} padding={16} showClose>
      <div style={{ fontSize: FS.xs, fontWeight: FW.bold, color: K.teal, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
        {teeTime} · Spot {s + 1}
      </div>
      <div style={{ fontSize: FS.xs, color: K.t3, marginBottom: 12 }}>
        {occupant
          ? "Pick someone else to swap or replace them."
          : "Pick a player for this spot."}
      </div>

      {occupant && (
        <button
          onClick={onClear}
          style={{
            width: "100%", padding: "10px 12px", borderRadius: 8, marginBottom: 12,
            background: "transparent", border: `1px solid ${K.red}40`, color: K.red,
            fontSize: FS.sm, fontWeight: FW.bold, cursor: "pointer",
          }}
        >Clear this spot</button>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {sorted.map(p => {
          const here = p.id === occupant;
          const seated = seatOf[p.id];
          return (
            <button
              key={p.id}
              onClick={() => { if (!here) onAssign(p.id); }}
              disabled={here}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "9px 10px", borderRadius: 8, textAlign: "left",
                background: here ? K.teal + "14" : K.inp,
                border: `1px solid ${here ? K.teal + "60" : K.bdr}`,
                color: here ? K.teal : K.t1,
                fontSize: FS.sm, fontWeight: FW.semibold,
                cursor: here ? "default" : "pointer",
              }}
            >
              <span style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p.name}</span>
              {here ? (
                <span style={{ fontSize: FS.micro, color: K.teal }}>here now</span>
              ) : seated !== undefined ? (
                // Tapping this one is a swap, and it should say so before
                // the tap rather than surprise you after it.
                <span style={{ fontSize: FS.micro, color: K.act }}>swap · group {seated + 1}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </Popup>
  );
}

// ── One round's card ──────────────────────────────────────────────
function FunRoundCard({
  round, players, myPid, isComm, isPast, course, funScoreIndex,
  onClaim, onRelease, onManage, onEdit, onDelete, busy,
}) {
  const groups = useMemo(() => buildFunGroups(round), [round]);
  const { filled, total } = funRoundCounts(round);
  const mySlot = findPlayerSlot(round, myPid);
  const { pars, hcps } = funRoundSide(round, course);

  const grid = useMemo(() => groups.map(g => g.spots), [groups]);
  const hasScores = roundHasScores({ grid, index: funScoreIndex, roundId: round.id });
  const board = useMemo(
    () => buildFunLeaderboard({ grid, index: funScoreIndex, roundId: round.id, players, pars, hcps }),
    [grid, funScoreIndex, round.id, players, pars, hcps]
  );

  const nameFor = (pid) => {
    const p = players.find(x => x.id === pid);
    return p ? lastNamesOnly(p.name) : "Unknown";
  };

  return (
    <div style={{
      background: K.card, borderRadius: CARD_RADIUS,
      border: `1px solid ${mySlot && !isPast ? K.teal + "60" : K.bdr}`,
      overflow: "hidden", opacity: isPast ? 0.72 : 1,
    }}>
      {/* Header — date, name, nine */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${K.bdr}` }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: FS.base, fontWeight: FW.bold, color: K.t1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            {round.date || "No date"}
            {round.title ? <span style={{ color: K.t2, fontWeight: FW.semibold }}> · {round.title}</span> : null}
          </div>
          <div style={{ fontSize: FS.xs, color: K.t3, marginTop: 2 }}>
            {groups.length} {groups.length === 1 ? "tee time" : "tee times"} · {filled} of {total} spots filled
          </div>
        </div>
        <Pill color={K.logoBright} style={{ fontSize: FS.micro }}>{round.side === "back" ? "Back 9" : "Front 9"}</Pill>
        {mySlot && !isPast && <Pill color={K.teal} style={{ fontSize: FS.micro }}>You're In</Pill>}
      </div>

      {/* Tee sheet — one row per activated tee time, always shown even
          when empty. An activated-but-empty tee time is information:
          it's the spot somebody can still take. */}
      <div style={{ padding: "8px 14px" }}>
        {groups.map(g => {
          const seated = g.spots.filter(Boolean);
          return (
            <div key={g.idx} style={{ padding: "5px 0" }}>
              {/* Tee time and Score share a line; the spots get the full
                  width below them.
                  This used to be one row — time, four spots, Score. Each
                  spot carries a min-width so a name stays readable, so
                  four of them plus the time and the button needed about
                  406px of row. A phone card is nearer 300px, and the
                  card's overflow:hidden clipped the Score button out of
                  existence behind the last spot. Giving the spots their
                  own full-width line fits a foursome comfortably, and
                  they wrap rather than overflow if the screen is
                  narrower still or the group is a fivesome. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: FS.sm, fontWeight: FW.bold, color: K.act }}>{g.teeTime}</div>
                <div style={{ flex: 1, minWidth: 0 }} />
                {/* A full group needs no Score button: it turns up in its
                    players' Scoring tab on its own. The pill just says so,
                    so a group that has filled up knows where to go. */}
                {g.spots.every(Boolean) && (
                  <Pill color={K.act} style={{ fontSize: FS.micro, flexShrink: 0 }}>Full</Pill>
                )}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {g.spots.map((pid, s) => (
                    <Spot
                      key={s}
                      pid={pid}
                      name={pid ? nameFor(pid) : ""}
                      mine={!!pid && pid === myPid}
                      canClaim={!isPast && !!myPid}
                      canRelease={!isPast}
                      canManage={isComm && !isPast}
                      busy={busy}
                      onClaim={() => onClaim(round, g.idx, s)}
                      onRelease={() => onRelease(round, g.idx, s, pid)}
                      onManage={() => onManage(round, g.idx, s)}
                    />
                  ))}
              </div>
              {/* Per-player score line, only for players who've posted.
                  Sits under the group so the tee sheet above stays a
                  tee sheet and doesn't turn into a scoreboard. */}
              {seated.some(pid => funSpotSummary(funScoreIndex, round.id, pid, pars, hcps, players.find(p => p.id === pid))) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0 2px 2px" }}>
                  {seated.map(pid => {
                    const summary = funSpotSummary(funScoreIndex, round.id, pid, pars, hcps, players.find(p => p.id === pid));
                    if (!summary) return null;
                    return (
                      <span key={pid} style={{ fontSize: FS.micro, color: K.t3 }}>
                        {nameFor(pid)} <strong style={{ color: pid === myPid ? K.teal : K.t2 }}>{summary}</strong>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {round.notes && (
          <div style={{ fontSize: FS.xs, color: K.t3, marginTop: 8, lineHeight: 1.5 }}>{round.notes}</div>
        )}
        {!isPast && !myPid && (
          <div style={{ fontSize: FS.xs, color: K.t3, marginTop: 8, lineHeight: 1.5 }}>
            Link your player in Admin to claim a spot.
          </div>
        )}

        {/* Round leaderboard — appears the moment anyone posts a hole,
            and only then. An all-zero board on an unplayed round would
            be noise on every upcoming card. */}
        {hasScores && (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${K.bdr}` }}>
            <div style={{ fontSize: FS.micro, fontWeight: FW.bold, color: K.teal, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>
              Leaderboard · Net
            </div>
            <FunLeaderboard rows={board} myPid={myPid} />
          </div>
        )}
      </div>

      {/* Commissioner actions. A past round is read-only — nothing left
          to claim and nothing worth editing — but it can still be
          deleted to tidy the list. */}
      {isComm && (
        <div style={{ display: "flex", gap: 6, padding: "0 14px 12px" }}>
          {!isPast && (
            <button
              onClick={() => onEdit(round)}
              style={{ flex: 1, padding: "9px 12px", borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: FS.sm, fontWeight: FW.bold, cursor: "pointer" }}
            >Edit</button>
          )}
          <button
            onClick={() => onDelete(round)}
            style={{ flex: isPast ? 1 : "0 0 auto", padding: "9px 12px", borderRadius: 8, background: "transparent", border: `1px solid ${K.red}40`, color: K.red, fontSize: FS.sm, fontWeight: FW.bold, cursor: "pointer" }}
          >Delete</button>
        </div>
      )}
    </div>
  );
}

// ── The view ──────────────────────────────────────────────────────
/**
 * @param {{
 *   funRounds: object[],
 *   players: import('../lib/types').Player[],
 *   leagueUser: import('../lib/types').LeagueUser | null,
 *   isComm: boolean,
 *   saveFunRound: (r: object) => Promise<any>,
 *   deleteFunRound: (id: string) => Promise<any>,
 *   leagueConfig: object,
 *   season: number,
 *   appToast?: (msg: string, kind?: string) => void,
 *   setPopupOpen?: (open: boolean) => void,
 * }} props
 */
export function FunRounds({
  funRounds, players, leagueUser, isComm,
  saveFunRound, deleteFunRound, leagueConfig, season,
  course, funScores, saveFunScores,
  appToast, setPopupOpen,
  // Scoring passes this. A full foursome opens straight onto its
  // scorecard there — that IS the entry point, in place of the Score
  // button this view used to carry. Standings and Schedule leave it off:
  // they're where you read the tee sheet and claim a spot.
  autoOpenMyGroup = false,
}) {
  const [formFor, setFormFor] = useState(null);   // round object | "new" | null
  const [confirmDelete, setConfirmDelete] = useState(null);
  // { round, g, s } — the spot whose commissioner manager is open.
  const [managing, setManaging] = useState(null);
  const [scoreToast, setScoreToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const myPid = leagueUser?.playerId || null;
  const year = season || leagueConfig?.year || new Date().getFullYear();

  const { upcoming, past } = useMemo(
    () => splitFunRounds(funRounds, year),
    [funRounds, year]
  );

  // Flat card lookup keyed `${roundId}_${pid}`, rebuilt when the score
  // subscription fires. Every card on the page reads from this one index
  // rather than filtering the doc list per player per round.
  const funScoreIndex = useMemo(() => indexFunScores(funScores), [funScores]);

  // ── The group this player should be scoring ───────────────────────
  //
  // There is no Score button any more: a full foursome simply turns up
  // on its players' Scoring tab. This is that lookup, and seeding the
  // state from it means the card is on screen the moment the tab opens
  // rather than after a flash of the tee sheet.
  //
  // `scoring` stays state rather than being derived, because Back has to
  // be able to put the tee sheet in front of someone who wants to see
  // the other groups — and once they've done that, re-deriving would
  // yank them straight back to their card.
  const myFullGroup = useMemo(
    () => (autoOpenMyGroup
      ? findMyFullGroup(funRounds, myPid, year,
          (r, pid) => isCardComplete(_readFunCard(funScoreIndex, r.id, pid)))
      : null),
    [autoOpenMyGroup, funRounds, myPid, year, funScoreIndex]
  );
  const [scoring, setScoring] = useState(myFullGroup);
  const leftScoring = useRef(false);
  useEffect(() => {
    // Late-arriving data (the subscription lands after mount, or the
    // fourth player claims their spot while you're looking at the sheet)
    // still opens the card — unless you've deliberately backed out of it.
    if (!leftScoring.current && myFullGroup && !scoring) setScoring(myFullGroup);
  }, [myFullGroup, scoring]);

  // Popups suppress pull-to-refresh app-side, same as every other page
  // that opens one.
  useEffect(() => {
    if (setPopupOpen) setPopupOpen(!!formFor || !!confirmDelete || !!managing || !!scoring);
  }, [formFor, confirmDelete, managing, scoring, setPopupOpen]);
  // GroupScoring wants a pid → player lookup, the same shape Scoring builds.
  const playerMap = useMemo(() => {
    const m = {};
    (players || []).forEach(p => { m[p.id] = p; });
    return m;
  }, [players]);

  const toast = (msg, kind = "info") => {
    if (typeof appToast === "function") appToast(msg, kind, 3000);
  };

  // Defaults for a new round mirror the league's own tee-sheet config,
  // so a fun round looks like a normal league night unless changed.
  const defaults = {
    startTime: leagueConfig?.startTime || "4:28 PM",
    teeInterval: Number.isInteger(leagueConfig?.teeInterval) ? leagueConfig.teeInterval : FUN_TEE_INTERVAL,
  };

  const handleSave = async (fields) => {
    const editing = formFor !== "new" ? formFor : null;
    setSaving(true);
    try {
      let doc;
      if (editing) {
        // Shrinking the sheet strands any claim outside the new bounds.
        // Null them in the SAME write as the resize, so there is never a
        // moment where the doc says "3 tee times" while spot g3_s0 still
        // holds a name that would reappear on the next expansion.
        const stranded = pruneSlotsPatch(editing, fields.groupCount, fields.groupSize);
        doc = { ...editing, ...fields };
        if (Object.keys(stranded).length) {
          doc.slots = { ...(editing.slots || {}), ...stranded };
        }
      } else {
        doc = {
          // Millisecond id + a random suffix: two commissioners creating
          // a round in the same millisecond is far-fetched, but a
          // collision would silently overwrite the other's round, so it
          // costs nothing to rule out.
          id: `fun_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          season: year,
          slots: {},
          // Player.id, not an auth uid — leagueUser carries playerId,
          // and a Player.id is what every other record in the app uses
          // to name a human.
          createdBy: myPid || null,
          createdAt: Date.now(),
          ...fields,
        };
      }
      const ok = await saveFunRound(doc);
      if (!ok) { toast("Couldn't save the tee time.", "error"); return; }
      setFormFor(null);
      toast(editing ? "Tee time updated." : "Tee time created.", "success");
    } finally {
      setSaving(false);
    }
  };

  // Claim a spot. The write is a MERGE of one or two slot keys — never
  // the whole grid — so two players claiming different spots at the same
  // moment can't overwrite each other. It also stays inside what the
  // Firestore rules let a non-commissioner touch (the `slots` field).
  const handleClaim = async (round, g, s) => {
    if (!myPid) return;
    const patch = claimSlotPatch(round, myPid, g, s);
    if (!patch) { toast("That spot was just taken.", "error"); return; }
    setBusyId(round.id);
    try {
      const ok = await saveFunRound({ id: round.id, slots: patch });
      if (!ok) toast("Couldn't claim that spot.", "error");
    } finally {
      setBusyId(null);
    }
  };

  // Give up your own spot. Commissioners never reach this — every spot
  // routes them to the manager instead.
  const handleRelease = async (round, g, s) => {
    const patch = releaseSlotPatch(round, g, s);
    if (!patch) return;
    setBusyId(round.id);
    try {
      const ok = await saveFunRound({ id: round.id, slots: patch });
      if (!ok) toast("Couldn't give up that spot.", "error");
    } finally {
      setBusyId(null);
    }
  };

  // Commissioner: seat a player, swapping if they're already on the
  // sheet. assignSlotPatch decides which of those it is; this only has
  // to persist the result and say what happened.
  const handleAssign = async (pid) => {
    const m = managing;
    if (!m) return;
    const patch = assignSlotPatch(m.round, pid, m.g, m.s);
    setManaging(null);
    if (!patch) return;
    setBusyId(m.round.id);
    try {
      const ok = await saveFunRound({ id: m.round.id, slots: patch });
      toast(
        ok ? (Object.keys(patch).length > 1 ? "Players swapped." : "Spot assigned.") : "Couldn't update the tee sheet.",
        ok ? "success" : "error"
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleManagerClear = async () => {
    const m = managing;
    setManaging(null);
    if (!m) return;
    const patch = releaseSlotPatch(m.round, m.g, m.s);
    if (!patch) return;
    const ok = await saveFunRound({ id: m.round.id, slots: patch });
    if (!ok) toast("Couldn't clear that spot.", "error");
  };

  const handleDelete = async () => {
    const round = confirmDelete;
    setConfirmDelete(null);
    if (!round) return;
    const ok = await deleteFunRound(round.id);
    toast(ok ? "Tee time deleted." : "Couldn't delete the tee time.", ok ? "success" : "error");
  };

  // Save a group's cards. One doc per player, so two people scoring
  // DIFFERENT players in the same group can't collide; two people
  // scoring the SAME player is last-write-wins, which is the same
  // bargain league scoring makes and the same one a paper card makes.
  // One hole, one tap, one merge patch — mirroring how league scoring
  // writes a single hole at a time. `holes` is a map, so this touches
  // only the hole just entered and two quick taps can't clobber each
  // other (see normalizeHoles in lib/funScores.js).
  const saveOneHole = (round, pid, hole, value) => {
    saveFunScores([{
      id: funScoreId(round.id, pid),
      roundId: round.id,
      playerId: pid,
      season: round.season || year,
      holes: funHolePatch(hole, value),
      updatedAt: Date.now(),
      updatedBy: myPid || null,
    }]).then(ok => {
      if (!ok) toast("Couldn't save that score.", "error");
    });
  };

  const cardProps = {
    players, myPid, isComm, course, funScoreIndex,
    onClaim: handleClaim,
    onRelease: handleRelease,
    onEdit: (r) => setFormFor(r),
    onDelete: (r) => setConfirmDelete(r),
    onManage: (round, g, s) => setManaging({ round, g, s }),
  };

  const nothingAtAll = upcoming.length === 0 && past.length === 0;

  // ── Scoring a group ───────────────────────────────────────────────
  //
  // Takes over the whole view rather than opening a popup, because this
  // IS the league's scoring screen — the same GroupScoring component a
  // knocked-out playoff foursome uses, with the same hole strip, the
  // same one-tap entry, the same scorecard. A fun group is exactly that
  // situation: golfers sharing a tee time with no opponent.
  //
  // What's switched off is what doesn't exist here. There's no league
  // week to be absent from, and nothing feeding a competition to sign
  // or attest for — so both features are turned off rather than shown
  // and made inert.
  //
  // The store is the whole adapter: read a hole from this round's card,
  // write a hole back to it. GroupScoring never learns that these
  // scores live somewhere other than league_hole_scores, and nothing
  // downstream of league_hole_scores learns these exist.
  if (scoring) {
    const { side, pars, hcps } = funRoundSide(scoring.round, course);
    const seated = (scoring.pids || []).filter(Boolean);
    const groups = buildFunGroups(scoring.round);
    const teeTime = groups[scoring.groupIdx]?.teeTime || "";
    const store = {
      get: (pid, h) => readFunCard(funScoreIndex, scoring.round.id, pid)[h] || 0,
      set: (pid, h, val) => saveOneHole(scoring.round, pid, h, val),
    };
    return (
      <GroupScoring
        key={`${scoring.round.id}_${scoring.groupIdx}`}
        pids={seated}
        side={side}
        pars={pars}
        hcps={hcps}
        playerMap={playerMap}
        viewerPid={myPid}
        isComm={isComm}
        onBack={() => { leftScoring.current = true; setScoring(null); }}
        toast={scoreToast}
        setToast={setScoreToast}
        scoreStore={store}
        resolveRound={(pid) => funRoundIr(readFunCard(funScoreIndex, scoring.round.id, pid))}
        allowAttendance={false}
        allowSigning={false}
        // Unused once a store is supplied, but passed so the component
        // never reads an undefined map if a future edit slips past one.
        week={0}
        holeScores={{}}
        saveScore={() => {}}
        isWeekLocked={false}
        header={
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: FS.xs, fontWeight: FW.bold, color: K.teal, letterSpacing: 1.5, textTransform: "uppercase" }}>
              Fun Round · {scoring.round.date || ""}
            </div>
            <div style={{ fontSize: FS.xs, color: K.t3, marginTop: 2 }}>
              {teeTime} · {side === "back" ? "Back 9" : "Front 9"}
              {scoring.round.title ? ` · ${scoring.round.title}` : ""}
            </div>
          </div>
        }
      />
    );
  }

  return (
    <div>
      {/* Intro + create. The one-liner is doing real work: without it
          the obvious question about any golf round in this app is
          "does this count?", and the answer needs to be visible rather
          than folklore. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, fontSize: FS.xs, color: K.t3, lineHeight: 1.5 }}>
          Extra rounds outside the league schedule. Nothing here counts toward standings, handicaps, or stats.
        </div>
        {isComm && (
          <button
            onClick={() => setFormFor("new")}
            style={{
              flexShrink: 0, padding: "8px 12px", borderRadius: 8,
              background: K.teal, border: "none", color: K.bg,
              fontSize: FS.xs, fontWeight: FW.bold, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >+ Tee Time</button>
        )}
      </div>

      {nothingAtAll && (
        <EmptyState
          icon="calendar"
          title="No fun rounds yet"
          subtitle={isComm ? "Tap + Tee Time to set one up." : "Your commissioner hasn't posted one."}
        />
      )}

      {upcoming.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
          {upcoming.map(r => (
            <FunRoundCard key={r.id} round={r} isPast={false} busy={busyId === r.id} {...cardProps} />
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div style={{ marginTop: upcoming.length > 0 ? 20 : 0 }}>
          <SubLabel color={K.t3} style={{ marginBottom: 8 }}>Past</SubLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
            {past.map(r => (
              <FunRoundCard key={r.id} round={r} isPast={true} busy={busyId === r.id} {...cardProps} />
            ))}
          </div>
        </div>
      )}

      {formFor && (
        <FunRoundForm
          // Keyed so switching which round is being edited remounts the
          // form; without it the draft state initializer wouldn't re-run
          // and the second round would open showing the first one's values.
          key={formFor === "new" ? "new" : formFor.id}
          round={formFor === "new" ? null : formFor}
          season={year}
          defaults={defaults}
          saving={saving}
          onSave={handleSave}
          onCancel={() => setFormFor(null)}
        />
      )}

      <ConfirmModal
        modal={confirmDelete ? {
          eyebrow: confirmDelete.date || "",
          title: "Delete this tee time?",
          message: `${funRoundCounts(confirmDelete).filled} player(s) have claimed a spot. This can't be undone.`,
          confirmLabel: "Delete",
          destructive: true,
          onConfirm: handleDelete,
          onCancel: () => setConfirmDelete(null),
        } : null}
      />

      {managing && (
        <SpotManager
          key={`${managing.round.id}_${managing.g}_${managing.s}`}
          round={managing.round}
          g={managing.g}
          s={managing.s}
          players={players}
          grid={readSlots(managing.round)}
          onAssign={handleAssign}
          onClear={handleManagerClear}
          onClose={() => setManaging(null)}
        />
      )}
    </div>
  );
}
