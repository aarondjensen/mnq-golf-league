import { useState, useEffect, useMemo } from "react";
import { K, EmptyState, Card, SubLabel, LIST_GAP, CARD_RADIUS, getWeekSide } from "../theme";

// ──────────────────────────────────────────────────────────────────────────
//  StatsView — season-long leaderboards
// ──────────────────────────────────────────────────────────────────────────
// Replaces the prior "Coming soon" placeholder. Computes from current-season
// hole_scores: lowest gross round, lowest net round, fewest bogeys+ across
// all rounds, most birdies+. Refreshes when the user opens this tab.
//
// Light implementation by design — the heavy individual-tournament leaderboard
// already lives in Standings → Individual. This page is for "fun" season
// stats that don't drive standings.
export default function StatsView({ players, course, schedule, scoringRules, fetchSeasonScores }) {
  const [scores, setScores] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!fetchSeasonScores) return;
    let cancelled = false;
    setLoading(true);
    fetchSeasonScores().then(s => {
      if (cancelled) return;
      setScores(s);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchSeasonScores]);

  // Build per-player aggregate stats from current-season hole_scores.
  const stats = useMemo(() => {
    if (!course) return [];
    const frontPars = course.frontPars || [];
    const backPars = course.backPars || [];

    return players.map(p => {
      const rounds = []; // { week, side, gross, net, birdiePlus, bogeyPlus }
      const hcp = Math.round(p.handicapIndex || 0);
      // Walk weeks; collect any complete (9-hole) round.
      for (const wk of (schedule || [])) {
        if (wk.rainedOut) continue;
        if (typeof wk.week !== "number" || wk.week <= 0) continue;
        const side = wk.side || getWeekSide(wk.week);
        const pars = side === 'front' ? frontPars : backPars;
        if (!pars.length) continue;
        // Skip if marked absent for this week.
        if (scores[`w${wk.week}_p${p.id}_habsent`] === 1) continue;

        let gross = 0, holesPlayed = 0, birdiePlus = 0, bogeyPlus = 0;
        for (let h = 0; h < 9; h++) {
          const s = scores[`w${wk.week}_p${p.id}_h${h}`] || 0;
          if (s > 0) {
            gross += s;
            holesPlayed++;
            const par = pars[h] || 4;
            if (s <= par - 1) birdiePlus++;
            if (s >= par + 1) bogeyPlus++;
          }
        }
        if (holesPlayed === 9) {
          rounds.push({ week: wk.week, side, gross, net: gross - hcp, birdiePlus, bogeyPlus });
        }
      }

      if (!rounds.length) return null;
      const lowestGross = Math.min(...rounds.map(r => r.gross));
      const lowestNet = Math.min(...rounds.map(r => r.net));
      const totalBirdiePlus = rounds.reduce((a, r) => a + r.birdiePlus, 0);
      const totalBogeyPlus = rounds.reduce((a, r) => a + r.bogeyPlus, 0);
      return {
        playerId: p.id,
        name: p.name,
        rounds: rounds.length,
        lowestGross,
        lowestNet,
        birdiePlus: totalBirdiePlus,
        bogeyPlus: totalBogeyPlus,
      };
    }).filter(Boolean);
  }, [players, course, schedule, scores]);

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: K.t3, fontSize: 13 }} className="pu">Loading...</div>;
  if (!course) return <EmptyState icon="barChart" title="Course not configured" subtitle="Stats unlock once the commissioner sets up the course." />;
  if (!stats.length) return <EmptyState icon="barChart" title="No completed rounds yet" subtitle="Stats appear here as players post 9-hole rounds." />;

  // Each leaderboard takes the same shape: a sorted list with a hero metric.
  const board = (title, subtitle, valueFn, sortDir = 'asc', valueFmt) => {
    const sorted = [...stats]
      .filter(s => valueFn(s) !== null && valueFn(s) !== undefined)
      .sort((a, b) => sortDir === 'asc' ? valueFn(a) - valueFn(b) : valueFn(b) - valueFn(a))
      .slice(0, 5);
    return (
      <div style={{ marginBottom: 16 }}>
        <SubLabel>{title}</SubLabel>
        {subtitle && <div style={{ fontSize: 10, color: K.t3, marginTop: -4, marginBottom: 6 }}>{subtitle}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
          {sorted.map((s, i) => (
            <div key={s.playerId} style={{
              display: "flex", alignItems: "center", padding: "8px 12px",
              background: K.card, borderRadius: CARD_RADIUS,
              border: `1px solid ${i === 0 ? K.act + "30" : K.bdr}`,
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: 5,
                background: i === 0 ? K.act + "20" : K.inp,
                color: i === 0 ? K.act : K.t3,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 800, flexShrink: 0,
              }}>{i + 1}</div>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: K.t1, marginLeft: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.name}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: K.t1, marginLeft: 8 }}>
                {valueFmt ? valueFmt(valueFn(s)) : valueFn(s)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      {board("Lowest Gross Round", "Best 9-hole gross score this season", s => s.lowestGross, 'asc')}
      {board("Lowest Net Round", "Best 9-hole net score this season", s => s.lowestNet, 'asc')}
      {board("Most Birdies+", "Birdies / eagles / better across the season", s => s.birdiePlus, 'desc')}
      {board("Fewest Bogeys+", "Bogey or worse holes — lower is better", s => s.bogeyPlus, 'asc')}
      <Card style={{ padding: "10px 14px", marginTop: 8 }}>
        <div style={{ fontSize: 11, color: K.t3, lineHeight: 1.5 }}>
          Stats reflect every completed 9-hole round in the current season — round-robin, seeded, and playoff weeks alike. Rounds where the player was marked absent are excluded.
        </div>
      </Card>
    </div>
  );
}
