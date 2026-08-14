// ══════════════════════════════════════════════════════════════════
//  useStableCallback — the ref-mirror pattern, named.
// ══════════════════════════════════════════════════════════════════
//
// Returns a stable callable whose identity NEVER changes across
// renders, but which always invokes the LATEST version of the function
// you pass in. The classic React workaround for "I need useCallback's
// stable identity but I also need closure-fresh state" without listing
// every captured variable as a dependency.
//
// When to reach for it
// ────────────────────
// Use this whenever a callback needs to:
//   1) be passed to a useEffect / useCallback dependency array without
//      retriggering on every render, AND
//   2) reference up-to-date state/props when finally invoked.
//
// Replaces the hand-rolled `xxxRef.current = xxx; useEffect(...)` pair.
// Before:
//   const recalcRef = useRef(null);
//   useEffect(() => { recalcRef.current = recalc; }, [recalc]);
//   // ... if (recalcRef.current) await recalcRef.current();
// After:
//   const stableRecalc = useStableCallback(recalc);
//   // ... await stableRecalc();
//
// What it does NOT do
// ───────────────────
// Does not memoize the function's RESULT — only stabilizes its
// reference. For result memoization use useMemo. Does not give a fresh
// value DURING the same render it's defined in (the ref updates in a
// layout effect, after commit) — but event handlers and effects both
// run after commit, so this never bites in practice.
//
// Why a layout effect, not a regular effect?
// ──────────────────────────────────────────
// React's commit phase runs BEFORE regular effects fire. A layout
// effect fires synchronously within commit, so by the time any handler
// outside React's scheduler runs, the ref is already current.

import { useRef, useCallback, useLayoutEffect } from "react";

export function useStableCallback(fn) {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  }, [fn]);
  // Stable identity for the component's lifetime; forwards to the latest
  // fn at call time. Wrapped in useCallback for explicit intent even
  // though useRef alone would suffice for stability.
  return useCallback((...args) => ref.current(...args), []);
}
