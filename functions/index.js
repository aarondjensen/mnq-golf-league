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
//
// To test the test endpoint:
//   firebase functions:shell
//   sendTestPush({playerId: "your-pid", message: "hello"})

const admin = require("firebase-admin");
const functions = require("firebase-functions/v2");
const { onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

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
//          (FCM requires all data values to be strings; we stringify upstream)
//
// Returns: { sent: number, failed: number, cleanedTokens: number }
async function sendToPlayer(playerId, payload) {
  if (!playerId) {
    logger.warn("sendToPlayer: missing playerId");
    return { sent: 0, failed: 0, cleanedTokens: 0 };
  }
  const snap = await db.collection("league_notifications_tokens")
    .where("league_id", "==", LEAGUE_ID)
    .where("playerId", "==", playerId)
    .get();
  if (snap.empty) {
    logger.info("sendToPlayer: no tokens for", playerId);
    return { sent: 0, failed: 0, cleanedTokens: 0 };
  }

  let sent = 0, failed = 0, cleaned = 0;
  const tokenDocs = snap.docs;

  // Iterate one-by-one rather than messaging.sendEach so we can correlate
  // each result with its doc for cleanup. At 20-player scale with ~1-3
  // tokens per player, the sequential overhead is negligible.
  for (const tokenDoc of tokenDocs) {
    const data = tokenDoc.data();
    const token = data.token;
    if (!token) continue;
    try {
      await messaging.send({
        token,
        notification: payload.notification,
        // FCM requires all data values to be strings. Coerce before sending.
        data: stringifyDataValues(payload.data || {}),
        webpush: {
          // FCM web push delivers via the relay; this block lets us add
          // platform-specific options. Headers TTL = 1 hour means stale
          // notifications get dropped rather than delivered late.
          headers: { TTL: "3600" },
        },
      });
      sent++;
      // Update lastSeenAt so we can later identify dormant tokens
      await tokenDoc.ref.update({ lastSeenAt: Date.now() });
    } catch (err) {
      failed++;
      // Stale-token error codes — see Firebase docs:
      // https://firebase.google.com/docs/cloud-messaging/send-message#admin
      const code = err?.errorInfo?.code || err?.code || "";
      const isStale =
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument";
      if (isStale) {
        await tokenDoc.ref.delete();
        cleaned++;
        logger.info("Removed stale token", { playerId, code });
      } else {
        logger.error("Send failed (non-stale)", { playerId, code, err });
      }
    }
  }

  return { sent, failed, cleanedTokens: cleaned };
}

// Helper — FCM data fields must all be strings. Coerce non-string values.
function stringifyDataValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

// ─── Test endpoint ──────────────────────────────────────────────────────
// Callable from the client during dev to verify the wiring. Takes a
// playerId and an optional message; sends a test notification to all
// devices registered for that player.
//
// Usage from JavaScript:
//   const fn = httpsCallable(functions, "sendTestPush");
//   await fn({ playerId: "pid_abc", message: "Hello world" });
//
// Or via Firebase shell:
//   sendTestPush({playerId: "pid_abc"})
exports.sendTestPush = onCall(async (request) => {
  const { playerId, message = "This is a test push from MnQ Golf." } = request.data || {};
  if (!playerId) {
    throw new functions.https.HttpsError("invalid-argument", "playerId required");
  }
  const result = await sendToPlayer(playerId, {
    notification: { title: "Test notification", body: message },
    data: { type: "test", url: "/" },
  });
  logger.info("Test push complete", { playerId, ...result });
  return result;
});

// Export the helper for Phase 2 triggers to use (when they're added)
exports.__sendToPlayer = sendToPlayer;
