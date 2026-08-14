// ══════════════════════════════════════════════════════════════════
//  theme — the generated stylesheet
// ══════════════════════════════════════════════════════════════════
//
// getCSS builds the app's global stylesheet from the active palette. It moved
// back beside theme.js when the domain left; it had been living in a file named
// for the standings.
//
// Split out of league.test.js when lib/league.js became seven modules. Tests
// live next to the code they cover here, and a single 626-line file covering
// five of them was not that.

import { describe, it, expect } from "vitest";
import { getCSS } from "./theme";

describe("app typography selector", () => {
  const css = getCSS("light");

  it("applies to the popup root as well as the app shell", () => {
    const rule = css.split("\n").find(l => l.includes(".app-shell, .popup-root"));
    expect(rule).toBeTruthy();
    expect(rule).toContain("League Spartan");
    expect(rule).toContain("text-transform: uppercase");
    expect(rule).toContain("letter-spacing");
  });
});
