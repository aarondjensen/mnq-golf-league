import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // android/ and ios/ are generated Capacitor projects, and shims/ is a single
  // hand-written stub standing in for a node_modules package. None of the three
  // is app source, and all three were being linted as if they were.
  globalIgnores(['dist', 'android', 'ios', 'functions/node_modules', 'shims']),
  {
    files: ['**/*.{js,jsx}'],
    plugins: { react },
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // ── A component that isn't imported ──
      // `no-undef` does not see JSX element names, so a component used without
      // its import lints perfectly clean, builds perfectly clean, and throws
      // "Can't find variable" the moment somebody opens that tab. That is
      // exactly how WBC shipped a dead Betting tab. This app splits its screens
      // across src/pages/ and src/components/ and moves things between them,
      // which is the same move that caused it there.
      //
      // This is the rule that catches it, and it is the only reason
      // eslint-plugin-react is a dependency — nothing else from it is on.
      'react/jsx-no-undef': 'error',
      // `catch {}` is a deliberate shape here: browser APIs that are absent or
      // permission-blocked on some platforms should degrade quietly, not crash.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // ── The blocks below are why this file grew ──
  // Everything outside src/ was being linted with BROWSER globals, because
  // there was nothing here saying otherwise. The Cloud Functions, the Vercel
  // handler and the push service worker each reported a pile of `no-undef` for
  // doing exactly what they are supposed to do — `require`, `exports`,
  // `process`, `importScripts`, `self` — and that pile was most of the noise
  // the repo's real findings were hiding behind. Bourbon Cup and WBC have both
  // carried these overrides for a while; this brings MnQ in line.

  // Vercel serverless handler — Node ESM, not browser.
  {
    files: ['api/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  // Build and deploy tooling — Node ESM. Run from a terminal, never bundled.
  {
    files: ['scripts/**/*.{js,mjs}', 'vite.config.js', 'vitest.config.js'],
    languageOptions: { globals: globals.node },
  },
  // Firebase Cloud Functions — Node, and CommonJS rather than ESM, so
  // `require` and `exports` are globals rather than syntax. Deployed
  // separately with its own package.json, so it never sees the browser globals
  // or the ESM parse above.
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
  },
  // The push service worker. Not a page and not Node: it has the worker
  // globals, `importScripts`, and the compat `firebase` object those scripts
  // define on self.
  {
    files: ['public/**/*-sw.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, firebase: 'readonly' },
    },
  },
])
