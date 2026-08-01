// ══════════════════════════════════════════════════════════════════
//  IndividualLeaderboard — the individual net stroke-play board
// ══════════════════════════════════════════════════════════════════
//
// Extracted from Standings.jsx so BOTH surfaces render the same board:
//   • Standings → Postseason → INDIVIDUAL   (the full-page view)
//   • Scoring → trophy button                (a popup, mid-round)
//
// It deliberately does NOT live in Standings.jsx and get imported from there.
// Standings is a lazy-loaded route chunk; importing it from Scoring would drag
// the entire Standings page into Scoring's chunk — the exact regression that
// pulling SharedScorecard out of Scoring.jsx fixed (see that file's header).
//
// Presentation only: `scores`, `allRounds` and `loading` are supplied by the
// caller (see lib/useIndividualScores.js). That split is what lets the popup
// open for ~zero Firestore reads while the page view keeps its live behavior —
// the component itself has no idea where the data came from.
//
// Everything below the props boundary is the original view, unchanged: the
// net/gross lens, live position movement arrows, column sorting, the
// per-player expandable scorecard, and the rank/WD bucketing.

import { useState, useMemo, useRef, useEffect } from "react";
import { K, EmptyState, getWeekSide, LIST_GAP, CARD_RADIUS, calcPlayerHcp, lastNamesOnly,
  resolveIndivRound, LoadingPanel, buildHistoricalPlayers, FS, FW } from "../theme";
import { SharedScorecard } from "./SharedScorecard";
import { buildStrokesMap } from "../lib/matchCalc";
// computeRoundLine is the same per-round calc the leaderboard totals use, so
// the number printed on an expanded card can't drift from the row above it.
import { computeRoundLine } from "../lib/indivGroups";

// ══════════════════════════════════════════════════════════════════\n//  IndividualRoundCard — one golfer's round, as the event scored it\n// ══════════════════════════════════════════════════════════════════\n//\n// Exported (rather than living as a closure inside the board) so the\n// absent-but-made-up case can be tested directly — it's reachable in the UI\n// only by expanding a row, which is internal state.\n//\n// Inline scorecard panel for an expanded player row.
//
// This reads the INDIVIDUAL round — the same resolveIndivRound the row's own
// total is computed from — and nothing else. It previously went through
// readScoreEffective/getStrokesForHole with the player's teammate supplied as
// the opposing side, which drags in the TEAM match's absent-substitution rule:
// when a golfer is marked absent from their match, their present teammate
// "plays both slots" and the absent golfer's cells resolve to the teammate's
// scores. So a golfer who missed League Night and made up their individual
// round later showed the correct makeup total on the row and their
// teammate's card underneath it, in absent-red, disagreeing with itself.
//
// There is no team in the individual event, so no substitution applies. A
// golfer either posted a round (live card, makeup card, or a total-only
// makeup) or they didn't.
export function IndividualRoundCard({
  pid, week, schedule, course, players, scoringRules, leagueConfig, allRounds, scores,
  // Round selection. When more than one round is on offer the card's own
  // heading becomes the picker — no separate control row above the scorecard,
  // which on a phone is the difference between seeing the whole card and not.
  roundOptions = null, selected = null, onSelect = null,
  // Uncontrolled by default; pass menuOpen to drive it from outside. The
  // menu's contents are otherwise unreachable from a static render, which is
  // where the "only posted rounds are offered" rule gets verified.
  menuOpen: menuOpenProp,
}) {
  const [menuOpenState, setMenuOpenState] = useState(false);
  const menuOpen = menuOpenProp ?? menuOpenState;
  const setMenuOpen = (v) => setMenuOpenState(typeof v === "function" ? v(menuOpen) : v);
  const wk = schedule.find(s => s.week === week);
  if (!wk || !course) return null;
  if (!allRounds) return <LoadingPanel size="compact" subtitle="scores" />;

  const side = wk.side || getWeekSide(week);
  const pars = side === 'front' ? course.frontPars : course.backPars;
  const hcps = side === 'front' ? course.frontHcps : course.backHcps;
  if (!Array.isArray(pars) || !Array.isArray(hcps)) return null;

  const season = leagueConfig?.year || new Date().getFullYear();
  const historicalPlayers = buildHistoricalPlayers({
    players, week, season, allRoundsByPid: allRounds, scoringRules, course,
  });

  const getInitials = (x) => { const pl = players.find(pp => pp.id === x); return pl ? pl.name.split(' ').map(n => n[0]).join('') : "?"; }
  const getHcp = (x) => { const hp = historicalPlayers.find(pp => pp.id === x); return hp ? Math.round(hp.handicapIndex || 0) : 0; }

  const ir = resolveIndivRound(scores, week, pid);
  const roundHcp = getHcp(pid);
  // computeRoundLine is the same calc behind the row's per-round number, so
  // the figure printed on the card can't drift from the one above it.
  const line = computeRoundLine({ ir, pars, hcps, roundHcp });
  const toPar = (n) => n > 0 ? `+${n}` : n === 0 ? "E" : `${n}`;

  const playoffWeeks = (schedule || [])
    .filter(w => w.isPlayoff === true && !w.rainedOut && w.matches?.length > 0)
    .sort((a, b) => a.week - b.week);
  const roundIdxEarly = playoffWeeks.findIndex(w => w.week === week);
  const label = `${roundIdxEarly >= 0 ? `Round ${roundIdxEarly + 1}` : `Week ${week}`} · ${side === 'front' ? 'Front 9' : 'Back 9'}`;
  const canPick = Array.isArray(roundOptions) && roundOptions.length > 1 && typeof onSelect === "function";
  const labelStyle = {
    fontSize: FS.sm, fontWeight: FW.bold, color: K.t2,
    textTransform: "uppercase", letterSpacing: .6,
  };

  const Header = ({ note }) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6, flexWrap: "wrap", position: "relative" }}>
      {canPick ? (
        <button
          onClick={() => setMenuOpen(o => !o)}
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          style={{
            ...labelStyle, background: "none", border: "none", padding: 0,
            cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
          }}
        >
          {label}
          <span style={{ fontSize: 8, color: K.act, transition: "transform .2s", display: "inline-block", transform: menuOpen ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
        </button>
      ) : (
        <span style={labelStyle}>{label}</span>
      )}
      {note && <span style={{ fontSize: FS.micro, fontWeight: FW.heavy, color: K.act, textTransform: "uppercase", letterSpacing: .6 }}>{note}</span>}
      {line.played && (
        <span style={{ marginLeft: "auto", fontSize: FS.micro, fontWeight: FW.bold, color: K.t3 }}>
          NET <strong style={{ color: K.t1 }}>{toPar(line.netToPar)}</strong>
        </span>
      )}
      {canPick && menuOpen && (<>
        {/* Click-catcher. Sized to the viewport so a tap anywhere dismisses,
            and behind the menu so the menu's own taps still land. */}
        <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1 }} />
        <div role="listbox" style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 2,
          background: K.card, border: `1px solid ${K.bdr}`, borderRadius: 9,
          boxShadow: "0 6px 20px rgba(0,0,0,.28)", padding: 4, minWidth: 150,
        }}>
          {roundOptions.map(opt => {
            const active = opt.key === selected;
            return (
              <button
                key={opt.key}
                role="option"
                aria-selected={active}
                onClick={() => { setMenuOpen(false); onSelect(opt.key); }}
                style={{
                  display: "flex", alignItems: "center", gap: 6, width: "100%",
                  padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                  background: active ? K.acc : "transparent",
                  color: active ? K.bg : K.t2,
                  fontSize: FS.xs, fontWeight: FW.bold, letterSpacing: .5,
                  textAlign: "left", textTransform: "uppercase",
                }}
              >
                <span style={{ width: 10, flexShrink: 0 }}>{active ? "✓" : ""}</span>
                {opt.label}
              </button>
            );
          })}
        </div>
      </>)}
    </div>
  );

  if (ir.withdrawn && !line.played) {
    return (
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${K.bdr}` }}>
        <Header note="Withdrawn" />
        <div style={{ fontSize: FS.xs, color: K.t3 }}>No round recorded for this player.</div>
      </div>
    );
  }

  if (!line.played) {
    return (
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${K.bdr}` }}>
        <Header />
        <div style={{ fontSize: FS.xs, color: K.t3 }}>No round posted yet.</div>
      </div>
    );
  }

  // A total-only makeup has a gross and nothing else. Drawing a nine-hole
  // grid would mean inventing hole scores, so it gets a summary instead —
  // the same reason the Stats boards leave total-only rounds out of their
  // per-hole distributions.
  if (ir.totalOnly) {
    const cell = (lbl, val) => (
      <div style={{ flex: 1, textAlign: "center" }}>
        <div style={{ fontSize: FS.micro, color: K.t3, fontWeight: FW.bold, letterSpacing: .6 }}>{lbl}</div>
        <div style={{ fontSize: FS.base, color: K.t1, fontWeight: FW.heavy }}>{val}</div>
      </div>
    );
    return (
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${K.bdr}` }}>
        <Header note="Makeup · total only" />
        <div style={{ display: "flex", background: K.bg, border: `1px solid ${K.bdr}60`, borderRadius: 10, padding: "8px 4px" }}>
          {cell("Gross", ir.gross)}
          {cell("HCP", roundHcp)}
          {cell("Net", ir.gross - roundHcp)}
          {cell("To Par", toPar(line.netToPar))}
        </div>
      </div>
    );
  }

  // Live or makeup hole card. Scores come straight from the resolved round —
  // no team, no opponent side, no substitution — and strokes are allocated
  // from the into-week handicap by the same allocator the leaderboard uses.
  const strokeMap = buildStrokesMap(roundHcp, hcps);
  const getScore = (x, h) => (x === pid ? (ir.holes[h] || 0) : 0);
  const getStrokes = (x, h) => (x === pid ? (strokeMap[h] || 0) : 0);
  const t1Pids = [pid];

  const sc = SharedScorecard({
    pars, side, hcps, team1Pids: t1Pids, team2Pids: [],
    getScore, getStrokes, getHcp, getInitials,
    isAbsent: () => false,
    variant: "allMatches", showTotals: true, showMatchRow: false, matchGrn: K.matchGrn,
  });

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${K.bdr}` }}>
      {/* "Makeup" is called out because this card legitimately differs from
          the team match's card for the same week — the golfer was absent
          there and played this round separately. */}
      <Header note={ir.mode === "makeupHoles" ? "Makeup" : null} />
      <div style={{ background: K.bg, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden" }}>
        <sc.HoleRow />
        <sc.ParRow />
        <sc.HcpRow />
        {t1Pids.map(x => <sc.PlayerRow key={x} pid={x} />)}
        <sc.TeamNetRow pids={t1Pids} isTeam1Side={true} />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  IndividualRoundsPanel — the expanded row's round browser
// ══════════════════════════════════════════════════════════════════
//
// A golfer accumulates a card per playoff round, and the expanded row lets you
// step through any of them or stack them all. Only rounds actually POSTED are
// offered: an empty round has no card to draw, and listing it would invite a
// tap that does nothing.
//
// Exported, and driven by `selected` / `onSelect` from the parent, so the
// browsing behavior is testable — expansion is internal state and unreachable
// from a static render otherwise.
//
//   rounds       — the player's posted rounds (leaderboard row's `p.rounds`)
//   playoffWeeks — used only to label a week as "R1".."R4"
//   selected     — a week number, or "all"
export function IndividualRoundsPanel({
  pid, rounds, playoffWeeks, selected, onSelect,
  schedule, course, players, scoringRules, leagueConfig, allRounds, scores,
  menuOpen,   // test seam — see IndividualRoundCard
}) {
  const played = [...(rounds || [])].sort((a, b) => a.week - b.week);
  if (!played.length) return null;

  const roundNo = (w) => {
    const i = (playoffWeeks || []).findIndex(x => x.week === w);
    return i >= 0 ? i + 1 : null;
  };
  const showAll = selected === "all";
  // An unknown or stale selection falls back to the player's latest round
  // rather than rendering nothing — the selector can outlive a re-seed.
  const fallback = played[played.length - 1].week;
  const current = showAll ? null : (played.some(r => r.week === selected) ? selected : fallback);
  const weeksToShow = showAll ? played.map(r => r.week) : [current];

  // Options live on the card's own heading rather than a control row above it.
  // "All" is last so the round list reads in play order.
  const options = played.map(r => ({ key: r.week, label: `Round ${roundNo(r.week) ?? r.week}` }));
  // "All" only means something when there's more than one round to combine —
  // with a single round it would be a second name for the option above it.
  if (played.length > 1) options.push({ key: "all", label: "All rounds" });

  return (
    <>
      {weeksToShow.map(w => (
        <IndividualRoundCard
          key={w}
          pid={pid} week={w}
          schedule={schedule} course={course} players={players}
          scoringRules={scoringRules} leagueConfig={leagueConfig}
          allRounds={allRounds} scores={scores}
          roundOptions={options}
          selected={selected}
          onSelect={onSelect}
          menuOpen={menuOpen}
        />
      ))}
    </>
  );
}

export function IndividualLeaderboard({ players, teams, schedule, course, leagueConfig, scoringRules, scores, allRounds, loading, title = null }) {
  // Sticky header block; measured so an expanded row can scroll clear of it.
  const headerRef = useRef(null);
  // The expanded row's outer element, so opening one near the bottom of a long
  // board can bring its scorecard into view instead of leaving it off-screen.
  const expandedRowRef = useRef(null);
  const [expandedPid, setExpandedPid] = useState(null); // playerId whose scorecard is expanded inline
  // Which round the expanded card is showing: a week number, "all" to stack
  // every round the player has posted, or null to fall back to their latest.
  // Reset whenever a different player is opened so the selector never carries
  // a stale round — and null-not-a-week so the default follows the live round
  // as the tournament moves on.
  const [expandedRound, setExpandedRound] = useState(null);
  // Opening a row near the bottom of a long board would otherwise drop the
  // scorecard below the fold with no hint it had appeared. Scroll it into view
  // instead — `nearest` scrolls the minimum needed, so a card that fits gets
  // its bottom brought to the bottom edge (the list slides up under it), and a
  // card taller than the viewport aligns to its top so the player's own row
  // stays visible rather than being pushed off. scrollMarginTop is set from
  // the measured sticky header so that top-aligned case doesn't tuck the row
  // underneath it.
  useEffect(() => {
    if (!expandedPid) return;
    const el = expandedRowRef.current;
    if (!el || typeof el.scrollIntoView !== "function") return;
    if (typeof requestAnimationFrame !== "function") return;
    // One frame so the expanded card has been laid out before we measure.
    const id = requestAnimationFrame(() => {
      const headerH = headerRef.current?.offsetHeight || 0;
      el.style.scrollMarginTop = `${headerH + 4}px`;
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [expandedPid, expandedRound]);

  const openPlayer = (pid) => {
    setExpandedPid(prev => (prev === pid ? null : pid));
    setExpandedRound(null);
  };
  const [scoreMode, setScoreMode] = useState("net"); // "net" | "gross" — leaderboard scoring lens; defaults to Net
  // Display sort — a VIEW-only reorder. Rank badges + movement arrows always keep
  // reflecting golf position (computed by Total in the memo); this only changes
  // row order. Defaults to Total ascending, which reproduces leader-on-top.
  const [sortCol, setSortCol] = useState("total"); // "player" | "total" | "thru" | "r1".."rN"
  const [sortDir, setSortDir] = useState("asc");   // "asc" | "desc"

  // LIVE POSITION MOVEMENT — backs the WBC-style ▲/▼ arrows next to the rank
  // badge. prevPositions remembers each active player's last golf position so
  // the movement effect (defined after the leaderboard memo) can diff the board
  // whenever a live score reshuffles it.
  const prevPositions = useRef({});
  const prevMode = useRef("net"); // last lens the movement effect saw; a change rebaselines without arrows
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

  // Scores + rounds history arrive as props — see lib/useIndividualScores.js.
  // The subscribe-per-playoff-week effect that used to live here cost ~180 doc
  // reads per playoff week on every mount (~720 with four rounds seeded), which
  // is the single biggest read amplifier in the app and would have been
  // multiplied by putting this board behind a button people tap mid-round.
  // Completed playoff weeks are locked and immutable, so there is nothing to
  // subscribe to: the hook reads them from the cached season tier and overlays
  // only the one week that can still change.

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
      let totalNetToPar = 0;     // cumulative net-to-par over holes PLAYED — the Net ranking metric
      let totalGrossToPar = 0;   // cumulative gross-to-par over holes PLAYED — the Gross ranking metric
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
        // Gross-to-par ignores allocated handicap strokes entirely — the same
        // round scored as if this were a scratch/gross tournament. Drives the
        // Gross lens on the leaderboard toggle.
        const grossToPar = gross - parPlayed;

        totalGross += gross;
        totalNetToPar += netToPar;
        totalGrossToPar += grossToPar;
        totalHolesPlayed += holesPlayed;
        roundsPlayed++;
        rounds.push({
          week: wk.week, date: wk.date, side, gross,
          netToPar, grossToPar,
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
        totalGrossToPar,
        totalHolesPlayed,
        roundsPlayed,
        rounds,
        withdrew,
        wdRound,
      };
    }).filter(p => p.roundsPlayed > 0 || playoffWeeks.length > 0);

    // Ranking metric follows the active lens: Net uses cumulative net-to-par,
    // Gross uses cumulative gross-to-par. Everything below (sort, ties, positions)
    // keys off this one field so the whole board re-ranks when the toggle flips.
    const metricKey = scoreMode === "gross" ? "totalGrossToPar" : "totalNetToPar";

    // Sort order: ACTIVE (played at least one round, not withdrawn) → WD → NO DATA.
    // Within ACTIVE, cumulative to-par low→high. Equal totals are GENUINE TIES —
    // no secondary tiebreaker (standard golf tie handling); alphabetical within a
    // tied group purely for stable layout. Within WD and NO DATA, alphabetical for
    // the same reason.
    const bucket = (p) => p.withdrew ? 1 : p.roundsPlayed > 0 ? 0 : 2;
    board.sort((a, b) => {
      const ab = bucket(a);
      const bb = bucket(b);
      if (ab !== bb) return ab - bb;
      if (ab === 0 && a[metricKey] !== b[metricKey]) {
        return a[metricKey] - b[metricKey];
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
      p.posRank = (j > 0 && p[metricKey] === actives[j - 1][metricKey])
        ? actives[j - 1].posRank
        : j + 1;
    });
    const rankCounts = {};
    actives.forEach(p => { rankCounts[p.posRank] = (rankCounts[p.posRank] || 0) + 1; });
    actives.forEach(p => { p.posLabel = (rankCounts[p.posRank] > 1 ? "T" : "") + p.posRank; });

    return board;
  }, [players, teams, course, playoffWeeks, scores, allRounds, scoringRules, leagueConfig, scoreMode]);

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
    // A lens flip (Net↔Gross) reshuffles nearly everyone; that's not live
    // movement, so rebaseline positions without drawing any arrows.
    const modeChanged = prevMode.current !== scoreMode;
    prevMode.current = scoreMode;
    const newMov = {};
    if (!modeChanged) {
      actives.forEach(p => {
        const prev = prevPositions.current[p.playerId];
        if (prev != null && prev !== p.posRank) newMov[p.playerId] = prev > p.posRank ? "up" : "down";
      });
    }
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
  // Total / Thru / R1–R4 all share ONE width and are center-aligned, so their
  // centers sit at an even rhythm — equal gaps require equal interior widths, and
  // right-aligning Total (the old layout) was what jammed it against Thru. 32px
  // holds a 3-char total ("+12"/"WD") at FS.base with room to spare.
  const POS_W = 30;   // rank badge cell (+4px over the badge for the ▲/▼ arrow gutter)
  const STAT_W = 32;  // every numeric column (Total, Thru, each R#) — uniform for even spacing
  const THRU_W = STAT_W;
  const RND_W = STAT_W;
  const TOPAR_W = STAT_W;
  const PAD_X = 10;   // card / header horizontal padding

  // PGA-style "Thru": the round the field is currently on is the furthest week
  // anyone has posted a score in. Per player, Thru shows their progress in that
  // round ("F" once all 9 are in), or "–" if they haven't teed off in it yet.
  const currentRoundWeek = leaderboard.reduce(
    (mx, p) => p.rounds.reduce((m, r) => Math.max(m, r.week), mx), 0);


  const isGross = scoreMode === "gross";

  // Header click: same column flips asc⇄desc; a new column starts ascending.
  const onSort = (col) => {
    if (sortCol === col) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  // Display sort. Outermost key is always the bucket (active → WD → no-data) so
  // real competitors stay on top no matter the column; within a bucket we sort by
  // the chosen column. Players with no value for that column (e.g. haven't teed
  // off in the current round when sorting Thru) sink to the bottom of their bucket
  // regardless of direction, and equal values fall back to name order for stable
  // layout. Total / R# use the active Net/Gross lens.
  const bucketOf = (p) => (p.withdrew ? 1 : p.roundsPlayed > 0 ? 0 : 2);
  const sortVal = (p) => {
    switch (sortCol) {
      case "player":
        return p.name.toLowerCase();
      case "thru": {
        const cr = currentRoundWeek ? p.rounds.find(r => r.week === currentRoundWeek) : null;
        return cr ? cr.holesPlayed : null;
      }
      case "total":
        return p.roundsPlayed > 0 ? (isGross ? p.totalGrossToPar : p.totalNetToPar) : null;
      default: {
        if (sortCol[0] === "r") {
          const idx = parseInt(sortCol.slice(1), 10) - 1;
          const wk = playoffWeeks[idx];
          const rd = wk ? p.rounds.find(r => r.week === wk.week) : null;
          return rd ? (isGross ? rd.grossToPar : rd.netToPar) : null;
        }
        return null;
      }
    }
  };
  const dirMul = sortDir === "desc" ? -1 : 1;
  const displayBoard = [...leaderboard].sort((a, b) => {
    const ba = bucketOf(a), bb = bucketOf(b);
    if (ba !== bb) return ba - bb;
    const va = sortVal(a), vb = sortVal(b);
    const am = va === null || va === undefined;
    const bm = vb === null || vb === undefined;
    if (am && bm) return a.name.localeCompare(b.name);
    if (am) return 1;   // missing values sink to the bottom of the bucket
    if (bm) return -1;
    if (typeof va === "string") {
      const c = va.localeCompare(vb) * dirMul;
      return c !== 0 ? c : a.name.localeCompare(b.name);
    }
    if (va !== vb) return (va - vb) * dirMul;
    return a.name.localeCompare(b.name);
  });

  // Sortable column-header cell — active column reads in the maize accent with a
  // ▲/▼ direction caret. Player is left-aligned and flex; the rest are the shared
  // fixed width, centered.
  const th = (col, label, { width, flex, align, keyId } = {}) => {
    const active = sortCol === col;
    return (
      <div
        key={keyId}
        onClick={() => onSort(col)}
        style={{
          width, flex, minWidth: flex ? 0 : undefined,
          cursor: "pointer", userSelect: "none",
          color: active ? K.act : K.logoBright,
          display: "flex", alignItems: "center", gap: 1,
          justifyContent: align === "left" ? "flex-start" : "center",
        }}
      >
        <span>{label}</span>
        {active && <span style={{ fontSize: 7, lineHeight: 1 }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
      </div>
    );
  };

  return (
    <div style={{ padding: "0 2px" }}>
      {/* Everything above the rows travels together as ONE sticky block: the
          caller's title, the lens line, and the column headers. Sticking the
          column headers alone would leave them colliding with a title stuck
          separately above them, and a long board is exactly where you stop
          being able to remember which column is which. */}
      <div ref={headerRef} data-board-header style={{ position: "sticky", top: 0, zIndex: 3, background: K.bg, paddingBottom: 6 }}>
        {title && (
          <div style={{ textAlign: "center", fontSize: FS.xs, fontWeight: FW.bold, color: K.act, letterSpacing: 1.5, textTransform: "uppercase", padding: "2px 34px 8px" }}>
            {title}
          </div>
        )}
        {/* Reads "Net · N rounds · All players". This is a Net event and Gross
            is just a curiosity, so the lens control is deliberately quiet: the
            leading word itself is tappable and flips Net⇄Gross (a faint dashed
            underline is the only hint), rather than a prominent segmented
            control. */}
        <div style={{ textAlign: "center", marginBottom: 10, fontSize: FS.xs, color: K.t3 }}>
          <span
            onClick={() => setScoreMode(isGross ? "net" : "gross")}
            role="button"
            tabIndex={0}
            style={{
              color: K.t2, fontWeight: FW.bold, cursor: "pointer",
              borderBottom: `1px dashed ${K.t3}`, paddingBottom: 1,
            }}
          >{isGross ? "Gross" : "Net"}</span>
          {" · "}{totalRounds} round{totalRounds !== 1 ? "s" : ""} · All players
        </div>

        {/* Column header — click any header to sort (asc, then desc). */}
        <div style={{ display: "flex", padding: `0 ${PAD_X}px`, fontSize: FS.micro, fontWeight: FW.bold, color: K.logoBright, textTransform: "uppercase", letterSpacing: .8 }}>
          <div style={{ width: POS_W }} />
          {th("player", "Player", { flex: 1, align: "left" })}
          {th("total", "Total", { width: TOPAR_W })}
          {th("thru", "Thru", { width: THRU_W })}
          {Array.from({ length: totalRounds }, (_, i) =>
            th(`r${i + 1}`, `R${i + 1}`, { width: RND_W, keyId: `rhdr${i + 1}` })
          )}
        </div>
      </div>

      {/* Leaderboard */}
      <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>

        {displayBoard.map((p, i) => {
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

          const isExp = expandedPid === p.playerId;

          return (
            <div key={p.playerId} ref={isExp ? expandedRowRef : null} style={{
              display: "flex", flexDirection: "column", background: K.card,
              borderRadius: CARD_RADIUS, border: `1px solid ${p.posRank === 1 && showRank ? K.act + "30" : K.bdr}`,
              padding: `10px ${PAD_X}px`,
              opacity: isWD ? 0.55 : 1,
            }}>
              {/* Row — the whole row is the tap target: selecting it expands this
                  player's scorecard inline below (Schedule-style), or collapses it.
                  Inert when there's no round to show (scWk null). */}
              <div
                onClick={scWk ? () => openPlayer(p.playerId) : undefined}
                style={{ display: "flex", alignItems: "center", cursor: scWk ? "pointer" : "default" }}
              >
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

              {/* Name + expand chevron (rotates when the row is expanded). */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: FS.sm, fontWeight: FW.bold, color: K.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.displayName}
                </span>
                {scWk && (
                  <span style={{ fontSize: 8, flexShrink: 0, color: isExp ? K.act : K.t3, transition: "transform 0.2s", display: "inline-block", transform: isExp ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
                )}
              </div>

              {/* Total — cumulative net-to-par (E/+3/-2), placed right after the
                  name to match a PGA leaderboard. Red when under par; integer
                  end-to-end so it's the exact sum of the round cells. WD players
                  show "WD" in red. */}
              <div style={{
                width: TOPAR_W, textAlign: "center", fontSize: FS.base, fontWeight: FW.heavy,
                fontFamily: "'League Spartan', sans-serif",
                color: isWD ? K.red : hasRounds ? ((isGross ? p.totalGrossToPar : p.totalNetToPar) < 0 ? K.red : K.t1) : K.t3,
              }}>
                {isWD ? "WD" : hasRounds ? fmtToPar(isGross ? p.totalGrossToPar : p.totalNetToPar) : "–"}
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
                const roundVal = round ? (isGross ? round.grossToPar : round.netToPar) : null;
                return (
                  <div key={wi} style={{
                    width: RND_W, textAlign: "center", fontSize: FS.sm,
                    fontWeight: isWDRound ? FW.heavy : FW.semibold,
                    color: isWDRound ? K.red : round ? (roundVal < 0 ? K.red : K.t1) : K.t3 + "40",
                  }}>
                    {/* No makeup marker. A round played on a different day is
                        still just that golfer's round for the week, and the
                        superscript m/t only added noise to a column of
                        numbers. `round.makeup` / `round.totalOnly` are still
                        carried on the round for the expanded scorecard. */}
                    {isWDRound ? "WD" : round ? fmtToPar(roundVal) : "–"}
                  </div>
                );
              })}
              </div>

              {/* Inline scorecard — appears directly below the row when selected,
                  the way Schedule expands a match. No modal. */}
              {isExp && scWk && (
                <IndividualRoundsPanel
                  pid={p.playerId}
                  rounds={p.rounds}
                  playoffWeeks={playoffWeeks}
                  selected={expandedRound ?? scWk}
                  onSelect={setExpandedRound}
                  schedule={schedule} course={course} players={players}
                  scoringRules={scoringRules} leagueConfig={leagueConfig}
                  allRounds={allRounds} scores={scores}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
