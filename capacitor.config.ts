// ─────────────────────────────────────────────────────────────────────────
//  capacitor.config.ts — native shell configuration for MnQ Golf
// ─────────────────────────────────────────────────────────────────────────
// Capacitor bundles the Vite production build (dist/) into native iOS and
// Android projects and runs it inside a WebView. The web app is unchanged;
// this file only configures the native shell around it.
//
// Targeting Capacitor 8 (current as of 2026). Build requirements:
//   • Node 22+
//   • iOS: macOS + Xcode 26+, iOS deployment target 15.0   ← Mac required
//   • Android: Android Studio Otter (2025.2.1)+            ← builds on Windows
//
// After editing this file, run `npx cap sync` to push changes into the
// native projects.

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // ─── appId ──────────────────────────────────────────────────────────────
  // Reverse-DNS bundle identifier. This is PERMANENT once the app is
  // published to either store — it cannot be changed later without shipping
  // a brand-new app listing. com.mnqgolf.app reads cleanly off the domain
  // you already own. Change it here BEFORE the first `cap add` if you want
  // something different (e.g. com.mnqgolf.golf).
  appId: "com.mnqgolf.app",

  // Display name shown under the home-screen icon.
  appName: "MnQ Golf",

  // ─── webDir ─────────────────────────────────────────────────────────────
  // The folder Capacitor copies into the native app. Vite builds to dist/,
  // so every `npm run build` followed by `npx cap copy` ships the latest
  // web bundle into both native projects. Nothing is loaded from the
  // internet at runtime — the app is fully self-contained and offline-
  // capable for everything except Firestore/Functions network calls (which
  // is identical to the PWA today).
  webDir: "dist",

  // ─── server ─────────────────────────────────────────────────────────────
  // Production: NO server.url. The app serves bundled assets from the
  // native origin (capacitor://localhost on iOS, https://localhost on
  // Android). Pointing server.url at a remote URL would defeat the purpose
  // of a native build and risks an App Store "minimum functionality"
  // rejection — leave it unset for release builds.
  //
  // Dev live-reload (optional): to iterate against the running Vite dev
  // server on your machine, temporarily uncomment the block below, swap in
  // your machine's LAN IP, run `npm run dev -- --host`, then `npx cap run
  // ios|android`. Re-comment before building anything you ship.
  //
  // server: {
  //   url: "http://192.168.1.XXX:5173",
  //   cleartext: true,
  // },

  ios: {
    // Capacitor's WebView background while the web app paints — matches the
    // app's light theme-color so there's no flash of black on launch.
    backgroundColor: "#f0f2f5",
    // Keep the WebView from bouncing past content like a native scroll view;
    // the app manages its own scrolling (incl. the playoff-bracket snap).
    scrollEnabled: true,
  },

  android: {
    backgroundColor: "#f0f2f5",
  },

  plugins: {
    // Splash screen shows your launch asset, then hands off to the web app.
    // launchAutoHide:false lets the app dismiss it AFTER React has mounted
    // and first paint is ready, so users never see a blank WebView. Call
    // SplashScreen.hide() from App.jsx once the initial route renders.
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#f0f2f5",
      showSpinner: false,
    },

    // ─── Added in later phases (left here as a map, commented) ─────────────
    // Phase 3 — push notifications:
    // PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
