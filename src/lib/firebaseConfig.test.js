// ══════════════════════════════════════════════════════════════════
//  Which project does this build write to?
// ══════════════════════════════════════════════════════════════════
//
// The failure this guards against is the one nobody can see: a scratch project
// id paired with the production API key initializes without complaint, looks
// exactly like a working override, and writes to production anyway. So the
// partial case has to THROW, and that is the case worth pinning hardest — the
// other two are visible the moment you look at the console.
import { describe, it, expect } from "vitest";
import { resolveFirebaseConfig, FIREBASE_ENV_KEYS } from "./firebaseConfig";

const PROD = {
  apiKey: "prod-key",
  authDomain: "prod.firebaseapp.com",
  projectId: "prod-project",
  storageBucket: "prod.appspot.com",
  messagingSenderId: "1",
  appId: "1:1:web:prod",
};

const fullOverride = {
  VITE_FIREBASE_API_KEY: "scratch-key",
  VITE_FIREBASE_AUTH_DOMAIN: "scratch.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "scratch-project",
  VITE_FIREBASE_STORAGE_BUCKET: "scratch.appspot.com",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "2",
  VITE_FIREBASE_APP_ID: "1:2:web:scratch",
};

describe("no override set", () => {
  it("uses production", () => {
    const r = resolveFirebaseConfig({}, PROD);
    expect(r.source).toBe("prod");
    expect(r.config).toBe(PROD);
  });

  it("warns on a dev server, naming the live project", () => {
    const r = resolveFirebaseConfig({ DEV: true }, PROD);
    expect(r.warn).toContain("prod-project");
    expect(r.warn).toContain("LIVE");
  });

  // The label is the only app-specific string in the module, which is what lets
  // the file itself stay identical across all three repos.
  it("says what the live project actually holds", () => {
    const r = resolveFirebaseConfig({ DEV: true }, PROD, "real tournament data");
    expect(r.warn).toContain("real tournament data");
  });

  // A deployed build IS production; saying so on every load is noise, and noise
  // is what makes the dev-server warning above easy to ignore.
  it("stays quiet in a deployed build", () => {
    expect(resolveFirebaseConfig({}, PROD).warn).toBeNull();
  });
});

describe("all six set", () => {
  it("uses the override, and none of production leaks through", () => {
    const r = resolveFirebaseConfig(fullOverride, PROD);
    expect(r.source).toBe("env");
    expect(r.config.projectId).toBe("scratch-project");
    expect(Object.values(r.config)).not.toContain("prod-key");
  });

  it("maps every field, not just the ones anybody checks", () => {
    const r = resolveFirebaseConfig(fullOverride, PROD);
    expect(Object.keys(r.config).sort()).toEqual(Object.keys(FIREBASE_ENV_KEYS).sort());
  });

  it("does not warn — the override is the point, not a problem", () => {
    expect(resolveFirebaseConfig(fullOverride, PROD).warn).toBeNull();
  });
});

describe("a partial override", () => {
  // The whole reason this module exists. Each of the six on its own, because a
  // guard that only checked the first field would pass five of these.
  for (const key of Object.values(FIREBASE_ENV_KEYS)) {
    it(`throws when only ${key} is missing`, () => {
      const partial = { ...fullOverride };
      delete partial[key];
      expect(() => resolveFirebaseConfig(partial, PROD)).toThrow(key);
    });

    it(`throws when only ${key} is set`, () => {
      expect(() => resolveFirebaseConfig({ [key]: "x" }, PROD)).toThrow(/Partial/);
    });
  }

  // An empty string is what a `.env.local` line left as `VITE_FIREBASE_API_KEY=`
  // actually produces, and it is the likeliest way to land here by accident.
  it("treats an empty value as unset rather than as an override", () => {
    expect(() => resolveFirebaseConfig({ ...fullOverride, VITE_FIREBASE_API_KEY: "" }, PROD))
      .toThrow("VITE_FIREBASE_API_KEY");
  });

  it("names every missing var, so one fix round is enough", () => {
    const err = (() => {
      try { resolveFirebaseConfig({ VITE_FIREBASE_API_KEY: "x" }, PROD); }
      catch (e) { return e.message; }
    })();
    expect(err).toContain("VITE_FIREBASE_PROJECT_ID");
    expect(err).toContain("VITE_FIREBASE_APP_ID");
  });
});

// A missing env bag entirely (import.meta.env undefined in some runtimes)
// must read as "no override" rather than crashing before the app can say why.
it("survives a missing env bag", () => {
  expect(resolveFirebaseConfig(undefined, PROD).source).toBe("prod");
});
