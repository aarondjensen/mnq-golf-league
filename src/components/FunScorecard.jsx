// ══════════════════════════════════════════════════════════════════
//  FunScorecard — score entry + leaderboard for a fun round
// ══════════════════════════════════════════════════════════════════
//
// Two pieces, both used from the fun round card:
//
//   • FunScoreEntry  — a popup that scores ONE tee group. Nine holes
//                      across, one row per player in the group. Any
//                      member can open it, same as live league scoring
//                      where whoever has their phone out enters for
//                      the group.
//   • FunLeaderboard — the round's board, best net first, shown once
//                      anyone has posted a hole.
//
// All of the arithmetic lives in lib/funScores.js, which defers in turn
// to computeRoundLine — the same function the playoff individual board
// uses. Nothing is recomputed here.
//
// Nothing on this screen touches league data. See the boundary note at
// the top of lib/funScores.js.

import { useState, useMemo } from "react";
import { K, lastNamesOnly, FS, FW } from "../theme";
import { Popup } from "./Popup";
import { buildStrokesMap } from "../lib/matchCalc";
import {
  normalizeHoles,
  readFunCard,
  funRoundLine,
  funPlayerHcp,
  formatToPar,
} from "../lib/funScores";

// Course-hole numbers for the header: the back nine is holes 10-18, and
// showing 1-9 there would have people entering scores against the wrong
// hole on the card in their hand.
const holeLabel = (side, h) => (side === "back" ? h + 10 : h + 1);

// ── Score entry for one group ─────────────────────────────────────
/**
 * @param {{
 *   round: object,
 *   groupIdx: number,
 *   pids: (string|null)[],
 *   players: object[],
 *   pars: number[] | null,
 *   hcps: number[] | null,
 *   side: "front" | "back",
 *   index: Record<string, number[]>,
 *   onSave: (cards: Record<string, number[]>) => Promise<boolean>,
 *   onClose: () => void,
 * }} props
 */
export function FunScoreEntry({ round, groupIdx, pids, players, pars, hcps, side, index, onSave, onClose }) {
  const seated = (pids || []).filter(Boolean);

  // Local draft of every card in the group. Committed as one save so a
  // group's scores land together rather than player by player.
  const [draft, setDraft] = useState(() => {
    const d = {};
    for (const pid of seated) d[pid] = readFunCard(index, round.id, pid);
    return d;
  });
  const [saving, setSaving] = useState(false);

  const playerFor = (pid) => (players || []).find(p => p.id === pid);

  const setHole = (pid, h, value) => {
    setDraft(prev => {
      const card = [...(prev[pid] || new Array(9).fill(0))];
      const n = parseInt(value, 10);
      card[h] = Number.isInteger(n) && n > 0 && n < 100 ? n : 0;
      return { ...prev, [pid]: card };
    });
  };

  const submit = async () => {
    setSaving(true);
    try {
      // Only send cards that actually changed — a group where one person
      // fixes a single hole shouldn't rewrite three other players' docs
      // (and bump their updatedAt for no reason).
      const changed = {};
      for (const pid of seated) {
        const before = readFunCard(index, round.id, pid);
        const after = normalizeHoles(draft[pid]);
        if (after.some((n, h) => n !== before[h])) changed[pid] = after;
      }
      const ok = await onSave(changed);
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popup onClose={onClose} maxWidth={520} padding={16} showClose>
      <div style={{ fontSize: FS.xs, fontWeight: FW.bold, color: K.teal, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
        Group {groupIdx + 1} — {round.date || ""}
      </div>
      <div style={{ fontSize: FS.xs, color: K.t3, marginBottom: 12 }}>
        {side === "back" ? "Back 9" : "Front 9"} · leave a hole blank if it wasn't played
      </div>

      {!pars ? (
        <div style={{ padding: 20, textAlign: "center", color: K.t3, fontSize: FS.sm }}>
          Course data hasn't loaded yet.
        </div>
      ) : (<>
        {/* Hole numbers + pars */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
          <div style={{ width: 76, flexShrink: 0, fontSize: FS.micro, color: K.t3, fontWeight: FW.bold }}>HOLE</div>
          {pars.map((_, h) => (
            <div key={h} style={{ flex: 1, textAlign: "center", fontSize: FS.micro, color: K.t3, fontWeight: FW.bold }}>
              {holeLabel(side, h)}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <div style={{ width: 76, flexShrink: 0, fontSize: FS.micro, color: K.t3, fontWeight: FW.bold }}>PAR</div>
          {pars.map((p, h) => (
            <div key={h} style={{ flex: 1, textAlign: "center", fontSize: FS.micro, color: K.t3 }}>{p}</div>
          ))}
        </div>

        {seated.map(pid => {
          const player = playerFor(pid);
          const hcp = funPlayerHcp(player);
          const strokes = hcps ? buildStrokesMap(hcp, hcps) : {};
          const card = draft[pid] || new Array(9).fill(0);
          const line = funRoundLine(card, pars, hcps, hcp);
          return (
            <div key={pid} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: FS.sm, fontWeight: FW.bold, color: K.t1 }}>
                  {lastNamesOnly(player?.name || "Unknown")}
                </span>
                <span style={{ fontSize: FS.micro, color: K.hcpBlue, fontWeight: FW.bold }}>HCP {hcp}</span>
                <span style={{ marginLeft: "auto", fontSize: FS.micro, color: K.t3 }}>
                  {line.played
                    ? `${formatToPar(line.netToPar)} net · thru ${line.holesPlayed}`
                    : "no card"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div style={{ width: 76, flexShrink: 0 }} />
                {card.map((val, h) => {
                  const dots = strokes[h] || 0;
                  const diff = val > 0 ? val - pars[h] : 0;
                  return (
                    <div key={h} style={{ flex: 1, display: "flex", justifyContent: "center", position: "relative" }}>
                      {dots > 0 && (
                        <span style={{
                          position: "absolute", top: -1, right: 4, zIndex: 1,
                          fontSize: 8, color: K.hcpBlue, lineHeight: 1, pointerEvents: "none",
                        }}>{"•".repeat(Math.min(dots, 3))}</span>
                      )}
                      <input
                        type="number"
                        inputMode="numeric"
                        value={val || ""}
                        onChange={e => setHole(pid, h, e.target.value)}
                        aria-label={`${lastNamesOnly(player?.name || "player")} hole ${holeLabel(side, h)}`}
                        style={{
                          width: "100%", maxWidth: 34, height: 32, textAlign: "center",
                          fontSize: FS.base, fontWeight: FW.bold,
                          background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 4,
                          color: val <= 0 ? K.t3 : diff < 0 ? K.red : K.t1,
                          padding: 0, outline: "none",
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button
            onClick={onClose}
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
          >{saving ? "Saving..." : "Save Scores"}</button>
        </div>
      </>)}
    </Popup>
  );
}

// ── Round leaderboard ─────────────────────────────────────────────
/**
 * Best net first. Rows for players who haven't posted sit at the bottom
 * showing "—", because the tee sheet says they're playing and dropping
 * them would read as a bug.
 */
export function FunLeaderboard({ rows, myPid }) {
  const anyPlayed = useMemo(() => (rows || []).some(r => r.line.played), [rows]);
  if (!rows || !rows.length || !anyPlayed) return null;

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{
        display: "flex", alignItems: "center", padding: "0 2px 4px",
        fontSize: FS.micro, color: K.t3, fontWeight: FW.bold,
        textTransform: "uppercase", letterSpacing: .8,
      }}>
        <div style={{ width: 22 }} />
        <div style={{ flex: 1 }}>Player</div>
        <div style={{ width: 34, textAlign: "right" }}>Hcp</div>
        <div style={{ width: 40, textAlign: "right" }}>Gross</div>
        <div style={{ width: 40, textAlign: "right" }}>Net</div>
        <div style={{ width: 44, textAlign: "right" }}>Thru</div>
      </div>
      {rows.map((r, i) => {
        const played = r.line.played;
        const mine = r.pid === myPid;
        return (
          <div key={r.pid} style={{
            display: "flex", alignItems: "center", padding: "5px 2px",
            borderTop: `1px solid ${K.bdr}40`,
            opacity: played ? 1 : 0.55,
          }}>
            <div style={{ width: 22, fontSize: FS.micro, color: K.t3, fontWeight: FW.bold }}>
              {played ? i + 1 : ""}
            </div>
            <div style={{
              flex: 1, fontSize: FS.sm, fontWeight: mine ? FW.bold : FW.medium,
              color: mine ? K.teal : K.t1,
              overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
            }}>{lastNamesOnly(r.name)}</div>
            <div style={{ width: 34, textAlign: "right", fontSize: FS.micro, color: K.hcpBlue, fontWeight: FW.bold }}>{r.hcp}</div>
            <div style={{ width: 40, textAlign: "right", fontSize: FS.sm, color: K.t2 }}>
              {played ? r.line.gross : "—"}
            </div>
            <div style={{ width: 40, textAlign: "right", fontSize: FS.sm, fontWeight: FW.heavy, color: played ? K.t1 : K.t3 }}>
              {played ? formatToPar(r.line.netToPar) : "—"}
            </div>
            <div style={{ width: 44, textAlign: "right", fontSize: FS.micro, color: K.t3 }}>
              {played ? (r.line.holesPlayed === 9 ? "F" : r.line.holesPlayed) : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
