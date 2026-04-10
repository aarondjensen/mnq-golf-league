import { useState, useEffect, useRef, useCallback } from "react";
import { db, LF, LEAGUE_ID, _auth, _googleProvider, onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile } from "./firebase";
import { K, FONTS, CSS, I, DEFAULT_SCORING, SEASON_WEEKS, applyTheme, getCSS, lastNamesOnly } from "./theme";
import { LoadingScreen, AuthScreen, JoinScreen } from "./pages/Auth";
import StandingsView from "./pages/Standings";
import LiveScoringView from "./pages/Scoring";
import ScheduleView from "./pages/Schedule";
import PlayersView from "./pages/Players";
import StatsView from "./pages/Stats";
import CTPView from "./pages/CTP";
import AdminView from "./pages/Admin";


export default function GolfLeagueApp() {
  const [authUser, setAuthUser] = useState(undefined);
  const [leagueUser, setLeagueUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [courseData, setCourseData] = useState(null);
  const [scoringRules, setScoringRules] = useState(DEFAULT_SCORING);
  const [holeScores, setHoleScores] = useState({});
  const [ctpData, setCtpData] = useState([]);
  const [matchResults, setMatchResults] = useState([]);
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
    // Set initial hash if none
    if (!window.location.hash) window.location.hash = "standings";
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const [showMore, setShowMore] = useState(false);
  const [impersonating, setImpersonating] = useState(null);
  const [showPlayerPicker, setShowPlayerPicker] = useState(false);
  const [openAllMatches, setOpenAllMatches] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("mnq_theme") !== "light"; } catch { return true; }
  });

  // Pull-to-refresh
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const pullYRef = useRef(0);
  const pullingRef = useRef(false);
  const PULL_THRESHOLD = 80;
  const appBodyRef = useRef(null);

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

  useEffect(() => {
    if (refreshing) return;
    const getScrollEl = () => appBodyRef.current || document.querySelector('.app-body');
    const handleStart = (e) => {
      const el = getScrollEl();
      if (el && el.scrollTop <= 0) { touchStartY.current = e.touches[0].clientY; }
      else { touchStartY.current = 0; }
      pullingRef.current = false;
    };
    const handleMove = (e) => {
      if (!touchStartY.current) return;
      const el = getScrollEl();
      const diff = e.touches[0].clientY - touchStartY.current;
      if (diff > 10 && el && el.scrollTop <= 0) {
        pullingRef.current = true;
        e.preventDefault();
        const val = Math.min(diff * 0.4, 120);
        pullYRef.current = val;
        setPullY(val);
      } else if (pullingRef.current && diff <= 5) {
        pullingRef.current = false;
        pullYRef.current = 0;
        setPullY(0);
        touchStartY.current = 0;
      }
    };
    const handleEnd = () => {
      pullingRef.current = false;
      if (pullYRef.current >= PULL_THRESHOLD) {
        setPullY(PULL_THRESHOLD); pullYRef.current = PULL_THRESHOLD;
        setRefreshing(true);
        setTimeout(() => window.location.reload(), 600);
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
  }, [refreshing]);

  // Safety: if pull indicator stuck, reset after 2s
  useEffect(() => {
    if (pullY > 0 && !refreshing) {
      const safety = setTimeout(resetPull, 2000);
      return () => clearTimeout(safety);
    }
  }, [pullY, refreshing, resetPull]);

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
    unsubs.push(db.subscribe("league_course", LF, (docs) => { if (docs.length) setCourseData(docs[0]); }));
    unsubs.push(db.subscribe("league_scoring", LF, (docs) => { if (docs.length) setScoringRules(docs[0]); }));

    unsubs.push(db.subscribe("league_ctp", LF, (docs) => setCtpData(docs)));
    unsubs.push(db.subscribe("league_match_results", LF, (docs) => setMatchResults(docs)));
    unsubs.push(db.subscribe("league_config", LF, (docs) => { if (docs.length) setLeagueConfig(docs[0]); }));

    return () => unsubs.forEach(u => u && u());
  }, [authUser?.uid]);

  // Subscribe to hole scores for a specific week (real-time for live scoring)
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
    try { await signInWithEmailAndPassword(_auth, email, pw); }
    catch (e) {
      if (e.code === "auth/user-not-found") { const c = await createUserWithEmailAndPassword(_auth, email, pw); await updateProfile(c.user, { displayName: email.split("@")[0] }); }
      else throw e;
    }
  };
  const doSignOut = async () => { await signOut(_auth); setLeagueUser(null); setTab("standings"); };

  const CURRENT_SEASON = 2026;

  // Data write helpers
  const saveScore = async (week, playerId, hole, score) => {
    const id = `${LEAGUE_ID}_s${CURRENT_SEASON}_w${week}_p${playerId}_h${hole}`;
    setHoleScores(prev => ({ ...prev, [`w${week}_p${playerId}_h${hole}`]: score }));
    await db.upsert("league_hole_scores", { id, league_id: LEAGUE_ID, season: CURRENT_SEASON, week, player_id: playerId, hole, score, ts: Date.now() });
  };
  // Fetch scores for a specific week on-demand (non-realtime, one-time read)
  const fetchWeekScores = async (weekNum) => {
    const docs = await db.get("league_hole_scores", [...LF, { field: "season", op: "==", value: CURRENT_SEASON }, { field: "week", op: "==", value: weekNum }]);
    const scores = {};
    docs.forEach(r => { scores[`w${r.week}_p${r.player_id}_h${r.hole}`] = r.score; });
    return scores;
  };
  // Fetch scores for current season (for stats/handicap calc)
  const fetchSeasonScores = async () => {
    const docs = await db.get("league_hole_scores", [...LF, { field: "season", op: "==", value: CURRENT_SEASON }]);
    const scores = {};
    docs.forEach(r => { scores[`w${r.week}_p${r.player_id}_h${r.hole}`] = r.score; });
    return scores;
  };
  // Fetch ALL scores across all seasons (for handicap calc that carries over)
  const fetchAllScores = async () => {
    const docs = await db.get("league_hole_scores", LF);
    // Return grouped by player: { playerId: [{ season, week, gross }] }
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
    // Sort each player's rounds chronologically (by season then week)
    for (const pid in byPlayer) {
      byPlayer[pid].sort((a, b) => a.season !== b.season ? a.season - b.season : a.week - b.week);
    }
    return byPlayer;
  };
  const saveCtp = async (data) => await db.upsert("league_ctp", { ...data, league_id: LEAGUE_ID });
  const saveMatchResult = async (data) => await db.upsert("league_match_results", { ...data, league_id: LEAGUE_ID });
  const savePlayer = async (p) => await db.upsert("league_players", { ...p, league_id: LEAGUE_ID });
  const deletePlayer = async (id) => await db.deleteDoc("league_players", id);
  const saveTeam = async (t) => await db.upsert("league_teams", { ...t, league_id: LEAGUE_ID });
  const deleteTeam = async (id) => await db.deleteDoc("league_teams", id);
  const saveWeekSchedule = async (w) => await db.upsert("league_schedule", { ...w, league_id: LEAGUE_ID });
  const saveCourseData = async (c) => await db.upsert("league_course", { ...c, id: `${LEAGUE_ID}_course`, league_id: LEAGUE_ID });
  const saveScoringRules = async (s) => await db.upsert("league_scoring", { ...s, id: `${LEAGUE_ID}_scoring`, league_id: LEAGUE_ID });
  const saveLeagueConfig = async (c) => await db.upsert("league_config", { ...c, id: `${LEAGUE_ID}_config`, league_id: LEAGUE_ID });
  const saveMember = async (m) => await db.upsert("league_members", { ...m, league_id: LEAGUE_ID });
  const deleteMember = async (id) => await db.deleteDoc("league_members", id);

  const isComm = leagueUser?.isCommissioner === true;
  const activePlayers = players.filter(p => p.status !== "inactive");

  // When commissioner impersonates a player, effectiveUser overrides leagueUser for scoring/schedule
  const effectiveUser = impersonating
    ? { ...leagueUser, playerId: impersonating.playerId, name: impersonating.name }
    : leagueUser;

  if (authLoading) return <LoadingScreen />;
  if (!authUser) return <AuthScreen onGoogle={doGoogleSignIn} onEmail={doEmailSignIn} />;
  if (!membersLoaded) return <LoadingScreen />;
  if (!leagueUser || !leagueUser.playerId) return <JoinScreen authUser={authUser} members={members} players={activePlayers} saveMember={saveMember} doSignOut={doSignOut} leagueConfig={leagueConfig} />;

  const tabs = [
    { id: "standings", label: "Standings", icon: "trophy" },
    { id: "scoring", label: "Scoring", icon: "flag" },
    { id: "schedule", label: "Schedule", icon: "calendar" },
  ];

  const moreItems = [
    { id: "players", label: "Players", icon: "users" },
    { id: "stats", label: "Stats", icon: "barChart" },
    { id: "ctp", label: "CTP", icon: "target" },
    ...(isComm ? [{ id: "admin", label: "Admin", icon: "settings" }] : []),
    { id: "signout", label: "Sign Out", icon: "key" },
  ];

  // Check if there's a week ready to finalize (commish only)
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

  // Find upcoming match info for banner
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
      const base = leagueConfig?.startTime || "4:28 PM";
      const interval = leagueConfig?.teeInterval || 8;
      const [timePart, ampm] = base.split(' ');
      const [h, m] = timePart.split(':').map(Number);
      let mins = (ampm === 'PM' && h !== 12 ? h + 12 : h) * 60 + m + matchIdx * interval;
      const hr = Math.floor(mins / 60) % 12 || 12;
      const mn = mins % 60;
      const ap = Math.floor(mins / 60) >= 12 ? 'PM' : 'AM';
      const teeTime = `${hr}:${String(mn).padStart(2, '0')}`;
      // Get opponent player names
      const oppP1 = opp ? activePlayers.find(p => p.id === opp.player1) : null;
      const oppP2 = opp ? activePlayers.find(p => p.id === opp.player2) : null;
      const oppName1 = oppP1 ? oppP1.name.split(' ').pop() : "TBD";
      const oppName2 = oppP2 ? oppP2.name.split(' ').pop() : "TBD";
      return { week: wk.week, date: wk.date, teeTime, teeMinutes: mins, opp: opp?.name || "TBD", oppName1, oppName2, side: wk.side };
    }
    return null;
  })();

  // Banner green color — theme-aware
  const bannerGrn = K.matchGrn;

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
      <link href={FONTS} rel="stylesheet" /><style>{getCSS(K)}</style>

      {/* Header */}
      <div className="app-header">
        <div style={{ maxWidth: 900, width: "100%", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "0 14px" }}>
          {/* Left: LIVE dot + Commissioner Switch Player */}
          <div style={{ position: "absolute", left: 14, display: "flex", alignItems: "center", gap: 6 }}>
            {isComm && (
              <button onClick={() => setShowPlayerPicker(true)} style={{ background: impersonating ? K.teal + "15" : "none", border: `1px solid ${impersonating ? K.teal + "40" : K.bdr}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ textAlign: "left", lineHeight: 1.2 }}>
                  <div style={{ fontSize: 11, color: impersonating ? K.teal : K.t3, fontWeight: 600 }}>Switch</div>
                  <div style={{ fontSize: 11, color: impersonating ? K.teal : K.t3, fontWeight: 700 }}>Player</div>
                </div>
                <span style={{ fontSize: 10, color: K.t3 }}>▾</span>
              </button>
            )}
          </div>
          <img src="/MnQ_logo_transparent_bg.png" alt="MnQ Golf" style={{ height: 36, objectFit: "contain" }} />
          {/* Right: Live Scoring button */}
          <div style={{ position: "absolute", right: 14, display: "flex", alignItems: "center" }}>
            <button onClick={() => setTab("scoring")} style={{
              background: tab === "scoring" ? bannerGrn : "transparent",
              border: `1.5px solid ${tab === "scoring" ? bannerGrn : bannerGrn + "50"}`,
              borderRadius: 8, padding: "6px 10px", cursor: "pointer",
              color: tab === "scoring" ? "#fff" : bannerGrn, fontSize: 13, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: .5, lineHeight: 1.3,
            }}>
              Live<br/>Scoring
            </button>
          </div>
        </div>
      </div>

      {/* Finalize week banner — commish only */}
      {weekToFinalize && (
        <button onClick={() => { setOpenAllMatches(true); setTab("scoring"); }} style={{
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

      {/* Upcoming match banner */}

      <div className="app-body" ref={appBodyRef}>
        <div style={{ maxWidth: 900, width: "100%", margin: "0 auto" }}>
          {upcomingBanner && tab !== "scoring" && (() => {
            return (
              <div style={{ background: K.card, border: `1.5px solid ${bannerGrn}`, borderRadius: 10, margin: "6px 14px", padding: "10px 16px", display: "flex", alignItems: "center" }}>
                {/* Left: Tee time + Front/Back */}
                <div style={{ width: 80, flexShrink: 0, textAlign: "left", lineHeight: 1.3, padding: "6px 0" }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: K.act, letterSpacing: .5 }}>{upcomingBanner.teeTime}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#3b82f6", letterSpacing: .5, textTransform: "uppercase" }}>{upcomingBanner.side === 'front' ? 'FRONT 9' : 'BACK 9'}</div>
                </div>
                {/* Center: Date + Week */}
                <div style={{ flex: 1, textAlign: "center", lineHeight: 1.3 }}>
                  <div style={{ fontSize: 12, color: K.t2, fontWeight: 500 }}>{upcomingBanner.date || ""}</div>
                  <div style={{ fontSize: 14, color: K.t1, fontWeight: 700 }}>Week {upcomingBanner.week}</div>
                </div>
                {/* Right: Opponent player names */}
                <div style={{ width: 80, flexShrink: 0, textAlign: "right", lineHeight: 1.3 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: K.t1 }}>{upcomingBanner.oppName1}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: K.t1 }}>{upcomingBanner.oppName2}</div>
                </div>
              </div>
            );
          })()}
          <div className="main-content fi" key={tab}>
          {tab === "standings" && <StandingsView teams={teams} players={activePlayers} matchResults={matchResults} leagueConfig={leagueConfig} schedule={schedule} fetchSeasonScores={fetchSeasonScores} />}
          {tab === "scoring" && <LiveScoringView leagueUser={effectiveUser} players={activePlayers} teams={teams} course={courseData} schedule={schedule} holeScores={holeScores} saveScore={saveScore} scoringRules={scoringRules} matchResults={matchResults} saveMatchResult={saveMatchResult} ctpData={ctpData} saveCtp={saveCtp} setLiveWeek={setLiveWeek} fetchWeekScores={fetchWeekScores} isComm={isComm} leagueConfig={leagueConfig} saveWeekSchedule={saveWeekSchedule} openAllMatches={openAllMatches} onAllMatchesOpened={() => setOpenAllMatches(false)} />}
          {tab === "schedule" && <ScheduleView schedule={schedule} teams={teams} players={activePlayers} matchResults={matchResults} leagueUser={effectiveUser} leagueConfig={leagueConfig} />}
          {tab === "players" && <PlayersView players={activePlayers} course={courseData} schedule={schedule} scoringRules={scoringRules} fetchAllScores={fetchAllScores} members={members} />}
          {tab === "stats" && <StatsView players={activePlayers} course={courseData} schedule={schedule} scoringRules={scoringRules} fetchSeasonScores={fetchSeasonScores} />}
          {tab === "ctp" && <CTPView ctpData={ctpData} players={activePlayers} />}
          {tab === "admin" && isComm && <AdminView players={players} savePlayer={savePlayer} deletePlayer={deletePlayer} teams={teams} saveTeam={saveTeam} deleteTeam={deleteTeam} schedule={schedule} saveWeekSchedule={saveWeekSchedule} course={courseData} saveCourseData={saveCourseData} scoringRules={scoringRules} saveScoringRules={saveScoringRules} leagueConfig={leagueConfig} saveLeagueConfig={saveLeagueConfig} members={members} saveMember={saveMember} deleteMember={deleteMember} authUser={authUser} matchResults={matchResults} />}
          </div>
        </div>
      </div>

      {/* More popup menu */}
      {showMore && (
        <div onClick={() => setShowMore(false)} style={{ position: "fixed", inset: 0, zIndex: 150 }} />
      )}

      {/* Player picker popup (commissioner) */}
      {showPlayerPicker && (
        <>
          <div onClick={() => setShowPlayerPicker(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 400 }} />
          <div onClick={() => setShowPlayerPicker(false)} style={{ position: "fixed", inset: 0, zIndex: 450, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: K.bg, border: `1px solid ${K.bdr}`, borderRadius: 14, padding: "16px", width: "100%", maxWidth: 340, maxHeight: "70vh", overflowY: "auto" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: K.t1, marginBottom: 12, textAlign: "center" }}>Switch Player</div>
              {impersonating && (
                <button onClick={() => { setImpersonating(null); setShowPlayerPicker(false); }} style={{ width: "100%", padding: "10px 14px", marginBottom: 8, borderRadius: 8, background: K.teal + "15", border: `1px solid ${K.teal}40`, color: K.teal, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  Back to My Account
                </button>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {activePlayers.map(p => {
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

      {/* Impersonation banner */}
      {impersonating && (
        <div style={{ background: K.teal + "20", borderTop: `1px solid ${K.teal}40`, padding: "6px 14px", display: "flex", justifyContent: "center", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: K.teal, fontWeight: 600 }}>Playing as {impersonating.name}</span>
          <button onClick={() => setImpersonating(null)} style={{ background: "none", border: `1px solid ${K.teal}40`, borderRadius: 4, color: K.teal, fontSize: 10, padding: "2px 8px", cursor: "pointer", fontWeight: 600 }}>Exit</button>
        </div>
      )}

      {/* Bottom Nav */}
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
              {moreItems.map((item, idx) => {
                const active = tab === item.id;
                const isSignOut = item.id === "signout";
                return (
                  <div key={item.id}>
                    {isSignOut && (<>
                      {/* Dark mode toggle */}
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
