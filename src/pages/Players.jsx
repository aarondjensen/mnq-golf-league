import { useState, useEffect, useMemo } from "react";
import { K, EmptyState, LIST_GAP, CARD_RADIUS, NAME_SIZE, NAME_WEIGHT, CHEVRON_SIZE, calcPlayerHcp, getWeekSide } from "../theme";

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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
    const currentSeason = new Date().getFullYear();
    return players.map(p => {
      const allRounds = allScores[p.id] || [];
      const totalRounds = allRounds.length;
      const recentRounds = allRounds.slice(-recentN);
      // Two rounds just before the recentN window — these "just dropped out of
      // the calc" and get shown below the divider for context. Bounded by
      // available history; if a player has only just barely enough rounds
      // for recentN, droppedRounds is empty.
      const droppedStart = Math.max(0, allRounds.length - recentN - 2);
      const droppedEnd = Math.max(0, allRounds.length - recentN);
      const droppedRounds = allRounds.slice(droppedStart, droppedEnd);
      // Mirror calcPlayerHcp's proportional scaling for transparency in the expanded view
      const ratio = bestN / recentN;
      const scaledBest = recentRounds.length > 0 ? Math.max(1, Math.round(ratio * recentRounds.length)) : 0;
      const sorted = [...recentRounds].sort((a, b) => a.gross - b.gross);
      const best = sorted.slice(0, scaledBest);

      // Use stored handicapIndex — the single source of truth, updated when a week is locked
      const idx = p.handicapIndex ?? null;

      // Week-over-week change arrow: only show if the player's most recent round
      // is from the current season (otherwise the arrow is stale/confusing).
      // Compare current handicap to what it would have been before the most recent week's round(s).
      let hcpChange = null;
      if (allRounds.length >= 2 && idx !== null) {
        const lastRound = allRounds[allRounds.length - 1];
        if (lastRound.season === currentSeason) {
          // Strip all rounds matching the most-recent (season, week) — handles the rare case
          // where a player has multiple entries per week (shouldn't happen, but safe).
          const priorRounds = allRounds.filter(r => !(r.season === lastRound.season && r.week === lastRound.week));
          if (priorRounds.length > 0) {
            const priorHcp = calcPlayerHcp(priorRounds, recentN, bestN, par);
            if (priorHcp !== null) {
              hcpChange = idx - priorHcp; // negative = improved (lower handicap)
            }
          }
        }
      }

      return { ...p, totalRounds, recentRounds, droppedRounds, best, idx, hcpChange };
    }).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [players, allScores, course, recentN, bestN]);

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: K.t3, fontSize: 13 }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
        {playerStats.map(p => {
          const isExpanded = expanded === p.id;
          return (
          <div key={p.id}>
            <div
              onClick={() => setExpanded(isExpanded ? null : p.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(isExpanded ? null : p.id); } }}
              style={{
                display: "flex", alignItems: "center",
                background: K.card,
                borderRadius: isExpanded ? `${CARD_RADIUS}px ${CARD_RADIUS}px 0 0` : CARD_RADIUS,
                border: `1px solid ${K.bdr}`,
                borderBottom: isExpanded ? "none" : `1px solid ${K.bdr}`,
                padding: "10px 14px", gap: 8,
                cursor: "pointer", userSelect: "none",
              }}
            >
              <div style={{ flex: 1, fontSize: NAME_SIZE, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                {p.name}
                {commPlayerIds.includes(p.id) && <span style={{ fontSize: 8, fontWeight: 700, color: K.warn, background: K.warn + "18", padding: "1px 5px", borderRadius: 3, textTransform: "uppercase", letterSpacing: .5 }}>Comm</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {p.hcpChange !== null && p.hcpChange !== 0 && (
                  <div style={{
                    fontSize: 11, fontWeight: 700,
                    color: p.hcpChange < 0 ? K.matchGrn : K.red,
                    display: "flex", alignItems: "center", gap: 1, justifyContent: "flex-end", minWidth: 24,
                  }}>
                    <span style={{ fontSize: 9 }}>{p.hcpChange < 0 ? "▼" : "▲"}</span>
                    <span>{Math.abs(p.hcpChange)}</span>
                  </div>
                )}
                <div style={{
                  background: K.logoBright + "20", border: `1px solid ${K.logoBright}50`, borderRadius: 6,
                  width: 38, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16, fontWeight: 800, color: K.t1,
                }}>{p.idx}</div>
                {/* Chevron — rotates when row is expanded so the affordance stays consistent
                    with the rest of the app (Standings, Schedule use the same pattern). */}
                <span style={{
                  fontSize: CHEVRON_SIZE, color: K.t3,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 16, lineHeight: 1, marginLeft: 2,
                  transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform .18s ease",
                }}>▾</span>
              </div>
            </div>
            {isExpanded && (
              <div style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderTop: "none", borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`, padding: "10px 10px", fontSize: 12 }}>
                {p.recentRounds.length === 0 ? (
                  <div style={{ color: K.t3, fontStyle: "italic", padding: 4 }}>No completed rounds found</div>
                ) : (() => {
                  // Resolve front/back for a given (season, week). Current season
                  // can override via schedule.side; historical seasons fall back
                  // to the default odd=front, even=back alternation.
                  const currentSeason = new Date().getFullYear();
                  const getRoundSide = (season, week) => {
                    if (season === currentSeason && schedule) {
                      const wk = schedule.find(s => s.week === week);
                      if (wk?.side) return wk.side;
                    }
                    return getWeekSide(week);
                  };

                  // Render one row. Used for both recent (numbered, possibly
                  // accent-bordered if in best-N) and dropped rounds (dimmed,
                  // unnumbered). Layout: date pinned left, side label centered,
                  // score pinned right, with the "dropped" tag (when present)
                  // tucked between side and score so the score stays on the
                  // right edge for fast scanning.
                  const renderRound = (s, opts) => {
                    const { isBest, dropped } = opts;
                    const date = getRoundDate(s.season, s.week);
                    const side = getRoundSide(s.season, s.week);
                    const sideLabel = side === 'front' ? 'Front 9' : 'Back 9';
                    return (
                      <div style={{
                        display: "flex", alignItems: "center",
                        background: K.card,
                        border: `1px solid ${isBest ? K.act + "60" : K.bdr}`,
                        borderRadius: 6,
                        padding: "10px 14px",
                        marginBottom: 4,
                        opacity: dropped ? 0.55 : 1,
                      }}>
                        {/* Date — left-anchored */}
                        <div style={{
                          fontSize: 12, color: K.t2, fontWeight: 600,
                          minWidth: 110,
                        }}>{date}</div>

                        {/* Front/Back — centered in the remaining space */}
                        <div style={{
                          flex: 1, textAlign: "center",
                          fontSize: 12, fontWeight: 700, color: K.t2,
                          letterSpacing: .3,
                        }}>{sideLabel}</div>

                        {/* Optional "dropped" indicator */}
                        {dropped && (
                          <div style={{
                            fontSize: 11, color: K.t3, fontWeight: 600,
                            fontStyle: "italic", marginRight: 14,
                          }}>dropped</div>
                        )}

                        {/* Score — right-anchored */}
                        <div style={{
                          fontSize: 18, fontWeight: 800,
                          color: isBest ? K.act : (dropped ? K.t3 : K.t1),
                          minWidth: 30, textAlign: "right",
                        }}>{s.gross}</div>
                      </div>
                    );
                  };

                  // Most recent first — reverse a copy so we don't mutate state.
                  const recent = [...p.recentRounds].reverse();
                  const dropped = [...p.droppedRounds].reverse();

                  return (
                    <>
                      {recent.map((s) => {
                        const isBest = p.best.some(b =>
                          b.season === s.season && b.week === s.week && b.gross === s.gross
                        );
                        return (
                          <div key={`recent-${s.season}-${s.week}`}>
                            {renderRound(s, { isBest, dropped: false })}
                          </div>
                        );
                      })}

                      {/* Divider — only renders when there are dropped rounds to show */}
                      {dropped.length > 0 && (
                        <div style={{
                          margin: "10px 4px 8px",
                          borderTop: `1px dashed ${K.bdr}`,
                        }} />
                      )}

                      {dropped.map((s) => (
                        <div key={`dropped-${s.season}-${s.week}`}>
                          {renderRound(s, { dropped: true })}
                        </div>
                      ))}

                      {p.best.length > 0 && (
                        <div style={{ color: K.t2, paddingTop: 8, marginTop: 6, textAlign: "center", fontSize: 12, borderTop: `1px solid ${K.bdr}40` }}>
                          Best {p.best.length} of {p.recentRounds.length}: {p.best.map(b => b.gross).join(", ")} · Avg: {(p.best.reduce((a, b) => a + b.gross, 0) / p.best.length).toFixed(1)} · <strong style={{ color: K.t1 }}>HCP: {p.idx}</strong>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
