import { useState, useEffect, useCallback, useRef } from "react";
import { LEAGUE_ID } from "../firebase";
import { K, FONTS, CSS, I, Pill, BackBtn, SaveBtn, SectionTitle, SubLabel, Card, EmptyState,
  SEASON_WEEKS, REGULAR_WEEKS, TEAMS_COUNT, getTeeTime, getWeekSide, calcCourseHandicap, calcNineHandicap, calcLeagueHandicap } from "../theme";


export default function AdminView(props) {
  const { players, savePlayer, deletePlayer, teams, saveTeam, deleteTeam, schedule, saveWeekSchedule, course, saveCourseData, scoringRules, saveScoringRules, leagueConfig, saveLeagueConfig, members, saveMember, deleteMember } = props;
  const [sec, setSec] = useState(null);
  const sections = [
    { id: "config", label: "League Settings", icon: "settings", desc: leagueConfig.name },
    { id: "players", label: "Players", icon: "user", desc: `${players.filter(p => p.status !== "inactive").length} active` },
    { id: "teams", label: "Teams", icon: "users", desc: `${teams.length} teams` },
    { id: "course", label: "Course Setup", icon: "mapPin", desc: course?.name || "Not set" },
    { id: "schedule", label: "Schedule", icon: "calendar", desc: `${schedule.length} weeks` },
    { id: "scoring", label: "Scoring Rules", icon: "ruler", desc: "Match & bonus points" },
    { id: "members", label: "Members / Auth", icon: "key", desc: `${members.length} linked accounts` },
  ];

  if (sec === "players") return <AdminPlayers players={players} savePlayer={savePlayer} deletePlayer={deletePlayer} course={course} onBack={() => setSec(null)} />;
  if (sec === "teams") return <AdminTeams teams={teams} saveTeam={saveTeam} players={players} onBack={() => setSec(null)} />;
  if (sec === "course") return <AdminCourse course={course} saveCourseData={saveCourseData} onBack={() => setSec(null)} />;
  if (sec === "schedule") return <AdminSchedule schedule={schedule} saveWeekSchedule={saveWeekSchedule} teams={teams} leagueConfig={leagueConfig} saveLeagueConfig={saveLeagueConfig} matchResults={props.matchResults} onBack={() => setSec(null)} />;
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
  const [showInactive, setShowInactive] = useState(false);
  const nameRef = useCallback(node => { if (node) setTimeout(() => node.focus(), 50); }, [ed]);
  const tees = course?.teeBoxes?.map(t => t.name) || ["Blue", "Black", "White"];
  const save = async () => { if (!f.name.trim()) return; const id = ed === "new" ? `${LEAGUE_ID}_p${Date.now()}` : ed; await savePlayer({ id, name: f.name.trim(), handicapIndex: parseFloat(f.handicapIndex) || 0, teeBox: f.teeBox, status: "active" }); setEd(null); };
  const toggleStatus = async (p) => { await savePlayer({ ...p, status: p.status === "inactive" ? "active" : "inactive" }); };

  const activePlayers = players.filter(p => p.status !== "inactive").sort((a, b) => a.name.localeCompare(b.name));
  const inactivePlayers = players.filter(p => p.status === "inactive").sort((a, b) => a.name.localeCompare(b.name));

  const PlayerRow = ({ p, inactive }) => (
    <Card key={p.id} style={{ display: "flex", alignItems: "center", padding: "10px 14px", opacity: inactive ? .5 : 1 }}>
      <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{p.name}</div>
      <div style={{ width: 50, textAlign: "right", fontSize: 14, fontWeight: 700, color: K.t1, marginRight: 12 }}>{p.handicapIndex}</div>
      {inactive ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Pill color={K.t3} style={{ fontSize: 8 }}>INACTIVE</Pill>
          <button onClick={() => toggleStatus(p)} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.grn, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>Reactivate</button>
          <button onClick={() => { if (confirm(`Permanently delete ${p.name}? This cannot be undone.`)) deletePlayer(p.id); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.red, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>Delete</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => { setF({ name: p.name, handicapIndex: String(p.handicapIndex ?? ""), teeBox: p.teeBox || "Blue" }); setEd(p.id); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.acc, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>Edit</button>
          <button onClick={() => { if (confirm(`Deactivate ${p.name}?`)) toggleStatus(p); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.warn, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>Deactivate</button>
        </div>
      )}
    </Card>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={onBack} /><span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Players ({activePlayers.length} active)</span>
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
      {activePlayers.length > 0 && (
        <div style={{ display: "flex", padding: "0 14px 4px", fontSize: 10, fontWeight: 600, color: K.t3, textTransform: "uppercase", letterSpacing: 1 }}>
          <div style={{ flex: 1 }}>Name</div>
          <div style={{ width: 50, textAlign: "right", marginRight: 12 }}>HCP</div>
          <div style={{ width: 130 }}></div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {activePlayers.map(p => <PlayerRow key={p.id} p={p} />)}
      </div>
      {inactivePlayers.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <button onClick={() => setShowInactive(!showInactive)} style={{ background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
            {showInactive ? "▾" : "▸"} Inactive Players ({inactivePlayers.length})
          </button>
          {showInactive && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
              {inactivePlayers.map(p => <PlayerRow key={p.id} p={p} inactive />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function AdminTeams({ teams, saveTeam, players, onBack }) {
  const activePlayers = players.filter(p => p.status !== "inactive").sort((a, b) => a.name.localeCompare(b.name));

  // Build team name from two player IDs
  const buildName = (p1Id, p2Id) => {
    const p1 = players.find(p => p.id === p1Id);
    const p2 = players.find(p => p.id === p2Id);
    if (!p1 && !p2) return "";
    const short = (p) => {
      if (!p) return "?";
      const parts = p.name.split(' ');
      return parts.length > 1 ? `${parts[0][0]} ${parts[parts.length - 1]}` : p.name;
    };
    return `${short(p1)}/${short(p2)}`;
  };

  // Initialize 10 rows from existing teams
  const [rows, setRows] = useState(() => {
    const r = [];
    for (let i = 0; i < TEAMS_COUNT; i++) {
      const t = teams[i];
      r.push({
        id: t?.id || `${LEAGUE_ID}_t${i + 1}`,
        name: t?.name || "",
        player1: t?.player1 || "",
        player2: t?.player2 || "",
      });
    }
    return r;
  });

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Get all currently assigned player IDs (to prevent double-assignment)
  const assignedIds = rows.flatMap(r => [r.player1, r.player2]).filter(Boolean);

  // Available players for a dropdown: unassigned + the current selection
  const avail = (currentId) => activePlayers.filter(p => !assignedIds.includes(p.id) || p.id === currentId);

  const updateRow = (idx, field, value) => {
    setRows(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      // Auto-update team name when players change
      const p1 = field === "player1" ? value : next[idx].player1;
      const p2 = field === "player2" ? value : next[idx].player2;
      if (field === "player1" || field === "player2") {
        next[idx].name = buildName(p1, p2);
      }
      return next;
    });
    setDirty(true);
  };

  const saveAll = async () => {
    setSaving(true);
    for (const r of rows) {
      if (r.player1 || r.player2) {
        await saveTeam({ id: r.id, name: r.name || buildName(r.player1, r.player2), player1: r.player1, player2: r.player2 });
      }
    }
    setSaving(false);
    setDirty(false);
  };

  // Short display name: "A. Jensen", "S. Rhoades"
  const shortName = (p) => {
    if (!p) return "?";
    const parts = p.name.split(' ');
    return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : p.name;
  };

  const selectStyle = { flex: 1, padding: "8px 6px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13 };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={onBack} />
        <span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Teams</span>
        <SaveBtn onClick={saveAll} label={saving ? "Saving..." : dirty ? "Save All" : "Saved"} />
      </div>

      {/* Header row */}
      <div style={{ display: "flex", gap: 8, padding: "0 4px 6px", fontSize: 10, fontWeight: 600, color: K.t3, textTransform: "uppercase", letterSpacing: 1 }}>
        <div style={{ width: 24 }}>#</div>
        <div style={{ width: 140 }}>Team Name</div>
        <div style={{ flex: 1 }}>Player 1</div>
        <div style={{ flex: 1 }}>Player 2</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", background: K.card, borderRadius: 8, border: `1px solid ${K.bdr}`, padding: "8px 8px" }}>
            <div style={{ width: 24, fontSize: 13, fontWeight: 700, color: K.t3, textAlign: "center", flexShrink: 0 }}>{i + 1}</div>
            <input
              value={r.name}
              onChange={e => { const next = [...rows]; next[i].name = e.target.value; setRows(next); setDirty(true); }}
              placeholder="Auto"
              style={{ width: 140, padding: "8px 6px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, fontWeight: 600, flexShrink: 0 }}
            />
            <select value={r.player1} onChange={e => updateRow(i, "player1", e.target.value)} style={selectStyle}>
              <option value="">— Select —</option>
              {avail(r.player1).map(p => <option key={p.id} value={p.id}>{shortName(p)}</option>)}
            </select>
            <select value={r.player2} onChange={e => updateRow(i, "player2", e.target.value)} style={selectStyle}>
              <option value="">— Select —</option>
              {avail(r.player2).map(p => <option key={p.id} value={p.id}>{shortName(p)}</option>)}
            </select>
          </div>
        ))}
      </div>

      {dirty && (
        <button onClick={saveAll} disabled={saving} style={{ width: "100%", padding: 12, borderRadius: 8, background: K.act, border: "none", color: K.bg, fontSize: 14, fontWeight: 700, cursor: "pointer", marginTop: 12, opacity: saving ? .6 : 1 }}>
          {saving ? "Saving..." : "Save All Teams"}
        </button>
      )}
    </div>
  );
}


function AdminCourse({ course, saveCourseData, onBack }) {
  const [lc, setLc] = useState(course || { name: "", frontPars: [4,4,4,3,5,4,4,3,5], backPars: [4,3,5,4,4,4,5,3,4], frontHcps: [7,3,1,9,5,13,11,17,15], backHcps: [8,14,2,10,4,16,6,18,12], teeBoxes: [{ name: "White", color: "#e2e8f0", slope: 113, rating: 67 }] });
  const [dirty, setDirty] = useState(false);
  const upT = (ti, f, v) => { const t = [...lc.teeBoxes]; t[ti] = { ...t[ti], [f]: f === 'slope' || f === 'rating' ? parseFloat(v) || 0 : v }; setLc({ ...lc, teeBoxes: t }); setDirty(true); };

  // Store hole values in refs so editing never triggers re-render
  const holeRefs = useRef({});
  const getRef = (key, i) => {
    const k = `${key}_${i}`;
    if (!holeRefs.current[k]) holeRefs.current[k] = { current: null };
    return holeRefs.current[k];
  };

  // On save, read all ref values into state
  const saveWithRefs = async () => {
    const updated = { ...lc };
    ['frontPars', 'backPars', 'frontHcps', 'backHcps'].forEach(key => {
      updated[key] = Array.from({ length: 9 }, (_, i) => {
        const ref = getRef(key, i);
        return parseInt(ref.current?.value) || 0;
      });
    });
    setLc(updated);
    await saveCourseData(updated);
    setDirty(false);
  };

  const HoleRow = ({ label, dataKey, side }) => {
    const offset = side === 'front' ? 0 : 9;
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: K.t3, fontWeight: 600, marginBottom: 6 }}>{label}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ fontSize: 10, color: K.t3, fontWeight: 600 }}>{offset + i + 1}</div>
              <input
                ref={el => { getRef(dataKey, i).current = el; }}
                defaultValue={lc[dataKey][i]}
                onFocus={e => setTimeout(() => e.target.select(), 10)}
                type="text"
                inputMode="numeric"
                maxLength={2}
                className="hole-input"
                style={{ width: 42, height: 40, padding: "4px 2px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 16, textAlign: "center", fontWeight: 600 }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div onInput={() => { if (!dirty) setDirty(true); }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={onBack} />
        <span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Course Setup</span>
        <button onClick={saveWithRefs} style={{ background: dirty ? K.act : K.inp, border: dirty ? "none" : `1px solid ${K.bdr}`, borderRadius: 6, color: dirty ? K.bg : K.t3, fontSize: 13, padding: "7px 16px", cursor: dirty ? "pointer" : "default", fontWeight: 600, letterSpacing: .4, transition: "all .2s" }}>{dirty ? "Save" : "Saved"}</button>
      </div>
      <input value={lc.name} onChange={e => setLc({ ...lc, name: e.target.value })} placeholder="Course Name" style={{ width: "100%", maxWidth: 400, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14, marginBottom: 12 }} />
      <div className="scoring-grid">
      {['front', 'back'].map(s => (
        <div key={s} style={{ marginBottom: 12 }}>
          <SubLabel>{s === 'front' ? 'Front 9' : 'Back 9'}</SubLabel>
          <Card style={{ padding: 14 }}>
            <HoleRow label="Par" dataKey={s === 'front' ? 'frontPars' : 'backPars'} side={s} />
            <HoleRow label="Handicap" dataKey={s === 'front' ? 'frontHcps' : 'backHcps'} side={s} />
          </Card>
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


function AdminSchedule({ schedule, saveWeekSchedule, teams, leagueConfig, saveLeagueConfig, matchResults, onBack }) {
  const [step, setStep] = useState(schedule.length > 0 ? "view" : "setup");
  const [cfg, setCfg] = useState({
    dayOfWeek: leagueConfig.dayOfWeek || "Tuesday",
    startTime: leagueConfig.startTime || "4:28 PM",
    teeInterval: leagueConfig.teeInterval || 8,
    regularWeeks: leagueConfig.regularWeeks || 14,
    playoffWeeks: leagueConfig.playoffWeeks || 2,
    startDate: leagueConfig.startDate || "",
    alternateNines: leagueConfig.alternateNines !== false,
  });
  const [editWeek, setEditWeek] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [generating, setGenerating] = useState(false);

  const totalWeeks = cfg.regularWeeks + cfg.playoffWeeks;

  // Round-robin generator: each team plays every other team once
  const generateRoundRobin = (teamIds) => {
    const ids = [...teamIds];
    if (ids.length % 2 !== 0) ids.push(null); // bye
    const n = ids.length;
    const rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const matches = [];
      for (let i = 0; i < n / 2; i++) {
        const a = ids[i], b = ids[n - 1 - i];
        if (a && b) matches.push({ team1: a, team2: b });
      }
      rounds.push(matches);
      // Rotate: fix first, shift rest
      const last = ids.pop();
      ids.splice(1, 0, last);
    }
    return rounds;
  };

  // Standings-based matchups: 1v10, 2v9, 3v8, etc.
  const generateStandingsMatchups = () => {
    const pts = {};
    teams.forEach(t => { pts[t.id] = 0; });
    (matchResults || []).forEach(r => {
      if (pts[r.team1Id] !== undefined) pts[r.team1Id] += (r.team1Points || 0);
      if (pts[r.team2Id] !== undefined) pts[r.team2Id] += (r.team2Points || 0);
    });
    const sorted = Object.entries(pts).sort((a, b) => b[1] - a[1]).map(e => e[0]);
    const matches = [];
    for (let i = 0; i < Math.floor(sorted.length / 2); i++) {
      matches.push({ team1: sorted[i], team2: sorted[sorted.length - 1 - i] });
    }
    return matches;
  };

  const formatTeeTime = (baseTime, idx) => {
    const [timePart, ampm] = baseTime.split(' ');
    const [h, m] = timePart.split(':').map(Number);
    let mins = (ampm === 'PM' && h !== 12 ? h + 12 : h) * 60 + m + idx * cfg.teeInterval;
    const hr = Math.floor(mins / 60) % 12 || 12;
    const mn = mins % 60;
    const ap = Math.floor(mins / 60) >= 12 ? 'PM' : 'AM';
    return `${hr}:${String(mn).padStart(2, '0')} ${ap}`;
  };

  const getWeekDate = (weekIdx) => {
    if (!cfg.startDate) return "";
    const d = new Date(cfg.startDate + "T12:00:00");
    d.setDate(d.getDate() + weekIdx * 7);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const generate = async () => {
    if (teams.length < 2) return alert("Need at least 2 teams");
    if (!cfg.startDate) return alert("Set a season start date");
    setGenerating(true);

    const teamIds = teams.map(t => t.id);
    const rrRounds = generateRoundRobin(teamIds);
    const rrWeeks = Math.min(rrRounds.length, cfg.regularWeeks);

    for (let w = 0; w < totalWeeks; w++) {
      let matches;
      if (w < rrWeeks) {
        matches = rrRounds[w];
      } else if (w < cfg.regularWeeks) {
        // After round-robin: standings-based
        matches = generateStandingsMatchups();
      } else {
        // Playoffs: standings-based
        matches = generateStandingsMatchups();
      }
      const side = cfg.alternateNines ? (w % 2 === 0 ? 'front' : 'back') : 'front';
      await saveWeekSchedule({
        id: `${LEAGUE_ID}_w${w}`, week: w, matches, side,
        date: getWeekDate(w),
        isPlayoff: w >= cfg.regularWeeks,
      });
    }

    // Save season config
    await saveLeagueConfig({ ...leagueConfig, ...cfg, totalWeeks });
    setGenerating(false);
    setStep("view");
  };

  // Drag reorder for a week's matches
  const moveMatch = async (weekData, fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    const matches = [...weekData.matches];
    const [moved] = matches.splice(fromIdx, 1);
    matches.splice(toIdx, 0, moved);
    await saveWeekSchedule({ ...weekData, matches });
  };

  const gn = (id) => teams.find(t => t.id === id)?.name || "TBD";
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  // ── Setup wizard ──
  if (step === "setup") {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <BackBtn onClick={onBack} />
          <span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Season Setup</span>
          <div style={{ width: 60 }} />
        </div>

        <div className="scoring-grid">
          <div>
            <SubLabel>Schedule</SubLabel>
            <Card style={{ padding: 14 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>League Day</div>
                <select value={cfg.dayOfWeek} onChange={e => setCfg({ ...cfg, dayOfWeek: e.target.value })} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }}>
                  {days.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Season Start Date</div>
                <input type="date" value={cfg.startDate} onChange={e => setCfg({ ...cfg, startDate: e.target.value })} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>First Tee Time</div>
                <input value={cfg.startTime} onChange={e => setCfg({ ...cfg, startTime: e.target.value })} placeholder="4:28 PM" style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Minutes Between Tee Times</div>
                <input type="number" value={cfg.teeInterval} onChange={e => setCfg({ ...cfg, teeInterval: parseInt(e.target.value) || 8 })} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} />
              </div>
            </Card>
          </div>

          <div>
            <SubLabel>Season Format</SubLabel>
            <Card style={{ padding: 14 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Regular Season Weeks</div>
                <input type="number" value={cfg.regularWeeks} onChange={e => setCfg({ ...cfg, regularWeeks: parseInt(e.target.value) || 14 })} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Playoff Weeks</div>
                <input type="number" value={cfg.playoffWeeks} onChange={e => setCfg({ ...cfg, playoffWeeks: parseInt(e.target.value) || 2 })} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} />
              </div>
              <div style={{ fontSize: 12, color: K.t2, padding: "8px 0", borderTop: `1px solid ${K.bdr}30` }}>
                Total: <strong style={{ color: K.t1 }}>{totalWeeks} weeks</strong> ({cfg.regularWeeks} regular + {cfg.playoffWeeks} playoff)
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: K.t2, cursor: "pointer" }}>
                  <input type="checkbox" checked={cfg.alternateNines} onChange={e => setCfg({ ...cfg, alternateNines: e.target.checked })} style={{ accentColor: K.act }} />
                  Alternate front/back 9 each week
                </label>
              </div>
            </Card>
          </div>
        </div>

        <div style={{ fontSize: 12, color: K.t3, margin: "16px 0 8px", lineHeight: 1.6 }}>
          With {teams.length} teams, the round-robin takes {teams.length - 1} weeks. {cfg.regularWeeks > teams.length - 1 ? `The remaining ${cfg.regularWeeks - (teams.length - 1)} regular season weeks will be standings-based matchups (1st vs last, 2nd vs 2nd-to-last, etc).` : ""}
        </div>

        <button onClick={generate} disabled={generating || teams.length < 2} style={{ width: "100%", padding: 14, borderRadius: 10, background: K.act, border: "none", color: K.bg, fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: generating ? .6 : 1, marginTop: 8 }}>
          {generating ? "Generating..." : "Generate Schedule"}
        </button>

        {schedule.length > 0 && (
          <button onClick={() => setStep("view")} style={{ width: "100%", padding: 10, borderRadius: 8, background: "none", border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 13, cursor: "pointer", marginTop: 8 }}>
            View Current Schedule
          </button>
        )}
      </div>
    );
  }

  // ── Week detail / edit view ──
  if (editWeek !== null) {
    const wk = schedule.find(s => s.week === editWeek);
    if (!wk) { setEditWeek(null); return null; }
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <BackBtn onClick={() => setEditWeek(null)} />
          <span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Week {wk.week + 1}{wk.date ? ` · ${wk.date}` : ""}</span>
          <Pill color={wk.side === 'front' ? K.acc : K.t2}>{wk.side === 'front' ? 'FRONT 9' : 'BACK 9'}</Pill>
        </div>
        <div style={{ fontSize: 11, color: K.t3, marginBottom: 12 }}>Drag matches to reorder tee times</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {wk.matches.map((m, mi) => (
            <div
              key={mi}
              draggable
              onDragStart={() => setDragIdx(mi)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragIdx !== null) { moveMatch(wk, dragIdx, mi); setDragIdx(null); } }}
              style={{ background: dragIdx === mi ? K.cardHi : K.card, borderRadius: 10, border: `1px solid ${K.bdr}`, padding: "12px 14px", cursor: "grab", display: "flex", alignItems: "center", gap: 12, userSelect: "none" }}
            >
              <div style={{ color: K.t3, fontSize: 14, cursor: "grab" }}>⠿</div>
              <div style={{ width: 70, fontSize: 12, color: K.acc, fontWeight: 600 }}>{formatTeeTime(cfg.startTime || "4:28 PM", mi)}</div>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: K.t1 }}>{gn(m.team1)}</div>
              <div style={{ fontSize: 11, color: K.t3, fontWeight: 700 }}>vs</div>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: K.t1, textAlign: "right" }}>{gn(m.team2)}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={() => {
            const newSide = wk.side === 'front' ? 'back' : 'front';
            saveWeekSchedule({ ...wk, side: newSide });
          }} style={{ flex: 1, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 12, cursor: "pointer" }}>
            Flip to {wk.side === 'front' ? 'Back' : 'Front'} 9
          </button>
        </div>
      </div>
    );
  }

  // ── Schedule overview ──
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={onBack} />
        <span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Schedule</span>
        <button onClick={() => setStep("setup")} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 8, color: K.acc, fontSize: 11, padding: "6px 12px", cursor: "pointer", fontWeight: 600 }}>Edit Setup</button>
      </div>
      {!schedule.length ? (
        <div style={{ textAlign: "center", padding: 30, color: K.t3, fontSize: 13 }}>No schedule yet. Set up teams, then configure the season.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {schedule.map(wk => {
            const isPlayoff = wk.isPlayoff || wk.week >= (leagueConfig.regularWeeks || 14);
            return (
              <button key={wk.week} onClick={() => setEditWeek(wk.week)} style={{ background: K.card, borderRadius: 10, padding: "10px 14px", border: `1px solid ${K.bdr}`, cursor: "pointer", textAlign: "left", width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 12, color: isPlayoff ? K.warn : K.t1 }}>
                    Week {wk.week + 1}{wk.date ? ` · ${wk.date}` : ""}
                  </span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <Pill color={wk.side === 'front' ? K.acc : K.t3} style={{ fontSize: 8 }}>{wk.side === 'front' ? 'F9' : 'B9'}</Pill>
                    {isPlayoff && <Pill color={K.warn} style={{ fontSize: 8 }}>PLAYOFF</Pill>}
                  </div>
                </div>
                {wk.matches.map((m, mi) => (
                  <div key={mi} style={{ fontSize: 11, color: K.t3, marginLeft: 4 }}>
                    {formatTeeTime(leagueConfig.startTime || cfg.startTime || "4:28 PM", mi)} — {gn(m.team1)} vs {gn(m.team2)}
                  </div>
                ))}
              </button>
            );
          })}
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><BackBtn onClick={onBack} /><span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Scoring Rules</span><SaveBtn onClick={save} /></div>
      <div className="scoring-grid">
        <div><SubLabel>Handicap Calculation</SubLabel><Card style={{ padding: "2px 14px" }}><F label="Recent rounds to consider" field="hcpRecentCount" /><F label="Best rounds to average" field="hcpBestCount" /></Card></div>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><BackBtn onClick={onBack} /><span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Members</span><div style={{ width: 60 }} /></div>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><BackBtn onClick={onBack} /><span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>League Settings</span><SaveBtn onClick={save} /></div>
      <Card style={{ padding: 14 }}>
        <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>League Name</div><input value={lc.name} onChange={e => setLc({ ...lc, name: e.target.value })} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} /></div>
        <div><div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Season Year</div><input value={lc.year} onChange={e => setLc({ ...lc, year: parseInt(e.target.value) || 2026 })} type="number" style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} /></div>
      </Card>
    </div>
  );
}


