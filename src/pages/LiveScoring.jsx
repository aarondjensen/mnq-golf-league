import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { K, FONTS, CSS, I, Pill, BackBtn, SaveBtn, SectionTitle, SubLabel, Card, EmptyState,
  SEASON_WEEKS, REGULAR_WEEKS, TEAMS_COUNT, getTeeTime, getWeekSide, calcCourseHandicap, calcNineHandicap, calcLeagueHandicap } from "../theme";
import { LEAGUE_ID } from "../firebase";

export default function LiveScoringView({ leagueUser, players, teams, course, schedule, holeScores, saveScore, scoringRules, matchResults, saveMatchResult, ctpData, saveCtp, setLiveWeek, fetchWeekScores, isComm, leagueConfig }) {
  const [activeMatch, setActiveMatch] = useState(null);
  const [curHole, setCurHole] = useState(0);
  const [showCTP, setShowCTP] = useState(false);
  const [commMode, setCommMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(false);
  const [showScorecard, setShowScorecard] = useState(false);
  const [showFinalize, setShowFinalize] = useState(false);
  const initialJump = useRef(false); // true when user manually navigated to a previous hole

  // Find current week: first week where not all matches are finalized
  const currentWeek = useMemo(() => {
    for (const wk of schedule) {
      const allDone = wk.matches.every(m =>
        matchResults.some(r => r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2)
      );
      if (!allDone) return wk.week;
    }
    return schedule.length ? schedule[schedule.length - 1].week : 0;
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

  if (!course?.name) return <EmptyState icon="flag" title="Course not configured" subtitle="Commissioner needs to set up the course." />;
  if (!matches.length) return <EmptyState icon="calendar" title="No matches this week" subtitle="Commissioner needs to set the schedule." />;

  // ── Match selector (commissioner mode) ──
  if (!activeMatch && commMode) {
    const getProgress = (match) => {
      const ids = []; const t1 = teams.find(t => t.id === match.team1); const t2 = teams.find(t => t.id === match.team2);
      if (t1) ids.push(t1.player1, t1.player2); if (t2) ids.push(t2.player1, t2.player2);
      let sc = 0; ids.forEach(pid => { for (let h = 0; h < 9; h++) if (holeScores[`w${week}_p${pid}_h${h}`]) sc++; });
      return ids.length ? sc / (ids.length * 9) : 0;
    };
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <button onClick={() => setCommMode(false)} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.t2, fontSize: 13, padding: "7px 14px", cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>{I.arrowLeft(13, K.t2)} My Match</button>
          <div><SectionTitle>All Matches · Wk {week}</SectionTitle></div>
          <div style={{ width: 90 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {matches.map((m, mi) => {
            const t1 = teams.find(t => t.id === m.team1); const t2 = teams.find(t => t.id === m.team2);
            if (!t1 || !t2) return null;
            const prog = getProgress(m);
            const gn = id => players.find(p => p.id === id)?.name?.split(' ')[0] || "?";
            return (
              <button key={mi} onClick={() => { setActiveMatch(m); setCurHole(0); setShowCTP(false); }} style={{ background: K.card, border: `1px solid ${K.bdr}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", textAlign: "left", width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: K.t3, textTransform: "uppercase", letterSpacing: 1 }}>Match {mi + 1} · {getTeeTime(mi)}</span>
                  {prog > 0 && <Pill color={prog >= 1 ? K.grn : K.warn}>{prog >= 1 ? "FINAL" : `${Math.round(prog * 100)}%`}</Pill>}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700 }}>{t1.name}</div></div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: K.t3, padding: "0 10px" }}>VS</div>
                  <div style={{ flex: 1, textAlign: "right" }}><div style={{ fontSize: 14, fontWeight: 700 }}>{t2.name}</div></div>
                </div>
                {prog > 0 && prog < 1 && <div style={{ marginTop: 6, height: 3, background: K.inp, borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${prog * 100}%`, background: K.acc, borderRadius: 2 }} /></div>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Default: auto-open user's match, or show prompt ──
  const matchToScore = activeMatch || myMatch;
  if (!matchToScore) {
    return (
      <div>
        <EmptyState icon="flag" title="No match found" subtitle="You don't have a match scheduled this week." />
        {isComm && <div style={{ textAlign: "center", marginTop: 16 }}><button onClick={() => setCommMode(true)} style={{ padding: "10px 20px", borderRadius: 8, background: K.act, border: "none", color: K.bg, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Enter Scores for Any Match</button></div>}
      </div>
    );
  }

  // ── Hole scoring view ──
  const t1 = teams.find(t => t.id === matchToScore.team1);
  const t2 = teams.find(t => t.id === matchToScore.team2);
  if (!t1 || !t2) return null;

  const scoringFormat = leagueConfig?.scoringFormat || "lowHighBonus";
  const isTeamNet = scoringFormat === "teamNetTotal";

  // For lowHighBonus: interleave low/high pairs. For teamNetTotal: group by team
  const t1Players = [t1.player1, t1.player2];
  const t2Players = [t2.player1, t2.player2];
  const getHcp = (pid) => {
    const p = players.find(pl => pl.id === pid);
    return p ? Math.round(p.handicapIndex || 0) : 0;
  };
  const allP = isTeamNet
    ? [...t1Players, ...t2Players]
    : (() => { const t1s = [...t1Players].sort((a, b) => getHcp(a) - getHcp(b)); const t2s = [...t2Players].sort((a, b) => getHcp(a) - getHcp(b)); return [t1s[0], t2s[0], t1s[1], t2s[1]]; })();

  const par = pars[curHole] || 4;
  const hcp = hcps[curHole] || 1;
  const isPar3 = par === 3;

  const getS = (pid, h) => holeScores[`w${week}_p${pid}_h${h}`] || 0;
  const getNineHcp = (pid) => {
    const p = players.find(pl => pl.id === pid);
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
  const allComplete = allP.every(pid => { for (let h = 0; h < 9; h++) if (getS(pid, h) <= 0) return false; return true; });
  const holeComplete = allP.every(pid => getS(pid, curHole) > 0);

  // Find the "current" hole — first incomplete hole
  const currentHoleIdx = (() => {
    for (let h = 0; h < 9; h++) { if (!allP.every(pid => getS(pid, h) > 0)) return h; }
    return 8; // all complete
  })();

  // Jump to current hole on initial load (not hole 1)
  useEffect(() => {
    if (!initialJump.current && currentHoleIdx > 0) {
      setCurHole(currentHoleIdx);
      initialJump.current = true;
    }
  }, [currentHoleIdx]);

  // Auto-advance when all 4 scores entered on current hole (only when not editing)
  useEffect(() => {
    if (holeComplete && curHole < 8 && !editing && !allComplete) {
      const holeNum = side === 'front' ? curHole + 1 : curHole + 10;
      setToast(`✓ Hole ${holeNum} saved`);
      const timer = setTimeout(() => {
        let next = curHole + 1;
        while (next < 8 && allP.every(pid => getS(pid, next) > 0)) next++;
        setCurHole(next);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [holeComplete, curHole, editing, allComplete]);

  // Clear toast when hole changes
  useEffect(() => {
    setToast(null);
  }, [curHole]);

  // Auto-show finalize popup when all holes complete
  useEffect(() => {
    if (allComplete && !showFinalize) {
      const timer = setTimeout(() => setShowFinalize(true), 600);
      return () => clearTimeout(timer);
    }
  }, [allComplete]);

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
      // Low/High matches
      const t1s = [...t1Players].sort((a, b) => getHcp(a) - getHcp(b));
      const t2s = [...t2Players].sort((a, b) => getHcp(a) - getHcp(b));
      const t1L = getRunning(t1s[0]).net, t2L = getRunning(t2s[0]).net;
      const t1H = getRunning(t1s[1]).net, t2H = getRunning(t2s[1]).net;
      if (t1L < t2L) { t1Pts += sr.mw; t2Pts += sr.ml; } else if (t1L > t2L) { t1Pts += sr.ml; t2Pts += sr.mw; } else { t1Pts += sr.mt; t2Pts += sr.mt; }
      if (t1H < t2H) { t1Pts += sr.mw; t2Pts += sr.ml; } else if (t1H > t2H) { t1Pts += sr.ml; t2Pts += sr.mw; } else { t1Pts += sr.mt; t2Pts += sr.mt; }

      // Bonus — depends on bonusType
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

    // Running match status to determine match play result text
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
    const finalStatus = runningStatus[8]; // positive = t1 up

    let matchResultText;
    if (finalStatus === 0) {
      matchResultText = "ALL SQUARE";
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
      // positive finalStatus means t1 won the match play
      matchWinnerId: finalStatus > 0 ? t1.id : finalStatus < 0 ? t2.id : null,
    });
  };

  return (
    <div>
      {activeMatch && (
        <div style={{ marginBottom: 8 }}>
          <BackBtn onClick={() => { setActiveMatch(null); if (!commMode) setCommMode(false); }} />
        </div>
      )}
      <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
        <div style={{ width: 40, flexShrink: 0, fontSize: 8, color: K.t3, fontWeight: 600, display: "flex", alignItems: "center", paddingLeft: 2 }}>HOLE</div>
        {Array.from({ length: 9 }, (_, i) => {
          const cur = i === curHole; const done = allP.every(pid => getS(pid, i) > 0);
          return <button key={i} onClick={() => { setCurHole(i); setEditing(i < currentHoleIdx); }} style={{ flex: 1, height: 34, borderRadius: done || cur ? 10 : 6, border: done && !cur ? `1.5px solid ${K.acc}50` : "none", background: cur ? K.acc : done ? K.acc + "15" : K.card, color: cur ? K.bg : done ? K.acc : K.t3, fontSize: 12, fontWeight: 700, cursor: "pointer", outline: cur ? `2px solid ${K.acc}` : "none", outlineOffset: 1 }}>{i + 1}</button>;
        })}
      </div>
      <div style={{ background: K.acc, borderRadius: 10, padding: "6px 8px", marginBottom: 6, display: "flex", alignItems: "center" }}>
        <button onClick={() => { const prev = Math.max(0, curHole - 1); setCurHole(prev); setEditing(prev < currentHoleIdx); }} disabled={curHole === 0} style={{ width: 32, height: 40, borderRadius: 8, background: "none", border: "none", cursor: curHole === 0 ? "default" : "pointer", color: curHole === 0 ? K.bg + "40" : K.bg, fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px" }}>
          <div style={{ textAlign: "center", minWidth: 36 }}><div style={{ fontSize: 9, color: K.bg, fontWeight: 600, opacity: 0.7 }}>Par</div><div style={{ fontSize: 16, fontWeight: 800, color: K.bg }}>{par}</div></div>
          <div style={{ textAlign: "center" }}><div style={{ fontSize: 9, color: K.bg, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, opacity: 0.7 }}>Hole</div><div style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 30, fontWeight: 700, color: K.bg, lineHeight: 1 }}>{side === 'front' ? curHole + 1 : curHole + 10}</div></div>
          <div style={{ textAlign: "center", minWidth: 36 }}><div style={{ fontSize: 9, color: K.bg, fontWeight: 600, opacity: 0.7 }}>HCP</div><div style={{ fontSize: 16, fontWeight: 800, color: K.bg }}>{hcp}</div></div>
        </div>
        <button onClick={() => { const next = Math.min(8, curHole + 1); setCurHole(next); setEditing(next < currentHoleIdx); }} disabled={curHole === 8} style={{ width: 32, height: 40, borderRadius: 8, background: "none", border: "none", cursor: curHole === 8 ? "default" : "pointer", color: curHole === 8 ? K.bg + "40" : K.bg, fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
      </div>
      {isPar3 && <button onClick={() => setShowCTP(!showCTP)} style={{ width: "100%", padding: 8, borderRadius: 8, marginBottom: 8, cursor: "pointer", background: K.acc + "12", border: `1px solid ${K.acc}35`, color: K.acc, fontSize: 12, fontWeight: 700 }}>{showCTP ? "Hide" : "Record"} Closest to Pin</button>}
      {showCTP && isPar3 && <CTPEntry week={week} hole={curHole} players={players} ctpData={ctpData} saveCtp={saveCtp} side={side} />}

      {editing && (
        <button onClick={() => { setCurHole(currentHoleIdx); setEditing(false); }} style={{ width: "100%", padding: 8, borderRadius: 8, marginBottom: 6, cursor: "pointer", background: K.teal + "15", border: `1px solid ${K.teal}40`, color: K.teal, fontSize: 12, fontWeight: 700 }}>
          Hole {side === 'front' ? currentHoleIdx + 1 : currentHoleIdx + 10} →
        </button>
      )}

      {allP.map(pid => {
        const pl = players.find(p => p.id === pid); if (!pl) return null;
        const score = getS(pid, curHole); const strokes = getStrokes(pid, curHole); const nh = getNineHcp(pid); const run = getRunning(pid);
        const btns = par === 3 ? [1,2,3,4,5,6,7] : par === 5 ? [2,3,4,5,6,7,8] : [2,3,4,5,6,7,8];
        return <PlayerScoreCard key={pid} pl={pl} score={score} strokes={strokes} nh={nh} run={run} btns={btns} par={par} pid={pid} week={week} curHole={curHole} saveScore={saveScore} K={K} />;
      })}
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
        return (<>
          <button onClick={() => setShowScorecard(!showScorecard)} style={{ display: "flex", gap: 3, marginTop: 6, marginBottom: showScorecard ? 0 : 8, width: "100%", background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: showScorecard ? "8px 8px 0 0" : 8, cursor: "pointer", padding: "6px 0", alignItems: "center" }}>
            <div style={{ width: 40, flexShrink: 0, fontSize: 8, color: K.t3, fontWeight: 600, display: "flex", alignItems: "center", paddingLeft: 6, gap: 2 }}><span>MATCH</span><span style={{ fontSize: 10 }}>{showScorecard ? "▾" : "›"}</span></div>
            {holeStatuses.map((st, i) => {
              if (st === null) return <div key={i} style={{ flex: 1, height: 24 }} />;
              const label = st > 0 ? `▲${st}` : st < 0 ? `▼${Math.abs(st)}` : "—";
              const color = st > 0 ? K.grn : st < 0 ? K.red : K.t3;
              return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800, color, lineHeight: "24px" }}>{label}</div>;
            })}
          </button>
          {showScorecard && (() => {
            const gridLine = `1px solid ${K.bdr}25`;
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
                <div style={{ display: "flex", alignItems: "center", borderBottom: gridLine }}>
                  <div style={{ width: 36, flexShrink: 0, fontSize: 12, color: K.t1, fontWeight: 700, padding: "4px 0", borderRight: gridLine, paddingLeft: 4 }}>{initials}<span style={{ color: K.t3, fontSize: 9 }}>({nh})</span></div>
                  {cells.map((c, h) => (
                    <div key={h} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 700, color: c.s <= 0 ? K.t3 + "30" : K.t1, lineHeight: "22px", padding: "4px 0", borderRight: h < 8 ? gridLine : "none" }}>
                      {c.s > 0 ? <>{c.s}{c.st > 0 && <span style={{ color: K.teal, fontSize: 11 }}>{"•".repeat(c.st)}</span>}</> : "·"}
                    </div>
                  ))}
                </div>
              );
            };

            const ScTeamRow = ({ pids, side: teamSide }) => {
              let total = 0; let hasAll = true;
              return (
                <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
                  <div style={{ width: 36, flexShrink: 0, fontSize: 9, color: K.t3, fontWeight: 700, padding: "4px 0", borderRight: gridLine, paddingLeft: 4 }}>NET</div>
                  {Array.from({ length: 9 }, (_, h) => {
                    let tNet = 0; let ok = true;
                    pids.forEach(pid => { const s = getS(pid, h); if (s <= 0) ok = false; else tNet += s - getStrokes(pid, h); });
                    if (ok) total += tNet; else hasAll = false;
                    const won = scHoleResults[h] === (teamSide === "my" ? 1 : -1);
                    return <div key={h} style={{
                      flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800, color: !ok ? K.t3 + "30" : K.t2, lineHeight: "22px",
                      padding: "3px 0", borderRight: won ? "none" : gridLine,
                      ...(won ? { background: K.bg, border: `2px solid ${K.act}`, borderRadius: 5, margin: "-1px 1px", position: "relative", zIndex: 1 } : {}),
                    }}>{ok ? tNet : "·"}</div>;
                  })}
                </div>
              );
            };

            return (
            <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "6px 4px", marginBottom: 8 }}>
              {/* Hole numbers */}
              <div style={{ display: "flex", alignItems: "center", borderBottom: gridLine }}>
                <div style={{ width: 36, flexShrink: 0, fontSize: 10, color: K.t2, fontWeight: 700, padding: "4px 0", borderRight: gridLine, paddingLeft: 4 }}>HOLE</div>
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, color: K.t1, fontWeight: 700, lineHeight: "22px", padding: "4px 0", borderRight: i < 8 ? gridLine : "none" }}>{side === 'front' ? i + 1 : i + 10}</div>
                ))}
              </div>

              {/* Par row */}
              <div style={{ display: "flex", alignItems: "center", borderBottom: gridLine }}>
                <div style={{ width: 36, flexShrink: 0, fontSize: 10, color: K.t3, fontWeight: 600, padding: "4px 0", borderRight: gridLine, paddingLeft: 4 }}>PAR</div>
                {pars.map((p, i) => <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, color: K.t3, fontWeight: 600, lineHeight: "22px", padding: "4px 0", borderRight: i < 8 ? gridLine : "none" }}>{p}</div>)}
              </div>

              {/* My team */}
              {scMyPids.map(pid => <ScPlayerRow key={pid} pid={pid} />)}
              <ScTeamRow pids={scMyPids} side="my" />

              <div style={{ borderBottom: `2px solid ${K.bdr}40`, margin: "2px 0" }} />

              {/* Match status triangles */}
              <div style={{ display: "flex", alignItems: "center", borderBottom: `2px solid ${K.bdr}40` }}>
                <div style={{ width: 36, flexShrink: 0, fontSize: 10, color: K.t3, fontWeight: 700, padding: "5px 0", borderRight: gridLine, paddingLeft: 4 }}>MATCH</div>
                {holeStatuses.map((st, i) => {
                  if (st === null) return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, lineHeight: "22px", padding: "5px 0", borderRight: i < 8 ? gridLine : "none", color: K.t3 + "30" }}>—</div>;
                  const label = st > 0 ? `▲${st}` : st < 0 ? `▼${Math.abs(st)}` : "—";
                  const color = st > 0 ? K.grn : st < 0 ? K.red : K.t3;
                  return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800, color, lineHeight: "22px", padding: "5px 0", borderRight: i < 8 ? gridLine : "none" }}>{label}</div>;
                })}
              </div>

              {/* Opp team */}
              {scOppPids.map(pid => <ScPlayerRow key={pid} pid={pid} />)}
              <ScTeamRow pids={scOppPids} side="opp" />
            </div>
            );
          })()}
        </>);
      })()}
      {allComplete && !showFinalize && (
        <button onClick={() => setShowFinalize(true)} style={{ width: "100%", padding: 10, borderRadius: 10, marginTop: 8, cursor: "pointer", background: K.grn + "15", border: `1.5px solid ${K.grn}50`, color: K.grn, fontSize: 13, fontWeight: 700 }}>
          All Holes Complete — Tap to Finalize
        </button>
      )}

      {/* Finalize Popup */}
      {showFinalize && (() => {
        const myTeamId = myTeam?.id || t1.id;
        const isMyT1 = t1.id === myTeamId;
        const myPids = isMyT1 ? t1Players : t2Players;
        const oppPids = isMyT1 ? t2Players : t1Players;
        const myTeamObj = isMyT1 ? t1 : t2;
        const oppTeamObj = isMyT1 ? t2 : t1;
        const myNet = myPids.reduce((a, pid) => a + getRunning(pid).net, 0);
        const oppNet = oppPids.reduce((a, pid) => a + getRunning(pid).net, 0);

        // Holes won
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

        // Running match status per hole
        const runningStatus = [];
        let cum = 0;
        holeResults.forEach(r => { cum += r; runningStatus.push(cum); });

        // Calculate proper match play result
        // Match is "clinched" when lead > remaining holes
        let matchEndHole = 8; // default: goes to 9
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
        const finalStatus = runningStatus[8]; // positive = my team up
        const isWin = finalStatus > 0;
        const isLoss = finalStatus < 0;
        const isTie = finalStatus === 0;

        let matchResultText;
        if (isTie) {
          matchResultText = "ALL SQUARE";
        } else if (holesRemaining > 0) {
          // Clinched early: "X&Y"
          matchResultText = `${matchMargin}&${holesRemaining}`;
        } else {
          // Went to final hole: "X UP"
          matchResultText = `${Math.abs(finalStatus)}UP`;
        }

        const matchResult = isWin ? "WIN" : isLoss ? "LOSS" : "TIE";
        const resultColor = isWin ? K.grn : isLoss ? K.red : K.t2;

        const gridLine = `1px solid ${K.bdr}25`;

        // Build player scorecard row
        const PlayerRow = ({ pid, isMyTeam }) => {
          const pl = players.find(p => p.id === pid); if (!pl) return null;
          const nh = getNineHcp(pid);
          let grossTotal = 0;
          const cells = Array.from({ length: 9 }, (_, h) => {
            const s = getS(pid, h); const st = getStrokes(pid, h);
            grossTotal += s;
            return { s, st };
          });
          const initials = pl.name.split(' ').map(n => n[0]).join('');
          return (
            <div style={{ display: "flex", alignItems: "center", borderBottom: gridLine }}>
              <div style={{ width: 36, flexShrink: 0, fontSize: 12, color: K.t1, fontWeight: 700, padding: "4px 0", borderRight: gridLine }}>{initials}<span style={{ color: K.t3, fontSize: 9 }}>({nh})</span></div>
              {cells.map((c, h) => (
                <div key={h} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 700, color: K.t1, lineHeight: "22px", padding: "4px 0", borderRight: gridLine }}>
                  {c.s}{c.st > 0 && <span style={{ color: K.teal, fontSize: 11 }}>{"•".repeat(c.st)}</span>}
                </div>
              ))}
              <div style={{ width: 28, textAlign: "center", fontSize: 13, fontWeight: 800, color: K.t1, padding: "4px 0" }}>{grossTotal}</div>
            </div>
          );
        };

        // Team net row — maize border on winning holes
        const TeamRow = ({ pids }) => {
          let total = 0;
          return (
            <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
              <div style={{ width: 36, flexShrink: 0, fontSize: 9, color: K.t3, fontWeight: 700, padding: "4px 0", borderRight: gridLine }}>NET</div>
              {Array.from({ length: 9 }, (_, h) => {
                let tNet = 0;
                pids.forEach(pid => { tNet += getS(pid, h) - getStrokes(pid, h); });
                total += tNet;
                const won = holeResults[h] === (pids === myPids ? 1 : -1);
                return <div key={h} style={{
                  flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800, color: K.t2, lineHeight: "22px",
                  padding: "3px 0", borderRight: won ? "none" : gridLine,
                  ...(won ? { background: K.bg, border: `2px solid ${K.act}`, borderRadius: 5, margin: "-1px 1px", position: "relative", zIndex: 1 } : {}),
                }}>{tNet}</div>;
              })}
              <div style={{ width: 28, textAlign: "center", fontSize: 13, fontWeight: 800, color: K.t2, padding: "4px 0" }}>{total}</div>
            </div>
          );
        };

        return (<>
          <div onClick={() => setShowFinalize(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 500 }} />
          {/* Confetti for wins */}
          {matchResult === "WIN" && (
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
          <div style={{ position: "fixed", inset: 0, zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: K.bg, border: `1.5px solid ${resultColor}50`, borderRadius: 16, padding: "16px 12px 20px", width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto" }}>
              {/* Header */}
              <div style={{ textAlign: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: resultColor }}>
                  {matchResultText}
                </div>
              </div>

              {/* Hole numbers */}
              <div style={{ display: "flex", alignItems: "center", borderBottom: gridLine }}>
                <div style={{ width: 36, flexShrink: 0, fontSize: 10, color: K.t2, fontWeight: 700, padding: "4px 0", borderRight: gridLine }}>HOLE</div>
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, color: K.t1, fontWeight: 700, lineHeight: "22px", padding: "4px 0", borderRight: gridLine }}>{side === 'front' ? i + 1 : i + 10}</div>
                ))}
                <div style={{ width: 28, textAlign: "center", fontSize: 10, color: K.t1, fontWeight: 700, padding: "4px 0" }}>TOT</div>
              </div>

              {/* Par row */}
              <div style={{ display: "flex", alignItems: "center", borderBottom: gridLine }}>
                <div style={{ width: 36, flexShrink: 0, fontSize: 10, color: K.t3, fontWeight: 600, padding: "4px 0", borderRight: gridLine }}>PAR</div>
                {pars.map((p, i) => <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, color: K.t3, fontWeight: 600, lineHeight: "22px", padding: "4px 0", borderRight: gridLine }}>{p}</div>)}
                <div style={{ width: 28, textAlign: "center", fontSize: 13, color: K.t3, fontWeight: 600, padding: "4px 0" }}>{pars.reduce((a, b) => a + b, 0)}</div>
              </div>

              {/* My team */}
              {myPids.map(pid => <PlayerRow key={pid} pid={pid} isMyTeam={true} />)}
              <TeamRow pids={myPids} />

              <div style={{ borderBottom: `2px solid ${K.bdr}40`, margin: "2px 0" }} />

              {/* Match status triangles — between teams */}
              <div style={{ display: "flex", alignItems: "center", borderBottom: `2px solid ${K.bdr}40` }}>
                <div style={{ width: 36, flexShrink: 0, fontSize: 10, color: K.t3, fontWeight: 700, padding: "5px 0", borderRight: gridLine }}>MATCH</div>
                {runningStatus.map((st, i) => {
                  const label = st > 0 ? `▲${st}` : st < 0 ? `▼${Math.abs(st)}` : "—";
                  const color = st > 0 ? K.grn : st < 0 ? K.red : K.t3;
                  return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800, color, lineHeight: "22px", padding: "5px 0", borderRight: gridLine }}>{label}</div>;
                })}
                <div style={{ width: 28, padding: "5px 0" }} />
              </div>

              {/* Opp team */}
              {oppPids.map(pid => <PlayerRow key={pid} pid={pid} isMyTeam={false} />)}
              <TeamRow pids={oppPids} />

              <div style={{ marginTop: 16 }}>
                <button onClick={async () => { await finalizeMatch(); setShowFinalize(false); }} style={{ width: "100%", padding: "14px", borderRadius: 12, background: K.grn, border: "none", color: K.bg, fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
                  Finalize Match
                </button>
                <button onClick={() => setShowFinalize(false)} style={{ width: "100%", padding: 10, background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer", marginTop: 4 }}>
                  Go Back & Edit
                </button>
              </div>
            </div>
          </div>
        </>);
      })()}
      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", background: K.act, color: K.bg, padding: "12px 48px", borderRadius: 12, fontSize: 14, fontWeight: 700, zIndex: 1000, whiteSpace: "nowrap", textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}


function PlayerScoreCard({ pl, score, strokes, nh, run, btns: defaultBtns, par, pid, week, curHole, saveScore, K }) {
  const handleScore = (val) => {
    saveScore(week, pid, curHole, val);
  };
  // Shift button range if score is outside default range
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
          <span style={{ fontSize: 14, fontWeight: 700 }}>{pl.name}</span>
          <Pill color={K.acc}>({nh})</Pill>
          {strokes > 0 && <span style={{ color: K.teal, fontSize: 11, letterSpacing: -1 }}>{"●".repeat(strokes)}</span>}
        </div>
        {run.thru > 0 && <span style={{ fontSize: 11, color: K.t3 }}>Net: <strong style={{ color: run.netVsPar < 0 ? K.grn : run.netVsPar > 0 ? K.red : K.t1 }}>{run.netVsPar > 0 ? "+" : ""}{run.netVsPar}</strong> thru {run.thru}</span>}
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {btns.map(btn => {
          const isCur = btn === score; const sd = btn - par; const sc = sd < 0 ? K.red : sd === 0 ? K.t3 : "#3b82f6";
          return (
            <button key={btn} onClick={() => handleScore(isCur ? 0 : btn)} style={{ flex: 1, height: 42, borderRadius: 8, cursor: "pointer", fontSize: 16, fontWeight: 800, border: "none", background: isCur ? K.acc : K.inp, color: isCur ? K.bg : K.t2, position: "relative", transition: "all .15s" }}>
              {isCur && sd !== 0 && <div style={{ position: "absolute", width: 34, height: 34, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}><div style={{ position: "absolute", inset: 0, borderRadius: sd < 0 ? "50%" : 3, border: `2px solid ${sc}` }} />{Math.abs(sd) >= 2 && <div style={{ position: "absolute", inset: 4, borderRadius: sd < 0 ? "50%" : 2, border: `1.5px solid ${sc}` }} />}</div>}
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


function CTPEntry({ week, hole, players, ctpData, saveCtp, side }) {
  const existing = ctpData.find(c => c.week === week && c.hole === hole);
  const [pid, setPid] = useState(existing?.playerId || "");
  const [dist, setDist] = useState(existing?.distance || "");
  const save = async () => { await saveCtp({ id: `${LEAGUE_ID}_w${week}_h${hole}`, week, hole, holeNum: side === 'front' ? hole + 1 : hole + 10, playerId: pid, distance: parseFloat(dist) || 0 }); };
  return (
    <Card style={{ marginBottom: 8, border: `1px solid ${K.acc}30` }}>
      <SubLabel>Closest to Pin — Hole {side === 'front' ? hole + 1 : hole + 10}</SubLabel>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <select value={pid} onChange={e => setPid(e.target.value)} style={{ flex: 1, padding: 8, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13 }}><option value="">Select player</option>{players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input value={dist} onChange={e => setDist(e.target.value)} placeholder="Ft" type="number" style={{ width: 64, padding: 8, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, textAlign: "center" }} />
        <SaveBtn onClick={save} />
      </div>
      {existing?.playerId && <div style={{ marginTop: 6, fontSize: 11, color: K.grn }}>Current: {players.find(p => p.id === existing.playerId)?.name} — {existing.distance} ft</div>}
    </Card>
  );
}
