# Mirch Masaala — QR Digital Menu

This repository contains the existing single-file Mirch Masaala customer menu, cart, table ordering interface, admin screens, and kitchen queue. The app UI has been preserved; mobile startup was adjusted so optional QR/camera libraries load only when needed.

## Publish with GitHub Pages

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**, then click **Save**.
4. After GitHub Pages finishes building, use the URL it shows. A table QR link can be formed as `<your-pages-url>?table=01`.

## Important current limitations

- This is still the original frontend prototype. Order/cart state and most staff-panel state use browser `localStorage`; it is **not yet live-synced between customer phones, admin, and kitchen devices**.
- The Supabase database was prepared separately, but this frontend has **not yet been connected to it**. Do not rely on this version for real service until the database integration and a multi-device test are complete.
- Payment screens are UI flows, not verified payment processing. Do not treat an order as paid based only on a screen display.
- QR generation and camera scanning use optional public CDN libraries and require internet access; table number entry remains the fallback.

## Main file

- `index.html` — existing Mirch Masaala application.
- `manifest.webmanifest` — install metadata for supported browsers.
