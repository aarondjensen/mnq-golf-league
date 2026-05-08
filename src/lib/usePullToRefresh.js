// ══════════════════════════════════════════════════════════════════
//  usePullToRefresh — iOS-style pull-down-to-refresh on document body.
// ══════════════════════════════════════════════════════════════════
//
// Why this is a hook
// ──────────────────
// App.jsx had ~135 lines of touch-event plumbing inline (state, refs,
// effect, watchdog) that had nothing to do with the league domain. Lifting
// it to a hook leaves App.jsx with a 4-line consumer call and centralizes
// the gesture logic so it can be tested and tweaked in one spot.
//
// What it does
// ────────────
//   • Listens to touchstart/move/end/cancel on `document`
//   • Detects "user is pulling down at the top of the scroll container"
//   • Scales the pull distance (40% drag rate, capped at 120px)
//   • At threshold (default 80px), triggers refresh:
//       - If a new app bundle is available (hasNewBundle returns true),
//         hard-reload the page so the user lands on the latest build
//       - Otherwise, call refetchOneTimeReads() to refresh the three
//         non-realtime collections (course, scoring rules, config)
//   • Hard safety timeout at 8s so a hung refresh can't lock the UI
//   • Soft safety watchdog at 2s catches the rare case where touchend
//     never fires and pullY gets stuck > 0
//
// Why it's not just `usePullToRefresh()` with no args
// ──────────────────────────────────────────────────
// Three pieces of behavior MUST live outside the hook:
//
//   1. `popupOpenRef` — when a modal/popup is open the gesture must
//      no-op so it doesn't fight with the modal's own scroll handling.
//      The caller owns popup state and gives us a ref so we can read
//      the latest value inside the touch handlers without re-installing
//      them on every popup toggle.
//
//   2. `hasNewBundle` + `refetchOneTimeReads` — the actual refresh work
//      is App-domain stuff (Firestore reads, version metadata fetch).
//      The hook only knows about gesture mechanics.
//
//   3. The visual spinner is rendered by the caller — App.jsx draws it
//      using the `pullY` and `refreshing` values returned here. Keeping
//      the visual in the caller lets App theme it (dark mode, palette)
//      without leaking theme tokens into this hook.
//
// Returns
// ───────
//   { pullY, refreshing, appBodyRef, resetPull }
//     • pullY        — current pull distance in px (0..120). Drives the
//                      spinner's translateY in App.jsx's render.
//     • refreshing   — true while the refresh callback is running. Used
//                      to disable other refresh triggers and to lock the
//                      spinner at the threshold position during the work.
//     • appBodyRef   — ref to attach to the main scrollable body div. The
//                      hook reads scrollTop from this element to decide
//                      "is the user at the top of the scroll?" — only
//                      then does a downward drag start the gesture.
//                      Falls back to `document.querySelector('.app-body')`
//                      if the ref isn't attached yet (initial mount).
//     • resetPull    — manual reset escape hatch. Currently only used by
//                      the internal watchdog, but exported in case the
//                      caller needs to abort a stuck pull (e.g. from a
//                      route change handler). Stable ref, safe to use in
//                      effect deps.
//
// Stable closure note
// ───────────────────
// The touch event handlers are installed once per [refreshing,
// hasNewBundle, refetchOneTimeReads] change. Inside, we read popupOpenRef
// via .current so popup-open changes don't force a re-install (which
// would briefly drop touch events while the listener swap happens, and
// can let a half-completed gesture get into an inconsistent state).
// This was the single most fiddly part of the original inline code; the
// ref-based approach is preserved exactly.

import { useState, useRef, useCallback, useEffect } from "react";

const PULL_THRESHOLD = 80;
const MAX_PULL = 120;
const DRAG_RATE = 0.4;
const HARD_SAFETY_MS = 8000;
const SOFT_WATCHDOG_MS = 2000;
const REFRESH_DELAY_MS = 600;

export function usePullToRefresh({ popupOpenRef, hasNewBundle, refetchOneTimeReads }) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const pullYRef = useRef(0);
  const pullingRef = useRef(false);
  const appBodyRef = useRef(null);

  // Manual reset — used by the watchdog below and exported for the
  // caller's edge cases.
  const resetPull = useCallback(() => {
    setPullY(0);
    pullYRef.current = 0;
    touchStartY.current = 0;
    pullingRef.current = false;
  }, []);

  // ── Touch handlers ──
  // Single useEffect installs all four (start/move/end/cancel) together
  // and cleans them up together. Re-installs only when refreshing flips
  // (to skip handler work entirely while a refresh is in progress) or
  // when the refresh callbacks change identity.
  useEffect(() => {
    if (refreshing) return;

    const getScrollEl = () => appBodyRef.current || document.querySelector('.app-body');
    let activeScrollEl = null;
    let insidePopup = false;
    let popupScrollEl = null;

    // Walk up the DOM from the touch target. Stops at the first element
    // marked `data-popup` (returns null → "we're inside a popup, defer
    // to popup scroll handling") or the first `.app-body` (returns it →
    // that's the scroll container we should watch). Default to the
    // app body if neither marker is found (touch on a top-level UI
    // chrome element, etc.).
    const findScrollEl = (target) => {
      let el = target;
      while (el) {
        if (el.hasAttribute && el.hasAttribute('data-popup')) return null;
        if (el.classList && el.classList.contains('app-body')) return el;
        el = el.parentElement;
      }
      return getScrollEl();
    };

    // Inside-popup case: find the scrollable region within the popup
    // (any element marked `data-popup-scroll`). We watch THAT element's
    // scrollTop so swipes inside a long popup body don't trigger app
    // refresh. Returns null if no such marker — in which case we treat
    // the popup as non-scrollable and ignore drags entirely.
    const findPopupScroll = (target) => {
      let el = target;
      while (el) {
        if (el.hasAttribute && el.hasAttribute('data-popup-scroll')) return el;
        if (el.hasAttribute && el.hasAttribute('data-popup')) return null;
        el = el.parentElement;
      }
      return null;
    };

    const handleStart = (e) => {
      // Popup-open snapshot: read via ref so handler doesn't need to
      // re-install on every popup toggle. The trade-off is that a
      // popup that opens MID-drag won't immediately stop the existing
      // drag — but the next handleMove call sees popupOpenRef.current
      // and aborts.
      if (popupOpenRef.current) {
        touchStartY.current = 0;
        return;
      }
      activeScrollEl = findScrollEl(e.target);
      insidePopup = activeScrollEl === null;
      popupScrollEl = insidePopup ? findPopupScroll(e.target) : null;
      touchStartY.current = e.touches[0].clientY;
      pullingRef.current = false;
    };

    const handleMove = (e) => {
      if (!touchStartY.current) return;
      // Popup opened during the drag → abort cleanly.
      if (popupOpenRef.current) {
        if (pullingRef.current) { pullingRef.current = false; pullYRef.current = 0; setPullY(0); }
        touchStartY.current = 0;
        return;
      }

      // "At top" check: scrollTop ≤ 1px (≤ instead of === to absorb
      // sub-pixel rounding on iOS).
      let atTop;
      if (insidePopup) {
        atTop = popupScrollEl ? popupScrollEl.scrollTop <= 1 : true;
      } else {
        atTop = activeScrollEl ? activeScrollEl.scrollTop <= 1 : true;
      }

      const currentY = e.touches[0].clientY;
      const diff = currentY - touchStartY.current;

      if (pullingRef.current) {
        // Already pulling — either continue (downward at top) or abort
        // (upward, or scrolled away from top mid-pull).
        if (diff <= 0 || !atTop) {
          pullingRef.current = false;
          pullYRef.current = 0;
          setPullY(0);
          touchStartY.current = currentY;
        } else {
          e.preventDefault();
          const val = Math.min(diff * DRAG_RATE, MAX_PULL);
          pullYRef.current = val;
          setPullY(val);
        }
      } else if (atTop && diff > 10) {
        // Threshold to start: downward drag of 10+ px while at top.
        // Reset touchStartY to current so the first frame of pull
        // doesn't include the 10px primer distance.
        touchStartY.current = currentY;
        pullingRef.current = true;
        e.preventDefault();
        pullYRef.current = 0;
        setPullY(0);
      } else if (!atTop) {
        // Scrolled inside content — keep updating touchStartY so a
        // later drag from a settled position can re-trigger pull.
        touchStartY.current = currentY;
      }
    };

    const handleEnd = () => {
      if (popupOpenRef.current) {
        pullingRef.current = false;
        pullYRef.current = 0;
        setPullY(0);
        touchStartY.current = 0;
        activeScrollEl = null;
        insidePopup = false;
        popupScrollEl = null;
        return;
      }
      pullingRef.current = false;
      activeScrollEl = null;
      insidePopup = false;
      popupScrollEl = null;

      if (pullYRef.current >= PULL_THRESHOLD) {
        // Lock the spinner at the threshold position while we work.
        setPullY(PULL_THRESHOLD);
        pullYRef.current = PULL_THRESHOLD;
        setRefreshing(true);

        // Hard safety: if the refresh promise hangs (rare but possible
        // with flaky network and a timeout-less fetch), force-reset
        // the UI after 8s so the user isn't stuck staring at a spinner.
        const hardSafety = setTimeout(() => {
          console.warn('[pull-to-refresh] hard safety timeout — forcing reset');
          setRefreshing(false);
          setPullY(0);
          pullYRef.current = 0;
          touchStartY.current = 0;
        }, HARD_SAFETY_MS);

        // Brief delay (600ms) before kicking off work — gives the spinner
        // a beat to settle visually so the refresh feels intentional, not
        // jittery. Was tuned by hand in the original code; keeping it.
        setTimeout(async () => {
          try {
            const needsUpdate = await hasNewBundle();
            if (needsUpdate) {
              clearTimeout(hardSafety);
              window.location.reload();
              return;
            }
            refetchOneTimeReads();
          } catch (e) {
            console.error('[pull-to-refresh] refresh failed:', e);
          } finally {
            clearTimeout(hardSafety);
            setRefreshing(false);
            setPullY(0);
            pullYRef.current = 0;
            touchStartY.current = 0;
          }
        }, REFRESH_DELAY_MS);
      } else {
        // Below threshold — just snap back to zero.
        setPullY(0);
        pullYRef.current = 0;
        touchStartY.current = 0;
      }
    };

    document.addEventListener('touchstart', handleStart, { passive: true });
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd, { passive: true });
    document.addEventListener('touchcancel', handleEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleStart);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleEnd);
    };
  }, [refreshing, refetchOneTimeReads, hasNewBundle, popupOpenRef]);

  // Soft safety watchdog: if pullY drifts above zero without a refresh
  // running, schedule a reset 2s out. Catches the edge case where
  // touchend fires before our handler installs (race during initial
  // mount) or where a touchcancel doesn't bubble (rare, observed once
  // on iOS Safari mid-recovery from a system gesture). 2s is long
  // enough that legitimate sub-threshold pulls don't get cut off.
  useEffect(() => {
    if (pullY > 0 && !refreshing) {
      const safety = setTimeout(resetPull, SOFT_WATCHDOG_MS);
      return () => clearTimeout(safety);
    }
  }, [pullY, refreshing, resetPull]);

  return { pullY, refreshing, appBodyRef, resetPull, PULL_THRESHOLD };
}
