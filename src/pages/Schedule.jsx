import { useState, useMemo } from "react";
import { K, SectionTitle, SubLabel, Card, Pill, EmptyState, getTeeTime, getWeekSide, REGULAR_WEEKS } from "../theme";

export default function ScheduleView({ schedule, teams, players, matchResults, leagueUser, leagueConfig }) {
  const [showAll, setShowAll] = useState(false);
  const [myOnly, setMyOnly] = useState(false);

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

  const weeksToShow = useMemo(() => {
    if (myOnly) return schedule; // My Schedule always shows full season
    if (showAll) return schedule;
    if (currentWeekIdx >= 0 && currentWeekIdx < schedule.length) return [schedule[currentWeekIdx]];
    return schedule.slice(0, 1);
  }, [showAll, myOnly, schedule, currentWeekIdx]);

  const gn = (id) => teams.find(t => t.id === id)?.name || "TBD";

  if (!schedule.length) return <EmptyState icon="calendar" title="No schedule yet" subtitle="Commissioner needs to generate the schedule." />;

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

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {weeksToShow.map(wk => {
          const isPlayoff = wk.isPlayoff || wk.week >= (leagueConfig?.regularWeeks || REGULAR_WEEKS);
          const side = wk.side || getWeekSide(wk.week + 1);
          const matches = myOnly && myTeam
            ? wk.matches.filter(m => m.team1 === myTeam.id || m.team2 === myTeam.id)
            : wk.matches;

          if (myOnly && matches.length === 0) return null;

          return (
            <div key={wk.week}>
              {/* Week header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: isPlayoff ? K.warn : K.t1 }}>
                    Week {wk.week + 1}
                  </span>
                  {wk.date && <span style={{ fontSize: 12, color: K.t3 }}>{wk.date}</span>}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <Pill color={side === 'front' ? K.acc : K.t3} style={{ fontSize: 9 }}>{side === 'front' ? 'FRONT 9' : 'BACK 9'}</Pill>
                  {isPlayoff && <Pill color={K.warn} style={{ fontSize: 9 }}>PLAYOFF</Pill>}
                </div>
              </div>

              {/* Matches */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {matches.map((m, mi) => {
                  const t1 = teams.find(t => t.id === m.team1);
                  const t2 = teams.find(t => t.id === m.team2);
                  const res = matchResults.find(r => r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2);
                  const isMyMatch = myTeam && (m.team1 === myTeam.id || m.team2 === myTeam.id);
                  const origIdx = wk.matches.indexOf(m);

                  return (
                    <div key={mi} style={{ background: K.card, borderRadius: 8, border: isMyMatch ? `1.5px solid ${K.act}` : `1px solid ${K.bdr}`, padding: "8px 10px", display: "flex", alignItems: "center" }}>
                      {/* Left team — right aligned */}
                      <div style={{ flex: 1, textAlign: "right", paddingRight: 10, overflow: "hidden" }}>
                        <div style={{ fontSize: 15, color: K.t1, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t1?.player1)}</div>
                        <div style={{ fontSize: 15, color: K.t1, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t1?.player2)}</div>
                      </div>
                      {/* Center — tee time or result */}
                      <div style={{ textAlign: "center", minWidth: 68, flexShrink: 0 }}>
                        {res ? (<>
                          <div style={{ fontSize: 17, fontWeight: 800, color: K.t1 }}>{res.team1Points}–{res.team2Points}</div>
                          <div style={{ fontSize: 9, color: K.grn, fontWeight: 600 }}>FINAL</div>
                        </>) : (
                          <div style={{ fontSize: 18, fontWeight: 800, color: K.t1, letterSpacing: .3 }}>{formatTeeTime(origIdx)}</div>
                        )}
                      </div>
                      {/* Right team — left aligned */}
                      <div style={{ flex: 1, textAlign: "left", paddingLeft: 10, overflow: "hidden" }}>
                        <div style={{ fontSize: 15, color: K.t1, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t2?.player1)}</div>
                        <div style={{ fontSize: 15, color: K.t1, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t2?.player2)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
