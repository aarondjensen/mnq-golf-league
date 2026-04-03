import { useState, useMemo, useCallback, useEffect } from "react";
import { K, FONTS, CSS, I, Pill, BackBtn, SaveBtn, SectionTitle, SubLabel, Card, EmptyState,
  SEASON_WEEKS, REGULAR_WEEKS, TEAMS_COUNT, getTeeTime, getWeekSide, calcCourseHandicap, calcNineHandicap, calcLeagueHandicap } from "../theme";
import { LEAGUE_ID } from "../firebase";

export default function LiveScoringView({ leagueUser, players, teams, course, schedule, holeScores, saveScore, scoringRules, matchResults, saveMatchResult, ctpData, saveCtp, setLiveWeek, fetchWeekScores, isComm, leagueConfig }) {
  const [activeMatch, setActiveMatch] = useState(null);
  const [curHole, setCurHole] = useState(0);
  const [showCTP, setShowCTP] = useState(false);
  const [commMode, setCommMode] = useState(false);

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
    await saveMatchResult({ id: `${LEAGUE_ID}_w${week}_${t1.id}_${t2.id}`, week, team1Id: t1.id, team2Id: t2.id, team1Points: t1Pts, team2Points: t2Pts, t1Total: t1Net, t2Total: t2Net });
  };

  return (
    <div>
      {activeMatch && (
        <div style={{ marginBottom: 8 }}>
          <BackBtn onClick={() => { setActiveMatch(null); if (!commMode) setCommMode(false); }} />
        </div>
      )}
      <div style={{ display: "flex", gap: 3, marginBottom: 2 }}>
        {Array.from({ length: 9 }, (_, i) => {
          const cur = i === curHole; const done = allP.every(pid => getS(pid, i) > 0);
          return <button key={i} onClick={() => setCurHole(i)} style={{ flex: 1, height: 34, borderRadius: done || cur ? 10 : 6, border: done && !cur ? `1.5px solid ${K.acc}50` : "none", background: cur ? K.acc : done ? K.acc + "15" : K.card, color: cur ? K.bg : done ? K.acc : K.t3, fontSize: 12, fontWeight: 700, cursor: "pointer", outline: cur ? `2px solid ${K.acc}` : "none", outlineOffset: 1 }}>{i + 1}</button>;
        })}
      </div>
      {/* Per-hole match status */}
      <div style={{ display: "flex", gap: 3, marginBottom: 8 }}>
        {Array.from({ length: 9 }, (_, i) => {
          // Calculate cumulative net through hole i
          const myTeamId = myTeam?.id || t1.id;
          const isMyT1 = t1.id === myTeamId;
          let cumDiff = 0;
          let hasData = false;
          for (let h = 0; h <= i; h++) {
            let t1HoleNet = 0, t2HoleNet = 0, t1Has = false, t2Has = false;
            t1Players.forEach(pid => { const s = getS(pid, h); if (s > 0) { t1HoleNet += s - getStrokes(pid, h); t1Has = true; } });
            t2Players.forEach(pid => { const s = getS(pid, h); if (s > 0) { t2HoleNet += s - getStrokes(pid, h); t2Has = true; } });
            if (t1Has && t2Has) { cumDiff += t1HoleNet - t2HoleNet; hasData = true; }
            else { hasData = false; break; }
          }
          if (!hasData) return <div key={i} style={{ flex: 1, height: 16 }} />;
          // From my team's perspective
          const myDiff = isMyT1 ? -cumDiff : cumDiff;
          const label = myDiff > 0 ? `${myDiff}U` : myDiff < 0 ? `${Math.abs(myDiff)}D` : "T";
          const color = myDiff > 0 ? K.grn : myDiff < 0 ? K.red : K.t3;
          return (
            <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 9, fontWeight: 700, color, lineHeight: "16px" }}>{label}</div>
          );
        })}
      </div>
      <div style={{ background: `linear-gradient(135deg, ${K.card}, #0f2440)`, borderRadius: 12, border: `1px solid ${K.bdr}`, padding: "8px 14px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: K.t3, fontWeight: 600 }}>Par</div><div style={{ fontSize: 18, fontWeight: 800, color: K.t2 }}>{par}</div></div>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: K.t1, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Hole</div><div style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 38, fontWeight: 700, color: K.t1, lineHeight: 1 }}>{side === 'front' ? curHole + 1 : curHole + 10}</div></div>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: K.t3, fontWeight: 600 }}>HCP</div><div style={{ fontSize: 18, fontWeight: 800, color: K.t2 }}>{hcp}</div></div>
      </div>
      {isPar3 && <button onClick={() => setShowCTP(!showCTP)} style={{ width: "100%", padding: 8, borderRadius: 8, marginBottom: 8, cursor: "pointer", background: K.acc + "12", border: `1px solid ${K.acc}35`, color: K.acc, fontSize: 12, fontWeight: 700 }}>{showCTP ? "Hide" : "Record"} Closest to Pin</button>}
      {showCTP && isPar3 && <CTPEntry week={week} hole={curHole} players={players} ctpData={ctpData} saveCtp={saveCtp} side={side} />}

      {allP.map(pid => {
        const pl = players.find(p => p.id === pid); if (!pl) return null;
        const score = getS(pid, curHole); const strokes = getStrokes(pid, curHole); const nh = getNineHcp(pid); const run = getRunning(pid);
        const btns = par === 3 ? [1,2,3,4,5,6,7] : par === 5 ? [2,3,4,5,6,7,8] : [2,3,4,5,6,7,8];
        return <PlayerScoreCard key={pid} pl={pl} score={score} strokes={strokes} nh={nh} run={run} btns={btns} par={par} pid={pid} week={week} curHole={curHole} saveScore={saveScore} K={K} />;
      })}
      {allComplete && (
        <div style={{ marginTop: 16, background: K.grn + "12", border: `1.5px solid ${K.grn}50`, borderRadius: 12, padding: 14, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: K.grn, marginBottom: 10 }}>All Holes Complete!</div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 12 }}>
            {allP.map(pid => { const p = players.find(pl => pl.id === pid); const r = getRunning(pid); return (
              <div key={pid} style={{ background: K.card, borderRadius: 8, padding: "6px 10px", border: `1px solid ${K.bdr}`, textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: K.t2 }}>{p?.name?.split(' ')[0]}</div><div style={{ fontSize: 15, fontWeight: 800, color: K.t1 }}>{r.gross}</div><div style={{ fontSize: 10, color: K.acc }}>Net {r.net}</div>
              </div>
            ); })}
          </div>
          <button onClick={finalizeMatch} style={{ padding: "12px 32px", borderRadius: 10, background: K.grn, border: "none", color: K.bg, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>Finalize Match</button>
        </div>
      )}
    </div>
  );
}


function PlayerScoreCard({ pl, score, strokes, nh, run, btns, par, pid, week, curHole, saveScore, K }) {
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
            <button key={btn} onClick={() => saveScore(week, pid, curHole, isCur ? 0 : btn)} style={{ flex: 1, height: 42, borderRadius: 8, cursor: "pointer", fontSize: 16, fontWeight: 800, border: "none", background: isCur ? K.acc : K.inp, color: isCur ? K.bg : K.t2, position: "relative", transition: "all .15s" }}>
              {isCur && sd !== 0 && <div style={{ position: "absolute", width: 34, height: 34, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}><div style={{ position: "absolute", inset: 0, borderRadius: sd < 0 ? "50%" : 3, border: `2px solid ${sc}` }} />{Math.abs(sd) >= 2 && <div style={{ position: "absolute", inset: 4, borderRadius: sd < 0 ? "50%" : 2, border: `1.5px solid ${sc}` }} />}</div>}
              <span style={{ position: "relative", zIndex: 1 }}>{btn}</span>
            </button>
          );
        })}
        <button onClick={() => saveScore(week, pid, curHole, Math.max(1, (score || par) - 1))} style={{ width: 28, height: 42, borderRadius: 8, background: K.inp, border: "none", color: K.t3, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>−</button>
        <button onClick={() => saveScore(week, pid, curHole, (score || par) + 1)} style={{ width: 28, height: 42, borderRadius: 8, background: K.inp, border: "none", color: K.t3, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>+</button>
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
