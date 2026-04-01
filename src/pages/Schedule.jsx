import { useState } from "react";
import { K, SectionTitle, SubLabel, Card, Pill, EmptyState, getTeeTime, getWeekSide, REGULAR_WEEKS } from "../theme";

export default function ScheduleView({ schedule, teams, players, matchResults }) {
  const [vw, setVw] = useState(0);
  if (!schedule.length) return <EmptyState icon="calendar" title="No schedule yet" subtitle="Commissioner needs to generate the schedule." />;
  return (
    <div><SectionTitle>Schedule</SectionTitle>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>{schedule.map((s, i) => <button key={i} onClick={() => setVw(i)} style={{ padding: "5px 9px", borderRadius: 7, cursor: "pointer", fontSize: 10, fontWeight: 700, background: vw === i ? K.acc : K.card, color: vw === i ? K.bg : K.t2, border: `1px solid ${vw === i ? K.acc : K.bdr}` }}>W{s.week + 1}</button>)}</div>
      <div style={{ marginBottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
        <SubLabel style={{ margin: 0 }}>Week {schedule[vw]?.week + 1}</SubLabel>
        <Pill>{getWeekSide(schedule[vw]?.week + 1) === 'front' ? 'FRONT 9' : 'BACK 9'}</Pill>
        {schedule[vw]?.week >= REGULAR_WEEKS && <Pill color={K.warn}>PLAYOFFS</Pill>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {(schedule[vw]?.matches || []).map((m, mi) => {
          const t1 = teams.find(t => t.id === m.team1); const t2 = teams.find(t => t.id === m.team2);
          const res = matchResults.find(r => r.week === schedule[vw]?.week && r.team1Id === m.team1 && r.team2Id === m.team2);
          return (
            <Card key={mi} style={{ padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: K.t3, fontWeight: 600, marginBottom: 4 }}>{getTeeTime(mi)} · Match {mi + 1}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{t1?.name || "TBD"}</div>
                {res ? <div style={{ textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 800, color: K.acc }}>{res.team1Points}–{res.team2Points}</div><div style={{ fontSize: 9, color: K.grn }}>FINAL</div></div> : <div style={{ fontSize: 11, color: K.t3, fontWeight: 700 }}>VS</div>}
                <div style={{ fontSize: 13, fontWeight: 700, textAlign: "right" }}>{t2?.name || "TBD"}</div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}


