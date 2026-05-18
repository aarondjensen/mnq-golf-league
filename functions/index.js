// ─────────────────────────────────────────────────────────────────────────
//  functions/index.js — MnQ Golf push notification Cloud Functions
// ─────────────────────────────────────────────────────────────────────────
// Phase 1: one test endpoint (sendTestPush) for verifying the wiring.
// Phase 2 adds the four real triggers (week_finalized, attest_ready,
// rained_out, attendance_marked) as Firestore document triggers.
//
// To deploy:
//   cd functions
//   firebase deploy --only functions

const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

const LEAGUE_ID = "league_2026";

// ─── Core send helper ────────────────────────────────────────────────────
// IMPORTANT — message format choice: we send DATA-ONLY messages (no
// top-level `notification` block). This forces every platform's SW to
// invoke onBackgroundMessage and call showNotification itself. The
// alternative (sending a notification block) has FCM auto-display the
// notification on some platforms but not others — and on iOS PWA the
// auto-display silently fails while ALSO preventing onBackgroundMessage
// from firing, so the notification just vanishes. Data-only is the
// consistent path. Trade-off: SW MUST call showNotification on every
// push, otherwise iOS may throttle our origin's push permissions.
//
// payload shape (caller-side):
//   notification: { title: string, body: string }
//   data: { type: string, url?: string, ... }
//
// Wire-format (sent to FCM): everything goes into the data map; SW reads
// title/body from data.title and data.body.
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
    logger.error("Firestore query failed", { playerId, err: err?.message });
    throw new HttpsError("internal", `Firestore query failed: ${err?.message || err}`);
  }

  if (snap.empty) {
    logger.info("sendToPlayer: no tokens for", playerId);
    return { sent: 0, failed: 0, cleanedTokens: 0, errors: ["no_tokens_registered"] };
  }

  let sent = 0, failed = 0, cleaned = 0;
  const errors = [];

  // Build the data-only payload. FCM requires all data values to be
  // strings, so the title/body strings go directly. Any data fields the
  // caller passed in are stringified and merged. Title/body are
  // top-priority keys; we don't allow data fields to override them.
  const dataPayload = {
    ...stringifyDataValues(payload.data || {}),
    title: payload.notification?.title || "MnQ Golf",
    body: payload.notification?.body || "",
  };

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
        // No `notification` block — pure data-only. Forces SW to handle
        // display, gives us cross-platform consistency on iOS PWA.
        data: dataPayload,
        webpush: {
          headers: {
            TTL: "3600",
            // Urgency "high" tells the iOS push relay to wake the SW
            // promptly rather than batch with low-priority messages.
            Urgency: "high",
          },
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

function stringifyDataValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

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
