// ══════════════════════════════════════════════════════════════════
//  Popup — the close affordance survives tall content
// ══════════════════════════════════════════════════════════════════
//
// The individual tournament leaderboard is the first popup in the app tall
// enough to overflow the viewport, and it exposed two latent faults that every
// shorter popup had been hiding:
//
//   1. The card itself was the scroller, and the ✕ was absolutely positioned
//      inside it — so scrolling the content scrolled the close button off the
//      top. On a full-height board there was no way to close it at all.
//   2. The overlay is position:fixed inside .app-body, which scrolls within a
//      fixed, overflow-hidden .app-shell. WebKit clips fixed descendants of a
//      clipping ancestor, so the overlay was cropped to the body region and
//      appeared tucked behind the header and bottom nav. Portalling to <body>
//      takes it out of that subtree.
//
// Both fixes are structural and invisible in a passing render, so they're
// pinned here rather than left to be rediscovered the next time someone puts
// tall content in a popup.
//
// Note these render under Node (no `document`), which is exactly the branch
// where Popup skips the portal and returns the overlay inline — so the markup
// below is the overlay itself.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Popup } from "./Popup.jsx";

const tall = Array.from({ length: 200 }, (_, i) => <div key={i}>row {i}</div>);

describe("Popup", () => {
  it("puts the scroll on an inner element, not the card holding the ✕", () => {
    const html = renderToStaticMarkup(
      <Popup onClose={() => {}} showClose>{tall}</Popup>
    );
    // The ✕ must be a sibling of the scrolling region, not inside it — that's
    // what keeps it on screen while the content moves underneath.
    const closeIdx = html.indexOf('aria-label="Close"');
    const scrollerIdx = html.indexOf("overflow-y:auto");
    expect(closeIdx).toBeGreaterThan(-1);
    expect(scrollerIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeLessThan(scrollerIdx);
  });

  it("caps the card to the overlay rather than the raw viewport", () => {
    // maxHeight:100% resolves against the overlay's content box, which already
    // has the safe-area insets subtracted. A raw 100vh would run under the
    // notch and the home indicator.
    const html = renderToStaticMarkup(<Popup onClose={() => {}}>{tall}</Popup>);
    expect(html).toContain("max-height:100%");
    expect(html).not.toContain("100vh");
  });

  it("reserves the iOS safe areas", () => {
    const html = renderToStaticMarkup(<Popup onClose={() => {}}>hi</Popup>);
    expect(html).toContain("safe-area-inset-top");
    expect(html).toContain("safe-area-inset-bottom");
  });

  it("still renders children and honours innerStyle", () => {
    const html = renderToStaticMarkup(
      <Popup onClose={() => {}} innerStyle={{ border: "1px solid red" }}>
        <span>content here</span>
      </Popup>
    );
    expect(html).toContain("content here");
    expect(html).toContain("1px solid red");
  });

  it("omits the ✕ unless showClose is set", () => {
    const html = renderToStaticMarkup(<Popup onClose={() => {}}>hi</Popup>);
    expect(html).not.toContain('aria-label="Close"');
  });
});
