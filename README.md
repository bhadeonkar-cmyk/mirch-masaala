# Mirch Masaala — QR Digital Menu

The existing single-file Mirch Masaala interface is preserved in `index.html`. It includes customer ordering, waiter entry, kitchen queue, and an owner/admin panel.

## Customer and staff experience

- Swipe horizontally through animated table cards if a printed table QR is not available.
- QR stickers encode a table-specific link such as `?table=01`; scanning with the phone's camera should open the menu for that table.
- Admin → QR supports downloading one table QR as PNG or preparing a printable QR sheet.
- Customer and waiter menus have **All foods**, **Veg only**, and **Non-veg only** filters.
- Owner/Admin → Menu has per-item price editing and availability controls.
- Order confirmation and order history show status-based progress with playful waiting messages.
- The in-app Quick guide has separate Customer, Waiter, Kitchen, and Owner/Admin instructions.

## Publish with GitHub Pages

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**, then click **Save**.
4. Use the URL shown by GitHub Pages. A table QR link is formed by adding `?table=01`, `?table=02`, and so on.

## Important limitations before real service

- The frontend is **not connected to Supabase yet**. Orders, alerts, menu edits, and order progress rely primarily on the current browser's `localStorage`. They do not reliably sync from customer phones to a separate kitchen or admin device.
- The login in this static prototype is **not production security**. Demo credential values still exist in public client-side code and can be discovered by someone inspecting the page source. Hiding password hints in the customer UI is not equivalent to protecting an admin account. Connect Supabase Auth or another server-side authentication system before using staff screens for a real restaurant.
- Local owner price changes only affect the browser where they are saved until shared database persistence is implemented.
- The payment experience creates UPI links and shows QR/payment UI, but payment completion is not verified automatically. Staff must verify receipt through the payment provider.
- QR generation uses a public CDN library loaded on demand and requires internet access. If QR generation does not load, retry with a working connection.

## Main files

- `index.html` — application UI and prototype logic.
- `manifest.webmanifest` — install metadata for supported browsers.
- `icon.svg` — app icon.
