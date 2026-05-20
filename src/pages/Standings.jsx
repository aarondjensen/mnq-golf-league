import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { K, Pill, EmptyState, lastNamesOnly, getWeekSide, LIST_GAP, CARD_RADIUS, NAME_SIZE, NAME_WEIGHT, HERO_NUM_SIZE, HERO_NUM_WEIGHT, RANK_BADGE_SIZE, RANK_BADGE_RADIUS, RANK_BADGE_FONT, calcPlayerHcp, buildSeedMap, buildStandingsForSeed, LoadingPanel, SkeletonList, getPlayerHcpAtWeek } from "../theme";
import { SharedScorecard } from "../components/SharedScorecard";
import { readScoreEffective, getStrokesForHole, resultLetterFor } from "../lib/matchCalc";
import { isScheduleDateAtOrPast } from "../lib/scheduleDate";
import { autoHealMatchResults } from "../lib/autoHealMatchResults";
import { TeamMatchupCard } from "../TeamMatchupCard";

// Standings calculation lives in theme.jsx as buildStandingsForSeed — see
// imports above. Standings.jsx used to have a local copy of nearly the same
// logic with subtly different semantics (slightly different tiebreaker
// chain, different field name for games-played). The audit found the two
// copies were drifting. Consolidating to one canonical implementation
// means a future tweak — say, changing the record-mode tiebreaker chain
// or adding a points-mode head-to-head fallback — is a single-place edit
// instead of "remember to update both". Local callers below pass
// `lockedOnly: false` to retain the prior caller-pre-filters semantics.


// ════════════════════════════════════════════════════════════
//  PLAYOFF BRACKET VIEW
// ════════════════════════════════════════════════════════════
function PlayoffBracketView({ teams, players, schedule, matchResults, leagueConfig }) {
  const playoffRounds = leagueConfig?.playoffRounds || [];
  const playoffWeeks = schedule.filter(wk => wk.isPlayoff === true && !wk.rainedOut).sort((a, b) => a.week - b.week);
  // "bracket" shows every round stacked (the prior default behavior).
  // A numeric index (0-based) shows just that single round with its consolation block —
  // useful during a playoff week when people just want to check this round's matchups
  // and scores without scrolling past earlier rounds.
  const [view, setView] = useState("bracket");
  // Ref to the horizontal scroll container. Used so the clickable round-column
  // headers INSIDE the bracket can scroll their column to the left edge — helpful
  // for multi-round brackets that don't fit on one screen.
  const bracketScrollRef = useRef(null);
  // Use shared buildSeedMap so bracket seed badges match Schedule / Scoring / Admin.
  // Prior implementation built its own seed map from raw points, ignoring locked status
  // and standingsMethod, so bracket seeds could disagree with everywhere else in the app.
  const seedMap = useMemo(
    () => buildSeedMap(teams, matchResults, schedule, leagueConfig),
    [teams, matchResults, schedule, leagueConfig]
  );

  const gn = (id) => lastNamesOnly(teams.find(t => t.id === id)?.name || "TBD");

  // Return an array of per-player last names (["JENSEN", "OLSON"]) for a team.
  // Used so the matchup card can stack teammate names on separate rows instead
  // of joining them into one "JENSEN / OLSON" string — matches the Scoring
  // All Matches card format.
  const playerLastNames = (teamId) => {
    const t = teams.find(tm => tm.id === teamId);
    if (!t) return ["TBD", ""];
    const lookup = (pid) => {
      if (!pid) return "";
      const p = players?.find(pl => pl.id === pid);
      if (!p?.name) return "";
      const parts = p.name.trim().split(/\s+/);
      return parts[parts.length - 1].toUpperCase();
    };
    return [lookup(t.player1), lookup(t.player2)];
  };
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
        players1: playerLastNames(m.team1), players2: playerLastNames(m.team2),
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

  // ═════════════════════════════════════════════════════════════════
  //  MatchupCard — thin wrapper around TeamMatchupCard
  // ═════════════════════════════════════════════════════════════════
  // Was a 140-line inline component with its own three-column layout. Now
  // delegates to the shared TeamMatchupCard with `compact: true` so all
  // three matchup-card sites (Schedule, Scoring, Standings) share one
  // implementation. The wrapper still owns:
  //   1. The mu-shape → TeamMatchupCard prop mapping
  //   2. The unfilled-bracket "config mode" placeholder rendering
  //   3. The result-tinted outer border (matchGrn40 when finalized)
  //
  // Visual reconciliation note: when this view first ships, finalized cards
  // will look slightly different from prior — TeamMatchupCard uses
  // `K.matchGrn + "18"` for the winner half tint vs the prior `+12`. This
  // is the same alignment Schedule got in the previous Tier 1 swap, and
  // keeping all three views on the same exact tint is the whole point of
  // consolidation. If a stronger contrast is needed, change it once in
  // TeamMatchupCard and all three update together.
  const MatchupCard = ({ mu, showConfig, configMu, isConsolation }) => {
    // Center strip is a flat "VS" pill. Same for both filled and config
    // modes — a compact 9pt uppercase glyph in K.t3.
    const vsCenter = (
      <span style={{
        fontSize: 9, fontWeight: 700, color: K.t3,
        letterSpacing: 1, whiteSpace: "nowrap",
      }}>VS</span>
    );

    // ── Config (placeholder) mode ──
    // Round is unfilled; show "Winner M1" / "Loser M2" / "#3 Seed" labels
    // pulled from the round config. Names are dimmed to K.t3 by passing
    // them as the `name1Line1` field — TeamMatchupCard will render them
    // in the standard name slot, so we ride the name slot's typography
    // and let the surrounding card layout do the rest. No seeds, no
    // winner state.
    if (!mu && showConfig && configMu) {
      return (
        <TeamMatchupCard
          team1={{ name1Line1: slotLabel(configMu, "s1"), name1Line2: "" }}
          team2={{ name1Line1: slotLabel(configMu, "s2"), name1Line2: "" }}
          compact
          center={vsCenter}
        />
      );
    }
    if (!mu) return null;

    // ── Filled mode ──
    // Map mu's pre-resolved fields onto TeamMatchupCard. The two-line stack
    // pulls from players1/players2 (last names array, always 2 entries for
    // 2v2). Falls back to the combined name1/name2 string when the player
    // arrays are empty — rare safety net for malformed teams.
    const team1Props = {
      name1Line1: mu.players1?.[0] || mu.name1,
      name1Line2: mu.players1?.[1] || "",
      seed: mu.seed1,
    };
    const team2Props = {
      name1Line1: mu.players2?.[0] || mu.name2,
      name1Line2: mu.players2?.[1] || "",
      seed: mu.seed2,
    };

    // Tint the outer frame green when the bracket card has been played and
    // produced a winner. Preserves the prior "this round is settled at a
    // glance" affordance from the inline MatchupCard. Skipped when there's
    // no result yet (or a tie, which technically can't happen in playoffs
    // but we handle defensively).
    const outerBorderColor = mu.hasResult && (mu.t1Won || mu.t2Won)
      ? `${K.matchGrn}40`
      : null;

    return (
      <TeamMatchupCard
        team1={team1Props}
        team2={team2Props}
        winnerSide={mu.t1Won ? "team1" : mu.t2Won ? "team2" : null}
        isFinal={mu.hasResult}
        isConsolation={isConsolation}
        compact
        outerBorderColor={outerBorderColor}
        center={vsCenter}
      />
    );
  };

  // Which rounds to actually render based on the current toggle.
  const roundsToRender = view === "bracket"
    ? bracketData
    : bracketData.filter((_, i) => i === view);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Toggle — compact round abbreviations (R1, R2 ...) + "Bracket", all on one
          row even on narrow phones. flex-wrap is off and each button flexes to an
          equal share of the row width. */}
      <div style={{
        display: "flex", flexWrap: "nowrap", gap: 4,
        background: K.inp, border: `1px solid ${K.bdr}`,
        borderRadius: 8, padding: 4,
      }}>
        {bracketData.map((round, ri) => {
          const isActive = view === ri;
          return (
            <button
              key={ri}
              onClick={() => setView(ri)}
              style={{
                flex: "1 1 0", minWidth: 0,
                padding: "8px 4px", borderRadius: 6,
                background: isActive ? K.card : "transparent",
                border: isActive ? `1px solid ${K.bdr}` : "1px solid transparent",
                color: isActive ? K.t1 : K.t3,
                fontSize: 11, fontWeight: 700, letterSpacing: .4, textTransform: "uppercase",
                cursor: "pointer", whiteSpace: "nowrap",
                overflow: "hidden", textOverflow: "ellipsis",
                transition: "all .15s",
                textAlign: "center",
              }}
            >
              {/* Always use the short R{n} form so everything fits on one line on
                  phones. The round name is shown as the column header inside the
                  Bracket view anyway. */}
              R{ri + 1}
            </button>
          );
        })}
        <button
          onClick={() => setView("bracket")}
          style={{
            flex: "2 1 0", minWidth: 0,
            padding: "8px 4px", borderRadius: 6,
            background: view === "bracket" ? K.card : "transparent",
            border: view === "bracket" ? `1px solid ${K.bdr}` : "1px solid transparent",
            color: view === "bracket" ? K.t1 : K.t3,
            fontSize: 11, fontWeight: 700, letterSpacing: .4, textTransform: "uppercase",
            cursor: "pointer", whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis",
            transition: "all .15s",
            textAlign: "center",
          }}
        >
          Bracket
        </button>
      </div>

      {/* BRACKET VIEW — side-by-side columns with connector lines, classic tournament
          layout. Scrolls horizontally if the bracket is wider than the viewport. */}
      {view === "bracket" && (() => {
        // Compact card component for the bracket columns. Single line per team, no
        // scores, no VS pill — just seed badge + name with winner highlight. The green
        // tint on the whole card (instead of just one half) makes advancement obvious.
        const BracketCard = ({ mu, configMu }) => {
          const teamRow = (seed, name, isWinner, isLoser, isConsolation) => {
            const badgeStyle = isConsolation
              ? { background: K.logoBright + "20", border: `1px solid ${K.logoBright}30`, color: K.logoBright }
              : { background: K.act, border: `1px solid ${K.act}`, color: K.logoBlue };
            return (
              <div style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 7px",
                background: isWinner ? K.matchGrn + "18" : "transparent",
                borderLeft: isWinner ? `3px solid ${K.matchGrn}` : "3px solid transparent",
                opacity: isLoser ? 0.55 : 1,
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                  ...badgeStyle,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8, fontWeight: 800,
                }}>{seed}</div>
                <div style={{
                  flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, color: K.t1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{name}</div>
              </div>
            );
          };

          if (!mu && configMu) {
            return (
              <div style={{ background: K.card, borderRadius: 6, border: `1px solid ${K.bdr}`, overflow: "hidden" }}>
                <div style={{ padding: "6px 7px", fontSize: 11, color: K.t3, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {slotLabel(configMu, "s1")}
                </div>
                <div style={{ height: 1, background: K.bdr + "40" }} />
                <div style={{ padding: "6px 7px", fontSize: 11, color: K.t3, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {slotLabel(configMu, "s2")}
                </div>
              </div>
            );
          }
          if (!mu) return null;
          return (
            <div style={{
              background: K.card, borderRadius: 6,
              border: `1px solid ${mu.hasResult && (mu.t1Won || mu.t2Won) ? K.matchGrn + "50" : K.bdr}`,
              overflow: "hidden",
            }}>
              {teamRow(mu.seed1, mu.name1, mu.t1Won, mu.t2Won)}
              <div style={{ height: 1, background: K.bdr + "40" }} />
              {teamRow(mu.seed2, mu.name2, mu.t2Won, mu.t1Won)}
            </div>
          );
        };

        const champCard = (() => {
          const lastRound = bracketData[bracketData.length - 1];
          const finalMatch = lastRound?.matchups[0];
          return finalMatch?.t1Won ? finalMatch.team1 : finalMatch?.t2Won ? finalMatch.team2 : null;
        })();

        // 2nd place — loser of the championship match. Only resolves once the
        // championship has a result; otherwise we render a "TBD" placeholder
        // tied to the same matchup so the box is always present in layout.
        const secondPlace = (() => {
          const lastRound = bracketData[bracketData.length - 1];
          const finalMatch = lastRound?.matchups[0];
          if (!finalMatch || !finalMatch.hasResult) return null;
          return finalMatch.t1Won ? finalMatch.team2 : finalMatch.t2Won ? finalMatch.team1 : null;
        })();

        // 3rd place: any matchup in the last round AFTER index 0 is treated as
        // a parallel consolation match (Loser M1 vs Loser M2 in a 4-round
        // bracket = 3rd place game). The winner of that match is awarded 3rd.
        // Returns { teamId, matchupIdx } so we can render a podium card aligned
        // with the matching consolation card. matchupIdx === null means no
        // 3rd-place match is configured for this bracket — caller skips render.
        const thirdPlace = (() => {
          const lastRound = bracketData[bracketData.length - 1];
          if (!lastRound) return null;
          for (let mi = 1; mi < lastRound.matchups.length; mi++) {
            const m = lastRound.matchups[mi];
            if (m) {
              const winner = m.t1Won ? m.team1 : m.t2Won ? m.team2 : null;
              return { teamId: winner, matchupIdx: mi };
            }
          }
          if (lastRound.config && lastRound.config.length > 1) {
            return { teamId: null, matchupIdx: 1 };
          }
          return null;
        })();

        // 4th place — loser of the 3rd place game (parallels secondPlace).
        const fourthPlace = (() => {
          const lastRound = bracketData[bracketData.length - 1];
          if (!lastRound) return null;
          for (let mi = 1; mi < lastRound.matchups.length; mi++) {
            const m = lastRound.matchups[mi];
            if (m && m.hasResult) {
              return m.t1Won ? m.team2 : m.t2Won ? m.team1 : null;
            }
          }
          return null;
        })();

        const COL_WIDTH = 132;         // column width — snug but fits the longest team names
        const CARD_HEIGHT = 52;        // approx height of a 2-team BracketCard after padding trim
        const BASE_GAP = 16;           // gap between matchups — breathable, not cramped
        const COL_SPACING = 12;        // horizontal space between columns (connector width)

        // Uniform spacing across all rounds — every round uses BASE_GAP between its
        // cards, so Round 2 feels as tight as Round 1 instead of doubling.
        //
        // Bracket geometry — each card must sit at the midpoint of its pair from the
        // prior round. The card-to-card SPACING doubles each advancement round.
        //
        // Round 0 (qualifying) and Round 1 (bracket start) are visually disconnected —
        // both start at the top of their column with no offset.
        //
        // CONSOLATION/THIRD-PLACE MATCHES: Rounds can have more cards than a pure
        // advancement bracket would require (e.g. Round 4 = { Championship, 3rd Place }
        // when Round 3 = 2 SFs). The FIRST card of each such round IS an advancement
        // match (Championship is SF winners). Any additional cards are parallel
        // consolation matches — placed at the same Y as cards in the PRIOR round.
        const geom = (() => {
          const out = [];
          let tp = 0;
          let prevSpacing = 0;  // card-to-card center distance in the previous round
          for (let r = 0; r < bracketData.length; r++) {
            if (r <= 1) {
              // Round 0 and Round 1 both start plain — no offset, standard gap.
              out.push({ gap: BASE_GAP, topPad: 0 });
              prevSpacing = CARD_HEIGHT + BASE_GAP; // Round 1 is the reference for Round 2
            } else {
              // Advancement round — first card sits at midpoint of prior round's first
              // pair, subsequent cards double the spacing to keep pairs aligned. This
              // handles both pure advancement rounds AND consolation-extended rounds
              // (the consolation match will appear at a Y position that corresponds to
              // the nearest prior-round card — more details in the connector logic).
              tp = tp + prevSpacing / 2;
              const newSpacing = prevSpacing * 2;
              const newGap = newSpacing - CARD_HEIGHT;
              out.push({ gap: newGap, topPad: tp });
              prevSpacing = newSpacing;
            }
          }
          return out;
        })();

        return (
          <div ref={bracketScrollRef} style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 4, scrollSnapType: "x proximity" }}>
            <div style={{ display: "flex", alignItems: "stretch", gap: 0, minWidth: (bracketData.length + 1) * (COL_WIDTH + COL_SPACING) }}>
              {bracketData.map((round, ri) => {
                const matchCount = Math.max(round.matchups.length, round.config.length, 1);
                const { gap, topPad } = geom[ri];

                return (
                  <div
                    key={ri}
                    data-round-col={ri}
                    style={{ width: COL_WIDTH, flexShrink: 0, display: "flex", flexDirection: "column", marginRight: ri < bracketData.length - 1 ? COL_SPACING : 0, scrollSnapAlign: "start" }}
                  >
                    {/* Column header — click to scroll this column to the left edge.
                        Handy on multi-round brackets that don't fit on one screen. */}
                    <button
                      onClick={() => {
                        const container = bracketScrollRef.current;
                        const col = container?.querySelector(`[data-round-col="${ri}"]`);
                        if (container && col) {
                          container.scrollTo({ left: col.offsetLeft, behavior: "smooth" });
                        }
                      }}
                      style={{
                        textAlign: "center", marginBottom: 10, height: 32,
                        background: "none", border: "none", padding: 0, cursor: "pointer",
                        display: "block", width: "100%",
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 700, color: K.warn, letterSpacing: .8, textTransform: "uppercase" }}>
                        {round.name}
                      </div>
                      {round.weekNum && (
                        <div style={{ fontSize: 9, color: K.t3, marginTop: 2 }}>
                          Wk {round.weekNum}{round.date ? ` · ${round.date}` : ""}
                        </div>
                      )}
                    </button>

                    {/* Stack of matchup cards for this round. Absolute positioning so
                        we can place consolation matches (e.g. 3rd-place game) at the
                        Y of their peer from the prior round, while the first card(s)
                        sit at the correct advancement-centered Y. */}
                    {(() => {
                      // For round >= 2, an "advancement" card count is max(1, ceil(prev/2)).
                      // Any card index >= advCount is a consolation/parallel match.
                      const prevCount = ri > 0
                        ? Math.max(bracketData[ri - 1].matchups.length, bracketData[ri - 1].config.length, 1)
                        : 0;
                      const advCount = ri <= 1 ? matchCount : Math.max(1, Math.ceil(prevCount / 2));

                      // Card Y positions. For r<=1: flow normally from top with BASE_GAP.
                      // For r>=2 advancement cards: topPad + index * (CARD_HEIGHT + gap).
                      // For r>=2 consolation cards: align with the LAST match of Round 1
                      // (the first real bracket round). For a standard 8-team bracket this
                      // means the 4th QF, which is the semantic "source" of the loser
                      // bracket's inputs — losing SFs came from the second-half QFs.
                      const cardY = (mi) => {
                        if (ri <= 1) return mi * (CARD_HEIGHT + gap);
                        if (mi < advCount) return topPad + mi * (CARD_HEIGHT + gap);
                        // Consolation card — align with the LAST match of the first real
                        // bracket round (index 1 in bracketData — round 0 is qualifying).
                        // If we don't have a Round 1, fall back to the prior round's last
                        // match so the card is still in the column.
                        const anchorRoundIdx = bracketData.length > 1 ? 1 : ri - 1;
                        const anchorG = geom[anchorRoundIdx];
                        const anchorRound = bracketData[anchorRoundIdx];
                        const anchorMatchCount = Math.max(
                          anchorRound?.matchups.length || 0,
                          anchorRound?.config.length || 0,
                          1
                        );
                        // For multiple consolation cards (future-proof), stack them starting
                        // from the bottom of the anchor round upward.
                        const consolationIdx = mi - advCount;
                        const anchorCardIdx = Math.max(0, anchorMatchCount - 1 - consolationIdx);
                        if (!anchorG) return topPad + mi * (CARD_HEIGHT + gap);
                        return anchorG.topPad + anchorCardIdx * (CARD_HEIGHT + anchorG.gap);
                      };

                      // Total column height — max of advancement block end and consolation card end
                      const columnHeight = Math.max(
                        ...Array.from({ length: matchCount }, (_, mi) => cardY(mi) + CARD_HEIGHT)
                      );

                      return (
                        <div style={{ position: "relative", height: columnHeight }}>
                          {Array.from({ length: matchCount }, (_, mi) => {
                            const mu = round.matchups[mi];
                            const configMu = round.config[mi];
                            const myY = cardY(mi);
                            const isConsolation = ri >= 2 && mi >= advCount;

                            // Compute connector target — next round's matching advancement card.
                            // Only draw for advancement cards in round >= 1.
                            let nextCardDeltaY = 0;
                            let shouldDrawConnector = false;
                            if (ri >= 1 && ri < bracketData.length - 1 && !isConsolation) {
                              const nextRound = bracketData[ri + 1];
                              const nextPrevCount = matchCount;
                              const nextAdvCount = Math.max(1, Math.ceil(nextPrevCount / 2));
                              const nextTargetIdx = Math.floor(mi / 2);
                              // Only draw if the next round has an advancement target at this index
                              if (nextTargetIdx < nextAdvCount) {
                                const nextG = geom[ri + 1];
                                const nextY = nextG.topPad + nextTargetIdx * (CARD_HEIGHT + nextG.gap);
                                const currCenterY = myY + CARD_HEIGHT / 2;
                                const nextCenterY = nextY + CARD_HEIGHT / 2;
                                nextCardDeltaY = nextCenterY - currCenterY;
                                shouldDrawConnector = true;
                              }
                            }

                            return (
                              <div key={mi} style={{ position: "absolute", top: myY, left: 0, right: 0 }}>
                                <BracketCard mu={mu} configMu={configMu} />
                                {shouldDrawConnector && (
                                  <>
                                    <div style={{
                                      position: "absolute", top: "50%", right: -6,
                                      width: 6, height: 1, background: K.bdr,
                                    }} />
                                    {nextCardDeltaY !== 0 && (
                                      <div style={{
                                        position: "absolute",
                                        top: nextCardDeltaY > 0 ? "50%" : `calc(50% + ${nextCardDeltaY}px)`,
                                        right: -6, width: 1,
                                        height: Math.abs(nextCardDeltaY),
                                        background: K.bdr,
                                      }} />
                                    )}
                                    {(mi % 2 === 0 || mi + 1 === advCount) && (
                                      <div style={{
                                        position: "absolute",
                                        top: `calc(50% + ${nextCardDeltaY}px)`,
                                        right: -12, width: 6, height: 1, background: K.bdr,
                                      }} />
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                    {/* Legacy stack removed — see the absolutely-positioned block above */}
                  </div>
                );
              })}

              {/* Trophy column — 4 single-row podium boxes:
                    1st (CHAMPION)        ← centered next to championship match
                    2nd (RUNNER-UP)       ← directly below 1st, fixed gap
                    3rd (3RD PLACE)       ← centered next to 3rd-place match
                    4th (4TH PLACE)       ← directly below 3rd, fixed gap

                  Each pair (1st+2nd, 3rd+4th) forms a "podium block" exactly
                  CARD_HEIGHT tall, so it occupies the same vertical space as
                  the source 2-team match card next to it — same top/bottom
                  edges, no overhang, perfect symmetry. The fixed gap between
                  1st-and-2nd is the same as 3rd-and-4th by design. */}
              {(() => {
                const lastIdx = bracketData.length - 1;
                const lastRound = bracketData[lastIdx];
                const lastG = geom[lastIdx] || { topPad: 0, gap: BASE_GAP };
                const lastAdvCount = Math.max(1, Math.ceil((lastIdx > 0 ? bracketData[lastIdx - 1] : { matchups: [], config: [] }).matchups.length / 2) || 1);
                const trophyCardY = (mi) => {
                  if (lastIdx <= 1) return mi * (CARD_HEIGHT + lastG.gap);
                  if (mi < lastAdvCount) return lastG.topPad + mi * (CARD_HEIGHT + lastG.gap);
                  const anchorRoundIdx = bracketData.length > 1 ? 1 : lastIdx - 1;
                  const anchorG = geom[anchorRoundIdx];
                  const anchorRound = bracketData[anchorRoundIdx];
                  const anchorMatchCount = Math.max(
                    anchorRound?.matchups.length || 0,
                    anchorRound?.config.length || 0,
                    1
                  );
                  const consolationIdx = mi - lastAdvCount;
                  const anchorCardIdx = Math.max(0, anchorMatchCount - 1 - consolationIdx);
                  if (!anchorG) return lastG.topPad + mi * (CARD_HEIGHT + lastG.gap);
                  return anchorG.topPad + anchorCardIdx * (CARD_HEIGHT + anchorG.gap);
                };

                // Single-row podium box dimensions. ROW_HEIGHT × 2 + ROW_GAP =
                // CARD_HEIGHT keeps the stacked pair exactly the height of the
                // source match card. 24 + 4 + 24 = 52 = CARD_HEIGHT. Don't
                // change without updating CARD_HEIGHT in the same direction —
                // the equality is what makes the symmetry work.
                const ROW_HEIGHT = 24;
                const ROW_GAP = 4;

                const championY = trophyCardY(0);
                const thirdMatchY = thirdPlace ? trophyCardY(thirdPlace.matchupIdx) : null;

                // Position calc: 1st sits at championY; 2nd directly below it.
                // 3rd sits at thirdMatchY; 4th directly below it.
                const firstY = championY;
                const secondY = championY + ROW_HEIGHT + ROW_GAP;
                const thirdY = thirdMatchY;
                const fourthY = thirdMatchY != null ? thirdMatchY + ROW_HEIGHT + ROW_GAP : null;

                const totalHeight = Math.max(
                  secondY + ROW_HEIGHT,
                  fourthY != null ? fourthY + ROW_HEIGHT : 0
                );

                // Single-row box: leading emoji/badge, position label, seed
                // badge + team name. Same border weight (1px) and radius (6)
                // as BracketCard so the cards visually belong to the same
                // family. `accent` colors the border + bg tint + label; team
                // name stays in K.t1 for readability across all positions.
                const podiumRow = (filled, accent, emoji, label, teamId) => (
                  <div style={{
                    height: ROW_HEIGHT, boxSizing: "border-box",
                    background: filled ? accent + "15" : K.card,
                    border: `1px solid ${filled ? accent + "60" : K.bdr}`,
                    borderRadius: 6,
                    padding: "0 8px",
                    display: "flex", alignItems: "center", gap: 6,
                    overflow: "hidden",
                  }}>
                    <span style={{ fontSize: 12, lineHeight: 1, flexShrink: 0 }}>{emoji}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 800, color: filled ? accent : K.t3,
                      letterSpacing: .8, flexShrink: 0, textTransform: "uppercase",
                    }}>{label}</span>
                    {filled ? (
                      <>
                        <div style={{
                          width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                          background: K.logoBright + "20", border: `1px solid ${K.logoBright}30`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 7, fontWeight: 800, color: K.logoBright,
                          marginLeft: "auto",
                        }}>{getSeed(teamId)}</div>
                        <span style={{
                          fontSize: 11, fontWeight: 700, color: K.t1,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          minWidth: 0, flexShrink: 1,
                        }}>{gn(teamId)}</span>
                      </>
                    ) : (
                      <span style={{
                        fontSize: 10, color: K.t3, fontWeight: 600,
                        marginLeft: "auto", letterSpacing: .5,
                      }}>TBD</span>
                    )}
                  </div>
                );

                return (
                  <div style={{ width: COL_WIDTH, flexShrink: 0, display: "flex", flexDirection: "column" }}>
                    <div style={{ height: 32 + 10 /* match header + its margin */ }} />
                    <div style={{ position: "relative", height: totalHeight }}>
                      <div style={{ position: "absolute", top: firstY, left: 0, right: 0 }}>
                        {podiumRow(!!champCard, K.gold, "🏆", "Champion", champCard)}
                      </div>
                      <div style={{ position: "absolute", top: secondY, left: 0, right: 0 }}>
                        {podiumRow(!!secondPlace, K.t2, "🥈", "2nd", secondPlace)}
                      </div>
                      {thirdPlace && thirdY != null && (
                        <>
                          <div style={{ position: "absolute", top: thirdY, left: 0, right: 0 }}>
                            {podiumRow(!!thirdPlace.teamId, K.t2, "🥉", "3rd", thirdPlace.teamId)}
                          </div>
                          {fourthY != null && (
                            <div style={{ position: "absolute", top: fourthY, left: 0, right: 0 }}>
                              {podiumRow(!!fourthPlace, K.t2, "4️⃣", "4th", fourthPlace)}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* PER-ROUND VIEW — stacked matchup cards, non-playoff matches below */}
      {view !== "bracket" && roundsToRender.map((round, idx) => {
        const ri = bracketData.indexOf(round);
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

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Array.from({ length: matchCount }, (_, mi) => {
                const mu = round.matchups[mi];
                const configMu = round.config[mi];
                return <MatchupCard key={mi} mu={mu} showConfig={!mu} configMu={configMu} />;
              })}
            </div>

            {/* Non-playoff matches below the bracket portion — dashed divider separates */}
            {round.consolationMatchups.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${K.bdr}` }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: K.t3,
                  letterSpacing: 1.2, textTransform: "uppercase",
                  marginBottom: 8,
                }}>
                  Non-Playoff Matches
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {round.consolationMatchups.map((mu, mi) => (
                    <MatchupCard key={mi} mu={mu} isConsolation />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ════════════════════════════════════════════════════════════
//  INDIVIDUAL TOURNAMENT VIEW
// ════════════════════════════════════════════════════════════
function IndividualEventView({ players, teams, schedule, course, leagueConfig, fetchWeekScores, fetchAllScores, scoringRules, matchResults }) {
  const [scores, setScores] = useState({});
  const [allRounds, setAllRounds] = useState(null); // { playerId: [{ season, week, gross }] }
  const [loading, setLoading] = useState(true);

  // Identify the "final round" — the last round in the configured bracket. During
  // the final round, the leaderboard updates live: we don't wait for signed match
  // results, and we refresh scores on a short interval so everyone watching can
  // see the tournament unfold in real time.
  //
  // Earlier rounds DO wait for a signed match — this protects the leaderboard
  // from stale test data or abandoned partial entries. You can think of the
  // non-final round gate as "official scores only" and the final round as
  // "live scoring window, show everything".
  const finalRoundWeek = useMemo(() => {
    const allPlayoffWeeks = schedule
      .filter(wk => wk.isPlayoff === true && !wk.rainedOut && wk.matches?.length > 0)
      .sort((a, b) => a.week - b.week);
    return allPlayoffWeeks[allPlayoffWeeks.length - 1]?.week ?? null;
  }, [schedule]);

  const playoffWeeks = useMemo(() =>
    schedule.filter(wk => {
      if (wk.rainedOut || wk.isPlayoff !== true) return false;
      if (!(wk.matches?.length > 0)) return false;
      // FINAL round: always include (live scoring window).
      if (wk.week === finalRoundWeek) return true;
      // EARLIER rounds: require at least one signed match result for this week,
      // so stale test scores or abandoned entries can't show up.
      return (matchResults || []).some(r => r.week === wk.week);
    }).sort((a, b) => a.week - b.week),
    [schedule, matchResults, finalRoundWeek]
  );
  // Total number of rounds configured for the tournament. Sourced from the admin's
  // bracket setup so the header count stays stable even when later rounds aren't
  // seeded yet (Round 2 can't be seeded until Round 1 finishes). Falls back to the
  // count of scheduled playoff weeks if the admin never configured playoffRounds.
  const totalRounds = useMemo(() => {
    const cfg = leagueConfig?.playoffRounds || [];
    if (cfg.length > 0) return cfg.length;
    return schedule.filter(wk => wk.isPlayoff === true && !wk.rainedOut).length;
  }, [leagueConfig, schedule]);

  // Short name formatter for leaderboard display: "Aaron Jensen" -> "A. Jensen".
  // Single-name players (rare) render as-is.
  const shortName = (fullName) => {
    if (!fullName) return "";
    const parts = fullName.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : fullName;
  };

  // Fetch scores for all playoff weeks AND the full rounds history needed for
  // per-week handicap snapshots. Refetches on every mount/update of this view so
  // the leaderboard always reflects the latest saved scores. Users typically land
  // on the Individual tab only briefly, so re-running the fetches each time is
  // not expensive in practice — and it guarantees freshness after pull-to-refresh
  // or any background save.
  useEffect(() => {
    if (!playoffWeeks.length || !fetchWeekScores) return;
    let cancelled = false;

    // Full refresh — scores for all playoff weeks + history for per-round HCP calc.
    // This is the initial load path.
    const fullFetch = async (showLoading) => {
      if (showLoading) setLoading(true);
      const all = {};
      for (const wk of playoffWeeks) {
        const wkScores = await fetchWeekScores(wk.week);
        Object.assign(all, wkScores);
      }
      if (cancelled) return;
      setScores(all);
      if (fetchAllScores) {
        const hist = await fetchAllScores();
        if (cancelled) return;
        setAllRounds(hist);
      }
      if (showLoading) setLoading(false);
    };

    // Lightweight refresh — only the final round's scores. Used by the polling
    // interval during live final-round play so we don't redownload earlier rounds
    // on every tick (their scores are already final and won't change).
    const finalRoundOnlyFetch = async () => {
      if (!finalRoundWeek) return;
      const wkScores = await fetchWeekScores(finalRoundWeek);
      if (cancelled) return;
      setScores(prev => {
        // Keep prior rounds' data, replace the final round's keys.
        const merged = { ...prev };
        // Strip any old final-round keys first so deletions propagate.
        for (const k of Object.keys(merged)) {
          if (k.startsWith(`w${finalRoundWeek}_`)) delete merged[k];
        }
        return { ...merged, ...wkScores };
      });
    };

    // Kick off the initial load.
    fullFetch(true);

    // LIVE LEADERBOARD — poll every 20s only while the final round is
    // actually being played, not just because it's on the schedule. The
    // tournament runs during playoffs, which can be weeks away at season
    // start; the original condition (final round merely exists in the
    // schedule) lit the LIVE badge from week 1. Now we also require:
    //   - the final round itself is unlocked (not yet finalized), and
    //   - any prior playoff round has been finalized (so we know we've
    //     reached the final round, not still in earlier rounds), and
    //   - today is at or past the final round's scheduled date (so the
    //     badge doesn't burn 20s polling cycles before play actually starts).
    // All three must hold; without prior rounds (single-round tournament)
    // the prior-rounds check is vacuously satisfied.
    const isFinalRoundLive = (() => {
      if (!finalRoundWeek) return false;
      const finalWk = schedule.find(wk => wk.week === finalRoundWeek);
      if (!finalWk || finalWk.locked === true) return false;
      if (!playoffWeeks.some(wk => wk.week === finalRoundWeek)) return false;
      const earlierPlayoffWeeks = schedule.filter(wk =>
        wk.isPlayoff === true && !wk.rainedOut && wk.week < finalRoundWeek
      );
      const priorRoundsDone = earlierPlayoffWeeks.length === 0
        || earlierPlayoffWeeks.every(wk => wk.locked === true);
      if (!priorRoundsDone) return false;
      // Date guard: only "live" once the scheduled date has arrived.
      //
      // PRIOR BUG: comment claimed dates were ISO ("2026-08-04") and compared
      // todayStr.toISOString() < finalWk.date — but dates throughout the app
      // are stored as short readable strings ("Apr 21"). ASCII-wise digit < letter
      // is always true, so this guard always returned false and live polling
      // never engaged. The LIVE badge never appeared. Fixed by using the
      // canonical parser via isScheduleDateAtOrPast.
      if (finalWk.date) {
        const year = leagueConfig?.year || new Date().getFullYear();
        if (!isScheduleDateAtOrPast(finalWk.date, year)) return false;
      }
      return true;
    })();
    let pollId = null;
    if (isFinalRoundLive) {
      pollId = setInterval(() => { finalRoundOnlyFetch(); }, 20_000);
    }

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
    };
  }, [playoffWeeks, finalRoundWeek, fetchWeekScores, fetchAllScores, leagueConfig]);

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
      // doesn't shift every week as scores come in. If no playoff rounds have started,
      // fall back to the current week so the handicap reflects today's reality.
      const firstWk = playoffWeeks[0];
      const season = leagueConfig?.year || new Date().getFullYear();
      const startHcp = firstWk
        ? handicapBeforeWeek(p, season, firstWk.week)
        : (calcPlayerHcp(allRounds?.[p.id] || [], recentN, bestN, frontPar) ?? (p.handicapIndex ?? 0));

      // Find the player's teammate for this playoff season's roster. Kept for the
      // teamName label; no longer used to substitute scores (see withdrawal logic below).
      const team = teams.find(t => t.player1 === p.id || t.player2 === p.id);

      // Individual-tournament withdrawal: being marked absent for ANY playoff week
      // disqualifies the player from the tournament. Their played rounds stay on
      // the leaderboard as a record of what they shot, but their total becomes WD
      // and they drop to the bottom of the sort. This differs from the team match,
      // where an absent player's teammate covers for them and the match proceeds —
      // the individual event has no teammate mechanic.
      let withdrew = false;
      let wdRound = null;

      for (const wk of playoffWeeks) {
        const side = wk.side || 'front';
        const pars = side === 'front' ? frontPars : backPars;
        const parTotal = pars.reduce((a, b) => a + b, 0);

        const isAbsent = scores[`w${wk.week}_p${p.id}_habsent`] === 1;

        if (isAbsent && !withdrew) {
          // Mark withdrawal at the first round the player missed. Prior rounds
          // (if any) remain in `rounds`; we stop accumulating here.
          withdrew = true;
          wdRound = wk.week;
        }
        // Once withdrawn, skip this and all subsequent rounds. No teammate
        // substitution, no continued accumulation — the tournament is individual.
        if (withdrew) continue;

        let gross = 0;
        let hasScores = false;
        // Holes are stored 0-indexed in Firestore (h=0 through h=8) — saveScore in
        // App.jsx and the historical-data imports both use 0..8. Using h=1..9 here
        // would miss every score and produce an all-blank leaderboard.
        for (let h = 0; h <= 8; h++) {
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

      // team already found above (for teammate lookup during absent handling)
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
        withdrew,
        wdRound,
      };
    }).filter(p => p.roundsPlayed > 0 || playoffWeeks.length > 0);

    // Sort order: ACTIVE (played at least one round, not withdrawn) → WD → NO DATA.
    // Within ACTIVE, net low→high, gross as tiebreaker. Within WD and NO DATA,
    // alphabetical for stable layout.
    const bucket = (p) => p.withdrew ? 1 : p.roundsPlayed > 0 ? 0 : 2;
    board.sort((a, b) => {
      const ab = bucket(a);
      const bb = bucket(b);
      if (ab !== bb) return ab - bb;
      if (ab === 0) {
        if (a.totalNet !== b.totalNet) return a.totalNet - b.totalNet;
        return a.totalGross - b.totalGross;
      }
      return a.name.localeCompare(b.name);
    });

    return board;
  }, [players, teams, course, playoffWeeks, scores, allRounds, scoringRules, leagueConfig]);

  if (loading && playoffWeeks.length > 0) {
    return <LoadingPanel subtitle="scores" />;
  }

  if (!playoffWeeks.length) {
    return <EmptyState icon="flag" title="No playoff rounds played yet" subtitle="The individual tournament runs alongside the playoff weeks." />;
  }

  const leaderName = leaderboard[0]?.roundsPlayed > 0 ? leaderboard[0].name.split(" ").pop() : null;

  // Show a LIVE badge when the final round is active — visible signal that the
  // leaderboard is auto-refreshing every 20 seconds. Conditions match the
  // polling effect above: final round seeded but not locked, all prior rounds
  // locked, and today's date has reached the final round's scheduled date.
  // See the polling effect for the full rationale.
  const isFinalRoundLive = (() => {
    if (!finalRoundWeek) return false;
    const finalWk = schedule.find(wk => wk.week === finalRoundWeek);
    if (!finalWk || finalWk.locked === true) return false;
    if (!playoffWeeks.some(wk => wk.week === finalRoundWeek)) return false;
    const earlierPlayoffWeeks = schedule.filter(wk =>
      wk.isPlayoff === true && !wk.rainedOut && wk.week < finalRoundWeek
    );
    const priorRoundsDone = earlierPlayoffWeeks.length === 0
      || earlierPlayoffWeeks.every(wk => wk.locked === true);
    if (!priorRoundsDone) return false;
    if (finalWk.date) {
      // Same fix as the polling guard above — was comparing ISO to "Apr 21".
      const year = leagueConfig?.year || new Date().getFullYear();
      if (!isScheduleDateAtOrPast(finalWk.date, year)) return false;
    }
    return true;
  })();

  return (
    <div style={{ padding: "0 2px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: K.t3 }}>
          Net stroke play · {totalRounds} round{totalRounds !== 1 ? "s" : ""} · All players
        </div>
        {isFinalRoundLive && (
          <>
            <style>{`
              @keyframes mnqLivePulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
            `}</style>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 7px", borderRadius: 10,
              background: K.red + "18", border: `1px solid ${K.red}40`,
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%", background: K.red,
                animation: "mnqLivePulse 1.5s ease-in-out infinite",
              }} />
              <span style={{ fontSize: 9, fontWeight: 800, color: K.red, letterSpacing: .8 }}>LIVE</span>
            </div>
          </>
        )}
      </div>

      {/* Leaderboard */}
      <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
        {/* Column header */}
        <div style={{ display: "flex", padding: "0 14px", fontSize: 9, fontWeight: 700, color: K.logoBright, textTransform: "uppercase", letterSpacing: .8 }}>
          <div style={{ width: 28 }} />
          <div style={{ flex: 1 }}>Player</div>
          <div style={{ width: 36, textAlign: "center" }}>HCP</div>
          {Array.from({ length: totalRounds }, (_, i) => (
            <div key={i} style={{ width: 36, textAlign: "center" }}>R{i + 1}</div>
          ))}
          <div style={{ width: 44, textAlign: "right" }}>Net</div>
        </div>

        {leaderboard.map((p, i) => {
          const mc = i === 0 ? K.gold : i === 1 ? K.silver : i === 2 ? K.bronze : K.logoBright;
          const hasRounds = p.roundsPlayed > 0;
          const isWD = p.withdrew;
          // Only active (non-WD) players with rounds get a rank badge; WD players
          // are explicitly ineligible for ranking.
          const showRank = hasRounds && !isWD;

          return (
            <div key={p.playerId} style={{
              display: "flex", alignItems: "center", background: K.card,
              borderRadius: CARD_RADIUS, border: `1px solid ${i === 0 && showRank ? K.act + "30" : K.bdr}`,
              padding: "10px 14px",
              opacity: isWD ? 0.55 : 1,
            }}>
              {/* Rank */}
              <div style={{ width: 28, flexShrink: 0 }}>
                {showRank && (
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

              {/* Round scores — one cell per CONFIGURED round, so the columns stay
                  aligned with the header even before later rounds are seeded. An
                  unseeded round shows a dash; a seeded round with no score for this
                  player also shows a dash (same visual treatment — they haven't
                  posted a score either way). The round the player withdrew in is
                  marked "WD" in red. */}
              {Array.from({ length: totalRounds }, (_, wi) => {
                const wk = playoffWeeks[wi];
                const round = wk ? p.rounds.find(r => r.week === wk.week) : null;
                const isWDRound = isWD && wk && wk.week === p.wdRound;
                return (
                  <div key={wi} style={{
                    width: 36, textAlign: "center", fontSize: 12,
                    fontWeight: isWDRound ? 800 : 600,
                    color: isWDRound ? K.red : round ? K.t1 : K.t3 + "40",
                  }}>
                    {isWDRound ? "WD" : round ? round.net : "–"}
                  </div>
                );
              })}

              {/* Total net — WD players get "WD" in red regardless of how many
                  rounds they played before withdrawing. */}
              <div style={{
                width: 44, textAlign: "right",
                fontSize: HERO_NUM_SIZE - 4, fontWeight: HERO_NUM_WEIGHT,
                color: isWD ? K.red : hasRounds ? K.t1 : K.t3,
                fontFamily: "'League Spartan', sans-serif",
              }}>
                {isWD ? "WD" : hasRounds ? p.totalNet : "–"}
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
export default function StandingsView({ teams, players, matchResults, leagueConfig, schedule, fetchSeasonScores, course, fetchWeekScores, scoringRules, fetchAllScores, saveMatchResult, dataLoaded }) {
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

  // Determine whether playoffs are configured at all — used to gate the
  // Playoffs tab pill (audit issue #19). During an early-season period
  // when no playoff weeks have been added to the schedule yet, showing
  // a Playoffs tab is just a dead-end click. Hide it entirely. Once the
  // commissioner configures playoff weeks (Admin → Schedule), the tab
  // appears. This also incidentally collapses the toggle pills bar to
  // a single "Season" tab when there's nothing else, and the existing
  // `tabs.length > 1` gate hides the bar entirely.
  const hasPlayoffs = useMemo(() =>
    schedule.some(wk => wk.isPlayoff === true && !wk.rainedOut),
    [schedule]
  );

  const hasIndividualEvent = leagueConfig?.individualEvent !== false; // default on
  // Default tab on first mount, strictly aligned to season phase:
  //   - "bracket" (Playoffs) → playoffs are CURRENTLY ACTIVE, defined as
  //     "at least one playoff week has been locked OR has match results" AND
  //     "at least one playoff week is still unlocked." So we only flip to
  //     bracket once a playoff round has actually been PLAYED — pre-seeded
  //     placeholder matchups in future playoff weeks no longer trip the
  //     toggle prematurely (which was the bug Aaron hit during regular
  //     season Week 2: playoff weeks had been pre-populated with empty
  //     matchups by an earlier schedule generate, so `matches.length > 0`
  //     fired even though no playoff golf had been played).
  //   - "standings" (Season) → in every other case: regular season, gap
  //     between regular season ending and playoffs starting, and after
  //     playoffs fully conclude. Final-standings view is the most useful
  //     landing once everything's locked.
  const defaultView = useMemo(() => {
    const playoffWks = (schedule || []).filter(wk => wk.isPlayoff === true && !wk.rainedOut);
    if (!playoffWks.length) return "standings";
    const anyPlayoffPlayed = playoffWks.some(wk =>
      wk.locked === true || (matchResults || []).some(r => r.week === wk.week)
    );
    const anyUnlockedPlayoff = playoffWks.some(wk => !wk.locked);
    if (anyPlayoffPlayed && anyUnlockedPlayoff) return "bracket";
    return "standings";
  }, [schedule, matchResults]);
  const [view, setView] = useState(defaultView); // "standings" | "bracket" | "individual"
  // If the schedule loads after first mount (common — subscriptions arrive async)
  // and the default changes, respect the new default — but ONLY while the user
  // hasn't manually picked a tab themselves. Tracked via a ref so re-selecting
  // the same tab intentionally doesn't block later auto-switches.
  const userPickedTab = useRef(false);
  useEffect(() => {
    if (!userPickedTab.current) setView(defaultView);
  }, [defaultView]);
  const pickTab = (id) => { userPickedTab.current = true; setView(id); };

  // Safety guard: if `view` ends up pointing at a tab that no longer
  // exists (e.g., user picked Playoffs, then commissioner removed all
  // playoff weeks), bounce to "standings". Otherwise the page renders
  // an empty branch with no nav back to a valid view.
  useEffect(() => {
    const validIds = new Set(["standings", ...(hasPlayoffs ? ["bracket"] : []), ...(hasIndividualEvent ? ["individual"] : [])]);
    if (!validIds.has(view)) setView("standings");
  }, [view, hasPlayoffs, hasIndividualEvent]);

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

  // ── Pre-load all season scores on mount, bucketed by week ──────────────
  // Without this, weekScores only has data for weeks the user has expanded.
  // We need scores for every week to detect/heal drift in saved match_result
  // docs (see auto-heal effect below). One Firestore query for the whole
  // season is cheaper than 16 per-week queries.
  useEffect(() => {
    if (!fetchSeasonScores) return;
    let alive = true;
    fetchSeasonScores().then(allScores => {
      if (!alive) return;
      const byWeek = {};
      Object.entries(allScores).forEach(([key, val]) => {
        const m = key.match(/^w(\d+)_/);
        if (!m) return;
        const w = parseInt(m[1]);
        if (!byWeek[w]) byWeek[w] = {};
        byWeek[w][key] = val;
      });
      // Existing weekScores entries (loaded via toggleResultExpand) win — they
      // may be more recent than the bulk fetch.
      setWeekScores(prev => {
        const merged = { ...byWeek };
        Object.keys(prev).forEach(w => { merged[w] = prev[w]; });
        return merged;
      });
    }).catch(() => { /* silent */ });
    return () => { alive = false; };
  }, [fetchSeasonScores]);

  // ── Auto-heal: silently recompute and re-save any drifted match_result ──
  // Delegates to lib/autoHealMatchResults — same logic Schedule uses, see
  // the lib file for the full rationale (drift sources, why it's a function
  // now, why per-mount Sets vs a shared module-level Set). This view runs
  // on bulk-loaded season scores (from the fetchSeasonScores effect above),
  // so it can heal every match the moment Standings is opened — Schedule's
  // copy heals lazily as the user expands individual weeks.
  //
  // seedMap MUST be declared before the effect call below — it's
  // referenced in the dep array, and a `const` lower in scope hits a TDZ
  // ReferenceError ("Cannot access before initialization"). Built from
  // saved matchResults so there's no circular dependency on auto-heal
  // output.
  const seedMap = useMemo(
    () => buildSeedMap(teams, matchResults, schedule, leagueConfig),
    [teams, matchResults, schedule, leagueConfig]
  );

  const healedRef = useRef(new Set());
  useEffect(() => {
    autoHealMatchResults({
      matchResults,
      scoresByWeek: weekScores,
      schedule,
      teams,
      players,
      course,
      scoringRules,
      leagueConfig,
      seedMap,
      healedIds: healedRef.current,
      saveMatchResult,
      // Pass season-wide rounds + current season so autoHeal can compute
      // each player's handicap AS OF the historical week. Without these
      // the function bails — which is by design: running it with
      // current handicaps caused the retroactive-standings bug.
      allRoundsByPid: allRounds,
      season: leagueConfig?.year || new Date().getFullYear(),
    });
  }, [matchResults, weekScores, course, scoringRules, leagueConfig, saveMatchResult, schedule, teams, players, seedMap, allRounds]);

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
    // lockedOnly: false because the caller has already filtered to lockedResults.
    // Passing standingsMethod (string) instead of isRecord (boolean) — the
    // shared function does its own "=== record" check.
    return buildStandingsForSeed(teams, lockedResults, schedule, leagueConfig?.standingsMethod, false);
  }, [teams, lockedResults, schedule, leagueConfig?.standingsMethod]);

  const prevStandings = useMemo(() => {
    if (latestLockedWeek === 0) return null;
    const prevResults = lockedResults.filter(r => r.week !== latestLockedWeek);
    if (prevResults.length === 0 && lockedResults.length > 0) return null;
    return buildStandingsForSeed(teams, prevResults, schedule, leagueConfig?.standingsMethod, false);
  }, [teams, lockedResults, latestLockedWeek, schedule, leagueConfig?.standingsMethod]);

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
        const wResult = resultLetterFor(r, teamId);
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
    if (!wkScores) return <LoadingPanel size="compact" />;

    const myTeamObj = teams.find(t => t.id === teamId);
    const oppTeamId = mr.team1Id === teamId ? mr.team2Id : mr.team1Id;
    const oppTeamObj = teams.find(t => t.id === oppTeamId);
    const t1Pids = [teams.find(t => t.id === mr.team1Id)?.player1, teams.find(t => t.id === mr.team1Id)?.player2].filter(Boolean);
    const t2Pids = [teams.find(t => t.id === mr.team2Id)?.player1, teams.find(t => t.id === mr.team2Id)?.player2].filter(Boolean);

    // Render-time helpers — score reading and strokes delegate to lib/matchCalc.js
    // so absent-handling stays consistent with Live Scoring and Schedule. Locals
    // are just thin closures binding the component's pars/hcps/players.
    //
    // Build a per-match historicalPlayers array where each player's handicapIndex
    // reflects what they had GOING INTO this week, using the same fallback chain
    // as autoHealMatchResults (retroactive calc → startingHandicapIndex →
    // current). This is what makes the displayed scorecard agree with the
    // recomputed match result — using today's handicaps in the render shows
    // wrong stroke dots and wrong hcp labels for any historical match.
    const recentN = scoringRules?.hcpRecentCount ?? 8;
    const bestN = scoringRules?.hcpBestCount ?? 6;
    const frontPar = (course.frontPars || []).reduce((a, b) => a + b, 0) || 36;
    const currentSeason = leagueConfig?.year || new Date().getFullYear();
    const historicalPlayers = players.map(p => {
      const retroHcp = allRounds ? getPlayerHcpAtWeek({
        playerId: p.id,
        week: mr.week,
        season: currentSeason,
        allRoundsByPid: allRounds,
        recentN, bestN, frontPar,
      }) : null;
      if (retroHcp !== null) return { ...p, handicapIndex: retroHcp };
      if (p.startingHandicapIndex !== undefined && p.startingHandicapIndex !== null && p.startingHandicapIndex !== "") {
        return { ...p, handicapIndex: parseFloat(p.startingHandicapIndex) };
      }
      return p;
    });

    const getInitials = (pid) => { const p = players.find(pl => pl.id === pid); return p ? p.name.split(' ').map(n => n[0]).join('') : "?"; };
    const getHcp = (pid) => { const p = historicalPlayers.find(pl => pl.id === pid); return p ? Math.round(p.handicapIndex || 0) : 0; };
    const isAbsent = (pid) => wkScores[`w${mr.week}_p${pid}_habsent`] === 1;
    const getStrokes = (pid, h) => getStrokesForHole({
      pid, h, players: historicalPlayers, hcps,
      week: mr.week, holeScores: wkScores, t1Pids, t2Pids,
    });
    const getScore = (pid, h) => readScoreEffective({
      pid, h, week: mr.week, holeScores: wkScores,
      t1Pids, t2Pids, pars, hcps, players: historicalPlayers,
    });

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
    const dispT1Obj = isT1 ? teams.find(t => t.id === mr.team1Id) : teams.find(t => t.id === mr.team2Id);
    const dispT2Obj = isT1 ? teams.find(t => t.id === mr.team2Id) : teams.find(t => t.id === mr.team1Id);
    const dispHR = !isT1 ? holeResults.map(x => -x) : holeResults;
    const dispRS = !isT1 ? runningStatus.map(x => -x) : runningStatus;
    // Local showSeeds — historical matches in seeded or playoff weeks get the
    // seed badge; round-robin weeks don't. Pulled from the schedule entry for
    // this specific week so the badge follows the actual week's flag, not the
    // current state of the league.
    const showSeedsLocal = !!(wk && (wk.seeded === true || wk.isPlayoff === true));

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
        {wk?.isPlayoff && <sc.HcpRow />}
        <sc.TeamLabelRow name={dispT1Obj?.name} seed={showSeedsLocal ? (seedMap[dispT1Obj?.id] || null) : null} />
        {dispT1Pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
        <sc.TeamNetRow pids={dispT1Pids} isTeam1Side={true} />
        <sc.MatchRow />
        <sc.TeamLabelRow name={dispT2Obj?.name} seed={showSeedsLocal ? (seedMap[dispT2Obj?.id] || null) : null} />
        {dispT2Pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
        <sc.TeamNetRow pids={dispT2Pids} isTeam1Side={false} />
      </div>
    );
  };

  const gt = (id) => teams.find(t => t.id === id);
  if (dataLoaded && !dataLoaded.teams) return <SkeletonList count={10} height={60} />;
  if (!teams.length) return <EmptyState icon="trophy" title="No teams yet" subtitle="Commissioner needs to set up teams." />;

  // W-L-T cell widths — sized for 1–2 digit values. Was 22/8 originally
  // which left 16px of slack across the trio; trimmed so the Team column
  // gets that space for longer last names.
  const wltCol = { width: 18, textAlign: "center", fontFamily: "'League Spartan', sans-serif" };
  const wltDash = { width: 6, textAlign: "center", color: K.t3 };

  // ── Toggle pills — always visible regardless of season phase ──
  // Season: current standings (always meaningful).
  // Playoffs: bracket view. During regular season this renders as a preview with seed
  //   placeholders (#1, #2, ...); once playoff weeks populate, real team names appear.
  // Individual: only meaningful during the individual tournament; shows a "starts Week X"
  //   placeholder beforehand. Omitted entirely if the league doesn't run an individual event.
  const tabs = [
    { id: "standings", label: "Season" },
    ...(hasPlayoffs ? [{ id: "bracket", label: "Playoffs" }] : []),
    ...(hasIndividualEvent ? [{ id: "individual", label: "Individual" }] : []),
  ];

  return (
    <div style={{ padding: "0 2px" }}>
      {/* Toggle pills */}
      {tabs.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <div style={{ display: "inline-flex", background: K.inp, borderRadius: 8, border: `1px solid ${K.bdr}`, padding: 3 }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => pickTab(t.id)} style={{
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
        <PlayoffBracketView teams={teams} players={players} schedule={schedule} matchResults={matchResults} leagueConfig={leagueConfig} />
      )}

      {/* Individual Event view — during regular season shows a "starts Week N" placeholder,
          during playoffs shows the live leaderboard. Keeps the toggle itself consistent
          regardless of season phase. */}
      {view === "individual" && (
        playoffsStarted ? (
          <IndividualEventView players={players} teams={teams} schedule={schedule} course={course} leagueConfig={leagueConfig} fetchWeekScores={fetchWeekScores} fetchAllScores={fetchAllScores} scoringRules={scoringRules} matchResults={matchResults} />
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
          {/* Slim column header — matches the row layout below.
              Widths: Pos 36 · Change 22 · Team flex · W-L-T 66 · final col
              40 (Holes Won, label wraps onto two lines) or 30 (Pts).
              Padding mirrors the row's "10px 10px" (tightened from 14 to
              maximize Team width on small screens). The Change column
              stays unlabeled — the ▲/▼ indicator below is self-evident,
              and a header label there would crowd the rank badge. */}
          <div style={{
            display: "flex", alignItems: "center", width: "100%",
            padding: "4px 10px", marginBottom: -2,
            fontSize: 9, fontWeight: 700, color: K.t3,
            letterSpacing: 1, textTransform: "uppercase",
          }}>
            <div style={{ width: 36, flexShrink: 0, textAlign: "center" }}>Pos</div>
            <div style={{ width: 22, flexShrink: 0 }} />
            <div style={{ flex: 1, textAlign: "center" }}>Team</div>
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
              <div style={{ width: 66, textAlign: "center" }}>W-L-T</div>
              <div style={{ minWidth: isRecord ? 40 : 30, textAlign: "center", marginLeft: 6, lineHeight: 1.1 }}>
                {isRecord ? <>Holes<br />Won</> : "Pts"}
              </div>
            </div>
          </div>
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
                  padding: "10px 10px", cursor: "pointer",
                }}>
                  {/* Pos column — just the rank badge. */}
                  <div style={{ width: 36, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                    <div style={{
                      width: RANK_BADGE_SIZE, height: RANK_BADGE_SIZE, borderRadius: RANK_BADGE_RADIUS,
                      background: i < 3 ? mc + "20" : K.logoBright + "20",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: RANK_BADGE_FONT, fontWeight: 800, color: mc,
                      border: i < 3 ? `1.5px solid ${mc}40` : `1.5px solid ${K.logoBright}30`,
                    }}>{curPos}</div>
                  </div>
                  {/* Change column — week-over-week position movement.
                      Reserves the same width whether or not there's a value
                      so team names line up cleanly across all rows. */}
                  <div style={{ width: 22, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                    {posChange !== null && posChange !== 0 && (
                      <div style={{ fontSize: 10, fontWeight: 700, color: posChange > 0 ? K.matchGrn : K.red, display: "flex", alignItems: "baseline", gap: 1, lineHeight: 1 }}>
                        <span style={{ fontSize: 7, lineHeight: 1 }}>{posChange > 0 ? "▲" : "▼"}</span>
                        <span style={{ lineHeight: 1 }}>{Math.abs(posChange)}</span>
                      </div>
                    )}
                  </div>
                  {/* Team column — players stacked on two rows. Last names
                      only, derived from each player's full name (split on
                      whitespace, take the trailing token). Falls back to
                      `lastNamesOnly(team.name)` on a single line if the
                      team's player IDs don't resolve. */}
                  <div style={{ flex: 1, textAlign: "left", lineHeight: 1.2, minWidth: 0 }}>
                    {(() => {
                      const p1 = players.find(pl => pl.id === team.player1);
                      const p2 = players.find(pl => pl.id === team.player2);
                      const lastOf = (p) => p ? p.name.split(/\s+/).slice(-1)[0] : null;
                      const l1 = lastOf(p1);
                      const l2 = lastOf(p2);
                      if (l1 && l2) return (
                        <>
                          <div style={{ fontSize: NAME_SIZE, fontWeight: NAME_WEIGHT, letterSpacing: .5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l1}</div>
                          <div style={{ fontSize: NAME_SIZE, fontWeight: NAME_WEIGHT, letterSpacing: .5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l2}</div>
                        </>
                      );
                      return <div style={{ fontSize: NAME_SIZE, fontWeight: NAME_WEIGHT, letterSpacing: .5 }}>{lastNamesOnly(team.name)}</div>;
                    })()}
                  </div>
                  <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0 }}>
                    {isRecord ? (<>
                      <div style={{ ...wltCol, fontSize: NAME_SIZE, fontWeight: 800, color: K.t1 }}>{s.w}</div>
                      <div style={{ ...wltDash, fontSize: NAME_SIZE, fontWeight: 800 }}>-</div>
                      <div style={{ ...wltCol, fontSize: NAME_SIZE, fontWeight: 800, color: K.t1 }}>{s.l}</div>
                      <div style={{ ...wltDash, fontSize: NAME_SIZE, fontWeight: 800 }}>-</div>
                      <div style={{ ...wltCol, fontSize: NAME_SIZE, fontWeight: 800, color: K.t1 }}>{s.t}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: K.hcpBlue, minWidth: 40, textAlign: "center", marginLeft: 6 }}>{s.hw}</div>
                    </>) : (<>
                      <div style={{ ...wltCol, fontSize: 11, fontWeight: 500, color: K.t3 }}>{s.w}</div>
                      <div style={{ ...wltDash, fontSize: 11, color: K.t3 }}>-</div>
                      <div style={{ ...wltCol, fontSize: 11, fontWeight: 500, color: K.t3 }}>{s.l}</div>
                      <div style={{ ...wltDash, fontSize: 11, color: K.t3 }}>-</div>
                      <div style={{ ...wltCol, fontSize: 11, fontWeight: 500, color: K.t3 }}>{s.t}</div>
                      <div style={{ fontSize: HERO_NUM_SIZE, fontWeight: HERO_NUM_WEIGHT, color: K.t1, fontFamily: "'League Spartan', sans-serif", minWidth: 30, textAlign: "center", marginLeft: 6 }}>{s.points}</div>
                    </>)}
                  </div>
                  {/* Chevron column removed — the entire row is a button so
                      tappability is implicit, and the 26px it occupied is
                      better given to the Team column on small screens. */}
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
                            <div style={{ width: 28, flexShrink: 0, textAlign: "right", color: K.hcpBlue, fontWeight: 700 }}>{r.holesWon}</div>
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
