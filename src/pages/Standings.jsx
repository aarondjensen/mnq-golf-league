import { useMemo } from "react";
import { K, SectionTitle, Card, EmptyState } from "../theme";

export default function StandingsView({ teams, players, matchResults }) {
  const standings = useMemo(() => {
    const pts = {};
    teams.forEach(t => { pts[t.id] = { teamId: t.id, points: 0, w: 0, l: 0, t: 0 }; });
    matchResults.forEach(r => {
      if (!r) return;
      if (pts[r.team1Id]) pts[r.team1Id].points += (r.team1Points || 0);
      if (pts[r.team2Id]) pts[r.team2Id].points += (r.team2Points || 0);
      const d = (r.team1Points || 0) - (r.team2Points || 0);
      if (d > 0) { if (pts[r.team1Id]) pts[r.team1Id].w++; if (pts[r.team2Id]) pts[r.team2Id].l++; }
      else if (d < 0) { if (pts[r.team1Id]) pts[r.team1Id].l++; if (pts[r.team2Id]) pts[r.team2Id].w++; }
      else { if (pts[r.team1Id]) pts[r.team1Id].t++; if (pts[r.team2Id]) pts[r.team2Id].t++; }
    });
    return Object.values(pts).sort((a, b) => b.points - a.points);
  }, [teams, matchResults]);
  const gt = (id) => teams.find(t => t.id === id);
  const gn = (id) => players.find(p => p.id === id)?.name || "TBD";
  if (!teams.length) return <EmptyState icon="trophy" title="No teams yet" subtitle="Commissioner needs to set up teams." />;

  return (
    <div><SectionTitle>Season Standings</SectionTitle>
      <div className="standings-grid">
        {standings.map((s, i) => {
          const team = gt(s.teamId); if (!team) return null;
          const mc = i === 0 ? K.gold : i === 1 ? K.silver : i === 2 ? K.bronze : K.t3;
          return (
            <Card key={s.teamId} highlight={i === 0} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: i < 3 ? mc + "20" : K.inp, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: mc, border: i < 3 ? `1.5px solid ${mc}40` : "none" }}>{i + 1}</div>
              <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700 }}>{team.name}</div><div style={{ fontSize: 11, color: K.t3 }}>{gn(team.player1)} & {gn(team.player2)}</div></div>
              <div style={{ textAlign: "right" }}><div style={{ fontSize: 22, fontWeight: 800, color: K.acc, fontFamily: "'League Spartan', sans-serif" }}>{s.points}</div><div style={{ fontSize: 10, color: K.t3 }}>{s.w}W-{s.l}L-{s.t}T</div></div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}


