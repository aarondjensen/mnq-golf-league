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
//     moves between groups — and can bring a GUEST, since these rounds
//     aren't members-only. A guest holds a spot under a `guest_` id with
//     their name and handicap on the round doc; only the member who
//     brought them (or the commissioner) can take them back out.
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

import { useState, useEffect, useMemo } from "react";
import { K, Pill, EmptyState, SubLabel, initialLastName, LIST_GAP, CARD_RADIUS, FS, FW } from "../theme";
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
  rosterFor,
  isGuestId,
  canRemoveGuest,
  addGuestPatch,
  updateGuestPatch,
  readGuests,
  newGuestId,
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
function Spot({ pid, name, mine, isGuest, canClaim, canRelease, canEditGuest, canManage, busy, onClaim, onRelease, onEditGuest, onManage }) {
  const interactive = canManage || (!pid && canClaim) || (pid && (canRelease || canEditGuest));
  const label = pid ? name : "Open";

  // Sized so "A. JENSEN" fits without truncating. The app renders
  // uppercase with letter-spacing, so a nine-character name needs about
  // 74px of box — hence the 80px floor. On a narrow phone four of those
  // exceed the card width and the row wraps to 2×2, which reads better
  // than four ellipsised surnames.
  const base = {
    flex: "1 1 0", minWidth: 80, padding: "11px 8px", borderRadius: 8,
    fontSize: FS.xs, fontWeight: FW.bold, textAlign: "center",
    overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
    transition: "background .15s, border-color .15s",
  };

  // A guest reads differently from a member on purpose: the
  // commissioner running the sheet needs to see at a glance who on it
  // isn't in the league.
  const style = pid
    ? {
        ...base,
        background: mine ? K.teal + "1c" : isGuest ? K.act + "12" : K.inp,
        border: `1px ${isGuest ? "dashed" : "solid"} ${mine ? K.teal + "70" : isGuest ? K.act + "60" : K.bdr}`,
        color: mine ? K.teal : isGuest ? K.act : K.t2,
      }
    : {
        ...base,
        background: "transparent",
        border: `1px dashed ${canClaim ? K.teal + "70" : K.bdr}`,
        color: canClaim ? K.teal : K.t3,
      };

  if (!interactive) return <div style={style}>{label}</div>;

  const who = isGuest ? `${label} (guest)` : label;
  const ariaLabel = canManage
    ? `${who} — tap to manage spot`
    : canEditGuest ? `${who} — tap to edit or remove`
    : pid ? `${who} — tap to give up` : "Open spot — tap to fill";

  return (
    <button
      onClick={canManage ? onManage : canEditGuest ? onEditGuest : (pid ? onRelease : onClaim)}
      disabled={busy}
      aria-label={ariaLabel}
      style={{ ...style, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
    >{label}</button>
  );
}

// ── What goes in this open spot ───────────────────────────────────
//
// Tapping "Open" asks rather than assuming, because a member filling a
// spot means one of two things and the app can't tell which: they're
// playing, or they're bringing someone.
//
// If they ALREADY hold a spot in this round, taking a second one is not
// a thing a person can do — so only the guest option is offered, and
// the popup says where they're already sitting rather than leaving a
// missing button unexplained.
export function OpenSpotChooser({ teeTime, spotIdx, mySeat, onClaim, onGuest, onCancel }) {
  const btn = (primary) => ({
    width: "100%", padding: 13, borderRadius: 10, marginBottom: 8,
    background: primary ? K.teal : K.inp,
    border: primary ? "none" : `1px solid ${K.bdr}`,
    color: primary ? K.bg : K.t1,
    fontSize: FS.base, fontWeight: FW.bold, cursor: "pointer",
  });

  return (
    <Popup onClose={onCancel} maxWidth={340} padding={20} showClose>
      <div style={{ fontSize: FS.xs, fontWeight: FW.bold, color: K.teal, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
        {teeTime} · Spot {spotIdx + 1}
      </div>
      <div style={{ fontSize: FS.xs, color: K.t3, marginBottom: 14, lineHeight: 1.5 }}>
        {mySeat
          ? `You're already in this round at ${mySeat}. Fill this spot for a guest.`
          : "Who's taking this spot?"}
      </div>

      {!mySeat && (
        <button onClick={onClaim} style={btn(true)}>I'm playing</button>
      )}
      <button onClick={onGuest} style={btn(!mySeat ? false : true)}>Add a guest</button>
      <button
        onClick={onCancel}
        style={{ ...btn(false), marginBottom: 0, background: "transparent", border: "none", color: K.t3, fontSize: FS.sm }}
      >Cancel</button>
    </Popup>
  );
}

// ── Add a guest ───────────────────────────────────────────────────
//
// Fun rounds aren't members-only — someone brings a friend. Reached
// from the open-spot chooser, so the guest lands in the spot that was
// tapped. The member adding them owns them: their name and handicap are
// typed here, and only that member (or the commissioner) can take them
// back out.
//
// Handicap is optional and defaults to scratch. It exists so the net
// leaderboard can rank a guest honestly against the members they're
// playing with; getting it slightly wrong on a casual round costs
// nothing, and demanding it would be friction on the tee.
export function GuestForm({ teeTime, spotIdx, guest, onAdd, onRemove, onCancel, saving }) {
  const editing = !!guest;
  const [name, setName] = useState(guest?.name || "");
  const [hcp, setHcp] = useState(guest ? String(guest.hcp ?? "") : "");
  const [error, setError] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Give your guest a name."); return; }
    onAdd({ name: trimmed, hcp: hcp === "" ? 0 : Number(hcp) });
  };

  return (
    <Popup onClose={onCancel} maxWidth={360} padding={20} showClose>
      <div style={{ fontSize: FS.xs, fontWeight: FW.bold, color: K.teal, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
        {editing ? "Guest" : "Add a Guest"}
      </div>
      <div style={{ fontSize: FS.xs, color: K.t3, marginBottom: 12 }}>
        {teeTime} · Spot {spotIdx + 1}
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={fieldLabel}>Name</div>
        <input
          value={name}
          onChange={e => { setName(e.target.value); setError(""); }}
          placeholder="Mike Smith"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={fieldLabel}>Handicap (optional)</div>
        <input
          type="number"
          value={hcp}
          onChange={e => setHcp(e.target.value)}
          placeholder="0"
          style={inputStyle}
        />
        <div style={{ fontSize: FS.micro, color: K.t3, marginTop: 4, lineHeight: 1.5 }}>
          Used only to rank them on this round's net leaderboard. Nothing
          about a guest touches league records.
        </div>
      </div>

      {error && (
        <div style={{
          marginBottom: 12, padding: "8px 10px", borderRadius: 8,
          background: K.red + "12", border: `1px solid ${K.red}40`,
          color: K.red, fontSize: FS.xs,
        }}>{error}</div>
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
        >{saving ? "Saving..." : editing ? "Save" : "Add Guest"}</button>
      </div>

      {/* Removing is deliberately down here and quiet. Tapping a guest's
          spot used to remove them outright — a destructive one-tap on a
          small target, with no way to fix a typo. Now the tap opens this
          and removal is an explicit second choice. */}
      {editing && onRemove && (
        <button
          onClick={onRemove}
          style={{
            width: "100%", padding: "10px 12px", borderRadius: 8, marginTop: 10,
            background: "transparent", border: `1px solid ${K.red}40`, color: K.red,
            fontSize: FS.sm, fontWeight: FW.bold, cursor: "pointer",
          }}
        >Remove from this spot</button>
      )}
    </Popup>
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
export function SpotManager({ round, g, s, players, grid, onAssign, onGuest, onEditGuest, onClear, onClose }) {
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
          : "Pick a player, or add a guest."}
      </div>

      {/* An open spot can take a non-member too. Without this the
          commissioner had no route to a guest at all: every spot sends
          them here, so the league list was the only thing they could
          reach. */}
      {occupant && isGuestId(occupant) && onEditGuest && (
        <button
          onClick={onEditGuest}
          style={{
            width: "100%", padding: "10px 12px", borderRadius: 8, marginBottom: 8,
            background: "transparent", border: `1px solid ${K.teal}50`, color: K.teal,
            fontSize: FS.sm, fontWeight: FW.bold, cursor: "pointer",
          }}
        >Edit guest</button>
      )}

      {!occupant && (
        <button
          onClick={onGuest}
          style={{
            width: "100%", padding: "10px 12px", borderRadius: 8, marginBottom: 12,
            background: "transparent", border: `1px solid ${K.teal}50`, color: K.teal,
            fontSize: FS.sm, fontWeight: FW.bold, cursor: "pointer",
          }}
        >+ Add a guest</button>
      )}

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

// The commissioner's create button. It lives in the first round card's
// header, so it renders exactly once per screen — the view falls back to
// the intro row only when there are no cards to host it.
function CreateRoundButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0, padding: "6px 10px", borderRadius: 8,
        background: K.teal, border: "none", color: K.bg,
        fontSize: FS.micro, fontWeight: FW.bold, cursor: "pointer", whiteSpace: "nowrap",
      }}
    >+ Tee Time</button>
  );
}

// ── One round's card ──────────────────────────────────────────────
function FunRoundCard({
  round, players, myPid, isComm, isPast, course, funScoreIndex,
  onOpenSpot, onRelease, onEditGuest, onManage, onEdit, onDelete, onCreate, busy,
}) {
  const groups = useMemo(() => buildFunGroups(round), [round]);
  // Players plus THIS round's guests, shaped alike — so every name and
  // handicap lookup below works the same whether the spot holds a league
  // member or somebody's friend.
  const roster = useMemo(() => rosterFor(round, players), [round, players]);
  const mySlot = findPlayerSlot(round, myPid);
  const { pars, hcps } = funRoundSide(round, course);

  const grid = useMemo(() => groups.map(g => g.spots), [groups]);
  const hasScores = roundHasScores({ grid, index: funScoreIndex, roundId: round.id });
  const board = useMemo(
    () => buildFunLeaderboard({ grid, index: funScoreIndex, roundId: round.id, players: roster, pars, hcps }),
    [grid, funScoreIndex, round.id, roster, pars, hcps]
  );

  // "A. Jensen" rather than "Jensen": two players sharing a surname is
  // not hypothetical in a league this size, and the tee sheet is the one
  // screen where getting the wrong person is a real problem.
  const nameFor = (pid) => {
    const p = roster.find(x => x.id === pid);
    return p ? initialLastName(p.name) : "Unknown";
  };

  return (
    <div style={{
      background: K.card, borderRadius: CARD_RADIUS,
      border: `1px solid ${mySlot && !isPast ? K.teal + "60" : K.bdr}`,
      overflow: "hidden", opacity: isPast ? 0.72 : 1,
    }}>
      {/* Header — date, name, nine.
          The sheet below already says who's in and how full it is, one
          name per spot, so the header doesn't repeat it: no "You're In"
          pill, no "3 tee times · 5 of 12 spots filled". The teal border
          still marks a round you're playing. The space that bought goes
          to the create button, which now sits with the rounds it makes
          rather than on a line of its own. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${K.bdr}` }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: FS.base, fontWeight: FW.bold, color: K.t1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            {round.date || "No date"}
            {round.title ? <span style={{ color: K.t2, fontWeight: FW.semibold }}> · {round.title}</span> : null}
          </div>
        </div>
        <Pill color={K.logoBright} style={{ fontSize: FS.micro }}>{round.side === "back" ? "Back 9" : "Front 9"}</Pill>
        {isComm && onCreate && <CreateRoundButton onClick={onCreate} />}
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
                      isGuest={isGuestId(pid)}
                      canClaim={!isPast && !!myPid}
                      canRelease={!isPast && pid === myPid}
                      // A guest you brought opens their editor. Somebody
                      // else's guest is not yours to touch.
                      canEditGuest={!isPast && canRemoveGuest(round, pid, myPid)}
                      canManage={isComm && !isPast}
                      busy={busy}
                      onClaim={() => onOpenSpot(round, g.idx, s, g.teeTime)}
                      onRelease={() => onRelease(round, g.idx, s, pid)}
                      onEditGuest={() => onEditGuest(round, g.idx, s, pid, g.teeTime)}
                      onManage={() => onManage(round, g.idx, s)}
                    />
                  ))}
              </div>
              {/* Per-player score line, only for players who've posted.
                  Sits under the group so the tee sheet above stays a
                  tee sheet and doesn't turn into a scoreboard. */}
              {seated.some(pid => funSpotSummary(funScoreIndex, round.id, pid, pars, hcps, roster.find(p => p.id === pid))) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0 2px 2px" }}>
                  {seated.map(pid => {
                    const summary = funSpotSummary(funScoreIndex, round.id, pid, pars, hcps, roster.find(p => p.id === pid));
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
  // { round, g, s, teeTime } — the open spot whose chooser is showing.
  const [filling, setFilling] = useState(null);
  // { round, g, s, teeTime } — the spot a guest is being named for.
  const [guestFor, setGuestFor] = useState(null);
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
  // on its players' Scoring tab. This is that lookup, and it's derived
  // rather than held in state — on Scoring your card IS the view, so
  // there's nothing to enter or leave. The tee sheet is a tab away on
  // Standings and Schedule for anyone who wants to see the other groups
  // or give up their spot.
  //
  // It briefly WAS state, with a Back button that dropped you onto the
  // tee sheet. That was a trapdoor: no Score button means no way back up.
  const scoring = useMemo(
    () => (autoOpenMyGroup
      ? findMyFullGroup(funRounds, myPid, year,
          (r, pid) => isCardComplete(readFunCard(funScoreIndex, r.id, pid)))
      : null),
    [autoOpenMyGroup, funRounds, myPid, year, funScoreIndex]
  );

  // Popups suppress pull-to-refresh app-side, same as every other page
  // that opens one.
  useEffect(() => {
    if (setPopupOpen) setPopupOpen(!!formFor || !!confirmDelete || !!managing || !!scoring || !!guestFor || !!filling);
  }, [formFor, confirmDelete, managing, scoring, guestFor, filling, setPopupOpen]);
  // GroupScoring wants a pid → player lookup, the same shape Scoring
  // builds — but keyed off the ROUND's roster, so a guest in the group
  // resolves to their name and handicap instead of rendering as "?".
  const playerMap = useMemo(() => {
    const m = {};
    rosterFor(scoring?.round, players).forEach(p => { m[p.id] = p; });
    return m;
  }, [scoring, players]);

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
    setFilling(null);
    if (!myPid) return;
    const patch = claimSlotPatch(round, myPid, g, s);
    if (!patch) { toast("That spot was just taken.", "error"); return; }
    setBusyId(round.id);
    try {
      const ok = await saveFunRound({ id: round.id, ...patch });
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
      const ok = await saveFunRound({ id: round.id, ...patch });
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
      const ok = await saveFunRound({ id: m.round.id, ...patch });
      toast(
        ok ? (Object.keys(patch.slots).length > 1 ? "Players swapped." : "Spot assigned.") : "Couldn't update the tee sheet.",
        ok ? "success" : "error"
      );
    } finally {
      setBusyId(null);
    }
  };

  // Add a guest to a group. One write carries both the seat and the
  // record, so a guest can never exist without a spot.
  const handleSaveGuest = async (guest) => {
    const target = guestFor;
    if (!target) return;
    // Editing an existing guest touches only their record; adding one
    // seats them as well. Same form, same write call, different patch.
    if (target.guestId) {
      const patch = updateGuestPatch(target.round, target.guestId, guest);
      setGuestFor(null);
      if (!patch) { toast("Couldn't update that guest.", "error"); return; }
      setBusyId(target.round.id);
      try {
        const ok = await saveFunRound({ id: target.round.id, ...patch });
        toast(ok ? "Guest updated." : "Couldn't update that guest.", ok ? "success" : "error");
      } finally {
        setBusyId(null);
      }
      return;
    }
    const patch = addGuestPatch(
      target.round,
      target.g,
      target.s,
      { ...guest, invitedBy: myPid, addedAt: Date.now() },
      newGuestId()
    );
    setGuestFor(null);
    if (!patch) { toast("That spot was just taken.", "error"); return; }
    setBusyId(target.round.id);
    try {
      const ok = await saveFunRound({ id: target.round.id, ...patch });
      toast(ok ? `${guest.name} added.` : "Couldn't add your guest.", ok ? "success" : "error");
    } finally {
      setBusyId(null);
    }
  };

  // Remove a guest from their spot, reached from the guest editor.
  const handleRemoveGuest = async () => {
    const target = guestFor;
    setGuestFor(null);
    if (!target) return;
    const patch = releaseSlotPatch(target.round, target.g, target.s);
    if (!patch) return;
    setBusyId(target.round.id);
    try {
      const ok = await saveFunRound({ id: target.round.id, ...patch });
      if (!ok) toast("Couldn't remove that guest.", "error");
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
    const ok = await saveFunRound({ id: m.round.id, ...patch });
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
    onOpenSpot: (round, g, s, teeTime) => setFilling({ round, g, s, teeTime }),
    onRelease: handleRelease,
    onEdit: (r) => setFormFor(r),
    onDelete: (r) => setConfirmDelete(r),
    onEditGuest: (round, g, s, guestId, teeTime) => setGuestFor({ round, g, s, guestId, teeTime }),
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
    const headerLine = [teeTime, scoring.round.title].filter(Boolean).join(" · ");
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
        // Just the tee time (and the round's name, if it has one). The
        // "FUN ROUND · Dec 30" banner and the nine went: you got here
        // from a round you claimed a spot on, so which round this is
        // was never the question — and the hole strip immediately below
        // is numbered, which says the nine better than a label does.
        header={
          headerLine
            ? <div style={{ marginBottom: 8, fontSize: FS.xs, color: K.t3 }}>{headerLine}</div>
            : null
        }
      />
    );
  }

  return (
    <div>
      {/* Intro. The one-liner is doing real work: without it the obvious
          question about any golf round in this app is "does this count?",
          and the answer needs to be visible rather than folklore.
          The create button normally rides in the first card's header;
          with no cards there's nothing to ride, so it falls back here —
          otherwise a commissioner who has deleted every round would have
          no way to make another. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, fontSize: FS.xs, color: K.t3, lineHeight: 1.5 }}>
          Extra rounds outside the league schedule. Nothing here counts toward standings, handicaps, or stats.
        </div>
        {isComm && nothingAtAll && <CreateRoundButton onClick={() => setFormFor("new")} />}
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
          {upcoming.map((r, i) => (
            <FunRoundCard
              key={r.id} round={r} isPast={false} busy={busyId === r.id}
              onCreate={i === 0 ? () => setFormFor("new") : null}
              {...cardProps}
            />
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div style={{ marginTop: upcoming.length > 0 ? 20 : 0 }}>
          <SubLabel color={K.t3} style={{ marginBottom: 8 }}>Past</SubLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
            {past.map((r, i) => (
              <FunRoundCard
                key={r.id} round={r} isPast={true} busy={busyId === r.id}
                onCreate={upcoming.length === 0 && i === 0 ? () => setFormFor("new") : null}
                {...cardProps}
              />
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

      {filling && (
        <OpenSpotChooser
          key={`${filling.round.id}_${filling.g}_${filling.s}`}
          teeTime={filling.teeTime}
          spotIdx={filling.s}
          // Where they're already sitting, if anywhere. Its presence is
          // what hides "I'm playing" — and saying the tee time turns a
          // missing button into an explanation.
          mySeat={(() => {
            const at = findPlayerSlot(filling.round, myPid);
            return at ? buildFunGroups(filling.round)[at.g]?.teeTime || null : null;
          })()}
          onClaim={() => handleClaim(filling.round, filling.g, filling.s)}
          onGuest={() => { setGuestFor(filling); setFilling(null); }}
          onCancel={() => setFilling(null)}
        />
      )}

      {guestFor && (
        <GuestForm
          key={`${guestFor.round.id}_${guestFor.g}_${guestFor.s}_${guestFor.guestId || "new"}`}
          teeTime={guestFor.teeTime}
          spotIdx={guestFor.s}
          guest={guestFor.guestId ? readGuests(guestFor.round)[guestFor.guestId] : null}
          onAdd={handleSaveGuest}
          onRemove={handleRemoveGuest}
          onCancel={() => setGuestFor(null)}
        />
      )}

      {managing && (
        <SpotManager
          key={`${managing.round.id}_${managing.g}_${managing.s}`}
          round={managing.round}
          g={managing.g}
          s={managing.s}
          players={rosterFor(managing.round, players)}
          grid={readSlots(managing.round)}
          onAssign={handleAssign}
          onEditGuest={() => {
            setGuestFor({
              round: managing.round, g: managing.g, s: managing.s,
              guestId: readSlots(managing.round)[managing.g]?.[managing.s],
              teeTime: buildFunGroups(managing.round)[managing.g]?.teeTime || "",
            });
            setManaging(null);
          }}
          onGuest={() => {
            setGuestFor({
              round: managing.round, g: managing.g, s: managing.s,
              teeTime: buildFunGroups(managing.round)[managing.g]?.teeTime || "",
            });
            setManaging(null);
          }}
          onClear={handleManagerClear}
          onClose={() => setManaging(null)}
        />
      )}
    </div>
  );
}
