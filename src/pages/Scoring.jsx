import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { K, FONTS, CSS, I, Pill, BackBtn, SaveBtn, SectionTitle, SubLabel, Card, EmptyState,
  SEASON_WEEKS, REGULAR_WEEKS, TEAMS_COUNT, getTeeTime, getWeekSide, calcCourseHandicap, calcNineHandicap, calcLeagueHandicap,
  lastNamesOnly, formatTeeTime as fmtTeeTimeUtil, LIST_GAP, CARD_RADIUS, NAME_SIZE, CHEVRON_SIZE } from "../theme";
import { LEAGUE_ID } from "../firebase";

// Golf scorecard cell — shows score with standard indicators:
// Eagle (−2): double circle  |  Birdie (−1): circle
// Par (0): plain  |  Bogey (+1): square
// Double bogey (+2): double square  |  Triple+ (+3): double square
// All borders use same muted color for clean look
function ScoreCell({ score, par, strokes, size = 13, color: colorOverride }) {
  if (!score || score <= 0) return <span style={{ color: K.t3 + "30", fontSize: size }}>·</span>;
  const diff = score - par;
  const s = size;
  const sh = s + 8;
  const bc = colorOverride || K.t2;
  const textColor = colorOverride || undefined;
  const dotH = 10;

  // Border shape — centered absolutely in the score area
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
  } else if (diff === 2) {
    border = (
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: 3, border: `1.5px solid ${bc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: sh - 6, height: sh - 6, borderRadius: 2, border: `1px solid ${bc}` }} />
      </div>
    );
  } else if (diff >= 3) {
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

export default function LiveScoringView({ leagueUser, players, teams, course, schedule, holeScores, saveScore, scoringRules, matchResults, saveMatchResult, ctpData, saveCtp, setLiveWeek, fetchWeekScores, isComm, leagueConfig, saveWeekSchedule, openAllMatches, onAllMatchesOpened }) {
  const [activeMatch, setActiveMatch] = useState(null);
  const [curHole, setCurHole] = useState(0);
  const [showAllMatches, setShowAllMatches] = useState(false);
  const [expandedMatch, setExpandedMatch] = useState(null);
  const [toast, setToast] = useState(null);

  // If App signals to open All Matches (e.g. from finalize banner), do it
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
  const [absentPlayers, setAbsentPlayers] = useState({}); // { playerId: true }
  const [confirmModal, setConfirmModal] = useState(null); // { title, message, onConfirm }
  const initialJump = useRef(false);
  const matchGrn = K.matchGrn;

  // Find current week: first non-locked week with matches
  // Only advances when the commish locks/finalizes the week
  const currentWeek = useMemo(() => {
    for (const wk of schedule) {
      if (wk.rainedOut) continue;
      if (!wk.matches || wk.matches.length === 0) continue; // skip seeded/TBD weeks
      if (!wk.locked) return wk.week; // stay on this week until commish locks it
    }
    // All weeks locked — show the last playable week
    const playable = schedule.filter(wk => !wk.rainedOut && wk.matches && wk.matches.length > 0);
    return playable.length ? playable[playable.length - 1].week : 0;
  }, [schedule, matchResults]);

  const week = currentWeek;

  // Tell App.jsx which week to subscribe to
  useEffect(() => { setLiveWeek(week); }, [week, setLiveWeek]);

  const weekSch = schedule.find(s => s.week === week);
  const matches = weekSch?.matches || [];
  const side = weekSch?.side || getWeekSide(week);
  const pars = course ? (side === 'front' ? course.frontPars : course.backPars) : [4,4,4,3,5,4,4,3,5];
  const hcps = course ? (side === 'front' ? course.frontHcps : course.backHcps) : [1,3,5,7,9,11,13,15,17];
  const myTeam = teams.find(t => t.player1 === leagueUser.playerId || t.player2 === leagueUser.playerId);

  // Find user's match
  const myMatch = myTeam ? matches.find(m => m.team1 === myTeam.id || m.team2 === myTeam.id) : null;

  // Week finalization checks
  const isWeekLocked = weekSch?.locked === true;
  const allMatchesFinalized = matches.every(m =>
    matchResults.some(r => r.week === week && r.team1Id === m.team1 && r.team2Id === m.team2)
  );
  const allMatchesAttested = matches.every(m =>
    matchResults.some(r => r.week === week && r.team1Id === m.team1 && r.team2Id === m.team2 && r.attested === true)
  );

  if (!course?.name) return <EmptyState icon="flag" title="Course not configured" subtitle="Commissioner needs to set up the course." />;
  if (!matches.length) return <EmptyState icon="calendar" title="No matches this week" subtitle="Commissioner needs to set the schedule." />;

  // ── Compute match data unconditionally (hooks must always run) ──
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
    const p = players.find(pl => pl.id === pid);
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

  useEffect(() => {
    if (!t1 || !t2) return;
    const abs = {};
    [...t1Players, ...t2Players].forEach(pid => {
      if (holeScores[`w${week}_p${pid}_habsent`] === 1) abs[pid] = true;
    });
    setAbsentPlayers(abs);
  }, [matchKey]);

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
        // Net bogey: gross score = par + 1 + strokes so that net = par + 1
        const strokes = getStrokesMap((() => {
          const p = players.find(pl => pl.id === pid);
          return p ? Math.round(p.handicapIndex || 0) : 0;
        })())[h] || 0;
        return (pars[h] || 4) + 1 + strokes;
      }
      return getRawScore(tm, h);
    }
    return getRawScore(pid, h);
  };
  const getNineHcp = (pid) => {
    if (isBothAbsent(pid)) {
      const p = players.find(pl => pl.id === pid);
      return p ? Math.round(p.handicapIndex || 0) : 0;
    }
    const effectivePid = isPlayerAbsent(pid) ? (getTeammate(pid) || pid) : pid;
    const p = players.find(pl => pl.id === effectivePid);
    return p ? Math.round(p.handicapIndex || 0) : 0;
  };
  const getStrokesMap = (nh) => {
    const map = {}; const sorted = hcps.map((h, i) => ({ idx: i, hcp: h })).sort((a, b) => a.hcp - b.hcp);
    let rem = Math.abs(nh);
    for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + 1; rem--; }
    for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + 1; rem--; }
    return map;
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
  const isAttested = existingResult?.attested === true;
  const finalizedByTeamId = existingResult?.finalizedByTeamId || null;
  const signedByPlayerId = existingResult?.signedByPlayerId || null;
  const isTheSigner = leagueUser.playerId === signedByPlayerId;
  const isOnFinalizingTeam = myTeam && (finalizedByTeamId === myTeam.id || isTheSigner);
  const isOnOpposingTeam = myTeam && !isOnFinalizingTeam && (myTeam.id === (t1?.id) || myTeam.id === (t2?.id));
  const needsAttestation = isAlreadyFinalized && !isAttested && isOnOpposingTeam;
  const scoresLocked = (isWeekLocked && !isComm) || (isAttested && !isComm);

  const guardedSaveScore = (w, pid, h, val) => {
    if (scoresLocked) {
      setToast(isWeekLocked ? "Week is locked — scores cannot be changed" : "Scorecard attested — only commissioner can edit");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    saveScore(w, pid, h, val);
  };

  const currentHoleIdx = (() => {
    for (let h = 0; h < 9; h++) { if (!allP.every(pid => getS(pid, h) > 0)) return h; }
    return 8;
  })();

  const hasAnyScores = allP.some(pid => { for (let h = 0; h < 9; h++) if (getS(pid, h) > 0) return true; return false; });

  useEffect(() => {
    if (!initialJump.current && currentHoleIdx > 0 && hasAnyScores) {
      setCurHole(currentHoleIdx);
      initialJump.current = true;
    }
  }, [currentHoleIdx, hasAnyScores]);

  useEffect(() => {
    if (holeComplete && curHole < 8 && !editing && !allComplete) {
      const holeNum = side === 'front' ? curHole + 1 : curHole + 10;
      setToast(`✓ Hole ${holeNum} saved — advancing...`);
      initialJump.current = true; // prevent initialJump from competing
      const timer = setTimeout(() => {
        setToast(null);
        let next = curHole + 1;
        while (next < 8 && allP.every(pid => getS(pid, next) > 0)) next++;
        setCurHole(next);
      }, 1800);
      return () => clearTimeout(timer);
    }
  }, [holeComplete, curHole, editing, allComplete]);

  // Safety: clear any stuck toast after 3s
  useEffect(() => {
    if (toast) {
      const safety = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(safety);
    }
  }, [toast]);

  useEffect(() => {
    if (allComplete && !showFinalize && !isAlreadyFinalized) {
      const timer = setTimeout(() => setShowFinalize(true), 600);
      return () => clearTimeout(timer);
    }
  }, [allComplete, isAlreadyFinalized]);

  // ── All Matches view (Schedule "This Week" style + expandable scorecards) ──
  if (showAllMatches && !activeMatch) {
    const formatTeeTime = (idx) => fmtTeeTimeUtil(leagueConfig?.startTime || "4:28 PM", idx, leagueConfig?.teeInterval || 8);
    const dn = (pid) => {
      const pl = players.find(p => p.id === pid);
      if (!pl) return "TBD";
      const parts = pl.name.split(' ');
      return parts.length > 1 ? parts[parts.length - 1] : parts[0];
    };
    const amGetHcp = (pid) => {
      const p = players.find(pl => pl.id === pid);
      return p ? Math.round(p.handicapIndex || 0) : 0;
    };
    const amGetScore = (pid, h) => holeScores[`w${week}_p${pid}_h${h}`] || 0;
    const amGetStrokesMap = (nh) => {
      const map = {}; const sorted = hcps.map((h, i) => ({ idx: i, hcp: h })).sort((a, b) => a.hcp - b.hcp);
      let rem = Math.abs(nh);
      for (const item of sorted) { if (rem <= 0) break; map[item.idx] = (map[item.idx] || 0) + 1; rem--; }
      for (const item of sorted) { if (rem <= 0) break; map[item.idx] = (map[item.idx] || 0) + 1; rem--; }
      return map;
    };
    const amGetStrokes = (pid, h) => amGetStrokesMap(amGetHcp(pid))[h] || 0;

    // Count holes completed for a match
    const getThru = (mT1Pids, mT2Pids) => {
      let thru = 0;
      for (let h = 0; h < 9; h++) {
        const allOk = [...mT1Pids, ...mT2Pids].every(pid => amGetScore(pid, h) > 0);
        if (allOk) thru = h + 1;
        else break;
      }
      return thru;
    };

    return (
      <div>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", background: K.inp, borderRadius: 20, border: `1px solid ${K.bdr}`, padding: 3 }}>
            <button onClick={() => setShowAllMatches(false)} style={{ padding: "6px 16px", borderRadius: 17, cursor: "pointer", fontSize: 12, fontWeight: 700, border: "none", background: "transparent", color: K.t3, transition: "all .2s" }}>
              My Match
            </button>
            <button style={{ padding: "6px 16px", borderRadius: 17, cursor: "default", fontSize: 12, fontWeight: 700, border: "none", background: K.acc, color: K.bg, transition: "all .2s" }}>
              All Matches
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: K.t3, textTransform: "uppercase", letterSpacing: 1.5 }}>Week {week}</div>
          {weekSch?.date && <div style={{ fontSize: 9, color: K.t3 }}>{weekSch.date}</div>}
        </div>

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

            // Compute live match score (from dispT1 perspective)
            let dispCum = 0;
            if (thru > 0) {
              let cum = 0;
              for (let h = 0; h < thru; h++) {
                let n1 = 0, n2 = 0;
                mT1Pids.forEach(pid => { n1 += amGetScore(pid, h) - amGetStrokes(pid, h); });
                mT2Pids.forEach(pid => { n2 += amGetScore(pid, h) - amGetStrokes(pid, h); });
                if (n1 < n2) cum += 1; else if (n2 < n1) cum -= 1;
              }
              dispCum = swapped ? -cum : cum;
            }

            // Determine display state
            const isFinalOrSigned = !!res;
            const isTied = isFinalOrSigned ? (score1 === score2) : (thru > 0 && dispCum === 0);
            const t1Leading = isFinalOrSigned ? (score1 > score2) : (dispCum > 0);
            const t2Leading = isFinalOrSigned ? (score2 > score1) : (dispCum < 0);

            // Center text and color
            let centerText = "";
            let centerColor = K.t1;
            let progressLabel = "";
            let progressColor = K.t3;

            if (isFinalOrSigned) {
              centerText = res.matchResultText || `${score1}-${score2}`;
              centerColor = isTied ? K.t3 : K.t1;
              if (res.attested) { progressLabel = "FINAL"; progressColor = K.grn; }
              else { progressLabel = "SIGNED"; progressColor = K.warn; }
            } else if (thru > 0) {
              if (dispCum > 0) { centerText = dispCum + "UP"; centerColor = K.matchGrn; }
              else if (dispCum < 0) { centerText = Math.abs(dispCum) + "UP"; centerColor = K.matchGrn; }
              else { centerText = "AS"; centerColor = K.t3; }
              progressLabel = "Thru " + thru;
            } else {
              centerText = formatTeeTime(mi);
              centerColor = K.act;
            }

            // Shrink font for longer result text like "TIED"
            const centerFontSize = !isFinalOrSigned && thru === 0 ? 18 : centerText.length > 3 ? 17 : 20;

            // Slightly darker gray for All Matches names
            const dimColor = K.t2;

            // Name styling: final winners = bold + full color, final losers = lighter gray,
            // non-final = all gray
            const t1NameWeight = isFinalOrSigned && t1Leading ? 700 : 600;
            const t2NameWeight = isFinalOrSigned && t2Leading ? 700 : 600;
            const t1NameColor = !isFinalOrSigned ? dimColor : t1Leading ? K.t1 : dimColor;
            const t2NameColor = !isFinalOrSigned ? dimColor : t2Leading ? K.t1 : dimColor;

            // Determine which display side signed (for orange arrow on SIGNED matches)
            const isSigned = isFinalOrSigned && res && !res.attested;
            const signerIsDispT1 = isSigned && (
              (swapped && res.finalizedByTeamId === rawT2.id) ||
              (!swapped && res.finalizedByTeamId === rawT1.id)
            );
            const signerIsDispT2 = isSigned && !signerIsDispT1;

            return (
              <div key={mi} style={{ background: K.card, borderRadius: 10, border: isMyMatch ? `1.5px solid ${K.act}` : `1px solid ${K.bdr}40`, overflow: "hidden" }}>
                <button onClick={() => setExpandedMatch(isExp ? null : mi)} style={{ width: "100%", padding: "8px 10px", cursor: "pointer", textAlign: "left", background: "transparent", border: "none" }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    {/* Left team */}
                    <div style={{ flex: 1, textAlign: "right", paddingRight: 4, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                      <div style={{ fontSize: 14, fontWeight: t1NameWeight, color: t1NameColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textTransform: "uppercase" }}>{dn(dispT1?.player1)}</div>
                      <div style={{ fontSize: 14, fontWeight: t1NameWeight, color: t1NameColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textTransform: "uppercase" }}>{dn(dispT1?.player2)}</div>
                    </div>
                    {/* Left arrow — fixed 16px column */}
                    <div style={{ width: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {t1Leading && (
                        <svg width="10" height="12" viewBox="0 0 10 12" style={{ transform: "rotate(-90deg)" }}>
                          {isFinalOrSigned
                            ? <polygon points="5,0 10,12 0,12" fill={K.matchGrn} />
                            : <polygon points="5,1 9,11 1,11" fill="none" stroke={K.matchGrn} strokeWidth="1.5" />
                          }
                        </svg>
                      )}
                      {signerIsDispT1 && !t1Leading && (
                        <svg width="10" height="12" viewBox="0 0 10 12" style={{ transform: "rotate(-90deg)" }}>
                          <polygon points="5,1 9,11 1,11" fill="none" stroke={K.warn} strokeWidth="1.5" />
                        </svg>
                      )}
                    </div>
                    {/* Center — fixed width */}
                    <div style={{ textAlign: "center", width: 80, flexShrink: 0 }}>
                      <div style={{ fontSize: centerFontSize, fontWeight: 800, color: centerColor, letterSpacing: .5 }}>{centerText}</div>
                      {progressLabel && (
                        <div style={{ fontSize: 9, fontWeight: 700, color: progressColor, textTransform: "uppercase", letterSpacing: 1, marginTop: 1 }}>{progressLabel}</div>
                      )}
                    </div>
                    {/* Right arrow — fixed 16px column */}
                    <div style={{ width: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {t2Leading && (
                        <svg width="10" height="12" viewBox="0 0 10 12" style={{ transform: "rotate(90deg)" }}>
                          {isFinalOrSigned
                            ? <polygon points="5,0 10,12 0,12" fill={K.matchGrn} />
                            : <polygon points="5,1 9,11 1,11" fill="none" stroke={K.matchGrn} strokeWidth="1.5" />
                          }
                        </svg>
                      )}
                      {signerIsDispT2 && !t2Leading && (
                        <svg width="10" height="12" viewBox="0 0 10 12" style={{ transform: "rotate(90deg)" }}>
                          <polygon points="5,1 9,11 1,11" fill="none" stroke={K.warn} strokeWidth="1.5" />
                        </svg>
                      )}
                    </div>
                    {/* Right team */}
                    <div style={{ flex: 1, textAlign: "left", paddingLeft: 4, overflow: "hidden", display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ fontSize: 14, fontWeight: t2NameWeight, color: t2NameColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textTransform: "uppercase" }}>{dn(dispT2?.player1)}</div>
                      <div style={{ fontSize: 14, fontWeight: t2NameWeight, color: t2NameColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textTransform: "uppercase" }}>{dn(dispT2?.player2)}</div>
                    </div>
                    {/* Expand chevron */}
                    <div style={{ flexShrink: 0, marginLeft: 4, color: K.t3, fontSize: 12, transform: isExp ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</div>
                  </div>
                </button>

                {/* Expanded scorecard */}
                {isExp && (() => {
                  const colBdr = `1px solid ${K.bdr}30`;
                  const gridLine = `1px solid ${K.bdr}25`;
                  const getInitials = (pid) => { const pl = players.find(p => p.id === pid); return pl ? pl.name.split(' ').map(n => n[0]).join('') : "?"; };

                  // Compute hole results for this match
                  const mHoleResults = [];
                  for (let h = 0; h < 9; h++) {
                    let n1 = 0, n2 = 0, ok1 = true, ok2 = true;
                    mT1Pids.forEach(pid => { const s = amGetScore(pid, h); if (s <= 0) ok1 = false; else n1 += s - amGetStrokes(pid, h); });
                    mT2Pids.forEach(pid => { const s = amGetScore(pid, h); if (s <= 0) ok2 = false; else n2 += s - amGetStrokes(pid, h); });
                    if (ok1 && ok2) mHoleResults.push(n1 < n2 ? 1 : n2 < n1 ? -1 : 0);
                    else mHoleResults.push(null);
                  }
                  // Running status from T1 perspective
                  const mRunning = []; let mCum = 0;
                  mHoleResults.forEach(r => { if (r !== null) mCum += r; mRunning.push(r !== null ? mCum : null); });
                  let mClinchHole = null, mClinchText = null;
                  for (let h = 0; h < 9; h++) {
                    if (mRunning[h] === null) break;
                    const lead = Math.abs(mRunning[h]);
                    const rem = 8 - h;
                    if (lead > rem) { mClinchHole = h; mClinchText = rem > 0 ? lead + "&" + rem : lead + "UP"; break; }
                  }

                  // Swap holeResults to be from dispT1 perspective if swapped
                  const dispHoleResults = swapped ? mHoleResults.map(r => r !== null ? -r : null) : mHoleResults;
                  const dispRunning = []; let dCum = 0;
                  dispHoleResults.forEach(r => { if (r !== null) dCum += r; dispRunning.push(r !== null ? dCum : null); });

                  // Compute clinch from display perspective (top team)
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

                  // Absent detection for all-matches view
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
                        // Both absent — net bogey
                        const nh = amGetHcp(pid);
                        const strokesOnHole = amGetStrokesMap(nh)[h] || 0;
                        return (pars[h] || 4) + 1 + strokesOnHole;
                      }
                      return amGetScore(tm, h); // teammate's score doubled
                    }
                    return amGetScore(pid, h);
                  };

                  const PlayerRow = ({ pid }) => {
                    const absent = amIsAbsent(pid);
                    let gt = 0;
                    return (
                      <div style={{ display: "flex", alignItems: "center", borderBottom: gridLine }}>
                        <div style={{ width: 28, flexShrink: 0, borderRight: "none", paddingLeft: 4, display: "flex", alignItems: "center", height: 38, paddingTop: 10 }}>
                          <span style={{ fontSize: 13, color: K.t1, fontWeight: 800 }}>{getInitials(pid)}</span>
                        </div>
                        <div style={{ width: 16, flexShrink: 0, borderRight: gridLine, display: "flex", alignItems: "center", height: 38, paddingTop: 10 }}>
                          <span style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700 }}>{amGetHcp(pid)}</span>
                        </div>
                        {Array.from({ length: 9 }, (_, h) => {
                          const s = amGetEffectiveScore(pid, h); const st = amGetStrokes(pid, h); if (s > 0) gt += s;
                          return <div key={h} style={{ flex: 1, height: 38, display: "flex", alignItems: "center", justifyContent: "center", borderRight: h < 8 ? gridLine : "none" }}>
                            <ScoreCell score={s} par={pars[h]} strokes={st} size={13} color={absent ? K.red : undefined} />
                          </div>;
                        })}
                      </div>
                    );
                  };

                  const TeamNetRow = ({ pids, isDispT1 }) => {
                    return (
                      <div style={{ display: "flex", alignItems: "center", background: K.act + "0c" }}>
                        <div style={{ width: 44, flexShrink: 0, fontSize: 9, color: K.act, fontWeight: 800, borderRight: gridLine, paddingLeft: 4, display: "flex", alignItems: "center", height: 28 }}>NET</div>
                        {Array.from({ length: 9 }, (_, h) => {
                          let tNet = 0; let ok = true;
                          pids.forEach(pid => { const s = amGetEffectiveScore(pid, h); if (s <= 0) ok = false; else tNet += s - amGetStrokes(pid, h); });
                          const won = dispHoleResults[h] === (isDispT1 ? 1 : -1);
                          return <div key={h} style={{
                            flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800, color: !ok ? K.t3 + "30" : K.t1, lineHeight: "22px",
                            padding: "4px 0", borderRight: won ? "none" : gridLine,
                            ...(won ? { background: K.bg, border: `1.5px solid ${K.act}`, borderRadius: 3, margin: "-1px 1px", position: "relative", zIndex: 1 } : {}),
                          }}>{ok ? tNet : "\u00B7"}</div>;
                        })}
                      </div>
                    );
                  };

                  const MatchRow = () => (
                    <div style={{ display: "flex", background: K.card, border: `1px solid ${K.bdr}40`, borderRadius: 6, padding: "2px 0", margin: "4px 0" }}>
                      <div style={{ width: 44, flexShrink: 0, fontSize: 8, fontWeight: 800, color: K.t2, display: "flex", alignItems: "center", paddingLeft: 4, borderRight: gridLine }}>MATCH</div>
                      {dispRunning.map((rs, i) => {
                        const bdr = i < 8 ? { borderRight: gridLine } : {};
                        if (rs === null) return <div key={i} style={{ flex: 1, height: 22, ...bdr }} />;
                        if (dispClinchHole !== null && i > dispClinchHole) return <div key={i} style={{ flex: 1, height: 22, ...bdr }} />;
                        if (dispClinchHole !== null && i === dispClinchHole) {
                          const c = rs > 0 ? matchGrn : rs < 0 ? K.red : K.t3;
                          return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 800, color: c, lineHeight: "22px", ...bdr }}>{dispClinchText}</div>;
                        }
                        const c = rs > 0 ? matchGrn : rs < 0 ? K.red : K.t3;
                        return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 800, color: c, lineHeight: "22px", ...bdr }}>
                          {rs > 0 ? "\u25B2" + rs : rs < 0 ? "\u25BC" + Math.abs(rs) : "\u2014"}
                        </div>;
                      })}
                    </div>
                  );

                  const dispT1Pids = swapped ? mT2Pids : mT1Pids;
                  const dispT2Pids = swapped ? mT1Pids : mT2Pids;

                  return (
                    <div style={{ padding: "6px 8px 10px", borderTop: `1px solid ${K.bdr}30` }}>
                      {/* Header row + Par row */}
                      <div style={{ display: "flex", background: K.acc, borderRadius: "6px 6px 0 0" }}>
                        <div style={{ width: 44, flexShrink: 0, fontSize: 10, color: K.bg, fontWeight: 800, paddingLeft: 4, opacity: .8, display: "flex", alignItems: "center", height: 30 }}>HOLE</div>
                        {Array.from({ length: 9 }, (_, i) => (
                          <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 12, color: K.bg, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", height: 30 }}>{side === 'front' ? i + 1 : i + 10}</div>
                        ))}
                      </div>
                      <div style={{ display: "flex", borderBottom: gridLine, background: K.acc + "18" }}>
                        <div style={{ width: 44, flexShrink: 0, fontSize: 10, color: K.acc, fontWeight: 700, borderRight: gridLine, paddingLeft: 4, display: "flex", alignItems: "center", height: 26 }}>PAR</div>
                        {pars.map((p, i) => <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 11, color: K.t2, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", height: 26, borderRight: i < 8 ? gridLine : "none" }}>{p}</div>)}
                      </div>

                      {/* Team 1 (display perspective) */}
                      <div style={{ fontSize: 9, fontWeight: 700, color: K.acc, textTransform: "uppercase", letterSpacing: 1, padding: "4px 4px 2px" }}>{dispT1.name}</div>
                      {dispT1Pids.map(pid => <PlayerRow key={pid} pid={pid} />)}
                      <TeamNetRow pids={dispT1Pids} isDispT1={true} />

                      <MatchRow />

                      {/* Team 2 (display perspective) */}
                      <div style={{ fontSize: 9, fontWeight: 700, color: K.acc, textTransform: "uppercase", letterSpacing: 1, padding: "4px 4px 2px" }}>{dispT2.name}</div>
                      {dispT2Pids.map(pid => <PlayerRow key={pid} pid={pid} />)}
                      <TeamNetRow pids={dispT2Pids} isDispT1={false} />
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {isComm && (
          <div style={{ marginTop: 12 }}>
            {allMatchesAttested && !isWeekLocked && saveWeekSchedule && (
              <button onClick={async () => {
                await saveWeekSchedule({ ...weekSch, locked: true });
                setToast("Week " + week + " finalized");
                setTimeout(() => {
                  setToast(null);
                  setShowAllMatches(false);
                  setActiveMatch(null);
                  setExpandedMatch(null);
                }, 2000);
              }} style={{ width: "100%", padding: 14, borderRadius: 12, cursor: "pointer", background: K.act, border: "none", color: K.bg, fontSize: 14, fontWeight: 800 }}>
                Finalize Week {week}
              </button>
            )}
          </div>
        )}

        {toast && (
          <div style={{ position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", background: K.act, color: K.bg, padding: "12px 48px", borderRadius: 12, fontSize: 13, fontWeight: 700, zIndex: 1000, whiteSpace: "nowrap", minWidth: 240, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
            {toast}
          </div>
        )}
      </div>
    );
  }

  // ── Default: auto-open user's match, or show prompt ──
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

  const finalizeMatch = async () => {
    const sr = week > REGULAR_WEEKS
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
      if (bonusType === "lowestNet") {
        b1 = Math.min(getRunning(t1s[0]).net, getRunning(t1s[1]).net);
        b2 = Math.min(getRunning(t2s[0]).net, getRunning(t2s[1]).net);
      } else if (bonusType === "totalGross") {
        b1 = t1Gross; b2 = t2Gross;
      } else {
        b1 = t1Net; b2 = t2Net;
      }
      if (b1 < b2) { t1Pts += sr.bw; t2Pts += sr.bl; } else if (b1 > b2) { t1Pts += sr.bl; t2Pts += sr.bw; } else { t1Pts += sr.bt; t2Pts += sr.bt; }
    }

    // Calculate holes won per team (net-based) and match result text
    let hw1 = 0, hw2 = 0;
    const holeResults = [];
    for (let h = 0; h < 9; h++) {
      let n1 = 0, n2 = 0;
      t1Players.forEach(pid => { n1 += getS(pid, h) - getStrokes(pid, h); });
      t2Players.forEach(pid => { n2 += getS(pid, h) - getStrokes(pid, h); });
      if (n1 < n2) { hw1++; holeResults.push(1); }
      else if (n2 < n1) { hw2++; holeResults.push(-1); }
      else { holeResults.push(0); }
    }

    const runningStatus = [];
    let cum = 0;
    holeResults.forEach(r => { cum += r; runningStatus.push(cum); });

    let matchEndHole = 8;
    let matchMargin = Math.abs(runningStatus[8]);
    for (let h = 0; h < 9; h++) {
      const lead = Math.abs(runningStatus[h]);
      const remaining = 8 - h;
      if (lead > remaining) {
        matchEndHole = h;
        matchMargin = lead;
        break;
      }
    }
    const holesRemaining = 8 - matchEndHole;
    const finalStatus = runningStatus[8];

    let matchResultText;
    if (finalStatus === 0) {
      matchResultText = "TIED";
    } else if (holesRemaining > 0) {
      matchResultText = `${matchMargin}&${holesRemaining}`;
    } else {
      matchResultText = `${Math.abs(finalStatus)}UP`;
    }

    await saveMatchResult({
      id: `${LEAGUE_ID}_w${week}_${t1.id}_${t2.id}`, week,
      team1Id: t1.id, team2Id: t2.id,
      team1Points: t1Pts, team2Points: t2Pts,
      t1Total: t1Net, t2Total: t2Net,
      t1HolesWon: hw1, t2HolesWon: hw2,
      matchResultText,
      matchWinnerId: finalStatus > 0 ? t1.id : finalStatus < 0 ? t2.id : null,
      finalizedByTeamId: myTeam?.id || null,
      signedByPlayerId: leagueUser.playerId || null,
      attested: false,
    });
  };

  const attestMatch = async () => {
    if (!existingResult) return;
    await saveMatchResult({
      ...existingResult,
      attested: true,
      attestedByTeamId: myTeam?.id || null,
      attestedByPlayerId: leagueUser.playerId || null,
    });
    setShowFinalize(false);
    setShowEditConfirm(false);
    setToast("Scorecard attested ✓");
    setTimeout(() => setToast(null), 2000);
  };

  // ── Shared scorecard data builder ──
  const buildScorecardData = () => {
    const myTeamId = myTeam?.id || t1.id;
    const isMyT1 = t1.id === myTeamId;
    const myPids = isMyT1 ? t1Players : t2Players;
    const oppPids = isMyT1 ? t2Players : t1Players;
    const myTeamObj = isMyT1 ? t1 : t2;
    const oppTeamObj = isMyT1 ? t2 : t1;

    let myHW = 0, oppHW = 0;
    const holeResults = [];
    for (let h = 0; h < 9; h++) {
      let mN = 0, oN = 0;
      myPids.forEach(pid => { mN += getS(pid, h) - getStrokes(pid, h); });
      oppPids.forEach(pid => { oN += getS(pid, h) - getStrokes(pid, h); });
      if (mN < oN) { myHW++; holeResults.push(1); }
      else if (oN < mN) { oppHW++; holeResults.push(-1); }
      else holeResults.push(0);
    }

    const runningStatus = [];
    let cum = 0;
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
    const isWin = finalStatus > 0;
    const isLoss = finalStatus < 0;
    const isTie = finalStatus === 0;

    let matchResultText;
    if (isTie) matchResultText = "TIED";
    else if (holesRemaining > 0) matchResultText = `${matchMargin}&${holesRemaining}`;
    else matchResultText = `${Math.abs(finalStatus)}UP`;

    const matchResult = isWin ? "WIN" : isLoss ? "LOSS" : "TIE";
    const resultColor = isTie ? K.t2 : K.grn;

    // Sort players by handicap (low first) for header display
    const myPidsSorted = [...myPids].sort((a, b) => getHcp(a) - getHcp(b));
    const oppPidsSorted = [...oppPids].sort((a, b) => getHcp(a) - getHcp(b));

    return { myPids, oppPids, myPidsSorted, oppPidsSorted, myTeamObj, oppTeamObj, myHW, oppHW, holeResults, runningStatus, matchResultText, matchResult, resultColor, isMyT1, matchEndHole };
  };

  return (
    <div>
      {activeMatch && (
        <div style={{ marginBottom: 8 }}>
          <BackBtn onClick={() => { setActiveMatch(null); }} />
        </div>
      )}
      {/* See All Matches */}
      {!activeMatch && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", background: K.inp, borderRadius: 20, border: `1px solid ${K.bdr}`, padding: 3 }}>
            <button style={{ padding: "6px 16px", borderRadius: 17, cursor: "default", fontSize: 12, fontWeight: 700, border: "none", background: K.acc, color: K.bg, transition: "all .2s" }}>
              My Match
            </button>
            <button onClick={() => setShowAllMatches(true)} style={{ padding: "6px 16px", borderRadius: 17, cursor: "pointer", fontSize: 12, fontWeight: 700, border: "none", background: "transparent", color: K.t3, transition: "all .2s" }}>
              All Matches
            </button>
          </div>
        </div>
      )}
      {/* Status banners */}
      {isWeekLocked && (
        <div style={{ background: K.warn + "18", border: `1px solid ${K.warn}40`, borderRadius: 8, padding: "6px 10px", marginBottom: 6, fontSize: 13, color: K.warn, fontWeight: 700, textAlign: "center" }}>
          Week {week} is locked — scores are read-only
        </div>
      )}
      {!isAlreadyFinalized && (
      <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
        {Array.from({ length: 9 }, (_, i) => {
          const cur = i === curHole; const done = allP.every(pid => getS(pid, i) > 0);
          return <button key={i} onClick={() => { setCurHole(i); setEditing(i < currentHoleIdx); }} style={{ flex: 1, height: 38, borderRadius: done || cur ? 10 : 6, border: done && !cur ? `1.5px solid ${K.acc}50` : "none", background: cur ? K.acc : done ? K.acc + "15" : K.card, color: cur ? K.bg : done ? K.acc : K.t3, fontSize: 16, fontWeight: 700, cursor: "pointer", outline: cur ? `2px solid ${K.acc}` : "none", outlineOffset: 1 }}>{i + 1}</button>;
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

        // Calculate match clinch hole
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

        return (<>
          <button onClick={() => setShowScorecard(!showScorecard)} style={{ display: isAlreadyFinalized ? "none" : "flex", marginTop: 6, marginBottom: showScorecard ? 0 : 8, width: "100%", background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: showScorecard ? "8px 8px 0 0" : 8, cursor: "pointer", padding: "8px 0", alignItems: "center" }}>
            {holeStatuses.map((st, i) => {
              const colBorderR = i < 8 ? { borderRight: `1px solid ${K.bdr}30` } : {};
              if (matchClinchHole !== null && i === matchClinchHole) {
                const color = st > 0 ? matchGrn : st < 0 ? K.red : K.t3;
                return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 16, color, fontWeight: 800, lineHeight: "30px", ...colBorderR }}>{clinchScoreText}</div>;
              }
              if (matchClinchHole !== null && i > matchClinchHole) {
                return <div key={i} style={{ flex: 1, height: 30, ...colBorderR }} />;
              }
              if (st === null) return <div key={i} style={{ flex: 1, height: 30, ...colBorderR }} />;
              const color = st > 0 ? matchGrn : st < 0 ? K.red : K.t3;
              return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 16, fontWeight: 800, color, lineHeight: "30px", ...colBorderR }}>{st > 0 ? <><span style={{ fontSize: 16 }}>▲</span>{st}</> : st < 0 ? <><span style={{ fontSize: 16 }}>▼</span>{Math.abs(st)}</> : "—"}</div>;
            })}
          </button>
          {showScorecard && (() => {
            const gridLine = `1px solid ${K.bdr}25`;
            const netBg = K.act + "0c";
            const subHeaderBg = K.acc + "18";
            const scIsMyT1 = t1.id === myTeamId;
            const scMyPids = scIsMyT1 ? t1Players : t2Players;
            const scOppPids = scIsMyT1 ? t2Players : t1Players;

            const scHoleResults = [];
            for (let h = 0; h < 9; h++) {
              let mN = 0, oN = 0, mOk = true, oOk = true;
              scMyPids.forEach(pid => { const s = getS(pid, h); if (s <= 0) mOk = false; else mN += s - getStrokes(pid, h); });
              scOppPids.forEach(pid => { const s = getS(pid, h); if (s <= 0) oOk = false; else oN += s - getStrokes(pid, h); });
              if (mOk && oOk) { scHoleResults.push(mN < oN ? 1 : oN < mN ? -1 : 0); } else { scHoleResults.push(null); }
            }

            const ScPlayerRow = ({ pid }) => {
              const pl = players.find(p => p.id === pid); if (!pl) return null;
              const nh = getNineHcp(pid);
              let grossTotal = 0;
              const cells = Array.from({ length: 9 }, (_, h) => {
                const s = getS(pid, h); const st = getStrokes(pid, h);
                if (s > 0) grossTotal += s;
                return { s, st };
              });
              const initials = pl.name.split(' ').map(n => n[0]).join('');
              return (
                <div style={{ display: "flex", alignItems: "stretch", borderBottom: gridLine }}>
                  <div style={{ width: 28, flexShrink: 0, fontSize: 13, color: K.t1, fontWeight: 800, paddingLeft: 4, display: "flex", alignItems: "center" }}>{initials}</div>
                  <div style={{ width: 16, flexShrink: 0, fontSize: 10, color: "#3b82f6", fontWeight: 700, borderRight: gridLine, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 3 }}>{nh}</div>
                  {cells.map((c, h) => (
                    <div key={h} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 38, borderRight: h < 8 ? gridLine : "none" }}>
                      <ScoreCell score={c.s} par={pars[h]} strokes={c.st} size={13} color={isPlayerAbsent(pid) ? K.red : undefined} />
                    </div>
                  ))}
                </div>
              );
            };

            const ScTeamRow = ({ pids, side: teamSide }) => {
              let total = 0; let hasAll = true;
              return (
                <div style={{ display: "flex", alignItems: "center", position: "relative", background: netBg, borderBottom: `1.5px solid ${K.act}20` }}>
                  <div style={{ width: 44, flexShrink: 0, fontSize: 9, color: K.act, fontWeight: 800, padding: "5px 0", borderRight: gridLine, paddingLeft: 4, letterSpacing: .5 }}>NET</div>
                  {Array.from({ length: 9 }, (_, h) => {
                    let tNet = 0; let ok = true;
                    pids.forEach(pid => { const s = getS(pid, h); if (s <= 0) ok = false; else tNet += s - getStrokes(pid, h); });
                    if (ok) total += tNet; else hasAll = false;
                    const won = scHoleResults[h] === (teamSide === "my" ? 1 : -1);
                    return <div key={h} style={{
                      flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800, color: !ok ? K.t3 + "30" : K.t1, lineHeight: "22px",
                      padding: "4px 0", borderRight: won ? "none" : gridLine,
                      ...(won ? { background: K.bg, border: `1.5px solid ${K.act}`, borderRadius: 3, margin: "-1px 1px", position: "relative", zIndex: 1 } : {}),
                    }}>{ok ? tNet : "·"}</div>;
                  })}
                </div>
              );
            };

            return (<>
            <div onClick={() => setShowScorecard(false)} data-popup style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 400 }} />
            <div onClick={() => setShowScorecard(false)} style={{ position: "fixed", inset: 0, zIndex: 450, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, touchAction: "pan-y" }}>
            <div onClick={e => e.stopPropagation()} style={{ background: K.bg, border: `1px solid ${K.bdr}`, borderRadius: 14, padding: "0 0 10px", width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto", overflow: "hidden", overscrollBehavior: "none", WebkitOverflowScrolling: "touch" }}>
              <div style={{ display: "flex", alignItems: "center", background: K.acc, borderRadius: "14px 14px 0 0" }}>
                <div style={{ width: 44, flexShrink: 0, fontSize: 10, color: K.bg, fontWeight: 800, padding: "7px 0", paddingLeft: 4, letterSpacing: .5, opacity: .8 }}>HOLE</div>
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, color: K.bg, fontWeight: 800, lineHeight: "22px", padding: "7px 0" }}>{side === 'front' ? i + 1 : i + 10}</div>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", borderBottom: gridLine, background: subHeaderBg }}>
                <div style={{ width: 44, flexShrink: 0, fontSize: 10, color: K.acc, fontWeight: 700, padding: "5px 0", borderRight: gridLine, paddingLeft: 4, letterSpacing: .3 }}>PAR</div>
                {pars.map((p, i) => <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, color: K.t2, fontWeight: 700, lineHeight: "22px", padding: "5px 0", borderRight: i < 8 ? gridLine : "none" }}>{p}</div>)}
              </div>

              <div style={{ padding: "0 4px" }}>
                {scMyPids.map(pid => <ScPlayerRow key={pid} pid={pid} />)}
                <ScTeamRow pids={scMyPids} side="my" />

                <div style={{ borderBottom: `2px solid ${K.bdr}40`, margin: "3px 0" }} />

                <div style={{ display: "flex", alignItems: "center", background: subHeaderBg, borderBottom: `2px solid ${K.bdr}40` }}>
                  <div style={{ width: 44, flexShrink: 0, fontSize: 10, color: K.acc, fontWeight: 700, padding: "5px 0", borderRight: gridLine, paddingLeft: 4, letterSpacing: .3 }}>MATCH</div>
                  {holeStatuses.map((st, i) => {
                    if (matchClinchHole !== null && i === matchClinchHole) {
                      const color = st > 0 ? matchGrn : st < 0 ? K.red : K.t3;
                      return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, color, fontWeight: 800, lineHeight: "22px", padding: "5px 0", borderRight: i < 8 ? gridLine : "none" }}>{clinchScoreText}</div>;
                    }
                    if (matchClinchHole !== null && i > matchClinchHole) {
                      return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, lineHeight: "22px", padding: "5px 0", borderRight: i < 8 ? gridLine : "none" }} />;
                    }
                    if (st === null) return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, lineHeight: "22px", padding: "5px 0", borderRight: i < 8 ? gridLine : "none", color: K.t3 + "30" }}>—</div>;
                    const color = st > 0 ? matchGrn : st < 0 ? K.red : K.t3;
                    return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800, color, lineHeight: "22px", padding: "5px 0", borderRight: i < 8 ? gridLine : "none" }}>{st > 0 ? <><span style={{ fontSize: 15 }}>▲</span>{st}</> : st < 0 ? <><span style={{ fontSize: 15 }}>▼</span>{Math.abs(st)}</> : "—"}</div>;
                  })}
                </div>

                <div style={{ borderBottom: `2px solid ${K.bdr}40`, margin: "3px 0" }} />

                {scOppPids.map(pid => <ScPlayerRow key={pid} pid={pid} />)}
                <ScTeamRow pids={scOppPids} side="opp" />
              </div>

              <button onClick={() => setShowScorecard(false)} style={{ display: "block", width: "calc(100% - 20px)", margin: "10px auto 0", padding: "9px", background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 8, color: K.t2, fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: .4 }}>
                Close
              </button>
            </div>
            </div>
            </>);
          })()}
        </>);
      })()}
      {/* After signed: show inline scorecard. Before signed: show hole card + scoring UI */}
      {isAlreadyFinalized ? (() => {
        const myTeamId = myTeam?.id || t1.id;
        const isMyT1 = t1.id === myTeamId;
        const scMyPids = isMyT1 ? t1Players : t2Players;
        const scOppPids = isMyT1 ? t2Players : t1Players;
        const scHoleResults = [];
        for (let h = 0; h < 9; h++) {
          let mN = 0, oN = 0;
          scMyPids.forEach(pid => { mN += getS(pid, h) - getStrokes(pid, h); });
          scOppPids.forEach(pid => { oN += getS(pid, h) - getStrokes(pid, h); });
          scHoleResults.push(mN < oN ? 1 : oN < mN ? -1 : 0);
        }
        // Running match status: cumulative holes up/down
        const scRunningStatus = [];
        let cum = 0;
        scHoleResults.forEach(r => { cum += r; scRunningStatus.push(cum); });

        // Calculate clinch hole
        let scClinchHole = null;
        let scClinchText = null;
        for (let h = 0; h < 9; h++) {
          const lead = Math.abs(scRunningStatus[h]);
          const remaining = 8 - h;
          if (lead > remaining && lead > 0) {
            scClinchHole = h;
            scClinchText = remaining > 0 ? `${lead}&${remaining}` : `${lead}UP`;
            break;
          }
        }
        // If no clinch but match is over (all 9 holes), show final result on hole 9
        if (scClinchHole === null && scRunningStatus.length === 9) {
          scClinchHole = 8;
          const final = scRunningStatus[8];
          if (final !== 0) scClinchText = `${Math.abs(final)}UP`;
          else scClinchText = "TIED";
        }

        const SignedPlayerRow = ({ pid }) => {
          const pl = players.find(p => p.id === pid); if (!pl) return null;
          const nh = getNineHcp(pid);
          let grossTotal = 0;
          const cells = Array.from({ length: 9 }, (_, h) => {
            const s = getS(pid, h); const st = getStrokes(pid, h);
            if (s > 0) grossTotal += s;
            return { s, st };
          });
          return (
            <div style={{ display: "flex" }}>
              {cells.map((c, h) => (
                <div key={h} style={{ flex: 1, minHeight: 38, display: "flex", alignItems: "center", justifyContent: "center", borderRight: h < 8 ? colBdr : "none" }}>
                  <ScoreCell score={c.s} par={pars[h]} strokes={c.st} size={15} color={isPlayerAbsent(pid) ? K.red : undefined} />
                </div>
              ))}
            </div>
          );
        };

        const SignedTeamRow = ({ pids, isMyTeam }) => {
          const hw = isMyTeam ? (scHoleResults.filter(r => r === 1).length) : (scHoleResults.filter(r => r === -1).length);
          return (
            <div style={{ display: "flex" }}>
              {Array.from({ length: 9 }, (_, h) => {
                let tNet = 0;
                pids.forEach(pid => { tNet += getS(pid, h) - getStrokes(pid, h); });
                const won = scHoleResults[h] === (isMyTeam ? 1 : -1);
                return <div key={h} style={{
                  flex: 1, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
                  borderRight: h < 8 ? colBdr : "none",
                  background: won ? K.act + "18" : "transparent",
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 26, height: 26, borderRadius: 3,
                    border: won ? `1.5px solid ${K.act}` : "none",
                  }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: K.t2 }}>{tNet}</span>
                  </div>
                </div>;
              })}
            </div>
          );
        };

        const myTeamName = isMyT1 ? t1.name : t2.name;
        const oppTeamName = isMyT1 ? t2.name : t1.name;

        const colBdr = `1px solid ${K.bdr}30`;
        const lw = 40; // label column width
        const lblStyle = { width: lw, flexShrink: 0, fontSize: 9, fontWeight: 700, color: K.t3, display: "flex", alignItems: "center", paddingLeft: 3, borderRight: colBdr, textTransform: "uppercase", letterSpacing: .3 };
        const tw = 30; // total column width
        const totStyle = { width: tw, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderLeft: colBdr };

        // Helper: get player initials
        const getInitials = (pid) => {
          const effectivePid = isPlayerAbsent(pid) ? (getTeammate(pid) || pid) : pid;
          const pl = players.find(p => p.id === effectivePid);
          return pl ? pl.name.split(' ').map(n => n[0]).join('') : "?";
        };

        // Row builders
        const HoleRow = () => (
          <div style={{ display: "flex", background: K.acc, borderRadius: "10px 10px 0 0" }}>
            <div style={{ ...lblStyle, height: 28, color: K.bg, opacity: .8, borderRight: "none" }}>HOLE</div>
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} style={{ flex: 1, height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: K.bg }}>{side === 'front' ? i + 1 : i + 10}</span>
              </div>
            ))}
            <div style={{ ...totStyle, height: 28, borderLeft: "none" }}><span style={{ fontSize: 10, fontWeight: 700, color: K.bg }}>TOT</span></div>
          </div>
        );

        const ParRow = () => (
          <div style={{ display: "flex", borderBottom: colBdr, background: K.acc + "18" }}>
            <div style={{ ...lblStyle, height: 22 }}>PAR</div>
            {pars.map((p, i) => (
              <div key={i} style={{ flex: 1, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRight: i < 8 ? colBdr : "none" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: K.t3 }}>{p}</span>
              </div>
            ))}
            <div style={{ ...totStyle, height: 22 }}><span style={{ fontSize: 11, fontWeight: 700, color: K.t3 }}>{pars.reduce((a, b) => a + b, 0)}</span></div>
          </div>
        );

        const PlayerScoreRow = ({ pid }) => {
          let grossTotal = 0;
          const cells = Array.from({ length: 9 }, (_, h) => {
            const s = getS(pid, h); const st = getStrokes(pid, h);
            if (s > 0) grossTotal += s;
            return { s, st };
          });
          return (
            <div style={{ display: "flex", alignItems: "center", borderBottom: colBdr }}>
              <div style={{ ...lblStyle, height: 38, paddingTop: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: K.t1, width: 24, flexShrink: 0 }}>{getInitials(pid)}</span>
                <span style={{ fontSize: 11, color: "#3b82f6", fontWeight: 700 }}>{getNineHcp(pid)}</span>
              </div>
              {cells.map((c, h) => (
                <div key={h} style={{ flex: 1, height: 38, display: "flex", alignItems: "center", justifyContent: "center", borderRight: h < 8 ? colBdr : "none" }}>
                  <ScoreCell score={c.s} par={pars[h]} strokes={c.st} size={15} color={isPlayerAbsent(pid) ? K.red : undefined} />
                </div>
              ))}
              <div style={{ ...totStyle, height: 38, paddingTop: 10 }}><span style={{ fontSize: 14, fontWeight: 800, color: isPlayerAbsent(pid) ? K.red : K.t1 }}>{grossTotal || ""}</span></div>
            </div>
          );
        };

        const TeamNetRow = ({ pids, isMyTeam }) => {
          let netTotal = 0;
          return (
            <div style={{ display: "flex" }}>
              <div style={{ ...lblStyle, height: 34, fontSize: 9, fontWeight: 800 }}>TEAM</div>
              {Array.from({ length: 9 }, (_, h) => {
                let tNet = 0;
                pids.forEach(pid => { tNet += getS(pid, h) - getStrokes(pid, h); });
                netTotal += tNet;
                const won = scHoleResults[h] === (isMyTeam ? 1 : -1);
                return <div key={h} style={{
                  flex: 1, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
                  borderRight: h < 8 ? colBdr : "none",
                  background: won ? K.act + "18" : "transparent",
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 26, height: 26, borderRadius: 3,
                    border: won ? `1.5px solid ${K.act}` : "none",
                  }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: K.t2 }}>{tNet}</span>
                  </div>
                </div>;
              })}
              <div style={{ ...totStyle, height: 34 }}><span style={{ fontSize: 14, fontWeight: 800, color: K.t1 }}>{netTotal}</span></div>
            </div>
          );
        };

        const MatchStatusRow = () => {
          return (
            <div style={{ display: "flex", background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 8, padding: "4px 0", marginBottom: 4, marginTop: 4 }}>
              <div style={{ ...lblStyle, height: 28, fontWeight: 800, color: K.t2 }}>MATCH</div>
              {scRunningStatus.map((rs, i) => {
                const colBorderR = i < 8 ? { borderRight: colBdr } : {};
                // After clinch — empty
                if (scClinchHole !== null && i > scClinchHole) {
                  return <div key={i} style={{ flex: 1, height: 28, ...colBorderR }} />;
                }
                // On clinch hole — show result text
                if (scClinchHole !== null && i === scClinchHole) {
                  const color = rs > 0 ? matchGrn : rs < 0 ? K.red : K.t3;
                  return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 800, color, lineHeight: "28px", ...colBorderR }}>{scClinchText}</div>;
                }
                // Normal hole — show running status
                const color = rs > 0 ? matchGrn : rs < 0 ? K.red : K.t3;
                return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 800, color, lineHeight: "28px", ...colBorderR }}>
                  {rs > 0 ? <><span style={{ fontSize: 14 }}>▲</span>{rs}</> : rs < 0 ? <><span style={{ fontSize: 14 }}>▼</span>{Math.abs(rs)}</> : "—"}
                </div>;
              })}
              <div style={{ width: tw, flexShrink: 0, height: 28 }} />
            </div>
          );
        };

        return (
          <div style={{ marginBottom: 6, position: "relative" }}>
            {/* FINAL watermark */}
            {isAttested && (
              <div style={{
                position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                pointerEvents: "none", zIndex: 2, overflow: "hidden",
              }}>
                <div style={{
                  fontSize: "min(192px, 22vw)", fontWeight: 900, color: K.t3 + "20",
                  letterSpacing: "min(36px, 4vw)", textTransform: "uppercase",
                  userSelect: "none", whiteSpace: "nowrap",
                  transform: "rotate(-18deg)",
                }}>FINAL</div>
              </div>
            )}

            {/* My team card */}
            <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden", marginBottom: 4 }}>
              <HoleRow />
              <ParRow />
              {scMyPids.map(pid => <PlayerScoreRow key={pid} pid={pid} />)}
              <TeamNetRow pids={scMyPids} isMyTeam={true} />
            </div>

            {/* Match status */}
            <MatchStatusRow />

            {/* Opp team card */}
            <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden" }}>
              <HoleRow />
              <ParRow />
              {scOppPids.map(pid => <PlayerScoreRow key={pid} pid={pid} />)}
              <TeamNetRow pids={scOppPids} isMyTeam={false} />
            </div>

            {/* Awaiting opponent attestation banner — shown to the team that signed */}
            {isAlreadyFinalized && !isAttested && !isWeekLocked && !needsAttestation && (
              <div style={{ background: K.warn + "18", border: `1px solid ${K.warn}40`, borderRadius: 8, padding: "6px 10px", marginTop: 8, fontSize: 13, color: K.warn, fontWeight: 700, textAlign: "center" }}>
                Scorecard signed — awaiting opponent attestation
              </div>
            )}

            {/* Attest button — only for opposing team */}
            {needsAttestation && (
              <div style={{ marginTop: 12 }}>
                <button onClick={attestMatch} style={{ width: "100%", padding: "14px", borderRadius: 12, background: "#3b82f6", border: "none", color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
                  Attest Scorecard
                </button>
              </div>
            )}
          </div>
        );
      })() : (<>
      <div style={{ background: K.acc, borderRadius: 10, padding: "6px 8px", marginBottom: 6, display: "flex", alignItems: "center" }}>
        <button onClick={() => { const prev = Math.max(0, curHole - 1); setCurHole(prev); setEditing(prev < currentHoleIdx); }} disabled={curHole === 0} style={{ width: 32, height: 40, borderRadius: 8, background: "none", border: "none", cursor: curHole === 0 ? "default" : "pointer", color: curHole === 0 ? K.bg + "40" : K.bg, fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px" }}>
          <div style={{ textAlign: "center", minWidth: 36 }}><div style={{ fontSize: 9, color: K.bg, fontWeight: 600, opacity: 0.7 }}>Par</div><div style={{ fontSize: 16, fontWeight: 800, color: K.bg }}>{par}</div></div>
          <div style={{ textAlign: "center" }}><div style={{ fontSize: 9, color: K.bg, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, opacity: 0.7 }}>Hole</div><div style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 30, fontWeight: 700, color: K.bg, lineHeight: 1 }}>{side === 'front' ? curHole + 1 : curHole + 10}</div></div>
          <div style={{ textAlign: "center", minWidth: 36 }}><div style={{ fontSize: 9, color: K.bg, fontWeight: 600, opacity: 0.7 }}>HCP</div><div style={{ fontSize: 16, fontWeight: 800, color: K.bg }}>{hcp}</div></div>
        </div>
        <button onClick={() => { const next = Math.min(8, curHole + 1); setCurHole(next); setEditing(next < currentHoleIdx); }} disabled={curHole === 8} style={{ width: 32, height: 40, borderRadius: 8, background: "none", border: "none", cursor: curHole === 8 ? "default" : "pointer", color: curHole === 8 ? K.bg + "40" : K.bg, fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
      </div>
      </>)}
      {!isAlreadyFinalized && (<>
      {editing && (
        <button onClick={() => { setCurHole(currentHoleIdx); setEditing(false); }} style={{ width: "100%", padding: 8, borderRadius: 8, marginBottom: 6, cursor: "pointer", background: K.teal + "15", border: `1px solid ${K.teal}40`, color: K.teal, fontSize: 12, fontWeight: 700 }}>
          Hole {side === 'front' ? currentHoleIdx + 1 : currentHoleIdx + 10} →
        </button>
      )}

      {allP.map(pid => {
        const pl = players.find(p => p.id === pid); if (!pl) return null;
        const absent = isPlayerAbsent(pid);
        const score = getS(pid, curHole); const strokes = getStrokes(pid, curHole); const nh = getNineHcp(pid); const run = getRunning(pid);
        const btns = par === 3 ? [1,2,3,4,5,6,7] : par === 5 ? [2,3,4,5,6,7,8] : [2,3,4,5,6,7,8];
        // Disable absent toggle after hole 1 has scores from all present players
        const hole1Done = allP.filter(p => !isPlayerAbsent(p)).every(p => getRawScore(p, 0) > 0);
        const absentLocked = hole1Done && !absent;
        const absentBtn = !isAlreadyFinalized ? (
          <button
            onClick={() => {
              if (absentLocked) return;
              const tm = getTeammate(pid);
              const tmPlayer = tm ? players.find(p => p.id === tm) : null;
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
      </>)}
      {/* Finalize / Show Match Details buttons */}
      {allComplete && !showFinalize && !isAlreadyFinalized && (
        <button onClick={() => setShowFinalize(true)} style={{ width: "100%", padding: 10, borderRadius: 10, marginTop: 8, cursor: "pointer", background: "#3b82f615", border: `1.5px solid #3b82f650`, color: "#3b82f6", fontSize: 15, fontWeight: 700 }}>
          All Holes Complete — Sign Scorecard
        </button>
      )}

      {/* ═══ Finalize Popup — for initial signing or commish editing ═══ */}
      {showFinalize && (!isAlreadyFinalized || isComm) && (() => {
        const sc = buildScorecardData();
        const colBdr = `1px solid ${K.bdr}30`;
        const lw = 40;
        const tw = 30;
        const lblStyle = { width: lw, flexShrink: 0, fontSize: 9, fontWeight: 700, color: K.t3, display: "flex", alignItems: "center", paddingLeft: 3, borderRight: colBdr, textTransform: "uppercase", letterSpacing: .3 };
        const totStyle = { width: tw, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderLeft: colBdr };

        const getInitials = (pid) => {
          const effectivePid = isPlayerAbsent(pid) ? (getTeammate(pid) || pid) : pid;
          const pl = players.find(p => p.id === effectivePid);
          return pl ? pl.name.split(' ').map(n => n[0]).join('') : "?";
        };

        const FHoleRow = () => (
          <div style={{ display: "flex", background: K.inp, borderBottom: colBdr }}>
            <div style={{ ...lblStyle, height: 24 }}>HOLE</div>
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} style={{ flex: 1, height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRight: i < 8 ? colBdr : "none" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: K.t3 }}>{side === 'front' ? i + 1 : i + 10}</span>
              </div>
            ))}
            <div style={{ ...totStyle, height: 24 }}><span style={{ fontSize: 10, fontWeight: 700, color: K.t3 }}>TOT</span></div>
          </div>
        );

        const FParRow = () => (
          <div style={{ display: "flex", borderBottom: colBdr }}>
            <div style={{ ...lblStyle, height: 22 }}>PAR</div>
            {pars.map((p, i) => (
              <div key={i} style={{ flex: 1, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRight: i < 8 ? colBdr : "none" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: K.t3 }}>{p}</span>
              </div>
            ))}
            <div style={{ ...totStyle, height: 22 }}><span style={{ fontSize: 11, fontWeight: 700, color: K.t3 }}>{pars.reduce((a, b) => a + b, 0)}</span></div>
          </div>
        );

        const FPlayerRow = ({ pid }) => {
          let grossTotal = 0;
          const cells = Array.from({ length: 9 }, (_, h) => {
            const s = getS(pid, h); const st = getStrokes(pid, h);
            if (s > 0) grossTotal += s;
            return { s, st };
          });
          return (
            <div style={{ display: "flex", alignItems: "center", borderBottom: colBdr }}>
              <div style={{ ...lblStyle, height: 38, paddingTop: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: K.t1, width: 24, flexShrink: 0 }}>{getInitials(pid)}</span>
                <span style={{ fontSize: 11, color: "#3b82f6", fontWeight: 700 }}>{getNineHcp(pid)}</span>
              </div>
              {cells.map((c, h) => (
                <div key={h} style={{ flex: 1, height: 38, display: "flex", alignItems: "center", justifyContent: "center", borderRight: h < 8 ? colBdr : "none" }}>
                  <ScoreCell score={c.s} par={pars[h]} strokes={c.st} size={15} color={isPlayerAbsent(pid) ? K.red : undefined} />
                </div>
              ))}
              <div style={{ ...totStyle, height: 38, paddingTop: 10 }}><span style={{ fontSize: 14, fontWeight: 800, color: isPlayerAbsent(pid) ? K.red : K.t1 }}>{grossTotal || ""}</span></div>
            </div>
          );
        };

        const FTeamRow = ({ pids, isMyTeam }) => {
          let netTotal = 0;
          return (
            <div style={{ display: "flex" }}>
              <div style={{ ...lblStyle, height: 34, fontSize: 9, fontWeight: 800 }}>TEAM</div>
              {Array.from({ length: 9 }, (_, h) => {
                let tNet = 0;
                pids.forEach(pid => { tNet += getS(pid, h) - getStrokes(pid, h); });
                netTotal += tNet;
                const won = sc.holeResults[h] === (isMyTeam ? 1 : -1);
                return <div key={h} style={{
                  flex: 1, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
                  borderRight: h < 8 ? colBdr : "none",
                  background: won ? K.act + "18" : "transparent",
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 26, height: 26, borderRadius: 3,
                    border: won ? `1.5px solid ${K.act}` : "none",
                  }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: K.t2 }}>{tNet}</span>
                  </div>
                </div>;
              })}
              <div style={{ ...totStyle, height: 34 }}><span style={{ fontSize: 14, fontWeight: 800, color: K.t1 }}>{netTotal}</span></div>
            </div>
          );
        };

        const FMatchRow = () => (
          <div style={{ display: "flex", background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 8, padding: "4px 0", marginBottom: 4, marginTop: 4 }}>
            <div style={{ ...lblStyle, height: 28, fontSize: 8, fontWeight: 800, color: K.t2 }}>MATCH</div>
            {sc.runningStatus.map((st, i) => {
              const colBorderR = i < 8 ? { borderRight: colBdr } : {};
              if (i === sc.matchEndHole) {
                const color = st > 0 ? matchGrn : st < 0 ? K.red : K.t3;
                return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 800, color, lineHeight: "28px", ...colBorderR }}>{sc.matchResultText}</div>;
              }
              if (i > sc.matchEndHole) {
                return <div key={i} style={{ flex: 1, height: 28, ...colBorderR }} />;
              }
              const color = st > 0 ? matchGrn : st < 0 ? K.red : K.t3;
              return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 800, color, lineHeight: "28px", ...colBorderR }}>
                {st > 0 ? <><span style={{ fontSize: 14 }}>▲</span>{st}</> : st < 0 ? <><span style={{ fontSize: 14 }}>▼</span>{Math.abs(st)}</> : "—"}
              </div>;
            })}
            <div style={{ ...totStyle, height: 28 }} />
          </div>
        );

        return (<>
          <div onClick={() => { setShowFinalize(false); setShowEditConfirm(false); }} data-popup style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 500 }} />
          {/* Confetti for wins — only on first finalize */}
          {sc.matchResult === "WIN" && !isAlreadyFinalized && (
            <div style={{ position: "fixed", inset: 0, zIndex: 550, pointerEvents: "none", overflow: "hidden" }}>
              {Array.from({ length: 60 }, (_, i) => {
                const colors = [K.act, K.grn, K.teal, "#fff", K.logoBright, K.red, "#ff6b6b", "#ffd93d"];
                const c = colors[i % colors.length];
                const left = Math.random() * 100;
                const delay = Math.random() * 2;
                const dur = 2 + Math.random() * 2;
                const size = 4 + Math.random() * 6;
                const rot = Math.random() * 360;
                const drift = (Math.random() - 0.5) * 80;
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
                  100% { opacity: 0; transform: translateY(100vh) translateX(${Math.random() > 0.5 ? '' : '-'}40px) rotate(720deg); }
                }
              `}</style>
            </div>
          )}
          <div data-popup style={{ position: "fixed", inset: 0, zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 16px 16px", touchAction: "pan-y" }}>
            <div style={{ background: K.bg, border: `1.5px solid ${sc.resultColor}50`, borderRadius: 16, padding: "16px 12px 20px", width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto", overscrollBehavior: "none", WebkitOverflowScrolling: "touch" }}>
              {/* Header — Players vs Players with match score and winner arrow */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 14, padding: "0 4px" }}>
                <div style={{ flex: 1, textAlign: "right" }}>
                  {sc.myPidsSorted.map(pid => {
                    const effectivePid = isPlayerAbsent(pid) ? (getTeammate(pid) || pid) : pid;
                    const pl = players.find(p => p.id === effectivePid);
                    const last = pl?.name?.split(' ').slice(1).join(' ') || pl?.name || "?";
                    return <div key={pid} style={{ fontSize: 22, fontWeight: 800, color: sc.matchResult === "WIN" ? K.matchGrn : K.t1, lineHeight: 1.3 }}>{last}</div>;
                  })}
                </div>
                {sc.matchResult === "WIN" && (
                  <div style={{ color: K.matchGrn, fontSize: 15, fontWeight: 800, flexShrink: 0, lineHeight: 1, transform: "rotate(-90deg)" }}>▲</div>
                )}
                <div style={{ textAlign: "center", minWidth: 60 }}>
                  <div style={{ fontSize: 26, fontWeight: 800, color: sc.matchResult === "TIE" ? K.t2 : K.matchGrn, lineHeight: 1 }}>{sc.matchResultText}</div>
                </div>
                {sc.matchResult === "LOSS" && (
                  <div style={{ color: K.matchGrn, fontSize: 15, fontWeight: 800, flexShrink: 0, lineHeight: 1, transform: "rotate(90deg)" }}>▲</div>
                )}
                <div style={{ flex: 1, textAlign: "left" }}>
                  {sc.oppPidsSorted.map(pid => {
                    const effectivePid = isPlayerAbsent(pid) ? (getTeammate(pid) || pid) : pid;
                    const pl = players.find(p => p.id === effectivePid);
                    const last = pl?.name?.split(' ').slice(1).join(' ') || pl?.name || "?";
                    return <div key={pid} style={{ fontSize: 22, fontWeight: 800, color: sc.matchResult === "LOSS" ? K.matchGrn : K.t1, lineHeight: 1.3 }}>{last}</div>;
                  })}
                </div>
              </div>

              {/* My team card */}
              <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden", marginBottom: 4 }}>
                <FHoleRow />
                <FParRow />
                {sc.myPids.map(pid => <FPlayerRow key={pid} pid={pid} />)}
                <FTeamRow pids={sc.myPids} isMyTeam={true} />
              </div>

              {/* Match status */}
              <FMatchRow />

              {/* Opp team card */}
              <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden" }}>
                <FHoleRow />
                <FParRow />
                {sc.oppPids.map(pid => <FPlayerRow key={pid} pid={pid} />)}
                <FTeamRow pids={sc.oppPids} isMyTeam={false} />
              </div>

              <div style={{ marginTop: 16 }}>
                {/* First finalize — Sign Scorecard */}
                {!isAlreadyFinalized && (
                  <>
                    <button onClick={async () => { await finalizeMatch(); setShowFinalize(false); }} style={{ width: "100%", padding: "14px", borderRadius: 12, background: "#3b82f6", border: "none", color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
                      Sign Scorecard
                    </button>
                    <button onClick={() => setShowFinalize(false)} style={{ width: "100%", padding: 10, background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer", marginTop: 4 }}>
                      Go Back & Edit
                    </button>
                  </>
                )}
                {/* Already finalized: Edit Scores (comm only) + Close */}
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
        <div onClick={() => setConfirmModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 900 }} />
        <div style={{ position: "fixed", inset: 0, zIndex: 950, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: K.bg, border: `1px solid ${K.bdr}`, borderRadius: 14, padding: "20px", width: "100%", maxWidth: 320 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: K.act, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>MnQ Golf League</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: K.t1, marginBottom: 6 }}>{confirmModal.title}</div>
            <div style={{ fontSize: 13, color: K.t2, lineHeight: 1.5, marginBottom: 16 }}>{confirmModal.message}</div>
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
        <div style={{ position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", background: K.act, color: K.bg, padding: "12px 48px", borderRadius: 12, fontSize: 13, fontWeight: 700, zIndex: 1000, whiteSpace: "nowrap", minWidth: 240, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", animation: "toastDown 0.3s ease" }}>
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
    <Card style={{ marginBottom: 4, padding: "10px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{pl.name}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: K.t1 }}>({nh})</span>
          {strokes > 0 && <span style={{ color: "#3b82f6", fontSize: 16, letterSpacing: 1, display: "inline-flex", alignItems: "center", height: 16 }}>{"●".repeat(strokes)}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {run.thru > 0 && <span style={{ fontSize: 11, color: K.t3 }}>Net: <strong style={{ color: run.netVsPar < 0 ? K.red : run.netVsPar === 0 ? K.t3 : K.t1 }}>{run.netVsPar > 0 ? "+" + run.netVsPar : run.netVsPar === 0 ? "E" : run.netVsPar}</strong> thru {run.thru}</span>}
          {absentBtn}
        </div>
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {btns.map(btn => {
          const isCur = btn === score; const sd = btn - par; const sc = sd < 0 ? K.red : sd === 0 ? K.t3 : K.bg;
          return (
            <button key={btn} onClick={() => handleScore(isCur ? 0 : btn)} style={{ flex: 1, height: 42, borderRadius: 8, cursor: "pointer", fontSize: 16, fontWeight: 800, border: "none", background: isCur ? K.acc : K.inp, color: isCur ? K.bg : K.t2, position: "relative", transition: "all .15s" }}>
              {isCur && sd !== 0 && <div style={{ position: "absolute", width: 34, height: 34, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}><div style={{ position: "absolute", inset: 0, borderRadius: sd < 0 ? "50%" : 3, border: `2px solid ${sc}` }} />{Math.abs(sd) >= 2 && <div style={{ position: "absolute", inset: 5, borderRadius: sd < 0 ? "50%" : 2, border: `2px solid ${sc}` }} />}</div>}
              <span style={{ position: "relative", zIndex: 1 }}>{btn}</span>
            </button>
          );
        })}
        <button onClick={() => handleScore(Math.max(1, (score || par) - 1))} style={{ width: 28, height: 42, borderRadius: 8, background: K.inp, border: "none", color: K.t3, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>−</button>
        <button onClick={() => handleScore((score || par) + 1)} style={{ width: 28, height: 42, borderRadius: 8, background: K.inp, border: "none", color: K.t3, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>+</button>
      </div>
    </Card>
  );
}
