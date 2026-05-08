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
// Default pattern (`**/*.{test,spec}.{js,jsx,ts,tsx}`) is fine. Tests live
// next to the code they cover (e.g., src/theme.jsx → src/theme.test.js,
// src/lib/matchCalc.js → src/lib/matchCalc.test.js) so finding the test
// file from the source is one click in any editor.
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
  test: {
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
