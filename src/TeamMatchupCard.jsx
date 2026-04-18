import { K } from "./theme";

// ══════════════════════════════════════════════════════════════════
//  TeamMatchupCard — shared visual identity for matchup cards
// ══════════════════════════════════════════════════════════════════
// A single consistent layout used across the app wherever we show two teams
// facing off:
//   • Standings → Playoffs → Rounds view
//   • Scoring → All Matches
//   • Schedule → Full League expanded matchups
//
// Structural anatomy:
//   ┌──────────────────────────────────────────────────────────────┐
//   │ [S] PLAYER1                 │  CTR   │           PLAYER1 [S] │
//   │     PLAYER2                 │ strip  │           PLAYER2     │
//   │     (record, optional)      │        │           (record)    │
//   └──────────────────────────────────────────────────────────────┘
//
//   • Outer: 1.5px border (maize if `highlightSelf`, otherwise K.bdr60),
//     10px radius, soft drop shadow.
//   • Seed badges: 20×20 K.act maize bg with navy text (all contexts).
//   • Team names: 14px K.t1, ALWAYS stacked on two rows for rhythm.
//   • Winner marker: K.matchGrn+"18" tint + 3px accent bar on the winning
//     team's side. Loser fades to 60% opacity. No arrows — redundant.
//   • Center strip: K.inp background, thin 1px borders left + right, width
//     grows with content. Content is caller-provided via the `center` slot.
//
// Props:
//   team1, team2           — { id, name1Line1, name1Line2, record?, seed }
//                            (pre-resolved strings so this component is
//                            presentation-only; no player/teams lookup)
//   winnerSide             — "team1" | "team2" | "tie" | null  (null = not yet)
//   isFinal                — when true, loser fades to 60%
//   center                 — JSX for the center strip. Required.
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
  highlightSelf = false,
  isConsolation = false,
  showRecords = false,
  onClick,
  footer,
  expanded,
}) {
  const t1Won = winnerSide === "team1";
  const t2Won = winnerSide === "team2";

  // Outer wrapper styling. Shadow intensity bumps for highlighted (own) matches.
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

  // Seed badge — maize fill + navy text by default; light-blue for consolation.
  // Size 20×20, rounded square (5px radius) — matches the standings rank treatment.
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

  // Team-half render. Left and right sides are mirrored via the `side` prop so
  // the seed sits on the outer edge in both cases.
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
        {side === "left" && seedBadge(team?.seed)}
        <div style={{
          flex: 1, minWidth: 0,
          display: "flex", flexDirection: "column", gap: 1,
          alignItems: align,
        }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: K.t1,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            lineHeight: 1.2, textAlign, maxWidth: "100%",
          }}>{team?.name1Line1 || "—"}</div>
          <div style={{
            fontSize: 14, fontWeight: 700, color: K.t1,
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
        {side === "right" && seedBadge(team?.seed)}
      </div>
    );
  };

  // The 3-column body (team1 | center | team2)
  const body = (
    <div style={{ display: "flex", alignItems: "stretch", minHeight: 62 }}>
      {teamHalf(team1, "left")}
      <div style={{
        flexShrink: 0, minWidth: 76,
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

  // When onClick is provided, wrap the body in a button for tap-to-expand.
  // Without it the card is display-only.
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
// Used by center-strip renderers to display the tiebreaker reason on a second
// line below a big "TIE" token.
export function parseTiebreakerResult(raw) {
  if (!raw) return { isTiebreaker: false };
  const m = raw.match(/^TIE\s*\(([^)]+)\)\s*$/i);
  if (m) return { isTiebreaker: true, label: m[1] };
  return { isTiebreaker: false };
}
