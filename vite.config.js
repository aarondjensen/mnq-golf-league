import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Drop ~157 KB (~45 KB gzipped) of dead RE2 regex engine that
      // @firebase/firestore pulls in for its Pipelines preview API, which MnQ
      // never calls. The stub throws loudly if it's ever actually reached.
      // Full rationale + revert instructions: shims/re2js-stub.js
      're2js': fileURLToPath(new URL('./shims/re2js-stub.js', import.meta.url)),
    },
  },
  build: {
    // ── Vendor chunk split ───────────────────────────────────────────────
    // Before this, everything non-lazy landed in one ~800 KB index-<hash>.js.
    // Two problems: the whole thing re-downloads on every deploy (MnQ ships
    // often, and only app code changes), and the browser can't start
    // compiling any of it until the last byte lands.
    //
    // Splitting on dependency boundaries means a typical deploy invalidates
    // only the small app chunk — react/firebase stay in cache across
    // releases. The chunks are all still fetched in parallel (Vite emits
    // modulepreload links for them), so there's no extra round trip.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // react-dom is the single biggest vendor block and changes only on
          // a React upgrade — its own long-lived chunk.
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react'
          // Firestore + its webchannel transport. Needed on every authed
          // session, but versioned independently of app code.
          if (/node_modules\/@firebase\/(firestore|webchannel-wrapper)/.test(id)) return 'vendor-firestore'
          // Auth is on the critical path even for signed-out users.
          if (/node_modules\/@firebase\//.test(id) || /node_modules\/firebase\//.test(id)) return 'vendor-firebase'
        },
      },
    },
  },
})
