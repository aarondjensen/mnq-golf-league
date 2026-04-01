import { useMemo } from "react";
import { K, SectionTitle, EmptyState } from "../theme";

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
  if (!teams.length) return <EmptyState icon="trophy" title="No teams yet" subtitle="Commissioner needs to set up teams." />;

  return (
    <div>
      <SectionTitle><span style={{ display: "block", textAlign: "center" }}>Season Standings</span></SectionTitle>
      <div className="standings-grid">
        {standings.map((s, i) => {
          const team = gt(s.teamId); if (!team) return null;
          const mc = i === 0 ? K.gold : i === 1 ? K.silver : i === 2 ? K.bronze : K.t3;
          return (
            <div key={s.teamId} style={{
              display: "flex", alignItems: "center",
              background: K.card, borderRadius: 8,
              border: `1px solid ${i === 0 ? K.acc + '40' : K.bdr}`,
              padding: "8px 12px", position: "relative",
            }}>
              {/* Left bookend — rank */}
              <div style={{ width: 60, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 6,
                  background: i < 3 ? mc + "20" : K.inp,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 800, color: mc,
                  border: i < 3 ? `1.5px solid ${mc}40` : "none",
                }}>{i + 1}</div>
              </div>
              {/* Center — team name */}
              <div style={{ flex: 1, fontSize: 15, fontWeight: 700, letterSpacing: .3, textAlign: "center" }}>{team.name}</div>
              {/* Right bookend — record + points */}
              <div style={{ width: 80, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                <div style={{ fontSize: 10, color: K.t3, whiteSpace: "nowrap" }}>{s.w}-{s.l}-{s.t}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: K.t1, fontFamily: "'League Spartan', sans-serif", minWidth: 28, textAlign: "right" }}>{s.points}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
