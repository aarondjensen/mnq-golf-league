import { useState, useMemo, useCallback, useEffect, useRef, memo } from "react";
import { K, I, BackBtn, Card, EmptyState,
  getWeekSide,
  formatTeeTime as fmtTeeTimeUtil, LIST_GAP,
  buildSeedMap } from "../theme";
import { LEAGUE_ID } from "../firebase";
import { computeMatchResult, resultLetterFor, readScoreEffective, readStrokesEffectiveExt, computePlayoffTiebreaker, isMatchPendingMakeup } from "../lib/matchCalc";
import { parseScheduleDate } from "../lib/scheduleDate";
import { parseTiebreakerResult, TeamMatchupCard } from "../TeamMatchupCard";
import { SharedScorecard } from "../components/SharedScorecard";
import { Popup, ConfirmModal } from "../components/Popup";

// ═══════════════════════════════════════════════════════════════
//  Haptic feedback helpers (1.1A)
// ═══════════════════════════════════════════════════════════════
// PWAs on Android + recent iOS support navigator.vibrate. On unsupported
// browsers vibrate is undefined and the helper no-ops. Tap pattern feels
// native and is critical UX on a course (gloves, sun, motion). Three
// intensities used throughout this view:
//   • tapScore     — single 10ms blip for entering a hole score
//   • tapNudge     — 8ms blip for +/− nudge buttons (lighter than score)
//   • tapBigAction — three-pulse pattern for big moments (sign card, attest, finalize)
function tapScore()     { if (typeof navigator !== "undefined" && navigator.vibrate) try { navigator.vibrate(10); } catch {} }
function tapNudge()     { if (typeof navigator !== "undefined" && navigator.vibrate) try { navigator.vibrate(8); } catch {} }
function tapBigAction() { if (typeof navigator !== "undefined" && navigator.vibrate) try { navigator.vibrate([20, 40, 20]); } catch {} }


// ═══════════════════════════════════════════════════════════════
//  Helper: compute strokes map for a given handicap
// ═══════════════════════════════════════════════════════════════
function buildStrokesCache(hcps) {
  const cache = {};
  const sorted = hcps.map((h, i) => ({ idx: i, hcp: h })).sort((a, b) => a.hcp - b.hcp);
  return (nh) => {
    if (cache[nh]) return cache[nh];
    const map = {};
    let rem = Math.abs(nh);
    for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + 1; rem--; }
    for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + 1; rem--; }
    cache[nh] = map;
    return map;
  };
}

// ═══════════════════════════════════════════════════════════════
//  Helper: compute hole results and clinch info
// ═══════════════════════════════════════════════════════════════
function computeMatchStatus(t1Pids, t2Pids, getScore, getStrokes, pars) {
  const holeResults = [];
  for (let h = 0; h < 9; h++) {
    let n1 = 0, n2 = 0, ok1 = true, ok2 = true;
    t1Pids.forEach(pid => { const s = getScore(pid, h); if (s <= 0) ok1 = false; else n1 += s - getStrokes(pid, h); });
    t2Pids.forEach(pid => { const s = getScore(pid, h); if (s <= 0) ok2 = false; else n2 += s - getStrokes(pid, h); });
    if (ok1 && ok2) holeResults.push(n1 < n2 ? 1 : n2 < n1 ? -1 : 0);
    else holeResults.push(null);
  }
  // Running cumulative match status. Match-play integrity rule: the
  // cumulative is only meaningful when every prior hole is resolved. A
  // single incomplete hole (null) makes the running total indeterminate
  // for that hole AND all holes after it — you can't know the cumulative
  // standing when an earlier hole's win/loss/halve is unknown. So once we
  // hit a null, every subsequent entry is null too. (Downstream MatchRow
  // shows ⚠️ on null holes with partial activity, blank on untouched ones.)
  const runningStatus = [];
  let cum = 0;
  let sequenceBroken = false;
  holeResults.forEach(r => {
    if (sequenceBroken || r === null) {
      sequenceBroken = true;
      runningStatus.push(null);
    } else {
      cum += r;
      runningStatus.push(cum);
    }
  });

  let clinchHole = null, clinchText = null;
  for (let h = 0; h < 9; h++) {
    if (runningStatus[h] === null) break;
    const lead = Math.abs(runningStatus[h]);
    const rem = 8 - h;
    if (lead > rem) {
      clinchHole = h;
      clinchText = rem > 0 ? `${lead}&${rem}` : `${lead}UP`;
      break;
    }
  }
  if (clinchHole === null && runningStatus.length === 9 && runningStatus[8] !== null) {
    clinchHole = 8;
    const f = runningStatus[8];
    clinchText = f !== 0 ? `${Math.abs(f)}UP` : "TIED";
  }

  return { holeResults, runningStatus, clinchHole, clinchText };
}


// ═══════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function LiveScoringView({ leagueUser, players, teams, course, schedule, holeScores, saveScore, scoringRules, matchResults, saveMatchResult, deleteMatchResult, ctpData, saveCtp, setLiveWeek, fetchWeekScores, isComm, commMode, leagueConfig, saveWeekSchedule, setWeekSchedule, deleteWeekSchedule, openAllMatches, onAllMatchesOpened, openFinalize, onFinalizeOpened, forceWeek, onForceWeekUsed, setPopupOpen, recalcHandicaps, clearWeekData, autoSeedIfReady, attendance, saveAttendance }) {
  const [activeMatch, setActiveMatch] = useState(null);
  const [curHole, setCurHole] = useState(0);
  // 3-way view toggle: "myMatch" (default scoring view), "allMatches" (week overview), "lowNet" (leaderboard)
  // Kept as derived alias for backward-compat with existing code paths.
  const [view, setView] = useState("myMatch");
  const showAllMatches = view === "allMatches";
  const showLowNet = view === "lowNet";
  const setShowAllMatches = (b) => setView(b ? "allMatches" : "myMatch");
  const [expandedMatch, setExpandedMatch] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (openAllMatches) {
      setShowAllMatches(true);
      setActiveMatch(null);
      if (onAllMatchesOpened) onAllMatchesOpened();
    }
  }, [openAllMatches]);
  const [editing, setEditing] = useState(false);
  const [showScorecard, setShowScorecard] = useState(false);
  const [showFinalize, setShowFinalize] = useState(false);
  const [showEditConfirm, setShowEditConfirm] = useState(false);
  const [absentPlayers, setAbsentPlayers] = useState({});
  const [confirmModal, setConfirmModal] = useState(null);
  const [justSigned, setJustSigned] = useState(false); // prevents flash between sign and Firestore update
  const [showCtpPopup, setShowCtpPopup] = useState(false);
  const [ctpSelections, setCtpSelections] = useState({}); // { holeNum: { playerId, distance } }
  const [lowNetSort, setLowNetSort] = useState("net"); // "net" | "gross" — Low Net leaderboard sort column
  const [lowNetDir, setLowNetDir] = useState("asc"); // "asc" (best→worst) | "desc" (worst→best) — Low Net sort direction
  const initialJump = useRef(false);
  const matchGrn = K.matchGrn;

  // Memoized confetti particle config. Without this, every render of the
  // finalize popup re-randomized 25 particles' positions/sizes/durations —
  // and any Firestore subscription update during the celebration would
  // restart the animation from scratch. Memoizing on `showFinalize` keeps
  // the same particle layout for the lifetime of one popup view; closing
  // and reopening generates fresh particles.
  const confettiParticles = useMemo(() => {
    if (!showFinalize) return null;
    const palette = [K.act, K.grn, K.teal, "#fff", K.logoBright, K.red, "#ff6b6b", "#ffd93d"];
    return Array.from({ length: 25 }, (_, i) => ({
      key: i,
      color: palette[i % palette.length],
      left: Math.random() * 100,
      delay: Math.random() * 2,
      dur: 2 + Math.random() * 2,
      size: 4 + Math.random() * 6,
      heightRatio: Math.random() > 0.5 ? 1 : 0.5,
      rot: Math.random() * 360,
      round: Math.random() > 0.5,
    }));
  }, [showFinalize]);

  // Notify App.jsx when popups open/close for body scroll lock
  useEffect(() => {
    if (setPopupOpen) setPopupOpen(showFinalize || showScorecard || !!confirmModal || showCtpPopup);
  }, [showFinalize, showScorecard, confirmModal, showCtpPopup, setPopupOpen]);

  // ── Player lookup map (O(1) instead of repeated .find()) ──
  const playerMap = useMemo(() => {
    const m = {};
    players.forEach(p => { m[p.id] = p; });
    return m;
  }, [players]);

  const currentWeek = useMemo(() => {
    if (forceWeek) return forceWeek;
    for (const wk of schedule) {
      if (wk.rainedOut) continue;
      if (!wk.matches || wk.matches.length === 0) continue;
      if (!wk.locked) return wk.week;
    }
    const playable = schedule.filter(wk => !wk.rainedOut && wk.matches && wk.matches.length > 0);
    return playable.length ? playable[playable.length - 1].week : 0;
  }, [schedule, matchResults, forceWeek]);

  const week = currentWeek;
  useEffect(() => { setLiveWeek(week); }, [week, setLiveWeek]);
  // Clear the forceWeek after it's been consumed
  useEffect(() => { if (forceWeek && onForceWeekUsed) onForceWeekUsed(); }, [forceWeek]);

  const weekSch = schedule.find(s => s.week === week);
  const matches = weekSch?.matches || [];
  const side = weekSch?.side || getWeekSide(week);
  const pars = course ? (side === 'front' ? course.frontPars : course.backPars) : [4,4,4,3,5,4,4,3,5];
  const hcps = course ? (side === 'front' ? course.frontHcps : course.backHcps) : [1,3,5,7,9,11,13,15,17];
  const myTeam = teams.find(t => t.player1 === leagueUser.playerId || t.player2 === leagueUser.playerId);
  const myMatch = myTeam ? matches.find(m => m.team1 === myTeam.id || m.team2 === myTeam.id) : null;

  // App-level "Finalize Week N" banner click → directly open the CTP /
  // finalize popup. Pre-fills CTP selections from any prior week-CTP
  // records so the commish sees what was previously chosen, then fires
  // the cleanup callback so a second tap on the banner re-opens it.
  useEffect(() => {
    if (!openFinalize) return;
    const par3Holes = pars.map((p, i) => p === 3 ? (side === 'front' ? i + 1 : i + 10) : null).filter(Boolean);
    const existing = {};
    par3Holes.forEach(h => {
      const c = ctpData.find(cd => cd.week === week && cd.holeNum === h);
      if (c) existing[h] = { playerId: c.playerId || "", distance: c.distance || "" };
    });
    setCtpSelections(existing);
    setShowCtpPopup(true);
    if (onFinalizeOpened) onFinalizeOpened();
    // Intentionally only re-runs on openFinalize — pars/side/ctpData/week
    // change frequently and we don't want this firing on every Firestore
    // tick. By the time a banner click sets openFinalize, those values
    // are stable for the targeted week.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFinalize]);

  // ── Memoized strokes calculator ──
  const getStrokesMap = useMemo(() => buildStrokesCache(hcps), [hcps]);

  // Seed numbers for team cards during seeded/playoff weeks (1 = best per current standings
  // or locked-seeds snapshot). Hidden on pure round-robin weeks where every team plays every
  // other team equally and seeds aren't meaningful.
  const showSeeds = (weekSch?.seeded === true) || (weekSch?.isPlayoff === true);
  const seedMap = useMemo(() => {
    if (!showSeeds) return {};
    return buildSeedMap(teams, matchResults, schedule, leagueConfig);
  }, [showSeeds, teams, matchResults, schedule, leagueConfig]);

  const isWeekLocked = weekSch?.locked === true;
  const allMatchesFinalized = matches.every(m =>
    matchResults.some(r => r.week === week && r.team1Id === m.team1 && r.team2Id === m.team2)
  );
  const allMatchesAttested = matches.every(m =>
    matchResults.some(r => r.week === week && r.team1Id === m.team1 && r.team2Id === m.team2 && r.attested === true)
  );

  // Two banner states for the commish (all hidden when week is already locked):
  //   1. Ready → handled at app level (gold strip above tab nav). This file
  //      no longer renders a Ready banner; the app-level banner is the single
  //      finalize entry point.
  //   2. Waiting → muted info strip: "Waiting on N match(es) · X of Y attested"
  //                (when some but not all matches are done). Key UX need: the
  //                banner disappearing without explanation when a match goes
  //                unattested confuses commissioners who think the feature is
  //                broken. This strip gives them a visible breadcrumb while
  //                they wait.
  //                (when some but not all matches are done). Key UX need: the
  //                banner disappearing without explanation when a match goes
  //                unattested confuses commissioners who think the feature is
  //                broken. This strip gives them a visible breadcrumb while
  //                they wait.
  //   3. Nothing to show → no banner (no matches scored yet, or not commish).
  const attestedCount = matches.filter(m =>
    matchResults.some(r => r.week === week && r.team1Id === m.team1 && r.team2Id === m.team2 && r.attested === true)
  ).length;
  const matchCount = matches.length;
  const hasSomeProgress = attestedCount > 0 && attestedCount < matchCount;

  const showWaitingBanner = isComm && !allMatchesAttested && hasSomeProgress && !isWeekLocked;

  // The "ready to finalize" CTA is now exclusively the app-level gold strip
  // above the tab navigation in App.jsx. This file used to render a 3rd-tier
  // ready banner inside each Scoring sub-view (My Match / All Matches / Low
  // Net) plus a 4th "Finalize Week N" button at the bottom of the All Matches
  // list — three duplicate tap targets driving the same action. Both removed.
  // We keep the WAITING info strip below because it's status, not a CTA.
  const FinalizeBanner = showWaitingBanner ? (
    <div style={{
      width: "100%", padding: "8px 14px", borderRadius: 10,
      marginBottom: 8,
      background: K.inp, border: `1px dashed ${K.bdr}`,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      fontSize: 12, color: K.t2,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: K.t3, letterSpacing: 1, textTransform: "uppercase" }}>Waiting</span>
      <span style={{ color: K.bdr }}>·</span>
      <span style={{ fontWeight: 600 }}>
        {attestedCount} of {matchCount} match{matchCount === 1 ? "" : "es"} attested
      </span>
    </div>
  ) : null;

  // ── Early returns moved BELOW all hooks (see end of hook block, ~line 920).
  //
  // Previously the four guards above (no course / no matches / no playerId /
  // auto-switch to All Matches) lived RIGHT HERE, before ~12 hook calls
  // (useRef, useEffect, useCallback, useMemo) further down. That violated the
  // Rules of Hooks: when any of those guards fired, the hook calls below were
  // skipped, and the next render — which might NOT take the early-return
  // branch — would call hooks in a different order. React's reconciler would
  // throw "Rendered more hooks than during the previous render" and crash the
  // page. The crash is rare in practice because course/matches usually arrive
  // in a stable order, but cold-start races and the auto-switch-to-allMatches
  // path could trip it.
  //
  // Fix: keep the guards' placement of "before any rendering work happens"
  // intact, but move them to AFTER the last hook so every render path goes
  // through the same hook sequence. The intermediate derivations between here
  // and the early-returns block (matchToScore, t1, t2, t1Players, t2Players,
  // allP, getS, etc.) were already null-safe — they all guard with
  // `(t1 && t2)`, `(allP.length > 0 && ...)`, optional chaining, or default
  // fallbacks — so no body changes were needed; only the placement.

  const matchToScore = activeMatch || myMatch;
  const t1 = matchToScore ? teams.find(t => t.id === matchToScore.team1) : null;
  const t2 = matchToScore ? teams.find(t => t.id === matchToScore.team2) : null;
  const matchKey = matchToScore ? `${matchToScore.team1}_${matchToScore.team2}` : "_none_";

  const prevMatchKey = useRef(matchKey);
  useEffect(() => {
    if (prevMatchKey.current !== matchKey) {
      setCurHole(0);
      initialJump.current = false;
      setEditing(false);
      setShowScorecard(false);
      setShowFinalize(false);
      prevMatchKey.current = matchKey;
    }
  }, [matchKey]);

  const prevPlayerId = useRef(leagueUser.playerId);
  useEffect(() => {
    if (prevPlayerId.current !== leagueUser.playerId) {
      setShowFinalize(false);
      setShowEditConfirm(false);
      setShowAllMatches(false);
      setActiveMatch(null);
      setExpandedMatch(null);
      setShowScorecard(false);
      prevPlayerId.current = leagueUser.playerId;
    }
  }, [leagueUser.playerId]);

  const scoringFormat = leagueConfig?.scoringFormat || "lowHighBonus";
  const isTeamNet = scoringFormat === "teamNetTotal";

  const t1Players = t1 ? [t1.player1, t1.player2] : [];
  const t2Players = t2 ? [t2.player1, t2.player2] : [];
  const getHcp = (pid) => {
    const p = playerMap[pid];
    return p ? Math.round(p.handicapIndex || 0) : 0;
  };

  // Absent player helpers
  const getTeammate = (pid) => {
    if (t1Players.includes(pid)) return t1Players.find(p => p !== pid);
    if (t2Players.includes(pid)) return t2Players.find(p => p !== pid);
    return null;
  };
  const isPlayerAbsent = (pid) => !!absentPlayers[pid];

  // ── Attendance integration (Phase 2 of Mark Out feature) ──
  // Reads from the attendance prop populated by App.jsx subscribing to
  // league_attendance. Provides two helpers:
  //   - getAttendanceStatus(pid): "absent" | "makeup" | null
  //   - isPlayerMakingUp(pid): boolean
  // Absent state is unified with the existing _habsent mechanism: the
  // auto-sync effect below writes _habsent=1 for players flagged absent
  // in advance, so isPlayerAbsent (which reads _habsent) returns the
  // correct value everywhere else in this file.
  // Makeup is a separate visual state — players are NOT auto-marked
  // absent for match calc purposes, so the match remains incomplete
  // until their makeup scores are entered (commissioner-side via
  // Schedule → Edit Scores until Phase 3 ships a self-service path).
  const getAttendanceStatus = (pid) => {
    if (!attendance || !week) return null;
    return attendance[`w${week}_p${pid}`]?.status || null;
  };
  const isPlayerMakingUp = (pid) => getAttendanceStatus(pid) === "makeup" && !isPlayerAbsent(pid);
  const isBothAbsent = (pid) => {
    const tm = getTeammate(pid);
    return isPlayerAbsent(pid) && tm && isPlayerAbsent(tm);
  };
  const toggleAbsent = (pid) => {
    // Same lockdown as guardedSaveScore. Toggling absent on a finalized match
    // would change the team-net calculation but wouldn't rewrite the
    // match_result, creating the same drift. Force this through Schedule →
    // Edit Scores too, which handles absent flags as part of its diff/commit.
    if (scoresLocked) {
      const msg = isComm
        ? (isWeekLocked
            ? "Week is locked — use Schedule → Edit Scores to change attendance"
            : "Match attested — use Schedule → Edit Scores to change attendance")
        : (isWeekLocked
            ? "Week is locked — attendance cannot be changed"
            : "Scorecard attested — only commissioner can edit");
      setToast(msg);
      setTimeout(() => setToast(null), 3500);
      return;
    }
    const nowAbsent = !absentPlayers[pid];
    setAbsentPlayers(prev => {
      const next = { ...prev };
      if (nowAbsent) next[pid] = true; else delete next[pid];
      return next;
    });
    saveScore(week, pid, "absent", nowAbsent ? 1 : 0);
    // Bidirectional sync with Schedule's attendance system. Writing here
    // means Schedule's My Schedule / Full League views immediately reflect
    // the absent flag (with the diagonal stripe + Absent pill) without
    // requiring the player to have used the "I'm out" button. When
    // un-marking absent, the attendance flag is cleared — even if the
    // original source was Schedule, that's the expected behavior (you
    // un-marked them from the live scoring card, so the announcement
    // is no longer accurate).
    if (saveAttendance) {
      saveAttendance(week, pid, nowAbsent ? "absent" : null);
    }
  };

  // ── markMakeup ──────────────────────────────────────────────────────
  // Counterpart to toggleAbsent for the "Makeup" button next to Absent
  // in the player meta row. Writes attendance status="makeup", which the
  // existing render block picks up via isPlayerMakingUp to swap the score
  // card for the dimmed MAKING UP variant. If the player was previously
  // marked absent (_habsent=1), we explicitly clear that score-side flag
  // since makeup and absent are mutually exclusive — the match should
  // stay OPEN pending the makeup score, not auto-substitute teammate's
  // score as absent would.
  const markMakeup = (pid) => {
    if (scoresLocked) {
      const msg = isComm
        ? (isWeekLocked
            ? "Week is locked — use Schedule → Edit Scores to change attendance"
            : "Match attested — use Schedule → Edit Scores to change attendance")
        : (isWeekLocked
            ? "Week is locked — attendance cannot be changed"
            : "Scorecard attested — only commissioner can edit");
      setToast(msg);
      setTimeout(() => setToast(null), 3500);
      return;
    }
    if (!saveAttendance) return;
    // Clear absent state if this is a transition from absent → makeup.
    // The local state setter handles the optimistic UI; saveScore writes
    // the source-of-truth flag clear.
    if (absentPlayers[pid]) {
      setAbsentPlayers(prev => {
        const next = { ...prev };
        delete next[pid];
        return next;
      });
      saveScore(week, pid, "absent", 0);
    }
    saveAttendance(week, pid, "makeup");
  };

  // Sync local absent state from Firestore. Reruns whenever:
  //  - matchKey changes (user navigates to a different match)
  //  - holeScores updates (Firestore subscription delivers data)
  //
  // The holeScores dep is critical: on app cold-start, this effect fires once
  // before Firestore has responded — at that point `holeScores` is empty and
  // every `_habsent` read is undefined, so we'd reset absentPlayers to {}.
  // Without holeScores in the deps, the effect would never re-run when the
  // real data arrived, leaving absent flags silently dropped on reopen.
  // The user-visible bug: mark someone absent → close/reopen app → they're
  // shown as present again, even though Firestore still has the absent flag.
  //
  // The early-return guard avoids a setState (and the resulting re-render) on
  // every score keystroke when the absent set hasn't actually changed —
  // holeScores updates fire constantly during scoring, but absent state
  // changes rarely.
  useEffect(() => {
    if (!t1 || !t2) return;
    const abs = {};
    [...t1Players, ...t2Players].forEach(pid => {
      if (holeScores[`w${week}_p${pid}_habsent`] === 1) abs[pid] = true;
    });
    const sameKeys = Object.keys(abs).sort().join(",");
    const prevKeys = Object.keys(absentPlayers).sort().join(",");
    if (sameKeys === prevKeys) return;
    setAbsentPlayers(abs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey, holeScores, week]);

  // ── Attendance → _habsent auto-sync ──────────────────────────────
  // When a player flagged themselves "absent" in advance via Schedule,
  // mirror that into the existing _habsent mechanism so match calc
  // (which reads _habsent directly from holeScores) treats them as
  // absent without manual toggle. Fires once per week change.
  //
  // Deliberately one-way (attendance → _habsent, never the reverse):
  // clearing _habsent via the Undo button in Scoring shouldn't delete
  // the attendance announcement — those are different user actions.
  //
  // Deliberately NOT applied to makeup status: makeup players should
  // remain "unmarked" at match calc level so the match stays incomplete
  // until their scores are entered later.
  useEffect(() => {
    if (!attendance || !week || !t1 || !t2) return;
    // Gate on isWeekLocked only (not full scoresLocked) since isFullyAttested
    // is declared later in this component and would TDZ-error if read here.
    // If a week is locked, we shouldn't write attendance flags into it
    // anyway (rain-outs, etc.). The full-attestation case is a vanishingly
    // unlikely edge: the match closed before the player opened scoring AND
    // they had attendance marked. Safe enough to skip checking.
    if (isWeekLocked) return;
    const matchPids = [...t1Players, ...t2Players];
    for (const pid of matchPids) {
      const status = attendance[`w${week}_p${pid}`]?.status;
      if (status !== "absent") continue;
      if (holeScores[`w${week}_p${pid}_habsent`] === 1) continue;
      // Fire-and-forget; saveScore is idempotent for the absent flag.
      saveScore(week, pid, "absent", 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey, attendance, week, holeScores, isWeekLocked]);

  const allP = (t1 && t2) ? (isTeamNet
    ? [...t1Players, ...t2Players]
    : (() => { const t1s = [...t1Players].sort((a, b) => getHcp(a) - getHcp(b)); const t2s = [...t2Players].sort((a, b) => getHcp(a) - getHcp(b)); return [t1s[0], t2s[0], t1s[1], t2s[1]]; })()
  ) : [];

  const par = pars[curHole] || 4;
  const hcp = hcps[curHole] || 1;

  const getRawScore = (pid, h) => holeScores[`w${week}_p${pid}_h${h}`] || 0;
  const getS = (pid, h) => {
    if (isPlayerAbsent(pid)) {
      const tm = getTeammate(pid);
      if (!tm || isPlayerAbsent(tm)) {
        const strokes = getStrokesMap(getHcp(pid))[h] || 0;
        return (pars[h] || 4) + 1 + strokes;
      }
      return getRawScore(tm, h);
    }
    return getRawScore(pid, h);
  };
  const getNineHcp = (pid) => {
    // Absent-substitution model: present teammate "plays both positions",
    // so their handicap drives strokes for both score slots. Falls back to
    // own handicap when both teammates are absent (impute path) or when
    // the player is present. Mirrors matchCalc.js's readStrokesEffective.
    if (isBothAbsent(pid)) {
      const p = playerMap[pid];
      return p ? Math.round(p.handicapIndex || 0) : 0;
    }
    const effectivePid = isPlayerAbsent(pid) ? (getTeammate(pid) || pid) : pid;
    const p = playerMap[effectivePid];
    return p ? Math.round(p.handicapIndex || 0) : 0;
  };
  const getStrokes = (pid, h) => getStrokesMap(getNineHcp(pid))[h] || 0;
  const getRunning = (pid) => {
    let gross = 0, net = 0, thru = 0, parTotal = 0;
    for (let h = 0; h < 9; h++) { const s = getS(pid, h); if (s > 0) { gross += s; net += s - getStrokes(pid, h); parTotal += pars[h] || 4; thru++; } }
    return { gross, net, netVsPar: net - parTotal, thru };
  };
  const allComplete = allP.length > 0 && allP.every(pid => { for (let h = 0; h < 9; h++) if (getS(pid, h) <= 0) return false; return true; });
  const holeComplete = allP.length > 0 && allP.every(pid => getS(pid, curHole) > 0);

  // Detect players with a PARTIALLY filled card — at least one hole scored
  // but not all 9. This is the actionable "you forgot a hole" state: the
  // scorer has clearly been entering this player's scores, so a gap is a
  // mistake worth flagging (vs a player who hasn't started at all, who's
  // either making up or just hasn't teed off). Returns the missing hole
  // NUMBERS (1-indexed for display) per player so the alert can name them.
  const missingScores = allP.map(pid => {
    let started = false;
    const missing = [];
    for (let h = 0; h < 9; h++) {
      if (getS(pid, h) > 0) started = true;
      else missing.push(h + 1);
    }
    if (!started || missing.length === 0) return null; // not started, or complete
    const pl = players.find(p => p.id === pid);
    const initials = pl ? pl.name.split(' ').map(n => n[0]).join('') : "?";
    return { pid, initials, holes: missing };
  }).filter(Boolean);

  const existingResult = (t1 && t2) ? matchResults.find(r => r.week === week && r.team1Id === t1.id && r.team2Id === t2.id) : null;
  const isAlreadyFinalized = !!existingResult;

  // Clear justSigned and close popup once Firestore confirms the result
  useEffect(() => {
    if (isAlreadyFinalized && justSigned) {
      setJustSigned(false);
      setShowFinalize(false);
    }
  }, [isAlreadyFinalized, justSigned]);
  const isAttested = existingResult?.attested === true;
  const finalizedByTeamId = existingResult?.finalizedByTeamId || null;
  const signedByPlayerId = existingResult?.signedByPlayerId || null;
  const isTheSigner = leagueUser.playerId === signedByPlayerId;
  const isOnFinalizingTeam = myTeam && (finalizedByTeamId === myTeam.id || isTheSigner);
  const isOnOpposingTeam = myTeam && !isOnFinalizingTeam && (myTeam.id === (t1?.id) || myTeam.id === (t2?.id));

  // Multi-player attestation: all non-signing PRESENT players must attest
  const attestedBy = existingResult?.attestedBy || [];
  const allMatchPids = [...t1Players, ...t2Players];
  const nonSignerPids = allMatchPids.filter(pid => pid !== signedByPlayerId && !isPlayerAbsent(pid));
  // If no present non-signers (all absent), the signer's signature is sufficient
  const isFullyAttested = isAlreadyFinalized && (nonSignerPids.length === 0 || nonSignerPids.every(pid => attestedBy.includes(pid)));
  const iHaveAttested = attestedBy.includes(leagueUser.playerId);
  const isInThisMatch = allMatchPids.includes(leagueUser.playerId) || isComm;
  const needsAttestation = isAlreadyFinalized && !isFullyAttested && isInThisMatch && !isTheSigner && !iHaveAttested && !isPlayerAbsent(leagueUser.playerId);
  // Score-entry lockdown rules:
  //   - Week locked (Finalize Week tapped) → no Live Scoring writes for ANYONE,
  //     including the commissioner. Locked weeks are historical records.
  //     Retroactive edits go through Schedule → Edit Scores, which has the
  //     prepare/commit recalc flow that keeps match_result in sync with
  //     hole_scores. Allowing commish writes here would let them update
  //     hole_scores without re-running the match-result calculation, which
  //     creates drift (the "L showing for a tie match" bug).
  //   - Match fully attested → same lockdown for the same reason. Once a
  //     match is officially complete, post-hoc score changes need to flow
  //     through the channel that knows to recompute the result.
  //   - Player not in this match (rare in normal use; commish viewing
  //     someone else's card) → also locked.
  // Was: `(isWeekLocked && !isComm) || (isFullyAttested && !isComm)` — letting
  // commish bypass the lock here was the source of drift. Now uniform.
  const scoresLocked = isWeekLocked || isFullyAttested;

  // Tee time early-entry warning
  const teeTimeWarningDismissed = useRef(false);
  // Reset when match changes
  useEffect(() => { teeTimeWarningDismissed.current = false; }, [matchKey]);

  const getMatchTeeTimeMinutes = () => {
    if (!matchToScore || !matches.length) return null;
    const matchIdx = matches.indexOf(matchToScore);
    if (matchIdx < 0) return null;
    const base = leagueConfig?.startTime || "4:28 PM";
    const interval = leagueConfig?.teeInterval || 8;
    const [timePart, ampm] = base.split(' ');
    const [h, m] = timePart.split(':').map(Number);
    return (ampm === 'PM' && h !== 12 ? h + 12 : h) * 60 + m + matchIdx * interval;
  };

  // Returns true ONLY when the live wall clock is before the match's
  // scheduled start (date + tee time). Prior implementation compared only
  // hour:minute of the current day to hour:minute of the tee time — so the
  // day after the match (or any other day where now-of-day < tee-of-day),
  // it would falsely report "before tee time" and fire the early-entry
  // prompt. Now we anchor the tee time to wk.date and compare full Date
  // objects.
  const isBeforeTeeTime = () => {
    const teeMinutes = getMatchTeeTimeMinutes();
    if (teeMinutes === null) return false;
    const year = leagueConfig?.year || new Date().getFullYear();
    const matchDay = parseScheduleDate(weekSch?.date, year);
    if (!matchDay) return false;
    const teeAt = new Date(
      matchDay.getFullYear(), matchDay.getMonth(), matchDay.getDate(),
      Math.floor(teeMinutes / 60), teeMinutes % 60
    );
    return new Date() < teeAt;
  };

  const guardedSaveScore = (w, pid, h, val) => {
    if (scoresLocked) {
      // Different copy for commissioner vs regular user: regular users hit
      // the lockdown for ordinary reasons (their match is done), but commish
      // hits it because they need to use the recalc-aware edit path instead.
      // Pointing them at Schedule → Edit Scores keeps drift impossible.
      const msg = isComm
        ? (isWeekLocked
            ? "Week is locked — use Schedule → Edit Scores to change finalized scores"
            : "Match attested — use Schedule → Edit Scores to change finalized scores")
        : (isWeekLocked
            ? "Week is locked — scores cannot be changed"
            : "Scorecard attested — only commissioner can edit");
      setToast(msg);
      setTimeout(() => setToast(null), 3500);
      return;
    }
    // Compute existing score once — used by both the early-tee-time guard
    // (which should only fire for first-time entries) and the
    // complete-card edit guard below.
    const existingScore = getS(pid, h);
    // Check if before tee time. Two preconditions:
    //   1. The wall clock is genuinely before the match's date+time (not
    //      just before the tee time-of-day).
    //   2. There's no existing score on this hole yet — i.e. this is a
    //      first-time entry. Editing an already-saved score is never
    //      "early scoring" by definition; the points were already entered
    //      during/after the round.
    if (!teeTimeWarningDismissed.current && existingScore <= 0 && isBeforeTeeTime()) {
      setConfirmModal({
        title: "Early Score Entry",
        message: "You are trying to enter scores before your scheduled tee time. Continue?",
        onConfirm: () => { teeTimeWarningDismissed.current = true; setConfirmModal(null); saveScore(w, pid, h, val); },
      });
      return;
    }
    // Edit-protection on a complete card. If the player whose hole is being
    // tapped already has all 9 holes scored, AND the new value actually
    // changes something (skip idempotent re-tap of the same value, and skip
    // the rare 0→0 no-op), prompt before writing — every time. The prompt
    // fires on every attempted change (no session-memory dismissal),
    // because after a card is complete, every change is a deliberate
    // edit and deserves explicit confirmation. Easy to brush a finger
    // across a complete row while editing a teammate on a busy makeup day.
    //
    // The trigger condition is intentionally specific:
    //   • cardComplete: every hole has a non-zero score for this player
    //   • valueChanging: existing score differs from the new value
    // First-time entry (existing 0 → first score) and idempotent re-taps
    // never trigger. (existingScore was computed earlier for the
    // tee-time guard.)
    const cardComplete = (() => {
      for (let i = 0; i < 9; i++) if (getS(pid, i) <= 0) return false;
      return true;
    })();
    const valueChanging = existingScore !== val;
    if (cardComplete && valueChanging) {
      const player = playerMap[pid];
      const playerName = player?.name || "this player";
      // Convert internal hole index (0..8) to display hole number based on
      // which side this week is on. Front 9 → holes 1–9, Back 9 → holes
      // 10–18. Same convention used everywhere else hole numbers are
      // displayed (live scorecard header, par-3 CTP detection, etc.).
      const displayHole = side === 'front' ? h + 1 : h + 10;
      setConfirmModal({
        title: "Edit completed round?",
        message: `${playerName} has finished their round. Are you sure you want to change their hole ${displayHole} score?`,
        onConfirm: () => {
          setConfirmModal(null);
          saveScore(w, pid, h, val);
        },
      });
      return;
    }
    saveScore(w, pid, h, val);
  };

  const currentHoleIdx = (() => {
    for (let h = 0; h < 9; h++) { if (!allP.every(pid => getS(pid, h) > 0)) return h; }
    return 8;
  })();

  const hasAnyScores = allP.some(pid => { for (let h = 0; h < 9; h++) if (getS(pid, h) > 0) return true; return false; });

  // Initial hole-auto-jump for live scoring: when opening a match mid-round, jump to the
  // first unscored hole so the user doesn't start at hole 1. Original version had `[]` deps
  // and fired once on mount, but at mount Firestore scores haven't arrived yet so
  // currentHoleIdx was usually 0 and the jump never fired. Re-running until we've jumped
  // once (guarded by initialJump.current) ensures we catch the first render where scores
  // are present.
  useEffect(() => {
    if (initialJump.current) return;
    if (hasAnyScores) {
      if (currentHoleIdx > 0) setCurHole(currentHoleIdx);
      initialJump.current = true;
    }
  }, [currentHoleIdx, hasAnyScores]);

  // Signature of the current hole's scores — changes whenever ANY player's
  // score on this hole changes, even if the hole remains "complete" through
  // the change (e.g. editing a 2 to a 3). Used as an effect dep below so the
  // auto-advance timer restarts on every edit rather than locking in at the
  // moment the hole first becomes complete.
  const curHoleScoreSig = allP.map(pid => getS(pid, curHole)).join(",");

  useEffect(() => {
    if (holeComplete && curHole < 8 && !editing && !allComplete) {
      const holeNum = side === 'front' ? curHole + 1 : curHole + 10;
      setToast(`✓ Hole ${holeNum} saved — advancing...`);
      const timer = setTimeout(() => {
        setToast(null);
        let next = curHole + 1;
        while (next < 8 && allP.every(pid => getS(pid, next) > 0)) next++;
        setCurHole(next);
      }, 1800);
      return () => clearTimeout(timer);
    }
    // Include curHoleScoreSig so that editing a score within the 1800ms window
    // (e.g. correcting a 2 to a 3 before auto-advance fires) cancels the old
    // timer and starts a fresh one. Without this dep, the timer latches at the
    // moment of first completion and can't be interrupted by subsequent edits
    // on the same hole — producing the confusing "I pressed − and the screen
    // jumped to the next hole" behavior new users report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeComplete, curHole, editing, allComplete, curHoleScoreSig]);

  useEffect(() => {
    if (toast) {
      const safety = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(safety);
    }
  }, [toast]);

  // PRIOR BEHAVIOR: this useEffect auto-popped the Finalize/Sign Scorecard
  // screen 400ms after the last hole was scored. That intrudes when a player
  // typo'd hole 9 and is about to fix it — the popup hides the score buttons.
  // Removed in favor of the explicit "Sign Scorecard" button rendered just
  // below the live scorecard (see ~line 2338); users now choose when to sign.

  // ── Shared helper: get initials (with absent fallback) ──
  const getInitials = useCallback((pid) => {
    const effectivePid = isPlayerAbsent(pid) ? (getTeammate(pid) || pid) : pid;
    const pl = playerMap[effectivePid];
    return pl ? pl.name.split(' ').map(n => n[0]).join('') : "?";
  }, [playerMap, absentPlayers]);

  // ── Commish: force-attest all signed-but-unattested matches for this week ──
  // Normal flow requires every present non-signer to tap Attest individually.
  // This bypasses that when the real-world attestation loop stalls (e.g. players
  // left, commissioner needs to close out the week).
  const weekSignedUnattestedCount = useMemo(() => {
    return matchResults.filter(r => r.week === week && !r.attested).length;
  }, [matchResults, week]);

  // ═════════════════════════════════════════════════════════════════════
  // EARLY RETURNS — relocated from above the hooks block (see explanatory
  // comment near `const matchToScore = ...`). Every hook above runs on
  // every render, regardless of which return below fires; the React Rules
  // of Hooks are now respected. Order of the returns is intentional:
  //   1. Course not configured → page can't render anything useful.
  //   2. No matches scheduled this week → page has nothing to score.
  //   3. User has no linked player → empty state pointing at commish.
  //   4. User linked but no match this week → silently switch to All
  //      Matches view (returning null lets the next render pick it up).
  // ═════════════════════════════════════════════════════════════════════
  if (!course?.name) return <EmptyState icon="flag" title="Course not configured" subtitle="Commissioner needs to set up the course." />;
  if (!matches.length) return <EmptyState icon="calendar" title="No matches this week" subtitle="Commissioner needs to set the schedule." />;

  // Onboarding fallback — a brand-new user can land here with no match of
  // their own to score (not linked to a player yet, not on a team, or
  // bye week). Without these guards, the render path below assumes `t1`
  // and `t2` are non-null and crashes when reading `.player1` etc.
  if (!activeMatch && !myMatch) {
    if (!leagueUser.playerId) {
      return <EmptyState icon="user" title="Account not linked" subtitle="Your commissioner needs to link your account to a player profile before you can score. In the meantime, you can view other matches from the Schedule tab." />;
    }
    // Linked but no match this week → auto-switch to All Matches.
    // Calling setView during render is safe here: it triggers a re-render
    // where `view === "allMatches"` and this branch no longer fires, so
    // there's no infinite loop. Hooks above still run on this render too,
    // so React's hook-order invariant is preserved.
    if (view !== "allMatches") {
      setView("allMatches");
      return null;
    }
  }

  const handleAttestAllWeek = () => {
    const pending = matchResults.filter(r => r.week === week && !r.attested);
    if (pending.length === 0) {
      setToast("No signed matches pending attestation");
      setTimeout(() => setToast(null), 2000);
      return;
    }
    setConfirmModal({
      title: `Force-attest ${pending.length} match${pending.length === 1 ? "" : "es"}?`,
      message: `This bypasses the opposing-team signature requirement for all signed matches in Week ${week}. Use when the normal attestation flow is blocked.`,
      onConfirm: async () => {
        setConfirmModal(null);
        for (const r of pending) {
          // Populate attestedBy with all non-signer player IDs so downstream UI checks
          // (e.g., isFullyAttested, "N of M attested" badges) stay internally consistent
          // with attested:true.
          const t1 = teams.find(t => t.id === r.team1Id);
          const t2 = teams.find(t => t.id === r.team2Id);
          const allPids = [t1?.player1, t1?.player2, t2?.player1, t2?.player2].filter(Boolean);
          const nonSignerPids = allPids.filter(pid => pid !== r.signedByPlayerId);
          await saveMatchResult({ ...r, attested: true, attestedBy: nonSignerPids });
        }
        setToast(`${pending.length} match${pending.length === 1 ? "" : "es"} attested`);
        setTimeout(() => setToast(null), 2000);
      },
    });
  };

  // ── Three-way view toggle helper (used by My Match, All Matches, and Low Net views) ──
  const ViewToggle = () => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 10 }}>
      <div style={{ display: "flex", background: K.inp, borderRadius: 20, border: `1px solid ${K.bdr}`, padding: 3 }}>
        {[
          { id: "myMatch", label: "My Match" },
          { id: "allMatches", label: "All Matches" },
          { id: "lowNet", label: "Low Net" },
        ].map(opt => {
          const isActive = view === opt.id;
          return (
            <button key={opt.id} onClick={() => { if (!isActive) setView(opt.id); }} style={{
              padding: "6px 14px", borderRadius: 17,
              cursor: isActive ? "default" : "pointer",
              fontSize: 12, fontWeight: 700, border: "none",
              background: isActive ? K.acc : "transparent",
              color: isActive ? K.bg : K.t3,
              transition: "all .2s",
            }}>{opt.label}</button>
          );
        })}
      </div>
    </div>
  );

  // ── All Matches view ──
  if (showAllMatches && !activeMatch) {
    const formatTeeTime = (idx) => fmtTeeTimeUtil(leagueConfig?.startTime || "4:28 PM", idx, leagueConfig?.teeInterval || 8);
    const dn = (pid) => {
      const pl = playerMap[pid];
      if (!pl) return "TBD";
      const parts = pl.name.split(' ');
      return parts.length > 1 ? parts[parts.length - 1] : parts[0];
    };
    const amGetHcp = (pid) => {
      // Absent-substitution model: when a player is marked absent and their
      // teammate is present, the present teammate is "playing both positions".
      // Both score slots use the teammate's gross AND the teammate's handicap
      // for stroke allocation. Without this, the absent row would render its
      // own stroke pattern over the teammate's substituted score, mismatching
      // what the team actually receives. matchCalc.js's readStrokesEffective
      // applies the same rule to net calculation, so display and saved totals
      // stay in sync.
      const absent = holeScores[`w${week}_p${pid}_habsent`] === 1;
      if (absent) {
        for (const m of matches) {
          const mt1 = teams.find(t => t.id === m.team1);
          const mt2 = teams.find(t => t.id === m.team2);
          const t1p = [mt1?.player1, mt1?.player2].filter(Boolean);
          const t2p = [mt2?.player1, mt2?.player2].filter(Boolean);
          let tm = null;
          if (t1p.includes(pid)) tm = t1p.find(p => p !== pid);
          else if (t2p.includes(pid)) tm = t2p.find(p => p !== pid);
          if (tm && holeScores[`w${week}_p${tm}_habsent`] !== 1) {
            const p = playerMap[tm];
            return p ? Math.round(p.handicapIndex || 0) : 0;
          }
          if (tm !== null) break;
        }
      }
      const p = playerMap[pid];
      return p ? Math.round(p.handicapIndex || 0) : 0;
    };
    const amGetScore = (pid, h) => holeScores[`w${week}_p${pid}_h${h}`] || 0;
    const amGetStrokes = (pid, h) => getStrokesMap(amGetHcp(pid))[h] || 0;

    const getThru = (mT1Pids, mT2Pids) => {
      let thru = 0;
      for (let h = 0; h < 9; h++) {
        const presentPids = [...mT1Pids, ...mT2Pids].filter(pid => holeScores[`w${week}_p${pid}_habsent`] !== 1);
        const allOk = presentPids.length > 0 && presentPids.every(pid => amGetScore(pid, h) > 0);
        if (allOk) thru = h + 1;
        else break;
      }
      return thru;
    };

    return (
      <div style={{ maxWidth: 540, margin: "0 auto" }}>
        <ViewToggle />
        {FinalizeBanner}

        <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
          {matches.map((m, mi) => {
            const rawT1 = teams.find(t => t.id === m.team1);
            const rawT2 = teams.find(t => t.id === m.team2);
            if (!rawT1 || !rawT2) return null;
            const res = matchResults.find(r => r.week === week && r.team1Id === m.team1 && r.team2Id === m.team2);
            const isMyMatch = myTeam && (m.team1 === myTeam.id || m.team2 === myTeam.id);
            const isExp = expandedMatch === mi;

            const swapped = isMyMatch && m.team2 === myTeam.id;
            const dispT1 = swapped ? rawT2 : rawT1;
            const dispT2 = swapped ? rawT1 : rawT2;
            const score1 = res ? (swapped ? res.team2Points : res.team1Points) : null;
            const score2 = res ? (swapped ? res.team1Points : res.team2Points) : null;

            const mT1Pids = [rawT1.player1, rawT1.player2];
            const mT2Pids = [rawT2.player1, rawT2.player2];
            const thru = getThru(mT1Pids, mT2Pids);

            // Compute live match score (collapsed card header).
            // Must be absent-aware: when a player is absent, their teammate's
            // score is substituted (mirroring how the expanded scorecard's MATCH
            // row computes hole results via amGetEffectiveScore at line ~971).
            // Without this substitution, an absent player's missing score reads
            // as 0 in the net calculation, making their side appear to win every
            // hole by a huge margin — which is how a match that's actually 1UP
            // through 5 was displaying as "5UP" in the card header.
            //
            // Both teammates absent: imputed net-bogey (par + 1 + strokes), same
            // fallback amGetEffectiveScore uses.
            const isAbsentLocal = (pid) => holeScores[`w${week}_p${pid}_habsent`] === 1;
            const teammateOf = (pid) => {
              if (mT1Pids.includes(pid)) return mT1Pids.find(p => p !== pid);
              if (mT2Pids.includes(pid)) return mT2Pids.find(p => p !== pid);
              return null;
            };
            const effectiveScore = (pid, h) => {
              if (isAbsentLocal(pid)) {
                const tm = teammateOf(pid);
                if (!tm || isAbsentLocal(tm)) {
                  const strokesOnHole = getStrokesMap(amGetHcp(pid))[h] || 0;
                  return (pars[h] || 4) + 1 + strokesOnHole;
                }
                return amGetScore(tm, h);
              }
              return amGetScore(pid, h);
            };

            let dispCum = 0;
            if (thru > 0) {
              let cum = 0;
              for (let h = 0; h < thru; h++) {
                let n1 = 0, n2 = 0;
                mT1Pids.forEach(pid => { n1 += effectiveScore(pid, h) - amGetStrokes(pid, h); });
                mT2Pids.forEach(pid => { n2 += effectiveScore(pid, h) - amGetStrokes(pid, h); });
                if (n1 < n2) cum += 1; else if (n2 < n1) cum -= 1;
              }
              dispCum = swapped ? -cum : cum;
            }

            const isFinalOrSigned = !!res;
            const isTied = isFinalOrSigned ? (res.matchResultText === "TIED") : (thru > 0 && dispCum === 0);
            const matchIsTied = res?.matchResultText === "TIED";
            // For finalized matches use the match-play winner (matchWinnerId via
            // resultLetterFor); for in-progress matches fall back to running cum.
            // Points compare is wrong here for the same reason it's wrong on
            // Schedule — TIED match-play can produce asymmetric points.
            const t1Leading = matchIsTied ? false : isFinalOrSigned ? (resultLetterFor(res, dispT1?.id) === "W") : (dispCum > 0);
            const t2Leading = matchIsTied ? false : isFinalOrSigned ? (resultLetterFor(res, dispT2?.id) === "W") : (dispCum < 0);

            const isSigned = isFinalOrSigned && res && !res.attested;
            const signerIsRawT1 = isSigned && res.finalizedByTeamId === rawT1.id;
            const signerIsRawT2 = isSigned && res.finalizedByTeamId === rawT2.id;
            const resAttestedBy = res?.attestedBy || [];
            const resAllPids = [...mT1Pids, ...mT2Pids];
            const resAbsent = (pid) => holeScores[`w${week}_p${pid}_habsent`] === 1;
            const resNonSigners = resAllPids.filter(pid => pid !== res?.signedByPlayerId && !resAbsent(pid));
            const resAttestedCount = resNonSigners.filter(pid => resAttestedBy.includes(pid)).length;
            const attestNeededDispT1 = isSigned && (
              (swapped && signerIsRawT1) || (!swapped && signerIsRawT2)
            );
            const attestNeededDispT2 = isSigned && !attestNeededDispT1;

            let centerText = "";
            let centerColor = K.t1;
            let progressLabel = "";
            let progressColor = K.t3;

            if (isFinalOrSigned) {
              centerText = res.matchResultText || `${score1}-${score2}`;
              centerColor = matchIsTied ? K.t3 : K.t1;
              if (res.attested) { progressLabel = "FINAL"; progressColor = K.grn; }
              // When signed-but-not-yet-fully-attested, leave the center strip clean —
              // the N/M ATTEST counter lives in the attesters row below now.
            } else if (thru > 0) {
              // Match-play clinch awareness: a match ends when a team's lead
              // exceeds the holes remaining. Past that point, additional net
              // hole wins don't change the result — but the raw dispCum tally
              // keeps counting them, which inflated a clinched 4&3 match into
              // a displayed "5UP". Run the same clinch detection the per-hole
              // MATCH row uses and prefer its result when the match has been
              // decided. amGetStrokes/effectiveScore are the same inputs used
              // to build dispCum, so the two stay consistent.
              const cs = computeMatchStatus(
                mT1Pids, mT2Pids,
                (pid, h) => effectiveScore(pid, h),
                (pid, h) => amGetStrokes(pid, h),
                pars
              );
              if (cs.clinchText && cs.clinchHole !== null && cs.clinchText !== "TIED") {
                // Match decided early (e.g., "4&3") — show that, not the
                // inflated running cumulative. centerColor stays neutral
                // dark since there IS a winner.
                centerText = cs.clinchText;
                centerColor = K.t1;
              } else if (dispCum > 0) { centerText = dispCum + "UP"; centerColor = K.t1; }
              else if (dispCum < 0) { centerText = Math.abs(dispCum) + "UP"; centerColor = K.t1; }
              else { centerText = "AS"; centerColor = K.t3; }
              progressLabel = "Thru " + thru;
            } else {
              // No complete hole has been scored yet on the match. Three
              // sub-cases, in priority order:
              //   (a) Any player is flagged "making up" — show PENDING MAKEUP
              //       since that's the SPECIFIC reason the match is open.
              //       Overrides the generic PENDING/tee-time labels below
              //       because it carries actionable info ("we're waiting on
              //       this person's later round" vs "the round is incomplete").
              //   (b) Some players HAVE entered scores but the match-play
              //       status can't be computed because at least one player
              //       hasn't yet — show generic PENDING.
              //   (c) Nobody has entered any scores. Show scheduled tee time.
              const pendingMakeup = isMatchPendingMakeup([...mT1Pids, ...mT2Pids], attendance, week);
              const anyScoreEntered = [...mT1Pids, ...mT2Pids].some(pid => {
                for (let h = 0; h < 9; h++) {
                  if ((holeScores[`w${week}_p${pid}_h${h}`] || 0) > 0) return true;
                }
                return false;
              });
              if (pendingMakeup) {
                centerText = "PENDING";
                centerColor = K.act;
              } else if (anyScoreEntered) {
                centerText = "PENDING";
                centerColor = K.act;
              } else {
                centerText = formatTeeTime(mi);
                centerColor = K.act;
              }
            }

            // When the match is "PENDING" (some scores entered, others not),
            // highlight any player whose 9-hole card is incomplete in the same
            // gold so it's obvious *who* the match is waiting on. Players
            // with all 9 holes entered render in the normal text color even
            // while the match is pending. Outside the PENDING state — match
            // is final/signed/in-progress, or hasn't started — every name
            // renders normally.
            // Name color resolves in priority order:
            //   1. Attendance "makeup" → K.act gold (this player is making
            //      up their round later — the match waits on them)
            //   2. Attendance "absent" → K.red (this player isn't here)
            //   3. Default → K.t1
            //
            // Deliberately does NOT gold players merely for having an
            // incomplete card. During normal live play every player has an
            // incomplete card until their last hole is entered — that's not
            // a "needs attention" state. The earlier version golded any
            // incomplete player while the match was PENDING, which wrongly
            // flagged actively-playing players whenever their OPPONENTS were
            // making up (the whole match goes PENDING, but only the makeup
            // players should be gold). Attendance status is per-player, so
            // it cleanly separates "making up" from "still on the course."
            //
            // Color-token gotcha: K.act = maize gold (#deab12, brand color),
            // K.acc = light gray. Easy to confuse — makeup should be K.act.
            // Helper: has this player entered ANY score this week?
            // The gold "making up — we're waiting on them" flag should only
            // apply to players who haven't started. A player actively
            // playing (even if not yet finished — e.g. THRU 8) has scores
            // entered and should render normally, not gold. A making-up
            // player with zero scores is the genuine pending case.
            const hasStartedScoring = (pid) => {
              for (let h = 0; h < 9; h++) {
                if ((holeScores[`w${week}_p${pid}_h${h}`] || 0) > 0) return true;
              }
              return false;
            };
            const nameColor = (pid) => {
              const attnStatus = attendance?.[`w${week}_p${pid}`]?.status;
              // Makeup gold only while the player hasn't entered any scores
              // yet — once they start playing/making up their round, the
              // name renders normally. This keeps actively-playing players
              // (who have scores) from ever showing gold.
              if (attnStatus === "makeup" && !hasStartedScoring(pid)) return K.act;
              if (attnStatus === "absent") return K.red;
              return K.t1;
            };

            // ── Map Scoring's per-match data → TeamMatchupCard props ──
            //
            // Scoring's All Matches card is the most feature-dense of the
            // three matchup-card sites: live progress with green leader
            // arrows, name color shifts during PENDING state, attestation
            // status row, and the expanded scorecard panel. All of those
            // map cleanly onto TeamMatchupCard's slots:
            //
            //   • team1/team2 names: { text, color } objects so PENDING
            //     state can pulse incomplete players in K.act gold
            //   • center: custom JSX with the leader-arrow flanks
            //   • footer: the attestation status row (signer + attesters)
            //   • expanded: the SharedScorecard scorecard
            //
            // The leader arrows are rendered HERE in the caller because
            // they're not a generic "arrow at result" pattern — they only
            // appear in Scoring's live-leading state, never in Schedule
            // (which just shows the final result text) or Standings.
            const team1Props = {
              name1Line1: { text: dn(dispT1?.player1), color: nameColor(dispT1?.player1) },
              name1Line2: { text: dn(dispT1?.player2), color: nameColor(dispT1?.player2) },
              seed: showSeeds ? (seedMap[dispT1?.id] || null) : null,
            };
            const team2Props = {
              name1Line1: { text: dn(dispT2?.player1), color: nameColor(dispT2?.player1) },
              name1Line2: { text: dn(dispT2?.player2), color: nameColor(dispT2?.player2) },
              seed: showSeeds ? (seedMap[dispT2?.id] || null) : null,
            };

            // Center strip: result/status text, flanked by green leader arrows
            // when one team is leading on a finalized match. Chevron underneath
            // when expandable.
            const arrowFlankL = t1Leading && isFinalOrSigned ? (
              <div style={{
                position: "absolute", right: "100%", top: "50%",
                transform: "translateY(-50%)",
                marginRight: 6,
                width: 0, height: 0,
                borderTop: "6px solid transparent",
                borderBottom: "6px solid transparent",
                borderRight: `8px solid ${K.matchGrn}`,
              }} />
            ) : null;
            const arrowFlankR = t2Leading && isFinalOrSigned ? (
              <div style={{
                position: "absolute", left: "100%", top: "50%",
                transform: "translateY(-50%)",
                marginLeft: 6,
                width: 0, height: 0,
                borderTop: "6px solid transparent",
                borderBottom: "6px solid transparent",
                borderLeft: `8px solid ${K.matchGrn}`,
              }} />
            ) : null;
            const center = (
              <>
                <div style={{ position: "relative", display: "inline-block" }}>
                  {arrowFlankL}
                  <div style={{
                    fontSize: centerText.length > 5 ? 14 : centerText.length > 3 ? 15 : 17, fontWeight: 800,
                    color: centerColor, letterSpacing: .3,
                    whiteSpace: "nowrap", textAlign: "center", lineHeight: 1.05,
                  }}>{centerText}</div>
                  {arrowFlankR}
                </div>
                <div style={{ fontSize: 11, color: K.t3, lineHeight: 1, marginTop: 2 }}>
                  {isExp ? "▴" : "▾"}
                </div>
              </>
            );

            // Attestation row builder — IIFE because it's bulky and we
            // only want to compute it once per render. Returns null when
            // there's no signer AND no attester slots to show (degenerate
            // case for empty matches), which collapses the footer prop
            // to undefined and TeamMatchupCard skips it cleanly.
            const attestationFooter = (() => {
              const signer = playerMap[res?.signedByPlayerId];
              const hasSigner = !!signer;
              const attesterList = hasSigner
                ? resNonSigners
                : (() => {
                    const allPids = [...mT1Pids, ...mT2Pids].filter(pid =>
                      holeScores[`w${week}_p${pid}_habsent`] !== 1
                    );
                    return allPids.slice(0, Math.max(0, allPids.length - 1));
                  })();
              if (!hasSigner && attesterList.length === 0) return null;

              const initialsOf = (pid) => {
                const p = playerMap[pid];
                if (!p) return "";
                return p.name.split(' ').map(n => n[0]).join('').toUpperCase();
              };
              const Badge = ({ pid, filled }) => (
                <div style={{
                  width: 18, height: 18, borderRadius: "50%",
                  background: filled ? K.t2 : K.card,
                  border: `1.5px solid ${K.t2}`,
                  color: filled ? "#fff" : K.t2,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8, fontWeight: 800, letterSpacing: -.2,
                }}>{pid ? initialsOf(pid) : ""}</div>
              );

              return (
                <div style={{
                  borderTop: `1px solid ${K.bdr}30`,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "5px 10px", gap: 8,
                  fontSize: 10, color: K.t3, lineHeight: 1.3,
                  position: "relative",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 600, letterSpacing: .3, textTransform: "uppercase", fontSize: 9 }}>Signed</span>
                    <Badge pid={signer?.id} filled={!!signer} />
                  </div>
                  {progressLabel && (
                    <div style={{
                      position: "absolute", left: "50%", top: "50%",
                      transform: "translate(-50%, -50%)",
                      fontSize: 9, fontWeight: 700, color: progressColor,
                      textTransform: "uppercase", letterSpacing: .8,
                      whiteSpace: "nowrap",
                      pointerEvents: "none",
                    }}>{progressLabel}</div>
                  )}
                  {attesterList.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontWeight: 600, letterSpacing: .3, textTransform: "uppercase", fontSize: 9, marginRight: 2 }}>Attested</span>
                      {attesterList.map((pid, i) => (
                        <Badge
                          key={`att-${pid || i}`}
                          pid={hasSigner ? pid : null}
                          filled={hasSigner && resAttestedBy.includes(pid)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })();

            // Expanded scorecard — same SharedScorecard call as before,
            // wrapped in TeamMatchupCard's `expanded` slot so the card's
            // outer chrome (border, radius, shadow) wraps it cleanly.
            const expandedPanel = isExp ? (() => {
              const amIsAbsent = (pid) => holeScores[`w${week}_p${pid}_habsent`] === 1;
              const amGetEffectiveScore = (pid, h) => readScoreEffective({
                pid, h, week, holeScores,
                t1Pids: mT1Pids, t2Pids: mT2Pids,
                pars, hcps, players,
              });
              const amGetEffectiveStrokes = (pid, h) => readStrokesEffectiveExt({
                pid, h, week, holeScores,
                t1Pids: mT1Pids, t2Pids: mT2Pids,
                players, hcps,
              });
              const amGetInitials = (pid) => { const pl = playerMap[pid]; return pl ? pl.name.split(' ').map(n => n[0]).join('') : "?"; };

              const dispT1Pids = swapped ? mT2Pids : mT1Pids;
              const dispT2Pids = swapped ? mT1Pids : mT2Pids;

              const rawStatus = computeMatchStatus(mT1Pids, mT2Pids, amGetEffectiveScore, amGetEffectiveStrokes, pars);
              const dispHoleResults = swapped ? rawStatus.holeResults.map(r => r !== null ? -r : null) : rawStatus.holeResults;
              const dispRunning = []; let dCum = 0;
              dispHoleResults.forEach(r => { if (r !== null) dCum += r; dispRunning.push(r !== null ? dCum : null); });
              let dispClinchHole = null, dispClinchText = null;
              for (let h = 0; h < 9; h++) {
                if (dispRunning[h] === null) break;
                const lead = Math.abs(dispRunning[h]);
                const rem = 8 - h;
                if (lead > rem) {
                  dispClinchHole = h;
                  const updn = dispRunning[h] > 0 ? "UP" : "DN";
                  dispClinchText = rem > 0 ? lead + "&" + rem : lead + updn;
                  break;
                }
              }

              const sc = SharedScorecard({
                pars, side, hcps, team1Pids: dispT1Pids, team2Pids: dispT2Pids,
                getScore: amGetEffectiveScore, getStrokes: amGetEffectiveStrokes, getHcp: amGetHcp,
                getInitials: amGetInitials, isAbsent: amIsAbsent,
                holeResults: dispHoleResults, runningStatus: dispRunning,
                clinchHole: dispClinchHole, clinchText: dispClinchText,
                variant: "allMatches", showTotals: true, matchGrn,
              });

              return (
                <div style={{ padding: "6px 8px 10px", borderTop: `1px solid ${K.bdr}30` }}>
                  <sc.HoleRow />
                  <sc.ParRow />
                  {weekSch?.isPlayoff && <sc.HcpRow />}
                  <sc.TeamLabelRow name={dispT1?.name} seed={showSeeds ? (seedMap[dispT1?.id] || null) : null} />
                  {dispT1Pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
                  <sc.TeamNetRow pids={dispT1Pids} isTeam1Side={true} />
                  <sc.MatchRow />
                  <sc.TeamLabelRow name={dispT2?.name} seed={showSeeds ? (seedMap[dispT2?.id] || null) : null} />
                  {dispT2Pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
                  <sc.TeamNetRow pids={dispT2Pids} isTeam1Side={false} />
                </div>
              );
            })() : null;

            return (
              <TeamMatchupCard
                key={mi}
                team1={team1Props}
                team2={team2Props}
                winnerSide={t1Leading ? "team1" : t2Leading ? "team2" : null}
                isFinal={isFinalOrSigned}
                highlightSelf={!!isMyMatch}
                isConsolation={true}
                centerWidth={90}
                onClick={() => setExpandedMatch(isExp ? null : mi)}
                center={center}
                footer={attestationFooter}
                expanded={expandedPanel}
              />
            );
          })}
        </div>

        {/* CTP shortcut (1.3C) — once the week is locked, expose a
            one-tap path to the CTP results for this week. Without this,
            the user has to nav to More → CTP, which is 2 taps deeper.
            Visible only when there's actually CTP data for this week
            (the par-3 holes have been recorded) — otherwise the button
            would lead to an empty view. Uses hash routing for nav
            consistency with the rest of the app. */}
        {isWeekLocked && ctpData.some(c => c.week === week && c.playerId) && (
          <button
            onClick={() => { window.location.hash = "ctp"; }}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              width: "100%", marginTop: 10,
              padding: "10px 14px", borderRadius: 10,
              background: K.card, border: `1px solid ${K.act}40`,
              color: K.act, fontSize: 12, fontWeight: 800,
              letterSpacing: 1, textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            <span>🏌️</span>
            <span>View CTP Results for Week {week}</span>
            <span style={{ fontSize: 14 }}>›</span>
          </button>
        )}

        {isComm && (
          <div style={{ marginTop: 12 }}>
            {/* Rain Out button — only visible when commish toggle is on */}
            {commMode && !isWeekLocked && !allMatchesAttested && (
              <button onClick={() => {
                const isRoundRobin = !weekSch.isPlayoff && !weekSch.seeded && !weekSch.makeupFor;
                const lastRRWeekNum = Math.max(0, ...schedule.filter(s =>
                  (!s.isPlayoff && !s.seeded && !s.makeupFor) || (s.makeupFor && !s.isPlayoff)
                ).map(s => s.week));
                // Find first non-locked slot at or after ideal insert position
                const insertTarget = isRoundRobin ? lastRRWeekNum + 1 : weekSch.week + 1;
                let makeupWeekNum = insertTarget;
                while (schedule.some(s => s.week === makeupWeekNum && s.locked === true)) {
                  makeupWeekNum++;
                }
                // Count what will be wiped
                const weekHoleScoreCount = Object.keys(holeScores).filter(k => k.startsWith(`w${week}_`)).length;
                const weekMatchResultCount = matchResults.filter(r => r.week === week).length;
                const weekCtpCount = ctpData.filter(c => c.week === week).length;
                const willWipe = weekHoleScoreCount > 0 || weekMatchResultCount > 0 || weekCtpCount > 0;

                const msgLines = [
                  `This will skip this week and insert a makeup week at week ${makeupWeekNum}. Unlocked future weeks will shift forward. Locked weeks stay put.`,
                ];
                if (willWipe) {
                  const parts = [];
                  if (weekHoleScoreCount > 0) parts.push(`${weekHoleScoreCount} hole score${weekHoleScoreCount === 1 ? "" : "s"}`);
                  if (weekMatchResultCount > 0) parts.push(`${weekMatchResultCount} signed match${weekMatchResultCount === 1 ? "" : "es"}`);
                  if (weekCtpCount > 0) parts.push(`${weekCtpCount} CTP`);
                  msgLines.push("");
                  msgLines.push(`All existing data for this week will be permanently deleted: ${parts.join(", ")}. This data will need to be re-entered at the makeup week.`);
                }
                const msgDetail = msgLines.join("\n");

                setConfirmModal({
                  title: `Rain out Week ${week}?`,
                  message: msgDetail,
                  onConfirm: async () => {
                    const year = leagueConfig?.year || new Date().getFullYear();
                    const parseDate = (dateStr) => {
                      if (!dateStr) return null;
                      const d = new Date(`${dateStr}, ${year}`);
                      return isNaN(d.getTime()) ? null : d;
                    };
                    const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                    // Mark the week as rained out (clear matches since they're moved to makeup)
                    await saveWeekSchedule({ ...weekSch, rainedOut: true, matches: [] });

                    // Hard-delete all partial data from this week so handicaps, stats,
                    // and standings don't carry stale info once the makeup is played.
                    if (clearWeekData) await clearWeekData(week);

                    // Build shift map: non-locked weeks at or after makeupWeekNum skip over locked weeks
                    const lockedWeekNums = new Set(schedule.filter(s => s.locked === true).map(s => s.week));
                    const reserved = new Set(lockedWeekNums);
                    reserved.add(weekSch.week); // rained-out week stays put

                    const ascShifts = schedule
                      .filter(s => s.week >= makeupWeekNum && s.locked !== true && s.week !== weekSch.week)
                      .sort((a, b) => a.week - b.week);

                    const shiftMap = {};
                    let cursor = makeupWeekNum + 1;
                    for (const fw of ascShifts) {
                      while (reserved.has(cursor)) cursor++;
                      shiftMap[fw.week] = cursor;
                      reserved.add(cursor);
                      cursor++;
                    }

                    // Apply shifts descending by new week number
                    const shiftEntries = Object.entries(shiftMap).map(([oldW, newW]) => ({ oldW: parseInt(oldW), newW })).sort((a, b) => b.newW - a.newW);
                    for (const { oldW, newW } of shiftEntries) {
                      const fw = schedule.find(s => s.week === oldW);
                      if (!fw) continue;
                      let newDate = fw.date || "";
                      const parsed = parseDate(fw.date);
                      if (parsed) {
                        parsed.setDate(parsed.getDate() + (newW - oldW) * 7);
                        newDate = fmtDate(parsed);
                      }
                      if (deleteWeekSchedule) await deleteWeekSchedule(fw.id);
                      if (setWeekSchedule) await setWeekSchedule({ ...fw, id: `${LEAGUE_ID}_w${newW}`, week: newW, date: newDate });
                      else await saveWeekSchedule({ ...fw, id: `${LEAGUE_ID}_w${newW}`, week: newW, date: newDate });
                    }

                    // Create makeup week
                    const neighborWeek = schedule.find(s => s.week === makeupWeekNum - 1) || weekSch;
                    let makeupDate = "";
                    const nParsed = parseDate(neighborWeek?.date);
                    if (nParsed) {
                      nParsed.setDate(nParsed.getDate() + 7);
                      makeupDate = fmtDate(nParsed);
                    }
                    const makeupSide = neighborWeek?.side === 'front' ? 'back' : 'front';

                    const makeupDoc = {
                      id: `${LEAGUE_ID}_w${makeupWeekNum}`,
                      week: makeupWeekNum,
                      matches: [...(weekSch.matches || [])],
                      side: weekSch.side || makeupSide,
                      date: makeupDate,
                      makeupFor: weekSch.week,
                      isPlayoff: weekSch.isPlayoff || false,
                      seeded: weekSch.seeded || false,
                    };
                    if (setWeekSchedule) await setWeekSchedule(makeupDoc);
                    else await saveWeekSchedule(makeupDoc);

                    setConfirmModal(null);
                    setToast("Week " + week + " rained out");
                    setTimeout(() => { setToast(null); setShowAllMatches(false); }, 2000);
                  },
                });
              }} style={{ width: "100%", padding: 12, borderRadius: 10, marginBottom: 8, cursor: "pointer", background: K.warn + "15", border: `1.5px solid ${K.warn}50`, color: K.warn, fontSize: 13, fontWeight: 700 }}>
                Rain Out Week {week}
              </button>
            )}
            {/* Attest All Signed — force-attest pending match results for this week.
                Only visible when the commish toggle is on (matches Rain Out gate). */}
            {commMode && !isWeekLocked && weekSignedUnattestedCount > 0 && (
              <button onClick={handleAttestAllWeek} style={{ width: "100%", padding: 12, borderRadius: 10, marginBottom: 8, cursor: "pointer", background: K.hcpBlue + "15", border: `1.5px solid ${K.hcpBlue}50`, color: K.hcpBlue, fontSize: 13, fontWeight: 700 }}>
                Attest All Signed ({weekSignedUnattestedCount})
              </button>
            )}
            {/* Bottom-of-list "Finalize Week N" button removed — the app-level
                gold banner above the tab navigation is the single entry point
                for finalization. Was previously a third redundant CTA along
                with the in-Scoring banner and the app-level banner. */}
          </div>
        )}

        {/* CTP Selection Popup */}
        {showCtpPopup && (() => {
          const par3Holes = pars.map((p, i) => p === 3 ? (side === 'front' ? i + 1 : i + 10) : null).filter(Boolean);
          const allPlayersSorted = [...players].sort((a, b) => a.name.localeCompare(b.name));

          const handleFinalize = async () => {
            tapBigAction();
            // Save CTP selections
            for (const holeNum of par3Holes) {
              const sel = ctpSelections[holeNum];
              if (sel && sel.playerId) {
                await saveCtp({
                  id: `${LEAGUE_ID}_w${week}_h${holeNum}`,
                  week, holeNum,
                  playerId: sel.playerId,
                  distance: sel.distance || "",
                  season: 2026,
                });
              }
            }
            // Lock the week
            await saveWeekSchedule({ ...weekSch, locked: true });
            // Auto-recalculate all handicaps from updated scores
            if (recalcHandicaps) recalcHandicaps();
            // If this was the last RR week, auto-populate seeded regular-season weeks
            // from current standings so the schedule is ready for seeded play. Also auto-seeds
            // the next playoff round if dependencies are met.
            let autoSeedResult = { seeded: 0, playoff: 0 };
            if (autoSeedIfReady) {
              const r = await autoSeedIfReady(week);
              if (r && typeof r === "object") autoSeedResult = r;
            }
            setShowCtpPopup(false);
            // Build a summary of what got auto-seeded so the commish sees explicit feedback.
            const parts = [];
            if (autoSeedResult.seeded > 0) {
              parts.push(`${autoSeedResult.seeded} seeded week${autoSeedResult.seeded === 1 ? "" : "s"}`);
            }
            if (autoSeedResult.playoff > 0) {
              parts.push(`${autoSeedResult.playoff} playoff round${autoSeedResult.playoff === 1 ? "" : "s"}`);
            }
            setToast(parts.length
              ? `Week ${week} finalized — ${parts.join(" + ")} populated`
              : `Week ${week} finalized`);
            setTimeout(() => {
              setToast(null);
              setShowAllMatches(false);
              setActiveMatch(null);
              setExpandedMatch(null);
            }, 2500);
          };

          return (
            <Popup onClose={() => setShowCtpPopup(false)} maxWidth={360} padding={20}>
              <div style={{ fontSize: 11, fontWeight: 700, color: K.act, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>Finalize Week {week}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: K.t1, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Closest to the Pin</div>

              {par3Holes.map(holeNum => {
                const sel = ctpSelections[holeNum] || {};
                return (
                  <div key={holeNum} style={{ marginBottom: 14, background: K.card, border: `1px solid ${K.bdr}`, borderRadius: 10, padding: "12px" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: K.t1, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Hole {holeNum}</div>
                    <select
                      value={sel.playerId || ""}
                      onChange={e => setCtpSelections(prev => ({ ...prev, [holeNum]: { ...prev[holeNum], playerId: e.target.value } }))}
                      style={{ width: "100%", padding: "10px", borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, marginBottom: 6 }}
                    >
                      <option value="">No winner</option>
                      {allPlayersSorted.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {sel.playerId && (
                      <input
                        type="text"
                        placeholder="Distance (e.g. 4'6&quot;)"
                        value={sel.distance || ""}
                        onChange={e => setCtpSelections(prev => ({ ...prev, [holeNum]: { ...prev[holeNum], distance: e.target.value } }))}
                        style={{ width: "100%", padding: "8px 10px", borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13 }}
                      />
                    )}
                  </div>
                );
              })}

              {par3Holes.length === 0 && (
                <div style={{ fontSize: 13, color: K.t3, padding: "8px 0" }}>No par 3 holes this side</div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button onClick={handleFinalize} style={{ flex: 1, padding: 12, borderRadius: 10, background: K.act, border: "none", color: K.bg, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                  Finalize Week
                </button>
                <button onClick={() => setShowCtpPopup(false)} style={{ flex: 1, padding: 12, borderRadius: 10, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </Popup>
          );
        })()}

        {toast && (
          <div style={{ position: "fixed", top: 30, left: "50%", transform: "translateX(-50%)", background: K.act, color: K.bg, padding: "12px 48px", borderRadius: 12, fontSize: 13, fontWeight: 700, zIndex: 1000, whiteSpace: "nowrap", minWidth: 240, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
            {toast}
          </div>
        )}
        {/* Confirm modal (for rain out etc.) */}
        <ConfirmModal modal={confirmModal && {
          ...confirmModal,
          eyebrow: confirmModal.eyebrow || "MnQ Golf League",
          onCancel: confirmModal.onCancel || (() => setConfirmModal(null)),
        }} />
      </div>
    );
  }

  // ── Low Net leaderboard view ──
  // Shows every player in the league this week, ranked by net (best to worst).
  // Players without a complete 9-hole round sit at the bottom with em-dashes.
  // Strokes use the player's stored handicap mapped to the course's stroke-index allocation.
  if (showLowNet && !activeMatch) {
    const parTotal = pars.reduce((a, b) => a + b, 0);

    // Build the set of players actually scheduled this week (across all matches)
    const weekPidsSet = new Set();
    matches.forEach(m => {
      const mt1 = teams.find(t => t.id === m.team1);
      const mt2 = teams.find(t => t.id === m.team2);
      [mt1?.player1, mt1?.player2, mt2?.player1, mt2?.player2].filter(Boolean).forEach(pid => weekPidsSet.add(pid));
    });
    const weekPids = Array.from(weekPidsSet);

    const rows = weekPids.map(pid => {
      const pl = playerMap[pid];
      const hcp = pl ? Math.round(pl.handicapIndex || 0) : 0;
      const strokesByHole = getStrokesMap(hcp);
      const isAbsent = holeScores[`w${week}_p${pid}_habsent`] === 1;

      let gross = 0, net = 0, holesPlayed = 0;
      for (let h = 0; h < 9; h++) {
        const s = holeScores[`w${week}_p${pid}_h${h}`] || 0;
        if (s > 0) {
          gross += s;
          net += s - (strokesByHole[h] || 0);
          holesPlayed++;
        }
      }
      const complete = holesPlayed === 9 && !isAbsent;
      return {
        pid,
        name: pl?.name || "?",
        hcp,
        isAbsent,
        complete,
        gross: complete ? gross : null,
        net: complete ? net : null,
        toPar: complete ? net - parTotal : null,
      };
    });

    // Sort by selected column. Default is ascending (best → worst, lower is better in golf);
    // tapping the same header toggles to descending (worst → best).
    // Incomplete rounds (no 9-hole score yet) always stay at the bottom alphabetically,
    // regardless of direction — they're shown as reference, not ranked.
    const sortKey = lowNetSort; // "net" or "gross"
    const dirMult = lowNetDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (a.complete && !b.complete) return -1;
      if (!a.complete && b.complete) return 1;
      if (a.complete && b.complete) return (a[sortKey] - b[sortKey]) * dirMult;
      return a.name.localeCompare(b.name);
    });

    // Tap handler: switching columns resets to ascending (best first, golf-standard view).
    // Tapping the already-active column flips direction.
    const handleHeaderTap = (col) => {
      if (lowNetSort !== col) {
        setLowNetSort(col);
        setLowNetDir("asc");
      } else {
        setLowNetDir(lowNetDir === "asc" ? "desc" : "asc");
      }
    };

    const fmtToPar = (tp) => {
      if (tp === null) return "—";
      if (tp === 0) return "E";
      return tp > 0 ? `+${tp}` : `${tp}`;
    };

    // Header cell style helper — sortable headers are visually interactive
    const headerCellStyle = (isActive) => ({
      cursor: "pointer",
      fontWeight: isActive ? 900 : 800,
      opacity: isActive ? 1 : 0.8,
      textDecoration: "none",
      borderBottom: isActive ? `2px solid ${K.bg}` : "2px solid transparent",
      paddingBottom: 1,
    });

    // Chevron shown on the active header: ▾ ascending, ▴ descending. Reserved 10px slot
    // keeps header cell width stable regardless of state.
    const activeChevron = lowNetDir === "asc" ? " ▾" : " ▴";

    return (
      <div style={{ maxWidth: 540, margin: "0 auto" }}>
        <ViewToggle />
        {FinalizeBanner}

        {/* Table header — Net and Gross are tappable to sort; tapping the active column flips direction */}
        <div style={{ display: "flex", alignItems: "center", padding: "6px 10px", background: K.acc, borderRadius: "8px 8px 0 0", color: K.bg, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: .5 }}>
          <div style={{ width: 22, flexShrink: 0, textAlign: "center", opacity: .8 }}>#</div>
          <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }}>Player</div>
          <div style={{ width: 36, flexShrink: 0, textAlign: "center", opacity: .8 }}>Hcp</div>
          <div style={{ width: 44, flexShrink: 0, textAlign: "center", opacity: .8 }}>To Par</div>
          <div onClick={() => handleHeaderTap("net")} style={{ width: 48, flexShrink: 0, textAlign: "center", ...headerCellStyle(sortKey === "net") }}>
            Net<span style={{ display: "inline-block", width: 10, textAlign: "left" }}>{sortKey === "net" ? activeChevron : ""}</span>
          </div>
          <div onClick={() => handleHeaderTap("gross")} style={{ width: 56, flexShrink: 0, textAlign: "center", ...headerCellStyle(sortKey === "gross") }}>
            Gross<span style={{ display: "inline-block", width: 10, textAlign: "left" }}>{sortKey === "gross" ? activeChevron : ""}</span>
          </div>
        </div>

        <div style={{ background: K.card, border: `1px solid ${K.bdr}`, borderTop: "none", borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
          {(() => {
            // Traditional golf rank — rank = (count of players with strictly
            // better score) + 1. Tied players share a rank; the next rank
            // skips by the tie group size. e.g. 1, 2, T3, T3, 5 (NOT 1, 2,
            // T3, T4, 5 which is what the old position-based logic produced).
            //
            // Both rank and tie status are properties of the score itself,
            // not the row's position in the displayed list, so the same
            // values hold whether we're sorted ascending (best first) or
            // descending (worst first).
            const completeRows = rows.filter(r => r.complete);
            return rows.map((r, i) => {
              const isMe = r.pid === leagueUser.playerId;
              const isLast = i === rows.length - 1;
              const showRank = r.complete;
              // Golf rank: count rows with strictly better score on the
              // active sort column, then +1. For "asc" (low net is best)
              // and the typical golf scenario, "better" = lower value.
              const rank = showRank
                ? completeRows.filter(other => other[sortKey] < r[sortKey]).length + 1
                : null;
              const isLeader = rank === 1;
              // A row is tied when at least one OTHER complete row has the
              // same score on the active sort column. Shows the "T" prefix
              // on every member of a tied group (rather than just the
              // second occurrence as the old tiedAbove check did).
              const isTied = showRank && completeRows.some(other =>
                other.pid !== r.pid && other[sortKey] === r[sortKey]
              );
              // Green emphasis follows the active sort column
              const netIsActive = sortKey === "net";
              const grossIsActive = sortKey === "gross";
              return (
                <div key={r.pid} style={{
                  display: "flex", alignItems: "center", padding: "9px 10px",
                  borderBottom: isLast ? "none" : `1px solid ${K.bdr}30`,
                  background: isMe ? K.acc + "12" : "transparent",
                }}>
                  <div style={{ width: 22, flexShrink: 0, textAlign: "center", fontSize: 12, fontWeight: 700, color: isLeader ? K.matchGrn : K.t3 }}>
                    {showRank ? (isTied ? "T" : "") + rank : "—"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingLeft: 8, fontSize: 13, fontWeight: isMe ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.name}
                    {r.isAbsent && <span style={{ marginLeft: 6, fontSize: 8, fontWeight: 700, color: K.red, background: K.red + "15", padding: "1px 4px", borderRadius: 3 }}>ABS</span>}
                  </div>
                  <div style={{ width: 36, flexShrink: 0, textAlign: "center", fontSize: 11, fontWeight: 700, color: K.hcpBlue }}>{r.hcp}</div>
                  <div style={{ width: 44, flexShrink: 0, textAlign: "center", fontSize: 13, fontWeight: 800, color: r.toPar === null ? K.t3 + "60" : r.toPar < 0 ? K.red : r.toPar === 0 ? K.t2 : K.t1 }}>
                    {fmtToPar(r.toPar)}
                  </div>
                  <div style={{ width: 48, flexShrink: 0, textAlign: "center", fontSize: netIsActive ? 14 : 13, fontWeight: netIsActive ? 800 : 600, color: r.net === null ? K.t3 + "60" : (netIsActive && isLeader) ? K.matchGrn : netIsActive ? K.t1 : K.t2 }}>
                    {r.net ?? "—"}
                  </div>
                  <div style={{ width: 56, flexShrink: 0, textAlign: "center", fontSize: grossIsActive ? 14 : 12, fontWeight: grossIsActive ? 800 : 600, color: r.gross === null ? K.t3 + "60" : (grossIsActive && isLeader) ? K.matchGrn : grossIsActive ? K.t1 : K.t2 }}>
                    {r.gross ?? "—"}
                  </div>
                </div>
              );
            });
          })()}
        </div>

        {rows.every(r => !r.complete) && (
          <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: K.t3, fontStyle: "italic" }}>
            No complete rounds yet this week
          </div>
        )}
      </div>
    );
  }

  // ── Default: no match found ──
  if (!matchToScore) {
    return (
      <div>
        <EmptyState icon="flag" title="No match found" subtitle="You don't have a match scheduled this week." />
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button onClick={() => setShowAllMatches(true)} style={{ padding: "10px 20px", borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>See All Matches</button>
        </div>
      </div>
    );
  }

  if (!t1 || !t2) return null;

  // Resolves the configured playoff tiebreaker against the in-progress live
  // scoring state. Used by both finalizeMatch() and the Sign Scorecard preview.
  //
  // Prior implementation duplicated ~85 lines of tiebreaker rules from
  // matchCalc.js — the comment was explicit: "If you change the tiebreaker
  // rules, change them in BOTH places." This wrapper instead synthesizes a
  // holeScores snapshot that bakes in the absent-resolved getS() scores, then
  // delegates to the single canonical tiebreaker resolver. There's now exactly
  // one place to change tiebreaker rules.
  const computePlayoffTiebreakerLocal = ({ t1Players: tb1, t2Players: tb2, holeResults: hr, t1Id, t2Id }) => {
    // Build a flat holeScores override that the canonical resolver can read.
    // For absent players, getS() already returns the substituted teammate
    // score (or the imputed both-absent score), so injecting this map under
    // each player's own key yields the same totals as the inline version did.
    const synthScores = {};
    [...tb1, ...tb2].forEach(pid => {
      for (let h = 0; h < 9; h++) {
        synthScores[`w${week}_p${pid}_h${h}`] = getS(pid, h);
      }
    });

    const sumNet = (pids) => pids.reduce((acc, pid) => {
      let s = 0;
      for (let h = 0; h < 9; h++) s += getS(pid, h) - getStrokes(pid, h);
      return acc + s;
    }, 0);
    const sumGross = (pids) => pids.reduce((acc, pid) => {
      let s = 0;
      for (let h = 0; h < 9; h++) s += getS(pid, h);
      return acc + s;
    }, 0);

    return computePlayoffTiebreaker({
      t1Pids: tb1, t2Pids: tb2, t1Id, t2Id,
      hr,
      t1Net: sumNet(tb1), t2Net: sumNet(tb2),
      t1Gross: sumGross(tb1), t2Gross: sumGross(tb2),
      week, holeScores: synthScores,
      pars, hcps, players, leagueConfig, seedMap,
    });
  };

  const finalizeMatch = async () => {
    tapBigAction();
    const isPlayoffWeek = weekSch?.isPlayoff === true;

    // Single source of truth: compute all match-result fields via matchCalc.
    // Replaces ~80 lines of inline calculation that duplicated logic also
    // present in Schedule.jsx's saveEditedScores. See lib/matchCalc.js for
    // the full algorithm.
    const calc = computeMatchResult({
      match: { team1: t1.id, team2: t2.id },
      week,
      isPlayoff: isPlayoffWeek,
      teams,
      players,
      holeScores,
      pars,
      hcps,
      scoringRules,
      leagueConfig,
      seedMap,
    });

    // Workflow metadata — not derivable from scores, so it stays caller-side.
    // autoAttest fires when no other present player can attest (e.g. solo
    // match, or all teammates marked absent). When that happens we ALSO
    // populate attestedBy with all non-signer pids so the UI's two attestation
    // signals (the FINAL label and the per-player attest dots) stay
    // internally consistent. Prior code set attestedBy:[] alongside
    // attested:true, which made the All Matches center strip show "FINAL"
    // while the attest row showed 0/3 — the two states disagreed.
    // (Mirrors handleAttestAllWeek's behavior — same invariant.)
    const presentNonSigners = allP.filter(pid => pid !== leagueUser.playerId && !isPlayerAbsent(pid));
    const autoAttest = presentNonSigners.length === 0;
    const allNonSigners = allP.filter(pid => pid !== leagueUser.playerId);

    await saveMatchResult({
      ...calc,
      id: `${LEAGUE_ID}_w${week}_${t1.id}_${t2.id}`,
      week,
      finalizedByTeamId: myTeam?.id || null,
      signedByPlayerId: leagueUser.playerId || null,
      attestedBy: autoAttest ? allNonSigners : [],
      attested: autoAttest,
    });
  };

  const attestMatch = async () => {
    if (!existingResult) return;
    tapBigAction();
    const newAttestedBy = [...new Set([...attestedBy, leagueUser.playerId])];
    const allDone = nonSignerPids.every(pid => newAttestedBy.includes(pid));
    await saveMatchResult({
      ...existingResult,
      attestedBy: newAttestedBy,
      attested: allDone,
    });
    setShowFinalize(false);
    setShowEditConfirm(false);
    setToast(allDone ? "Scorecard fully attested ✓" : "Attestation recorded ✓");
    setTimeout(() => setToast(null), 2000);
  };

  // ── Build scorecard data (used by finalize popup + inline signed view) ──
  const buildScorecardData = () => {
    const myTeamId = myTeam?.id || t1.id;
    const isMyT1 = t1.id === myTeamId;
    const myPids = isMyT1 ? t1Players : t2Players;
    const oppPids = isMyT1 ? t2Players : t1Players;
    const myTeamObj = isMyT1 ? t1 : t2;
    const oppTeamObj = isMyT1 ? t2 : t1;

    const status = computeMatchStatus(myPids, oppPids, getS, getStrokes, pars);
    const myHW = status.holeResults.filter(r => r === 1).length;
    const oppHW = status.holeResults.filter(r => r === -1).length;
    const finalStatus = status.runningStatus[8];
    let isWin = finalStatus > 0;
    let isLoss = finalStatus < 0;
    let isTie = finalStatus === 0;

    // PLAYOFF TIEBREAKER PREVIEW — if this is a tied playoff match, resolve
    // the winner using the configured tiebreaker and reflect it here so the
    // Sign Scorecard screen shows the correct W/L instead of a misleading
    // "TIED". This now delegates to the canonical resolver in matchCalc.js
    // (the same one finalizeMatch and Schedule's saveEditedScores use), so
    // there's a single source of truth for tiebreaker rules.
    const isPlayoffWeek = weekSch?.isPlayoff === true;
    let tbClinchText = null;
    if (isPlayoffWeek && isTie) {
      const tbResult = computePlayoffTiebreakerLocal({
        t1Players: myPids, t2Players: oppPids,
        holeResults: status.holeResults,
        t1Id: myTeamObj.id, t2Id: oppTeamObj.id,
      });
      if (tbResult.winner === "t1") { isWin = true; isTie = false; }
      else if (tbResult.winner === "t2") { isLoss = true; isTie = false; }
      tbClinchText = `TIE (${tbResult.label})`;
    }

    const matchResult = isWin ? "WIN" : isLoss ? "LOSS" : "TIE";
    const resultColor = isTie ? K.t2 : K.grn;

    const myPidsSorted = [...myPids].sort((a, b) => getHcp(a) - getHcp(b));
    const oppPidsSorted = [...oppPids].sort((a, b) => getHcp(a) - getHcp(b));

    // Override clinchText so the tiebreaker label shows on the preview
    const finalClinchText = tbClinchText || status.clinchText;

    return { myPids, oppPids, myPidsSorted, oppPidsSorted, myTeamObj, oppTeamObj, myHW, oppHW, ...status, clinchText: finalClinchText, matchResult, resultColor, isMyT1 };
  };

  // Shared playoff tiebreaker resolver. Called in two places:
  //   1. finalizeMatch() when saving a tied playoff result
  //   2. buildScorecardData() when rendering the Sign Scorecard preview
  // Both callers pass the two teams' players, the per-hole results (1/-1/0),
  // and the team IDs. Returns { winner: "t1" | "t2", label: string }.
  // ── Shared scorecard builder for both inline and popup views ──
  const buildSC = (team1Pids, team2Pids, hResults, rStatus, cHole, cText, variant, showTotals) => {
    return SharedScorecard({
      pars, side, hcps, team1Pids, team2Pids,
      getScore: getS, getStrokes, getHcp: getNineHcp,
      getInitials, isAbsent: isPlayerAbsent,
      holeResults: hResults, runningStatus: rStatus,
      clinchHole: cHole, clinchText: cText,
      variant, showTotals, matchGrn,
    });
  };

  return (
    <div style={{ maxWidth: 420, margin: "0 auto" }}>
      {activeMatch && (
        <div style={{ marginBottom: 8 }}>
          {/* Explicit destination label (1.1H). The shared BackBtn just
              says "Back" — in this context "Back to All Matches" tells
              the user exactly where they're going, which matters
              especially for a commish drilling into someone else's
              match by mistake. */}
          <button
            onClick={() => { setActiveMatch(null); }}
            style={{
              background: K.inp, border: `1px solid ${K.bdr}`,
              borderRadius: 6, color: K.t2,
              fontSize: 13, padding: "7px 14px",
              cursor: "pointer", fontWeight: 500,
              display: "flex", alignItems: "center", gap: 6,
              letterSpacing: .8,
            }}
          >
            {I.arrowLeft(13, K.t2)} Back to All Matches
          </button>
        </div>
      )}
      {!activeMatch && <ViewToggle />}
      {!activeMatch && FinalizeBanner}
      {/* Status banners */}
      {isWeekLocked && (
        <div style={{ background: K.warn + "18", border: `1px solid ${K.warn}40`, borderRadius: 8, padding: "6px 10px", marginBottom: 4, fontSize: 13, color: K.warn, fontWeight: 700, textAlign: "center" }}>
          Week {week} is locked — scores are read-only
        </div>
      )}
      {!isAlreadyFinalized && (
      <div style={{ display: "flex", gap: 4, marginBottom: 2 }}>
        {Array.from({ length: 9 }, (_, i) => {
          const cur = i === curHole; const done = allP.every(pid => getS(pid, i) > 0);
          // Height bumped 32 → 40 (1.1E) so each cell hits the iOS HIG
          // 44pt minimum within reach (with vertical padding around
          // the row, the effective hit-target is larger than the
          // visible height). gap 3→4 gives a hair more visual
          // breathing room on iPhone SE where 9 cells across 320px is
          // tight. Current-hole cell gets a small scale bump so the
          // "you are scoring this hole" cue is unmistakable.
          return <button key={i} onClick={() => { tapNudge(); setCurHole(i); setEditing(i < currentHoleIdx); }} style={{ flex: 1, height: 40, borderRadius: done || cur ? 8 : 6, border: done && !cur ? `1.5px solid ${K.acc}50` : "none", background: cur ? K.acc : done ? K.acc + "15" : K.card, color: cur ? K.bg : done ? K.acc : K.t3, fontSize: 16, fontWeight: 800, cursor: "pointer", outline: cur ? `2px solid ${K.acc}` : "none", outlineOffset: 1, transform: cur ? "scale(1.06)" : "none", transition: "transform .15s, background .15s" }}>{side === 'front' ? i + 1 : i + 10}</button>;
        })}
      </div>
      )}
      {/* Match status — tappable to expand scorecard */}
      {(() => {
        const myTeamId = myTeam?.id || t1.id;
        const isMyT1 = t1.id === myTeamId;
        const holeStatuses = Array.from({ length: 9 }, (_, i) => {
          let holesUp = 0, hasData = false;
          for (let h = 0; h <= i; h++) {
            let t1HN = 0, t2HN = 0, t1OK = true, t2OK = true;
            t1Players.forEach(pid => { const s = getS(pid, h); if (s <= 0) t1OK = false; else t1HN += s - getStrokes(pid, h); });
            t2Players.forEach(pid => { const s = getS(pid, h); if (s <= 0) t2OK = false; else t2HN += s - getStrokes(pid, h); });
            if (t1OK && t2OK) {
              if (t1HN < t2HN) holesUp += isMyT1 ? 1 : -1;
              else if (t1HN > t2HN) holesUp += isMyT1 ? -1 : 1;
              hasData = true;
            } else { hasData = false; break; }
          }
          return hasData ? holesUp : null;
        });

        let matchClinchHole = null;
        let clinchScoreText = null;
        for (let h = 0; h < 9; h++) {
          if (holeStatuses[h] === null) break;
          const lead = Math.abs(holeStatuses[h]);
          const remaining = 8 - h;
          if (lead > remaining) {
            matchClinchHole = h;
            clinchScoreText = remaining > 0 ? `${lead}&${remaining}` : `${lead}UP`;
            break;
          }
        }

        const hasAnyStatus = holeStatuses.some(s => s !== null);

        return (<>
          <div style={{ display: isAlreadyFinalized ? "none" : "flex", marginTop: 2, marginBottom: 4, width: "100%", background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 8, padding: "4px 0", alignItems: "center" }}>
            {holeStatuses.map((st, i) => {
              const colBorderR = i < 8 ? { borderRight: `1px solid ${K.bdr}30` } : {};
              if (matchClinchHole !== null && i === matchClinchHole) {
                const color = st > 0 ? matchGrn : st < 0 ? K.red : K.t3;
                return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 14, color, fontWeight: 800, lineHeight: "24px", ...colBorderR }}>{clinchScoreText}</div>;
              }
              if (matchClinchHole !== null && i > matchClinchHole) return <div key={i} style={{ flex: 1, height: 24, ...colBorderR }} />;
              // null status: distinguish "untouched future hole" from "this hole
              // has data but cumulative status is unresolvable due to a missing
              // earlier-hole score." The `holeStatuses` builder above breaks the
              // cumulative loop on the first incomplete hole, so once any hole
              // has a gap, every subsequent cell here is null even if those holes
              // have full data themselves. We surface ⚠️ on:
              //   - The hole(s) that triggered the gap (incomplete entries —
              //     scorer forgot, or make-up player not yet scored)
              //   - Any later hole that has data but can't accumulate due to the
              //     gap (signals "fix the earlier hole, this one's waiting")
              // Both cases share the same user remediation: enter the missing
              // score, and the strip immediately fills in.
              if (st === null) {
                const checkPids = [...t1Players, ...t2Players].filter(Boolean);
                // Use getS (absent-aware) so an absent player whose teammate
                // has a score doesn't trip the activity check unnecessarily.
                // The null running-status entry already tells us the hole is
                // unresolvable; the activity check distinguishes "pending data"
                // from "untouched future hole."
                const holeHasActivity = checkPids.some(pid => getS(pid, i) > 0);
                if (holeHasActivity) {
                  return <div key={i}
                    title="Match status pending — scores incomplete on this hole"
                    style={{ flex: 1, height: 24, textAlign: "center", lineHeight: "24px", fontSize: 12, opacity: 0.55, ...colBorderR }}>⚠️</div>;
                }
                return <div key={i} style={{ flex: 1, height: 24, ...colBorderR }} />;
              }
              const color = st > 0 ? matchGrn : st < 0 ? K.red : K.t3;
              return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 800, color, lineHeight: "24px", ...colBorderR }}>{st > 0 ? <><span style={{ fontSize: 14 }}>▲</span>{st}</> : st < 0 ? <><span style={{ fontSize: 14 }}>▼</span>{Math.abs(st)}</> : <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: .5 }}>TIED</span>}</div>;
            })}
          </div>
        </>);
      })()}
      {/* After signed: show inline scorecard. Before signed: show hole card + scoring UI */}
      {isAlreadyFinalized ? (() => {
        const sc = buildScorecardData();
        const scComp = buildSC(sc.myPids, sc.oppPids, sc.holeResults, sc.runningStatus, sc.clinchHole, sc.clinchText, "full", true);

        return (
          <div style={{ marginBottom: 6, position: "relative" }}>
            {isFullyAttested && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 2, overflow: "hidden" }}>
                <div style={{ fontSize: "clamp(70px, 22vw, 120px)", fontWeight: 900, color: K.t3 + "20", letterSpacing: "clamp(12px, 4vw, 24px)", textTransform: "uppercase", userSelect: "none", whiteSpace: "nowrap", transform: "rotate(-18deg)" }}>FINAL</div>
              </div>
            )}

            <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden", marginBottom: 4 }}>
              <scComp.HoleRow />
              <scComp.ParRow />
              {weekSch?.isPlayoff && <scComp.HcpRow />}
              <scComp.TeamLabelRow name={sc.myTeamObj?.name} seed={showSeeds ? (seedMap[sc.myTeamObj?.id] || null) : null} />
              {sc.myPids.map(pid => <scComp.PlayerRow key={pid} pid={pid} />)}
              <scComp.TeamNetRow pids={sc.myPids} isTeam1Side={true} />
            </div>
            <scComp.MatchRow />
            <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden" }}>
              <scComp.HoleRow />
              <scComp.ParRow />
              {weekSch?.isPlayoff && <scComp.HcpRow />}
              <scComp.TeamLabelRow name={sc.oppTeamObj?.name} seed={showSeeds ? (seedMap[sc.oppTeamObj?.id] || null) : null} />
              {sc.oppPids.map(pid => <scComp.PlayerRow key={pid} pid={pid} />)}
              <scComp.TeamNetRow pids={sc.oppPids} isTeam1Side={false} />
            </div>

            {/* Attestation status + actions */}
            {isAlreadyFinalized && !isFullyAttested && !isWeekLocked && (() => {
              const attestCount = attestedBy.length;
              const needed = nonSignerPids.length;
              const statusText = `${attestCount} of ${needed} attested`;
              return (
                <div style={{ marginTop: 8 }}>
                  {/* Attestation progress */}
                  <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap", justifyContent: "center" }}>
                    {nonSignerPids.map(pid => {
                      const pl = playerMap[pid];
                      const done = attestedBy.includes(pid);
                      const lastName = pl ? pl.name.split(' ').pop() : "?";
                      return (
                        <div key={pid} style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 4, background: done ? K.grn + "18" : K.inp, border: `1px solid ${done ? K.grn + "40" : K.bdr}`, color: done ? K.grn : K.t3 }}>
                          {done ? "✓ " : ""}{lastName}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ textAlign: "center", fontSize: 11, color: K.warn, fontWeight: 600, marginBottom: 6 }}>
                    {statusText}
                  </div>

                  {/* Attest button — for non-signers who haven't attested yet */}
                  {needsAttestation && (
                    <>
                      <button onClick={attestMatch} style={{ width: "100%", padding: "12px", borderRadius: 10, background: K.hcpBlue, border: "none", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                        Attest Scorecard
                      </button>
                      {signedByPlayerId && playerMap[signedByPlayerId] && (
                        <div style={{ textAlign: "center", marginTop: 5, fontSize: 11, color: K.t3, fontWeight: 600 }}>
                          Signed by {playerMap[signedByPlayerId].name}
                        </div>
                      )}
                    </>
                  )}

                  {/* Already attested but waiting for others */}
                  {iHaveAttested && !isFullyAttested && (
                    <div style={{ textAlign: "center", fontSize: 12, color: K.t3, fontWeight: 600, padding: "6px 0" }}>
                      You attested — waiting for others
                    </div>
                  )}

                  {/* Unsign button — any of the 4 players can unsign before fully attested */}
                  {isInThisMatch && existingResult?.id && (
                    <button onClick={() => {
                      setConfirmModal({
                        title: "Unsign scorecard?",
                        message: "All attestations will be reset and scores can be edited again.",
                        onConfirm: () => {
                          deleteMatchResult(existingResult.id);
                          setConfirmModal(null);
                        },
                      });
                    }} style={{ width: "100%", padding: "7px 0", borderRadius: 8, marginTop: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      Unsign & Edit
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })() : (<>
      {/* Full Scorecard button — sits above the current-hole banner so
          it's visible without scrolling past the player cards. Slim
          padding to keep vertical footprint minimal. */}
      <button onClick={() => setShowScorecard(true)} style={{ width: "100%", padding: "5px 0", borderRadius: 8, marginBottom: 4, cursor: "pointer", background: K.card, border: `1px solid ${K.bdr}60`, color: K.t2, fontSize: 11, fontWeight: 700, letterSpacing: .5 }}>
        Full Scorecard
      </button>
      <div style={{ background: K.acc, borderRadius: 10, padding: "4px 8px", marginBottom: 4, display: "flex", alignItems: "center" }}>
        <button onClick={() => { const prev = Math.max(0, curHole - 1); setCurHole(prev); setEditing(prev < currentHoleIdx); }} disabled={curHole === 0} style={{ width: 28, height: 36, borderRadius: 8, background: "none", border: "none", cursor: curHole === 0 ? "default" : "pointer", color: curHole === 0 ? K.bg + "40" : K.bg, fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px" }}>
          <div style={{ textAlign: "center", minWidth: 32 }}><div style={{ fontSize: 8, color: K.bg, fontWeight: 600, opacity: 0.7 }}>Par</div><div style={{ fontSize: 15, fontWeight: 800, color: K.bg }}>{par}</div></div>
          <div style={{ textAlign: "center" }}><div style={{ fontSize: 8, color: K.bg, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, opacity: 0.7 }}>Hole</div><div style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 26, fontWeight: 700, color: K.bg, lineHeight: 1 }}>{side === 'front' ? curHole + 1 : curHole + 10}</div></div>
          <div style={{ textAlign: "center", minWidth: 32 }}><div style={{ fontSize: 8, color: K.bg, fontWeight: 600, opacity: 0.7 }}>HCP</div><div style={{ fontSize: 15, fontWeight: 800, color: K.bg }}>{hcp}</div></div>
        </div>
        <button onClick={() => { const next = Math.min(8, curHole + 1); setCurHole(next); setEditing(next < currentHoleIdx); }} disabled={curHole === 8} style={{ width: 28, height: 36, borderRadius: 8, background: "none", border: "none", cursor: curHole === 8 ? "default" : "pointer", color: curHole === 8 ? K.bg + "40" : K.bg, fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
      </div>
      </>)}
      {!isAlreadyFinalized && (<>

      {/* Missing-scores alert — moved here (1.1D) above the player
          cards so the actionable list of who's missing what is visible
          without scrolling past the entire match. Original placement
          was below the cards which hid it on iPhone SE while scoring
          the lower players. Only fires for started-but-incomplete
          players; players who haven't started (making up / not teed
          off) are an expected state, not an error. */}
      {!allComplete && missingScores.length > 0 && !showFinalize && (
        <div style={{ width: "100%", padding: "8px 10px", borderRadius: 10, marginBottom: 6, background: K.warn + "15", border: `1.5px solid ${K.warn}50`, color: K.warn, fontSize: 12, fontWeight: 700, boxSizing: "border-box" }}>
          <div style={{ marginBottom: missingScores.length ? 3 : 0 }}>⚠️ Missing scores — can't sign yet</div>
          {missingScores.map(m => (
            <div key={m.pid} style={{ fontSize: 11, fontWeight: 600, opacity: .9 }}>
              {m.initials}: hole{m.holes.length > 1 ? "s" : ""} {m.holes.join(", ")}
            </div>
          ))}
        </div>
      )}

      {allP.map(pid => {
        const pl = playerMap[pid]; if (!pl) return null;
        const absent = isPlayerAbsent(pid);
        const score = getS(pid, curHole); const strokes = getStrokes(pid, curHole); const nh = getNineHcp(pid); const run = getRunning(pid);
        // Par-relative button window: birdie / par / bogey / double / triple.
        // PlayerScoreCard's recenter logic shifts the window when the player's
        // score lands outside [par-1, par+3] — e.g. an ace on a par 3 (1) or a
        // 9 on a par 4. The recentered case hides the par-relative labels in
        // PlayerScoreCard since "Birdie/Par/Bogey/..." no longer line up with
        // the shifted numbers.
        const btns = [par - 1, par, par + 1, par + 2, par + 3];
        const hole1Done = allP.filter(p => !isPlayerAbsent(p)).every(p => getRawScore(p, 0) > 0);
        const absentLocked = hole1Done && !absent;
        const absentBtn = !isAlreadyFinalized ? (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            {/* Makeup button — amber pill, no absentLocked gate since
                makeup is an explicit "this person plays later" decision
                valid at any time. Writes attendance status="makeup" via
                markMakeup, which clears any prior _habsent flag too. */}
            <button
              onClick={() => {
                setConfirmModal({
                  title: `Mark ${pl.name} as making up?`,
                  onConfirm: () => { markMakeup(pid); setConfirmModal(null); },
                });
              }}
              style={{
                fontSize: 11, fontWeight: 600, color: K.t3, background: "none",
                border: `1px solid ${K.bdr}`, borderRadius: 6,
                padding: "3px 8px", cursor: "pointer", flexShrink: 0,
              }}
            >
              Makeup
            </button>
            <button
              onClick={() => {
                if (absentLocked) return;
                const tm = getTeammate(pid);
                const tmPlayer = tm ? playerMap[tm] : null;
                const tmAbsent = tm && isPlayerAbsent(tm);
                const tmName = tmPlayer?.name || "teammate";
                const message = tmAbsent
                  ? `Both teammates will be absent — net bogey scores will be used for ${pl.name} and ${tmName}.`
                  : `${tmName}'s scores will count double for match calculations.`;
                setConfirmModal({
                  title: `Mark ${pl.name} as absent?`,
                  message,
                  onConfirm: () => { toggleAbsent(pid); setConfirmModal(null); },
                });
              }}
              style={{
                fontSize: 11, fontWeight: 600, color: absentLocked ? K.t3 + "50" : K.t3, background: "none",
                border: `1px solid ${absentLocked ? K.bdr + "30" : K.bdr}`, borderRadius: 6,
                padding: "3px 8px", cursor: absentLocked ? "default" : "pointer",
                opacity: absentLocked ? 0.4 : 1, flexShrink: 0,
              }}
            >
              Absent
            </button>
          </div>
        ) : null;
        const makingUp = isPlayerMakingUp(pid);
        return <div key={pid}>
          {absent ? (
            <div style={{ background: K.card, borderRadius: 10, border: `1px solid ${K.red}40`, borderLeft: `4px solid ${K.red}`, padding: "12px 14px", marginBottom: 6, opacity: 0.6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: K.t1 }}>{pl.name}</div>
                  <span style={{ fontSize: 10, color: K.red, fontWeight: 700, background: K.red + "15", padding: "2px 6px", borderRadius: 4 }}>ABSENT</span>
                </div>
                {!isAlreadyFinalized && (
                  <button onClick={() => { setConfirmModal({ title: `Mark ${pl.name} as present?`, message: `${pl.name} will play their own scores.`, onConfirm: () => { toggleAbsent(pid); setConfirmModal(null); } }); }} style={{ fontSize: 11, fontWeight: 700, color: K.hcpBlue, background: "none", border: `1px solid ${K.hcpBlue}40`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                    Undo
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: K.t3, marginTop: 4 }}>
                {isBothAbsent(pid)
                  ? "Net bogey on each hole (does not count for handicap/stats)"
                  : "Teammate's scores used for match calculations"}
              </div>
            </div>
          ) : makingUp ? (
            /* MAKING UP — visually distinct from Absent. Same dimmed-card
               structure for consistency, but gold accents (K.act, maize)
               so the player reads as "makeup-flagged" at a glance. Two
               action buttons: Undo (revert to no flag, confirmed) and
               Play (affirmative "I'm here, let's score now", one-tap).
               Functionally both clear the attendance flag; the UX framing
               is what differs.
               Color-token gotcha: K.act is the maize brand gold (#deab12),
               K.acc is a light gray. Easy to confuse — makeup should be
               K.act everywhere it appears. */
            <div style={{ background: K.card, borderRadius: 10, border: `1px solid ${K.act}40`, borderLeft: `4px solid ${K.act}`, padding: "12px 14px", marginBottom: 6, opacity: 0.6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.name}</div>
                  <span style={{ fontSize: 10, color: K.act, fontWeight: 700, background: K.act + "15", padding: "2px 6px", borderRadius: 4, flexShrink: 0 }}>MAKING UP</span>
                </div>
                {!isAlreadyFinalized && saveAttendance && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => {
                        setConfirmModal({
                          title: `Clear ${pl.name}'s makeup flag?`,
                          message: `${pl.name} will be marked present and can be scored normally.`,
                          onConfirm: async () => {
                            await saveAttendance(week, pid, null);
                            setConfirmModal(null);
                          },
                        });
                      }}
                      style={{ fontSize: 11, fontWeight: 700, color: K.hcpBlue, background: "none", border: `1px solid ${K.hcpBlue}40`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
                    >
                      Undo
                    </button>
                    {/* PLAY — affirmative "I'm here, let's score" button.
                        Same downstream action as Undo (clears attendance)
                        but framed as a positive action so it doesn't need
                        a confirm popup. Solid green to read as the primary
                        path when the player has actually shown up. */}
                    <button
                      onClick={async () => {
                        await saveAttendance(week, pid, null);
                      }}
                      style={{ fontSize: 11, fontWeight: 800, color: K.bg, background: K.grn, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", letterSpacing: .5 }}
                    >
                      PLAY
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <PlayerScoreCard pl={pl} score={score} strokes={strokes} nh={nh} run={run} btns={btns} par={par} pid={pid} week={week} curHole={curHole} saveScore={guardedSaveScore} K={K} absentBtn={absentBtn} />
          )}
        </div>;
      })}
      {editing && (
        <button onClick={() => { setCurHole(currentHoleIdx); setEditing(false); }} style={{ width: "100%", padding: 10, borderRadius: 10, marginTop: 8, cursor: "pointer", background: K.warn, border: "none", color: K.bg, fontSize: 13, fontWeight: 800 }}>
          Back to Hole {side === 'front' ? currentHoleIdx + 1 : currentHoleIdx + 10} →
        </button>
      )}
      </>)}
      {showScorecard && !isAlreadyFinalized && (() => {
        const myTeamId = myTeam?.id || t1.id;
        const isMyT1 = t1.id === myTeamId;
        const scMyPids = isMyT1 ? t1Players : t2Players;
        const scOppPids = isMyT1 ? t2Players : t1Players;
        const myTeamObj = isMyT1 ? t1 : t2;
        const oppTeamObj = isMyT1 ? t2 : t1;
        const scStatus = computeMatchStatus(scMyPids, scOppPids, getS, getStrokes, pars);
        // buildSC at "full" variant matches the after-signed inline scorecard
        // (#5) and the Finalize popup (#7) — same call sites that already use
        // split-card frame + canonical MatchRow. The popup is now visually
        // identical to those two surfaces, just wrapped in a modal.
        const sc = buildSC(scMyPids, scOppPids, scStatus.holeResults, scStatus.runningStatus, scStatus.clinchHole, scStatus.clinchText, "full", true);
        return (
          <Popup onClose={() => setShowScorecard(false)} maxWidth={420} padding={10} outerPadding={12}>
            {/* My team card */}
            <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden", marginBottom: 4 }}>
              <sc.HoleRow />
              <sc.ParRow />
              {weekSch?.isPlayoff && <sc.HcpRow />}
              <sc.TeamLabelRow name={myTeamObj?.name} seed={showSeeds ? (seedMap[myTeamObj?.id] || null) : null} />
              {scMyPids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
              <sc.TeamNetRow pids={scMyPids} isTeam1Side={true} />
            </div>

            <sc.MatchRow />

            {/* Opp team card */}
            <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden" }}>
              <sc.HoleRow />
              <sc.ParRow />
              {weekSch?.isPlayoff && <sc.HcpRow />}
              <sc.TeamLabelRow name={oppTeamObj?.name} seed={showSeeds ? (seedMap[oppTeamObj?.id] || null) : null} />
              {scOppPids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
              <sc.TeamNetRow pids={scOppPids} isTeam1Side={false} />
            </div>

            <button onClick={() => setShowScorecard(false)} style={{ display: "block", width: "calc(100% - 20px)", margin: "10px auto 0", padding: "9px", background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 8, color: K.t2, fontSize: 13, fontWeight: 600, cursor: "pointer", letterSpacing: .4 }}>
              Close
            </button>
          </Popup>
        );
      })()}
      {/* Finalize / Show Match Details buttons */}
      {allComplete && !showFinalize && !isAlreadyFinalized && (
        <button onClick={() => { tapBigAction(); setShowFinalize(true); }} style={{ width: "100%", padding: 10, borderRadius: 10, marginTop: 8, cursor: "pointer", background: K.hcpBlue + "15", border: `1.5px solid ${K.hcpBlue}50`, color: K.hcpBlue, fontSize: 15, fontWeight: 700 }}>
          All Holes Complete — Sign Scorecard
        </button>
      )}

      {/* (Missing-scores alert moved above the player cards — 1.1D.) */}

      {/* ═══ Finalize Popup ═══ */}
      {showFinalize && (!isAlreadyFinalized || isComm) && (() => {
        const sc = buildScorecardData();
        const scComp = buildSC(sc.myPids, sc.oppPids, sc.holeResults, sc.runningStatus, sc.clinchHole, sc.clinchText, "compact", true);

        return (<>
          <div onClick={() => { setShowFinalize(false); setShowEditConfirm(false); }} data-popup style={{ position: "fixed", top: -50, left: 0, right: 0, bottom: -50, background: "rgba(0,0,0,.7)", zIndex: 500 }} />
          {/* Confetti — 25 memoized particles (see confettiParticles useMemo).
              Animation stays stable across Firestore re-renders during the celebration. */}
          {sc.matchResult === "WIN" && !isAlreadyFinalized && confettiParticles && (
            <div style={{ position: "fixed", inset: 0, zIndex: 550, pointerEvents: "none", overflow: "hidden" }}>
              {confettiParticles.map(p => (
                <div key={p.key} style={{
                  position: "absolute", top: -20, left: `${p.left}%`,
                  width: p.size, height: p.size * p.heightRatio,
                  background: p.color, borderRadius: p.round ? "50%" : 1,
                  opacity: 0, transform: `rotate(${p.rot}deg)`,
                  animation: `confettiFall ${p.dur}s ${p.delay}s ease-out forwards`,
                }} />
              ))}
              <style>{`
                @keyframes confettiFall {
                  0% { opacity: 1; transform: translateY(0) translateX(0) rotate(0deg); }
                  100% { opacity: 0; transform: translateY(100vh) translateX(40px) rotate(720deg); }
                }
              `}</style>
            </div>
          )}
          <div data-popup style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 16px 16px", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
            <div style={{ background: K.bg, border: `1.5px solid ${sc.resultColor}50`, borderRadius: 16, padding: "16px 12px 20px", width: "100%", maxWidth: 420 }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 14, padding: "0 4px" }}>
                <div style={{ flex: 1, textAlign: "right", minWidth: 0 }}>
                  {sc.myPidsSorted.map(pid => {
                    const effectivePid = isPlayerAbsent(pid) ? (getTeammate(pid) || pid) : pid;
                    const pl = playerMap[effectivePid];
                    const last = pl?.name?.split(' ').slice(1).join(' ') || pl?.name || "?";
                    return <div key={pid} style={{ fontSize: 20, fontWeight: 800, color: sc.matchResult === "WIN" ? K.matchGrn : K.t1, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{last}</div>;
                  })}
                </div>
                {sc.matchResult === "WIN" && <div style={{ color: K.matchGrn, fontSize: 15, fontWeight: 800, flexShrink: 0, lineHeight: 1, transform: "rotate(-90deg)" }}>▲</div>}
                {/* Center result block.
                    For a tiebreaker-resolved match, the clinchText is "TIE (HCP losses)"
                    or similar. We split it: the word "TIE" on top in big type, and the
                    tiebreaker label in small type below. Keeps the header compact and
                    avoids wrapping into the scorecard grid below. */}
                <div style={{ textAlign: "center", flexShrink: 0, width: 80 }}>
                  {(() => {
                    const raw = sc.clinchText || "TIED";
                    const tb = parseTiebreakerResult(raw);
                    if (tb.isTiebreaker) {
                      return (
                        <>
                          <div style={{ fontSize: 24, fontWeight: 800, color: K.matchGrn, lineHeight: 1 }}>TIE</div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: K.t3, letterSpacing: .5, textTransform: "uppercase", marginTop: 3, lineHeight: 1.15, whiteSpace: "normal", wordBreak: "break-word" }}>{tb.label}</div>
                        </>
                      );
                    }
                    // Regular result (e.g. "3&2", "2UP", or plain "TIED" for non-playoff)
                    return (
                      <div style={{ fontSize: 26, fontWeight: 800, color: sc.matchResult === "TIE" ? K.t2 : K.matchGrn, lineHeight: 1, whiteSpace: "nowrap" }}>{raw}</div>
                    );
                  })()}
                </div>
                {sc.matchResult === "LOSS" && <div style={{ color: K.matchGrn, fontSize: 15, fontWeight: 800, flexShrink: 0, lineHeight: 1, transform: "rotate(90deg)" }}>▲</div>}
                <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                  {sc.oppPidsSorted.map(pid => {
                    const effectivePid = isPlayerAbsent(pid) ? (getTeammate(pid) || pid) : pid;
                    const pl = playerMap[effectivePid];
                    const last = pl?.name?.split(' ').slice(1).join(' ') || pl?.name || "?";
                    return <div key={pid} style={{ fontSize: 20, fontWeight: 800, color: sc.matchResult === "LOSS" ? K.matchGrn : K.t1, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{last}</div>;
                  })}
                </div>
              </div>

              {/* My team card */}
              <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden", marginBottom: 4 }}>
                <scComp.HoleRow />
                <scComp.ParRow />
                {weekSch?.isPlayoff && <scComp.HcpRow />}
                <scComp.TeamLabelRow name={sc.myTeamObj?.name} seed={showSeeds ? (seedMap[sc.myTeamObj?.id] || null) : null} />
                {sc.myPids.map(pid => <scComp.PlayerRow key={pid} pid={pid} />)}
                <scComp.TeamNetRow pids={sc.myPids} isTeam1Side={true} />
              </div>

              <scComp.MatchRow />

              {/* Opp team card */}
              <div style={{ background: K.card, border: `1px solid ${K.bdr}60`, borderRadius: 10, overflow: "hidden" }}>
                <scComp.HoleRow />
                <scComp.ParRow />
                {weekSch?.isPlayoff && <scComp.HcpRow />}
                <scComp.TeamLabelRow name={sc.oppTeamObj?.name} seed={showSeeds ? (seedMap[sc.oppTeamObj?.id] || null) : null} />
                {sc.oppPids.map(pid => <scComp.PlayerRow key={pid} pid={pid} />)}
                <scComp.TeamNetRow pids={sc.oppPids} isTeam1Side={false} />
              </div>

              <div style={{ marginTop: 16 }}>
                {!isAlreadyFinalized && (
                  <>
                    <button disabled={justSigned} onClick={async () => { setJustSigned(true); await finalizeMatch(); }} style={{ width: "100%", padding: "14px", borderRadius: 12, background: justSigned ? K.t3 : K.hcpBlue, border: "none", color: "#fff", fontSize: 15, fontWeight: 800, cursor: justSigned ? "default" : "pointer", opacity: justSigned ? 0.7 : 1 }}>
                      {justSigned ? "Signing..." : "Sign Scorecard"}
                    </button>
                    {!justSigned && (
                    <button onClick={() => setShowFinalize(false)} style={{ width: "100%", padding: 10, background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer", marginTop: 4 }}>
                      Go Back & Edit
                    </button>
                    )}
                  </>
                )}
                {isAlreadyFinalized && (
                  <>
                    {isComm && !showEditConfirm && (
                      <button onClick={() => setShowEditConfirm(true)} style={{ width: "100%", padding: "12px", borderRadius: 12, background: K.warn, border: "none", color: K.bg, fontSize: 14, fontWeight: 800, cursor: "pointer", marginBottom: 6 }}>
                        Edit Scores
                      </button>
                    )}
                    {isComm && showEditConfirm && (
                      <div style={{ background: K.warn + "15", border: `1px solid ${K.warn}40`, borderRadius: 10, padding: 12, marginBottom: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: K.t1, marginBottom: 10 }}>This will allow score edits. Continue?</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => { setShowEditConfirm(false); setShowFinalize(false); }} style={{ flex: 1, padding: 10, borderRadius: 8, background: K.warn, border: "none", color: K.bg, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                            Yes
                          </button>
                          <button onClick={() => setShowEditConfirm(false)} style={{ flex: 1, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                            No
                          </button>
                        </div>
                      </div>
                    )}
                    <button onClick={() => { setShowFinalize(false); setShowEditConfirm(false); }} style={{ width: "100%", padding: 10, background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer", marginTop: 4 }}>
                      Close
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </>);
      })()}
      {/* Custom confirm modal */}
      <ConfirmModal modal={confirmModal && {
        ...confirmModal,
        eyebrow: confirmModal.eyebrow || "MnQ Golf League",
        onCancel: confirmModal.onCancel || (() => setConfirmModal(null)),
      }} />
      {/* Toast */}
      {toast && (<>
        <style>{`@keyframes toastDown { 0% { transform: translateX(-50%) translateY(-20px); opacity: 0; } 100% { transform: translateX(-50%) translateY(0); opacity: 1; } }`}</style>
        <div style={{ position: "fixed", top: 30, left: "50%", transform: "translateX(-50%)", background: K.act, color: K.bg, padding: "12px 48px", borderRadius: 12, fontSize: 13, fontWeight: 700, zIndex: 1000, whiteSpace: "nowrap", minWidth: 240, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", animation: "toastDown 0.3s ease" }}>
          {toast}
        </div>
      </>)}
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────────────
//  Score-button labels — index-aligned with the par-relative button window
// ──────────────────────────────────────────────────────────────────────────
// The parent passes a 5-element btns array of [par-1, par, par+1, par+2, par+3].
// These labels sit directly beneath each button so the row is self-documenting.
// They're hidden when the recenter logic shifts the window outside the default
// (e.g. an ace on a par 3, or a 9 on a par 4) since "Birdie/Par/Bogey/..." no
// longer line up with the shifted numbers — see `showLabels` below.
const SCORE_LABELS = ["Birdie", "Par", "Bogey", "Double", "Triple"];

const PlayerScoreCard = memo(function PlayerScoreCard({ pl, score, strokes, nh, run, btns: defaultBtns, par, pid, week, curHole, saveScore, K, absentBtn }) {
  const handleScore = (val) => {
    tapScore();
    saveScore(week, pid, curHole, val);
  };
  const handleNudge = (val) => {
    tapNudge();
    saveScore(week, pid, curHole, val);
  };
  const maxBtn = defaultBtns[defaultBtns.length - 1];
  const minBtn = defaultBtns[0];
  let btns = defaultBtns;
  if (score > maxBtn) {
    const shift = score - maxBtn;
    btns = defaultBtns.map(b => b + shift);
  } else if (score > 0 && score < minBtn) {
    const shift = minBtn - score;
    btns = defaultBtns.map(b => b - shift);
  }
  // Reference equality is intentional: btns === defaultBtns is true ONLY when
  // recenter didn't fire (we'd have re-assigned btns to a freshly-mapped array).
  // When labels would mislabel a shifted number (e.g. "Birdie" sitting under a
  // 5 on a par 4 because we shifted to [5,6,7,8,9] for a triple-bogey-or-worse
  // entry) we just hide them. Empty-string label slot still reserves vertical
  // space so the row height doesn't shift between default and recentered.
  const showLabels = btns === defaultBtns;
  // Last name + first initial — matches the rest of the app's last-name
  // display convention but adds a tiny initial in front so teammates with
  // the same last name (or simply different players with similar names)
  // stay disambiguated at a glance. Single-name players (rare but possible
  // in a recreational league with a nickname-only entry) skip the initial.
  const nameParts = pl.name.split(' ').filter(Boolean);
  const lastName = nameParts[nameParts.length - 1] || pl.name;
  const firstInitial = nameParts.length > 1 ? nameParts[0][0] : null;
  const displayName = firstInitial ? `${firstInitial}. ${lastName}` : lastName;

  return (
    <Card style={{ marginBottom: 3, padding: "6px 10px" }}>
      {/* Top row — initial + last name + handicap pill + stroke dots
          clustered tight on the LEFT, with a flex spacer pushing the
          Absent button to the right edge. The name can shrink/truncate
          (minWidth: 0 + ellipsis) on very narrow screens but normally
          takes its natural width so handicap and stroke dots sit
          visually attached to the player it's describing. Handicap
          color matches stroke dots (K.hcpBlue) so the whole stroke-
          allocation context reads as a single unit. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{displayName}</span>
        <span style={{ fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
          (<span style={{ color: K.hcpBlue }}>{nh}</span>)
        </span>
        {strokes > 0 && <span style={{ color: K.hcpBlue, fontSize: 12, letterSpacing: 1, flexShrink: 0, lineHeight: 1 }}>{"●".repeat(strokes)}</span>}
        <div style={{ flex: 1 }} />
        {absentBtn}
      </div>
      {/* Net / thru sub-line — tightened to recover vertical space for
          the top-positioned Full Scorecard button. minHeight still
          reserves the slot before scoring starts so the layout doesn't
          jump on first score entry. */}
      <div style={{ fontSize: 10, color: K.t3, marginBottom: 3, lineHeight: 1.1, minHeight: 10 }}>
        {run.thru > 0 && (
          <>Net <strong style={{ color: run.netVsPar < 0 ? K.red : run.netVsPar === 0 ? K.t3 : K.t1, fontWeight: 700 }}>{run.netVsPar > 0 ? "+" + run.netVsPar : run.netVsPar === 0 ? "E" : run.netVsPar}</strong> thru {run.thru}</>
        )}
      </div>
      {/* Score-button row — 5 par-relative buttons at 44px tall (Apple HIG
          minimum touch target) plus −/+ nudge buttons. Each score button
          stacks a label beneath it (Birdie / Par / Bogey / Double / Triple);
          labels render empty in the recenter case (see showLabels). The −/+
          buttons intentionally have no labels — they're nudge controls, not
          scores. The 12px reserved label slot keeps the row height stable
          regardless of recenter state. */}
      <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
        {/* − nudge button moved to the FAR LEFT so the par button sits
            dead center of the 7-button row. Symmetric with the + on the
            far right. Width bumped 30→36 (1.1B) to land closer to the
            HIG 44pt minimum — with gloves on a bumpy cart the previous
            30px coin-flip target was too small. */}
        <button onClick={() => handleNudge(Math.max(1, (score || par) - 1))} style={{ width: 36, height: 44, borderRadius: 8, background: K.inp, border: "none", color: K.t3, fontSize: 14, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>−</button>
        {btns.map((btn, idx) => {
          const isCur = btn === score; const sd = btn - par;
          const boxSize = 32;
          // Par anchor — the button matching par gets a subtle label
          // emphasis (brighter color + bolder weight) so the golfer's
          // eye finds par as the visual reference. Suppressed when par
          // is the selected score, since the gold active background
          // already serves as the focal point. In the recenter case
          // (e.g. a 9 on par 4 → btns become [5,6,7,8,9]), par isn't
          // in the array so isPar is false everywhere and no emphasis
          // shows — the unlabeled state already signals "abnormal."
          const isPar = btn === par;
          const showParAnchor = isPar && !isCur;
          return (
            <div key={btn} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
              <button onClick={() => handleScore(isCur ? 0 : btn)} style={{ width: "100%", height: 44, borderRadius: 8, cursor: "pointer", fontSize: 15, fontWeight: 800, border: "none", background: isCur ? K.acc : K.inp, color: isCur ? K.bg : K.t2, position: "relative", transition: "all .15s", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {/* SELECTED-STATE rings: solid red circles for under-par
                    (single for birdie, double for eagle), solid bg-color
                    squares for over-par (single for bogey, double for
                    double-bogey-or-worse). Renders on top of the gold
                    selected background so the rings contrast cleanly. */}
                {isCur && sd !== 0 && <div style={{ position: "absolute", width: boxSize, height: boxSize, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}><div style={{ position: "absolute", inset: 0, borderRadius: sd < 0 ? "50%" : 3, border: `1.5px solid ${sd < 0 ? K.red : K.bg}` }} />{Math.abs(sd) >= 2 && <div style={{ position: "absolute", inset: 3, borderRadius: sd < 0 ? "50%" : 2, border: `1px solid ${sd < 0 ? K.red : K.bg}` }} />}</div>}
                {/* RESTING-STATE faint outlines on non-par buttons. Same
                    geometry as the selected state but at 0.15 opacity, and
                    in resting-button colors (K.red for under-par circles,
                    K.t2 for over-par squares). Double squares appear for
                    sd >= 2 (double-bogey and worse) mirroring the
                    selected-state convention. Suppressed when the button
                    is selected — the solid ring above takes over. Also
                    suppressed for par buttons (sd === 0) — par is its
                    own anchor via the label emphasis. */}
                {!isCur && sd !== 0 && <div style={{ position: "absolute", width: boxSize, height: boxSize, left: "50%", top: "50%", transform: "translate(-50%, -50%)", opacity: 0.15 }}><div style={{ position: "absolute", inset: 0, borderRadius: sd < 0 ? "50%" : 3, border: `1.25px solid ${sd < 0 ? K.red : K.t2}` }} />{Math.abs(sd) >= 2 && <div style={{ position: "absolute", inset: 3, borderRadius: sd < 0 ? "50%" : 2, border: `1px solid ${sd < 0 ? K.red : K.t2}` }} />}</div>}
                <span style={{ position: "relative", zIndex: 1 }}>{btn}</span>
              </button>
              {/* Par's label gets a brighter color + bolder weight so the
                  "Par" word also reads as the visual anchor below the
                  button. Both cues fire from the same `showParAnchor`
                  flag so the anchor disappears together when par is
                  selected. */}
              <div style={{ fontSize: 9, color: showParAnchor ? K.t2 : K.t3, fontWeight: showParAnchor ? 700 : 600, letterSpacing: 0.4, lineHeight: 1, height: 12 }}>
                {showLabels ? SCORE_LABELS[idx] : ""}
              </div>
            </div>
          );
        })}
        <button onClick={() => handleNudge((score || par) + 1)} style={{ width: 36, height: 44, borderRadius: 8, background: K.inp, border: "none", color: K.t3, fontSize: 14, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>+</button>
      </div>
    </Card>
  );
});