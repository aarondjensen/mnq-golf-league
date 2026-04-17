import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { LEAGUE_ID, db } from "../firebase";
import { K, FONTS, I, Pill, BackBtn, SaveBtn, SectionTitle, SubLabel, Card, EmptyState,
  getTeeTime, getWeekSide, calcCourseHandicap, calcNineHandicap, calcLeagueHandicap,
  formatTeeTime as fmtTeeTimeUtil, LIST_GAP, CARD_RADIUS, lastNamesOnly } from "../theme";


export default function AdminView(props) {
  const { players, savePlayer, deletePlayer, teams, saveTeam, deleteTeam, schedule, saveWeekSchedule, setWeekSchedule, deleteWeekSchedule, course, saveCourseData, scoringRules, saveScoringRules, leagueConfig, saveLeagueConfig, members, saveMember, deleteMember, matchResults, saveMatchResult } = props;
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
  if (sec === "config") return <AdminConfig config={leagueConfig} saveLeagueConfig={saveLeagueConfig} resetSeasonData={props.resetSeasonData} importHistoricalScores={props.importHistoricalScores} recalcHandicaps={props.recalcHandicaps} matchResults={matchResults} saveMatchResult={saveMatchResult} onBack={() => setSec(null)} />;

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
    dayOfWeek: leagueConfig.dayOfWeek ?? "Tuesday",
    startTime: leagueConfig.startTime ?? "4:28 PM",
    teeInterval: leagueConfig.teeInterval ?? 8,
    regularWeeks: leagueConfig.regularWeeks ?? 14,
    roundRobinWeeks: leagueConfig.roundRobinWeeks ?? null,
    seededWeeks: leagueConfig.seededWeeks ?? null,
    playoffWeeks: leagueConfig.playoffWeeks ?? 2,
    customSeedWeeks: undefined, // NOT stored in cfg — read directly from leagueConfig
    // lockSeedsEnabled also read from leagueConfig directly
    startDate: leagueConfig.startDate ?? "",
    alternateNines: leagueConfig.alternateNines !== false,
    playoffRounds: leagueConfig.playoffRounds ?? [],
  });
  const [editWeek, setEditWeek] = useState(null);
  const [selectedSeededWeek, setSelectedSeededWeek] = useState(0);
  const [selectedSeed, setSelectedSeed] = useState(null); // {pairIdx, slot} for tap-to-swap
  const [playoffView, setPlayoffView] = useState("setup"); // "setup" | "preview"
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

  // Derived week counts — all configurable by admin
  const defaultRRWeeks = Math.max(0, teams.length - 1);
  const rrWeekCount = (cfg.roundRobinWeeks !== null && cfg.roundRobinWeeks !== undefined)
    ? cfg.roundRobinWeeks
    : Math.min(defaultRRWeeks, cfg.regularWeeks);
  const seededWeekCount = (cfg.seededWeeks !== null && cfg.seededWeeks !== undefined)
    ? cfg.seededWeeks
    : Math.max(0, cfg.regularWeeks - rrWeekCount);
  const computedRegularWeeks = rrWeekCount + seededWeekCount;
  const subTotal = rrWeekCount + seededWeekCount + cfg.playoffWeeks;
  const totalWeeks = subTotal;

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

    // ── Sequential schedule model ──
    // The schedule is always: [RR block] → [Seeded block] → [Playoff block]
    // Rainouts during RR insert makeup weeks at the END of the RR block,
    // pushing seeded and playoff forward. The RR block must fully complete
    // before seeded play begins.
    // Rainouts during seeded/playoff just delay the season by one week.

    // Identify what exists and must be preserved
    const preservedWeeks = schedule.filter(s =>
      s.locked === true || s.rainedOut === true || (s.makeupFor && !s.rainedOut)
    );
    const preservedWeekNums = new Set(preservedWeeks.map(s => s.week));

    if (preservedWeeks.length > 0) {
      const locked = schedule.filter(s => s.locked).length;
      const rained = schedule.filter(s => s.rainedOut).length;
      const makeup = schedule.filter(s => s.makeupFor && !s.locked && !s.rainedOut).length;
      const parts = [];
      if (locked) parts.push(`${locked} finalized`);
      if (rained) parts.push(`${rained} rained-out`);
      if (makeup) parts.push(`${makeup} makeup`);
      if (!window.confirm(`Preserved weeks: ${parts.join(", ")}.\n\nAll other weeks will be regenerated.\n\nContinue?`)) return;
    }

    setGenerating(true);

    // Clean corrupted data: locked seeded weeks shouldn't have makeupFor
    for (const wk of schedule) {
      if (wk.locked && wk.seeded && wk.makeupFor) {
        await saveWeekSchedule({ ...wk, makeupFor: null });
      }
    }
    const cleanSchedule = schedule.map(wk =>
      (wk.locked && wk.seeded && wk.makeupFor) ? { ...wk, makeupFor: null } : wk
    );

    // Delete ALL existing schedule docs
    for (const existing of schedule) {
      if (existing.id) await deleteWeekSchedule(existing.id);
    }

    // Delete any zombie docs beyond the schedule
    const maxExisting = Math.max(0, ...schedule.map(s => s.week));
    for (let w = maxExisting + 1; w <= maxExisting + 5; w++) {
      await deleteWeekSchedule(`${LEAGUE_ID}_w${w}`);
    }

    // ── Build the new schedule sequentially ──
    const teamIds = teams.map(t => t.id);
    const rrRounds = generateRoundRobin(teamIds);

    // Count how many RR rainouts exist (these need makeup weeks in the RR block)
    const rrRainouts = cleanSchedule.filter(s =>
      s.rainedOut === true && !s.isPlayoff && !s.seeded
    ).length;

    // Total weeks: base schedule + rainouts (each rainout adds 1 dead slot)
    const totalRainouts = cleanSchedule.filter(s => s.rainedOut === true).length;

    // Walk through week positions sequentially, building each block in order
    let weekNum = 0;
    let rrCursor = 0;       // which round-robin round to assign next
    let rrPlayed = 0;       // how many RR matchups have been placed (played + makeup)
    let seededPlaced = 0;
    let playoffPlaced = 0;
    const rrTarget = rrWeekCount;    // how many RR rounds needed
    const seededTarget = seededWeekCount;
    const playoffTarget = cfg.playoffWeeks;

    // Phase 1: RR block (includes original RR weeks + makeup weeks for RR rainouts)
    // Locked seeded/playoff weeks can't move, so RR makeups go around them.
    while (rrPlayed < rrTarget) {
      weekNum++;
      const side = cfg.alternateNines ? ((weekNum - 1) % 2 === 0 ? 'front' : 'back') : 'front';
      const existing = cleanSchedule.find(s => s.week === weekNum);

      if (existing && existing.rainedOut === true && !existing.seeded && !existing.isPlayoff) {
        // Rained-out RR week — preserve as dead slot
        await setWeekSchedule({ ...existing, id: `${LEAGUE_ID}_w${weekNum}` });
        continue; // don't count toward rrPlayed
      }

      if (existing && existing.locked === true && !existing.seeded && !existing.isPlayoff) {
        // Locked RR week (not seeded) — preserve with scores intact
        await setWeekSchedule({ ...existing, id: `${LEAGUE_ID}_w${weekNum}` });
        rrPlayed++;
        continue;
      }

      if (existing && existing.makeupFor && !existing.seeded) {
        // Makeup week for an RR rainout — preserve
        await setWeekSchedule({ ...existing, id: `${LEAGUE_ID}_w${weekNum}` });
        rrPlayed++;
        continue;
      }

      // If there's a locked seeded/playoff week here, preserve it and skip past it
      // (the RR makeup will go to the next available slot)
      if (existing && existing.locked === true) {
        await setWeekSchedule({ ...existing, id: `${LEAGUE_ID}_w${weekNum}` });
        continue; // don't count toward rrPlayed — this is a seeded/playoff week we're skipping past
      }

      // Empty slot — place new RR week
      const roundIdx = rrCursor % rrRounds.length;
      rrCursor++;
      await setWeekSchedule({
        id: `${LEAGUE_ID}_w${weekNum}`, week: weekNum,
        matches: rrRounds[roundIdx], side,
        date: getWeekDate(weekNum - 1), isPlayoff: false,
        makeupFor: rrRainouts > 0 ? "rr" : undefined, // mark as makeup if we're past original RR block
      });
      rrPlayed++;
    }

    // Phase 2: Seeded regular season block
    // Some locked seeded weeks may have already been written in Phase 1 (when RR phase skipped past them)
    // Count those toward seededPlaced first
    const alreadyWrittenSeeded = cleanSchedule.filter(s =>
      s.week <= weekNum && s.locked === true && s.seeded === true && !s.isPlayoff
    );
    seededPlaced += alreadyWrittenSeeded.length;

    while (seededPlaced < seededTarget) {
      weekNum++;
      const side = cfg.alternateNines ? ((weekNum - 1) % 2 === 0 ? 'front' : 'back') : 'front';
      const existing = cleanSchedule.find(s => s.week === weekNum);

      if (existing && existing.rainedOut === true) {
        // Rained-out seeded week — preserve, push everything forward
        await setWeekSchedule({ ...existing, id: `${LEAGUE_ID}_w${weekNum}` });
        continue;
      }

      if (existing && existing.locked === true && existing.seeded) {
        // Locked seeded week — already written in Phase 1 or preserve now
        if (!alreadyWrittenSeeded.some(s => s.week === weekNum)) {
          await setWeekSchedule({ ...existing, id: `${LEAGUE_ID}_w${weekNum}` });
        }
        seededPlaced++;
        continue;
      }

      // New seeded week
      await setWeekSchedule({
        id: `${LEAGUE_ID}_w${weekNum}`, week: weekNum,
        matches: [], side,
        date: getWeekDate(weekNum - 1), isPlayoff: false, seeded: true,
      });
      seededPlaced++;
    }

    // Phase 3: Playoff block
    while (playoffPlaced < playoffTarget) {
      weekNum++;
      const side = cfg.alternateNines ? ((weekNum - 1) % 2 === 0 ? 'front' : 'back') : 'front';
      const existing = cleanSchedule.find(s => s.week === weekNum);

      if (existing && existing.rainedOut === true) {
        // Rained-out playoff week — preserve, push everything forward
        await setWeekSchedule({ ...existing, id: `${LEAGUE_ID}_w${weekNum}` });
        continue;
      }

      if (existing && existing.locked === true) {
        // Locked playoff week — preserve
        await setWeekSchedule({ ...existing, id: `${LEAGUE_ID}_w${weekNum}` });
        playoffPlaced++;
        continue;
      }

      // New playoff week
      await setWeekSchedule({
        id: `${LEAGUE_ID}_w${weekNum}`, week: weekNum,
        matches: [], side,
        date: getWeekDate(weekNum - 1), isPlayoff: true, seeded: true,
      });
      playoffPlaced++;
    }

    // Save config (preserve directly-saved fields)
    const { customSeedWeeks, lockSeedsEnabled, customSeedPairs, ...scheduleFields } = cfg;
    await saveLeagueConfig({ ...leagueConfig, ...scheduleFields, regularWeeks: computedRegularWeeks, roundRobinWeeks: rrWeekCount, seededWeeks: seededWeekCount });
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
    // Use locked seeds if set, otherwise compute from current standings
    const lockedSeeds = leagueConfig?.lockedSeeds;
    if (lockedSeeds && lockedSeeds.length === teams.length) {
      const map = {};
      lockedSeeds.forEach((tid, i) => { map[tid] = i + 1; });
      return map;
    }
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
  }, [teams, matchResults, leagueConfig?.lockedSeeds]);

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
              <div style={{ marginTop: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: K.t2, cursor: "pointer" }}>
                  <input type="checkbox" checked={cfg.alternateNines} onChange={e => setCfg({ ...cfg, alternateNines: e.target.checked })} style={{ accentColor: K.act }} />
                  Alternate front/back 9 each week
                </label>
              </div>
            </Card>
          </div>

          <div>
            <SubLabel>Season Format</SubLabel>
            <Card style={{ padding: 14 }}>
              {/* Total season weeks — computed read-only display */}
              <div style={{ marginBottom: 12, padding: "10px 12px", background: K.act + "10", borderRadius: 8, border: `1px solid ${K.act}30` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: K.t1 }}>Total Season Weeks</span>
                  <span style={{ minWidth: 60, padding: "6px 8px", borderRadius: 6, background: K.card, color: K.act, fontSize: 16, fontWeight: 800, textAlign: "center" }}>{totalWeeks}</span>
                </div>
                <div style={{ fontSize: 10, color: K.t3, marginTop: 6 }}>
                  Round-robin + seeded + playoffs
                </div>
              </div>

              {/* Sub-category inputs */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontSize: 11, color: K.t3 }}>Round-Robin</div>
                  <div style={{ fontSize: 10, color: K.t3 }}>{teams.length >= 2 ? `Full RR = ${defaultRRWeeks} wks` : ""}</div>
                </div>
                <input type="number" min="0" value={rrWeekCount} onChange={e => {
                  const v = parseInt(e.target.value);
                  setCfg({ ...cfg, roundRobinWeeks: isNaN(v) ? 0 : Math.max(0, v) });
                }} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Seeded Regular Season</div>
                <input type="number" min="0" value={seededWeekCount} onChange={e => {
                  const v = parseInt(e.target.value);
                  setCfg({ ...cfg, seededWeeks: isNaN(v) ? 0 : Math.max(0, v) });
                }} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Playoffs</div>
                <input type="number" value={cfg.playoffWeeks} onChange={e => {
                  const pw = parseInt(e.target.value) || 0;
                  const rounds = [...(cfg.playoffRounds || [])];
                  while (rounds.length < pw) rounds.push({ name: `Round ${rounds.length + 1}`, matchups: [] });
                  while (rounds.length > pw) rounds.pop();
                  setCfg({ ...cfg, playoffWeeks: pw, playoffRounds: rounds });
                }} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} />
              </div>
              {/* Consolidated seeded matchup builder — single card with week toggle */}
              {teams.length >= 2 && (() => {
                const seededRegWeeks = seededWeekCount;
                if (seededRegWeeks === 0) return null;
                const pairCount = Math.floor(teams.length / 2);

                // Seed default: all weeks use top-vs-bottom
                const defaultWeek = () => Array.from({ length: pairCount }, (_, i) => ({ s1: i + 1, s2: teams.length - i }));
                const savedWeeks = leagueConfig?.customSeedWeeks;
                const currentWeeks = (savedWeeks && savedWeeks.length === seededRegWeeks)
                  ? savedWeeks
                  : Array.from({ length: seededRegWeeks }, (_, i) =>
                      savedWeeks && savedWeeks[i] && savedWeeks[i].length === pairCount ? savedWeeks[i] : defaultWeek()
                    );

                const activeIdx = Math.min(selectedSeededWeek, seededRegWeeks - 1);
                const activeWeekPairs = currentWeeks[activeIdx] || defaultWeek();

                const validateWeek = (wk) => {
                  const used = new Set();
                  wk.forEach(p => { used.add(p.s1); used.add(p.s2); });
                  const missing = [];
                  for (let i = 1; i <= teams.length; i++) if (!used.has(i)) missing.push(i);
                  return { isValid: used.size === pairCount * 2 && missing.length === 0, missing, hasDuplicates: used.size !== pairCount * 2 };
                };

                // Swap two seed positions — save immediately to both local + Firestore
                const swapSeeds = async (srcPos, dstPos) => {
                  if (srcPos.pairIdx === dstPos.pairIdx && srcPos.slot === dstPos.slot) return;
                  const next = currentWeeks.map((wk, wi) => {
                    if (wi !== activeIdx) return [...wk];
                    const nextWk = wk.map(p => ({ ...p }));
                    const srcVal = nextWk[srcPos.pairIdx][srcPos.slot];
                    const dstVal = nextWk[dstPos.pairIdx][dstPos.slot];
                    nextWk[srcPos.pairIdx][srcPos.slot] = dstVal;
                    nextWk[dstPos.pairIdx][dstPos.slot] = srcVal;
                    return nextWk;
                  });
                  // Write directly to Firestore with ONLY the fields we want to update
                  const configId = `${LEAGUE_ID}_config`;
                  await db.upsert("league_config", { id: configId, league_id: LEAGUE_ID, customSeedWeeks: next });
                  // Update local state to reflect immediately
                  saveLeagueConfig({ ...leagueConfig, customSeedWeeks: next });
                };

                const { isValid, missing, hasDuplicates } = validateWeek(activeWeekPairs);
                const lockSeedsEnabled = leagueConfig?.lockSeedsEnabled === true;

                const onSeedTap = (pos) => {
                  if (selectedSeed) {
                    swapSeeds(selectedSeed, pos);
                    setSelectedSeed(null);
                  } else {
                    setSelectedSeed(pos);
                  }
                };

                return (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: K.t3, marginBottom: 6 }}>Seeded Regular Season Matchups</div>

                    <div style={{ padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${isValid ? K.bdr : K.red + "60"}` }}>
                      {/* Week toggle pills */}
                      <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
                        {currentWeeks.map((_, wi) => {
                          const wv = validateWeek(currentWeeks[wi]);
                          const isActive = wi === activeIdx;
                          return (
                            <button key={wi} onClick={() => { setSelectedSeededWeek(wi); setSelectedSeed(null); }} style={{
                              flex: "1 1 auto", minWidth: 60, padding: "6px 8px", borderRadius: 6, cursor: "pointer",
                              background: isActive ? K.act + "18" : K.card,
                              border: `1px solid ${isActive ? K.act + "60" : wv.isValid ? K.bdr : K.red + "50"}`,
                              color: isActive ? K.act : K.t2, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5,
                            }}>
                              Week {wi + 1}
                              {!wv.isValid && <span style={{ color: K.red, marginLeft: 3 }}>!</span>}
                            </button>
                          );
                        })}
                      </div>

                      {/* Hint */}
                      <div style={{ fontSize: 10, color: K.t3, marginBottom: 8, fontStyle: "italic" }}>
                        {selectedSeed ? "Tap another seed to swap" : "Tap a seed to select, then tap another to swap"}
                      </div>

                      {/* Matchup rows with draggable seed cards */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {activeWeekPairs.map((p, pairIdx) => {
                          const renderSeedCard = (seed, slot) => {
                            const pos = { pairIdx, slot };
                            const isSelected = selectedSeed && selectedSeed.pairIdx === pairIdx && selectedSeed.slot === slot;
                            const isTarget = selectedSeed && !isSelected;
                            return (
                              <button onClick={() => onSeedTap(pos)} style={{
                                width: 48, height: 38, borderRadius: 6, cursor: "pointer",
                                background: isSelected ? K.act : isTarget ? K.act + "10" : K.card,
                                border: `1.5px solid ${isSelected ? K.act : isTarget ? K.act + "60" : K.bdr}`,
                                color: isSelected ? K.bg : K.t1, fontSize: 15, fontWeight: 800,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                transition: "all .15s",
                              }}>
                                {seed}
                              </button>
                            );
                          };
                          return (
                            <div key={pairIdx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 10, color: K.t3, width: 16 }}>{pairIdx + 1}.</span>
                              {renderSeedCard(p.s1, "s1")}
                              <span style={{ fontSize: 10, color: K.t3, fontWeight: 700 }}>VS</span>
                              {renderSeedCard(p.s2, "s2")}
                            </div>
                          );
                        })}
                      </div>

                      {!isValid && (
                        <div style={{ fontSize: 10, color: K.red, marginTop: 8, lineHeight: 1.4 }}>
                          {hasDuplicates && "Each seed must be used once. "}
                          {missing.length > 0 && `Missing: ${missing.map(s => `#${s}`).join(", ")}`}
                        </div>
                      )}

                      {/* Lock Seeds toggle */}
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${K.bdr}50`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, color: K.t1, fontWeight: 700 }}>Lock Seeds</div>
                          <div style={{ fontSize: 9, color: K.t3, lineHeight: 1.4, marginTop: 2 }}>
                            {lockSeedsEnabled
                              ? "#1 seed stays as #1 for all seeded weeks"
                              : "Seeds update each week based on current standings"}
                          </div>
                        </div>
                        <button onClick={async () => {
                          const newVal = !lockSeedsEnabled;
                          const configId = `${LEAGUE_ID}_config`;
                          await db.upsert("league_config", { id: configId, league_id: LEAGUE_ID, lockSeedsEnabled: newVal });
                          saveLeagueConfig({ ...leagueConfig, lockSeedsEnabled: newVal });
                        }} style={{
                          width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
                          background: lockSeedsEnabled ? K.act : K.bdr,
                          position: "relative", transition: "background .2s", flexShrink: 0,
                        }}>
                          <div style={{
                            width: 20, height: 20, borderRadius: 10,
                            background: "#fff",
                            position: "absolute", top: 2,
                            left: lockSeedsEnabled ? 22 : 2,
                            transition: "left .2s",
                            boxShadow: "0 1px 3px rgba(0,0,0,.3)",
                          }} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
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

          {/* Individual Tournament — always shown at top */}
          <div style={{ marginBottom: 14 }}>
            <SubLabel color={K.teal}>Individual Tournament</SubLabel>
            <Card style={{ padding: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: K.t2, cursor: "pointer", marginBottom: 8 }}>
                <input type="checkbox" checked={cfg.individualEvent !== false} onChange={e => setCfg({ ...cfg, individualEvent: e.target.checked })} style={{ accentColor: K.act }} />
                Run individual net stroke play during playoffs
              </label>
              <div style={{ fontSize: 11, color: K.t3, lineHeight: 1.5 }}>
                All players compete individually across {cfg.playoffWeeks} playoff rounds. Lowest cumulative net score wins.
              </div>
            </Card>
          </div>

          {/* Setup / Preview toggle */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <div style={{ display: "inline-flex", background: K.inp, borderRadius: 8, border: `1px solid ${K.bdr}`, padding: 3 }}>
              {[
                { id: "setup", label: "Bracket Setup" },
                { id: "preview", label: "Bracket Preview" },
              ].map(opt => {
                const isActive = playoffView === opt.id;
                return (
                  <button key={opt.id} onClick={() => setPlayoffView(opt.id)} style={{
                    padding: "6px 14px", borderRadius: 6, cursor: "pointer", border: "none",
                    background: isActive ? K.act : "transparent",
                    color: isActive ? K.bg : K.t2, fontSize: 11, fontWeight: 700, transition: "all .2s",
                  }}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bracket Setup */}
          {playoffView === "setup" && (
          <div className="scoring-grid">
          <div>
            <SubLabel color={K.warn}>Playoff Bracket</SubLabel>
            {(cfg.playoffRounds || []).map((round, ri) => {
              const roundWeekNum = computedRegularWeeks + ri + 1;
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
          )}

          {/* Bracket Preview */}
          {playoffView === "preview" && (
          <div>
            {(cfg.playoffRounds || []).some(r => r.matchups?.length > 0) ? (
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
                // Separate main bracket matchups from consolation in the last round
                const lastRoundIdx = rounds.length - 1;
                const lastRound = rounds[lastRoundIdx];
                const lastMatchups = lastRound?.matchups || [];
                // A consolation match has at least one "loser" slot
                const isConsolation = (mu) => mu.s1type === "loser" || mu.s2type === "loser";
                const mainLastMatchups = lastMatchups.filter(mu => !isConsolation(mu));
                const consolationMatchups = lastMatchups.filter(mu => isConsolation(mu));

                return (
                  <div>
                    <div style={{ display: "flex", alignItems: "flex-start" }}>
                      {rounds.map((round, ri) => {
                        const isLast = ri === lastRoundIdx;
                        // For the last round, only show main (non-consolation) matchups
                        const matchups = isLast ? mainLastMatchups : (round.matchups || []);
                        const mc = matchups.length;
                        const gap = ri === 0 ? baseGap : baseGap + (cardH + baseGap) * (Math.pow(2, ri) - 1);
                        const topPad = ri === 0 ? 0 : (gap - baseGap) / 2;
                        return (
                          <div key={ri} style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ textAlign: "center", marginBottom: 4, height: 28 }}>
                              <div style={{ fontSize: 9, fontWeight: 700, color: K.warn, letterSpacing: .8 }}>{round.name || `R${ri + 1}`}</div>
                              <div style={{ fontSize: 8, color: K.t3 }}>Wk {computedRegularWeeks + ri + 1}</div>
                            </div>
                            <div style={{ paddingTop: topPad }}>
                              {mc > 0 ? matchups.map((mu, mi) => (
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
                                    {ri < lastRoundIdx && (
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
                                    {isLast && mc === 1 && (
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
                    {/* Consolation matches — rendered below the main bracket */}
                    {consolationMatchups.length > 0 && (
                      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                        <div style={{ width: `${100 / rounds.length}%`, minWidth: 0 }}>
                          <div style={{ textAlign: "center", fontSize: 8, fontWeight: 700, color: K.t3, marginBottom: 4, textTransform: "uppercase", letterSpacing: .5 }}>3rd Place</div>
                          {consolationMatchups.map((mu, mi) => (
                            <div key={mi} style={{ marginBottom: mi < consolationMatchups.length - 1 ? baseGap : 0 }}>
                              <div style={{ flex: 1, minWidth: 0, background: K.inp, borderRadius: 4, border: `1px solid ${K.red}30`, overflow: "hidden" }}>
                                {["s1", "s2"].map((side, si) => (
                                  <div key={side} style={{ display: "flex", alignItems: "center", padding: "3px 5px", gap: 4, ...(si === 0 ? { borderBottom: `1px solid ${K.bdr}30` } : {}) }}>
                                    <div style={{ width: 14, height: 14, borderRadius: 3, background: badgeColor(mu, side) + "20", border: `1px solid ${badgeColor(mu, side)}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 800, color: badgeColor(mu, side), flexShrink: 0 }}>{badgeLetter(mu, side)}</div>
                                    <div style={{ fontSize: 9, fontWeight: 600, color: K.t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slotLabel(mu, side)}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </Card>
            ) : (
              <div style={{ textAlign: "center", padding: 30, color: K.t3, fontSize: 13 }}>Configure your bracket in the Setup view first to see the preview.</div>
            )}
          </div>
          )}

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
            {/* Seed status pill — reflects setup config */}
            {(() => {
              const seededRegWeeks = schedule.filter(s => s.seeded === true && !s.isPlayoff);
              if (seededRegWeeks.length === 0) return null;
              const lockSeedsEnabled = leagueConfig?.lockSeedsEnabled === true;
              const lockedSeeds = leagueConfig?.lockedSeeds;
              const captured = lockedSeeds && lockedSeeds.length === teams.length;

              if (!lockSeedsEnabled) return null;

              return (
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
                  <div style={{ background: K.act + "20", border: `1px solid ${K.act}60`, borderRadius: 8, color: K.act, fontSize: 11, padding: "6px 12px", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                    🔒 {captured ? "Seeds Locked" : "Seeds Will Lock at Start of Seeded Play"}
                  </div>
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
                      {isRainedOut ? "RAIN OUT" : isSeeded ? (() => {
                        if (isPlayoffWk) return "PLAYOFF — TBD";
                        // Show configured seed pairings if available
                        const seededRegWeeks = schedule.filter(s => s.seeded === true && !s.isPlayoff).sort((a, b) => a.week - b.week);
                        const seededIdx = seededRegWeeks.findIndex(s => s.week === wk.week);
                        const customWeeks = leagueConfig?.customSeedWeeks;
                        const weekPairs = customWeeks && customWeeks[seededIdx];
                        if (weekPairs && weekPairs.length > 0) {
                          return weekPairs.map(p => `#${p.s1}v#${p.s2}`).join("  ");
                        }
                        return "SEEDED — TBD";
                      })() : wk.matches?.length ? (() => {
                        const isSeededFilled = wk.seeded === true;
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
    const regWeeks = computedRegularWeeks; // use the live computed value
    const playoffWeeks = cfg.playoffWeeks;
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
      // Determine seeds: if lockSeedsEnabled and a snapshot exists, use it;
      // if enabled but no snapshot yet, capture one now from current standings
      let seeds;
      const lockSeedsEnabled = leagueConfig?.lockSeedsEnabled === true;
      const existingLocked = leagueConfig?.lockedSeeds;
      if (existingLocked && existingLocked.length === teams.length) {
        seeds = existingLocked;
      } else {
        seeds = buildStandingsForSeed().map(s => s.teamId);
        // Auto-capture snapshot when entering seeded play with lockSeedsEnabled
        if (lockSeedsEnabled && !isPlayoff) {
          await saveLeagueConfig({ ...leagueConfig, lockedSeeds: seeds });
        }
      }
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
          const playoffWeeksList = schedule.filter(s => s.isPlayoff === true).sort((a, b) => a.week - b.week);
          const prevPlayoffWeek = playoffWeeksList[playoffRound - 2]; // 0-indexed: round 2 → index 0
          if (!prevPlayoffWeek || !prevPlayoffWeek.matches || prevPlayoffWeek.matches.length === 0) {
            alert(`Previous playoff round (Week ${prevPlayoffWeek?.week || "?"}) has no matches yet. Seed that week first.`);
            return;
          }
          const prevResults = (matchResults || []).filter(r => r.week === prevPlayoffWeek.week);
          if (prevResults.length < prevPlayoffWeek.matches.length) {
            alert(`Previous playoff round (Week ${prevPlayoffWeek.week}) must be finalized first.`);
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
        // Seeded regular season: use per-week custom matchups
        const n = seeds.length;
        const pairCount = Math.floor(n / 2);

        // Find the index of this week among seeded regular season weeks (sorted by week number)
        const seededRegWeeks = schedule.filter(s => s.seeded === true && !s.isPlayoff).sort((a, b) => a.week - b.week);
        const seededIdx = seededRegWeeks.findIndex(s => s.week === wk.week);

        const customWeeks = leagueConfig.customSeedWeeks;
        const weekPairs = (customWeeks && customWeeks[seededIdx]) || null;

        if (weekPairs && weekPairs.length === pairCount) {
          for (const pair of weekPairs) {
            const t1 = seeds[pair.s1 - 1];
            const t2 = seeds[pair.s2 - 1];
            if (t1 && t2) matches.push({ team1: t1, team2: t2 });
          }
        } else {
          // Fallback to default top vs bottom if no custom config set
          for (let i = 0; i < pairCount; i++) {
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

      // Find where to insert the makeup week.
      // For RR rainouts: ideally right after the last RR week.
      // But we can NEVER shift locked weeks (scores are keyed by week number),
      // so walk forward from the ideal position until we find the first non-locked slot.
      const lastRRWeekNum = Math.max(0, ...schedule.filter(s =>
        (!s.isPlayoff && !s.seeded && !s.makeupFor) || (s.makeupFor && !s.isPlayoff)
      ).map(s => s.week));

      // Find first non-locked week at or after (lastRRWeekNum+1 for RR) or (wk.week+1 for others)
      const insertTarget = isRoundRobin ? lastRRWeekNum + 1 : wk.week + 1;
      let makeupWeekNum = insertTarget;
      while (schedule.some(s => s.week === makeupWeekNum && s.locked === true)) {
        makeupWeekNum++;
      }

      const msgDetail = isRoundRobin
        ? `Rain out Week ${wk.week}? This will:\n\n• Skip this week (no matches played)\n• Insert a makeup week at week ${makeupWeekNum}\n• Push unlocked future weeks forward\n• Extend the season by one week`
        : `Rain out Week ${wk.week}? This will:\n\n• Skip this week\n• Insert makeup matchups at week ${makeupWeekNum}\n• Push unlocked future weeks forward\n• Extend the season by one week`;
      if (!window.confirm(msgDetail)) return;

      const year = leagueConfig?.year || new Date().getFullYear();
      const parseDate = (dateStr) => {
        if (!dateStr) return null;
        const d = new Date(`${dateStr}, ${year}`);
        return isNaN(d.getTime()) ? null : d;
      };
      const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      // Mark this week as rained out (clear matches since they're moved to the makeup)
      await saveWeekSchedule({ ...wk, rainedOut: true, matches: [] });

      // Shift only NON-LOCKED weeks from makeupWeekNum onward. Locked weeks stay put.
      // We process descending to avoid id collisions as we renumber.
      const weeksToShift = schedule
        .filter(s => s.week >= makeupWeekNum && s.locked !== true && s.week !== wk.week)
        .sort((a, b) => b.week - a.week);

      // We need to be careful: if we shift a week to position N, and N is occupied by a locked week,
      // we need to skip that position. Build a mapping: oldWeek → newWeek by walking forward.
      const shiftMap = {};
      const lockedWeekNums = new Set(schedule.filter(s => s.locked === true).map(s => s.week));
      const reserved = new Set(lockedWeekNums); // positions that can't be taken
      reserved.add(wk.week); // the rained-out week stays at its original position

      // Walk ascending through weeks that need to shift
      const ascShifts = schedule
        .filter(s => s.week >= makeupWeekNum && s.locked !== true && s.week !== wk.week)
        .sort((a, b) => a.week - b.week);

      let cursor = makeupWeekNum + 1; // makeupWeekNum itself is the makeup slot
      for (const fw of ascShifts) {
        while (reserved.has(cursor)) cursor++;
        shiftMap[fw.week] = cursor;
        reserved.add(cursor);
        cursor++;
      }

      // Apply shifts (descending by new week number to avoid collisions)
      const shiftEntries = Object.entries(shiftMap).map(([oldW, newW]) => ({ oldW: parseInt(oldW), newW })).sort((a, b) => b.newW - a.newW);
      for (const { oldW, newW } of shiftEntries) {
        const fw = schedule.find(s => s.week === oldW);
        if (!fw) continue;
        // Delete old doc, create new at new week number
        let newDate = fw.date || "";
        const parsed = parseDate(fw.date);
        if (parsed) {
          parsed.setDate(parsed.getDate() + (newW - oldW) * 7);
          newDate = fmtDate(parsed);
        }
        await deleteWeekSchedule(fw.id);
        await setWeekSchedule({ ...fw, id: `${LEAGUE_ID}_w${newW}`, week: newW, date: newDate });
      }

      // Create the makeup week at makeupWeekNum
      // Find a neighboring week to compute the date
      const neighborWeek = schedule.find(s => s.week === makeupWeekNum - 1) || schedule.find(s => s.week === wk.week);
      let makeupDate = "";
      const nParsed = parseDate(neighborWeek?.date);
      if (nParsed) {
        nParsed.setDate(nParsed.getDate() + 7);
        makeupDate = fmtDate(nParsed);
      }
      const makeupSide = neighborWeek?.side === 'front' ? 'back' : 'front';

      await setWeekSchedule({
        id: `${LEAGUE_ID}_w${makeupWeekNum}`,
        week: makeupWeekNum,
        matches: [...(wk.matches || [])],
        side: wk.side || makeupSide,
        date: makeupDate,
        makeupFor: wk.week,
        isPlayoff: wk.isPlayoff || false,
        seeded: wk.seeded || false,
      });

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

                // Un-mark the rain out and restore matches if they were cleared
                const makeupWeek = schedule.find(s => s.makeupFor === wk.week);
                const restoredMatches = makeupWeek?.matches || wk.matches || [];
                await saveWeekSchedule({ ...wk, rainedOut: false, matches: restoredMatches });

                if (makeupWeek) {
                  // Delete the makeup week, then shift weeks after it down by 1 — but skip over locked weeks.
                  await deleteWeekSchedule(makeupWeek.id);

                  // Build shift map: for each non-locked week after makeupWeek.week, find the next lower available slot.
                  const lockedWeekNums = new Set(schedule.filter(s => s.locked === true && s.week !== wk.week).map(s => s.week));
                  const weeksToShift = schedule
                    .filter(s => s.week > makeupWeek.week && s.locked !== true && s.week !== wk.week)
                    .sort((a, b) => a.week - b.week);

                  const shiftMap = {};
                  const reserved = new Set(lockedWeekNums);
                  reserved.add(wk.week);
                  reserved.add(makeupWeek.week); // this is now being vacated
                  // Actually remove makeupWeek from reserved since we just deleted it
                  reserved.delete(makeupWeek.week);

                  let cursor = makeupWeek.week;
                  for (const fw of weeksToShift) {
                    while (reserved.has(cursor)) cursor++;
                    if (cursor < fw.week) {
                      shiftMap[fw.week] = cursor;
                      reserved.add(cursor);
                    }
                    cursor++;
                  }

                  // Apply shifts ascending by old week (so we free slots before we need them)
                  const shiftEntries = Object.entries(shiftMap).map(([oldW, newW]) => ({ oldW: parseInt(oldW), newW })).sort((a, b) => a.oldW - b.oldW);
                  for (const { oldW, newW } of shiftEntries) {
                    const fw = schedule.find(s => s.week === oldW);
                    if (!fw) continue;
                    let newDate = fw.date || "";
                    const parsed = parseDate(fw.date);
                    if (parsed) {
                      parsed.setDate(parsed.getDate() + (newW - oldW) * 7);
                      newDate = fmtDate(parsed);
                    }
                    await deleteWeekSchedule(fw.id);
                    await setWeekSchedule({ ...fw, id: `${LEAGUE_ID}_w${newW}`, week: newW, date: newDate });
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
            // Seeded regular: use per-week custom matchups
            const n = teams.length;
            const pairCount = Math.floor(n / 2);
            const seededRegWeeks = schedule.filter(s => s.seeded === true && !s.isPlayoff).sort((a, b) => a.week - b.week);
            const seededIdx = seededRegWeeks.findIndex(s => s.week === wk.week);
            const weekPairs = (leagueConfig.customSeedWeeks && leagueConfig.customSeedWeeks[seededIdx]) || null;

            if (weekPairs && weekPairs.length === pairCount) {
              weekPairs.forEach(pair => {
                const s1 = pair.s1, s2 = pair.s2;
                const t1 = getTeamBySeed(s1), t2 = getTeamBySeed(s2);
                previewPairings.push({ label1: `#${s1}`, label2: `#${s2}`, name1: t1 ? lastNamesOnly(t1.name) : `Seed #${s1}`, name2: t2 ? lastNamesOnly(t2.name) : `Seed #${s2}`, seed1: s1, seed2: s2 });
              });
            } else {
              // Fallback: top vs bottom
              for (let i = 0; i < pairCount; i++) {
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
                    <div style={{ flexShrink: 0, fontSize: 10, color: K.acc, fontWeight: 700 }}>{formatTeeTime(cfg.startTime ?? "4:28 PM", mi).replace(/\s*(AM|PM)$/i, '')}</div>
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


function AdminConfig({ config, saveLeagueConfig, resetSeasonData, importHistoricalScores, recalcHandicaps, matchResults, saveMatchResult, onBack }) {
  const [lc, setLc] = useState({ ...config });
  const [dirty, setDirty] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [attesting, setAttesting] = useState(false);
  const [attestResult, setAttestResult] = useState(null);
  const save = async () => { await saveLeagueConfig(lc); setDirty(false); };

  const handleBack = async () => {
    if (dirty) {
      const choice = window.confirm("You have unsaved changes. Save before leaving?");
      if (choice) await save();
    }
    onBack();
  };

  const handleReset = async () => {
    if (!window.confirm("Reset all season data?\n\nThis will permanently delete:\n• All hole scores\n• All match results\n• All CTP data\n• The entire schedule (all weeks, rainouts, makeups)\n\nAfter reset, you'll need to regenerate the schedule from scratch.\n\nThis cannot be undone.")) return;
    if (!window.confirm("Are you sure? This wipes ALL season data including the schedule itself.")) return;
    setResetting(true);
    await resetSeasonData();
    setResetting(false);
  };

  const handleAttestAll = async () => {
    const unattested = (matchResults || []).filter(r => r.attested !== true);
    if (unattested.length === 0) {
      setAttestResult({ updated: 0, message: "No unattested match results" });
      return;
    }
    if (!window.confirm(`Mark all ${unattested.length} unattested match result(s) as attested?\n\nTESTING ONLY — this bypasses the opposing-team signature requirement.`)) return;
    setAttesting(true);
    setAttestResult(null);
    try {
      for (const r of unattested) {
        await saveMatchResult({ ...r, attested: true });
      }
      setAttestResult({ updated: unattested.length });
    } catch (e) {
      setAttestResult({ error: e.message });
    }
    setAttesting(false);
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
              Wipe all scores, match results, CTP data, and the entire schedule for the current season. After resetting, regenerate the schedule from Schedule settings.
            </div>
            <button onClick={handleReset} disabled={resetting} style={{ width: "100%", padding: 12, borderRadius: 8, background: K.red + "15", border: `1.5px solid ${K.red}50`, color: K.red, fontSize: 13, fontWeight: 700, cursor: resetting ? "default" : "pointer", opacity: resetting ? 0.6 : 1 }}>
              {resetting ? "Resetting..." : "Reset Season Data"}
            </button>
          </Card>

          {saveMatchResult && (
          <Card style={{ padding: 14, border: `1px solid ${K.warn}30`, marginTop: 8 }}>
            <div style={{ fontSize: 12, color: K.t2, marginBottom: 10, lineHeight: 1.5 }}>
              <strong>Testing only.</strong> Force-attest every match result, bypassing the opposing-team signature requirement. Remove this card before live play.
            </div>
            <button onClick={handleAttestAll} disabled={attesting} style={{ width: "100%", padding: 12, borderRadius: 8, background: K.warn + "15", border: `1.5px solid ${K.warn}50`, color: K.warn, fontSize: 13, fontWeight: 700, cursor: attesting ? "default" : "pointer", opacity: attesting ? 0.6 : 1 }}>
              {attesting ? "Attesting..." : "Attest All Match Results"}
            </button>
            {attestResult && (
              <div style={{ fontSize: 11, color: attestResult.error ? K.red : K.grn, marginTop: 8, textAlign: "center", fontWeight: 600 }}>
                {attestResult.error ? `Error: ${attestResult.error}` : attestResult.message || `Done! ${attestResult.updated} result(s) attested`}
              </div>
            )}
          </Card>
          )}
        </div>
      )}
    </div>
  );
}


