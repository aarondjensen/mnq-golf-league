import { useState, useMemo } from "react";
import { K, Card, EmptyState, LIST_GAP, CARD_RADIUS, NAME_SIZE, NAME_WEIGHT, HERO_NUM_SIZE, HERO_NUM_WEIGHT, RANK_BADGE_SIZE, RANK_BADGE_RADIUS, RANK_BADGE_FONT, CHEVRON_SIZE } from "../theme";

export default function CTPView({ ctpData, players, isComm, saveCtp }) {
  const [view, setView] = useState("players"); // "players" | "weeks"
  const [expanded, setExpanded] = useState(null); // playerId
  const [editing, setEditing] = useState(null);
  const [editPlayer, setEditPlayer] = useState("");
  const [editDistance, setEditDistance] = useState("");

  // Season leaders — players grouped with their individual wins.
  // Each leader also carries their win list so the row can expand to show the detail.
  const leaders = useMemo(() => {
    const byPlayer = {};
    ctpData.filter(c => c.playerId).forEach(c => {
      if (!byPlayer[c.playerId]) byPlayer[c.playerId] = [];
      byPlayer[c.playerId].push(c);
    });
    return Object.entries(byPlayer)
      .map(([pid, wins]) => ({
        p: players.find(pl => pl.id === pid),
        cnt: wins.length,
        wins: [...wins].sort((a, b) => {
          // Most recent first — matches the feel of the Weeks tab
          if (a.week !== b.week) return b.week - a.week;
          return a.holeNum - b.holeNum;
        }),
      }))
      .filter(e => e.p)
      .sort((a, b) => {
        // Primary sort: count (most wins first). Tiebreaker: name.
        if (b.cnt !== a.cnt) return b.cnt - a.cnt;
        return (a.p.name || "").localeCompare(b.p.name || "");
      });
  }, [ctpData, players]);

  const weeklyResults = useMemo(() =>
    ctpData.filter(c => c.playerId).sort((a, b) => {
      if (a.week !== b.week) return b.week - a.week;
      return a.holeNum - b.holeNum;
    }),
    [ctpData]
  );

  const allPlayersSorted = useMemo(() =>
    [...players].sort((a, b) => a.name.localeCompare(b.name)),
    [players]
  );

  const startEdit = (c) => {
    setEditing(c.id);
    setEditPlayer(c.playerId || "");
    setEditDistance(c.distance || "");
  };

  const saveEdit = async (c) => {
    await saveCtp({ ...c, playerId: editPlayer, distance: editDistance });
    setEditing(null);
  };

  // Early-out empty state only when nothing to show AND the user isn't a commish
  // (commishes should still see the Weeks tab so they can assign winners to open slots).
  if (!leaders.length && !isComm) {
    return <EmptyState icon="target" title="No CTP results yet" />;
  }

  const toggleBtnStyle = (active) => ({
    flex: "1 1 auto", minWidth: 0,
    padding: "8px 10px", borderRadius: 6,
    background: active ? K.card : "transparent",
    border: active ? `1px solid ${K.bdr}` : "1px solid transparent",
    color: active ? K.t1 : K.t3,
    fontSize: 11, fontWeight: 700, letterSpacing: .6, textTransform: "uppercase",
    cursor: "pointer", whiteSpace: "nowrap",
    transition: "all .15s",
  });

  return (
    <div>
      {/* View toggle — two options. Matches the visual style used in Standings. */}
      <div style={{
        display: "flex", gap: 6,
        background: K.inp, border: `1px solid ${K.bdr}`,
        borderRadius: 8, padding: 4, marginBottom: 14,
      }}>
        <button onClick={() => setView("players")} style={toggleBtnStyle(view === "players")}>
          Players
        </button>
        <button onClick={() => setView("weeks")} style={toggleBtnStyle(view === "weeks")}>
          Weeks
        </button>
      </div>

      {/* PLAYERS VIEW — season leaders, expandable to show each player's wins */}
      {view === "players" && (
        <>
          {leaders.length === 0 ? (
            <EmptyState icon="target" title="No CTP winners yet" subtitle="Results will appear here as the commissioner records each week's closest-to-the-pin winners." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
              {leaders.map((e, i) => {
                const isExp = expanded === e.p.id;
                return (
                  <div key={e.p.id}>
                    {/* Row — whole card is tappable to expand */}
                    <div
                      onClick={() => setExpanded(isExp ? null : e.p.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setExpanded(isExp ? null : e.p.id); } }}
                      style={{
                        display: "flex", alignItems: "center",
                        background: K.card,
                        border: `1px solid ${i === 0 ? K.gold + "40" : K.bdr}`,
                        borderRadius: isExp ? `${CARD_RADIUS}px ${CARD_RADIUS}px 0 0` : CARD_RADIUS,
                        borderBottom: isExp ? "none" : `1px solid ${i === 0 ? K.gold + "40" : K.bdr}`,
                        padding: "10px 14px", gap: 8,
                        cursor: "pointer", userSelect: "none",
                      }}
                    >
                      <div style={{
                        width: RANK_BADGE_SIZE, height: RANK_BADGE_SIZE, borderRadius: RANK_BADGE_RADIUS,
                        background: i === 0 ? K.gold + "20" : K.inp,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: RANK_BADGE_FONT, fontWeight: 800,
                        color: i === 0 ? K.gold : K.t3,
                        flexShrink: 0,
                      }}>{i + 1}</div>
                      <span style={{ flex: 1, fontSize: NAME_SIZE, fontWeight: NAME_WEIGHT, color: K.t1 }}>
                        {e.p.name}
                      </span>
                      <span style={{
                        fontSize: HERO_NUM_SIZE, fontWeight: HERO_NUM_WEIGHT, color: K.t1,
                        fontFamily: "'League Spartan', sans-serif",
                      }}>{e.cnt}</span>
                      <span style={{
                        fontSize: CHEVRON_SIZE, color: K.t3,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 16, lineHeight: 1, marginLeft: 2,
                      }}>{isExp ? "▴" : "▾"}</span>
                    </div>

                    {/* Expanded panel — list of wins with week, hole, distance */}
                    {isExp && (
                      <div style={{
                        background: K.inp,
                        border: `1px solid ${i === 0 ? K.gold + "40" : K.bdr}`,
                        borderTop: "none",
                        borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`,
                        padding: "8px 10px",
                      }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {e.wins.map(w => (
                            <div key={w.id} style={{
                              display: "flex", alignItems: "center",
                              background: K.card,
                              border: `1px solid ${K.bdr}`,
                              borderRadius: 6,
                              padding: "6px 10px",
                              fontSize: 12,
                              gap: 10,
                            }}>
                              <span style={{ color: K.t3, fontWeight: 600, minWidth: 52 }}>
                                Wk {w.week}
                              </span>
                              <span style={{ flex: 1, color: K.t2, fontWeight: 600 }}>
                                Hole {w.holeNum}
                              </span>
                              {w.distance && (
                                <span style={{ color: K.acc, fontWeight: 600 }}>
                                  {w.distance}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* WEEKS VIEW — chronological list of every recorded CTP result, commish-editable */}
      {view === "weeks" && (
        <>
          {weeklyResults.length === 0 ? (
            <EmptyState icon="target" title="No CTP results recorded yet" subtitle={isComm ? "Open a playable hole from the Scoring tab to record a CTP winner." : undefined} />
          ) : (
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
          )}
        </>
      )}
    </div>
  );
}
