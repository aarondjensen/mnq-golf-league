// ══════════════════════════════════════════════════════════════════
//  resolveFirebaseConfig — which Firebase project this build talks to.
// ══════════════════════════════════════════════════════════════════
//
// There is one Firebase project behind this app and it holds the real
// league. Admin writes on edit, so a dev server aimed at production can
// corrupt a live week with one stray click. Copy .env.example
// to .env.local and fill in every VITE_FIREBASE_* var to aim that machine at a
// scratch project instead.
//
// ── Why the override is all-or-nothing ──
// A PARTIAL set throws. That is the whole design, not a convenience check: the
// alternative is pairing a scratch project id with the production API key —
// which initializes without complaint, looks exactly like a working override,
// and writes to production anyway. A half-applied override is worse than no
// override, because it reports success. The one failure this module exists to
// prevent is the one you cannot see.
//
// ── Why it is here and not in firebase.js ──
// It used to be inline there, which meant the only way to check any of this was
// to boot the app against a real project and see what happened. firebase.js
// imports the Firebase SDK at module scope, so a test of it is a test of the
// SDK. Pulled out, the decision is a pure function of an env bag and can be
// pinned properly — see firebaseConfig.test.js, which covers all three paths.
//
// Bourbon Cup, WBC and MnQ all carry this file. Keep them in step.

// The six fields Firebase needs, and the env var each is read from. All six
// together or none — see above.
export const FIREBASE_ENV_KEYS = {
  apiKey: "VITE_FIREBASE_API_KEY",
  authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
  projectId: "VITE_FIREBASE_PROJECT_ID",
  storageBucket: "VITE_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID",
  appId: "VITE_FIREBASE_APP_ID",
};

/**
 * Decide which Firebase config to initialize with.
 *
 * Pure: it reads the env bag it is handed and returns a verdict. The caller
 * does the logging, so a test can assert the verdict without capturing console
 * output — and so the "you are on the live project" warning can be worded per
 * app without this file knowing anything about tournaments or leagues.
 *
 * @param {object} env   import.meta.env, or any plain object in a test.
 * @param {object} prod  The production config, used when nothing is overridden.
 * @param {string} dataLabel  What the live project holds, for the dev warning —
 *   "real tournament data", "real league data". The only app-specific thing in
 *   this file, and it is a parameter so the file itself can stay identical
 *   across all three repos.
 * @returns {{config: object, source: "prod"|"env", warn: string|null}}
 * @throws  {Error} when SOME but not all of the six vars are set.
 */
export function resolveFirebaseConfig(env, prod, dataLabel = "real data") {
  const bag = env || {};
  const entries = Object.entries(FIREBASE_ENV_KEYS);
  const missing = entries.filter(([, key]) => !bag[key]).map(([, key]) => key);

  // Nothing set — production, which is the default and what deployed builds do.
  // Warn only on a dev server: in a deployed build this is simply the truth and
  // a console warning on every load is noise.
  if (missing.length === entries.length) {
    return {
      config: prod,
      source: "prod",
      warn: bag.DEV
        ? `[firebase] No VITE_FIREBASE_* override — this dev server is on the LIVE ` +
          `project "${prod.projectId}". Edits reach ${dataLabel}. See .env.example ` +
          `to point at a scratch project.`
        : null,
    };
  }

  // Some but not all. Refuse to start rather than write to production under a
  // dev project's name.
  if (missing.length) {
    throw new Error(
      `[firebase] Partial VITE_FIREBASE_* override — also set: ${missing.join(", ")}. ` +
      `Unset them all to use the production project. See .env.example.`
    );
  }

  return {
    config: Object.fromEntries(entries.map(([field, key]) => [field, bag[key]])),
    source: "env",
    warn: null,
  };
}
