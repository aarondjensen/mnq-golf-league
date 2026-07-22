import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { K, Pill, EmptyState, lastNamesOnly, getWeekSide, LIST_GAP, CARD_RADIUS, NAME_SIZE, NAME_WEIGHT, HERO_NUM_SIZE, HERO_NUM_WEIGHT, RANK_BADGE_SIZE, RANK_BADGE_RADIUS, RANK_BADGE_FONT, calcPlayerHcp, buildSeedMap, buildPlayoffSeedMap, buildStandingsForSeed, recordPoints, resolveIndivRound, LoadingPanel, SkeletonList, buildHistoricalPlayers, FS, FW } from "../theme";
import { SharedScorecard } from "../components/SharedScorecard";
import { Popup } from "../components/Popup";
import { readScoreEffective, getStrokesForHole, resultLetterFor, buildStrokesMap } from "../lib/matchCalc";
import { db, LF } from "../firebase";
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
  // Trailing spacer after the last bracket column. The horizontal scroll range
  // is shorter than the full bracket width, so without trailing space the last
  // round(s) and the podium column physically cannot reach the left edge. We
  // size this spacer in JS (see snap effect) to exactly the gap needed so every
  // column — including the podium — can be snapped flush-left.
  const bracketSpacerRef = useRef(null);

  // Deterministic horizontal snap. CSS scroll-snap (`mandatory`) proved
  // unreliable on iOS here — momentum scrolling rides past the snap point and
  // the column rests mid-round. Instead we snap in JS on scroll-end: after the
  // user stops scrolling, ease to whichever column's left edge is nearest. This
  // guarantees a round is always pinned to the leftmost column, never a partial.
  useEffect(() => {
    const el = bracketScrollRef.current;
    if (!el || view !== "bracket") return;

    // Non-spacer children of the inner flex row are the bracket columns
    // (rounds + podium) — the snap targets. Their flush-left scroll positions
    // are measured via getBoundingClientRect in snapToNearest below.
    const columns = () => {
      const row = el.firstElementChild;
      if (!row) return [];
      return Array.from(row.children).filter(c => c.dataset.bracketSpacer == null);
    };

    // Size the trailing spacer so the final ROUND column can sit flush-left
    // with the podium still beside it on screen — and so the scroll CANNOT go
    // past that point into a podium-only view. The podium is always the last
    // column, so the last round is the second-to-last column. We give trailing
    // room = (visible width − width of [last round → end]); the result makes
    // maxScrollLeft land exactly on the last round's left edge. Bail until the
    // container has a real width (ResizeObserver re-runs this when it does).
    const sizeSpacer = () => {
      const cols = columns();
      const spacer = bracketSpacerRef.current;
      if (cols.length < 2 || !spacer || !el.clientWidth) return;
      const last = cols[cols.length - 1];                 // podium (rightmost content)
      const anchor = cols[cols.length - 2];               // last ROUND column
      const rightEdge = last.offsetLeft + last.offsetWidth;
      const trailing = rightEdge - anchor.offsetLeft;     // width from last round → end
      spacer.style.width = Math.max(0, el.clientWidth - trailing) + "px";
    };

    const snapToNearest = () => {
      const cols = columns();
      if (!cols.length) return;
      const left = el.scrollLeft;
      const maxLeft = el.scrollWidth - el.clientWidth;
      // Reference point = the container's left content edge (border + padding).
      // Using rects rather than offsetLeft makes the target independent of the
      // column's offsetParent and any container padding — offsetLeft carried a
      // small constant offset that left Rounds 1–3 a few px short (Round 4 was
      // masked by the maxLeft clamp). The scroll position that brings a column
      // flush-left is: current scrollLeft + (column.left − reference.left).
      const elRect = el.getBoundingClientRect();
      const refLeft = elRect.left + el.clientLeft + (parseFloat(getComputedStyle(el).paddingLeft) || 0);
      let target = left;
      let best = Infinity;
      for (const c of cols) {
        const delta = c.getBoundingClientRect().left - refLeft;
        if (Math.abs(delta) < best) { best = Math.abs(delta); target = left + delta; }
      }
      target = Math.max(0, Math.min(target, maxLeft));
      if (Math.abs(target - left) > 1) el.scrollTo({ left: target, behavior: "smooth" });
    };

    let settleTimer = null;
    const onScroll = () => {
      clearTimeout(settleTimer);
      // Fire once scrolling (incl. iOS momentum) has settled.
      settleTimer = setTimeout(snapToNearest, 110);
    };

    // A ResizeObserver re-sizes the spacer whenever the container's width
    // becomes known or changes. This covers the case where the Standings tab
    // mounts before layout settles (clientWidth starts at 0) — a single rAF
    // would size to 0 and never correct itself, capping the scroll short of
    // the final rounds (the bug where Round 4 couldn't reach the left edge).
    const ro = new ResizeObserver(() => sizeSpacer());
    ro.observe(el);
    sizeSpacer();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(settleTimer);
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [view, playoffRounds.length]);

  // Bracket seed badges use the PLAYOFF seed map (full regular season, frozen
  // at RS end), NOT the round-robin-only lockedSeeds. This is the order that
  // resolves the bracket matchups, so badges and teams always agree — and it
  // matches the Regular Season standings everyone reads.
  const seedMap = useMemo(
    () => buildPlayoffSeedMap(teams, matchResults, schedule, leagueConfig),
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
    // Prefer the isConsolation flag so bracket/consolation are separated by
    // identity, not array position. This lets non-bracket matches sit in the
    // earlier tee slots (they're ordered first) while the bracket keeps the
    // final tee times. Fall back to the old first-N-are-bracket split for weeks
    // seeded before the flag existed.
    const hasConsolationFlag = allMatches.some(m => m.isConsolation === true);
    const bracketMatches = hasConsolationFlag
      ? allMatches.filter(m => !m.isConsolation)
      : allMatches.slice(0, bracketSize);
    const consolationMatches = hasConsolationFlag
      ? allMatches.filter(m => m.isConsolation === true)
      : allMatches.slice(bracketSize);
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
    if (val === "lowestSeed") return "Lower Seed";
    if (val === "highestSeed") return "Top Seed";
    if (val === "highestWinner") return "High Winner";
    if (val === "nextHighestSeed") return "2nd High Seed";
    if (val === "nextHighestWinner") return "2nd High Winner";
    if (val === "nextLowestSeed") return "2nd Low Seed";
    if (val?.startsWith("winner_")) return `Winner M${parseInt(val.split("_")[1]) + 1}`;
    return "TBD";
  };

  // Once playoff seeds are locked, every SEED-type slot in a future round is
  // already known — only winner/loser slots depend on games not yet played.
  // Resolve those seed slots to the actual team so an unplayed round shows,
  // e.g., "#4 CARPENTER vs #5 KELLEY" instead of "#4 SEED vs #5 SEED", while
  // "Winner M1" / "Low Seed" slots stay as placeholders until they resolve.
  const seedsLocked = Array.isArray(leagueConfig?.playoffSeeds) && leagueConfig.playoffSeeds.length === teams.length;
  const teamIdForSeed = (n) => Object.keys(seedMap).find(id => seedMap[id] === Number(n)) || null;
  const configSideProps = (mu, side) => {
    const type = mu[side + "type"];
    const val = mu[side];
    if (seedsLocked && type === "seed" && val) {
      const teamId = teamIdForSeed(val);
      if (teamId) {
        const [l1, l2] = playerLastNames(teamId);
        return { name1Line1: l1 || gn(teamId), name1Line2: l2 || "", seed: getSeed(teamId) };
      }
    }
    return { name1Line1: slotLabel(mu, side), name1Line2: "" };
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
        fontSize: FS.micro, fontWeight: FW.bold, color: K.t3,
        letterSpacing: 1, whiteSpace: "nowrap",
      }}>VS</span>
    );

    // ── Config (placeholder) mode ──
    // Round is unfilled. Seed-type slots resolve to the actual team (seeds are
    // locked); winner/loser slots show "Winner M1" / "Low Seed" placeholders
    // until the feeding round finalizes. configSideProps handles the split.
    if (!mu && showConfig && configMu) {
      return (
        <TeamMatchupCard
          team1={configSideProps(configMu, "s1")}
          team2={configSideProps(configMu, "s2")}
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
                fontSize: FS.xs, fontWeight: FW.bold, letterSpacing: .4, textTransform: "uppercase",
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
            fontSize: FS.xs, fontWeight: FW.bold, letterSpacing: .4, textTransform: "uppercase",
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
            // Unified blue seed badge (Full League style) — matches the card
            // view and the rest of the app. isConsolation no longer alters the
            // badge color; advancement is still shown via the green winner tint.
            const badgeStyle = { background: K.logoBright + "20", border: `1px solid ${K.logoBright}30`, color: K.logoBright };
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
                  fontSize: FS.micro, fontWeight: FW.heavy,
                }}>{seed}</div>
                <div style={{
                  flex: 1, minWidth: 0, fontSize: FS.xs, fontWeight: FW.bold, color: K.t1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{name}</div>
              </div>
            );
          };

          if (!mu && configMu) {
            // Resolve each config slot: a locked SEED slot shows the real team
            // (badge + name) exactly like a filled card; winner/loser slots stay
            // as "Winner M1" / "Low Seed" placeholders until they resolve. This
            // is what lets an unplayed round (e.g. Round 2 before the play-in
            // finishes) display everything already known — seeds 1–6 here — while
            // only the Week 13-dependent opponents remain TBD.
            const slotContent = (side) => {
              const type = configMu[side + "type"];
              const val = configMu[side];
              if (seedsLocked && type === "seed" && val) {
                const teamId = teamIdForSeed(val);
                if (teamId) return { resolved: true, seed: getSeed(teamId), name: gn(teamId) };
              }
              return { resolved: false, label: slotLabel(configMu, side) };
            };
            const placeholderRow = (label) => (
              <div style={{ padding: "6px 7px", fontSize: FS.xs, color: K.t3, fontWeight: FW.semibold, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {label}
              </div>
            );
            const renderSlot = (s) => s.resolved
              ? teamRow(s.seed, s.name, false, false)
              : placeholderRow(s.label);
            const s1 = slotContent("s1");
            const s2 = slotContent("s2");
            return (
              <div style={{ background: K.card, borderRadius: 6, border: `1px solid ${K.bdr}`, overflow: "hidden" }}>
                {renderSlot(s1)}
                <div style={{ height: 1, background: K.bdr + "40" }} />
                {renderSlot(s2)}
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
          <div ref={bracketScrollRef} style={{ overflowX: "auto", paddingBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "stretch", gap: 0, minWidth: (bracketData.length + 1) * (COL_WIDTH + COL_SPACING) }}>
              {bracketData.map((round, ri) => {
                const matchCount = Math.max(round.matchups.length, round.config.length, 1);
                const { gap, topPad } = geom[ri];

                return (
                  <div
                    key={ri}
                    data-round-col={ri}
                    style={{ width: COL_WIDTH, flexShrink: 0, display: "flex", flexDirection: "column", marginRight: ri < bracketData.length - 1 ? COL_SPACING : 0 }}
                  >
                    {/* Column header — click to scroll this column to the left edge.
                        Handy on multi-round brackets that don't fit on one screen. */}
                    <button
                      onClick={() => {
                        const container = bracketScrollRef.current;
                        const col = container?.querySelector(`[data-round-col="${ri}"]`);
                        if (container && col) {
                          // Match the snap math: scroll so the column's left edge
                          // sits at the container's left content edge (rect-based,
                          // independent of offsetParent/padding).
                          const refLeft = container.getBoundingClientRect().left
                            + container.clientLeft
                            + (parseFloat(getComputedStyle(container).paddingLeft) || 0);
                          const delta = col.getBoundingClientRect().left - refLeft;
                          const maxLeft = container.scrollWidth - container.clientWidth;
                          const target = Math.max(0, Math.min(container.scrollLeft + delta, maxLeft));
                          container.scrollTo({ left: target, behavior: "smooth" });
                        }
                      }}
                      style={{
                        textAlign: "center", marginBottom: 10, height: 32,
                        background: "none", border: "none", padding: 0, cursor: "pointer",
                        display: "block", width: "100%",
                      }}
                    >
                      <div style={{ fontSize: FS.xs, fontWeight: FW.bold, color: K.warn, letterSpacing: .8, textTransform: "uppercase" }}>
                        {round.name}
                      </div>
                      {round.weekNum && (
                        <div style={{ fontSize: FS.micro, color: K.t3, marginTop: 2 }}>
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
                    <span style={{ fontSize: FS.sm, lineHeight: 1, flexShrink: 0 }}>{emoji}</span>
                    <span style={{
                      fontSize: FS.micro, fontWeight: FW.heavy, color: filled ? accent : K.t3,
                      letterSpacing: .8, flexShrink: 0, textTransform: "uppercase",
                    }}>{label}</span>
                    {filled ? (
                      <>
                        <div style={{
                          width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                          background: K.logoBright + "20", border: `1px solid ${K.logoBright}30`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: FS.micro, fontWeight: FW.heavy, color: K.logoBright,
                          marginLeft: "auto",
                        }}>{getSeed(teamId)}</div>
                        <span style={{
                          fontSize: FS.xs, fontWeight: FW.bold, color: K.t1,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          minWidth: 0, flexShrink: 1,
                        }}>{gn(teamId)}</span>
                      </>
                    ) : (
                      <span style={{
                        fontSize: FS.xs, color: K.t3, fontWeight: FW.semibold,
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
              {/* Trailing spacer — width set in JS so the last column (podium)
                  can scroll fully to the left edge. flexShrink:0 keeps it. */}
              <div ref={bracketSpacerRef} data-bracket-spacer="" style={{ flexShrink: 0, width: 0 }} />
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
              <span style={{ fontSize: FS.sm, fontWeight: FW.bold, color: K.warn, letterSpacing: 1, textTransform: "uppercase" }}>
                {round.name}
              </span>
              {round.weekNum && (
                <span style={{ fontSize: FS.xs, color: K.t3 }}>
                  Wk {round.weekNum}{round.date ? ` · ${round.date}` : ""}
                </span>
              )}
              {round.isLocked && (
                <span style={{ marginLeft: "auto" }}>
                  <Pill color={K.grn} style={{ fontSize: FS.micro }}>FINAL</Pill>
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
                  fontSize: FS.xs, fontWeight: FW.bold, color: K.t3,
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
function IndividualEventView({ players, teams, schedule, course, leagueConfig, fetchAllScores, scoringRules }) {
  const [scores, setScores] = useState({});
  const [allRounds, setAllRounds] = useState(null); // { playerId: [{ season, week, gross }] }
  const [loading, setLoading] = useState(true);
  const [scPlayer, setScPlayer] = useState(null); // { pid, week } — open scorecard popout

  // LIVE POSITION MOVEMENT — backs the WBC-style ▲/▼ arrows next to the rank
  // badge. prevPositions remembers each active player's last golf position so
  // the movement effect (defined after the leaderboard memo) can diff the board
  // whenever a live score reshuffles it.
  const prevPositions = useRef({});
  const [movements, setMovements] = useState({});

  // ALWAYS-LIVE MODEL: every non-rained-out playoff week with matches is on the
  // leaderboard unconditionally, and its scores stream in via Firestore
  // onSnapshot subscriptions (see the effect below) the moment they're saved.
  //
  // This intentionally REMOVES the old signed-match-result gate on earlier
  // rounds (scores only appeared after a director signed the week's match) and
  // the final-round-only 20-second polling window. Directors accepted the
  // tradeoff: unsigned in-progress scores show immediately on THIS view.
  // Match-play views and autoHeal keep their own signed-result semantics —
  // nothing here feeds back into them.
  const playoffWeeks = useMemo(() =>
    schedule
      .filter(wk => wk.isPlayoff === true && !wk.rainedOut && wk.matches?.length > 0)
      .sort((a, b) => a.week - b.week),
    [schedule]
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

  // REAL-TIME SCORES — one Firestore onSnapshot subscription per playoff week,
  // replacing the old fetch-once-then-poll-the-final-round pattern. Every round
  // (not just the final) updates in real time, with no interval timer.
  //
  // Why one listener PER WEEK with equality filters, rather than a single
  // `week >= firstPlayoffWeek` range listener: the per-week equality query
  // (league_id ==, season ==, week ==) is the exact shape App.jsx's liveWeek
  // subscription already runs in production, so its index provably exists. A
  // range query would need a new composite index and would fail silently (an
  // onSnapshot error log, blank leaderboard) until one was created.
  //
  // Each snapshot delivers the FULL doc set for its week; we rebuild that
  // week's keys wholesale (delete-then-refill by prefix) so score deletions
  // propagate — the same merge model finalRoundOnlyFetch used. Prefix matching
  // is unambiguous: keys are `w{week}_p...`, so `w1_` can never match `w10_...`.
  //
  // READ-COST NOTE: attaching a listener costs an initial snapshot read of that
  // week's docs (~180/week, ~720 with all four playoff weeks seeded) on every
  // mount of this tab — the old path served the initial load from the warm
  // season cache at 0 reads. This only runs during playoff weeks, on a tab
  // people visit briefly, so it's bounded; but it's a knob to revisit if the
  // Firestore read monitoring flags it (the fix would be lifting the
  // subscription into App.jsx's cache layer alongside liveWeek).
  //
  // The rounds history for retroactive per-week handicaps is a one-time fetch —
  // served from App.jsx's derived-rounds cache, and per-round handicaps only
  // change when a week is finalized, not per hole saved.
  useEffect(() => {
    if (!playoffWeeks.length) return;
    let cancelled = false;
    const season = leagueConfig?.year || new Date().getFullYear();

    if (fetchAllScores) {
      fetchAllScores().then(hist => { if (!cancelled) setAllRounds(hist); });
    }

    // Flip loading off once EVERY subscribed week has delivered its first
    // snapshot, so the board doesn't paint with only some rounds' scores.
    const received = new Set();
    const unsubs = playoffWeeks.map(wk =>
      db.subscribe(
        "league_hole_scores",
        [...LF, { field: "season", op: "==", value: season }, { field: "week", op: "==", value: wk.week }],
        (docs) => {
          if (cancelled) return;
          setScores(prev => {
            const next = { ...prev };
            const prefix = `w${wk.week}_`;
            for (const k of Object.keys(next)) {
              if (k.startsWith(prefix)) delete next[k];
            }
            docs.forEach(r => { next[`w${r.week}_p${r.player_id}_h${r.hole}`] = r.score; });
            return next;
          });
          received.add(wk.week);
          if (received.size === playoffWeeks.length) setLoading(false);
        }
      )
    );

    return () => {
      cancelled = true;
      unsubs.forEach(u => u && u());
    };
  }, [playoffWeeks, fetchAllScores, leagueConfig]);

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
      let totalNetToPar = 0;     // cumulative net-to-par over holes PLAYED — the ranking metric
      let totalHolesPlayed = 0;
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

      // Individual-tournament withdrawal is now driven ONLY by the explicit
      // _hindivwd sentinel the commissioner sets at finalize — NOT by _habsent.
      // That's the whole point of the makeup feature: an absent player who makes
      // up their individual round keeps accumulating; only an explicit
      // withdrawal drops them. Withdrawn players' played rounds stay on the
      // leaderboard as a record, but their total becomes WD and they sort to the
      // bottom. (The team match still uses _habsent for teammate substitution;
      // the two signals are fully decoupled now.)
      let withdrew = false;
      let wdRound = null;

      for (const wk of playoffWeeks) {
        const side = wk.side || 'front';

        // Resolve this week's individual-event round from the canonical read
        // resolver (theme.jsx): a live League-Night card, a makeup hole card, a
        // total-only makeup, or nothing — plus the explicit withdrawal flag.
        const ir = resolveIndivRound(scores, wk.week, p.id);

        if (ir.withdrawn && !withdrew) {
          // Sticky from the first withdrawn week — prior rounds remain as a
          // record; we stop accumulating here.
          withdrew = true;
          wdRound = wk.week;
        }
        if (withdrew) continue;

        // Nothing posted this week (no live card, no makeup) — no round to score.
        if (ir.mode === 'none') continue;

        const gross = ir.gross;
        const holesPlayed = ir.holesPlayed;
        const playedHoles = Object.keys(ir.holes).map(Number);

        // Per-round handicap — computed from history BEFORE this week, so it
        // matches what the player was playing off when they teed up. Makeup
        // rounds included: the round still belongs to wk.week, so its handicap is
        // the into-that-week index regardless of the day it was actually played.
        const roundHcp = handicapBeforeWeek(p, season, wk.week);

        // Side stroke-index / par arrays, with deterministic fallbacks when the
        // course doc lacks valid data for this side (sequential index order,
        // standard pars — never proration).
        const sideHcps = side === 'front' ? course?.frontHcps : course?.backHcps;
        const hcps = (Array.isArray(sideHcps) && sideHcps.length === 9)
          ? sideHcps
          : [1, 2, 3, 4, 5, 6, 7, 8, 9];
        const sidePars = side === 'front' ? course?.frontPars : course?.backPars;
        const pars = (Array.isArray(sidePars) && sidePars.length === 9)
          ? sidePars
          : [4, 4, 4, 3, 5, 4, 4, 3, 5];

        // RANKING METRIC: net-to-par over holes played (not raw net strokes), so
        // a mid-round live card reads comparably to a finished one. Integer
        // end-to-end (integer gross, pars, allocated strokes — no rounding), so
        // per-round values sum to the cumulative totals exactly.
        let parPlayed, signedStrokes;
        if (ir.totalOnly) {
          // Total-only makeup: a complete 9 with no per-hole detail. Strokes over
          // a full round always sum to |roundHcp| however they'd distribute, so
          // net-to-par collapses to gross - fullSidePar - roundHcp. holesPlayed
          // is already 9 from the resolver.
          parPlayed = pars.reduce((a, b) => a + b, 0);
          signedStrokes = roundHcp; // full allocation, sign already correct
        } else {
          // Live or makeup hole card: allocate strokes hardest-first via the
          // canonical buildStrokesMap and count only strokes landing on holes
          // actually played (same allocator as match play, Schedule dots, Stats).
          const strokeMap = buildStrokesMap(roundHcp, hcps);
          let strokesOnPlayed = 0;
          for (const h of playedHoles) strokesOnPlayed += strokeMap[h] || 0;
          // buildStrokesMap distributes |roundHcp|, so re-apply the sign: a plus
          // (negative) handicap gives strokes BACK.
          signedStrokes = roundHcp < 0 ? -strokesOnPlayed : strokesOnPlayed;
          parPlayed = 0;
          for (const h of playedHoles) parPlayed += pars[h] || 4;
        }
        const netToPar = gross - parPlayed - signedStrokes;

        totalGross += gross;
        totalNetToPar += netToPar;
        totalHolesPlayed += holesPlayed;
        roundsPlayed++;
        rounds.push({
          week: wk.week, date: wk.date, side, gross,
          netToPar,
          holesPlayed, nineHcp: roundHcp,
          // Cell markers: makeup = played another day; totalOnly = entered as a
          // bare gross (no per-hole detail, so it's absent from per-hole Stats).
          makeup: ir.mode === 'makeupHoles' || ir.mode === 'makeupTotal',
          totalOnly: ir.totalOnly,
        });
      }

      // team already found above (for teammate lookup during absent handling)
      return {
        playerId: p.id,
        name: p.name,
        displayName: shortName(p.name),
        teamName: team ? lastNamesOnly(team.name) : "",
        startNineHcp: startHcp,
        totalGross,
        totalNetToPar,
        totalHolesPlayed,
        roundsPlayed,
        rounds,
        withdrew,
        wdRound,
      };
    }).filter(p => p.roundsPlayed > 0 || playoffWeeks.length > 0);

    // Sort order: ACTIVE (played at least one round, not withdrawn) → WD → NO DATA.
    // Within ACTIVE, cumulative net-to-par low→high. Equal totals are GENUINE
    // TIES — no gross tiebreaker (standard golf tie handling); alphabetical
    // within a tied group purely for stable layout. Within WD and NO DATA,
    // alphabetical for the same reason.
    const bucket = (p) => p.withdrew ? 1 : p.roundsPlayed > 0 ? 0 : 2;
    board.sort((a, b) => {
      const ab = bucket(a);
      const bb = bucket(b);
      if (ab !== bb) return ab - bb;
      if (ab === 0 && a.totalNetToPar !== b.totalNetToPar) {
        return a.totalNetToPar - b.totalNetToPar;
      }
      return a.name.localeCompare(b.name);
    });

    // Golf-standard positions: walk the sorted active players, group consecutive
    // equal totals, and label tied groups with a T prefix. The next distinct
    // total resumes at its true index — e.g. totals [-2, -2, +1] rank T1, T1, 3
    // and [E, +1, +1, +3] rank 1, T2, T2, 4. WD and no-data players get no
    // position (posLabel stays undefined; the badge doesn't render for them).
    const actives = board.filter(p => bucket(p) === 0);
    actives.forEach((p, j) => {
      p.posRank = (j > 0 && p.totalNetToPar === actives[j - 1].totalNetToPar)
        ? actives[j - 1].posRank
        : j + 1;
    });
    const rankCounts = {};
    actives.forEach(p => { rankCounts[p.posRank] = (rankCounts[p.posRank] || 0) + 1; });
    actives.forEach(p => { p.posLabel = (rankCounts[p.posRank] > 1 ? "T" : "") + p.posRank; });

    return board;
  }, [players, teams, course, playoffWeeks, scores, allRounds, scoringRules, leagueConfig]);

  // WBC-style live movement arrows. When a streamed score reshuffles the board,
  // players who climbed get a green ▲ and players who dropped a red ▼; the marker
  // persists until the NEXT reshuffle. Keying the effect on the active players'
  // rank SIGNATURE (playerId:posRank pairs) — not on the leaderboard array — is
  // what gives that persistence: ordinary in-round score updates that don't move
  // anyone leave rankSig unchanged, so the effect doesn't re-run and the existing
  // arrows stay put. Positions compared are golf POSITIONS (posRank, tie-aware),
  // so a T3→T2 climb counts as up and alphabetical shuffling inside a tied group
  // never fabricates an arrow. WD / no-data players carry no position and are
  // excluded on both sides of the diff.
  const rankSig = leaderboard
    .filter(p => p.posLabel != null && !p.withdrew)
    .map(p => `${p.playerId}:${p.posRank}`)
    .join(",");
  useEffect(() => {
    const actives = leaderboard.filter(p => p.posLabel != null && !p.withdrew);
    const newMov = {};
    actives.forEach(p => {
      const prev = prevPositions.current[p.playerId];
      if (prev != null && prev !== p.posRank) newMov[p.playerId] = prev > p.posRank ? "up" : "down";
    });
    setMovements(newMov);
    const newPos = {};
    actives.forEach(p => { newPos[p.playerId] = p.posRank; });
    prevPositions.current = newPos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankSig]);

  if (loading && playoffWeeks.length > 0) {
    return <LoadingPanel subtitle="scores" />;
  }

  if (!playoffWeeks.length) {
    return <EmptyState icon="flag" title="No playoff rounds played yet" subtitle="The individual tournament runs alongside the playoff weeks." />;
  }

  // LIVE badge — the leaderboard now ALWAYS updates in real time via the
  // onSnapshot subscriptions above, so the badge no longer gates anything.
  // It simply signals that a playoff round is plausibly in progress right now:
  // some round is unlocked (not finalized) and its scheduled date has arrived.
  // No final-round-only logic, no prior-rounds-locked requirement.
  const isLive = playoffWeeks.some(wk => {
    if (wk.locked === true) return false;
    if (wk.date) {
      const year = leagueConfig?.year || new Date().getFullYear();
      if (!isScheduleDateAtOrPast(wk.date, year)) return false;
    }
    return true;
  });

  // To-par display convention (golf standard): under par renders with the
  // leading minus JS gives negative numbers ("-2"), over par gets an explicit
  // "+3", and level par is "E".
  const fmtToPar = (n) => n === 0 ? "E" : n > 0 ? `+${n}` : String(n);

  // Leaderboard grid column widths — shared between the column header and every
  // row so they stay perfectly aligned. Kept intentionally tight (vs the prior
  // 36px HCP/round columns and 14px side padding) to give the Player column more
  // room before names truncate: with up to four round columns the fixed columns
  // otherwise squeeze the name to just a few characters on narrow phones. The
  // Player column is flex:1, so every pixel trimmed here goes straight to the name.
  const POS_W = 30;   // rank badge cell (+4px over the badge for the ▲/▼ arrow gutter)
  const THRU_W = 30;  // "Thru" column ("F" or holes-completed count)
  const RND_W = 28;   // each R# column ("+3"/"-2"/"WD"/"E"/"–" all fit at FS.sm)
  const TOPAR_W = 44; // cumulative Total (to-par) column
  const PAD_X = 10;   // card / header horizontal padding

  // PGA-style "Thru": the round the field is currently on is the furthest week
  // anyone has posted a score in. Per player, Thru shows their progress in that
  // round ("F" once all 9 are in), or "–" if they haven't teed off in it yet.
  const currentRoundWeek = leaderboard.reduce(
    (mx, p) => p.rounds.reduce((m, r) => Math.max(m, r.week), mx), 0);

  return (
    <div style={{ padding: "0 2px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: FS.xs, color: K.t3 }}>
          Net stroke play · {totalRounds} round{totalRounds !== 1 ? "s" : ""} · All players
        </div>
        {isLive && (
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
              <span style={{ fontSize: FS.micro, fontWeight: FW.heavy, color: K.red, letterSpacing: .8 }}>LIVE</span>
            </div>
          </>
        )}
      </div>

      {/* Leaderboard */}
      <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
        {/* Column header */}
        <div style={{ display: "flex", padding: `0 ${PAD_X}px`, fontSize: FS.micro, fontWeight: FW.bold, color: K.logoBright, textTransform: "uppercase", letterSpacing: .8 }}>
          <div style={{ width: POS_W }} />
          <div style={{ flex: 1, minWidth: 0 }}>Player</div>
          <div style={{ width: TOPAR_W, textAlign: "right" }}>Total</div>
          <div style={{ width: THRU_W, textAlign: "center" }}>Thru</div>
          {Array.from({ length: totalRounds }, (_, i) => (
            <div key={i} style={{ width: RND_W, textAlign: "center" }}>R{i + 1}</div>
          ))}
        </div>

        {leaderboard.map((p, i) => {
          // Payout is 1st place only, so 1st is the ONLY chip that reads
          // differently — gold, tie-aware (everyone sharing 1st/T1 gets it). Every
          // other position (2nd through last) is visually identical: no money, no
          // distinction. Keys off the golf POSITION (posRank), not the list index.
          const mc = p.posRank === 1 ? K.gold : K.logoBright;
          const hasRounds = p.roundsPlayed > 0;
          const isWD = p.withdrew;
          // Only active (non-WD) players with rounds get a rank badge; WD players
          // are explicitly ineligible for ranking. posLabel is only assigned to
          // active players, so it doubles as the eligibility check.
          const showRank = hasRounds && !isWD && p.posLabel != null;

          // Live movement for this player's rank (set only for active players).
          const mov = showRank ? movements[p.playerId] : null;

          // Thru — progress in the field's current round (see currentRoundWeek).
          // WBC-style live emphasis: a player mid-round (1–8 holes in the current
          // round) is highlighted in the maize accent so the eye lands on who's
          // still out on the course; a finished "F" reads secondary, and "–"
          // (hasn't teed off / WD) stays dimmed.
          const curRound = currentRoundWeek ? p.rounds.find(r => r.week === currentRoundWeek) : null;
          const thru = isWD ? "–" : curRound ? (curRound.holesPlayed >= 9 ? "F" : String(curRound.holesPlayed)) : "–";
          const thruLive = !isWD && curRound && curRound.holesPlayed > 0 && curRound.holesPlayed < 9;
          const thruColor = thruLive ? K.act : (!isWD && curRound && curRound.holesPlayed >= 9) ? K.t2 : K.t3;

          // Tapping the name opens that player's current-round scorecard — their
          // most recent round (curRound if they're in the current round, else the
          // latest week they posted). Null when they haven't played, so the name
          // stays inert rather than opening an empty card.
          const scWk = curRound ? currentRoundWeek : (p.rounds.length ? p.rounds.reduce((m, r) => Math.max(m, r.week), 0) : null);

          return (
            <div key={p.playerId} style={{
              display: "flex", alignItems: "center", background: K.card,
              borderRadius: CARD_RADIUS, border: `1px solid ${p.posRank === 1 && showRank ? K.act + "30" : K.bdr}`,
              padding: `10px ${PAD_X}px`,
              opacity: isWD ? 0.55 : 1,
            }}>
              {/* Rank — golf-standard tie labels: T1/T2/… for tied groups, plain
                  number otherwise. minWidth + padding (instead of fixed width)
                  keeps 3-character labels like "T10" from clipping. */}
              <div style={{ width: POS_W, flexShrink: 0, position: "relative" }}>
                {showRank && (
                  <div style={{
                    minWidth: 22, height: 22, borderRadius: 6, padding: "0 3px",
                    boxSizing: "border-box",
                    background: p.posRank === 1 ? mc + "20" : K.logoBright + "20",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: FS.xs, fontWeight: FW.heavy, color: mc,
                    border: p.posRank === 1 ? `1.5px solid ${mc}40` : `1.5px solid ${K.logoBright}30`,
                  }}>{p.posLabel}</div>
                )}
                {/* Live ▲/▼ — sits in the gutter to the right of the badge (absolutely
                    positioned so it never squeezes the badge or the Player column).
                    Green ▲ for a climb, red ▼ for a drop; cleared on the next reshuffle. */}
                {mov && (
                  <span style={{
                    position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
                    fontSize: 8, lineHeight: 1, fontWeight: FW.heavy,
                    color: mov === "up" ? K.grn : K.red,
                  }}>{mov === "up" ? "▲" : "▼"}</span>
                )}
              </div>

              {/* Name — tap to open this player's current-round scorecard. */}
              <div
                onClick={scWk ? () => setScPlayer({ pid: p.playerId, week: scWk }) : undefined}
                style={{ flex: 1, minWidth: 0, cursor: scWk ? "pointer" : "default" }}
              >
                <div style={{ fontSize: FS.sm, fontWeight: FW.bold, color: K.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.displayName}
                </div>
              </div>

              {/* Total — cumulative net-to-par (E/+3/-2), placed right after the
                  name to match a PGA leaderboard. Red when under par; integer
                  end-to-end so it's the exact sum of the round cells. WD players
                  show "WD" in red. */}
              <div style={{
                width: TOPAR_W, textAlign: "right", fontSize: FS.base, fontWeight: FW.heavy,
                fontFamily: "'League Spartan', sans-serif",
                color: isWD ? K.red : hasRounds ? (p.totalNetToPar < 0 ? K.red : K.t1) : K.t3,
              }}>
                {isWD ? "WD" : hasRounds ? fmtToPar(p.totalNetToPar) : "–"}
              </div>

              {/* Thru — "F" when the current round's 9 is complete, otherwise
                  holes played; "–" if not teed off in the current round. */}
              <div style={{ width: THRU_W, textAlign: "center", fontSize: FS.sm, fontWeight: thruLive ? FW.heavy : FW.semibold, color: thruColor }}>
                {thru}
              </div>

              {/* Round scores — one cell per CONFIGURED round, so the columns stay
                  aligned with the header even before later rounds are seeded. An
                  unseeded round shows a dash; a seeded round with no score for this
                  player also shows a dash (same visual treatment — they haven't
                  posted a score either way). The round the player withdrew in is
                  marked "WD" in red. Cells show the round's NET-TO-PAR (E/+3/-2)
                  over holes played, so an in-progress round reads comparably to a
                  finished one. Under-par cells render red per golf-scoreboard
                  convention. */}
              {Array.from({ length: totalRounds }, (_, wi) => {
                const wk = playoffWeeks[wi];
                const round = wk ? p.rounds.find(r => r.week === wk.week) : null;
                const isWDRound = isWD && wk && wk.week === p.wdRound;
                return (
                  <div key={wi} style={{
                    width: RND_W, textAlign: "center", fontSize: FS.sm,
                    fontWeight: isWDRound ? FW.heavy : FW.semibold,
                    color: isWDRound ? K.red : round ? (round.netToPar < 0 ? K.red : K.t1) : K.t3 + "40",
                  }}>
                    {isWDRound ? "WD" : round ? (
                      <>
                        {fmtToPar(round.netToPar)}
                        {round.makeup && (
                          <sup style={{ fontSize: FS.micro, color: K.act, fontWeight: FW.bold, marginLeft: 1 }}>
                            {round.totalOnly ? "t" : "m"}
                          </sup>
                        )}
                      </>
                    ) : "–"}
                  </div>
                );
              })}
            </div>
          );
        })}
        {leaderboard.some(p => p.rounds.some(r => r.makeup)) && (
          <div style={{ padding: "8px 4px 2px", fontSize: FS.micro, color: K.t3, display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <span><sup style={{ color: K.act, fontWeight: FW.bold }}>m</sup> makeup round</span>
            <span><sup style={{ color: K.act, fontWeight: FW.bold }}>t</sup> makeup (total only)</span>
          </div>
        )}
      </div>

      {/* Current-round scorecard popout — reuses the shared match scorecard
          framework (SharedScorecard + Popup) for a single player: same score/
          stroke reading (lib/matchCalc) and into-week handicaps (buildHistorical-
          Players) as the team match cards, so stroke dots and net line match
          everywhere. Stroke play, so no opponent / match rows. */}
      {scPlayer && (() => {
        const player = players.find(pl => pl.id === scPlayer.pid);
        const wk = schedule.find(s => s.week === scPlayer.week);
        if (!player || !wk || !course) return null;

        const closeBtn = (
          <button onClick={() => setScPlayer(null)} style={{ display: "block", width: "calc(100% - 20px)", margin: "10px auto 0", padding: "9px", background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 8, color: K.t2, fontSize: FS.sm, fontWeight: FW.semibold, cursor: "pointer", letterSpacing: .4 }}>Close</button>
        );

        if (!allRounds) {
          return (
            <Popup onClose={() => setScPlayer(null)} maxWidth={420} padding={10} outerPadding={12}>
              <LoadingPanel size="compact" />
              {closeBtn}
            </Popup>
          );
        }

        const side = wk.side || getWeekSide(scPlayer.week);
        const pars = side === 'front' ? course.frontPars : course.backPars;
        const hcps = side === 'front' ? course.frontHcps : course.backHcps;
        if (!Array.isArray(pars) || !Array.isArray(hcps)) return null;

        const season = leagueConfig?.year || new Date().getFullYear();
        const historicalPlayers = buildHistoricalPlayers({
          players, week: scPlayer.week, season,
          allRoundsByPid: allRounds, scoringRules, course,
        });

        // Teammate resolves the absent model (present teammate plays both slots),
        // matching how this player's round total was computed on the leaderboard.
        const team = teams.find(t => t.player1 === scPlayer.pid || t.player2 === scPlayer.pid);
        const teammate = team ? (team.player1 === scPlayer.pid ? team.player2 : team.player1) : null;
        const t1Pids = [scPlayer.pid];
        const t2Pids = teammate ? [teammate] : [];

        const getInitials = (pid) => { const pl = players.find(x => x.id === pid); return pl ? pl.name.split(' ').map(n => n[0]).join('') : "?"; };
        const getHcp = (pid) => { const hp = historicalPlayers.find(x => x.id === pid); return hp ? Math.round(hp.handicapIndex || 0) : 0; };
        const isAbsent = (pid) => scores[`w${scPlayer.week}_p${pid}_habsent`] === 1;
        const getStrokes = (pid, h) => getStrokesForHole({ pid, h, players: historicalPlayers, hcps, week: scPlayer.week, holeScores: scores, t1Pids, t2Pids });
        const getScore = (pid, h) => readScoreEffective({ pid, h, week: scPlayer.week, holeScores: scores, t1Pids, t2Pids, pars, hcps, players: historicalPlayers });

        const sc = SharedScorecard({
          pars, side, hcps, team1Pids: t1Pids, team2Pids: t2Pids,
          getScore, getStrokes, getHcp, getInitials, isAbsent,
          variant: "allMatches", showTotals: true, showMatchRow: false, matchGrn: K.matchGrn,
        });

        const roundIdx = playoffWeeks.findIndex(w => w.week === scPlayer.week);
        const roundLabel = roundIdx >= 0 ? `Round ${roundIdx + 1}` : `Week ${scPlayer.week}`;

        return (
          <Popup onClose={() => setScPlayer(null)} maxWidth={420} padding={10} outerPadding={12}>
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <div style={{ fontSize: FS.base, fontWeight: FW.heavy, color: K.t1, fontFamily: "'League Spartan', sans-serif" }}>{shortName(player.name)}</div>
              <div style={{ fontSize: FS.micro, fontWeight: FW.bold, color: K.t3, textTransform: "uppercase", letterSpacing: .6 }}>{roundLabel} · {side === 'front' ? 'Front 9' : 'Back 9'}</div>
            </div>
            <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden" }}>
              <sc.HoleRow />
              <sc.ParRow />
              <sc.HcpRow />
              {t1Pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
              <sc.TeamNetRow pids={t1Pids} isTeam1Side={true} />
            </div>
            {closeBtn}
          </Popup>
        );
      })()}
    </div>
  );
}


// ════════════════════════════════════════════════════════════
//  MAIN STANDINGS VIEW
// ════════════════════════════════════════════════════════════
export default function StandingsView({ teams, players, matchResults, leagueConfig, schedule, fetchSeasonScores, course, fetchWeekScores, scoringRules, fetchAllScores, saveMatchResult, dataLoaded }) {
  // Note: no local isRecord flag anymore — the standings rows render the
  // same column set (W-L-T · Pts/HW) in both modes; standingsMethod only
  // affects the sort, which buildStandingsForSeed receives as a string.
  const [expanded, setExpanded] = useState(null);
  const [expandedResult, setExpandedResult] = useState(null);
  const [weekScores, setWeekScores] = useState({});
  // Season-wide rounds keyed by playerId — used by renderMiniScorecard
  // and by autoHeal for retroactive handicap reconstruction. Populated
  // once on mount via fetchAllScores (which is cached App-side, so this
  // is cheap). Null while loading; renderMiniScorecard falls back to
  // startingHandicapIndex / current hcp until it populates.
  const [allRounds, setAllRounds] = useState(null);
  const expandedRef = useRef(null);

  useEffect(() => {
    if (!fetchAllScores) return;
    let cancelled = false;
    fetchAllScores().then(hist => {
      if (cancelled) return;
      setAllRounds(hist);
    });
    return () => { cancelled = true; };
  }, [fetchAllScores]);

  // Determine if playoffs have started (any playoff week has matches)
  const playoffsStarted = useMemo(() =>
    schedule.some(wk => wk.isPlayoff === true && wk.matches?.length > 0 && !wk.rainedOut),
    [schedule]
  );

  // Determine whether playoffs are configured at all — used to gate the
  // Postseason primary toggle (audit issue #19). During an early-season
  // period when no playoff weeks have been added to the schedule yet,
  // showing a Postseason toggle is just a dead-end click. Hide it entirely
  // (the page renders standings with no toggle bar). Once the commissioner
  // configures playoff weeks (Admin → Schedule), the Regular Season /
  // Postseason toggle appears (gated below by `showPostseason`).
  const hasPlayoffs = useMemo(() =>
    schedule.some(wk => wk.isPlayoff === true && !wk.rainedOut),
    [schedule]
  );

  const hasIndividualEvent = leagueConfig?.individualEvent !== false; // default on
  // Default tab on first mount, strictly aligned to season phase. The
  // switchover point is the START OF THE POSTSEASON, defined as "the final
  // regular-season week has been finalized (locked)". Not "a playoff round
  // has been played" — the bracket is the thing everyone wants to look at the
  // moment seeding is final, before a single playoff shot is hit.
  //   - "bracket" (Postseason) → playoff weeks exist AND the last regular-
  //     season week is locked. Stays the default through the playoffs and
  //     after they conclude (the champion/podium view is the season's payoff).
  //   - "standings" (Regular Season) → everything before that: any week of the
  //     regular season (including the seeded weeks), and any league that has
  //     no playoff weeks configured at all.
  // Note we key off the LAST regular-season week specifically rather than
  // `every(locked)` — a mid-season week left unlocked for a makeup shouldn't
  // hold the postseason default hostage once the finale is in the books.
  const defaultView = useMemo(() => {
    const wks = schedule || [];
    const playoffWks = wks.filter(wk => wk.isPlayoff === true && !wk.rainedOut);
    if (!playoffWks.length) return "standings";
    const regWks = wks
      .filter(wk => wk.isPlayoff !== true && !wk.rainedOut && (wk.matches?.length || 0) > 0)
      .sort((a, b) => a.week - b.week);
    // Guard against [].every()-style vacuous truth: no regular-season weeks
    // on the board means the season hasn't been built yet, not that it's over.
    if (!regWks.length) return "standings";
    const finalRegWeek = regWks[regWks.length - 1];
    return finalRegWeek.locked === true ? "bracket" : "standings";
  }, [schedule]);
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

  // Remember which Postseason sub-view ("bracket" | "individual") the user
  // last looked at, so toggling Regular Season → Postseason restores their
  // prior sub-selection instead of always snapping back to Team Bracket.
  // Defaults to "bracket" (Team Bracket is the primary postseason view).
  const lastPostSub = useRef("bracket");
  useEffect(() => {
    if (view === "bracket" || view === "individual") lastPostSub.current = view;
  }, [view]);

  // Safety guard: if `view` ends up pointing at a tab that no longer
  // exists (e.g., user picked Postseason, then commissioner removed all
  // playoff weeks), bounce to "standings". Otherwise the page renders
  // an empty branch with no nav back to a valid view. The Individual
  // tournament only runs alongside playoff weeks, so it's only valid
  // when playoffs exist.
  useEffect(() => {
    const validIds = new Set([
      "standings",
      ...(hasPlayoffs ? ["bracket", ...(hasIndividualEvent ? ["individual"] : [])] : []),
    ]);
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
  // Playoff-week scorecards badge from the frozen playoff seeds (full regular
  // season), while seeded regular-season weeks keep the round-robin seedMap.
  const playoffSeedMap = useMemo(
    () => buildPlayoffSeedMap(teams, matchResults, schedule, leagueConfig),
    [teams, matchResults, schedule, leagueConfig]
  );
  const seedForWeek = (wk, id) =>
    (wk?.isPlayoff === true ? playoffSeedMap[id] : seedMap[id]) || null;

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
      playoffSeedMap,
      healedIds: healedRef.current,
      saveMatchResult,
      // Pass season-wide rounds + current season so autoHeal can compute
      // each player's handicap AS OF the historical week. Without these
      // the function bails — which is by design: running it with
      // current handicaps caused the retroactive-standings bug.
      allRoundsByPid: allRounds,
      season: leagueConfig?.year || new Date().getFullYear(),
    });
  }, [matchResults, weekScores, course, scoringRules, leagueConfig, saveMatchResult, schedule, teams, players, seedMap, playoffSeedMap, allRounds]);

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
    // reflects what they had GOING INTO this week. Single source of truth lives
    // in theme.buildHistoricalPlayers so Schedule and Stats produce identical
    // scorecards/match statuses — using today's handicaps in the render shows
    // wrong stroke dots and wrong hcp labels for any historical match.
    const currentSeason = leagueConfig?.year || new Date().getFullYear();
    const historicalPlayers = buildHistoricalPlayers({
      players,
      week: mr.week,
      season: currentSeason,
      allRoundsByPid: allRounds,
      scoringRules,
      course,
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
        <sc.TeamLabelRow name={dispT1Obj?.name} seed={showSeedsLocal ? seedForWeek(wk, dispT1Obj?.id) : null} />
        {dispT1Pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
        <sc.TeamNetRow pids={dispT1Pids} isTeam1Side={true} />
        <sc.MatchRow />
        <sc.TeamLabelRow name={dispT2Obj?.name} seed={showSeedsLocal ? seedForWeek(wk, dispT2Obj?.id) : null} />
        {dispT2Pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
        <sc.TeamNetRow pids={dispT2Pids} isTeam1Side={false} />
      </div>
    );
  };

  const gt = (id) => teams.find(t => t.id === id);
  if (dataLoaded && !dataLoaded.teams) return <SkeletonList count={10} height={60} />;
  if (!teams.length) return <EmptyState icon="trophy" title="No teams yet" subtitle="Commissioner needs to set up teams." />;

  // Right-cluster column styles — shared by record and points modes so the
  // column set is identical regardless of standingsMethod (only the sort
  // differs). Two columns: Pts (the primary sort stat, so it leads), then a
  // stacked W-L-T-over-HW pair that mirrors the two-line name stack (so row
  // height is unchanged).
  //
  // Widths are em-based rather than px so the columns scale with the text
  // when a user's system font scale inflates font rendering without
  // inflating px layout (Android WebView textZoom does exactly this; iOS
  // page zoom scales both so it's unaffected either way). The header cells
  // below wrap their micro-size label in a NAME_SIZE-font container with
  // the same em minWidth, keeping header/row alignment at any scale. The
  // Team column's ellipsis is then the only thing that degrades on
  // large-font settings, which is the right failure mode.
  //
  // Type scale is deliberately minimal: NAME_SIZE for names, W-L-T, and
  // Pts (hierarchy via weight/color, not size), FS.xs for HW, FS.micro for
  // the header. The old fixed 18/6px W-L-T cell grid clipped 2-digit
  // values at large scales and wasted width at normal scale.
  const ptsColStyle = { minWidth: "2.4em", textAlign: "center", fontFamily: "'League Spartan', sans-serif", fontSize: NAME_SIZE, fontWeight: FW.heavy, color: K.t1 };
  const wltHwStyle = { minWidth: "3.4em", textAlign: "center", fontFamily: "'League Spartan', sans-serif", fontSize: NAME_SIZE, lineHeight: 1.2 };

  // ── Toggle structure ──────────────────────────────────────────────
  // PRIMARY toggle: Regular Season | Postseason.
  //   - "Regular Season" → standings view (always meaningful).
  //   - "Postseason"     → playoff content. Only surfaced once the league
  //     actually has playoff weeks configured (hasPlayoffs); otherwise the
  //     primary toggle bar collapses and only standings shows.
  // SECONDARY toggle (Postseason only): Team Bracket | Individual. The
  //   individual tournament runs concurrently with the team playoff bracket,
  //   so it lives nested under Postseason rather than as a top-level tab.
  //   Only shown when the league runs an individual event alongside playoffs.
  const inPostseason = view === "bracket" || view === "individual";
  const showPostseason = hasPlayoffs;                       // primary toggle gate
  const showSubToggle = inPostseason && hasPlayoffs && hasIndividualEvent;

  // Jump into Postseason, restoring the user's last sub-view (or Team Bracket
  // by default; falls back to Individual if no bracket exists for any reason).
  const goPostseason = () => {
    const sub = lastPostSub.current === "individual" && hasIndividualEvent
      ? "individual"
      : (hasPlayoffs ? "bracket" : (hasIndividualEvent ? "individual" : "standings"));
    pickTab(sub);
  };

  // Shared segmented-control button style. `primary` = the larger top-level
  // toggle; secondary (sub) buttons are slightly smaller to read as nested.
  const segBtn = (active, primary = true) => ({
    padding: primary ? "7px 14px" : "6px 12px",
    borderRadius: 6, border: "none", cursor: "pointer",
    background: active ? K.card : "transparent",
    color: active ? K.t1 : K.t3,
    fontSize: primary ? 11 : 10, fontWeight: FW.bold, letterSpacing: .8,
    boxShadow: active ? `0 1px 3px ${K.bdr}40` : "none",
    transition: "all .15s", whiteSpace: "nowrap",
  });

  return (
    <div style={{ padding: "0 2px" }}>
      {/* PRIMARY toggle — Regular Season | Postseason */}
      {showPostseason && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: showSubToggle ? 8 : 14 }}>
          <div style={{ display: "inline-flex", background: K.inp, borderRadius: 8, border: `1px solid ${K.bdr}`, padding: 3 }}>
            <button onClick={() => pickTab("standings")} style={segBtn(!inPostseason)}>REGULAR SEASON</button>
            <button onClick={goPostseason} style={segBtn(inPostseason)}>POSTSEASON</button>
          </div>
        </div>
      )}

      {/* SECONDARY toggle — Team Bracket | Individual (Postseason only) */}
      {showSubToggle && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <div style={{ display: "inline-flex", background: K.inp, borderRadius: 8, border: `1px solid ${K.bdr}`, padding: 3 }}>
            <button onClick={() => pickTab("bracket")} style={segBtn(view === "bracket", false)}>TEAM BRACKET</button>
            <button onClick={() => pickTab("individual")} style={segBtn(view === "individual", false)}>INDIVIDUAL</button>
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
          <IndividualEventView players={players} teams={teams} schedule={schedule} course={course} leagueConfig={leagueConfig} fetchAllScores={fetchAllScores} scoringRules={scoringRules} />
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
              Widths: Pos 36 · Change 22 · Team flex · Pts 2.4em ·
              W-L-T/HW 3.4em (stacked label, mirrors the stacked pair in
              the rows). Padding mirrors the row's "10px 10px" (tightened
              from 14 to maximize Team width on small screens). The Change
              column stays unlabeled — the ▲/▼ indicator below is
              self-evident, and a header label there would crowd the rank
              badge. */}
          <div style={{
            display: "flex", alignItems: "center", width: "100%",
            padding: "4px 10px", marginBottom: -2,
            fontSize: FS.micro, fontWeight: FW.bold, color: K.t3,
            letterSpacing: 1, textTransform: "uppercase",
          }}>
            <div style={{ width: 36, flexShrink: 0, textAlign: "center" }}>Pos</div>
            <div style={{ width: 22, flexShrink: 0 }} />
            {/* Team header is left-aligned to sit over the left-aligned
                stacked last names in the rows below (it previously
                centered, which left it floating over nothing). */}
            <div style={{ flex: 1, textAlign: "left" }}>Team</div>
            {/* Each header cell wraps its micro label in a NAME_SIZE-font
                container so the em minWidths compute against the same font
                size as the row cells — header and rows stay aligned even
                under system font scaling. */}
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
              <div style={{ fontSize: NAME_SIZE, minWidth: "2.4em", textAlign: "center" }}>
                <span style={{ fontSize: FS.micro }}>Pts</span>
              </div>
              <div style={{ fontSize: NAME_SIZE, minWidth: "3.4em", textAlign: "center", lineHeight: 1.2 }}>
                <span style={{ fontSize: FS.micro }}>W-L-T<br />HW</span>
              </div>
            </div>
          </div>
          {standings.map((s, i) => {
            const team = gt(s.teamId); if (!team) return null;
            const mc = i === 0 ? K.gold : i === 1 ? K.silver : i === 2 ? K.bronze : K.logoBright;
            const isExp = expanded === s.teamId;
            const results = isExp ? getTeamResults(s.teamId) : [];
            const curPos = i + 1;
            // Displayed Pts comes from the canonical recordPoints helper in
            // theme.jsx (2 per win, 1 per tie) — the same function the
            // record-mode sort in buildStandingsForSeed uses, so the Pts
            // column and the row order can never disagree.
            const recordPts = recordPoints(s);
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
                      fontSize: RANK_BADGE_FONT, fontWeight: FW.heavy, color: mc,
                      border: i < 3 ? `1.5px solid ${mc}40` : `1.5px solid ${K.logoBright}30`,
                    }}>{curPos}</div>
                  </div>
                  {/* Change column — week-over-week position movement.
                      Reserves the same width whether or not there's a value
                      so team names line up cleanly across all rows. */}
                  <div style={{ width: 22, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                    {posChange !== null && posChange !== 0 && (
                      <div style={{ fontSize: FS.xs, fontWeight: FW.bold, color: posChange > 0 ? K.matchGrn : K.red, display: "flex", alignItems: "baseline", gap: 1, lineHeight: 1 }}>
                        <span style={{ fontSize: FS.micro, lineHeight: 1 }}>{posChange > 0 ? "▲" : "▼"}</span>
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
                  {/* Right cluster — identical in record and points modes;
                      standingsMethod only changes the sort. Pts leads as
                      the primary sort stat (NAME_SIZE, heavy, K.t1); the
                      stacked pair follows with W-L-T at FW.medium in K.t2
                      over HW, the tiebreaker, at FS.xs in K.hcpBlue. */}
                  <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0 }}>
                    <div style={ptsColStyle}>{recordPts}</div>
                    <div style={wltHwStyle}>
                      <div style={{ fontWeight: FW.medium, color: K.t2, fontVariantNumeric: "tabular-nums" }}>{s.w}-{s.l}-{s.t}</div>
                      <div style={{ fontSize: FS.xs, fontWeight: FW.bold, color: K.hcpBlue }}>{s.hw}</div>
                    </div>
                  </div>
                  {/* Chevron column removed — the entire row is a button so
                      tappability is implicit, and the 26px it occupied is
                      better given to the Team column on small screens. */}
                </button>

                {isExp && (
                  <div ref={expandedRef} style={{ background: K.inp, border: `1px solid ${i === 0 ? K.act + '30' : K.bdr}`, borderTop: "none", borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`, padding: "8px 10px" }}>
                    <div style={{ display: "flex", padding: "5px 8px", fontSize: FS.micro, color: K.logoBright, fontWeight: FW.bold, textTransform: "uppercase", letterSpacing: .8 }}>
                      <div style={{ width: 14, flexShrink: 0 }} />
                      <div style={{ width: 24, flexShrink: 0 }}>Wk</div>
                      <div style={{ width: 48, flexShrink: 0 }}>Date</div>
                      <div style={{ flex: 1 }}>Opponent</div>
                      <div style={{ width: 58, flexShrink: 0, textAlign: "right" }}>Result</div>
                      <div style={{ width: 28, flexShrink: 0, textAlign: "right" }}>HW</div>
                    </div>
                    {results.length === 0 ? (
                      <div style={{ padding: "10px 8px", fontSize: FS.sm, color: K.t3, fontStyle: "italic" }}>No matches played yet</div>
                    ) : results.map((r, ri) => {
                      if (r.rainedOut) {
                        return (
                          <div key={ri} style={{ display: "flex", alignItems: "center", padding: "7px 8px", borderTop: `1px solid ${K.bdr}30`, fontSize: FS.sm, opacity: 0.5 }}>
                            <div style={{ width: 14, flexShrink: 0 }} />
                            <div style={{ width: 24, flexShrink: 0, color: K.t3, fontSize: FS.xs }}>{r.week}</div>
                            <div style={{ width: 48, flexShrink: 0, color: K.t3, fontSize: FS.xs }}>{r.date || "—"}</div>
                            <div style={{ flex: 1, color: K.warn, fontWeight: FW.semibold }}>RAIN OUT</div>
                            <div style={{ width: 58, flexShrink: 0 }} />
                            <div style={{ width: 28, flexShrink: 0 }} />
                          </div>
                        );
                      }
                      const resKey = `${s.teamId}_${r.week}`;
                      const isResExp = expandedResult === resKey;
                      return (
                        <div key={ri}>
                          <button onClick={() => toggleResultExpand(s.teamId, r.week)} style={{ display: "flex", alignItems: "center", padding: "7px 8px", fontSize: FS.sm, width: "100%", background: "transparent", border: "none", borderTop: `1px solid ${K.bdr}30`, cursor: "pointer", textAlign: "left" }}>
                            <div style={{ width: 14, flexShrink: 0, color: K.t3, fontSize: FS.micro }}>{isResExp ? "▾" : "›"}</div>
                            <div style={{ width: 24, flexShrink: 0, color: K.t3, fontSize: FS.xs }}>{r.week}</div>
                            <div style={{ width: 48, flexShrink: 0, color: K.t3, fontSize: FS.xs }}>{r.date || "—"}</div>
                            <div style={{ flex: 1, color: K.t2, fontWeight: FW.medium }}>{r.oppName}</div>
                            <div style={{ width: 58, flexShrink: 0, display: "flex", justifyContent: "flex-end", alignItems: "center", fontWeight: FW.bold, fontSize: FS.xs, color: r.result === "W" ? K.matchGrn : r.result === "L" ? K.red : K.t2 }}>
                              {r.result === "T" || r.rainedOut ? (
                                <span>{r.resultDisplay}</span>
                              ) : (
                                <>
                                  <span style={{ width: 14, textAlign: "right" }}>{r.result}</span>
                                  <span style={{ width: 34, textAlign: "right" }}>{r.matchResult?.matchResultText || `${r.myPts}-${r.oppPts}`}</span>
                                </>
                              )}
                            </div>
                            <div style={{ width: 28, flexShrink: 0, textAlign: "right", color: K.hcpBlue, fontWeight: FW.bold }}>{r.holesWon}</div>
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
