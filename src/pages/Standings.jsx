import { useMemo } from "react";
import { K, SectionTitle, EmptyState } from "../theme";

export default function StandingsView({ teams, players, matchResults, leagueConfig }) {
  const isRecord = leagueConfig?.standingsMethod === "record";

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
      // Sort by win%, then wins, then fewest losses
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
              padding: "8px 12px",
            }}>
              <div style={{ width: 60, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 6,
                  background: i < 3 ? mc + "20" : K.inp,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 800, color: mc,
                  border: i < 3 ? `1.5px solid ${mc}40` : "none",
                }}>{i + 1}</div>
              </div>
              <div style={{ flex: 1, fontSize: 15, fontWeight: 700, letterSpacing: .3, textAlign: "center" }}>{team.name}</div>
              <div style={{ width: isRecord ? 70 : 90, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                {isRecord ? (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: K.t1, fontFamily: "'League Spartan', sans-serif", whiteSpace: "nowrap" }}>{s.w}-{s.l}-{s.t}</div>
                  </div>
                ) : (<>
                  <div style={{ fontSize: 10, color: K.t3, whiteSpace: "nowrap" }}>{s.w}-{s.l}-{s.t}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: K.t1, fontFamily: "'League Spartan', sans-serif", minWidth: 28, textAlign: "right" }}>{s.points}</div>
                </>)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
