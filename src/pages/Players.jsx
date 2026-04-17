import { useState, useEffect, useMemo } from "react";
import { K, EmptyState, LIST_GAP, CARD_RADIUS, NAME_SIZE, NAME_WEIGHT, CHEVRON_SIZE } from "../theme";

export default function PlayersView({ players, course, schedule, scoringRules, fetchAllScores, members }) {
  const recentN = scoringRules.hcpRecentCount ?? 8;
  const bestN = scoringRules.hcpBestCount ?? 6;
  const [allScores, setAllScores] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const commPlayerIds = (members || []).filter(m => m.isCommissioner).map(m => m.playerId);

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
    return players.map(p => {
      const allRounds = allScores[p.id] || [];
      const totalRounds = allRounds.length;
      const recentRounds = allRounds.slice(-recentN);
      // Mirror calcPlayerHcp's proportional scaling for transparency in the expanded view
      const ratio = bestN / recentN;
      const scaledBest = recentRounds.length > 0 ? Math.max(1, Math.round(ratio * recentRounds.length)) : 0;
      const sorted = [...recentRounds].sort((a, b) => a.gross - b.gross);
      const best = sorted.slice(0, scaledBest);

      // Use stored handicapIndex — the single source of truth, updated when a week is locked
      const idx = p.handicapIndex ?? null;

      return { ...p, totalRounds, recentRounds, best, idx };
    }).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [players, allScores, recentN, bestN]);

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: K.t3, fontSize: 13 }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
        {playerStats.map(p => (
          <div key={p.id}>
            <div style={{ display: "flex", alignItems: "center", background: K.card, borderRadius: expanded === p.id ? `${CARD_RADIUS}px ${CARD_RADIUS}px 0 0` : CARD_RADIUS, border: `1px solid ${K.bdr}`, borderBottom: expanded === p.id ? "none" : `1px solid ${K.bdr}`, padding: "10px 14px", gap: 8 }}>
              <div style={{ flex: 1, fontSize: NAME_SIZE, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                {p.name}
                {commPlayerIds.includes(p.id) && <span style={{ fontSize: 8, fontWeight: 700, color: K.warn, background: K.warn + "18", padding: "1px 5px", borderRadius: 3, textTransform: "uppercase", letterSpacing: .5 }}>Comm</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button onClick={() => setExpanded(expanded === p.id ? null : p.id)} style={{
                  background: K.logoBright + "20", border: `1px solid ${K.logoBright}50`, borderRadius: 6,
                  width: 38, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16, fontWeight: 800, color: K.t1, padding: 0,
                }}>{p.idx}</button>
              </div>
            </div>
            {expanded === p.id && (
              <div style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderTop: "none", borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`, padding: "10px 10px", fontSize: 12 }}>
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
                    Best {p.best.length} of {p.recentRounds.length}: {p.best.map(b => b.gross).join(", ")} · Avg: {(p.best.reduce((a, b) => a + b.gross, 0) / p.best.length).toFixed(1)} · <strong style={{ color: K.t1 }}>HCP: {p.idx}</strong>
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
