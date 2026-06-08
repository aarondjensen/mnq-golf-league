import { useState, useEffect, useMemo, useRef, memo } from "react";
import { K, EmptyState, SubLabel, LIST_GAP, CARD_RADIUS, getWeekSide, LoadingPanel, getPlayerHcpAtWeek } from "../theme";
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
export default function StatsView({ players, course, schedule, scoringRules, fetchSeasonScores, fetchAllScores, leagueConfig, leagueUser }) {
  const [scores, setScores] = useState({});
  const [allRounds, setAllRounds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("gross");  // "gross" | "net"
  // Sticky-toggle compaction. The sentinel is a 1px div placed just above
  // the toggle in the document. IntersectionObserver watches whether the
  // sentinel is visible in the viewport — when it isn't, the user has
  // scrolled past the toggle's natural position and the toggle should
  // render in compact form. Cheap, jitter-free, and falls back to "never
  // compact" if the observer fails to register (no functional loss).
  const [stuck, setStuck] = useState(false);
  // Per-board expand state — keyed by board title so each board tracks its
  // own collapsed/expanded state independently. Default = collapsed (top 5).
  // Toggling expanded reveals every qualifying player so the full 20-person
  // league can find themselves on every board.
  const [expandedBoards, setExpandedBoards] = useState({});
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
  const [eaglesAgg,  setEaglesAgg]  = useState("total");

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

  // Season-wide rounds for retroactive handicap reconstruction. Stats
  // boards in "net" mode need each round's net to be computed using the
  // handicap the player had GOING INTO that round, not their current
  // handicap. Without this, a player who improved during the season
  // (e.g., went from hcp 8 to hcp 3) would have their early-season net
  // scores under-counted today because we'd be subtracting only 3 strokes
  // per round instead of the 8 they actually got. Symmetric to the
  // Standings fix for the same root cause.
  useEffect(() => {
    if (!fetchAllScores) return;
    let cancelled = false;
    fetchAllScores().then(hist => {
      if (!cancelled) setAllRounds(hist);
    });
    return () => { cancelled = true; };
  }, [fetchAllScores]);

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

    // Settings for retroactive handicap calc — same defaults the rest of
    // the app uses. recentN and bestN come from scoringRules; frontPar
    // is computed from the course's front-9 par list. season is read off
    // leagueConfig so multi-season-aware (matches autoHeal + Standings).
    const recentN = scoringRules?.hcpRecentCount ?? 8;
    const bestN = scoringRules?.hcpBestCount ?? 6;
    const frontPar = frontPars.reduce((a, b) => a + b, 0) || 36;
    const currentSeason = leagueConfig?.year || new Date().getFullYear();

    return players.map(p => {
      // Resolves the handicap this player had GOING INTO a given week.
      // Order of preference:
      //   1. Retroactive calc from prior rounds (deterministic, accurate)
      //   2. startingHandicapIndex (commissioner-set, sticky)
      //   3. Current handicapIndex (today's value, last resort — used
      //      automatically until allRounds fetch resolves on initial load)
      // Closed over p so the call site stays terse.
      const hcpForWeek = (week) => {
        if (allRounds) {
          const retro = getPlayerHcpAtWeek({
            playerId: p.id,
            week,
            season: currentSeason,
            allRoundsByPid: allRounds,
            recentN, bestN, frontPar,
          });
          if (retro !== null) return retro;
        }
        if (p.startingHandicapIndex !== undefined && p.startingHandicapIndex !== null && p.startingHandicapIndex !== "") {
          return Math.round(parseFloat(p.startingHandicapIndex));
        }
        return Math.round(p.handicapIndex || 0);
      };
      const rounds = [];                   // [{ week, side, gross, net, sidePar }]
      const holeSequence = [];             // [{ par, gross, net, played }] in time order

      // Aggregate counters
      let totalParsGross = 0,    totalParsNet = 0;
      let totalBirdiesGross = 0, totalBirdiesNet = 0;
      let totalEaglesGross = 0,  totalEaglesNet = 0;

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

        // Handicap as of this specific week — see hcpForWeek above for
        // the resolution chain. Critical that this is INSIDE the week
        // loop, not outside; using a single hcp value for all of a
        // player's rounds (the original bug) gives wrong net scores for
        // any player whose handicap shifted during the season.
        const weekHcp = hcpForWeek(wk.week);
        const strokes = buildStrokesMap(weekHcp, hcps);

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

            // Eagles (two under par). Rare on a 9-hole front/back at this
            // par-36 layout — most often a par-5 reached in two and a
            // long putt, or driving a par-4. Tracked separately rather
            // than rolled into birdies so the boards show the standout
            // moments without diluting the more common birdies count.
            if (s === par - 2)       totalEaglesGross++;
            if (netHole === par - 2) totalEaglesNet++;

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
          const net = gross - weekHcp;
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
        totalEaglesGross,  totalEaglesNet,
        avgParsGross:    totalParsGross    / rounds.length,
        avgParsNet:      totalParsNet      / rounds.length,
        avgBirdiesGross: totalBirdiesGross / rounds.length,
        avgBirdiesNet:   totalBirdiesNet   / rounds.length,
        avgEaglesGross:  totalEaglesGross  / rounds.length,
        avgEaglesNet:    totalEaglesNet    / rounds.length,
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
  }, [players, course, schedule, scores, allRounds, leagueConfig, scoringRules]);

  // Hole numbers behind the Hardest/Easiest specialist boards, derived from
  // the course hcp arrays so the subtitle always matches what's actually
  // averaged. Mirrors the per-side slice logic in the stats build above:
  // slice(0,3) of holes ranked by ascending hcp = the 3 hardest (hardest
  // first); slice(-3) = the 3 easiest (easiest last). Front holes are
  // numbered 1-9, back holes 10-18. Config-driven — if the course's hcp
  // layout changes, these labels follow automatically.
  const specialistHoles = useMemo(() => {
    if (!course) return null;
    const sideHoles = (hcps, offset) => {
      const ranked = (hcps || []).map((h, i) => ({ h, i })).sort((a, b) => a.h - b.h);
      if (ranked.length < 3) return { hard: [], easy: [] };
      return {
        hard: ranked.slice(0, 3).map(x => x.i + offset),
        easy: ranked.slice(-3).map(x => x.i + offset),
      };
    };
    const front = sideHoles(course.frontHcps, 1);
    const back  = sideHoles(course.backHcps, 10);
    if (!front.hard.length || !back.hard.length) return null;
    return {
      hard: `${front.hard.join(",")} & ${back.hard.join(",")}`,
      easy: `${front.easy.join(",")} & ${back.easy.join(",")}`,
    };
  }, [course]);

  // Section refs — scroll targets for the sticky section nav (1.6A).
  // Each Section component below carries a `sectionId` that resolves
  // to one of these refs. handleSectionTap scrolls the target to just
  // below the sticky toggle so the heading lines up under the pinned
  // pill instead of disappearing under it.
  const sectionRefs = {
    rounds:      useRef(null),
    holes:       useRef(null),
    specialists: useRef(null),
  };
  const handleSectionTap = (id) => {
    const el = sectionRefs[id]?.current;
    if (!el) return;
    // Scroll so the section title sits ~60px from the viewport top —
    // far enough below the sticky toggle (which is ~38-50px tall when
    // stuck) that the title is fully visible. block:"start" + a negative
    // offset is the cleanest cross-browser way to express this.
    const top = el.getBoundingClientRect().top + window.scrollY - 60;
    // scrollIntoView would respect the sticky offset on some browsers
    // but not Safari; window.scrollTo is portable.
    // Pull-to-refresh hook reads scrollTop from .app-body, so we scroll
    // that container instead of window when present.
    const appBody = document.querySelector(".app-body");
    if (appBody) {
      const elTop = el.getBoundingClientRect().top - appBody.getBoundingClientRect().top + appBody.scrollTop;
      appBody.scrollTo({ top: elTop - 60, behavior: "smooth" });
    } else {
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

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
    const allSorted = [...stats]
      .filter(s => valueFn(s) !== null && valueFn(s) !== undefined)
      .sort((a, b) => sortDir === 'asc' ? valueFn(a) - valueFn(b) : valueFn(b) - valueFn(a));
    if (!allSorted.length) return null;
    const isExpanded = !!expandedBoards[title];
    const collapsedCount = 5;
    const hasMore = allSorted.length > collapsedCount;
    const shown = isExpanded ? allSorted : allSorted.slice(0, collapsedCount);

    // ── Jump-to-self affordance (1.6C) ───────────────────────────────
    // If the viewer is on this board AND outside the top-5 collapsed
    // view, render a "▼ You're 12th" pill between rank 5 and the
    // Show All button. Tapping expands the board AND scrolls the
    // viewer's row into view. Without this, a player on a 20-row
    // board has to expand and then hunt — the pill collapses that
    // to one tap.
    const myPid = leagueUser?.playerId;
    const myIdx = myPid ? allSorted.findIndex(s => s.playerId === myPid) : -1;
    const myRank = myIdx >= 0 ? myIdx + 1 : null;
    const showJumpToSelf = !isExpanded && myRank !== null && myRank > collapsedCount;
    const ordinal = (n) => {
      // "1st / 2nd / 3rd / 4th..." for the jump label. Standard English
      // ordinals — covers the edge cases (11th/12th/13th vs 21st/22nd).
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };

    return (
      <div style={{ marginBottom: 16 }}>
        {/* Header row — title left, optional mini-toggle right. The mini
            toggle sits on the same baseline as the SubLabel so the row
            reads as a single header rather than label + separate control. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: subtitle ? 0 : 6, minHeight: 18 }}>
          <SubLabel>{title}</SubLabel>
          {headerToggle}
        </div>
        {subtitle && <div className="mnq-prose" style={{ fontSize: 10, color: K.t3, marginTop: -4, marginBottom: 6 }}>{subtitle}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
          {shown.map((s, i) => {
            const annotation = playerAnnotation ? playerAnnotation(s) : null;
            const isMe = myPid && s.playerId === myPid;
            return (
              <BoardRow
                key={s.playerId}
                rowKey={`${title}__${s.playerId}`}
                rank={i + 1}
                name={s.name}
                annotation={annotation}
                value={valueFmt ? valueFmt(valueFn(s)) : valueFn(s)}
                isFirst={i === 0}
                isMe={isMe}
              />
            );
          })}
        </div>
        {/* Jump-to-self pill — only when viewer is on this board AND outside
            the visible top 5. Expanding scrolls to the row after the layout
            updates (a 0ms timeout is enough — React flushes synchronously
            for state updates within click handlers in practice). */}
        {showJumpToSelf && (
          <button
            onClick={() => {
              setExpandedBoards(prev => ({ ...prev, [title]: true }));
              setTimeout(() => {
                const el = document.querySelector(`[data-stat-row="${title}__${myPid}"]`);
                if (!el) return;
                const appBody = document.querySelector(".app-body");
                if (appBody) {
                  const elTop = el.getBoundingClientRect().top - appBody.getBoundingClientRect().top + appBody.scrollTop;
                  appBody.scrollTo({ top: elTop - 80, behavior: "smooth" });
                } else {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              }, 50);
            }}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              width: "100%", marginTop: 6,
              padding: "8px 12px", borderRadius: CARD_RADIUS,
              background: K.acc + "10", border: `1px solid ${K.acc}40`,
              color: K.acc, fontSize: 11, fontWeight: 800,
              letterSpacing: 1, textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            <span>▼</span>
            <span>You're {ordinal(myRank)}</span>
          </button>
        )}
        {/* Show all / Show less affordance — only renders if there are
            more than 5 qualifying players. Toggles the title-keyed entry
            in expandedBoards; functional setState avoids stale-closure
            issues when the user mashes the button.
            Visual weight bumped (#1.6B) — was a low-opacity dashed pill
            that read as disabled; now a solid 1px border with stronger
            text color + an explicit chevron so the affordance is clear. */}
        {hasMore && (
          <button
            onClick={() => setExpandedBoards(prev => ({ ...prev, [title]: !prev[title] }))}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              width: "100%", marginTop: showJumpToSelf ? 6 : 6,
              padding: "8px 12px", borderRadius: CARD_RADIUS,
              background: K.inp, border: `1px solid ${K.bdr}`,
              color: K.t2, fontSize: 11, fontWeight: 700,
              letterSpacing: 1, textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            <span>{isExpanded ? "Show less" : `Show all (${allSorted.length})`}</span>
            <span style={{ fontSize: 9, transition: "transform .15s", transform: isExpanded ? "rotate(180deg)" : "none" }}>▾</span>
          </button>
        )}
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
  // The `id` prop attaches a ref so the section nav pills can scroll to it.
  // The label keeps its uppercase styling; the wrapper holds the ref so
  // measurements include any leading margin.
  const Section = ({ title, refKey }) => (
    <div ref={refKey ? sectionRefs[refKey] : undefined}>
      <div style={{
        fontSize: 9, fontWeight: 800, color: K.t3,
        letterSpacing: 2, textTransform: "uppercase",
        margin: "8px 0 10px", paddingBottom: 6,
        borderBottom: `1px solid ${K.bdr}40`,
      }}>{title}</div>
    </div>
  );

  // ── Section nav pills (1.6A) ─────────────────────────────────────
  // Three-pill row that jumps to Rounds / Holes / Specialists. Sits
  // between the sticky Gross/Net toggle and the first board. NOT
  // sticky itself — only the Gross/Net toggle needs to stay pinned;
  // the section nav is a one-tap convenience used at the top of the
  // page. If users want it sticky too, easy to add later. Keeping it
  // unsticky now means the Stats page doesn't have two pinned bars
  // eating vertical space.
  const SectionNav = (
    <div style={{
      display: "flex", gap: 6,
      marginBottom: 14, marginTop: 2,
    }}>
      {[
        { id: "rounds", label: "Rounds" },
        { id: "holes", label: "Holes" },
        { id: "specialists", label: "Specialists" },
      ].map(s => (
        <button
          key={s.id}
          onClick={() => handleSectionTap(s.id)}
          style={{
            flex: 1,
            padding: "6px 8px",
            borderRadius: 6,
            background: K.card,
            border: `1px solid ${K.bdr}`,
            color: K.t2, fontSize: 10, fontWeight: 800,
            letterSpacing: 1, textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          {s.label}
        </button>
      ))}
    </div>
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
      {SectionNav}

      <Section title="Rounds" refKey="rounds" />
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

      <Section title="Holes" refKey="holes" />
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
        title: `Eagles — ${modeLabel}`,
        headerToggle: <MiniToggle value={eaglesAgg} onChange={setEaglesAgg} options={totalAvgOptions} />,
        valueFn: s => {
          if (eaglesAgg === "avg") return isNet ? s.avgEaglesNet : s.avgEaglesGross;
          return isNet ? s.totalEaglesNet : s.totalEaglesGross;
        },
        sortDir: 'desc',
        valueFmt: v => eaglesAgg === "avg" ? v.toFixed(2) : v,
        playerAnnotation: s => eaglesAgg === "avg" ? `${s.rounds}r` : null,
      })}
      {board({
        title: `Longest Par-or-Better Streak — ${modeLabel}`,
        valueFn: s => isNet ? s.maxStreakNet : s.maxStreakGross,
        sortDir: 'desc',
        valueFmt: v => v > 0 ? `${v}` : "—",
      })}

      <Section title="Specialists" refKey="specialists" />
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
        subtitle: `Average on the 3 hardest handicap holes each 9${specialistHoles ? ` (${specialistHoles.hard})` : ""}`,
        valueFn: s => isNet ? s.hardestAvgNet : s.hardestAvgGross,
        sortDir: 'asc',
        valueFmt: v => v.toFixed(2),
      })}
      {board({
        title: `Easy Holes Specialist — ${modeLabel}`,
        subtitle: `Average on the 3 easiest handicap holes each 9${specialistHoles ? ` (${specialistHoles.easy})` : ""}`,
        valueFn: s => isNet ? s.easyAvgNet : s.easyAvgGross,
        sortDir: 'asc',
        valueFmt: v => v.toFixed(2),
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
//  BoardRow — single row on a leaderboard. Memoized so the 10 boards on
//  this page don't all re-reconcile when the page-level toggle (which
//  changes hundreds of rows) fires. Props are all primitives so shallow
//  compare is sufficient. data-stat-row carries `${board}__${pid}` so
//  the jump-to-self button can find this row in the DOM and scroll to it.
// ──────────────────────────────────────────────────────────────────────
const BoardRow = memo(function BoardRow({ rank, name, annotation, value, isFirst, isMe, rowKey }) {
  return (
    <div
      data-stat-row={rowKey /* set by parent when known; safe to be undefined */}
      style={{
        display: "flex", alignItems: "center", padding: "8px 12px",
        background: isMe ? K.acc + "12" : K.card,
        borderRadius: CARD_RADIUS,
        border: `1px solid ${
          isMe ? K.acc + "55" :
          isFirst ? K.gold + "30" :
          K.bdr
        }`,
      }}
    >
      <div style={{
        width: 22, height: 22, borderRadius: 5,
        background: isFirst ? K.gold + "20" : K.inp,
        color: isFirst ? K.gold : K.t3,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 800, flexShrink: 0,
      }}>{rank}</div>
      <div style={{
        flex: 1, fontSize: 13, fontWeight: isMe ? 800 : 600,
        color: K.t1, marginLeft: 10,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {name}
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
        {value}
      </div>
    </div>
  );
});
