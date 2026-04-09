import { useState, useEffect, useRef } from "react";
import { db, LF, LEAGUE_ID, _auth, _googleProvider, onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile } from "./firebase";
import { K, FONTS, CSS, I, DEFAULT_SCORING, SEASON_WEEKS, applyTheme, getCSS } from "./theme";
import { LoadingScreen, AuthScreen, JoinScreen } from "./pages/Auth";
import StandingsView from "./pages/Standings";
import LiveScoringView from "./pages/LiveScoring";
import ScheduleView from "./pages/Schedule";
import MoreView from "./pages/More";
import AdminView from "./pages/Admin";

function lastNamesOnly(teamName) {
  if (!teamName) return "";
  return teamName.split(/\s*\/\s*/).map(part => {
    const words = part.trim().split(/\s+/);
    return words.length > 1 ? words[words.length - 1] : words[0];
  }).join(" / ");
}

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
  const [tab, setTab] = useState("standings");
  const [showMore, setShowMore] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("mnq_theme") !== "light"; } catch { return true; }
  });

  // Pull-to-refresh
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStart = useRef(0);
  const pullYRef = useRef(0);
  const PULL_THRESHOLD = 80;

  const toggleTheme = () => {
    const newMode = darkMode ? "light" : "dark";
    try { localStorage.setItem("mnq_theme", newMode); } catch {}
    applyTheme(newMode);
    setDarkMode(!darkMode);
  };

  const getScrollTop = () => {
    const el = document.querySelector('.app-body');
    return el ? el.scrollTop : window.scrollY;
  };

  const refreshingRef = useRef(false);

  const onTouchStart = (e) => {
    if (getScrollTop() <= 1) touchStart.current = e.touches[0].clientY;
    else touchStart.current = 0;
  };

  const onTouchMove = (e) => {
    if (!touchStart.current || refreshingRef.current) return;
    const diff = e.touches[0].clientY - touchStart.current;
    if (diff > 0 && getScrollTop() <= 1) {
      const val = Math.min(diff * 0.4, 120);
      pullYRef.current = val;
      setPullY(val);
    } else {
      pullYRef.current = 0;
      setPullY(0);
    }
  };

  const onTouchEnd = () => {
    if (pullYRef.current >= PULL_THRESHOLD && !refreshingRef.current) {
      refreshingRef.current = true;
      setRefreshing(true);
      setPullY(PULL_THRESHOLD);
      pullYRef.current = PULL_THRESHOLD;
      setTimeout(() => window.location.reload(), 600);
    } else {
      setPullY(0);
      pullYRef.current = 0;
    }
    touchStart.current = 0;
  };

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

  if (authLoading) return <LoadingScreen />;
  if (!authUser) return <AuthScreen onGoogle={doGoogleSignIn} onEmail={doEmailSignIn} />;
  if (!membersLoaded) return <LoadingScreen />;
  if (!leagueUser || !leagueUser.playerId) return <JoinScreen authUser={authUser} members={members} players={activePlayers} saveMember={saveMember} doSignOut={doSignOut} leagueConfig={leagueConfig} />;

  const tabs = [
    { id: "standings", label: "Standings", icon: "trophy" },
    { id: "scoring", label: "Score", icon: "flag" },
    { id: "schedule", label: "Schedule", icon: "calendar" },
  ];

  const moreItems = [
    { id: "players", label: "Players", icon: "users" },
    { id: "stats", label: "Stats", icon: "barChart" },
    { id: "ctp", label: "CTP", icon: "target" },
    ...(isComm ? [{ id: "admin", label: "Admin", icon: "settings" }] : []),
  ];

  // Find upcoming match info for banner
  const myTeam = teams.find(t => t.player1 === leagueUser.playerId || t.player2 === leagueUser.playerId);
  const upcomingBanner = (() => {
    if (!myTeam || !schedule.length) return null;
    // Find current week (first week without all matches finalized)
    for (const wk of schedule) {
      const allDone = wk.matches.every(m => matchResults.some(r => r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2));
      if (!allDone) {
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
        const teeTime = `${hr}:${String(mn).padStart(2, '0')} ${ap}`;
        return { week: wk.week, date: wk.date, teeTime, teeMinutes: mins, opp: opp?.name || "TBD", side: wk.side };
      }
    }
    return null;
  })();

  // Banner green color — a traditional, noticeable green
  const bannerGrn = "#1a8c3f";

  return (
    <div className="app-shell" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
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
          <div style={{ position: "absolute", left: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={toggleTheme} style={{ background: "none", border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.t3, fontSize: 14, padding: "5px 10px", cursor: "pointer", lineHeight: 1 }} title={darkMode ? "Light mode" : "Dark mode"}>
              {darkMode ? "☀" : "🌙"}
            </button>
            {syncing && <span className="pu" style={{ fontSize: 8, color: K.grn }}>● LIVE</span>}
          </div>
          <img src="/MnQ_logo_transparent_bg.png" alt="MnQ Golf" style={{ height: 36, objectFit: "contain" }} />
          <div style={{ position: "absolute", right: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={doSignOut} style={{ background: "none", border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.t3, fontSize: 12, padding: "5px 12px", cursor: "pointer", fontWeight: 600, letterSpacing: .4 }}>Sign Out</button>
          </div>
        </div>
      </div>

      {/* Upcoming match banner */}

      <div className="app-body">
        <div style={{ maxWidth: 900, width: "100%", margin: "0 auto" }}>
          {upcomingBanner && tab !== "scoring" && (() => {
            const now = new Date();
            const nowMins = now.getHours() * 60 + now.getMinutes();
            const isLeagueDay = leagueConfig?.dayOfWeek && now.toLocaleDateString('en-US', { weekday: 'long' }) === leagueConfig.dayOfWeek;
            const isLive = isLeagueDay && nowMins >= upcomingBanner.teeMinutes - 30;
            return (
              <div style={{ background: K.card, border: `1.5px solid ${bannerGrn}`, borderRadius: 10, margin: "6px 14px", padding: "8px 14px", display: "flex", alignItems: "center" }}>
                {/* Left: Tee time + Front/Back */}
                <div style={{ width: 90, flexShrink: 0, textAlign: "center", lineHeight: 1.3, padding: "8px 0" }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: bannerGrn, letterSpacing: .5, textTransform: "uppercase" }}>{upcomingBanner.teeTime}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: bannerGrn, letterSpacing: .5, textTransform: "uppercase" }}>{upcomingBanner.side === 'front' ? 'FRONT 9' : 'BACK 9'}</div>
                </div>
                {/* Center: Date, vs, opponent */}
                <div style={{ flex: 1, textAlign: "center", lineHeight: 1.3 }}>
                  <div style={{ fontSize: 12, color: K.t2, fontWeight: 500 }}>{upcomingBanner.date ? `${upcomingBanner.date} — ` : ""}Week {upcomingBanner.week}</div>
                  <div style={{ fontSize: 9, color: K.logoBright, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>vs</div>
                  <div style={{ color: K.t1, fontWeight: 700, fontSize: 15 }}>{lastNamesOnly(upcomingBanner.opp)}</div>
                </div>
                {/* Right: Live Scoring button */}
                <div style={{ width: 90, flexShrink: 0, textAlign: "center" }}>
                  <button onClick={() => setTab("scoring")} style={{
                    background: isLive ? bannerGrn : "transparent",
                    border: `1.5px solid ${isLive ? bannerGrn : bannerGrn + "50"}`,
                    borderRadius: 8, padding: "8px 10px", cursor: "pointer",
                    color: isLive ? "#fff" : bannerGrn, fontSize: 15, fontWeight: 800,
                    textTransform: "uppercase", letterSpacing: .5, transition: "all .3s",
                    lineHeight: 1.3,
                  }}>
                    {isLive && <span style={{ fontSize: 11 }}>● </span>}Live<br/>Scoring
                  </button>
                </div>
              </div>
            );
          })()}
          <div className="main-content fi" key={tab}>
          {tab === "standings" && <StandingsView teams={teams} players={activePlayers} matchResults={matchResults} leagueConfig={leagueConfig} schedule={schedule} fetchSeasonScores={fetchSeasonScores} />}
          {tab === "scoring" && <LiveScoringView leagueUser={leagueUser} players={activePlayers} teams={teams} course={courseData} schedule={schedule} holeScores={holeScores} saveScore={saveScore} scoringRules={scoringRules} matchResults={matchResults} saveMatchResult={saveMatchResult} ctpData={ctpData} saveCtp={saveCtp} setLiveWeek={setLiveWeek} fetchWeekScores={fetchWeekScores} isComm={isComm} leagueConfig={leagueConfig} saveWeekSchedule={saveWeekSchedule} />}
          {tab === "schedule" && <ScheduleView schedule={schedule} teams={teams} players={activePlayers} matchResults={matchResults} leagueUser={leagueUser} leagueConfig={leagueConfig} />}
          {tab === "players" && <MoreView view="players" players={activePlayers} course={courseData} schedule={schedule} scoringRules={scoringRules} fetchSeasonScores={fetchSeasonScores} fetchAllScores={fetchAllScores} ctpData={ctpData} members={members} />}
          {tab === "stats" && <MoreView view="stats" players={activePlayers} course={courseData} schedule={schedule} scoringRules={scoringRules} fetchSeasonScores={fetchSeasonScores} ctpData={ctpData} members={members} />}
          {tab === "ctp" && <MoreView view="ctp" players={activePlayers} course={courseData} schedule={schedule} scoringRules={scoringRules} fetchSeasonScores={fetchSeasonScores} ctpData={ctpData} members={members} />}
          {tab === "admin" && isComm && <AdminView players={players} savePlayer={savePlayer} deletePlayer={deletePlayer} teams={teams} saveTeam={saveTeam} deleteTeam={deleteTeam} schedule={schedule} saveWeekSchedule={saveWeekSchedule} course={courseData} saveCourseData={saveCourseData} scoringRules={scoringRules} saveScoringRules={saveScoringRules} leagueConfig={leagueConfig} saveLeagueConfig={saveLeagueConfig} members={members} saveMember={saveMember} deleteMember={deleteMember} authUser={authUser} matchResults={matchResults} />}
          </div>
        </div>
      </div>

      {/* More popup menu */}
      {showMore && (
        <div onClick={() => setShowMore(false)} style={{ position: "fixed", inset: 0, zIndex: 150 }} />
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
            <div style={{ position: "absolute", bottom: "100%", right: 0, marginBottom: 8, background: K.card, border: `1px solid ${K.bdr}`, borderRadius: 12, padding: "6px 0", zIndex: 200, minWidth: 180, boxShadow: "0 -4px 20px rgba(0,0,0,.4)" }}>
              {moreItems.map(item => {
                const active = tab === item.id;
                return (
                  <button key={item.id} onClick={() => { setTab(item.id); setShowMore(false); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 16px", background: active ? K.acc + "12" : "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ display: "flex" }}>{I[item.icon](16, active ? K.acc : K.t3)}</span>
                    <span style={{ fontSize: 14, fontWeight: active ? 600 : 400, color: active ? K.acc : K.t1 }}>{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
