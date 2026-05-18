import { useState, useEffect, useMemo } from "react";
import { K, Card, SubLabel } from "../theme";
import { db, LEAGUE_ID } from "../firebase";

// ─────────────────────────────────────────────────────────────────────────
//  NotificationsAdmin — commissioner-only view of push notification setup
// ─────────────────────────────────────────────────────────────────────────
// Surfaces which players have registered for push notifications and what
// kind of device(s) they're set up on. Mainly useful for the commissioner
// to chase down players who haven't enabled — particularly iOS users who
// might be in regular Safari instead of the installed PWA (where push
// can't fire on iOS).
//
// Data flow:
//   - Subscribe to league_notifications_tokens (live updates as players
//     enable / disable)
//   - Each token doc has playerId + isIOS + isStandalone + userAgent
//   - Group tokens by playerId, join with the players array to get names
//   - Render summary + per-player rows

// Translate the (userAgent + isStandalone) into a short device-type chip
// label. The iOS/Android/Desktop split is derived from userAgent (always
// saved, robust against missing fields). The PWA-vs-Safari distinction
// for iOS requires isStandalone, which was added in a later release — if
// that field is missing on an older token doc, we show a neutral "iOS"
// chip rather than guessing wrong (iOS Safari would be misleading since
// the user clearly registered successfully — push won't actually fire
// from a non-standalone iOS Safari tab).
const deviceType = (token) => {
  const ua = token.userAgent || "";
  if (/iPhone|iPad|iPod/.test(ua)) {
    if (token.isStandalone === true) return { label: "iOS PWA", color: K.grn };
    if (token.isStandalone === false) return { label: "iOS Safari", color: K.warn };
    return { label: "iOS", color: K.t2 }; // unknown — older token
  }
  if (/Android/i.test(ua)) return { label: "Android", color: K.t2 };
  return { label: "Desktop", color: K.t2 };
};

export default function NotificationsAdmin({ players }) {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = db.subscribe(
      "league_notifications_tokens",
      [{ field: "league_id", op: "==", value: LEAGUE_ID }],
      (data) => {
        setTokens(data || []);
        setLoading(false);
      }
    );
    return () => { try { unsub?.(); } catch { /* swallow */ } };
  }, []);

  // Group tokens by playerId and join with players. Players with no
  // tokens get an empty array (so we can still display "Off" for them).
  const rows = useMemo(() => {
    const byPid = {};
    tokens.forEach(t => {
      if (!t.playerId) return;
      if (!byPid[t.playerId]) byPid[t.playerId] = [];
      byPid[t.playerId].push(t);
    });
    // Players list — show in roster order, all 20 of them, enabled
    // and unenabled alike.
    const playerRows = (players || []).map(p => ({
      pid: p.id,
      name: p.name,
      tokens: byPid[p.id] || [],
    }));
    // Unknown tokens (orphaned playerId not in current roster) get
    // a trailing section so Aaron can spot stale registrations.
    const known = new Set(playerRows.map(r => r.pid));
    const orphanTokens = tokens.filter(t => t.playerId && !known.has(t.playerId));
    const orphansByPid = {};
    orphanTokens.forEach(t => {
      if (!orphansByPid[t.playerId]) orphansByPid[t.playerId] = [];
      orphansByPid[t.playerId].push(t);
    });
    const orphanRows = Object.entries(orphansByPid).map(([pid, ts]) => ({
      pid,
      name: `Unknown (${pid})`,
      tokens: ts,
      isOrphan: true,
    }));
    return [...playerRows, ...orphanRows];
  }, [tokens, players]);

  const enabledCount = rows.filter(r => !r.isOrphan && r.tokens.length > 0).length;
  const totalPlayers = (players || []).length;
  const isIOSToken = (t) => /iPhone|iPad|iPod/.test(t.userAgent || "");
  const iosPwaCount = tokens.filter(t => isIOSToken(t) && t.isStandalone === true).length;
  const iosSafariCount = tokens.filter(t => isIOSToken(t) && t.isStandalone === false).length;

  return (
    <div>
      <SubLabel>Push Notification Status</SubLabel>

      {/* Summary card */}
      <Card style={{ padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 24, fontWeight: 800, color: K.t1, lineHeight: 1 }}>
            {loading ? "…" : enabledCount}
          </span>
          <span style={{ fontSize: 13, color: K.t2 }}>
            of {totalPlayers} players enabled
          </span>
        </div>
        {iosPwaCount + iosSafariCount > 0 && (
          <div style={{ fontSize: 11, color: K.t3, marginTop: 4 }}>
            iOS PWA: {iosPwaCount}{iosSafariCount > 0 && ` · iOS Safari (won't work): ${iosSafariCount}`}
          </div>
        )}
      </Card>

      {/* Per-player list */}
      <SubLabel>By Player</SubLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map(r => {
          const enabled = r.tokens.length > 0;
          return (
            <Card key={r.pid} style={{ padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: r.isOrphan ? K.t3 : K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.name}
                  </div>
                  {/* Device chips, one per token registered. Multiple
                      chips when the user has enabled on phone + laptop. */}
                  {enabled && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                      {r.tokens.map((t, i) => {
                        const dt = deviceType(t);
                        return (
                          <span key={i} style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: .5,
                            textTransform: "uppercase",
                            padding: "2px 6px", borderRadius: 4,
                            background: dt.color + "20",
                            color: dt.color,
                            border: `1px solid ${dt.color}40`,
                          }}>
                            {dt.label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: .8,
                  textTransform: "uppercase",
                  padding: "3px 8px", borderRadius: 5,
                  background: enabled ? K.grn : K.t3 + "30",
                  color: enabled ? K.bg : K.t3,
                  flexShrink: 0,
                }}>
                  {enabled ? "Enabled" : "Off"}
                </span>
              </div>
            </Card>
          );
        })}
        {rows.length === 0 && !loading && (
          <Card style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 12, color: K.t3 }}>No players to display.</div>
          </Card>
        )}
      </div>

      <div style={{ fontSize: 10, color: K.t3, lineHeight: 1.5, marginTop: 12, padding: "0 4px" }}>
        Status updates live as players enable / disable. Stale registrations are cleaned up automatically the first time a push fails to deliver.
      </div>
    </div>
  );
}
