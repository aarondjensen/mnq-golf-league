// ══════════════════════════════════════════════════════════════════
//  playerNames — how a golfer is written on screen
// ══════════════════════════════════════════════════════════════════
//
// Display formatting only, and the app shows first initial plus last name
// nearly everywhere, so this runs on almost every screen.
//
// Split out of league.test.js when lib/league.js became seven modules. Tests
// live next to the code they cover here, and a single 626-line file covering
// five of them was not that.

import { describe, it, expect } from "vitest";
import { initialLastName } from "./playerNames";

describe("initialLastName", () => {
  it("abbreviates the first name and keeps the last", () => {
    expect(initialLastName("Aaron Jensen")).toBe("A. Jensen");
  });

  it("uses the LAST word as the surname, not the second", () => {
    // Middle names and two-word surnames both land here; taking parts[1]
    // would render "Juan de la Cruz" as "J. de".
    expect(initialLastName("Robert James Vigo")).toBe("R. Vigo");
    expect(initialLastName("Juan de la Cruz")).toBe("J. Cruz");
  });

  it("leaves a single-word name alone", () => {
    // "C. Cher" would be worse than useless.
    expect(initialLastName("Cher")).toBe("Cher");
  });

  it("tolerates messy spacing", () => {
    expect(initialLastName("  Aaron   Jensen  ")).toBe("A. Jensen");
  });

  it("returns empty string for nothing", () => {
    expect(initialLastName("")).toBe("");
    expect(initialLastName(null)).toBe("");
    expect(initialLastName(undefined)).toBe("");
  });
});
