// ══════════════════════════════════════════════════════════════════
//  useIndividualScores — data for the individual tournament board
// ══════════════════════════════════════════════════════════════════
//
// Supplies { scores, allRounds, loading } to IndividualLeaderboard, and exists
// to make that board cheap enough to open repeatedly mid-round.
//
// The read problem it solves
// ──────────────────────────
// The board used to attach one Firestore onSnapshot per playoff week on every
// mount: ~180 doc reads per week, ~720 with four rounds seeded, every time
// anyone opened the tab. On a playoff night with 20 golfers checking their
// position a few times each, that single view can approach the whole 50k/day
// free-tier read allowance on its own — and putting the board behind a trophy
// button, where it's meant to be tapped often, would have multiplied it.
//
// Why it can be nearly free
// ─────────────────────────
// A finalized playoff week is locked and immutable — that's the same property
// that makes a played round's handicap stable. So only ONE week in the whole
// tournament can still change: the current, unlocked one. Everything else is
// history and can be read from a cache.
//
//   • prior (locked) weeks → fetchSeasonScores(), which App.jsx serves from an
//     in-memory cache after the first call. Zero reads on a warm session.
//   • the one live week → either handed in by the caller (Scoring is already
//     subscribed to it via App's liveWeek listener, so it costs nothing), or
//     subscribed to here as a fallback for callers that aren't.
//
// That's 0 reads from Scoring's popup and one week's worth from Standings,
// down from four weeks' worth on every single mount.
//
// Freshness is unchanged where it matters: the only rows that move during a
// round belong to the live week, and that week is live in both paths.

import { useState, useEffect, useMemo } from "react";
import { db, LF } from "../firebase";

/**
 * @param {Object}   args
 * @param {Array}    args.schedule
 * @param {Object}   args.leagueConfig
 * @param {Function} args.fetchSeasonScores  App.jsx's cached season-tier fetch
 * @param {Function} args.fetchAllScores     App.jsx's cached rounds history
 * @param {Object}   [args.liveScores]       caller's already-subscribed hole
 *                                           scores (App's `holeScores`). When
 *                                           it covers the live playoff week,
 *                                           no subscription is opened at all.
 * @param {number}   [args.liveWeek]         which week `liveScores` covers
 * @param {boolean}  [args.enabled=true]     skip all work when the consumer
 *                                           isn't showing the board (e.g. a
 *                                           closed popup)
 */
export function useIndividualScores({
  schedule,
  leagueConfig,
  fetchSeasonScores,
  fetchAllScores,
  liveScores = null,
  liveWeek = null,
  enabled = true,
}) {
  const [baseScores, setBaseScores] = useState({});      // locked weeks, from cache
  const [subScores, setSubScores] = useState({});        // the live week, if we subscribe
  const [allRounds, setAllRounds] = useState(null);
  const [loading, setLoading] = useState(true);

  const playoffWeeks = useMemo(() =>
    (schedule || [])
      .filter(wk => wk.isPlayoff === true && !wk.rainedOut && wk.matches?.length > 0)
      .sort((a, b) => a.week - b.week),
    [schedule]
  );

  // The single week that can still change. Earliest unlocked playoff week —
  // matching how the rest of the app picks "the current week". Null once every
  // playoff week is finalized, at which point the board is fully static and
  // this hook opens nothing.
  const liveTargetWeek = useMemo(() => {
    const wk = playoffWeeks.find(w => w.locked !== true);
    return wk ? wk.week : null;
  }, [playoffWeeks]);

  // Caller-supplied live scores are usable only if they actually cover the week
  // that's in play. Scoring sets App's liveWeek to the week it's scoring, which
  // is normally exactly this week — but a commissioner viewing a past week via
  // forceWeek would leave them pointed elsewhere, and silently trusting that
  // would freeze the board's live round.
  const canUseCallerLive = liveScores != null && liveTargetWeek != null && liveWeek === liveTargetWeek;

  // ── Locked weeks + rounds history (cached; typically 0 reads) ──
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    if (fetchAllScores) {
      fetchAllScores().then(hist => { if (!cancelled) setAllRounds(hist); });
    }
    // Resolved-promise continuations rather than a synchronous setLoading in
    // the effect body — a sync setState here re-renders before paint on every
    // mount, and the "no fetcher" branch would do it for nothing.
    Promise.resolve(fetchSeasonScores ? fetchSeasonScores() : null)
      .then(all => {
        if (cancelled) return;
        if (all) setBaseScores(all);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, fetchSeasonScores, fetchAllScores]);

  // ── The live week, only when the caller can't supply it ──
  // One equality-filtered subscription (league_id ==, season ==, week ==) —
  // the exact query shape App.jsx's liveWeek listener already runs, so its
  // index provably exists. Each snapshot rebuilds that week's keys wholesale
  // so score deletions propagate; prefix matching is unambiguous because keys
  // are `w{week}_p...`, so `w1_` can never match `w10_...`.
  useEffect(() => {
    if (!enabled || canUseCallerLive || liveTargetWeek == null) return;
    const season = leagueConfig?.year || new Date().getFullYear();
    let cancelled = false;
    const unsub = db.subscribe(
      "league_hole_scores",
      [...LF, { field: "season", op: "==", value: season }, { field: "week", op: "==", value: liveTargetWeek }],
      (docs) => {
        if (cancelled) return;
        const next = {};
        docs.forEach(r => { next[`w${r.week}_p${r.player_id}_h${r.hole}`] = r.score; });
        setSubScores(next);
      }
    );
    return () => { cancelled = true; if (unsub) unsub(); };
  }, [enabled, canUseCallerLive, liveTargetWeek, leagueConfig]);

  // Overlay order: cached history first, then the live week on top. The live
  // source is authoritative for its week — the cached copy of it may be a few
  // strokes stale, and a stale key must never win over a live one. Both paths
  // drop the cached keys for that week before overlaying so a deleted score
  // doesn't linger.
  const scores = useMemo(() => {
    // Disabled means genuinely no work, not just no reads. Scoring holds this
    // hook while the popup is closed, and `liveScores` is App's hole-score map
    // — which changes on every single score entered. Without this guard the
    // merge would rebuild the whole season map on every keystroke of a live
    // round for a board nobody is looking at.
    if (!enabled) return {};
    const live = canUseCallerLive ? liveScores : subScores;
    if (liveTargetWeek == null) return baseScores;
    const merged = {};
    const prefix = `w${liveTargetWeek}_`;
    for (const k of Object.keys(baseScores)) {
      if (!k.startsWith(prefix)) merged[k] = baseScores[k];
    }
    for (const k of Object.keys(live || {})) {
      if (k.startsWith(prefix)) merged[k] = live[k];
    }
    return merged;
  }, [enabled, baseScores, subScores, liveScores, canUseCallerLive, liveTargetWeek]);

  return { scores, allRounds, loading };
}
