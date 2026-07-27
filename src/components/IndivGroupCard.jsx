import { K, FS, FW, NAME_SIZE } from "../theme";

// ══════════════════════════════════════════════════════════════════
//  IndivGroupCard — the card for a playoff individual group
// ══════════════════════════════════════════════════════════════════
//
// Why this exists alongside TeamMatchupCard
// ─────────────────────────────────────────
// Once a team is knocked out of the bracket, its two players stop playing as
// a team and join the individual pool (see lib/indivGroups.js). The seeder
// regroups those players into fresh foursomes written as
//   { players: [pid, pid, pid, pid], isConsolation: true, isIndivGroup: true }
// with NO team1/team2 — because there is no head-to-head match. Four golfers
// share a tee time and each posts an individual net round.
//
// TeamMatchupCard can't render that: it is structurally two-sided (left half,
// center result strip, right half) and every field it wants — seeds, W-L-T
// records, a match-play result, a winner — is meaningless here. Feeding it an
// individual group produced the "TBD vs TBD" cards this component replaces.
//
// This card is presentation-only, same discipline as TeamMatchupCard: the
// caller resolves names and score lines and passes strings. It owns no data
// lookups.
//
// Props:
//   rows          — [{ pid, name, value?, sub? }] one per golfer, already in
//                   tee order. `value` is the headline number (e.g. "+2" net
//                   to par); `sub` is the muted qualifier (e.g. "thru 7").
//                   Both optional — before anyone tees off there's nothing to
//                   show and the rows render as names alone.
//   teeTime       — formatted tee time string for the top-right corner.
//   label         — eyebrow text (default "Individual Group").
//   highlightSelf — maize border, matching TeamMatchupCard's "your match".
//   highlightPid  — one row rendered in maize: the viewer's own line.
//   onClick       — when provided the card body becomes a button.
//   isExpanded    — drives the ▾ / ▴ affordance; pass undefined to hide it.
//   expanded      — JSX rendered below the card body (e.g. the scorecard).
//   footer        — JSX rendered below the body, above `expanded`.
// ══════════════════════════════════════════════════════════════════
export function IndivGroupCard({
  rows = [],
  teeTime,
  label = "Individual Group",
  highlightSelf = false,
  highlightPid = null,
  onClick,
  isExpanded,
  expanded,
  footer,
}) {
  const outerStyle = {
    background: K.card,
    borderRadius: 10,
    border: highlightSelf ? `1.5px solid ${K.act}` : `1px solid ${K.bdr}60`,
    overflow: "hidden",
    boxShadow: highlightSelf
      ? `0 2px 8px ${K.act}18`
      : "0 1px 3px rgba(0,0,0,.10), 0 1px 2px rgba(0,0,0,.06)",
  };

  const body = (
    <div style={{ padding: "8px 10px" }}>
      {/* Header strip — the teal eyebrow is the one unmistakable signal that
          this row is NOT a match. Tee time sits opposite it, in the same
          maize the team cards use for their center strip, so the week reads
          as one continuous tee sheet. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{
          fontSize: FS.micro, fontWeight: FW.bold, color: K.teal,
          letterSpacing: 1, textTransform: "uppercase", whiteSpace: "nowrap",
        }}>{label}</span>
        <div style={{ flex: 1, height: 1, background: `${K.bdr}60` }} />
        {teeTime && (
          <span style={{
            fontSize: FS.sm, fontWeight: FW.heavy, color: K.act,
            letterSpacing: .3, whiteSpace: "nowrap",
          }}>{teeTime}</span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {rows.map((r, i) => {
          const isMe = highlightPid && r.pid === highlightPid;
          return (
            <div key={r.pid || i} style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
              <span style={{
                fontSize: NAME_SIZE, fontWeight: isMe ? FW.heavy : FW.bold,
                color: isMe ? K.act : K.t1,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                minWidth: 0, flex: 1, lineHeight: 1.25,
              }}>{r.name}</span>
              {r.value != null && r.value !== "" && (
                <span style={{
                  fontSize: FS.sm, fontWeight: FW.heavy, color: isMe ? K.act : K.t1,
                  whiteSpace: "nowrap", flexShrink: 0,
                }}>{r.value}</span>
              )}
              {r.sub && (
                <span style={{
                  fontSize: FS.micro, color: K.t3, fontWeight: FW.semibold,
                  whiteSpace: "nowrap", flexShrink: 0, minWidth: 38, textAlign: "right",
                }}>{r.sub}</span>
              )}
            </div>
          );
        })}
      </div>

      {isExpanded !== undefined && (
        <div style={{ textAlign: "center", fontSize: FS.xs, color: K.t3, lineHeight: 1, marginTop: 4 }}>
          {isExpanded ? "▴" : "▾"}
        </div>
      )}
    </div>
  );

  return (
    <div style={outerStyle}>
      {onClick ? (
        <button
          onClick={onClick}
          style={{
            width: "100%", padding: 0, textAlign: "left",
            background: "transparent", border: "none", cursor: "pointer", display: "block",
          }}
        >{body}</button>
      ) : body}
      {footer}
      {expanded}
    </div>
  );
}
