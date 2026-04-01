import { useMemo } from "react";
import { K, SectionTitle, Card, getWeekSide, calcLeagueHandicap } from "../theme";

export default function StatsView({ players, holeScores, course, schedule, scoringRules }) {
  const recentN = scoringRules.hcpRecentCount || 8;
  const bestN = scoringRules.hcpBestCount || 6;
  const stats = useMemo(() => {
    return players.map(p => {
      const grossScores = []; let totalGross = 0, rounds = 0;
      schedule.forEach(wk => {
        const side = getWeekSide(wk.week + 1);
        const prs = course ? (side === 'front' ? course.frontPars : course.backPars) : [];
        let wg = 0, cnt = 0;
        for (let h = 0; h < 9; h++) { const s = holeScores[`w${wk.week}_p${p.id}_h${h}`]; if (s > 0) { wg += s; cnt++; } }
        if (cnt === 9) { grossScores.push(wg); totalGross += wg; rounds++; }
      });
      const par = course ? (course.frontPars || []).reduce((a, b) => a + b, 0) : 36;
      const calcHcp = calcLeagueHandicap(grossScores, par, recentN, bestN);
      return { ...p, grossScores, idx: calcHcp !== null ? calcHcp : p.handicapIndex, avgGross: rounds ? (totalGross / rounds).toFixed(1) : "—", rounds };
    }).sort((a, b) => (a.idx || 99) - (b.idx || 99));
  }, [players, holeScores, course, schedule, recentN, bestN]);
  return (
    <div><SectionTitle>Player Stats & Handicaps</SectionTitle>
      <div style={{ fontSize: 12, color: K.t3, marginBottom: 12 }}>Best {bestN} of recent {recentN} rounds</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {stats.map(p => (
          <Card key={p.id}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><div style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</div><div style={{ fontSize: 11, color: K.t3 }}>{p.rounds} rounds played</div></div>
            <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: K.t3, fontWeight: 600 }}>Handicap</div><div style={{ fontSize: 22, fontWeight: 800, color: K.t1, fontFamily: "'League Spartan', sans-serif" }}>{p.idx ?? "—"}</div>{p.rounds > 0 && <div style={{ fontSize: 10, color: K.t3 }}>Avg 9: {p.avgGross}</div>}</div>
          </div></Card>
        ))}
      </div>
    </div>
  );
}


