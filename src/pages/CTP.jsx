import { useState } from "react";
import { K, Card, EmptyState, LIST_GAP, CARD_RADIUS, NAME_SIZE, NAME_WEIGHT, HERO_NUM_SIZE, HERO_NUM_WEIGHT, RANK_BADGE_SIZE, RANK_BADGE_RADIUS, RANK_BADGE_FONT } from "../theme";

export default function CTPView({ ctpData, players, isComm, saveCtp }) {
  const [editing, setEditing] = useState(null);
  const [editPlayer, setEditPlayer] = useState("");
  const [editDistance, setEditDistance] = useState("");

  const wins = {}; ctpData.filter(c => c.playerId).forEach(c => { wins[c.playerId] = (wins[c.playerId] || 0) + 1; });
  const sorted = Object.entries(wins).map(([pid, cnt]) => ({ p: players.find(pl => pl.id === pid), cnt })).filter(e => e.p).sort((a, b) => b.cnt - a.cnt);
  const allPlayersSorted = [...players].sort((a, b) => a.name.localeCompare(b.name));

  const startEdit = (c) => {
    setEditing(c.id);
    setEditPlayer(c.playerId || "");
    setEditDistance(c.distance || "");
  };

  const saveEdit = async (c) => {
    await saveCtp({ ...c, playerId: editPlayer, distance: editDistance });
    setEditing(null);
  };

  const weeklyResults = ctpData.filter(c => c.playerId).sort((a, b) => {
    if (a.week !== b.week) return b.week - a.week;
    return a.holeNum - b.holeNum;
  });

  return (
    <div>
      {!sorted.length && !isComm ? <EmptyState icon="target" title="No CTP results yet" /> : (<>
        {sorted.length > 0 && (<>
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
        </>)}
        <div style={{ fontSize: 11, color: K.t3, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 8 }}>Weekly Results</div>
        <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
          {weeklyResults.map(c => {
            const isEd = editing === c.id;
            if (isEd) {
              return (
                <div key={c.id} style={{ background: K.card, borderRadius: CARD_RADIUS, padding: "10px 12px", border: `1.5px solid ${K.act}40` }}>
                  <div style={{ fontSize: 12, color: K.t2, marginBottom: 8 }}>Wk {c.week} · Hole {c.holeNum}</div>
                  <select
                    value={editPlayer}
                    onChange={e => setEditPlayer(e.target.value)}
                    style={{ width: "100%", padding: "8px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, marginBottom: 6 }}
                  >
                    <option value="">No winner</option>
                    {allPlayersSorted.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input
                    type="text"
                    placeholder="Distance"
                    value={editDistance}
                    onChange={e => setEditDistance(e.target.value)}
                    style={{ width: "100%", padding: "8px", borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 13, marginBottom: 8 }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => saveEdit(c)} style={{ flex: 1, padding: 8, borderRadius: 6, background: K.act, border: "none", color: K.bg, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
                    <button onClick={() => setEditing(null)} style={{ flex: 1, padding: 8, borderRadius: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              );
            }
            return (
              <div key={c.id} style={{ background: K.card, borderRadius: CARD_RADIUS, padding: "7px 12px", border: `1px solid ${K.bdr}`, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                <span style={{ color: K.t2 }}>Wk {c.week} · Hole {c.holeNum}</span>
                <span style={{ fontWeight: 700 }}>{players.find(p => p.id === c.playerId)?.name}</span>
                <span style={{ color: K.acc, fontWeight: 600 }}>{c.distance}</span>
                {isComm && saveCtp && (
                  <button onClick={() => startEdit(c)} style={{ background: "none", border: `1px solid ${K.bdr}`, borderRadius: 4, color: K.t3, fontSize: 10, padding: "2px 8px", cursor: "pointer", fontWeight: 600, marginLeft: 6 }}>Edit</button>
                )}
              </div>
            );
          })}
        </div>
        {!weeklyResults.length && (
          <div style={{ fontSize: 13, color: K.t3, textAlign: "center", padding: 20 }}>No CTP results recorded yet</div>
        )}
      </>)}
    </div>
  );
}
