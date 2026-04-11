import { useState, useMemo, useCallback, useRef } from "react";
import { K, EmptyState, lastNamesOnly, getWeekSide, LIST_GAP, CARD_RADIUS, NAME_SIZE, NAME_WEIGHT, HERO_NUM_SIZE, HERO_NUM_WEIGHT, RANK_BADGE_SIZE, RANK_BADGE_RADIUS, RANK_BADGE_FONT, CHEVRON_SIZE } from "../theme";

// Mini ScoreCell for scorecard expansion
function MiniScoreCell({ score, par, size = 11 }) {
  if (!score || score <= 0) return <span style={{ color: K.t3 + "30", fontSize: size }}>·</span>;
  const diff = score - par;
  const sh = size + 6;
  const bc = K.t2;
  let border = null;
  if (diff <= -2) {
    border = (
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: "50%", border: `1.5px solid ${bc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: sh - 5, height: sh - 5, borderRadius: "50%", border: `1px solid ${bc}` }} />
      </div>
    );
  } else if (diff === -1) {
    border = <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: "50%", border: `1.5px solid ${bc}` }} />;
  } else if (diff === 1) {
    border = <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: 2, border: `1.5px solid ${bc}` }} />;
  } else if (diff >= 2) {
    border = (
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: 2, border: `1.5px solid ${bc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: sh - 5, height: sh - 5, borderRadius: 1, border: `1px solid ${bc}` }} />
      </div>
    );
  }
  return (
    <div style={{ position: "relative", width: sh, height: sh, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {border}
      <span style={{ position: "relative", zIndex: 1, fontSize: size, fontWeight: 700, lineHeight: 1 }}>{score}</span>
    </div>
  );
}

// Build standings from a set of match results
function buildStandings(teams, results, isRecord, tiebreaker) {
  const pts = {};
  teams.forEach(t => { pts[t.id] = { teamId: t.id, points: 0, w: 0, l: 0, t: 0, gamesPlayed: 0, hw: 0 }; });
  results.forEach(r => {
    if (!r) return;
    if (pts[r.team1Id]) pts[r.team1Id].points += (r.team1Points || 0);
    if (pts[r.team2Id]) pts[r.team2Id].points += (r.team2Points || 0);
    if (r.t1HolesWon !== undefined && r.t2HolesWon !== undefined) {
      if (pts[r.team1Id]) pts[r.team1Id].hw += r.t1HolesWon;
      if (pts[r.team2Id]) pts[r.team2Id].hw += r.t2HolesWon;
    }
    const d = (r.team1Points || 0) - (r.team2Points || 0);
    if (d > 0) {
      if (pts[r.team1Id]) { pts[r.team1Id].w++; pts[r.team1Id].gamesPlayed++; }
      if (pts[r.team2Id]) { pts[r.team2Id].l++; pts[r.team2Id].gamesPlayed++; }
    } else if (d < 0) {
      if (pts[r.team1Id]) { pts[r.team1Id].l++; pts[r.team1Id].gamesPlayed++; }
      if (pts[r.team2Id]) { pts[r.team2Id].w++; pts[r.team2Id].gamesPlayed++; }
    } else {
      if (pts[r.team1Id]) { pts[r.team1Id].t++; pts[r.team1Id].gamesPlayed++; }
      if (pts[r.team2Id]) { pts[r.team2Id].t++; pts[r.team2Id].gamesPlayed++; }
    }
  });
  const arr = Object.values(pts);
  const hwTiebreak = tiebreaker === "holesWon" || !tiebreaker;
  if (isRecord) {
    arr.sort((a, b) => {
      const aPct = a.gamesPlayed ? (a.w + a.t * 0.5) / a.gamesPlayed : 0;
      const bPct = b.gamesPlayed ? (b.w + b.t * 0.5) / b.gamesPlayed : 0;
      if (bPct !== aPct) return bPct - aPct;
      if (b.w !== a.w) return b.w - a.w;
      if (a.l !== b.l) return a.l - b.l;
      if (hwTiebreak) return b.hw - a.hw;
      return 0;
    });
  } else {
    arr.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (hwTiebreak) return b.hw - a.hw;
      return 0;
    });
  }
  return arr;
}

export default function StandingsView({ teams, players, matchResults, leagueConfig, schedule, fetchSeasonScores, course, fetchWeekScores }) {
  const isRecord = leagueConfig?.standingsMethod === "record";
  const tiebreaker = leagueConfig?.tiebreaker || "holesWon";
  const [expanded, setExpanded] = useState(null);
  const [expandedResult, setExpandedResult] = useState(null); // "teamId_week" for scorecard
  const [weekScores, setWeekScores] = useState({}); // { week: { key: score } }
  const expandedRef = useRef(null);

  const handleExpand = (teamId) => {
    const next = expanded === teamId ? null : teamId;
    setExpanded(next);
    setExpandedResult(null);
    if (next) {
      setTimeout(() => {
        expandedRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
    }
  };

  const toggleResultExpand = useCallback(async (teamId, week) => {
    const key = `${teamId}_${week}`;
    if (expandedResult === key) {
      setExpandedResult(null);
      return;
    }
    setExpandedResult(key);
    if (!weekScores[week] && fetchWeekScores) {
      const scores = await fetchWeekScores(week);
      setWeekScores(prev => ({ ...prev, [week]: scores }));
    }
  }, [expandedResult, weekScores, fetchWeekScores]);

  const lockedWeeks = useMemo(() => {
    const set = new Set();
    (schedule || []).forEach(wk => { if (wk.locked) set.add(wk.week); });
    return set;
  }, [schedule]);

  const lockedResults = useMemo(() => {
    return matchResults.filter(r => r && lockedWeeks.has(r.week));
  }, [matchResults, lockedWeeks]);

  const latestLockedWeek = useMemo(() => {
    let max = 0;
    lockedWeeks.forEach(w => { if (w > max) max = w; });
    return max;
  }, [lockedWeeks]);

  const standings = useMemo(() => {
    return buildStandings(teams, lockedResults, isRecord, tiebreaker);
  }, [teams, lockedResults, isRecord]);

  const prevStandings = useMemo(() => {
    if (latestLockedWeek === 0) return null;
    const prevResults = lockedResults.filter(r => r.week !== latestLockedWeek);
    if (prevResults.length === 0 && lockedResults.length > 0) return null;
    return buildStandings(teams, prevResults, isRecord, tiebreaker);
  }, [teams, lockedResults, latestLockedWeek, isRecord]);

  const prevPositionMap = useMemo(() => {
    if (!prevStandings) return {};
    const map = {};
    prevStandings.forEach((s, i) => { map[s.teamId] = i + 1; });
    return map;
  }, [prevStandings]);

  const getTeamResults = (teamId) => {
    return lockedResults
      .filter(r => r.team1Id === teamId || r.team2Id === teamId)
      .sort((a, b) => a.week - b.week)
      .map(r => {
        const isTeam1 = r.team1Id === teamId;
        const oppId = isTeam1 ? r.team2Id : r.team1Id;
        const opp = teams.find(t => t.id === oppId);
        const myPts = isTeam1 ? r.team1Points : r.team2Points;
        const oppPts = isTeam1 ? r.team2Points : r.team1Points;
        const wResult = myPts > oppPts ? "W" : myPts < oppPts ? "L" : "T";
        const wk = schedule.find(s => s.week === r.week);

        const holesWon = (r.t1HolesWon !== undefined && r.t2HolesWon !== undefined)
          ? (isTeam1 ? r.t1HolesWon : r.t2HolesWon)
          : 0;

        // Build result display: W/L shows match result text, T always shows TIED
        let resultDisplay = wResult;
        if (wResult === "T") {
          resultDisplay = "TIED";
        } else if (r.matchResultText) {
          resultDisplay = `${wResult} ${r.matchResultText}`;
        } else {
          resultDisplay = `${wResult} ${myPts}-${oppPts}`;
        }

        return { week: r.week, date: wk?.date || "", oppName: lastNamesOnly(opp?.name || "TBD"), myPts, oppPts, result: wResult, holesWon, resultDisplay, matchResult: r };
      });
  };

  // ── Mini scorecard renderer ──
  const renderMiniScorecard = (teamId, r) => {
    if (!course || !r.matchResult) return null;
    const mr = r.matchResult;
    const wk = schedule.find(s => s.week === mr.week);
    const side = wk?.side || getWeekSide(mr.week);
    const pars = side === 'front' ? course.frontPars : course.backPars;
    const hcps = side === 'front' ? course.frontHcps : course.backHcps;
    const wkScores = weekScores[mr.week];
    if (!wkScores) return <div style={{ padding: 8, textAlign: "center", color: K.t3, fontSize: 11 }} className="pu">Loading...</div>;

    const myTeam = teams.find(t => t.id === teamId);
    const oppTeamId = mr.team1Id === teamId ? mr.team2Id : mr.team1Id;
    const oppTeam = teams.find(t => t.id === oppTeamId);
    const isT1 = mr.team1Id === teamId;
    const myPids = isT1 ? [myTeam?.player1, myTeam?.player2].filter(Boolean) : [myTeam?.player1, myTeam?.player2].filter(Boolean);
    const oppPids = isT1 ? [oppTeam?.player1, oppTeam?.player2].filter(Boolean) : [oppTeam?.player1, oppTeam?.player2].filter(Boolean);
    // Raw team IDs for score lookup
    const t1Pids = [teams.find(t => t.id === mr.team1Id)?.player1, teams.find(t => t.id === mr.team1Id)?.player2].filter(Boolean);
    const t2Pids = [teams.find(t => t.id === mr.team2Id)?.player1, teams.find(t => t.id === mr.team2Id)?.player2].filter(Boolean);
    const topPids = isT1 ? t1Pids : t2Pids;
    const botPids = isT1 ? t2Pids : t1Pids;

    const getScore = (pid, h) => wkScores[`w${mr.week}_p${pid}_h${h}`] || 0;
    const sorted = hcps.map((h, i) => ({ idx: i, hcp: h })).sort((a, b) => a.hcp - b.hcp);
    const getStrokesMap = (nh) => {
      const map = {}; let rem = Math.abs(nh);
      for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + 1; rem--; }
      for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + 1; rem--; }
      return map;
    };
    const getHcp = (pid) => {
      const p = players.find(pl => pl.id === pid);
      return p ? Math.round(p.handicapIndex || 0) : 0;
    };
    const getStrokes = (pid, h) => getStrokesMap(getHcp(pid))[h] || 0;
    const getInitials = (pid) => {
      const p = players.find(pl => pl.id === pid);
      return p ? p.name.split(' ').map(n => n[0]).join('') : "?";
    };

    // Hole results from top team perspective
    const holeResults = [];
    for (let h = 0; h < 9; h++) {
      let n1 = 0, n2 = 0;
      topPids.forEach(pid => { n1 += getScore(pid, h) - getStrokes(pid, h); });
      botPids.forEach(pid => { n2 += getScore(pid, h) - getStrokes(pid, h); });
      holeResults.push(n1 < n2 ? 1 : n2 < n1 ? -1 : 0);
    }

    const gridLine = `1px solid ${K.bdr}20`;

    const PlayerRow = ({ pid }) => (
      <div style={{ display: "flex", alignItems: "center", borderBottom: gridLine }}>
        <div style={{ width: 32, flexShrink: 0, paddingLeft: 3, display: "flex", alignItems: "center", height: 28 }}>
          <span style={{ fontSize: 10, color: K.t1, fontWeight: 800 }}>{getInitials(pid)}</span>
          <span style={{ fontSize: 8, color: "#3b82f6", fontWeight: 700, marginLeft: 2 }}>{getHcp(pid)}</span>
        </div>
        {Array.from({ length: 9 }, (_, h) => {
          const s = getScore(pid, h);
          return <div key={h} style={{ flex: 1, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRight: h < 8 ? gridLine : "none" }}>
            <MiniScoreCell score={s} par={pars[h]} size={11} />
          </div>;
        })}
      </div>
    );

    const TeamRow = ({ pids, isTop }) => (
      <div style={{ display: "flex", alignItems: "center", background: K.act + "08" }}>
        <div style={{ width: 32, flexShrink: 0, fontSize: 7, color: K.act, fontWeight: 800, paddingLeft: 3, display: "flex", alignItems: "center", height: 22 }}>NET</div>
        {Array.from({ length: 9 }, (_, h) => {
          let tNet = 0;
          pids.forEach(pid => { tNet += getScore(pid, h) - getStrokes(pid, h); });
          const won = holeResults[h] === (isTop ? 1 : -1);
          return <div key={h} style={{
            flex: 1, textAlign: "center", fontSize: 10, fontWeight: 800,
            color: K.t1, lineHeight: "22px", borderRight: won ? "none" : gridLine,
            ...(won ? { background: K.bg, border: `1px solid ${K.act}`, borderRadius: 2, margin: "-1px 1px", position: "relative", zIndex: 1 } : {}),
          }}>{tNet}</div>;
        })}
      </div>
    );

    return (
      <div style={{ margin: "4px 0 2px", borderRadius: 6, overflow: "hidden", border: `1px solid ${K.bdr}30` }}>
        <div style={{ display: "flex", background: K.acc }}>
          <div style={{ width: 32, flexShrink: 0, fontSize: 7, color: K.bg, fontWeight: 800, paddingLeft: 3, opacity: .8, display: "flex", alignItems: "center", height: 20 }}>HOLE</div>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: K.bg, fontWeight: 800, lineHeight: "20px" }}>{side === 'front' ? i + 1 : i + 10}</div>
          ))}
        </div>
        {topPids.map(pid => <PlayerRow key={pid} pid={pid} />)}
        <TeamRow pids={topPids} isTop={true} />
        <div style={{ height: 1, background: K.bdr + "40" }} />
        {botPids.map(pid => <PlayerRow key={pid} pid={pid} />)}
        <TeamRow pids={botPids} isTop={false} />
      </div>
    );
  };

  const gt = (id) => teams.find(t => t.id === id);
  if (!teams.length) return <EmptyState icon="trophy" title="No teams yet" subtitle="Commissioner needs to set up teams." />;

  const wltCol = { width: 22, textAlign: "center", fontFamily: "'League Spartan', sans-serif" };
  const wltDash = { width: 8, textAlign: "center", color: K.t3 };

  return (
    <div style={{ padding: "0 2px" }}>
      <div className="standings-grid" style={{ gap: LIST_GAP }}>
        {standings.map((s, i) => {
          const team = gt(s.teamId); if (!team) return null;
          const mc = i === 0 ? K.gold : i === 1 ? K.silver : i === 2 ? K.bronze : K.logoBright;
          const isExp = expanded === s.teamId;
          const results = isExp ? getTeamResults(s.teamId) : [];
          const curPos = i + 1;
          const prevPos = prevPositionMap[s.teamId];
          const posChange = (prevPos && latestLockedWeek > 0) ? prevPos - curPos : null;

          return (
            <div key={s.teamId}>
              <button onClick={() => handleExpand(s.teamId)} style={{
                display: "flex", alignItems: "center", width: "100%", color: K.t1,
                background: K.card, borderRadius: isExp ? `${CARD_RADIUS}px ${CARD_RADIUS}px 0 0` : CARD_RADIUS,
                border: `1px solid ${i === 0 ? K.act + '30' : K.bdr}`,
                borderBottom: isExp ? "none" : `1px solid ${i === 0 ? K.act + '30' : K.bdr}`,
                padding: "10px 14px", cursor: "pointer",
              }}>
                <div style={{ width: 40, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                  <div style={{
                    width: RANK_BADGE_SIZE, height: RANK_BADGE_SIZE, borderRadius: RANK_BADGE_RADIUS,
                    background: i < 3 ? mc + "20" : K.logoBright + "20",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: RANK_BADGE_FONT, fontWeight: 800, color: mc,
                    border: i < 3 ? `1.5px solid ${mc}40` : `1.5px solid ${K.logoBright}30`,
                  }}>{curPos}</div>
                  {posChange !== null && posChange !== 0 ? (
                    <div style={{ fontSize: 10, fontWeight: 700, color: posChange > 0 ? K.matchGrn : K.red, display: "flex", alignItems: "baseline", gap: 1, marginLeft: 3, minWidth: 16, lineHeight: 1 }}>
                      <span style={{ fontSize: 7, lineHeight: 1 }}>{posChange > 0 ? "▲" : "▼"}</span>
                      <span style={{ lineHeight: 1 }}>{Math.abs(posChange)}</span>
                    </div>
                  ) : (
                    <div style={{ minWidth: 16, marginLeft: 3 }} />
                  )}
                </div>
                <div style={{ flex: 1, fontSize: NAME_SIZE, fontWeight: NAME_WEIGHT, letterSpacing: .5, textAlign: "left" }}>{lastNamesOnly(team.name)}</div>
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0 }}>
                  {isRecord ? (<>
                    <div style={{ ...wltCol, fontSize: NAME_SIZE, fontWeight: 800, color: K.t1 }}>{s.w}</div>
                    <div style={{ ...wltDash, fontSize: NAME_SIZE, fontWeight: 800 }}>-</div>
                    <div style={{ ...wltCol, fontSize: NAME_SIZE, fontWeight: 800, color: K.t1 }}>{s.l}</div>
                    <div style={{ ...wltDash, fontSize: NAME_SIZE, fontWeight: 800 }}>-</div>
                    <div style={{ ...wltCol, fontSize: NAME_SIZE, fontWeight: 800, color: K.t1 }}>{s.t}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#3b82f6", minWidth: 26, textAlign: "right", marginLeft: 6 }}>{s.hw}</div>
                  </>) : (<>
                    <div style={{ ...wltCol, fontSize: 11, fontWeight: 500, color: K.t3 }}>{s.w}</div>
                    <div style={{ ...wltDash, fontSize: 11, color: K.t3 }}>-</div>
                    <div style={{ ...wltCol, fontSize: 11, fontWeight: 500, color: K.t3 }}>{s.l}</div>
                    <div style={{ ...wltDash, fontSize: 11, color: K.t3 }}>-</div>
                    <div style={{ ...wltCol, fontSize: 11, fontWeight: 500, color: K.t3 }}>{s.t}</div>
                    <div style={{ fontSize: HERO_NUM_SIZE, fontWeight: HERO_NUM_WEIGHT, color: K.t1, fontFamily: "'League Spartan', sans-serif", minWidth: 30, textAlign: "right", marginLeft: 6 }}>{s.points}</div>
                  </>)}
                </div>
                <div style={{ width: 20, flexShrink: 0, textAlign: "right", color: K.t3, fontSize: CHEVRON_SIZE, marginLeft: 6 }}>{isExp ? "▾" : "›"}</div>
              </button>

              {isExp && (
                <div ref={expandedRef} style={{ background: K.inp, border: `1px solid ${i === 0 ? K.act + '30' : K.bdr}`, borderTop: "none", borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`, padding: "8px 10px" }}>
                  <div style={{ display: "flex", padding: "5px 8px", fontSize: 9, color: K.logoBright, fontWeight: 700, textTransform: "uppercase", letterSpacing: .8 }}>
                    <div style={{ width: 14, flexShrink: 0 }} />
                    <div style={{ width: 24, flexShrink: 0 }}>Wk</div>
                    <div style={{ width: 48, flexShrink: 0 }}>Date</div>
                    <div style={{ flex: 1 }}>Opponent</div>
                    <div style={{ width: 58, flexShrink: 0, textAlign: "right" }}>Result</div>
                    <div style={{ width: 28, flexShrink: 0, textAlign: "right" }}>HW</div>
                  </div>
                  {results.length === 0 ? (
                    <div style={{ padding: "10px 8px", fontSize: 12, color: K.t3, fontStyle: "italic" }}>No matches played yet</div>
                  ) : results.map((r, ri) => {
                    const resKey = `${s.teamId}_${r.week}`;
                    const isResExp = expandedResult === resKey;
                    return (
                      <div key={ri}>
                        <button onClick={() => toggleResultExpand(s.teamId, r.week)} style={{ display: "flex", alignItems: "center", padding: "7px 8px", fontSize: 12, width: "100%", background: "transparent", border: "none", borderTop: `1px solid ${K.bdr}30`, cursor: "pointer", textAlign: "left" }}>
                          <div style={{ width: 14, flexShrink: 0, color: K.t3, fontSize: 9 }}>{isResExp ? "▾" : "›"}</div>
                          <div style={{ width: 24, flexShrink: 0, color: K.t3, fontSize: 11 }}>{r.week}</div>
                          <div style={{ width: 48, flexShrink: 0, color: K.t3, fontSize: 11 }}>{r.date || "—"}</div>
                          <div style={{ flex: 1, color: K.t2, fontWeight: 500 }}>{r.oppName}</div>
                          <div style={{ width: 58, flexShrink: 0, textAlign: "right", fontWeight: 700, fontSize: 11, color: r.result === "W" ? K.matchGrn : r.result === "L" ? K.red : K.t2 }}>{r.resultDisplay}</div>
                          <div style={{ width: 28, flexShrink: 0, textAlign: "right", color: "#3b82f6", fontWeight: 700 }}>{r.holesWon}</div>
                        </button>
                        {isResExp && (
                          <div style={{ padding: "2px 4px 10px" }}>
                            {renderMiniScorecard(s.teamId, r)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
