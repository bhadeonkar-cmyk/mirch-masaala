# Mirch Masaala — QR Digital Menu

The existing single-file Mirch Masaala interface is preserved in `index.html`. It includes customer ordering, waiter entry, kitchen queue, and an owner/admin panel.

## Customer and staff experience

- Customers can scan a printed table QR with the in-app camera scanner or their phone camera. If not scanning, swipe horizontally through animated table cards, tap one to center/highlight it, and confirm the selected table.
- The scanner no longer offers manual table-number typing. If the scanner library does not load, the UI explains how to use the phone's camera app or select a table card.
- QR stickers encode a table-specific link such as `?table=01`; scanning with the phone's camera should open the menu for that table.
- Admin → QR downloads an individual table QR or prepares a printable QR sheet. QR generation tries several CDN sources and has an image-service fallback.
- Customer and waiter menus have **All foods**, **Veg only**, and **Non-veg only** filters.
- Owner/Admin → Menu has per-item price editing and availability controls.
- Order confirmation and order history show status-based progress with playful waiting messages.
- The public Quick guide shows customer instructions only. Staff-specific help is available from the waiter/kitchen/admin login screen.
- Admin → Settings requires the owner to enter the restaurant's real merchant UPI ID before UPI payments can be used. Google Pay / PhonePe links use app-specific mobile links where supported, with the standard UPI QR payload available for scanning.

## Publish with GitHub Pages

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**, then click **Save**.
4. Use the URL shown by GitHub Pages. A table QR link is formed by adding `?table=01`, `?table=02`, and so on.

## Important limitations before real service

- The frontend is **not connected to Supabase yet**. Orders, alerts, menu edits, and order progress rely primarily on the current browser's `localStorage`. They do not reliably sync from customer phones to a separate kitchen or admin device.
- The login in this static prototype is **not production security**. Demo credential values still exist in public client-side code and can be discovered by someone inspecting the page source. Hiding password hints in the customer UI is not equivalent to protecting an admin account. Connect Supabase Auth or another server-side authentication system before using staff screens for a real restaurant.
- Local owner price changes only affect the browser where they are saved until shared database persistence is implemented.
- UPI requires the owner to enter a real merchant VPA (UPI ID) in Admin → Settings. A missing UPI ID disables the UPI launch path and asks the customer to contact staff.
- Payment completion is not verified automatically by this static frontend. Even if an app reports that a payment was submitted, staff must verify the money was received before marking an order paid.
- QR generation uses a public CDN library loaded on demand and requires internet access. If QR generation does not load, retry with a working connection.

## Main files

- `index.html` — application UI and prototype logic.
- `manifest.webmanifest` — install metadata for supported browsers.
- `icon.svg` — app icon.
