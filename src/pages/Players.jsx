import { useState, useEffect, useMemo } from "react";
import { K, EmptyState, LIST_GAP, CARD_RADIUS, NAME_SIZE, NAME_WEIGHT, CHEVRON_SIZE, calcPlayerHcp, getWeekSide, LoadingPanel, SkeletonList, FS, FW } from "../theme";

// ── HcpTrendChart ─────────────────────────────────────────────────────
// Inline SVG line chart of a player's handicap-over-time. Each x-axis
// point is one round; y-axis is the handicap that player had GOING INTO
// that round (computed retroactively from prior rounds via calcPlayerHcp,
// same function the rest of the app uses for match-time handicaps).
//
// Useful as a quick visual of how a player's handicap has trended over
// the season — climbing, falling, holding steady — without having to
// open the full rounds list and do mental math.
//
// Why this lives in Players.jsx and not theme.jsx: it's small and only
// used here. If a second consumer ever appears, promote it.
function HcpTrendChart({ playerScores, recentN, bestN, par, currentHcp }) {
  // Build the (round, hcp-going-into-it) series. Skip rounds where there
  // are zero priors — calcPlayerHcp returns null and there's nothing to
  // plot. Caller sorts playerScores oldest-first, which is the natural
  // Firestore order from fetchAllScores.
  const points = [];
  for (let i = 0; i < playerScores.length; i++) {
    const prior = playerScores.slice(0, i); // strictly before this round
    if (prior.length === 0) continue;
    const hcp = calcPlayerHcp(prior, recentN, bestN, par);
    if (hcp === null) continue;
    points.push({
      season: playerScores[i].season,
      week: playerScores[i].week,
      hcp,
    });
  }

  // Append a final point for the current handicap — what they ARE today,
  // factoring in their most recent round. Gives the line a clean
  // "ends-at-now" endpoint that matches the HCP shown elsewhere.
  if (currentHcp !== undefined && currentHcp !== null && playerScores.length > 0) {
    const lastRound = playerScores[playerScores.length - 1];
    points.push({
      season: lastRound.season,
      week: lastRound.week + 1, // pseudo-week for x-positioning
      hcp: currentHcp,
      label: "Now",
    });
  }

  if (points.length < 2) {
    return (
      <div style={{ color: K.t3, fontStyle: "italic", padding: "20px 4px", textAlign: "center", fontSize: FS.sm }}>
        Not enough rounds to show a trend yet
      </div>
    );
  }

  // SVG dimensions and padding (in viewBox units; final size is 100%)
  const W = 320, H = 140;
  const padL = 26, padR = 12, padT = 12, padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  // Y-axis: handicap range. Pad by 1 above max and below min so points
  // don't sit on the chart edges. Floor at 0 since handicaps don't go
  // negative in this league.
  const hcps = points.map(p => p.hcp);
  const minH = Math.max(0, Math.min(...hcps) - 1);
  const maxH = Math.max(...hcps) + 1;
  const yRange = maxH - minH || 1;

  // X-axis: evenly spaced points
  const xStep = points.length === 1 ? 0 : innerW / (points.length - 1);
  const xy = (i, hcp) => ({
    x: padL + i * xStep,
    y: padT + ((maxH - hcp) / yRange) * innerH,
  });

  // Build the path string and the dots
  const pathD = points.map((p, i) => {
    const { x, y } = xy(i, p.hcp);
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  // Y-axis gridlines: 4 evenly spaced labels including min and max
  const yLabels = [];
  const labelStep = Math.max(1, Math.ceil(yRange / 4));
  for (let v = Math.floor(minH); v <= Math.ceil(maxH); v += labelStep) {
    if (v >= minH - 0.5 && v <= maxH + 0.5) {
      yLabels.push({
        v,
        y: padT + ((maxH - v) / yRange) * innerH,
      });
    }
  }

  return (
    <div style={{ padding: "8px 4px 0" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {/* Y gridlines + labels */}
        {yLabels.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke={K.bdr} strokeWidth="1" strokeDasharray="2,3" />
            <text x={padL - 5} y={g.y + 3} fontSize="9" fill={K.t3} textAnchor="end">{g.v}</text>
          </g>
        ))}

        {/* The trend line */}
        <path d={pathD} stroke={K.act} strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />

        {/* Data points */}
        {points.map((p, i) => {
          const { x, y } = xy(i, p.hcp);
          const isLast = i === points.length - 1;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={isLast ? 4 : 2.5} fill={isLast ? K.act : K.card} stroke={K.act} strokeWidth="1.5" />
            </g>
          );
        })}

        {/* X-axis label: just count of rounds + current hcp at the end. */}
        <text x={padL} y={H - 6} fontSize="9" fill={K.t3}>{points.length} rounds</text>
        <text x={W - padR} y={H - 6} fontSize="9" fill={K.t2} textAnchor="end" fontWeight="700">Current: {currentHcp}</text>
      </svg>
    </div>
  );
}

export default function PlayersView({ players, course, schedule, scoringRules, fetchAllScores, members, dataLoaded }) {
  const recentN = scoringRules.hcpRecentCount ?? 8;
  const bestN = scoringRules.hcpBestCount ?? 6;
  // ── Background-loaded detail data ──
  // The Players tab used to block rendering on a `fetchAllScores()` call —
  // a Firestore fetch of every hole_score doc across all seasons (5000+ rows
  // for a league with imported history). Worse: that cache is invalidated on
  // every score save, so during live scoring the cost is paid repeatedly.
  //
  // The fix: the BASIC list (player name, current handicap, rank, comm
  // badge) needs nothing from allScores — it all comes from `players`
  // props directly. Only the EXPANDED detail view needs allScores (recent
  // rounds list, dropped-rounds context, hcpChange arrow). So render
  // immediately with what's already in props, fetch detail data in
  // background, populate the detail-only fields when ready.
  //
  // Trade-off: the hcpChange arrow on the collapsed row only appears
  // after the background fetch resolves. That's fine — it was always
  // a "after Loading..." appearance, just now the surrounding list is
  // visible during the wait instead of hidden.
  const [allScores, setAllScores] = useState(null);
  const [expanded, setExpanded] = useState(null);
  // Per-player view toggle: "rounds" (default — list of contributing
  // rounds) vs "graph" (handicap-over-time line). Keyed by player id so
  // each expanded card has its own state. Doesn't persist across
  // expand/collapse cycles — that's fine, it's a quick visual aid.
  const [viewModeByPid, setViewModeByPid] = useState({});

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
    fetchAllScores().then(scores => {
      if (!cancelled) setAllScores(scores);
    });
    return () => { cancelled = true; };
  }, [fetchAllScores]);

  const playerStats = useMemo(() => {
    const par = course ? (course.frontPars || []).reduce((a, b) => a + b, 0) : 36;
    const currentSeason = new Date().getFullYear();
    return players.map(p => {
      // Detail-only fields — empty/null until allScores arrives in
      // background. The basic list fields below (idx, name, etc.) work
      // regardless.
      const allRounds = allScores ? (allScores[p.id] || []) : [];
      const totalRounds = allRounds.length;
      const recentRounds = allRounds.slice(-recentN);
      // Two rounds just before the recentN window — these "just dropped out of
      // the calc" and get shown below the divider for context. Bounded by
      // available history; if a player has only just barely enough rounds
      // for recentN, droppedRounds is empty.
      const droppedStart = Math.max(0, allRounds.length - recentN - 2);
      const droppedEnd = Math.max(0, allRounds.length - recentN);
      const droppedRounds = allRounds.slice(droppedStart, droppedEnd);
      // Mirror calcPlayerHcp's proportional scaling for transparency in the
      // expanded view. Includes the same 2-rounds → best-1 special case so
      // the footer "BEST X OF Y" line matches what the stored handicap was
      // actually computed from.
      const ratio = bestN / recentN;
      let scaledBest;
      if (recentRounds.length === 2) {
        scaledBest = 1;
      } else {
        scaledBest = recentRounds.length > 0 ? Math.max(1, Math.round(ratio * recentRounds.length)) : 0;
      }
      const sorted = [...recentRounds].sort((a, b) => a.gross - b.gross);
      const best = sorted.slice(0, scaledBest);

      // Use stored handicapIndex — the single source of truth, updated when a week is locked.
      // This DOESN'T require allScores, so it always renders.
      const idx = p.handicapIndex ?? null;

      // Week-over-week change arrow: only show if the player's most recent round
      // is from the current season (otherwise the arrow is stale/confusing).
      // Compare current handicap to what it would have been before the most recent week's round(s).
      // Requires allScores — null until background fetch resolves.
      let hcpChange = null;
      if (allScores && allRounds.length >= 2 && idx !== null) {
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

  // Cold-start skeleton — `dataLoaded.players` flips true once App.jsx
  // receives the first onSnapshot for league_players, even if it returns
  // empty. Lets us distinguish "still fetching" (skeleton) from "truly
  // no players" (EmptyState) so the page doesn't flash empty state then
  // pop in players a moment later.
  if (dataLoaded && !dataLoaded.players) {
    return <SkeletonList count={10} height={56} />;
  }
  if (!players.length) {
    return <EmptyState icon="user" title="No players yet" subtitle="Commissioner needs to add players in Admin." />;
  }

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
              <div style={{ flex: 1, fontSize: NAME_SIZE, fontWeight: FW.semibold, display: "flex", alignItems: "center", gap: 6 }}>
                {p.name}
                {commPlayerIds.includes(p.id) && <span style={{ fontSize: FS.micro, fontWeight: FW.bold, color: K.warn, background: K.warn + "18", padding: "1px 5px", borderRadius: 3, textTransform: "uppercase", letterSpacing: .5 }}>Comm</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {p.hcpChange !== null && p.hcpChange !== 0 && (
                  <div style={{
                    fontSize: FS.xs, fontWeight: FW.bold,
                    color: p.hcpChange < 0 ? K.matchGrn : K.red,
                    display: "flex", alignItems: "center", gap: 1, justifyContent: "flex-end", minWidth: 24,
                  }}>
                    <span style={{ fontSize: FS.micro }}>{p.hcpChange < 0 ? "▼" : "▲"}</span>
                    <span>{Math.abs(p.hcpChange)}</span>
                  </div>
                )}
                <div style={{
                  background: K.logoBright + "20", border: `1px solid ${K.logoBright}50`, borderRadius: 6,
                  width: 38, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: FS.lg, fontWeight: FW.heavy, color: K.t1,
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
              <div style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderTop: "none", borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`, padding: "10px 10px", fontSize: FS.sm }}>
                {/* Distinguish "still loading" from "loaded, but empty" — we
                    don't want to misleadingly say "no rounds found" while the
                    background fetch is still in flight. allScores is null
                    until the fetchAllScores effect resolves; once it resolves,
                    even an empty player still gets `[]` mapped via `|| []`. */}
                {allScores === null ? (
                  <LoadingPanel subtitle="rounds" size="compact" />
                ) : p.recentRounds.length === 0 ? (
                  <div style={{ color: K.t3, fontStyle: "italic", padding: 4 }}>No completed rounds found</div>
                ) : (() => {
                  const viewMode = viewModeByPid[p.id] || "rounds";
                  const setMode = (m) => setViewModeByPid(prev => ({ ...prev, [p.id]: m }));

                  // ── Toggle pill bar ─────────────────────────────────
                  // Two-option pill, same shape as Scoring's MY MATCH /
                  // ALL MATCHES toggle. Active option gets dark fill, the
                  // inactive one is just outlined. Kept compact since
                  // it sits inside an already-expanded card.
                  const Toggle = (
                    <div style={{
                      display: "flex",
                      gap: 0,
                      background: K.inp,
                      borderRadius: 8,
                      padding: 3,
                      marginBottom: 10,
                      width: "fit-content",
                      margin: "0 auto 10px",
                    }}>
                      {[
                        { id: "rounds", label: "Rounds" },
                        { id: "graph", label: "Trend" },
                      ].map(opt => {
                        const active = viewMode === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => setMode(opt.id)}
                            style={{
                              background: active ? K.t1 : "transparent",
                              color: active ? K.bg : K.t2,
                              border: "none",
                              borderRadius: 6,
                              padding: "5px 14px",
                              fontSize: FS.xs,
                              fontWeight: FW.bold,
                              letterSpacing: .5,
                              textTransform: "uppercase",
                              cursor: "pointer",
                              transition: "all .15s",
                            }}
                          >{opt.label}</button>
                        );
                      })}
                    </div>
                  );

                  if (viewMode === "graph") {
                    return <>{Toggle}<HcpTrendChart playerScores={allScores[p.id] || []} recentN={recentN} bestN={bestN} par={course ? (course.frontPars || []).reduce((a, b) => a + b, 0) : 36} currentHcp={p.idx} /></>;
                  }

                  // Resolve front/back for a given (season, week). Current season
                  // can override via schedule.side; historical seasons fall back
                  // to the default odd=front, even=back alternation — with one
                  // explicit Week-1 override.
                  //
                  // Week 1 is ALWAYS Back 9 in this league, by tradition. The
                  // current-season schedule encodes that with side:'back' on
                  // Week 1, so the commissioner-set value wins. But historical
                  // seasons don't have a schedule available here — the only
                  // info is (season, week) — so the fallback would default to
                  // getWeekSide(1) which returns 'front' (odd weeks default to
                  // front). That's wrong for the league's actual Week 1 history.
                  // Hard-code the override here so historical Week 1 rounds
                  // display "Back 9" consistently with the live schedule.
                  // Same convention enforced in App.jsx's auto-seed flow and
                  // in Schedule.jsx's tee-time labels — keep these in sync.
                  const currentSeason = new Date().getFullYear();
                  const getRoundSide = (season, week) => {
                    if (season === currentSeason && schedule) {
                      const wk = schedule.find(s => s.week === week);
                      if (wk?.side) return wk.side;
                    }
                    if (week === 1) return 'back';
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
                          fontSize: FS.sm, color: K.t2, fontWeight: FW.semibold,
                          minWidth: 110,
                        }}>{date}</div>

                        {/* Front/Back — centered in the remaining space */}
                        <div style={{
                          flex: 1, textAlign: "center",
                          fontSize: FS.sm, fontWeight: FW.bold, color: K.t2,
                          letterSpacing: .3,
                        }}>{sideLabel}</div>

                        {/* Optional "dropped" indicator */}
                        {dropped && (
                          <div style={{
                            fontSize: FS.xs, color: K.t3, fontWeight: FW.semibold,
                            fontStyle: "italic", marginRight: 14,
                          }}>dropped</div>
                        )}

                        {/* Score — right-anchored */}
                        <div style={{
                          fontSize: FS.lg, fontWeight: FW.heavy,
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
                      {Toggle}
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
                        <div style={{ color: K.t2, paddingTop: 8, marginTop: 6, textAlign: "center", fontSize: FS.sm, borderTop: `1px solid ${K.bdr}40` }}>
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
