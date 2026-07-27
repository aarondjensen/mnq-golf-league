// ══════════════════════════════════════════════════════════════════
//  Tests for lib/notifications.js — subscription state only
// ══════════════════════════════════════════════════════════════════
//
// Coverage focus
// ──────────────
// The push lifecycle itself (service worker, FCM tokens, Capacitor plugin)
// isn't unit-testable without a browser. What IS testable — and what caused
// a real user-visible bug — is how the subscription ANSWER is reported:
//
//   • A failed read must return null ("unknown"), never false. false means
//     "no tokens registered", which makes the App-level banner nag a user
//     who is in fact subscribed and merely offline for a moment.
//
//   • A successful read must write the device-local cache, so the next cold
//     start can gate the banner before the network round-trip finishes.
//     Without that seed, the banner flashed on every load: it rendered while
//     the read was in flight and vanished when the answer arrived.
//
// db.getStrict (not db.get) is what makes the first case possible — db.get
// swallows errors into [], which is indistinguishable from "no tokens".

import { describe, it, expect, beforeEach, vi } from "vitest";

// localStorage doesn't exist in the default `node` test environment, and the
// project has no jsdom dependency. A trivial Map-backed stand-in is enough:
// the cache only ever does getItem/setItem of "1"/"0".
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const getStrict = vi.fn();
vi.mock("../firebase", () => ({
  db: { getStrict: (...a) => getStrict(...a), get: vi.fn(), upsert: vi.fn(), deleteDoc: vi.fn() },
  LEAGUE_ID: "mnq",
  getMessagingInstance: vi.fn(async () => null),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
}));

const { checkSubscriptionStatus, getCachedSubscriptionStatus } =
  await import("./notifications");

beforeEach(() => {
  store.clear();
  getStrict.mockReset();
});

describe("checkSubscriptionStatus", () => {
  it("returns true and caches when the player has a token", async () => {
    getStrict.mockResolvedValue([{ id: "mnq_p7_abc" }]);
    expect(await checkSubscriptionStatus(7)).toBe(true);
    expect(getCachedSubscriptionStatus(7)).toBe(true);
  });

  it("returns false and caches when the player has no tokens", async () => {
    getStrict.mockResolvedValue([]);
    expect(await checkSubscriptionStatus(7)).toBe(false);
    expect(getCachedSubscriptionStatus(7)).toBe(false);
  });

  it("returns null on a failed read instead of false", async () => {
    getStrict.mockRejectedValue(new Error("offline"));
    expect(await checkSubscriptionStatus(7)).toBe(null);
  });

  it("leaves a cached true intact when a later read fails", async () => {
    getStrict.mockResolvedValue([{ id: "mnq_p7_abc" }]);
    await checkSubscriptionStatus(7);
    getStrict.mockRejectedValue(new Error("offline"));
    expect(await checkSubscriptionStatus(7)).toBe(null);
    expect(getCachedSubscriptionStatus(7)).toBe(true);
  });

  it("returns false without a read when there's no playerId", async () => {
    expect(await checkSubscriptionStatus(null)).toBe(false);
    expect(getStrict).not.toHaveBeenCalled();
  });
});

describe("getCachedSubscriptionStatus", () => {
  it("is null for a player never checked on this device", () => {
    expect(getCachedSubscriptionStatus(99)).toBe(null);
  });

  it("is null for a missing playerId", () => {
    expect(getCachedSubscriptionStatus(null)).toBe(null);
  });

  it("is keyed per player so impersonation doesn't inherit an answer", async () => {
    getStrict.mockResolvedValue([{ id: "mnq_p7_abc" }]);
    await checkSubscriptionStatus(7);
    expect(getCachedSubscriptionStatus(7)).toBe(true);
    expect(getCachedSubscriptionStatus(8)).toBe(null);
  });
});
