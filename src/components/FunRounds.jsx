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
//   • Commissioner creates, edits and deletes rounds.
//   • Any linked player signs THEMSELVES up or out.
//
// Groups form in signup order and tee times fall out of start time +
// interval — see lib/funRounds.js, which owns all of that logic and is
// where the tests live. This file is presentation plus the two write
// calls.
//
// Deliberately absent: scoring. A fun round writes no hole scores and
// touches no league math (see the header comment in lib/funRounds.js
// for why that isolation is structural rather than a filter someone
// has to remember).

import { useState, useEffect, useMemo } from "react";
import { K, Pill, EmptyState, SubLabel, lastNamesOnly, LIST_GAP, CARD_RADIUS, FS, FW } from "../theme";
import { Popup, ConfirmModal } from "./Popup";
import {
  splitFunRounds,
  buildFunGroups,
  normalizeSignups,
  isSignedUp,
  withSignup,
  validateFunRound,
  normalizeStartTime,
  isoToScheduleDate,
  scheduleDateToIso,
  funGroupSize,
  funTeeInterval,
  FUN_GROUP_SIZE,
  FUN_TEE_INTERVAL,
} from "../lib/funRounds";

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
        <div style={{ width: 96 }}>
          <div style={fieldLabel}>Per Group</div>
          <input
            type="number" min="2" max="6"
            value={draft.groupSize}
            onChange={e => set({ groupSize: parseInt(e.target.value, 10) || "" })}
            style={inputStyle}
          />
        </div>
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

// ── One round's card ──────────────────────────────────────────────
function FunRoundCard({ round, players, myPid, isComm, isPast, onJoin, onEdit, onDelete, busy }) {
  const groups = useMemo(() => buildFunGroups(round), [round]);
  const signups = normalizeSignups(round);
  const joined = isSignedUp(round, myPid);

  const nameFor = (pid) => {
    const p = players.find(x => x.id === pid);
    return p ? lastNamesOnly(p.name) : "Unknown";
  };

  return (
    <div style={{
      background: K.card, borderRadius: CARD_RADIUS,
      border: `1px solid ${joined && !isPast ? K.teal + "60" : K.bdr}`,
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
            {signups.length} {signups.length === 1 ? "player" : "players"}
            {groups.length > 0 ? ` · ${groups.length} ${groups.length === 1 ? "group" : "groups"}` : ""}
          </div>
        </div>
        <Pill color={K.logoBright} style={{ fontSize: FS.micro }}>{round.side === "back" ? "Back 9" : "Front 9"}</Pill>
        {joined && !isPast && <Pill color={K.teal} style={{ fontSize: FS.micro }}>You're In</Pill>}
      </div>

      {/* Tee sheet */}
      <div style={{ padding: "8px 14px" }}>
        {groups.length === 0 ? (
          <div style={{ fontSize: FS.sm, color: K.t3, padding: "6px 0" }}>
            No one signed up yet — first tee is {round.startTime || "TBD"}.
          </div>
        ) : groups.map(g => (
          <div key={g.idx} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "5px 0" }}>
            <div style={{ width: 62, flexShrink: 0, fontSize: FS.sm, fontWeight: FW.bold, color: K.act }}>{g.teeTime}</div>
            <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {g.pids.map(pid => (
                <span key={pid} style={{
                  fontSize: FS.xs, fontWeight: FW.semibold,
                  color: pid === myPid ? K.teal : K.t2,
                  background: pid === myPid ? K.teal + "14" : K.inp,
                  border: `1px solid ${pid === myPid ? K.teal + "50" : K.bdr}`,
                  borderRadius: 5, padding: "2px 7px",
                }}>{nameFor(pid)}</span>
              ))}
            </div>
          </div>
        ))}
        {round.notes && (
          <div style={{ fontSize: FS.xs, color: K.t3, marginTop: 6, lineHeight: 1.5 }}>{round.notes}</div>
        )}
      </div>

      {/* Actions. A past round is read-only for everyone — there is
          nothing to sign up for and nothing worth editing; the commish
          can still delete it to tidy the list. */}
      <div style={{ display: "flex", gap: 6, padding: "0 14px 12px" }}>
        {!isPast && myPid && (
          <button
            onClick={() => onJoin(round, !joined)}
            disabled={busy}
            style={{
              flex: 1, padding: "9px 10px", borderRadius: 8,
              background: joined ? K.inp : K.teal,
              border: `1px solid ${joined ? K.bdr : K.teal}`,
              color: joined ? K.t2 : K.bg,
              fontSize: FS.sm, fontWeight: FW.bold,
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            }}
          >{joined ? "Drop Out" : "I'm In"}</button>
        )}
        {isComm && !isPast && (
          <button
            onClick={() => onEdit(round)}
            style={{ padding: "9px 12px", borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: FS.sm, fontWeight: FW.bold, cursor: "pointer" }}
          >Edit</button>
        )}
        {isComm && (
          <button
            onClick={() => onDelete(round)}
            style={{ padding: "9px 12px", borderRadius: 8, background: "transparent", border: `1px solid ${K.red}40`, color: K.red, fontSize: FS.sm, fontWeight: FW.bold, cursor: "pointer" }}
          >Delete</button>
        )}
      </div>
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
  appToast, setPopupOpen,
}) {
  const [formFor, setFormFor] = useState(null);   // round object | "new" | null
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const myPid = leagueUser?.playerId || null;
  const year = season || leagueConfig?.year || new Date().getFullYear();

  const { upcoming, past } = useMemo(
    () => splitFunRounds(funRounds, year),
    [funRounds, year]
  );

  // Popups suppress pull-to-refresh app-side, same as every other page
  // that opens one.
  useEffect(() => {
    if (setPopupOpen) setPopupOpen(!!formFor || !!confirmDelete);
  }, [formFor, confirmDelete, setPopupOpen]);

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
      const doc = editing
        ? { ...editing, ...fields }
        : {
            // Millisecond id + a random suffix: two commissioners
            // creating a round in the same millisecond is far-fetched,
            // but a collision would silently overwrite the other's
            // round, so it costs nothing to rule out.
            id: `fun_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            season: year,
            signups: [],
            // Player.id, not an auth uid — leagueUser carries playerId,
            // and a Player.id is what every other record in the app uses
            // to name a human.
            createdBy: myPid || null,
            createdAt: Date.now(),
            ...fields,
          };
      const ok = await saveFunRound(doc);
      if (!ok) { toast("Couldn't save the tee time.", "error"); return; }
      setFormFor(null);
      toast(editing ? "Tee time updated." : "Tee time created.", "success");
    } finally {
      setSaving(false);
    }
  };

  // Sign in / out. Writes ONLY the signups field so it stays within what
  // the Firestore rules allow a non-commissioner member to change.
  const handleJoin = async (round, joining) => {
    if (!myPid) return;
    setBusyId(round.id);
    try {
      const ok = await saveFunRound({ id: round.id, signups: withSignup(round, myPid, joining) });
      if (!ok) toast("Couldn't update your signup.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    const round = confirmDelete;
    setConfirmDelete(null);
    if (!round) return;
    const ok = await deleteFunRound(round.id);
    toast(ok ? "Tee time deleted." : "Couldn't delete the tee time.", ok ? "success" : "error");
  };

  const cardProps = {
    players, myPid, isComm,
    onJoin: handleJoin,
    onEdit: (r) => setFormFor(r),
    onDelete: (r) => setConfirmDelete(r),
  };

  const nothingAtAll = upcoming.length === 0 && past.length === 0;

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
          message: `${normalizeSignups(confirmDelete).length} player(s) signed up. This can't be undone.`,
          confirmLabel: "Delete",
          destructive: true,
          onConfirm: handleDelete,
          onCancel: () => setConfirmDelete(null),
        } : null}
      />
    </div>
  );
}
