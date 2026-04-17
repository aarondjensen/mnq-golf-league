import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { K, Pill, EmptyState, lastNamesOnly, getWeekSide, LIST_GAP, CARD_RADIUS, NAME_SIZE, NAME_WEIGHT, HERO_NUM_SIZE, HERO_NUM_WEIGHT, RANK_BADGE_SIZE, RANK_BADGE_RADIUS, RANK_BADGE_FONT, CHEVRON_SIZE, calcCourseHandicap, calcNineHandicap, calcPlayerHcp, buildSeedMap } from "../theme";
import { SharedScorecard } from "./Scoring";

// Build standings from a set of match results.
// Tiebreaker is always total holes won (the headToHead option was removed because it was
// never implemented — the dropdown existed in Admin but the sort logic did nothing with it).
function buildStandings(teams, results, isRecord) {
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
  if (isRecord) {
    arr.sort((a, b) => {
      const aPct = a.gamesPlayed ? (a.w + a.t * 0.5) / a.gamesPlayed : 0;
      const bPct = b.gamesPlayed ? (b.w + b.t * 0.5) / b.gamesPlayed : 0;
      if (bPct !== aPct) return bPct - aPct;
      if (b.w !== a.w) return b.w - a.w;
      if (a.l !== b.l) return a.l - b.l;
      return b.hw - a.hw;
    });
  } else {
    arr.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return b.hw - a.hw;
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
  // Use shared buildSeedMap so bracket seed badges match Schedule / Scoring / Admin.
  // Prior implementation built its own seed map from raw points, ignoring locked status
  // and standingsMethod, so bracket seeds could disagree with everywhere else in the app.
  const seedMap = useMemo(
    () => buildSeedMap(teams, matchResults, schedule, leagueConfig),
    [teams, matchResults, schedule, leagueConfig]
  );

  const gn = (id) => lastNamesOnly(teams.find(t => t.id === id)?.name || "TBD");
  const getSeed = (id) => seedMap[id] || "?";

  if (!playoffRounds.length) {
    return <EmptyState icon="trophy" title="No playoff bracket configured" subtitle="Commissioner can set up playoff rounds in Admin → Schedule → Edit Setup." />;
  }

  // Build bracket data: for each round, separate bracket matches (those configured in
  // playoffRounds.matchups) from consolation matches (pairings appended at seed-time for
  // teams not in the bracket). Week's matches array is built with bracket first, then
  // consolation — so we split by the config count.
  const bracketData = playoffRounds.map((round, ri) => {
    const roundWeek = playoffWeeks[ri];
    const allMatches = roundWeek?.matches || [];
    const bracketSize = (round.matchups || []).length;
    const bracketMatches = allMatches.slice(0, bracketSize);
    const consolationMatches = allMatches.slice(bracketSize);
    const results = roundWeek ? matchResults.filter(r => r.week === roundWeek.week) : [];
    const isLocked = roundWeek?.locked === true;

    const toMatchup = (m) => {
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
    };

    return {
      name: round.name || `Round ${ri + 1}`,
      weekNum: roundWeek?.week,
      date: roundWeek?.date,
      isLocked,
      matchups: bracketMatches.map(toMatchup),
      consolationMatchups: consolationMatches.map(toMatchup),
      // For unfilled rounds, show config labels (bracket only — consolation has no config)
      config: round.matchups || [],
    };
  });

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
  const MatchupCard = ({ mu, showConfig, configMu, isConsolation }) => {
    // Badge styling — bracket seeds get the prominent maize+navy treatment to highlight
    // progression through the bracket. Non-playoff (consolation) matches use the original
    // muted light-blue so they visually recede from the bracket they accompany.
    const badgeStyle = isConsolation
      ? { background: K.logoBright + "20", border: `1px solid ${K.logoBright}30`, color: K.logoBright }
      : { background: K.act, border: `1px solid ${K.act}`, color: K.logoBlue };
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
            ...badgeStyle,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, fontWeight: 800,
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
            ...badgeStyle,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, fontWeight: 800,
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
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {bracketData.map((round, ri) => {
        const matchCount = Math.max(round.matchups.length, round.config.length, 1);
        return (
          <div key={ri}>
            {/* Round header — full-width strip with name, week info, status */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              marginBottom: 8, paddingBottom: 6,
              borderBottom: `1px solid ${K.bdr}`,
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: K.warn, letterSpacing: 1, textTransform: "uppercase" }}>
                {round.name}
              </span>
              {round.weekNum && (
                <span style={{ fontSize: 10, color: K.t3 }}>
                  Wk {round.weekNum}{round.date ? ` · ${round.date}` : ""}
                </span>
              )}
              {round.isLocked && (
                <span style={{ marginLeft: "auto" }}>
                  <Pill color={K.grn} style={{ fontSize: 7 }}>FINAL</Pill>
                </span>
              )}
            </div>

            {/* Matchups — full-width stacked cards, no converging geometry */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Array.from({ length: matchCount }, (_, mi) => {
                const mu = round.matchups[mi];
                const configMu = round.config[mi];
                return <MatchupCard key={mi} mu={mu} showConfig={!mu} configMu={configMu} />;
              })}
            </div>

            {/* Consolation matchups — teams not in the bracket this round. These are
                pairings chosen by pairNonBracketTeams at seed-time to minimize repeat
                meetings across the full season. They don't progress the bracket, so
                they're visually separated with a dashed divider + subtitle. */}
            {round.consolationMatchups.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${K.bdr}` }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: K.t3,
                  letterSpacing: 1.2, textTransform: "uppercase",
                  marginBottom: 8,
                  display: "flex", alignItems: "baseline", gap: 8,
                }}>
                  <span>Non-Playoff Matches</span>
                  <span style={{ fontSize: 9, fontWeight: 400, color: K.t3, letterSpacing: 0, textTransform: "none" }}>
                    Tee times for teams not in the bracket
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {round.consolationMatchups.map((mu, mi) => (
                    <MatchupCard key={mi} mu={mu} isConsolation />
                  ))}
                </div>
              </div>
            )}

            {/* Progression indicator between rounds */}
            {ri < bracketData.length - 1 && (
              <div style={{
                textAlign: "center", padding: "8px 0 2px",
                color: K.t3 + "80", fontSize: 14, lineHeight: 1,
              }}>↓</div>
            )}
          </div>
        );
      })}

      {/* Champion block */}
      {(() => {
        const lastRound = bracketData[bracketData.length - 1];
        const finalMatch = lastRound?.matchups[0];
        const champion = finalMatch?.t1Won ? finalMatch.team1 : finalMatch?.t2Won ? finalMatch.team2 : null;
        return (
          <div style={{
            marginTop: 4,
            background: champion ? K.gold + "15" : K.card,
            border: `2px solid ${champion ? K.gold + "50" : K.bdr}`,
            borderRadius: 12, padding: "16px 14px", textAlign: "center",
          }}>
            <div style={{ fontSize: 28, marginBottom: 4, lineHeight: 1 }}>🏆</div>
            {champion ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 800, color: K.gold }}>{gn(champion)}</div>
                <div style={{ fontSize: 10, color: K.t3, marginTop: 4, letterSpacing: 1.5, fontWeight: 600 }}>
                  #{getSeed(champion)} SEED · CHAMPION
                </div>
              </>
            ) : (
              <div style={{ fontSize: 10, color: K.t3, letterSpacing: 1.5, fontWeight: 600 }}>CHAMPION TBD</div>
            )}
          </div>
        );
      })()}
    </div>
  );
}


// ════════════════════════════════════════════════════════════
//  INDIVIDUAL TOURNAMENT VIEW
// ════════════════════════════════════════════════════════════
function IndividualEventView({ players, teams, schedule, course, leagueConfig, fetchWeekScores, fetchAllScores, scoringRules }) {
  const [scores, setScores] = useState({});
  const [allRounds, setAllRounds] = useState(null); // { playerId: [{ season, week, gross }] }
  const [loading, setLoading] = useState(true);
  const fetched = useRef(false);

  // Find playoff weeks
  const playoffWeeks = useMemo(() =>
    schedule.filter(wk => wk.isPlayoff === true && !wk.rainedOut && wk.matches?.length > 0)
      .sort((a, b) => a.week - b.week),
    [schedule]
  );

  // Short name formatter for leaderboard display: "Aaron Jensen" -> "A. Jensen".
  // Single-name players (rare) render as-is.
  const shortName = (fullName) => {
    if (!fullName) return "";
    const parts = fullName.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : fullName;
  };

  // Fetch scores for all playoff weeks AND the full rounds history needed for
  // per-week handicap snapshots.
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
      // fetchAllScores is optional for graceful fallback; if absent, we fall back to
      // player.handicapIndex for all rounds (the old, slightly-wrong behavior).
      if (fetchAllScores) {
        const hist = await fetchAllScores();
        setAllRounds(hist);
      }
      setLoading(false);
    })();
  }, [playoffWeeks, fetchWeekScores, fetchAllScores]);

  // Build leaderboard: each player's net total across playoff rounds.
  // KEY DIFFERENCE from prior implementation: handicap is NOT a single value per player.
  // It's computed per-round from the rounds the player had played BEFORE that round.
  // The player's p.handicapIndex is always the current (latest) handicap — but using it
  // retroactively for Round 1 gives the wrong net, because by Round 3 the player's index
  // reflects Rounds 1 and 2's results.
  const leaderboard = useMemo(() => {
    if (!course || !players.length) return [];

    const teeBoxes = course.teeBoxes || [];
    const frontPars = course.frontPars || [];
    const backPars = course.backPars || [];
    const frontPar = frontPars.reduce((a, b) => a + b, 0);
    const recentN = scoringRules?.hcpRecentCount ?? 8;
    const bestN = scoringRules?.hcpBestCount ?? 6;

    // Helper: compute a player's 9-hole handicap as of right before a given (season, week),
    // using only rounds played strictly before that point in the history.
    //
    // This must match how App.jsx:recalcHandicaps produces p.handicapIndex — that's the
    // single source of truth everywhere else in the app (Players tab, match-play net
    // scoring, etc.). Specifically:
    //   par passed to calcPlayerHcp = FRONT-9 par (36), not full-18 par
    //   the returned value IS the 9-hole handicap — no calcCourseHandicap / calcNineHandicap
    //   transforms needed because all the rounds in allScores are 9-hole rounds already.
    const handicapBeforeWeek = (p, asOfSeason, asOfWeek) => {
      const priorRounds = ((allRounds && allRounds[p.id]) || []).filter(r =>
        r.season < asOfSeason || (r.season === asOfSeason && r.week < asOfWeek)
      );
      const idx = calcPlayerHcp(priorRounds, recentN, bestN, frontPar);
      // Not enough history → fall back to the player's currently-stored handicap.
      return idx ?? (p.handicapIndex ?? 0);
    };

    const board = players.map(p => {
      let totalGross = 0;
      let totalNet = 0;
      let roundsPlayed = 0;
      const rounds = [];

      // Starting handicap — what the player had going into Round 1. Shown as a tournament
      // reference in the HCP column so it's stable across the whole tournament view and
      // doesn't shift every week as scores come in.
      const firstWk = playoffWeeks[0];
      const season = leagueConfig?.year || new Date().getFullYear();
      const startHcp = handicapBeforeWeek(p, season, firstWk.week);

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
          // Per-round handicap — computed from history BEFORE this week, so it matches
          // what the player was actually playing off of when they teed up that round.
          const roundHcp = handicapBeforeWeek(p, season, wk.week);
          const net = gross - roundHcp;
          totalGross += gross;
          totalNet += net;
          roundsPlayed++;
          rounds.push({ week: wk.week, date: wk.date, side, gross, net, nineHcp: roundHcp, parTotal, toPar: net - parTotal });
        }
      }

      // Find team for display
      const team = teams.find(t => t.player1 === p.id || t.player2 === p.id);

      return {
        playerId: p.id,
        name: p.name,
        displayName: shortName(p.name),
        teamName: team ? lastNamesOnly(team.name) : "",
        startNineHcp: startHcp,
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
  }, [players, teams, course, playoffWeeks, scores, allRounds, scoringRules, leagueConfig]);

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
                  {p.displayName}
                </div>
              </div>

              {/* Handicap — shown as the player's starting handicap (what they had going
                  into Round 1). Per-round handicaps are reflected in each R# column's net
                  score, but showing a single stable number keeps the leaderboard readable. */}
              <div style={{ width: 36, textAlign: "center", fontSize: 11, color: K.t3 }}>{p.startNineHcp}</div>

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
export default function StandingsView({ teams, players, matchResults, leagueConfig, schedule, fetchSeasonScores, course, fetchWeekScores, scoringRules, fetchAllScores }) {
  const isRecord = leagueConfig?.standingsMethod === "record";
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
    return buildStandings(teams, lockedResults, isRecord);
  }, [teams, lockedResults, isRecord]);

  const prevStandings = useMemo(() => {
    if (latestLockedWeek === 0) return null;
    const prevResults = lockedResults.filter(r => r.week !== latestLockedWeek);
    if (prevResults.length === 0 && lockedResults.length > 0) return null;
    return buildStandings(teams, prevResults, isRecord);
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

    const myTeamObj = teams.find(t => t.id === teamId);
    const oppTeamId = mr.team1Id === teamId ? mr.team2Id : mr.team1Id;
    const oppTeamObj = teams.find(t => t.id === oppTeamId);
    const t1Pids = [teams.find(t => t.id === mr.team1Id)?.player1, teams.find(t => t.id === mr.team1Id)?.player2].filter(Boolean);
    const t2Pids = [teams.find(t => t.id === mr.team2Id)?.player1, teams.find(t => t.id === mr.team2Id)?.player2].filter(Boolean);

    const getScore = (pid, h) => wkScores[`w${mr.week}_p${pid}_h${h}`] || 0;
    const sorted = hcps.map((h, i) => ({ idx: i, hcp: h })).sort((a, b) => a.hcp - b.hcp);
    const getStrokesMap = (nh) => {
      const mp = {}; let rem = Math.abs(nh);
      for (const h of sorted) { if (rem <= 0) break; mp[h.idx] = (mp[h.idx] || 0) + 1; rem--; }
      for (const h of sorted) { if (rem <= 0) break; mp[h.idx] = (mp[h.idx] || 0) + 1; rem--; }
      return mp;
    };
    const getHcp = (pid) => { const p = players.find(pl => pl.id === pid); return p ? Math.round(p.handicapIndex || 0) : 0; };
    const getStrokes = (pid, h) => getStrokesMap(getHcp(pid))[h] || 0;
    const getInitials = (pid) => { const p = players.find(pl => pl.id === pid); return p ? p.name.split(' ').map(n => n[0]).join('') : "?"; };
    const isAbsent = (pid) => wkScores[`w${mr.week}_p${pid}_habsent`] === 1;

    // Compute hole results + running status
    const holeResults = [];
    for (let h = 0; h < 9; h++) {
      let n1 = 0, n2 = 0;
      t1Pids.forEach(pid => { n1 += getScore(pid, h) - getStrokes(pid, h); });
      t2Pids.forEach(pid => { n2 += getScore(pid, h) - getStrokes(pid, h); });
      holeResults.push(n1 < n2 ? 1 : n2 < n1 ? -1 : 0);
    }
    const runningStatus = []; let cum = 0;
    holeResults.forEach(r2 => { cum += r2; runningStatus.push(cum); });
    let clinchHole = null, clinchText = null;
    for (let h = 0; h < 9; h++) {
      const lead = Math.abs(runningStatus[h]); const rem = 8 - h;
      if (lead > rem) { clinchHole = h; clinchText = rem > 0 ? `${lead}&${rem}` : `${lead}UP`; break; }
    }

    // Swap so selected team is on top
    const isT1 = mr.team1Id === teamId;
    const dispT1Pids = isT1 ? t1Pids : t2Pids;
    const dispT2Pids = isT1 ? t2Pids : t1Pids;
    const dispHR = !isT1 ? holeResults.map(x => -x) : holeResults;
    const dispRS = !isT1 ? runningStatus.map(x => -x) : runningStatus;

    const sc = SharedScorecard({
      pars, side, hcps, team1Pids: dispT1Pids, team2Pids: dispT2Pids,
      getScore, getStrokes, getHcp, getInitials, isAbsent,
      holeResults: dispHR, runningStatus: dispRS,
      clinchHole, clinchText,
      variant: "allMatches", showTotals: true, matchGrn: K.matchGrn,
    });

    return (
      <div style={{ margin: "4px 0 2px" }}>
        <sc.HoleRow />
        <sc.ParRow />
        {dispT1Pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
        <sc.TeamNetRow pids={dispT1Pids} isTeam1Side={true} />
        <sc.MatchRow />
        {dispT2Pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
        <sc.TeamNetRow pids={dispT2Pids} isTeam1Side={false} />
      </div>
    );
  };

  const gt = (id) => teams.find(t => t.id === id);
  if (!teams.length) return <EmptyState icon="trophy" title="No teams yet" subtitle="Commissioner needs to set up teams." />;

  const wltCol = { width: 22, textAlign: "center", fontFamily: "'League Spartan', sans-serif" };
  const wltDash = { width: 8, textAlign: "center", color: K.t3 };

  // ── Toggle pills — always visible regardless of season phase ──
  // Season: current standings (always meaningful).
  // Playoffs: bracket view. During regular season this renders as a preview with seed
  //   placeholders (#1, #2, ...); once playoff weeks populate, real team names appear.
  // Individual: only meaningful during the individual tournament; shows a "starts Week X"
  //   placeholder beforehand. Omitted entirely if the league doesn't run an individual event.
  const tabs = [
    { id: "standings", label: "Season" },
    { id: "bracket", label: "Playoffs" },
    ...(hasIndividualEvent ? [{ id: "individual", label: "Individual" }] : []),
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

      {/* Individual Event view — during regular season shows a "starts Week N" placeholder,
          during playoffs shows the live leaderboard. Keeps the toggle itself consistent
          regardless of season phase. */}
      {view === "individual" && (
        playoffsStarted ? (
          <IndividualEventView players={players} teams={teams} schedule={schedule} course={course} leagueConfig={leagueConfig} fetchWeekScores={fetchWeekScores} fetchAllScores={fetchAllScores} scoringRules={scoringRules} />
        ) : (() => {
          // Find the first playoff week — that's when the individual tournament kicks off.
          const firstPlayoff = schedule.filter(wk => wk.isPlayoff === true && !wk.rainedOut).sort((a, b) => a.week - b.week)[0];
          if (!firstPlayoff) {
            return <EmptyState icon="trophy" title="No individual tournament configured" subtitle="Commissioner can enable it in Admin → Schedule." />;
          }
          const when = firstPlayoff.date ? `Week ${firstPlayoff.week} (${firstPlayoff.date})` : `Week ${firstPlayoff.week}`;
          return <EmptyState icon="trophy" title="Individual Tournament" subtitle={`Starts ${when}`} />;
        })()
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
                            <div style={{ width: 58, flexShrink: 0, display: "flex", justifyContent: "flex-end", alignItems: "center", fontWeight: 700, fontSize: 11, color: r.result === "W" ? K.matchGrn : r.result === "L" ? K.red : K.t2 }}>
                              {r.result === "T" || r.rainedOut ? (
                                <span>{r.resultDisplay}</span>
                              ) : (
                                <>
                                  <span style={{ width: 14, textAlign: "right" }}>{r.result}</span>
                                  <span style={{ width: 34, textAlign: "right" }}>{r.matchResult?.matchResultText || `${r.myPts}-${r.oppPts}`}</span>
                                </>
                              )}
                            </div>
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
