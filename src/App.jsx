import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { db, LF, LEAGUE_ID, _auth, _googleProvider, onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile, sendPasswordResetEmail } from "./firebase";
import { K, I, DEFAULT_SCORING, applyTheme, getCSS, calcPlayerHcp, buildStandingsForSeed, pairNonBracketTeams, collectPriorMatchups } from "./theme";
import { parseScheduleDate } from "./lib/scheduleDate";
import { LoadingScreen, AuthScreen, JoinScreen } from "./pages/Auth";
import ErrorBoundary from "./ErrorBoundary";

// Fix #2: Lazy-load page components — Vite will code-split each into its own chunk.
// Only the active tab's code is downloaded and parsed on navigation.
const StandingsView = lazy(() => import("./pages/Standings"));
const LiveScoringView = lazy(() => import("./pages/Scoring"));
const ScheduleView = lazy(() => import("./pages/Schedule"));
const PlayersView = lazy(() => import("./pages/Players"));
const StatsView = lazy(() => import("./pages/Stats"));
const CTPView = lazy(() => import("./pages/CTP"));
const AdminView = lazy(() => import("./pages/Admin"));


export default function GolfLeagueApp() {
  const [authUser, setAuthUser] = useState(undefined);
  const [leagueUser, setLeagueUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [schedule, setSchedule] = useState([]);
  // Ref mirror of schedule — same rationale as matchResultsRef below. Used so auto-seeding
  // can see the just-locked week without waiting for a snapshot + re-render.
  const scheduleRef = useRef([]);
  useEffect(() => { scheduleRef.current = schedule; }, [schedule]);
  const [courseData, setCourseData] = useState(null);
  const [scoringRules, setScoringRules] = useState(DEFAULT_SCORING);
  const [holeScores, setHoleScores] = useState({});
  const [ctpData, setCtpData] = useState([]);
  const [matchResults, setMatchResults] = useState([]);
  // Ref mirror of matchResults — used inside autoSeedIfReady so playoff-round auto-seeding
  // can read the just-saved match result without waiting for a Firestore snapshot + re-render.
  // Without this, Phase 2 (advance to next playoff round) could read stale matchResults and
  // sporadically bail out with "prior round not fully scored" even when it was.
  const matchResultsRef = useRef([]);
  useEffect(() => { matchResultsRef.current = matchResults; }, [matchResults]);
  // Ref mirror of holeScores — used by autoSeedIfReady's stale-bracket guard
  // so we can detect "scores already entered for this week" without a re-render
  // and without making the callback dep on the large holeScores map.
  const holeScoresRef = useRef({});
  useEffect(() => { holeScoresRef.current = holeScores; }, [holeScores]);
  const [leagueConfig, setLeagueConfig] = useState({ name: "Golf League 2026", year: 2026 });
  const [members, setMembers] = useState([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [liveWeek, setLiveWeek] = useState(null);
  const validTabs = ["standings", "scoring", "schedule", "players", "stats", "ctp", "admin"];
  const getTabFromHash = () => {
    const hash = window.location.hash.replace("#", "").toLowerCase();
    return validTabs.includes(hash) ? hash : "standings";
  };

  const [tab, setTabState] = useState(getTabFromHash);
  const setTab = (newTab) => {
    setTabState(newTab);
    window.location.hash = newTab;
  };

  // Listen for browser back/forward
  useEffect(() => {
    const onHashChange = () => setTabState(getTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash) window.location.hash = "standings";
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const [showMore, setShowMore] = useState(false);
  const [impersonating, setImpersonating] = useState(null);
  const [commMode, setCommMode] = useState(false);
  const [showPlayerPicker, setShowPlayerPicker] = useState(false);
  const [openAllMatches, setOpenAllMatches] = useState(false);
  const [forceWeek, setForceWeek] = useState(null);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("mnq_theme") === "dark"; } catch { return false; }
  });

  // App-level toast — surfaced from anywhere via the appToast helper. Replaces
  // the prior console.log-only feedback for things like recalcHandicaps from
  // the implicit finalize-week path. Pages that need to push a toast receive
  // appToast as a prop.
  const [appToastMsg, setAppToastState] = useState(null);
  const appToastTimer = useRef(null);
  const appToast = useCallback((msg, kind = "info", durationMs = 2400) => {
    if (!msg) return;
    if (appToastTimer.current) clearTimeout(appToastTimer.current);
    setAppToastState({ msg, kind });
    appToastTimer.current = setTimeout(() => setAppToastState(null), durationMs);
  }, []);
  useEffect(() => () => { if (appToastTimer.current) clearTimeout(appToastTimer.current); }, []);

  // Pull-to-refresh
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const pullYRef = useRef(0);
  const pullingRef = useRef(false);
  const PULL_THRESHOLD = 80;
  const appBodyRef = useRef(null);

  // Track whether ANY popup is open (for consistent body lock + pull-to-refresh)
  const [popupOpen, setPopupOpen] = useState(false);
  const popupOpenRef = useRef(false);
  useEffect(() => { popupOpenRef.current = popupOpen || showPlayerPicker; }, [popupOpen, showPlayerPicker]);

  // Inject dynamic CSS via useEffect instead of inline <style> in JSX. This runs
  // once on mount and only re-runs when darkMode changes (theme toggle), instead
  // of React diffing ~2KB of CSS text on every single re-render.
  useEffect(() => {
    let styleEl = document.getElementById("mnq-dynamic-css");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "mnq-dynamic-css";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = getCSS(K);
    return () => {}; // leave style in place — it's needed even after unmount during auth screens
  }, [darkMode]);

  const toggleTheme = () => {
    const newMode = darkMode ? "light" : "dark";
    try { localStorage.setItem("mnq_theme", newMode); } catch {}
    applyTheme(newMode);
    setDarkMode(!darkMode);
  };

  const resetPull = useCallback(() => {
    setPullY(0);
    pullYRef.current = 0;
    touchStartY.current = 0;
    pullingRef.current = false;
  }, []);

  // Re-fetch the three collections that don't have live subscriptions (course,
  // scoring rules, config). Used on mount and by pull-to-refresh.
  const refetchOneTimeReads = useCallback(() => {
    db.get("league_course", LF).then(docs => { if (docs.length) setCourseData(docs[0]); });
    db.get("league_scoring", LF).then(docs => { if (docs.length) setScoringRules(docs[0]); });
    db.get("league_config", LF).then(docs => { if (docs.length) setLeagueConfig(docs[0]); });
  }, []);

  // Check whether a new build has been deployed since the app was loaded. We compare
  // the hashed asset URLs in the currently-loaded DOM against the asset URLs in a
  // freshly-fetched index.html. Vite rebuilds produce new hashes for every deploy, so
  // any mismatch means a new version exists on the server and the running client is
  // stale.
  const hasNewBundle = useCallback(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const html = await fetch(`/index.html?t=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
      }).then(r => r.text());
      const freshAssets = [];
      let m;
      const scriptRe = /<script[^>]+src="([^"]+)"/g;
      while ((m = scriptRe.exec(html)) !== null) freshAssets.push(m[1]);
      const linkRe = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g;
      while ((m = linkRe.exec(html)) !== null) freshAssets.push(m[1]);
      const linkRe2 = /<link[^>]+href="([^"]+)"[^>]+rel="stylesheet"/g;
      while ((m = linkRe2.exec(html)) !== null) freshAssets.push(m[1]);
      const toPath = (u) => { try { return new URL(u, location.href).pathname; } catch { return u; } };
      const currentAssets = new Set([
        ...Array.from(document.querySelectorAll('script[src]')).map(s => toPath(s.src)),
        ...Array.from(document.querySelectorAll('link[rel="stylesheet"][href]')).map(l => toPath(l.href)),
      ]);
      return freshAssets.some(a => !currentAssets.has(toPath(a)));
    } catch (e) {
      console.warn('[update-check] failed:', e.name || e);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (refreshing) return;
    const getScrollEl = () => appBodyRef.current || document.querySelector('.app-body');
    let activeScrollEl = null;
    let insidePopup = false;
    let popupScrollEl = null;
    const findScrollEl = (target) => {
      let el = target;
      while (el) {
        if (el.hasAttribute && el.hasAttribute('data-popup')) return null;
        if (el.classList && el.classList.contains('app-body')) return el;
        el = el.parentElement;
      }
      return getScrollEl();
    };
    const findPopupScroll = (target) => {
      let el = target;
      while (el) {
        if (el.hasAttribute && el.hasAttribute('data-popup-scroll')) return el;
        if (el.hasAttribute && el.hasAttribute('data-popup')) return null;
        el = el.parentElement;
      }
      return null;
    };
    const handleStart = (e) => {
      if (popupOpenRef.current) {
        touchStartY.current = 0;
        return;
      }
      activeScrollEl = findScrollEl(e.target);
      insidePopup = activeScrollEl === null;
      popupScrollEl = insidePopup ? findPopupScroll(e.target) : null;
      touchStartY.current = e.touches[0].clientY;
      pullingRef.current = false;
    };
    const handleMove = (e) => {
      if (!touchStartY.current) return;
      if (popupOpenRef.current) {
        if (pullingRef.current) { pullingRef.current = false; pullYRef.current = 0; setPullY(0); }
        touchStartY.current = 0;
        return;
      }

      let atTop;
      if (insidePopup) {
        atTop = popupScrollEl ? popupScrollEl.scrollTop <= 1 : true;
      } else {
        atTop = activeScrollEl ? activeScrollEl.scrollTop <= 1 : true;
      }

      const currentY = e.touches[0].clientY;
      const diff = currentY - touchStartY.current;

      if (pullingRef.current) {
        if (diff <= 0 || !atTop) {
          pullingRef.current = false;
          pullYRef.current = 0;
          setPullY(0);
          touchStartY.current = currentY;
        } else {
          e.preventDefault();
          const val = Math.min(diff * 0.4, 120);
          pullYRef.current = val;
          setPullY(val);
        }
      } else if (atTop && diff > 10) {
        touchStartY.current = currentY;
        pullingRef.current = true;
        e.preventDefault();
        pullYRef.current = 0;
        setPullY(0);
      } else if (!atTop) {
        touchStartY.current = currentY;
      }
    };
    const handleEnd = () => {
      if (popupOpenRef.current) {
        pullingRef.current = false;
        pullYRef.current = 0;
        setPullY(0);
        touchStartY.current = 0;
        activeScrollEl = null;
        insidePopup = false;
        popupScrollEl = null;
        return;
      }
      pullingRef.current = false;
      activeScrollEl = null;
      insidePopup = false;
      popupScrollEl = null;
      if (pullYRef.current >= PULL_THRESHOLD) {
        setPullY(PULL_THRESHOLD); pullYRef.current = PULL_THRESHOLD;
        setRefreshing(true);
        const hardSafety = setTimeout(() => {
          console.warn('[pull-to-refresh] hard safety timeout — forcing reset');
          setRefreshing(false);
          setPullY(0);
          pullYRef.current = 0;
          touchStartY.current = 0;
        }, 8000);
        setTimeout(async () => {
          try {
            const needsUpdate = await hasNewBundle();
            if (needsUpdate) {
              clearTimeout(hardSafety);
              window.location.reload();
              return;
            }
            refetchOneTimeReads();
          } catch (e) {
            console.error('[pull-to-refresh] refresh failed:', e);
          } finally {
            clearTimeout(hardSafety);
            setRefreshing(false);
            setPullY(0);
            pullYRef.current = 0;
            touchStartY.current = 0;
          }
        }, 600);
      } else { setPullY(0); pullYRef.current = 0; touchStartY.current = 0; }
    };
    document.addEventListener('touchstart', handleStart, { passive: true });
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd, { passive: true });
    document.addEventListener('touchcancel', handleEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleStart);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleEnd);
    };
  }, [refreshing, refetchOneTimeReads, hasNewBundle]);

  useEffect(() => {
    if (pullY > 0 && !refreshing) {
      const safety = setTimeout(resetPull, 2000);
      return () => clearTimeout(safety);
    }
  }, [pullY, refreshing, resetPull]);

  useEffect(() => { setPopupOpen(false); }, [tab]);

  useEffect(() => {
    if (popupOpen || showPlayerPicker) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = '0';
      return () => {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.body.style.top = '';
      };
    }
  }, [popupOpen, showPlayerPicker]);

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(_auth, (user) => {
      setAuthUser(user || null);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  // Real-time subscriptions
  useEffect(() => {
    if (!authUser) { setLeagueUser(null); setMembersLoaded(false); return; }
    const unsubs = [];

    unsubs.push(db.subscribe("league_members", LF, (docs) => {
      setMembers(docs);
      setMembersLoaded(true);
      const me = docs.find(d => d.uid === authUser.uid);
      if (me) setLeagueUser({ playerId: me.playerId, isCommissioner: me.isCommissioner, name: me.name || authUser.displayName, email: authUser.email });
      else setLeagueUser(null);
    }));

    unsubs.push(db.subscribe("league_players", LF, (docs) => setPlayers(docs)));
    unsubs.push(db.subscribe("league_teams", LF, (docs) => setTeams(docs)));
    unsubs.push(db.subscribe("league_schedule", LF, (docs) => setSchedule(docs.filter(d => d.week > 0).sort((a, b) => a.week - b.week))));
    unsubs.push(db.subscribe("league_match_results", LF, (docs) => setMatchResults(docs)));
    unsubs.push(db.subscribe("league_ctp", LF, (docs) => setCtpData(docs)));

    refetchOneTimeReads();

    return () => unsubs.forEach(u => u && u());
  }, [authUser?.uid, refetchOneTimeReads]);

  useEffect(() => {
    if (liveWeek === null || !authUser) return;
    const weekFilters = [...LF, { field: "season", op: "==", value: 2026 }, { field: "week", op: "==", value: liveWeek }];
    const unsub = db.subscribe("league_hole_scores", weekFilters, (docs, changes) => {
      setSyncing(true);
      setHoleScores(prev => {
        const next = { ...prev };
        (changes || []).forEach(ch => {
          const r = ch.doc.data();
          const key = `w${r.week}_p${r.player_id}_h${r.hole}`;
          if (ch.type === "removed") delete next[key];
          else next[key] = r.score;
        });
        return next;
      });
      setTimeout(() => setSyncing(false), 500);
    });
    return () => unsub();
  }, [liveWeek, authUser?.uid]);

  // Auth actions
  const doGoogleSignIn = async () => { try { await signInWithPopup(_auth, _googleProvider); } catch (e) { console.error(e); throw e; } };
  const doEmailSignIn = async (email, pw) => {
    try {
      await signInWithEmailAndPassword(_auth, email, pw);
    } catch (e) {
      if (e.code === "auth/user-not-found" || e.code === "auth/invalid-credential" || e.code === "auth/invalid-login-credentials") {
        try {
          const c = await createUserWithEmailAndPassword(_auth, email, pw);
          await updateProfile(c.user, { displayName: email.split("@")[0] });
        } catch (createErr) {
          if (createErr.code === "auth/email-already-in-use") {
            const err = new Error("Wrong password");
            err.code = "auth/wrong-password";
            throw err;
          }
          throw createErr;
        }
      } else {
        throw e;
      }
    }
  };
  const doSignOut = async () => { await signOut(_auth); setLeagueUser(null); setTab("standings"); };
  const doPasswordReset = async (email) => {
    if (!email) { const e = new Error("Enter your email first"); e.code = "auth/missing-email"; throw e; }
    await sendPasswordResetEmail(_auth, email);
  };

  const CURRENT_SEASON = 2026;

  const allScoresCacheRef = useRef(null);

  const saveScore = useCallback(async (week, playerId, hole, score) => {
    const id = `${LEAGUE_ID}_s${CURRENT_SEASON}_w${week}_p${playerId}_h${hole}`;
    setHoleScores(prev => ({ ...prev, [`w${week}_p${playerId}_h${hole}`]: score }));
    allScoresCacheRef.current = null;
    await db.upsert("league_hole_scores", { id, league_id: LEAGUE_ID, season: CURRENT_SEASON, week, player_id: playerId, hole, score, ts: Date.now() });
  }, []);

  const fetchWeekScores = useCallback(async (weekNum) => {
    const docs = await db.get("league_hole_scores", [...LF, { field: "season", op: "==", value: CURRENT_SEASON }, { field: "week", op: "==", value: weekNum }]);
    const scores = {};
    docs.forEach(r => { scores[`w${r.week}_p${r.player_id}_h${r.hole}`] = r.score; });
    return scores;
  }, []);

  const fetchSeasonScores = useCallback(async () => {
    const docs = await db.get("league_hole_scores", [...LF, { field: "season", op: "==", value: CURRENT_SEASON }]);
    const scores = {};
    docs.forEach(r => { scores[`w${r.week}_p${r.player_id}_h${r.hole}`] = r.score; });
    return scores;
  }, []);

  const fetchAllScores = useCallback(async () => {
    if (allScoresCacheRef.current) return allScoresCacheRef.current;
    const docs = await db.get("league_hole_scores", LF);
    const byPlayer = {};
    const roundMap = {};
    docs.forEach(r => {
      const key = `${r.season}_${r.week}_${r.player_id}`;
      if (!roundMap[key]) roundMap[key] = { season: r.season, week: r.week, playerId: r.player_id, holes: 0, gross: 0 };
      if (r.score > 0) { roundMap[key].holes++; roundMap[key].gross += r.score; }
    });
    Object.values(roundMap).forEach(rd => {
      if (rd.holes === 9) {
        if (!byPlayer[rd.playerId]) byPlayer[rd.playerId] = [];
        byPlayer[rd.playerId].push({ season: rd.season, week: rd.week, gross: rd.gross });
      }
    });
    for (const pid in byPlayer) {
      byPlayer[pid].sort((a, b) => a.season !== b.season ? a.season - b.season : a.week - b.week);
    }
    allScoresCacheRef.current = byPlayer;
    return byPlayer;
  }, []);

  const saveCtp = useCallback(async (data) => await db.upsert("league_ctp", { ...data, league_id: LEAGUE_ID }), []);

  const saveMatchResult = useCallback(async (data) => await db.upsert("league_match_results", { ...data, league_id: LEAGUE_ID }), []);
  const deleteMatchResult = useCallback(async (id) => await db.deleteDoc("league_match_results", id), []);

  const savePlayer = useCallback(async (p) => await db.upsert("league_players", { ...p, league_id: LEAGUE_ID }), []);
  const deletePlayer = useCallback(async (id) => await db.deleteDoc("league_players", id), []);
  const saveTeam = useCallback(async (t) => await db.upsert("league_teams", { ...t, league_id: LEAGUE_ID }), []);
  const deleteTeam = useCallback(async (id) => await db.deleteDoc("league_teams", id), []);
  const saveWeekSchedule = useCallback(async (w) => await db.upsert("league_schedule", { ...w, league_id: LEAGUE_ID }), []);
  const setWeekSchedule = useCallback(async (w) => await db.set("league_schedule", { ...w, league_id: LEAGUE_ID }), []);
  const deleteWeekSchedule = useCallback(async (id) => await db.deleteDoc("league_schedule", id), []);

  const resetSeasonData = useCallback(async () => {
    const seasonFilter = [...LF, { field: "season", op: "==", value: CURRENT_SEASON }];
    await db.batchDelete("league_hole_scores", seasonFilter);
    await db.batchDelete("league_match_results", LF);
    await db.batchDelete("league_ctp", LF);
    for (const wk of schedule) {
      if (wk.id) await db.deleteDoc("league_schedule", wk.id);
    }
    const cleared = { ...leagueConfig };
    delete cleared.lockedSeeds;
    delete cleared.customSeedWeeks;
    const cfgId = leagueConfig?.id || `${LEAGUE_ID}_config`;
    await db.set("league_config", { ...cleared, id: cfgId, league_id: LEAGUE_ID });
    setLeagueConfig({ ...cleared, id: cfgId, league_id: LEAGUE_ID });
    setHoleScores({});
    setMatchResults([]);
    setSchedule([]);
    allScoresCacheRef.current = null;
  }, [schedule, leagueConfig]);

  const clearWeekData = useCallback(async (weekNum) => {
    const weekFilter = [...LF, { field: "season", op: "==", value: CURRENT_SEASON }, { field: "week", op: "==", value: weekNum }];
    const mrFilter = [...LF, { field: "week", op: "==", value: weekNum }];
    const ctpFilter = [...LF, { field: "week", op: "==", value: weekNum }];
    await db.batchDelete("league_hole_scores", weekFilter);
    await db.batchDelete("league_match_results", mrFilter);
    await db.batchDelete("league_ctp", ctpFilter);
  }, []);

  // Auto-seed empty seeded (non-playoff) weeks once the round-robin block completes,
  // AND auto-seed playoff rounds as they become resolvable. See lib/scheduleAutoSeed
  // refactor in the audit notes — this lives here for now.
  const autoSeedIfReady = useCallback(async (justLockedWeek) => {
    const currentSchedule = scheduleRef.current;
    const currentMatchResults = matchResultsRef.current;

    const isConfigRefresh = justLockedWeek === 0;
    const lockedWk = isConfigRefresh ? null : currentSchedule.find(s => s.week === justLockedWeek);
    if (!isConfigRefresh && !lockedWk) return 0;

    const projectedSchedule = isConfigRefresh ? currentSchedule : currentSchedule.map(s =>
      s.week === justLockedWeek ? { ...s, locked: true } : s
    );

    const lockSeedsEnabled = leagueConfig?.lockSeedsEnabled === true;
    const existingLocked = leagueConfig?.lockedSeeds;
    let seeds;

    const computeSeeds = () => buildStandingsForSeed(
      teams, currentMatchResults, projectedSchedule, leagueConfig?.standingsMethod
    ).map(s => s.teamId);

    let seededCount = 0;
    const rrWeeks = currentSchedule.filter(s => !s.isPlayoff && !s.seeded && !s.rainedOut);
    const allRRLocked = rrWeeks.length > 0 && rrWeeks.every(s =>
      s.locked === true || s.week === justLockedWeek
    );

    if (allRRLocked) {
      const useLocked = lockSeedsEnabled && existingLocked && existingLocked.length === teams.length;
      seeds = useLocked ? existingLocked : computeSeeds();

      if (!useLocked && lockSeedsEnabled) {
        await db.upsert("league_config", { ...leagueConfig, id: leagueConfig?.id || `${LEAGUE_ID}_config`, league_id: LEAGUE_ID, lockedSeeds: seeds });
      }

      const n = seeds.length;
      const pairCount = Math.floor(n / 2);
      if (pairCount >= 1) {
        const seededRegWeeks = currentSchedule.filter(s => s.seeded === true && !s.isPlayoff && !s.rainedOut).sort((a, b) => a.week - b.week);
        const customWeeks = leagueConfig?.customSeedWeeks;

        for (let si = 0; si < seededRegWeeks.length; si++) {
          const wk = seededRegWeeks[si];
          if (wk.locked === true) continue;
          const weekPairs = (customWeeks && customWeeks[si]) || null;
          const matches = [];
          if (weekPairs && weekPairs.length === pairCount) {
            for (const pair of weekPairs) {
              const t1 = seeds[pair.s1 - 1];
              const t2 = seeds[pair.s2 - 1];
              if (t1 && t2) matches.push({ team1: t1, team2: t2 });
            }
          } else {
            for (let i = 0; i < pairCount; i++) {
              matches.push({ team1: seeds[i], team2: seeds[n - 1 - i] });
            }
          }
          if (matches.length) {
            await db.upsert("league_schedule", { ...wk, matches, league_id: LEAGUE_ID });
            seededCount++;
          }
        }
      }
    }

    let playoffCount = 0;

    const playoffWeeksList = currentSchedule.filter(s => s.isPlayoff === true).sort((a, b) => a.week - b.week);
    if (playoffWeeksList.length === 0) {
      return { seeded: seededCount, playoff: 0 };
    }

    const playoffRoundsCfg = leagueConfig?.playoffRounds || [];
    if (playoffRoundsCfg.length === 0) {
      return { seeded: seededCount, playoff: 0 };
    }

    if (!seeds) {
      seeds = existingLocked && existingLocked.length === teams.length
        ? existingLocked
        : computeSeeds();
    }

    for (let pi = 0; pi < playoffWeeksList.length; pi++) {
      const pWk = playoffWeeksList[pi];
      if (pWk.locked === true) continue;
      const hasExistingMatches = pWk.matches && pWk.matches.length > 0;
      if (hasExistingMatches) {
        const hasAnyScoreOrResult = (currentMatchResults || []).some(r => r.week === pWk.week)
          || Object.keys(holeScoresRef.current || {}).some(k => k.startsWith(`w${pWk.week}_`));
        if (hasAnyScoreOrResult) continue;
      }

      const roundDef = playoffRoundsCfg[pi];

      if (pi === 0 && (!roundDef || !roundDef.matchups || !roundDef.matchups.length)) {
        const n = seeds.length;
        const pairCount = Math.floor(n / 2);
        if (pairCount < 1) break;
        const matches = [];
        for (let i = 0; i < pairCount; i++) {
          matches.push({ team1: seeds[i], team2: seeds[n - 1 - i] });
        }
        const priorMatchups = collectPriorMatchups(currentSchedule, pWk.week);
        const { pairs: consolationPairs } = pairNonBracketTeams(teams, matches, priorMatchups);
        matches.push(...consolationPairs);
        await db.upsert("league_schedule", { ...pWk, matches, league_id: LEAGUE_ID });
        playoffCount++;
        continue;
      }

      if (!roundDef || !roundDef.matchups || !roundDef.matchups.length) break;

      let prevWinners = [];
      let prevLosers = [];
      if (pi > 0) {
        const prevPWk = playoffWeeksList[pi - 1];
        if (!prevPWk.locked && prevPWk.week !== justLockedWeek) break;
        if (!prevPWk.matches || prevPWk.matches.length === 0) break;
        const prevResults = (currentMatchResults || []).filter(r => r.week === prevPWk.week);
        if (prevResults.length < prevPWk.matches.length) break;
        const prevRoundDef = playoffRoundsCfg[pi - 1];
        const prevBracketCount = (prevRoundDef?.matchups || []).length;
        const prevBracketMatches = prevBracketCount > 0
          ? prevPWk.matches.slice(0, prevBracketCount)
          : prevPWk.matches;
        prevBracketMatches.forEach((m) => {
          const r = prevResults.find(pr => pr.team1Id === m.team1 && pr.team2Id === m.team2);
          if (r) {
            const d = (r.team1Points || 0) - (r.team2Points || 0);
            prevWinners.push(d >= 0 ? r.team1Id : r.team2Id);
            prevLosers.push(d >= 0 ? r.team2Id : r.team1Id);
          }
        });
      }

      const resolveSlot = (mu, side) => {
        const type = mu[side + "type"];
        const val = mu[side];
        if (type === "seed") {
          const seedIdx = parseInt(val) - 1;
          return seedIdx >= 0 && seedIdx < seeds.length ? seeds[seedIdx] : null;
        } else if (type === "winner") {
          if (val === "lowestWinner" || val === "lowestSeed") {
            const sorted = prevWinners.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => b.rank - a.rank);
            return sorted[0]?.id || null;
          } else if (val === "nextLowestWinner" || val === "nextLowestSeed") {
            const sorted = prevWinners.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => b.rank - a.rank);
            return sorted[1]?.id || null;
          } else if (val?.startsWith("winner_")) {
            const idx = parseInt(val.split("_")[1]);
            return prevWinners[idx] || null;
          }
        } else if (type === "loser") {
          if (val === "highestLoser") {
            const sorted = prevLosers.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => a.rank - b.rank);
            return sorted[0]?.id || null;
          } else if (val === "nextHighestLoser") {
            const sorted = prevLosers.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => a.rank - b.rank);
            return sorted[1]?.id || null;
          } else if (val?.startsWith("loser_")) {
            const idx = parseInt(val.split("_")[1]);
            return prevLosers[idx] || null;
          }
        }
        return null;
      };

      const bracketMatches = [];
      const usedTeamIds = new Set();
      let hasDuplicate = false;
      for (const mu of roundDef.matchups) {
        const t1 = resolveSlot(mu, "s1");
        const t2 = resolveSlot(mu, "s2");
        if (!t1 || !t2) continue;
        if (usedTeamIds.has(t1) || usedTeamIds.has(t2) || t1 === t2) {
          hasDuplicate = true;
          console.warn(
            `[autoSeedIfReady] Skipping duplicate team in Round ${pi + 1} ` +
            `(week ${pWk.week}): matchup ${JSON.stringify(mu)} resolves to ` +
            `t1=${t1} t2=${t2} — already used: ${[...usedTeamIds].join(", ")}`
          );
          continue;
        }
        usedTeamIds.add(t1);
        usedTeamIds.add(t2);
        bracketMatches.push({ team1: t1, team2: t2 });
      }

      if (bracketMatches.length !== roundDef.matchups.length && !hasDuplicate) break;

      const priorMatchups = collectPriorMatchups(currentSchedule, pWk.week);
      const { pairs: consolationPairs } = pairNonBracketTeams(teams, bracketMatches, priorMatchups);
      const matches = [...bracketMatches, ...consolationPairs];

      await db.upsert("league_schedule", { ...pWk, matches, league_id: LEAGUE_ID });
      playoffCount++;
    }

    return { seeded: seededCount, playoff: playoffCount };
  }, [teams, leagueConfig]);

  // Import historical scores from a [name, season, week, hole, score] array.
  // See importHistoricalData.js for the source format.
  //
  // Atomic via db.batchUpsert (writeBatch under the hood, 500-op chunks). Prior
  // implementation fired Promise.all of N parallel upserts, which could leave
  // partial data on mid-batch failure. Cache invalidation now also fires on
  // success — without it, downstream Players/Standings views would show stale
  // handicap rollups until the next saveScore.
  const importHistoricalScores = useCallback(async (data) => {
    const nameMap = {};
    players.forEach(p => { nameMap[p.name.trim().toLowerCase()] = p.id; });

    const docs = [];
    let skipped = 0;
    for (const row of data) {
      const [name, season, week, hole, score] = row;
      const playerId = nameMap[name.trim().toLowerCase()];
      if (!playerId) { skipped++; continue; }
      const id = `${LEAGUE_ID}_s${season}_w${week}_p${playerId}_h${hole}`;
      docs.push({ id, league_id: LEAGUE_ID, season, week, player_id: playerId, hole, score, ts: Date.now() });
    }

    const imported = await db.batchUpsert("league_hole_scores", docs);
    // Invalidate the handicap-rollup cache so the next Players-tab visit
    // computes from the freshly-imported data.
    allScoresCacheRef.current = null;

    return { imported, skipped };
  }, [players]);

  // Recalculate all player handicaps from historical scores. Called by Admin
  // on demand AND implicitly on finalize-week. Returns the count updated, and
  // also surfaces a toast so the implicit finalize-week path isn't silent.
  const recalcHandicaps = useCallback(async () => {
    const allScores = await fetchAllScores();
    const par = courseData ? (courseData.frontPars || []).reduce((a, b) => a + b, 0) : 36;
    const recentN = scoringRules.hcpRecentCount ?? 8;
    const bestN = scoringRules.hcpBestCount ?? 6;
    let updated = 0;
    for (const p of players) {
      const rounds = allScores[p.id] || [];
      const newHcp = calcPlayerHcp(rounds, recentN, bestN, par);
      if (newHcp !== null && newHcp !== p.handicapIndex) {
        await savePlayer({ ...p, handicapIndex: newHcp });
        updated++;
      }
    }
    if (updated > 0) {
      appToast(`${updated} handicap${updated === 1 ? "" : "s"} updated`, "info", 2200);
    }
    return updated;
  }, [players, courseData, scoringRules, fetchAllScores, savePlayer, appToast]);

  const saveCourseData = useCallback(async (c) => {
    const data = { ...c, id: `${LEAGUE_ID}_course`, league_id: LEAGUE_ID };
    await db.upsert("league_course", data);
    setCourseData(data);
  }, []);
  const saveScoringRules = useCallback(async (s) => {
    const data = { ...s, id: `${LEAGUE_ID}_scoring`, league_id: LEAGUE_ID };
    await db.upsert("league_scoring", data);
    setScoringRules(data);
  }, []);
  const saveLeagueConfig = useCallback(async (c) => {
    const prev = leagueConfig;
    const data = { ...c, id: `${LEAGUE_ID}_config`, league_id: LEAGUE_ID };
    await db.upsert("league_config", data);
    setLeagueConfig(data);
    const playoffChanged = JSON.stringify(prev?.playoffRounds || []) !== JSON.stringify(data.playoffRounds || []);
    const customSeedChanged = JSON.stringify(prev?.customSeedWeeks || null) !== JSON.stringify(data.customSeedWeeks || null);
    const standingsMethodChanged = (prev?.standingsMethod || "") !== (data.standingsMethod || "");
    if (playoffChanged || customSeedChanged || standingsMethodChanged) {
      setTimeout(() => { autoSeedIfReady(0); }, 0);
    }
  }, [leagueConfig, autoSeedIfReady]);
  const saveMember = useCallback(async (m) => await db.upsert("league_members", { ...m, league_id: LEAGUE_ID }), []);
  const deleteMember = useCallback(async (id) => await db.deleteDoc("league_members", id), []);

  const isComm = leagueUser?.isCommissioner === true;
  const activePlayers = useMemo(() => players.filter(p => p.status !== "inactive"), [players]);

  const [minuteTick, setMinuteTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMinuteTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Live Scoring button appears from 30 minutes before the FIRST tee time of the
  // day through 4 hours after — enough window to cover pre-round setup and a
  // full 9-hole round with finalization. Anchored to league Eastern Time.
  //
  // Uses parseScheduleDate (not raw new Date()) so the date format is the single
  // source of truth and stays in sync with the rest of the app.
  const showLiveBtn = useMemo(() => {
    if (!schedule.length) return false;
    const now = new Date();
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const year = leagueConfig?.year || new Date().getFullYear();
    const todayStr = et.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const todayWk = schedule.find(wk => {
      if (wk.rainedOut || !wk.matches || wk.matches.length === 0) return false;
      if (!wk.date) return false;
      const wkDate = parseScheduleDate(wk.date, year);
      if (!wkDate) return false;
      return wkDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }) === todayStr;
    });
    if (!todayWk) return false;

    const startTime = leagueConfig?.startTime || "4:28 PM";
    const [timePart, ampm] = startTime.split(' ');
    const [h, m] = timePart.split(':').map(Number);
    let hour24 = h;
    if (ampm === 'PM' && h !== 12) hour24 = h + 12;
    else if (ampm === 'AM' && h === 12) hour24 = 0;
    const firstTeeMins = hour24 * 60 + (m || 0);

    const nowMins = et.getHours() * 60 + et.getMinutes();

    return nowMins >= firstTeeMins - 30 && nowMins <= firstTeeMins + 240;
  }, [schedule, leagueConfig, minuteTick]);

  useEffect(() => { if (!commMode) setImpersonating(null); }, [commMode]);

  const effectiveUser = commMode && impersonating
    ? { ...leagueUser, playerId: impersonating.playerId, name: impersonating.name }
    : leagueUser;

  if (authLoading) return <LoadingScreen />;
  if (!authUser) return <AuthScreen onGoogle={doGoogleSignIn} onEmail={doEmailSignIn} onPasswordReset={doPasswordReset} />;
  if (!membersLoaded) return <LoadingScreen />;
  if (!leagueUser || !leagueUser.playerId) return <JoinScreen authUser={authUser} members={members} players={activePlayers} saveMember={saveMember} doSignOut={doSignOut} leagueConfig={leagueConfig} />;

  const tabs = [
    { id: "players", label: "Players", icon: "users" },
    { id: "standings", label: "Standings", icon: "trophy" },
    { id: "scoring", label: "Scoring", icon: "flag" },
    { id: "schedule", label: "Schedule", icon: "calendar" },
  ];

  const moreItems = [
    { id: "stats", label: "Stats", icon: "barChart" },
    { id: "ctp", label: "CTP", icon: "target" },
    ...(isComm ? [{ id: "admin", label: "Admin", icon: "settings" }] : []),
    { id: "signout", label: "Sign Out", icon: "key" },
  ];

  const weekToFinalize = isComm ? (() => {
    for (const wk of schedule) {
      if (wk.rainedOut || wk.locked) continue;
      if (!wk.matches || wk.matches.length === 0) continue;
      const allAttested = wk.matches.every(m =>
        matchResults.some(r => r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2 && r.attested === true)
      );
      if (allAttested) return wk.week;
    }
    return null;
  })() : null;

  // Find upcoming match info for banner. Tee time computation uses the same
  // base time + interval as the Schedule's tee time formatter.
  const myTeam = teams.find(t => t.player1 === leagueUser.playerId || t.player2 === leagueUser.playerId);
  const upcomingBanner = (() => {
    if (!myTeam || !schedule.length) return null;
    for (const wk of schedule) {
      if (wk.rainedOut) continue;
      if (!wk.matches || wk.matches.length === 0) continue;
      if (wk.locked) continue;
      const myMatch = wk.matches.find(m => m.team1 === myTeam.id || m.team2 === myTeam.id);
      if (!myMatch) return null;
      const oppId = myMatch.team1 === myTeam.id ? myMatch.team2 : myMatch.team1;
      const opp = teams.find(t => t.id === oppId);
      const matchIdx = wk.matches.indexOf(myMatch);
      const base = leagueConfig?.startTime ?? "4:28 PM";
      const interval = leagueConfig?.teeInterval ?? 8;
      const [timePart, ampm] = base.split(' ');
      const [h, m] = timePart.split(':').map(Number);
      let mins = (ampm === 'PM' && h !== 12 ? h + 12 : h) * 60 + m + matchIdx * interval;
      const hr = Math.floor(mins / 60) % 12 || 12;
      const mn = mins % 60;
      const teeTime = `${hr}:${String(mn).padStart(2, '0')}`;
      const oppP1 = opp ? activePlayers.find(p => p.id === opp.player1) : null;
      const oppP2 = opp ? activePlayers.find(p => p.id === opp.player2) : null;
      const oppName1 = oppP1 ? oppP1.name.split(' ').pop() : "TBD";
      const oppName2 = oppP2 ? oppP2.name.split(' ').pop() : "TBD";
      return { week: wk.week, date: wk.date, teeTime, teeMinutes: mins, opp: opp?.name || "TBD", oppName1, oppName2, side: wk.side };
    }
    return null;
  })();

  const bannerGrn = K.matchGrn;

  const TabFallback = <div style={{ textAlign: "center", padding: 40, color: K.t3, fontSize: 13 }} className="pu">Loading...</div>;

  return (
    <div className="app-shell">
      {/* Pull-to-refresh indicator */}
      {pullY > 0 && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 999, display: "flex", justifyContent: "center", paddingTop: Math.min(pullY, 100) - 20, transition: refreshing ? "all .3s" : "none" }}>
          <style>{`
            @keyframes mnqSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            @keyframes mnqPulseGlow { 0%,100% { box-shadow: 0 0 8px ${K.act}40; } 50% { box-shadow: 0 0 18px ${K.act}80; } }
          `}</style>
          <div style={{
            width: 44, height: 44, borderRadius: "50%", background: K.card,
            border: `2.5px solid ${pullY >= PULL_THRESHOLD ? K.act : K.bdr}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: pullY >= PULL_THRESHOLD ? `0 0 12px ${K.act}50` : "0 2px 12px rgba(0,0,0,.3)",
            transition: "border-color .2s, box-shadow .3s", overflow: "hidden",
            animation: refreshing ? "mnqPulseGlow 1s ease-in-out infinite" : "none",
          }}>
            <img src="/favicon/favicon-96x96.png" alt="" style={{
              width: 28, height: 28, objectFit: "contain",
              opacity: pullY >= PULL_THRESHOLD ? 1 : 0.3 + (pullY / PULL_THRESHOLD) * 0.7,
              transform: refreshing ? "none" : `rotate(${pullY * 3}deg)`,
              animation: refreshing ? "mnqSpin .8s linear infinite" : "none",
              transition: refreshing ? "none" : "opacity .2s",
            }} />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="app-header">
        <div style={{ maxWidth: 900, width: "100%", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "0 14px" }}>
          {/* Left: Commissioner mode toggle */}
          <div style={{ position: "absolute", left: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            {isComm && (
              <>
                <span style={{ fontSize: 8, fontWeight: 700, color: commMode ? K.act : K.t3, letterSpacing: .5, textTransform: "uppercase" }}>Commish</span>
                <button onClick={() => setCommMode(!commMode)} style={{
                  width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
                  background: commMode ? K.act : K.bdr,
                  position: "relative", transition: "background .2s",
                }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 10,
                    background: "#fff",
                    position: "absolute", top: 2,
                    left: commMode ? 22 : 2,
                    transition: "left .2s",
                    boxShadow: "0 1px 3px rgba(0,0,0,.3)",
                  }} />
                </button>
              </>
            )}
          </div>
          <img src="/MnQ_logo_transparent_bg.png" alt="MnQ Golf" style={{ height: 36, objectFit: "contain" }} />
          {/* Right: Live Scoring button — only on match days during the play window */}
          <div style={{ position: "absolute", right: 14, display: "flex", alignItems: "center" }}>
            {showLiveBtn && (
            <button onClick={() => setTab("scoring")} style={{
              background: tab === "scoring" ? bannerGrn : "transparent",
              border: `1.5px solid ${tab === "scoring" ? bannerGrn : bannerGrn + "50"}`,
              borderRadius: 8, padding: "6px 10px", cursor: "pointer",
              color: tab === "scoring" ? "#fff" : bannerGrn, fontSize: 13, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: .5, lineHeight: 1.3,
            }}>
              Live<br/>Scoring
            </button>
            )}
          </div>
        </div>
      </div>

      {/* Finalize week banner — commish only */}
      {weekToFinalize && (
        <button onClick={() => { setForceWeek(weekToFinalize); setOpenAllMatches(true); setTab("scoring"); }} style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          width: "100%", maxWidth: 900, margin: "0 auto",
          padding: "8px 14px", background: K.warn + "18", border: "none",
          borderBottom: `1px solid ${K.warn}40`, cursor: "pointer", flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: K.warn }}>
            Week {weekToFinalize} ready to finalize
          </span>
          <span style={{ fontSize: 11, color: K.warn, opacity: .7 }}>→</span>
        </button>
      )}

      <div className="app-body" ref={appBodyRef}>
        <div style={{ maxWidth: 900, width: "100%", margin: "0 auto" }}>
          {upcomingBanner && tab !== "scoring" && (() => {
            return (
              <div style={{ background: K.card, border: `1.5px solid ${bannerGrn}`, borderRadius: 10, margin: "6px 14px", padding: "10px 16px", display: "flex", alignItems: "center" }}>
                <div style={{ width: 80, flexShrink: 0, textAlign: "left", lineHeight: 1.3, padding: "6px 0" }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: K.act, letterSpacing: .5 }}>{upcomingBanner.teeTime}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: K.logoBright, letterSpacing: .5, textTransform: "uppercase" }}>{upcomingBanner.side === 'front' ? 'FRONT 9' : 'BACK 9'}</div>
                </div>
                <div style={{ flex: 1, textAlign: "center", lineHeight: 1.3 }}>
                  <div style={{ fontSize: 12, color: K.t2, fontWeight: 500 }}>{upcomingBanner.date || ""}</div>
                  <div style={{ fontSize: 14, color: K.t1, fontWeight: 700 }}>Week {upcomingBanner.week}</div>
                </div>
                <div style={{ width: 80, flexShrink: 0, textAlign: "right", lineHeight: 1.3 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: K.t1 }}>{upcomingBanner.oppName1}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: K.t1 }}>{upcomingBanner.oppName2}</div>
                </div>
              </div>
            );
          })()}
          <div className="main-content fi" key={tab}>
          <ErrorBoundary>
          <Suspense fallback={TabFallback}>
          {tab === "standings" && <StandingsView teams={teams} players={activePlayers} matchResults={matchResults} leagueConfig={leagueConfig} schedule={schedule} fetchSeasonScores={fetchSeasonScores} course={courseData} fetchWeekScores={fetchWeekScores} scoringRules={scoringRules} fetchAllScores={fetchAllScores} saveMatchResult={saveMatchResult} />}
          {tab === "scoring" && <LiveScoringView leagueUser={effectiveUser} players={activePlayers} teams={teams} course={courseData} schedule={schedule} holeScores={holeScores} saveScore={saveScore} scoringRules={scoringRules} matchResults={matchResults} saveMatchResult={saveMatchResult} deleteMatchResult={deleteMatchResult} ctpData={ctpData} saveCtp={saveCtp} setLiveWeek={setLiveWeek} fetchWeekScores={fetchWeekScores} isComm={isComm} commMode={commMode} leagueConfig={leagueConfig} saveWeekSchedule={saveWeekSchedule} setWeekSchedule={setWeekSchedule} deleteWeekSchedule={deleteWeekSchedule} openAllMatches={openAllMatches} onAllMatchesOpened={() => setOpenAllMatches(false)} forceWeek={forceWeek} onForceWeekUsed={() => setForceWeek(null)} setPopupOpen={setPopupOpen} recalcHandicaps={recalcHandicaps} clearWeekData={clearWeekData} autoSeedIfReady={autoSeedIfReady} />}
          {tab === "schedule" && <ScheduleView schedule={schedule} teams={teams} players={activePlayers} matchResults={matchResults} leagueUser={effectiveUser} leagueConfig={leagueConfig} course={courseData} fetchWeekScores={fetchWeekScores} scoringRules={scoringRules} isComm={isComm} saveScore={saveScore} saveMatchResult={saveMatchResult} setPopupOpen={setPopupOpen} />}
          {tab === "players" && <PlayersView players={activePlayers} course={courseData} schedule={schedule} scoringRules={scoringRules} fetchAllScores={fetchAllScores} members={members} />}
          {tab === "stats" && <StatsView players={activePlayers} course={courseData} schedule={schedule} scoringRules={scoringRules} fetchSeasonScores={fetchSeasonScores} />}
          {tab === "ctp" && <CTPView ctpData={ctpData} players={activePlayers} isComm={isComm} saveCtp={saveCtp} />}
          {tab === "admin" && isComm && <AdminView players={players} savePlayer={savePlayer} deletePlayer={deletePlayer} teams={teams} saveTeam={saveTeam} deleteTeam={deleteTeam} schedule={schedule} saveWeekSchedule={saveWeekSchedule} setWeekSchedule={setWeekSchedule} deleteWeekSchedule={deleteWeekSchedule} course={courseData} saveCourseData={saveCourseData} scoringRules={scoringRules} saveScoringRules={saveScoringRules} leagueConfig={leagueConfig} saveLeagueConfig={saveLeagueConfig} members={members} saveMember={saveMember} deleteMember={deleteMember} authUser={authUser} matchResults={matchResults} saveMatchResult={saveMatchResult} resetSeasonData={resetSeasonData} importHistoricalScores={importHistoricalScores} recalcHandicaps={recalcHandicaps} autoSeedIfReady={autoSeedIfReady} clearWeekData={clearWeekData} />}
          </Suspense>
          </ErrorBoundary>
          {commMode && <div style={{ height: 44 }} />}
          </div>
        </div>
      </div>

      {/* App-level toast */}
      {appToastMsg && (
        <>
          <style>{`@keyframes appToastDown { 0% { transform: translateX(-50%) translateY(-20px); opacity: 0; } 100% { transform: translateX(-50%) translateY(0); opacity: 1; } }`}</style>
          <div style={{
            position: "fixed", top: 30, left: "50%", transform: "translateX(-50%)",
            background: appToastMsg.kind === "error" ? K.red : K.act, color: K.bg,
            padding: "12px 36px", borderRadius: 12,
            fontSize: 13, fontWeight: 700, zIndex: 1100,
            whiteSpace: "nowrap", maxWidth: "90vw", textAlign: "center",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            animation: "appToastDown 0.3s ease",
          }}>{appToastMsg.msg}</div>
        </>
      )}

      {showMore && (
        <div onClick={() => setShowMore(false)} style={{ position: "fixed", inset: 0, zIndex: 150 }} />
      )}

      {showPlayerPicker && (
        <>
          <div onClick={() => setShowPlayerPicker(false)} data-popup style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 400 }} />
          <div onClick={() => setShowPlayerPicker(false)} data-popup style={{ position: "fixed", inset: 0, zIndex: 450, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} data-popup-scroll style={{ background: K.bg, border: `1px solid ${K.bdr}`, borderRadius: 14, padding: "16px", width: "100%", maxWidth: 340, maxHeight: "70vh", overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: K.t1, marginBottom: 12, textAlign: "center" }}>Switch Player</div>
              {impersonating && (
                <button onClick={() => { setImpersonating(null); setShowPlayerPicker(false); }} style={{ width: "100%", padding: "10px 14px", marginBottom: 8, borderRadius: 8, background: K.teal + "15", border: `1px solid ${K.teal}40`, color: K.teal, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  Back to My Account
                </button>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[...activePlayers].sort((a, b) => a.name.localeCompare(b.name)).map(p => {
                  const isSelf = p.id === leagueUser.playerId;
                  const isActive = impersonating?.playerId === p.id;
                  return (
                    <button key={p.id} onClick={() => {
                      if (isSelf) { setImpersonating(null); }
                      else { setImpersonating({ playerId: p.id, name: p.name }); }
                      setShowPlayerPicker(false);
                    }} style={{
                      padding: "10px 14px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                      background: isActive ? K.teal + "15" : isSelf ? K.acc + "10" : K.card,
                      border: `1px solid ${isActive ? K.teal + "40" : isSelf ? K.acc + "30" : K.bdr}`,
                      color: K.t1, fontSize: 14, fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}>
                      <span>{p.name}</span>
                      {isSelf && <span style={{ fontSize: 10, color: K.t3, fontWeight: 500 }}>(you)</span>}
                      {isActive && <span style={{ fontSize: 10, color: K.teal, fontWeight: 500 }}>active</span>}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => setShowPlayerPicker(false)} style={{ display: "block", width: "100%", margin: "12px 0 0", padding: "9px", background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 8, color: K.t2, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {commMode && (
        <button onClick={() => setShowPlayerPicker(true)} style={{ width: "100%", maxWidth: 900, margin: "0 auto", background: K.act, padding: "8px 14px", display: "flex", justifyContent: "center", alignItems: "center", gap: 8, flexShrink: 0, cursor: "pointer", border: "none", zIndex: 200 }}>
          <span style={{ fontSize: 12, color: K.bg, fontWeight: 800, letterSpacing: .5 }}>
            {impersonating ? `Logged in as ${impersonating.name}` : "Login as"}
          </span>
          <span style={{ fontSize: 10, color: K.bg + "90" }}>▾</span>
          {impersonating && (
            <button onClick={(e) => { e.stopPropagation(); setImpersonating(null); }} style={{ background: K.bg + "25", border: "none", borderRadius: 4, color: K.bg, fontSize: 10, padding: "3px 8px", cursor: "pointer", fontWeight: 700 }}>Exit</button>
          )}
        </button>
      )}

      <div className="bottom-nav" style={{ margin: "0 auto" }}>
        {tabs.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => { setTab(t.id); setShowMore(false); }} style={{ background: active ? K.acc + "10" : "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, opacity: active ? 1 : .4, transition: "all .2s", padding: "4px 14px", borderRadius: 8 }}>
              <span style={{ display: "flex" }}>{I[t.icon](18, active ? K.acc : K.t2)}</span>
              <span style={{ fontSize: 9, fontWeight: active ? 600 : 400, color: active ? K.acc : K.t2 }}>{t.label}</span>
            </button>
          );
        })}
        <div style={{ position: "relative" }}>
          <button onClick={() => setShowMore(!showMore)} style={{ background: showMore || moreItems.some(m => m.id === tab) ? K.acc + "10" : "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, opacity: showMore || moreItems.some(m => m.id === tab) ? 1 : .4, transition: "all .2s", padding: "4px 14px", borderRadius: 8 }}>
            <span style={{ display: "flex" }}>{I.ellipsis(18, showMore || moreItems.some(m => m.id === tab) ? K.acc : K.t2)}</span>
            <span style={{ fontSize: 9, fontWeight: showMore || moreItems.some(m => m.id === tab) ? 600 : 400, color: showMore || moreItems.some(m => m.id === tab) ? K.acc : K.t2 }}>More</span>
          </button>
          {showMore && (
            <div style={{ position: "fixed", bottom: `calc(56px + env(safe-area-inset-bottom, 0px))`, right: 14, background: K.card, border: `1px solid ${K.bdr}`, borderRadius: 12, padding: "6px 0", zIndex: 300, minWidth: 180, boxShadow: "0 -4px 20px rgba(0,0,0,.4)" }}>
              {moreItems.map((item) => {
                const active = tab === item.id;
                const isSignOut = item.id === "signout";
                return (
                  <div key={item.id}>
                    {isSignOut && (<>
                      <div style={{ borderTop: `1px solid ${K.bdr}`, margin: "4px 0" }} />
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px" }}>
                        <span style={{ fontSize: 14, fontWeight: 400, color: K.t1 }}>Dark Mode</span>
                        <button onClick={(e) => { e.stopPropagation(); toggleTheme(); }} style={{
                          width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
                          background: darkMode ? K.act : K.bdr,
                          position: "relative", transition: "background .2s",
                        }}>
                          <div style={{
                            width: 20, height: 20, borderRadius: 10,
                            background: "#fff",
                            position: "absolute", top: 2,
                            left: darkMode ? 22 : 2,
                            transition: "left .2s",
                            boxShadow: "0 1px 3px rgba(0,0,0,.3)",
                          }} />
                        </button>
                      </div>
                      <div style={{ borderTop: `1px solid ${K.bdr}`, margin: "4px 0" }} />
                    </>)}
                    <button onClick={() => {
                      if (isSignOut) { doSignOut(); }
                      else { setTab(item.id); }
                      setShowMore(false);
                    }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 16px", background: active && !isSignOut ? K.acc + "12" : "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ display: "flex" }}>{I[item.icon](16, isSignOut ? K.red : active ? K.acc : K.t3)}</span>
                      <span style={{ fontSize: 14, fontWeight: active && !isSignOut ? 600 : 400, color: isSignOut ? K.red : active ? K.acc : K.t1 }}>{item.label}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
