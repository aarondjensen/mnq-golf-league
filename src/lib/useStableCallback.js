// ══════════════════════════════════════════════════════════════════
//  useStableCallback — the ref-mirror pattern, named.
// ══════════════════════════════════════════════════════════════════
//
// What it does
// ────────────
// Returns a stable callable whose identity NEVER changes across
// renders, but which always invokes the LATEST version of the
// function you pass in. The classic React workaround for "I need
// useCallback's stable identity but I also need closure-fresh state"
// without listing every captured variable as a dep.
//
// When to reach for it
// ────────────────────
// Use this whenever a callback needs to:
//   1) Be passed to a useEffect / useCallback's dependency array
//      without retriggering on every render, AND
//   2) Reference up-to-date state/props when finally invoked.
//
// Example use cases in this codebase (any place that previously
// used a hand-rolled `xxxRef.current = xxx; useEffect(...)` pair):
//   • App.jsx's `autoSeedIfReady` / `autoSeedStateRef`
//   • App.jsx's `clearWeekData` → `recalcHandicapsRef`
//
// What it does NOT do
// ───────────────────
// Does not memoize the function's RESULT — only stabilizes its
// reference. For result memoization use useMemo.
//
// Does not work inside the same render cycle that the wrapped
// callback was defined in for non-event flows (e.g. inline JSX usage
// that fires synchronously during render) — the ref is updated in a
// layout effect, after render commits. In practice this never bites
// because event handlers and effects both run after commit. If you
// need a value DURING render, use useMemo or a derived value, not a
// callback.
//
// Why a layout effect, not a regular effect?
// ──────────────────────────────────────────
// React's commit phase happens BEFORE effects fire. If we used a
// regular useEffect, an event that fires between commit and effect
// (rare but possible — e.g. a synchronous browser event handler that
// runs right after a setState flush) would see a stale ref. Layout
// effects fire synchronously within the commit phase, so by the time
// any handler outside React's scheduler runs, the ref is current.
//
// Caveats
// ───────
// • The returned function is the SAME reference forever. Don't
//   conditional-render based on it being "a new function" — it never
//   is.
// • Server-side rendering: useLayoutEffect warns on SSR. This app
//   doesn't SSR, but if that changes, swap to useIsomorphicLayoutEffect
//   (one-line definition switching between useEffect and useLayoutEffect
//   based on `typeof window`).

import { useRef, useCallback, useLayoutEffect } from "react";

/**
 * @template {(...args: unknown[]) => unknown} T
 * @param {T} fn
 * @returns {T}
 */
export function useStableCallback(fn) {
  const ref = useRef(fn);
  // Layout effect — fires synchronously at commit time, BEFORE any
  // user-initiated event handlers can run with the next state. This
  // is the property that distinguishes useStableCallback from a
  // naive useRef + useEffect: the ref is always at-least-as-fresh as
  // the rendered output.
  useLayoutEffect(() => {
    ref.current = fn;
  }, [fn]);
  // The returned function captures `ref` (stable across renders) and
  // forwards to ref.current at call time. Its identity is fixed for
  // the component's lifetime — safe to pass to deps arrays without
  // causing retriggers. Wrapped in useCallback for explicit intent
  // even though useRef alone would give us stability; the explicit
  // marker reads better at call sites and tells future readers "this
  // is a stable identity by design."
  return useCallback((...args) => ref.current(...args), []);
}

// ══════════════════════════════════════════════════════════════════
//  Notes on the ad-hoc pattern this replaces
// ══════════════════════════════════════════════════════════════════
//
// App.jsx had two instances of the hand-rolled pattern at the time
// of this audit:
//
//   const recalcHandicapsRef = useRef(null);
//   useEffect(() => { recalcHandicapsRef.current = recalcHandicaps; },
//             [recalcHandicaps]);
//   // ... and then call recalcHandicapsRef.current(...) elsewhere.
//
// And:
//
//   const autoSeedStateRef = useRef(null);
//   useEffect(() => {
//     autoSeedStateRef.current = { schedule, matchResults, ... };
//   }, [schedule, matchResults, ...]);
//   // ... then read autoSeedStateRef.current.schedule inside the
//   // useCallback'd handler.
//
// The second pattern (mirroring a STATE OBJECT, not a function) is
// not what this hook handles. For that case the right primitive is
// useRef + useLayoutEffect directly, or — better — refactor so the
// callback that needs fresh state IS the thing being made stable,
// and pull the state in via closures inside it. See the audit's
// section 2.5 note on autoSeedStateRef for the longer discussion.
//
// MIGRATION SKETCH for recalcHandicapsRef in App.jsx
// ──────────────────────────────────────────────────
//   Before:
//     const recalcHandicapsRef = useRef(null);
//     useEffect(() => { recalcHandicapsRef.current = recalcHandicaps;
//                       }, [recalcHandicaps]);
//     // ... and `if (recalcHandicapsRef.current) await
//     //          recalcHandicapsRef.current()` inside clearWeekData.
//
//   After:
//     const stableRecalcHandicaps = useStableCallback(recalcHandicaps);
//     // ... `await stableRecalcHandicaps()` inside clearWeekData.
//
// The migration is one-for-one and behavior-preserving. Not urgent —
// the existing code is correct — but worth doing the next time
// either ref is touched, to reduce surface area for "did I remember
// to update the ref?" bugs.
