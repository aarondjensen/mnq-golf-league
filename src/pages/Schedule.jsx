import { useState, useMemo } from "react";
import { K, SectionTitle, SubLabel, Card, Pill, EmptyState, getTeeTime, getWeekSide, REGULAR_WEEKS } from "../theme";

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

  // Find current week (latest week without a finalized result for all matches)
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

  // Check if a week is fully complete
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
    if (myOnly) return { upcoming: schedule.filter(wk => !isWeekComplete(wk)), complete: schedule.filter(wk => isWeekComplete(wk)) };
    if (showAll) return { upcoming, complete };
    // This Week mode: just show current week
    if (currentWeekIdx >= 0 && currentWeekIdx < schedule.length) {
      const wk = schedule[currentWeekIdx];
      if (isWeekComplete(wk)) return { upcoming: [], complete: [wk] };
      return { upcoming: [wk], complete: [] };
    }
    return { upcoming: schedule.slice(0, 1), complete: [] };
  }, [showAll, myOnly, schedule, currentWeekIdx, upcoming, complete]);

  // Auto-expand current week
  const getExpanded = (weekNum) => {
    if (expandedWeeks[weekNum] !== undefined) return expandedWeeks[weekNum];
    // Default: expand current week, collapse others in "all weeks" view
    if (!showAll && !myOnly) return true;
    return weekNum === schedule[currentWeekIdx]?.week;
  };

  const gn = (id) => teams.find(t => t.id === id)?.name || "TBD";

  if (!schedule.length) return <EmptyState icon="calendar" title="No schedule yet" subtitle="Commissioner needs to generate the schedule." />;

  const renderWeek = (wk, dimmed) => {
    const isPlayoff = wk.isPlayoff || wk.week > (leagueConfig?.regularWeeks || REGULAR_WEEKS);
    const side = wk.side || getWeekSide(wk.week);
    const weekComplete = isWeekComplete(wk);
    const matches = myOnly && myTeam
      ? wk.matches.filter(m => m.team1 === myTeam.id || m.team2 === myTeam.id)
      : wk.matches;
    const isExp = getExpanded(wk.week);

    if (myOnly && matches.length === 0) return null;

    return (
      <div key={wk.week}>
        {/* Week header — tappable to expand/collapse */}
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

        {/* Matches — collapsible */}
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

                // If user's team is team2, swap so they always appear on the left
                const swapped = isMyMatch && m.team2 === myTeam.id;
                const t1 = swapped ? rawT2 : rawT1;
                const t2 = swapped ? rawT1 : rawT2;
                const score1 = res ? (swapped ? res.team2Points : res.team1Points) : null;
                const score2 = res ? (swapped ? res.team1Points : res.team2Points) : null;

                return (
                  <div key={mi} style={{ background: K.card, borderRadius: 8, border: isMyMatch ? `1.5px solid ${K.act}` : `1px solid ${K.bdr}40`, padding: "8px 10px", display: "flex", alignItems: "center" }}>
                    {/* Left team — right aligned */}
                    <div style={{ flex: 1, textAlign: "right", paddingRight: 18, overflow: "hidden" }}>
                      <div style={{ fontSize: 15, color: K.t1, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t1?.player1)}</div>
                      <div style={{ fontSize: 15, color: K.t1, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t1?.player2)}</div>
                    </div>
                    {/* Center — tee time or result */}
                    <div style={{ textAlign: "center", minWidth: 74, flexShrink: 0, padding: "0 4px" }}>
                      {res ? (<>
                        <div style={{ fontSize: 17, fontWeight: 800, color: K.t1 }}>{score1}–{score2}</div>
                        {res.matchResultText && <div style={{ fontSize: 9, color: K.t3, fontWeight: 600 }}>{res.matchResultText}</div>}
                      </>) : (
                        <div style={{ fontSize: 18, fontWeight: 800, color: K.act, letterSpacing: .3 }}>{formatTeeTime(origIdx)}</div>
                      )}
                    </div>
                    {/* Right team — left aligned */}
                    <div style={{ flex: 1, textAlign: "left", paddingLeft: 18, overflow: "hidden" }}>
                      <div style={{ fontSize: 15, color: K.t1, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t2?.player1)}</div>
                      <div style={{ fontSize: 15, color: K.t1, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t2?.player2)}</div>
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

  return (
    <div>
      <SectionTitle>Schedule</SectionTitle>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setShowAll(false)} style={{
          padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600,
          background: !showAll ? K.acc : K.card, color: !showAll ? K.bg : K.t2,
          border: `1px solid ${!showAll ? K.acc : K.bdr}`,
        }}>This Week</button>
        <button onClick={() => setShowAll(true)} style={{
          padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600,
          background: showAll ? K.acc : K.card, color: showAll ? K.bg : K.t2,
          border: `1px solid ${showAll ? K.acc : K.bdr}`,
        }}>All Weeks</button>

        {myTeam && (
          <>
            <div style={{ width: 1, height: 20, background: K.bdr, margin: "0 4px" }} />
            <button onClick={() => setMyOnly(!myOnly)} style={{
              padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600,
              background: myOnly ? K.act : K.card, color: myOnly ? K.bg : K.t2,
              border: `1px solid ${myOnly ? K.act : K.bdr}`,
            }}>My Schedule</button>
          </>
        )}
      </div>

      {/* Upcoming weeks */}
      {weeksToShow.upcoming.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {weeksToShow.upcoming.map(wk => renderWeek(wk, false))}
        </div>
      )}

      {/* Complete weeks */}
      {weeksToShow.complete.length > 0 && (
        <div style={{ marginTop: weeksToShow.upcoming.length > 0 ? 20 : 0 }}>
          {(showAll || myOnly) && weeksToShow.upcoming.length > 0 && (
            <SubLabel color={K.t3} style={{ marginBottom: 8 }}>Complete</SubLabel>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {weeksToShow.complete.map(wk => renderWeek(wk, true))}
          </div>
        </div>
      )}

      {weeksToShow.upcoming.length === 0 && weeksToShow.complete.length === 0 && (
        <EmptyState icon="calendar" title="No matches to show" />
      )}
    </div>
  );
}
