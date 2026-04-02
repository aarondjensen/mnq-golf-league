import { useState, useEffect, useMemo } from "react";
import { K, I, SectionTitle, Card, EmptyState, getWeekSide, calcLeagueHandicap } from "../theme";

export default function MoreView({ view, players, course, schedule, scoringRules, fetchSeasonScores, fetchAllScores, ctpData, members }) {
  if (view === "players") return <PlayersDirectory players={players} course={course} schedule={schedule} scoringRules={scoringRules} fetchAllScores={fetchAllScores} members={members} />;
  if (view === "stats") return <StatsSection players={players} course={course} schedule={schedule} scoringRules={scoringRules} fetchSeasonScores={fetchSeasonScores} />;
  if (view === "ctp") return <CTPSection ctpData={ctpData} players={players} />;
  return null;
}

// ── Players Directory with expandable handicap calc ──
function PlayersDirectory({ players, course, schedule, scoringRules, fetchAllScores, members }) {
  const recentN = scoringRules.hcpRecentCount || 8;
  const bestN = scoringRules.hcpBestCount || 6;
  const [allScores, setAllScores] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const commPlayerIds = (members || []).filter(m => m.isCommissioner).map(m => m.playerId);

  // Approximate round dates from season year + week number
  // Seasons typically start mid-April: 2023=Apr 25, 2024=Apr 23, 2025=Apr 22, 2026=Apr 21
  const seasonStarts = { 2023: "2023-04-25", 2024: "2024-04-23", 2025: "2025-04-22", 2026: "2026-04-21" };
  const getRoundDate = (season, week) => {
    const start = seasonStarts[season];
    if (!start) return `${season}`;
    const d = new Date(start + "T12:00:00");
    d.setDate(d.getDate() + (week - 1) * 7);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAllScores().then(scores => {
      if (!cancelled) { setAllScores(scores); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [fetchAllScores]);

  const playerStats = useMemo(() => {
    if (!allScores) return [];
    const par = course ? (course.frontPars || []).reduce((a, b) => a + b, 0) : 36;
    return players.map(p => {
      const allRounds = allScores[p.id] || []; // already sorted chronologically
      const totalRounds = allRounds.length;
      const recentRounds = allRounds.slice(-recentN);
      const sorted = [...recentRounds].sort((a, b) => a.gross - b.gross);
      const best = sorted.slice(0, Math.min(bestN, sorted.length));
      const avg = best.length ? best.reduce((a, b) => a + b.gross, 0) / best.length : null;
      const calcHcp = avg !== null ? Math.round(avg - par) : null;
      return {
        ...p,
        totalRounds,
        recentRounds,
        best,
        par,
        idx: calcHcp !== null ? calcHcp : p.handicapIndex,
      };
    }).sort((a, b) => (a.idx || 99) - (b.idx || 99));
  }, [players, allScores, course, recentN, bestN]);

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: K.t3, fontSize: 13 }}>Loading...</div>;

  return (
    <div>
      <SectionTitle>Players</SectionTitle>
      <div style={{ fontSize: 12, color: K.t3, marginBottom: 12 }}>Best {bestN} of recent {recentN} rounds · Tap handicap for details</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {playerStats.map(p => (
          <div key={p.id}>
            <div style={{ display: "flex", alignItems: "center", background: K.card, borderRadius: expanded === p.id ? "8px 8px 0 0" : 8, border: `1px solid ${K.bdr}`, borderBottom: expanded === p.id ? "none" : `1px solid ${K.bdr}`, padding: "10px 14px", gap: 8 }}>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>{p.name}{commPlayerIds.includes(p.id) && <span style={{ fontSize: 8, fontWeight: 700, color: K.warn, background: K.warn + "18", padding: "1px 5px", borderRadius: 3, textTransform: "uppercase", letterSpacing: .5 }}>Comm</span>}</div>
              <div style={{ fontSize: 11, color: K.t3 }}>{p.totalRounds} rds</div>
              <button onClick={() => setExpanded(expanded === p.id ? null : p.id)} style={{
                background: K.logoBright + "20", border: `1px solid ${K.logoBright}50`, borderRadius: 6, padding: "4px 10px", cursor: "pointer",
                fontSize: 16, fontWeight: 800, color: K.t1, minWidth: 36, textAlign: "center",
              }}>{p.idx}</button>
            </div>
            {expanded === p.id && (
              <div style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "10px 10px", fontSize: 12 }}>
                {p.recentRounds.length === 0 ? (
                  <div style={{ color: K.t3, fontStyle: "italic", padding: 4 }}>No completed rounds found</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5 }}>
                    {p.recentRounds.map((s, i) => {
                      const isBest = p.best.some(b => b.season === s.season && b.week === s.week && b.gross === s.gross);
                      const roundDate = getRoundDate(s.season, s.week);
                      return (
                        <div key={i} style={{
                          background: K.card,
                          border: `1px solid ${isBest ? K.act + "50" : K.bdr}`,
                          borderRadius: 6, padding: "6px 4px", textAlign: "center",
                        }}>
                          <div style={{ fontSize: 11, color: K.t3, marginBottom: 3, fontWeight: 500 }}>{roundDate}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: isBest ? K.act : K.t2 }}>{s.gross}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {p.best.length > 0 && (
                  <div style={{ color: K.t2, paddingTop: 8, marginTop: 6, textAlign: "center", fontSize: 12 }}>
                    Best {p.best.length}: {p.best.map(b => b.gross).join(", ")} · Avg: {(p.best.reduce((a, b) => a + b.gross, 0) / p.best.length).toFixed(1)} · <strong style={{ color: K.t1 }}>HCP: {p.idx}</strong>
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
