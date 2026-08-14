// ══════════════════════════════════════════════════════════════════
//  useConfirm — promise-based confirmations on the shared ConfirmModal.
// ══════════════════════════════════════════════════════════════════
//
// Drop-in, themed replacement for the blocking `window.confirm()`:
//
//   const { confirm, confirmModal } = useConfirm();
//   ...
//   if (await confirm({ title, message, confirmLabel, destructive })) { ... }
//   // or shorthand:  if (await confirm("Remove this?")) { ... }
//   ...
//   // render ONCE, anywhere in the component's tree:
//   <ConfirmModal modal={confirmModal} />
//
// `confirm` returns a Promise<boolean> that resolves true on confirm and
// false on cancel / backdrop / ESC. The dialog is non-blocking (unlike
// window.confirm) so the rest of the app keeps painting behind it, and it
// picks up the live theme — one confirmation look for the whole app.
import { useCallback, useRef, useState } from "react";

export function useConfirm() {
  const [opts, setOpts] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((options) => {
    const o = typeof options === "string" ? { message: options } : (options || {});
    return new Promise((resolve) => {
      // A confirm raised while another is already open would otherwise strand
      // the first promise unresolved forever, and any `await confirm(...)`
      // sitting behind it never returns — the caller's code after the await
      // simply never runs, with nothing on screen to suggest why. Settle the
      // outgoing one as a cancel before taking its place. (Came back from WBC,
      // which hit it first.)
      if (resolver.current) resolver.current(false);
      resolver.current = resolve;
      setOpts(o);
    });
  }, []);

  const settle = useCallback((result) => {
    setOpts(null);
    const r = resolver.current;
    resolver.current = null;
    if (r) r(result);
  }, []);

  // Shaped for <ConfirmModal modal={…}/> — null when idle so it renders
  // nothing. A title always exists so ConfirmModal never no-ops on us.
  const confirmModal = opts && {
    title: opts.title || "Are you sure?",
    message: opts.message,
    confirmLabel: opts.confirmLabel,
    cancelLabel: opts.cancelLabel,
    destructive: opts.destructive,
    eyebrow: opts.eyebrow,
    alert: opts.alert,
    onConfirm: () => settle(true),
    onCancel: () => settle(false),
  };

  return { confirm, confirmModal };
}
