import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { LEAGUE_ID } from "../firebase";
import { K, FONTS, CSS, I, Pill, BackBtn, SaveBtn, SectionTitle, SubLabel, Card, EmptyState,
  SEASON_WEEKS, REGULAR_WEEKS, TEAMS_COUNT, getTeeTime, getWeekSide, calcCourseHandicap, calcNineHandicap, calcLeagueHandicap,
  formatTeeTime as fmtTeeTimeUtil, LIST_GAP, CARD_RADIUS, lastNamesOnly } from "../theme";


export default function AdminView(props) {
  const { players, savePlayer, deletePlayer, teams, saveTeam, deleteTeam, schedule, saveWeekSchedule, course, saveCourseData, scoringRules, saveScoringRules, leagueConfig, saveLeagueConfig, members, saveMember, deleteMember } = props;
  const [sec, setSec] = useState(null);
  const sections = [
    { id: "config", label: "Basic Info", icon: "settings", desc: leagueConfig.name },
    { id: "players", label: "Players", icon: "user", desc: `${players.filter(p => p.status !== "inactive").length} active` },
    { id: "teams", label: "Teams", icon: "users", desc: `${teams.length} teams` },
    { id: "course", label: "Course Setup", icon: "mapPin", desc: course?.name || "Not set" },
    { id: "schedule", label: "Schedule", icon: "calendar", desc: `${schedule.length} weeks` },
    { id: "scoring", label: "Scoring Rules", icon: "ruler", desc: "Match & bonus points" },
    { id: "members", label: "Members / Auth", icon: "key", desc: `${members.length} linked accounts` },
  ];

  if (sec === "players") return <AdminPlayers players={players} savePlayer={savePlayer} deletePlayer={deletePlayer} course={course} members={members} saveMember={saveMember} onBack={() => setSec(null)} />;
  if (sec === "teams") return <AdminTeams teams={teams} saveTeam={saveTeam} players={players} onBack={() => setSec(null)} />;
  if (sec === "course") return <AdminCourse course={course} saveCourseData={saveCourseData} onBack={() => setSec(null)} />;
  if (sec === "schedule") return <AdminSchedule schedule={schedule} saveWeekSchedule={saveWeekSchedule} teams={teams} leagueConfig={leagueConfig} saveLeagueConfig={saveLeagueConfig} matchResults={props.matchResults} onBack={() => setSec(null)} />;
  if (sec === "scoring") return <AdminScoring scoring={scoringRules} saveScoringRules={saveScoringRules} leagueConfig={leagueConfig} saveLeagueConfig={saveLeagueConfig} onBack={() => setSec(null)} />;
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


function AdminPlayers({ players, savePlayer, deletePlayer, course, members, saveMember, onBack }) {
  const [ed, setEd] = useState(null);
  const [f, setF] = useState({ name: "", handicapIndex: "", teeBox: "Blue" });
  const [showInactive, setShowInactive] = useState(false);
  const nameRef = useCallback(node => { if (node) setTimeout(() => node.focus(), 50); }, [ed]);
  const tees = course?.teeBoxes?.map(t => t.name) || ["Blue", "Black", "White"];

  const getMember = (playerId) => (members || []).find(m => m.playerId === playerId);
  const isComm = (playerId) => getMember(playerId)?.isCommissioner === true;
  const toggleComm = async (playerId) => {
    const member = getMember(playerId);
    if (!member) return;
    await saveMember({ ...member, isCommissioner: !member.isCommissioner });
  };
  const save = async () => {
    if (!f.name.trim()) return;
    const id = ed === "new" ? `${LEAGUE_ID}_p${Date.now()}` : ed;
    await savePlayer({ id, name: f.name.trim(), handicapIndex: parseFloat(f.handicapIndex) || 0, teeBox: f.teeBox, status: "active" });
    setEd(null);
  };
  const toggleStatus = async (p) => { await savePlayer({ ...p, status: p.status === "inactive" ? "active" : "inactive" }); };

  const activePlayers = players.filter(p => p.status !== "inactive").sort((a, b) => a.name.localeCompare(b.name));
  const inactivePlayers = players.filter(p => p.status === "inactive").sort((a, b) => a.name.localeCompare(b.name));

  const isEditing = (id) => ed === id;

  const rowStyle = { display: "flex", alignItems: "center", background: K.card, borderRadius: 8, border: `1px solid ${K.bdr}`, padding: "6px 10px", gap: 8 };
  const inputStyle = { padding: "6px 8px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 };

  const PlayerRow = ({ p, inactive }) => {
    const editing = isEditing(p.id);
    return (
      <div style={{ ...rowStyle, opacity: inactive ? .5 : 1, border: editing ? `1.5px solid ${K.act}` : `1px solid ${K.bdr}` }}>
        {editing ? (
          <>
            <input ref={nameRef} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} style={{ ...inputStyle, width: 160, fontWeight: 600 }} />
            <input value={f.handicapIndex} onChange={e => setF({ ...f, handicapIndex: e.target.value })} type="number" step="0.1" style={{ ...inputStyle, width: 50, textAlign: "center" }} />
            <select value={f.teeBox} onChange={e => setF({ ...f, teeBox: e.target.value })} style={{ ...inputStyle, width: 70 }}>{tees.map(n => <option key={n} value={n}>{n}</option>)}</select>
            <div style={{ flex: 1 }} />
            <button onClick={save} style={{ background: K.act, border: "none", borderRadius: 6, color: K.bg, fontSize: 11, padding: "6px 10px", cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap" }}>Save</button>
            <button onClick={() => setEd(null)} style={{ background: "none", border: "none", color: K.t3, fontSize: 11, cursor: "pointer", padding: "6px 4px" }}>✕</button>
          </>
        ) : (
          <>
            <div style={{ width: 160, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 5 }}>
              {p.name}
              {isComm(p.id) && <span style={{ fontSize: 8, fontWeight: 700, color: K.warn, background: K.warn + "18", padding: "1px 5px", borderRadius: 3, textTransform: "uppercase", letterSpacing: .5, flexShrink: 0 }}>Comm</span>}
            </div>
            <div style={{ width: 30, textAlign: "center", fontSize: 14, fontWeight: 700, color: K.t2 }}>{p.handicapIndex}</div>
            <div style={{ flex: 1 }} />
            {inactive ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Pill color={K.t3} style={{ fontSize: 8 }}>INACTIVE</Pill>
                <button onClick={() => toggleStatus(p)} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.grn, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>Reactivate</button>
                <button onClick={() => { if (confirm(`Permanently delete ${p.name}? This cannot be undone.`)) deletePlayer(p.id); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.red, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>Delete</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                {getMember(p.id) && (
                  <button onClick={() => toggleComm(p.id)} style={{ background: isComm(p.id) ? K.warn + "20" : K.inp, border: `1px solid ${isComm(p.id) ? K.warn + "40" : K.bdr}`, borderRadius: 6, color: isComm(p.id) ? K.warn : K.t3, fontSize: 10, padding: "4px 8px", cursor: "pointer", fontWeight: 600 }}>{isComm(p.id) ? "Revoke" : "Comm"}</button>
                )}
                <button onClick={() => { setF({ name: p.name, handicapIndex: String(p.handicapIndex ?? ""), teeBox: p.teeBox || "Blue" }); setEd(p.id); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.acc, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>Edit</button>
                <button onClick={() => { if (confirm(`Deactivate ${p.name}?`)) toggleStatus(p); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.warn, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>Deactivate</button>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={onBack} /><span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Players ({activePlayers.length} active)</span>
        <button onClick={() => { setF({ name: "", handicapIndex: "", teeBox: "Blue" }); setEd("new"); }} style={{ background: K.act, border: "none", borderRadius: 8, color: K.bg, fontSize: 11, padding: "6px 12px", cursor: "pointer", fontWeight: 700 }}>+ Add</button>
      </div>
      {ed === "new" && (
        <div style={{ ...rowStyle, border: `1.5px solid ${K.act}`, marginBottom: 8 }}>
          <input ref={nameRef} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Name" style={{ ...inputStyle, width: 160, fontWeight: 600 }} />
          <input value={f.handicapIndex} onChange={e => setF({ ...f, handicapIndex: e.target.value })} placeholder="HCP" type="number" step="0.1" style={{ ...inputStyle, width: 50, textAlign: "center" }} />
          <select value={f.teeBox} onChange={e => setF({ ...f, teeBox: e.target.value })} style={{ ...inputStyle, width: 70 }}>{tees.map(n => <option key={n} value={n}>{n}</option>)}</select>
          <div style={{ flex: 1 }} />
          <button onClick={save} style={{ background: K.act, border: "none", borderRadius: 6, color: K.bg, fontSize: 11, padding: "6px 10px", cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap" }}>Save</button>
          <button onClick={() => setEd(null)} style={{ background: "none", border: "none", color: K.t3, fontSize: 11, cursor: "pointer", padding: "6px 4px" }}>✕</button>
        </div>
      )}
      {/* Column header */}
      <div style={{ display: "flex", padding: "0 10px 4px", gap: 8, fontSize: 10, fontWeight: 600, color: K.t3, textTransform: "uppercase", letterSpacing: 1 }}>
        <div style={{ width: 160 }}>Name</div>
        <div style={{ width: 30, textAlign: "center" }}>HCP</div>
      </div>
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
        <button onClick={saveAll} style={{ background: dirty ? K.act : K.inp, border: dirty ? "none" : `1px solid ${K.bdr}`, borderRadius: 6, color: dirty ? K.bg : K.t3, fontSize: 13, padding: "7px 16px", cursor: dirty ? "pointer" : "default", fontWeight: 600, letterSpacing: .4, transition: "all .2s" }}>{saving ? "Saving..." : dirty ? "Save All" : "Saved"}</button>
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
    playoffRounds: leagueConfig.playoffRounds || [],
  });
  const [editWeek, setEditWeek] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragTeam, setDragTeam] = useState(null); // { matchIdx, slot: "team1"|"team2", teamId, ghostPos? }
  const dragTeamRef = useRef(null); // ref mirror for touch handlers (avoids stale closures)
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

  const formatTeeTime = (baseTime, idx) => fmtTeeTimeUtil(baseTime, idx, cfg.teeInterval);

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
      const weekNum = w + 1;
      const side = cfg.alternateNines ? (w % 2 === 0 ? 'front' : 'back') : 'front';
      const isPlayoff = w >= cfg.regularWeeks;

      if (w < rrWeeks) {
        // Round-robin weeks — fixed matchups
        await saveWeekSchedule({
          id: `${LEAGUE_ID}_w${weekNum}`, week: weekNum, matches: rrRounds[w], side,
          date: getWeekDate(w),
          isPlayoff: false,
        });
      } else {
        // Post-round-robin regular season or playoffs — seeded, TBD matchups
        await saveWeekSchedule({
          id: `${LEAGUE_ID}_w${weekNum}`, week: weekNum, matches: [], side,
          date: getWeekDate(w),
          isPlayoff,
          seeded: true,
        });
      }
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

  // Compute current seed (standings rank) for each team
  const seedMap = useMemo(() => {
    const pts = {};
    teams.forEach(t => { pts[t.id] = 0; });
    (matchResults || []).forEach(r => {
      if (pts[r.team1Id] !== undefined) pts[r.team1Id] += (r.team1Points || 0);
      if (pts[r.team2Id] !== undefined) pts[r.team2Id] += (r.team2Points || 0);
    });
    const sorted = Object.entries(pts).sort((a, b) => b[1] - a[1]);
    const map = {};
    sorted.forEach(([id], i) => { map[id] = i + 1; });
    return map;
  }, [teams, matchResults]);

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
                <input type="number" value={cfg.playoffWeeks} onChange={e => {
                  const pw = parseInt(e.target.value) || 0;
                  // Adjust playoffRounds array to match
                  const rounds = [...(cfg.playoffRounds || [])];
                  while (rounds.length < pw) rounds.push({ name: `Round ${rounds.length + 1}`, matchups: [] });
                  while (rounds.length > pw) rounds.pop();
                  setCfg({ ...cfg, playoffWeeks: pw, playoffRounds: rounds });
                }} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Seeded Regular Season Format</div>
                <div style={{ fontSize: 12, color: K.t2, padding: "8px 0", lineHeight: 1.6 }}>
                  Matchups by standings: #1 vs #{teams.length}, #2 vs #{teams.length - 1}, etc.
                </div>
              </div>
              {/* Season breakdown */}
              {teams.length >= 2 && (() => {
                const rrWeeks = teams.length - 1;
                const seededReg = Math.max(0, cfg.regularWeeks - rrWeeks);
                return (
                  <div style={{ fontSize: 12, color: K.t2, padding: "8px 0", borderTop: `1px solid ${K.bdr}30`, lineHeight: 1.8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Round-robin</span>
                      <span style={{ color: K.t1, fontWeight: 600 }}>{rrWeeks} weeks</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Seeded regular season</span>
                      <span style={{ color: K.t1, fontWeight: 600 }}>{seededReg} weeks</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Playoffs</span>
                      <span style={{ color: K.warn, fontWeight: 600 }}>{cfg.playoffWeeks} weeks</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${K.bdr}30`, paddingTop: 6, marginTop: 4 }}>
                      <span style={{ fontWeight: 600 }}>Total</span>
                      <span style={{ color: K.t1, fontWeight: 700 }}>{totalWeeks} weeks</span>
                    </div>
                  </div>
                );
              })()}
              <div style={{ marginTop: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: K.t2, cursor: "pointer" }}>
                  <input type="checkbox" checked={cfg.alternateNines} onChange={e => setCfg({ ...cfg, alternateNines: e.target.checked })} style={{ accentColor: K.act }} />
                  Alternate front/back 9 each week
                </label>
              </div>
            </Card>
          </div>

          {cfg.playoffWeeks > 0 && (
          <div>
            <SubLabel color={K.warn}>Playoff Bracket</SubLabel>
            {(cfg.playoffRounds || []).map((round, ri) => {
              const roundWeekNum = cfg.regularWeeks + ri + 1;
              const prevRound = ri > 0 ? (cfg.playoffRounds || [])[ri - 1] : null;
              const prevWinnerCount = prevRound ? prevRound.matchups.length : 0;
              const seedOptions = Array.from({ length: teams.length }, (_, i) => i + 1);

              const updateRound = (field, val) => {
                const rounds = [...(cfg.playoffRounds || [])];
                rounds[ri] = { ...rounds[ri], [field]: val };
                setCfg({ ...cfg, playoffRounds: rounds });
              };
              const addMatchup = () => {
                const m = [...round.matchups, { s1: "", s2: "", s1type: "seed", s2type: "seed" }];
                updateRound("matchups", m);
              };
              const removeMatchup = (mi) => {
                const m = [...round.matchups]; m.splice(mi, 1);
                updateRound("matchups", m);
              };
              const updateMatchup = (mi, field, val) => {
                const m = [...round.matchups];
                m[mi] = { ...m[mi], [field]: val };
                updateRound("matchups", m);
              };

              const selectStyle = { padding: "6px 4px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 12, flex: 1 };

              return (
                <Card key={ri} style={{ padding: 12, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <input value={round.name} onChange={e => updateRound("name", e.target.value)} style={{ padding: "4px 8px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.warn, fontSize: 13, fontWeight: 700, flex: 1, maxWidth: 200 }} />
                    <span style={{ fontSize: 10, color: K.t3 }}>Week {roundWeekNum}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {round.matchups.map((mu, mi) => (
                      <div key={mi} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {/* Seed 1 */}
                        <select value={mu.s1type} onChange={e => updateMatchup(mi, "s1type", e.target.value)} style={{ ...selectStyle, flex: "none", width: 55 }}>
                          <option value="seed">Seed</option>
                          {ri > 0 && <option value="winner">Winner</option>}
                        </select>
                        {mu.s1type === "seed" ? (
                          <select value={mu.s1} onChange={e => updateMatchup(mi, "s1", parseInt(e.target.value) || "")} style={selectStyle}>
                            <option value="">—</option>
                            {seedOptions.map(s => <option key={s} value={s}>#{s}</option>)}
                          </select>
                        ) : (
                          <select value={mu.s1} onChange={e => updateMatchup(mi, "s1", e.target.value)} style={selectStyle}>
                            <option value="">—</option>
                            <option value="lowestWinner">Lowest winner</option>
                            <option value="nextLowestWinner">Next lowest</option>
                            {prevWinnerCount > 0 && Array.from({ length: prevWinnerCount }, (_, i) => (
                              <option key={i} value={`winner_${i}`}>Winner match {i + 1}</option>
                            ))}
                          </select>
                        )}
                        <span style={{ fontSize: 11, color: K.t3, fontWeight: 700, flexShrink: 0 }}>vs</span>
                        {/* Seed 2 */}
                        <select value={mu.s2type} onChange={e => updateMatchup(mi, "s2type", e.target.value)} style={{ ...selectStyle, flex: "none", width: 55 }}>
                          <option value="seed">Seed</option>
                          {ri > 0 && <option value="winner">Winner</option>}
                        </select>
                        {mu.s2type === "seed" ? (
                          <select value={mu.s2} onChange={e => updateMatchup(mi, "s2", parseInt(e.target.value) || "")} style={selectStyle}>
                            <option value="">—</option>
                            {seedOptions.map(s => <option key={s} value={s}>#{s}</option>)}
                          </select>
                        ) : (
                          <select value={mu.s2} onChange={e => updateMatchup(mi, "s2", e.target.value)} style={selectStyle}>
                            <option value="">—</option>
                            <option value="lowestWinner">Lowest winner</option>
                            <option value="nextLowestWinner">Next lowest</option>
                            {prevWinnerCount > 0 && Array.from({ length: prevWinnerCount }, (_, i) => (
                              <option key={i} value={`winner_${i}`}>Winner match {i + 1}</option>
                            ))}
                          </select>
                        )}
                        <button onClick={() => removeMatchup(mi)} style={{ background: "none", border: "none", color: K.t3, fontSize: 14, cursor: "pointer", padding: "0 4px", flexShrink: 0 }}>✕</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={addMatchup} style={{ width: "100%", padding: 8, borderRadius: 6, background: K.inp, border: `1px dashed ${K.bdr}`, color: K.t3, fontSize: 11, cursor: "pointer", marginTop: 8, fontWeight: 600 }}>+ Add Match</button>
                </Card>
              );
            })}
          </div>
          )}
        </div>

        <button onClick={generate} disabled={generating || teams.length < 2} style={{ width: "100%", padding: 14, borderRadius: 10, background: K.act, border: "none", color: K.bg, fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: generating ? .6 : 1, marginTop: 16 }}>
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
    const isFinalized = wk.locked || (matchResults || []).some(r => r.week === wk.week);
    const isRainedOut = wk.rainedOut === true;
    const isSeeded = wk.seeded === true && (!wk.matches || wk.matches.length === 0);
    const isPlayoff = wk.isPlayoff || wk.week > (leagueConfig.regularWeeks || 14);
    const regWeeks = leagueConfig.regularWeeks || 14;
    const playoffWeeks = leagueConfig.playoffWeeks || 2;
    const playoffRound = isPlayoff ? wk.week - regWeeks : 0; // 1 = play-in, 2 = quarters, etc.

    // Build current standings for seeding
    const buildStandingsForSeed = () => {
      const pts = {};
      teams.forEach(t => { pts[t.id] = { teamId: t.id, points: 0, w: 0, l: 0, t: 0, hw: 0, gp: 0 }; });
      (matchResults || []).forEach(r => {
        if (!r) return;
        // Only count locked weeks
        const rWeek = schedule.find(s => s.week === r.week);
        if (!rWeek || !rWeek.locked) return;
        if (pts[r.team1Id]) { pts[r.team1Id].points += (r.team1Points || 0); if (r.t1HolesWon !== undefined) pts[r.team1Id].hw += r.t1HolesWon; }
        if (pts[r.team2Id]) { pts[r.team2Id].points += (r.team2Points || 0); if (r.t2HolesWon !== undefined) pts[r.team2Id].hw += r.t2HolesWon; }
        const d = (r.team1Points || 0) - (r.team2Points || 0);
        if (d > 0) { if (pts[r.team1Id]) { pts[r.team1Id].w++; pts[r.team1Id].gp++; } if (pts[r.team2Id]) { pts[r.team2Id].l++; pts[r.team2Id].gp++; } }
        else if (d < 0) { if (pts[r.team1Id]) { pts[r.team1Id].l++; pts[r.team1Id].gp++; } if (pts[r.team2Id]) { pts[r.team2Id].w++; pts[r.team2Id].gp++; } }
        else { if (pts[r.team1Id]) { pts[r.team1Id].t++; pts[r.team1Id].gp++; } if (pts[r.team2Id]) { pts[r.team2Id].t++; pts[r.team2Id].gp++; } }
      });
      const isRecord = leagueConfig?.standingsMethod === "record";
      const arr = Object.values(pts);
      if (isRecord) {
        arr.sort((a, b) => {
          const aPct = a.gp ? (a.w + a.t * 0.5) / a.gp : 0;
          const bPct = b.gp ? (b.w + b.t * 0.5) / b.gp : 0;
          if (bPct !== aPct) return bPct - aPct;
          if (b.w !== a.w) return b.w - a.w;
          return a.l - b.l;
        });
      } else {
        arr.sort((a, b) => b.points - a.points || b.hw - a.hw);
      }
      return arr;
    };

    const handleSeedWeek = async () => {
      const standings = buildStandingsForSeed();
      const seeds = standings.map(s => s.teamId); // seeds[0] = #1 seed, etc.
      let matches = [];

      if (isPlayoff) {
        const playoffRounds = leagueConfig.playoffRounds || [];
        const roundDef = playoffRounds[playoffRound - 1];
        if (!roundDef || !roundDef.matchups || !roundDef.matchups.length) {
          alert("No playoff matchups configured for this round. Go to Schedule → Edit Setup to configure the playoff bracket.");
          return;
        }

        // Collect winners from previous playoff round if needed
        let prevWinners = [];
        if (playoffRound > 1) {
          const prevPlayoffWeek = schedule.find(s => s.week === regWeeks + playoffRound - 1);
          if (!prevPlayoffWeek || !prevPlayoffWeek.matches || prevPlayoffWeek.matches.length === 0) {
            alert(`Previous playoff round (Week ${regWeeks + playoffRound - 1}) has no matches yet. Seed that week first.`);
            return;
          }
          const prevResults = (matchResults || []).filter(r => r.week === prevPlayoffWeek.week);
          if (prevResults.length < prevPlayoffWeek.matches.length) {
            alert(`Previous playoff round (Week ${regWeeks + playoffRound - 1}) must be finalized first.`);
            return;
          }
          // Get winners in match order
          prevPlayoffWeek.matches.forEach((m, mi) => {
            const r = prevResults.find(pr => pr.team1Id === m.team1 && pr.team2Id === m.team2);
            if (r) {
              const d = (r.team1Points || 0) - (r.team2Points || 0);
              // Tie goes to higher seed (team1 is always higher seed)
              prevWinners.push(d >= 0 ? r.team1Id : r.team2Id);
            }
          });
        }

        // Resolve "winner" references
        const resolveSlot = (mu, side) => {
          const type = mu[side + "type"];
          const val = mu[side];
          if (type === "seed") {
            const seedIdx = parseInt(val) - 1;
            return seedIdx >= 0 && seedIdx < seeds.length ? seeds[seedIdx] : null;
          } else if (type === "winner") {
            if (val === "lowestWinner") {
              // Among prevWinners, find the one with the lowest ranking (highest seed index)
              const sorted = prevWinners.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => b.rank - a.rank);
              return sorted[0]?.id || null;
            } else if (val === "nextLowestWinner") {
              const sorted = prevWinners.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => b.rank - a.rank);
              return sorted[1]?.id || null;
            } else if (val?.startsWith("winner_")) {
              const idx = parseInt(val.split("_")[1]);
              return prevWinners[idx] || null;
            }
          }
          return null;
        };

        for (const mu of roundDef.matchups) {
          const t1 = resolveSlot(mu, "s1");
          const t2 = resolveSlot(mu, "s2");
          if (t1 && t2) matches.push({ team1: t1, team2: t2 });
        }

        if (matches.length !== roundDef.matchups.length) {
          alert("Could not resolve all matchups. Make sure previous rounds are finalized and bracket is configured correctly.");
          return;
        }
      } else {
        // Seeded regular season: 1vLast, 2v(Last-1), etc.
        for (let i = 0; i < Math.floor(seeds.length / 2); i++) {
          matches.push({ team1: seeds[i], team2: seeds[seeds.length - 1 - i] });
        }
      }

      if (!matches.length) { alert("Not enough data to seed this week."); return; }

      const roundName = isPlayoff
        ? ((leagueConfig.playoffRounds || [])[playoffRound - 1]?.name || `Playoff Round ${playoffRound}`)
        : "seeded matchups";
      if (!window.confirm(`Seed Week ${wk.week} (${roundName})?\n\n${matches.map(m => `${gn(m.team1)} vs ${gn(m.team2)}`).join('\n')}`)) return;

      await saveWeekSchedule({ ...wk, matches, seeded: false });
    };

    const handleRainOut = async () => {
      const isRoundRobin = wk.week <= regWeeks && !wk.seeded && !wk.isPlayoff;
      const msgDetail = isRoundRobin
        ? `Rain out Week ${wk.week}? This will:\n\n• Skip this week (no matches played)\n• Add a makeup week at the end of the round robin\n• Push all future dates forward one week`
        : `Rain out Week ${wk.week}? This will:\n\n• Skip this week\n• Push all future dates forward one week`;
      if (!window.confirm(msgDetail)) return;

      const year = leagueConfig?.year || new Date().getFullYear();
      const parseDate = (dateStr) => {
        if (!dateStr) return null;
        const d = new Date(`${dateStr}, ${year}`);
        return isNaN(d.getTime()) ? null : d;
      };
      const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      await saveWeekSchedule({ ...wk, rainedOut: true });

      if (isRoundRobin) {
        const rrWeeks = schedule.filter(s => s.week <= regWeeks && !s.seeded && !s.isPlayoff && !s.rainedOut && s.week !== wk.week);
        const lastRRWeek = rrWeeks.length > 0 ? Math.max(...rrWeeks.map(s => s.week)) : wk.week;
        const insertAfter = lastRRWeek;
        const makeupWeekNum = insertAfter + 1;

        // Shift all weeks after insertAfter up by 1 (descending order to avoid collisions)
        const weeksToShift = schedule.filter(s => s.week > insertAfter).sort((a, b) => b.week - a.week);
        for (const fw of weeksToShift) {
          const newNum = fw.week + 1;
          let newDate = fw.date || "";
          const parsed = parseDate(fw.date);
          if (parsed) {
            parsed.setDate(parsed.getDate() + 7);
            newDate = fmtDate(parsed);
          }
          await saveWeekSchedule({ ...fw, id: `${LEAGUE_ID}_w${newNum}`, week: newNum, date: newDate });
        }

        // Determine makeup week date
        const lastRRWeekData = schedule.find(s => s.week === lastRRWeek);
        let makeupDate = "";
        const lastParsed = parseDate(lastRRWeekData?.date);
        if (lastParsed) {
          lastParsed.setDate(lastParsed.getDate() + 7);
          makeupDate = fmtDate(lastParsed);
        }
        const makeupSide = lastRRWeekData?.side === 'front' ? 'back' : 'front';

        await saveWeekSchedule({
          id: `${LEAGUE_ID}_w${makeupWeekNum}`,
          week: makeupWeekNum,
          matches: [...(wk.matches || [])],
          side: wk.side || makeupSide,
          date: makeupDate,
          makeupFor: wk.week,
        });
      } else {
        // Seeded/Playoff: just push future dates forward by 1 week
        const futureWeeks = schedule.filter(s => s.week > wk.week && !s.rainedOut);
        for (const fw of futureWeeks) {
          const parsed = parseDate(fw.date);
          if (parsed) {
            parsed.setDate(parsed.getDate() + 7);
            await saveWeekSchedule({ ...fw, date: fmtDate(parsed) });
          }
        }
      }

      setEditWeek(null);
    };

    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <BackBtn onClick={() => setEditWeek(null)} />
          <span style={{ fontSize: 16, fontWeight: 700, color: K.t1, flex: 1 }}>Week {wk.week}</span>
          {wk.date && <span style={{ fontSize: 12, color: K.t3 }}>{wk.date}</span>}
          <Pill color={K.logoBright}>{wk.side === 'front' ? 'FRONT 9' : 'BACK 9'}</Pill>
          {isPlayoff && <Pill color={K.warn}>PLAYOFF</Pill>}
        </div>

        {isRainedOut && (
          <div style={{ background: K.warn + "18", border: `1px solid ${K.warn}40`, borderRadius: 8, padding: "8px 12px", marginBottom: 10, textAlign: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: K.warn }}>Rained Out</span>
            {wk.makeupFor && <span style={{ fontSize: 11, color: K.t3, marginLeft: 6 }}>(Makeup for Week {wk.makeupFor})</span>}
            <div style={{ marginTop: 8 }}>
              <button onClick={async () => {
                if (!window.confirm(`Undo rain out for Week ${wk.week}? This will restore the week and remove the makeup week / reverse date shifts.`)) return;

                const isRoundRobin = wk.week <= regWeeks && !wk.seeded && !wk.isPlayoff;
                const year = leagueConfig?.year || new Date().getFullYear();
                const parseDate = (dateStr) => {
                  if (!dateStr) return null;
                  const d = new Date(`${dateStr}, ${year}`);
                  return isNaN(d.getTime()) ? null : d;
                };
                const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                // Un-mark the rain out
                await saveWeekSchedule({ ...wk, rainedOut: false });

                if (isRoundRobin) {
                  const makeupWeek = schedule.find(s => s.makeupFor === wk.week);
                  if (makeupWeek) {
                    await saveWeekSchedule({ ...makeupWeek, matches: [], rainedOut: true, makeupFor: null, removed: true });

                    const weeksToShift = schedule.filter(s => s.week > makeupWeek.week && s.week !== makeupWeek.week).sort((a, b) => a.week - b.week);
                    for (const fw of weeksToShift) {
                      const newNum = fw.week - 1;
                      let newDate = fw.date || "";
                      const parsed = parseDate(fw.date);
                      if (parsed) {
                        parsed.setDate(parsed.getDate() - 7);
                        newDate = fmtDate(parsed);
                      }
                      await saveWeekSchedule({ ...fw, id: `${LEAGUE_ID}_w${newNum}`, week: newNum, date: newDate });
                    }
                  }
                } else {
                  const futureWeeks = schedule.filter(s => s.week > wk.week && !s.rainedOut);
                  for (const fw of futureWeeks) {
                    const parsed = parseDate(fw.date);
                    if (parsed) {
                      parsed.setDate(parsed.getDate() - 7);
                      await saveWeekSchedule({ ...fw, date: fmtDate(parsed) });
                    }
                  }
                }

                setEditWeek(null);
              }} style={{ padding: "6px 16px", borderRadius: 6, background: K.card, border: `1px solid ${K.warn}40`, color: K.warn, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Undo Rain Out
              </button>
            </div>
          </div>
        )}

        {/* Seeded week — show seed button */}
        {isSeeded && !isRainedOut && (() => {
          const roundDef = isPlayoff ? (leagueConfig.playoffRounds || [])[playoffRound - 1] : null;
          const roundName = isPlayoff ? (roundDef?.name || `Playoff Round ${playoffRound}`) : "Seeded Matchups";
          const descParts = [];
          if (isPlayoff && roundDef?.matchups?.length) {
            roundDef.matchups.forEach(mu => {
              const s1Label = mu.s1type === "seed" ? `#${mu.s1}` : (mu.s1 === "lowestWinner" ? "Lowest winner" : mu.s1 === "nextLowestWinner" ? "Next lowest" : mu.s1?.startsWith("winner_") ? `Winner M${parseInt(mu.s1.split("_")[1]) + 1}` : "?");
              const s2Label = mu.s2type === "seed" ? `#${mu.s2}` : (mu.s2 === "lowestWinner" ? "Lowest winner" : mu.s2 === "nextLowestWinner" ? "Next lowest" : mu.s2?.startsWith("winner_") ? `Winner M${parseInt(mu.s2.split("_")[1]) + 1}` : "?");
              descParts.push(`${s1Label} vs ${s2Label}`);
            });
          }

          return (
            <div style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: CARD_RADIUS, padding: "16px", textAlign: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: K.t1, marginBottom: 4 }}>{roundName}</div>
              <div style={{ fontSize: 12, color: K.t3, marginBottom: 12, lineHeight: 1.5 }}>
                {isPlayoff && descParts.length > 0
                  ? descParts.join("  ·  ")
                  : isPlayoff
                  ? "No matchups configured — go to Edit Setup to build the bracket"
                  : `Matchups by standings: #1 vs #${teams.length}, #2 vs #${teams.length - 1}, etc.`
                }
              </div>
              <button onClick={handleSeedWeek} style={{ width: "100%", padding: 14, borderRadius: 10, background: K.act, border: "none", color: K.bg, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                Seed Week {wk.week}
              </button>
            </div>
          );
        })()}

        {/* Normal week — show matches */}
        {!isSeeded && !isRainedOut && (<>
          <div style={{ fontSize: 11, color: K.t3, marginBottom: 12 }}>
            {dragTeam && !dragTeam.dragging ? "Tap another team to swap" : "Tap to select · Hold and drag to move"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {wk.matches.map((m, mi) => {
              const seed1 = seedMap[m.team1] || "—";
              const seed2 = seedMap[m.team2] || "—";

              const doSwap = (srcInfo, targetInfo) => {
                if (srcInfo.teamId === targetInfo.teamId) return;
                const newMatches = wk.matches.map(mm => ({ ...mm }));
                const srcMatch = newMatches[srcInfo.matchIdx];
                const dstMatch = newMatches[targetInfo.matchIdx];
                const dstTeamId = dstMatch[targetInfo.slot];
                if (srcInfo.slot === "team1") srcMatch.team1 = dstTeamId;
                else srcMatch.team2 = dstTeamId;
                dstMatch[targetInfo.slot] = srcInfo.teamId;
                saveWeekSchedule({ ...wk, matches: newMatches });
              };

              const renderTeamCard = (teamId, seed, slot) => {
                const info = { matchIdx: mi, slot, teamId };
                const isSelected = dragTeam && dragTeam.teamId === teamId && !dragTeam.dragging;
                const isDragging = dragTeam && dragTeam.dragging && dragTeam.teamId === teamId;
                const isTarget = dragTeam && dragTeam.teamId !== teamId;

                // Compute transform offset if this card is being dragged
                const dx = isDragging ? (dragTeam.curX - dragTeam.startX) : 0;
                const dy = isDragging ? (dragTeam.curY - dragTeam.startY) : 0;

                return (
                  <div
                    data-team-card={JSON.stringify(info)}
                    onClick={() => {
                      if (dragTeam && dragTeam.dragging) return;
                      if (dragTeam) {
                        if (dragTeam.teamId !== teamId) doSwap(dragTeam, info);
                        setDragTeam(null); dragTeamRef.current = null;
                      } else {
                        setDragTeam(info); dragTeamRef.current = null;
                      }
                    }}
                    onTouchStart={(e) => {
                      const touch = e.touches[0];
                      const el = e.currentTarget;
                      el._lpMoved = false;
                      el._lpStartX = touch.clientX;
                      el._lpStartY = touch.clientY;
                      el._lpTimer = setTimeout(() => {
                        if (!el._lpMoved) {
                          const dt = { ...info, dragging: true, startX: touch.clientX, startY: touch.clientY, curX: touch.clientX, curY: touch.clientY };
                          dragTeamRef.current = dt;
                          setDragTeam(dt);
                          if (navigator.vibrate) navigator.vibrate(20);
                        }
                      }, 200);
                    }}
                    onTouchMove={(e) => {
                      const touch = e.touches[0];
                      const el = e.currentTarget;
                      if (!dragTeamRef.current) {
                        el._lpMoved = true;
                        clearTimeout(el._lpTimer);
                        return;
                      }
                      e.preventDefault();
                      dragTeamRef.current = { ...dragTeamRef.current, curX: touch.clientX, curY: touch.clientY };
                      setDragTeam({ ...dragTeamRef.current });
                    }}
                    onTouchEnd={(e) => {
                      clearTimeout(e.currentTarget._lpTimer);
                      const dt = dragTeamRef.current;
                      if (dt && dt.dragging) {
                        e.preventDefault();
                        const touch = e.changedTouches[0];
                        // Hide the dragged card so elementFromPoint hits the card underneath
                        const draggedEl = e.currentTarget;
                        draggedEl.style.pointerEvents = "none";
                        draggedEl.style.visibility = "hidden";
                        const hitEl = document.elementFromPoint(touch.clientX, touch.clientY);
                        draggedEl.style.pointerEvents = "";
                        draggedEl.style.visibility = "";
                        const targetCard = hitEl?.closest?.('[data-team-card]');
                        if (targetCard) {
                          try {
                            const target = JSON.parse(targetCard.getAttribute('data-team-card'));
                            doSwap(dt, target);
                          } catch {}
                        }
                        dragTeamRef.current = null;
                        setDragTeam(null);
                      }
                    }}
                    onTouchCancel={(e) => { clearTimeout(e.currentTarget._lpTimer); dragTeamRef.current = null; setDragTeam(null); }}
                    style={{
                      flex: 1, borderRadius: 8, padding: "8px 10px",
                      background: isSelected ? K.act + "20" : isDragging ? K.cardHi : isTarget ? K.act + "08" : K.inp,
                      border: isSelected ? `2px solid ${K.act}` : isDragging ? `2px solid ${K.act}` : isTarget ? `1.5px dashed ${K.act}50` : `1px solid ${K.bdr}`,
                      display: "flex", alignItems: "center", gap: 8,
                      cursor: "pointer",
                      touchAction: "none", WebkitUserSelect: "none", userSelect: "none",
                      // When dragging: lift the card, apply transform to follow finger
                      ...(isDragging ? {
                        position: "relative", zIndex: 100,
                        transform: `translate(${dx}px, ${dy}px) scale(1.05)`,
                        boxShadow: "0 8px 24px rgba(0,0,0,.3)",
                        transition: "box-shadow .1s",
                      } : {
                        transition: "background .15s, border .15s",
                      }),
                    }}
                  >
                    <div style={{
                      width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                      background: K.logoBright + "20", border: `1px solid ${K.logoBright}30`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 800, color: K.logoBright,
                    }}>{seed}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: K.t1, lineHeight: 1.3 }}>{lastNamesOnly(gn(teamId))}</div>
                  </div>
                );
              };

              return (
                <div key={mi} style={{ background: K.card, borderRadius: 10, border: `1px solid ${K.bdr}`, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, userSelect: "none" }}>
                  <div style={{ flexShrink: 0, fontSize: 10, color: K.acc, fontWeight: 700 }}>{formatTeeTime(cfg.startTime || "4:28 PM", mi).replace(/\s*(AM|PM)$/i, '')}</div>
                  {renderTeamCard(m.team1, seed1, "team1")}
                  <div style={{ fontSize: 10, color: K.t3, fontWeight: 800, flexShrink: 0 }}>VS</div>
                  {renderTeamCard(m.team2, seed2, "team2")}
                </div>
              );
            })}
          </div>
        </>)}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={() => {
            const newSide = wk.side === 'front' ? 'back' : 'front';
            saveWeekSchedule({ ...wk, side: newSide });
          }} style={{ flex: 1, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 12, cursor: "pointer" }}>
            Flip to {wk.side === 'front' ? 'Back' : 'Front'} 9
          </button>
        </div>

        {/* Rain Out button — any non-finalized, non-rained-out week */}
        {!isFinalized && !isRainedOut && (
          <button onClick={handleRainOut} style={{ width: "100%", padding: 12, borderRadius: 10, marginTop: 12, cursor: "pointer", background: K.warn + "15", border: `1.5px solid ${K.warn}50`, color: K.warn, fontSize: 14, fontWeight: 700 }}>
            Rain Out
          </button>
        )}
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
            const isRainedOut = wk.rainedOut === true;
            const isSeeded = wk.seeded === true && (!wk.matches || wk.matches.length === 0);
            return (
              <button key={wk.week} onClick={() => setEditWeek(wk.week)} style={{ background: K.card, borderRadius: 10, padding: "10px 14px", border: `1px solid ${isRainedOut ? K.warn + "40" : K.bdr}`, cursor: "pointer", textAlign: "left", width: "100%", opacity: isRainedOut ? 0.6 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 12, color: isRainedOut ? K.warn : isPlayoff ? K.warn : K.t1 }}>
                    Week {wk.week}{wk.date ? ` · ${wk.date}` : ""}
                  </span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {isRainedOut && <Pill color={K.warn} style={{ fontSize: 8 }}>RAIN</Pill>}
                    {wk.makeupFor && <Pill color={K.teal} style={{ fontSize: 8 }}>MAKEUP</Pill>}
                    <Pill color={wk.side === 'front' ? K.acc : K.t3} style={{ fontSize: 8 }}>{wk.side === 'front' ? 'F9' : 'B9'}</Pill>
                    {isSeeded && <Pill color={K.acc} style={{ fontSize: 8 }}>SEEDED</Pill>}
                    {isPlayoff && !isRainedOut && <Pill color={K.warn} style={{ fontSize: 8 }}>PLAYOFF</Pill>}
                  </div>
                </div>
                {isRainedOut ? (
                  <div style={{ fontSize: 11, color: K.warn, fontStyle: "italic", marginLeft: 4 }}>Rained out — rescheduled</div>
                ) : isSeeded ? (
                  <div style={{ fontSize: 11, color: K.t3, fontStyle: "italic", marginLeft: 4 }}>Matchups TBD — based on standings</div>
                ) : (
                  wk.matches.map((m, mi) => (
                    <div key={mi} style={{ fontSize: 11, color: K.t3, marginLeft: 4 }}>
                      {formatTeeTime(leagueConfig.startTime || cfg.startTime || "4:28 PM", mi)} — {gn(m.team1)} vs {gn(m.team2)}
                    </div>
                  ))
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


function AdminScoring({ scoring, saveScoringRules, leagueConfig, saveLeagueConfig, onBack }) {
  const [lc, setLc] = useState({ ...scoring });
  const [cfg, setCfg] = useState({ scoringFormat: "lowHighBonus", bonusType: "teamNetTotal", standingsMethod: "points", tiebreaker: "holesWon", ...leagueConfig });
  const [dirty, setDirty] = useState(false);
  const save = async () => {
    await saveScoringRules(lc);
    await saveLeagueConfig({ ...leagueConfig, scoringFormat: cfg.scoringFormat, bonusType: cfg.bonusType, standingsMethod: cfg.standingsMethod, tiebreaker: cfg.tiebreaker });
    setDirty(false);
  };
  const F = ({ label, field }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${K.bdr}15` }}>
      <span style={{ fontSize: 12, color: K.t2 }}>{label}</span>
      <input value={lc[field]} onChange={e => { setLc({ ...lc, [field]: parseFloat(e.target.value) || 0 }); setDirty(true); }} type="number" step="0.5" style={{ width: 58, padding: "5px 6px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, textAlign: "center" }} />
    </div>
  );

  const format = cfg.scoringFormat;
  const isLowHigh = format === "lowHighBonus";
  const isPoints = cfg.standingsMethod === "points";

  const Radio = ({ items, value, onChange }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
      {items.map(f => (
        <button key={f.id} onClick={() => { onChange(f.id); setDirty(true); }} style={{
          background: value === f.id ? K.act + "15" : K.card,
          border: `1.5px solid ${value === f.id ? K.act : K.bdr}`,
          borderRadius: 8, padding: "10px 12px", cursor: "pointer", textAlign: "left", width: "100%",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${value === f.id ? K.act : K.t3}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {value === f.id && <div style={{ width: 8, height: 8, borderRadius: "50%", background: K.act }} />}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: value === f.id ? K.t1 : K.t2 }}>{f.label}</div>
              {f.desc && <div style={{ fontSize: 10, color: K.t3, marginTop: 1 }}>{f.desc}</div>}
            </div>
          </div>
        </button>
      ))}
    </div>
  );

  const Dropdown = ({ label, value, onChange, options }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>{label}</div>
      <select value={value} onChange={e => { onChange(e.target.value); setDirty(true); }} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }}>
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={onBack} />
        <span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Scoring Rules</span>
        <button onClick={save} style={{ background: dirty ? K.act : K.inp, border: dirty ? "none" : `1px solid ${K.bdr}`, borderRadius: 6, color: dirty ? K.bg : K.t3, fontSize: 13, padding: "7px 16px", cursor: dirty ? "pointer" : "default", fontWeight: 600, letterSpacing: .4, transition: "all .2s" }}>{dirty ? "Save" : "Saved"}</button>
      </div>

      <SubLabel>Match Format</SubLabel>
      <Radio items={[
        { id: "lowHighBonus", label: "Low/High Match + Bonus", desc: "Low HCP match, high HCP match, plus a bonus category" },
        { id: "teamNetTotal", label: "Team Net Total", desc: "Combined team net vs combined team net — single match" },
      ]} value={format} onChange={v => setCfg({ ...cfg, scoringFormat: v })} />

      <SubLabel>Standings Method</SubLabel>
      <Radio items={[
        { id: "points", label: "Points-Based", desc: "Teams accumulate points each week — most points wins" },
        { id: "record", label: "Win-Loss-Tie Record", desc: "Standings by win percentage — like a traditional sports league" },
      ]} value={cfg.standingsMethod} onChange={v => setCfg({ ...cfg, standingsMethod: v })} />

      <SubLabel>Tiebreaker</SubLabel>
      <Dropdown label="When teams are tied in standings" value={cfg.tiebreaker} onChange={v => setCfg({ ...cfg, tiebreaker: v })} options={[
        { id: "holesWon", label: "Total Holes Won (season)" },
        { id: "headToHead", label: "Head-to-Head Matchup Result" },
      ]} />

      <div className="scoring-grid">
        <div>
          <SubLabel>Handicap Calculation</SubLabel>
          <Card style={{ padding: "2px 14px" }}>
            <F label="Recent rounds to consider" field="hcpRecentCount" />
            <F label="Best rounds to average" field="hcpBestCount" />
          </Card>
        </div>

        {isPoints ? (<>
          {isLowHigh ? (<>
            <div>
              <SubLabel>Low/High Match Points</SubLabel>
              <Card style={{ padding: "2px 14px" }}>
                <F label="Win" field="matchWin" />
                <F label="Tie" field="matchTie" />
                <F label="Loss" field="matchLoss" />
              </Card>
            </div>
            <div>
              <SubLabel>Bonus — Type</SubLabel>
              <Radio items={[
                { id: "teamNetTotal", label: "Team Net Total", desc: "Combined net of both teammates" },
                { id: "lowestNet", label: "Lowest Individual Net", desc: "Lowest single net score between all 4" },
                { id: "totalGross", label: "Total Gross", desc: "Combined gross of both teammates" },
              ]} value={cfg.bonusType || "teamNetTotal"} onChange={v => setCfg({ ...cfg, bonusType: v })} />
              <SubLabel>Bonus — Points</SubLabel>
              <Card style={{ padding: "2px 14px" }}>
                <F label="Win" field="totalNetBonusWin" />
                <F label="Tie" field="totalNetBonusTie" />
                <F label="Loss" field="totalNetBonusLoss" />
              </Card>
            </div>
          </>) : (
            <div>
              <SubLabel>Match Points</SubLabel>
              <Card style={{ padding: "2px 14px" }}>
                <F label="Win" field="matchWin" />
                <F label="Tie" field="matchTie" />
                <F label="Loss" field="matchLoss" />
              </Card>
            </div>
          )}

          <div>
            <SubLabel color={K.warn}>Playoff — Match</SubLabel>
            <Card style={{ padding: "2px 14px" }}>
              <F label="Win" field="playoffMatchWin" />
              <F label="Tie" field="playoffMatchTie" />
              <F label="Loss" field="playoffMatchLoss" />
            </Card>
          </div>

          {isLowHigh && (
            <div>
              <SubLabel color={K.warn}>Playoff — Bonus</SubLabel>
              <Card style={{ padding: "2px 14px" }}>
                <F label="Win" field="playoffBonusWin" />
                <F label="Tie" field="playoffBonusTie" />
                <F label="Loss" field="playoffBonusLoss" />
              </Card>
            </div>
          )}
        </>) : (
          <div>
            <Card style={{ padding: 14 }}>
              <div style={{ fontSize: 13, color: K.t2, lineHeight: 1.6 }}>
                {isLowHigh
                  ? "Each week has 3 results: low match, high match, and bonus. Each result is a W, L, or T added to the team's record."
                  : "Each week produces a single W, L, or T for each team based on combined team net."
                }
              </div>
            </Card>
          </div>
        )}
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
  const [dirty, setDirty] = useState(false);
  const save = async () => { await saveLeagueConfig(lc); setDirty(false); };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={onBack} />
        <span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Basic Info</span>
        <button onClick={save} style={{ background: dirty ? K.act : K.inp, border: dirty ? "none" : `1px solid ${K.bdr}`, borderRadius: 6, color: dirty ? K.bg : K.t3, fontSize: 13, padding: "7px 16px", cursor: dirty ? "pointer" : "default", fontWeight: 600, letterSpacing: .4, transition: "all .2s" }}>{dirty ? "Save" : "Saved"}</button>
      </div>
      <Card style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>League Name</div><input value={lc.name} onChange={e => { setLc({ ...lc, name: e.target.value }); setDirty(true); }} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} /></div>
        <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Season Year</div><input value={lc.year} onChange={e => { setLc({ ...lc, year: parseInt(e.target.value) || 2026 }); setDirty(true); }} type="number" style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} /></div>
        <div><div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Invite Code</div><input value={lc.inviteCode || ""} onChange={e => { setLc({ ...lc, inviteCode: e.target.value.toUpperCase() }); setDirty(true); }} placeholder="e.g. MNQ2026" style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14, letterSpacing: 2, textTransform: "uppercase" }} /><div style={{ fontSize: 10, color: K.t3, marginTop: 4 }}>New members must enter this code to join. Leave blank to allow anyone.</div></div>
      </Card>
    </div>
  );
}


