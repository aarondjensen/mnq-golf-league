/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  useDirtyForm — the three things it promises
// ══════════════════════════════════════════════════════════════════
//
// Two admin forms run on this hook now (AdminConfig and AdminScoring), and both
// derive their `dirty` flag from it rather than tracking one alongside. That
// makes the hook's own behaviour the thing standing between a commissioner and
// a Save button that lies, so it is worth pinning properly rather than by
// inspection.
//
// The three promises, and what breaking each one looks like on screen:
//
//   1. A saved form stops being dirty. This is the bug MnQ shipped: the clean
//      snapshot lived in a REF, so writing it in save() changed the answer
//      without scheduling a render, and the Save button stayed lit on a form
//      that had already saved.
//   2. An incoming document syncs in ONLY when the user is not mid-edit.
//      Getting this wrong wipes what somebody is halfway through typing, which
//      is the whole reason the guard exists.
//   3. Key order is not a change. A Firestore snapshot can hand back the same
//      document with its keys reordered; treating that as an edit would mark a
//      clean form dirty and stop it re-seeding from then on.
//
// jsdom + testing-library rather than renderToStaticMarkup, because every one
// of these is about what happens ACROSS renders — a static string cannot see it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { createElement as h } from "react";
import { useDirtyForm } from "./useDirtyForm";

afterEach(cleanup);

// A probe that exposes the hook's returns to the test without a real form in
// the way. `latest` is written on every render, so assertions read the value
// the component would have rendered with.
function mount(initialValue, onSave = vi.fn()) {
  const latest = {};
  function Probe({ value }) {
    Object.assign(latest, useDirtyForm({ initialValue: value, onSave }));
    return null;
  }
  const utils = render(h(Probe, { value: initialValue }));
  return { latest, onSave, rerender: (v) => utils.rerender(h(Probe, { value: v })) };
}

describe("dirty tracking", () => {
  it("starts clean", () => {
    const { latest } = mount({ name: "MnQ" });
    expect(latest.isDirty).toBe(false);
    expect(latest.value).toEqual({ name: "MnQ" });
  });

  it("goes dirty on an edit", () => {
    const { latest } = mount({ name: "MnQ" });
    act(() => latest.setValue({ name: "MnQ Golf" }));
    expect(latest.isDirty).toBe(true);
  });

  // Driven by CONTENT, not by whether setValue was called — so typing a
  // character and deleting it again leaves the Save button dark, which is what
  // somebody who changed their mind expects.
  it("goes clean again when the edit is undone", () => {
    const { latest } = mount({ name: "MnQ" });
    act(() => latest.setValue({ name: "MnQ Golf" }));
    act(() => latest.setValue({ name: "MnQ" }));
    expect(latest.isDirty).toBe(false);
  });

  it("takes an updater function, like useState", () => {
    const { latest } = mount({ n: 1 });
    act(() => latest.setValue(prev => ({ n: prev.n + 1 })));
    expect(latest.value).toEqual({ n: 2 });
  });

  it("ignores key order", () => {
    const { latest } = mount({ a: 1, b: 2 });
    act(() => latest.setValue({ b: 2, a: 1 }));
    expect(latest.isDirty).toBe(false);
  });

  it("ignores key order in nested objects too", () => {
    const { latest } = mount({ o: { x: 1, y: 2 } });
    act(() => latest.setValue({ o: { y: 2, x: 1 } }));
    expect(latest.isDirty).toBe(false);
  });
});

describe("save", () => {
  it("hands onSave the current value", async () => {
    const onSave = vi.fn();
    const { latest } = mount({ name: "MnQ" }, onSave);
    act(() => latest.setValue({ name: "MnQ Golf" }));
    await act(() => latest.save());
    expect(onSave).toHaveBeenCalledWith({ name: "MnQ Golf" });
  });

  // The regression this file exists for. With the snapshot in a ref, save()
  // changed the answer without scheduling a render and the button stayed lit.
  it("leaves the form CLEAN afterwards", async () => {
    const { latest } = mount({ name: "MnQ" });
    act(() => latest.setValue({ name: "MnQ Golf" }));
    expect(latest.isDirty).toBe(true);
    await act(() => latest.save());
    expect(latest.isDirty).toBe(false);
  });

  it("returns whatever onSave returned", async () => {
    const { latest } = mount({ n: 1 }, vi.fn().mockResolvedValue("written"));
    let result;
    await act(async () => { result = await latest.save(); });
    expect(result).toBe("written");
  });

  // The snapshot is taken when save STARTS. A keystroke that lands while the
  // write is in flight has to survive it, and leave the form dirty.
  it("keeps an edit made while the save is in flight", async () => {
    let release;
    const onSave = vi.fn(() => new Promise(r => { release = r; }));
    const { latest } = mount({ n: 1 }, onSave);
    act(() => latest.setValue({ n: 2 }));
    let pending;
    act(() => { pending = latest.save(); });
    act(() => latest.setValue({ n: 3 }));
    await act(async () => { release(); await pending; });
    expect(onSave).toHaveBeenCalledWith({ n: 2 });
    expect(latest.value).toEqual({ n: 3 });
    expect(latest.isDirty).toBe(true);
  });
});

describe("syncing from upstream", () => {
  it("takes an incoming document while the form is clean", () => {
    const { latest, rerender } = mount({ name: "MnQ" });
    rerender({ name: "Renamed Elsewhere" });
    expect(latest.value).toEqual({ name: "Renamed Elsewhere" });
    expect(latest.isDirty).toBe(false);
  });

  // The guard that matters. Another commissioner saving in a second tab must
  // not wipe what this one is halfway through typing.
  it("refuses to overwrite a form somebody is mid-edit on", () => {
    const { latest, rerender } = mount({ name: "MnQ" });
    act(() => latest.setValue({ name: "half-typed" }));
    rerender({ name: "Renamed Elsewhere" });
    expect(latest.value).toEqual({ name: "half-typed" });
    expect(latest.isDirty).toBe(true);
  });

  // The regression that prompted the sync guard to be rewritten. save() sets the
  // clean snapshot to what was written, but the PROP is still the old document
  // until Firestore's snapshot comes back. A guard that fired on "clean differs
  // from incoming" rather than "incoming changed" syncs the form backwards here
  // — the field visibly reverts to the value you just replaced.
  it("does not revert to the stale prop after a save", async () => {
    const { latest } = mount({ name: "MnQ" });
    act(() => latest.setValue({ name: "MnQ Golf" }));
    await act(() => latest.save());
    expect(latest.value).toEqual({ name: "MnQ Golf" });
    expect(latest.isDirty).toBe(false);
  });

  // ...and it still takes the document when it does arrive.
  it("takes the saved document when Firestore catches up", async () => {
    const { latest, rerender } = mount({ name: "MnQ" });
    act(() => latest.setValue({ name: "MnQ Golf" }));
    await act(() => latest.save());
    rerender({ name: "MnQ Golf" });
    expect(latest.value).toEqual({ name: "MnQ Golf" });
    expect(latest.isDirty).toBe(false);
  });

  // A caller that builds initialValue inline hands over a NEW object every
  // render. Compared by identity that syncs forever; compared by content it
  // syncs once and stops.
  it("does not loop on an inline initialValue", () => {
    const { latest, rerender } = mount({ name: "MnQ" });
    rerender({ name: "MnQ" });
    rerender({ name: "MnQ" });
    expect(latest.isDirty).toBe(false);
    expect(latest.value).toEqual({ name: "MnQ" });
  });
});

describe("reset", () => {
  it("throws the edits away", () => {
    const { latest } = mount({ name: "MnQ" });
    act(() => latest.setValue({ name: "half-typed" }));
    act(() => latest.reset());
    expect(latest.value).toEqual({ name: "MnQ" });
    expect(latest.isDirty).toBe(false);
  });

  // Back to what was last SAVED, not to what the form first mounted with.
  it("resets to the last save, not to the original", async () => {
    const { latest } = mount({ n: 1 });
    act(() => latest.setValue({ n: 2 }));
    await act(() => latest.save());
    act(() => latest.setValue({ n: 3 }));
    act(() => latest.reset());
    expect(latest.value).toEqual({ n: 2 });
  });
});
