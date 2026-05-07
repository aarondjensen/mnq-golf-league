import { K, NAME_SIZE } from "./theme";

// ══════════════════════════════════════════════════════════════════
//  TeamMatchupCard — shared visual identity for matchup cards
// ══════════════════════════════════════════════════════════════════
// The single layout used everywhere two teams face off:
//   • Standings → Playoffs → Rounds view (per-round MatchupCard)
//   • Scoring → All Matches list
//   • Schedule → Full League expanded matchups
//
// Before the audit, each of the three places re-implemented this layout inline
// (~100-150 lines each) and the three variants had drifted in border radius,
// opacity transitions, badge styling, and overflow handling. This component is
// the single source — change it here, and all three views stay aligned.
//
// Structural anatomy:
//   ┌──────────────────────────────────────────────────────────────┐
//   │ [S] PLAYER1                 │  CTR   │           PLAYER1 [S] │
//   │     PLAYER2                 │ strip  │           PLAYER2     │
//   │     (record, optional)      │        │           (record)    │
//   └──────────────────────────────────────────────────────────────┘
//
//   • Outer: 1px K.bdr60 border, 10px radius, soft drop shadow.
//     Highlighted "your match" gets a 1.5px K.act border + maize shadow.
//   • Seed badges: 20×20 K.act maize bg with navy text by default; consolation
//     uses K.logoBright muted blue to recede from bracket emphasis.
//   • Team names: K.t1, ALWAYS stacked on two rows for visual rhythm.
//   • Winner marker: K.matchGrn+"18" tint + 3px accent bar on the winning
//     team's outer edge. Loser fades to 60% opacity. No arrows — redundant.
//   • Center strip: K.inp background, thin 1px borders left + right.
//     Width grows with content. Content is caller-provided via the `center` slot.
//
// Props:
//   team1, team2           — { id, name1Line1, name1Line2, record?, seed }
//                            (pre-resolved strings so this component is
//                            presentation-only; no player/teams lookup)
//   winnerSide             — "team1" | "team2" | "tie" | null  (null = not yet)
//   isFinal                — when true, loser fades to 60%
//   center                 — JSX for the center strip. Required.
//   centerWidth            — min-width for the center strip (default 76)
//   highlightSelf          — maize border for the viewer's own match
//   isConsolation          — use K.logoBright seed badges (non-bracket context)
//   showRecords            — render W-L-T line under each team's names
//   onClick                — optional; when provided, the card becomes clickable
//   footer                 — optional JSX rendered below the card body (e.g.
//                            the attestation progress bar in Scoring)
//   expanded               — optional JSX rendered as an expansion panel below
//                            the card (e.g. full scorecard)
// ══════════════════════════════════════════════════════════════════
export function TeamMatchupCard({
  team1, team2,
  winnerSide = null,       // "team1" | "team2" | "tie" | null
  isFinal = false,
  center,
  centerWidth = 76,
  highlightSelf = false,
  isConsolation = false,
  showRecords = false,
  onClick,
  footer,
  expanded,
}) {
  const t1Won = winnerSide === "team1";
  const t2Won = winnerSide === "team2";

  const outerStyle = {
    background: K.card,
    borderRadius: 10,
    border: highlightSelf
      ? `1.5px solid ${K.act}`
      : `1px solid ${K.bdr}60`,
    overflow: "hidden",
    boxShadow: highlightSelf
      ? `0 2px 8px ${K.act}18`
      : "0 1px 3px rgba(0,0,0,.10), 0 1px 2px rgba(0,0,0,.06)",
  };

  const seedBadge = (seed) => {
    const badgeStyle = isConsolation
      ? { background: K.logoBright + "20", border: `1px solid ${K.logoBright}30`, color: K.logoBright }
      : { background: K.act, border: `1px solid ${K.act}`, color: K.logoBlue };
    return (
      <div style={{
        width: 20, height: 20, borderRadius: 5, flexShrink: 0,
        ...badgeStyle,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontWeight: 800,
      }}>{seed ?? "?"}</div>
    );
  };

  const teamHalf = (team, side) => {
    const isWinner = side === "left" ? t1Won : t2Won;
    const isLoser = isFinal && (side === "left" ? t2Won : t1Won);
    const align = side === "left" ? "flex-start" : "flex-end";
    const textAlign = side === "left" ? "left" : "right";

    return (
      <div style={{
        flex: 1, minWidth: 0,
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 12px",
        background: isWinner ? K.matchGrn + "18" : "transparent",
        borderLeft: side === "left" && isWinner ? `3px solid ${K.matchGrn}` : "3px solid transparent",
        borderRight: side === "right" && isWinner ? `3px solid ${K.matchGrn}` : "3px solid transparent",
        justifyContent: side === "left" ? "flex-start" : "flex-end",
        opacity: isLoser ? 0.6 : 1,
      }}>
        {side === "left" && team?.seed != null && seedBadge(team?.seed)}
        <div style={{
          flex: 1, minWidth: 0,
          display: "flex", flexDirection: "column", gap: 1,
          alignItems: align,
        }}>
          <div style={{
            fontSize: NAME_SIZE, fontWeight: 700, color: K.t1,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            lineHeight: 1.2, textAlign, maxWidth: "100%",
          }}>{team?.name1Line1 || "—"}</div>
          <div style={{
            fontSize: NAME_SIZE, fontWeight: 700, color: K.t1,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            lineHeight: 1.2, textAlign, maxWidth: "100%",
          }}>{team?.name1Line2 || ""}</div>
          {showRecords && team?.record && (
            <div style={{
              fontSize: 11, fontWeight: 600, color: K.t3,
              lineHeight: 1.2, textAlign, marginTop: 2,
            }}>{team.record}</div>
          )}
        </div>
        {side === "right" && team?.seed != null && seedBadge(team?.seed)}
      </div>
    );
  };

  const body = (
    <div style={{ display: "flex", alignItems: "stretch", minHeight: 62 }}>
      {teamHalf(team1, "left")}
      <div style={{
        flexShrink: 0, minWidth: centerWidth,
        background: K.inp,
        borderLeft: `1px solid ${K.bdr}40`, borderRight: `1px solid ${K.bdr}40`,
        display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column",
        padding: "6px 8px",
        gap: 2,
      }}>
        {center}
      </div>
      {teamHalf(team2, "right")}
    </div>
  );

  const bodyInteractive = onClick ? (
    <button
      onClick={onClick}
      style={{
        width: "100%", padding: 0, textAlign: "left",
        background: "transparent", border: "none", cursor: "pointer",
        display: "block",
      }}
    >{body}</button>
  ) : body;

  return (
    <div style={outerStyle}>
      {bodyInteractive}
      {footer}
      {expanded}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  Helper: split a "TIE (Hole 5)" result text into stacked parts
// ══════════════════════════════════════════════════════════════════
// Parses tiebreaker-style match result strings and returns
//   { isTiebreaker: true, label: "Hole 5" }   for "TIE (Hole 5)"
//   { isTiebreaker: false }                   for "3&1", "1UP", "TIED", etc.
// Used by center-strip renderers in Scoring/Schedule/Standings to display the
// tiebreaker reason on a second line below a big "TIE" token.
export function parseTiebreakerResult(raw) {
  if (!raw) return { isTiebreaker: false };
  const m = String(raw).match(/^TIE\s*\(([^)]+)\)\s*$/i);
  if (m) return { isTiebreaker: true, label: m[1] };
  return { isTiebreaker: false };
}

// ══════════════════════════════════════════════════════════════════
//  ResultCenter — standard center-strip content for a match result
// ══════════════════════════════════════════════════════════════════
// Renders the most common center-strip variant:
//   - Match-play result text ("3&2", "1UP", "TIED")
//   - Tiebreaker results split onto two lines (TIE / Hole 5)
//   - Optional chevron underneath when the card is expandable
//
// Caller controls everything else (tee-time pre-result, score scratch, etc.)
// by passing custom `center` JSX into TeamMatchupCard directly.
export function ResultCenter({ resultText, isTie, isExpanded }) {
  const tb = parseTiebreakerResult(resultText);
  const color = isTie ? K.t3 : K.t1;
  return (
    <>
      {tb.isTiebreaker ? (
        <>
          <div style={{ fontSize: 17, fontWeight: 800, color, letterSpacing: .3, lineHeight: 1 }}>TIE</div>
          <div style={{ fontSize: 9, fontWeight: 700, color: K.t3, letterSpacing: .5, textTransform: "uppercase", lineHeight: 1.1, marginTop: 1, whiteSpace: "nowrap" }}>
            {tb.label}
          </div>
        </>
      ) : (
        <div style={{
          fontSize: resultText?.length > 5 ? 14 : resultText?.length > 3 ? 15 : 17,
          fontWeight: 800, color, letterSpacing: .3,
          whiteSpace: "nowrap", textAlign: "center", lineHeight: 1.05,
        }}>{resultText || "—"}</div>
      )}
      {isExpanded !== undefined && (
        <div style={{ fontSize: 11, color: K.t3, lineHeight: 1, marginTop: 2 }}>
          {isExpanded ? "▴" : "▾"}
        </div>
      )}
    </>
  );
}
