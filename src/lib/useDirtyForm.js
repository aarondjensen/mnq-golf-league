// ══════════════════════════════════════════════════════════════════
//  useDirtyForm — local-state form with dirty tracking + explicit save.
// ══════════════════════════════════════════════════════════════════
//
// Captures user edits in local state, exposes an `isDirty` indicator,
// and commits on an explicit user action. Fixes the recurring class of
// bugs that inline "save on every tap" code tends to produce:
//
//   1. Stale-closure auto-save — two rapid taps both read the OLD state
//      and race, losing the intermediate edit. Admin's customSeedWeeks UI
//      had exactly this before it moved to an explicit Save button.
//   2. Always-live Save button — confuses users and triggers needless
//      writes that flush realtime subscriptions and re-render everyone.
//   3. Forgotten reset-on-save — the dirty flag stays true forever.
//
// Usage
// ─────
//   const { value, setValue, isDirty, save, reset } = useDirtyForm({
//     initialValue: configFromServer,
//     onSave: async (current) => { await saveConfig(current); },
//   });
//
//   • value     — local working copy
//   • setValue  — update working copy (accepts a value or an updater fn,
//                 matching useState); flips isDirty when content differs
//   • isDirty   — true when value differs from the clean snapshot, deep-
//                 compared via key-sorted JSON so insertion-order changes
//                 in nested objects don't false-positive
//   • save      — async; calls onSave(value), then reconciles the clean
//                 snapshot so isDirty flips false on the next render
//   • reset     — discard edits, snap value back to the clean snapshot
//
// Incoming initialValue changes sync into local state ONLY when not
// dirty — if the user is mid-edit, their work is preserved and save()
// reconciles. That matters here because a config document re-emits on
// every unrelated change to the same singleton, and a naive sync would
// wipe whatever the commissioner was halfway through typing.
//
// ── Why the clean snapshot is state and not a ref ───────────────────
// It was a ref, on the reasoning that nothing in the render tree depended
// on it. That reasoning was wrong twice over, and WBC — which adopted this
// hook and put it in front of a real form — hit both:
//
//   1. `isDirty` IS derived from it and IS rendered. Writing the ref in
//      save() therefore changed the answer without scheduling a render, so
//      a saved form kept showing its Save button lit until something else
//      happened to re-render it.
//   2. Reading a ref during render is a side effect. React Compiler
//      responds by giving up on memoizing the whole component.
//
// Making it state fixes both: save() now schedules the re-render that
// clears the flag. The sync is likewise done DURING RENDER rather than in
// an effect — React re-runs the component immediately without committing
// the first pass, so the inputs never paint a frame of stale text, and no
// synchronous setState-inside-an-effect cascade is created. The old effect
// also listed `value` as a dependency, so it re-ran on every keystroke to
// decide it had nothing to do.
//
// Bourbon Cup and WBC both carry this version; MnQ was the last copy on
// the old shape.

import { useState, useCallback } from "react";

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
  // The committed ("clean") snapshot. See the header for why this is state.
  const [clean, setClean] = useState(initialValue);

  const cleanKey = stableStringify(clean);
  const isDirty = stableStringify(value) !== cleanKey;

  // Sync incoming initialValue → local state ONLY when not dirty, so a user
  // mid-edit keeps their work and save() reconciles.
  //
  // Compared on the STRINGIFIED values rather than on identity, so a caller
  // that builds initialValue inline — a new object every render — syncs once
  // and then stops, instead of looping forever.
  const initKey = stableStringify(initialValue);
  if (!isDirty && cleanKey !== initKey) {
    setClean(initialValue);
    setValueRaw(initialValue);
  }

  const setValue = useCallback((next) => {
    setValueRaw(prev => typeof next === "function" ? next(prev) : next);
  }, []);

  const save = useCallback(async () => {
    // Snapshot the value at save time — protects against further edits
    // while the save is in flight. The snapshot becomes the new clean state.
    const snapshot = value;
    const result = await onSave(snapshot);
    setClean(snapshot);
    return result;
  }, [value, onSave]);

  const reset = useCallback(() => { setValueRaw(clean); }, [clean]);

  return { value, setValue, isDirty, save, reset };
}
