import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { db, LF, LEAGUE_ID, _auth, _googleProvider, onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, fetchSignInMethodsForEmail, signOut, updateProfile, sendPasswordResetEmail } from "./firebase";
import { K, I, DEFAULT_SCORING, applyTheme, getCSS, calcPlayerHcp, LoadingPanel } from "./theme";
import { parseScheduleDate } from "./lib/scheduleDate";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { autoSeedIfReady as autoSeedIfReadyLib } from "./lib/scheduleAutoSeed";
import { LoadingScreen, AuthScreen, JoinScreen } from "./pages/Auth";
import ErrorBoundary from "./ErrorBoundary";
import { Popup } from "./components/Popup";

// Fix #2: Lazy-load page components — Vite will code-split each into its own chunk.
// Only the active tab's code is downloaded and parsed on navigation.
// ── Retry helper for lazy() route imports ────────────────────────────
// Dynamic import() can fail transiently on slow/flaky mobile networks —
// the chunk request times out, the promise rejects, React's Suspense
// catches it and bails. Visible symptom: tab is tapped, screen briefly
// flashes the fallback, then reverts to the previously-rendered tab.
// Tapping the tab again often succeeds because the browser has cached
// the in-flight request.
//
// This helper retries up to 3 times with a 400ms backoff on each attempt.
// React only sees the eventual resolve/reject, so it's transparent to
// the Suspense boundary. Production tradeoff: a hard failure now takes
// ~1.2s to surface instead of immediate, but immediate failure was
// invisible to the user anyway (screen just stayed put), so the trade
// is strictly positive.
const lazyWithRetry = (importFn) => lazy(async () => {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await importFn();
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 400));
      }
    }
  }
  throw lastErr;
});

const StandingsView = lazyWithRetry(() => import("./pages/Standings"));
const LiveScoringView = lazyWithRetry(() => import("./pages/Scoring"));
const ScheduleView = lazyWithRetry(() => import("./pages/Schedule"));
const PlayersView = lazyWithRetry(() => import("./pages/Players"));
const StatsView = lazyWithRetry(() => import("./pages/Stats"));
const CTPView = lazyWithRetry(() => import("./pages/CTP"));
const AdminView = lazyWithRetry(() => import("./pages/Admin"));
const NotificationsSettings = lazyWithRetry(() => import("./pages/NotificationsSettings"));


export default function GolfLeagueApp() {
  const [authUser, setAuthUser] = useState(undefined);
  const [leagueUser, setLeagueUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [schedule, setSchedule] = useState([]);
  // Attendance flags — players announcing in advance that they will be
  // absent or making up a future week. Keyed by `w${week}_p${pid}` so
  // lookups from Schedule.jsx are O(1). Values: { status: "absent" |
  // "makeup", markedAt, markedBy }. See Schedule.jsx for the UI side
  // (Mark Out button + confirmation popup). Phase 1: announce only —
  // Live Scoring and match calc don't yet read from this collection.
  const [attendance, setAttendance] = useState({});
  // dataLoaded tracks whether each Firestore subscription has fired at
  // least once. Pages use it to choose between SkeletonList (cold-start
  // first paint, data still en route) and EmptyState (data fetched,
  // genuinely empty). Without this, the cold-start path briefly
  // renders the empty state before the snapshot arrives — visible flash
  // on slow connections.
  const [dataLoaded, setDataLoaded] = useState({
    players: false,
    teams: false,
    schedule: false,
  });
  const [courseData, setCourseData] = useState(null);
  const [scoringRules, setScoringRules] = useState(DEFAULT_SCORING);
  const [holeScores, setHoleScores] = useState({});
  const [ctpData, setCtpData] = useState([]);
  const [matchResults, setMatchResults] = useState([]);
  const [leagueConfig, setLeagueConfig] = useState({ name: "Golf League 2026", year: 2026 });

  // ── Latest-state ref for autoSeedIfReady ──
  // Replaces the previous three separate refs (scheduleRef,
  // matchResultsRef, holeScoresRef) with one consolidated ref. Updated
  // via useEffect after every state change so the ref always reflects
  // the most recent committed state.
  //
  // Why it exists at all
  // ────────────────────
  // Callers like saveLeagueConfig do `setTimeout(() => autoSeedIfReady(0), 0)`.
  // If the autoSeedIfReady wrapper had `leagueConfig` in its useCallback
  // deps and read state via closure, the setTimeout would fire the OLD
  // wrapper (captured at save-call time, before setLeagueConfig had
  // propagated), and that wrapper's closure would have the OLD config —
  // so autoSeedIfReady wouldn't see the very change that triggered it.
  // Reading state from a ref at call time sidesteps this: regardless of
  // when the wrapper was created, it sees the latest state.
  //
  // Why one ref instead of three
  // ────────────────────────────
  // Bundling into one object means one useEffect, one place to add a
  // new field if autoSeedIfReady ever needs more state, and the ref's
  // shape mirrors the lib function's parameter shape exactly. Cuts
  // App.jsx's hook count and makes the relationship explicit.
  //
  // Why the wrapper now has empty deps
  // ─────────────────────────────────
  // The wrapper is stable across renders. autoSeedIfReady is passed as
  // a prop to multiple page components (Scoring, Schedule, Admin) — a
  // stable identity means those components don't see prop churn on every
  // realtime subscription update. They previously got a new wrapper
  // identity any time teams or leagueConfig changed.
  const autoSeedStateRef = useRef({});
  useEffect(() => {
    autoSeedStateRef.current = { schedule, matchResults, holeScores, teams, leagueConfig };
  }, [schedule, matchResults, holeScores, teams, leagueConfig]);

  const [members, setMembers] = useState([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [liveWeek, setLiveWeek] = useState(null);
  const validTabs = ["standings", "scoring", "schedule", "players", "stats", "ctp", "admin", "notifications"];
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

  // ── Push notification foreground handler ─────────────────────────────
  // Mounts once at app start. When the app is in the foreground, FCM
  // delivers messages via onMessage (NOT the SW's onBackgroundMessage),
  // and Chrome/Firefox don't auto-show a notification UI for those. This
  // handler bridges that gap by manually calling showNotification on the
  // SW registration, so the user sees the same banner either way.
  // Safe to run on every page including unauthed — the helper bails
  // internally if FCM isn't supported.
  useEffect(() => {
    import("./lib/notifications").then(mod => mod.initForegroundNotifications());
    // Also clear app badge whenever the user opens the app — they're
    // here now, so any pending notification count is consumed.
    import("./lib/notifications").then(mod => mod.clearAppBadge());
  }, []);

  const [showMore, setShowMore] = useState(false);
  const [impersonating, setImpersonating] = useState(null);
  const [commMode, setCommMode] = useState(false);
  const [showPlayerPicker, setShowPlayerPicker] = useState(false);
  const [openAllMatches, setOpenAllMatches] = useState(false);
  // openFinalize → Scoring opens the CTP-selection / finalize popup directly.
  // The app-level "Week N ready to finalize" banner sets this. Mirrors the
  // openAllMatches pattern: set true here, Scoring's effect picks it up,
  // Scoring fires onFinalizeOpened to clear the flag.
  const [openFinalize, setOpenFinalize] = useState(false);
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

  // ── Pull-to-refresh ──
  // Lives in lib/usePullToRefresh now. The hook call itself is below this
  // block (after refetchOneTimeReads + hasNewBundle are defined, since they're
  // its dependencies). What stays HERE: popupOpenRef, which the hook reads via
  // ref so popup-open state changes don't churn the touch event handlers.
  // What's removed: the 6 lines of pull-related state + threshold constant +
  // the resetPull useCallback (now both inside the hook).

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

  // resetPull moved to usePullToRefresh hook (returned in destructure below).

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

  // ── Hook up pull-to-refresh ──
  // Attach `appBodyRef` to the main scroll body div in the JSX below; the
  // hook reads scrollTop from it to gate the gesture. PULL_THRESHOLD is
  // also returned from the hook so the spinner JSX can use the same value
  // when deciding when to flip the spinner color from gray → maize.
  const { pullY, refreshing, appBodyRef, PULL_THRESHOLD } = usePullToRefresh({
    popupOpenRef,
    hasNewBundle,
    refetchOneTimeReads,
  });

  // ── Pull-to-refresh effects extracted to lib/usePullToRefresh ──
  // The hook owns the touch event installation + soft watchdog. Caller
  // (this file) only attaches `appBodyRef` to the scroll body and renders
  // the spinner JSX based on the returned `pullY` / `refreshing` values.

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

    unsubs.push(db.subscribe("league_players", LF, (docs) => {
      setPlayers(docs);
      setDataLoaded(prev => prev.players ? prev : { ...prev, players: true });
    }));
    unsubs.push(db.subscribe("league_teams", LF, (docs) => {
      setTeams(docs);
      setDataLoaded(prev => prev.teams ? prev : { ...prev, teams: true });
    }));
    unsubs.push(db.subscribe("league_schedule", LF, (docs) => {
      setSchedule(docs.filter(d => d.week > 0).sort((a, b) => a.week - b.week));
      setDataLoaded(prev => prev.schedule ? prev : { ...prev, schedule: true });
    }));
    // Attendance subscription. Each doc id encodes (week, pid) per the
    // saveAttendance convention; flatten to a lookup object so Schedule
    // can hit `attendance[`w${wk}_p${pid}`]?.status` without scanning.
    unsubs.push(db.subscribe("league_attendance", LF, (docs) => {
      const flat = {};
      for (const d of docs) {
        if (!d || typeof d.week !== "number" || !d.playerId || !d.status) continue;
        flat[`w${d.week}_p${d.playerId}`] = {
          status: d.status,
          markedAt: d.markedAt,
          markedBy: d.markedBy,
        };
      }
      setAttendance(flat);
    }));
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
    // Email/password sign-in with an auto-create fallback for first-time
    // users (so the UI doesn't need a separate "Sign Up" form).
    //
    // The orphan-account risk
    // ───────────────────────
    // Firebase returns `auth/invalid-credential` for BOTH "no such user" and
    // "wrong password" — same error code, same message. The naive flow
    // ("on invalid-credential, try to create the user") would create an
    // orphan account if a returning user mistypes their password and the
    // create attempt happens to succeed (e.g., Firebase glitch, or email
    // enumeration protection wasn't fully active). The previous code had a
    // belt-and-suspenders catch on `email-already-in-use` from the create
    // attempt — that catches MOST cases but isn't a guarantee.
    //
    // Defense in depth here:
    //   1. Try sign-in.
    //   2. On invalid-credential / user-not-found, ASK Firebase whether
    //      this email already has any sign-in methods registered. If yes,
    //      it's definitely a wrong-password scenario — throw immediately
    //      without attempting create. This is the strongest guarantee.
    //   3. If Firebase reports no methods (truly new user), attempt create.
    //   4. Belt-and-suspenders: keep the email-already-in-use catch in
    //      case fetchSignInMethodsForEmail's email-enumeration protection
    //      returns an empty list for a real existing account.
    //
    // Note on email enumeration protection: when enabled in Firebase, step
    // 2 may return [] even for existing emails (privacy feature). That's
    // why step 4 is still here as a fallback — the create attempt itself
    // is the canonical "is this email taken?" check.
    try {
      await signInWithEmailAndPassword(_auth, email, pw);
    } catch (e) {
      const isAmbiguous = e.code === "auth/user-not-found"
        || e.code === "auth/invalid-credential"
        || e.code === "auth/invalid-login-credentials";
      if (!isAmbiguous) throw e;

      // Step 2: check whether this email is already registered.
      try {
        const methods = await fetchSignInMethodsForEmail(_auth, email);
        if (methods && methods.length > 0) {
          // Email is registered → this was a wrong-password attempt. Do
          // NOT attempt to create a duplicate account.
          const err = new Error("Wrong password");
          err.code = "auth/wrong-password";
          throw err;
        }
      } catch (lookupErr) {
        // If the lookup itself fails (network issue, etc.), fall through
        // to step 3's create attempt — which has its own protection in
        // step 4. Don't let a transient lookup failure block legitimate
        // first-time signups.
        if (lookupErr.code === "auth/wrong-password") throw lookupErr;
      }

      // Step 3: appears to be a new user — attempt create.
      try {
        const c = await createUserWithEmailAndPassword(_auth, email, pw);
        await updateProfile(c.user, { displayName: email.split("@")[0] });
      } catch (createErr) {
        // Step 4: belt-and-suspenders. If create fails because the email
        // exists, this WAS a wrong-password scenario despite step 2 not
        // catching it (likely email enumeration protection masked the
        // existence). Surface as wrong-password.
        if (createErr.code === "auth/email-already-in-use") {
          const err = new Error("Wrong password");
          err.code = "auth/wrong-password";
          throw err;
        }
        throw createErr;
      }
    }
  };
  const doSignOut = async () => {
    // Reset auth-derived state SYNCHRONOUSLY before awaiting signOut. The
    // auth-state listener (line 224 effect) will eventually fire and reset
    // these too, but it's async — there's a render gap between
    // setLeagueUser(null) and the listener clearing membersLoaded, during
    // which `!leagueUser && membersLoaded` is true and the render falls
    // through to JoinScreen with stale member data flashing on screen
    // before the listener catches up. Resetting here makes the transition
    // go LoadingScreen → AuthScreen cleanly, no flash.
    //
    // Also clearing commMode + impersonating: a commissioner who signs out
    // and lets someone else sign in on the same device would otherwise
    // start the next session in commMode=true (their setting persisted
    // through the signout). Resetting here ensures every sign-in starts
    // clean.
    setMembersLoaded(false);
    setMembers([]);
    setLeagueUser(null);
    setCommMode(false);
    setImpersonating(null);
    setTab("standings");
    await signOut(_auth);
  };
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
    // Return the upsert result. db.upsert resolves to the data object on
    // success and to `null` when Firestore rejects the write (network drop,
    // permission denied, doc-too-large). Schedule.jsx's commitEditedScores
    // checks this return value to detect silent save failures and surface
    // them via toast — without this `return`, that check always sees
    // undefined and treats every save as successful.
    return await db.upsert("league_hole_scores", { id, league_id: LEAGUE_ID, season: CURRENT_SEASON, week, player_id: playerId, hole, score, ts: Date.now() });
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
    // Invalidate the season-scores cache. Without this, a subsequent
    // recalcHandicaps (or anything else that calls fetchAllScores) returns
    // a stale cached snapshot that still contains the just-deleted week's
    // scores, producing inflated handicap rolls. resetSeasonData and
    // saveScore both invalidate this same cache; clearWeekData was the
    // odd one out, easy to miss because it's only called from rain-out
    // and reset-week flows that don't immediately recompute handicaps.
    allScoresCacheRef.current = null;
  }, []);

  // ── Auto-seed wrapper ──
  // The 200-line implementation lives in lib/scheduleAutoSeed. This wrapper
  // forwards to the lib using the latest-state ref (declared near the top
  // of this component). Empty deps = stable identity across renders, which
  // matters because autoSeedIfReady is passed as a prop to multiple page
  // components.
  const autoSeedIfReady = useCallback(async (justLockedWeek) => {
    return autoSeedIfReadyLib({
      justLockedWeek,
      ...autoSeedStateRef.current,
    });
  }, []);

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

    // Collect all updates first, then batch-write in a single Firestore
    // round-trip. Previously this was a serial `for ... await savePlayer`
    // loop — on a 20-player league that meant 20 sequential round-trips
    // (~3-6s on typical mobile network), and the realtime subscription
    // would fire 20 separate updates back, each re-rendering Players /
    // Standings / Scoring. Batching collapses the writes into one ~200ms
    // commit and produces a single subscription update, so the UI stays
    // smooth and the action completes fast enough that the appToast feels
    // responsive instead of laggy.
    //
    // Semantics preserved: only update players whose computed handicap
    // ACTUALLY CHANGED. db.batchUpsert uses { merge: true } same as
    // db.upsert under the hood, so write-shape is identical to the prior
    // savePlayer call. League_id is added per-doc (consistent with
    // savePlayer's spread).
    const updates = [];
    for (const p of players) {
      const rounds = allScores[p.id] || [];
      const newHcp = calcPlayerHcp(rounds, recentN, bestN, par);
      if (newHcp !== null && newHcp !== p.handicapIndex) {
        updates.push({ ...p, handicapIndex: newHcp, league_id: LEAGUE_ID });
      }
    }

    let updated = 0;
    if (updates.length > 0) {
      try {
        updated = await db.batchUpsert("league_players", updates);
      } catch (e) {
        // batchUpsert throws on Firestore failure (unlike upsert which
        // catches and returns null). Surface to the user via toast and
        // re-throw so the caller's await-chain knows it failed.
        appToast("Handicap update failed — please try again", "error", 3000);
        throw e;
      }
    }

    if (updated > 0) {
      appToast(`${updated} handicap${updated === 1 ? "" : "s"} updated`, "info", 2200);
    }
    return updated;
  }, [players, courseData, scoringRules, fetchAllScores, appToast]);

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
    // Stable deep-equality: JSON.stringify with a sorted-keys replacer
    // produces a canonical form that's invariant to key insertion order
    // for objects nested anywhere in the tree. Plain JSON.stringify
    // would return false-positives "changed" when a nested object's
    // keys were written in a different order on the prev vs. data side
    // — even though the underlying values were identical. Today's data
    // shapes happen to be order-stable by construction, but a future
    // refactor that builds these via spread/destructure could silently
    // break the comparison. Belt-and-suspenders: works regardless of
    // construction discipline. The performance cost (one extra walk
    // per save) is negligible for these small objects.
    const stableStringify = (obj) => JSON.stringify(obj, (_k, v) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const sorted = {};
        Object.keys(v).sort().forEach(k => { sorted[k] = v[k]; });
        return sorted;
      }
      return v;
    });
    const playoffChanged = stableStringify(prev?.playoffRounds || []) !== stableStringify(data.playoffRounds || []);
    const customSeedChanged = stableStringify(prev?.customSeedWeeks || null) !== stableStringify(data.customSeedWeeks || null);
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

  // Attendance — save = mark a player out for a given week with a status
  // of "absent" or "makeup"; passing status=null DELETES the flag (the
  // undo path from the ✕ button on the Schedule row). Doc id is the same
  // (week, pid) convention used elsewhere so it's deterministic and an
  // overwrite naturally replaces a prior "absent" with "makeup" or vice
  // versa without leaving orphaned docs. markedBy is the effective user's
  // player id (so commissioner impersonation correctly records who acted).
  //
  // Placement note: this hook MUST be declared after `effectiveUser` since
  // it reads from it, and BEFORE the early returns below so the hooks
  // order stays stable across renders. Moving it elsewhere will either
  // hit a temporal-dead-zone error (declared above effectiveUser) or a
  // "rendered fewer hooks than expected" React error (declared below the
  // conditional returns).
  const saveAttendance = useCallback(async (week, playerId, status) => {
    const docId = `${LEAGUE_ID}_w${week}_p${playerId}`;
    if (status === null) {
      return await db.deleteDoc("league_attendance", docId);
    }
    return await db.upsert("league_attendance", {
      id: docId,
      league_id: LEAGUE_ID,
      season: CURRENT_SEASON,
      week,
      playerId,
      status,
      markedAt: Date.now(),
      markedBy: effectiveUser?.playerId || null,
    });
  }, [effectiveUser?.playerId]);

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

  // More menu order: Admin first (when present) so the privileged tool is
  // grouped at the top and visually distinct from the regular nav items
  // below it. Sign Out stays at the bottom — separated from the navigation
  // entries by intent. Previously Admin was sandwiched between CTP and
  // Sign Out, which was easy to miss-tap when reaching for Sign Out.
  const moreItems = [
    ...(isComm ? [{ id: "admin", label: "Admin", icon: "settings" }] : []),
    { id: "stats", label: "Stats", icon: "barChart" },
    { id: "ctp", label: "CTP", icon: "target" },
    { id: "notifications", label: "Notifications", icon: "bell" },
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

  const TabFallback = <LoadingPanel />;

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
        <button onClick={() => {
          setForceWeek(weekToFinalize);
          setOpenAllMatches(true);   // routes the scoring view to the right week's All Matches
          setOpenFinalize(true);     // and opens the finalize CTP popup directly
          setTab("scoring");
        }} style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          width: "100%", maxWidth: 900, margin: "0 auto",
          padding: "12px 16px", background: K.act, border: "none",
          cursor: "pointer", flexShrink: 0,
          boxShadow: `0 2px 8px ${K.act}40`,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: K.bg, opacity: .7, letterSpacing: 1, textTransform: "uppercase" }}>Ready</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: K.bg, letterSpacing: .3, textTransform: "uppercase" }}>
            Finalize Week {weekToFinalize}
          </span>
          <span style={{ fontSize: 16, fontWeight: 800, color: K.bg, opacity: .85 }}>›</span>
        </button>
      )}

      <div className="app-body" ref={appBodyRef}>
        <div style={{ maxWidth: 900, width: "100%", margin: "0 auto" }}>
          {/* upcomingBanner only renders on Standings + Schedule. Showing it on
              Players, Stats, CTP, Admin felt out of context — the user is doing
              an unrelated task, and the "your next match" banner clutters the
              top of every page. Scoring already excludes itself because the
              live scoring view IS the next-match context. */}
          {upcomingBanner && (tab === "standings" || tab === "schedule") && (() => {
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
          {tab === "standings" && <StandingsView teams={teams} players={activePlayers} matchResults={matchResults} leagueConfig={leagueConfig} schedule={schedule} fetchSeasonScores={fetchSeasonScores} course={courseData} fetchWeekScores={fetchWeekScores} scoringRules={scoringRules} fetchAllScores={fetchAllScores} saveMatchResult={saveMatchResult} dataLoaded={dataLoaded} />}
          {tab === "scoring" && <LiveScoringView leagueUser={effectiveUser} players={activePlayers} teams={teams} course={courseData} schedule={schedule} holeScores={holeScores} saveScore={saveScore} scoringRules={scoringRules} matchResults={matchResults} saveMatchResult={saveMatchResult} deleteMatchResult={deleteMatchResult} ctpData={ctpData} saveCtp={saveCtp} setLiveWeek={setLiveWeek} fetchWeekScores={fetchWeekScores} isComm={isComm} commMode={commMode} leagueConfig={leagueConfig} saveWeekSchedule={saveWeekSchedule} setWeekSchedule={setWeekSchedule} deleteWeekSchedule={deleteWeekSchedule} openAllMatches={openAllMatches} onAllMatchesOpened={() => setOpenAllMatches(false)} openFinalize={openFinalize} onFinalizeOpened={() => setOpenFinalize(false)} forceWeek={forceWeek} onForceWeekUsed={() => setForceWeek(null)} setPopupOpen={setPopupOpen} recalcHandicaps={recalcHandicaps} clearWeekData={clearWeekData} autoSeedIfReady={autoSeedIfReady} attendance={attendance} saveAttendance={saveAttendance} />}
          {tab === "schedule" && <ScheduleView schedule={schedule} teams={teams} players={activePlayers} matchResults={matchResults} leagueUser={effectiveUser} leagueConfig={leagueConfig} course={courseData} fetchWeekScores={fetchWeekScores} scoringRules={scoringRules} isComm={isComm} saveScore={saveScore} saveMatchResult={saveMatchResult} setPopupOpen={setPopupOpen} appToast={appToast} dataLoaded={dataLoaded} attendance={attendance} saveAttendance={saveAttendance} />}
          {tab === "players" && <PlayersView players={activePlayers} course={courseData} schedule={schedule} scoringRules={scoringRules} fetchAllScores={fetchAllScores} members={members} dataLoaded={dataLoaded} />}
          {tab === "stats" && <StatsView players={activePlayers} course={courseData} schedule={schedule} scoringRules={scoringRules} fetchSeasonScores={fetchSeasonScores} />}
          {tab === "ctp" && <CTPView ctpData={ctpData} players={activePlayers} isComm={isComm} saveCtp={saveCtp} />}
          {tab === "notifications" && <NotificationsSettings leagueUser={effectiveUser} appToast={appToast} />}
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
        <Popup onClose={() => setShowPlayerPicker(false)} maxWidth={340}>
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
        </Popup>
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
            <button key={t.id} onClick={() => { setTab(t.id); setShowMore(false); }} style={{ flex: 1, background: active ? K.acc + "10" : "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, opacity: active ? 1 : .4, transition: "all .2s", padding: "4px 0", borderRadius: 8 }}>
              <span style={{ display: "flex" }}>{I[t.icon](18, active ? K.acc : K.t2)}</span>
              <span style={{ fontSize: 9, fontWeight: active ? 600 : 400, color: active ? K.acc : K.t2 }}>{t.label}</span>
            </button>
          );
        })}
        <div style={{ flex: 1, position: "relative", display: "flex", justifyContent: "center" }}>
          <button onClick={() => setShowMore(!showMore)} style={{ width: "100%", background: showMore || moreItems.some(m => m.id === tab) ? K.acc + "10" : "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, opacity: showMore || moreItems.some(m => m.id === tab) ? 1 : .4, transition: "all .2s", padding: "4px 0", borderRadius: 8 }}>
            <span style={{ display: "flex" }}>{I.ellipsis(18, showMore || moreItems.some(m => m.id === tab) ? K.acc : K.t2)}</span>
            <span style={{ fontSize: 9, fontWeight: showMore || moreItems.some(m => m.id === tab) ? 600 : 400, color: showMore || moreItems.some(m => m.id === tab) ? K.acc : K.t2 }}>More</span>
          </button>
          {showMore && (
            <div style={{ position: "fixed", bottom: `calc(38px + env(safe-area-inset-bottom, 0px))`, right: 14, background: K.card, border: `1px solid ${K.bdr}`, borderRadius: 12, padding: "6px 0", zIndex: 300, minWidth: 180, boxShadow: "0 -4px 20px rgba(0,0,0,.4)" }}>
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
