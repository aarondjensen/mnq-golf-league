// ══════════════════════════════════════════════════════════════════
//  SharedScorecard + ScoreCell — the canonical scorecard renderer.
//
//  Lives here, not in pages/Scoring.jsx, because three pages need it:
//    • Live Scoring   — real-time scoring view
//    • Schedule       — expanded scorecard inside a completed match row
//    • Standings      — expanded scorecard inside a team's history row
//
//  When this used to live inside Scoring.jsx, the lazy-load boundary was
//  effectively broken: Schedule and Standings imported `SharedScorecard`
//  from "./Scoring", which dragged the entire LiveScoringView page (~155KB
//  with all its popups, finalize logic, CTP picker, etc.) into a shared
//  chunk that loaded the moment the user opened Schedule. Pulling
//  SharedScorecard out lets Vite's code-splitter actually do its job —
//  the Scoring chunk only loads when the Scoring tab opens.
//
//  Public exports
//  ──────────────
//    • SharedScorecard       — factory that returns row components
//                              ({ HoleRow, ParRow, HcpRow, PlayerRow,
//                                 TeamNetRow, MatchRow }) with the same
//                              pars/hcps/handlers closed over. Calling
//                              code composes them in whatever order it
//                              needs.
//    • ScoreCell             — the per-cell score notation: empty dot,
//                              plain number, circle (birdie), square
//                              (bogey), double-ring/double-square
//                              (eagle/double-bogey+).
//    • GRID_LINE_STYLE,
//      COL_BDR_STYLE         — border tokens for callers that want to
//                              match the scorecard's visual weight in
//                              adjacent UI.
//
//  Dependencies
//  ────────────
//    • K from theme.jsx         — color tokens (dark/light aware)
//    • parseTiebreakerResult    — used by MatchRow's clinch cell to
//      from TeamMatchupCard       split "TIE (Hole 5)" into stacked
//                                 "TIE" + "Hole 5" lines.
// ══════════════════════════════════════════════════════════════════

import { K } from "../theme";
import { parseTiebreakerResult } from "../TeamMatchupCard";

// ═══════════════════════════════════════════════════════════════
//  ScoreCell — golf scorecard notation (circles, squares, dots)
// ═══════════════════════════════════════════════════════════════
export function ScoreCell({ score, par, strokes, size = 13, color: colorOverride }) {
  const s = size;
  const sh = s + 8;
  const dotH = 10;
  const bc = colorOverride || K.t2;
  const textColor = colorOverride || undefined;

  // Empty cell: show the placeholder dot AND any stroke marks the player gets on
  // this hole. This way a blank scorecard at the start of a round still
  // communicates "this player has a stroke here" — useful for the team during
  // play. Match the scored-cell layout (stroke-dots row above the score area)
  // so row heights line up before and after a score is entered.
  if (!score || score <= 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: dotH + sh, justifyContent: "flex-end" }}>
        <div style={{ height: dotH, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          {strokes > 0 && <span style={{ color: colorOverride || K.hcpBlue, fontSize: 10, fontWeight: 900, letterSpacing: 1, lineHeight: 1 }}>{"•".repeat(strokes)}</span>}
        </div>
        <div style={{ width: sh, height: sh, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: K.t3 + "30", fontSize: size, lineHeight: 1 }}>·</span>
        </div>
      </div>
    );
  }

  const diff = score - par;

  let border = null;
  if (diff <= -2) {
    border = (
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: "50%", border: `1.5px solid ${bc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: sh - 6, height: sh - 6, borderRadius: "50%", border: `1px solid ${bc}` }} />
      </div>
    );
  } else if (diff === -1) {
    border = <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: "50%", border: `1.5px solid ${bc}` }} />;
  } else if (diff === 1) {
    border = <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: 3, border: `1.5px solid ${bc}` }} />;
  } else if (diff >= 2) {
    border = (
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: 3, border: `1.5px solid ${bc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: sh - 6, height: sh - 6, borderRadius: 2, border: `1px solid ${bc}` }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: dotH + sh, justifyContent: "flex-end" }}>
      <div style={{ height: dotH, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        {strokes > 0 && <span style={{ color: colorOverride || K.hcpBlue, fontSize: 10, fontWeight: 900, letterSpacing: 1, lineHeight: 1 }}>{"•".repeat(strokes)}</span>}
      </div>
      <div style={{ position: "relative", width: sh, height: sh, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {border}
        <span style={{ position: "relative", zIndex: 1, fontSize: s, fontWeight: 700, lineHeight: 1, transform: "translateY(0.5px)", ...(textColor ? { color: textColor } : {}) }}>{score}</span>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
//  Shared Scorecard — reusable across all views
//  Eliminates 4x duplication of hole/par/player/team/match rows
// ═══════════════════════════════════════════════════════════════

// Shared style constants (created once, reused across renders)
export const GRID_LINE_STYLE = (bdr) => `1px solid ${bdr}25`;
export const COL_BDR_STYLE = (bdr) => `1px solid ${bdr}30`;

export function SharedScorecard({
  pars, side, hcps,
  team1Pids, team2Pids,        // player ID arrays
  getScore,                     // (pid, hole) => score
  getStrokes,                   // (pid, hole) => strokes
  getHcp,                       // (pid) => nine handicap
  getInitials,                  // (pid) => "JC"
  isAbsent,                     // (pid) => bool
  holeResults,                  // [1, -1, 0, ...] from team1 perspective
  runningStatus,                // cumulative
  clinchHole,                   // index or null
  clinchText,                   // "3&2" etc
  variant = "full",             // "full" | "compact" | "allMatches"
  showTotals = false,           // show TOT column
  showMatchRow = true,
  matchGrn,
  team1Label,                   // team name for allMatches
  team2Label,
}) {
  const colBdr = COL_BDR_STYLE(K.bdr);
  const gridLine = GRID_LINE_STYLE(K.bdr);
  const lw = variant === "allMatches" ? 44 : 40;
  const tw = 30;
  const lblStyle = { width: lw, flexShrink: 0, fontSize: 9, fontWeight: 700, color: K.t3, display: "flex", alignItems: "center", paddingLeft: 4, borderRight: variant === "allMatches" ? gridLine : colBdr, textTransform: "uppercase", letterSpacing: .3 };
  const totStyle = showTotals ? { width: tw, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderLeft: colBdr } : null;

  const scoreSize = variant === "compact" ? 13 : 15;
  const parTotal = pars.reduce((a, b) => a + b, 0);

  const HoleRow = () => (
    <div style={{ display: "flex", background: K.acc, borderRadius: variant === "allMatches" ? "6px 6px 0 0" : "10px 10px 0 0" }}>
      <div style={{ ...lblStyle, height: 28, color: K.bg, opacity: .8, borderRight: "none", fontWeight: 800, fontSize: 10 }}>HOLE</div>
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} style={{ flex: 1, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: K.bg }}>{side === 'front' ? i + 1 : i + 10}</span>
        </div>
      ))}
      {totStyle && <div style={{ ...totStyle, height: 28, borderLeft: "none" }}><span style={{ fontSize: 10, fontWeight: 700, color: K.bg }}>TOT</span></div>}
    </div>
  );

  const ParRow = () => (
    <div style={{ display: "flex", borderBottom: gridLine, background: K.acc + "18" }}>
      <div style={{ ...lblStyle, height: variant === "allMatches" ? 26 : 22 }}>PAR</div>
      {pars.map((p, i) => <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 11, color: K.t2, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", height: variant === "allMatches" ? 26 : 22, borderRight: i < 8 ? gridLine : "none" }}>{p}</div>)}
      {totStyle && <div style={{ ...totStyle, height: 22 }}><span style={{ fontSize: 11, fontWeight: 700, color: K.t3 }}>{parTotal}</span></div>}
    </div>
  );

  // Hole-Handicap row — shows the course HCP index for each of the 9 holes.
  // Used on playoff scorecards so viewers can see which hole decided a tiebreaker
  // (the "Hole X" label in a tied match's result corresponds to the lowest HCP
  // index where the net scores differed). Visually lighter than the PAR row.
  const HcpRow = () => (
    <div style={{ display: "flex", borderBottom: gridLine, background: K.inp }}>
      <div style={{ ...lblStyle, height: variant === "allMatches" ? 22 : 20 }}>HCP</div>
      {hcps.map((h, i) => <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: K.t3, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", height: variant === "allMatches" ? 22 : 20, borderRight: i < 8 ? gridLine : "none" }}>{h}</div>)}
      {totStyle && <div style={{ ...totStyle, height: 20 }} />}
    </div>
  );

  const PlayerRow = ({ pid }) => {
    const absent = isAbsent ? isAbsent(pid) : false;
    let grossTotal = 0;
    const cells = Array.from({ length: 9 }, (_, h) => {
      const s = getScore(pid, h); const st = getStrokes(pid, h);
      if (s > 0) grossTotal += s;
      return { s, st };
    });
    return (
      <div style={{ display: "flex", alignItems: "center", borderBottom: gridLine }}>
        <div style={{ ...lblStyle, height: 38, paddingTop: 10 }}>
          <span style={{ fontSize: variant === "allMatches" ? 13 : 15, fontWeight: 800, color: K.t1, width: 24, flexShrink: 0 }}>{getInitials(pid)}</span>
          <span style={{ fontSize: variant === "allMatches" ? 10 : 11, color: K.hcpBlue, fontWeight: 700 }}>{getHcp(pid)}</span>
        </div>
        {cells.map((c, h) => (
          <div key={h} style={{ flex: 1, height: 38, display: "flex", alignItems: "center", justifyContent: "center", borderRight: h < 8 ? gridLine : "none" }}>
            <ScoreCell score={c.s} par={pars[h]} strokes={c.st} size={scoreSize} color={absent ? K.red : undefined} />
          </div>
        ))}
        {totStyle && <div style={{ ...totStyle, height: 38, paddingTop: 10 }}><span style={{ fontSize: 14, fontWeight: 800, color: absent ? K.red : K.t1 }}>{grossTotal || ""}</span></div>}
      </div>
    );
  };

  const TeamNetRow = ({ pids, isTeam1Side }) => {
    let netTotal = 0;
    const isAM = variant === "allMatches";
    return (
      <div style={{ display: "flex", ...(isAM ? { alignItems: "center", background: K.act + "0c" } : {}) }}>
        <div style={{ ...lblStyle, height: isAM ? 28 : 38, fontSize: 9, fontWeight: 800 }}>{isAM ? "NET" : "TEAM"}</div>
        {Array.from({ length: 9 }, (_, h) => {
          let tNet = 0; let ok = true;
          pids.forEach(pid => { const s = getScore(pid, h); if (s <= 0) ok = false; else tNet += s - getStrokes(pid, h); });
          if (ok) netTotal += tNet; else netTotal = NaN;
          const won = holeResults && holeResults[h] === (isTeam1Side ? 1 : -1);

          if (isAM) {
            return <div key={h} style={{
              flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800,
              color: !ok ? K.t3 + "30" : K.t1, lineHeight: "22px",
              padding: "4px 0", borderRight: won ? "none" : gridLine,
              ...(won ? { background: K.bg, border: `1.5px solid ${K.act}`, borderRadius: 3, margin: "-1px 1px", position: "relative", zIndex: 1 } : {}),
            }}>{ok ? tNet : "\u00B7"}</div>;
          }

          return <div key={h} style={{
            flex: 1, height: 38, display: "flex", alignItems: "center", justifyContent: "center",
            borderRight: h < 8 ? gridLine : "none",
          }}>
            {won ? (
              <div style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 3, border: `1.5px solid ${K.act}`, background: K.act + "18" }}>
                <span style={{ fontSize: scoreSize, fontWeight: 800, color: K.t1 }}>{ok ? tNet : "·"}</span>
              </div>
            ) : (
              <span style={{ fontSize: scoreSize, fontWeight: 800, color: ok ? K.t1 : K.t3 + "30" }}>{ok ? tNet : "·"}</span>
            )}
          </div>;
        })}
        {totStyle && <div style={{ ...totStyle, height: 38 }}><span style={{ fontSize: 14, fontWeight: 800, color: K.t1 }}>{isNaN(netTotal) ? "" : netTotal}</span></div>}
      </div>
    );
  };

  // ────────────────────────────────────────────────────────────────
  //  TeamLabelRow — small uppercase team-name header that sits above
  //  each team's PlayerRow stack. Becomes canonical so every scorecard
  //  surface (Schedule expansion, Standings expansion, Scoring All
  //  Matches, Sign Scorecard popup) renders team names with the same
  //  typography.
  //
  //  Renders nothing when no name is passed — keeps existing call sites
  //  that didn't supply team1Label/team2Label working unchanged.
  //  Optional `seed` prop renders a "#N" badge in front of the name,
  //  used during seeded weeks and playoff weeks.
  // ────────────────────────────────────────────────────────────────
  const TeamLabelRow = ({ name, seed }) => {
    if (!name) return null;
    return (
      <div style={{
        fontSize: 9, fontWeight: 700, color: K.acc,
        textTransform: "uppercase", letterSpacing: 1,
        padding: "4px 4px 2px",
      }}>
        {seed != null && <span style={{ color: K.logoBright, marginRight: 4 }}>#{seed}</span>}
        {name}
      </div>
    );
  };

  const MatchRow = () => {
    if (!showMatchRow || !runningStatus) return null;
    const mGrn = matchGrn || K.matchGrn;
    return (
      <div style={{ display: "flex", background: K.card, border: `1px solid ${K.bdr}${variant === "allMatches" ? "40" : "60"}`, borderRadius: variant === "allMatches" ? 6 : 8, padding: "2px 0", margin: variant === "allMatches" ? "4px 0" : "4px 0" }}>
        <div style={{ ...lblStyle, height: 28, fontSize: 8, fontWeight: 800, color: K.t2 }}>MATCH</div>
        {runningStatus.map((rs, i) => {
          const colBorderR = i < 8 ? { borderRight: gridLine } : {};
          const isClinch = clinchHole !== null && i === clinchHole;
          if (clinchHole !== null && i > clinchHole) return <div key={i} style={{ flex: 1, height: 28, ...colBorderR }} />;
          if (isClinch) {
            const color = rs > 0 ? mGrn : rs < 0 ? K.red : K.t3;
            // Tiebreaker clinch like "TIE (Hole 5)" — split into stacked two-line
            // display: big "TIE" on top, small label on bottom.
            const tb = parseTiebreakerResult(clinchText || "");
            if (tb.isTiebreaker) {
              return <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", height: 28, ...colBorderR }}>
                <div style={{ border: `1.5px solid ${color}`, borderRadius: 4, padding: "1px 3px", display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1, maxWidth: "100%" }}>
                  <span style={{ fontSize: variant === "allMatches" ? 9 : 10, fontWeight: 800, color, letterSpacing: .3 }}>TIE</span>
                  <span style={{ fontSize: variant === "allMatches" ? 6 : 7, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: .3, whiteSpace: "nowrap", marginTop: 1 }}>{tb.label}</span>
                </div>
              </div>;
            }
            // Regular clinch ("3&2", "2UP", plain "TIED"): single centered token.
            return <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", height: 28, ...colBorderR }}>
              <div style={{ border: `1.5px solid ${color}`, borderRadius: 4, padding: "0 3px", lineHeight: "22px", maxWidth: "100%" }}>
                <span style={{ fontSize: variant === "allMatches" ? 12 : 14, fontWeight: 800, color, whiteSpace: "nowrap" }}>{clinchText}</span>
              </div>
            </div>;
          }
          const color = rs > 0 ? mGrn : rs < 0 ? K.red : K.t3;
          // null running status branches:
          //   - If the hole has score activity (anyone in the foursome has a
          //     score recorded for this hole), show a ⚠️ marker so the scorer
          //     notices the missing data. Two scenarios produce this state:
          //       1. Scorer forgot to enter one player's score on this hole —
          //          actionable, fix it now.
          //       2. One golfer is playing a make-up round at a different time;
          //          the other 3 are scoring live. The make-up player isn't
          //          "absent" (no teammate-doubling), they're just on a delayed
          //          schedule. The marker stays visible until the make-up
          //          scores are entered, signalling "match status is pending."
          //   - If the hole has no activity at all, render blank — that's just
          //     a future hole nobody has played yet.
          if (rs === null) {
            const checkPids = [...(team1Pids || []), ...(team2Pids || [])].filter(Boolean);
            const holeHasActivity = checkPids.some(pid => getScore(pid, i) > 0);
            if (holeHasActivity) {
              return <div key={i}
                title="Match status pending — scores incomplete on this hole"
                style={{ flex: 1, height: 28, textAlign: "center", lineHeight: "28px", fontSize: variant === "allMatches" ? 11 : 12, opacity: 0.55, ...colBorderR }}>⚠️</div>;
            }
            return <div key={i} style={{ flex: 1, height: 28, ...colBorderR }} />;
          }
          return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: variant === "allMatches" ? 12 : 14, fontWeight: 800, color, lineHeight: "28px", ...colBorderR }}>
            {rs > 0 ? <><span style={{ fontSize: variant === "allMatches" ? 12 : 14 }}>▲</span>{rs}</> : rs < 0 ? <><span style={{ fontSize: variant === "allMatches" ? 12 : 14 }}>▼</span>{Math.abs(rs)}</> : <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: .5 }}>TIED</span>}
          </div>;
        })}
        {totStyle && <div style={{ width: tw, flexShrink: 0, height: 28 }} />}
      </div>
    );
  };

  return { HoleRow, ParRow, HcpRow, PlayerRow, TeamNetRow, MatchRow, TeamLabelRow };
}
