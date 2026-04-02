import { useState, useMemo } from "react";
import { K, SectionTitle, EmptyState } from "../theme";

export default function StandingsView({ teams, players, matchResults, leagueConfig, schedule, holeScores }) {
  const isRecord = leagueConfig?.standingsMethod === "record";
  const [expanded, setExpanded] = useState(null);

  const standings = useMemo(() => {
    const pts = {};
    teams.forEach(t => { pts[t.id] = { teamId: t.id, points: 0, w: 0, l: 0, t: 0, gamesPlayed: 0 }; });
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
  }, [teams, matchResults, isRecord]);

  // Get weekly results for a team
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
        const result = myPts > oppPts ? "W" : myPts < oppPts ? "L" : "T";
        const wk = schedule.find(s => s.week === r.week);

        // Calculate holes won from holeScores
        let holesWon = 0;
        if (holeScores && opp) {
          const myTeam = teams.find(t => t.id === teamId);
          const oppTeam = opp;
          if (myTeam && oppTeam) {
            const myPids = [myTeam.player1, myTeam.player2];
            const oppPids = [oppTeam.player1, oppTeam.player2];
            for (let h = 0; h < 9; h++) {
              let myNet = 0, oppNet = 0;
              myPids.forEach(pid => {
                const s = holeScores[`w${r.week}_p${pid}_h${h}`];
                if (s > 0) myNet += s;
              });
              oppPids.forEach(pid => {
                const s = holeScores[`w${r.week}_p${pid}_h${h}`];
                if (s > 0) oppNet += s;
              });
              if (myNet > 0 && oppNet > 0 && myNet < oppNet) holesWon++;
            }
          }
        }

        return {
          week: r.week,
          date: wk?.date || "",
          oppName: opp?.name || "TBD",
          myPts, oppPts, result, holesWon,
          score: `${myPts}-${oppPts}`,
        };
      });
  };

  const gt = (id) => teams.find(t => t.id === id);
  if (!teams.length) return <EmptyState icon="trophy" title="No teams yet" subtitle="Commissioner needs to set up teams." />;

  return (
    <div>
      <SectionTitle><span style={{ display: "block", textAlign: "center" }}>Season Standings</span></SectionTitle>
      <div className="standings-grid">
        {standings.map((s, i) => {
          const team = gt(s.teamId); if (!team) return null;
          const mc = i === 0 ? K.gold : i === 1 ? K.silver : i === 2 ? K.bronze : K.t3;
          const isExp = expanded === s.teamId;
          const results = isExp ? getTeamResults(s.teamId) : [];

          return (
            <div key={s.teamId}>
              <button onClick={() => setExpanded(isExp ? null : s.teamId)} style={{
                display: "flex", alignItems: "center", width: "100%", color: K.t1,
                background: K.card, borderRadius: isExp ? "8px 8px 0 0" : 8,
                border: `1px solid ${i === 0 ? K.acc + '40' : K.bdr}`,
                borderBottom: isExp ? "none" : undefined,
                padding: "8px 12px", cursor: "pointer",
              }}>
                <div style={{ width: 50, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 6,
                    background: i < 3 ? mc + "20" : K.inp,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 800, color: mc,
                    border: i < 3 ? `1.5px solid ${mc}40` : "none",
                  }}>{i + 1}</div>
                </div>
                <div style={{ flex: 1, fontSize: 15, fontWeight: 700, letterSpacing: .3, textAlign: "center" }}>{team.name}</div>
                <div style={{ width: 80, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                  {isRecord ? (
                    <div style={{ fontSize: 16, fontWeight: 800, color: K.t1, fontFamily: "'League Spartan', sans-serif", whiteSpace: "nowrap" }}>{s.w}-{s.l}-{s.t}</div>
                  ) : (<>
                    <div style={{ fontSize: 10, color: K.t3, whiteSpace: "nowrap" }}>{s.w}-{s.l}-{s.t}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: K.t1, fontFamily: "'League Spartan', sans-serif", minWidth: 28, textAlign: "right" }}>{s.points}</div>
                  </>)}
                </div>
                <div style={{ width: 20, flexShrink: 0, textAlign: "right", color: K.t3, fontSize: 14, marginLeft: 4 }}>{isExp ? "▾" : "›"}</div>
              </button>

              {isExp && (
                <div style={{ background: K.inp, border: `1px solid ${i === 0 ? K.acc + '40' : K.bdr}`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "6px 8px" }}>
                  {/* Header */}
                  <div style={{ display: "flex", padding: "4px 6px", fontSize: 9, color: K.t3, fontWeight: 600, textTransform: "uppercase", letterSpacing: .8 }}>
                    <div style={{ width: 60 }}>Date</div>
                    <div style={{ width: 30 }}>Wk</div>
                    <div style={{ flex: 1 }}>Opponent</div>
                    <div style={{ width: 24, textAlign: "center" }}>R</div>
                    <div style={{ width: 40, textAlign: "center" }}>Score</div>
                    <div style={{ width: 30, textAlign: "center" }}>HW</div>
                  </div>
                  {results.length === 0 ? (
                    <div style={{ padding: "8px 6px", fontSize: 12, color: K.t3, fontStyle: "italic" }}>No matches played yet</div>
                  ) : results.map((r, ri) => (
                    <div key={ri} style={{ display: "flex", alignItems: "center", padding: "5px 6px", borderTop: `1px solid ${K.bdr}30`, fontSize: 12 }}>
                      <div style={{ width: 60, color: K.t3, fontSize: 11 }}>{r.date || "—"}</div>
                      <div style={{ width: 30, color: K.t3, fontSize: 11 }}>{r.week}</div>
                      <div style={{ flex: 1, color: K.t2, fontWeight: 500 }}>{r.oppName}</div>
                      <div style={{ width: 24, textAlign: "center", fontWeight: 700, color: r.result === "W" ? K.grn : r.result === "L" ? K.red : K.t2 }}>{r.result}</div>
                      <div style={{ width: 40, textAlign: "center", color: K.t1, fontWeight: 600 }}>{r.score}</div>
                      <div style={{ width: 30, textAlign: "center", color: K.teal, fontWeight: 700 }}>{r.holesWon}</div>
                    </div>
                  ))}
                  {results.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", padding: "6px 6px 4px", borderTop: `1px solid ${K.bdr}`, fontSize: 11, fontWeight: 700 }}>
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
