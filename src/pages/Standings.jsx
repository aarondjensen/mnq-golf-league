import { useState, useEffect, useMemo } from "react";
import { K, EmptyState } from "../theme";

// Extract last name from "First Last" or "F. Last" patterns
// Handles team names like "A. Jensen / B. Smith" → "Jensen / Smith"
function lastNamesOnly(teamName) {
  if (!teamName) return "";
  return teamName.split(/\s*\/\s*/).map(part => {
    const words = part.trim().split(/\s+/);
    return words.length > 1 ? words[words.length - 1] : words[0];
  }).join(" / ");
}

export default function StandingsView({ teams, players, matchResults, leagueConfig, schedule, fetchSeasonScores }) {
  const isRecord = leagueConfig?.standingsMethod === "record";
  const [expanded, setExpanded] = useState(null);
  const [seasonScores, setSeasonScores] = useState(null);

  // Fetch all season scores once on mount
  useEffect(() => {
    fetchSeasonScores().then(scores => setSeasonScores(scores));
  }, []);

  // Calculate holes won per team — prefer saved data, fallback to gross calc
  const teamHolesWon = useMemo(() => {
    const hw = {};
    teams.forEach(t => { hw[t.id] = 0; });

    matchResults.forEach(r => {
      if (!r) return;
      // Use saved holes won data if available
      if (r.t1HolesWon !== undefined && r.t2HolesWon !== undefined) {
        if (hw[r.team1Id] !== undefined) hw[r.team1Id] += r.t1HolesWon;
        if (hw[r.team2Id] !== undefined) hw[r.team2Id] += r.t2HolesWon;
        return;
      }
      // Fallback: calculate from gross scores (legacy matches without saved data)
      if (!seasonScores) return;
      const t1 = teams.find(t => t.id === r.team1Id);
      const t2 = teams.find(t => t.id === r.team2Id);
      if (!t1 || !t2) return;
      const t1Pids = [t1.player1, t1.player2];
      const t2Pids = [t2.player1, t2.player2];

      for (let h = 0; h < 9; h++) {
        let t1Net = 0, t2Net = 0, t1Has = true, t2Has = true;
        t1Pids.forEach(pid => { const s = seasonScores[`w${r.week}_p${pid}_h${h}`]; if (!s || s <= 0) t1Has = false; else t1Net += s; });
        t2Pids.forEach(pid => { const s = seasonScores[`w${r.week}_p${pid}_h${h}`]; if (!s || s <= 0) t2Has = false; else t2Net += s; });
        if (t1Has && t2Has) {
          if (t1Net < t2Net) { if (hw[r.team1Id] !== undefined) hw[r.team1Id]++; }
          else if (t2Net < t1Net) { if (hw[r.team2Id] !== undefined) hw[r.team2Id]++; }
        }
      }
    });
    return hw;
  }, [seasonScores, matchResults, teams]);

  const standings = useMemo(() => {
    const pts = {};
    teams.forEach(t => { pts[t.id] = { teamId: t.id, points: 0, w: 0, l: 0, t: 0, gamesPlayed: 0, hw: teamHolesWon[t.id] || 0 }; });
    matchResults.forEach(r => {
      if (!r) return;
      if (pts[r.team1Id]) pts[r.team1Id].points += (r.team1Points || 0);
      if (pts[r.team2Id]) pts[r.team2Id].points += (r.team2Points || 0);
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
  }, [teams, matchResults, isRecord, teamHolesWon]);

  // Get weekly results for expanded team
  const getTeamResults = (teamId) => {
    return matchResults
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

        // Get holes won from saved data
        let holesWon = 0;
        if (r.t1HolesWon !== undefined && r.t2HolesWon !== undefined) {
          holesWon = isTeam1 ? r.t1HolesWon : r.t2HolesWon;
        } else if (seasonScores && opp) {
          // Fallback: calculate from gross scores (legacy matches)
          const myTeam = teams.find(t => t.id === teamId);
          if (myTeam) {
            const myPids = [myTeam.player1, myTeam.player2];
            const oppPids = [opp.player1, opp.player2];
            for (let h = 0; h < 9; h++) {
              let myNet = 0, oppNet = 0, myHas = true, oppHas = true;
              myPids.forEach(pid => { const s = seasonScores[`w${r.week}_p${pid}_h${h}`]; if (!s || s <= 0) myHas = false; else myNet += s; });
              oppPids.forEach(pid => { const s = seasonScores[`w${r.week}_p${pid}_h${h}`]; if (!s || s <= 0) oppHas = false; else oppNet += s; });
              if (myHas && oppHas && myNet < oppNet) holesWon++;
            }
          }
        }

        // Build result display text: "W 3&1" or "L 3&1" or "T"
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

  // Column style for W-L-T alignment
  const wltCol = { width: 22, textAlign: "center", fontFamily: "'League Spartan', sans-serif" };
  const wltDash = { width: 8, textAlign: "center", color: K.t3 };

  return (
    <div style={{ padding: "0 2px" }}>
      <div className="standings-grid" style={{ gap: 6 }}>
        {standings.map((s, i) => {
          const team = gt(s.teamId); if (!team) return null;
          const mc = i === 0 ? K.gold : i === 1 ? K.silver : i === 2 ? K.bronze : K.logoBright;
          const isExp = expanded === s.teamId;
          const results = isExp ? getTeamResults(s.teamId) : [];

          return (
            <div key={s.teamId}>
              <button onClick={() => setExpanded(isExp ? null : s.teamId)} style={{
                display: "flex", alignItems: "center", width: "100%", color: K.t1,
                background: K.card, borderRadius: isExp ? "10px 10px 0 0" : 10,
                border: `1px solid ${i === 0 ? K.act + '30' : K.bdr + '60'}`,
                borderBottom: isExp ? "none" : `1px solid ${i === 0 ? K.act + '30' : K.bdr + '60'}`,
                padding: "10px 14px", cursor: "pointer",
              }}>
                <div style={{ width: 40, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 7,
                    background: i < 3 ? mc + "20" : K.logoBright + "20",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 800, color: mc,
                    border: i < 3 ? `1.5px solid ${mc}40` : `1.5px solid ${K.logoBright}30`,
                  }}>{i + 1}</div>
                </div>
                <div style={{ flex: 1, fontSize: 15, fontWeight: 700, letterSpacing: .5, textAlign: "left" }}>{lastNamesOnly(team.name)}</div>
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0 }}>
                  {isRecord ? (<>
                    <div style={{ ...wltCol, fontSize: 15, fontWeight: 800, color: K.t1 }}>{s.w}</div>
                    <div style={{ ...wltDash, fontSize: 15, fontWeight: 800 }}>-</div>
                    <div style={{ ...wltCol, fontSize: 15, fontWeight: 800, color: K.t1 }}>{s.l}</div>
                    <div style={{ ...wltDash, fontSize: 15, fontWeight: 800 }}>-</div>
                    <div style={{ ...wltCol, fontSize: 15, fontWeight: 800, color: K.t1 }}>{s.t}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: K.teal, minWidth: 26, textAlign: "right", marginLeft: 6 }}>{s.hw}</div>
                  </>) : (<>
                    <div style={{ ...wltCol, fontSize: 11, fontWeight: 500, color: K.t3 }}>{s.w}</div>
                    <div style={{ ...wltDash, fontSize: 11, color: K.t3 }}>-</div>
                    <div style={{ ...wltCol, fontSize: 11, fontWeight: 500, color: K.t3 }}>{s.l}</div>
                    <div style={{ ...wltDash, fontSize: 11, color: K.t3 }}>-</div>
                    <div style={{ ...wltCol, fontSize: 11, fontWeight: 500, color: K.t3 }}>{s.t}</div>
                    <div style={{ fontSize: 21, fontWeight: 800, color: K.t1, fontFamily: "'League Spartan', sans-serif", minWidth: 30, textAlign: "right", marginLeft: 6 }}>{s.points}</div>
                  </>)}
                </div>
                <div style={{ width: 20, flexShrink: 0, textAlign: "right", color: K.t3, fontSize: 14, marginLeft: 6 }}>{isExp ? "▾" : "›"}</div>
              </button>

              {isExp && (
                <div style={{ background: K.inp, border: `1px solid ${i === 0 ? K.act + '30' : K.bdr + '60'}`, borderTop: "none", borderRadius: "0 0 10px 10px", padding: "8px 10px" }}>
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
                      <div style={{ width: 62, textAlign: "center", fontWeight: 700, fontSize: 11, color: r.result === "W" ? K.grn : r.result === "L" ? K.red : K.t2 }}>{r.resultDisplay}</div>
                      <div style={{ width: 30, textAlign: "center", color: K.teal, fontWeight: 700 }}>{r.holesWon}</div>
                    </div>
                  ))}
                  {results.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", padding: "8px 8px 6px", borderTop: `1px solid ${K.bdr}`, fontSize: 11, fontWeight: 700 }}>
                      <div style={{ flex: 1, color: K.t3 }}>Total</div>
                      <div style={{ width: 30, textAlign: "center", color: K.teal }}>{results.reduce((a, r) => a + r.holesWon, 0)}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
