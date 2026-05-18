// ─────────────────────────────────────────────────────────────────────────
//  functions/index.js — MnQ Golf push notification Cloud Functions
// ─────────────────────────────────────────────────────────────────────────
// Phase 1: sendTestPush (callable, manual test from settings page)
// Phase 2 (this version): four real Firestore document triggers:
//   - onWeekLocked        → "Week N results are in"
//   - onMatchResultSigned → "Time to attest your scorecard"
//   - onWeekRainedOut     → "Week N rained out"
//   - onAttendanceMarked  → "Bob marked himself absent/making up"
//
// All triggers use onDocumentWritten so we can inspect both before and
// after state — important for transition detection (e.g., locked flipping
// false→true) rather than firing on every save. Without transition
// detection, a re-save of an already-locked week would re-notify the
// whole league.
//
// Deploy: `firebase deploy --only functions` from repo root.

const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

const LEAGUE_ID = "league_2026";

// ─── Core send helper (data-only messages) ───────────────────────────────
// See Phase 1 commentary for the data-only format rationale.
async function sendToPlayer(playerId, payload) {
  if (!playerId) {
    return { sent: 0, failed: 0, cleanedTokens: 0, errors: ["missing_playerId"] };
  }

  let snap;
  try {
    snap = await db.collection("league_notifications_tokens")
      .where("league_id", "==", LEAGUE_ID)
      .where("playerId", "==", playerId)
      .get();
  } catch (err) {
    logger.error("Firestore query failed", { playerId, err: err?.message });
    throw new HttpsError("internal", `Firestore query failed: ${err?.message || err}`);
  }

  if (snap.empty) {
    return { sent: 0, failed: 0, cleanedTokens: 0, errors: ["no_tokens_registered"] };
  }

  let sent = 0, failed = 0, cleaned = 0;
  const errors = [];

  const dataPayload = {
    ...stringifyDataValues(payload.data || {}),
    title: payload.notification?.title || "MnQ Golf",
    body: payload.notification?.body || "",
  };

  for (const tokenDoc of snap.docs) {
    const data = tokenDoc.data();
    const token = data.token;
    if (!token) continue;
    try {
      await messaging.send({
        token,
        data: dataPayload,
        webpush: {
          headers: { TTL: "3600", Urgency: "high" },
        },
      });
      sent++;
      try { await tokenDoc.ref.update({ lastSeenAt: Date.now() }); }
      catch { /* swallow */ }
    } catch (err) {
      failed++;
      const code = err?.errorInfo?.code || err?.code || "unknown";
      const msg = err?.errorInfo?.message || err?.message || String(err);
      logger.error("messaging.send failed", { playerId, docId: tokenDoc.id, code, msg });
      errors.push(`${code}: ${msg}`);

      const isStale =
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument";
      if (isStale) {
        try {
          await tokenDoc.ref.delete();
          cleaned++;
        } catch { /* swallow */ }
      }
    }
  }

  return { sent, failed, cleanedTokens: cleaned, errors };
}

function stringifyDataValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

// ─── Helper: fetch all active players for the league ────────────────────
// Matches App.jsx's activePlayers filter: status !== "inactive".
async function fetchActivePlayers() {
  const snap = await db.collection("league_players")
    .where("league_id", "==", LEAGUE_ID)
    .get();
  return snap.docs
    .map(d => d.data())
    .filter(p => p.status !== "inactive");
}

// ─── Helper: send to many players with logging ──────────────────────────
async function broadcast(recipients, payload, triggerLabel) {
  let totalSent = 0, totalFailed = 0;
  const playerErrors = {};
  for (const pid of recipients) {
    try {
      const r = await sendToPlayer(pid, payload);
      totalSent += r.sent;
      totalFailed += r.failed;
      if (r.errors.length && !r.errors.every(e => e === "no_tokens_registered")) {
        playerErrors[pid] = r.errors;
      }
    } catch (e) {
      playerErrors[pid] = [e?.message || String(e)];
    }
  }
  logger.info(`${triggerLabel} broadcast complete`, {
    recipients: recipients.length,
    totalSent,
    totalFailed,
    errorsForPlayers: Object.keys(playerErrors),
  });
  return { totalSent, totalFailed };
}

// ─── Helper: resolve match players for a given week + (team1Id, team2Id) ─
// Returns array of player IDs (up to 4) from the two teams. Uses the
// teams collection to find player1/player2 for each team.
async function resolveMatchPlayers(team1Id, team2Id) {
  const out = [];
  for (const teamId of [team1Id, team2Id]) {
    if (!teamId) continue;
    try {
      const teamSnap = await db.collection("league_teams").doc(teamId).get();
      const team = teamSnap.exists ? teamSnap.data() : null;
      if (team?.player1) out.push(team.player1);
      if (team?.player2) out.push(team.player2);
    } catch (e) {
      logger.warn("resolveMatchPlayers team fetch failed", { teamId, err: e?.message });
    }
  }
  return out;
}

// ─── Helper: which players in this week are flagged absent? ─────────────
async function fetchAbsentPidsForWeek(week) {
  const snap = await db.collection("league_attendance")
    .where("league_id", "==", LEAGUE_ID)
    .where("week", "==", week)
    .where("status", "==", "absent")
    .get();
  return new Set(snap.docs.map(d => d.data().playerId).filter(Boolean));
}

// ═════════════════════════════════════════════════════════════════════════
//  TRIGGER 1 — Week Locked (Weekly results finalized)
// ═════════════════════════════════════════════════════════════════════════
// Fires on the locked false→true transition. Notifies every active player.
// Detection of false→true (not just "locked is now true") prevents re-fire
// when the commish edits other fields on an already-locked week.
exports.onWeekLocked = onDocumentWritten(
  "league_schedule/{docId}",
  async (event) => {
    try {
      const before = event.data.before?.exists ? event.data.before.data() : null;
      const after = event.data.after?.exists ? event.data.after.data() : null;
      if (!after) return; // deleted

      // Only fire on the transition into locked=true. Includes the case
      // where the doc was just created with locked=true (before=null).
      const wasLocked = before?.locked === true;
      const nowLocked = after?.locked === true;
      if (wasLocked || !nowLocked) return;

      // Filter to our league only (this trigger fires for the entire
      // collection; multi-league projects would otherwise leak).
      if (after.league_id && after.league_id !== LEAGUE_ID) return;

      const week = after.week;
      logger.info("onWeekLocked firing", { week, docId: event.params.docId });

      const players = await fetchActivePlayers();
      const recipients = players.map(p => p.id).filter(Boolean);

      await broadcast(recipients, {
        notification: {
          title: `Week ${week} is final`,
          body: "Results are in — check the standings.",
        },
        data: { type: "week_finalized", week: String(week), url: "/?tab=standings" },
      }, "week_finalized");
    } catch (err) {
      logger.error("onWeekLocked error", { err: err?.message, stack: err?.stack?.slice(0, 500) });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════
//  TRIGGER 2 — Match Result Signed (Time to attest your scorecard)
// ═════════════════════════════════════════════════════════════════════════
// Fires on the creation of a league_match_results document. The signer
// has just submitted; the 3 other players in the match need to attest.
// Important — we filter by "is this the first time we've seen this doc":
//   - If before existed → it's an UPDATE (probably an attestation arriving
//     incrementally). Don't re-fire; would spam non-attesters who haven't
//     acted yet, and re-fire is unnecessary anyway since they already got
//     the first notification.
//   - If before didn't exist → it's a CREATE (the signer's first save).
//     Send to the non-signing players in the match.
exports.onMatchResultSigned = onDocumentWritten(
  "league_match_results/{docId}",
  async (event) => {
    try {
      const before = event.data.before?.exists ? event.data.before.data() : null;
      const after = event.data.after?.exists ? event.data.after.data() : null;
      if (!after) return;

      // CREATE only — not on subsequent updates
      if (before) return;

      if (after.league_id && after.league_id !== LEAGUE_ID) return;

      const { week, team1Id, team2Id, signedByPlayerId, attestedBy = [] } = after;
      if (!team1Id || !team2Id || !signedByPlayerId) {
        logger.warn("onMatchResultSigned: missing required fields", { week, team1Id, team2Id, signedByPlayerId });
        return;
      }

      logger.info("onMatchResultSigned firing", { week, signedByPlayerId, docId: event.params.docId });

      const matchPids = await resolveMatchPlayers(team1Id, team2Id);
      const absent = await fetchAbsentPidsForWeek(week);

      // Recipients = all match players EXCEPT the signer, already-attested,
      // and absent players. Absent players auto-substitute and don't attest.
      const recipients = matchPids.filter(pid =>
        pid !== signedByPlayerId
        && !attestedBy.includes(pid)
        && !absent.has(pid)
      );

      if (recipients.length === 0) {
        logger.info("onMatchResultSigned: no recipients (all absent or pre-attested)", { week });
        return;
      }

      await broadcast(recipients, {
        notification: {
          title: "Time to attest your scorecard",
          body: `Your week ${week} match has been signed — open Scoring to attest.`,
        },
        data: { type: "attest_ready", week: String(week), url: "/?tab=scoring" },
      }, "attest_ready");
    } catch (err) {
      logger.error("onMatchResultSigned error", { err: err?.message, stack: err?.stack?.slice(0, 500) });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════
//  TRIGGER 3 — Week Rained Out
// ═════════════════════════════════════════════════════════════════════════
// Fires on the rainedOut false→true transition. Notifies every active
// player so they know league night is cancelled. Symmetric to week-locked.
exports.onWeekRainedOut = onDocumentWritten(
  "league_schedule/{docId}",
  async (event) => {
    try {
      const before = event.data.before?.exists ? event.data.before.data() : null;
      const after = event.data.after?.exists ? event.data.after.data() : null;
      if (!after) return;

      const wasRained = before?.rainedOut === true;
      const nowRained = after?.rainedOut === true;
      if (wasRained || !nowRained) return;

      if (after.league_id && after.league_id !== LEAGUE_ID) return;

      const week = after.week;
      logger.info("onWeekRainedOut firing", { week, docId: event.params.docId });

      const players = await fetchActivePlayers();
      const recipients = players.map(p => p.id).filter(Boolean);

      await broadcast(recipients, {
        notification: {
          title: `Week ${week} rained out`,
          body: "League night is cancelled — check Schedule for makeup info.",
        },
        data: { type: "rained_out", week: String(week), url: "/?tab=schedule" },
      }, "rained_out");
    } catch (err) {
      logger.error("onWeekRainedOut error", { err: err?.message, stack: err?.stack?.slice(0, 500) });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════
//  TRIGGER 4 — Attendance Marked (Player marked out in your match)
// ═════════════════════════════════════════════════════════════════════════
// Fires when an attendance doc is created (player marked absent or making
// up). Notifies the OTHER 3 players in that player's match so they know
// to plan around it. Doesn't re-fire on status flips (absent ↔ makeup) —
// only on initial creation. Status changes between absent/makeup represent
// the marked-out player refining their plan, not a brand-new event.
exports.onAttendanceMarked = onDocumentWritten(
  "league_attendance/{docId}",
  async (event) => {
    try {
      const before = event.data.before?.exists ? event.data.before.data() : null;
      const after = event.data.after?.exists ? event.data.after.data() : null;
      if (!after) return;

      // CREATE only
      if (before) return;

      if (after.league_id && after.league_id !== LEAGUE_ID) return;

      const { week, playerId, status, markedBy } = after;
      if (!week || !playerId || !status) {
        logger.warn("onAttendanceMarked: missing required fields", { week, playerId, status });
        return;
      }

      logger.info("onAttendanceMarked firing", { week, playerId, status });

      // Find the player's match this week. Look up the schedule doc for
      // the week, find the match containing playerId's team, and resolve
      // the other 3 player IDs.
      const scheduleSnap = await db.collection("league_schedule")
        .where("league_id", "==", LEAGUE_ID)
        .where("week", "==", week)
        .get();
      if (scheduleSnap.empty) {
        logger.warn("onAttendanceMarked: no schedule for week", { week });
        return;
      }

      const wk = scheduleSnap.docs[0].data();
      if (!wk.matches?.length) return;

      // Find player's team
      const playerTeamSnap = await db.collection("league_teams")
        .where("league_id", "==", LEAGUE_ID)
        .get();
      const teamForPlayer = playerTeamSnap.docs
        .map(d => d.data())
        .find(t => t.player1 === playerId || t.player2 === playerId);
      if (!teamForPlayer) {
        logger.warn("onAttendanceMarked: player not on any team", { playerId });
        return;
      }

      // Find the match containing this team
      const myMatch = wk.matches.find(m =>
        m.team1 === teamForPlayer.id || m.team2 === teamForPlayer.id
      );
      if (!myMatch) {
        logger.info("onAttendanceMarked: player has no match this week", { playerId, week });
        return;
      }

      const matchPids = await resolveMatchPlayers(myMatch.team1, myMatch.team2);

      // Recipients = everyone in the match EXCEPT the player who marked
      // themselves. (Marker doesn't need a push reminding them what they
      // just did.) Skip if the marker WAS someone else (commish acting
      // on the player's behalf) — in that case still skip the marker.
      const recipients = matchPids.filter(pid => pid !== playerId);

      if (recipients.length === 0) return;

      // Get player name for the message body. Fall back to a generic
      // phrase if lookup fails.
      let playerName = "A player";
      try {
        const pSnap = await db.collection("league_players").doc(playerId).get();
        if (pSnap.exists) {
          const p = pSnap.data();
          const parts = (p.name || "").split(" ").filter(Boolean);
          playerName = parts.length ? parts[parts.length - 1] : "A player";
        }
      } catch { /* swallow */ }

      const statusText = status === "absent" ? "is out" : "is making up later";
      await broadcast(recipients, {
        notification: {
          title: `${playerName} ${statusText}`,
          body: `Week ${week} match update — check Schedule for details.`,
        },
        data: { type: "attendance_marked", week: String(week), url: "/?tab=schedule" },
      }, "attendance_marked");
    } catch (err) {
      logger.error("onAttendanceMarked error", { err: err?.message, stack: err?.stack?.slice(0, 500) });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════
//  Phase 1 — sendTestPush (manual trigger from settings page)
// ═════════════════════════════════════════════════════════════════════════
exports.sendTestPush = onCall(async (request) => {
  try {
    const { playerId, message = "This is a test push from MnQ Golf." } = request.data || {};
    if (!playerId) {
      throw new HttpsError("invalid-argument", "playerId required");
    }
    logger.info("Test push starting", { playerId });

    const result = await sendToPlayer(playerId, {
      notification: { title: "MnQ Golf — test", body: message },
      data: { type: "test", url: "/" },
    });

    logger.info("Test push complete", { playerId, ...result });

    if (result.sent === 0) {
      if (result.errors.includes("no_tokens_registered")) {
        throw new HttpsError("failed-precondition", "No devices registered for this player. Try Disable then Enable.");
      }
      throw new HttpsError("internal", `All sends failed: ${result.errors.slice(0, 3).join(" | ")}`);
    }
    return result;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("sendTestPush unexpected error", {
      message: err?.message,
      code: err?.code,
      stack: err?.stack?.slice(0, 500),
    });
    throw new HttpsError("internal", `Unexpected: ${err?.message || String(err)}`);
  }
});

exports.__sendToPlayer = sendToPlayer;
