// ══════════════════════════════════════════════════════════════════
//  useDirtyForm — local-state form pattern with dirty tracking and
//                 explicit save.
// ══════════════════════════════════════════════════════════════════
//
// Why this exists
// ───────────────
// A handful of admin-side flows need to: capture user edits in local
// state, expose a "dirty" indicator (something has changed since the
// last load/save), and commit on an explicit user action. Doing this
// inline tends to produce a recurring class of bugs:
//
//   1. Stale-closure auto-save. Some early code did "save on every
//      tap" by reading local state inside the tap handler. The handler
//      closure captures local state at render time, so two rapid taps
//      both save the OLD state, racing each other and losing the
//      intermediate edits. We saw this in Admin's customSeedWeeks UI
//      before it was migrated to "explicit Save button + dirty flag."
//
//   2. Forgetting the dirty flag. Without an "is dirty?" check, the
//      Save button is always live, which both confuses users (am I
//      saving anything?) and triggers unnecessary Firestore writes
//      that flush the realtime subscription and re-render everyone.
//
//   3. Forgetting the reset-on-save. After a successful save, local
//      state and the upstream server-derived value should reconcile.
//      Without a reset, the dirty flag stays true forever until the
//      component unmounts.
//
// What this provides
// ──────────────────
//   const { value, setValue, isDirty, save, reset } = useDirtyForm({
//     initialValue: configFromServer,
//     onSave: async (currentValue) => { await saveConfig(currentValue); },
//   });
//
//   • `value`     — local working copy of the form's data
//   • `setValue`  — update working copy; flips isDirty true
//   • `isDirty`   — true when value differs from initialValue (deep
//                   compared via JSON.stringify), false otherwise.
//                   Driven by content, not setValue calls — so bouncing
//                   value out and back to initialValue correctly clears
//                   dirty.
//   • `save`      — async; calls onSave(currentValue), then resets
//                   initialValue snapshot to currentValue so isDirty
//                   becomes false. Returns the onSave result.
//   • `reset`     — drop local edits, snap value back to initialValue.
//
// initialValue tracking
// ─────────────────────
// The server-side value is the caller's prop or upstream state. It can
// change while the form is open (e.g., another commissioner saves a
// concurrent edit). The hook syncs to incoming initialValue when the
// form is NOT dirty. When the form IS dirty, incoming changes are
// ignored — letting the user finish their edits without losing them
// to a real-time update. Save then reconciles by snapping initialValue
// to the saved value.
//
// Stable-stringify
// ────────────────
// Uses the same key-sorted JSON.stringify pattern as App.jsx's
// saveLeagueConfig dirty check, so insertion-order changes in nested
// objects don't false-positive as "dirty." Non-trivial perf cost for
// huge objects, but for typical form data (config blobs, seed weeks)
// it's negligible.

import { useState, useEffect, useRef, useCallback } from "react";

function stableStringify(obj) {
  return JSON.stringify(obj, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted = {};
      Object.keys(v).sort().forEach(k => { sorted[k] = v[k]; });
      return sorted;
    }
    return v;
  });
}

export function useDirtyForm({ initialValue, onSave }) {
  const [value, setValueRaw] = useState(initialValue);
  // Snapshot of the "clean" value — what's currently committed on the
  // server side. Updated when:
  //   1. initialValue changes upstream AND we're not dirty (sync).
  //   2. save() succeeds (reconcile).
  // A ref instead of state because nothing in the render tree directly
  // depends on this value — only the dirty check reads it.
  const cleanRef = useRef(initialValue);

  // initialValueRef tracks the most recent initialValue prop, used by
  // the sync effect below to know when to overwrite local state.
  const initialValueRef = useRef(initialValue);

  // Sync incoming initialValue → local state ONLY when not dirty.
  // If dirty, the user is mid-edit; preserving their work matters more
  // than reflecting a concurrent server-side change. Save will reconcile.
  useEffect(() => {
    initialValueRef.current = initialValue;
    const isCurrentlyDirty = stableStringify(value) !== stableStringify(cleanRef.current);
    if (!isCurrentlyDirty) {
      cleanRef.current = initialValue;
      setValueRaw(initialValue);
    }
  }, [initialValue, value]);

  const setValue = useCallback((next) => {
    // Accept either a plain next value or an updater function (matches
    // useState's behavior). Updater receives the current value.
    setValueRaw(prev => typeof next === "function" ? next(prev) : next);
  }, []);

  const isDirty = stableStringify(value) !== stableStringify(cleanRef.current);

  const save = useCallback(async () => {
    // Snapshot the value at the moment of save — protects against the
    // user editing further while the save is in flight. The snapshot
    // becomes the new clean state after success.
    const snapshot = value;
    const result = await onSave(snapshot);
    // Reconcile — incoming initialValue update will catch up via the
    // sync effect, but we also update cleanRef immediately so isDirty
    // flips to false on the very next render.
    cleanRef.current = snapshot;
    return result;
  }, [value, onSave]);

  const reset = useCallback(() => {
    setValueRaw(cleanRef.current);
  }, []);

  return { value, setValue, isDirty, save, reset };
}
