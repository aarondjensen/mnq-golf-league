import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { K, FONTS, I, Pill, BackBtn, SaveBtn, SectionTitle, SubLabel, Card, EmptyState,
  getTeeTime, getWeekSide, calcCourseHandicap, calcNineHandicap, calcLeagueHandicap,
  lastNamesOnly, formatTeeTime as fmtTeeTimeUtil, LIST_GAP, CARD_RADIUS, NAME_SIZE, CHEVRON_SIZE,
  buildSeedMap } from "../theme";
import { LEAGUE_ID } from "../firebase";

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
          {strokes > 0 && <span style={{ color: colorOverride || "#3b82f6", fontSize: 10, fontWeight: 900, letterSpacing: 1, lineHeight: 1 }}>{"•".repeat(strokes)}</span>}
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
        {strokes > 0 && <span style={{ color: colorOverride || "#3b82f6", fontSize: 10, fontWeight: 900, letterSpacing: 1, lineHeight: 1 }}>{"•".repeat(strokes)}</span>}
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
          <span style={{ fontSize: variant === "allMatches" ? 10 : 11, color: "#3b82f6", fontWeight: 700 }}>{getHcp(pid)}</span>
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
            const tbMatch = (clinchText || "").match(/^TIE\s*\(([^)]+)\)\s*$/i);
            if (tbMatch) {
              return <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", height: 28, ...colBorderR }}>
                <div style={{ border: `1.5px solid ${color}`, borderRadius: 4, padding: "1px 3px", display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1, maxWidth: "100%" }}>
                  <span style={{ fontSize: variant === "allMatches" ? 9 : 10, fontWeight: 800, color, letterSpacing: .3 }}>TIE</span>
                  <span style={{ fontSize: variant === "allMatches" ? 6 : 7, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: .3, whiteSpace: "nowrap", marginTop: 1 }}>{tbMatch[1]}</span>
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
          // null = no data (one or both teams missing scores on this hole) — render
          // blank, NOT "TIED". A tie requires actual scores from both teams that
          // happen to be equal; missing data is a different state and the older
          // code conflated them. The collapsed-card cumulative `runningStatus[h]`
          // is also null here, so accumulation correctly skips this hole and
          // resumes on the next hole that has data — but the visible cell needs
          // to clearly say "we don't know yet" rather than "tied".
          if (rs === null) {
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

  return { HoleRow, ParRow, HcpRow, PlayerRow, TeamNetRow, MatchRow };
}


// ═══════════════════════════════════════════════════════════════
//  Helper: compute strokes map for a given handicap
// ═══════════════════════════════════════════════════════════════
function buildStrokesCache(hcps) {
  const cache = {};
  const sorted = hcps.map((h, i) => ({ idx: i, hcp: h })).sort((a, b) => a.hcp - b.hcp);
  return (nh) => {
    if (cache[nh]) return cache[nh];
    const map = {};
    let rem = Math.abs(nh);
    for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + 1; rem--; }
    for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + 1; rem--; }
    cache[nh] = map;
    return map;
  };
}

// ═══════════════════════════════════════════════════════════════
//  Helper: compute hole results and clinch info
// ═══════════════════════════════════════════════════════════════
function computeMatchStatus(t1Pids, t2Pids, getScore, getStrokes, pars) {
  const holeResults = [];
  for (let h = 0; h < 9; h++) {
    let n1 = 0, n2 = 0, ok1 = true, ok2 = true;
    t1Pids.forEach(pid => { const s = getScore(pid, h); if (s <= 0) ok1 = false; else n1 += s - getStrokes(pid, h); });
    t2Pids.forEach(pid => { const s = getScore(pid, h); if (s <= 0) ok2 = false; else n2 += s - getStrokes(pid, h); });
    if (ok1 && ok2) holeResults.push(n1 < n2 ? 1 : n2 < n1 ? -1 : 0);
    else holeResults.push(null);
  }
  const runningStatus = []; let cum = 0;
  holeResults.forEach(r => { if (r !== null) cum += r; runningStatus.push(r !== null ? cum : null); });

  let clinchHole = null, clinchText = null;
  for (let h = 0; h < 9; h++) {
    if (runningStatus[h] === null) break;
    const lead = Math.abs(runningStatus[h]);
    const rem = 8 - h;
    if (lead > rem) {
      clinchHole = h;
      clinchText = rem > 0 ? `${lead}&${rem}` : `${lead}UP`;
      break;
    }
  }
  if (clinchHole === null && runningStatus.length === 9 && runningStatus[8] !== null) {
    clinchHole = 8;
    const f = runningStatus[8];
    clinchText = f !== 0 ? `${Math.abs(f)}UP` : "TIED";
  }

  return { holeResults, runningStatus, clinchHole, clinchText };
}


// ═══════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function LiveScoringView({ leagueUser, players, teams, course, schedule, holeScores, saveScore, scoringRules, matchResults, saveMatchResult, deleteMatchResult, ctpData, saveCtp, setLiveWeek, fetchWeekScores, isComm, leagueConfig, saveWeekSchedule, setWeekSchedule, deleteWeekSchedule, openAllMatches, onAllMatchesOpened, forceWeek, onForceWeekUsed, setPopupOpen, recalcHandicaps, clearWeekData, autoSeedIfReady }) {
  const [activeMatch, setActiveMatch] = useState(null);
  const [curHole, setCurHole] = useState(0);
  // 3-way view toggle: "myMatch" (default scoring view), "allMatches" (week overview), "lowNet" (leaderboard)
  // Kept as derived alias for backward-compat with existing code paths.
  const [view, setView] = useState("myMatch");
  const showAllMatches = view === "allMatches";
  const showLowNet = view === "lowNet";
  const setShowAllMatches = (b) => setView(b ? "allMatches" : "myMatch");
  const [expandedMatch, setExpandedMatch] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (openAllMatches) {
      setShowAllMatches(true);
      setActiveMatch(null);
      if (onAllMatchesOpened) onAllMatchesOpened();
    }
  }, [openAllMatches]);
  const [editing, setEditing] = useState(false);
  const [showScorecard, setShowScorecard] = useState(false);
  const [showFinalize, setShowFinalize] = useState(false);
  const [showEditConfirm, setShowEditConfirm] = useState(false);
  const [absentPlayers, setAbsentPlayers] = useState({});
  const [confirmModal, setConfirmModal] = useState(null);
  const [justSigned, setJustSigned] = useState(false); // prevents flash between sign and Firestore update
  const [showCtpPopup, setShowCtpPopup] = useState(false);
  const [ctpSelections, setCtpSelections] = useState({}); // { holeNum: { playerId, distance } }
  const [lowNetSort, setLowNetSort] = useState("net"); // "net" | "gross" — Low Net leaderboard sort column
  const [lowNetDir, setLowNetDir] = useState("asc"); // "asc" (best→worst) | "desc" (worst→best) — Low Net sort direction
  const initialJump = useRef(false);
  const matchGrn = K.matchGrn;

  // Notify App.jsx when popups open/close for body scroll lock
  useEffect(() => {
    if (setPopupOpen) setPopupOpen(showFinalize || showScorecard || !!confirmModal || showCtpPopup);
  }, [showFinalize, showScorecard, confirmModal, showCtpPopup, setPopupOpen]);

  // ── Player lookup map (O(1) instead of repeated .find()) ──
  const playerMap = useMemo(() => {
    const m = {};
    players.forEach(p => { m[p.id] = p; });
    return m;
  }, [players]);

  const currentWeek = useMemo(() => {
    if (forceWeek) return forceWeek;
    for (const wk of schedule) {
      if (wk.rainedOut) continue;
      if (!wk.matches || wk.matches.length === 0) continue;
      if (!wk.locked) return wk.week;
    }
    const playable = schedule.filter(wk => !wk.rainedOut && wk.matches && wk.matches.length > 0);
    return playable.length ? playable[playable.length - 1].week : 0;
  }, [schedule, matchResults, forceWeek]);

  const week = currentWeek;
  useEffect(() => { setLiveWeek(week); }, [week, setLiveWeek]);
  // Clear the forceWeek after it's been consumed
  useEffect(() => { if (forceWeek && onForceWeekUsed) onForceWeekUsed(); }, [forceWeek]);

  const weekSch = schedule.find(s => s.week === week);
  const matches = weekSch?.matches || [];
  const side = weekSch?.side || getWeekSide(week);
  const pars = course ? (side === 'front' ? course.frontPars : course.backPars) : [4,4,4,3,5,4,4,3,5];
  const hcps = course ? (side === 'front' ? course.frontHcps : course.backHcps) : [1,3,5,7,9,11,13,15,17];
  const myTeam = teams.find(t => t.player1 === leagueUser.playerId || t.player2 === leagueUser.playerId);
  const myMatch = myTeam ? matches.find(m => m.team1 === myTeam.id || m.team2 === myTeam.id) : null;

  // ── Memoized strokes calculator ──
  const getStrokesMap = useMemo(() => buildStrokesCache(hcps), [hcps]);

  // Seed numbers for team cards during seeded/playoff weeks (1 = best per current standings
  // or locked-seeds snapshot). Hidden on pure round-robin weeks where every team plays every
  // other team equally and seeds aren't meaningful.
  const showSeeds = (weekSch?.seeded === true) || (weekSch?.isPlayoff === true);
  const seedMap = useMemo(() => {
    if (!showSeeds) return {};
    return buildSeedMap(teams, matchResults, schedule, leagueConfig);
  }, [showSeeds, teams, matchResults, schedule, leagueConfig]);

  const isWeekLocked = weekSch?.locked === true;
  const allMatchesFinalized = matches.every(m =>
    matchResults.some(r => r.week === week && r.team1Id === m.team1 && r.team2Id === m.team2)
  );
  const allMatchesAttested = matches.every(m =>
    matchResults.some(r => r.week === week && r.team1Id === m.team1 && r.team2Id === m.team2 && r.attested === true)
  );

  // ── Finalize-week banner ──
  // When every match in the week is attested but the week isn't locked, the
  // commissioner needs to do a final pass (assign Closest-to-the-Pin winners,
  // then lock the week). The legacy entry point lives at the bottom of the
  // All Matches view, but commissioners frequently miss it because they
  // don't switch tabs after attestation completes. This banner surfaces the
  // action at the top of EVERY scoring view (My Match, All Matches, Low Net)
  // so the next step is always one tap away.
  //
  // openFinalize replicates the existing button's logic — pre-populate CTP
  // selections from any prior week-CTP records, then open the popup. The
  // popup itself (line ~1355) is unchanged; it owns the actual lock + recalc.
  const openFinalize = () => {
    const par3Holes = pars.map((p, i) => p === 3 ? (side === 'front' ? i + 1 : i + 10) : null).filter(Boolean);
    const existing = {};
    par3Holes.forEach(h => {
      const c = ctpData.find(cd => cd.week === week && cd.holeNum === h);
      if (c) existing[h] = { playerId: c.playerId || "", distance: c.distance || "" };
    });
    setCtpSelections(existing);
    setShowCtpPopup(true);
  };
  const showFinalizeBanner = isComm && allMatchesAttested && !isWeekLocked && !!saveWeekSchedule;
  const FinalizeBanner = showFinalizeBanner ? (
    <button
      onClick={openFinalize}
      style={{
        width: "100%", padding: "10px 14px", borderRadius: 10,
        marginBottom: 8, cursor: "pointer",
        background: K.act, border: "none", color: K.bg,
        fontSize: 13, fontWeight: 800, letterSpacing: .3,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        boxShadow: `0 2px 8px ${K.act}40`,
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, opacity: .85, letterSpacing: 1, textTransform: "uppercase" }}>Ready</span>
      <span>Finalize Week {week}</span>
      <span style={{ fontSize: 16, fontWeight: 800, opacity: .85 }}>›</span>
    </button>
  ) : null;

  if (!course?.name) return <EmptyState icon="flag" title="Course not configured" subtitle="Commissioner needs to set up the course." />;
  if (!matches.length) return <EmptyState icon="calendar" title="No matches this week" subtitle="Commissioner needs to set the schedule." />;

  // ── Onboarding fallback ──
  // A brand-new user can land here with no match of their own to score — either
  // because they're not linked to a player yet (commissioner hasn't assigned
  // them from the Accounts admin page), or their player isn't on a team yet,
  // or their team happens to have a bye this week. Without this guard, the
  // default "myMatch" view falls through to code below that assumes `t1`/`t2`
  // are non-null and crashes.
  //
  // Fix: if the user has no `myMatch` and hasn't opened a specific match via
  // the All Matches view, route them to All Matches so they can see what's
  // happening. If they ALSO don't have a linked player at all, show a clear
  // empty state pointing them at the commissioner.
  if (!activeMatch && !myMatch) {
    // No linked player at all → explain what's going on.
    if (!leagueUser.playerId) {
      return <EmptyState icon="user" title="Account not linked" subtitle="Your commissioner needs to link your account to a player profile before you can score. In the meantime, you can view other matches from the Schedule tab." />;
    }
    // Linked to a player but no match this week (not on a team, bye, etc.)
    // → auto-switch to All Matches view so they can browse everyone else's games.
    // Using a render-triggered side effect here is intentional and safe because
    // the state change forces a re-render that takes the `showAllMatches`
    // branch above; no infinite loop (guard condition changes on re-render).
    if (view !== "allMatches") {
      setView("allMatches");
      return null;
    }
  }

  const matchToScore = activeMatch || myMatch;
  const t1 = matchToScore ? teams.find(t => t.id === matchToScore.team1) : null;
  const t2 = matchToScore ? teams.find(t => t.id === matchToScore.team2) : null;
  const matchKey = matchToScore ? `${matchToScore.team1}_${matchToScore.team2}` : "_none_";

  const prevMatchKey = useRef(matchKey);
  useEffect(() => {
    if (prevMatchKey.current !== matchKey) {
      setCurHole(0);
      initialJump.current = false;
      setEditing(false);
      setShowScorecard(false);
      setShowFinalize(false);
      prevMatchKey.current = matchKey;
    }
  }, [matchKey]);

  const prevPlayerId = useRef(leagueUser.playerId);
  useEffect(() => {
    if (prevPlayerId.current !== leagueUser.playerId) {
      setShowFinalize(false);
      setShowEditConfirm(false);
      setShowAllMatches(false);
      setActiveMatch(null);
      setExpandedMatch(null);
      setShowScorecard(false);
      prevPlayerId.current = leagueUser.playerId;
    }
  }, [leagueUser.playerId]);

  const scoringFormat = leagueConfig?.scoringFormat || "lowHighBonus";
  const isTeamNet = scoringFormat === "teamNetTotal";

  const t1Players = t1 ? [t1.player1, t1.player2] : [];
  const t2Players = t2 ? [t2.player1, t2.player2] : [];
  const getHcp = (pid) => {
    const p = playerMap[pid];
    return p ? Math.round(p.handicapIndex || 0) : 0;
  };

  // Absent player helpers
  const getTeammate = (pid) => {
    if (t1Players.includes(pid)) return t1Players.find(p => p !== pid);
    if (t2Players.includes(pid)) return t2Players.find(p => p !== pid);
    return null;
  };
  const isPlayerAbsent = (pid) => !!absentPlayers[pid];
  const isBothAbsent = (pid) => {
    const tm = getTeammate(pid);
    return isPlayerAbsent(pid) && tm && isPlayerAbsent(tm);
  };
  const toggleAbsent = (pid) => {
    const nowAbsent = !absentPlayers[pid];
    setAbsentPlayers(prev => {
      const next = { ...prev };
      if (nowAbsent) next[pid] = true; else delete next[pid];
      return next;
    });
    saveScore(week, pid, "absent", nowAbsent ? 1 : 0);
  };

  // Sync local absent state from Firestore. Reruns whenever:
  //  - matchKey changes (user navigates to a different match)
  //  - holeScores updates (Firestore subscription delivers data)
  //
  // The holeScores dep is critical: on app cold-start, this effect fires once
  // before Firestore has responded — at that point `holeScores` is empty and
  // every `_habsent` read is undefined, so we'd reset absentPlayers to {}.
  // Without holeScores in the deps, the effect would never re-run when the
  // real data arrived, leaving absent flags silently dropped on reopen.
  // The user-visible bug: mark someone absent → close/reopen app → they're
  // shown as present again, even though Firestore still has the absent flag.
  //
  // The early-return guard avoids a setState (and the resulting re-render) on
  // every score keystroke when the absent set hasn't actually changed —
  // holeScores updates fire constantly during scoring, but absent state
  // changes rarely.
  useEffect(() => {
    if (!t1 || !t2) return;
    const abs = {};
    [...t1Players, ...t2Players].forEach(pid => {
      if (holeScores[`w${week}_p${pid}_habsent`] === 1) abs[pid] = true;
    });
    const sameKeys = Object.keys(abs).sort().join(",");
    const prevKeys = Object.keys(absentPlayers).sort().join(",");
    if (sameKeys === prevKeys) return;
    setAbsentPlayers(abs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey, holeScores, week]);

  const allP = (t1 && t2) ? (isTeamNet
    ? [...t1Players, ...t2Players]
    : (() => { const t1s = [...t1Players].sort((a, b) => getHcp(a) - getHcp(b)); const t2s = [...t2Players].sort((a, b) => getHcp(a) - getHcp(b)); return [t1s[0], t2s[0], t1s[1], t2s[1]]; })()
  ) : [];

  const par = pars[curHole] || 4;
  const hcp = hcps[curHole] || 1;

  const getRawScore = (pid, h) => holeScores[`w${week}_p${pid}_h${h}`] || 0;
  const getS = (pid, h) => {
    if (isPlayerAbsent(pid)) {
      const tm = getTeammate(pid);
      if (!tm || isPlayerAbsent(tm)) {
        const strokes = getStrokesMap(getHcp(pid))[h] || 0;
        return (pars[h] || 4) + 1 + strokes;
      }
      return getRawScore(tm, h);
    }
    return getRawScore(pid, h);
  };
  const getNineHcp = (pid) => {
    if (isBothAbsent(pid)) return getHcp(pid);
    const effectivePid = isPlayerAbsent(pid) ? (getTeammate(pid) || pid) : pid;
    const p = playerMap[effectivePid];
    return p ? Math.round(p.handicapIndex || 0) : 0;
  };
  const getStrokes = (pid, h) => getStrokesMap(getNineHcp(pid))[h] || 0;
  const getRunning = (pid) => {
    let gross = 0, net = 0, thru = 0, parTotal = 0;
    for (let h = 0; h < 9; h++) { const s = getS(pid, h); if (s > 0) { gross += s; net += s - getStrokes(pid, h); parTotal += pars[h] || 4; thru++; } }
    return { gross, net, netVsPar: net - parTotal, thru };
  };
  const allComplete = allP.length > 0 && allP.every(pid => { for (let h = 0; h < 9; h++) if (getS(pid, h) <= 0) return false; return true; });
  const holeComplete = allP.length > 0 && allP.every(pid => getS(pid, curHole) > 0);

  const existingResult = (t1 && t2) ? matchResults.find(r => r.week === week && r.team1Id === t1.id && r.team2Id === t2.id) : null;
  const isAlreadyFinalized = !!existingResult;

  // Clear justSigned and close popup once Firestore confirms the result
  useEffect(() => {
    if (isAlreadyFinalized && justSigned) {
      setJustSigned(false);
      setShowFinalize(false);
    }
  }, [isAlreadyFinalized, justSigned]);
  const isAttested = existingResult?.attested === true;
  const finalizedByTeamId = existingResult?.finalizedByTeamId || null;
  const signedByPlayerId = existingResult?.signedByPlayerId || null;
  const isTheSigner = leagueUser.playerId === signedByPlayerId;
  const isOnFinalizingTeam = myTeam && (finalizedByTeamId === myTeam.id || isTheSigner);
  const isOnOpposingTeam = myTeam && !isOnFinalizingTeam && (myTeam.id === (t1?.id) || myTeam.id === (t2?.id));

  // Multi-player attestation: all non-signing PRESENT players must attest
  const attestedBy = existingResult?.attestedBy || [];
  const allMatchPids = [...t1Players, ...t2Players];
  const nonSignerPids = allMatchPids.filter(pid => pid !== signedByPlayerId && !isPlayerAbsent(pid));
  // If no present non-signers (all absent), the signer's signature is sufficient
  const isFullyAttested = isAlreadyFinalized && (nonSignerPids.length === 0 || nonSignerPids.every(pid => attestedBy.includes(pid)));
  const iHaveAttested = attestedBy.includes(leagueUser.playerId);
  const isInThisMatch = allMatchPids.includes(leagueUser.playerId) || isComm;
  const needsAttestation = isAlreadyFinalized && !isFullyAttested && isInThisMatch && !isTheSigner && !iHaveAttested && !isPlayerAbsent(leagueUser.playerId);
  const scoresLocked = (isWeekLocked && !isComm) || (isFullyAttested && !isComm);

  // Tee time early-entry warning
  const teeTimeWarningDismissed = useRef(false);
  // Reset when match changes
  useEffect(() => { teeTimeWarningDismissed.current = false; }, [matchKey]);

  const getMatchTeeTimeMinutes = () => {
    if (!matchToScore || !matches.length) return null;
    const matchIdx = matches.indexOf(matchToScore);
    if (matchIdx < 0) return null;
    const base = leagueConfig?.startTime || "4:28 PM";
    const interval = leagueConfig?.teeInterval || 8;
    const [timePart, ampm] = base.split(' ');
    const [h, m] = timePart.split(':').map(Number);
    return (ampm === 'PM' && h !== 12 ? h + 12 : h) * 60 + m + matchIdx * interval;
  };

  const isBeforeTeeTime = () => {
    const teeMinutes = getMatchTeeTimeMinutes();
    if (teeMinutes === null) return false;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return nowMinutes < teeMinutes;
  };

  const guardedSaveScore = (w, pid, h, val) => {
    if (scoresLocked) {
      setToast(isWeekLocked ? "Week is locked — scores cannot be changed" : "Scorecard attested — only commissioner can edit");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    // Check if before tee time (prompt every attempt until confirmed)
    if (!teeTimeWarningDismissed.current && isBeforeTeeTime()) {
      setConfirmModal({
        title: "Early Score Entry",
        message: "You are trying to enter scores before your scheduled tee time. Continue?",
        onConfirm: () => { teeTimeWarningDismissed.current = true; setConfirmModal(null); saveScore(w, pid, h, val); },
      });
      return;
    }
    saveScore(w, pid, h, val);
  };

  const currentHoleIdx = (() => {
    for (let h = 0; h < 9; h++) { if (!allP.every(pid => getS(pid, h) > 0)) return h; }
    return 8;
  })();

  const hasAnyScores = allP.some(pid => { for (let h = 0; h < 9; h++) if (getS(pid, h) > 0) return true; return false; });

  // Initial hole-auto-jump for live scoring: when opening a match mid-round, jump to the
  // first unscored hole so the user doesn't start at hole 1. Original version had `[]` deps
  // and fired once on mount, but at mount Firestore scores haven't arrived yet so
  // currentHoleIdx was usually 0 and the jump never fired. Re-running until we've jumped
  // once (guarded by initialJump.current) ensures we catch the first render where scores
  // are present.
  useEffect(() => {
    if (initialJump.current) return;
    if (hasAnyScores) {
      if (currentHoleIdx > 0) setCurHole(currentHoleIdx);
      initialJump.current = true;
    }
  }, [currentHoleIdx, hasAnyScores]);

  // Signature of the current hole's scores — changes whenever ANY player's
  // score on this hole changes, even if the hole remains "complete" through
  // the change (e.g. editing a 2 to a 3). Used as an effect dep below so the
  // auto-advance timer restarts on every edit rather than locking in at the
  // moment the hole first becomes complete.
  const curHoleScoreSig = allP.map(pid => getS(pid, curHole)).join(",");

  useEffect(() => {
    if (holeComplete && curHole < 8 && !editing && !allComplete) {
      const holeNum = side === 'front' ? curHole + 1 : curHole + 10;
      setToast(`✓ Hole ${holeNum} saved — advancing...`);
      const timer = setTimeout(() => {
        setToast(null);
        let next = curHole + 1;
        while (next < 8 && allP.every(pid => getS(pid, next) > 0)) next++;
        setCurHole(next);
      }, 1800);
      return () => clearTimeout(timer);
    }
    // Include curHoleScoreSig so that editing a score within the 1800ms window
    // (e.g. correcting a 2 to a 3 before auto-advance fires) cancels the old
    // timer and starts a fresh one. Without this dep, the timer latches at the
    // moment of first completion and can't be interrupted by subsequent edits
    // on the same hole — producing the confusing "I pressed − and the screen
    // jumped to the next hole" behavior new users report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeComplete, curHole, editing, allComplete, curHoleScoreSig]);

  useEffect(() => {
    if (toast) {
      const safety = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(safety);
    }
  }, [toast]);

  useEffect(() => {
    if (allComplete && !showFinalize && !isAlreadyFinalized && !justSigned) {
      const timer = setTimeout(() => setShowFinalize(true), 400);
      return () => clearTimeout(timer);
    }
  }, [allComplete, isAlreadyFinalized, justSigned]);

  // ── Shared helper: get initials (with absent fallback) ──
  const getInitials = useCallback((pid) => {
    const effectivePid = isPlayerAbsent(pid) ? (getTeammate(pid) || pid) : pid;
    const pl = playerMap[effectivePid];
    return pl ? pl.name.split(' ').map(n => n[0]).join('') : "?";
  }, [playerMap, absentPlayers]);

  // ── Commish: force-attest all signed-but-unattested matches for this week ──
  // Normal flow requires every present non-signer to tap Attest individually.
  // This bypasses that when the real-world attestation loop stalls (e.g. players
  // left, commissioner needs to close out the week).
  const weekSignedUnattestedCount = useMemo(() => {
    return matchResults.filter(r => r.week === week && !r.attested).length;
  }, [matchResults, week]);

  const handleAttestAllWeek = () => {
    const pending = matchResults.filter(r => r.week === week && !r.attested);
    if (pending.length === 0) {
      setToast("No signed matches pending attestation");
      setTimeout(() => setToast(null), 2000);
      return;
    }
    setConfirmModal({
      title: `Force-attest ${pending.length} match${pending.length === 1 ? "" : "es"}?`,
      message: `This bypasses the opposing-team signature requirement for all signed matches in Week ${week}. Use when the normal attestation flow is blocked.`,
      onConfirm: async () => {
        setConfirmModal(null);
        for (const r of pending) {
          // Populate attestedBy with all non-signer player IDs so downstream UI checks
          // (e.g., isFullyAttested, "N of M attested" badges) stay internally consistent
          // with attested:true.
          const t1 = teams.find(t => t.id === r.team1Id);
          const t2 = teams.find(t => t.id === r.team2Id);
          const allPids = [t1?.player1, t1?.player2, t2?.player1, t2?.player2].filter(Boolean);
          const nonSignerPids = allPids.filter(pid => pid !== r.signedByPlayerId);
          await saveMatchResult({ ...r, attested: true, attestedBy: nonSignerPids });
        }
        setToast(`${pending.length} match${pending.length === 1 ? "" : "es"} attested`);
        setTimeout(() => setToast(null), 2000);
      },
    });
  };

  // ── Three-way view toggle helper (used by My Match, All Matches, and Low Net views) ──
  const ViewToggle = () => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: K.t3, textTransform: "uppercase", letterSpacing: 1.5 }}>Week {week}</span>
        {weekSch?.date && <span style={{ fontSize: 10, color: K.t3 }}>{weekSch.date}</span>}
      </div>
      <div style={{ display: "flex", background: K.inp, borderRadius: 20, border: `1px solid ${K.bdr}`, padding: 3 }}>
        {[
          { id: "myMatch", label: "My Match" },
          { id: "allMatches", label: "All Matches" },
          { id: "lowNet", label: "Low Net" },
        ].map(opt => {
          const isActive = view === opt.id;
          return (
            <button key={opt.id} onClick={() => { if (!isActive) setView(opt.id); }} style={{
              padding: "6px 14px", borderRadius: 17,
              cursor: isActive ? "default" : "pointer",
              fontSize: 12, fontWeight: 700, border: "none",
              background: isActive ? K.acc : "transparent",
              color: isActive ? K.bg : K.t3,
              transition: "all .2s",
            }}>{opt.label}</button>
          );
        })}
      </div>
    </div>
  );

  // ── All Matches view ──
  if (showAllMatches && !activeMatch) {
    const formatTeeTime = (idx) => fmtTeeTimeUtil(leagueConfig?.startTime || "4:28 PM", idx, leagueConfig?.teeInterval || 8);
    const dn = (pid) => {
      const pl = playerMap[pid];
      if (!pl) return "TBD";
      const parts = pl.name.split(' ');
      return parts.length > 1 ? parts[parts.length - 1] : parts[0];
    };
    const amGetHcp = (pid) => {
      const absent = holeScores[`w${week}_p${pid}_habsent`] === 1;
      if (absent) {
        // Find teammate
        const allPidsForMatch = matches.flatMap(m => {
          const mt1 = teams.find(t => t.id === m.team1);
          const mt2 = teams.find(t => t.id === m.team2);
          return [mt1?.player1, mt1?.player2, mt2?.player1, mt2?.player2].filter(Boolean);
        });
        // Find which team this player is on
        for (const m of matches) {
          const mt1 = teams.find(t => t.id === m.team1);
          const mt2 = teams.find(t => t.id === m.team2);
          const t1p = [mt1?.player1, mt1?.player2].filter(Boolean);
          const t2p = [mt2?.player1, mt2?.player2].filter(Boolean);
          if (t1p.includes(pid)) {
            const tm = t1p.find(p => p !== pid);
            if (tm && holeScores[`w${week}_p${tm}_habsent`] !== 1) {
              const p = playerMap[tm]; return p ? Math.round(p.handicapIndex || 0) : 0;
            }
            break;
          }
          if (t2p.includes(pid)) {
            const tm = t2p.find(p => p !== pid);
            if (tm && holeScores[`w${week}_p${tm}_habsent`] !== 1) {
              const p = playerMap[tm]; return p ? Math.round(p.handicapIndex || 0) : 0;
            }
            break;
          }
        }
      }
      const p = playerMap[pid];
      return p ? Math.round(p.handicapIndex || 0) : 0;
    };
    const amGetScore = (pid, h) => holeScores[`w${week}_p${pid}_h${h}`] || 0;
    const amGetStrokes = (pid, h) => getStrokesMap(amGetHcp(pid))[h] || 0;

    const getThru = (mT1Pids, mT2Pids) => {
      let thru = 0;
      for (let h = 0; h < 9; h++) {
        const presentPids = [...mT1Pids, ...mT2Pids].filter(pid => holeScores[`w${week}_p${pid}_habsent`] !== 1);
        const allOk = presentPids.length > 0 && presentPids.every(pid => amGetScore(pid, h) > 0);
        if (allOk) thru = h + 1;
        else break;
      }
      return thru;
    };

    return (
      <div style={{ maxWidth: 540, margin: "0 auto" }}>
        <ViewToggle />
        {FinalizeBanner}

        <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
          {matches.map((m, mi) => {
            const rawT1 = teams.find(t => t.id === m.team1);
            const rawT2 = teams.find(t => t.id === m.team2);
            if (!rawT1 || !rawT2) return null;
            const res = matchResults.find(r => r.week === week && r.team1Id === m.team1 && r.team2Id === m.team2);
            const isMyMatch = myTeam && (m.team1 === myTeam.id || m.team2 === myTeam.id);
            const isExp = expandedMatch === mi;

            const swapped = isMyMatch && m.team2 === myTeam.id;
            const dispT1 = swapped ? rawT2 : rawT1;
            const dispT2 = swapped ? rawT1 : rawT2;
            const score1 = res ? (swapped ? res.team2Points : res.team1Points) : null;
            const score2 = res ? (swapped ? res.team1Points : res.team2Points) : null;

            const mT1Pids = [rawT1.player1, rawT1.player2];
            const mT2Pids = [rawT2.player1, rawT2.player2];
            const thru = getThru(mT1Pids, mT2Pids);

            // Compute live match score (collapsed card header).
            // Must be absent-aware: when a player is absent, their teammate's
            // score is substituted (mirroring how the expanded scorecard's MATCH
            // row computes hole results via amGetEffectiveScore at line ~971).
            // Without this substitution, an absent player's missing score reads
            // as 0 in the net calculation, making their side appear to win every
            // hole by a huge margin — which is how a match that's actually 1UP
            // through 5 was displaying as "5UP" in the card header.
            //
            // Both teammates absent: imputed net-bogey (par + 1 + strokes), same
            // fallback amGetEffectiveScore uses.
            const isAbsentLocal = (pid) => holeScores[`w${week}_p${pid}_habsent`] === 1;
            const teammateOf = (pid) => {
              if (mT1Pids.includes(pid)) return mT1Pids.find(p => p !== pid);
              if (mT2Pids.includes(pid)) return mT2Pids.find(p => p !== pid);
              return null;
            };
            const effectiveScore = (pid, h) => {
              if (isAbsentLocal(pid)) {
                const tm = teammateOf(pid);
                if (!tm || isAbsentLocal(tm)) {
                  const strokesOnHole = getStrokesMap(amGetHcp(pid))[h] || 0;
                  return (pars[h] || 4) + 1 + strokesOnHole;
                }
                return amGetScore(tm, h);
              }
              return amGetScore(pid, h);
            };

            let dispCum = 0;
            if (thru > 0) {
              let cum = 0;
              for (let h = 0; h < thru; h++) {
                let n1 = 0, n2 = 0;
                mT1Pids.forEach(pid => { n1 += effectiveScore(pid, h) - amGetStrokes(pid, h); });
                mT2Pids.forEach(pid => { n2 += effectiveScore(pid, h) - amGetStrokes(pid, h); });
                if (n1 < n2) cum += 1; else if (n2 < n1) cum -= 1;
              }
              dispCum = swapped ? -cum : cum;
            }

            const isFinalOrSigned = !!res;
            const isTied = isFinalOrSigned ? (score1 === score2) : (thru > 0 && dispCum === 0);
            const matchIsTied = res?.matchResultText === "TIED";
            const t1Leading = matchIsTied ? false : isFinalOrSigned ? (score1 > score2) : (dispCum > 0);
            const t2Leading = matchIsTied ? false : isFinalOrSigned ? (score2 > score1) : (dispCum < 0);

            const isSigned = isFinalOrSigned && res && !res.attested;
            const signerIsRawT1 = isSigned && res.finalizedByTeamId === rawT1.id;
            const signerIsRawT2 = isSigned && res.finalizedByTeamId === rawT2.id;
            const resAttestedBy = res?.attestedBy || [];
            const resAllPids = [...mT1Pids, ...mT2Pids];
            const resAbsent = (pid) => holeScores[`w${week}_p${pid}_habsent`] === 1;
            const resNonSigners = resAllPids.filter(pid => pid !== res?.signedByPlayerId && !resAbsent(pid));
            const resAttestedCount = resNonSigners.filter(pid => resAttestedBy.includes(pid)).length;
            const attestNeededDispT1 = isSigned && (
              (swapped && signerIsRawT1) || (!swapped && signerIsRawT2)
            );
            const attestNeededDispT2 = isSigned && !attestNeededDispT1;

            let centerText = "";
            let centerColor = K.t1;
            let progressLabel = "";
            let progressColor = K.t3;

            if (isFinalOrSigned) {
              centerText = res.matchResultText || `${score1}-${score2}`;
              centerColor = matchIsTied ? K.t3 : K.t1;
              if (res.attested) { progressLabel = "FINAL"; progressColor = K.grn; }
              // When signed-but-not-yet-fully-attested, leave the center strip clean —
              // the N/M ATTEST counter lives in the attesters row below now.
            } else if (thru > 0) {
              if (dispCum > 0) { centerText = dispCum + "UP"; centerColor = K.t1; }
              else if (dispCum < 0) { centerText = Math.abs(dispCum) + "UP"; centerColor = K.t1; }
              else { centerText = "AS"; centerColor = K.t3; }
              progressLabel = "Thru " + thru;
            } else {
              centerText = formatTeeTime(mi);
              centerColor = K.act;
            }

            return (
              <div key={mi} style={{
                background: K.card,
                borderRadius: 10,
                border: isMyMatch ? `1.5px solid ${K.act}` : `1px solid ${K.bdr}60`,
                overflow: "hidden",
                boxShadow: isMyMatch ? `0 2px 8px ${K.act}18` : "0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.08)",
              }}>
                <button onClick={() => setExpandedMatch(isExp ? null : mi)} style={{ width: "100%", padding: 0, cursor: "pointer", textAlign: "left", background: "transparent", border: "none", display: "block" }}>
                  {/* Standings-style single-row card: [seed · team]  VS/status  [team · seed].
                      Green tint + accent bar on the leading/winning team's half. Team names
                      stack on two lines so both players show in full. */}
                  <div style={{ display: "flex", alignItems: "stretch", minHeight: 60 }}>
                    {/* TEAM 1 — left half. Teammate names always stacked on two lines so
                        the row has a consistent height + rhythm regardless of name length. */}
                    <div style={{
                      flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8,
                      padding: "10px 12px",
                      background: t1Leading ? K.matchGrn + "18" : "transparent",
                      borderLeft: t1Leading ? `3px solid ${K.matchGrn}` : "3px solid transparent",
                      opacity: t2Leading && isFinalOrSigned ? 0.6 : 1,
                    }}>
                      {showSeeds && (
                        <div style={{
                          width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                          background: K.act, border: `1px solid ${K.act}`, color: K.logoBlue,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, fontWeight: 800,
                        }}>{seedMap[dispT1?.id] || "?"}</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>
                          {dn(dispT1?.player1)}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>
                          {dn(dispT1?.player2)}
                        </div>
                      </div>
                    </div>

                    {/* Center strip — tee time/status/result on top, chevron below.
                        Larger font on the main line. Chevron is static (no rotation) so
                        the card doesn't flip when expanded. */}
                    <div style={{
                      flexShrink: 0, minWidth: 76,
                      background: K.inp,
                      display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column",
                      padding: "6px 6px",
                      borderLeft: `1px solid ${K.bdr}40`, borderRight: `1px solid ${K.bdr}40`,
                      gap: 2,
                    }}>
                      <div style={{
                        fontSize: centerText.length > 5 ? 14 : centerText.length > 3 ? 15 : 17, fontWeight: 800,
                        color: centerColor, letterSpacing: .3,
                        whiteSpace: "nowrap", textAlign: "center", lineHeight: 1.05,
                      }}>{centerText}</div>
                      {progressLabel && (
                        <div style={{ fontSize: 9, fontWeight: 700, color: progressColor, textTransform: "uppercase", letterSpacing: .8, whiteSpace: "nowrap" }}>
                          {progressLabel}
                        </div>
                      )}
                      <div style={{
                        fontSize: 11, color: K.t3, lineHeight: 1,
                        marginTop: 2,
                      }}>{isExp ? "▴" : "▾"}</div>
                    </div>

                    {/* TEAM 2 — right half (mirrored: seed on the right). Stacked names too. */}
                    <div style={{
                      flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8,
                      padding: "10px 12px",
                      background: t2Leading ? K.matchGrn + "18" : "transparent",
                      borderRight: t2Leading ? `3px solid ${K.matchGrn}` : "3px solid transparent",
                      justifyContent: "flex-end",
                      opacity: t1Leading && isFinalOrSigned ? 0.6 : 1,
                    }}>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2, textAlign: "right", maxWidth: "100%" }}>
                          {dn(dispT2?.player1)}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2, textAlign: "right", maxWidth: "100%" }}>
                          {dn(dispT2?.player2)}
                        </div>
                      </div>
                      {showSeeds && (
                        <div style={{
                          width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                          background: K.act, border: `1px solid ${K.act}`, color: K.logoBlue,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, fontWeight: 800,
                        }}>{seedMap[dispT2?.id] || "?"}</div>
                      )}
                    </div>
                  </div>
                </button>

                {/* Attestation status — compact, inline. When signed-but-not-attested,
                    we show:
                      1. A small signed-by indicator at the bottom-left
                      2. An attestation progress bar on the bottom edge of the card
                      3. Pending-player initial chips at the bottom-right
                    No full-width text label — the progress bar visually conveys "N of M"
                    without needing to read a counter, and the whole strip is short. */}
                {isSigned && (() => {
                  const pending = resNonSigners.filter(pid => !resAttestedBy.includes(pid));
                  if (!pending.length) return null;

                  const signer = playerMap[res?.signedByPlayerId];
                  const signerLast = signer ? signer.name.split(' ').pop() : null;
                  const totalNeeded = resNonSigners.length;
                  const donePct = totalNeeded > 0 ? (resAttestedCount / totalNeeded) * 100 : 0;

                  return (
                    <div style={{ borderTop: `1px solid ${K.bdr}30` }}>
                      {/* Thin progress bar — blue fill showing attestation progress */}
                      <div style={{ height: 2, background: K.bdr + "30", position: "relative" }}>
                        <div style={{
                          position: "absolute", top: 0, left: 0, bottom: 0,
                          width: `${donePct}%`,
                          background: "#3b82f6",
                          transition: "width .2s",
                        }} />
                      </div>
                      {/* Single status row: signer on left, pending initials on right */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 10px", gap: 8 }}>
                        {signerLast ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: K.t3 }}>
                            <span style={{ fontSize: 9 }}>✓</span>
                            <span style={{ fontWeight: 600 }}>Signed by {signerLast}</span>
                          </div>
                        ) : <div />}
                        {/* Pending initial dots — one per player still to attest */}
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 9, fontWeight: 600, color: K.t3, letterSpacing: .3, marginRight: 2 }}>
                            Pending
                          </span>
                          {pending.map(pid => {
                            const p = playerMap[pid];
                            const initials = p ? p.name.split(' ').map(n => n[0]).join('').toUpperCase() : '?';
                            return (
                              <div key={pid} style={{
                                width: 18, height: 18, borderRadius: "50%",
                                background: "transparent",
                                border: `1.5px solid #3b82f6`,
                                color: "#3b82f6",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 8, fontWeight: 800, letterSpacing: -.2,
                              }}>{initials}</div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Expanded scorecard — uses SharedScorecard */}
                {isExp && (() => {
                  const amIsAbsent = (pid) => holeScores[`w${week}_p${pid}_habsent`] === 1;
                  const amGetTeammate = (pid) => {
                    if (mT1Pids.includes(pid)) return mT1Pids.find(p => p !== pid);
                    if (mT2Pids.includes(pid)) return mT2Pids.find(p => p !== pid);
                    return null;
                  };
                  const amGetEffectiveScore = (pid, h) => {
                    if (amIsAbsent(pid)) {
                      const tm = amGetTeammate(pid);
                      if (!tm || amIsAbsent(tm)) {
                        const nh = amGetHcp(pid);
                        const strokesOnHole = getStrokesMap(nh)[h] || 0;
                        return (pars[h] || 4) + 1 + strokesOnHole;
                      }
                      return amGetScore(tm, h);
                    }
                    return amGetScore(pid, h);
                  };
                  const amGetInitials = (pid) => { const pl = playerMap[pid]; return pl ? pl.name.split(' ').map(n => n[0]).join('') : "?"; };

                  const dispT1Pids = swapped ? mT2Pids : mT1Pids;
                  const dispT2Pids = swapped ? mT1Pids : mT2Pids;

                  // Compute match status from raw T1 perspective, then flip if swapped
                  const rawStatus = computeMatchStatus(mT1Pids, mT2Pids, amGetEffectiveScore, amGetStrokes, pars);
                  const dispHoleResults = swapped ? rawStatus.holeResults.map(r => r !== null ? -r : null) : rawStatus.holeResults;
                  const dispRunning = []; let dCum = 0;
                  dispHoleResults.forEach(r => { if (r !== null) dCum += r; dispRunning.push(r !== null ? dCum : null); });
                  let dispClinchHole = null, dispClinchText = null;
                  for (let h = 0; h < 9; h++) {
                    if (dispRunning[h] === null) break;
                    const lead = Math.abs(dispRunning[h]);
                    const rem = 8 - h;
                    if (lead > rem) {
                      dispClinchHole = h;
                      const updn = dispRunning[h] > 0 ? "UP" : "DN";
                      dispClinchText = rem > 0 ? lead + "&" + rem : lead + updn;
                      break;
                    }
                  }

                  const sc = SharedScorecard({
                    pars, side, hcps, team1Pids: dispT1Pids, team2Pids: dispT2Pids,
                    getScore: amGetEffectiveScore, getStrokes: amGetStrokes, getHcp: amGetHcp,
                    getInitials: amGetInitials, isAbsent: amIsAbsent,
                    holeResults: dispHoleResults, runningStatus: dispRunning,
                    clinchHole: dispClinchHole, clinchText: dispClinchText,
                    variant: "allMatches", showTotals: true, matchGrn,
                  });

                  return (
                    <div style={{ padding: "6px 8px 10px", borderTop: `1px solid ${K.bdr}30` }}>
                      <sc.HoleRow />
                      <sc.ParRow />
                      {weekSch?.isPlayoff && <sc.HcpRow />}
                      <div style={{ fontSize: 9, fontWeight: 700, color: K.acc, textTransform: "uppercase", letterSpacing: 1, padding: "4px 4px 2px" }}>
                        {showSeeds && seedMap[dispT1?.id] && <span style={{ color: K.logoBright, marginRight: 4 }}>#{seedMap[dispT1.id]}</span>}
                        {dispT1.name}
                      </div>
                      {dispT1Pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
                      <sc.TeamNetRow pids={dispT1Pids} isTeam1Side={true} />
                      <sc.MatchRow />
                      <div style={{ fontSize: 9, fontWeight: 700, color: K.acc, textTransform: "uppercase", letterSpacing: 1, padding: "4px 4px 2px" }}>
                        {showSeeds && seedMap[dispT2?.id] && <span style={{ color: K.logoBright, marginRight: 4 }}>#{seedMap[dispT2.id]}</span>}
                        {dispT2.name}
                      </div>
                      {dispT2Pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
                      <sc.TeamNetRow pids={dispT2Pids} isTeam1Side={false} />
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {isComm && (
          <div style={{ marginTop: 12 }}>
            {/* Rain Out button — before week is finalized */}
            {!isWeekLocked && !allMatchesAttested && (
              <button onClick={() => {
                const isRoundRobin = !weekSch.isPlayoff && !weekSch.seeded && !weekSch.makeupFor;
                const lastRRWeekNum = Math.max(0, ...schedule.filter(s =>
                  (!s.isPlayoff && !s.seeded && !s.makeupFor) || (s.makeupFor && !s.isPlayoff)
                ).map(s => s.week));
                // Find first non-locked slot at or after ideal insert position
                const insertTarget = isRoundRobin ? lastRRWeekNum + 1 : weekSch.week + 1;
                let makeupWeekNum = insertTarget;
                while (schedule.some(s => s.week === makeupWeekNum && s.locked === true)) {
                  makeupWeekNum++;
                }
                // Count what will be wiped
                const weekHoleScoreCount = Object.keys(holeScores).filter(k => k.startsWith(`w${week}_`)).length;
                const weekMatchResultCount = matchResults.filter(r => r.week === week).length;
                const weekCtpCount = ctpData.filter(c => c.week === week).length;
                const willWipe = weekHoleScoreCount > 0 || weekMatchResultCount > 0 || weekCtpCount > 0;

                const msgLines = [
                  `This will skip this week and insert a makeup week at week ${makeupWeekNum}. Unlocked future weeks will shift forward. Locked weeks stay put.`,
                ];
                if (willWipe) {
                  const parts = [];
                  if (weekHoleScoreCount > 0) parts.push(`${weekHoleScoreCount} hole score${weekHoleScoreCount === 1 ? "" : "s"}`);
                  if (weekMatchResultCount > 0) parts.push(`${weekMatchResultCount} signed match${weekMatchResultCount === 1 ? "" : "es"}`);
                  if (weekCtpCount > 0) parts.push(`${weekCtpCount} CTP`);
                  msgLines.push("");
                  msgLines.push(`All existing data for this week will be permanently deleted: ${parts.join(", ")}. This data will need to be re-entered at the makeup week.`);
                }
                const msgDetail = msgLines.join("\n");

                setConfirmModal({
                  title: `Rain out Week ${week}?`,
                  message: msgDetail,
                  onConfirm: async () => {
                    const year = leagueConfig?.year || new Date().getFullYear();
                    const parseDate = (dateStr) => {
                      if (!dateStr) return null;
                      const d = new Date(`${dateStr}, ${year}`);
                      return isNaN(d.getTime()) ? null : d;
                    };
                    const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                    // Mark the week as rained out (clear matches since they're moved to makeup)
                    await saveWeekSchedule({ ...weekSch, rainedOut: true, matches: [] });

                    // Hard-delete all partial data from this week so handicaps, stats,
                    // and standings don't carry stale info once the makeup is played.
                    if (clearWeekData) await clearWeekData(week);

                    // Build shift map: non-locked weeks at or after makeupWeekNum skip over locked weeks
                    const lockedWeekNums = new Set(schedule.filter(s => s.locked === true).map(s => s.week));
                    const reserved = new Set(lockedWeekNums);
                    reserved.add(weekSch.week); // rained-out week stays put

                    const ascShifts = schedule
                      .filter(s => s.week >= makeupWeekNum && s.locked !== true && s.week !== weekSch.week)
                      .sort((a, b) => a.week - b.week);

                    const shiftMap = {};
                    let cursor = makeupWeekNum + 1;
                    for (const fw of ascShifts) {
                      while (reserved.has(cursor)) cursor++;
                      shiftMap[fw.week] = cursor;
                      reserved.add(cursor);
                      cursor++;
                    }

                    // Apply shifts descending by new week number
                    const shiftEntries = Object.entries(shiftMap).map(([oldW, newW]) => ({ oldW: parseInt(oldW), newW })).sort((a, b) => b.newW - a.newW);
                    for (const { oldW, newW } of shiftEntries) {
                      const fw = schedule.find(s => s.week === oldW);
                      if (!fw) continue;
                      let newDate = fw.date || "";
                      const parsed = parseDate(fw.date);
                      if (parsed) {
                        parsed.setDate(parsed.getDate() + (newW - oldW) * 7);
                        newDate = fmtDate(parsed);
                      }
                      if (deleteWeekSchedule) await deleteWeekSchedule(fw.id);
                      if (setWeekSchedule) await setWeekSchedule({ ...fw, id: `${LEAGUE_ID}_w${newW}`, week: newW, date: newDate });
                      else await saveWeekSchedule({ ...fw, id: `${LEAGUE_ID}_w${newW}`, week: newW, date: newDate });
                    }

                    // Create makeup week
                    const neighborWeek = schedule.find(s => s.week === makeupWeekNum - 1) || weekSch;
                    let makeupDate = "";
                    const nParsed = parseDate(neighborWeek?.date);
                    if (nParsed) {
                      nParsed.setDate(nParsed.getDate() + 7);
                      makeupDate = fmtDate(nParsed);
                    }
                    const makeupSide = neighborWeek?.side === 'front' ? 'back' : 'front';

                    const makeupDoc = {
                      id: `${LEAGUE_ID}_w${makeupWeekNum}`,
                      week: makeupWeekNum,
                      matches: [...(weekSch.matches || [])],
                      side: weekSch.side || makeupSide,
                      date: makeupDate,
                      makeupFor: weekSch.week,
                      isPlayoff: weekSch.isPlayoff || false,
                      seeded: weekSch.seeded || false,
                    };
                    if (setWeekSchedule) await setWeekSchedule(makeupDoc);
                    else await saveWeekSchedule(makeupDoc);

                    setConfirmModal(null);
                    setToast("Week " + week + " rained out");
                    setTimeout(() => { setToast(null); setShowAllMatches(false); }, 2000);
                  },
                });
              }} style={{ width: "100%", padding: 12, borderRadius: 10, marginBottom: 8, cursor: "pointer", background: K.warn + "15", border: `1.5px solid ${K.warn}50`, color: K.warn, fontSize: 13, fontWeight: 700 }}>
                Rain Out Week {week}
              </button>
            )}
            {/* Attest All Signed — force-attest pending match results for this week */}
            {!isWeekLocked && weekSignedUnattestedCount > 0 && (
              <button onClick={handleAttestAllWeek} style={{ width: "100%", padding: 12, borderRadius: 10, marginBottom: 8, cursor: "pointer", background: "#3b82f615", border: `1.5px solid #3b82f650`, color: "#3b82f6", fontSize: 13, fontWeight: 700 }}>
                Attest All Signed ({weekSignedUnattestedCount})
              </button>
            )}
            {allMatchesAttested && !isWeekLocked && saveWeekSchedule && (
              <button onClick={() => {
                // Identify par 3 holes for CTP selection
                const par3Holes = pars.map((p, i) => p === 3 ? (side === 'front' ? i + 1 : i + 10) : null).filter(Boolean);
                // Pre-fill with existing CTP data for this week
                const existing = {};
                par3Holes.forEach(h => {
                  const c = ctpData.find(cd => cd.week === week && cd.holeNum === h);
                  if (c) existing[h] = { playerId: c.playerId || "", distance: c.distance || "" };
                });
                setCtpSelections(existing);
                setShowCtpPopup(true);
              }} style={{ width: "100%", padding: 14, borderRadius: 12, cursor: "pointer", background: K.act, border: "none", color: K.bg, fontSize: 14, fontWeight: 800 }}>
                Finalize Week {week}
              </button>
            )}
          </div>
        )}

        {/* CTP Selection Popup */}
        {showCtpPopup && (() => {
          const par3Holes = pars.map((p, i) => p === 3 ? (side === 'front' ? i + 1 : i + 10) : null).filter(Boolean);
          const allPlayersSorted = [...players].sort((a, b) => a.name.localeCompare(b.name));

          const handleFinalize = async () => {
            // Save CTP selections
            for (const holeNum of par3Holes) {
              const sel = ctpSelections[holeNum];
              if (sel && sel.playerId) {
                await saveCtp({
                  id: `${LEAGUE_ID}_w${week}_h${holeNum}`,
                  week, holeNum,
                  playerId: sel.playerId,
                  distance: sel.distance || "",
                  season: 2026,
                });
              }
            }
            // Lock the week
            await saveWeekSchedule({ ...weekSch, locked: true });
            // Auto-recalculate all handicaps from updated scores
            if (recalcHandicaps) recalcHandicaps();
            // If this was the last RR week, auto-populate seeded regular-season weeks
            // from current standings so the schedule is ready for seeded play. Also auto-seeds
            // the next playoff round if dependencies are met.
            let autoSeedResult = { seeded: 0, playoff: 0 };
            if (autoSeedIfReady) {
              const r = await autoSeedIfReady(week);
              if (r && typeof r === "object") autoSeedResult = r;
            }
            setShowCtpPopup(false);
            // Build a summary of what got auto-seeded so the commish sees explicit feedback.
            const parts = [];
            if (autoSeedResult.seeded > 0) {
              parts.push(`${autoSeedResult.seeded} seeded week${autoSeedResult.seeded === 1 ? "" : "s"}`);
            }
            if (autoSeedResult.playoff > 0) {
              parts.push(`${autoSeedResult.playoff} playoff round${autoSeedResult.playoff === 1 ? "" : "s"}`);
            }
            setToast(parts.length
              ? `Week ${week} finalized — ${parts.join(" + ")} populated`
              : `Week ${week} finalized`);
            setTimeout(() => {
              setToast(null);
              setShowAllMatches(false);
              setActiveMatch(null);
              setExpandedMatch(null);
            }, 2500);
          };

          return (<>
            <div onClick={() => setShowCtpPopup(false)} data-popup style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 500 }} />
            <div data-popup style={{ position: "fixed", inset: 0, zIndex: 550, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: K.bg, border: `1px solid ${K.bdr}`, borderRadius: 14, padding: "20px", width: "100%", maxWidth: 360 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: K.act, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>Finalize Week {week}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: K.t1, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Closest to the Pin</div>

                {par3Holes.map(holeNum => {
                  const sel = ctpSelections[holeNum] || {};
                  return (
                    <div key={holeNum} style={{ marginBottom: 14, background: K.card, border: `1px solid ${K.bdr}`, borderRadius: 10, padding: "12px" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: K.t1, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Hole {holeNum}</div>
                      <select
                        value={sel.playerId || ""}
                        onChange={e => setCtpSelections(prev => ({ ...prev, [holeNum]: { ...prev[holeNum], playerId: e.target.value } }))}
                        style={{ width: "100%", padding: "10px", borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, marginBottom: 6 }}
                      >
                        <option value="">No winner</option>
                        {allPlayersSorted.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      {sel.playerId && (
                        <input
                          type="text"
                          placeholder="Distance (e.g. 4'6&quot;)"
                          value={sel.distance || ""}
                          onChange={e => setCtpSelections(prev => ({ ...prev, [holeNum]: { ...prev[holeNum], distance: e.target.value } }))}
                          style={{ width: "100%", padding: "8px 10px", borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13 }}
                        />
                      )}
                    </div>
                  );
                })}

                {par3Holes.length === 0 && (
                  <div style={{ fontSize: 13, color: K.t3, padding: "8px 0" }}>No par 3 holes this side</div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button onClick={handleFinalize} style={{ flex: 1, padding: 12, borderRadius: 10, background: K.act, border: "none", color: K.bg, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                    Finalize Week
                  </button>
                  <button onClick={() => setShowCtpPopup(false)} style={{ flex: 1, padding: 12, borderRadius: 10, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </>);
        })()}

        {toast && (
          <div style={{ position: "fixed", top: 30, left: "50%", transform: "translateX(-50%)", background: K.act, color: K.bg, padding: "12px 48px", borderRadius: 12, fontSize: 13, fontWeight: 700, zIndex: 1000, whiteSpace: "nowrap", minWidth: 240, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
            {toast}
          </div>
        )}
        {/* Confirm modal (for rain out etc.) */}
        {confirmModal && (<>
          <div onClick={() => setConfirmModal(null)} data-popup style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 900 }} />
          <div data-popup style={{ position: "fixed", inset: 0, zIndex: 950, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: K.bg, border: `1px solid ${K.bdr}`, borderRadius: 14, padding: "20px", width: "100%", maxWidth: 320 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: K.act, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>MnQ Golf League</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: K.t1, marginBottom: 6 }}>{confirmModal.title}</div>
              <div style={{ fontSize: 13, color: K.t2, lineHeight: 1.5, marginBottom: 16, whiteSpace: "pre-line" }}>{confirmModal.message}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={confirmModal.onConfirm} style={{ flex: 1, padding: 12, borderRadius: 10, background: K.act, border: "none", color: K.bg, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                  Confirm
                </button>
                <button onClick={() => setConfirmModal(null)} style={{ flex: 1, padding: 12, borderRadius: 10, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>)}
      </div>
    );
  }

  // ── Low Net leaderboard view ──
  // Shows every player in the league this week, ranked by net (best to worst).
  // Players without a complete 9-hole round sit at the bottom with em-dashes.
  // Strokes use the player's stored handicap mapped to the course's stroke-index allocation.
  if (showLowNet && !activeMatch) {
    const parTotal = pars.reduce((a, b) => a + b, 0);

    // Build the set of players actually scheduled this week (across all matches)
    const weekPidsSet = new Set();
    matches.forEach(m => {
      const mt1 = teams.find(t => t.id === m.team1);
      const mt2 = teams.find(t => t.id === m.team2);
      [mt1?.player1, mt1?.player2, mt2?.player1, mt2?.player2].filter(Boolean).forEach(pid => weekPidsSet.add(pid));
    });
    const weekPids = Array.from(weekPidsSet);

    const rows = weekPids.map(pid => {
      const pl = playerMap[pid];
      const hcp = pl ? Math.round(pl.handicapIndex || 0) : 0;
      const strokesByHole = getStrokesMap(hcp);
      const isAbsent = holeScores[`w${week}_p${pid}_habsent`] === 1;

      let gross = 0, net = 0, holesPlayed = 0;
      for (let h = 0; h < 9; h++) {
        const s = holeScores[`w${week}_p${pid}_h${h}`] || 0;
        if (s > 0) {
          gross += s;
          net += s - (strokesByHole[h] || 0);
          holesPlayed++;
        }
      }
      const complete = holesPlayed === 9 && !isAbsent;
      return {
        pid,
        name: pl?.name || "?",
        hcp,
        isAbsent,
        complete,
        gross: complete ? gross : null,
        net: complete ? net : null,
        toPar: complete ? net - parTotal : null,
      };
    });

    // Sort by selected column. Default is ascending (best → worst, lower is better in golf);
    // tapping the same header toggles to descending (worst → best).
    // Incomplete rounds (no 9-hole score yet) always stay at the bottom alphabetically,
    // regardless of direction — they're shown as reference, not ranked.
    const sortKey = lowNetSort; // "net" or "gross"
    const dirMult = lowNetDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (a.complete && !b.complete) return -1;
      if (!a.complete && b.complete) return 1;
      if (a.complete && b.complete) return (a[sortKey] - b[sortKey]) * dirMult;
      return a.name.localeCompare(b.name);
    });

    // Tap handler: switching columns resets to ascending (best first, golf-standard view).
    // Tapping the already-active column flips direction.
    const handleHeaderTap = (col) => {
      if (lowNetSort !== col) {
        setLowNetSort(col);
        setLowNetDir("asc");
      } else {
        setLowNetDir(lowNetDir === "asc" ? "desc" : "asc");
      }
    };

    const fmtToPar = (tp) => {
      if (tp === null) return "—";
      if (tp === 0) return "E";
      return tp > 0 ? `+${tp}` : `${tp}`;
    };

    // Header cell style helper — sortable headers are visually interactive
    const headerCellStyle = (isActive) => ({
      cursor: "pointer",
      fontWeight: isActive ? 900 : 800,
      opacity: isActive ? 1 : 0.8,
      textDecoration: "none",
      borderBottom: isActive ? `2px solid ${K.bg}` : "2px solid transparent",
      paddingBottom: 1,
    });

    // Chevron shown on the active header: ▾ ascending, ▴ descending. Reserved 10px slot
    // keeps header cell width stable regardless of state.
    const activeChevron = lowNetDir === "asc" ? " ▾" : " ▴";

    return (
      <div style={{ maxWidth: 540, margin: "0 auto" }}>
        <ViewToggle />
        {FinalizeBanner}

        {/* Table header — Net and Gross are tappable to sort; tapping the active column flips direction */}
        <div style={{ display: "flex", alignItems: "center", padding: "6px 10px", background: K.acc, borderRadius: "8px 8px 0 0", color: K.bg, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: .5 }}>
          <div style={{ width: 22, flexShrink: 0, textAlign: "center", opacity: .8 }}>#</div>
          <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }}>Player</div>
          <div style={{ width: 36, flexShrink: 0, textAlign: "center", opacity: .8 }}>Hcp</div>
          <div style={{ width: 44, flexShrink: 0, textAlign: "center", opacity: .8 }}>To Par</div>
          <div onClick={() => handleHeaderTap("net")} style={{ width: 48, flexShrink: 0, textAlign: "center", ...headerCellStyle(sortKey === "net") }}>
            Net<span style={{ display: "inline-block", width: 10, textAlign: "left" }}>{sortKey === "net" ? activeChevron : ""}</span>
          </div>
          <div onClick={() => handleHeaderTap("gross")} style={{ width: 56, flexShrink: 0, textAlign: "center", ...headerCellStyle(sortKey === "gross") }}>
            Gross<span style={{ display: "inline-block", width: 10, textAlign: "left" }}>{sortKey === "gross" ? activeChevron : ""}</span>
          </div>
        </div>

        <div style={{ background: K.card, border: `1px solid ${K.bdr}`, borderTop: "none", borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
          {(() => {
            // Rank = "position in ascending order" regardless of current display direction.
            // So the best score is always rank 1 even when the list is flipped to worst→best.
            const completeCount = rows.filter(r => r.complete).length;
            return rows.map((r, i) => {
              const isMe = r.pid === leagueUser.playerId;
              const isLast = i === rows.length - 1;
              const showRank = r.complete;
              // True ascending position for this row (1-indexed). In desc mode, top rows are higher rank numbers.
              const rank = showRank ? (lowNetDir === "asc" ? i + 1 : completeCount - i) : null;
              const isLeader = rank === 1;
              // Tied with the prior visible row on the active sort column
              const tiedAbove = r.complete && i > 0 && rows[i - 1].complete && rows[i - 1][sortKey] === r[sortKey];
              // Green emphasis follows the active sort column
              const netIsActive = sortKey === "net";
              const grossIsActive = sortKey === "gross";
              return (
                <div key={r.pid} style={{
                  display: "flex", alignItems: "center", padding: "9px 10px",
                  borderBottom: isLast ? "none" : `1px solid ${K.bdr}30`,
                  background: isMe ? K.acc + "12" : "transparent",
                }}>
                  <div style={{ width: 22, flexShrink: 0, textAlign: "center", fontSize: 12, fontWeight: 700, color: isLeader ? K.matchGrn : K.t3 }}>
                    {showRank ? (tiedAbove ? "T" : "") + rank : "—"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingLeft: 8, fontSize: 13, fontWeight: isMe ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.name}
                    {r.isAbsent && <span style={{ marginLeft: 6, fontSize: 8, fontWeight: 700, color: K.red, background: K.red + "15", padding: "1px 4px", borderRadius: 3 }}>ABS</span>}
                  </div>
                  <div style={{ width: 36, flexShrink: 0, textAlign: "center", fontSize: 11, fontWeight: 700, color: "#3b82f6" }}>{r.hcp}</div>
                  <div style={{ width: 44, flexShrink: 0, textAlign: "center", fontSize: 13, fontWeight: 800, color: r.toPar === null ? K.t3 + "60" : r.toPar < 0 ? K.red : r.toPar === 0 ? K.t2 : K.t1 }}>
                    {fmtToPar(r.toPar)}
                  </div>
                  <div style={{ width: 48, flexShrink: 0, textAlign: "center", fontSize: netIsActive ? 14 : 13, fontWeight: netIsActive ? 800 : 600, color: r.net === null ? K.t3 + "60" : (netIsActive && isLeader) ? K.matchGrn : netIsActive ? K.t1 : K.t2 }}>
                    {r.net ?? "—"}
                  </div>
                  <div style={{ width: 56, flexShrink: 0, textAlign: "center", fontSize: grossIsActive ? 14 : 12, fontWeight: grossIsActive ? 800 : 600, color: r.gross === null ? K.t3 + "60" : (grossIsActive && isLeader) ? K.matchGrn : grossIsActive ? K.t1 : K.t2 }}>
                    {r.gross ?? "—"}
                  </div>
                </div>
              );
            });
          })()}
        </div>

        {rows.every(r => !r.complete) && (
          <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: K.t3, fontStyle: "italic" }}>
            No complete rounds yet this week
          </div>
        )}
      </div>
    );
  }

  // ── Default: no match found ──
  if (!matchToScore) {
    return (
      <div>
        <EmptyState icon="flag" title="No match found" subtitle="You don't have a match scheduled this week." />
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button onClick={() => setShowAllMatches(true)} style={{ padding: "10px 20px", borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>See All Matches</button>
        </div>
      </div>
    );
  }

  if (!t1 || !t2) return null;

  // Shared playoff tiebreaker resolver. Called in two places:
  //   1. finalizeMatch() when saving a tied playoff result
  //   2. buildScorecardData() when rendering the Sign Scorecard preview
  // Both callers pass the two teams' players, the per-hole results (1/-1/0),
  // and the team IDs. Returns { winner: "t1" | "t2", label: string }.
  const computePlayoffTiebreaker = ({ t1Players: tb1, t2Players: tb2, holeResults: hr, t1Id, t2Id }) => {
    const tb = leagueConfig?.playoffTiebreaker || "hardestHole";
    const netOnHole = (pids, h) => pids.reduce((a, pid) => a + (getS(pid, h) - getStrokes(pid, h)), 0);
    const t1NetTotal = tb1.reduce((a, pid) => {
      let s = 0;
      for (let h = 0; h < 9; h++) s += (getS(pid, h) - getStrokes(pid, h));
      return a + s;
    }, 0);
    const t2NetTotal = tb2.reduce((a, pid) => {
      let s = 0;
      for (let h = 0; h < 9; h++) s += (getS(pid, h) - getStrokes(pid, h));
      return a + s;
    }, 0);
    const t1GrossTotal = tb1.reduce((a, pid) => {
      let s = 0;
      for (let h = 0; h < 9; h++) s += getS(pid, h);
      return a + s;
    }, 0);
    const t2GrossTotal = tb2.reduce((a, pid) => {
      let s = 0;
      for (let h = 0; h < 9; h++) s += getS(pid, h);
      return a + s;
    }, 0);

    let winner = null;
    let label = "";

    if (tb === "hardestHole") {
      // Sort the nine holes played by course HCP index (1 = hardest first), then
      // walk them in order until we find one where net scores differ. This makes
      // "hardest hole" cascade: if the #1 HCP hole is tied, try the #2 HCP hole, etc.
      // Only when all nine holes are also tied on this measure do we fall through
      // to the seed fallback below.
      const holesByHcp = Array.from({ length: 9 }, (_, h) => h)
        .sort((a, b) => (hcps[a] || Infinity) - (hcps[b] || Infinity));
      let decidingHoleIdx = null;
      for (const h of holesByHcp) {
        const n1 = netOnHole(tb1, h);
        const n2 = netOnHole(tb2, h);
        if (n1 < n2) { winner = "t1"; decidingHoleIdx = h; break; }
        if (n2 < n1) { winner = "t2"; decidingHoleIdx = h; break; }
        // tied on this hole — continue to the next-hardest
      }
      label = decidingHoleIdx !== null ? `Hole ${decidingHoleIdx + 1}` : "Hole-by-HCP";
    } else if (tb === "sumHoleHcpLosses") {
      // For each hole, the LOSING team adds that hole's course HCP index to their total.
      // Lower total wins — losing on easy holes (HCP 17, 18) hurts more than hard holes.
      let t1LossSum = 0, t2LossSum = 0;
      for (let h = 0; h < 9; h++) {
        const hc = hcps[h] || 0;
        if (hr[h] === 1) t2LossSum += hc;
        else if (hr[h] === -1) t1LossSum += hc;
      }
      if (t1LossSum < t2LossSum) winner = "t1";
      else if (t2LossSum < t1LossSum) winner = "t2";
      label = "HCP losses";
    } else if (tb === "lowestNet") {
      if (t1NetTotal < t2NetTotal) winner = "t1";
      else if (t2NetTotal < t1NetTotal) winner = "t2";
      label = "Low net";
    } else if (tb === "lowestGross") {
      if (t1GrossTotal < t2GrossTotal) winner = "t1";
      else if (t2GrossTotal < t1GrossTotal) winner = "t2";
      label = "Low gross";
    } else if (tb === "higherSeed") {
      // Better seed = lower number. Wrap in Number() in case seeds are stored as strings.
      const s1 = Number(seedMap[t1Id]) || Infinity;
      const s2 = Number(seedMap[t2Id]) || Infinity;
      if (s1 < s2) winner = "t1";
      else if (s2 < s1) winner = "t2";
      label = "Higher seed";
    }

    // Final fallback — seed, then default to t1 so we never return a null winner.
    // Label stays concise ("Seed") so it fits in the scorecard's clinch cell.
    if (!winner) {
      const s1 = Number(seedMap[t1Id]) || Infinity;
      const s2 = Number(seedMap[t2Id]) || Infinity;
      if (s1 !== s2) winner = s1 < s2 ? "t1" : "t2";
      else winner = "t1";
      label = "Seed";
    }

    return { winner, label };
  };

  const finalizeMatch = async () => {
    const isPlayoffWeek = weekSch?.isPlayoff === true;
    const sr = isPlayoffWeek
      ? { mw: scoringRules.playoffMatchWin, mt: scoringRules.playoffMatchTie, ml: scoringRules.playoffMatchLoss, bw: scoringRules.playoffBonusWin, bt: scoringRules.playoffBonusTie, bl: scoringRules.playoffBonusLoss }
      : { mw: scoringRules.matchWin, mt: scoringRules.matchTie, ml: scoringRules.matchLoss, bw: scoringRules.totalNetBonusWin, bt: scoringRules.totalNetBonusTie, bl: scoringRules.totalNetBonusLoss };

    let t1Pts = 0, t2Pts = 0;
    const t1Net = t1Players.reduce((a, pid) => a + getRunning(pid).net, 0);
    const t2Net = t2Players.reduce((a, pid) => a + getRunning(pid).net, 0);
    const t1Gross = t1Players.reduce((a, pid) => a + getRunning(pid).gross, 0);
    const t2Gross = t2Players.reduce((a, pid) => a + getRunning(pid).gross, 0);

    if (isTeamNet) {
      if (t1Net < t2Net) { t1Pts = sr.mw; t2Pts = sr.ml; }
      else if (t1Net > t2Net) { t1Pts = sr.ml; t2Pts = sr.mw; }
      else { t1Pts = sr.mt; t2Pts = sr.mt; }
    } else {
      const t1s = [...t1Players].sort((a, b) => getHcp(a) - getHcp(b));
      const t2s = [...t2Players].sort((a, b) => getHcp(a) - getHcp(b));
      const t1L = getRunning(t1s[0]).net, t2L = getRunning(t2s[0]).net;
      const t1H = getRunning(t1s[1]).net, t2H = getRunning(t2s[1]).net;
      if (t1L < t2L) { t1Pts += sr.mw; t2Pts += sr.ml; } else if (t1L > t2L) { t1Pts += sr.ml; t2Pts += sr.mw; } else { t1Pts += sr.mt; t2Pts += sr.mt; }
      if (t1H < t2H) { t1Pts += sr.mw; t2Pts += sr.ml; } else if (t1H > t2H) { t1Pts += sr.ml; t2Pts += sr.mw; } else { t1Pts += sr.mt; t2Pts += sr.mt; }

      const bonusType = leagueConfig?.bonusType || "teamNetTotal";
      let b1, b2;
      if (bonusType === "lowestNet") { b1 = Math.min(getRunning(t1s[0]).net, getRunning(t1s[1]).net); b2 = Math.min(getRunning(t2s[0]).net, getRunning(t2s[1]).net); }
      else if (bonusType === "totalGross") { b1 = t1Gross; b2 = t2Gross; }
      else { b1 = t1Net; b2 = t2Net; }
      if (b1 < b2) { t1Pts += sr.bw; t2Pts += sr.bl; } else if (b1 > b2) { t1Pts += sr.bl; t2Pts += sr.bw; } else { t1Pts += sr.bt; t2Pts += sr.bt; }
    }

    let hw1 = 0, hw2 = 0;
    const holeResults = [];
    for (let h = 0; h < 9; h++) {
      let n1 = 0, n2 = 0;
      t1Players.forEach(pid => { n1 += getS(pid, h) - getStrokes(pid, h); });
      t2Players.forEach(pid => { n2 += getS(pid, h) - getStrokes(pid, h); });
      if (n1 < n2) { hw1++; holeResults.push(1); } else if (n2 < n1) { hw2++; holeResults.push(-1); } else { holeResults.push(0); }
    }

    const runningStatus = []; let cum = 0;
    holeResults.forEach(r => { cum += r; runningStatus.push(cum); });

    let matchEndHole = 8;
    let matchMargin = Math.abs(runningStatus[8]);
    for (let h = 0; h < 9; h++) {
      const lead = Math.abs(runningStatus[h]);
      const remaining = 8 - h;
      if (lead > remaining) { matchEndHole = h; matchMargin = lead; break; }
    }
    const holesRemaining = 8 - matchEndHole;
    const finalStatus = runningStatus[8];

    let matchResultText;
    if (finalStatus === 0) matchResultText = "TIED";
    else if (holesRemaining > 0) matchResultText = `${matchMargin}&${holesRemaining}`;
    else matchResultText = `${Math.abs(finalStatus)}UP`;

    // PLAYOFF TIEBREAKER — playoff matches cannot end tied. If the raw result is a
    // tie, apply the league-configured tiebreaker via the shared computePlayoffTiebreaker
    // helper and override points + result text.
    let finalT1Pts = t1Pts;
    let finalT2Pts = t2Pts;
    let winnerTeamId = finalStatus > 0 ? t1.id : finalStatus < 0 ? t2.id : null;
    if (isPlayoffWeek && finalStatus === 0) {
      const { winner: tbWinner, label: tbLabel } = computePlayoffTiebreaker({
        t1Players, t2Players, holeResults, t1Id: t1.id, t2Id: t2.id,
      });
      // Award match-win points to the tiebreaker winner. In 1v1 team-net scoring
      // there's only one match-line; in 2v2 by-position scoring there's also a bonus line.
      if (tbWinner === "t1") {
        finalT1Pts = isTeamNet ? sr.mw : sr.mw + sr.bw;
        finalT2Pts = isTeamNet ? sr.ml : sr.ml + sr.bl;
        winnerTeamId = t1.id;
      } else {
        finalT1Pts = isTeamNet ? sr.ml : sr.ml + sr.bl;
        finalT2Pts = isTeamNet ? sr.mw : sr.mw + sr.bw;
        winnerTeamId = t2.id;
      }
      matchResultText = `TIE (${tbLabel})`;
    }

    // If all other players are absent, auto-attest since nobody can
    const presentNonSigners = allP.filter(pid => pid !== leagueUser.playerId && !isPlayerAbsent(pid));
    const autoAttest = presentNonSigners.length === 0;

    await saveMatchResult({
      id: `${LEAGUE_ID}_w${week}_${t1.id}_${t2.id}`, week,
      team1Id: t1.id, team2Id: t2.id,
      team1Points: finalT1Pts, team2Points: finalT2Pts,
      t1Total: t1Net, t2Total: t2Net,
      t1HolesWon: hw1, t2HolesWon: hw2,
      matchResultText,
      matchWinnerId: winnerTeamId,
      finalizedByTeamId: myTeam?.id || null,
      signedByPlayerId: leagueUser.playerId || null,
      attestedBy: [],
      attested: autoAttest,
    });
  };

  const attestMatch = async () => {
    if (!existingResult) return;
    const newAttestedBy = [...new Set([...attestedBy, leagueUser.playerId])];
    const allDone = nonSignerPids.every(pid => newAttestedBy.includes(pid));
    await saveMatchResult({
      ...existingResult,
      attestedBy: newAttestedBy,
      attested: allDone,
    });
    setShowFinalize(false);
    setShowEditConfirm(false);
    setToast(allDone ? "Scorecard fully attested ✓" : "Attestation recorded ✓");
    setTimeout(() => setToast(null), 2000);
  };

  // ── Build scorecard data (used by finalize popup + inline signed view) ──
  const buildScorecardData = () => {
    const myTeamId = myTeam?.id || t1.id;
    const isMyT1 = t1.id === myTeamId;
    const myPids = isMyT1 ? t1Players : t2Players;
    const oppPids = isMyT1 ? t2Players : t1Players;
    const myTeamObj = isMyT1 ? t1 : t2;
    const oppTeamObj = isMyT1 ? t2 : t1;

    const status = computeMatchStatus(myPids, oppPids, getS, getStrokes, pars);
    const myHW = status.holeResults.filter(r => r === 1).length;
    const oppHW = status.holeResults.filter(r => r === -1).length;
    const finalStatus = status.runningStatus[8];
    let isWin = finalStatus > 0;
    let isLoss = finalStatus < 0;
    let isTie = finalStatus === 0;

    // PLAYOFF TIEBREAKER PREVIEW — if this is a tied playoff match, resolve the
    // winner using the configured tiebreaker and reflect it here so the Sign
    // Scorecard screen shows the correct W/L instead of a misleading "TIED".
    // Uses computePlayoffTiebreaker() which is the same logic applied at save time.
    const isPlayoffWeek = weekSch?.isPlayoff === true;
    let tbClinchText = null;
    if (isPlayoffWeek && isTie) {
      const tbResult = computePlayoffTiebreaker({
        t1Players: myPids, t2Players: oppPids,
        holeResults: status.holeResults,
        t1Id: myTeamObj.id, t2Id: oppTeamObj.id,
      });
      if (tbResult.winner === "t1") { isWin = true; isTie = false; }
      else if (tbResult.winner === "t2") { isLoss = true; isTie = false; }
      tbClinchText = `TIE (${tbResult.label})`;
    }

    const matchResult = isWin ? "WIN" : isLoss ? "LOSS" : "TIE";
    const resultColor = isTie ? K.t2 : K.grn;

    const myPidsSorted = [...myPids].sort((a, b) => getHcp(a) - getHcp(b));
    const oppPidsSorted = [...oppPids].sort((a, b) => getHcp(a) - getHcp(b));

    // Override clinchText so the tiebreaker label shows on the preview
    const finalClinchText = tbClinchText || status.clinchText;

    return { myPids, oppPids, myPidsSorted, oppPidsSorted, myTeamObj, oppTeamObj, myHW, oppHW, ...status, clinchText: finalClinchText, matchResult, resultColor, isMyT1 };
  };

  // Shared playoff tiebreaker resolver. Called in two places:
  //   1. finalizeMatch() when saving a tied playoff result
  //   2. buildScorecardData() when rendering the Sign Scorecard preview
  // Both callers pass the two teams' players, the per-hole results (1/-1/0),
  // and the team IDs. Returns { winner: "t1" | "t2", label: string }.
  // ── Shared scorecard builder for both inline and popup views ──
  const buildSC = (team1Pids, team2Pids, hResults, rStatus, cHole, cText, variant, showTotals) => {
    return SharedScorecard({
      pars, side, hcps, team1Pids, team2Pids,
      getScore: getS, getStrokes, getHcp: getNineHcp,
      getInitials, isAbsent: isPlayerAbsent,
      holeResults: hResults, runningStatus: rStatus,
      clinchHole: cHole, clinchText: cText,
      variant, showTotals, matchGrn,
    });
  };

  return (
    <div style={{ maxWidth: 420, margin: "0 auto" }}>
      {activeMatch && (
        <div style={{ marginBottom: 8 }}>
          <BackBtn onClick={() => { setActiveMatch(null); }} />
        </div>
      )}
      {!activeMatch && <ViewToggle />}
      {!activeMatch && FinalizeBanner}
      {/* Status banners */}
      {isWeekLocked && (
        <div style={{ background: K.warn + "18", border: `1px solid ${K.warn}40`, borderRadius: 8, padding: "6px 10px", marginBottom: 4, fontSize: 13, color: K.warn, fontWeight: 700, textAlign: "center" }}>
          Week {week} is locked — scores are read-only
        </div>
      )}
      {!isAlreadyFinalized && (
      <div style={{ display: "flex", gap: 3, marginBottom: 2 }}>
        {Array.from({ length: 9 }, (_, i) => {
          const cur = i === curHole; const done = allP.every(pid => getS(pid, i) > 0);
          return <button key={i} onClick={() => { setCurHole(i); setEditing(i < currentHoleIdx); }} style={{ flex: 1, height: 32, borderRadius: done || cur ? 8 : 6, border: done && !cur ? `1.5px solid ${K.acc}50` : "none", background: cur ? K.acc : done ? K.acc + "15" : K.card, color: cur ? K.bg : done ? K.acc : K.t3, fontSize: 15, fontWeight: 700, cursor: "pointer", outline: cur ? `2px solid ${K.acc}` : "none", outlineOffset: 1 }}>{side === 'front' ? i + 1 : i + 10}</button>;
        })}
      </div>
      )}
      {/* Match status — tappable to expand scorecard */}
      {(() => {
        const myTeamId = myTeam?.id || t1.id;
        const isMyT1 = t1.id === myTeamId;
        const holeStatuses = Array.from({ length: 9 }, (_, i) => {
          let holesUp = 0, hasData = false;
          for (let h = 0; h <= i; h++) {
            let t1HN = 0, t2HN = 0, t1OK = true, t2OK = true;
            t1Players.forEach(pid => { const s = getS(pid, h); if (s <= 0) t1OK = false; else t1HN += s - getStrokes(pid, h); });
            t2Players.forEach(pid => { const s = getS(pid, h); if (s <= 0) t2OK = false; else t2HN += s - getStrokes(pid, h); });
            if (t1OK && t2OK) {
              if (t1HN < t2HN) holesUp += isMyT1 ? 1 : -1;
              else if (t1HN > t2HN) holesUp += isMyT1 ? -1 : 1;
              hasData = true;
            } else { hasData = false; break; }
          }
          return hasData ? holesUp : null;
        });

        let matchClinchHole = null;
        let clinchScoreText = null;
        for (let h = 0; h < 9; h++) {
          if (holeStatuses[h] === null) break;
          const lead = Math.abs(holeStatuses[h]);
          const remaining = 8 - h;
          if (lead > remaining) {
            matchClinchHole = h;
            clinchScoreText = remaining > 0 ? `${lead}&${remaining}` : `${lead}UP`;
            break;
          }
        }

        const hasAnyStatus = holeStatuses.some(s => s !== null);

        return (<>
          <div style={{ display: isAlreadyFinalized ? "none" : "flex", marginTop: 2, marginBottom: 4, width: "100%", background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 8, padding: "4px 0", alignItems: "center" }}>
            {holeStatuses.map((st, i) => {
              const colBorderR = i < 8 ? { borderRight: `1px solid ${K.bdr}30` } : {};
              if (matchClinchHole !== null && i === matchClinchHole) {
                const color = st > 0 ? matchGrn : st < 0 ? K.red : K.t3;
                return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 14, color, fontWeight: 800, lineHeight: "24px", ...colBorderR }}>{clinchScoreText}</div>;
              }
              if (matchClinchHole !== null && i > matchClinchHole) return <div key={i} style={{ flex: 1, height: 24, ...colBorderR }} />;
              if (st === null) return <div key={i} style={{ flex: 1, height: 24, ...colBorderR }} />;
              const color = st > 0 ? matchGrn : st < 0 ? K.red : K.t3;
              return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 800, color, lineHeight: "24px", ...colBorderR }}>{st > 0 ? <><span style={{ fontSize: 14 }}>▲</span>{st}</> : st < 0 ? <><span style={{ fontSize: 14 }}>▼</span>{Math.abs(st)}</> : <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: .5 }}>TIED</span>}</div>;
            })}
          </div>
        </>);
      })()}
      {/* After signed: show inline scorecard. Before signed: show hole card + scoring UI */}
      {isAlreadyFinalized ? (() => {
        const sc = buildScorecardData();
        const scComp = buildSC(sc.myPids, sc.oppPids, sc.holeResults, sc.runningStatus, sc.clinchHole, sc.clinchText, "full", true);

        return (
          <div style={{ marginBottom: 6, position: "relative" }}>
            {isFullyAttested && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 2, overflow: "hidden" }}>
                <div style={{ fontSize: "clamp(70px, 22vw, 120px)", fontWeight: 900, color: K.t3 + "20", letterSpacing: "clamp(12px, 4vw, 24px)", textTransform: "uppercase", userSelect: "none", whiteSpace: "nowrap", transform: "rotate(-18deg)" }}>FINAL</div>
              </div>
            )}

            <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden", marginBottom: 4 }}>
              <scComp.HoleRow />
              <scComp.ParRow />
              {weekSch?.isPlayoff && <scComp.HcpRow />}
              {sc.myPids.map(pid => <scComp.PlayerRow key={pid} pid={pid} />)}
              <scComp.TeamNetRow pids={sc.myPids} isTeam1Side={true} />
            </div>
            <scComp.MatchRow />
            <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden" }}>
              <scComp.HoleRow />
              <scComp.ParRow />
              {weekSch?.isPlayoff && <scComp.HcpRow />}
              {sc.oppPids.map(pid => <scComp.PlayerRow key={pid} pid={pid} />)}
              <scComp.TeamNetRow pids={sc.oppPids} isTeam1Side={false} />
            </div>

            {/* Attestation status + actions */}
            {isAlreadyFinalized && !isFullyAttested && !isWeekLocked && (() => {
              const attestCount = attestedBy.length;
              const needed = nonSignerPids.length;
              const statusText = `${attestCount} of ${needed} attested`;
              return (
                <div style={{ marginTop: 8 }}>
                  {/* Attestation progress */}
                  <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap", justifyContent: "center" }}>
                    {nonSignerPids.map(pid => {
                      const pl = playerMap[pid];
                      const done = attestedBy.includes(pid);
                      const lastName = pl ? pl.name.split(' ').pop() : "?";
                      return (
                        <div key={pid} style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 4, background: done ? K.grn + "18" : K.inp, border: `1px solid ${done ? K.grn + "40" : K.bdr}`, color: done ? K.grn : K.t3 }}>
                          {done ? "✓ " : ""}{lastName}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ textAlign: "center", fontSize: 11, color: K.warn, fontWeight: 600, marginBottom: 6 }}>
                    {statusText}
                  </div>

                  {/* Attest button — for non-signers who haven't attested yet */}
                  {needsAttestation && (
                    <>
                      <button onClick={attestMatch} style={{ width: "100%", padding: "12px", borderRadius: 10, background: "#3b82f6", border: "none", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                        Attest Scorecard
                      </button>
                      {signedByPlayerId && playerMap[signedByPlayerId] && (
                        <div style={{ textAlign: "center", marginTop: 5, fontSize: 11, color: K.t3, fontWeight: 600 }}>
                          Signed by {playerMap[signedByPlayerId].name}
                        </div>
                      )}
                    </>
                  )}

                  {/* Already attested but waiting for others */}
                  {iHaveAttested && !isFullyAttested && (
                    <div style={{ textAlign: "center", fontSize: 12, color: K.t3, fontWeight: 600, padding: "6px 0" }}>
                      You attested — waiting for others
                    </div>
                  )}

                  {/* Unsign button — any of the 4 players can unsign before fully attested */}
                  {isInThisMatch && existingResult?.id && (
                    <button onClick={() => {
                      setConfirmModal({
                        title: "Unsign scorecard?",
                        message: "All attestations will be reset and scores can be edited again.",
                        onConfirm: () => {
                          deleteMatchResult(existingResult.id);
                          setConfirmModal(null);
                        },
                      });
                    }} style={{ width: "100%", padding: "7px 0", borderRadius: 8, marginTop: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      Unsign & Edit
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })() : (<>
      <div style={{ background: K.acc, borderRadius: 10, padding: "4px 8px", marginBottom: 4, display: "flex", alignItems: "center" }}>
        <button onClick={() => { const prev = Math.max(0, curHole - 1); setCurHole(prev); setEditing(prev < currentHoleIdx); }} disabled={curHole === 0} style={{ width: 28, height: 36, borderRadius: 8, background: "none", border: "none", cursor: curHole === 0 ? "default" : "pointer", color: curHole === 0 ? K.bg + "40" : K.bg, fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px" }}>
          <div style={{ textAlign: "center", minWidth: 32 }}><div style={{ fontSize: 8, color: K.bg, fontWeight: 600, opacity: 0.7 }}>Par</div><div style={{ fontSize: 15, fontWeight: 800, color: K.bg }}>{par}</div></div>
          <div style={{ textAlign: "center" }}><div style={{ fontSize: 8, color: K.bg, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, opacity: 0.7 }}>Hole</div><div style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 26, fontWeight: 700, color: K.bg, lineHeight: 1 }}>{side === 'front' ? curHole + 1 : curHole + 10}</div></div>
          <div style={{ textAlign: "center", minWidth: 32 }}><div style={{ fontSize: 8, color: K.bg, fontWeight: 600, opacity: 0.7 }}>HCP</div><div style={{ fontSize: 15, fontWeight: 800, color: K.bg }}>{hcp}</div></div>
        </div>
        <button onClick={() => { const next = Math.min(8, curHole + 1); setCurHole(next); setEditing(next < currentHoleIdx); }} disabled={curHole === 8} style={{ width: 28, height: 36, borderRadius: 8, background: "none", border: "none", cursor: curHole === 8 ? "default" : "pointer", color: curHole === 8 ? K.bg + "40" : K.bg, fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
      </div>
      </>)}
      {!isAlreadyFinalized && (<>

      {allP.map(pid => {
        const pl = playerMap[pid]; if (!pl) return null;
        const absent = isPlayerAbsent(pid);
        const score = getS(pid, curHole); const strokes = getStrokes(pid, curHole); const nh = getNineHcp(pid); const run = getRunning(pid);
        const btns = par === 3 ? [1,2,3,4,5,6,7] : par === 5 ? [2,3,4,5,6,7,8] : [2,3,4,5,6,7,8];
        const hole1Done = allP.filter(p => !isPlayerAbsent(p)).every(p => getRawScore(p, 0) > 0);
        const absentLocked = hole1Done && !absent;
        const absentBtn = !isAlreadyFinalized ? (
          <button
            onClick={() => {
              if (absentLocked) return;
              const tm = getTeammate(pid);
              const tmPlayer = tm ? playerMap[tm] : null;
              const tmAbsent = tm && isPlayerAbsent(tm);
              const tmName = tmPlayer?.name || "teammate";
              const message = tmAbsent
                ? `Both teammates will be absent — net bogey scores will be used for ${pl.name} and ${tmName}.`
                : `${tmName}'s scores will count double for match calculations.`;
              setConfirmModal({
                title: `Mark ${pl.name} as absent?`,
                message,
                onConfirm: () => { toggleAbsent(pid); setConfirmModal(null); },
              });
            }}
            style={{
              fontSize: 11, fontWeight: 600, color: absentLocked ? K.t3 + "50" : K.t3, background: "none",
              border: `1px solid ${absentLocked ? K.bdr + "30" : K.bdr}`, borderRadius: 6,
              padding: "3px 10px", cursor: absentLocked ? "default" : "pointer",
              opacity: absentLocked ? 0.4 : 1, flexShrink: 0,
            }}
          >
            Absent
          </button>
        ) : null;
        return <div key={pid}>
          {absent ? (
            <div style={{ background: K.card, borderRadius: 10, border: `1px solid ${K.bdr}`, padding: "12px 14px", marginBottom: 6, opacity: 0.6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: K.t1 }}>{pl.name}</div>
                  <span style={{ fontSize: 10, color: K.red, fontWeight: 700, background: K.red + "15", padding: "2px 6px", borderRadius: 4 }}>ABSENT</span>
                </div>
                {!isAlreadyFinalized && (
                  <button onClick={() => { setConfirmModal({ title: `Mark ${pl.name} as present?`, message: `${pl.name} will play their own scores.`, onConfirm: () => { toggleAbsent(pid); setConfirmModal(null); } }); }} style={{ fontSize: 11, fontWeight: 700, color: "#3b82f6", background: "none", border: `1px solid #3b82f640`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                    Undo
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: K.t3, marginTop: 4 }}>
                {isBothAbsent(pid)
                  ? "Net bogey on each hole (does not count for handicap/stats)"
                  : "Teammate's scores used for match calculations"}
              </div>
            </div>
          ) : (
            <PlayerScoreCard pl={pl} score={score} strokes={strokes} nh={nh} run={run} btns={btns} par={par} pid={pid} week={week} curHole={curHole} saveScore={guardedSaveScore} K={K} absentBtn={absentBtn} />
          )}
        </div>;
      })}
      {editing && (
        <button onClick={() => { setCurHole(currentHoleIdx); setEditing(false); }} style={{ width: "100%", padding: 10, borderRadius: 10, marginTop: 8, cursor: "pointer", background: K.warn, border: "none", color: K.bg, fontSize: 13, fontWeight: 800 }}>
          Back to Hole {side === 'front' ? currentHoleIdx + 1 : currentHoleIdx + 10} →
        </button>
      )}
      </>)}
      {/* Full Scorecard button */}
      {!isAlreadyFinalized && (
        <button onClick={() => setShowScorecard(true)} style={{ width: "100%", padding: "7px 0", borderRadius: 8, marginTop: 4, cursor: "pointer", background: K.card, border: `1px solid ${K.bdr}60`, color: K.t2, fontSize: 12, fontWeight: 700, letterSpacing: .5 }}>
          Full Scorecard
        </button>
      )}
      {showScorecard && !isAlreadyFinalized && (() => {
        const myTeamId = myTeam?.id || t1.id;
        const isMyT1 = t1.id === myTeamId;
        const scMyPids = isMyT1 ? t1Players : t2Players;
        const scOppPids = isMyT1 ? t2Players : t1Players;
        const scStatus = computeMatchStatus(scMyPids, scOppPids, getS, getStrokes, pars);
        const sc = buildSC(scMyPids, scOppPids, scStatus.holeResults, scStatus.runningStatus, scStatus.clinchHole, scStatus.clinchText, "allMatches", true);
        const holeStatuses = Array.from({ length: 9 }, (_, i) => {
          let holesUp = 0, hasData = false;
          for (let h = 0; h <= i; h++) {
            let t1HN = 0, t2HN = 0, t1OK = true, t2OK = true;
            t1Players.forEach(pid => { const s = getS(pid, h); if (s <= 0) t1OK = false; else t1HN += s - getStrokes(pid, h); });
            t2Players.forEach(pid => { const s = getS(pid, h); if (s <= 0) t2OK = false; else t2HN += s - getStrokes(pid, h); });
            if (t1OK && t2OK) { if (t1HN < t2HN) holesUp += isMyT1 ? 1 : -1; else if (t1HN > t2HN) holesUp += isMyT1 ? -1 : 1; hasData = true; } else { hasData = false; break; }
          }
          return hasData ? holesUp : null;
        });
        let matchClinchHole = null, clinchScoreText = null;
        for (let h = 0; h < 9; h++) {
          if (holeStatuses[h] === null) break;
          const lead = Math.abs(holeStatuses[h]); const rem = 8 - h;
          if (lead > rem) { matchClinchHole = h; clinchScoreText = rem > 0 ? `${lead}&${rem}` : `${lead}UP`; break; }
        }
        return (<>
          <div onClick={() => setShowScorecard(false)} data-popup style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 400 }} />
          <div onClick={() => setShowScorecard(false)} data-popup style={{ position: "fixed", inset: 0, zIndex: 450, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: K.bg, border: `1px solid ${K.bdr}`, borderRadius: 14, padding: "0 0 10px", width: "100%", maxWidth: 420, overflow: "hidden", overscrollBehavior: "contain" }}>
            <sc.HoleRow />
            <sc.ParRow />
            {weekSch?.isPlayoff && <sc.HcpRow />}
            <div style={{ padding: "0 4px" }}>
              {scMyPids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
              <sc.TeamNetRow pids={scMyPids} isTeam1Side={true} />
              <div style={{ borderBottom: `2px solid ${K.bdr}40`, margin: "3px 0" }} />
              <div style={{ display: "flex", alignItems: "center", background: K.acc + "18", borderBottom: `2px solid ${K.bdr}40` }}>
                <div style={{ width: 44, flexShrink: 0, fontSize: 10, color: K.acc, fontWeight: 700, padding: "5px 0", borderRight: `1px solid ${K.bdr}25`, paddingLeft: 4, letterSpacing: .3 }}>MATCH</div>
                {holeStatuses.map((st, i) => {
                  if (matchClinchHole !== null && i === matchClinchHole) {
                    const color = st > 0 ? matchGrn : st < 0 ? K.red : K.t3;
                    return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, color, fontWeight: 800, lineHeight: "22px", padding: "5px 0", borderRight: i < 8 ? `1px solid ${K.bdr}25` : "none" }}>{clinchScoreText}</div>;
                  }
                  if (matchClinchHole !== null && i > matchClinchHole) return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, lineHeight: "22px", padding: "5px 0", borderRight: i < 8 ? `1px solid ${K.bdr}25` : "none" }} />;
                  if (st === null) return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, lineHeight: "22px", padding: "5px 0", borderRight: i < 8 ? `1px solid ${K.bdr}25` : "none", color: K.t3 + "30" }}>—</div>;
                  const color = st > 0 ? matchGrn : st < 0 ? K.red : K.t3;
                  return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800, color, lineHeight: "22px", padding: "5px 0", borderRight: i < 8 ? `1px solid ${K.bdr}25` : "none" }}>{st > 0 ? <><span style={{ fontSize: 15 }}>▲</span>{st}</> : st < 0 ? <><span style={{ fontSize: 15 }}>▼</span>{Math.abs(st)}</> : <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: .5 }}>TIED</span>}</div>;
                })}
              </div>
              <div style={{ borderBottom: `2px solid ${K.bdr}40`, margin: "3px 0" }} />
              {scOppPids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
              <sc.TeamNetRow pids={scOppPids} isTeam1Side={false} />
            </div>
            <button onClick={() => setShowScorecard(false)} style={{ display: "block", width: "calc(100% - 20px)", margin: "10px auto 0", padding: "9px", background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 8, color: K.t2, fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: .4 }}>
              Close
            </button>
          </div>
          </div>
        </>);
      })()}
      {/* Finalize / Show Match Details buttons */}
      {allComplete && !showFinalize && !isAlreadyFinalized && (
        <button onClick={() => setShowFinalize(true)} style={{ width: "100%", padding: 10, borderRadius: 10, marginTop: 8, cursor: "pointer", background: "#3b82f615", border: `1.5px solid #3b82f650`, color: "#3b82f6", fontSize: 15, fontWeight: 700 }}>
          All Holes Complete — Sign Scorecard
        </button>
      )}

      {/* ═══ Finalize Popup ═══ */}
      {showFinalize && (!isAlreadyFinalized || isComm) && (() => {
        const sc = buildScorecardData();
        const scComp = buildSC(sc.myPids, sc.oppPids, sc.holeResults, sc.runningStatus, sc.clinchHole, sc.clinchText, "compact", true);

        return (<>
          <div onClick={() => { setShowFinalize(false); setShowEditConfirm(false); }} data-popup style={{ position: "fixed", top: -50, left: 0, right: 0, bottom: -50, background: "rgba(0,0,0,.7)", zIndex: 500 }} />
          {/* Confetti — reduced to 25 particles for mobile performance */}
          {sc.matchResult === "WIN" && !isAlreadyFinalized && (
            <div style={{ position: "fixed", inset: 0, zIndex: 550, pointerEvents: "none", overflow: "hidden" }}>
              {Array.from({ length: 25 }, (_, i) => {
                const colors = [K.act, K.grn, K.teal, "#fff", K.logoBright, K.red, "#ff6b6b", "#ffd93d"];
                const c = colors[i % colors.length];
                const left = Math.random() * 100;
                const delay = Math.random() * 2;
                const dur = 2 + Math.random() * 2;
                const size = 4 + Math.random() * 6;
                const rot = Math.random() * 360;
                return (
                  <div key={i} style={{
                    position: "absolute", top: -20, left: `${left}%`,
                    width: size, height: size * (Math.random() > 0.5 ? 1 : 0.5),
                    background: c, borderRadius: Math.random() > 0.5 ? "50%" : 1,
                    opacity: 0, transform: `rotate(${rot}deg)`,
                    animation: `confettiFall ${dur}s ${delay}s ease-out forwards`,
                  }} />
                );
              })}
              <style>{`
                @keyframes confettiFall {
                  0% { opacity: 1; transform: translateY(0) translateX(0) rotate(0deg); }
                  100% { opacity: 0; transform: translateY(100vh) translateX(40px) rotate(720deg); }
                }
              `}</style>
            </div>
          )}
          <div data-popup style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 16px 16px", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
            <div style={{ background: K.bg, border: `1.5px solid ${sc.resultColor}50`, borderRadius: 16, padding: "16px 12px 20px", width: "100%", maxWidth: 420 }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 14, padding: "0 4px" }}>
                <div style={{ flex: 1, textAlign: "right", minWidth: 0 }}>
                  {sc.myPidsSorted.map(pid => {
                    const effectivePid = isPlayerAbsent(pid) ? (getTeammate(pid) || pid) : pid;
                    const pl = playerMap[effectivePid];
                    const last = pl?.name?.split(' ').slice(1).join(' ') || pl?.name || "?";
                    return <div key={pid} style={{ fontSize: 20, fontWeight: 800, color: sc.matchResult === "WIN" ? K.matchGrn : K.t1, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{last}</div>;
                  })}
                </div>
                {sc.matchResult === "WIN" && <div style={{ color: K.matchGrn, fontSize: 15, fontWeight: 800, flexShrink: 0, lineHeight: 1, transform: "rotate(-90deg)" }}>▲</div>}
                {/* Center result block.
                    For a tiebreaker-resolved match, the clinchText is "TIE (HCP losses)"
                    or similar. We split it: the word "TIE" on top in big type, and the
                    tiebreaker label in small type below. Keeps the header compact and
                    avoids wrapping into the scorecard grid below. */}
                <div style={{ textAlign: "center", flexShrink: 0, width: 80 }}>
                  {(() => {
                    const raw = sc.clinchText || "TIED";
                    const tbMatch = raw.match(/^TIE\s*\(([^)]+)\)\s*$/i);
                    if (tbMatch) {
                      return (
                        <>
                          <div style={{ fontSize: 24, fontWeight: 800, color: K.matchGrn, lineHeight: 1 }}>TIE</div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: K.t3, letterSpacing: .5, textTransform: "uppercase", marginTop: 3, lineHeight: 1.15, whiteSpace: "normal", wordBreak: "break-word" }}>{tbMatch[1]}</div>
                        </>
                      );
                    }
                    // Regular result (e.g. "3&2", "2UP", or plain "TIED" for non-playoff)
                    return (
                      <div style={{ fontSize: 26, fontWeight: 800, color: sc.matchResult === "TIE" ? K.t2 : K.matchGrn, lineHeight: 1, whiteSpace: "nowrap" }}>{raw}</div>
                    );
                  })()}
                </div>
                {sc.matchResult === "LOSS" && <div style={{ color: K.matchGrn, fontSize: 15, fontWeight: 800, flexShrink: 0, lineHeight: 1, transform: "rotate(90deg)" }}>▲</div>}
                <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                  {sc.oppPidsSorted.map(pid => {
                    const effectivePid = isPlayerAbsent(pid) ? (getTeammate(pid) || pid) : pid;
                    const pl = playerMap[effectivePid];
                    const last = pl?.name?.split(' ').slice(1).join(' ') || pl?.name || "?";
                    return <div key={pid} style={{ fontSize: 20, fontWeight: 800, color: sc.matchResult === "LOSS" ? K.matchGrn : K.t1, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{last}</div>;
                  })}
                </div>
              </div>

              {/* My team card */}
              <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden", marginBottom: 4 }}>
                <scComp.HoleRow />
                <scComp.ParRow />
                {weekSch?.isPlayoff && <scComp.HcpRow />}
                {sc.myPids.map(pid => <scComp.PlayerRow key={pid} pid={pid} />)}
                <scComp.TeamNetRow pids={sc.myPids} isTeam1Side={true} />
              </div>

              <scComp.MatchRow />

              {/* Opp team card */}
              <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden" }}>
                <scComp.HoleRow />
                <scComp.ParRow />
                {weekSch?.isPlayoff && <scComp.HcpRow />}
                {sc.oppPids.map(pid => <scComp.PlayerRow key={pid} pid={pid} />)}
                <scComp.TeamNetRow pids={sc.oppPids} isTeam1Side={false} />
              </div>

              <div style={{ marginTop: 16 }}>
                {!isAlreadyFinalized && (
                  <>
                    <button disabled={justSigned} onClick={async () => { setJustSigned(true); await finalizeMatch(); }} style={{ width: "100%", padding: "14px", borderRadius: 12, background: justSigned ? K.t3 : "#3b82f6", border: "none", color: "#fff", fontSize: 15, fontWeight: 800, cursor: justSigned ? "default" : "pointer", opacity: justSigned ? 0.7 : 1 }}>
                      {justSigned ? "Signing..." : "Sign Scorecard"}
                    </button>
                    {!justSigned && (
                    <button onClick={() => setShowFinalize(false)} style={{ width: "100%", padding: 10, background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer", marginTop: 4 }}>
                      Go Back & Edit
                    </button>
                    )}
                  </>
                )}
                {isAlreadyFinalized && (
                  <>
                    {isComm && !showEditConfirm && (
                      <button onClick={() => setShowEditConfirm(true)} style={{ width: "100%", padding: "12px", borderRadius: 12, background: K.warn, border: "none", color: K.bg, fontSize: 14, fontWeight: 800, cursor: "pointer", marginBottom: 6 }}>
                        Edit Scores
                      </button>
                    )}
                    {isComm && showEditConfirm && (
                      <div style={{ background: K.warn + "15", border: `1px solid ${K.warn}40`, borderRadius: 10, padding: 12, marginBottom: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: K.t1, marginBottom: 10 }}>This will allow score edits. Continue?</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => { setShowEditConfirm(false); setShowFinalize(false); }} style={{ flex: 1, padding: 10, borderRadius: 8, background: K.warn, border: "none", color: K.bg, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                            Yes
                          </button>
                          <button onClick={() => setShowEditConfirm(false)} style={{ flex: 1, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                            No
                          </button>
                        </div>
                      </div>
                    )}
                    <button onClick={() => { setShowFinalize(false); setShowEditConfirm(false); }} style={{ width: "100%", padding: 10, background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer", marginTop: 4 }}>
                      Close
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </>);
      })()}
      {/* Custom confirm modal */}
      {confirmModal && (<>
        <div onClick={() => setConfirmModal(null)} data-popup style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 900 }} />
        <div data-popup style={{ position: "fixed", inset: 0, zIndex: 950, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: K.bg, border: `1px solid ${K.bdr}`, borderRadius: 14, padding: "20px", width: "100%", maxWidth: 320 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: K.act, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>MnQ Golf League</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: K.t1, marginBottom: 6 }}>{confirmModal.title}</div>
            <div style={{ fontSize: 13, color: K.t2, lineHeight: 1.5, marginBottom: 16, whiteSpace: "pre-line" }}>{confirmModal.message}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={confirmModal.onConfirm} style={{ flex: 1, padding: 12, borderRadius: 10, background: K.act, border: "none", color: K.bg, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Confirm
              </button>
              <button onClick={() => setConfirmModal(null)} style={{ flex: 1, padding: 12, borderRadius: 10, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </>)}
      {/* Toast */}
      {toast && (<>
        <style>{`@keyframes toastDown { 0% { transform: translateX(-50%) translateY(-20px); opacity: 0; } 100% { transform: translateX(-50%) translateY(0); opacity: 1; } }`}</style>
        <div style={{ position: "fixed", top: 30, left: "50%", transform: "translateX(-50%)", background: K.act, color: K.bg, padding: "12px 48px", borderRadius: 12, fontSize: 13, fontWeight: 700, zIndex: 1000, whiteSpace: "nowrap", minWidth: 240, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", animation: "toastDown 0.3s ease" }}>
          {toast}
        </div>
      </>)}
    </div>
  );
}


function PlayerScoreCard({ pl, score, strokes, nh, run, btns: defaultBtns, par, pid, week, curHole, saveScore, K, absentBtn }) {
  const handleScore = (val) => {
    saveScore(week, pid, curHole, val);
  };
  const maxBtn = defaultBtns[defaultBtns.length - 1];
  const minBtn = defaultBtns[0];
  let btns = defaultBtns;
  if (score > maxBtn) {
    const shift = score - maxBtn;
    btns = defaultBtns.map(b => b + shift);
  } else if (score > 0 && score < minBtn) {
    const shift = minBtn - score;
    btns = defaultBtns.map(b => b - shift);
  }
  return (
    <Card style={{ marginBottom: 3, padding: "6px 10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 1 }}>{pl.name}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: K.t2, flexShrink: 0 }}>({nh})</span>
        {strokes > 0 && <span style={{ color: "#3b82f6", fontSize: 12, letterSpacing: 1, flexShrink: 0, lineHeight: 1 }}>{"●".repeat(strokes)}</span>}
        <div style={{ flex: 1 }} />
        {run.thru > 0 && <span style={{ fontSize: 10, color: K.t3, flexShrink: 0, whiteSpace: "nowrap" }}>Net: <strong style={{ color: run.netVsPar < 0 ? K.red : run.netVsPar === 0 ? K.t3 : K.t1 }}>{run.netVsPar > 0 ? "+" + run.netVsPar : run.netVsPar === 0 ? "E" : run.netVsPar}</strong> thru {run.thru}</span>}
        {absentBtn}
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {btns.map(btn => {
          const isCur = btn === score; const sd = btn - par;
          const boxSize = 32;
          return (
            <button key={btn} onClick={() => handleScore(isCur ? 0 : btn)} style={{ flex: 1, height: 38, borderRadius: 8, cursor: "pointer", fontSize: 15, fontWeight: 800, border: "none", background: isCur ? K.acc : K.inp, color: isCur ? K.bg : K.t2, position: "relative", transition: "all .15s", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {isCur && sd !== 0 && <div style={{ position: "absolute", width: boxSize, height: boxSize, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}><div style={{ position: "absolute", inset: 0, borderRadius: sd < 0 ? "50%" : 3, border: `1.5px solid ${sd < 0 ? K.red : K.bg}` }} />{Math.abs(sd) >= 2 && <div style={{ position: "absolute", inset: 3, borderRadius: sd < 0 ? "50%" : 2, border: `1px solid ${sd < 0 ? K.red : K.bg}` }} />}</div>}
              <span style={{ position: "relative", zIndex: 1 }}>{btn}</span>
            </button>
          );
        })}
        <button onClick={() => handleScore(Math.max(1, (score || par) - 1))} style={{ width: 26, height: 38, borderRadius: 8, background: K.inp, border: "none", color: K.t3, fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>−</button>
        <button onClick={() => handleScore((score || par) + 1)} style={{ width: 26, height: 38, borderRadius: 8, background: K.inp, border: "none", color: K.t3, fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>+</button>
      </div>
    </Card>
  );
}