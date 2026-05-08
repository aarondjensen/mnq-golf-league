import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, setDoc, getDocs, query, where, writeBatch, onSnapshot, deleteDoc } from "firebase/firestore";
import { getAuth, signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, fetchSignInMethodsForEmail, onAuthStateChanged, signOut, updateProfile, sendPasswordResetEmail } from "firebase/auth";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDW3tTWxOlrPoKiflmlh_6JPLe8vbvVEUE",
  authDomain: "mnq-golf-leage.firebaseapp.com",
  projectId: "mnq-golf-leage",
  storageBucket: "mnq-golf-leage.firebasestorage.app",
  messagingSenderId: "367374056990",
  appId: "1:367374056990:web:70133948f9b2760558780f",
};

export const LEAGUE_ID = "league_2026";

const _app = initializeApp(FIREBASE_CONFIG);
const _db = getFirestore(_app);
export const _auth = getAuth(_app);
export const _googleProvider = new GoogleAuthProvider();

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

export { onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, fetchSignInMethodsForEmail, signOut, updateProfile, sendPasswordResetEmail };
