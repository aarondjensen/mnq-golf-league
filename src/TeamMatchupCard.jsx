import { memo } from "react";
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
//                            presentation-only; no player/teams lookup).
//                            name1Line1 / name1Line2 each accept either a
//                            plain string OR a { text, color } object for
//                            per-line color override (used by Scoring's
//                            PENDING-state name pulse).
//                            name1Line2 is optional — when falsy, Line2 is
//                            not rendered at all (single-line cards).
//   winnerSide             — "team1" | "team2" | "tie" | null  (null = not yet)
//   isFinal                — when true, loser fades to 60%
//   center                 — JSX for the center strip. Required.
//   centerWidth            — min-width for the center strip (default 76,
//                            or 44 in compact mode)
//   highlightSelf          — maize border for the viewer's own match
//   isConsolation          — use K.logoBright seed badges (non-bracket context)
//   showRecords            — render W-L-T line under each team's names
//   compact                — when true, scale down the entire card for use
//                            inside bracket views: smaller fonts, smaller
//                            seed badges, tighter padding, smaller radius.
//                            Designed so 4 cards stack visibly inside a
//                            mobile-width bracket round column.
//   outerBorderColor       — when provided, overrides the default outer
//                            border color (K.bdr60). Used by Standings to
//                            tint the outer frame green when a result exists,
//                            so the bracket round visually distinguishes
//                            played from un-played matches at a glance.
//                            Ignored when highlightSelf is true (which
//                            forces the maize border).
//   onClick                — optional; when provided, the card becomes clickable
//   footer                 — optional JSX rendered below the card body (e.g.
//                            the attestation progress bar in Scoring)
//   expanded               — optional JSX rendered as an expansion panel below
//                            the card (e.g. full scorecard)
// ══════════════════════════════════════════════════════════════════
// Implementation kept as a separate symbol so we can wrap the public
// export in React.memo. The card is rendered in lists 5-15 deep in
// Schedule/Scoring/Standings, and many of those lists re-render on
// every Firestore snapshot (matchResults, holeScores). Without memo,
// every snapshot ticks every card in every list. With memo + stable
// props from the caller, only the cards whose data actually changed
// re-render. Props are all primitives or simple objects (team{1,2},
// winnerSide, isFinal, center, etc.); the JSX in `center`/`footer`/
// `expanded` is the main thing that needs to be referentially stable
// for memo to take effect. Callers that build those inline still
// avoid the inner reconciliation cost, which is the bigger half.
function TeamMatchupCardImpl({
  team1, team2,
  winnerSide = null,       // "team1" | "team2" | "tie" | null
  isFinal = false,
  center,
  centerWidth,
  highlightSelf = false,
  isConsolation = false,
  showRecords = false,
  compact = false,
  outerBorderColor = null,
  onClick,
  footer,
  expanded,
}) {
  const t1Won = winnerSide === "team1";
  const t2Won = winnerSide === "team2";

  // Compact mode tweaks every dimension proportionally. Pulled from the prior
  // inline Standings MatchupCard which had been hand-tuned for the bracket
  // grid; consolidating to TeamMatchupCard means every consumer that wants
  // the smaller variant gets the same exact values rather than re-deriving.
  const dims = compact
    ? { padding: "8px 10px", gap: 6, radius: 8, minH: 60, nameSize: 12,
        seedSize: 18, seedFont: 9, seedRadius: 5,
        centerPad: "0 8px", centerGap: 0, defaultCenterW: 44 }
    : { padding: "10px 12px", gap: 8, radius: 10, minH: 62, nameSize: NAME_SIZE,
        seedSize: 20, seedFont: 10, seedRadius: 5,
        centerPad: "6px 8px", centerGap: 2, defaultCenterW: 76 };

  // Resolve effective center-strip width: caller-provided centerWidth wins,
  // otherwise fall back to the variant's default.
  const cw = centerWidth ?? dims.defaultCenterW;

  // Resolve outer border color. Highlight wins (always maize for "your match").
  // Then explicit override (e.g. matchGrn40 from Standings on a finalized
  // bracket card). Otherwise the default soft gray.
  const outerBorder = highlightSelf
    ? K.act
    : outerBorderColor || `${K.bdr}60`;
  const outerBorderWidth = highlightSelf ? "1.5px" : "1px";

  const outerStyle = {
    background: K.card,
    borderRadius: dims.radius,
    border: `${outerBorderWidth} solid ${outerBorder}`,
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
        width: dims.seedSize, height: dims.seedSize, borderRadius: dims.seedRadius, flexShrink: 0,
        ...badgeStyle,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: dims.seedFont, fontWeight: 800,
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
        display: "flex", alignItems: "center", gap: dims.gap,
        padding: dims.padding,
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
          {/* Line 1 / Line 2 — both lines accept either a plain string OR a
              { text, color } object. Per-line color is used in Scoring's
              "PENDING" pulse: any player whose 9-hole card is incomplete on a
              partially-scored match renders in K.act gold so it's obvious WHO
              the match is waiting on. Schedule/Standings just pass strings
              and inherit the default K.t1. */}
          {(() => {
            const l1 = team?.name1Line1;
            const l1Text = (l1 && typeof l1 === "object") ? l1.text : l1;
            const l1Color = (l1 && typeof l1 === "object" && l1.color) ? l1.color : K.t1;
            return (
              <div style={{
                fontSize: dims.nameSize, fontWeight: 700, color: l1Color,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                lineHeight: 1.2, textAlign, maxWidth: "100%",
              }}>{l1Text || "—"}</div>
            );
          })()}
          {/* Line 2 is rendered only when truthy. Single-line callers (e.g.
              Standings's config-mode placeholder labels like "Winner M1")
              omit it cleanly — no empty div eating vertical space. */}
          {team?.name1Line2 && (() => {
            const l2 = team.name1Line2;
            const l2Text = (typeof l2 === "object") ? l2.text : l2;
            const l2Color = (typeof l2 === "object" && l2.color) ? l2.color : K.t1;
            return (
              <div style={{
                fontSize: dims.nameSize, fontWeight: 700, color: l2Color,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                lineHeight: 1.2, textAlign, maxWidth: "100%",
              }}>{l2Text}</div>
            );
          })()}
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
    <div style={{ display: "flex", alignItems: "stretch", minHeight: dims.minH }}>
      {teamHalf(team1, "left")}
      <div style={{
        flexShrink: 0, minWidth: cw,
        background: K.inp,
        borderLeft: `1px solid ${K.bdr}40`, borderRight: `1px solid ${K.bdr}40`,
        display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column",
        padding: dims.centerPad,
        gap: dims.centerGap,
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

// Memoized export. Shallow prop compare is sufficient — all callers pass
// either primitives, stable id-keyed objects, or freshly-built JSX in
// `center`/`footer`/`expanded` slots. The JSX itself won't be ===-equal
// across renders, but React still skips the entire subtree's
// reconciliation when other props are stable, which is the win.
export const TeamMatchupCard = memo(TeamMatchupCardImpl);

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
