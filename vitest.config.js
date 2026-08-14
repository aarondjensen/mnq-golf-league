// ══════════════════════════════════════════════════════════════════
//  vitest.config.js — minimal Vitest setup.
// ══════════════════════════════════════════════════════════════════
//
// Vitest reuses Vite's resolver/transform pipeline automatically; this
// file only specifies test-specific options. Kept small and well-commented
// so adding new categories of tests later is mechanical.
//
// Test discovery
// ──────────────
// Scoped to src/ deliberately. Tests live next to the code they cover
// (src/lib/matchCalc.js → src/lib/matchCalc.test.js) so finding the test from
// the source is one click in any editor.
//
// The default pattern also swept up firestore.rules.test.mjs at the repo root,
// which is an INTEGRATION test: it needs the Firestore emulator listening on
// 127.0.0.1:8080 and dies with ECONNREFUSED without it. Inside the default glob
// it made `npm test` red on a clean checkout, and a suite that is red by
// default is one everybody learns to ignore. Bourbon Cup and WBC both carve it
// out the same way.
//
// Run the rules suite deliberately, with the emulator up:
//   npm i --no-save firebase-tools @firebase/rules-unit-testing
//   npx firebase emulators:exec --only firestore --project mnq-rules-probe \
//     "node firestore.rules.test.mjs"
//
// Environment
// ───────────
// Default is `node` — fast, no jsdom overhead. Pure-function tests
// (buildStandingsForSeed, matchCalc, scheduleAutoSeed) don't need a DOM.
// When we add tests that touch React hooks (usePullToRefresh, useDirtyForm)
// they'll need `environment: "jsdom"` either at the top level here or via
// a `// @vitest-environment jsdom` comment at the top of those individual
// test files. Per-file is preferred — keeps the fast tests fast.
//
// Coverage
// ────────
// `npm run coverage` runs all tests and emits a report. Default reporter
// is "text" (console summary) + "html" (./coverage/index.html in the
// browser). Excludes config files, node_modules, build output, and the
// one-off importHistoricalData script.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Force the automatic JSX runtime for test transforms. Without it the
  // component render tests compile to classic `React.createElement` and blow
  // up with "React is not defined", since no source file imports React by
  // name. The production build already uses the automatic runtime; this makes
  // the test transform agree with it.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    // Globals: false — keeps imports explicit (`import { describe, it,
    // expect } from "vitest"`). Avoids the "where did `expect` come
    // from?" question when reading tests cold.
    globals: false,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.config.js',
        '**/*.config.jsx',
        'src/main.jsx',
        // One-off / generated files that don't ship to users:
        'src/importHistoricalData.js',
        // Test files themselves
        '**/*.test.js',
        '**/*.test.jsx',
      ],
    },
  },
});
