import { useState, useEffect, useMemo, useRef } from "react";
import { K, EmptyState, lastNamesOnly, LIST_GAP, CARD_RADIUS, NAME_SIZE, NAME_WEIGHT, HERO_NUM_SIZE, HERO_NUM_WEIGHT, RANK_BADGE_SIZE, RANK_BADGE_RADIUS, RANK_BADGE_FONT, CHEVRON_SIZE } from "../theme";

// Build standings from a set of match results
function buildStandings(teams, results, isRecord) {
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
  if (isRecord) {
    arr.sort((a, b) => {
      const aPct = a.gamesPlayed ? (a.w + a.t * 0.5) / a.gamesPlayed : 0;
      const bPct = b.gamesPlayed ? (b.w + b.t * 0.5) / b.gamesPlayed : 0;
      if (bPct !== aPct) return bPct - aPct;
      if (b.w !== a.w) return b.w - a.w;
      return a.l - b.l;
    });
  } else {
    arr.sort((a, b) => b.points - a.points);
  }
  return arr;
}

export default function StandingsView({ teams, players, matchResults, leagueConfig, schedule, fetchSeasonScores }) {
  const isRecord = leagueConfig?.standingsMethod === "record";
  const [expanded, setExpanded] = useState(null);
  const expandedRef = useRef(null);

  const handleExpand = (teamId) => {
    const next = expanded === teamId ? null : teamId;
    setExpanded(next);
    if (next) {
      setTimeout(() => {
        expandedRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
    }
  };

  // Get set of locked weeks from schedule
  const lockedWeeks = useMemo(() => {
    const set = new Set();
    (schedule || []).forEach(wk => {
      if (wk.locked) set.add(wk.week);
    });
    return set;
  }, [schedule]);

  // Only count match results from locked/finalized weeks for standings
  const lockedResults = useMemo(() => {
    return matchResults.filter(r => r && lockedWeeks.has(r.week));
  }, [matchResults, lockedWeeks]);

  // Find the most recently locked week number
  const latestLockedWeek = useMemo(() => {
    let max = 0;
    lockedWeeks.forEach(w => { if (w > max) max = w; });
    return max;
  }, [lockedWeeks]);

  // Current standings (all locked weeks)
  const standings = useMemo(() => {
    return buildStandings(teams, lockedResults, isRecord);
  }, [teams, lockedResults, isRecord]);

  // Previous standings (all locked weeks except the latest)
  const prevStandings = useMemo(() => {
    if (latestLockedWeek === 0) return null;
    const prevResults = lockedResults.filter(r => r.week !== latestLockedWeek);
    if (prevResults.length === 0 && lockedResults.length > 0) return null;
    return buildStandings(teams, prevResults, isRecord);
  }, [teams, lockedResults, latestLockedWeek, isRecord]);

  // Build position map: teamId → rank for previous week
  const prevPositionMap = useMemo(() => {
    if (!prevStandings) return {};
    const map = {};
    prevStandings.forEach((s, i) => { map[s.teamId] = i + 1; });
    return map;
  }, [prevStandings]);

  // Get weekly results for expanded team (only locked weeks)
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

        let resultDisplay = wResult;
        if (r.matchResultText) {
          if (r.matchResultText === "ALL SQUARE") {
            resultDisplay = "T";
          } else {
            resultDisplay = `${wResult} ${r.matchResultText}`;
          }
        } else {
          resultDisplay = `${wResult} ${myPts}-${oppPts}`;
        }

        return { week: r.week, date: wk?.date || "", oppName: lastNamesOnly(opp?.name || "TBD"), myPts, oppPts, result: wResult, holesWon, resultDisplay };
      });
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
                    <div style={{ fontSize: 10, fontWeight: 700, color: posChange > 0 ? K.matchGrn : K.red, display: "flex", alignItems: "center", gap: 0, marginLeft: 3, minWidth: 16 }}>
                      <span style={{ fontSize: 8 }}>{posChange > 0 ? "▲" : "▼"}</span>
                      <span>{Math.abs(posChange)}</span>
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
                    <div style={{ fontSize: 12, fontWeight: 700, color: K.teal, minWidth: 26, textAlign: "right", marginLeft: 6 }}>{s.hw}</div>
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
                    <div style={{ width: 50 }}>Date</div>
                    <div style={{ width: 26 }}>Wk</div>
                    <div style={{ flex: 1 }}>Opponent</div>
                    <div style={{ width: 62, textAlign: "center" }}>Result</div>
                    <div style={{ width: 30, textAlign: "center" }}>HW</div>
                  </div>
                  {results.length === 0 ? (
                    <div style={{ padding: "10px 8px", fontSize: 12, color: K.t3, fontStyle: "italic" }}>No matches played yet</div>
                  ) : results.map((r, ri) => (
                    <div key={ri} style={{ display: "flex", alignItems: "center", padding: "7px 8px", borderTop: `1px solid ${K.bdr}30`, fontSize: 12 }}>
                      <div style={{ width: 50, color: K.t3, fontSize: 11 }}>{r.date || "—"}</div>
                      <div style={{ width: 26, color: K.t3, fontSize: 11 }}>{r.week}</div>
                      <div style={{ flex: 1, color: K.t2, fontWeight: 500 }}>{r.oppName}</div>
                      <div style={{ width: 62, textAlign: "center", fontWeight: 700, fontSize: 11, color: r.result === "W" ? K.matchGrn : r.result === "L" ? K.red : K.t2 }}>{r.resultDisplay}</div>
                      <div style={{ width: 30, textAlign: "center", color: K.teal, fontWeight: 700 }}>{r.holesWon}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
