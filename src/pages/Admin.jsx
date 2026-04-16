import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { LEAGUE_ID } from "../firebase";
import { K, FONTS, I, Pill, BackBtn, SaveBtn, SectionTitle, SubLabel, Card, EmptyState,
  getTeeTime, getWeekSide, calcCourseHandicap, calcNineHandicap, calcLeagueHandicap,
  formatTeeTime as fmtTeeTimeUtil, LIST_GAP, CARD_RADIUS, lastNamesOnly } from "../theme";


export default function AdminView(props) {
  const { players, savePlayer, deletePlayer, teams, saveTeam, deleteTeam, schedule, saveWeekSchedule, setWeekSchedule, deleteWeekSchedule, course, saveCourseData, scoringRules, saveScoringRules, leagueConfig, saveLeagueConfig, members, saveMember, deleteMember } = props;
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
  if (sec === "schedule") return <AdminSchedule schedule={schedule} saveWeekSchedule={saveWeekSchedule} setWeekSchedule={setWeekSchedule} deleteWeekSchedule={deleteWeekSchedule} teams={teams} leagueConfig={leagueConfig} saveLeagueConfig={saveLeagueConfig} matchResults={props.matchResults} onBack={() => setSec(null)} />;
  if (sec === "scoring") return <AdminScoring scoring={scoringRules} saveScoringRules={saveScoringRules} leagueConfig={leagueConfig} saveLeagueConfig={saveLeagueConfig} onBack={() => setSec(null)} />;
  if (sec === "members") return <AdminMembers members={members} saveMember={saveMember} deleteMember={deleteMember} players={players} onBack={() => setSec(null)} />;
  if (sec === "config") return <AdminConfig config={leagueConfig} saveLeagueConfig={saveLeagueConfig} resetSeasonData={props.resetSeasonData} importHistoricalScores={props.importHistoricalScores} recalcHandicaps={props.recalcHandicaps} onBack={() => setSec(null)} />;

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
  const [orig, setOrig] = useState(null); // snapshot for dirty detection
  const [showInactive, setShowInactive] = useState(false);
  const nameRef = useCallback(node => { if (node) setTimeout(() => node.focus(), 50); }, [ed]);
  const teeBoxes = course?.teeBoxes || [{ name: "White", color: "#e2e8f0", slope: 113, rating: 67 }];
  const teeColor = (name) => (teeBoxes.find(t => t.name === name) || {}).color || K.bdr;
  const isWhiteTee = (name) => { const c = teeColor(name).toLowerCase(); return c === "#fff" || c === "#ffffff" || c === "#e2e8f0" || c === "white"; };

  const getMember = (playerId) => (members || []).find(m => m.playerId === playerId);
  const isComm = (playerId) => getMember(playerId)?.isCommissioner === true;
  const toggleComm = async (playerId) => {
    const member = getMember(playerId);
    if (!member) return;
    await saveMember({ ...member, isCommissioner: !member.isCommissioner });
  };

  const isDirty = orig && (f.name !== orig.name || f.teeBox !== orig.teeBox || (ed === "new"));
  const save = async () => {
    if (!f.name.trim()) return;
    const id = ed === "new" ? `${LEAGUE_ID}_p${Date.now()}` : ed;
    await savePlayer({ id, name: f.name.trim(), handicapIndex: parseFloat(f.handicapIndex) || 0, teeBox: f.teeBox, status: f.status || "active" });
    setEd(null); setOrig(null);
  };
  const toggleStatus = async (p) => { await savePlayer({ ...p, status: p.status === "inactive" ? "active" : "inactive" }); };
  const startEdit = (vals) => { setF(vals); setOrig({ ...vals }); };

  const activePlayers = players.filter(p => p.status !== "inactive").sort((a, b) => a.name.localeCompare(b.name));
  const inactivePlayers = players.filter(p => p.status === "inactive").sort((a, b) => a.name.localeCompare(b.name));

  const rowStyle = { display: "flex", alignItems: "center", background: K.card, borderRadius: 8, border: `1px solid ${K.bdr}`, padding: "8px 10px", gap: 8 };
  const inputStyle = { padding: "8px 10px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 16, width: "100%" };

  /* ── Edit Card (shared for new + existing) ── */
  const EditCard = ({ isNew }) => {
    const playerId = isNew ? null : ed;
    const member = playerId ? getMember(playerId) : null;
    const commStatus = playerId ? isComm(playerId) : false;
    return (
      <Card style={{ padding: "10px 12px", marginBottom: 8 }}>
        {/* Row 1: Name input + close */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input ref={nameRef} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Player name" style={{ ...inputStyle, padding: "7px 10px", fontWeight: 600 }} />
          <button onClick={() => { setEd(null); setOrig(null); }} style={{ background: "none", border: "none", color: K.t3, fontSize: 15, cursor: "pointer", padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>
        {/* Row 2: Tee box + Commissioner + Deactivate */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 4, flex: 1 }}>
            {teeBoxes.map(t => {
              const sel = f.teeBox === t.name;
              const white = isWhiteTee(t.name);
              return (
                <button key={t.name} onClick={() => setF({ ...f, teeBox: t.name })} style={{ flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: sel ? `1.5px solid ${white ? K.t3 : t.color}` : `1px solid ${K.bdr}`, background: sel ? (white ? K.t3 + "30" : t.color + "20") : K.inp, color: sel ? (white ? "#fff" : t.color) : K.t2 }}>{t.name}</button>
              );
            })}
          </div>
          {!isNew && member && (
            <button onClick={() => toggleComm(playerId)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 8px", borderRadius: 6, border: `1px solid ${commStatus ? K.warn + "40" : K.bdr}`, background: commStatus ? K.warn + "12" : K.inp, cursor: "pointer", flexShrink: 0 }}>
              <div style={{ width: 26, height: 14, borderRadius: 7, background: commStatus ? K.warn : K.bdr, position: "relative", transition: "background .2s" }}>
                <div style={{ width: 10, height: 10, borderRadius: 5, background: "#fff", position: "absolute", top: 2, left: commStatus ? 14 : 2, transition: "left .2s" }} />
              </div>
              <span style={{ fontSize: 9, color: commStatus ? K.warn : K.t3, fontWeight: 700 }}>Comm</span>
            </button>
          )}
          {!isNew && (
            <button onClick={() => { if (confirm(`Deactivate ${f.name}?`)) { toggleStatus(players.find(p => p.id === ed)); setEd(null); setOrig(null); } }} style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${K.red}30`, background: K.red + "10", color: K.red, fontSize: 9, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Deactivate</button>
          )}
        </div>
        {/* Row 3: Save */}
        <button onClick={isDirty ? save : undefined} style={{ width: "100%", padding: "8px 0", borderRadius: 6, background: isDirty ? K.act : K.inp, border: isDirty ? "none" : `1px solid ${K.bdr}`, color: isDirty ? K.bg : K.t3, fontSize: 12, fontWeight: 700, cursor: isDirty ? "pointer" : "default", letterSpacing: .5, transition: "all .2s" }}>{isDirty ? "Save" : "Saved"}</button>
      </Card>
    );
  };

  const PlayerRow = ({ p, inactive }) => (
    <div style={{ ...rowStyle, opacity: inactive ? .5 : 1 }}>
      <div style={{ flex: 1, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 5 }}>
        {p.name}
        {isComm(p.id) && <span style={{ fontSize: 8, fontWeight: 700, color: K.warn, background: K.warn + "18", padding: "1px 5px", borderRadius: 3, textTransform: "uppercase", letterSpacing: .5, flexShrink: 0 }}>Comm</span>}
      </div>
      <div style={{ width: 34, textAlign: "center", fontSize: 14, fontWeight: 700, color: K.t2 }}>{p.handicapIndex}</div>
      {inactive ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={() => toggleStatus(p)} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.grn, fontSize: 10, padding: "4px 8px", cursor: "pointer", fontWeight: 600 }}>Reactivate</button>
          <button onClick={() => { if (confirm(`Permanently delete ${p.name}? This cannot be undone.`)) deletePlayer(p.id); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.red, fontSize: 10, padding: "4px 8px", cursor: "pointer", fontWeight: 600 }}>Delete</button>
        </div>
      ) : (
        <button onClick={() => { startEdit({ name: p.name, handicapIndex: String(p.handicapIndex ?? ""), teeBox: p.teeBox || teeBoxes[0]?.name || "White", status: p.status || "active" }); setEd(p.id); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.acc, fontSize: 10, padding: "5px 10px", cursor: "pointer", fontWeight: 600 }}>Edit</button>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={onBack} /><span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Players ({activePlayers.length} active)</span>
        <button onClick={() => { startEdit({ name: "", handicapIndex: "", teeBox: teeBoxes[0]?.name || "White", status: "active" }); setEd("new"); }} style={{ background: K.act, border: "none", borderRadius: 8, color: K.bg, fontSize: 11, padding: "6px 12px", cursor: "pointer", fontWeight: 700 }}>+ Add</button>
      </div>
      {ed === "new" && <EditCard isNew />}
      {/* Column header */}
      <div style={{ display: "flex", padding: "0 10px 4px", gap: 8, fontSize: 10, fontWeight: 600, color: K.t3, textTransform: "uppercase", letterSpacing: 1 }}>
        <div style={{ flex: 1 }}>Name</div>
        <div style={{ width: 34, textAlign: "center" }}>HCP</div>
        <div style={{ width: 42 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {activePlayers.map(p => (
          <div key={p.id}>
            <PlayerRow p={p} />
            {ed === p.id && <div style={{ marginTop: 4 }}><EditCard /></div>}
          </div>
        ))}
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

  const [rows, setRows] = useState(() => {
    const teamCount = Math.max(teams.length, 2);
    const r = [];
    for (let i = 0; i < teamCount; i++) {
      const t = teams[i];
      r.push({ id: t?.id || `${LEAGUE_ID}_t${i + 1}`, name: t?.name || "", player1: t?.player1 || "", player2: t?.player2 || "" });
    }
    return r;
  });

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dragPlayer, setDragPlayer] = useState(null); // { playerId, source: { type: "pool" } | { type: "slot", teamIdx, slot } }
  const dragRef = useRef(null);

  const assignedIds = rows.flatMap(r => [r.player1, r.player2]).filter(Boolean);
  const unassigned = activePlayers.filter(p => !assignedIds.includes(p.id));

  const shortName = (p) => {
    if (!p) return "?";
    const parts = p.name.split(' ');
    return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : p.name;
  };

  const placePlayer = (playerId, teamIdx, slot) => {
    setRows(prev => {
      const next = prev.map(r => ({ ...r }));
      // Remove player from any existing slot
      next.forEach(r => {
        if (r.player1 === playerId) r.player1 = "";
        if (r.player2 === playerId) r.player2 = "";
      });
      // If the target slot is occupied, swap: put the displaced player where the dragged one came from
      const displaced = next[teamIdx][slot];
      if (displaced && dragRef.current?.source?.type === "slot") {
        const src = dragRef.current.source;
        next[src.teamIdx][src.slot] = displaced;
        const sp1 = src.slot === "player1" ? displaced : next[src.teamIdx].player1;
        const sp2 = src.slot === "player2" ? displaced : next[src.teamIdx].player2;
        next[src.teamIdx].name = buildName(sp1, sp2);
      }
      next[teamIdx][slot] = playerId;
      next[teamIdx].name = buildName(
        slot === "player1" ? playerId : next[teamIdx].player1,
        slot === "player2" ? playerId : next[teamIdx].player2,
      );
      return next;
    });
    setDirty(true);
  };

  const removeFromSlot = (teamIdx, slot) => {
    setRows(prev => {
      const next = prev.map(r => ({ ...r }));
      next[teamIdx][slot] = "";
      next[teamIdx].name = buildName(next[teamIdx].player1, next[teamIdx].player2);
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

  const handleBack = async () => {
    if (dirty) {
      const choice = window.confirm("You have unsaved changes. Save before leaving?");
      if (choice) await saveAll();
    }
    onBack();
  };

  // Find drop target from coordinates
  const findSlotTarget = (x, y) => {
    const els = document.querySelectorAll("[data-team-slot]");
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const [ti, sl] = el.dataset.teamSlot.split("-");
        return { teamIdx: parseInt(ti), slot: sl };
      }
    }
    return null;
  };

  // Drag chip component
  const PlayerChip = ({ playerId, source, style: extraStyle }) => {
    const p = players.find(pl => pl.id === playerId);
    if (!p) return null;
    const isDragging = dragPlayer?.playerId === playerId;
    return (
      <div
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "5px 10px", borderRadius: 6,
          background: isDragging ? K.act + "20" : K.card,
          border: `1px solid ${isDragging ? K.act : K.bdr}`,
          fontSize: 12, fontWeight: 600, color: K.t1,
          cursor: "grab", userSelect: "none",
          opacity: isDragging ? .5 : 1,
          transition: "opacity .1s",
          ...extraStyle,
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          const info = { playerId, source };
          dragRef.current = info;
          setDragPlayer(info);
          const onMove = (ev) => { dragRef.current = { ...dragRef.current, curX: ev.clientX, curY: ev.clientY }; };
          const onUp = (ev) => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            const target = findSlotTarget(ev.clientX, ev.clientY);
            if (target) placePlayer(playerId, target.teamIdx, target.slot);
            dragRef.current = null;
            setDragPlayer(null);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          const info = { playerId, source };
          dragRef.current = info;
          setDragPlayer(info);
          if (navigator.vibrate) navigator.vibrate(15);
          const onMove = (ev) => { ev.preventDefault(); };
          const onEnd = (ev) => {
            document.removeEventListener("touchmove", onMove);
            document.removeEventListener("touchend", onEnd);
            const t = ev.changedTouches[0];
            const target = findSlotTarget(t.clientX, t.clientY);
            if (target) placePlayer(playerId, target.teamIdx, target.slot);
            dragRef.current = null;
            setDragPlayer(null);
          };
          document.addEventListener("touchmove", onMove, { passive: false });
          document.addEventListener("touchend", onEnd);
        }}
      >
        <span style={{ fontSize: 10, color: K.t3 }}>{p.handicapIndex}</span>
        <span>{shortName(p)}</span>
      </div>
    );
  };

  // Slot in team row
  const Slot = ({ teamIdx, slot, playerId }) => {
    const isEmpty = !playerId;
    const isDropTarget = !!dragPlayer;
    return (
      <div
        data-team-slot={`${teamIdx}-${slot}`}
        style={{
          flex: 1, minHeight: 36, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
          background: isDropTarget ? K.act + "08" : K.inp,
          border: `1.5px dashed ${isDropTarget ? K.act + "50" : isEmpty ? K.bdr + "80" : "transparent"}`,
          ...(isEmpty ? {} : { border: `1px solid ${K.bdr}`, background: K.card }),
          transition: "all .15s",
        }}
      >
        {isEmpty ? (
          <span style={{ fontSize: 10, color: K.t3 + "80" }}>Drop here</span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}>
            <PlayerChip playerId={playerId} source={{ type: "slot", teamIdx, slot }} style={{ flex: 1, borderRadius: 4, border: "none", background: "transparent", padding: "4px 6px" }} />
            <button onClick={() => removeFromSlot(teamIdx, slot)} style={{ background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer", padding: "2px 4px", flexShrink: 0, lineHeight: 1 }}>✕</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={handleBack} />
        <span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Teams</span>
        <button onClick={saveAll} style={{ background: dirty ? K.act : K.inp, border: dirty ? "none" : `1px solid ${K.bdr}`, borderRadius: 6, color: dirty ? K.bg : K.t3, fontSize: 13, padding: "7px 16px", cursor: dirty ? "pointer" : "default", fontWeight: 600, letterSpacing: .4, transition: "all .2s" }}>{saving ? "Saving..." : dirty ? "Save All" : "Saved"}</button>
      </div>

      {/* Unassigned player pool */}
      {unassigned.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: K.t3, letterSpacing: 1, marginBottom: 6 }}>Unassigned ({unassigned.length})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {unassigned.map(p => <PlayerChip key={p.id} playerId={p.id} source={{ type: "pool" }} />)}
          </div>
        </div>
      )}

      {/* Header row */}
      <div style={{ display: "flex", gap: 6, padding: "0 4px 6px", fontSize: 10, fontWeight: 600, color: K.t3, letterSpacing: 1 }}>
        <div style={{ width: 24 }}>#</div>
        <div style={{ flex: 1 }}>Player 1</div>
        <div style={{ flex: 1 }}>Player 2</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", background: K.card, borderRadius: 8, border: `1px solid ${K.bdr}`, padding: "6px 8px" }}>
            <div style={{ width: 24, fontSize: 13, fontWeight: 700, color: K.t3, textAlign: "center", flexShrink: 0 }}>{i + 1}</div>
            <Slot teamIdx={i} slot="player1" playerId={r.player1} />
            <Slot teamIdx={i} slot="player2" playerId={r.player2} />
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

  const handleBack = async () => {
    if (dirty) {
      const choice = window.confirm("You have unsaved changes. Save before leaving?");
      if (choice) await saveWithRefs();
    }
    onBack();
  };

  return (
    <div onInput={() => { if (!dirty) setDirty(true); }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={handleBack} />
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


function AdminSchedule({ schedule, saveWeekSchedule, setWeekSchedule, deleteWeekSchedule, teams, leagueConfig, saveLeagueConfig, matchResults, onBack }) {
  const [step, setStep] = useState(schedule.length > 0 ? "view" : "setup");
  const [cfg, setCfg] = useState({
    dayOfWeek: leagueConfig.dayOfWeek || "Tuesday",
    startTime: leagueConfig.startTime || "4:28 PM",
    teeInterval: leagueConfig.teeInterval || 8,
    regularWeeks: leagueConfig.regularWeeks || 14,
    playoffWeeks: leagueConfig.playoffWeeks || 2,
    seededFormat: leagueConfig.seededFormat || "topBottom",
    startDate: leagueConfig.startDate || "",
    alternateNines: leagueConfig.alternateNines !== false,
    playoffRounds: leagueConfig.playoffRounds || [],
  });
  const [editWeek, setEditWeek] = useState(null);
  const [localWk, setLocalWk] = useState(null); // local edits for the week being edited
  const [weekDirty, setWeekDirty] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragTeam, setDragTeam] = useState(null); // { matchIdx, slot: "team1"|"team2", teamId, ghostPos? }
  const dragTeamRef = useRef(null); // ref mirror for touch handlers (avoids stale closures)
  const [generating, setGenerating] = useState(false);

  // Sync localWk when editWeek changes or schedule updates
  useEffect(() => {
    if (editWeek !== null) {
      const wk = schedule.find(s => s.week === editWeek);
      if (wk && !weekDirty) setLocalWk({ ...wk, matches: wk.matches?.map(m => ({ ...m })) || [] });
    } else {
      setLocalWk(null);
      setWeekDirty(false);
    }
  }, [editWeek, schedule]);

  const saveWeekEdits = async () => {
    if (localWk) {
      await saveWeekSchedule(localWk);
      setWeekDirty(false);
    }
  };

  const handleWeekBack = async () => {
    if (weekDirty) {
      const choice = window.confirm("You have unsaved changes. Save before leaving?");
      if (choice) await saveWeekEdits();
    }
    setEditWeek(null);
  };

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

    // Warn if there are finalized weeks
    const lockedWeeks = schedule.filter(s => s.locked);
    if (lockedWeeks.length > 0) {
      if (!window.confirm(`${lockedWeeks.length} week(s) have been finalized with scores. Regenerating will preserve their locked status but reset matchups.\n\nContinue?`)) return;
    }

    setGenerating(true);

    // Remember which weeks were locked so we can preserve that
    const lockedMap = {};
    schedule.forEach(s => { if (s.locked) lockedMap[s.week] = true; });

    // Delete all existing schedule documents to avoid stale/zombie data
    for (const existing of schedule) {
      if (existing.id) await deleteWeekSchedule(existing.id);
    }

    const teamIds = teams.map(t => t.id);
    const rrRounds = generateRoundRobin(teamIds);
    const rrWeeks = Math.min(rrRounds.length, cfg.regularWeeks);

    for (let w = 0; w < totalWeeks; w++) {
      const weekNum = w + 1;
      const side = cfg.alternateNines ? (w % 2 === 0 ? 'front' : 'back') : 'front';
      const isPlayoff = w >= cfg.regularWeeks;
      const wasLocked = lockedMap[weekNum] || false;

      if (w < rrWeeks) {
        await setWeekSchedule({
          id: `${LEAGUE_ID}_w${weekNum}`, week: weekNum, matches: rrRounds[w], side,
          date: getWeekDate(w), isPlayoff: false,
          ...(wasLocked ? { locked: true } : {}),
        });
      } else {
        await setWeekSchedule({
          id: `${LEAGUE_ID}_w${weekNum}`, week: weekNum, matches: [], side,
          date: getWeekDate(w), isPlayoff, seeded: true,
          ...(wasLocked ? { locked: true } : {}),
        });
      }
    }

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

  // ── Tab layout (setup / weekly / playoff) ──
  if (editWeek === null && (step === "setup" || step === "view" || step === "playoff")) {
    // Sub-tab within the schedule section
    const subTab = step === "setup" ? "setup" : step === "playoff" ? "playoff" : "weekly";
    const setSubTab = (t) => setStep(t === "weekly" ? "view" : t);

    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <BackBtn onClick={onBack} />
          <span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Schedule</span>
          <div style={{ width: 60 }} />
        </div>

        {/* 3-tab toggle */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <div style={{ display: "inline-flex", background: K.inp, borderRadius: 8, border: `1px solid ${K.bdr}`, padding: 3 }}>
            {[
              { id: "setup", label: "Setup" },
              { id: "weekly", label: "Weekly" },
              { id: "playoff", label: "Playoff" },
            ].map(t => (
              <button key={t.id} onClick={() => setSubTab(t.id)} style={{
                padding: "7px 14px", borderRadius: 6, border: "none", cursor: "pointer",
                background: subTab === t.id ? K.card : "transparent",
                color: subTab === t.id ? K.t1 : K.t3,
                fontSize: 11, fontWeight: 700, letterSpacing: .8,
                boxShadow: subTab === t.id ? `0 1px 3px ${K.bdr}40` : "none",
                transition: "all .15s",
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* ── SETUP TAB ── */}
        {subTab === "setup" && (<>
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
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {[
                    { id: "topBottom", label: "Top vs Bottom", desc: `#1 vs #${teams.length}, #2 vs #${teams.length - 1}, etc.` },
                    { id: "topHalfBottom", label: "Top Half vs Bottom Half", desc: `#1 vs #${Math.ceil(teams.length / 2) + 1}, #2 vs #${Math.ceil(teams.length / 2) + 2}, etc.` },
                    { id: "adjacent", label: "Adjacent Seeds", desc: "#1 vs #2, #3 vs #4, etc." },
                  ].map(opt => (
                    <button key={opt.id} onClick={() => setCfg({ ...cfg, seededFormat: opt.id })} style={{
                      display: "flex", flexDirection: "column", gap: 2, padding: "8px 10px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                      background: cfg.seededFormat === opt.id ? K.act + "15" : K.card,
                      border: `1.5px solid ${cfg.seededFormat === opt.id ? K.act + "50" : K.bdr}`,
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: cfg.seededFormat === opt.id ? K.act : K.t1 }}>{opt.label}</span>
                      <span style={{ fontSize: 10, color: K.t3 }}>{opt.desc}</span>
                    </button>
                  ))}
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
        </div>

        <button onClick={generate} disabled={generating || teams.length < 2} style={{ width: "100%", padding: 14, borderRadius: 10, background: K.act, border: "none", color: K.bg, fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: generating ? .6 : 1, marginTop: 16 }}>
          {generating ? "Generating..." : "Generate Schedule"}
        </button>
        </>)}

        {/* ── PLAYOFF TAB ── */}
        {subTab === "playoff" && (<>
          {cfg.playoffWeeks > 0 ? (<>
          <div className="scoring-grid">
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

              const selectStyle = { padding: "6px 4px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 12, flex: 1, minWidth: 0 };
              const typeStyle = { ...selectStyle, flex: "none", width: 52, fontSize: 11 };

              const SlotSelect = ({ type, val, onTypeChange, onValChange }) => (
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <select value={type} onChange={e => onTypeChange(e.target.value)} style={typeStyle}>
                    <option value="seed">Seed</option>
                    {ri > 0 && <option value="winner">Win</option>}
                    {ri > 0 && <option value="loser">Loss</option>}
                  </select>
                  {type === "seed" ? (
                    <select value={val} onChange={e => onValChange(parseInt(e.target.value) || "")} style={selectStyle}>
                      <option value="">—</option>
                      {seedOptions.map(s => <option key={s} value={s}>#{s}</option>)}
                    </select>
                  ) : type === "loser" ? (
                    <select value={val} onChange={e => onValChange(e.target.value)} style={selectStyle}>
                      <option value="">—</option>
                      <option value="highestLoser">High seed loser</option>
                      <option value="nextHighestLoser">2nd high loser</option>
                      {prevWinnerCount > 0 && Array.from({ length: prevWinnerCount }, (_, i) => (
                        <option key={i} value={`loser_${i}`}>Loser M{i + 1}</option>
                      ))}
                    </select>
                  ) : (
                    <select value={val} onChange={e => onValChange(e.target.value)} style={selectStyle}>
                      <option value="">—</option>
                      <option value="lowestWinner">Low winner</option>
                      <option value="lowestSeed">Low rem. seed</option>
                      <option value="nextLowestWinner">2nd low winner</option>
                      <option value="nextLowestSeed">2nd low seed</option>
                      {prevWinnerCount > 0 && Array.from({ length: prevWinnerCount }, (_, i) => (
                        <option key={i} value={`winner_${i}`}>Winner M{i + 1}</option>
                      ))}
                    </select>
                  )}
                </div>
              );

              return (
                <Card key={ri} style={{ padding: 12, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <input value={round.name} onChange={e => updateRound("name", e.target.value)} style={{ padding: "4px 8px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.warn, fontSize: 13, fontWeight: 700, flex: 1, maxWidth: 200 }} />
                    <span style={{ fontSize: 10, color: K.t3 }}>Week {roundWeekNum}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {round.matchups.map((mu, mi) => (
                      <div key={mi} style={{ background: K.inp, borderRadius: 8, padding: "8px 8px 8px 10px", border: `1px solid ${K.bdr}30` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <SlotSelect type={mu.s1type} val={mu.s1} onTypeChange={v => updateMatchup(mi, "s1type", v)} onValChange={v => updateMatchup(mi, "s1", v)} />
                          </div>
                          <button onClick={() => removeMatchup(mi)} style={{ background: "none", border: "none", color: K.t3, fontSize: 13, cursor: "pointer", padding: "0 2px", flexShrink: 0, lineHeight: 1 }}>✕</button>
                        </div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: K.t3, textAlign: "center", padding: "3px 0", letterSpacing: 1 }}>VS</div>
                        <SlotSelect type={mu.s2type} val={mu.s2} onTypeChange={v => updateMatchup(mi, "s2type", v)} onValChange={v => updateMatchup(mi, "s2", v)} />
                      </div>
                    ))}
                  </div>
                  <button onClick={addMatchup} style={{ width: "100%", padding: 8, borderRadius: 6, background: K.inp, border: `1px dashed ${K.bdr}`, color: K.t3, fontSize: 11, cursor: "pointer", marginTop: 8, fontWeight: 600 }}>+ Add Match</button>
                </Card>
              );
            })}
          </div>
          </div>

          {/* Bracket Preview */}
          {(cfg.playoffRounds || []).some(r => r.matchups?.length > 0) && (
          <div style={{ marginTop: 12 }}>
            <SubLabel color={K.warn}>Bracket Preview</SubLabel>
            <Card style={{ padding: 10 }}>
              {(() => {
                const rounds = cfg.playoffRounds || [];
                const slotLabel = (mu, side) => {
                  const type = mu[side + "type"];
                  const val = mu[side];
                  if (type === "seed") return val ? `#${val}` : "?";
                  if (type === "loser") {
                    if (val === "highestLoser") return "Hi L";
                    if (val === "nextHighestLoser") return "2nd L";
                    if (val?.startsWith("loser_")) return `L${parseInt(val.split("_")[1]) + 1}`;
                    return "L?";
                  }
                  if (val === "lowestWinner") return "Lo W";
                  if (val === "nextLowestWinner") return "Nxt W";
                  if (val === "lowestSeed") return "Lo S";
                  if (val === "nextLowestSeed") return "2nd S";
                  if (val?.startsWith("winner_")) return `W${parseInt(val.split("_")[1]) + 1}`;
                  return "?";
                };
                const badgeLetter = (mu, side) => { const t = mu[side + "type"]; return t === "seed" ? (mu[side] || "?") : t === "loser" ? "L" : "W"; };
                const badgeColor = (mu, side) => mu[side + "type"] === "loser" ? K.red : K.logoBright;
                const cardH = 44, baseGap = 6;
                return (
                  <div style={{ display: "flex", alignItems: "flex-start" }}>
                    {rounds.map((round, ri) => {
                      const mc = round.matchups?.length || 0;
                      const gap = ri === 0 ? baseGap : baseGap + (cardH + baseGap) * (Math.pow(2, ri) - 1);
                      const topPad = ri === 0 ? 0 : (gap - baseGap) / 2;
                      return (
                        <div key={ri} style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ textAlign: "center", marginBottom: 4, height: 28 }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: K.warn, letterSpacing: .8 }}>{round.name || `R${ri + 1}`}</div>
                            <div style={{ fontSize: 8, color: K.t3 }}>Wk {cfg.regularWeeks + ri + 1}</div>
                          </div>
                          <div style={{ paddingTop: topPad }}>
                            {mc > 0 ? (round.matchups || []).map((mu, mi) => (
                              <div key={mi} style={{ marginBottom: mi < mc - 1 ? gap : 0 }}>
                                <div style={{ display: "flex", alignItems: "center" }}>
                                  {ri > 0 && <div style={{ width: 8, height: 2, background: K.bdr + "50", flexShrink: 0 }} />}
                                  <div style={{ flex: 1, minWidth: 0, background: K.inp, borderRadius: 4, border: `1px solid ${K.bdr}`, overflow: "hidden" }}>
                                    {["s1", "s2"].map((side, si) => (
                                      <div key={side} style={{ display: "flex", alignItems: "center", padding: "3px 5px", gap: 4, ...(si === 0 ? { borderBottom: `1px solid ${K.bdr}30` } : {}) }}>
                                        <div style={{ width: 14, height: 14, borderRadius: 3, background: badgeColor(mu, side) + "20", border: `1px solid ${badgeColor(mu, side)}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 800, color: badgeColor(mu, side), flexShrink: 0 }}>{badgeLetter(mu, side)}</div>
                                        <div style={{ fontSize: 9, fontWeight: 600, color: K.t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slotLabel(mu, side)}</div>
                                      </div>
                                    ))}
                                  </div>
                                  {ri < rounds.length - 1 && (
                                    <div style={{ width: 8, flexShrink: 0, position: "relative", height: cardH }}>
                                      <div style={{ position: "absolute", top: "50%", left: 0, width: 4, height: 2, background: K.bdr + "50" }} />
                                      {(() => {
                                        const isTop = mi % 2 === 0, pairSize = (cardH + gap) / 2;
                                        if (isTop && mi + 1 < mc) return <><div style={{ position: "absolute", top: "50%", left: 4, width: 2, height: pairSize, background: K.bdr + "50" }} /><div style={{ position: "absolute", top: `calc(50% + ${pairSize}px)`, left: 4, width: 4, height: 2, background: K.bdr + "50" }} /></>;
                                        if (!isTop) return <div style={{ position: "absolute", bottom: "50%", left: 4, width: 2, height: pairSize, background: K.bdr + "50" }} />;
                                        if (mc === 1) return <div style={{ position: "absolute", top: "50%", left: 4, width: 4, height: 2, background: K.bdr + "50" }} />;
                                        return null;
                                      })()}
                                    </div>
                                  )}
                                  {ri === rounds.length - 1 && mc === 1 && (
                                    <div style={{ fontSize: 14, marginLeft: 6, flexShrink: 0 }}>🏆</div>
                                  )}
                                </div>
                              </div>
                            )) : <div style={{ background: K.inp, borderRadius: 4, border: `1px solid ${K.bdr}`, padding: 8, textAlign: "center", fontSize: 9, color: K.t3 }}>—</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </Card>
          </div>
          )}

          <div style={{ marginTop: 12 }}>
            <SubLabel color={K.teal}>Individual Tournament</SubLabel>
            <Card style={{ padding: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: K.t2, cursor: "pointer", marginBottom: 8 }}>
                <input type="checkbox" checked={cfg.individualEvent !== false} onChange={e => setCfg({ ...cfg, individualEvent: e.target.checked })} style={{ accentColor: K.act }} />
                Run individual net stroke play during playoffs
              </label>
              <div style={{ fontSize: 11, color: K.t3, lineHeight: 1.5 }}>
                All 20 players compete individually across {cfg.playoffWeeks} playoff rounds. Lowest cumulative net score wins.
              </div>
            </Card>
          </div>
          </>) : (
            <div style={{ textAlign: "center", padding: 30, color: K.t3, fontSize: 13 }}>Set playoff weeks in the Setup tab to configure the bracket.</div>
          )}
        </>)}

        {/* ── WEEKLY TAB ── */}
        {subTab === "weekly" && (<>
          {!schedule.length ? (
            <div style={{ textAlign: "center", padding: 30, color: K.t3, fontSize: 13 }}>No schedule yet. Generate one in the Setup tab.</div>
          ) : (<>
            {/* Shuffle button — only shows if no weeks are locked */}
            {(() => {
              const rrWeeks = schedule.filter(s => !s.isPlayoff && !s.seeded && !s.rainedOut && !s.makeupFor);
              const anyLocked = schedule.some(s => s.locked);
              if (anyLocked || rrWeeks.length < 2) return null;
              const doShuffle = async () => {
                if (!window.confirm("Shuffle the round-robin matchup order? This randomizes which week each matchup is played.")) return;
                // Collect all RR matchups and shuffle
                const matchups = rrWeeks.map(w => w.matches || []);
                for (let i = matchups.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [matchups[i], matchups[j]] = [matchups[j], matchups[i]];
                }
                // Save back with shuffled matchups
                for (let i = 0; i < rrWeeks.length; i++) {
                  await saveWeekSchedule({ ...rrWeeks[i], matches: matchups[i] });
                }
              };
              return (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                  <button onClick={doShuffle} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 8, color: K.acc, fontSize: 11, padding: "6px 12px", cursor: "pointer", fontWeight: 600 }}>
                    Shuffle Schedule
                  </button>
                </div>
              );
            })()}
            <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
              {schedule.map(wk => {
                const isPlayoffWk = wk.isPlayoff === true;
                const isRainedOut = wk.rainedOut === true;
                const isSeeded = wk.seeded === true && (!wk.matches || wk.matches.length === 0);
                const isFinalized = wk.locked === true;
                const side = wk.side || 'front';
                return (
                  <button key={wk.week} onClick={() => setEditWeek(wk.week)} style={{
                    display: "flex", alignItems: "center", width: "100%",
                    background: K.card, borderRadius: CARD_RADIUS,
                    border: `1px solid ${isRainedOut ? K.warn + "40" : K.bdr}`,
                    padding: "10px 14px", cursor: "pointer", textAlign: "left",
                    opacity: isRainedOut ? 0.5 : 1, gap: 8,
                  }}>
                    <div style={{ width: 26, fontSize: 14, fontWeight: 700, color: K.t1, flexShrink: 0 }}>{wk.week}</div>
                    <div style={{ width: 52, fontSize: 12, fontWeight: 600, color: K.t1, flexShrink: 0 }}>{wk.date || "—"}</div>
                    <div style={{ width: 42, flexShrink: 0 }}>
                      <Pill color={K.logoBright} style={{ fontSize: 8 }}>{side === 'front' ? 'FRONT' : 'BACK'}</Pill>
                    </div>
                    <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: isRainedOut ? K.warn : isSeeded ? K.t3 : K.t1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {isRainedOut ? "RAIN OUT" : isSeeded ? (isPlayoffWk ? "PLAYOFF — TBD" : "SEEDED — TBD") : wk.matches?.length ? (() => {
                        const isSeededFilled = wk.seeded === true || wk.makeupFor;
                        if (isSeededFilled) {
                          return wk.matches.map(m => `#${seedMap[m.team1] || "?"}v#${seedMap[m.team2] || "?"}`).join("  ");
                        }
                        return `${wk.matches.length} MATCHES`;
                      })() : "—"}
                    </div>
                    <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                      {isFinalized && <Pill color={K.grn} style={{ fontSize: 7 }}>FINAL</Pill>}
                      {wk.makeupFor && <Pill color={K.teal} style={{ fontSize: 7 }}>MU</Pill>}
                    </div>
                    <div style={{ color: K.t3, fontSize: 12, flexShrink: 0 }}>›</div>
                  </button>
                );
              })}
            </div>
          </>)}
        </>)}
      </div>
    );
  }

  // ── Week detail must be checked first — it takes priority over tabs ──
  if (editWeek !== null) {
    const wk = localWk || schedule.find(s => s.week === editWeek);
    if (!wk) { setEditWeek(null); return null; }
    const isFinalized = wk.locked || (matchResults || []).some(r => r.week === wk.week);
    const isRainedOut = wk.rainedOut === true;
    const isSeeded = wk.seeded === true && (!wk.matches || wk.matches.length === 0);
    const isPlayoff = wk.isPlayoff === true;
    const regWeeks = leagueConfig.regularWeeks || 14;
    const playoffWeeks = leagueConfig.playoffWeeks || 2;
    // Determine playoff round by counting playoff weeks up to and including this one
    const playoffRound = isPlayoff ? schedule.filter(s => s.isPlayoff === true && s.week <= wk.week).length : 0;

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
        let prevLosers = [];
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
          // Get winners and losers in match order
          prevPlayoffWeek.matches.forEach((m, mi) => {
            const r = prevResults.find(pr => pr.team1Id === m.team1 && pr.team2Id === m.team2);
            if (r) {
              const d = (r.team1Points || 0) - (r.team2Points || 0);
              // Tie goes to higher seed (team1 is always higher seed)
              prevWinners.push(d >= 0 ? r.team1Id : r.team2Id);
              prevLosers.push(d >= 0 ? r.team2Id : r.team1Id);
            }
          });
        }

        // Resolve "winner", "loser", and "seed" references
        const resolveSlot = (mu, side) => {
          const type = mu[side + "type"];
          const val = mu[side];
          if (type === "seed") {
            const seedIdx = parseInt(val) - 1;
            return seedIdx >= 0 && seedIdx < seeds.length ? seeds[seedIdx] : null;
          } else if (type === "winner") {
            if (val === "lowestWinner") {
              const sorted = prevWinners.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => b.rank - a.rank);
              return sorted[0]?.id || null;
            } else if (val === "nextLowestWinner") {
              const sorted = prevWinners.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => b.rank - a.rank);
              return sorted[1]?.id || null;
            } else if (val === "lowestSeed") {
              const sorted = prevWinners.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => b.rank - a.rank);
              return sorted[0]?.id || null;
            } else if (val === "nextLowestSeed") {
              const sorted = prevWinners.map(id => ({ id, rank: seeds.indexOf(id) })).sort((a, b) => b.rank - a.rank);
              return sorted[1]?.id || null;
            } else if (val?.startsWith("winner_")) {
              const idx = parseInt(val.split("_")[1]);
              return prevWinners[idx] || null;
            }
          } else if (type === "loser") {
            if (val === "highestLoser") {
              // Among losers, find the one with the best seed (lowest seed number)
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
        // Seeded regular season: format based on leagueConfig.seededFormat
        const format = leagueConfig.seededFormat || "topBottom";
        const n = seeds.length;
        const half = Math.ceil(n / 2);
        if (format === "topHalfBottom") {
          for (let i = 0; i < Math.floor(n / 2); i++) {
            matches.push({ team1: seeds[i], team2: seeds[half + i] });
          }
        } else if (format === "adjacent") {
          for (let i = 0; i < n - 1; i += 2) {
            matches.push({ team1: seeds[i], team2: seeds[i + 1] });
          }
        } else {
          // topBottom (default): #1 vs #Last, #2 vs #(Last-1), etc.
          for (let i = 0; i < Math.floor(n / 2); i++) {
            matches.push({ team1: seeds[i], team2: seeds[n - 1 - i] });
          }
        }
      }

      if (!matches.length) { alert("Not enough data to seed this week."); return; }

      const roundName = isPlayoff
        ? ((leagueConfig.playoffRounds || [])[playoffRound - 1]?.name || `Playoff Round ${playoffRound}`)
        : "seeded matchups";
      if (!window.confirm(`Seed Week ${wk.week} (${roundName})?\n\n${matches.map(m => `${gn(m.team1)} vs ${gn(m.team2)}`).join('\n')}`)) return;

      await saveWeekSchedule({ ...wk, matches });
    };

    const handleRainOut = async () => {
      // Determine if this week is round-robin by its schedule flags (not hardcoded team count)
      const isRoundRobin = !wk.isPlayoff && !wk.seeded && !wk.makeupFor;
      // Find the last RR/makeup-RR week number in the current schedule
      const lastRRWeekNum = Math.max(0, ...schedule.filter(s =>
        (!s.isPlayoff && !s.seeded && !s.makeupFor) || (s.makeupFor && !s.isPlayoff)
      ).map(s => s.week));

      const msgDetail = isRoundRobin
        ? `Rain out Week ${wk.week}? This will:\n\n• Skip this week (no matches played)\n• Insert a makeup week after week ${lastRRWeekNum} (end of round robin)\n• Push seeded/playoff weeks forward\n• Extend the season by one week`
        : `Rain out Week ${wk.week}? This will:\n\n• Skip this week\n• Same matchups will be played next week\n• All future weeks shift forward one week\n• Season extends by one week`;
      if (!window.confirm(msgDetail)) return;

      const year = leagueConfig?.year || new Date().getFullYear();
      const parseDate = (dateStr) => {
        if (!dateStr) return null;
        const d = new Date(`${dateStr}, ${year}`);
        return isNaN(d.getTime()) ? null : d;
      };
      const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      // Mark this week as rained out
      await saveWeekSchedule({ ...wk, rainedOut: true });

      if (isRoundRobin) {
        // Everything after the last RR week shifts up by 1 (process descending to avoid collisions)
        const weeksToShift = schedule.filter(s => s.week > lastRRWeekNum).sort((a, b) => b.week - a.week);
        for (const fw of weeksToShift) {
          const newNum = fw.week + 1;
          let newDate = fw.date || "";
          const parsed = parseDate(fw.date);
          if (parsed) {
            parsed.setDate(parsed.getDate() + 7);
            newDate = fmtDate(parsed);
          }
          await setWeekSchedule({ ...fw, id: `${LEAGUE_ID}_w${newNum}`, week: newNum, date: newDate });
        }

        // Insert makeup week right after the last RR week
        const makeupWeekNum = lastRRWeekNum + 1;
        const lastRRWeekData = schedule.find(s => s.week === lastRRWeekNum);
        let makeupDate = "";
        const lastParsed = parseDate(lastRRWeekData?.date);
        if (lastParsed) {
          lastParsed.setDate(lastParsed.getDate() + 7);
          makeupDate = fmtDate(lastParsed);
        }
        const makeupSide = lastRRWeekData?.side === 'front' ? 'back' : 'front';

        await setWeekSchedule({
          id: `${LEAGUE_ID}_w${makeupWeekNum}`,
          week: makeupWeekNum,
          matches: [...(wk.matches || [])],
          side: wk.side || makeupSide,
          date: makeupDate,
          makeupFor: wk.week,
        });
      } else {
        // Seeded or Playoff rain out:
        // The rained-out week's matchups get pushed to the next week.
        // All future weeks shift forward by 1 (week number + date).
        // Season extends by 1 week total.
        const futureWeeks = schedule.filter(s => s.week > wk.week && !s.rainedOut).sort((a, b) => b.week - a.week);
        for (const fw of futureWeeks) {
          const newNum = fw.week + 1;
          let newDate = fw.date || "";
          const parsed = parseDate(fw.date);
          if (parsed) {
            parsed.setDate(parsed.getDate() + 7);
            newDate = fmtDate(parsed);
          }
          await setWeekSchedule({ ...fw, id: `${LEAGUE_ID}_w${newNum}`, week: newNum, date: newDate });
        }

        // Write the rained-out week's matchups into the next week slot
        const nextWeekNum = wk.week + 1;
        let nextDate = wk.date || "";
        const wkParsed = parseDate(wk.date);
        if (wkParsed) {
          wkParsed.setDate(wkParsed.getDate() + 7);
          nextDate = fmtDate(wkParsed);
        }
        const nextSide = wk.side === 'front' ? 'back' : 'front';

        await setWeekSchedule({
          id: `${LEAGUE_ID}_w${nextWeekNum}`,
          week: nextWeekNum,
          matches: [...(wk.matches || [])],
          side: nextSide,
          date: nextDate,
          isPlayoff: wk.isPlayoff || false,
          seeded: wk.seeded || false,
        });
      }

      setEditWeek(null);
    };

    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <BackBtn onClick={handleWeekBack} />
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
                if (!window.confirm(`Undo rain out for Week ${wk.week}? This will restore the week and reverse all shifts.`)) return;

                const isRR = !wk.isPlayoff && !wk.seeded;
                const year = leagueConfig?.year || new Date().getFullYear();
                const parseDate = (dateStr) => {
                  if (!dateStr) return null;
                  const d = new Date(`${dateStr}, ${year}`);
                  return isNaN(d.getTime()) ? null : d;
                };
                const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                // Un-mark the rain out
                await saveWeekSchedule({ ...wk, rainedOut: false });

                // Find the week to remove:
                // - RR rain outs have a makeupFor-tagged week
                // - Seeded/playoff rain outs pushed matchups into wk.week + 1
                const makeupWeek = isRR
                  ? schedule.find(s => s.makeupFor === wk.week)
                  : schedule.find(s => s.week === wk.week + 1);

                if (makeupWeek) {
                  // Shift all weeks after the makeup/inserted week back down by 1 (ascending)
                  const weeksToShift = schedule.filter(s =>
                    s.week > makeupWeek.week
                  ).sort((a, b) => a.week - b.week);

                  for (const fw of weeksToShift) {
                    const newNum = fw.week - 1;
                    let newDate = fw.date || "";
                    const parsed = parseDate(fw.date);
                    if (parsed) {
                      parsed.setDate(parsed.getDate() - 7);
                      newDate = fmtDate(parsed);
                    }
                    await setWeekSchedule({ ...fw, id: `${LEAGUE_ID}_w${newNum}`, week: newNum, date: newDate });
                  }

                  // Delete the now-vacant last week doc
                  const lastShiftedWeek = weeksToShift.length > 0 ? weeksToShift[weeksToShift.length - 1].week : makeupWeek.week;
                  await deleteWeekSchedule(`${LEAGUE_ID}_w${lastShiftedWeek}`);
                  if (weeksToShift.length === 0) {
                    await deleteWeekSchedule(makeupWeek.id);
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

          // Build current seeded pairings preview
          const seedEntries = Object.entries(seedMap).sort((a, b) => a[1] - b[1]); // sorted by seed
          const getTeamBySeed = (seed) => {
            const entry = seedEntries.find(([, s]) => s === seed);
            return entry ? teams.find(t => t.id === entry[0]) : null;
          };

          let previewPairings = [];
          if (isPlayoff && roundDef?.matchups?.length) {
            roundDef.matchups.forEach((mu, i) => {
              const s1Label = mu.s1type === "seed" ? `#${mu.s1}` : (mu.s1 === "lowestWinner" ? "Lowest winner" : mu.s1 === "nextLowestWinner" ? "Next lowest" : mu.s1?.startsWith("winner_") ? `Winner M${parseInt(mu.s1.split("_")[1]) + 1}` : "?");
              const s2Label = mu.s2type === "seed" ? `#${mu.s2}` : (mu.s2 === "lowestWinner" ? "Lowest winner" : mu.s2 === "nextLowestWinner" ? "Next lowest" : mu.s2?.startsWith("winner_") ? `Winner M${parseInt(mu.s2.split("_")[1]) + 1}` : "?");
              const t1 = mu.s1type === "seed" ? getTeamBySeed(mu.s1) : null;
              const t2 = mu.s2type === "seed" ? getTeamBySeed(mu.s2) : null;
              previewPairings.push({
                label1: s1Label, label2: s2Label,
                name1: t1 ? lastNamesOnly(t1.name) : s1Label,
                name2: t2 ? lastNamesOnly(t2.name) : s2Label,
                seed1: mu.s1type === "seed" ? mu.s1 : null,
                seed2: mu.s2type === "seed" ? mu.s2 : null,
              });
            });
          } else {
            // Standard seeded: format based on leagueConfig setting
            const format = leagueConfig.seededFormat || "topBottom";
            const n = teams.length;
            const half = Math.ceil(n / 2);
            if (format === "topHalfBottom") {
              for (let i = 0; i < Math.floor(n / 2); i++) {
                const s1 = i + 1, s2 = half + i + 1;
                const t1 = getTeamBySeed(s1), t2 = getTeamBySeed(s2);
                previewPairings.push({ label1: `#${s1}`, label2: `#${s2}`, name1: t1 ? lastNamesOnly(t1.name) : `Seed #${s1}`, name2: t2 ? lastNamesOnly(t2.name) : `Seed #${s2}`, seed1: s1, seed2: s2 });
              }
            } else if (format === "adjacent") {
              for (let i = 0; i < n - 1; i += 2) {
                const s1 = i + 1, s2 = i + 2;
                const t1 = getTeamBySeed(s1), t2 = getTeamBySeed(s2);
                previewPairings.push({ label1: `#${s1}`, label2: `#${s2}`, name1: t1 ? lastNamesOnly(t1.name) : `Seed #${s1}`, name2: t2 ? lastNamesOnly(t2.name) : `Seed #${s2}`, seed1: s1, seed2: s2 });
              }
            } else {
              for (let i = 0; i < Math.floor(n / 2); i++) {
                const s1 = i + 1, s2 = n - i;
                const t1 = getTeamBySeed(s1), t2 = getTeamBySeed(s2);
                previewPairings.push({ label1: `#${s1}`, label2: `#${s2}`, name1: t1 ? lastNamesOnly(t1.name) : `Seed #${s1}`, name2: t2 ? lastNamesOnly(t2.name) : `Seed #${s2}`, seed1: s1, seed2: s2 });
              }
            }
          }

          return (
            <div style={{ marginBottom: 12 }}>
              <div style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: CARD_RADIUS, padding: "14px", marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: K.t1, marginBottom: 4, textAlign: "center" }}>{roundName}</div>
                <div style={{ fontSize: 10, color: K.t3, textAlign: "center", marginBottom: 10 }}>Current pairings based on standings</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {previewPairings.map((p, i) => (
                    <div key={i} style={{ background: K.card, borderRadius: 8, border: `1px solid ${K.bdr}`, padding: "8px 10px", display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: K.t1 }}>{p.name1}</span>
                        {p.seed1 && <div style={{ width: 20, height: 20, borderRadius: 5, background: K.logoBright + "20", border: `1px solid ${K.logoBright}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: K.logoBright, flexShrink: 0 }}>{p.seed1}</div>}
                      </div>
                      <div style={{ fontSize: 10, color: K.t3, fontWeight: 800, flexShrink: 0 }}>VS</div>
                      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                        {p.seed2 && <div style={{ width: 20, height: 20, borderRadius: 5, background: K.logoBright + "20", border: `1px solid ${K.logoBright}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: K.logoBright, flexShrink: 0 }}>{p.seed2}</div>}
                        <span style={{ fontSize: 12, fontWeight: 600, color: K.t1 }}>{p.name2}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={handleSeedWeek} style={{ width: "100%", padding: 14, borderRadius: 10, background: K.act, border: "none", color: K.bg, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                Seed Week {wk.week}
              </button>
            </div>
          );
        })()}

        {/* Normal week — show matches */}
        {!isSeeded && !isRainedOut && (<>
          {/* Action buttons — top of pairings */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            {!isFinalized && (
              <button onClick={handleRainOut} style={{ flex: 1, minWidth: 80, padding: 10, borderRadius: 8, background: K.red + "18", border: `1.5px solid ${K.red}50`, color: K.red, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Rain Out
              </button>
            )}
            <button onClick={() => {
              const newSide = wk.side === 'front' ? 'back' : 'front';
              setLocalWk({ ...wk, side: newSide });
              setWeekDirty(true);
            }} style={{ flex: 1, minWidth: 80, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 12, cursor: "pointer" }}>
              Change to {wk.side === 'front' ? 'Back' : 'Front'} 9
            </button>
            <button onClick={saveWeekEdits} style={{ padding: "10px 16px", borderRadius: 8, background: weekDirty ? K.act : K.inp, border: weekDirty ? "none" : `1px solid ${K.bdr}`, color: weekDirty ? K.bg : K.t3, fontSize: 12, fontWeight: 700, cursor: weekDirty ? "pointer" : "default", transition: "all .2s" }}>
              {weekDirty ? "Save" : "Saved"}
            </button>
          </div>
          {/* Re-seed button for seeded-type weeks (non-RR, non-makeup, or playoff) that aren't finalized */}
          {!isFinalized && (wk.isPlayoff || wk.seeded === true) && wk.matches?.length > 0 && (
            <button onClick={() => {
              if (!window.confirm("Re-seed this week from current standings? This will replace the current matchups.")) return;
              // Reset to seeded state so the Seed Week UI shows again
              saveWeekSchedule({ ...wk, matches: [], seeded: true });
              setLocalWk({ ...wk, matches: [], seeded: true });
            }} style={{ width: "100%", padding: 8, borderRadius: 8, marginBottom: 8, background: K.logoBright + "12", border: `1px solid ${K.logoBright}30`, color: K.logoBright, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              Re-seed from Standings
            </button>
          )}

          <div style={{ fontSize: 11, color: K.t3, marginBottom: 12 }}>
            {dragTeam && !dragTeam.dragging ? "Tap another team to swap" : "Tap to select · Hold and drag to move"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(() => {
              const doSwap = (srcInfo, targetInfo) => {
                if (srcInfo.teamId === targetInfo.teamId) return;
                const newMatches = wk.matches.map(mm => ({ ...mm }));
                const srcMatch = newMatches[srcInfo.matchIdx];
                const dstMatch = newMatches[targetInfo.matchIdx];
                const dstTeamId = dstMatch[targetInfo.slot];
                if (srcInfo.slot === "team1") srcMatch.team1 = dstTeamId;
                else srcMatch.team2 = dstTeamId;
                dstMatch[targetInfo.slot] = srcInfo.teamId;
                setLocalWk({ ...wk, matches: newMatches });
                setWeekDirty(true);
              };

              const findDropTarget = (tx, ty, draggedTeamId) => {
                const allCards = document.querySelectorAll('[data-team-card]');
                let best = null;
                allCards.forEach(card => {
                  try {
                    const ci = JSON.parse(card.getAttribute('data-team-card'));
                    if (ci.teamId === draggedTeamId) return;
                    const r = card.getBoundingClientRect();
                    if (tx >= r.left && tx <= r.right && ty >= r.top && ty <= r.bottom) best = ci;
                  } catch {}
                });
                return best;
              };

              return wk.matches.map((m, mi) => {
                const seed1 = seedMap[m.team1] || "—";
                const seed2 = seedMap[m.team2] || "—";

                const renderTeamCard = (teamId, seed, slot) => {
                  const info = { matchIdx: mi, slot, teamId };
                  const isSelected = dragTeam && dragTeam.teamId === teamId && !dragTeam.dragging;
                  const isDragging = dragTeam && dragTeam.dragging && dragTeam.teamId === teamId;
                  const isTarget = dragTeam && dragTeam.teamId !== teamId;
                  const dx = isDragging ? (dragTeam.curX - dragTeam.startX) : 0;
                  const dy = isDragging ? (dragTeam.curY - dragTeam.startY) : 0;

                  return (
                    <div
                      data-team-card={JSON.stringify(info)}
                      onClick={(e) => {
                        // Skip click if we just finished a mouse drag
                        if (e.currentTarget._mouseMoved) {
                          e.currentTarget._mouseMoved = false;
                          return;
                        }
                        if (dragTeam && dragTeam.dragging) return;
                        if (dragTeam) {
                          if (dragTeam.teamId !== teamId) {
                            doSwap(dragTeam, info);
                            setDragTeam({ matchIdx: info.matchIdx, slot: info.slot, teamId: dragTeam.teamId });
                          } else {
                            setDragTeam(null);
                          }
                          dragTeamRef.current = null;
                        } else {
                          setDragTeam(info); dragTeamRef.current = null;
                        }
                      }}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        const el = e.currentTarget;
                        el._mouseStartX = e.clientX;
                        el._mouseStartY = e.clientY;
                        el._mouseMoved = false;
                        el._mouseInfo = info;

                        const onMouseMove = (ev) => {
                          const dx2 = ev.clientX - el._mouseStartX;
                          const dy2 = ev.clientY - el._mouseStartY;
                          if (!el._mouseMoved && (Math.abs(dx2) > 4 || Math.abs(dy2) > 4)) {
                            el._mouseMoved = true;
                            const dt = { ...el._mouseInfo, dragging: true, startX: el._mouseStartX, startY: el._mouseStartY, curX: ev.clientX, curY: ev.clientY };
                            dragTeamRef.current = dt;
                            setDragTeam(dt);
                          }
                          if (el._mouseMoved && dragTeamRef.current) {
                            dragTeamRef.current = { ...dragTeamRef.current, curX: ev.clientX, curY: ev.clientY };
                            setDragTeam({ ...dragTeamRef.current });
                          }
                        };
                        const onMouseUp = (ev) => {
                          document.removeEventListener('mousemove', onMouseMove);
                          document.removeEventListener('mouseup', onMouseUp);
                          const dt = dragTeamRef.current;
                          if (dt && dt.dragging) {
                            const target = findDropTarget(ev.clientX, ev.clientY, dt.teamId);
                            if (target) {
                              doSwap(dt, target);
                              dragTeamRef.current = null;
                              setDragTeam({ matchIdx: target.matchIdx, slot: target.slot, teamId: dt.teamId });
                            } else {
                              dragTeamRef.current = null;
                              setDragTeam(null);
                            }
                          }
                        };
                        document.addEventListener('mousemove', onMouseMove);
                        document.addEventListener('mouseup', onMouseUp);
                      }}
                      onTouchStart={(e) => {
                        const touch = e.touches[0];
                        const el = e.currentTarget;
                        el._lpMoved = false;
                        el._lpTimer = setTimeout(() => {
                          if (!el._lpMoved) {
                            const dt = { ...info, dragging: true, startX: touch.clientX, startY: touch.clientY, curX: touch.clientX, curY: touch.clientY };
                            dragTeamRef.current = dt;
                            setDragTeam(dt);
                            if (navigator.vibrate) navigator.vibrate(20);

                            // Attach document-level listeners so drag tracks beyond card bounds
                            const onTouchMove2 = (ev) => {
                              const t2 = ev.touches[0];
                              if (!dragTeamRef.current) return;
                              ev.preventDefault();
                              dragTeamRef.current = { ...dragTeamRef.current, curX: t2.clientX, curY: t2.clientY };
                              setDragTeam({ ...dragTeamRef.current });
                            };
                            const onTouchEnd2 = (ev) => {
                              document.removeEventListener('touchmove', onTouchMove2, { passive: false });
                              document.removeEventListener('touchend', onTouchEnd2);
                              document.removeEventListener('touchcancel', onTouchCancel2);
                              const dt2 = dragTeamRef.current;
                              if (dt2 && dt2.dragging) {
                                ev.preventDefault();
                                const t2 = ev.changedTouches[0];
                                const target = findDropTarget(t2.clientX, t2.clientY, dt2.teamId);
                                if (target) {
                                  doSwap(dt2, target);
                                  dragTeamRef.current = null;
                                  setDragTeam({ matchIdx: target.matchIdx, slot: target.slot, teamId: dt2.teamId });
                                } else {
                                  dragTeamRef.current = null;
                                  setDragTeam(null);
                                }
                              }
                            };
                            const onTouchCancel2 = () => {
                              document.removeEventListener('touchmove', onTouchMove2, { passive: false });
                              document.removeEventListener('touchend', onTouchEnd2);
                              document.removeEventListener('touchcancel', onTouchCancel2);
                              dragTeamRef.current = null;
                              setDragTeam(null);
                            };
                            document.addEventListener('touchmove', onTouchMove2, { passive: false });
                            document.addEventListener('touchend', onTouchEnd2);
                            document.addEventListener('touchcancel', onTouchCancel2);
                          }
                        }, 200);
                      }}
                      onTouchMove={(e) => {
                        // Before long-press fires, any movement cancels it
                        if (!dragTeamRef.current) {
                          e.currentTarget._lpMoved = true;
                          clearTimeout(e.currentTarget._lpTimer);
                        }
                      }}
                      onTouchEnd={(e) => {
                        clearTimeout(e.currentTarget._lpTimer);
                      }}
                      onTouchCancel={(e) => { clearTimeout(e.currentTarget._lpTimer); }}
                      style={{
                        flex: 1, borderRadius: 8, padding: "8px 10px",
                        background: isSelected ? K.act + "20" : isDragging ? K.cardHi : isTarget ? K.act + "08" : K.inp,
                        border: isSelected ? `2px solid ${K.act}` : isDragging ? `2px solid ${K.act}` : isTarget ? `1.5px dashed ${K.act}50` : `1px solid ${K.bdr}`,
                        display: "flex", alignItems: "center", gap: 8,
                        cursor: "pointer",
                        touchAction: "none", WebkitUserSelect: "none", userSelect: "none",
                        ...(isDragging ? {
                          position: "relative", zIndex: 100,
                          transform: `translate(${dx}px, ${dy}px) scale(1.05)`,
                          boxShadow: "0 8px 24px rgba(0,0,0,.3)",
                        } : {}),
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
              });
            })()}
          </div>
        </>)}
      </div>
    );
  }
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

  const handleBack = async () => {
    if (dirty) {
      const choice = window.confirm("You have unsaved changes. Save before leaving?");
      if (choice) await save();
    }
    onBack();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={handleBack} />
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


function AdminConfig({ config, saveLeagueConfig, resetSeasonData, importHistoricalScores, recalcHandicaps, onBack }) {
  const [lc, setLc] = useState({ ...config });
  const [dirty, setDirty] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [recalcing, setRecalcing] = useState(false);
  const [recalcResult, setRecalcResult] = useState(null);
  const save = async () => { await saveLeagueConfig(lc); setDirty(false); };

  const handleBack = async () => {
    if (dirty) {
      const choice = window.confirm("You have unsaved changes. Save before leaving?");
      if (choice) await save();
    }
    onBack();
  };

  const handleReset = async () => {
    if (!window.confirm("Reset all season data?\n\nThis will permanently delete:\n• All hole scores\n• All match results\n• All CTP data\n• Unlock all weeks\n\nThis cannot be undone.")) return;
    if (!window.confirm("Are you sure? This will wipe ALL scores and results for the current season.")) return;
    setResetting(true);
    await resetSeasonData();
    setResetting(false);
  };

  const handleImportHistorical = async () => {
    if (!window.confirm("Import 2023 + 2024 + 2025 historical scores?\n\nThis will write ~7,500 hole scores across 45 weeks (3 seasons). Existing historical scores will be overwritten.")) return;
    setImporting(true);
    setImportResult(null);
    try {
      const { default: IMPORT_HISTORICAL } = await import("./importHistoricalData.js");
      const result = await importHistoricalScores(IMPORT_HISTORICAL);
      setImportResult(result);
    } catch (e) {
      console.error("Import error:", e);
      setImportResult({ error: e.message });
    }
    setImporting(false);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={handleBack} />
        <button onClick={save} style={{ background: dirty ? K.act : K.inp, border: dirty ? "none" : `1px solid ${K.bdr}`, borderRadius: 6, color: dirty ? K.bg : K.t3, fontSize: 13, padding: "7px 16px", cursor: dirty ? "pointer" : "default", fontWeight: 600, letterSpacing: .4, transition: "all .2s" }}>{dirty ? "Save" : "Saved"}</button>
      </div>
      <Card style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>League Name</div><input value={lc.name} onChange={e => { setLc({ ...lc, name: e.target.value }); setDirty(true); }} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} /></div>
        <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Season Year</div><input value={lc.year} onChange={e => { setLc({ ...lc, year: parseInt(e.target.value) || 2026 }); setDirty(true); }} type="number" style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} /></div>
        <div><div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Invite Code</div><input value={lc.inviteCode || ""} onChange={e => { setLc({ ...lc, inviteCode: e.target.value.toUpperCase() }); setDirty(true); }} placeholder="e.g. MNQ2026" style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14, letterSpacing: 2, textTransform: "uppercase" }} /><div style={{ fontSize: 10, color: K.t3, marginTop: 4 }}>New members must enter this code to join. Leave blank to allow anyone.</div></div>
      </Card>

      {resetSeasonData && (
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${K.bdr}30` }}>
          <SubLabel color={K.red}>Danger Zone</SubLabel>
          <Card style={{ padding: 14, border: `1px solid ${K.red}30` }}>
            <div style={{ fontSize: 12, color: K.t2, marginBottom: 10, lineHeight: 1.5 }}>
              Wipe all hole scores, match results, and CTP data for the current season. Use this to clear test data before the real season starts.
            </div>
            <button onClick={handleReset} disabled={resetting} style={{ width: "100%", padding: 12, borderRadius: 8, background: K.red + "15", border: `1.5px solid ${K.red}50`, color: K.red, fontSize: 13, fontWeight: 700, cursor: resetting ? "default" : "pointer", opacity: resetting ? 0.6 : 1 }}>
              {resetting ? "Resetting..." : "Reset Season Data"}
            </button>
          </Card>

          {importHistoricalScores && (
          <Card style={{ padding: 14, border: `1px solid ${K.warn}30`, marginTop: 8 }}>
            <div style={{ fontSize: 12, color: K.t2, marginBottom: 10, lineHeight: 1.5 }}>
              Import 2023–2025 season scores from historical spreadsheet data. This writes hole-by-hole scores for handicap calculation.
            </div>
            <button onClick={handleImportHistorical} disabled={importing} style={{ width: "100%", padding: 12, borderRadius: 8, background: K.warn + "15", border: `1.5px solid ${K.warn}50`, color: K.warn, fontSize: 13, fontWeight: 700, cursor: importing ? "default" : "pointer", opacity: importing ? 0.6 : 1 }}>
              {importing ? "Importing..." : "Import Historical Scores (2023–2025)"}
            </button>
            {importResult && (
              <div style={{ fontSize: 11, color: importResult.error ? K.red : K.grn, marginTop: 8, textAlign: "center", fontWeight: 600 }}>
                {importResult.error ? `Error: ${importResult.error}` : `Done! ${importResult.imported} scores imported, ${importResult.skipped} skipped`}
              </div>
            )}
          </Card>
          )}

          {recalcHandicaps && (
          <Card style={{ padding: 14, border: `1px solid ${K.teal}30`, marginTop: 8 }}>
            <div style={{ fontSize: 12, color: K.t2, marginBottom: 10, lineHeight: 1.5 }}>
              Recalculate all player handicaps from historical scores. This happens automatically after each week is finalized, but you can trigger it manually here.
            </div>
            <button onClick={async () => {
              setRecalcing(true); setRecalcResult(null);
              try { const n = await recalcHandicaps(); setRecalcResult({ updated: n }); }
              catch (e) { setRecalcResult({ error: e.message }); }
              setRecalcing(false);
            }} disabled={recalcing} style={{ width: "100%", padding: 12, borderRadius: 8, background: K.teal + "15", border: `1.5px solid ${K.teal}50`, color: K.teal, fontSize: 13, fontWeight: 700, cursor: recalcing ? "default" : "pointer", opacity: recalcing ? 0.6 : 1 }}>
              {recalcing ? "Recalculating..." : "Recalc Handicaps"}
            </button>
            {recalcResult && (
              <div style={{ fontSize: 11, color: recalcResult.error ? K.red : K.grn, marginTop: 8, textAlign: "center", fontWeight: 600 }}>
                {recalcResult.error ? `Error: ${recalcResult.error}` : `Done! ${recalcResult.updated} player(s) updated`}
              </div>
            )}
          </Card>
          )}
        </div>
      )}
    </div>
  );
}


