import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, setDoc, getDocs, query, where, writeBatch, onSnapshot, deleteDoc } from "firebase/firestore";
import { getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithCredential, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, fetchSignInMethodsForEmail, onAuthStateChanged, signOut, updateProfile, sendPasswordResetEmail } from "firebase/auth";
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

// ─── Callable Cloud Functions ───────────────────────────────────────────
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
