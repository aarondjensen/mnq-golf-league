import { K, Card, EmptyState, LIST_GAP, CARD_RADIUS, NAME_SIZE, NAME_WEIGHT, HERO_NUM_SIZE, HERO_NUM_WEIGHT, RANK_BADGE_SIZE, RANK_BADGE_RADIUS, RANK_BADGE_FONT } from "../theme";

export default function CTPView({ ctpData, players }) {
  const wins = {}; ctpData.filter(c => c.playerId).forEach(c => { wins[c.playerId] = (wins[c.playerId] || 0) + 1; });
  const sorted = Object.entries(wins).map(([pid, cnt]) => ({ p: players.find(pl => pl.id === pid), cnt })).filter(e => e.p).sort((a, b) => b.cnt - a.cnt);
  return (
    <div>
      {!sorted.length ? <EmptyState icon="target" title="No CTP results yet" /> : (<>
        <div style={{ fontSize: 11, color: K.t3, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 8 }}>Season Leaders</div>
        <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP, marginBottom: 20 }}>
          {sorted.map((e, i) => (
            <Card key={e.p.id} highlight={i === 0} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: RANK_BADGE_SIZE, height: RANK_BADGE_SIZE, borderRadius: RANK_BADGE_RADIUS, background: i === 0 ? K.gold + "20" : K.inp, display: "flex", alignItems: "center", justifyContent: "center", fontSize: RANK_BADGE_FONT, fontWeight: 800, color: i === 0 ? K.gold : K.t3 }}>{i + 1}</div>
                <span style={{ fontSize: NAME_SIZE, fontWeight: NAME_WEIGHT }}>{e.p.name}</span>
              </div>
              <div style={{ fontSize: HERO_NUM_SIZE, fontWeight: HERO_NUM_WEIGHT, color: K.t1, fontFamily: "'League Spartan', sans-serif" }}>{e.cnt}</div>
            </Card>
          ))}
        </div>
        <div style={{ fontSize: 11, color: K.t3, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 8 }}>Weekly Results</div>
        <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
          {ctpData.filter(c => c.playerId).map(c => <div key={c.id} style={{ background: K.card, borderRadius: CARD_RADIUS, padding: "7px 12px", border: `1px solid ${K.bdr}`, display: "flex", justifyContent: "space-between", fontSize: 12 }}><span style={{ color: K.t2 }}>Wk {c.week} · Hole {c.holeNum}</span><span style={{ fontWeight: 700 }}>{players.find(p => p.id === c.playerId)?.name}</span><span style={{ color: K.acc, fontWeight: 600 }}>{c.distance} ft</span></div>)}
        </div>
      </>)}
    </div>
  );
}
