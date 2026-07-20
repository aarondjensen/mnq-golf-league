import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, setDoc, getDocs, query, where, writeBatch, onSnapshot, deleteDoc } from "firebase/firestore";
import { getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithCredential, linkWithCredential, linkWithPopup, GoogleAuthProvider, OAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, fetchSignInMethodsForEmail, onAuthStateChanged, signOut, updateProfile, sendPasswordResetEmail, deleteUser, reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Capacitor } from "@capacitor/core";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDW3tTWxOlrPoKiflmlh_6JPLe8vbvVEUE",
  // authDomain points at our OWN app domain (not the default
  // mnq-golf-leage.firebaseapp.com) so the signInWithRedirect flow stays
  // first-party. Vercel reverse-proxies /__/auth/* and /__/firebase/* to
  // mnq-golf-leage.firebaseapp.com (see vercel.json), and the redirect URI
  // https://www.mnqgolf.com/__/auth/handler is authorized on the OAuth client.
  // This is what makes Google sign-in work inside the installed iOS PWA,
  // where iOS storage partitioning otherwise breaks the cross-origin
  // redirect round-trip. If the installed PWA actually serves from a
  // different host, this value MUST match it exactly. The apex mnqgolf.com
  // 307-redirects to www.mnqgolf.com (the canonical production host the PWA
  // installs from), so www is the correct authDomain here.
  authDomain: "www.mnqgolf.com",
  projectId: "mnq-golf-leage",
  storageBucket: "mnq-golf-leage.firebasestorage.app",
  messagingSenderId: "367374056990",
  appId: "1:367374056990:web:70133948f9b2760558780f",
};

export const LEAGUE_ID = "league_2026";

const _app = initializeApp(FIREBASE_CONFIG);
const _db = getFirestore(_app);
// ─── Auth persistence — explicit and durable ────────────────────────────
// Bare getAuth() resolves persistence through a SILENT fallback chain:
// [indexedDB → localStorage → sessionStorage → in-memory]. It picks the
// first available tier and never reports which one it landed on. The trap
// is the bottom two tiers: if IndexedDB is unavailable or unwritable
// (corrupted IDB, certain iOS content/lockdown settings, storage-pressure
// eviction, a flaky redirect-handler write), getAuth() quietly degrades to
// sessionStorage or in-memory — both wiped the instant the app is closed.
// The symptom is "I signed in, came back, and it made me log in again,"
// with NO error logged anywhere.
//
// initializeAuth lets us pin persistence to ONLY the durable tiers
// (IndexedDB preferred, localStorage fallback) so it can never silently
// drop to an ephemeral store. It's applied synchronously at construction,
// so — unlike setPersistence(), which returns a promise — there's no race
// against the onAuthStateChanged listener or getRedirectResult on cold
// start.
//
// CAVEAT: initializeAuth does NOT auto-register the popup/redirect resolver
// that getAuth wires up for you. Without browserPopupRedirectResolver, BOTH
// the popup (browser tabs) and redirect (installed iOS PWA) Google flows
// would break. We pass it explicitly.
//
// If construction throws (no IndexedDB AND no localStorage — effectively
// never, outside hard-locked private modes), fall back to plain getAuth so
// the app still loads rather than white-screening.
let _authInstance;
try {
  _authInstance = initializeAuth(_app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    // Resolver is WEB-ONLY. On web it powers the popup (browser tab) and
    // redirect (installed PWA) Google flows. On native we MUST omit it:
    // initializeAuth eagerly processes pending-redirect state THROUGH this
    // resolver during construction, which loads a cross-origin auth iframe
    // from authDomain (www.mnqgolf.com). In the iOS WKWebView (origin
    // capacitor://localhost — and iosScheme can't be changed to https, as
    // WKWebView reserves that scheme) the cross-origin postMessage handshake
    // never completes, so Auth's init promise hangs, onAuthStateChanged
    // never fires, and the app sits on LoadingScreen forever with no error.
    // Native Google sign-in arrives via @capacitor-firebase/authentication
    // in Phase 2, so the web resolver is never needed on native.
    ...(Capacitor.isNativePlatform()
      ? {}
      : { popupRedirectResolver: browserPopupRedirectResolver }),
  });
} catch (e) {
  console.error("initializeAuth failed; falling back to getAuth:", e?.message || e);
  _authInstance = getAuth(_app);
}
export const _auth = _authInstance;
export const _googleProvider = new GoogleAuthProvider();

// Apple uses the generic OAuthProvider with the 'apple.com' provider id —
// Firebase JS has no dedicated AppleAuthProvider class. Request name + email
// scopes so the first Apple sign-in/link can populate displayName/email when
// the user allows it. (With "Hide My Email" the email is a private relay
// address; with "Share My Email" it's the real one. Either way the provider
// id on providerData is 'apple.com'.) Used by the WEB link path
// (linkWithPopup); the NATIVE path mints the credential through the Capacitor
// plugin and builds an OAuthProvider('apple.com') credential inline below.
export const _appleProvider = new OAuthProvider("apple.com");
_appleProvider.addScope("email");
_appleProvider.addScope("name");

// Gate for showing the Apple "Link" action on NATIVE (iOS/Android) builds.
// Native Apple linking calls FirebaseAuthentication.signInWithApple(), which
// THROWS unless the app is fully Apple-enabled:
//   1. add "apple.com" to plugins.FirebaseAuthentication.providers in
//      capacitor.config.json
//   2. enable the "Sign in with Apple" capability on the iOS App target
//      (Xcode → Signing & Capabilities) + configure the Apple Service ID/key
//      in the Apple Developer portal and Firebase Console (Auth → Apple)
//   3. `npx cap sync ios` and rebuild + upload a new binary
// Until all three are done, leaving this FALSE keeps the Apple Link button
// from rendering on native — so a bundled/live-loaded build (including one in
// App Store review) can never surface a button that errors on tap. Web/PWA
// is unaffected: linkWithPopup works there today regardless of this flag.
// Flip to TRUE in the same change that ships the Apple-enabled native build.
export const NATIVE_APPLE_ENABLED = true;

// ─── Native Google sign-in (Capacitor) ──────────────────────────────────
// The web popup/redirect Google flow can't run inside a native WebView, so
// on iOS/Android we use @capacitor-firebase/authentication. It runs the
// platform-native Google sign-in (native Google SDK / system account
// picker) and returns an ID token. We exchange that for a Firebase
// credential and sign into the JS SDK with signInWithCredential — so the
// rest of the app (Firestore/Functions via the JS SDK) sees the user
// EXACTLY as it does on web. The onAuthStateChanged listener fires normally
// and routes the user in.
//
// skipNativeAuth:true (capacitor.config.json) means the plugin only mints
// the credential and does NOT keep its own native Firebase session — the JS
// SDK is the single source of truth for auth state, matching web. (This is
// also why signInWithCredential works without the popup/redirect resolver
// we deliberately omit on native — it's a direct credential exchange, not a
// popup/redirect operation.)
//
// Dynamic import keeps the plugin off the web bundle's critical path; on
// web this helper is never called (doGoogleSignIn branches on
// Capacitor.isNativePlatform()).
export const nativeGoogleSignIn = async () => {
  const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result?.credential?.idToken;
  if (!idToken) {
    throw new Error("Google sign-in did not return an ID token.");
  }
  const credential = GoogleAuthProvider.credential(idToken);
  return signInWithCredential(_auth, credential);
};

// ─── Native Sign in with Apple (Capacitor) ──────────────────────────────
// Apple parity for Google sign-in (App Store Guideline 4.8: an app offering a
// third-party login like Google must also offer Sign in with Apple). Mirrors
// nativeGoogleSignIn exactly, but with Apple's extra nonce requirement.
//
// The plugin runs the platform-native Sign in with Apple sheet and returns an
// ID token PLUS a nonce. We build an OAuthProvider('apple.com') credential
// from BOTH and sign into the JS SDK with signInWithCredential — so the rest
// of the app sees the user identically to web/Google (onAuthStateChanged
// fires, the league_members lookup by uid runs, the user is routed in).
//
// rawNonce MUST be result.credential.nonce: Apple embeds the SHA-256 of the
// raw nonce in the ID token and Firebase re-hashes rawNonce to verify it.
// Omitting rawNonce yields auth/invalid-credential. (Same contract as the
// linkAppleAccount native branch below.)
//
// Requires: "apple.com" in plugins.FirebaseAuthentication.providers
// (capacitor.config.json), the "Sign in with Apple" capability on the iOS App
// target, and Apple enabled in Firebase Auth. NATIVE_APPLE_ENABLED gates the
// button so this is never called until those ship together. Web Apple sign-in
// is not wired here (the app's web login offers Google + Email only); if that
// changes, add a signInWithPopup(_auth, _appleProvider) branch in the caller.
export const nativeAppleSignIn = async () => {
  const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
  const result = await FirebaseAuthentication.signInWithApple();
  const idToken = result?.credential?.idToken;
  if (!idToken) {
    throw new Error("Apple sign-in did not return an ID token.");
  }
  const provider = new OAuthProvider("apple.com");
  const credential = provider.credential({
    idToken,
    rawNonce: result.credential?.nonce,
  });
  return signInWithCredential(_auth, credential);
};

// Sign out of the native Google/Firebase plugin layer too. With
// skipNativeAuth:true the plugin holds no Firebase session, but the native
// Google SDK can cache the last-used account; clearing it ensures the next
// sign-in shows the account picker rather than silently re-using the
// previous account (so a shared device can switch users). No-op-safe: any
// failure is swallowed so it can never block the JS SDK signOut. Only call
// on native.
export const nativeAuthSignOut = async () => {
  try {
    const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
    await FirebaseAuthentication.signOut();
  } catch (e) {
    console.warn("native FirebaseAuthentication.signOut failed:", e?.message || e);
  }
};

// ─── Account linking (Google ⇆ Apple → one Firebase user) ────────────────
// PROBLEM: Google sign-in and Apple sign-in mint SEPARATE Firebase users
// (different uid) for the same human, because Apple's "Hide My Email" relay
// means the two identities never share an email Firebase could auto-match on.
// In MNQ a uid maps to a league_members doc (id `${LEAGUE_ID}_${uid}`) which
// carries the playerId → "team." So signing in with the OTHER provider lands
// on a different/absent member doc — i.e. the JoinScreen "claim gate" or the
// wrong player. The durable fix is EXPLICIT linking: while signed in as the
// keeper account, the user attaches their second provider so both credentials
// resolve to the SAME uid (and therefore the same member doc / playerId).
//
// We link in the JS SDK (linkWithCredential / linkWithPopup) on the
// auth.currentUser. On native we keep skipNativeAuth:true semantics intact —
// the Capacitor plugin only MINTS the provider credential (its own native
// Firebase session stays disabled); we never sign in natively. We exchange
// the plugin's token for a JS-SDK credential and link it, exactly mirroring
// the existing nativeGoogleSignIn credential-exchange shape.
//
// IMPORTANT (Apple on native): this requires the FirebaseAuthentication
// plugin to be configured for Apple. MNQ's capacitor.config.json currently
// lists providers:["google.com"] only, and the iOS project needs the "Sign in
// with Apple" capability. Until that's added + rebuilt, native Apple linking
// throws; web Apple linking (linkWithPopup) works as-is after a deploy. See
// the delivery notes accompanying this change.

// Map link/credential failures to readable, user-facing messages. Anything
// unrecognized falls through to the raw Firebase message so nothing is
// silently swallowed during debugging.
const mapLinkError = (e) => {
  const code = e?.code || "";
  const friendly = {
    // The currently signed-in user already has this provider attached.
    "auth/provider-already-linked": "That sign-in method is already linked to your account.",
    // The provider exists, but as a SEPARATE Firebase user. Can't link until
    // that duplicate is removed (or merged) — see console-cleanup steps.
    "auth/credential-already-in-use": "That account is already registered as a separate login. It has to be removed in Firebase before it can be linked — ask the commissioner to delete the duplicate user, then try again.",
    // The provider's email already belongs to another Firebase user.
    "auth/email-already-in-use": "That email is already tied to a different account. The duplicate has to be removed in Firebase before linking.",
    // Popup-flow cancellations (web). Treated as benign no-ops by callers,
    // but mapped here so the message reads cleanly if surfaced.
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/cancelled-popup-request": "Sign-in was cancelled.",
    "auth/popup-blocked": "The sign-in popup was blocked by the browser. Allow popups and try again.",
    "auth/user-cancelled": "Sign-in was cancelled.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
  }[code];
  const err = new Error(friendly || e?.message || "Could not link that sign-in method.");
  err.code = code;
  return err;
};

// Require a signed-in user before any link attempt. linkWith* operate on
// auth.currentUser; if it's null (race on cold start, or called from a signed-
// out state) the SDK error is opaque, so we guard explicitly.
const requireCurrentUser = () => {
  const user = _auth.currentUser;
  if (!user) {
    const err = new Error("You need to be signed in before linking another sign-in method.");
    err.code = "auth/no-current-user";
    throw err;
  }
  return user;
};

// Link Google to the currently signed-in user.
//   native: plugin mints the Google ID token → GoogleAuthProvider.credential
//           → linkWithCredential (mirrors nativeGoogleSignIn, but link not
//           signIn). Google is already a configured native provider, so this
//           works today.
//   web:    linkWithPopup with the shared _googleProvider.
export const linkGoogleAccount = async () => {
  const user = requireCurrentUser();
  try {
    if (Capacitor.isNativePlatform()) {
      const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
      const result = await FirebaseAuthentication.signInWithGoogle();
      const idToken = result?.credential?.idToken;
      if (!idToken) throw new Error("Google did not return an ID token.");
      const credential = GoogleAuthProvider.credential(idToken);
      return await linkWithCredential(user, credential);
    }
    return await linkWithPopup(user, _googleProvider);
  } catch (e) {
    throw mapLinkError(e);
  }
};

// Link Apple to the currently signed-in user.
//   native: plugin mints the Apple ID token + nonce → OAuthProvider
//           ('apple.com').credential({ idToken, rawNonce }) → linkWithCredential.
//           rawNonce MUST come from result.credential.nonce — Apple verifies
//           the SHA-256 of this raw value against the hashed nonce embedded in
//           the ID token; omitting it yields auth/invalid-credential.
//           Requires the plugin/iOS project to be Apple-enabled (see note above).
//   web:    linkWithPopup with the configured _appleProvider.
export const linkAppleAccount = async () => {
  const user = requireCurrentUser();
  try {
    if (Capacitor.isNativePlatform()) {
      const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
      const result = await FirebaseAuthentication.signInWithApple();
      const idToken = result?.credential?.idToken;
      if (!idToken) throw new Error("Apple did not return an ID token.");
      const provider = new OAuthProvider("apple.com");
      const credential = provider.credential({
        idToken,
        rawNonce: result.credential?.nonce,
      });
      return await linkWithCredential(user, credential);
    }
    return await linkWithPopup(user, _appleProvider);
  } catch (e) {
    throw mapLinkError(e);
  }
};

// Which providers are currently attached to the signed-in user. Reads
// providerData (the authoritative per-provider list on the user record) and
// checks the providerId strings. Returns {google, apple} booleans; both false
// if signed out. The settings UI calls this on open and after each successful
// link to refresh the "Linked / Link" state.
export const getLinkedProviders = () => {
  const user = _auth.currentUser;
  const ids = (user?.providerData || []).map((p) => p?.providerId);
  return {
    google: ids.includes("google.com"),
    apple: ids.includes("apple.com"),
  };
};

// ─── Account deletion (App Store Guideline 5.1.1(v)) ─────────────────────
// Apps that support account creation MUST offer in-app account deletion.
// This permanently removes the user: (1) their league_members doc, then
// (2) their Firebase Auth user. Order matters — delete the member doc first
// (still authenticated, so security rules pass) then the auth user.
//
// Firebase requires RECENT authentication to delete a user; if the last
// sign-in is stale, deleteUser throws auth/requires-recent-login. We catch
// that and re-authenticate in-place using the provider we can re-run
// silently on native (Google/Apple mint a fresh credential) or, for email
// users, the password they re-enter. Then we retry the delete once.
//
// reauthProvider tells us how to refresh:
//   'google.com' / 'apple.com' → re-run the native provider, build a
//        credential, reauthenticateWithCredential.
//   'password' → caller passes { email, password }; EmailAuthProvider
//        credential → reauthenticate.
// On web (non-native) Google/Apple reauth would need a popup; MNQ's delete
// entry point is the native app menu, so native reauth is the path exercised
// by review. Web callers get a clear error asking them to sign out/in first.
const reauthenticateCurrentUser = async (opts = {}) => {
  const user = _auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const providerId = (user.providerData?.[0]?.providerId) || "";

  if (providerId === "password") {
    const email = user.email || opts.email;
    if (!email || !opts.password) {
      const e = new Error("Please re-enter your password to confirm deletion.");
      e.code = "app/need-password";
      throw e;
    }
    const cred = EmailAuthProvider.credential(email, opts.password);
    return reauthenticateWithCredential(user, cred);
  }

  if (Capacitor.isNativePlatform() && (providerId === "google.com" || providerId === "apple.com")) {
    const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
    if (providerId === "google.com") {
      const result = await FirebaseAuthentication.signInWithGoogle();
      const idToken = result?.credential?.idToken;
      if (!idToken) throw new Error("Google did not return an ID token for re-authentication.");
      const cred = GoogleAuthProvider.credential(idToken);
      return reauthenticateWithCredential(user, cred);
    }
    // apple.com
    const result = await FirebaseAuthentication.signInWithApple();
    const idToken = result?.credential?.idToken;
    if (!idToken) throw new Error("Apple did not return an ID token for re-authentication.");
    const provider = new OAuthProvider("apple.com");
    const cred = provider.credential({ idToken, rawNonce: result.credential?.nonce });
    return reauthenticateWithCredential(user, cred);
  }

  // Fallback: can't silently reauth (e.g. web Google/Apple). Ask the user to
  // sign out and back in, then retry deletion.
  const e = new Error("For your security, please sign out and sign back in, then delete your account.");
  e.code = "app/reauth-required";
  throw e;
};

// Permanently delete the signed-in user's account + member doc.
//   memberDocId: `${LEAGUE_ID}_${uid}` (the league_members doc id).
//   opts.password: only needed for email/password users (re-auth).
// Returns true on success. Throws a readable Error otherwise.
export const deleteAccount = async (memberDocId, opts = {}) => {
  const user = _auth.currentUser;
  if (!user) throw new Error("Not signed in.");

  // 1. Remove the league membership doc while still authenticated.
  if (memberDocId) {
    try { await deleteDoc(doc(_db, "league_members", String(memberDocId))); }
    catch (e) { console.warn("deleteAccount: member doc delete failed:", e?.message || e); }
  }

  // 2. Delete the Firebase Auth user; reauth + retry once if required.
  try {
    await deleteUser(user);
  } catch (e) {
    if (e?.code === "auth/requires-recent-login") {
      await reauthenticateCurrentUser(opts);
      await deleteUser(_auth.currentUser);
    } else {
      throw e;
    }
  }

  // 3. Clear any native provider session so the next sign-in is clean.
  if (Capacitor.isNativePlatform()) {
    try {
      const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
      await FirebaseAuthentication.signOut();
    } catch { /* non-fatal */ }
  }
  return true;
};

// Default region (us-central1) — matches the v2 functions in functions/
// index.js, none of which pin a region. `callFunction` is a thin wrapper so
// callers get the unwrapped `.data` payload and a single place to evolve
// error handling. (The notifications lib wires its own callable for the
// test push; this is the general-purpose helper for everything else.)
const _functions = getFunctions(_app);
export const callFunction = async (name, payload = {}) => {
  const fn = httpsCallable(_functions, name);
  const res = await fn(payload);
  return res.data;
};

// ─── Firebase Cloud Messaging (lazy-loaded) ─────────────────────────────
// Messaging only exists in environments with a Service Worker + Push API
// + Notifications API. iOS Safari < 16.4 lacks Push API entirely; older
// browsers may lack one or more.
//
// CRITICAL: This module is imported by every page. A top-level import of
// firebase/messaging would force every page chunk to depend on the
// messaging SDK, and any failure (unsupported browser, network issue
// fetching the chunk) would cascade into "page won't render at all."
// Dynamic-importing inside the function limits the blast radius — pages
// load fine even when messaging is broken; only the explicit caller fails.
let _messaging = null;
let _messagingChecked = false;
export const getMessagingInstance = async () => {
  if (_messagingChecked) return _messaging;
  _messagingChecked = true;
  try {
    const { getMessaging, isSupported } = await import("firebase/messaging");
    const supported = await isSupported();
    if (!supported) return null;
    _messaging = getMessaging(_app);
    return _messaging;
  } catch (e) {
    // Some browsers throw rather than returning false from isSupported.
    // Treat any error as "not supported" — Phase 1 is best-effort.
    console.warn("Firebase Messaging unavailable:", e?.message || e);
    return null;
  }
};

// Firestore writeBatch hard limit is 500 ops per commit. We chunk to 500 so
// each batch is a single atomic transaction (not 500 parallel network calls).
const BATCH_LIMIT = 500;

export const db = {
  _q: (col, filters = []) => {
    const ref = collection(_db, col);
    return filters.length ? query(ref, ...filters.map(f => where(f.field, f.op, f.value))) : ref;
  },
  get: async (col, filters = []) => {
    try {
      const snap = await getDocs(db._q(col, filters));
      return snap.docs.map(d => d.data());
    } catch (e) { console.error("db.get error:", col, e); return []; }
  },
  // Like get(), but THROWS on failure instead of returning []. Use wherever
  // the caller must distinguish "collection is empty" from "read failed" —
  // e.g. before persisting a derived cache. db.get's swallow-and-return-[]
  // contract once let a transient network error write an empty historical-
  // rounds cache to localStorage, permanently zeroing handicap history on
  // that device.
  getStrict: async (col, filters = []) => {
    const snap = await getDocs(db._q(col, filters));
    return snap.docs.map(d => d.data());
  },
  upsert: async (col, data) => {
    if (!data.id) { console.error("db.upsert: missing id", col, data); return null; }
    try {
      await setDoc(doc(_db, col, String(data.id)), data, { merge: true });
      return data;
    } catch (e) { console.error("db.upsert error:", col, e); return null; }
  },
  set: async (col, data) => {
    if (!data.id) { console.error("db.set: missing id", col, data); return null; }
    try {
      await setDoc(doc(_db, col, String(data.id)), data);
      return data;
    } catch (e) { console.error("db.set error:", col, e); return null; }
  },
  // Atomic bulk upsert. Splits into 500-op batches; each batch commits as a
  // transaction (all-or-nothing within the chunk). Replaces the prior
  // Promise.all(batch.map(upsert)) pattern in importHistoricalScores, which
  // fired N parallel writes and could leave partial data on mid-batch failure.
  batchUpsert: async (col, items) => {
    if (!items || !items.length) return 0;
    const valid = items.filter(d => {
      if (!d.id) { console.error("db.batchUpsert: missing id", col, d); return false; }
      return true;
    });
    let written = 0;
    for (let i = 0; i < valid.length; i += BATCH_LIMIT) {
      const slice = valid.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(_db);
      slice.forEach(d => batch.set(doc(_db, col, String(d.id)), d, { merge: true }));
      try {
        await batch.commit();
        written += slice.length;
      } catch (e) {
        console.error("db.batchUpsert error:", col, e);
        throw e;
      }
    }
    return written;
  },
  deleteDoc: async (col, id) => {
    try { await deleteDoc(doc(_db, col, String(id))); return true; }
    catch (e) { console.error("db.deleteDoc error:", col, e); return null; }
  },
  // Atomic mixed-op batch: ops are { type: "set"|"delete", col, id, data?,
  // merge? }. Built for the destructive schedule rewrites (generate,
  // rain-out, undo rain-out), which previously deleted-then-recreated week
  // docs one sequential await at a time — a mid-run failure left the season
  // half-deleted with no rollback. Ops are deduped by (col, id) keeping the
  // LAST op, so a flow that logically deletes a doc and then recreates it
  // (week renumbering) commits only the final state and never enqueues two
  // writes to the same document. THROWS on failure — with ≤500 ops (every
  // current caller) the commit is all-or-nothing, so the caller can report
  // "nothing was changed" truthfully. Above 500 ops Firestore forces
  // chunking and atomicity is per-chunk, same as batchUpsert.
  batchWrite: async (ops) => {
    if (!ops || !ops.length) return 0;
    const byDoc = new Map();
    for (const op of ops) {
      if (!op || !op.col || op.id === undefined || op.id === null) {
        console.error("db.batchWrite: bad op", op);
        continue;
      }
      byDoc.set(`${op.col} ${op.id}`, op);
    }
    const finalOps = [...byDoc.values()];
    for (let i = 0; i < finalOps.length; i += BATCH_LIMIT) {
      const batch = writeBatch(_db);
      for (const op of finalOps.slice(i, i + BATCH_LIMIT)) {
        const ref = doc(_db, op.col, String(op.id));
        if (op.type === "delete") batch.delete(ref);
        else batch.set(ref, op.data, { merge: op.merge === true });
      }
      await batch.commit();
    }
    return finalOps.length;
  },
  batchDelete: async (col, filters = []) => {
    try {
      const snap = await getDocs(db._q(col, filters));
      if (snap.empty) return true;
      for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
        const batch = writeBatch(_db);
        snap.docs.slice(i, i + BATCH_LIMIT).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      return true;
    } catch (e) { console.error("db.batchDelete error:", col, e); return null; }
  },
  subscribe: (col, filters = [], callback) => {
    try {
      return onSnapshot(
        db._q(col, filters),
        snap => callback(snap.docs.map(d => d.data()), snap.docChanges()),
        err => console.error("db.subscribe error:", col, err)
      );
    } catch (e) { console.error("db.subscribe setup error:", col, e); return () => {}; }
  },
};

export const LF = [{ field: "league_id", op: "==", value: LEAGUE_ID }];

export { onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithEmailAndPassword, createUserWithEmailAndPassword, fetchSignInMethodsForEmail, signOut, updateProfile, sendPasswordResetEmail };
