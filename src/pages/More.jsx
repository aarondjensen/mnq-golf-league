import { useState, useEffect, useMemo } from "react";
import { K, I, SectionTitle, Card, EmptyState, getWeekSide, calcLeagueHandicap } from "../theme";
import AdminView from "./Admin";

export default function MoreView({ players, allPlayers, course, schedule, scoringRules, fetchSeasonScores, ctpData, isComm, adminProps, members }) {
  const [sub, setSub] = useState(null);

  if (sub === "players") return <><BackBar onBack={() => setSub(null)} title="Players" /><PlayersDirectory players={players} course={course} schedule={schedule} scoringRules={scoringRules} fetchSeasonScores={fetchSeasonScores} members={members} /></>;
  if (sub === "stats") return <><BackBar onBack={() => setSub(null)} title="Stats" /><StatsSection players={players} course={course} schedule={schedule} scoringRules={scoringRules} fetchSeasonScores={fetchSeasonScores} /></>;
  if (sub === "ctp") return <><BackBar onBack={() => setSub(null)} title="CTP" /><CTPSection ctpData={ctpData} players={players} /></>;
  if (sub === "admin" && isComm && adminProps) return <><BackBar onBack={() => setSub(null)} title="Admin" /><AdminView {...adminProps} /></>;

  const items = [
    { id: "players", label: "Players", desc: "Directory & handicap details", icon: "users" },
    { id: "stats", label: "Stats", desc: "Season stats & averages", icon: "barChart" },
    { id: "ctp", label: "Closest to Pin", desc: "CTP leaderboard & results", icon: "target" },
    ...(isComm ? [{ id: "admin", label: "Admin", desc: "League management", icon: "settings" }] : []),
  ];

  return (
    <div>
      <SectionTitle>More</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map(item => (
          <button key={item.id} onClick={() => setSub(item.id)} style={{
            display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left",
            background: K.card, border: `1px solid ${K.bdr}`, borderRadius: 10, padding: "14px 16px",
            cursor: "pointer", transition: "all .15s",
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: K.inp, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {I[item.icon](18, K.acc)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: K.t1 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: K.t3 }}>{item.desc}</div>
            </div>
            <div style={{ color: K.t3, fontSize: 18 }}>›</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function BackBar({ onBack, title }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <button onClick={onBack} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.t2, fontSize: 13, padding: "7px 14px", cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 5, letterSpacing: .4 }}>{I.arrowLeft(13, K.t2)} Back</button>
      <span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>{title}</span>
    </div>
  );
}

// ── Players Directory with expandable handicap calc ──
function PlayersDirectory({ players, course, schedule, scoringRules, fetchSeasonScores, members }) {
  const recentN = scoringRules.hcpRecentCount || 8;
  const bestN = scoringRules.hcpBestCount || 6;
  const [holeScores, setHoleScores] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const commPlayerIds = (members || []).filter(m => m.isCommissioner).map(m => m.playerId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSeasonScores().then(scores => {
      if (!cancelled) { setHoleScores(scores); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [fetchSeasonScores]);

  const playerStats = useMemo(() => {
    if (!holeScores) return [];
    return players.map(p => {
      const grossScores = [];
      schedule.forEach(wk => {
        let wg = 0, cnt = 0;
        for (let h = 0; h < 9; h++) { const s = holeScores[`w${wk.week}_p${p.id}_h${h}`]; if (s > 0) { wg += s; cnt++; } }
        if (cnt === 9) grossScores.push({ week: wk.week, gross: wg });
      });
      const par = course ? (course.frontPars || []).reduce((a, b) => a + b, 0) : 36;
      const recentScores = grossScores.slice(-recentN);
      const sorted = [...recentScores].sort((a, b) => a.gross - b.gross);
      const best = sorted.slice(0, Math.min(bestN, sorted.length));
      const avg = best.length ? best.reduce((a, b) => a + b.gross, 0) / best.length : null;
      const calcHcp = avg !== null ? Math.round(avg - par) : null;
      return {
        ...p,
        grossScores,
        recentScores,
        best,
        par,
        idx: calcHcp !== null ? calcHcp : p.handicapIndex,
        rounds: grossScores.length,
      };
    }).sort((a, b) => (a.idx || 99) - (b.idx || 99));
  }, [players, holeScores, course, schedule, recentN, bestN]);

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: K.t3, fontSize: 13 }}>Loading...</div>;

  return (
    <div>
      <SectionTitle>Players</SectionTitle>
      <div style={{ fontSize: 12, color: K.t3, marginBottom: 12 }}>Tap a handicap to see calculation details</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {playerStats.map(p => (
          <div key={p.id}>
            <div style={{ display: "flex", alignItems: "center", background: K.card, borderRadius: expanded === p.id ? "8px 8px 0 0" : 8, border: `1px solid ${K.bdr}`, borderBottom: expanded === p.id ? "none" : `1px solid ${K.bdr}`, padding: "10px 14px", gap: 8 }}>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>{p.name}{commPlayerIds.includes(p.id) && <span style={{ fontSize: 8, fontWeight: 700, color: K.warn, background: K.warn + "18", padding: "1px 5px", borderRadius: 3, textTransform: "uppercase", letterSpacing: .5 }}>Comm</span>}</div>
              <div style={{ fontSize: 11, color: K.t3 }}>{p.rounds} rds</div>
              <button onClick={() => setExpanded(expanded === p.id ? null : p.id)} style={{
                background: "none", border: `1px solid ${K.bdr}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer",
                fontSize: 16, fontWeight: 800, color: K.t1, minWidth: 36, textAlign: "center",
              }}>{p.idx}</button>
            </div>
            {expanded === p.id && (
              <div style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "10px 14px", fontSize: 12 }}>
                <div style={{ color: K.t3, marginBottom: 8 }}>Best {bestN} of recent {recentN} · Par {p.par}</div>
                {p.recentScores.length === 0 ? (
                  <div style={{ color: K.t3, fontStyle: "italic" }}>No completed rounds this season</div>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {p.recentScores.map((s, i) => {
                      const isBest = p.best.some(b => b.week === s.week && b.gross === s.gross);
                      return (
                        <div key={i} style={{
                          background: isBest ? K.act + "20" : K.card,
                          border: `1px solid ${isBest ? K.act + "50" : K.bdr}`,
                          borderRadius: 6, padding: "4px 8px", textAlign: "center",
                        }}>
                          <div style={{ fontSize: 10, color: K.t3 }}>Wk {s.week}</div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: isBest ? K.t1 : K.t2 }}>{s.gross}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {p.best.length > 0 && (
                  <div style={{ color: K.t2, borderTop: `1px solid ${K.bdr}`, paddingTop: 6, marginTop: 4 }}>
                    Best {p.best.length}: {p.best.map(b => b.gross).join(", ")} · Avg: {(p.best.reduce((a, b) => a + b.gross, 0) / p.best.length).toFixed(1)} · Par: {p.par} · <strong style={{ color: K.t1 }}>HCP: {p.idx}</strong>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stats (reuse existing logic) ──
function StatsSection({ players, course, schedule, scoringRules, fetchSeasonScores }) {
  const recentN = scoringRules.hcpRecentCount || 8;
  const bestN = scoringRules.hcpBestCount || 6;
  const [holeScores, setHoleScores] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSeasonScores().then(scores => {
      if (!cancelled) { setHoleScores(scores); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [fetchSeasonScores]);

  const stats = useMemo(() => {
    if (!holeScores) return [];
    return players.map(p => {
      const grossScores = []; let totalGross = 0, rounds = 0;
      schedule.forEach(wk => {
        let wg = 0, cnt = 0;
        for (let h = 0; h < 9; h++) { const s = holeScores[`w${wk.week}_p${p.id}_h${h}`]; if (s > 0) { wg += s; cnt++; } }
        if (cnt === 9) { grossScores.push(wg); totalGross += wg; rounds++; }
      });
      const par = course ? (course.frontPars || []).reduce((a, b) => a + b, 0) : 36;
      const calcHcp = calcLeagueHandicap(grossScores, par, recentN, bestN);
      return { ...p, idx: calcHcp !== null ? calcHcp : p.handicapIndex, avgGross: rounds ? (totalGross / rounds).toFixed(1) : "—", rounds };
    }).sort((a, b) => (a.idx || 99) - (b.idx || 99));
  }, [players, holeScores, course, schedule, recentN, bestN]);

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: K.t3, fontSize: 13 }}>Loading stats...</div>;

  return (
    <div>
      <SectionTitle>Player Stats</SectionTitle>
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

// ── CTP ──
function CTPSection({ ctpData, players }) {
  const wins = {}; ctpData.filter(c => c.playerId).forEach(c => { wins[c.playerId] = (wins[c.playerId] || 0) + 1; });
  const sorted = Object.entries(wins).map(([pid, cnt]) => ({ p: players.find(pl => pl.id === pid), cnt })).filter(e => e.p).sort((a, b) => b.cnt - a.cnt);
  return (
    <div>
      <SectionTitle>Closest to Pin</SectionTitle>
      {!sorted.length ? <EmptyState icon="target" title="No CTP results yet" /> : (<>
        <div style={{ fontSize: 11, color: K.t3, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 8 }}>Season Leaders</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
          {sorted.map((e, i) => (
            <Card key={e.p.id} highlight={i === 0} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 28, height: 28, borderRadius: 7, background: i === 0 ? K.gold + "20" : K.inp, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: i === 0 ? K.gold : K.t3 }}>{i + 1}</div><span style={{ fontSize: 14, fontWeight: 700 }}>{e.p.name}</span></div>
              <div style={{ fontSize: 18, fontWeight: 800, color: K.t1, fontFamily: "'League Spartan', sans-serif" }}>{e.cnt}</div>
            </Card>
          ))}
        </div>
        <div style={{ fontSize: 11, color: K.t3, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 8 }}>Weekly Results</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {ctpData.filter(c => c.playerId).map(c => <div key={c.id} style={{ background: K.card, borderRadius: 8, padding: "7px 12px", border: `1px solid ${K.bdr}`, display: "flex", justifyContent: "space-between", fontSize: 12 }}><span style={{ color: K.t2 }}>Wk {c.week} · Hole {c.holeNum}</span><span style={{ fontWeight: 700 }}>{players.find(p => p.id === c.playerId)?.name}</span><span style={{ color: K.acc, fontWeight: 600 }}>{c.distance} ft</span></div>)}
        </div>
      </>)}
    </div>
  );
}
