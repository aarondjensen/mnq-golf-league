import { useState, useMemo } from "react";
import { K, SubLabel, Pill, EmptyState, lastNamesOnly, formatTeeTime, getWeekSide, REGULAR_WEEKS, LIST_GAP, CARD_RADIUS, NAME_SIZE, HERO_NUM_SIZE, CHEVRON_SIZE } from "../theme";

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

  // Find current week (skip rained-out weeks)
  const currentWeekIdx = useMemo(() => {
    for (let i = 0; i < schedule.length; i++) {
      const wk = schedule[i];
      if (wk.rainedOut) continue;
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

  const fmtTeeTime = (idx) => {
    const base = leagueConfig?.startTime || "4:28 PM";
    const interval = leagueConfig?.teeInterval || 8;
    return formatTeeTime(base, idx, interval);
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
      if (wk.rainedOut || isWeekComplete(wk)) done.push(wk);
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
      if (wk.rainedOut) return;
      const myMatch = wk.matches.find(m => m.team1 === myTeam.id || m.team2 === myTeam.id);
      if (!myMatch) return;
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
      const teeTimeStr = fmtTeeTime(origIdx);

      let startDate;
      if (wk.date) {
        const [mon, day] = wk.date.split('/').map(Number);
        if (mon && day) {
          startDate = new Date(year, mon - 1, day, teeHr, teeMin);
        }
      }
      if (!startDate) {
        const months = { 'Jan':0,'Feb':1,'Mar':2,'Apr':3,'May':4,'Jun':5,'Jul':6,'Aug':7,'Sep':8,'Oct':9,'Nov':10,'Dec':11 };
        const parts = (wk.date || "").split(' ');
        if (parts.length === 2) {
          const m = months[parts[0]];
          const d = parseInt(parts[1]);
          if (m !== undefined && d) startDate = new Date(year, m, d, teeHr, teeMin);
        }
      }
      if (!startDate) return;

      const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000);
      events.push(
        `BEGIN:VEVENT\r\n` +
        `DTSTART:${fmtDt(startDate)}\r\n` +
        `DTEND:${fmtDt(endDate)}\r\n` +
        `SUMMARY:MnQ Golf - Week ${wk.week} vs ${lastNamesOnly(oppTeam?.name || 'TBD')}\r\n` +
        `DESCRIPTION:${sideLabel} | Tee Time: ${teeTimeStr}\\nVs: ${oppTeam?.name || 'TBD'}\r\n` +
        `END:VEVENT\r\n`
      );
    });

    if (!events.length) return;
    const cal = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//MnQ Golf//EN\r\n${events.join('')}END:VCALENDAR`;
    const blob = new Blob([cal], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mnq-golf-schedule.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── My Schedule compact row ──
  const renderMyWeek = (wk) => {
    const myMatch = wk.matches.find(m => m.team1 === myTeam.id || m.team2 === myTeam.id);
    if (!myMatch) return null;
    const origIdx = wk.matches.indexOf(myMatch);
    const side = wk.side || getWeekSide(wk.week);
    const isRainedOut = wk.rainedOut === true;
    const res = matchResults.find(r => r.week === wk.week && r.team1Id === myMatch.team1 && r.team2Id === myMatch.team2);
    const oppId = myMatch.team1 === myTeam.id ? myMatch.team2 : myMatch.team1;
    const oppTeam = teams.find(t => t.id === oppId);
    const oppName = lastNamesOnly(oppTeam?.name || "TBD");

    const teeTimeShort = fmtTeeTime(origIdx).replace(/\s*(AM|PM)$/i, '');

    return (
      <div key={wk.week} style={{
        display: "flex", alignItems: "center", padding: "8px 12px",
        background: K.card, borderRadius: CARD_RADIUS, border: `1px solid ${K.bdr}`,
        opacity: isRainedOut ? 0.5 : 1,
      }}>
        <div style={{ width: 28, fontSize: 13, fontWeight: 700, color: K.t1 }}>{wk.week}</div>
        <div style={{ width: 50, fontSize: 11, color: K.t3 }}>{wk.date || "—"}</div>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: isRainedOut ? K.warn : K.t1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {isRainedOut ? "RAIN" : oppName}
        </div>
        <div style={{ width: 46, textAlign: "center", fontSize: 13, fontWeight: 700, color: isRainedOut ? K.warn : res ? K.t1 : K.act }}>
          {isRainedOut ? "" : res ? (res.matchResultText || "—") : teeTimeShort}
        </div>
        <div style={{ width: 42, textAlign: "right", fontSize: 11, fontWeight: 600, color: K.t3 }}>
          {isRainedOut ? "" : side === 'front' ? 'Front' : 'Back'}
        </div>
      </div>
    );
  };

  // ── Full week view ──
  const renderWeek = (wk, isDone) => {
    const isPlayoff = wk.isPlayoff || wk.week > (leagueConfig?.regularWeeks || REGULAR_WEEKS);
    const weekComplete = isWeekComplete(wk);
    const isRainedOut = wk.rainedOut === true;
    const side = wk.side || getWeekSide(wk.week);
    const isExp = getExpanded(wk.week);

    const matches = myOnly
      ? wk.matches.filter(m => myTeam && (m.team1 === myTeam.id || m.team2 === myTeam.id))
      : wk.matches;

    return (
      <div key={wk.week}>
        <button onClick={() => toggleWeek(wk.week)} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
          background: K.card, padding: "10px 14px", cursor: "pointer", textAlign: "left",
          borderRadius: isExp ? `${CARD_RADIUS}px ${CARD_RADIUS}px 0 0` : CARD_RADIUS,
          border: `1px solid ${isRainedOut ? K.warn + "40" : weekComplete ? K.bdr : wk.week === schedule[currentWeekIdx]?.week ? K.act + "40" : K.bdr}`,
          borderBottom: isExp ? "none" : undefined,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: NAME_SIZE, fontWeight: 700, color: K.t1, minWidth: 90 }}>
              Week {wk.week}
            </span>
            {wk.date && <span style={{ fontSize: 12, color: K.t3 }}>{wk.date}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isRainedOut && <Pill color={K.warn} style={{ fontSize: 9 }}>RAIN OUT</Pill>}
            {wk.makeupFor && <Pill color={K.teal} style={{ fontSize: 9 }}>MAKEUP</Pill>}
            {!isRainedOut && <Pill color={K.logoBright} style={{ fontSize: 9 }}>{side === 'front' ? 'FRONT 9' : 'BACK 9'}</Pill>}
            {isPlayoff && !isRainedOut && <Pill color={K.warn} style={{ fontSize: 9 }}>PLAYOFF</Pill>}
            {weekComplete && !isRainedOut && <Pill color={K.grn} style={{ fontSize: 9 }}>FINAL</Pill>}
            <span style={{ color: K.t3, fontSize: CHEVRON_SIZE, marginLeft: 2 }}>{isExp ? "▾" : "›"}</span>
          </div>
        </button>

        {isExp && isRainedOut && (
          <div style={{
            background: K.inp, borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`,
            border: `1px solid ${K.warn}40`, borderTop: "none", padding: "12px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 13, color: K.warn, fontWeight: 600 }}>Rained Out</div>
            <div style={{ fontSize: 11, color: K.t3, marginTop: 2 }}>Matchups rescheduled to makeup week</div>
          </div>
        )}

        {isExp && !isRainedOut && (
          <div style={{
            background: K.inp, borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`,
            border: `1px solid ${weekComplete ? K.bdr : wk.week === schedule[currentWeekIdx]?.week ? K.act + "40" : K.bdr}`,
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
                  <div key={mi} style={{ background: K.card, borderRadius: 8, border: isMyMatch ? `1.5px solid ${K.act}` : `1px solid ${K.bdr}`, padding: "8px 10px", display: "flex", alignItems: "center" }}>
                    {/* Left team */}
                    <div style={{ flex: 1, textAlign: "right", paddingRight: res && score1 > score2 ? 8 : 18, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                      <div style={{ fontSize: NAME_SIZE, fontWeight: res && score1 > score2 ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t1?.player1)}</div>
                      <div style={{ fontSize: NAME_SIZE, fontWeight: res && score1 > score2 ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t1?.player2)}</div>
                      <div style={{ fontSize: 12, color: K.t3, fontWeight: 600, marginTop: 2 }}>{fmtRecord(t1?.id)}</div>
                    </div>
                    {/* Winner triangle left */}
                    {res && score1 > score2 && (
                      <div style={{ color: K.matchGrn, fontSize: 15, fontWeight: 800, marginRight: 2, flexShrink: 0, lineHeight: 1, transform: "rotate(-90deg)" }}>▲</div>
                    )}
                    {/* Center — match result or tee time */}
                    <div style={{ textAlign: "center", minWidth: 74, flexShrink: 0, padding: "0 2px" }}>
                      {res ? (
                        <div style={{ fontSize: HERO_NUM_SIZE, fontWeight: 800, color: K.t1, letterSpacing: .5 }}>
                          {res.matchResultText || `${score1}–${score2}`}
                        </div>
                      ) : (
                        <div style={{ fontSize: 18, fontWeight: 800, color: K.act, letterSpacing: .3 }}>{fmtTeeTime(origIdx)}</div>
                      )}
                    </div>
                    {/* Winner triangle right */}
                    {res && score2 > score1 && (
                      <div style={{ color: K.matchGrn, fontSize: 15, fontWeight: 800, marginLeft: 2, flexShrink: 0, lineHeight: 1, transform: "rotate(90deg)" }}>▲</div>
                    )}
                    {/* Right team */}
                    <div style={{ flex: 1, textAlign: "left", paddingLeft: res && score2 > score1 ? 8 : 18, overflow: "hidden" }}>
                      <div style={{ fontSize: NAME_SIZE, fontWeight: res && score2 > score1 ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t2?.player1)}</div>
                      <div style={{ fontSize: NAME_SIZE, fontWeight: res && score2 > score1 ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t2?.player2)}</div>
                      <div style={{ fontSize: 12, color: K.t3, fontWeight: 600, marginTop: 2 }}>{fmtRecord(t2?.id)}</div>
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
          <div style={{ width: 28 }}>Wk</div>
          <div style={{ width: 50 }}>Date</div>
          <div style={{ flex: 1 }}>Opponent</div>
          <div style={{ width: 46, textAlign: "center" }}>Tee</div>
          <div style={{ width: 42, textAlign: "right" }}>Side</div>
        </div>
      )}

      {/* Upcoming weeks */}
      {weeksToShow.upcoming.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
          {weeksToShow.upcoming.map(wk => renderer(wk, false))}
        </div>
      )}

      {/* Complete weeks */}
      {weeksToShow.complete.length > 0 && (
        <div style={{ marginTop: weeksToShow.upcoming.length > 0 ? 20 : 0 }}>
          {(showAll || myOnly) && weeksToShow.upcoming.length > 0 && (
            <SubLabel color={K.t3} style={{ marginBottom: 8 }}>Complete</SubLabel>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
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
