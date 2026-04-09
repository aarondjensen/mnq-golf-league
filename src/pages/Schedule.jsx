import { useState, useMemo } from "react";
import { K, SectionTitle, SubLabel, Card, Pill, EmptyState, getTeeTime, getWeekSide, REGULAR_WEEKS } from "../theme";

function lastNamesOnly(teamName) {
  if (!teamName) return "";
  return teamName.split(/\s*\/\s*/).map(part => {
    const words = part.trim().split(/\s+/);
    return words.length > 1 ? words[words.length - 1] : words[0];
  }).join(" / ");
}

export default function ScheduleView({ schedule, teams, players, matchResults, leagueUser, leagueConfig }) {
  const [showAll, setShowAll] = useState(false);
  const [myOnly, setMyOnly] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState({});

  const toggleWeek = (weekNum) => {
    setExpandedWeeks(prev => ({ ...prev, [weekNum]: !prev[weekNum] }));
  };

  // Build display names: last name only, add first initial if duplicate last names
  const displayNames = useMemo(() => {
    const lastNames = {};
    players.forEach(p => {
      const parts = p.name.split(' ');
      const last = parts[parts.length - 1];
      if (!lastNames[last]) lastNames[last] = [];
      lastNames[last].push(p);
    });
    const map = {};
    players.forEach(p => {
      const parts = p.name.split(' ');
      const last = parts[parts.length - 1];
      map[p.id] = lastNames[last].length > 1 ? `${parts[0][0]}. ${last}` : last;
    });
    return map;
  }, [players]);

  const dn = (id) => displayNames[id] || "TBD";

  const myTeam = useMemo(() => {
    if (!leagueUser?.playerId) return null;
    return teams.find(t => t.player1 === leagueUser.playerId || t.player2 === leagueUser.playerId);
  }, [teams, leagueUser]);

  // Find current week
  const currentWeekIdx = useMemo(() => {
    for (let i = 0; i < schedule.length; i++) {
      const wk = schedule[i];
      const allFinalized = wk.matches.every(m =>
        matchResults.some(r => r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2)
      );
      if (!allFinalized) return i;
    }
    return schedule.length - 1;
  }, [schedule, matchResults]);

  const isWeekComplete = (wk) => {
    return wk.matches.every(m =>
      matchResults.some(r => r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2)
    );
  };

  const formatTeeTime = (idx) => {
    const base = leagueConfig?.startTime || "4:28 PM";
    const interval = leagueConfig?.teeInterval || 8;
    const [timePart, ampm] = base.split(' ');
    const [h, m] = timePart.split(':').map(Number);
    let mins = (ampm === 'PM' && h !== 12 ? h + 12 : h) * 60 + m + idx * interval;
    const hr = Math.floor(mins / 60) % 12 || 12;
    const mn = mins % 60;
    const ap = Math.floor(mins / 60) >= 12 ? 'PM' : 'AM';
    return `${hr}:${String(mn).padStart(2, '0')} ${ap}`;
  };

  // Team records: { teamId: { w, l, t } }
  const teamRecords = useMemo(() => {
    const rec = {};
    teams.forEach(t => { rec[t.id] = { w: 0, l: 0, t: 0 }; });
    matchResults.forEach(r => {
      if (!r) return;
      const d = (r.team1Points || 0) - (r.team2Points || 0);
      if (d > 0) {
        if (rec[r.team1Id]) rec[r.team1Id].w++;
        if (rec[r.team2Id]) rec[r.team2Id].l++;
      } else if (d < 0) {
        if (rec[r.team1Id]) rec[r.team1Id].l++;
        if (rec[r.team2Id]) rec[r.team2Id].w++;
      } else {
        if (rec[r.team1Id]) rec[r.team1Id].t++;
        if (rec[r.team2Id]) rec[r.team2Id].t++;
      }
    });
    return rec;
  }, [teams, matchResults]);

  const fmtRecord = (teamId) => {
    const r = teamRecords[teamId];
    return r ? `${r.w}-${r.l}-${r.t}` : "0-0-0";
  };

  // Split schedule into upcoming and complete
  const { upcoming, complete } = useMemo(() => {
    const up = [];
    const done = [];
    schedule.forEach(wk => {
      if (isWeekComplete(wk)) done.push(wk);
      else up.push(wk);
    });
    return { upcoming: up, complete: done };
  }, [schedule, matchResults]);

  const weeksToShow = useMemo(() => {
    if (myOnly || showAll) return { upcoming, complete };
    if (currentWeekIdx >= 0 && currentWeekIdx < schedule.length) {
      const wk = schedule[currentWeekIdx];
      if (isWeekComplete(wk)) return { upcoming: [], complete: [wk] };
      return { upcoming: [wk], complete: [] };
    }
    return { upcoming: schedule.slice(0, 1), complete: [] };
  }, [showAll, myOnly, schedule, currentWeekIdx, upcoming, complete]);

  const getExpanded = (weekNum) => {
    if (expandedWeeks[weekNum] !== undefined) return expandedWeeks[weekNum];
    if (!showAll && !myOnly) return true;
    return weekNum === schedule[currentWeekIdx]?.week;
  };

  if (!schedule.length) return <EmptyState icon="calendar" title="No schedule yet" subtitle="Commissioner needs to generate the schedule." />;

  // ── Generate ICS calendar file with ALL upcoming matches ──
  const addAllToCalendar = async () => {
    if (!myTeam) return;
    const base = leagueConfig?.startTime || "4:28 PM";
    const interval = leagueConfig?.teeInterval || 8;
    const [timePart, ampm] = base.split(' ');
    const [bh, bm] = timePart.split(':').map(Number);
    const year = leagueConfig?.year || new Date().getFullYear();
    const pad = (n) => String(n).padStart(2, '0');
    const fmtDt = (d) => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

    const events = [];
    schedule.forEach(wk => {
      const myMatch = wk.matches.find(m => m.team1 === myTeam.id || m.team2 === myTeam.id);
      if (!myMatch) return;
      // Skip already-completed matches
      const res = matchResults.find(r => r.week === wk.week && r.team1Id === myMatch.team1 && r.team2Id === myMatch.team2);
      if (res) return;

      const origIdx = wk.matches.indexOf(myMatch);
      const oppId = myMatch.team1 === myTeam.id ? myMatch.team2 : myMatch.team1;
      const oppTeam = teams.find(t => t.id === oppId);
      const side = wk.side || getWeekSide(wk.week);
      const sideLabel = side === 'front' ? 'Front 9' : 'Back 9';

      const totalMins = (ampm === 'PM' && bh !== 12 ? bh + 12 : bh) * 60 + bm + origIdx * interval;
      const teeHr = Math.floor(totalMins / 60);
      const teeMin = totalMins % 60;
      const teeTimeStr = formatTeeTime(origIdx);

      let startDate;
      if (wk.date) {
        const [mon, day] = wk.date.split('/').map(Number);
        startDate = new Date(year, mon - 1, day, teeHr, teeMin);
      } else {
        const seasonStart = new Date(year, 3, 21);
        startDate = new Date(seasonStart.getTime() + (wk.week - 1) * 7 * 86400000);
        startDate.setHours(teeHr, teeMin);
      }
      const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000);

      events.push([
        'BEGIN:VEVENT',
        `DTSTART:${fmtDt(startDate)}`,
        `DTEND:${fmtDt(endDate)}`,
        `SUMMARY:MnQ Golf - ${teeTimeStr} - ${sideLabel}`,
        `DESCRIPTION:Week ${wk.week} vs ${lastNamesOnly(oppTeam?.name || "TBD")}\\n${sideLabel}\\nMnQ Golf League`,
        `LOCATION:3110 W Ellsworth Rd\\, Ann Arbor\\, MI 48103`,
        'STATUS:CONFIRMED',
        `UID:mnq-wk${wk.week}-${year}@mnqgolf.com`,
        'END:VEVENT',
      ].join('\r\n'));
    });

    if (!events.length) return;

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MnQ Golf//League//EN',
      ...events,
      'END:VCALENDAR',
    ].join('\r\n');

    // POST to API route — returns file with proper Content-Type headers
    // This is the only approach that works reliably on iOS Safari
    try {
      const resp = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ics, filename: `mnq-golf-${year}-schedule.ics` }),
      });
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      console.error('Calendar download failed:', e);
    }
  };

  // ── My Schedule row ──
  const renderMyWeek = (wk, dimmed) => {
    const side = wk.side || getWeekSide(wk.week);
    const weekComplete = isWeekComplete(wk);
    const myMatch = myTeam ? wk.matches.find(m => m.team1 === myTeam.id || m.team2 === myTeam.id) : null;
    if (!myMatch) return null;

    const origIdx = wk.matches.indexOf(myMatch);
    const oppId = myMatch.team1 === myTeam.id ? myMatch.team2 : myMatch.team1;
    const oppTeam = teams.find(t => t.id === oppId);
    const res = matchResults.find(r => r.week === wk.week && r.team1Id === myMatch.team1 && r.team2Id === myMatch.team2);
    const isExp = getExpanded(wk.week);
    const isCurrent = wk.week === schedule[currentWeekIdx]?.week;

    return (
      <div key={wk.week}>
        <button onClick={() => toggleWeek(wk.week)} style={{
          display: "flex", alignItems: "center", width: "100%",
          background: K.card, borderRadius: isExp ? "10px 10px 0 0" : 10,
          border: `1px solid ${isCurrent ? K.act + "40" : K.bdr + (weekComplete ? "60" : "")}`,
          borderBottom: isExp ? "none" : undefined,
          padding: "10px 12px", cursor: "pointer",
          opacity: dimmed ? 0.7 : 1, gap: 0,
        }}>
          <div style={{ width: 62, flexShrink: 0, fontSize: 13, fontWeight: 700, color: K.t1 }}>Week {wk.week}</div>
          <div style={{ width: 56, flexShrink: 0, fontSize: 12, color: K.t3 }}>{wk.date || "—"}</div>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: K.act, textAlign: "center" }}>{formatTeeTime(origIdx)}</div>
          <div style={{ width: 58, flexShrink: 0, textAlign: "right" }}>
            <Pill color={K.logoBright} style={{ fontSize: 9 }}>{side === 'front' ? 'FRONT 9' : 'BACK 9'}</Pill>
          </div>
          <div style={{ width: 18, flexShrink: 0, textAlign: "right", color: K.t3, fontSize: 13 }}>{isExp ? "▾" : "›"}</div>
        </button>

        {isExp && (
          <div style={{
            background: K.inp, borderRadius: "0 0 10px 10px",
            border: `1px solid ${isCurrent ? K.act + "40" : K.bdr + (weekComplete ? "60" : "")}`,
            borderTop: "none", padding: "10px 14px",
          }}>
            {res ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: K.t1 }}>{lastNamesOnly(myTeam.name)}</div>
                  <div style={{ fontSize: 12, color: K.t2, fontWeight: 600 }}>{fmtRecord(myTeam.id)}</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: K.t1 }}>
                    {myMatch.team1 === myTeam.id ? res.team1Points : res.team2Points}–{myMatch.team1 === myTeam.id ? res.team2Points : res.team1Points}
                  </div>
                  {res.matchResultText && <div style={{ fontSize: 10, color: K.t3, fontWeight: 600 }}>{res.matchResultText}</div>}
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: K.t1 }}>{lastNamesOnly(oppTeam?.name || "TBD")}</div>
                  <div style={{ fontSize: 12, color: K.t2, fontWeight: 600 }}>{fmtRecord(oppId)}</div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: K.t1 }}>{lastNamesOnly(myTeam.name)}</div>
                  <div style={{ fontSize: 12, color: K.t2, fontWeight: 600 }}>{fmtRecord(myTeam.id)}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 800, color: K.t3, padding: "0 6px", letterSpacing: 1.5 }}>VS</div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: K.t1 }}>{lastNamesOnly(oppTeam?.name || "TBD")}</div>
                  <div style={{ fontSize: 12, color: K.t2, fontWeight: 600 }}>{fmtRecord(oppId)}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Standard week render (This Week / All Weeks) ──
  const renderWeek = (wk, dimmed) => {
    const isPlayoff = wk.isPlayoff || wk.week > (leagueConfig?.regularWeeks || REGULAR_WEEKS);
    const side = wk.side || getWeekSide(wk.week);
    const weekComplete = isWeekComplete(wk);
    const matches = wk.matches;
    const isExp = getExpanded(wk.week);

    return (
      <div key={wk.week}>
        <button onClick={() => toggleWeek(wk.week)} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
          background: K.card, borderRadius: isExp ? "10px 10px 0 0" : 10,
          border: `1px solid ${weekComplete ? K.bdr + "60" : wk.week === schedule[currentWeekIdx]?.week ? K.act + "40" : K.bdr}`,
          borderBottom: isExp ? "none" : undefined,
          padding: "10px 12px", cursor: "pointer",
          opacity: dimmed ? 0.7 : 1,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: isPlayoff ? K.warn : K.t1 }}>
              Week {wk.week}
            </span>
            {wk.date && <span style={{ fontSize: 12, color: K.t3 }}>{wk.date}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Pill color={K.logoBright} style={{ fontSize: 9 }}>{side === 'front' ? 'FRONT 9' : 'BACK 9'}</Pill>
            {isPlayoff && <Pill color={K.warn} style={{ fontSize: 9 }}>PLAYOFF</Pill>}
            {weekComplete && <Pill color={K.grn} style={{ fontSize: 9 }}>FINAL</Pill>}
            <span style={{ color: K.t3, fontSize: 13, marginLeft: 2 }}>{isExp ? "▾" : "›"}</span>
          </div>
        </button>

        {isExp && (
          <div style={{
            background: K.inp, borderRadius: "0 0 10px 10px",
            border: `1px solid ${weekComplete ? K.bdr + "60" : wk.week === schedule[currentWeekIdx]?.week ? K.act + "40" : K.bdr}`,
            borderTop: "none", padding: "6px 8px",
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {matches.map((m, mi) => {
                const rawT1 = teams.find(t => t.id === m.team1);
                const rawT2 = teams.find(t => t.id === m.team2);
                const res = matchResults.find(r => r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2);
                const isMyMatch = myTeam && (m.team1 === myTeam.id || m.team2 === myTeam.id);
                const origIdx = wk.matches.indexOf(m);

                const swapped = isMyMatch && m.team2 === myTeam.id;
                const t1 = swapped ? rawT2 : rawT1;
                const t2 = swapped ? rawT1 : rawT2;
                const score1 = res ? (swapped ? res.team2Points : res.team1Points) : null;
                const score2 = res ? (swapped ? res.team1Points : res.team2Points) : null;

                return (
                  <div key={mi} style={{ background: K.card, borderRadius: 8, border: isMyMatch ? `1.5px solid ${K.act}` : `1px solid ${K.bdr}40`, padding: "8px 10px", display: "flex", alignItems: "center" }}>
                    {/* Left team */}
                    <div style={{ flex: 1, textAlign: "right", paddingRight: res && score1 > score2 ? 8 : 18, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                      <div style={{ fontSize: 15, fontWeight: res && score1 > score2 ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t1?.player1)}</div>
                      <div style={{ fontSize: 15, fontWeight: res && score1 > score2 ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t1?.player2)}</div>
                      {res && <div style={{ fontSize: 10, color: K.t3, fontWeight: 500, marginTop: 2 }}>{fmtRecord(t1?.id)}</div>}
                    </div>
                    {/* Winner triangle left */}
                    {res && score1 > score2 && (
                      <div style={{ color: "#1a8c3f", fontSize: 15, fontWeight: 800, marginRight: 2, flexShrink: 0, lineHeight: 1, transform: "rotate(-90deg)" }}>▲</div>
                    )}
                    {/* Center — match result or tee time */}
                    <div style={{ textAlign: "center", minWidth: 74, flexShrink: 0, padding: "0 2px" }}>
                      {res ? (
                        <div style={{ fontSize: 20, fontWeight: 800, color: K.t1, letterSpacing: .5 }}>
                          {res.matchResultText || `${score1}–${score2}`}
                        </div>
                      ) : (
                        <div style={{ fontSize: 18, fontWeight: 800, color: K.act, letterSpacing: .3 }}>{formatTeeTime(origIdx)}</div>
                      )}
                    </div>
                    {/* Winner triangle right */}
                    {res && score2 > score1 && (
                      <div style={{ color: "#1a8c3f", fontSize: 15, fontWeight: 800, marginLeft: 2, flexShrink: 0, lineHeight: 1, transform: "rotate(90deg)" }}>▲</div>
                    )}
                    {/* Right team */}
                    <div style={{ flex: 1, textAlign: "left", paddingLeft: res && score2 > score1 ? 8 : 18, overflow: "hidden" }}>
                      <div style={{ fontSize: 15, fontWeight: res && score2 > score1 ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t2?.player1)}</div>
                      <div style={{ fontSize: 15, fontWeight: res && score2 > score1 ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t2?.player2)}</div>
                      {res && <div style={{ fontSize: 10, color: K.t3, fontWeight: 500, marginTop: 2 }}>{fmtRecord(t2?.id)}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderer = myOnly ? renderMyWeek : renderWeek;

  return (
    <div>

      {/* Filter bar — single row */}
      <div style={{ display: "flex", gap: 5, marginBottom: 14, alignItems: "center" }}>
        <button onClick={() => { setShowAll(false); setMyOnly(false); }} style={{
          padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600,
          background: !showAll && !myOnly ? K.acc : K.card, color: !showAll && !myOnly ? K.bg : K.t2,
          border: `1px solid ${!showAll && !myOnly ? K.acc : K.bdr}`, whiteSpace: "nowrap",
        }}>This Week</button>
        <button onClick={() => { setShowAll(true); setMyOnly(false); }} style={{
          padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600,
          background: showAll && !myOnly ? K.acc : K.card, color: showAll && !myOnly ? K.bg : K.t2,
          border: `1px solid ${showAll && !myOnly ? K.acc : K.bdr}`, whiteSpace: "nowrap",
        }}>All Weeks</button>

        {myTeam && (
          <>
            <div style={{ width: 1, height: 20, background: K.bdr, flexShrink: 0 }} />
            <button onClick={() => { setMyOnly(true); setShowAll(true); }} style={{
              padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600,
              background: myOnly ? K.act : K.card, color: myOnly ? K.bg : K.t2,
              border: `1px solid ${myOnly ? K.act : K.bdr}`, whiteSpace: "nowrap",
            }}>My Schedule</button>
            {myOnly && (
              <button onClick={addAllToCalendar} style={{
                display: "flex", alignItems: "center", gap: 3,
                padding: "6px 8px", borderRadius: 6, cursor: "pointer",
                background: K.act + "12", border: `1px solid ${K.act}30`, color: K.act,
                fontSize: 10, fontWeight: 600, whiteSpace: "nowrap",
              }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                Add All
              </button>
            )}
          </>
        )}
      </div>

      {/* My Schedule column header */}
      {myOnly && (
        <div style={{ display: "flex", alignItems: "center", padding: "0 12px 6px", fontSize: 9, color: K.t3, fontWeight: 700, textTransform: "uppercase", letterSpacing: .8 }}>
          <div style={{ width: 62 }}>Week</div>
          <div style={{ width: 56 }}>Date</div>
          <div style={{ flex: 1, textAlign: "center" }}>Tee Time</div>
          <div style={{ width: 58, textAlign: "right" }}>Side</div>
          <div style={{ width: 18 }} />
        </div>
      )}

      {/* Upcoming weeks */}
      {weeksToShow.upcoming.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {weeksToShow.upcoming.map(wk => renderer(wk, false))}
        </div>
      )}

      {/* Complete weeks */}
      {weeksToShow.complete.length > 0 && (
        <div style={{ marginTop: weeksToShow.upcoming.length > 0 ? 20 : 0 }}>
          {(showAll || myOnly) && weeksToShow.upcoming.length > 0 && (
            <SubLabel color={K.t3} style={{ marginBottom: 8 }}>Complete</SubLabel>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {weeksToShow.complete.map(wk => renderer(wk, true))}
          </div>
        </div>
      )}

      {weeksToShow.upcoming.length === 0 && weeksToShow.complete.length === 0 && (
        <EmptyState icon="calendar" title="No matches to show" />
      )}
    </div>
  );
}
