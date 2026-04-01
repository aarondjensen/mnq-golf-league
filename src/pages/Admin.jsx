import { useState, useEffect, useCallback } from "react";
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
  const [showInactive, setShowInactive] = useState(false);
  const nameRef = useCallback(node => { if (node) setTimeout(() => node.focus(), 50); }, [ed]);
  const tees = course?.teeBoxes?.map(t => t.name) || ["Blue", "Black", "White"];
  const save = async () => { if (!f.name.trim()) return; const id = ed === "new" ? `${LEAGUE_ID}_p${Date.now()}` : ed; await savePlayer({ id, name: f.name.trim(), handicapIndex: parseFloat(f.handicapIndex) || 0, teeBox: f.teeBox, status: "active" }); setEd(null); };
  const toggleStatus = async (p) => { await savePlayer({ ...p, status: p.status === "inactive" ? "active" : "inactive" }); };

  const activePlayers = players.filter(p => p.status !== "inactive");
  const inactivePlayers = players.filter(p => p.status === "inactive");

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
      <div className="players-grid">
        {activePlayers.map(p => (
          <Card key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
            <div><div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span><span style={{ fontSize: 14, fontWeight: 700, color: K.t1 }}>{p.handicapIndex}</span></div></div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => { setF({ name: p.name, handicapIndex: String(p.handicapIndex ?? ""), teeBox: p.teeBox || "Blue" }); setEd(p.id); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.acc, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>Edit</button>
              <button onClick={() => toggleStatus(p)} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.warn, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>Deactivate</button>
            </div>
          </Card>
        ))}
      </div>
      {inactivePlayers.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <button onClick={() => setShowInactive(!showInactive)} style={{ background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
            {showInactive ? "▾" : "▸"} Inactive Players ({inactivePlayers.length})
          </button>
          {showInactive && (
            <div className="players-grid" style={{ marginTop: 8 }}>
              {inactivePlayers.map(p => (
                <Card key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", opacity: .5 }}>
                  <div><div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span><span style={{ fontSize: 14, fontWeight: 700, color: K.t1 }}>{p.handicapIndex}</span><Pill color={K.t3} style={{ fontSize: 8 }}>INACTIVE</Pill></div></div>
                  <button onClick={() => toggleStatus(p)} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.grn, fontSize: 10, padding: "4px 8px", cursor: "pointer" }}>Reactivate</button>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function AdminTeams({ teams, saveTeam, players, onBack }) {
  const [ed, setEd] = useState(null);
  const [f, setF] = useState({ name: "", player1: "", player2: "" });
  const assigned = teams.flatMap(t => [t.player1, t.player2]);
  const avail = (c1, c2) => players.filter(p => p.status !== "inactive" && (!assigned.includes(p.id) || p.id === c1 || p.id === c2));
  const save = async () => { if (!f.name.trim() || !f.player1 || !f.player2) return; const id = ed === "new" ? `${LEAGUE_ID}_t${Date.now()}` : ed; await saveTeam({ id, ...f }); setEd(null); };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={onBack} /><span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Teams ({teams.length}/{TEAMS_COUNT})</span>
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
  const IC = ({ value, onChange }) => <input value={value}
    onChange={e => onChange(e.target.value)}
    onFocus={e => e.target.select()}
    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); const inputs = Array.from(document.querySelectorAll('.hole-input')); const idx = inputs.indexOf(e.target); if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus(); } }}
    type="text" inputMode="numeric" pattern="[0-9]*"
    className="hole-input"
    style={{ width: 38, padding: "6px 2px", borderRadius: 4, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, textAlign: "center", fontWeight: 600 }} />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><BackBtn onClick={onBack} /><span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Course Setup</span><SaveBtn onClick={save} /></div>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><BackBtn onClick={onBack} /><span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Schedule</span><button onClick={generate} style={{ background: K.act, border: "none", borderRadius: 8, color: K.bg, fontSize: 11, padding: "6px 12px", cursor: "pointer", fontWeight: 700 }}>Generate</button></div>
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


