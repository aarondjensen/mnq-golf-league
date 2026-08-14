// ══════════════════════════════════════════════════════════════════
//  FunScorecard — the fun round's leaderboard
// ══════════════════════════════════════════════════════════════════
//
//   • FunLeaderboard — the round's board, best net first, shown on the
//                      round card once anyone has posted a hole.
//
// Score ENTRY is not here. A fun group scores through GroupScoring —
// the same hole-by-hole screen a knocked-out playoff foursome uses —
// so the gesture on the course is identical to league night. The grid
// popup that used to live here was a second, lesser way to do the same
// thing, and is gone.
//
// All of the arithmetic lives in lib/funScores.js, which defers in turn
// to computeRoundLine — the same function the playoff individual board
// uses. Nothing is recomputed here.
//
// Nothing on this screen touches league data. See the boundary note at
// the top of lib/funScores.js.

import { useMemo } from "react";
import { K, FS, FW } from "../theme";
import { lastNamesOnly } from "../lib/league";
import { formatToPar } from "../lib/funScores";

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
