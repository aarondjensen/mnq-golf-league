import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { db, LF, LEAGUE_ID, _auth, _googleProvider, onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile } from "./firebase";
import { K, I, DEFAULT_SCORING, SEASON_WEEKS, applyTheme, getCSS, lastNamesOnly } from "./theme";
import { LoadingScreen, AuthScreen, JoinScreen } from "./pages/Auth";

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
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Theme management
  const [theme, setTheme] = useState(() => {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("theme");
      return stored === "dark" ? "dark" : "light";
    }
    return "light";
  });

  useEffect(() => {
    applyTheme(theme);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("theme", theme);
    }
  }, [theme]);

  // Menu and popup state
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth => {
      setAuthUser(auth);
      setAuthLoading(false);
    });
    return () => unsub?.();
  }, []);

  // Data subscriptions
  useEffect(() => {
    if (!authUser?.uid) return;

    const unsubs = [];

    unsubs.push(db.subscribe("league_members", LF, (docs) => {
      setMembers(docs.map(d => ({
        ...d,
        id: d.id || `${d.userId}_${d.playerId}`,
        userId: d.userId || d.user_id,
        playerId: d.playerId || d.player_id,
      })));
      setMembersLoaded(true);
    }));

    unsubs.push(db.subscribe("league_players", LF, (docs) => setPlayers(docs)));
    unsubs.push(db.subscribe("league_teams", LF, (docs) => setTeams(docs)));
    unsubs.push(db.subscribe("league_schedule", LF, (docs) => setSchedule(docs.filter(d => d.week > 0).sort((a, b) => a.week - b.week))));
    unsubs.push(db.subscribe("league_match_results", LF, (docs) => setMatchResults(docs)));
    unsubs.push(db.subscribe("league_ctp", LF, (docs) => setCtpData(docs)));

    // Subscribe to league_config for real-time updates during schedule setup
    unsubs.push(db.subscribe("league_config", LF, (docs) => {
      if (docs.length) setLeagueConfig(docs[0]);
    }));

    // These change less frequently — one-time reads
    db.get("league_course", LF).then(docs => { if (docs.length) setCourseData(docs[0]); });
    db.get("league_scoring", LF).then(docs => { if (docs.length) setScoringRules(docs[0]); });

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

  // League member computation
  const leagueMembers = useMemo(() => {
    if (!authUser?.uid || !members?.length || !players?.length) return [];
    return members.map(member => ({
      ...member,
      player: players.find(p => p.id === member.playerId),
    })).filter(m => m.player);
  }, [authUser?.uid, members, players]);

  const isComm = leagueUser?.isCommissioner === true;

  // Find user's league membership
  useEffect(() => {
    if (!authUser?.uid || !leagueMembers.length) return;
    const member = leagueMembers.find(m => m.userId === authUser.uid);
    if (member && member.player) {
      setLeagueUser({ ...member, name: member.player.name });
    } else {
      setLeagueUser(null);
    }
  }, [authUser?.uid, leagueMembers]);

  // Sync mutations
  const savePlayer = useCallback(async (p) => {
    const data = { ...p, league_id: LEAGUE_ID };
    await db.upsert("league_players", data);
  }, []);

  const deletePlayer = useCallback(async (id) => await db.deleteDoc("league_players", id), []);

  const saveTeam = useCallback(async (t) => {
    const data = { ...t, league_id: LEAGUE_ID };
    await db.upsert("league_teams", data);
  }, []);

  const deleteTeam = useCallback(async (id) => await db.deleteDoc("league_teams", id), []);

  const saveWeekSchedule = useCallback(async (w) => {
    const data = { ...w, league_id: LEAGUE_ID };
    await db.upsert("league_schedule", data);
  }, []);

  const setWeekSchedule = useCallback(async (w) => {
    const data = { ...w, league_id: LEAGUE_ID };
    await db.set("league_schedule", data);
  }, []);

  const deleteWeekSchedule = useCallback(async (id) => await db.deleteDoc("league_schedule", id), []);

  const saveMatchResult = useCallback(async (r) => {
    const data = { ...r, league_id: LEAGUE_ID, season: CURRENT_SEASON };
    await db.upsert("league_match_results", data);
  }, []);

  const deleteMatchResult = useCallback(async (id) => await db.deleteDoc("league_match_results", id), []);

  const saveCtp = useCallback(async (c) => {
    const data = { ...c, league_id: LEAGUE_ID, season: CURRENT_SEASON };
    await db.upsert("league_ctp", data);
  }, []);

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
    const data = { ...c, id: `${LEAGUE_ID}_config`, league_id: LEAGUE_ID };
    await db.upsert("league_config", data);
    setLeagueConfig(data);
  }, []);

  // Patch league config (for narrow field updates - prevents stale closure bugs)
  const patchLeagueConfig = useCallback(async (patch) => {
    await db.upsert("league_config", { id: `${LEAGUE_ID}_config`, league_id: LEAGUE_ID, ...patch });
    setLeagueConfig(prev => ({ ...prev, ...patch }));
  }, []);

  const saveMember = useCallback(async (m) => await db.upsert("league_members", { ...m, league_id: LEAGUE_ID }), []);
  const deleteMember = useCallback(async (id) => await db.deleteDoc("league_members", id), []);

  const activePlayers = useMemo(() => players.filter(p => p.status !== "inactive"), [players]);

  const saveScore = useCallback(async (playerId, week, hole, score) => {
    const id = `${LEAGUE_ID}_${playerId}_${week}_${hole}`;
    const data = { id, league_id: LEAGUE_ID, season: CURRENT_SEASON, player_id: playerId, week, hole, score };
    await db.upsert("league_hole_scores", data);
  }, []);

  const fetchWeekScores = useCallback(async (week) => {
    if (!week) return {};
    const filters = [...LF, { field: "season", op: "==", value: CURRENT_SEASON }, { field: "week", op: "==", value: week }];
    const docs = await db.get("league_hole_scores", filters);
    const scores = {};
    docs.forEach(d => {
      const key = `w${d.week}_p${d.player_id}_h${d.hole}`;
      scores[key] = d.score;
    });
    return scores;
  }, []);

  const fetchSeasonScores = useCallback(async () => {
    const filters = [...LF, { field: "season", op: "==", value: CURRENT_SEASON }];
    const docs = await db.get("league_hole_scores", filters);
    const scores = {};
    docs.forEach(d => {
      const key = `w${d.week}_p${d.player_id}_h${d.hole}`;
      scores[key] = d.score;
    });
    return scores;
  }, []);

  const resetSeasonData = useCallback(async () => {
    if (!window.confirm("This will delete ALL scores, match results, and CTP data for the current season. This cannot be undone. Are you sure?")) return false;
    try {
      const season = CURRENT_SEASON;
      const filters = [...LF, { field: "season", op: "==", value: season }];
      await Promise.all([
        db.batchDelete("league_hole_scores", filters),
        db.batchDelete("league_match_results", filters),
        db.batchDelete("league_ctp", filters),
      ]);
      setHoleScores({});
      setMatchResults([]);
      setCtpData([]);
      return true;
    } catch (e) {
      console.error("Reset failed:", e);
      alert("Reset failed. Check console for details.");
      return false;
    }
  }, []);

  const importHistoricalScores = useCallback(async (scoreData) => {
    try {
      const scores = Array.isArray(scoreData) ? scoreData : JSON.parse(scoreData);
      for (const score of scores) {
        const id = `${LEAGUE_ID}_${score.player_id}_${score.week}_${score.hole}`;
        const data = { ...score, id, league_id: LEAGUE_ID };
        await db.upsert("league_hole_scores", data);
      }
      return { success: true, count: scores.length };
    } catch (e) {
      console.error("Import failed:", e);
      return { success: false, error: e.message };
    }
  }, []);

  const recalcHandicaps = useCallback(async () => {
    if (!courseData?.holes?.length || !activePlayers.length) {
      alert("Missing course data or players");
      return false;
    }
    try {
      const allScores = await fetchSeasonScores();
      const updates = [];
      for (const player of activePlayers) {
        const playerScores = [];
        for (let week = 1; week <= 20; week++) {
          const weekScores = [];
          for (let hole = 1; hole <= 9; hole++) {
            const score = allScores[`w${week}_p${player.id}_h${hole}`];
            if (typeof score === 'number') weekScores.push(score);
          }
          if (weekScores.length === 9) {
            const total = weekScores.reduce((sum, s) => sum + s, 0);
            playerScores.push(total);
          }
        }
        if (playerScores.length >= 3) {
          const sorted = [...playerScores].sort((a, b) => a - b);
          const best3 = sorted.slice(0, 3);
          const avg = best3.reduce((sum, s) => sum + s, 0) / 3;
          const coursePar = courseData.holes.reduce((sum, h) => sum + (h.par || 4), 0);
          const newIndex = Math.max(0, avg - coursePar);
          if (Math.abs(newIndex - (player.handicapIndex || 0)) > 0.1) {
            updates.push({ ...player, handicapIndex: Math.round(newIndex * 10) / 10 });
          }
        }
      }
      for (const update of updates) {
        await savePlayer(update);
      }
      return { success: true, updated: updates.length };
    } catch (e) {
      console.error("Recalc failed:", e);
      return { success: false, error: e.message };
    }
  }, [courseData, activePlayers, savePlayer, fetchSeasonScores]);

  // UI State
  const [commMode, setCommMode] = useState(false);
  const [impersonating, setImpersonating] = useState(null);

  // Clear impersonation when commish mode is turned off
  useEffect(() => { if (!commMode) setImpersonating(null); }, [commMode]);

  const effectiveUser = impersonating || leagueUser;

  if (authLoading) return <LoadingScreen />;
  if (!authUser) return <AuthScreen onGoogleSignIn={doGoogleSignIn} onEmailSignIn={doEmailSignIn} />;
  if (!leagueUser) return <JoinScreen authUser={authUser} members={members} players={activePlayers} saveMember={saveMember} doSignOut={doSignOut} leagueConfig={leagueConfig} />;

  const teamIds = teams.map(t => t.id);

  const tabData = [
    { id: "standings", label: "Standings", icon: "trophy" },
    { id: "scoring", label: "Live", icon: "target" },
    { id: "schedule", label: "Schedule", icon: "calendar" },
    { id: "players", label: "Players", icon: "users" },
    { id: "stats", label: "Stats", icon: "barChart3" },
    { id: "ctp", label: "CTP", icon: "crosshair" },
    ...(isComm ? [{ id: "admin", label: "Admin", icon: "settings" }] : [])
  ];

  return (
    <div style={getCSS()}>
      <div className="app">
        {/* Header */}
        <div className="header">
          <div className="nav-bar">
            <div className="nav-left">
              <button onClick={() => setTheme(theme === "light" ? "dark" : "light")} style={{ background: "none", border: "none", color: K.t2, cursor: "pointer", fontSize: 16, padding: "8px 12px" }}>
                {theme === "light" ? "🌙" : "☀️"}
              </button>
              <div style={{ fontSize: 18, fontWeight: 800, color: K.logoBright }}>MnQ</div>
              {syncing && <div style={{ fontSize: 10, color: K.acc, fontWeight: 600, marginLeft: 8 }}>Syncing...</div>}
            </div>
            <div className="nav-right">
              <button onClick={() => setMenuOpen(!menuOpen)} style={{ background: "none", border: "none", color: K.t2, cursor: "pointer", fontSize: 20, padding: "8px 12px", position: "relative" }}>
                {menuOpen ? "✕" : "☰"}
              </button>
              {menuOpen && (
                <div ref={menuRef} style={{
                  position: "absolute", top: "100%", right: 0, minWidth: 200, background: K.card, borderRadius: 8,
                  border: `1px solid ${K.bdr}`, boxShadow: `0 4px 12px ${K.bdr}40`, zIndex: 1000, marginTop: 4
                }}>
                  <div style={{ padding: "12px 16px", borderBottom: `1px solid ${K.bdr}` }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: K.t1 }}>{authUser.displayName || "User"}</div>
                    <div style={{ fontSize: 11, color: K.t3 }}>{authUser.email}</div>
                  </div>
                  {isComm && (
                    <div style={{ padding: "8px 0", borderBottom: `1px solid ${K.bdr}` }}>
                      <button onClick={() => setCommMode(!commMode)} style={{
                        width: "100%", padding: "8px 16px", border: "none", background: "transparent",
                        color: K.t2, fontSize: 12, textAlign: "left", cursor: "pointer"
                      }}>
                        {commMode ? "Exit" : "Enter"} Commissioner Mode
                      </button>
                      {commMode && activePlayers.length > 0 && (
                        <div style={{ paddingLeft: 16, paddingRight: 16, marginTop: 4 }}>
                          <select value={impersonating?.playerId || ""} onChange={e => {
                            const playerId = e.target.value;
                            if (!playerId) { setImpersonating(null); return; }
                            const player = activePlayers.find(p => p.id === playerId);
                            const member = leagueMembers.find(m => m.playerId === playerId);
                            if (player && member) setImpersonating({ ...member, player, name: player.name });
                          }} style={{
                            width: "100%", padding: "4px 8px", borderRadius: 4, background: K.inp,
                            border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 11
                          }}>
                            <option value="">Play as myself</option>
                            {activePlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ padding: "8px 0" }}>
                    <button onClick={doSignOut} style={{
                      width: "100%", padding: "8px 16px", border: "none", background: "transparent",
                      color: K.red, fontSize: 12, textAlign: "left", cursor: "pointer"
                    }}>
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tab Bar */}
          <div className="tab-bar">
            {tabData.map(t => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setMenuOpen(false); }}
                style={{
                  flex: 1, padding: "12px 8px", border: "none", background: tab === t.id ? K.act : "transparent",
                  color: tab === t.id ? K.bg : K.t2, fontSize: 11, fontWeight: 700, cursor: "pointer",
                  borderRadius: "6px", transition: "all .15s", textTransform: "uppercase", letterSpacing: ".8px",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6
                }}
              >
                {I[t.icon](14)} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="content" style={{ padding: "16px", paddingBottom: commMode ? 60 : 16 }}>
          <Suspense fallback={<div style={{ textAlign: "center", padding: "20px", color: K.t3 }}>Loading...</div>}>
            {tab === "standings" && <StandingsView teams={teams} players={activePlayers} matchResults={matchResults} leagueConfig={leagueConfig} schedule={schedule} fetchSeasonScores={fetchSeasonScores} course={courseData} fetchWeekScores={fetchWeekScores} />}
            {tab === "players" && <PlayersView players={activePlayers} teams={teams} matchResults={matchResults} course={courseData} fetchSeasonScores={fetchSeasonScores} leagueConfig={leagueConfig} />}
            {tab === "stats" && <StatsView players={activePlayers} teams={teams} matchResults={matchResults} course={courseData} fetchSeasonScores={fetchSeasonScores} schedule={schedule} leagueConfig={leagueConfig} />}
            {tab === "ctp" && <CTPView ctpData={ctpData} players={activePlayers} isComm={isComm} saveCtp={saveCtp} />}
            {tab === "scoring" && <LiveScoringView leagueUser={effectiveUser} players={activePlayers} teams={teams} course={courseData} schedule={schedule} holeScores={holeScores} saveScore={saveScore} scoringRules={scoringRules} matchResults={matchResults} saveMatchResult={saveMatchResult} deleteMatchResult={deleteMatchResult} ctpData={ctpData} saveCtp={saveCtp} setLiveWeek={setLiveWeek} fetchWeekScores={fetchWeekScores} isComm={isComm} leagueConfig={leagueConfig} saveWeekSchedule={saveWeekSchedule} setWeekSchedule={setWeekSchedule} deleteWeekSchedule={deleteWeekSchedule} />}
            {tab === "schedule" && <ScheduleView schedule={schedule} teams={teams} players={activePlayers} matchResults={matchResults} leagueUser={effectiveUser} leagueConfig={leagueConfig} course={courseData} fetchWeekScores={fetchWeekScores} scoringRules={scoringRules} isComm={isComm} saveScore={saveScore} saveMatchResult={saveMatchResult} />}
            {tab === "admin" && isComm && <AdminView players={players} savePlayer={savePlayer} deletePlayer={deletePlayer} teams={teams} saveTeam={saveTeam} deleteTeam={deleteTeam} schedule={schedule} saveWeekSchedule={saveWeekSchedule} setWeekSchedule={setWeekSchedule} deleteWeekSchedule={deleteWeekSchedule} course={courseData} saveCourseData={saveCourseData} scoringRules={scoringRules} saveScoringRules={saveScoringRules} leagueConfig={leagueConfig} saveLeagueConfig={saveLeagueConfig} patchLeagueConfig={patchLeagueConfig} members={members} saveMember={saveMember} deleteMember={deleteMember} authUser={authUser} matchResults={matchResults} resetSeasonData={resetSeasonData} importHistoricalScores={importHistoricalScores} recalcHandicaps={recalcHandicaps} />}
          </Suspense>
          {commMode && <div style={{ height: 44 }} />}
          </div>
        </div>

        {/* Commissioner mode indicator */}
        {commMode && (
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0, height: 44,
            background: K.warn, color: K.bg, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, letterSpacing: 1, zIndex: 999
          }}>
            COMMISSIONER MODE {impersonating && `— Playing as ${impersonating.name}`}
          </div>
        )}

        {/* Click outside handler */}
        {menuOpen && <div style={{ position: "fixed", inset: 0, zIndex: 900 }} onClick={() => setMenuOpen(false)} />}
      </div>
    </div>
  );
}
