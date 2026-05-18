// ─────────────────────────────────────────────────────────────────────────
//  functions/index.js — MnQ Golf push notification Cloud Functions
// ─────────────────────────────────────────────────────────────────────────
// Phase 1: one test endpoint (sendTestPush) for verifying the wiring.
// Phase 2 adds the four real triggers (week_finalized, attest_ready,
// rained_out, attendance_marked) as Firestore document triggers.
//
// To deploy:
//   cd functions
//   npm install
//   firebase deploy --only functions

const admin = require("firebase-admin");
// Import HttpsError + onCall together from the same v2/https module —
// importing HttpsError via firebase-functions/v2.https can fail in some
// v6 versions where the v2 namespace doesn't re-export http utilities.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

const LEAGUE_ID = "league_2026";

// ─── Core send helper ────────────────────────────────────────────────────
// Looks up all tokens registered for a player and sends the same payload
// to each. Cleans up stale tokens (FCM returns specific error codes for
// devices that have uninstalled / cleared data / etc.) so the token
// collection stays small and we don't waste API calls on dead targets.
//
// payload shape:
//   notification: { title: string, body: string }
//   data: { type: string, week?: string, url?: string, ... } — strings only
//
// Returns: { sent: number, failed: number, cleanedTokens: number, errors: [] }
async function sendToPlayer(playerId, payload) {
  if (!playerId) {
    logger.warn("sendToPlayer: missing playerId");
    return { sent: 0, failed: 0, cleanedTokens: 0, errors: ["missing_playerId"] };
  }

  let snap;
  try {
    snap = await db.collection("league_notifications_tokens")
      .where("league_id", "==", LEAGUE_ID)
      .where("playerId", "==", playerId)
      .get();
  } catch (err) {
    logger.error("Firestore query failed", { playerId, err: err?.message, code: err?.code });
    throw new HttpsError("internal", `Firestore query failed: ${err?.message || err}`);
  }

  if (snap.empty) {
    logger.info("sendToPlayer: no tokens for", playerId);
    return { sent: 0, failed: 0, cleanedTokens: 0, errors: ["no_tokens_registered"] };
  }

  let sent = 0, failed = 0, cleaned = 0;
  const errors = [];

  for (const tokenDoc of snap.docs) {
    const data = tokenDoc.data();
    const token = data.token;
    if (!token) {
      logger.warn("Token doc missing token field", { docId: tokenDoc.id });
      continue;
    }
    try {
      await messaging.send({
        token,
        notification: payload.notification,
        data: stringifyDataValues(payload.data || {}),
        webpush: {
          headers: { TTL: "3600" },
        },
      });
      sent++;
      try { await tokenDoc.ref.update({ lastSeenAt: Date.now() }); }
      catch (e) { logger.warn("lastSeenAt update failed", { docId: tokenDoc.id }); }
    } catch (err) {
      failed++;
      const code = err?.errorInfo?.code || err?.code || "unknown";
      const msg = err?.errorInfo?.message || err?.message || String(err);
      logger.error("messaging.send failed", { playerId, docId: tokenDoc.id, code, msg });
      errors.push(`${code}: ${msg}`);

      // Stale-token detection — clean up so we don't keep hitting it
      const isStale =
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument";
      if (isStale) {
        try {
          await tokenDoc.ref.delete();
          cleaned++;
          logger.info("Removed stale token", { playerId, code });
        } catch (e) {
          logger.warn("Stale token cleanup failed", { docId: tokenDoc.id });
        }
      }
    }
  }

  return { sent, failed, cleanedTokens: cleaned, errors };
}

// Helper — FCM data fields must all be strings.
function stringifyDataValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

// ─── Test endpoint ──────────────────────────────────────────────────────
// Called from the Notifications settings page. Wrapped in try/catch so
// any unexpected error surfaces as a typed HttpsError with a useful
// message, rather than the generic "internal" code.
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

    // If we sent to zero devices, surface a helpful error rather than
    // a silent "success".
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

// Export the helper for Phase 2 triggers to use (when they're added)
exports.__sendToPlayer = sendToPlayer;
