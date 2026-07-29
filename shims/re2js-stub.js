// ─── re2js build shim ────────────────────────────────────────────────────
// WHY THIS EXISTS
// @firebase/firestore has a hard top-level `import { RE2JS } from 're2js'`.
// re2js is a full JS port of Google's RE2 engine and weighs ~157 KB minified
// (~45 KB gzipped) — roughly 19% of MnQ's entire initial JS bundle, on the
// critical path of every cold start.
//
// It is reachable from exactly three call sites inside Firestore, all in the
// client-side evaluation of *Pipelines* expressions:
//   CoreLike / CoreRegexContains / CoreRegexMatch  → RE2JS.compile(pattern)
// Pipelines is a preview Firestore API. MnQ never touches it — src/firebase.js
// uses only collection / doc / query / where / getDocs / onSnapshot / setDoc /
// deleteDoc / writeBatch. So the 157 KB is pure dead weight at runtime.
//
// Vite aliases the bare specifier `re2js` to this module (see vite.config.js),
// which drops the real engine from the bundle.
//
// SAFETY
// This is not a silent no-op. If a future change (or a Firebase SDK upgrade
// that starts routing ordinary queries through the pipeline evaluator) ever
// reaches RE2JS.compile, it THROWS. Firestore wraps all three call sites in
// try/catch and degrades to its own "invalid pattern" error result plus a
// console warning — so the failure is loud and localized, never a wrong query
// result.
//
// TO REVERT: delete the `re2js` entry from resolve.alias in vite.config.js.
// The real package is still installed as a Firestore dependency.

export class RE2JS {
  static compile() {
    throw new Error(
      "re2js is stubbed out of this build (see shims/re2js-stub.js). " +
      "Firestore only needs it for Pipelines expression evaluation, which " +
      "MnQ does not use. If you now do, remove the alias in vite.config.js."
    );
  }

  static quote(s) {
    return String(s);
  }
}

export default { RE2JS };
