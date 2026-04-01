import { useState } from "react";
import { K, SectionTitle, SubLabel, Card, EmptyState } from "../theme";

export default function CTPView({ ctpData, players }) {
  const wins = {}; ctpData.filter(c => c.playerId).forEach(c => { wins[c.playerId] = (wins[c.playerId] || 0) + 1; });
  const sorted = Object.entries(wins).map(([pid, cnt]) => ({ p: players.find(pl => pl.id === pid), cnt })).filter(e => e.p).sort((a, b) => b.cnt - a.cnt);
  return (
    <div><SectionTitle>Closest to Pin</SectionTitle>
      {!sorted.length ? <EmptyState icon="target" title="No CTP results yet" /> : (<>
        <SubLabel style={{ marginBottom: 8, color: K.t3 }}>Season Leaders</SubLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
          {sorted.map((e, i) => (
            <Card key={e.p.id} highlight={i === 0} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 28, height: 28, borderRadius: 7, background: i === 0 ? K.gold + "20" : K.inp, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: i === 0 ? K.gold : K.t3 }}>{i + 1}</div><span style={{ fontSize: 14, fontWeight: 700 }}>{e.p.name}</span></div>
              <div style={{ fontSize: 18, fontWeight: 800, color: K.acc, fontFamily: "'League Spartan', sans-serif" }}>{e.cnt}</div>
            </Card>
          ))}
        </div>
        <SubLabel style={{ color: K.t3 }}>Weekly Results</SubLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {ctpData.filter(c => c.playerId).map(c => <div key={c.id} style={{ background: K.card, borderRadius: 8, padding: "7px 12px", border: `1px solid ${K.bdr}`, display: "flex", justifyContent: "space-between", fontSize: 12 }}><span style={{ color: K.t2 }}>Wk {c.week + 1} · Hole {c.holeNum}</span><span style={{ fontWeight: 700 }}>{players.find(p => p.id === c.playerId)?.name}</span><span style={{ color: K.acc, fontWeight: 600 }}>{c.distance} ft</span></div>)}
        </div>
      </>)}
    </div>
  );
}


