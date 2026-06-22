// ══════════════════════════════════════════════════════════════════
//  EditConfirmationPopup — confirmation modal for "Edit Scores → Save"
//                          flow in Schedule.jsx.
// ══════════════════════════════════════════════════════════════════
//
// Why this is its own file
// ────────────────────────
// Schedule.jsx grew to 1300+ lines, much of which was inline popup JSX
// that has nothing to do with rendering the schedule itself. This popup
// in particular was ~150 lines of pure presentation that depends on
// nothing but its props — perfect extract candidate.
//
// What it shows
// ─────────────
// When a commissioner saves edited scores from the Edit Scores popup,
// Schedule.jsx computes a diff between the old and new state and stores
// the result in the parent's `pendingEdits` state. This component renders
// that diff so the commissioner can review before committing:
//
//   • Match-result changes (W/L/T flip, points, winner)
//   • Per-hole score changes (player, hole, before → after)
//   • Absent-flag changes (player, present ↔ absent)
//
// Confirm fires `onConfirm` (which the parent wires up to its actual
// save handler — `commitEditedScores`); Cancel fires `onCancel` (drops
// pendingEdits, returns to the edit popup so the commissioner can keep
// adjusting). When `saving` is true the buttons disable and the Confirm
// button shows a spinner-y label.
//
// Props
// ─────
//   • pendingEdits   — { t1, t2, diff, changedScores, changedAbsents }
//                      where diff is { result?, winner?, t1Points?,
//                      t2Points? } each with { from, to } shape
//   • teams          — full teams array (for resolving t1/t2 to display
//                      names via lastNamesOnly)
//   • saving         — when true, disable buttons + show "Saving..."
//   • onConfirm      — async save handler (commitEditedScores in caller)
//   • onCancel       — handler to drop pendingEdits and return to the
//                      edit popup
//   • K, lastNamesOnly — theme tokens / utility threaded through so
//                        the component doesn't import from theme directly
//                        and stays trivially testable.

import React from "react";
import { Popup } from "./Popup";
import { FS, FW } from "../theme";

export function EditConfirmationPopup({
  pendingEdits,
  teams,
  saving,
  onConfirm,
  onCancel,
  K,
  lastNamesOnly,
}) {
  if (!pendingEdits) return null;

  const { diff, changedScores, changedAbsents } = pendingEdits;
  const hasResultChange = Object.keys(diff).length > 0;

  return (
    <Popup
      onClose={onCancel}
      maxWidth={460}
      zIndex="modal"
      showClose={true}
      padding="16px 14px"
      outerPadding={10}
      innerStyle={{
        // Orange warn-tinted border + glow signal "this is the destructive
        // confirm" vs. the neutral Edit Scores popup it sits on top of.
        border: `1px solid ${K.warn}`,
        boxShadow: `0 12px 40px ${K.warn}40`,
      }}
    >
      <div style={{ fontSize: FS.base, fontWeight: FW.heavy, color: K.warn, letterSpacing: .3, marginBottom: 12, paddingRight: 40 }}>
        Confirm Score Edit
      </div>

          {/* Lead-in summary */}
          <div style={{ fontSize: FS.sm, color: K.t2, marginBottom: 14, lineHeight: 1.5 }}>
            {hasResultChange
              ? "Saving these changes will update the match result. Standings and schedule will reflect the new outcome."
              : "Score values will be updated. Match result is unchanged."}
          </div>

          {/* Match result diff */}
          {hasResultChange && (
            <div style={{ background: K.warn + "12", border: `1px solid ${K.warn}40`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
              <div style={{ fontSize: FS.micro, fontWeight: FW.heavy, color: K.warn, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Match result</div>
              {diff.result && (
                <div style={{ fontSize: FS.sm, color: K.t1, marginBottom: 4 }}>
                  <span style={{ color: K.t3 }}>Result: </span>
                  <span style={{ textDecoration: "line-through", color: K.t3 }}>{diff.result.from}</span>
                  <span style={{ margin: "0 6px", color: K.t3 }}>→</span>
                  <span style={{ fontWeight: FW.bold }}>{diff.result.to}</span>
                </div>
              )}
              {diff.winner && (
                <div style={{ fontSize: FS.sm, color: K.t1, marginBottom: 4 }}>
                  <span style={{ color: K.t3 }}>Winner: </span>
                  <span style={{ textDecoration: "line-through", color: K.t3 }}>{diff.winner.from}</span>
                  <span style={{ margin: "0 6px", color: K.t3 }}>→</span>
                  <span style={{ fontWeight: FW.bold }}>{diff.winner.to}</span>
                </div>
              )}
              {diff.t1Points && (
                <div style={{ fontSize: FS.sm, color: K.t1, marginBottom: 4 }}>
                  <span style={{ color: K.t3 }}>{lastNamesOnly(teams.find(t => t.id === pendingEdits.t1.id)?.name || "Team 1")} points: </span>
                  <span style={{ textDecoration: "line-through", color: K.t3 }}>{diff.t1Points.from}</span>
                  <span style={{ margin: "0 6px", color: K.t3 }}>→</span>
                  <span style={{ fontWeight: FW.bold }}>{diff.t1Points.to}</span>
                </div>
              )}
              {diff.t2Points && (
                <div style={{ fontSize: FS.sm, color: K.t1 }}>
                  <span style={{ color: K.t3 }}>{lastNamesOnly(teams.find(t => t.id === pendingEdits.t2.id)?.name || "Team 2")} points: </span>
                  <span style={{ textDecoration: "line-through", color: K.t3 }}>{diff.t2Points.from}</span>
                  <span style={{ margin: "0 6px", color: K.t3 }}>→</span>
                  <span style={{ fontWeight: FW.bold }}>{diff.t2Points.to}</span>
                </div>
              )}
            </div>
          )}

          {/* Score changes */}
          {changedScores.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: FS.micro, fontWeight: FW.heavy, color: K.t3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
                Score changes ({changedScores.length})
              </div>
              <div style={{ background: K.inp, borderRadius: 8, padding: "8px 10px", fontSize: FS.xs, color: K.t2, lineHeight: 1.7 }}>
                {changedScores.map((c, i) => (
                  <div key={i}>
                    <span style={{ color: K.t1, fontWeight: FW.bold }}>{c.playerName}</span>
                    <span style={{ color: K.t3 }}> · Hole {c.hole}: </span>
                    <span style={{ textDecoration: "line-through", color: K.t3 }}>{c.oldVal || "—"}</span>
                    <span style={{ margin: "0 6px", color: K.t3 }}>→</span>
                    <span style={{ fontWeight: FW.bold, color: K.t1 }}>{c.newVal}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Absent flag changes */}
          {changedAbsents.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: FS.micro, fontWeight: FW.heavy, color: K.t3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
                Attendance changes
              </div>
              <div style={{ background: K.inp, borderRadius: 8, padding: "8px 10px", fontSize: FS.xs, color: K.t2, lineHeight: 1.7 }}>
                {changedAbsents.map((c, i) => (
                  <div key={i}>
                    <span style={{ color: K.t1, fontWeight: FW.bold }}>{c.playerName}</span>
                    <span style={{ color: K.t3 }}> marked </span>
                    <span style={{ fontWeight: FW.bold, color: c.newAbsent ? K.red : K.grn }}>
                      {c.newAbsent ? "Absent" : "Present"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confirm / Cancel */}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button
              onClick={onConfirm}
              disabled={saving}
              style={{
                flex: 1, padding: "12px",
                borderRadius: 8,
                background: saving ? K.inp : K.warn,
                border: "none",
                color: saving ? K.t3 : K.bg,
                fontSize: FS.sm, fontWeight: FW.heavy, letterSpacing: .3,
                cursor: saving ? "default" : "pointer",
              }}
            >
              {saving ? "Saving..." : "Confirm & Save"}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              style={{
                padding: "12px 18px",
                borderRadius: 8,
                background: K.inp, border: `1px solid ${K.bdr}`,
                color: K.t2,
                fontSize: FS.sm, fontWeight: FW.bold,
                cursor: saving ? "default" : "pointer",
              }}
            >
              Back
            </button>
          </div>
    </Popup>
  );
}
