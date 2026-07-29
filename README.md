# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Icons

Every web-facing icon lives under `public/`, which is the only directory Vite
copies to the deploy root:

- `public/favicon.ico`, `public/favicon.svg`, `public/apple-touch-icon.png` —
  at the **site root** on purpose. Browsers probe `/favicon.ico` and iOS probes
  `/apple-touch-icon.png` directly when no `<link>` tag applies.
- `public/icons/icon-*.png` — the PWA manifest icons, referenced by
  `public/manifest.webmanifest` with absolute `/icons/...` paths.
- `public/favicon/*` — notification and pull-to-refresh icons used from JS.

Note for `npx capacitor-assets generate` (source art: `assets/logo.png`): it
writes a PWA `icons/` directory at the **repo root** and rewrites the manifest
with `../icons/...` paths. Both are wrong for this project — the repo root is
not `publicDir`, so those files never ship and every manifest icon 404s. It
also emits the icons with a `.webp` extension despite their being PNG data. If
you re-run it, move the output into `public/icons/` as `.png` and restore the
absolute paths in `public/manifest.webmanifest`. Native icons (Android
`mipmap-*`, iOS `AppIcon.appiconset`) are generated separately and are
unaffected.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
