import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, setDoc, getDocs, query, where, writeBatch, onSnapshot, deleteDoc } from "firebase/firestore";
import { getAuth, signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile } from "firebase/auth";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ══════════════════════════════════════════════════════════════
//  FIREBASE CONFIG — Replace with your project's config
// ══════════════════════════════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDW3tTWxOlrPoKiflmlh_6JPLe8vbvVEUE",
  authDomain: "mnq-golf-leage.firebaseapp.com",
  projectId: "mnq-golf-leage",
  storageBucket: "mnq-golf-leage.firebasestorage.app",
  messagingSenderId: "367374056990",
  appId: "1:367374056990:web:70133948f9b2760558780f",
};

const LEAGUE_ID = "league_2026";

const _app = initializeApp(FIREBASE_CONFIG);
const _db = getFirestore(_app);
const _auth = getAuth(_app);
const _googleProvider = new GoogleAuthProvider();

// ══════════════════════════════════════════════════════════════
//  FIRESTORE DATA LAYER
// ══════════════════════════════════════════════════════════════
const db = {
  _q: (col, filters = []) => {
    const ref = collection(_db, col);
    return filters.length ? query(ref, ...filters.map(f => where(f.field, f.op, f.value))) : ref;
  },
  get: async (col, filters = []) => {
    try {
      const snap = await getDocs(db._q(col, filters));
      return snap.docs.map(d => d.data());
    } catch (e) { console.error("db.get error:", col, e); return []; }
  },
  upsert: async (col, data) => {
    if (!data.id) { console.error("db.upsert: missing id", col, data); return null; }
    try {
      await setDoc(doc(_db, col, String(data.id)), data, { merge: true });
      return data;
    } catch (e) { console.error("db.upsert error:", col, e); return null; }
  },
  deleteDoc: async (col, id) => {
    try { await deleteDoc(doc(_db, col, String(id))); return true; }
    catch (e) { console.error("db.deleteDoc error:", col, e); return null; }
  },
  batchDelete: async (col, filters = []) => {
    try {
      const snap = await getDocs(db._q(col, filters));
      if (snap.empty) return true;
      for (let i = 0; i < snap.docs.length; i += 490) {
        const batch = writeBatch(_db);
        snap.docs.slice(i, i + 490).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      return true;
    } catch (e) { console.error("db.batchDelete error:", col, e); return null; }
  },
  subscribe: (col, filters = [], callback) => {
    try {
      return onSnapshot(
        db._q(col, filters),
        snap => callback(snap.docs.map(d => d.data()), snap.docChanges()),
        err => console.error("db.subscribe error:", col, err)
      );
    } catch (e) { console.error("db.subscribe setup error:", col, e); return () => {}; }
  },
};

const LF = [{ field: "league_id", op: "==", value: LEAGUE_ID }];

// ══════════════════════════════════════════════════════════════
//  CONSTANTS & UTILITIES
// ══════════════════════════════════════════════════════════════
const SEASON_WEEKS = 16;
const REGULAR_WEEKS = 14;
const TEAMS_COUNT = 10;
const TEE_INTERVAL = 8;

const DEFAULT_SCORING = {
  matchWin: 3, matchTie: 1.5, matchLoss: 0,
  totalNetBonusWin: 3, totalNetBonusTie: 1.5, totalNetBonusLoss: 0,
  playoffMatchWin: 5, playoffMatchTie: 2.5, playoffMatchLoss: 0,
  playoffBonusWin: 3, playoffBonusTie: 1.5, playoffBonusLoss: 0,
};

function calcCourseHandicap(index, slope, rating, par) {
  if (!slope || !rating) return Math.round(index);
  return Math.round((index * slope / 113) + (rating - par));
}
function calcNineHandicap(ch) { return Math.round(ch / 2); }
function getTeeTime(idx) {
  const d = new Date(2026, 0, 1, 16, 28);
  d.setMinutes(d.getMinutes() + idx * TEE_INTERVAL);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function getWeekSide(weekNum) { return weekNum % 2 === 1 ? 'front' : 'back'; }
function calcDifferential(gross, rating, slope) { return (113 / slope) * (gross - rating); }
function calcHandicapIndex(diffs) {
  if (!diffs.length) return null;
  const s = [...diffs].sort((a, b) => a - b);
  const ct = s.length <= 3 ? 1 : s.length <= 5 ? 2 : s.length <= 8 ? 3 : s.length <= 11 ? 4 : s.length <= 14 ? 5 : s.length <= 16 ? 6 : s.length <= 18 ? 7 : 8;
  return Math.round(s.slice(0, ct).reduce((a, b) => a + b, 0) / ct * 10) / 10;
}

// ══════════════════════════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════════════════════════
const K = {
  bg: "#0b1829", card: "#111f36", cardHi: "#182d4a", inp: "#0d1e35",
  bdr: "#1e3a5f", acc: "#c8cfd8", accDim: "#8b95a3",
  act: "#d4a017", actHov: "#c2900f",
  grn: "#34d399", grnDim: "#059669", red: "#f87171",
  warn: "#fbbf24", t1: "#f1f5f9", t2: "#94a3b8", t3: "#475569",
  gold: "#fbbf24", silver: "#94a3b8", bronze: "#d97706",
};

const FONTS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700&family=IBM+Plex+Sans+Condensed:wght@600;700&display=swap";

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body { overscroll-behavior: none; background: ${K.bg}; }
  input, select, textarea, button { font-family: 'IBM Plex Sans', sans-serif; }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: ${K.bdr}; border-radius: 4px; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
  .fi { animation: fadeIn .35s ease both; }
  .pu { animation: pulse 1.8s ease-in-out infinite; }
  input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
  input[type=number] { -moz-appearance: textfield; }
  .app-shell { min-height: 100vh; background: ${K.bg}; color: ${K.t1}; font-family: 'IBM Plex Sans', sans-serif; display: flex; flex-direction: column; }
  .app-header { padding: 14px 24px 10px; background: linear-gradient(135deg, ${K.card}, ${K.bg}); border-bottom: 1px solid ${K.bdr}; display: flex; justify-content: space-between; align-items: center; }
  .app-body { display: flex; flex: 1; }
  .sidebar { display: none; }
  .main-content { flex: 1; padding: 12px 14px; padding-bottom: 74px; max-width: 100%; }
  .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; background: ${K.card}f0; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-top: 1px solid ${K.bdr}; display: flex; justify-content: space-around; padding: 6px 0 12px; z-index: 100; }
  .admin-grid { display: flex; flex-direction: column; gap: 6px; }
  .admin-sections-grid { display: flex; flex-direction: column; gap: 6px; }
  .players-grid { display: flex; flex-direction: column; gap: 4px; }
  .scoring-grid { display: flex; flex-direction: column; gap: 10px; }
  .schedule-weeks { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 12px; }
  .standings-grid { display: flex; flex-direction: column; gap: 6px; }
  @media (min-width: 768px) {
    .sidebar { display: flex; flex-direction: column; width: 200px; min-width: 200px; background: ${K.card}; border-right: 1px solid ${K.bdr}; padding: 16px 0; gap: 2px; }
    .bottom-nav { display: none; }
    .main-content { padding: 24px 32px; padding-bottom: 24px; max-width: 1100px; }
    .admin-sections-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .players-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .scoring-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .schedule-weeks { gap: 4px; }
    .standings-grid { max-width: 700px; }
  }
  @media (min-width: 1100px) {
    .sidebar { width: 220px; min-width: 220px; }
    .main-content { padding: 28px 40px; }
    .admin-sections-grid { grid-template-columns: repeat(3, 1fr); }
    .players-grid { display: grid; grid-template-columns: repeat(3, 1fr); }
  }
`;

// ── SVG Icons (Lucide-style, stroke-based) ──
const I = {
  trophy: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>,
  flag: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>,
  calendar: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>,
  barChart: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>,
  target: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  settings: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>,
  user: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  users: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  mapPin: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>,
  ruler: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>,
  key: (s = 18, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.3 9.3"/><path d="M18.5 5.5 21 3"/></svg>,
  arrowLeft: (s = 14, c = "currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>,
};

// ── Shared small components ──
const Pill = ({ children, color = K.acc, style, ...rest }) => (
  <span style={{ fontSize: 10, fontWeight: 600, color, background: color + "14", padding: "2px 7px", borderRadius: 4, letterSpacing: .5, textTransform: "uppercase", ...style }} {...rest}>{children}</span>
);
const BackBtn = ({ onClick }) => (
  <button onClick={onClick} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.t2, fontSize: 12, padding: "6px 12px", cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>{I.arrowLeft(12, K.t2)} Back</button>
);
const SaveBtn = ({ onClick, label = "Save" }) => (
  <button onClick={onClick} style={{ background: K.act, border: "none", borderRadius: 6, color: K.bg, fontSize: 12, padding: "6px 14px", cursor: "pointer", fontWeight: 600 }}>{label}</button>
);
const SectionTitle = ({ children }) => (
  <div style={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: 20, fontWeight: 700, color: K.t1, letterSpacing: .5, marginBottom: 14 }}>{children}</div>
);
const SubLabel = ({ children, color = K.acc, style }) => (
  <div style={{ fontSize: 10, fontWeight: 600, color, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, ...style }}>{children}</div>
);
const Card = ({ children, highlight, style, ...rest }) => (
  <div style={{ background: K.card, borderRadius: 10, border: `1px solid ${highlight ? K.acc + '40' : K.bdr}`, padding: "12px 14px", ...style }} {...rest}>{children}</div>
);
const EmptyState = ({ icon, title, subtitle }) => (
  <div style={{ textAlign: "center", padding: 40 }}>
    <div style={{ marginBottom: 12, display: "flex", justifyContent: "center", opacity: .4 }}>{typeof icon === "string" ? I[icon]?.(40, K.t3) || null : icon}</div>
    <div style={{ color: K.t2, fontSize: 14, fontWeight: 500 }}>{title}</div>
    {subtitle && <div style={{ color: K.t3, fontSize: 12, marginTop: 4 }}>{subtitle}</div>}
  </div>
);

// ══════════════════════════════════════════════════════════════
//  MAIN APP
// ══════════════════════════════════════════════════════════════
export default function GolfLeagueApp() {
  const [authUser, setAuthUser] = useState(undefined); // undefined=loading, null=signed out
  const [leagueUser, setLeagueUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // League data — all real-time via Firestore onSnapshot
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
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState("standings");

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(_auth, (user) => {
      setAuthUser(user || null);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  // Real-time subscriptions — fires when authUser changes
  useEffect(() => {
    if (!authUser) { setLeagueUser(null); return; }
    const unsubs = [];

    unsubs.push(db.subscribe("league_members", LF, (docs) => {
      setMembers(docs);
      const me = docs.find(d => d.uid === authUser.uid);
      if (me) setLeagueUser({ playerId: me.playerId, isCommissioner: me.isCommissioner, name: me.name || authUser.displayName, email: authUser.email });
      else setLeagueUser(null);
    }));

    unsubs.push(db.subscribe("league_players", LF, (docs) => setPlayers(docs)));
    unsubs.push(db.subscribe("league_teams", LF, (docs) => setTeams(docs)));
    unsubs.push(db.subscribe("league_schedule", LF, (docs) => setSchedule(docs.sort((a, b) => a.week - b.week))));
    unsubs.push(db.subscribe("league_course", LF, (docs) => { if (docs.length) setCourseData(docs[0]); }));
    unsubs.push(db.subscribe("league_scoring", LF, (docs) => { if (docs.length) setScoringRules(docs[0]); }));

    // Hole scores — the hot real-time path
    unsubs.push(db.subscribe("league_hole_scores", LF, (docs, changes) => {
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
    }));

    unsubs.push(db.subscribe("league_ctp", LF, (docs) => setCtpData(docs)));
    unsubs.push(db.subscribe("league_match_results", LF, (docs) => setMatchResults(docs)));
    unsubs.push(db.subscribe("league_config", LF, (docs) => { if (docs.length) setLeagueConfig(docs[0]); }));

    return () => unsubs.forEach(u => u && u());
  }, [authUser?.uid]);

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

  // Data write helpers
  const saveScore = async (week, playerId, hole, score) => {
    const id = `${LEAGUE_ID}_w${week}_p${playerId}_h${hole}`;
    setHoleScores(prev => ({ ...prev, [`w${week}_p${playerId}_h${hole}`]: score })); // optimistic
    await db.upsert("league_hole_scores", { id, league_id: LEAGUE_ID, week, player_id: playerId, hole, score, ts: Date.now() });
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

  // ── Render gates ──
  if (authLoading) return <LoadingScreen />;
  if (!authUser) return <AuthScreen onGoogle={doGoogleSignIn} onEmail={doEmailSignIn} />;
  if (!leagueUser) return <JoinScreen authUser={authUser} members={members} players={players} saveMember={saveMember} doSignOut={doSignOut} />;

  const tabs = [
    { id: "standings", label: "Standings", icon: "trophy" },
    { id: "scoring", label: "Score", icon: "flag" },
    { id: "schedule", label: "Schedule", icon: "calendar" },
    { id: "stats", label: "Stats", icon: "barChart" },
    { id: "ctp", label: "CTP", icon: "target" },
    ...(isComm ? [{ id: "admin", label: "Admin", icon: "settings" }] : []),
  ];

  return (
    <div className="app-shell">
      <link href={FONTS} rel="stylesheet" /><style>{CSS}</style>

      {/* Header */}
      <div className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src="/MnQ_logo_transparent_bg.png" alt="MnQ Golf" style={{ height: 36, objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: 12, color: K.t2, fontWeight: 600 }}>{leagueUser.name}</div>
            <div style={{ fontSize: 10, color: K.t3, display: "flex", alignItems: "center", gap: 6 }}>
              {isComm && <Pill color={K.warn} style={{ fontSize: 8 }}>COMMISSIONER</Pill>}
              {syncing && <span className="pu" style={{ fontSize: 8, color: K.grn }}>● LIVE</span>}
            </div>
          </div>
        </div>
        <button onClick={doSignOut} style={{ background: "none", border: `1px solid ${K.bdr}`, borderRadius: 8, color: K.t3, fontSize: 10, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>Sign Out</button>
      </div>

      <div className="app-body">
        {/* Desktop Sidebar */}
        <div className="sidebar">
          {tabs.map(t => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{ background: active ? K.acc + "12" : "transparent", border: "none", borderLeft: active ? `3px solid ${K.acc}` : "3px solid transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "11px 18px", transition: "all .15s", width: "100%" }}>
                <span style={{ display: "flex" }}>{I[t.icon](16, active ? K.acc : K.t3)}</span>
                <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? K.acc : K.t2 }}>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Main Content */}
        <div className="main-content fi" key={tab}>
          {tab === "standings" && <StandingsView teams={teams} players={players} matchResults={matchResults} />}
          {tab === "scoring" && <LiveScoringView leagueUser={leagueUser} players={players} teams={teams} course={courseData} schedule={schedule} holeScores={holeScores} saveScore={saveScore} scoringRules={scoringRules} matchResults={matchResults} saveMatchResult={saveMatchResult} ctpData={ctpData} saveCtp={saveCtp} />}
          {tab === "schedule" && <ScheduleView schedule={schedule} teams={teams} players={players} matchResults={matchResults} />}
          {tab === "stats" && <StatsView players={players} holeScores={holeScores} course={courseData} schedule={schedule} />}
          {tab === "ctp" && <CTPView ctpData={ctpData} players={players} />}
          {tab === "admin" && isComm && <AdminView players={players} savePlayer={savePlayer} deletePlayer={deletePlayer} teams={teams} saveTeam={saveTeam} deleteTeam={deleteTeam} schedule={schedule} saveWeekSchedule={saveWeekSchedule} course={courseData} saveCourseData={saveCourseData} scoringRules={scoringRules} saveScoringRules={saveScoringRules} leagueConfig={leagueConfig} saveLeagueConfig={saveLeagueConfig} members={members} saveMember={saveMember} deleteMember={deleteMember} authUser={authUser} />}
        </div>
      </div>

      {/* Mobile Bottom Nav */}
      <div className="bottom-nav">
        {tabs.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, opacity: active ? 1 : .45, transition: "all .2s" }}>
              <span style={{ display: "flex" }}>{I[t.icon](18, active ? K.acc : K.t2)}</span>
              <span style={{ fontSize: 9, fontWeight: active ? 600 : 400, color: active ? K.acc : K.t2 }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  LOADING / AUTH / JOIN SCREENS
// ══════════════════════════════════════════════════════════════
function LoadingScreen() {
  return (
    <div style={{ minHeight: "100vh", background: K.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <link href={FONTS} rel="stylesheet" /><style>{CSS}</style>
      <div style={{ fontSize: 52 }}><img src="/MnQ_logo_transparent_bg.png" alt="MnQ Golf" style={{ width: 220, objectFit: "contain" }} /></div>
      <div className="pu" style={{ fontFamily: "'IBM Plex Sans', sans-serif", color: K.t3, fontSize: 13 }}>Loading...</div>
    </div>
  );
}

function AuthScreen({ onGoogle, onEmail }) {
  const [mode, setMode] = useState("main");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleGoogle = async () => { setBusy(true); setError(""); try { await onGoogle(); } catch (e) { setError(e.message || "Sign-in failed"); } setBusy(false); };
  const handleEmail = async () => {
    if (!email || !pw) { setError("Enter email and password"); return; }
    setBusy(true); setError("");
    try { await onEmail(email, pw); } catch (e) { setError(e.code === "auth/wrong-password" ? "Wrong password" : e.code === "auth/invalid-email" ? "Invalid email" : e.message || "Sign-in failed"); }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: K.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <link href={FONTS} rel="stylesheet" /><style>{CSS}</style>
      <div style={{ width: 340, textAlign: "center" }} className="fi">
        <img src="/MnQ_logo_transparent_bg.png" alt="Maize-N-Que Golf" style={{ width: 280, objectFit: "contain", marginBottom: 8 }} />
        <div style={{ color: K.t3, fontSize: 12, marginBottom: 32 }}>Sign in to continue</div>

        {mode === "main" ? (<>
          <button onClick={handleGoogle} disabled={busy} style={{ width: "100%", padding: "14px 16px", borderRadius: 12, cursor: "pointer", fontSize: 15, fontWeight: 600, background: "#fff", color: "#333", border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10, opacity: busy ? .6 : 1 }}>
            <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#34A853" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#FBBC05" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Continue with Google
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "14px 0" }}><div style={{ flex: 1, height: 1, background: K.bdr }} /><span style={{ fontSize: 11, color: K.t3 }}>or</span><div style={{ flex: 1, height: 1, background: K.bdr }} /></div>
          <button onClick={() => setMode("email")} style={{ width: "100%", padding: "14px 16px", borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 600, background: K.card, color: K.t1, border: `1px solid ${K.bdr}` }}>Sign in with Email</button>
        </>) : (<>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" autoComplete="email" style={{ width: "100%", padding: "13px 16px", borderRadius: 10, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 15, marginBottom: 8, textAlign: "center" }} />
          <input value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" type="password" autoComplete="current-password" onKeyDown={e => e.key === "Enter" && handleEmail()} style={{ width: "100%", padding: "13px 16px", borderRadius: 10, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 15, marginBottom: 12, textAlign: "center" }} />
          <button onClick={handleEmail} disabled={busy} style={{ width: "100%", padding: "14px", borderRadius: 12, background: K.act, border: "none", color: K.bg, fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 10, opacity: busy ? .6 : 1 }}>Sign In / Create Account</button>
          <button onClick={() => { setMode("main"); setError(""); }} style={{ background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer" }}>← Back to options</button>
        </>)}
        {error && <div style={{ color: K.red, fontSize: 12, marginTop: 10 }}>{error}</div>}
      </div>
    </div>
  );
}

function JoinScreen({ authUser, members, players, saveMember, doSignOut }) {
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [busy, setBusy] = useState(false);
  const isFirstUser = members.length === 0;

  const handleJoin = async (asCommissioner = false) => {
    setBusy(true);
    await saveMember({ id: `${LEAGUE_ID}_${authUser.uid}`, uid: authUser.uid, email: authUser.email, name: authUser.displayName || authUser.email?.split("@")[0] || "Player", playerId: selectedPlayer || null, isCommissioner: asCommissioner });
    setBusy(false);
  };
  const assigned = members.map(m => m.playerId).filter(Boolean);

  return (
    <div style={{ minHeight: "100vh", background: K.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <link href={FONTS} rel="stylesheet" /><style>{CSS}</style>
      <div style={{ width: 340, textAlign: "center" }} className="fi">
        <img src="/MnQ_logo_transparent_bg.png" alt="Maize-N-Que Golf" style={{ width: 240, objectFit: "contain", marginBottom: 8 }} />
        <div style={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: 24, color: K.acc, letterSpacing: 1, marginBottom: 4 }}>Welcome!</div>
        <div style={{ color: K.t3, fontSize: 12, marginBottom: 6 }}>Signed in as <span style={{ color: K.t2, fontWeight: 600 }}>{authUser.email}</span></div>

        {isFirstUser ? (<>
          <div style={{ color: K.t2, fontSize: 13, marginBottom: 20, lineHeight: 1.5, padding: "0 12px" }}>You're the first one here! Set yourself up as commissioner to get started.</div>
          <button onClick={() => handleJoin(true)} disabled={busy} style={{ width: "100%", padding: "14px", borderRadius: 12, background: K.act, border: "none", color: K.bg, fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: busy ? .6 : 1 }}>Create League as Commissioner</button>
        </>) : (<>
          <div style={{ color: K.t2, fontSize: 13, marginBottom: 16, lineHeight: 1.5, padding: "0 12px" }}>{players.length > 0 ? "Link your account to your player profile:" : "No player profiles yet — your commissioner is still setting up. Join as a member."}</div>
          {players.length > 0 && (
            <select value={selectedPlayer} onChange={e => setSelectedPlayer(e.target.value)} style={{ width: "100%", padding: "12px", borderRadius: 10, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14, marginBottom: 12, textAlign: "center" }}>
              <option value="">— Select your player profile —</option>
              {players.filter(p => !assigned.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name} (HI: {p.handicapIndex})</option>)}
            </select>
          )}
          <button onClick={() => handleJoin(false)} disabled={busy} style={{ width: "100%", padding: "14px", borderRadius: 12, background: K.act, border: "none", color: K.bg, fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: busy ? .6 : 1 }}>Join League</button>
        </>)}
        <button onClick={doSignOut} style={{ background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer", marginTop: 12 }}>Sign out</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  STANDINGS
// ══════════════════════════════════════════════════════════════
function StandingsView({ teams, players, matchResults }) {
  const standings = useMemo(() => {
    const pts = {};
    teams.forEach(t => { pts[t.id] = { teamId: t.id, points: 0, w: 0, l: 0, t: 0 }; });
    matchResults.forEach(r => {
      if (!r) return;
      if (pts[r.team1Id]) pts[r.team1Id].points += (r.team1Points || 0);
      if (pts[r.team2Id]) pts[r.team2Id].points += (r.team2Points || 0);
      const d = (r.team1Points || 0) - (r.team2Points || 0);
      if (d > 0) { if (pts[r.team1Id]) pts[r.team1Id].w++; if (pts[r.team2Id]) pts[r.team2Id].l++; }
      else if (d < 0) { if (pts[r.team1Id]) pts[r.team1Id].l++; if (pts[r.team2Id]) pts[r.team2Id].w++; }
      else { if (pts[r.team1Id]) pts[r.team1Id].t++; if (pts[r.team2Id]) pts[r.team2Id].t++; }
    });
    return Object.values(pts).sort((a, b) => b.points - a.points);
  }, [teams, matchResults]);
  const gt = (id) => teams.find(t => t.id === id);
  const gn = (id) => players.find(p => p.id === id)?.name || "TBD";
  if (!teams.length) return <EmptyState icon="trophy" title="No teams yet" subtitle="Commissioner needs to set up teams." />;

  return (
    <div><SectionTitle>Season Standings</SectionTitle>
      <div className="standings-grid">
        {standings.map((s, i) => {
          const team = gt(s.teamId); if (!team) return null;
          const mc = i === 0 ? K.gold : i === 1 ? K.silver : i === 2 ? K.bronze : K.t3;
          return (
            <Card key={s.teamId} highlight={i === 0} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: i < 3 ? mc + "20" : K.inp, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: mc, border: i < 3 ? `1.5px solid ${mc}40` : "none" }}>{i + 1}</div>
              <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700 }}>{team.name}</div><div style={{ fontSize: 11, color: K.t3 }}>{gn(team.player1)} & {gn(team.player2)}</div></div>
              <div style={{ textAlign: "right" }}><div style={{ fontSize: 22, fontWeight: 800, color: K.acc, fontFamily: "'IBM Plex Sans Condensed', sans-serif" }}>{s.points}</div><div style={{ fontSize: 10, color: K.t3 }}>{s.w}W-{s.l}L-{s.t}T</div></div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  LIVE SCORING
// ══════════════════════════════════════════════════════════════
function LiveScoringView({ leagueUser, players, teams, course, schedule, holeScores, saveScore, scoringRules, matchResults, saveMatchResult, ctpData, saveCtp }) {
  const [selWeek, setSelWeek] = useState(null);
  const [activeMatch, setActiveMatch] = useState(null);
  const [curHole, setCurHole] = useState(0);
  const [showCTP, setShowCTP] = useState(false);

  const week = useMemo(() => { if (selWeek !== null) return selWeek; for (let w = schedule.length - 1; w >= 0; w--) if (schedule[w]) return schedule[w].week; return 0; }, [selWeek, schedule]);
  const weekSch = schedule.find(s => s.week === week);
  const matches = weekSch?.matches || [];
  const side = getWeekSide(week + 1);
  const pars = course ? (side === 'front' ? course.frontPars : course.backPars) : [4,4,4,3,5,4,4,3,5];
  const hcps = course ? (side === 'front' ? course.frontHcps : course.backHcps) : [1,3,5,7,9,11,13,15,17];
  const myTeam = teams.find(t => t.player1 === leagueUser.playerId || t.player2 === leagueUser.playerId);

  if (!course?.name) return <EmptyState icon="flag" title="Course not configured" subtitle="Commissioner needs to set up the course." />;
  if (!matches.length) return <EmptyState icon="calendar" title="No matches this week" subtitle="Commissioner needs to set the schedule." />;

  // Match selector
  if (!activeMatch) {
    const getProgress = (match) => {
      const ids = []; const t1 = teams.find(t => t.id === match.team1); const t2 = teams.find(t => t.id === match.team2);
      if (t1) ids.push(t1.player1, t1.player2); if (t2) ids.push(t2.player1, t2.player2);
      let sc = 0; ids.forEach(pid => { for (let h = 0; h < 9; h++) if (holeScores[`w${week}_p${pid}_h${h}`]) sc++; });
      return ids.length ? sc / (ids.length * 9) : 0;
    };
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div><SectionTitle>Week {week + 1}</SectionTitle><Pill>{side === 'front' ? 'FRONT 9' : 'BACK 9'}</Pill></div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setSelWeek(Math.max(0, week - 1))} disabled={week === 0} style={{ width: 32, height: 32, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: week === 0 ? K.t3 + "30" : K.t1, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>‹</button>
            <button onClick={() => setSelWeek(Math.min(SEASON_WEEKS - 1, week + 1))} style={{ width: 32, height: 32, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>›</button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {matches.map((m, mi) => {
            const t1 = teams.find(t => t.id === m.team1); const t2 = teams.find(t => t.id === m.team2);
            if (!t1 || !t2) return null;
            const prog = getProgress(m); const isMy = myTeam && (m.team1 === myTeam.id || m.team2 === myTeam.id);
            const gn = id => players.find(p => p.id === id)?.name?.split(' ')[0] || "?";
            return (
              <button key={mi} onClick={() => { setActiveMatch(m); setCurHole(0); setShowCTP(false); }} style={{ background: isMy ? K.acc + "0c" : K.card, border: `1px solid ${isMy ? K.acc + '40' : K.bdr}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", textAlign: "left", width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: K.t3, textTransform: "uppercase", letterSpacing: 1 }}>Match {mi + 1} · {getTeeTime(mi)}</span>
                  {prog > 0 && <Pill color={prog >= 1 ? K.grn : K.warn}>{prog >= 1 ? "FINAL" : `${Math.round(prog * 100)}%`}</Pill>}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700 }}>{t1.name}</div><div style={{ fontSize: 11, color: K.t3 }}>{gn(t1.player1)} & {gn(t1.player2)}</div></div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: K.t3, padding: "0 10px" }}>VS</div>
                  <div style={{ flex: 1, textAlign: "right" }}><div style={{ fontSize: 14, fontWeight: 700 }}>{t2.name}</div><div style={{ fontSize: 11, color: K.t3 }}>{gn(t2.player1)} & {gn(t2.player2)}</div></div>
                </div>
                {prog > 0 && prog < 1 && <div style={{ marginTop: 6, height: 3, background: K.inp, borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${prog * 100}%`, background: K.acc, borderRadius: 2 }} /></div>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Hole scoring view
  const t1 = teams.find(t => t.id === activeMatch.team1);
  const t2 = teams.find(t => t.id === activeMatch.team2);
  if (!t1 || !t2) return null;

  const getHcp = (pid) => players.find(p => p.id === pid)?.handicapIndex || 0;
  const t1p = [t1.player1, t1.player2].sort((a, b) => getHcp(a) - getHcp(b));
  const t2p = [t2.player1, t2.player2].sort((a, b) => getHcp(a) - getHcp(b));
  const allP = [t1p[0], t2p[0], t1p[1], t2p[1]];

  const par = pars[curHole] || 4;
  const hcp = hcps[curHole] || 1;
  const isPar3 = par === 3;

  const getS = (pid, h) => holeScores[`w${week}_p${pid}_h${h}`] || 0;
  const getNineHcp = (pid) => {
    const p = players.find(pl => pl.id === pid); if (!p || !course) return 0;
    const tb = course.teeBoxes?.find(t => t.name === p.teeBox) || course.teeBoxes?.[0];
    return tb ? calcNineHandicap(calcCourseHandicap(p.handicapIndex || 0, tb.slope, tb.rating, pars.reduce((a, b) => a + b, 0))) : 0;
  };
  const getStrokesMap = (nh) => {
    const map = {}; const sorted = hcps.map((h, i) => ({ idx: i, hcp: h })).sort((a, b) => a.hcp - b.hcp);
    let rem = Math.abs(nh);
    for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + 1; rem--; }
    for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + 1; rem--; }
    return map;
  };
  const getStrokes = (pid, h) => getStrokesMap(getNineHcp(pid))[h] || 0;
  const getRunning = (pid) => {
    let gross = 0, net = 0, thru = 0;
    for (let h = 0; h < 9; h++) { const s = getS(pid, h); if (s > 0) { gross += s; net += s - getStrokes(pid, h); thru++; } }
    return { gross, net, thru };
  };
  const allComplete = allP.every(pid => { for (let h = 0; h < 9; h++) if (getS(pid, h) <= 0) return false; return true; });

  const finalizeMatch = async () => {
    const t1L = getRunning(t1p[0]).net, t2L = getRunning(t2p[0]).net;
    const t1H = getRunning(t1p[1]).net, t2H = getRunning(t2p[1]).net;
    const t1T = t1L + t1H, t2T = t2L + t2H;
    const sr = week >= REGULAR_WEEKS
      ? { mw: scoringRules.playoffMatchWin, mt: scoringRules.playoffMatchTie, ml: scoringRules.playoffMatchLoss, bw: scoringRules.playoffBonusWin, bt: scoringRules.playoffBonusTie, bl: scoringRules.playoffBonusLoss }
      : { mw: scoringRules.matchWin, mt: scoringRules.matchTie, ml: scoringRules.matchLoss, bw: scoringRules.totalNetBonusWin, bt: scoringRules.totalNetBonusTie, bl: scoringRules.totalNetBonusLoss };
    let t1Pts = 0, t2Pts = 0;
    if (t1L < t2L) { t1Pts += sr.mw; t2Pts += sr.ml; } else if (t1L > t2L) { t1Pts += sr.ml; t2Pts += sr.mw; } else { t1Pts += sr.mt; t2Pts += sr.mt; }
    if (t1H < t2H) { t1Pts += sr.mw; t2Pts += sr.ml; } else if (t1H > t2H) { t1Pts += sr.ml; t2Pts += sr.mw; } else { t1Pts += sr.mt; t2Pts += sr.mt; }
    if (t1T < t2T) { t1Pts += sr.bw; t2Pts += sr.bl; } else if (t1T > t2T) { t1Pts += sr.bl; t2Pts += sr.bw; } else { t1Pts += sr.bt; t2Pts += sr.bt; }
    await saveMatchResult({ id: `${LEAGUE_ID}_w${week}_${t1.id}_${t2.id}`, week, team1Id: t1.id, team2Id: t2.id, team1Points: t1Pts, team2Points: t2Pts, t1LowNet: t1L, t2LowNet: t2L, t1HighNet: t1H, t2HighNet: t2H, t1Total: t1T, t2Total: t2T });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <BackBtn onClick={() => setActiveMatch(null)} />
        <div style={{ display: "flex", gap: 6 }}><Pill>{side === 'front' ? 'FRONT' : 'BACK'} 9</Pill><Pill color={K.t2}>WK {week + 1}</Pill></div>
      </div>
      <Card style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, padding: "8px 12px" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{t1.name}</span><span style={{ fontSize: 11, fontWeight: 800, color: K.t3 }}>VS</span><span style={{ fontSize: 13, fontWeight: 700, textAlign: "right" }}>{t2.name}</span>
      </Card>
      <div style={{ display: "flex", gap: 3, marginBottom: 8 }}>
        {Array.from({ length: 9 }, (_, i) => {
          const cur = i === curHole; const done = allP.every(pid => getS(pid, i) > 0);
          return <button key={i} onClick={() => setCurHole(i)} style={{ flex: 1, height: 34, borderRadius: done || cur ? 10 : 6, border: done && !cur ? `1.5px solid ${K.acc}50` : "none", background: cur ? K.acc : done ? K.acc + "15" : K.card, color: cur ? K.bg : done ? K.acc : K.t3, fontSize: 12, fontWeight: 700, cursor: "pointer", outline: cur ? `2px solid ${K.acc}` : "none", outlineOffset: 1 }}>{i + 1}</button>;
        })}
      </div>
      <div style={{ background: `linear-gradient(135deg, ${K.card}, #0f2440)`, borderRadius: 12, border: `1px solid ${K.bdr}`, padding: "8px 14px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: K.t3, fontWeight: 600 }}>Par</div><div style={{ fontSize: 18, fontWeight: 800, color: K.t2 }}>{par}</div></div>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: K.t1, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Hole</div><div style={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: 38, fontWeight: 700, color: K.t1, lineHeight: 1 }}>{side === 'front' ? curHole + 1 : curHole + 10}</div></div>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: K.t3, fontWeight: 600 }}>HCP</div><div style={{ fontSize: 18, fontWeight: 800, color: K.t2 }}>{hcp}</div></div>
      </div>
      {isPar3 && <button onClick={() => setShowCTP(!showCTP)} style={{ width: "100%", padding: 8, borderRadius: 8, marginBottom: 8, cursor: "pointer", background: K.acc + "12", border: `1px solid ${K.acc}35`, color: K.acc, fontSize: 12, fontWeight: 700 }}>{showCTP ? "Hide" : "Record"} Closest to Pin</button>}
      {showCTP && isPar3 && <CTPEntry week={week} hole={curHole} players={players} ctpData={ctpData} saveCtp={saveCtp} side={side} />}

      {[0, 1].map(mi => {
        const label = mi === 0 ? "Low Handicap Match" : "High Handicap Match";
        return (
          <div key={mi}>
            <SubLabel style={{ marginTop: mi > 0 ? 10 : 0 }}>{label}</SubLabel>
            {[allP[mi * 2], allP[mi * 2 + 1]].map(pid => {
              const pl = players.find(p => p.id === pid); if (!pl) return null;
              const score = getS(pid, curHole); const strokes = getStrokes(pid, curHole); const nh = getNineHcp(pid); const run = getRunning(pid);
              const btns = par === 3 ? [1,2,3,4,5,6,7] : par === 5 ? [2,3,4,5,6,7,8] : [2,3,4,5,6,7,8];
              return (
                <Card key={pid} style={{ marginBottom: 4, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{pl.name}</span>
                      <Pill color={K.acc}>({nh})</Pill>
                      {strokes > 0 && <span style={{ color: K.acc, fontSize: 11, letterSpacing: -1 }}>{"●".repeat(strokes)}</span>}
                    </div>
                    {run.thru > 0 && <span style={{ fontSize: 11, color: K.t3 }}>Net: <strong style={{ color: K.t1 }}>{run.net > 0 ? "+" : ""}{run.net}</strong> thru {run.thru}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 3 }}>
                    {btns.map(btn => {
                      const isCur = btn === score; const sd = btn - par; const sc = sd < 0 ? K.red : sd === 0 ? K.t3 : "#3b82f6";
                      return (
                        <button key={btn} onClick={() => saveScore(week, pid, curHole, isCur ? 0 : btn)} style={{ flex: 1, height: 42, borderRadius: 8, cursor: "pointer", fontSize: 16, fontWeight: 800, border: "none", background: isCur ? K.acc : K.inp, color: isCur ? K.bg : K.t2, position: "relative", transition: "all .15s" }}>
                          {isCur && sd !== 0 && <div style={{ position: "absolute", width: 34, height: 34, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}><div style={{ position: "absolute", inset: 0, borderRadius: sd < 0 ? "50%" : 3, border: `2px solid ${sc}` }} />{Math.abs(sd) >= 2 && <div style={{ position: "absolute", inset: 4, borderRadius: sd < 0 ? "50%" : 2, border: `1.5px solid ${sc}` }} />}</div>}
                          <span style={{ position: "relative", zIndex: 1 }}>{btn}</span>
                        </button>
                      );
                    })}
                    <button onClick={() => saveScore(week, pid, curHole, Math.max(1, (score || par) - 1))} style={{ width: 28, height: 42, borderRadius: 8, background: K.inp, border: "none", color: K.t3, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>−</button>
                    <button onClick={() => saveScore(week, pid, curHole, (score || par) + 1)} style={{ width: 28, height: 42, borderRadius: 8, background: K.inp, border: "none", color: K.t3, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>+</button>
                  </div>
                </Card>
              );
            })}
          </div>
        );
      })}
      {allComplete && (
        <div style={{ marginTop: 16, background: K.grn + "12", border: `1.5px solid ${K.grn}50`, borderRadius: 12, padding: 14, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: K.grn, marginBottom: 10 }}>All Holes Complete!</div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 12 }}>
            {allP.map(pid => { const p = players.find(pl => pl.id === pid); const r = getRunning(pid); return (
              <div key={pid} style={{ background: K.card, borderRadius: 8, padding: "6px 10px", border: `1px solid ${K.bdr}`, textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: K.t2 }}>{p?.name?.split(' ')[0]}</div><div style={{ fontSize: 15, fontWeight: 800, color: K.t1 }}>{r.gross}</div><div style={{ fontSize: 10, color: K.acc }}>Net {r.net}</div>
              </div>
            ); })}
          </div>
          <button onClick={finalizeMatch} style={{ padding: "12px 32px", borderRadius: 10, background: K.grn, border: "none", color: K.bg, fontSize: 14, fontWeight: 800, cursor: "pointer" }}>Finalize Match</button>
        </div>
      )}
    </div>
  );
}

function CTPEntry({ week, hole, players, ctpData, saveCtp, side }) {
  const existing = ctpData.find(c => c.week === week && c.hole === hole);
  const [pid, setPid] = useState(existing?.playerId || "");
  const [dist, setDist] = useState(existing?.distance || "");
  const save = async () => { await saveCtp({ id: `${LEAGUE_ID}_w${week}_h${hole}`, week, hole, holeNum: side === 'front' ? hole + 1 : hole + 10, playerId: pid, distance: parseFloat(dist) || 0 }); };
  return (
    <Card style={{ marginBottom: 8, border: `1px solid ${K.acc}30` }}>
      <SubLabel>Closest to Pin — Hole {side === 'front' ? hole + 1 : hole + 10}</SubLabel>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <select value={pid} onChange={e => setPid(e.target.value)} style={{ flex: 1, padding: 8, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13 }}><option value="">Select player</option>{players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input value={dist} onChange={e => setDist(e.target.value)} placeholder="Ft" type="number" style={{ width: 64, padding: 8, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, textAlign: "center" }} />
        <SaveBtn onClick={save} />
      </div>
      {existing?.playerId && <div style={{ marginTop: 6, fontSize: 11, color: K.grn }}>Current: {players.find(p => p.id === existing.playerId)?.name} — {existing.distance} ft</div>}
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════
//  SCHEDULE / STATS / CTP VIEWS
// ══════════════════════════════════════════════════════════════
function ScheduleView({ schedule, teams, players, matchResults }) {
  const [vw, setVw] = useState(0);
  if (!schedule.length) return <EmptyState icon="calendar" title="No schedule yet" subtitle="Commissioner needs to generate the schedule." />;
  return (
    <div><SectionTitle>Schedule</SectionTitle>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>{schedule.map((s, i) => <button key={i} onClick={() => setVw(i)} style={{ padding: "5px 9px", borderRadius: 7, cursor: "pointer", fontSize: 10, fontWeight: 700, background: vw === i ? K.acc : K.card, color: vw === i ? K.bg : K.t2, border: `1px solid ${vw === i ? K.acc : K.bdr}` }}>W{s.week + 1}</button>)}</div>
      <div style={{ marginBottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
        <SubLabel style={{ margin: 0 }}>Week {schedule[vw]?.week + 1}</SubLabel>
        <Pill>{getWeekSide(schedule[vw]?.week + 1) === 'front' ? 'FRONT 9' : 'BACK 9'}</Pill>
        {schedule[vw]?.week >= REGULAR_WEEKS && <Pill color={K.warn}>PLAYOFFS</Pill>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {(schedule[vw]?.matches || []).map((m, mi) => {
          const t1 = teams.find(t => t.id === m.team1); const t2 = teams.find(t => t.id === m.team2);
          const res = matchResults.find(r => r.week === schedule[vw]?.week && r.team1Id === m.team1 && r.team2Id === m.team2);
          return (
            <Card key={mi} style={{ padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: K.t3, fontWeight: 600, marginBottom: 4 }}>{getTeeTime(mi)} · Match {mi + 1}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{t1?.name || "TBD"}</div>
                {res ? <div style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 800, color: K.acc }}>{res.team1Points}–{res.team2Points}</div><div style={{ fontSize: 9, color: K.grn }}>FINAL</div></div> : <div style={{ fontSize: 11, color: K.t3, fontWeight: 700 }}>VS</div>}
                <div style={{ fontSize: 13, fontWeight: 700, textAlign: "right" }}>{t2?.name || "TBD"}</div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function StatsView({ players, holeScores, course, schedule }) {
  const stats = useMemo(() => {
    return players.map(p => {
      const diffs = []; let totalGross = 0, rounds = 0;
      schedule.forEach(wk => {
        const side = getWeekSide(wk.week + 1); const prs = course ? (side === 'front' ? course.frontPars : course.backPars) : [];
        let wg = 0, cnt = 0;
        for (let h = 0; h < 9; h++) { const s = holeScores[`w${wk.week}_p${p.id}_h${h}`]; if (s > 0) { wg += s; cnt++; } }
        if (cnt === 9 && course) { totalGross += wg; rounds++; const tb = course.teeBoxes?.find(t => t.name === p.teeBox) || course.teeBoxes?.[0]; if (tb) diffs.push(calcDifferential(wg * 2, tb.rating, tb.slope)); }
      });
      return { ...p, diffs, idx: diffs.length ? calcHandicapIndex(diffs) : p.handicapIndex, avgGross: rounds ? (totalGross / rounds).toFixed(1) : "—", rounds };
    }).sort((a, b) => (a.idx || 99) - (b.idx || 99));
  }, [players, holeScores, course, schedule]);
  return (
    <div><SectionTitle>Player Stats & Handicaps</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {stats.map(p => (
          <Card key={p.id}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><div style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</div><div style={{ fontSize: 11, color: K.t3 }}>{p.teeBox || "White"} tees · {p.rounds} rds</div></div>
            <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: K.t3, fontWeight: 600 }}>Handicap</div><div style={{ fontSize: 22, fontWeight: 800, color: K.acc, fontFamily: "'IBM Plex Sans Condensed', sans-serif" }}>{p.idx ?? "—"}</div>{p.rounds > 0 && <div style={{ fontSize: 10, color: K.t3 }}>Avg 9: {p.avgGross}</div>}</div>
          </div></Card>
        ))}
      </div>
    </div>
  );
}

function CTPView({ ctpData, players }) {
  const wins = {}; ctpData.filter(c => c.playerId).forEach(c => { wins[c.playerId] = (wins[c.playerId] || 0) + 1; });
  const sorted = Object.entries(wins).map(([pid, cnt]) => ({ p: players.find(pl => pl.id === pid), cnt })).filter(e => e.p).sort((a, b) => b.cnt - a.cnt);
  return (
    <div><SectionTitle>Closest to Pin</SectionTitle>
      {!sorted.length ? <EmptyState icon="target" title="No CTP results yet" /> : (<>
        <SubLabel style={{ marginBottom: 8, color: K.t3 }}>Season Leaders</SubLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
          {sorted.map((e, i) => (
            <Card key={e.p.id} highlight={i === 0} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 28, height: 28, borderRadius: 7, background: i === 0 ? K.gold + "20" : K.inp, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: i === 0 ? K.gold : K.t3 }}>{i + 1}</div><span style={{ fontSize: 14, fontWeight: 700 }}>{e.p.name}</span></div>
              <div style={{ fontSize: 18, fontWeight: 800, color: K.acc, fontFamily: "'IBM Plex Sans Condensed', sans-serif" }}>{e.cnt}</div>
            </Card>
          ))}
        </div>
        <SubLabel style={{ color: K.t3 }}>Weekly Results</SubLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {ctpData.filter(c => c.playerId).map(c => <div key={c.id} style={{ background: K.card, borderRadius: 8, padding: "7px 12px", border: `1px solid ${K.bdr}`, display: "flex", justifyContent: "space-between", fontSize: 12 }}><span style={{ color: K.t2 }}>Wk {c.week + 1} · Hole {c.holeNum}</span><span style={{ fontWeight: 700 }}>{players.find(p => p.id === c.playerId)?.name}</span><span style={{ color: K.acc, fontWeight: 600 }}>{c.distance} ft</span></div>)}
        </div>
      </>)}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════════════
function AdminView(props) {
  const { players, savePlayer, deletePlayer, teams, saveTeam, deleteTeam, schedule, saveWeekSchedule, course, saveCourseData, scoringRules, saveScoringRules, leagueConfig, saveLeagueConfig, members, saveMember, deleteMember } = props;
  const [sec, setSec] = useState(null);
  const sections = [
    { id: "config", label: "League Settings", icon: "settings", desc: leagueConfig.name },
    { id: "players", label: "Players", icon: "user", desc: `${players.length} registered` },
    { id: "teams", label: "Teams", icon: "users", desc: `${teams.length} teams` },
    { id: "course", label: "Course Setup", icon: "mapPin", desc: course?.name || "Not set" },
    { id: "schedule", label: "Schedule", icon: "calendar", desc: `${schedule.length} weeks` },
    { id: "scoring", label: "Scoring Rules", icon: "ruler", desc: "Match & bonus points" },
    { id: "members", label: "Members / Auth", icon: "key", desc: `${members.length} linked accounts` },
  ];

  if (sec === "players") return <AdminPlayers players={players} savePlayer={savePlayer} deletePlayer={deletePlayer} course={course} onBack={() => setSec(null)} />;
  if (sec === "teams") return <AdminTeams teams={teams} saveTeam={saveTeam} players={players} onBack={() => setSec(null)} />;
  if (sec === "course") return <AdminCourse course={course} saveCourseData={saveCourseData} onBack={() => setSec(null)} />;
  if (sec === "schedule") return <AdminSchedule schedule={schedule} saveWeekSchedule={saveWeekSchedule} teams={teams} onBack={() => setSec(null)} />;
  if (sec === "scoring") return <AdminScoring scoring={scoringRules} saveScoringRules={saveScoringRules} onBack={() => setSec(null)} />;
  if (sec === "members") return <AdminMembers members={members} saveMember={saveMember} deleteMember={deleteMember} players={players} onBack={() => setSec(null)} />;
  if (sec === "config") return <AdminConfig config={leagueConfig} saveLeagueConfig={saveLeagueConfig} onBack={() => setSec(null)} />;

  return (
    <div><SectionTitle>Commissioner Dashboard</SectionTitle>
      <div className="admin-sections-grid">
        {sections.map(s => <button key={s.id} onClick={() => setSec(s.id)} style={{ background: K.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${K.bdr}`, cursor: "pointer", textAlign: "left", width: "100%", display: "flex", alignItems: "center", gap: 12 }}><div style={{ display: "flex", color: K.t3 }}>{I[s.icon](20, K.t3)}</div><div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600, color: K.t1 }}>{s.label}</div><div style={{ fontSize: 11, color: K.t3 }}>{s.desc}</div></div><div style={{ color: K.t3, fontSize: 16 }}>›</div></button>)}
      </div>
    </div>
  );
}

function AdminPlayers({ players, savePlayer, deletePlayer, course, onBack }) {
  const [ed, setEd] = useState(null);
  const [f, setF] = useState({ name: "", handicapIndex: "", teeBox: "Blue" });
  const nameRef = useRef(null);
  const tees = course?.teeBoxes?.map(t => t.name) || ["Blue", "Black", "White"];
  const save = async () => { if (!f.name.trim()) return; const id = ed === "new" ? `${LEAGUE_ID}_p${Date.now()}` : ed; await savePlayer({ id, name: f.name.trim(), handicapIndex: parseFloat(f.handicapIndex) || 0, teeBox: f.teeBox }); setEd(null); };

  useEffect(() => { if (ed && nameRef.current) nameRef.current.focus(); }, [ed]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={onBack} /><span style={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: 18, color: K.t1 }}>Players ({players.length}/20)</span>
        <button onClick={() => { setF({ name: "", handicapIndex: "", teeBox: "Blue" }); setEd("new"); }} style={{ background: K.act, border: "none", borderRadius: 8, color: K.bg, fontSize: 11, padding: "6px 12px", cursor: "pointer", fontWeight: 700 }}>+ Add</button>
      </div>
      {ed && (
        <Card highlight style={{ marginBottom: 12, padding: 14 }}>
          <input ref={nameRef} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Player Name" style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14, marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <input value={f.handicapIndex} onChange={e => setF({ ...f, handicapIndex: e.target.value })} placeholder="Handicap Index" type="number" step="0.1" style={{ flex: 1, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} />
            <select value={f.teeBox} onChange={e => setF({ ...f, teeBox: e.target.value })} style={{ flex: 1, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }}>{tees.map(n => <option key={n} value={n}>{n}</option>)}</select>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={() => setEd(null)} style={{ flex: 1, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button onClick={save} style={{ flex: 1, padding: 10, borderRadius: 8, background: K.act, border: "none", color: K.bg, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Save</button>
          </div>
        </Card>
      )}
      <div className="players-grid">
        {players.map(p => (
          <Card key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
            <div><div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span><span style={{ fontSize: 14, fontWeight: 700, color: K.t1 }}>{p.handicapIndex}</span></div><div style={{ fontSize: 11, color: K.t3 }}>{p.teeBox || "Blue"} tees</div></div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => { setF({ name: p.name, handicapIndex: String(p.handicapIndex ?? ""), teeBox: p.teeBox || "White" }); setEd(p.id); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.acc, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>Edit</button>
              <button onClick={() => { if (confirm("Remove?")) deletePlayer(p.id); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.red, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>✕</button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AdminTeams({ teams, saveTeam, players, onBack }) {
  const [ed, setEd] = useState(null);
  const [f, setF] = useState({ name: "", player1: "", player2: "" });
  const assigned = teams.flatMap(t => [t.player1, t.player2]);
  const avail = (c1, c2) => players.filter(p => !assigned.includes(p.id) || p.id === c1 || p.id === c2);
  const save = async () => { if (!f.name.trim() || !f.player1 || !f.player2) return; const id = ed === "new" ? `${LEAGUE_ID}_t${Date.now()}` : ed; await saveTeam({ id, ...f }); setEd(null); };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={onBack} /><span style={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: 18, color: K.t1 }}>Teams ({teams.length}/{TEAMS_COUNT})</span>
        <button onClick={() => { setF({ name: "", player1: "", player2: "" }); setEd("new"); }} disabled={teams.length >= TEAMS_COUNT} style={{ background: teams.length >= TEAMS_COUNT ? K.t3 : K.act, border: "none", borderRadius: 8, color: K.bg, fontSize: 11, padding: "6px 12px", cursor: "pointer", fontWeight: 700, opacity: teams.length >= TEAMS_COUNT ? .5 : 1 }}>+ Add</button>
      </div>
      {ed && (
        <Card highlight style={{ marginBottom: 12, padding: 14 }}>
          <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Team Name" style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14, marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select value={f.player1} onChange={e => setF({ ...f, player1: e.target.value })} style={{ flex: 1, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13 }}><option value="">Player 1</option>{avail(f.player1, f.player2).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <select value={f.player2} onChange={e => setF({ ...f, player2: e.target.value })} style={{ flex: 1, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13 }}><option value="">Player 2</option>{avail(f.player1, f.player2).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </div>
          <div style={{ display: "flex", gap: 8 }}><button onClick={() => setEd(null)} style={{ flex: 1, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 13, cursor: "pointer" }}>Cancel</button><button onClick={save} style={{ flex: 1, padding: 10, borderRadius: 8, background: K.act, border: "none", color: K.bg, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Save</button></div>
        </Card>
      )}
      <div className="players-grid">
        {teams.map(t => <Card key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}><div><div style={{ fontSize: 14, fontWeight: 700 }}>{t.name}</div><div style={{ fontSize: 11, color: K.t3 }}>{players.find(p => p.id === t.player1)?.name} & {players.find(p => p.id === t.player2)?.name}</div></div><button onClick={() => { setF({ name: t.name, player1: t.player1, player2: t.player2 }); setEd(t.id); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.acc, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>Edit</button></Card>)}
      </div>
    </div>
  );
}

function AdminCourse({ course, saveCourseData, onBack }) {
  const [lc, setLc] = useState(course || { name: "", frontPars: [4,4,4,3,5,4,4,3,5], backPars: [4,3,5,4,4,4,5,3,4], frontHcps: [7,3,1,9,5,13,11,17,15], backHcps: [8,14,2,10,4,16,6,18,12], teeBoxes: [{ name: "White", color: "#e2e8f0", slope: 113, rating: 67 }] });
  const up = (k, i, v) => { const a = [...lc[k]]; a[i] = parseInt(v) || 0; setLc({ ...lc, [k]: a }); };
  const upT = (ti, f, v) => { const t = [...lc.teeBoxes]; t[ti] = { ...t[ti], [f]: f === 'slope' || f === 'rating' ? parseFloat(v) || 0 : v }; setLc({ ...lc, teeBoxes: t }); };
  const save = async () => { await saveCourseData(lc); onBack(); };
  const IC = ({ value, onChange }) => <input value={value} onChange={e => onChange(e.target.value)} type="number" style={{ width: 34, padding: "4px 2px", borderRadius: 4, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 12, textAlign: "center" }} />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><BackBtn onClick={onBack} /><span style={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: 18, color: K.t1 }}>Course Setup</span><SaveBtn onClick={save} /></div>
      <input value={lc.name} onChange={e => setLc({ ...lc, name: e.target.value })} placeholder="Course Name" style={{ width: "100%", maxWidth: 400, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14, marginBottom: 12 }} />
      <div className="scoring-grid">
      {['front', 'back'].map(s => (
        <div key={s} style={{ marginBottom: 12 }}><SubLabel>{s === 'front' ? 'Front 9' : 'Back 9'}</SubLabel>
          <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr><td style={{ color: K.t3, fontWeight: 600, padding: "4px 2px", width: 32 }}></td>{Array.from({length:9},(_,i) => <td key={i} style={{ color: K.t2, fontWeight: 700, textAlign: "center", padding: "4px 1px" }}>{s==='front'?i+1:i+10}</td>)}</tr></thead>
            <tbody>
              <tr><td style={{ color: K.t3, fontWeight: 600, padding: "3px 2px" }}>Par</td>{Array.from({length:9},(_,i) => <td key={i} style={{ padding: "2px 1px" }}><IC value={lc[s==='front'?'frontPars':'backPars'][i]} onChange={v => up(s==='front'?'frontPars':'backPars',i,v)} /></td>)}</tr>
              <tr><td style={{ color: K.t3, fontWeight: 600, padding: "3px 2px" }}>Hcp</td>{Array.from({length:9},(_,i) => <td key={i} style={{ padding: "2px 1px" }}><IC value={lc[s==='front'?'frontHcps':'backHcps'][i]} onChange={v => up(s==='front'?'frontHcps':'backHcps',i,v)} /></td>)}</tr>
            </tbody>
          </table></div>
        </div>
      ))}
      </div>
      <SubLabel>Tee Boxes</SubLabel>
      <div className="players-grid">
      {lc.teeBoxes.map((t, ti) => (
        <Card key={ti} style={{ marginBottom: 6, padding: "10px 12px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}><div style={{ width: 14, height: 14, borderRadius: 4, background: t.color }} /><input value={t.name} onChange={e => upT(ti, 'name', e.target.value)} style={{ flex: 1, padding: "6px 8px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, fontWeight: 700 }} /></div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}><div style={{ fontSize: 10, color: K.t3, marginBottom: 2 }}>Slope</div><input value={t.slope} onChange={e => upT(ti, 'slope', e.target.value)} type="number" style={{ width: "100%", padding: "6px 8px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13 }} /></div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 10, color: K.t3, marginBottom: 2 }}>Rating</div><input value={t.rating} onChange={e => upT(ti, 'rating', e.target.value)} type="number" step="0.1" style={{ width: "100%", padding: "6px 8px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13 }} /></div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 10, color: K.t3, marginBottom: 2 }}>Color</div><input value={t.color} onChange={e => upT(ti, 'color', e.target.value)} type="color" style={{ width: "100%", height: 32, borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, cursor: "pointer" }} /></div>
          </div>
        </Card>
      ))}
      </div>
      <button onClick={() => setLc({ ...lc, teeBoxes: [...lc.teeBoxes, { name: "New", color: "#888", slope: 113, rating: 67 }] })} style={{ width: "100%", maxWidth: 300, padding: 10, borderRadius: 8, background: K.inp, border: `1px dashed ${K.bdr}`, color: K.t3, fontSize: 12, cursor: "pointer", marginTop: 4 }}>+ Add Tee Box</button>
    </div>
  );
}

function AdminSchedule({ schedule, saveWeekSchedule, teams, onBack }) {
  const generate = async () => {
    if (teams.length < 2) return alert("Need at least 2 teams");
    const ids = teams.map(t => t.id); if (ids.length % 2 !== 0) ids.push(null);
    for (let r = 0; r < SEASON_WEEKS; r++) {
      const ri = r % (ids.length - 1); const sh = [ids[0]];
      for (let i = 1; i < ids.length; i++) sh.push(ids[(i - 1 + ri) % (ids.length - 1) + 1]);
      const matches = [];
      for (let i = 0; i < sh.length / 2; i++) { const a = sh[i], b = sh[sh.length - 1 - i]; if (a && b) matches.push({ team1: a, team2: b }); }
      await saveWeekSchedule({ id: `${LEAGUE_ID}_w${r}`, week: r, matches, side: getWeekSide(r + 1) });
    }
  };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><BackBtn onClick={onBack} /><span style={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: 18, color: K.t1 }}>Schedule</span><button onClick={generate} style={{ background: K.act, border: "none", borderRadius: 8, color: K.bg, fontSize: 11, padding: "6px 12px", cursor: "pointer", fontWeight: 700 }}>Generate</button></div>
      {!schedule.length ? <div style={{ textAlign: "center", padding: 30, color: K.t3, fontSize: 13 }}>No schedule yet. Set up teams, then tap Generate.</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {schedule.map(wk => (
            <Card key={wk.week} style={{ padding: "8px 12px" }}>
              <div style={{ fontWeight: 700, fontSize: 11, color: wk.week >= REGULAR_WEEKS ? K.warn : K.acc, marginBottom: 3 }}>Wk {wk.week + 1} — {getWeekSide(wk.week + 1) === 'front' ? 'Front 9' : 'Back 9'} {wk.week >= REGULAR_WEEKS && "· PLAYOFFS"}</div>
              {wk.matches.map((m, mi) => <div key={mi} style={{ fontSize: 11, color: K.t3, marginLeft: 10 }}>{getTeeTime(mi)} — {teams.find(t => t.id === m.team1)?.name} vs {teams.find(t => t.id === m.team2)?.name}</div>)}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminScoring({ scoring, saveScoringRules, onBack }) {
  const [lc, setLc] = useState({ ...scoring });
  const save = async () => { await saveScoringRules(lc); onBack(); };
  const F = ({ label, field }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${K.bdr}15` }}>
      <span style={{ fontSize: 12, color: K.t2 }}>{label}</span>
      <input value={lc[field]} onChange={e => setLc({ ...lc, [field]: parseFloat(e.target.value) || 0 })} type="number" step="0.5" style={{ width: 58, padding: "5px 6px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, textAlign: "center" }} />
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><BackBtn onClick={onBack} /><span style={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: 18, color: K.t1 }}>Scoring Rules</span><SaveBtn onClick={save} /></div>
      <div className="scoring-grid">
        <div><SubLabel>Regular Season — Match</SubLabel><Card style={{ padding: "2px 14px" }}><F label="Win" field="matchWin" /><F label="Tie" field="matchTie" /><F label="Loss" field="matchLoss" /></Card></div>
        <div><SubLabel>Regular Season — Total Net Bonus</SubLabel><Card style={{ padding: "2px 14px" }}><F label="Win" field="totalNetBonusWin" /><F label="Tie" field="totalNetBonusTie" /><F label="Loss" field="totalNetBonusLoss" /></Card></div>
        <div><SubLabel color={K.warn}>Playoff — Match</SubLabel><Card style={{ padding: "2px 14px" }}><F label="Win" field="playoffMatchWin" /><F label="Tie" field="playoffMatchTie" /><F label="Loss" field="playoffMatchLoss" /></Card></div>
        <div><SubLabel color={K.warn}>Playoff — Bonus</SubLabel><Card style={{ padding: "2px 14px" }}><F label="Win" field="playoffBonusWin" /><F label="Tie" field="playoffBonusTie" /><F label="Loss" field="playoffBonusLoss" /></Card></div>
      </div>
    </div>
  );
}

function AdminMembers({ members, saveMember, deleteMember, players, onBack }) {
  const assigned = members.map(m => m.playerId).filter(Boolean);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><BackBtn onClick={onBack} /><span style={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: 18, color: K.t1 }}>Members</span><div style={{ width: 60 }} /></div>
      <div style={{ fontSize: 12, color: K.t3, marginBottom: 12, lineHeight: 1.5 }}>Members sign in via Google or email and link to a player profile. Grant commissioner access as needed.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {members.map(m => (
          <Card key={m.id} style={{ padding: "10px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div><div style={{ fontSize: 13, fontWeight: 700 }}>{m.name}</div><div style={{ fontSize: 10, color: K.t3 }}>{m.email}</div></div>
              <div style={{ display: "flex", gap: 4 }}>{m.isCommissioner && <Pill color={K.warn} style={{ fontSize: 8 }}>COMM</Pill>}<button onClick={() => { if (confirm(`Remove ${m.name}?`)) deleteMember(m.id); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.red, fontSize: 10, padding: "3px 6px", cursor: "pointer" }}>✕</button></div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select value={m.playerId || ""} onChange={e => saveMember({ ...m, playerId: e.target.value })} style={{ flex: 1, padding: 6, borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 12 }}><option value="">— Unlinked —</option>{players.filter(p => !assigned.includes(p.id) || p.id === m.playerId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <button onClick={() => saveMember({ ...m, isCommissioner: !m.isCommissioner })} style={{ padding: "5px 8px", borderRadius: 6, background: m.isCommissioner ? K.warn + "20" : K.inp, border: `1px solid ${m.isCommissioner ? K.warn + "40" : K.bdr}`, color: m.isCommissioner ? K.warn : K.t3, fontSize: 10, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>{m.isCommissioner ? "Revoke" : "Make Comm"}</button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AdminConfig({ config, saveLeagueConfig, onBack }) {
  const [lc, setLc] = useState({ ...config });
  const save = async () => { await saveLeagueConfig(lc); onBack(); };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><BackBtn onClick={onBack} /><span style={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: 18, color: K.t1 }}>League Settings</span><SaveBtn onClick={save} /></div>
      <Card style={{ padding: 14 }}>
        <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>League Name</div><input value={lc.name} onChange={e => setLc({ ...lc, name: e.target.value })} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} /></div>
        <div><div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Season Year</div><input value={lc.year} onChange={e => setLc({ ...lc, year: parseInt(e.target.value) || 2026 })} type="number" style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} /></div>
      </Card>
    </div>
  );
}
