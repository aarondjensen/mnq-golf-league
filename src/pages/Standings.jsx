import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { K, Pill, EmptyState, lastNamesOnly, getWeekSide, LIST_GAP, CARD_RADIUS, NAME_SIZE, NAME_WEIGHT, HERO_NUM_SIZE, HERO_NUM_WEIGHT, RANK_BADGE_SIZE, RANK_BADGE_RADIUS, RANK_BADGE_FONT, CHEVRON_SIZE, calcCourseHandicap, calcNineHandicap } from "../theme";

// Mini ScoreCell for scorecard expansion
function MiniScoreCell({ score, par, size = 11 }) {
  if (!score || score <= 0) return <span style={{ color: K.t3 + "30", fontSize: size }}>·</span>;
  const diff = score - par;
  const sh = size + 6;
  const bc = K.t2;
  let border = null;
  if (diff <= -2) {
    border = (
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: "50%", border: `1.5px solid ${bc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: sh - 5, height: sh - 5, borderRadius: "50%", border: `1px solid ${bc}` }} />
      </div>
    );
  } else if (diff === -1) {
    border = <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: "50%", border: `1.5px solid ${bc}` }} />;
  } else if (diff === 1) {
    border = <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: 2, border: `1.5px solid ${bc}` }} />;
  } else if (diff >= 2) {
    border = (
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: 2, border: `1.5px solid ${bc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: sh - 5, height: sh - 5, borderRadius: 1, border: `1px solid ${bc}` }} />
      </div>
    );
  }
  return (
    <div style={{ position: "relative", width: sh, height: sh, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {border}
      <span style={{ position: "relative", zIndex: 1, fontSize: size, fontWeight: 700, lineHeight: 1 }}>{score}</span>
    </div>
  );
}

// Build standings from a set of match results
function buildStandings(teams, results, isRecord, tiebreaker) {
  const pts = {};
  teams.forEach(t => { pts[t.id] = { teamId: t.id, points: 0, w: 0, l: 0, t: 0, gamesPlayed: 0, hw: 0 }; });
  results.forEach(r => {
    if (!r) return;
    if (pts[r.team1Id]) pts[r.team1Id].points += (r.team1Points || 0);
    if (pts[r.team2Id]) pts[r.team2Id].points += (r.team2Points || 0);
    if (r.t1HolesWon !== undefined && r.t2HolesWon !== undefined) {
      if (pts[r.team1Id]) pts[r.team1Id].hw += r.t1HolesWon;
      if (pts[r.team2Id]) pts[r.team2Id].hw += r.t2HolesWon;
    }
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
  const hwTiebreak = tiebreaker === "holesWon" || !tiebreaker;
  if (isRecord) {
    arr.sort((a, b) => {
      const aPct = a.gamesPlayed ? (a.w + a.t * 0.5) / a.gamesPlayed : 0;
      const bPct = b.gamesPlayed ? (b.w + b.t * 0.5) / b.gamesPlayed : 0;
      if (bPct !== aPct) return bPct - aPct;
      if (b.w !== a.w) return b.w - a.w;
      if (a.l !== b.l) return a.l - b.l;
      if (hwTiebreak) return b.hw - a.hw;
      return 0;
    });
  } else {
    arr.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (hwTiebreak) return b.hw - a.hw;
      return 0;
    });
  }
  return arr;
}


// ════════════════════════════════════════════════════════════
//  PLAYOFF BRACKET VIEW
// ════════════════════════════════════════════════════════════
function PlayoffBracketView({ teams, schedule, matchResults, leagueConfig }) {
  const playoffRounds = leagueConfig?.playoffRounds || [];
  const playoffWeeks = schedule.filter(wk => wk.isPlayoff === true && !wk.rainedOut).sort((a, b) => a.week - b.week);
  const seedMap = useMemo(() => {
    const pts = {};
    teams.forEach(t => { pts[t.id] = 0; });
    matchResults.forEach(r => {
      if (pts[r.team1Id] !== undefined) pts[r.team1Id] += (r.team1Points || 0);
      if (pts[r.team2Id] !== undefined) pts[r.team2Id] += (r.team2Points || 0);
    });
    const sorted = Object.entries(pts).sort((a, b) => b[1] - a[1]);
    const map = {};
    sorted.forEach(([id], i) => { map[id] = i + 1; });
    return map;
  }, [teams, matchResults]);

  const gn = (id) => lastNamesOnly(teams.find(t => t.id === id)?.name || "TBD");
  const getSeed = (id) => seedMap[id] || "?";

  if (!playoffRounds.length) {
    return <EmptyState icon="trophy" title="No playoff bracket configured" subtitle="Commissioner can set up playoff rounds in Admin → Schedule → Edit Setup." />;
  }

  // Build bracket data: for each round, get matches and results
  const bracketData = playoffRounds.map((round, ri) => {
    const roundWeek = playoffWeeks[ri];
    const matches = roundWeek?.matches || [];
    const results = roundWeek ? matchResults.filter(r => r.week === roundWeek.week) : [];
    const isLocked = roundWeek?.locked === true;

    return {
      name: round.name || `Round ${ri + 1}`,
      weekNum: roundWeek?.week,
      date: roundWeek?.date,
      isLocked,
      matchups: matches.map((m, mi) => {
        const res = results.find(r => r.team1Id === m.team1 && r.team2Id === m.team2);
        const t1Pts = res?.team1Points || 0;
        const t2Pts = res?.team2Points || 0;
        return {
          team1: m.team1, team2: m.team2,
          seed1: getSeed(m.team1), seed2: getSeed(m.team2),
          name1: gn(m.team1), name2: gn(m.team2),
          t1Pts, t2Pts,
          t1Won: res && t1Pts > t2Pts,
          t2Won: res && t2Pts > t1Pts,
          tied: res && t1Pts === t2Pts,
          resultText: res?.matchResultText || "",
          hasResult: !!res,
        };
      }),
      // For unfilled rounds, show config labels
      config: round.matchups || [],
    };
  });

  // Determine if we should use horizontal bracket (desktop) or vertical stack (mobile)
  const numRounds = bracketData.length;

  // Helper to describe a config slot
  const slotLabel = (mu, side) => {
    const type = mu[side + "type"];
    const val = mu[side];
    if (type === "seed") return val ? `#${val} Seed` : "TBD";
    if (type === "loser") {
      if (val === "highestLoser") return "High Loser";
      if (val === "nextHighestLoser") return "2nd Loser";
      if (val?.startsWith("loser_")) return `Loser M${parseInt(val.split("_")[1]) + 1}`;
      return "Loser TBD";
    }
    if (val === "lowestWinner") return "Low Winner";
    if (val === "nextLowestWinner") return "Next Low Winner";
    if (val === "lowestSeed") return "Low Seed";
    if (val === "nextLowestSeed") return "2nd Low Seed";
    if (val?.startsWith("winner_")) return `Winner M${parseInt(val.split("_")[1]) + 1}`;
    return "TBD";
  };

  // Matchup card component
  const MatchupCard = ({ mu, showConfig, configMu }) => {
    if (!mu && showConfig && configMu) {
      // Unfilled — show config labels
      return (
        <div style={{ background: K.card, borderRadius: 8, border: `1px solid ${K.bdr}`, overflow: "hidden", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "8px 10px", borderBottom: `1px solid ${K.bdr}30` }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: K.t3, flex: 1 }}>{slotLabel(configMu, "s1")}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "2px 10px", background: K.inp }}>
            <span style={{ fontSize: 9, color: K.t3, fontWeight: 700 }}>VS</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", padding: "8px 10px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: K.t3, flex: 1 }}>{slotLabel(configMu, "s2")}</div>
          </div>
        </div>
      );
    }

    if (!mu) return null;

    return (
      <div style={{ background: K.card, borderRadius: 8, border: `1px solid ${mu.hasResult ? (mu.t1Won || mu.t2Won ? K.matchGrn + "40" : K.bdr) : K.bdr}`, overflow: "hidden", width: "100%" }}>
        {/* Team 1 */}
        <div style={{
          display: "flex", alignItems: "center", padding: "7px 10px",
          background: mu.t1Won ? K.matchGrn + "12" : "transparent",
          borderLeft: mu.t1Won ? `3px solid ${K.matchGrn}` : "3px solid transparent",
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginRight: 6,
            background: K.logoBright + "20", border: `1px solid ${K.logoBright}30`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, fontWeight: 800, color: K.logoBright,
          }}>{mu.seed1}</div>
          <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: mu.t1Won ? K.t1 : mu.t2Won ? K.t3 : K.t1 }}>
            {mu.name1}
          </div>
          {mu.hasResult && <div style={{ fontSize: 13, fontWeight: 800, color: mu.t1Won ? K.matchGrn : K.t3, marginLeft: 6 }}>{mu.t1Pts}</div>}
        </div>
        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", padding: "0 10px", background: K.inp, height: 20 }}>
          <div style={{ flex: 1, height: 1, background: K.bdr + "40" }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: mu.hasResult ? K.acc : K.t3, padding: "0 8px", letterSpacing: 1 }}>
            {mu.hasResult ? (mu.tied ? "TIED" : (mu.resultText || `${mu.t1Pts}-${mu.t2Pts}`)) : "VS"}
          </span>
          <div style={{ flex: 1, height: 1, background: K.bdr + "40" }} />
        </div>
        {/* Team 2 */}
        <div style={{
          display: "flex", alignItems: "center", padding: "7px 10px",
          background: mu.t2Won ? K.matchGrn + "12" : "transparent",
          borderLeft: mu.t2Won ? `3px solid ${K.matchGrn}` : "3px solid transparent",
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginRight: 6,
            background: K.logoBright + "20", border: `1px solid ${K.logoBright}30`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, fontWeight: 800, color: K.logoBright,
          }}>{mu.seed2}</div>
          <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: mu.t2Won ? K.t1 : mu.t1Won ? K.t3 : K.t1 }}>
            {mu.name2}
          </div>
          {mu.hasResult && <div style={{ fontSize: 13, fontWeight: 800, color: mu.t2Won ? K.matchGrn : K.t3, marginLeft: 6 }}>{mu.t2Pts}</div>}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: "0 2px" }}>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 8 }}>
        <div style={{ display: "flex", minWidth: (numRounds + 1) * 175 }}>
          {bracketData.map((round, ri) => {
            const matchCount = Math.max(round.matchups.length, round.config.length, 1);
            // Each subsequent round's matchups should be spaced further apart
            // to align with the midpoint of the pairs from the previous round
            const cardH = 76; // approximate matchup card height
            const firstRoundGap = 12;
            // For round ri, the gap between matchups doubles each round
            const gap = ri === 0 ? firstRoundGap : firstRoundGap + (cardH + firstRoundGap) * (Math.pow(2, ri) - 1);
            const topPad = ri === 0 ? 0 : (gap - firstRoundGap) / 2;

            return (
              <div key={ri} style={{ display: "flex", flexDirection: "column", minWidth: 155 }}>
                {/* Round header */}
                <div style={{ textAlign: "center", marginBottom: 8, height: 36 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: K.warn, letterSpacing: 1 }}>{round.name}</div>
                  <div style={{ fontSize: 9, color: K.t3 }}>
                    {round.weekNum ? `Wk ${round.weekNum}` : ""}{round.date ? ` · ${round.date}` : ""}
                  </div>
                </div>

                {/* Matchups with converging spacing */}
                <div style={{ display: "flex", flexDirection: "column", paddingTop: topPad }}>
                  {Array.from({ length: matchCount }, (_, mi) => {
                    const mu = round.matchups[mi];
                    const configMu = round.config[mi];
                    const isLast = mi === matchCount - 1;

                    return (
                      <div key={mi} style={{ marginBottom: isLast ? 0 : gap }}>
                        <div style={{ display: "flex", alignItems: "center" }}>
                          {/* Incoming connector from previous round */}
                          {ri > 0 && (
                            <div style={{ width: 16, flexShrink: 0, position: "relative", height: cardH }}>
                              <div style={{ position: "absolute", top: "50%", left: 0, width: 16, height: 2, background: K.bdr + "60" }} />
                            </div>
                          )}
                          {/* Card */}
                          <div style={{ flex: 1 }}>
                            <MatchupCard mu={mu} showConfig={!mu} configMu={configMu} />
                          </div>
                          {/* Outgoing connector to next round */}
                          {ri < numRounds - 1 && (
                            <div style={{ width: 16, flexShrink: 0, position: "relative", height: cardH }}>
                              {/* Horizontal line from card to vertical */}
                              <div style={{ position: "absolute", top: "50%", left: 0, width: 8, height: 2, background: K.bdr + "60" }} />
                              {/* Vertical connector — top match goes down, bottom match goes up */}
                              {(() => {
                                const pairIdx = Math.floor(mi / 2);
                                const isTop = mi % 2 === 0;
                                const pairSize = (cardH + gap) / 2;
                                if (isTop && mi + 1 < matchCount) {
                                  // Top of pair — vertical line goes down
                                  return <div style={{ position: "absolute", top: "50%", left: 8, width: 2, height: pairSize + 1, background: K.bdr + "60" }} />;
                                } else if (!isTop) {
                                  // Bottom of pair — vertical line goes up
                                  return <div style={{ position: "absolute", bottom: "50%", left: 8, width: 2, height: pairSize + 1, background: K.bdr + "60" }} />;
                                }
                                return null;
                              })()}
                              {/* Horizontal line from vertical to next round */}
                              {mi % 2 === 0 && mi + 1 < matchCount && (
                                <div style={{ position: "absolute", top: `calc(50% + ${(cardH + gap) / 2}px)`, left: 8, width: 8, height: 2, background: K.bdr + "60" }} />
                              )}
                              {/* Single match in round — just horizontal */}
                              {matchCount === 1 && (
                                <div style={{ position: "absolute", top: "50%", left: 8, width: 8, height: 2, background: K.bdr + "60" }} />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Champion column */}
          {(() => {
            const lastRound = bracketData[bracketData.length - 1];
            const finalMatch = lastRound?.matchups[0];
            const champion = finalMatch?.t1Won ? finalMatch.team1 : finalMatch?.t2Won ? finalMatch.team2 : null;
            // Center the champion vertically with the final round
            const lastMatchCount = Math.max(lastRound?.matchups.length || 0, lastRound?.config.length || 0, 1);
            const lastCardH = 76;
            const lastGap = numRounds <= 1 ? 12 : 12 + (lastCardH + 12) * (Math.pow(2, numRounds - 1) - 1);
            const lastTopPad = numRounds <= 1 ? 0 : (lastGap - 12) / 2;
            const totalH = lastTopPad + lastMatchCount * lastCardH + (lastMatchCount - 1) * lastGap;

            return (
              <div style={{ minWidth: 110, display: "flex", flexDirection: "column" }}>
                <div style={{ height: 36 }} />
                <div style={{ flex: 1, display: "flex", alignItems: "center", paddingLeft: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                    {/* Incoming line */}
                    <div style={{ width: 16, height: 2, background: K.bdr + "60", flexShrink: 0 }} />
                    <div style={{
                      background: champion ? K.gold + "15" : K.card,
                      border: `2px solid ${champion ? K.gold + "50" : K.bdr}`,
                      borderRadius: 10, padding: "12px 14px", textAlign: "center", minWidth: 90,
                    }}>
                      {champion ? (
                        <>
                          <div style={{ fontSize: 18, marginBottom: 2 }}>🏆</div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: K.gold }}>{gn(champion)}</div>
                          <div style={{ fontSize: 9, color: K.t3, marginTop: 2 }}>#{getSeed(champion)} Seed</div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 18, marginBottom: 2 }}>🏆</div>
                          <div style={{ fontSize: 11, color: K.t3 }}>TBD</div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════
//  INDIVIDUAL TOURNAMENT VIEW
// ════════════════════════════════════════════════════════════
function IndividualEventView({ players, teams, schedule, course, leagueConfig, fetchWeekScores }) {
  const [scores, setScores] = useState({});
  const [loading, setLoading] = useState(true);
  const fetched = useRef(false);

  // Find playoff weeks
  const playoffWeeks = useMemo(() =>
    schedule.filter(wk => wk.isPlayoff === true && !wk.rainedOut && wk.matches?.length > 0)
      .sort((a, b) => a.week - b.week),
    [schedule]
  );

  // Fetch scores for all playoff weeks
  useEffect(() => {
    if (fetched.current || !playoffWeeks.length || !fetchWeekScores) return;
    fetched.current = true;
    (async () => {
      const all = {};
      for (const wk of playoffWeeks) {
        const wkScores = await fetchWeekScores(wk.week);
        Object.assign(all, wkScores);
      }
      setScores(all);
      setLoading(false);
    })();
  }, [playoffWeeks, fetchWeekScores]);

  // Build leaderboard: each player's net total across playoff rounds
  const leaderboard = useMemo(() => {
    if (!course || !players.length) return [];

    const teeBoxes = course.teeBoxes || [];
    const frontPars = course.frontPars || [];
    const backPars = course.backPars || [];
    const frontPar = frontPars.reduce((a, b) => a + b, 0);
    const backPar = backPars.reduce((a, b) => a + b, 0);

    const board = players.map(p => {
      const teeBox = teeBoxes.find(t => t.name === p.teeBox) || teeBoxes[0] || {};
      const par9 = 36; // standard 9-hole par placeholder
      const ch = calcCourseHandicap(p.handicapIndex || 0, teeBox.slope || 113, teeBox.rating || 36, par9);
      const nineHcp = calcNineHandicap(ch);

      let totalGross = 0;
      let totalNet = 0;
      let roundsPlayed = 0;
      const rounds = [];

      for (const wk of playoffWeeks) {
        const side = wk.side || 'front';
        const pars = side === 'front' ? frontPars : backPars;
        const parTotal = pars.reduce((a, b) => a + b, 0);

        let gross = 0;
        let hasScores = false;
        for (let h = 1; h <= 9; h++) {
          const key = `w${wk.week}_p${p.id}_h${h}`;
          const s = scores[key];
          if (s && s > 0) { gross += s; hasScores = true; }
        }

        if (hasScores) {
          const net = gross - nineHcp;
          totalGross += gross;
          totalNet += net;
          roundsPlayed++;
          rounds.push({ week: wk.week, date: wk.date, side, gross, net, parTotal, toPar: net - parTotal });
        }
      }

      // Find team for display
      const team = teams.find(t => t.player1 === p.id || t.player2 === p.id);

      return {
        playerId: p.id,
        name: p.name,
        teamName: team ? lastNamesOnly(team.name) : "",
        handicapIndex: p.handicapIndex || 0,
        nineHcp,
        totalGross,
        totalNet,
        roundsPlayed,
        rounds,
      };
    }).filter(p => p.roundsPlayed > 0 || playoffWeeks.length > 0);

    // Sort by total net (lowest first), then gross as tiebreaker
    board.sort((a, b) => {
      if (a.roundsPlayed === 0 && b.roundsPlayed === 0) return a.name.localeCompare(b.name);
      if (a.roundsPlayed === 0) return 1;
      if (b.roundsPlayed === 0) return -1;
      if (a.totalNet !== b.totalNet) return a.totalNet - b.totalNet;
      return a.totalGross - b.totalGross;
    });

    return board;
  }, [players, teams, course, playoffWeeks, scores]);

  if (loading && playoffWeeks.length > 0) {
    return <div style={{ textAlign: "center", padding: 40, color: K.t3, fontSize: 13 }} className="pu">Loading scores...</div>;
  }

  if (!playoffWeeks.length) {
    return <EmptyState icon="flag" title="No playoff rounds played yet" subtitle="The individual tournament runs alongside the playoff weeks." />;
  }

  const leaderName = leaderboard[0]?.roundsPlayed > 0 ? leaderboard[0].name.split(" ").pop() : null;

  return (
    <div style={{ padding: "0 2px" }}>
      {/* Header */}
      <div style={{ fontSize: 11, color: K.t3, marginBottom: 10, textAlign: "center" }}>
        Net stroke play · {playoffWeeks.length} round{playoffWeeks.length !== 1 ? "s" : ""} · All players
      </div>

      {/* Leaderboard */}
      <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
        {/* Column header */}
        <div style={{ display: "flex", padding: "0 14px", fontSize: 9, fontWeight: 700, color: K.logoBright, textTransform: "uppercase", letterSpacing: .8 }}>
          <div style={{ width: 28 }} />
          <div style={{ flex: 1 }}>Player</div>
          <div style={{ width: 36, textAlign: "center" }}>HCP</div>
          {playoffWeeks.map((wk, i) => (
            <div key={i} style={{ width: 36, textAlign: "center" }}>R{i + 1}</div>
          ))}
          <div style={{ width: 44, textAlign: "right" }}>Net</div>
        </div>

        {leaderboard.map((p, i) => {
          const mc = i === 0 ? K.gold : i === 1 ? K.silver : i === 2 ? K.bronze : K.logoBright;
          const hasRounds = p.roundsPlayed > 0;

          return (
            <div key={p.playerId} style={{
              display: "flex", alignItems: "center", background: K.card,
              borderRadius: CARD_RADIUS, border: `1px solid ${i === 0 && hasRounds ? K.act + "30" : K.bdr}`,
              padding: "10px 14px",
            }}>
              {/* Rank */}
              <div style={{ width: 28, flexShrink: 0 }}>
                {hasRounds && (
                  <div style={{
                    width: 22, height: 22, borderRadius: 6,
                    background: i < 3 ? mc + "20" : K.logoBright + "20",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 800, color: mc,
                    border: i < 3 ? `1.5px solid ${mc}40` : `1.5px solid ${K.logoBright}30`,
                  }}>{i + 1}</div>
                )}
              </div>

              {/* Name */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: K.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name.split(" ").pop()}
                </div>
              </div>

              {/* Handicap */}
              <div style={{ width: 36, textAlign: "center", fontSize: 11, color: K.t3 }}>{p.nineHcp}</div>

              {/* Round scores */}
              {playoffWeeks.map((wk, wi) => {
                const round = p.rounds.find(r => r.week === wk.week);
                return (
                  <div key={wi} style={{ width: 36, textAlign: "center", fontSize: 12, fontWeight: 600, color: round ? K.t1 : K.t3 + "40" }}>
                    {round ? round.net : "–"}
                  </div>
                );
              })}

              {/* Total net */}
              <div style={{ width: 44, textAlign: "right", fontSize: HERO_NUM_SIZE - 4, fontWeight: HERO_NUM_WEIGHT, color: hasRounds ? K.t1 : K.t3, fontFamily: "'League Spartan', sans-serif" }}>
                {hasRounds ? p.totalNet : "–"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════
//  MAIN STANDINGS VIEW
// ════════════════════════════════════════════════════════════
export default function StandingsView({ teams, players, matchResults, leagueConfig, schedule, fetchSeasonScores, course, fetchWeekScores }) {
  const isRecord = leagueConfig?.standingsMethod === "record";
  const tiebreaker = leagueConfig?.tiebreaker || "holesWon";
  const [expanded, setExpanded] = useState(null);
  const [expandedResult, setExpandedResult] = useState(null);
  const [weekScores, setWeekScores] = useState({});
  const expandedRef = useRef(null);

  // Determine if playoffs have started (any playoff week has matches)
  const playoffsStarted = useMemo(() =>
    schedule.some(wk => wk.isPlayoff === true && wk.matches?.length > 0 && !wk.rainedOut),
    [schedule]
  );

  const hasIndividualEvent = leagueConfig?.individualEvent !== false; // default on
  const [view, setView] = useState("standings"); // "standings" | "bracket" | "individual"

  const handleExpand = (teamId) => {
    const next = expanded === teamId ? null : teamId;
    setExpanded(next);
    setExpandedResult(null);
    if (next) {
      setTimeout(() => {
        expandedRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
    }
  };

  const toggleResultExpand = useCallback(async (teamId, week) => {
    const key = `${teamId}_${week}`;
    if (expandedResult === key) {
      setExpandedResult(null);
      return;
    }
    setExpandedResult(key);
    if (!weekScores[week] && fetchWeekScores) {
      const scores = await fetchWeekScores(week);
      setWeekScores(prev => ({ ...prev, [week]: scores }));
    }
  }, [expandedResult, weekScores, fetchWeekScores]);

  const lockedWeeks = useMemo(() => {
    const set = new Set();
    (schedule || []).forEach(wk => { if (wk.locked) set.add(wk.week); });
    return set;
  }, [schedule]);

  const lockedResults = useMemo(() => {
    return matchResults.filter(r => r && lockedWeeks.has(r.week));
  }, [matchResults, lockedWeeks]);

  const latestLockedWeek = useMemo(() => {
    let max = 0;
    lockedWeeks.forEach(w => { if (w > max) max = w; });
    return max;
  }, [lockedWeeks]);

  const standings = useMemo(() => {
    return buildStandings(teams, lockedResults, isRecord, tiebreaker);
  }, [teams, lockedResults, isRecord]);

  const prevStandings = useMemo(() => {
    if (latestLockedWeek === 0) return null;
    const prevResults = lockedResults.filter(r => r.week !== latestLockedWeek);
    if (prevResults.length === 0 && lockedResults.length > 0) return null;
    return buildStandings(teams, prevResults, isRecord, tiebreaker);
  }, [teams, lockedResults, latestLockedWeek, isRecord]);

  const prevPositionMap = useMemo(() => {
    if (!prevStandings) return {};
    const map = {};
    prevStandings.forEach((s, i) => { map[s.teamId] = i + 1; });
    return map;
  }, [prevStandings]);

  const getTeamResults = (teamId) => {
    const matchRows = lockedResults
      .filter(r => r.team1Id === teamId || r.team2Id === teamId)
      .map(r => {
        const isTeam1 = r.team1Id === teamId;
        const oppId = isTeam1 ? r.team2Id : r.team1Id;
        const opp = teams.find(t => t.id === oppId);
        const myPts = isTeam1 ? r.team1Points : r.team2Points;
        const oppPts = isTeam1 ? r.team2Points : r.team1Points;
        const wResult = myPts > oppPts ? "W" : myPts < oppPts ? "L" : "T";
        const wk = schedule.find(s => s.week === r.week);

        const holesWon = (r.t1HolesWon !== undefined && r.t2HolesWon !== undefined)
          ? (isTeam1 ? r.t1HolesWon : r.t2HolesWon)
          : 0;

        let resultDisplay = wResult;
        if (wResult === "T") {
          resultDisplay = "TIED";
        } else if (r.matchResultText) {
          resultDisplay = `${wResult} ${r.matchResultText}`;
        } else {
          resultDisplay = `${wResult} ${myPts}-${oppPts}`;
        }

        return { week: r.week, date: wk?.date || "", oppName: lastNamesOnly(opp?.name || "TBD"), myPts, oppPts, result: wResult, holesWon, resultDisplay, matchResult: r, rainedOut: false };
      });

    const rainRows = schedule
      .filter(wk => wk.rainedOut && wk.week > 0)
      .map(wk => ({
        week: wk.week, date: wk.date || "", oppName: "", myPts: 0, oppPts: 0,
        result: "R", holesWon: "", resultDisplay: "RAIN", matchResult: null, rainedOut: true,
      }));

    return [...matchRows, ...rainRows].sort((a, b) => a.week - b.week);
  };

  // ── Mini scorecard renderer ──
  const renderMiniScorecard = (teamId, r) => {
    if (!course || !r.matchResult) return null;
    const mr = r.matchResult;
    const wk = schedule.find(s => s.week === mr.week);
    const side = wk?.side || getWeekSide(mr.week);
    const pars = side === 'front' ? course.frontPars : course.backPars;
    const hcps = side === 'front' ? course.frontHcps : course.backHcps;
    const wkScores = weekScores[mr.week];
    if (!wkScores) return <div style={{ padding: 8, textAlign: "center", color: K.t3, fontSize: 11 }} className="pu">Loading...</div>;

    const myTeam = teams.find(t => t.id === teamId);
    const oppTeamId = mr.team1Id === teamId ? mr.team2Id : mr.team1Id;
    const oppTeam = teams.find(t => t.id === oppTeamId);
    const myPids = myTeam ? [myTeam.player1, myTeam.player2].filter(Boolean) : [];
    const oppPids = oppTeam ? [oppTeam.player1, oppTeam.player2].filter(Boolean) : [];
    const isT1 = mr.team1Id === teamId;
    const topPids = isT1 ? myPids : oppPids;
    const botPids = isT1 ? oppPids : myPids;
    const topIsT1 = isT1;

    const PlayerRow = ({ pid }) => {
      const pl = players.find(p => p.id === pid);
      const shortName = pl ? pl.name.split(" ").pop() : "?";
      return (
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ width: 32, flexShrink: 0, fontSize: 9, color: K.t3, paddingLeft: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortName}</div>
          {Array.from({ length: 9 }, (_, i) => {
            const hole = i + 1;
            const key = `w${mr.week}_p${pid}_h${hole}`;
            const s = wkScores[key];
            return <div key={i} style={{ flex: 1, display: "flex", justifyContent: "center" }}><MiniScoreCell score={s} par={pars[i]} /></div>;
          })}
        </div>
      );
    };

    const TeamRow = ({ pids, isTop }) => {
      const totals = Array.from({ length: 9 }, (_, i) => {
        const hole = i + 1;
        let sum = 0; let valid = false;
        pids.forEach(pid => { const s = wkScores[`w${mr.week}_p${pid}_h${hole}`]; if (s > 0) { sum += s; valid = true; } });
        return valid ? sum : null;
      });
      return (
        <div style={{ display: "flex", alignItems: "center", background: K.acc + "10" }}>
          <div style={{ width: 32, flexShrink: 0, fontSize: 8, color: K.acc, fontWeight: 800, paddingLeft: 3 }}>TEAM</div>
          {totals.map((t, i) => (
            <div key={i} style={{ flex: 1, display: "flex", justifyContent: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: t !== null ? K.t1 : K.t3 + "30" }}>{t !== null ? t : "·"}</span>
            </div>
          ))}
        </div>
      );
    };

    return (
      <div style={{ margin: "4px 0 2px", borderRadius: 6, overflow: "hidden", border: `1px solid ${K.bdr}30`, paddingBottom: 2 }}>
        <div style={{ display: "flex", background: K.acc }}>
          <div style={{ width: 32, flexShrink: 0, fontSize: 7, color: K.bg, fontWeight: 800, paddingLeft: 3, opacity: .8, display: "flex", alignItems: "center", height: 20 }}>HOLE</div>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: K.bg, fontWeight: 800, lineHeight: "20px" }}>{side === 'front' ? i + 1 : i + 10}</div>
          ))}
        </div>
        {topPids.map(pid => <PlayerRow key={pid} pid={pid} />)}
        <TeamRow pids={topPids} isTop={true} />
        <div style={{ height: 1, background: K.bdr + "40" }} />
        {botPids.map(pid => <PlayerRow key={pid} pid={pid} />)}
        <TeamRow pids={botPids} isTop={false} />
      </div>
    );
  };

  const gt = (id) => teams.find(t => t.id === id);
  if (!teams.length) return <EmptyState icon="trophy" title="No teams yet" subtitle="Commissioner needs to set up teams." />;

  const wltCol = { width: 22, textAlign: "center", fontFamily: "'League Spartan', sans-serif" };
  const wltDash = { width: 8, textAlign: "center", color: K.t3 };

  // ── Toggle pills (only show once playoffs have started) ──
  const tabs = [
    { id: "standings", label: "Standings" },
    ...(playoffsStarted ? [{ id: "bracket", label: "Playoff Bracket" }] : []),
    ...(playoffsStarted && hasIndividualEvent ? [{ id: "individual", label: "Individual Event" }] : []),
  ];

  return (
    <div style={{ padding: "0 2px" }}>
      {/* Toggle pills */}
      {tabs.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <div style={{ display: "inline-flex", background: K.inp, borderRadius: 8, border: `1px solid ${K.bdr}`, padding: 3 }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setView(t.id)} style={{
                padding: "7px 14px", borderRadius: 6, border: "none", cursor: "pointer",
                background: view === t.id ? K.card : "transparent",
                color: view === t.id ? K.t1 : K.t3,
                fontSize: 11, fontWeight: 700, letterSpacing: .8,
                boxShadow: view === t.id ? `0 1px 3px ${K.bdr}40` : "none",
                transition: "all .15s",
              }}>{t.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Playoff Bracket view */}
      {view === "bracket" && (
        <PlayoffBracketView teams={teams} schedule={schedule} matchResults={matchResults} leagueConfig={leagueConfig} />
      )}

      {/* Individual Event view */}
      {view === "individual" && (
        <IndividualEventView players={players} teams={teams} schedule={schedule} course={course} leagueConfig={leagueConfig} fetchWeekScores={fetchWeekScores} />
      )}

      {/* Regular standings */}
      {view === "standings" && (
        <div className="standings-grid" style={{ gap: LIST_GAP }}>
          {standings.map((s, i) => {
            const team = gt(s.teamId); if (!team) return null;
            const mc = i === 0 ? K.gold : i === 1 ? K.silver : i === 2 ? K.bronze : K.logoBright;
            const isExp = expanded === s.teamId;
            const results = isExp ? getTeamResults(s.teamId) : [];
            const curPos = i + 1;
            const prevPos = prevPositionMap[s.teamId];
            const posChange = (prevPos && latestLockedWeek > 0) ? prevPos - curPos : null;

            return (
              <div key={s.teamId}>
                <button onClick={() => handleExpand(s.teamId)} style={{
                  display: "flex", alignItems: "center", width: "100%", color: K.t1,
                  background: K.card, borderRadius: isExp ? `${CARD_RADIUS}px ${CARD_RADIUS}px 0 0` : CARD_RADIUS,
                  border: `1px solid ${i === 0 ? K.act + '30' : K.bdr}`,
                  borderBottom: isExp ? "none" : `1px solid ${i === 0 ? K.act + '30' : K.bdr}`,
                  padding: "10px 14px", cursor: "pointer",
                }}>
                  <div style={{ width: 40, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                    <div style={{
                      width: RANK_BADGE_SIZE, height: RANK_BADGE_SIZE, borderRadius: RANK_BADGE_RADIUS,
                      background: i < 3 ? mc + "20" : K.logoBright + "20",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: RANK_BADGE_FONT, fontWeight: 800, color: mc,
                      border: i < 3 ? `1.5px solid ${mc}40` : `1.5px solid ${K.logoBright}30`,
                    }}>{curPos}</div>
                    {posChange !== null && posChange !== 0 ? (
                      <div style={{ fontSize: 10, fontWeight: 700, color: posChange > 0 ? K.matchGrn : K.red, display: "flex", alignItems: "baseline", gap: 1, marginLeft: 3, minWidth: 16, lineHeight: 1 }}>
                        <span style={{ fontSize: 7, lineHeight: 1 }}>{posChange > 0 ? "▲" : "▼"}</span>
                        <span style={{ lineHeight: 1 }}>{Math.abs(posChange)}</span>
                      </div>
                    ) : (
                      <div style={{ minWidth: 16, marginLeft: 3 }} />
                    )}
                  </div>
                  <div style={{ flex: 1, fontSize: NAME_SIZE, fontWeight: NAME_WEIGHT, letterSpacing: .5, textAlign: "left" }}>{lastNamesOnly(team.name)}</div>
                  <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0 }}>
                    {isRecord ? (<>
                      <div style={{ ...wltCol, fontSize: NAME_SIZE, fontWeight: 800, color: K.t1 }}>{s.w}</div>
                      <div style={{ ...wltDash, fontSize: NAME_SIZE, fontWeight: 800 }}>-</div>
                      <div style={{ ...wltCol, fontSize: NAME_SIZE, fontWeight: 800, color: K.t1 }}>{s.l}</div>
                      <div style={{ ...wltDash, fontSize: NAME_SIZE, fontWeight: 800 }}>-</div>
                      <div style={{ ...wltCol, fontSize: NAME_SIZE, fontWeight: 800, color: K.t1 }}>{s.t}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#3b82f6", minWidth: 26, textAlign: "right", marginLeft: 6 }}>{s.hw}</div>
                    </>) : (<>
                      <div style={{ ...wltCol, fontSize: 11, fontWeight: 500, color: K.t3 }}>{s.w}</div>
                      <div style={{ ...wltDash, fontSize: 11, color: K.t3 }}>-</div>
                      <div style={{ ...wltCol, fontSize: 11, fontWeight: 500, color: K.t3 }}>{s.l}</div>
                      <div style={{ ...wltDash, fontSize: 11, color: K.t3 }}>-</div>
                      <div style={{ ...wltCol, fontSize: 11, fontWeight: 500, color: K.t3 }}>{s.t}</div>
                      <div style={{ fontSize: HERO_NUM_SIZE, fontWeight: HERO_NUM_WEIGHT, color: K.t1, fontFamily: "'League Spartan', sans-serif", minWidth: 30, textAlign: "right", marginLeft: 6 }}>{s.points}</div>
                    </>)}
                  </div>
                  <div style={{ width: 20, flexShrink: 0, textAlign: "right", color: K.t3, fontSize: CHEVRON_SIZE, marginLeft: 6 }}>{isExp ? "▾" : "›"}</div>
                </button>

                {isExp && (
                  <div ref={expandedRef} style={{ background: K.inp, border: `1px solid ${i === 0 ? K.act + '30' : K.bdr}`, borderTop: "none", borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`, padding: "8px 10px" }}>
                    <div style={{ display: "flex", padding: "5px 8px", fontSize: 9, color: K.logoBright, fontWeight: 700, textTransform: "uppercase", letterSpacing: .8 }}>
                      <div style={{ width: 14, flexShrink: 0 }} />
                      <div style={{ width: 24, flexShrink: 0 }}>Wk</div>
                      <div style={{ width: 48, flexShrink: 0 }}>Date</div>
                      <div style={{ flex: 1 }}>Opponent</div>
                      <div style={{ width: 58, flexShrink: 0, textAlign: "right" }}>Result</div>
                      <div style={{ width: 28, flexShrink: 0, textAlign: "right" }}>HW</div>
                    </div>
                    {results.length === 0 ? (
                      <div style={{ padding: "10px 8px", fontSize: 12, color: K.t3, fontStyle: "italic" }}>No matches played yet</div>
                    ) : results.map((r, ri) => {
                      if (r.rainedOut) {
                        return (
                          <div key={ri} style={{ display: "flex", alignItems: "center", padding: "7px 8px", borderTop: `1px solid ${K.bdr}30`, fontSize: 12, opacity: 0.5 }}>
                            <div style={{ width: 14, flexShrink: 0 }} />
                            <div style={{ width: 24, flexShrink: 0, color: K.t3, fontSize: 11 }}>{r.week}</div>
                            <div style={{ width: 48, flexShrink: 0, color: K.t3, fontSize: 11 }}>{r.date || "—"}</div>
                            <div style={{ flex: 1, color: K.warn, fontWeight: 600 }}>RAIN OUT</div>
                            <div style={{ width: 58, flexShrink: 0 }} />
                            <div style={{ width: 28, flexShrink: 0 }} />
                          </div>
                        );
                      }
                      const resKey = `${s.teamId}_${r.week}`;
                      const isResExp = expandedResult === resKey;
                      return (
                        <div key={ri}>
                          <button onClick={() => toggleResultExpand(s.teamId, r.week)} style={{ display: "flex", alignItems: "center", padding: "7px 8px", fontSize: 12, width: "100%", background: "transparent", border: "none", borderTop: `1px solid ${K.bdr}30`, cursor: "pointer", textAlign: "left" }}>
                            <div style={{ width: 14, flexShrink: 0, color: K.t3, fontSize: 9 }}>{isResExp ? "▾" : "›"}</div>
                            <div style={{ width: 24, flexShrink: 0, color: K.t3, fontSize: 11 }}>{r.week}</div>
                            <div style={{ width: 48, flexShrink: 0, color: K.t3, fontSize: 11 }}>{r.date || "—"}</div>
                            <div style={{ flex: 1, color: K.t2, fontWeight: 500 }}>{r.oppName}</div>
                            <div style={{ width: 58, flexShrink: 0, textAlign: "right", fontWeight: 700, fontSize: 11, color: r.result === "W" ? K.matchGrn : r.result === "L" ? K.red : K.t2 }}>{r.resultDisplay}</div>
                            <div style={{ width: 28, flexShrink: 0, textAlign: "right", color: "#3b82f6", fontWeight: 700 }}>{r.holesWon}</div>
                          </button>
                          {isResExp && (
                            <div style={{ padding: "2px 4px 10px" }}>
                              {renderMiniScorecard(s.teamId, r)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
