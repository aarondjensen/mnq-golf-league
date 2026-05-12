import { useState, useEffect, useMemo, useRef } from "react";
import { K, EmptyState, Card, SubLabel, LIST_GAP, CARD_RADIUS, getWeekSide, LoadingPanel } from "../theme";
import { buildStrokesMap } from "../lib/matchCalc";

// ──────────────────────────────────────────────────────────────────────────
//  StatsView — season-long leaderboards
// ──────────────────────────────────────────────────────────────────────────
// Computes per-player stats from current-season hole_scores. Boards split
// across three themed sections: Rounds, Holes, Specialists. A page-level
// Gross/Net toggle drives every board. Two boards (Pars, Birdies) layer
// a per-board Total/Avg toggle on top of that — Avg captures players who
// have missed weeks, since cumulative totals would otherwise under-credit
// them just for low attendance.
//
// Sample-size caveat: no minimums enforced. Early-season boards may show
// noisy single-round leaders — that's the trade-off for showing data as
// it accumulates rather than hiding it until "enough" rounds are in.
//
// Performance: O(players × weeks × 9) per recompute. For 20 players over
// 16 weeks that's ~3000 iterations — well within useMemo budget.
export default function StatsView({ players, course, schedule, scoringRules, fetchSeasonScores }) {
  const [scores, setScores] = useState({});
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("gross");  // "gross" | "net"
  // Sticky-toggle compaction. The sentinel is a 1px div placed just above
  // the toggle in the document. IntersectionObserver watches whether the
  // sentinel is visible in the viewport — when it isn't, the user has
  // scrolled past the toggle's natural position and the toggle should
  // render in compact form. Cheap, jitter-free, and falls back to "never
  // compact" if the observer fails to register (no functional loss).
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  // Per-board aggregation toggle ("total" | "avg") for Total Pars and Total
  // Birdies. Average per round matters because players who miss weeks would
  // otherwise look worse on cumulative totals than they should — Avg captures
  // their actual rate, not raw attendance.
  const [parsAgg,    setParsAgg]    = useState("total");
  const [birdiesAgg, setBirdiesAgg] = useState("total");

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

  // ──────────────────────────────────────────────────────────────────────
  //  Build per-player aggregate stats from current-season hole_scores.
  // ──────────────────────────────────────────────────────────────────────
  // The hole-sequence array (per player) is the key data structure for
  // streak calc: every hole the player encountered this season, in
  // chronological order, marked played / not-played so a missing hole
  // breaks any active streak.
  const stats = useMemo(() => {
    if (!course) return [];
    const frontPars = course.frontPars || [];
    const backPars  = course.backPars  || [];
    const frontHcps = course.frontHcps || [];
    const backHcps  = course.backHcps  || [];

    const sortedWeeks = [...(schedule || [])].sort((a, b) => a.week - b.week);

    return players.map(p => {
      const hcp = Math.round(p.handicapIndex || 0);
      const rounds = [];                   // [{ week, side, gross, net, sidePar }]
      const holeSequence = [];             // [{ par, gross, net, played }] in time order

      // Aggregate counters
      let totalParsGross = 0,    totalParsNet = 0;
      let totalBirdiesGross = 0, totalBirdiesNet = 0;

      // Specialist sums + counts. Par-3 and par-5 now track both gross
      // and net since high-handicap players get strokes on the harder
      // par-3s and par-5s, making the net comparison meaningful.
      let par3SumGross = 0, par3SumNet = 0, par3Count = 0;
      let par5SumGross = 0, par5SumNet = 0, par5Count = 0;
      let hardSumGross = 0, hardSumNet = 0, hardCount = 0;
      let easySumGross = 0, easySumNet = 0, easyCount = 0;

      for (const wk of sortedWeeks) {
        if (wk.rainedOut) continue;
        if (typeof wk.week !== "number" || wk.week <= 0) continue;
        if (scores[`w${wk.week}_p${p.id}_habsent`] === 1) continue;

        const side = wk.side || getWeekSide(wk.week);
        const pars = side === 'front' ? frontPars : backPars;
        const hcps = side === 'front' ? frontHcps : backHcps;
        if (!pars.length || !hcps.length) continue;

        const strokes = buildStrokesMap(hcp, hcps);

        // Per-side hardest/easiest hole indices — rank the 9 holes by their
        // hcp values and grab the bottom 3 (hardest, lowest hcp number) and
        // top 3 (easiest, highest hcp number). Done per-round since front
        // and back have different hcp distributions.
        const sortedByHcp = hcps.map((h, i) => ({ h, i })).sort((a, b) => a.h - b.h);
        const hardestIdxs = new Set(sortedByHcp.slice(0, 3).map(x => x.i));
        const easiestIdxs = new Set(sortedByHcp.slice(-3).map(x => x.i));

        let gross = 0, holesPlayed = 0;

        for (let h = 0; h < 9; h++) {
          const s = scores[`w${wk.week}_p${p.id}_h${h}`] || 0;
          const par = pars[h] || 4;
          const str = strokes[h] || 0;

          if (s > 0) {
            gross += s;
            holesPlayed++;
            const netHole = s - str;

            // Pars (exactly par; the par-or-better count is round-level below)
            if (s === par)       totalParsGross++;
            if (netHole === par) totalParsNet++;

            // Birdies (one under par)
            if (s === par - 1)       totalBirdiesGross++;
            if (netHole === par - 1) totalBirdiesNet++;

            // Specialist — par-type. Both gross and net tracked so
            // each board can toggle independently of the par segmentation.
            if (par === 3) { par3SumGross += s; par3SumNet += netHole; par3Count++; }
            if (par === 5) { par5SumGross += s; par5SumNet += netHole; par5Count++; }

            // Specialist — hardest/easiest hole on the SIDE being played.
            // Per-side rank (not global HCP) so each round contributes
            // exactly 3 hardest and 3 easiest holes regardless of which
            // side a player plays.
            if (hardestIdxs.has(h)) { hardSumGross += s; hardSumNet += netHole; hardCount++; }
            if (easiestIdxs.has(h)) { easySumGross += s; easySumNet += netHole; easyCount++; }

            holeSequence.push({ par, gross: s, net: netHole, played: true });
          } else {
            // No score recorded — streak-breaking marker.
            holeSequence.push({ par, gross: 0, net: 0, played: false });
          }
        }

        if (holesPlayed === 9) {
          const net = gross - hcp;
          rounds.push({ week: wk.week, side, gross, net });
        }
      }

      if (!rounds.length) return null;

      // Longest par-or-better streak — runs across rounds in chronological
      // order. Any missed hole (absence, missing score, or above-par hole)
      // breaks the streak. Both gross and net streaks tracked independently.
      let curG = 0, maxG = 0, curN = 0, maxN = 0;
      for (const h of holeSequence) {
        if (!h.played) { curG = 0; curN = 0; continue; }
        if (h.gross <= h.par) { curG++; if (curG > maxG) maxG = curG; } else curG = 0;
        if (h.net   <= h.par) { curN++; if (curN > maxN) maxN = curN; } else curN = 0;
      }

      const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
      return {
        playerId: p.id,
        name: p.name,
        rounds: rounds.length,
        // Best round
        lowestGross: Math.min(...rounds.map(r => r.gross)),
        lowestNet:   Math.min(...rounds.map(r => r.net)),
        // Round average
        avgGross: sum(rounds, r => r.gross) / rounds.length,
        avgNet:   sum(rounds, r => r.net)   / rounds.length,
        // Hole-level cumulative — totals and per-round averages. Both shapes
        // exposed so the Total/Avg toggle on the Total Pars and Total
        // Birdies boards can switch without recomputing.
        totalParsGross,    totalParsNet,
        totalBirdiesGross, totalBirdiesNet,
        avgParsGross:    totalParsGross    / rounds.length,
        avgParsNet:      totalParsNet      / rounds.length,
        avgBirdiesGross: totalBirdiesGross / rounds.length,
        avgBirdiesNet:   totalBirdiesNet   / rounds.length,
        // Streaks
        maxStreakGross: maxG,
        maxStreakNet:   maxN,
        // Specialists
        par3AvgGross: par3Count > 0 ? par3SumGross / par3Count : null,
        par3AvgNet:   par3Count > 0 ? par3SumNet   / par3Count : null,
        par5AvgGross: par5Count > 0 ? par5SumGross / par5Count : null,
        par5AvgNet:   par5Count > 0 ? par5SumNet   / par5Count : null,
        hardestAvgGross: hardCount > 0 ? hardSumGross / hardCount : null,
        hardestAvgNet:   hardCount > 0 ? hardSumNet   / hardCount : null,
        easyAvgGross:    easyCount > 0 ? easySumGross / easyCount : null,
        easyAvgNet:      easyCount > 0 ? easySumNet   / easyCount : null,
      };
    }).filter(Boolean);
  }, [players, course, schedule, scores]);

  if (loading) return <LoadingPanel />;
  if (!course) return <EmptyState icon="barChart" title="Course not configured" subtitle="Stats unlock once the commissioner sets up the course." />;
  if (!stats.length) return <EmptyState icon="barChart" title="No completed rounds yet" subtitle="Stats appear here as players post 9-hole rounds." />;

  // ──────────────────────────────────────────────────────────────────────
  //  Board renderer — sorted leaderboard with top-5 + hero number.
  // ──────────────────────────────────────────────────────────────────────
  // valueFn returning null filters the player out of the board (e.g.
  // "par 3 specialist" hides anyone who hasn't played a par 3 yet).
  // `playerAnnotation` is an optional (stat) => string|null hook for a
  // small uppercase tag between the name and the hero number — used
  // by Pars/Birdies boards in Avg mode to show "5r" so users can see
  // at a glance why a 4-rounder might outrank a 6-rounder by rate.
  const board = ({ title, valueFn, sortDir = 'asc', valueFmt, headerToggle, subtitle, playerAnnotation }) => {
    const sorted = [...stats]
      .filter(s => valueFn(s) !== null && valueFn(s) !== undefined)
      .sort((a, b) => sortDir === 'asc' ? valueFn(a) - valueFn(b) : valueFn(b) - valueFn(a))
      .slice(0, 5);
    if (!sorted.length) return null;
    return (
      <div style={{ marginBottom: 16 }}>
        {/* Header row — title left, optional mini-toggle right. The mini
            toggle sits on the same baseline as the SubLabel so the row
            reads as a single header rather than label + separate control. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: subtitle ? 0 : 6, minHeight: 18 }}>
          <SubLabel>{title}</SubLabel>
          {headerToggle}
        </div>
        {subtitle && <div style={{ fontSize: 10, color: K.t3, marginTop: -4, marginBottom: 6 }}>{subtitle}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
          {sorted.map((s, i) => {
            const annotation = playerAnnotation ? playerAnnotation(s) : null;
            return (
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
                {annotation && (
                  <div style={{
                    fontSize: 9, fontWeight: 700, color: K.t3,
                    letterSpacing: .5, textTransform: "uppercase",
                    background: K.inp, padding: "2px 6px", borderRadius: 4,
                    marginLeft: 6, flexShrink: 0,
                  }}>
                    {annotation}
                  </div>
                )}
                <div style={{ fontSize: 16, fontWeight: 800, color: K.t1, marginLeft: 8 }}>
                  {valueFmt ? valueFmt(valueFn(s)) : valueFn(s)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ──────────────────────────────────────────────────────────────────────
  //  MiniToggle — smaller segmented control used in board headers for the
  //  Total/Avg switch. Visual weight kept low so it doesn't compete with
  //  the leaderboard rows below.
  // ──────────────────────────────────────────────────────────────────────
  const MiniToggle = ({ value, onChange, options }) => (
    <div style={{ display: "flex", background: K.inp, borderRadius: 5, padding: 1 }}>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: "3px 8px", borderRadius: 4, border: "none",
            background: value === opt.value ? K.acc : "transparent",
            color: value === opt.value ? K.bg : K.t3,
            fontSize: 9, fontWeight: 800, cursor: "pointer",
            letterSpacing: .8, textTransform: "uppercase",
            transition: "all .15s",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  // ──────────────────────────────────────────────────────────────────────
  //  Gross/Net toggle — segmented pill at the top of the page. Drives
  //  every board that takes a `mode`-dependent valueFn. Par-3 and Par-5
  //  specialist boards ignore the toggle (always gross).
  // ──────────────────────────────────────────────────────────────────────
  //  Sticky page Gross/Net toggle. Expanded at top of page; compacts to
  //  a slim pinned pill once the sentinel scrolls off-screen. zIndex 10
  //  keeps it above the boards but below any popup (popup chrome lives
  //  at 500+). background: K.bg is opaque so scrolling content under the
  //  stuck toggle doesn't bleed through.
  // ──────────────────────────────────────────────────────────────────────
  const Toggle = (
    <>
      {/* Sentinel — sits in normal document flow just above the sticky
          toggle. When this scrolls off-screen, the toggle has stuck. */}
      <div ref={sentinelRef} style={{ height: 1 }} />
      <div style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: K.bg,
        // When stuck: tighter padding + a hairline bottom border so the
        // pill has a visual ground line against content scrolling under.
        // When expanded: original 16px below it, no border (clean header).
        paddingTop: stuck ? 6 : 0,
        paddingBottom: stuck ? 6 : 16,
        borderBottom: `1px solid ${stuck ? K.bdr + "60" : "transparent"}`,
        transition: "padding .15s ease, border-color .15s ease",
        // Small negative inset so the bottom border spans full content width
        // even if the parent has horizontal padding. Tune per app layout.
        marginLeft: -2,
        marginRight: -2,
        paddingLeft: 2,
        paddingRight: 2,
      }}>
        <div style={{
          display: "flex", background: K.inp, borderRadius: 8, padding: 2,
          transition: "all .15s ease",
        }}>
          {["gross", "net"].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                // Padding shrinks ~50% in stuck mode to halve the pill's
                // visual height without changing its width.
                padding: stuck ? "4px 0" : "8px 0",
                borderRadius: 6, border: "none",
                background: mode === m ? K.acc : "transparent",
                color: mode === m ? K.bg : K.t3,
                fontSize: stuck ? 11 : 12,
                fontWeight: 700, cursor: "pointer",
                letterSpacing: 1, textTransform: "uppercase",
                transition: "all .15s ease",
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
    </>
  );

  const isNet = mode === "net";
  const modeLabel = isNet ? "Net" : "Gross";

  // Section header — visual separator between Rounds / Holes / Specialists.
  const Section = ({ title }) => (
    <div style={{
      fontSize: 9, fontWeight: 800, color: K.t3,
      letterSpacing: 2, textTransform: "uppercase",
      margin: "8px 0 10px", paddingBottom: 6,
      borderBottom: `1px solid ${K.bdr}40`,
    }}>{title}</div>
  );

  // Total/Avg toggle for the two hole-count boards. Same shape passed to
  // MiniToggle so the call sites stay symmetric.
  const totalAvgOptions = [
    { value: "total", label: "Total" },
    { value: "avg",   label: "Avg" },
  ];

  return (
    <div>
      {Toggle}

      <Section title="Rounds" />
      {board({
        title: `Round Average — ${modeLabel}`,
        valueFn: s => isNet ? s.avgNet : s.avgGross,
        sortDir: 'asc',
        valueFmt: v => v.toFixed(1),
      })}
      {board({
        title: `Best Round — ${modeLabel}`,
        valueFn: s => isNet ? s.lowestNet : s.lowestGross,
        sortDir: 'asc',
      })}

      <Section title="Holes" />
      {board({
        title: `Pars — ${modeLabel}`,
        headerToggle: <MiniToggle value={parsAgg} onChange={setParsAgg} options={totalAvgOptions} />,
        valueFn: s => {
          if (parsAgg === "avg") return isNet ? s.avgParsNet : s.avgParsGross;
          return isNet ? s.totalParsNet : s.totalParsGross;
        },
        sortDir: 'desc',
        valueFmt: v => parsAgg === "avg" ? v.toFixed(1) : v,
        // In Avg mode, show round count next to each player so users can
        // see why a 4-rounder might outrank a 6-rounder by per-round rate.
        playerAnnotation: s => parsAgg === "avg" ? `${s.rounds}r` : null,
      })}
      {board({
        title: `Birdies — ${modeLabel}`,
        headerToggle: <MiniToggle value={birdiesAgg} onChange={setBirdiesAgg} options={totalAvgOptions} />,
        valueFn: s => {
          if (birdiesAgg === "avg") return isNet ? s.avgBirdiesNet : s.avgBirdiesGross;
          return isNet ? s.totalBirdiesNet : s.totalBirdiesGross;
        },
        sortDir: 'desc',
        valueFmt: v => birdiesAgg === "avg" ? v.toFixed(1) : v,
        playerAnnotation: s => birdiesAgg === "avg" ? `${s.rounds}r` : null,
      })}
      {board({
        title: `Longest Par-or-Better Streak — ${modeLabel}`,
        valueFn: s => isNet ? s.maxStreakNet : s.maxStreakGross,
        sortDir: 'desc',
        valueFmt: v => v > 0 ? `${v}` : "—",
      })}

      <Section title="Specialists" />
      {board({
        title: `Par-3 Specialist — ${modeLabel}`,
        valueFn: s => isNet ? s.par3AvgNet : s.par3AvgGross,
        sortDir: 'asc',
        valueFmt: v => v.toFixed(2),
      })}
      {board({
        title: `Par-5 Specialist — ${modeLabel}`,
        valueFn: s => isNet ? s.par5AvgNet : s.par5AvgGross,
        sortDir: 'asc',
        valueFmt: v => v.toFixed(2),
      })}
      {board({
        title: `Hardest Holes Specialist — ${modeLabel}`,
        subtitle: "Average on the 3 hardest handicap holes each 9",
        valueFn: s => isNet ? s.hardestAvgNet : s.hardestAvgGross,
        sortDir: 'asc',
        valueFmt: v => v.toFixed(2),
      })}
      {board({
        title: `Easy Holes Specialist — ${modeLabel}`,
        subtitle: "Average on the 3 easiest handicap holes each 9",
        valueFn: s => isNet ? s.easyAvgNet : s.easyAvgGross,
        sortDir: 'asc',
        valueFmt: v => v.toFixed(2),
      })}

      <Card style={{ padding: "10px 14px", marginTop: 8 }}>
        <div style={{ fontSize: 11, color: K.t3, lineHeight: 1.5 }}>
          Stats reflect every completed 9-hole round in the current season — round-robin, seeded, and playoff weeks alike. Rounds where the player was marked absent are excluded. Streaks span across rounds; any missed hole breaks the run.
        </div>
      </Card>
    </div>
  );
}
