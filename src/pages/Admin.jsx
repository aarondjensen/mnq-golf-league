import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { LEAGUE_ID, db } from "../firebase";
import { K, I, Pill, BackBtn, SaveBtn, SectionTitle, SubLabel, Card, EmptyState,
  getWeekSide, formatTeeTime as fmtTeeTimeUtil, LIST_GAP, CARD_RADIUS, lastNamesOnly,
  buildStandingsForSeed as sharedBuildStandingsForSeed, buildSeedMap,
  pairNonBracketTeams, collectPriorMatchups } from "../theme";
import { ConfirmModal } from "../components/Popup";
import NotificationsAdmin from "./NotificationsAdmin";

// NOTE: ConfirmModal used to live in this file as a local helper. It's now
// imported from components/Popup.jsx so every confirm in the app (Admin,
// Scoring, etc.) shares the same chrome. The shared component supports the
// `<ConfirmModal modal={state} />` API this file uses at 9 call sites, so
// none of those sites need to change. State shape supported:
//   { title, message, confirmLabel, cancelLabel, destructive, onConfirm, onCancel }
// (plus an optional `eyebrow` for the branded "MnQ Golf League" callout
// used in Scoring's confirms — Admin doesn't pass that, so its modals
// render without an eyebrow, identical to today.)


export default function AdminView(props) {
  const { players, savePlayer, deletePlayer, teams, saveTeam, deleteTeam, schedule, saveWeekSchedule, setWeekSchedule, deleteWeekSchedule, course, saveCourseData, scoringRules, saveScoringRules, leagueConfig, saveLeagueConfig, members, saveMember, deleteMember, matchResults, saveMatchResult, clearWeekData } = props;
  const [sec, setSec] = useState(null);

  // ── Derive actionable status for the dashboard banner ──
  // The dashboard previously showed static inventory ("10 teams", "20 active"). Commissioners
  // open Admin mid-season to do something — finalize a week, fix a roster, respond to an
  // issue. Surfacing the actionable items up front is the single highest-leverage change.
  const activePlayers = useMemo(() => players.filter(p => p.status !== "inactive"), [players]);
  const teeBoxNames = useMemo(() => (course?.teeBoxes || []).map(t => t.name), [course]);

  // Per-player issues
  const playersWithIssues = useMemo(() => activePlayers.filter(p => {
    if (!p.teeBox || !teeBoxNames.includes(p.teeBox)) return true;
    if (p.handicapIndex === undefined || p.handicapIndex === null) return true;
    return false;
  }), [activePlayers, teeBoxNames]);

  // Per-team issues: a team needs both player1 and player2 filled in
  const incompleteTeams = useMemo(() => teams.filter(t => !t.player1 || !t.player2), [teams]);

  // Unlinked members: signed-in account with no player assigned
  const unlinkedMembers = useMemo(() => members.filter(m => !m.playerId), [members]);

  // Unassigned players (active player with no team)
  const unassignedPlayers = useMemo(() => {
    const assigned = new Set();
    teams.forEach(t => { if (t.player1) assigned.add(t.player1); if (t.player2) assigned.add(t.player2); });
    return activePlayers.filter(p => !assigned.has(p.id));
  }, [activePlayers, teams]);

  // Weeks ready to finalize (all matches attested but week not yet locked)
  const weeksReadyToFinalize = useMemo(() => {
    return schedule.filter(wk => {
      if (wk.rainedOut || wk.locked) return false;
      if (!wk.matches || wk.matches.length === 0) return false;
      return wk.matches.every(m =>
        (matchResults || []).some(r => r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2 && r.attested === true)
      );
    });
  }, [schedule, matchResults]);

  // Weeks with signed-but-unattested matches (commissioner may need to force-attest)
  const weeksWithPendingAttestation = useMemo(() => {
    const weeks = new Set();
    (matchResults || []).forEach(r => {
      if (r.attested !== true && r.signedByPlayerId) weeks.add(r.week);
    });
    return Array.from(weeks).sort((a, b) => a - b);
  }, [matchResults]);

  // Current / next week (earliest playable unlocked week)
  const currentWeek = useMemo(() => {
    for (const wk of schedule) {
      if (wk.rainedOut) continue;
      if (!wk.matches || wk.matches.length === 0) continue;
      if (!wk.locked) return wk;
    }
    return null;
  }, [schedule]);

  // Build flat list of issues with descriptions + section jump targets
  const issues = [];
  if (weeksReadyToFinalize.length > 0) {
    issues.push({
      level: "action",
      text: `Week ${weeksReadyToFinalize.map(w => w.week).join(", ")} ready to finalize`,
      jump: "schedule",
    });
  }
  if (weeksWithPendingAttestation.length > 0) {
    issues.push({
      level: "info",
      text: `${weeksWithPendingAttestation.length === 1 ? "Week" : "Weeks"} ${weeksWithPendingAttestation.join(", ")} awaiting attestation`,
      jump: "schedule",
    });
  }
  if (incompleteTeams.length > 0) {
    issues.push({
      level: "warn",
      text: `${incompleteTeams.length} incomplete team${incompleteTeams.length === 1 ? "" : "s"}`,
      jump: "teams",
    });
  }
  if (playersWithIssues.length > 0) {
    issues.push({
      level: "warn",
      text: `${playersWithIssues.length} player${playersWithIssues.length === 1 ? "" : "s"} missing tee box or handicap`,
      jump: "players",
    });
  }
  if (unassignedPlayers.length > 0 && teams.length > 0) {
    issues.push({
      level: "info",
      text: `${unassignedPlayers.length} player${unassignedPlayers.length === 1 ? "" : "s"} not on a team`,
      jump: "teams",
    });
  }
  if (unlinkedMembers.length > 0) {
    issues.push({
      level: "info",
      text: `${unlinkedMembers.length} account${unlinkedMembers.length === 1 ? "" : "s"} not linked to a player`,
      jump: "members",
    });
  }

  // Section tiles — grouped by intent rather than entity type.
  // League (once-per-season config), Roster (people), Season (running play), Maintenance (rare/destructive).
  const groupedSections = [
    {
      title: "League",
      items: [
        { id: "config", label: "League", icon: "settings", desc: leagueConfig.name || "Name, year, invite code" },
        { id: "course", label: "Course", icon: "mapPin", desc: course?.name || "Not set" },
        { id: "scoring", label: "Rules", icon: "ruler", desc: "Scoring & handicaps" },
        { id: "pushstatus", label: "Push Status", icon: "bell", desc: "Who has notifications enabled" },
      ],
    },
    {
      title: "Roster",
      items: [
        {
          id: "players", label: "Players", icon: "user",
          desc: `${activePlayers.length} active`,
          badge: playersWithIssues.length > 0 ? { count: playersWithIssues.length, color: K.warn } : null,
        },
        {
          id: "teams", label: "Teams", icon: "users",
          desc: `${teams.length} team${teams.length === 1 ? "" : "s"}`,
          badge: incompleteTeams.length > 0 ? { count: incompleteTeams.length, color: K.warn } : null,
        },
        {
          id: "members", label: "Accounts", icon: "key",
          desc: `${members.length} signed in`,
          badge: unlinkedMembers.length > 0 ? { count: unlinkedMembers.length, color: K.hcpBlue } : null,
        },
      ],
    },
    {
      title: "Season",
      items: [
        {
          id: "schedule", label: "Schedule", icon: "calendar",
          desc: currentWeek ? `Week ${currentWeek.week}${currentWeek.date ? " · " + currentWeek.date : ""}` : `${schedule.length} week${schedule.length === 1 ? "" : "s"}`,
          badge: weeksReadyToFinalize.length > 0 ? { count: weeksReadyToFinalize.length, color: K.act } : null,
        },
      ],
    },
  ];

  if (sec === "players") return <AdminPlayers players={players} savePlayer={savePlayer} deletePlayer={deletePlayer} course={course} teams={teams} members={members} saveMember={saveMember} onBack={() => setSec(null)} />;
  if (sec === "teams") return <AdminTeams teams={teams} saveTeam={saveTeam} players={players} onBack={() => setSec(null)} />;
  if (sec === "course") return <AdminCourse course={course} saveCourseData={saveCourseData} onBack={() => setSec(null)} />;
  if (sec === "schedule") return <AdminSchedule schedule={schedule} saveWeekSchedule={saveWeekSchedule} setWeekSchedule={setWeekSchedule} deleteWeekSchedule={deleteWeekSchedule} teams={teams} leagueConfig={leagueConfig} saveLeagueConfig={saveLeagueConfig} matchResults={props.matchResults} autoSeedIfReady={props.autoSeedIfReady} clearWeekData={clearWeekData} onBack={() => setSec(null)} />;
  if (sec === "scoring") return <AdminScoring scoring={scoringRules} saveScoringRules={saveScoringRules} leagueConfig={leagueConfig} saveLeagueConfig={saveLeagueConfig} onBack={() => setSec(null)} />;
  if (sec === "members") return <AdminMembers members={members} saveMember={saveMember} deleteMember={deleteMember} players={players} onBack={() => setSec(null)} />;
  if (sec === "config") return <AdminConfig config={leagueConfig} saveLeagueConfig={saveLeagueConfig} resetSeasonData={props.resetSeasonData} importHistoricalScores={props.importHistoricalScores} recalcHandicaps={props.recalcHandicaps} matchResults={matchResults} saveMatchResult={saveMatchResult} schedule={schedule} teams={teams} scoringRules={scoringRules} saveScoringRules={saveScoringRules} onBack={() => setSec(null)} />;
  // Push notifications admin — separate file so the giant Admin.jsx
  // doesn't grow further. Inherits commish gating from Admin itself.
  if (sec === "pushstatus") return (
    <div>
      <BackBtn onClick={() => setSec(null)} />
      <NotificationsAdmin players={activePlayers} />
    </div>
  );

  const levelColor = (level) => level === "action" ? K.act : level === "warn" ? K.warn : K.hcpBlue;

  return (
    <div>
      <SectionTitle>Commissioner Dashboard</SectionTitle>

      {/* ── Status banner ── */}
      {(currentWeek || issues.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          {currentWeek && (
            <button onClick={() => setSec("schedule")} style={{
              width: "100%", background: K.card, border: `1.5px solid ${K.matchGrn}40`,
              borderRadius: 10, padding: "10px 14px", cursor: "pointer", textAlign: "left",
              display: "flex", alignItems: "center", gap: 10, marginBottom: issues.length > 0 ? 6 : 0,
            }}>
              <div style={{ display: "flex", color: K.matchGrn }}>{I.calendar(18, K.matchGrn)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: K.matchGrn, letterSpacing: 1, textTransform: "uppercase" }}>Current Week</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: K.t1 }}>
                  Week {currentWeek.week}{currentWeek.date ? ` · ${currentWeek.date}` : ""}
                  {currentWeek.side && <span style={{ marginLeft: 8, fontSize: 11, color: K.t3, fontWeight: 500 }}>{currentWeek.side === "front" ? "Front 9" : "Back 9"}</span>}
                </div>
              </div>
              <div style={{ color: K.t3, fontSize: 16 }}>›</div>
            </button>
          )}
          {issues.map((issue, i) => (
            <button key={i} onClick={() => setSec(issue.jump)} style={{
              width: "100%", background: K.card, border: `1px solid ${levelColor(issue.level)}40`,
              borderRadius: 8, padding: "8px 14px", cursor: "pointer", textAlign: "left",
              display: "flex", alignItems: "center", gap: 10, marginTop: i === 0 ? 0 : 4,
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: levelColor(issue.level), flexShrink: 0,
              }} />
              <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: K.t1 }}>{issue.text}</div>
              <div style={{ color: K.t3, fontSize: 13 }}>›</div>
            </button>
          ))}
        </div>
      )}

      {/* ── Grouped section tiles ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {groupedSections.map(group => (
          <div key={group.title}>
            <SubLabel style={{ marginBottom: 6 }}>{group.title}</SubLabel>
            <div className="admin-sections-grid">
              {group.items.map(s => (
                <button key={s.id} onClick={() => setSec(s.id)} style={{
                  background: K.card, borderRadius: 10, padding: "14px 16px",
                  border: `1px solid ${K.bdr}`, cursor: "pointer", textAlign: "left",
                  width: "100%", display: "flex", alignItems: "center", gap: 12,
                }}>
                  <div style={{ display: "flex", color: K.t3 }}>{I[s.icon](20, K.t3)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: K.t1 }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: K.t3 }}>{s.desc}</div>
                  </div>
                  {s.badge && (
                    <div style={{
                      minWidth: 22, height: 22, borderRadius: 11, padding: "0 7px",
                      background: s.badge.color + "22", border: `1px solid ${s.badge.color}60`,
                      color: s.badge.color, fontSize: 11, fontWeight: 800,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>{s.badge.count}</div>
                  )}
                  <div style={{ color: K.t3, fontSize: 16 }}>›</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function AdminPlayers({ players, savePlayer, deletePlayer, course, teams, members, saveMember, onBack }) {
  const [ed, setEd] = useState(null);
  const [f, setF] = useState({ name: "", handicapIndex: "", teeBox: "Blue" });
  const [orig, setOrig] = useState(null); // snapshot for dirty detection
  const [showInactive, setShowInactive] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const nameRef = useCallback(node => { if (node) setTimeout(() => node.focus(), 50); }, [ed]);
  const teeBoxes = course?.teeBoxes || [{ name: "White", color: "#e2e8f0", slope: 113, rating: 67 }];
  const teeColor = (name) => (teeBoxes.find(t => t.name === name) || {}).color || K.bdr;
  const isWhiteTee = (name) => { const c = teeColor(name).toLowerCase(); return c === "#fff" || c === "#ffffff" || c === "#e2e8f0" || c === "white"; };
  const teeBoxNames = teeBoxes.map(t => t.name);

  const getMember = (playerId) => (members || []).find(m => m.playerId === playerId);
  const isComm = (playerId) => getMember(playerId)?.isCommissioner === true;

  // Map player → team for inline display on the row.
  const teamForPlayer = (playerId) => (teams || []).find(t => t.player1 === playerId || t.player2 === playerId);

  // Pre-fill helper: for new players, default tee box to whatever the existing roster
  // uses most often. Most leagues have everyone on one or two tee boxes, so this saves
  // a tap for the common case.
  const defaultTeeBox = useMemo(() => {
    const active = players.filter(p => p.status !== "inactive");
    if (active.length === 0) return teeBoxes[0]?.name || "White";
    const counts = {};
    active.forEach(p => { if (p.teeBox) counts[p.teeBox] = (counts[p.teeBox] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || teeBoxes[0]?.name || "White";
  }, [players, teeBoxes]);

  const isDirty = orig && (
    f.name !== orig.name ||
    f.teeBox !== orig.teeBox ||
    String(f.handicapIndex ?? "") !== String(orig.handicapIndex ?? "") ||
    (ed === "new")
  );
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

  // Per-player missing-data flags. Used to render the red dot on the row and to decide
  // whether the row needs visual attention. Keep this in sync with the dashboard's
  // playersWithIssues calculation.
  const playerIssues = (p) => {
    const issues = [];
    if (!p.teeBox || !teeBoxNames.includes(p.teeBox)) issues.push("Missing tee box");
    if (p.handicapIndex === undefined || p.handicapIndex === null) issues.push("No handicap set");
    return issues;
  };

  /* ── Edit Card (shared for new + existing) ── */
  // Note: Commissioner toggle removed from this card. It now lives only on the Accounts
  // page, which is where commissioner status conceptually belongs (it's a property of a
  // member account, not a player).
  const EditCard = ({ isNew }) => {
    return (
      <Card style={{ padding: "10px 12px", marginBottom: 8 }}>
        {/* Row 1: Name input + close */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input ref={nameRef} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Player name" style={{ ...inputStyle, padding: "7px 10px", fontWeight: 600 }} />
          <button onClick={() => { setEd(null); setOrig(null); }} style={{ background: "none", border: "none", color: K.t3, fontSize: 15, cursor: "pointer", padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>
        {/* Row 1b: Handicap index manual override. Normally recalculated automatically when
            a week is locked; this input lets the commissioner set a starting HCP for a mid-
            season joiner or correct a miscalculated value. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: K.t3, fontWeight: 600, letterSpacing: .8, textTransform: "uppercase", flexShrink: 0, width: 60 }}>HCP Index</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={f.handicapIndex ?? ""}
            onChange={e => setF({ ...f, handicapIndex: e.target.value })}
            onFocus={e => setTimeout(() => e.target.select(), 10)}
            placeholder="0"
            style={{ ...inputStyle, padding: "7px 10px", fontWeight: 700, textAlign: "center", flex: 1 }}
          />
        </div>
        {/* Row 2: Tee box selection + Deactivate */}
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
          {!isNew && (
            <button onClick={() => {
              setConfirmModal({
                title: `Deactivate ${f.name}?`,
                message: "They'll be hidden from active rosters but their historical scores are preserved. You can reactivate later.",
                confirmLabel: "Deactivate",
                onConfirm: () => {
                  setConfirmModal(null);
                  toggleStatus(players.find(p => p.id === ed));
                  setEd(null); setOrig(null);
                },
                onCancel: () => setConfirmModal(null),
              });
            }} style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${K.red}30`, background: K.red + "10", color: K.red, fontSize: 9, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Deactivate</button>
          )}
        </div>
        {/* Row 3: Save */}
        <button onClick={isDirty ? save : undefined} style={{ width: "100%", padding: "8px 0", borderRadius: 6, background: isDirty ? K.act : K.inp, border: isDirty ? "none" : `1px solid ${K.bdr}`, color: isDirty ? K.bg : K.t3, fontSize: 12, fontWeight: 700, cursor: isDirty ? "pointer" : "default", letterSpacing: .5, transition: "all .2s" }}>{isDirty ? "Save" : "Saved"}</button>
      </Card>
    );
  };

  const PlayerRow = ({ p, inactive }) => {
    const issues = inactive ? [] : playerIssues(p);
    const team = inactive ? null : teamForPlayer(p.id);
    return (
      <div style={{ ...rowStyle, opacity: inactive ? .5 : 1 }}>
        {/* Issue indicator dot — red when player is missing required data */}
        {!inactive && issues.length > 0 && (
          <div title={issues.join(" · ")} style={{
            width: 7, height: 7, borderRadius: "50%", background: K.warn, flexShrink: 0,
          }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 5 }}>
            {p.name}
            {!inactive && isComm(p.id) && <span style={{ fontSize: 8, fontWeight: 700, color: K.warn, background: K.warn + "18", padding: "1px 5px", borderRadius: 3, textTransform: "uppercase", letterSpacing: .5, flexShrink: 0 }}>Comm</span>}
          </div>
          {/* Team-name subtitle so finding a player's team doesn't require leaving this page */}
          {team && (
            <div style={{ fontSize: 10, color: K.t3, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {team.name || "Team"}
            </div>
          )}
        </div>
        <div style={{ width: 34, textAlign: "center", fontSize: 14, fontWeight: 700, color: K.t2 }}>{p.handicapIndex}</div>
        {inactive ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={() => toggleStatus(p)} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.grn, fontSize: 10, padding: "4px 8px", cursor: "pointer", fontWeight: 600 }}>Reactivate</button>
            <button onClick={() => {
              setConfirmModal({
                title: `Delete ${p.name}?`,
                message: "This permanently removes the player record. Historical scores and match results remain in the database but won't be attributable by name. This cannot be undone.",
                confirmLabel: "Delete",
                destructive: true,
                onConfirm: () => { setConfirmModal(null); deletePlayer(p.id); },
                onCancel: () => setConfirmModal(null),
              });
            }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.red, fontSize: 10, padding: "4px 8px", cursor: "pointer", fontWeight: 600 }}>Delete</button>
          </div>
        ) : (
          <button onClick={() => { startEdit({ name: p.name, handicapIndex: String(p.handicapIndex ?? ""), teeBox: p.teeBox || teeBoxes[0]?.name || "White", status: p.status || "active" }); setEd(p.id); }} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.acc, fontSize: 10, padding: "5px 10px", cursor: "pointer", fontWeight: 600 }}>Edit</button>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={onBack} /><span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Players ({activePlayers.length} active)</span>
        <button onClick={() => { startEdit({ name: "", handicapIndex: "", teeBox: defaultTeeBox, status: "active" }); setEd("new"); }} style={{ background: K.act, border: "none", borderRadius: 8, color: K.bg, fontSize: 11, padding: "6px 12px", cursor: "pointer", fontWeight: 700 }}>+ Add</button>
      </div>
      {ed === "new" && <EditCard isNew />}
      {/* Empty state with link to next action */}
      {activePlayers.length === 0 && ed !== "new" && (
        <div style={{ background: K.card, border: `1px dashed ${K.bdr}`, borderRadius: 10, padding: "24px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: K.t2, marginBottom: 8 }}>No players yet.</div>
          <div style={{ fontSize: 11, color: K.t3 }}>Tap <strong style={{ color: K.acc }}>+ Add</strong> in the top right to create your first player.</div>
        </div>
      )}
      {activePlayers.length > 0 && (
        <>
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
        </>
      )}
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
      <ConfirmModal modal={confirmModal} />
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
  const [confirmModal, setConfirmModal] = useState(null);
  const [dragPlayer, setDragPlayer] = useState(null); // { playerId, source: { type: "pool" } | { type: "slot", teamIdx, slot } }
  // Tap-to-swap state — alternative to drag, works great on mobile and is more discoverable.
  // Tap a player to "select" it, then tap a slot or another player to swap/place.
  // Tap the selected player again (or tap outside) to cancel.
  const [tapSelected, setTapSelected] = useState(null); // { playerId, source: { type: "pool" } | { type: "slot", teamIdx, slot } }
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

  // Tap-swap equivalent of placePlayer. Same swap logic but takes an explicit source
  // object instead of relying on dragRef — because the tap flow never touches dragRef.
  // If dragging into an occupied slot from another slot, the displaced player goes
  // back to where the dragged one came from (a true 2-player swap). From the pool,
  // the displaced player returns to the pool.
  const tapSwap = (playerId, source, teamIdx, slot) => {
    setRows(prev => {
      const next = prev.map(r => ({ ...r }));
      // Remove player from any existing slot
      next.forEach(r => {
        if (r.player1 === playerId) r.player1 = "";
        if (r.player2 === playerId) r.player2 = "";
      });
      const displaced = next[teamIdx][slot];
      if (displaced && source?.type === "slot") {
        next[source.teamIdx][source.slot] = displaced;
        const sp1 = source.slot === "player1" ? displaced : next[source.teamIdx].player1;
        const sp2 = source.slot === "player2" ? displaced : next[source.teamIdx].player2;
        next[source.teamIdx].name = buildName(sp1, sp2);
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

  // Central handler for tap interactions on players and slots.
  // Pattern: first tap selects; second tap on a slot places; second tap on the same
  // selected player cancels; second tap on a different player swaps the two players.
  const handleTap = (target) => {
    // target is either { kind: "player", playerId, source } or { kind: "slot", teamIdx, slot, playerId }
    if (!tapSelected) {
      // First tap — select a player (and only if there IS a player in the target)
      if (target.kind === "player") {
        setTapSelected({ playerId: target.playerId, source: target.source });
      } else if (target.kind === "slot" && target.playerId) {
        setTapSelected({ playerId: target.playerId, source: { type: "slot", teamIdx: target.teamIdx, slot: target.slot } });
      }
      return;
    }

    // Second tap — complete or cancel
    if (target.kind === "player" && target.playerId === tapSelected.playerId) {
      // Tap on the same player cancels the selection
      setTapSelected(null);
      return;
    }

    if (target.kind === "slot") {
      // Place selected player into this slot (may trigger a swap if occupied)
      tapSwap(tapSelected.playerId, tapSelected.source, target.teamIdx, target.slot);
      setTapSelected(null);
      return;
    }

    if (target.kind === "player" && target.source?.type === "slot") {
      // Tap on a different player that's in a team slot — swap them
      tapSwap(tapSelected.playerId, tapSelected.source, target.source.teamIdx, target.source.slot);
      setTapSelected(null);
      return;
    }

    if (target.kind === "player" && target.source?.type === "pool") {
      // Selected player was in pool, tapped a different pool player — reassign selection
      setTapSelected({ playerId: target.playerId, source: target.source });
      return;
    }
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

  const handleBack = () => {
    if (!dirty) { onBack(); return; }
    setConfirmModal({
      title: "Unsaved changes",
      message: "You have unsaved team changes. Save before leaving?",
      confirmLabel: "Save",
      cancelLabel: "Discard",
      onConfirm: async () => { setConfirmModal(null); await saveAll(); onBack(); },
      onCancel: () => { setConfirmModal(null); onBack(); },
    });
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
    const isSelected = tapSelected?.playerId === playerId;
    return (
      <div
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "5px 10px", borderRadius: 6,
          background: isSelected ? K.act + "30" : isDragging ? K.act + "20" : K.card,
          border: `1px solid ${isSelected ? K.act : isDragging ? K.act : K.bdr}`,
          boxShadow: isSelected ? `0 0 0 2px ${K.act}40` : "none",
          fontSize: 12, fontWeight: 600, color: K.t1,
          cursor: "pointer", userSelect: "none",
          opacity: isDragging ? .5 : 1,
          transition: "opacity .1s, box-shadow .15s, background .15s",
          ...extraStyle,
        }}
        onClick={(e) => {
          // onClick fires on tap completion. Fires after mouseup/touchend so a completed
          // drag's final mouseup won't mis-trigger this tap — the drag's onUp fires before
          // onClick and setDragPlayer(null) is called. But to be safe, if we're mid-drag,
          // skip the tap.
          if (dragPlayer) return;
          handleTap({ kind: "player", playerId, source });
        }}
        onMouseDown={(e) => {
          // Only initiate a drag on explicit mouse-down-and-move. A quick click stays a tap.
          // We set up drag listeners but only flip dragPlayer on actual movement.
          e.preventDefault();
          const info = { playerId, source };
          dragRef.current = info;
          let moved = false;
          const onMove = (ev) => {
            const dx = ev.clientX - e.clientX;
            const dy = ev.clientY - e.clientY;
            if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
              moved = true;
              setDragPlayer(info);
              // Cancel any pending tap selection since the user is dragging
              setTapSelected(null);
            }
            if (moved) dragRef.current = { ...dragRef.current, curX: ev.clientX, curY: ev.clientY };
          };
          const onUp = (ev) => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            if (moved) {
              const target = findSlotTarget(ev.clientX, ev.clientY);
              if (target) placePlayer(playerId, target.teamIdx, target.slot);
              setDragPlayer(null);
            }
            dragRef.current = null;
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
        onTouchStart={(e) => {
          // On touch, we only kick off a drag after a short long-press so a quick tap
          // still registers as a tap. Any movement before the long-press fires also
          // cancels the tap.
          const touch = e.touches[0];
          const info = { playerId, source };
          dragRef.current = info;
          let started = false;
          let moved = false;
          const startDrag = () => {
            if (moved) return; // movement before timer means we should not drag
            started = true;
            setDragPlayer(info);
            setTapSelected(null);
            if (navigator.vibrate) navigator.vibrate(15);
          };
          const lpTimer = setTimeout(startDrag, 200);
          const onMove = (ev) => {
            const t2 = ev.touches[0];
            const dx = t2.clientX - touch.clientX;
            const dy = t2.clientY - touch.clientY;
            if (!started && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
              moved = true;
              clearTimeout(lpTimer);
            }
            if (started) ev.preventDefault();
          };
          const onEnd = (ev) => {
            clearTimeout(lpTimer);
            document.removeEventListener("touchmove", onMove);
            document.removeEventListener("touchend", onEnd);
            if (started) {
              const t = ev.changedTouches[0];
              const target = findSlotTarget(t.clientX, t.clientY);
              if (target) placePlayer(playerId, target.teamIdx, target.slot);
              setDragPlayer(null);
            }
            dragRef.current = null;
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
    const hasTapSelection = !!tapSelected;
    return (
      <div
        data-team-slot={`${teamIdx}-${slot}`}
        onClick={(e) => {
          // Tapping a slot delegates to handleTap. Empty slots receive selections and
          // place the currently-selected player; occupied slots also delegate (so taps
          // on occupied slots can swap with the current selection). Clicks on the inner
          // PlayerChip stop propagation so the chip's own onClick fires first.
          if (dragPlayer) return;
          // Only handle slot-level click when the click target is actually the slot
          // container (not a chip inside it — those have their own onClick).
          if (e.target !== e.currentTarget) return;
          handleTap({ kind: "slot", teamIdx, slot, playerId });
        }}
        style={{
          flex: 1, minHeight: 36, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
          background: isDropTarget ? K.act + "08" : hasTapSelection && isEmpty ? K.act + "08" : K.inp,
          border: `1.5px dashed ${isDropTarget ? K.act + "50" : hasTapSelection && isEmpty ? K.act + "50" : isEmpty ? K.bdr + "80" : "transparent"}`,
          ...(isEmpty ? {} : { border: `1px solid ${K.bdr}`, background: K.card }),
          cursor: hasTapSelection ? "pointer" : isEmpty ? "default" : "pointer",
          transition: "all .15s",
        }}
      >
        {isEmpty ? (
          <span style={{ fontSize: 10, color: hasTapSelection ? K.act : K.t3 + "80", fontWeight: hasTapSelection ? 700 : 400, pointerEvents: "none" }}>
            {hasTapSelection ? "Tap to place" : "Tap or drop here"}
          </span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}>
            <PlayerChip playerId={playerId} source={{ type: "slot", teamIdx, slot }} style={{ flex: 1, borderRadius: 4, border: "none", background: "transparent", padding: "4px 6px" }} />
            <button onClick={(e) => { e.stopPropagation(); removeFromSlot(teamIdx, slot); }} style={{ background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer", padding: "2px 4px", flexShrink: 0, lineHeight: 1 }}>✕</button>
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
      {/* Helper strip — shows current tap interaction state + quick cancel.
          When a player is selected, this is the clearest place to tell the user
          "you've got a selection" and give them a one-tap escape. */}
      {tapSelected && (() => {
        const p = players.find(pl => pl.id === tapSelected.playerId);
        if (!p) return null;
        return (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: K.act + "15", border: `1px solid ${K.act}50`,
            borderRadius: 8, padding: "8px 12px", marginBottom: 10,
          }}>
            <span style={{ fontSize: 11, color: K.t3, fontWeight: 600, letterSpacing: .5, textTransform: "uppercase" }}>Selected:</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: K.t1 }}>{shortName(p)}</span>
            <span style={{ flex: 1, fontSize: 11, color: K.t3 }}>Tap a slot to place, or tap another player to swap.</span>
            <button onClick={() => setTapSelected(null)} style={{
              background: K.card, border: `1px solid ${K.bdr}`, borderRadius: 6,
              color: K.t2, fontSize: 10, padding: "4px 8px", cursor: "pointer", fontWeight: 600,
            }}>Cancel</button>
          </div>
        );
      })()}

      {unassigned.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: K.t3, letterSpacing: 1, marginBottom: 6 }}>
            Unassigned ({unassigned.length})
            <span style={{ marginLeft: 10, textTransform: "none", letterSpacing: 0, fontSize: 10, color: K.t3, fontWeight: 400 }}>
              Tap to select, tap a slot to place — or drag
            </span>
          </div>
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
        {rows.map((r, i) => {
          const isIncomplete = !r.player1 || !r.player2;
          // Combined handicap is a fast read on team balance — useful when forming or
          // tweaking pairings. We sum what's there (treating empty slots as 0) so the
          // number still updates as the second player is added.
          const p1 = r.player1 ? activePlayers.find(p => p.id === r.player1) : null;
          const p2 = r.player2 ? activePlayers.find(p => p.id === r.player2) : null;
          const h1 = p1?.handicapIndex ?? 0;
          const h2 = p2?.handicapIndex ?? 0;
          const combined = (parseFloat(h1) || 0) + (parseFloat(h2) || 0);
          return (
            <div key={i} style={{
              display: "flex", flexDirection: "column", gap: 4,
              background: K.card, borderRadius: 8,
              border: `1px solid ${isIncomplete ? K.warn + "40" : K.bdr}`,
              padding: "6px 8px",
            }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ width: 24, fontSize: 13, fontWeight: 700, color: K.t3, textAlign: "center", flexShrink: 0 }}>{i + 1}</div>
                <Slot teamIdx={i} slot="player1" playerId={r.player1} />
                <Slot teamIdx={i} slot="player2" playerId={r.player2} />
              </div>
              {/* Subtitle row: incomplete-team flag OR combined handicap */}
              <div style={{ display: "flex", gap: 6, alignItems: "center", paddingLeft: 30, fontSize: 10 }}>
                {isIncomplete ? (
                  <span style={{ color: K.warn, fontWeight: 700, letterSpacing: .5 }}>
                    ⚠ Needs {!r.player1 && !r.player2 ? "two players" : "one more player"}
                  </span>
                ) : (
                  <span style={{ color: K.t3 }}>
                    Combined HCP: <span style={{ color: K.t2, fontWeight: 700 }}>{combined.toFixed(1)}</span>
                    <span style={{ marginLeft: 6, color: K.t3 }}>({h1} + {h2})</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {dirty && (
        <button onClick={saveAll} disabled={saving} style={{ width: "100%", padding: 12, borderRadius: 8, background: K.act, border: "none", color: K.bg, fontSize: 14, fontWeight: 700, cursor: "pointer", marginTop: 12, opacity: saving ? .6 : 1 }}>
          {saving ? "Saving..." : "Save All Teams"}
        </button>
      )}
      <ConfirmModal modal={confirmModal} />
    </div>
  );
}


function AdminCourse({ course, saveCourseData, onBack }) {
  const [lc, setLc] = useState(course || { name: "", frontPars: [4,4,4,3,5,4,4,3,5], backPars: [4,3,5,4,4,4,5,3,4], frontHcps: [7,3,1,9,5,13,11,17,15], backHcps: [8,14,2,10,4,16,6,18,12], teeBoxes: [{ name: "White", color: "#e2e8f0", slope: 113, rating: 67 }] });
  const [dirty, setDirty] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const upT = (ti, f, v) => { const t = [...lc.teeBoxes]; t[ti] = { ...t[ti], [f]: f === 'slope' || f === 'rating' ? parseFloat(v) || 0 : v }; setLc({ ...lc, teeBoxes: t }); setDirty(true); };

  // Store hole values in refs so editing never triggers re-render
  const holeRefs = useRef({});
  const getRef = (key, i) => {
    const k = `${key}_${i}`;
    if (!holeRefs.current[k]) holeRefs.current[k] = { current: null };
    return holeRefs.current[k];
  };

  // Keep local state (and the ref-backed hole inputs) in sync when Firestore updates —
  // unless the user is mid-edit. The inputs use defaultValue, so we must also poke them
  // through their refs for the new values to appear visually.
  useEffect(() => {
    if (!dirty && course) {
      setLc(course);
      ['frontPars', 'backPars', 'frontHcps', 'backHcps'].forEach(key => {
        (course[key] || []).forEach((v, i) => {
          const ref = getRef(key, i);
          if (ref.current) ref.current.value = String(v);
        });
      });
    }
  }, [course, dirty]);

  // On save, read all ref values into state and validate before writing.
  // Validation rules:
  //  - Pars must be 3..6 (anything outside that range is almost certainly a typo)
  //  - HCP indexes 1..9 must each appear exactly once on each side (front, back)
  // We validate the front and back independently because the database stores them as
  // separate arrays and many courses really do reuse the same handicap-index numbers
  // 1..9 on each nine.
  const [validationError, setValidationError] = useState(null);

  const saveWithRefs = async () => {
    const updated = { ...lc };
    ['frontPars', 'backPars', 'frontHcps', 'backHcps'].forEach(key => {
      updated[key] = Array.from({ length: 9 }, (_, i) => {
        const ref = getRef(key, i);
        return parseInt(ref.current?.value) || 0;
      });
    });

    const errors = [];
    [['frontPars', 'Front'], ['backPars', 'Back']].forEach(([key, label]) => {
      updated[key].forEach((v, i) => {
        if (v < 3 || v > 6) errors.push(`${label} hole ${i + 1}: par must be 3-6 (got ${v})`);
      });
    });
    [['frontHcps', 'Front'], ['backHcps', 'Back']].forEach(([key, label]) => {
      const arr = updated[key];
      const sorted = [...arr].sort((a, b) => a - b);
      const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
        errors.push(`${label} HCP indexes must be 1-9 each used exactly once`);
      }
    });

    if (errors.length > 0) {
      setValidationError(errors.join(" · "));
      return;
    }

    setValidationError(null);
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

  const handleBack = () => {
    if (!dirty) { onBack(); return; }
    setConfirmModal({
      title: "Unsaved changes",
      message: "You have unsaved course changes. Save before leaving?",
      confirmLabel: "Save",
      cancelLabel: "Discard",
      onConfirm: async () => { setConfirmModal(null); await saveWithRefs(); onBack(); },
      onCancel: () => { setConfirmModal(null); onBack(); },
    });
  };

  return (
    <div onInput={() => { if (!dirty) setDirty(true); }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={handleBack} />
        <span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Course Setup</span>
        <button onClick={saveWithRefs} style={{ background: dirty ? K.act : K.inp, border: dirty ? "none" : `1px solid ${K.bdr}`, borderRadius: 6, color: dirty ? K.bg : K.t3, fontSize: 13, padding: "7px 16px", cursor: dirty ? "pointer" : "default", fontWeight: 600, letterSpacing: .4, transition: "all .2s" }}>{dirty ? "Save" : "Saved"}</button>
      </div>
      <input value={lc.name} onChange={e => setLc({ ...lc, name: e.target.value })} placeholder="Course Name" style={{ width: "100%", maxWidth: 400, padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14, marginBottom: 12 }} />
      {validationError && (
        <div style={{
          background: K.warn + "18", border: `1px solid ${K.warn}50`,
          borderRadius: 8, padding: "8px 12px", marginBottom: 12,
          fontSize: 12, color: K.warn, fontWeight: 600,
        }}>
          ⚠ {validationError}
        </div>
      )}
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
      <ConfirmModal modal={confirmModal} />
    </div>
  );
}


function AdminSchedule({ schedule, saveWeekSchedule, setWeekSchedule, deleteWeekSchedule, teams, leagueConfig, saveLeagueConfig, matchResults, autoSeedIfReady, clearWeekData, onBack }) {
  const [step, setStep] = useState(schedule.length > 0 ? "view" : "setup");

  // Single source of truth for "derive cfg from stored leagueConfig".
  // Used for both initial cfg state AND the snapshot dirty detection compares against.
  // Falls back to sensible defaults only when a stored value is missing entirely.
  const cfgFromLeague = (lc) => ({
    dayOfWeek: lc.dayOfWeek ?? "Tuesday",
    startTime: lc.startTime ?? "4:28 PM",
    teeInterval: lc.teeInterval ?? 8,
    // totalWeeks removed from editable fields — now derived from RR + Seeded + Playoffs.
    // Still persisted to Firestore after generate so downstream can read it.
    regularWeeks: lc.regularWeeks ?? 14,
    roundRobinWeeks: lc.roundRobinWeeks ?? null,
    seededWeeks: lc.seededWeeks ?? null,
    playoffWeeks: lc.playoffWeeks ?? 2,
    startDate: lc.startDate ?? "",
    alternateNines: lc.alternateNines !== false,
    startingSide: lc.startingSide ?? "front", // 'front' | 'back' — which nine week 1 plays
  });

  const [cfg, setCfg] = useState(() => ({
    ...cfgFromLeague(leagueConfig),
    // These aren't tracked in dirty detection; saved via their own code paths.
    customSeedWeeks: undefined,
    playoffRounds: leagueConfig.playoffRounds ?? [],
  }));
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
  const [setupDirty, setSetupDirty] = useState(false);
  const [savingSetup, setSavingSetup] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  // Local editing state for seeded-matchups pairings. Swaps update this; Save commits
  // to Firestore. Prior design auto-saved on every tap but stale closures were silently
  // overwriting saves. This pattern matches the rest of the Setup tab's Save flow.
  const [localSeedWeeks, setLocalSeedWeeks] = useState(null); // null = sync from leagueConfig; array = dirty edits
  const [seedsDirty, setSeedsDirty] = useState(false);
  // Snapshot of setup fields as currently stored in leagueConfig.
  // Used for dirty detection: cfg vs this snapshot.
  // customSeedWeeks has its own localSeedWeeks tracker; everything else (including
  // playoffRounds) flows through cfg and needs to be dirty-tracked here.
  const cfgSnapshot = useMemo(() => cfgFromLeague(leagueConfig), [leagueConfig]);
  const storedPlayoffRounds = useMemo(
    () => JSON.stringify(leagueConfig.playoffRounds ?? []),
    [leagueConfig.playoffRounds]
  );

  // Watch cfg; when any tracked setup field diverges from the stored snapshot, flag dirty.
  // Primitive fields use identity compare; playoffRounds is an array of objects so it needs
  // a deep compare via JSON serialization (fast enough for our small bracket configs).
  useEffect(() => {
    const primitivesChanged = Object.keys(cfgSnapshot).some(k => cfg[k] !== cfgSnapshot[k]);
    const playoffsChanged = JSON.stringify(cfg.playoffRounds ?? []) !== storedPlayoffRounds;
    setSetupDirty(primitivesChanged || playoffsChanged);
  }, [cfg, cfgSnapshot, storedPlayoffRounds]);

  // Sync cfg from leagueConfig when it loads/refreshes — but only while clean,
  // so user edits are never clobbered mid-edit.
  // Covers two cases: (1) initial mount before leagueConfig has arrived from Firestore,
  // (2) after Generate completes and writes new values back to leagueConfig.
  useEffect(() => {
    if (!setupDirty) {
      setCfg(prev => ({
        ...prev,
        ...cfgFromLeague(leagueConfig),
        playoffRounds: leagueConfig.playoffRounds ?? prev.playoffRounds,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueConfig]);

  const saveSetup = async () => {
    setSavingSetup(true);
    // Save the same shape the generate() function saves on completion, minus the
    // computed regularWeeks/roundRobinWeeks/seededWeeks/totalWeeks (those recompute on Generate).
    const { customSeedWeeks, lockSeedsEnabled, customSeedPairs, ...scheduleFields } = cfg;
    // Build the payload: scheduleFields from cfg, plus the currently-edited seed weeks.
    // We include localSeedWeeks whenever it's populated (not just when seedsDirty is true)
    // because a race between the dirty-flag reset and the async save was causing the
    // customSeedWeeks field to silently drop from the payload.
    const payload = { ...leagueConfig, ...scheduleFields };
    if (localSeedWeeks) {
      payload.customSeedWeeks = localSeedWeeks;
    }
    await saveLeagueConfig(payload);
    setSavingSetup(false);
    setSetupDirty(false);
    setSeedsDirty(false);
  };

  const handleOnBack = () => {
    if (!setupDirty && !seedsDirty) { onBack(); return; }
    setConfirmModal({
      title: "Unsaved setup changes",
      message: "You have unsaved schedule setup changes. Save before leaving?",
      confirmLabel: "Save",
      cancelLabel: "Discard",
      onConfirm: async () => { setConfirmModal(null); await saveSetup(); onBack(); },
      onCancel: () => { setConfirmModal(null); onBack(); },
    });
  };

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

  const handleWeekBack = () => {
    if (!weekDirty) { setEditWeek(null); return; }
    setConfirmModal({
      title: "Unsaved changes",
      message: "You have unsaved week changes. Save before leaving?",
      confirmLabel: "Save",
      cancelLabel: "Discard",
      onConfirm: async () => { setConfirmModal(null); await saveWeekEdits(); setEditWeek(null); },
      onCancel: () => { setConfirmModal(null); setEditWeek(null); },
    });
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
  // Total season weeks is always derived — RR + Seeded + Playoffs. No user override.
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
    // Week counts always match by construction — totalWeeks is now derived from subTotal.

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
      setConfirmModal({
        title: "Regenerate schedule?",
        message: `Preserved weeks: ${parts.join(", ")}. All other weeks will be regenerated from the current setup.`,
        confirmLabel: "Regenerate",
        onConfirm: () => { setConfirmModal(null); runGenerate(preservedWeekNums); },
        onCancel: () => setConfirmModal(null),
      });
      return;
    }

    runGenerate(preservedWeekNums);
  };

  // Async body extracted from generate() so the confirmation prompt can be a themed modal
  // (which is async/callback-based) instead of window.confirm (which was sync).
  const runGenerate = async (preservedWeekNums) => {
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

    // ── Round-robin integrity: ensure each pairing happens at most once ──
    // Build a stable signature for a set of matches. Two rounds with the same
    // signature are the same set of pairings regardless of order.
    //
    // Why this exists: rrCursor-based placement (below) walks rrRounds from
    // index 0 and doesn't know which rounds are already consumed by preserved
    // (locked / makeup) weeks. On regenerate, a locked week originally holding
    // rrRounds[5] would be preserved with its matchups intact — but the new
    // empty slots would still start placing from rrRounds[0], so one of the
    // new slots would also get rrRounds[5] (duplicate), and rrRounds[8] would
    // never be placed (missing). Filtering rrRounds down to only the rounds
    // NOT already present as preserved matchups guarantees uniqueness.
    const roundSignature = (matches) => matches.map(m => {
      const [a, b] = m.team1 < m.team2 ? [m.team1, m.team2] : [m.team2, m.team1];
      return `${a}~${b}`;
    }).sort().join("|");

    const consumedSignatures = new Set();
    let preservedRRCount = 0;
    for (const wk of cleanSchedule) {
      if (wk.isPlayoff || wk.seeded || wk.rainedOut) continue;
      if (!wk.matches || wk.matches.length === 0) continue;
      // A week "consumes" a round-robin round if its matchups will appear in
      // the final schedule. That's true for locked weeks (scores tied to them)
      // and makeup weeks (carrying forward a rained-out week's matches).
      if (wk.locked === true || wk.makeupFor) {
        consumedSignatures.add(roundSignature(wk.matches));
        preservedRRCount++;
      }
    }

    // Rounds still available to place on new (empty) slots. Preserves the
    // generator's natural order so scheduling stays predictable when no weeks
    // are preserved (the common case on first-time generate).
    const availableRounds = rrRounds.filter(r => !consumedSignatures.has(roundSignature(r)));

    // Pre-flight cap: round-robin has a finite number of unique pairings
    // (teams.length - 1 for even counts). If the user configured more RR
    // weeks than fit, wrapping rrRounds would produce duplicate matchups —
    // exactly what we're trying to avoid. Cap rrTarget at what's actually
    // achievable, and warn the commissioner so they understand why the
    // season ended up shorter than configured.
    const maxPossibleRR = preservedRRCount + availableRounds.length;
    let rrTargetEffective = rrWeekCount;
    if (rrTargetEffective > maxPossibleRR) {
      alert(
        `Round-Robin configured for ${rrTargetEffective} weeks, but only ` +
        `${maxPossibleRR} unique matchup sets are available for ${teams.length} teams` +
        (preservedRRCount > 0 ? ` (${preservedRRCount} preserved week${preservedRRCount === 1 ? "" : "s"} already consume a round each)` : "") +
        `.\n\nShortening round-robin to ${maxPossibleRR} weeks so each pairing plays at most once.`
      );
      rrTargetEffective = maxPossibleRR;
    }

    // ── Tee-time balancing ──
    // The circle-method round-robin produces match orderings where team 1 always
    // appears in the first match of every round. Since each team's match position
    // within the round maps directly to their tee time (match 0 = first tee time,
    // match 1 = second, etc.), that gives team 1 the earliest tee time every week
    // indefinitely while other teams get stuck in other slots.
    //
    // Fix: reorder the matches WITHIN each generated round so that tee-time slots
    // are distributed evenly across all teams. Algorithm: for each round, try
    // every permutation of its matches and pick the one that minimizes the sum
    // of squared slot-counts across teams (quadratic penalty discourages any team
    // from repeatedly landing in the same slot). Seed the running histogram with
    // any preserved (locked/makeup) weeks' existing slot assignments so we
    // harmonize with scores already recorded.
    //
    // Performance: permutation count is matchesPerRound!. For typical leagues
    // (4–6 matches/round) this is 24–720 permutations × ~10 rounds = fast. Above
    // 7 matches/round we fall back to Fisher-Yates shuffle to keep generate() snappy.
    const teeCount = {};
    teams.forEach(t => { teeCount[t.id] = []; });
    const bumpTee = (tid, slot) => {
      if (!tid) return;
      if (!teeCount[tid]) teeCount[tid] = [];
      teeCount[tid][slot] = (teeCount[tid][slot] || 0) + 1;
    };
    // Seed from already-preserved weeks' existing match orders.
    for (const wk of cleanSchedule) {
      if (wk.isPlayoff || wk.seeded || wk.rainedOut) continue;
      if (!wk.matches || wk.matches.length === 0) continue;
      if (wk.locked === true || wk.makeupFor) {
        wk.matches.forEach((m, slot) => { bumpTee(m.team1, slot); bumpTee(m.team2, slot); });
      }
    }
    const permute = (arr) => {
      if (arr.length <= 1) return [arr];
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        const rest = arr.slice(0, i).concat(arr.slice(i + 1));
        for (const p of permute(rest)) out.push([arr[i], ...p]);
      }
      return out;
    };
    const scorePerm = (perm) => {
      let score = 0;
      for (let slot = 0; slot < perm.length; slot++) {
        const m = perm[slot];
        for (const tid of [m.team1, m.team2]) {
          if (!tid) continue;
          const c = (teeCount[tid]?.[slot] || 0) + 1;
          score += c * c;
        }
      }
      return score;
    };
    const balanceRound = (round) => {
      if (round.length <= 1) return round;
      // Perf cap: 7! = 5040 is fine, 8! = 40320 starts to sting with many rounds.
      if (round.length > 7) {
        const shuffled = [...round];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
      }
      let best = round;
      let bestScore = scorePerm(round);
      for (const perm of permute(round)) {
        const s = scorePerm(perm);
        if (s < bestScore) { bestScore = s; best = perm; }
      }
      return best;
    };
    const balancedRounds = availableRounds.map(round => {
      const best = balanceRound(round);
      best.forEach((m, slot) => { bumpTee(m.team1, slot); bumpTee(m.team2, slot); });
      return best;
    });

    // Count how many RR rainouts exist (these need makeup weeks in the RR block)
    const rrRainouts = cleanSchedule.filter(s =>
      s.rainedOut === true && !s.isPlayoff && !s.seeded
    ).length;

    // Total weeks: base schedule + rainouts (each rainout adds 1 dead slot)
    const totalRainouts = cleanSchedule.filter(s => s.rainedOut === true).length;

    // Walk through week positions sequentially, building each block in order
    let weekNum = 0;
    let rrCursor = 0;       // index into availableRounds for next new slot
    let rrPlayed = 0;       // how many RR matchups have been placed (played + makeup)
    let seededPlaced = 0;
    let playoffPlaced = 0;
    const rrTarget = rrTargetEffective;  // capped above
    const seededTarget = seededWeekCount;
    const playoffTarget = cfg.playoffWeeks;

    // Helper: determine which nine a week plays based on startingSide + alternateNines
    // Week 1 plays startingSide. If alternating, each subsequent week flips.
    const otherSide = (s) => (s === 'front' ? 'back' : 'front');
    const sideForWeek = (wn) => {
      const start = cfg.startingSide || 'front';
      if (!cfg.alternateNines) return start;
      return (wn - 1) % 2 === 0 ? start : otherSide(start);
    };

    // Phase 1: RR block (includes original RR weeks + makeup weeks for RR rainouts)
    // Locked seeded/playoff weeks can't move, so RR makeups go around them.
    while (rrPlayed < rrTarget) {
      weekNum++;
      const side = sideForWeek(weekNum);
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

      // Empty slot — place new RR week from balanced (unconsumed, tee-time-
      // balanced) rounds. rrCursor indexes into balancedRounds, which already
      // excludes any rounds consumed by preserved locked/makeup weeks AND has
      // been reordered within each round to spread tee-time slots evenly
      // across teams, so this never produces a duplicate matchup set nor
      // parks the same team in the first tee time every week.
      if (rrCursor >= balancedRounds.length) {
        // Shouldn't happen after the pre-flight rrTargetEffective cap;
        // defensive bail so we never silently duplicate.
        console.error("[generate] balancedRounds exhausted unexpectedly", { rrCursor, available: balancedRounds.length, rrPlayed, rrTarget });
        break;
      }
      const round = balancedRounds[rrCursor];
      rrCursor++;
      await setWeekSchedule({
        id: `${LEAGUE_ID}_w${weekNum}`, week: weekNum,
        matches: round, side,
        date: getWeekDate(weekNum - 1), isPlayoff: false,
        // Only attach makeupFor if there are actual RR rainouts being made up.
        // Firestore strict setDoc rejects fields with undefined values, so omit entirely.
        ...(rrRainouts > 0 ? { makeupFor: "rr" } : {}),
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
      const side = sideForWeek(weekNum);
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
      const side = sideForWeek(weekNum);
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
    await saveLeagueConfig({ ...leagueConfig, ...scheduleFields, regularWeeks: computedRegularWeeks, roundRobinWeeks: rrWeekCount, seededWeeks: seededWeekCount, totalWeeks });
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

  // Compute current seed (standings rank) for each team — uses shared helper so Scoring
  // and any other caller see the same seeding. Prefers lockedSeeds snapshot when present.
  const seedMap = useMemo(
    () => buildSeedMap(teams, matchResults, schedule, leagueConfig),
    [teams, matchResults, schedule, leagueConfig]
  );

  // ── Tab layout (setup / weekly / playoff) ──
  if (editWeek === null && (step === "setup" || step === "view" || step === "playoff")) {
    // Sub-tab within the schedule section
    const subTab = step === "setup" ? "setup" : step === "playoff" ? "playoff" : "weekly";
    const setSubTab = (t) => setStep(t === "weekly" ? "view" : t);

    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <BackBtn onClick={handleOnBack} />
          <span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Schedule</span>
          {(() => {
            // Roll up every dirty source that the top-right Save button should commit.
            // setupDirty = general setup fields; seedsDirty = custom seeded matchups.
            const anyDirty = setupDirty || seedsDirty;
            return (
              <button onClick={saveSetup} disabled={!anyDirty || savingSetup} style={{ background: anyDirty ? K.act : K.inp, border: anyDirty ? "none" : `1px solid ${K.bdr}`, borderRadius: 6, color: anyDirty ? K.bg : K.t3, fontSize: 13, padding: "7px 16px", cursor: anyDirty && !savingSetup ? "pointer" : "default", fontWeight: 600, letterSpacing: .4, transition: "all .2s", opacity: savingSetup ? 0.6 : 1 }}>{savingSetup ? "Saving..." : anyDirty ? "Save" : "Saved"}</button>
            );
          })()}
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
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Week 1 Starts On</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[{ id: "front", label: "Front 9" }, { id: "back", label: "Back 9" }].map(opt => {
                    const active = cfg.startingSide === opt.id;
                    return (
                      <button key={opt.id} onClick={() => setCfg({ ...cfg, startingSide: opt.id })} style={{
                        flex: 1, padding: "8px 10px", borderRadius: 8,
                        background: active ? K.act : K.inp,
                        border: `1px solid ${active ? K.act : K.bdr}`,
                        color: active ? K.bg : K.t2,
                        fontSize: 13, fontWeight: 700, cursor: "pointer",
                      }}>{opt.label}</button>
                    );
                  })}
                </div>
              </div>
            </Card>
          </div>

          <div>
            <SubLabel>Season Format</SubLabel>
            <Card style={{ padding: 14 }}>
              {/* Total season weeks — derived from RR + Seeded + Playoffs. Read-only. */}
              <div style={{ marginBottom: 12, padding: "10px 12px", background: K.act + "10", borderRadius: 8, border: `1px solid ${K.act}30` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: K.t1 }}>Total Season Weeks</span>
                  <span style={{ width: 60, padding: "6px 8px", borderRadius: 6, border: `1px solid ${K.act}40`, background: K.card, color: K.act, fontSize: 16, fontWeight: 800, textAlign: "center", boxSizing: "border-box" }}>{totalWeeks}</span>
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
                // Use local edits if dirty; otherwise derive from leagueConfig or fall back to defaults.
                // `currentWeeks` is the working copy the UI renders from.
                const currentWeeks = (seedsDirty && localSeedWeeks)
                  ? localSeedWeeks
                  : (savedWeeks && savedWeeks.length === seededRegWeeks)
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

                // Swap two seed positions — stage the change locally. The top-right Save button
                // commits all dirty seed weeks in one Firestore write. This avoids the stale-closure
                // bug where rapid taps were racing against each other's saveLeagueConfig calls
                // and silently losing edits.
                const swapSeeds = (srcPos, dstPos) => {
                  if (srcPos.pairIdx === dstPos.pairIdx && srcPos.slot === dstPos.slot) return;
                  const next = currentWeeks.map((wk, wi) => {
                    if (wi !== activeIdx) return wk.map(p => ({ ...p }));
                    const nextWk = wk.map(p => ({ ...p }));
                    const srcVal = nextWk[srcPos.pairIdx][srcPos.slot];
                    const dstVal = nextWk[dstPos.pairIdx][dstPos.slot];
                    nextWk[srcPos.pairIdx][srcPos.slot] = dstVal;
                    nextWk[dstPos.pairIdx][dstPos.slot] = srcVal;
                    return nextWk;
                  });
                  setLocalSeedWeeks(next);
                  setSeedsDirty(true);
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
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ fontSize: 11, color: K.t3, display: "flex", alignItems: "center", gap: 6 }}>
                        <span>Seeded Regular Season Matchups</span>
                        {seedsDirty && (
                          <span style={{ fontSize: 9, fontWeight: 800, color: K.act, background: K.act + "18", border: `1px solid ${K.act}60`, padding: "2px 6px", borderRadius: 4, letterSpacing: .8, textTransform: "uppercase" }}>
                            Unsaved
                          </span>
                        )}
                      </div>
                      <button
                        onClick={saveSetup}
                        disabled={!seedsDirty || savingSetup}
                        style={{
                          background: seedsDirty ? K.act : "transparent",
                          border: seedsDirty ? "none" : `1px solid ${K.bdr}`,
                          borderRadius: 6,
                          color: seedsDirty ? K.bg : K.t3,
                          fontSize: 11,
                          padding: "5px 12px",
                          cursor: seedsDirty && !savingSetup ? "pointer" : "default",
                          fontWeight: 700,
                          letterSpacing: .4,
                          transition: "all .2s",
                          opacity: savingSetup ? 0.6 : 1,
                        }}
                      >
                        {savingSetup ? "Saving..." : seedsDirty ? "Save" : "Saved"}
                      </button>
                    </div>

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

            {/* Preset buttons: skip the tedium of filling out matchups by hand for
                the common case. Top-vs-bottom is 1v8 / 2v7 / 3v6 / 4v5 for an 8-team
                round; top-of-bracket is 1v4 / 2v3 for a 4-team semifinal. Re-presets
                only affect the FIRST round — subsequent rounds typically depend on
                winners and need per-league configuration. */}
            {teams.length >= 2 && (cfg.playoffRounds || []).length > 0 && (
              <Card style={{ padding: "10px 12px", marginBottom: 8, background: K.inp, border: `1px dashed ${K.bdr}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: K.t3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
                  Quick Setup — Round 1
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    { label: `All ${teams.length} (1v${teams.length})`, fn: () => {
                      const n = teams.length;
                      const pairs = [];
                      for (let i = 0; i < Math.floor(n / 2); i++) {
                        pairs.push({ s1: String(i + 1), s2: String(n - i), s1type: "seed", s2type: "seed" });
                      }
                      return pairs;
                    }},
                    ...(teams.length >= 8 ? [{ label: "Top 8 (1v8)", fn: () => [
                      { s1: "1", s2: "8", s1type: "seed", s2type: "seed" },
                      { s1: "4", s2: "5", s1type: "seed", s2type: "seed" },
                      { s1: "2", s2: "7", s1type: "seed", s2type: "seed" },
                      { s1: "3", s2: "6", s1type: "seed", s2type: "seed" },
                    ]}] : []),
                    ...(teams.length >= 4 ? [{ label: "Top 4 (1v4)", fn: () => [
                      { s1: "1", s2: "4", s1type: "seed", s2type: "seed" },
                      { s1: "2", s2: "3", s1type: "seed", s2type: "seed" },
                    ]}] : []),
                  ].map((preset, i) => (
                    <button key={i} onClick={() => {
                      const rounds = [...(cfg.playoffRounds || [])];
                      if (rounds[0]) {
                        rounds[0] = { ...rounds[0], matchups: preset.fn() };
                        setCfg({ ...cfg, playoffRounds: rounds });
                      }
                    }} style={{
                      padding: "6px 10px", borderRadius: 6,
                      background: K.card, border: `1px solid ${K.bdr}`,
                      color: K.t2, fontSize: 11, fontWeight: 600, cursor: "pointer",
                    }}>
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: K.t3, marginTop: 6, lineHeight: 1.4 }}>
                  Replaces Round 1 matchups only. Round 2+ still need manual setup (winners/losers from prior round).
                </div>
              </Card>
            )}

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
            <EmptyState icon="calendar" title="No schedule yet" subtitle="Generate one in the Setup tab." />
          ) : (<>
            {/* Shuffle button — only shows if no weeks are locked */}
            {(() => {
              // Include new-RR weeks even when they carry the `makeupFor: "rr"`
              // marker (set during a post-rainout regenerate). Only exclude
              // TRUE makeups, which hold a specific rained-out week's matchups
              // and are keyed by the numeric week they're making up for.
              const rrWeeks = schedule.filter(s =>
                !s.isPlayoff && !s.seeded && !s.rainedOut &&
                (!s.makeupFor || s.makeupFor === "rr")
              );
              const anyLocked = schedule.some(s => s.locked);
              if (anyLocked || rrWeeks.length < 2) return null;
              const doShuffle = () => {
                setConfirmModal({
                  title: "Shuffle round-robin order?",
                  message: "Randomizes which week each matchup is played AND each team's tee-time slot across weeks. Only available before any week is locked.",
                  confirmLabel: "Shuffle",
                  onConfirm: async () => {
                    setConfirmModal(null);
                    // Two-level shuffle:
                    //  1. Fisher-Yates on the weeks (which matchup set is played which week)
                    //  2. Within each week, re-balance tee-time slots across teams using the
                    //     same permutation-search algorithm generate() uses. This ensures
                    //     shuffle actively fixes tee-time fairness instead of just preserving
                    //     whatever order each week originally had.
                    const matchups = rrWeeks.map(w => w.matches || []);
                    for (let i = matchups.length - 1; i > 0; i--) {
                      const j = Math.floor(Math.random() * (i + 1));
                      [matchups[i], matchups[j]] = [matchups[j], matchups[i]];
                    }
                    // Tee-time balancing across the shuffled week order
                    const tc = {};
                    teams.forEach(t => { tc[t.id] = []; });
                    const bump = (tid, slot) => {
                      if (!tid) return;
                      if (!tc[tid]) tc[tid] = [];
                      tc[tid][slot] = (tc[tid][slot] || 0) + 1;
                    };
                    const permuteLocal = (arr) => {
                      if (arr.length <= 1) return [arr];
                      const out = [];
                      for (let i = 0; i < arr.length; i++) {
                        const rest = arr.slice(0, i).concat(arr.slice(i + 1));
                        for (const p of permuteLocal(rest)) out.push([arr[i], ...p]);
                      }
                      return out;
                    };
                    const scorePermLocal = (perm) => {
                      let s = 0;
                      for (let slot = 0; slot < perm.length; slot++) {
                        const m = perm[slot];
                        for (const tid of [m.team1, m.team2]) {
                          if (!tid) continue;
                          const c = (tc[tid]?.[slot] || 0) + 1;
                          s += c * c;
                        }
                      }
                      return s;
                    };
                    const balanced = matchups.map(round => {
                      if (!round || round.length <= 1) return round || [];
                      let best = round;
                      if (round.length <= 7) {
                        let bestScore = scorePermLocal(round);
                        for (const perm of permuteLocal(round)) {
                          const s = scorePermLocal(perm);
                          if (s < bestScore) { bestScore = s; best = perm; }
                        }
                      } else {
                        // Perf fallback for very large rounds
                        best = [...round];
                        for (let i = best.length - 1; i > 0; i--) {
                          const j = Math.floor(Math.random() * (i + 1));
                          [best[i], best[j]] = [best[j], best[i]];
                        }
                      }
                      best.forEach((m, slot) => { bump(m.team1, slot); bump(m.team2, slot); });
                      return best;
                    });
                    for (let i = 0; i < rrWeeks.length; i++) {
                      await saveWeekSchedule({ ...rrWeeks[i], matches: balanced[i] });
                    }
                  },
                  onCancel: () => setConfirmModal(null),
                });
              };
              return (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                  <button onClick={doShuffle} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 8, color: K.acc, fontSize: 11, padding: "6px 12px", cursor: "pointer", fontWeight: 600 }}>
                    Shuffle Schedule
                  </button>
                </div>
              );
            })()}
            {/* Seed All Remaining button — appears when RR is complete but seeded weeks are empty.
                Primary purpose: recover from pre-auto-seed leagues where the commish has no
                way to unstick seeded play. Normally auto-seed fires when the last RR week is
                finalized, so this button just stays hidden. */}
            {(() => {
              if (!autoSeedIfReady) return null;
              const rrWeeks = schedule.filter(s => !s.isPlayoff && !s.seeded && !s.rainedOut);
              if (rrWeeks.length === 0) return null;
              const allRRLocked = rrWeeks.every(s => s.locked === true);
              if (!allRRLocked) return null;
              const emptySeededWeeks = schedule.filter(s => s.seeded === true && !s.isPlayoff && !s.rainedOut && (!s.matches || s.matches.length === 0));
              if (emptySeededWeeks.length === 0) return null;
              const lastRRLockedWeek = Math.max(...rrWeeks.map(s => s.week));
              const doRecoverySeed = () => {
                setConfirmModal({
                  title: `Seed ${emptySeededWeeks.length} empty week${emptySeededWeeks.length === 1 ? "" : "s"}?`,
                  message: "Generates matchups for the listed seeded weeks from current standings.",
                  confirmLabel: "Seed",
                  onConfirm: async () => {
                    setConfirmModal(null);
                    const count = (await autoSeedIfReady(lastRRLockedWeek)) || 0;
                    if (count > 0) {
                      alert(`Seeded ${count} week${count === 1 ? "" : "s"}.`);
                    } else {
                      alert("No weeks needed seeding, or not enough data to seed.");
                    }
                  },
                  onCancel: () => setConfirmModal(null),
                });
              };
              return (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                  <button onClick={doRecoverySeed} style={{ background: K.act, border: "none", borderRadius: 8, color: K.bg, fontSize: 11, padding: "6px 12px", cursor: "pointer", fontWeight: 700 }}>
                    Seed {emptySeededWeeks.length} Remaining Week{emptySeededWeeks.length === 1 ? "" : "s"}
                  </button>
                </div>
              );
            })()}
            {/* Seed-lock banner removed — the lock behavior still happens quietly
                based on leagueConfig.lockSeedsEnabled + lockedSeeds, but there's no
                need to draw attention to it in the UI. */}

            <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
              {schedule.map(wk => {
                const isPlayoffWk = wk.isPlayoff === true;
                const isRainedOut = wk.rainedOut === true;
                const isSeeded = wk.seeded === true && (!wk.matches || wk.matches.length === 0);
                const isFinalized = wk.locked === true;
                const side = wk.side || 'front';

                // Week state → left-bar color. At-a-glance scan of the season.
                // Ready-to-finalize = all matches attested but not yet locked.
                const allMatchesAttested = !isSeeded && !isRainedOut && wk.matches?.length > 0 && wk.matches.every(m =>
                  (matchResults || []).some(r => r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2 && r.attested === true)
                );
                // Current week = earliest unlocked week with pairings set. Only the first
                // qualifying week gets the "current" color — subsequent unplayed weeks are
                // "upcoming". We derive this by checking: this week unlocked AND no earlier
                // unlocked-with-matches week exists.
                const isCurrent = !isFinalized && !isRainedOut && wk.matches?.length > 0 && !allMatchesAttested &&
                  !schedule.some(w => w.week < wk.week && !w.locked && !w.rainedOut && w.matches?.length > 0 && !w.matches.every(m =>
                    (matchResults || []).some(r => r.week === w.week && r.team1Id === m.team1 && r.team2Id === m.team2 && r.attested === true)
                  ));

                const barColor =
                  isRainedOut ? K.warn :
                  isFinalized ? K.grn :
                  allMatchesAttested ? K.act :
                  isCurrent ? K.hcpBlue :
                  K.bdr;

                return (
                  <button key={wk.week} onClick={() => setEditWeek(wk.week)} style={{
                    display: "flex", alignItems: "stretch", width: "100%",
                    background: K.card, borderRadius: CARD_RADIUS,
                    border: `1px solid ${isRainedOut ? K.warn + "40" : K.bdr}`,
                    padding: 0, cursor: "pointer", textAlign: "left",
                    opacity: isRainedOut ? 0.5 : 1,
                    overflow: "hidden",
                  }}>
                    <div style={{
                      width: 4, background: barColor, flexShrink: 0,
                    }} />
                    <div style={{ display: "flex", alignItems: "center", flex: 1, padding: "10px 14px", gap: 8 }}>
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
                        {!isFinalized && allMatchesAttested && <Pill color={K.act} style={{ fontSize: 7 }}>READY</Pill>}
                        {wk.makeupFor && <Pill color={K.teal} style={{ fontSize: 7 }}>MU</Pill>}
                      </div>
                      <div style={{ color: K.t3, fontSize: 12, flexShrink: 0 }}>›</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>)}
        </>)}
        <ConfirmModal modal={confirmModal} />
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
    const buildStandingsForSeed = () => sharedBuildStandingsForSeed(teams, matchResults, schedule, leagueConfig?.standingsMethod);

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
      // Number of matches that are "bracket" (official playoff) vs "consolation" (added
      // for non-bracket teams). For the Seed Week confirm modal we want to display them
      // separately so the commissioner understands why there are more matches than the
      // configured bracket has.
      let bracketCount = 0;

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
          // Slice to only the BRACKET matches from the prior round when building
          // prevWinners/prevLosers — consolation matches share the matches array but
          // must not feed into bracket progression. Bracket matches are always at the
          // front of the array (consolation appended after at seed-time).
          const prevRoundDef = (leagueConfig.playoffRounds || [])[playoffRound - 2];
          const prevBracketCount = (prevRoundDef?.matchups || []).length;
          const prevBracketMatches = prevBracketCount > 0
            ? prevPlayoffWeek.matches.slice(0, prevBracketCount)
            : prevPlayoffWeek.matches; // no config for prev round → treat all as bracket
          // Get winners and losers in match order
          prevBracketMatches.forEach((m, mi) => {
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

        const usedTeamIds = new Set();
        const duplicateInfo = [];
        for (const mu of roundDef.matchups) {
          const t1 = resolveSlot(mu, "s1");
          const t2 = resolveSlot(mu, "s2");
          if (!t1 || !t2) continue;
          // SAFETY: a team cannot play two matches in the same week. If the bracket
          // configuration resolves the same team into two slots (e.g. "seed 8" in
          // one match + "winner of qualifying" in another where seed 8 won), skip
          // the duplicate and warn the commissioner.
          if (usedTeamIds.has(t1) || usedTeamIds.has(t2) || t1 === t2) {
            duplicateInfo.push({ mu, t1, t2 });
            continue;
          }
          usedTeamIds.add(t1);
          usedTeamIds.add(t2);
          matches.push({ team1: t1, team2: t2 });
        }

        if (matches.length !== roundDef.matchups.length) {
          if (duplicateInfo.length > 0) {
            // Show a commissioner-friendly explanation of what went wrong. The most
            // common cause: the Round 2+ bracket config has "seed N" and "winner of
            // prior match" pointing at the same team.
            // Analyze which slot configs resolved to the same team — this tells the
            // commissioner exactly which bracket slots to change, not just which
            // teams collided. Example output:
            //   "Match 1 slot 2 (seed #8) and Match 3 slot 2 (Winner M1)
            //    both resolve to B Bergeron/E Olson."
            const slotDesc = (mu, side) => {
              const type = mu[side + "type"];
              const val = mu[side];
              if (type === "seed") return `seed #${val}`;
              if (type === "winner") {
                if (val === "lowestWinner" || val === "lowestSeed") return "Lowest winner";
                if (val === "nextLowestWinner" || val === "nextLowestSeed") return "Next lowest winner";
                if (val?.startsWith("winner_")) return `Winner of M${parseInt(val.split("_")[1]) + 1}`;
                return `winner:${val}`;
              }
              if (type === "loser") {
                if (val === "highestLoser") return "Highest loser";
                if (val === "nextHighestLoser") return "Next highest loser";
                if (val?.startsWith("loser_")) return `Loser of M${parseInt(val.split("_")[1]) + 1}`;
                return `loser:${val}`;
              }
              return "?";
            };
            // For each duplicate, find where ELSE that team appeared. Walk through
            // all matchups and for each resolved team, record which (mi, side) placed it.
            const placements = new Map(); // teamId → [{matchIdx, side, mu}]
            roundDef.matchups.forEach((mu, mi) => {
              const r1 = resolveSlot(mu, "s1");
              const r2 = resolveSlot(mu, "s2");
              if (r1) {
                if (!placements.has(r1)) placements.set(r1, []);
                placements.get(r1).push({ mi, side: "s1", mu });
              }
              if (r2) {
                if (!placements.has(r2)) placements.set(r2, []);
                placements.get(r2).push({ mi, side: "s2", mu });
              }
            });
            const nameFor = (id) => teams.find(t => t.id === id)?.name || id;
            const conflictLines = [];
            for (const [teamId, spots] of placements.entries()) {
              if (spots.length < 2) continue;
              const s = spots.map(sp =>
                `Match ${sp.mi + 1} slot ${sp.side === "s1" ? 1 : 2} (${slotDesc(sp.mu, sp.side)})`
              ).join(" AND ");
              conflictLines.push(`  • ${s}\n    both resolve to ${nameFor(teamId)}`);
            }
            alert(
              `BRACKET CONFIG ERROR — duplicate teams\n\n` +
              `The bracket for this round has two slots that point to the same ` +
              `team, so the seeding can't produce a valid bracket.\n\n` +
              `Conflicts:\n${conflictLines.join("\n\n")}\n\n` +
              `HOW TO FIX:\n` +
              `1. Go back to Admin → Schedule → Playoff tab\n` +
              `2. Find this round's matchups and change one of the conflicting\n` +
              `    slots (usually the wrong one is a "seed #N" that should\n` +
              `    instead be a "winner of" reference from a prior round).\n` +
              `3. Save, then come back here and try Seed Week again.`
            );
          } else {
            alert("Could not resolve all matchups. Make sure previous rounds are finalized and bracket is configured correctly.");
          }
          return;
        }

        bracketCount = matches.length;

        // Add consolation matchups so teams not in the bracket still have tee times.
        // Picks pairings that minimize repeat meetings based on full-season history.
        const priorMatchups = collectPriorMatchups(schedule, wk.week);
        const { pairs: consolationPairs } = pairNonBracketTeams(teams, matches, priorMatchups);
        matches.push(...consolationPairs);
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

      // Build a clear confirm message that distinguishes bracket matches from
      // consolation pairings. Consolation exists only for playoff weeks where the
      // bracket doesn't include every team.
      const fmtPair = (m) => `• ${gn(m.team1)} vs ${gn(m.team2)}`;
      let msg;
      if (isPlayoff && bracketCount > 0 && matches.length > bracketCount) {
        const bracket = matches.slice(0, bracketCount);
        const consolation = matches.slice(bracketCount);
        msg = `${roundName}:\n${bracket.map(fmtPair).join("\n")}\n\nConsolation (minimizes repeat matchups):\n${consolation.map(fmtPair).join("\n")}`;
      } else {
        msg = `${roundName}:\n\n${matches.map(fmtPair).join("\n")}`;
      }

      setConfirmModal({
        title: `Seed Week ${wk.week}?`,
        message: msg,
        confirmLabel: "Seed",
        onConfirm: async () => {
          setConfirmModal(null);
          await saveWeekSchedule({ ...wk, matches });
        },
        onCancel: () => setConfirmModal(null),
      });
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
        ? `This will skip this week, insert a makeup at week ${makeupWeekNum}, push unlocked future weeks forward, and extend the season by one week.`
        : `This will skip this week, insert makeup matchups at week ${makeupWeekNum}, push unlocked future weeks forward, and extend the season by one week.`;
      setConfirmModal({
        title: `Rain out Week ${wk.week}?`,
        message: msgDetail,
        confirmLabel: "Rain Out",
        destructive: true,
        onConfirm: async () => {
          setConfirmModal(null);
          await doRainOut();
        },
        onCancel: () => setConfirmModal(null),
      });
    };

    // Body of rain-out flow extracted from handleRainOut so confirm + action can be split.
    const doRainOut = async () => {
      const isRoundRobin = !wk.isPlayoff && !wk.seeded && !wk.makeupFor;
      const lastRRWeekNum = Math.max(0, ...schedule.filter(s =>
        (!s.isPlayoff && !s.seeded && !s.makeupFor) || (s.makeupFor && !s.isPlayoff)
      ).map(s => s.week));
      const insertTarget = isRoundRobin ? lastRRWeekNum + 1 : wk.week + 1;
      let makeupWeekNum = insertTarget;
      while (schedule.some(s => s.week === makeupWeekNum && s.locked === true)) {
        makeupWeekNum++;
      }

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
              <button onClick={() => {
                setConfirmModal({
                  title: `Undo rain out for Week ${wk.week}?`,
                  message: "Restores the week and reverses all week-number shifts. Locked weeks stay put.",
                  confirmLabel: "Undo Rain Out",
                  onConfirm: async () => {
                    setConfirmModal(null);

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
                  },
                  onCancel: () => setConfirmModal(null),
                });
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
              // Label generator — covers all slot types so the preview never shows
              // a bare "?" that leaves the commissioner wondering what's broken.
              // Unrecognized configs surface as "UNSET" with warning styling so the
              // user knows exactly which slot to fix in the bracket config.
              const labelFor = (type, val) => {
                if (type === "seed") return val ? `#${val}` : "UNSET seed";
                if (type === "winner") {
                  if (val === "lowestWinner" || val === "lowestSeed") return "Lowest winner";
                  if (val === "nextLowestWinner" || val === "nextLowestSeed") return "Next lowest";
                  if (val?.startsWith("winner_")) return `Winner M${parseInt(val.split("_")[1]) + 1}`;
                  return "UNSET winner";
                }
                if (type === "loser") {
                  if (val === "highestLoser") return "Highest loser";
                  if (val === "nextHighestLoser") return "Next highest loser";
                  if (val?.startsWith("loser_")) return `Loser M${parseInt(val.split("_")[1]) + 1}`;
                  return "UNSET loser";
                }
                return "UNSET";
              };
              const s1Label = labelFor(mu.s1type, mu.s1);
              const s2Label = labelFor(mu.s2type, mu.s2);
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
          {/* Duplicate team detector + repair — covers the edge case where a bad
              bracket config has already been seeded + finalized with duplicates,
              so normal drag/drop editing won't work (the affected team isn't on
              the grid to swap in, and the integrity check blocks any swap). The
              repair flow clears the week's matches + match results + scores so
              the week can be fully re-seeded from a corrected bracket config. */}
          {(() => {
            if (!wk.matches || wk.matches.length === 0) return null;
            const seen = new Set();
            const dupes = new Set();
            for (const m of wk.matches) {
              for (const tid of [m.team1, m.team2]) {
                if (!tid) continue;
                if (seen.has(tid)) dupes.add(tid);
                seen.add(tid);
              }
            }
            if (dupes.size === 0) return null;
            const dupeNames = [...dupes].map(id => teams.find(t => t.id === id)?.name || id).join(", ");
            return (
              <div style={{ background: K.red + "12", border: `1.5px solid ${K.red}60`, borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: K.red, marginBottom: 4, letterSpacing: .3 }}>
                  ⚠ DUPLICATE TEAM DETECTED
                </div>
                <div style={{ fontSize: 12, color: K.t2, marginBottom: 10, lineHeight: 1.4 }}>
                  {dupeNames} {dupes.size === 1 ? "appears" : "appear"} in more than one match this week. This happens when the bracket configuration has "seed N" and "winner of prior round" both resolving to the same team. Fix the bracket config in League Setup, then repair this week to clear scores and re-seed.
                </div>
                <button onClick={() => {
                  setConfirmModal({
                    title: `Repair Week ${wk.week}?`,
                    message: `This will DELETE all match results, hole scores, and CTP entries for Week ${wk.week}, then clear the pairings so you can re-seed.\n\nUse this only after you've fixed the bracket configuration in League Setup. This action cannot be undone.`,
                    confirmLabel: "Repair Week",
                    destructive: true,
                    onConfirm: async () => {
                      setConfirmModal(null);
                      if (clearWeekData) await clearWeekData(wk.week);
                      const cleaned = { ...wk, matches: [], locked: false, seeded: true };
                      await saveWeekSchedule(cleaned);
                      setLocalWk(cleaned);
                    },
                    onCancel: () => setConfirmModal(null),
                  });
                }} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.red, border: "none", color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer", letterSpacing: .3 }}>
                  Repair Week — Clear Scores & Pairings
                </button>
              </div>
            );
          })()}

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
              setConfirmModal({
                title: "Re-seed this week?",
                message: "Replaces current matchups with fresh pairings from current standings. Does nothing if the week is already finalized.",
                confirmLabel: "Re-seed",
                onConfirm: async () => {
                  setConfirmModal(null);
                  await saveWeekSchedule({ ...wk, matches: [], seeded: true });
                  setLocalWk({ ...wk, matches: [], seeded: true });
                },
                onCancel: () => setConfirmModal(null),
              });
            }} style={{ width: "100%", padding: 8, borderRadius: 8, marginBottom: 8, background: K.logoBright + "12", border: `1px solid ${K.logoBright}30`, color: K.logoBright, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              Re-seed from Standings
            </button>
          )}

          <div style={{ fontSize: 11, color: K.t3, marginBottom: 12 }}>
            {dragTeam && !dragTeam.dragging ? "Tap another team to swap" : "Tap to select · Hold and drag to move"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(() => {
              // doSwap: swap two team slots identified by (matchIdx, slot).
              // Defensive: we deliberately IGNORE srcInfo.teamId / targetInfo.teamId and
              // read the current occupants directly from the live `wk.matches`. This avoids
              // a class of bugs where stale DOM attributes (`data-team-card`) or stale drag
              // state could cause the handler to "swap in" a team that was already moved,
              // producing a duplicate. Position indices are the only input that matters.
              const doSwap = (srcInfo, targetInfo) => {
                if (srcInfo.matchIdx === targetInfo.matchIdx && srcInfo.slot === targetInfo.slot) return;
                const newMatches = wk.matches.map(mm => ({ ...mm }));
                const srcMatch = newMatches[srcInfo.matchIdx];
                const dstMatch = newMatches[targetInfo.matchIdx];
                if (!srcMatch || !dstMatch) return;
                // Read the live occupants — NOT the teamIds passed in via srcInfo/targetInfo,
                // which may be stale relative to the current state.
                const liveSrcTeamId = srcMatch[srcInfo.slot];
                const liveDstTeamId = dstMatch[targetInfo.slot];
                if (!liveSrcTeamId || !liveDstTeamId) return;
                if (liveSrcTeamId === liveDstTeamId) return; // same team — no-op
                srcMatch[srcInfo.slot] = liveDstTeamId;
                dstMatch[targetInfo.slot] = liveSrcTeamId;
                // Post-swap integrity check — every team must appear exactly once across all matches.
                // If something went sideways (e.g. wk.matches was malformed coming in), abort
                // rather than commit duplicates to state.
                const seen = new Set();
                let ok = true;
                for (const mm of newMatches) {
                  for (const tid of [mm.team1, mm.team2]) {
                    if (!tid) continue;
                    if (seen.has(tid)) { ok = false; break; }
                    seen.add(tid);
                  }
                  if (!ok) break;
                }
                if (!ok) {
                  console.error("doSwap: integrity check failed, aborting", newMatches);
                  return;
                }
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
        <ConfirmModal modal={confirmModal} />
      </div>
    );
  }
}


function AdminScoring({ scoring, saveScoringRules, leagueConfig, saveLeagueConfig, onBack }) {
  const [lc, setLc] = useState({ ...scoring });
  const [cfg, setCfg] = useState({ scoringFormat: "lowHighBonus", bonusType: "teamNetTotal", standingsMethod: "points", ...leagueConfig });
  const [dirty, setDirty] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);

  // Keep local form state in sync when Firestore updates — as long as the user isn't
  // mid-edit. Prevents silently overwriting concurrent changes on Save.
  useEffect(() => {
    if (!dirty) {
      setLc({ ...scoring });
      setCfg({ scoringFormat: "lowHighBonus", bonusType: "teamNetTotal", standingsMethod: "points", ...leagueConfig });
    }
  }, [scoring, leagueConfig, dirty]);

  const save = async () => {
    try {
      await saveScoringRules(lc);
      await saveLeagueConfig({ ...leagueConfig, scoringFormat: cfg.scoringFormat, bonusType: cfg.bonusType, standingsMethod: cfg.standingsMethod, playoffTiebreaker: cfg.playoffTiebreaker || "hardestHole" });
      setDirty(false);
    } catch (e) {
      console.error("AdminScoring save failed:", e);
      alert("Save failed: " + e.message);
    }
  };

  const F = ({ label, field }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${K.bdr}15` }}>
      <span style={{ fontSize: 12, color: K.t2 }}>{label}</span>
      <input value={lc[field]} onChange={e => { setLc({ ...lc, [field]: parseFloat(e.target.value) || 0 }); setDirty(true); }} onFocus={e => setTimeout(() => e.target.select(), 10)} type="number" inputMode="decimal" step="0.5" style={{ width: 58, padding: "5px 6px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, textAlign: "center" }} />
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

  const handleBack = () => {
    if (!dirty) { onBack(); return; }
    setConfirmModal({
      title: "Unsaved changes",
      message: "You have unsaved scoring rules changes. Save before leaving?",
      confirmLabel: "Save",
      cancelLabel: "Discard",
      onConfirm: async () => { setConfirmModal(null); await save(); onBack(); },
      onCancel: () => { setConfirmModal(null); onBack(); },
    });
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
        { id: "teamNetTotal", label: "Team Net Match Play", desc: "Combined team net per hole — winner of each hole earns 1 up; match-play status (1UP, 3&2, TIED) decides points" },
      ]} value={format} onChange={v => setCfg({ ...cfg, scoringFormat: v })} />

      {/* Worked example so the format choice isn't abstract. Numbers pull from the
          current scoring rules so the preview reflects what will actually happen. */}
      <Card style={{ padding: "10px 12px", marginBottom: 16, background: K.inp, border: `1px dashed ${K.bdr}` }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: K.t3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
          Example Week
        </div>
        {isLowHigh ? (
          <div style={{ fontSize: 12, color: K.t2, lineHeight: 1.7 }}>
            <div>• Your low-HCP player beat theirs <span style={{ color: K.t1, fontWeight: 700 }}>→ +{lc.matchWin ?? 3} pts</span></div>
            <div>• Your high-HCP player tied theirs <span style={{ color: K.t1, fontWeight: 700 }}>→ +{lc.matchTie ?? 1.5} pts</span></div>
            <div>• Your team net total won the bonus <span style={{ color: K.t1, fontWeight: 700 }}>→ +{lc.bonusWin ?? 3} pts</span></div>
            <div style={{ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${K.bdr}`, color: K.t1, fontWeight: 700 }}>
              Total: {((lc.matchWin ?? 3) + (lc.matchTie ?? 1.5) + (lc.bonusWin ?? 3)).toFixed(1)} pts this week
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: K.t2, lineHeight: 1.7 }}>
            <div>• Each hole: combined team net vs combined team net</div>
            <div>• Lower team net wins the hole — track 1UP, 2UP, etc.</div>
            <div>• Match ends 2&1 (your team) <span style={{ color: K.t1, fontWeight: 700 }}>→ +{lc.matchWin ?? 3} pts</span></div>
            <div style={{ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${K.bdr}`, color: K.t1, fontWeight: 700 }}>
              Total: {(lc.matchWin ?? 3).toFixed(1)} pts this week
            </div>
            <div style={{ fontSize: 10, color: K.t3, marginTop: 6, fontStyle: "italic" }}>
              Match-play TIED → both teams get {(lc.matchTie ?? 1.5).toFixed(1)} pts
            </div>
          </div>
        )}
      </Card>

      <SubLabel>Standings Method</SubLabel>
      <Radio items={[
        { id: "points", label: "Points-Based", desc: "Teams accumulate points each week — most points wins" },
        { id: "record", label: "Win-Loss-Tie Record", desc: "Standings by win percentage — like a traditional sports league" },
      ]} value={cfg.standingsMethod} onChange={v => setCfg({ ...cfg, standingsMethod: v })} />

      {/* Tiebreaker: total holes won across the season. The prior UI offered a
          "Head-to-Head" option but it was never wired up on the sort side, so the
          dropdown has been removed — holes won is the only real tiebreaker. */}

      {/* Playoff Tiebreaker — playoff matches can't end in a tie, so we need a
          deterministic rule for deciding who advances when the overall match is even.
          Handled separately from regular-season ties which are allowed. */}
      <SubLabel>Playoff Tiebreaker</SubLabel>
      <Radio items={[
        { id: "hardestHole", label: "Hardest Handicap Hole", desc: "Winner decided by score on the hole with HCP index 1 on the nine played. Most common playoff tiebreaker." },
        { id: "sumHoleHcpLosses", label: "Sum of HCP Indexes on Holes Lost", desc: "Lower total wins (losing on easy holes hurts more than losing on hard ones)." },
        { id: "lowestNet", label: "Lowest Team Net Total", desc: "Combined team net score — lowest wins." },
        { id: "lowestGross", label: "Lowest Team Gross Total", desc: "Combined team gross score — lowest wins." },
        { id: "higherSeed", label: "Higher Seed Advances", desc: "Simplest option — the better regular-season seed wins the tie." },
      ]} value={cfg.playoffTiebreaker || "hardestHole"} onChange={v => setCfg({ ...cfg, playoffTiebreaker: v })} />

      <div className="scoring-grid">
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
      <ConfirmModal modal={confirmModal} />
    </div>
  );
}


function AdminMembers({ members, saveMember, deleteMember, players, onBack }) {
  // Draft state lets the user try several dropdown/comm selections before committing.
  // The old version wrote on every change, so scrolling through a dropdown on mobile
  // would fire a write per option tapped. Draft-then-save is consistent with the rest of
  // admin and dramatically less chatty with Firestore.
  const [drafts, setDrafts] = useState({}); // { [memberId]: { playerId, isCommissioner } }
  const [confirmModal, setConfirmModal] = useState(null);
  const [saving, setSaving] = useState(false);

  // Resolve the effective value for a member — draft takes precedence over stored.
  const eff = (m, field) => (drafts[m.id] && field in drafts[m.id]) ? drafts[m.id][field] : m[field];

  const setDraft = (memberId, field, value) => {
    setDrafts(prev => {
      const next = { ...prev };
      const existing = next[memberId] || {};
      next[memberId] = { ...existing, [field]: value };
      return next;
    });
  };

  // Is this member's draft different from what's stored?
  const memberDirty = (m) => {
    const d = drafts[m.id];
    if (!d) return false;
    if ("playerId" in d && d.playerId !== (m.playerId || "")) return true;
    if ("isCommissioner" in d && !!d.isCommissioner !== !!m.isCommissioner) return true;
    return false;
  };

  const dirty = members.some(memberDirty);
  const dirtyCount = members.filter(memberDirty).length;

  const saveAll = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    for (const m of members) {
      if (!memberDirty(m)) continue;
      const d = drafts[m.id];
      const updated = {
        ...m,
        ...(("playerId" in d) ? { playerId: d.playerId } : {}),
        ...(("isCommissioner" in d) ? { isCommissioner: d.isCommissioner } : {}),
      };
      await saveMember(updated);
    }
    setDrafts({});
    setSaving(false);
  };

  // Dropdown-exclusion uses EFFECTIVE playerIds so the draft state behaves consistently —
  // selecting Alice on one member immediately removes her from the dropdown on another.
  const effectiveAssigned = members.map(m => eff(m, "playerId")).filter(Boolean);

  // Handle the edge case of a member whose stored playerId references a player who no
  // longer exists (e.g., the commissioner deleted the player but not the account).
  const playerExists = (playerId) => players.some(p => p.id === playerId);

  const handleBack = async () => {
    if (dirty) {
      setConfirmModal({
        title: "Unsaved changes",
        message: `You have ${dirtyCount} unsaved member change${dirtyCount === 1 ? "" : "s"}. Save before leaving?`,
        confirmLabel: "Save",
        cancelLabel: "Discard",
        onConfirm: async () => { setConfirmModal(null); await saveAll(); onBack(); },
        onCancel: () => { setConfirmModal(null); onBack(); },
      });
      return;
    }
    onBack();
  };

  const handleDelete = (m) => {
    setConfirmModal({
      title: `Remove ${m.name}?`,
      message: `This removes their sign-in access. Their player profile stays — if you want to remove that too, go to the Players page.`,
      confirmLabel: "Remove",
      onConfirm: async () => { setConfirmModal(null); await deleteMember(m.id); },
      onCancel: () => setConfirmModal(null),
    });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={handleBack} />
        <span style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 18, color: K.t1 }}>Accounts</span>
        <button
          onClick={saveAll}
          disabled={!dirty || saving}
          style={{
            background: dirty ? K.act : K.inp, border: dirty ? "none" : `1px solid ${K.bdr}`,
            borderRadius: 6, color: dirty ? K.bg : K.t3, fontSize: 13,
            padding: "7px 16px", cursor: dirty && !saving ? "pointer" : "default",
            fontWeight: 600, letterSpacing: .4, transition: "all .2s",
            opacity: saving ? .6 : 1,
          }}
        >
          {saving ? "Saving..." : dirty ? `Save${dirtyCount > 1 ? ` (${dirtyCount})` : ""}` : "Saved"}
        </button>
      </div>
      <div style={{ fontSize: 12, color: K.t3, marginBottom: 12, lineHeight: 1.5 }}>
        Members sign in via Google or email and link to a player profile. Commissioner
        access is granted here.
      </div>

      {members.length === 0 && (
        <div style={{ background: K.card, border: `1px dashed ${K.bdr}`, borderRadius: 10, padding: "24px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: K.t2, marginBottom: 4 }}>No accounts yet.</div>
          <div style={{ fontSize: 11, color: K.t3 }}>Members appear here after they sign in and complete the join flow.</div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {members.map(m => {
          const effectivePlayerId = eff(m, "playerId") || "";
          const effectiveComm = !!eff(m, "isCommissioner");
          const isUnlinked = !effectivePlayerId || !playerExists(effectivePlayerId);
          const isDirty = memberDirty(m);
          return (
            <Card key={m.id} style={{
              padding: "10px 12px",
              border: isDirty ? `1.5px solid ${K.act}60` : `1px solid ${K.bdr}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name || "—"}</div>
                    <div style={{ fontSize: 10, color: K.t3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.email}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                  {isUnlinked && (
                    <Pill color={K.hcpBlue} style={{ fontSize: 8 }}>UNLINKED</Pill>
                  )}
                  {effectiveComm && (
                    <Pill color={K.warn} style={{ fontSize: 8 }}>COMM</Pill>
                  )}
                  <button onClick={() => handleDelete(m)} style={{ background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 6, color: K.red, fontSize: 10, padding: "3px 6px", cursor: "pointer" }}>✕</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select
                  value={effectivePlayerId}
                  onChange={e => setDraft(m.id, "playerId", e.target.value)}
                  style={{ flex: 1, padding: 6, borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 12 }}
                >
                  <option value="">— Unlinked —</option>
                  {players
                    .filter(p => !effectiveAssigned.includes(p.id) || p.id === effectivePlayerId)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button
                  onClick={() => setDraft(m.id, "isCommissioner", !effectiveComm)}
                  style={{
                    padding: "5px 8px", borderRadius: 6,
                    background: effectiveComm ? K.warn + "20" : K.inp,
                    border: `1px solid ${effectiveComm ? K.warn + "40" : K.bdr}`,
                    color: effectiveComm ? K.warn : K.t3,
                    fontSize: 10, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {effectiveComm ? "Revoke" : "Make Comm"}
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {confirmModal && <ConfirmModal modal={confirmModal} />}
    </div>
  );
}


function AdminConfig({ config, saveLeagueConfig, resetSeasonData, importHistoricalScores, recalcHandicaps, matchResults, saveMatchResult, schedule, teams, scoringRules, saveScoringRules, onBack }) {
  const [lc, setLc] = useState({ ...config });
  const [sr, setSr] = useState({ ...(scoringRules || {}) });
  const [dirty, setDirty] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [attesting, setAttesting] = useState(false);
  const [attestResult, setAttestResult] = useState(null);
  const [recalcing, setRecalcing] = useState(false);
  const [recalcResult, setRecalcResult] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  // Keep local form state in sync when the Firestore doc updates — as long as the user
  // hasn't started editing. Prevents silently overwriting a concurrent change made in
  // another tab (or by another commissioner) when this user eventually hits Save.
  useEffect(() => { if (!dirty) setLc({ ...config }); }, [config, dirty]);
  useEffect(() => { if (!dirty && scoringRules) setSr({ ...scoringRules }); }, [scoringRules, dirty]);

  const save = async () => {
    await saveLeagueConfig(lc);
    // Only write scoring rules if they actually changed — avoids churning the doc
    // every time a user hits Save after editing only the league name.
    if (scoringRules && (sr.hcpRecentCount !== scoringRules.hcpRecentCount || sr.hcpBestCount !== scoringRules.hcpBestCount)) {
      await saveScoringRules(sr);
    }
    setDirty(false);
  };

  const handleBack = async () => {
    if (dirty) {
      setConfirmModal({
        title: "Unsaved changes",
        message: "You have unsaved changes. Save before leaving?",
        confirmLabel: "Save",
        cancelLabel: "Discard",
        onConfirm: async () => { setConfirmModal(null); await save(); onBack(); },
        onCancel: () => { setConfirmModal(null); onBack(); },
      });
      return;
    }
    onBack();
  };

  const handleReset = () => {
    setConfirmModal({
      title: "Reset all season data?",
      message: "This permanently deletes all hole scores, match results, CTP data, and the entire schedule (all weeks, rainouts, makeups). After reset, you'll need to regenerate the schedule from scratch. This cannot be undone.",
      confirmLabel: "Reset",
      destructive: true,
      onConfirm: () => {
        // Two-step confirm for a genuinely destructive action
        setConfirmModal({
          title: "Really reset?",
          message: "This wipes ALL season data including the schedule itself. Last chance to cancel.",
          confirmLabel: "Yes, wipe everything",
          destructive: true,
          onConfirm: async () => {
            setConfirmModal(null);
            setResetting(true);
            await resetSeasonData();
            setResetting(false);
          },
          onCancel: () => setConfirmModal(null),
        });
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const handleAttestAll = () => {
    const unattested = (matchResults || []).filter(r => r.attested !== true);
    if (unattested.length === 0) {
      setAttestResult({ updated: 0, message: "No unattested match results" });
      return;
    }
    setConfirmModal({
      title: `Force-attest ${unattested.length} match${unattested.length === 1 ? "" : "es"}?`,
      message: "DEV BUILD ONLY — bypasses the opposing-team signature requirement.",
      confirmLabel: "Attest all",
      onConfirm: async () => {
        setConfirmModal(null);
        setAttesting(true);
        setAttestResult(null);
        let completed = 0;
        try {
          for (const r of unattested) {
            const t1 = (teams || []).find(t => t.id === r.team1Id);
            const t2 = (teams || []).find(t => t.id === r.team2Id);
            const allPids = [t1?.player1, t1?.player2, t2?.player1, t2?.player2].filter(Boolean);
            const nonSignerPids = allPids.filter(pid => pid !== r.signedByPlayerId);
            await saveMatchResult({ ...r, attested: true, attestedBy: nonSignerPids });
            completed++;
          }
          setAttestResult({ updated: completed });
        } catch (e) {
          setAttestResult({ error: `${e.message} (${completed} of ${unattested.length} completed before error)` });
        }
        setAttesting(false);
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const handleRecalc = async () => {
    setRecalcing(true);
    setRecalcResult(null);
    try {
      const updated = await recalcHandicaps();
      setRecalcResult({ updated });
    } catch (e) {
      setRecalcResult({ error: e.message });
    }
    setRecalcing(false);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <BackBtn onClick={handleBack} />
        <button onClick={save} style={{ background: dirty ? K.act : K.inp, border: dirty ? "none" : `1px solid ${K.bdr}`, borderRadius: 6, color: dirty ? K.bg : K.t3, fontSize: 13, padding: "7px 16px", cursor: dirty ? "pointer" : "default", fontWeight: 600, letterSpacing: .4, transition: "all .2s" }}>{dirty ? "Save" : "Saved"}</button>
      </div>
      <SubLabel>League Basics</SubLabel>
      <Card style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>League Name</div><input value={lc.name} onChange={e => { setLc({ ...lc, name: e.target.value }); setDirty(true); }} style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} /></div>
        <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Season Year</div><input value={lc.year} onChange={e => { setLc({ ...lc, year: parseInt(e.target.value) || 2026 }); setDirty(true); }} type="number" inputMode="numeric" style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14 }} /></div>
        <div><div style={{ fontSize: 11, color: K.t3, marginBottom: 4 }}>Invite Code</div><input value={lc.inviteCode || ""} onChange={e => { setLc({ ...lc, inviteCode: e.target.value.toUpperCase() }); setDirty(true); }} placeholder="e.g. MNQ2026" style={{ width: "100%", padding: 10, borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14, letterSpacing: 2, textTransform: "uppercase" }} /><div style={{ fontSize: 10, color: K.t3, marginTop: 4 }}>New members must enter this code to join. Leave blank to allow anyone.</div></div>
      </Card>

      {/* ── Handicaps section ──
          All handicap controls in one place: the calc settings (how handicaps are
          derived from historical rounds) and the recalc action button. Previously
          the calc settings lived in Scoring Rules and the recalc button was buried
          in the old Basic Info "Danger Zone" — commissioners had to visit two pages
          to understand or manage handicaps. */}
      {scoringRules && (
        <>
          <SubLabel>Handicaps</SubLabel>
          <Card style={{ padding: "2px 14px", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${K.bdr}15` }}>
              <span style={{ fontSize: 12, color: K.t2 }}>Recent rounds to consider</span>
              <input
                value={sr.hcpRecentCount ?? ""}
                onChange={e => { setSr({ ...sr, hcpRecentCount: parseInt(e.target.value) || 0 }); setDirty(true); }}
                onFocus={e => setTimeout(() => e.target.select(), 10)}
                type="number" inputMode="numeric" step="1"
                style={{ width: 58, padding: "5px 6px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, textAlign: "center" }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0" }}>
              <span style={{ fontSize: 12, color: K.t2 }}>Best rounds to average</span>
              <input
                value={sr.hcpBestCount ?? ""}
                onChange={e => { setSr({ ...sr, hcpBestCount: parseInt(e.target.value) || 0 }); setDirty(true); }}
                onFocus={e => setTimeout(() => e.target.select(), 10)}
                type="number" inputMode="numeric" step="1"
                style={{ width: 58, padding: "5px 6px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, textAlign: "center" }}
              />
            </div>
          </Card>
          <div style={{ fontSize: 10, color: K.t3, marginBottom: 16, lineHeight: 1.5, paddingLeft: 4 }}>
            Handicap = average of the {sr.hcpBestCount || "N"} best rounds out of the most recent {sr.hcpRecentCount || "M"} rounds. Players with fewer rounds use a proportionally scaled count.
          </div>

          {recalcHandicaps && (
            <Card style={{ padding: 14, marginBottom: 16, border: `1px solid ${K.teal}30` }}>
              <div style={{ fontSize: 12, color: K.t2, marginBottom: 10, lineHeight: 1.5 }}>
                Recalculate all player handicaps now from historical scores. Normally runs automatically when a week is locked — use this to force a sync if stored values are out of date.
              </div>
              <button onClick={handleRecalc} disabled={recalcing} style={{ width: "100%", padding: 12, borderRadius: 8, background: K.teal + "15", border: `1.5px solid ${K.teal}50`, color: K.teal, fontSize: 13, fontWeight: 700, cursor: recalcing ? "default" : "pointer", opacity: recalcing ? 0.6 : 1 }}>
                {recalcing ? "Recalculating..." : "Recalc Handicaps Now"}
              </button>
              {recalcResult && (
                <div style={{ fontSize: 11, color: recalcResult.error ? K.red : K.grn, marginTop: 8, textAlign: "center", fontWeight: 600 }}>
                  {recalcResult.error ? `Error: ${recalcResult.error}` : `Done! ${recalcResult.updated} player(s) updated`}
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {/* ── Danger Zone — destructive only ── */}
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

          {saveMatchResult && import.meta.env.DEV && (
          <Card style={{ padding: 14, border: `1px solid ${K.warn}30`, marginTop: 8 }}>
            <div style={{ fontSize: 12, color: K.t2, marginBottom: 10, lineHeight: 1.5 }}>
              <strong>Dev build only — hidden in production.</strong> Force-attest every match
              result, bypassing the opposing-team signature requirement.
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

      {/* ── Confirm modal ── */}
      <ConfirmModal modal={confirmModal} />
    </div>
  );
}


