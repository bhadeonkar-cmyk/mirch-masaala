# Mirch Masaala — QR Digital Menu

The existing single-file Mirch Masaala interface is preserved in `index.html`. It includes customer ordering, waiter entry, kitchen queue, and an owner/admin panel.

## Customer and staff experience

- Customers can scan a printed table QR with the in-app camera scanner or their phone camera. If not scanning, swipe horizontally through animated table cards, tap one to center/highlight it, and confirm the selected table.
- The scanner no longer offers manual table-number typing. If the scanner library does not load, the UI explains how to use the phone's camera app or select a table card.
- QR stickers encode a table-specific link such as `?table=01`; scanning with the phone's camera should open the menu for that table.
- Admin → QR creates individual codes and a printable sheet for Tables 01–20 from the bundled `qr-matrices.js` asset, so those standard table QR images do not depend on a third-party QR service. These codes encode the current GitHub Pages URL; regenerate them if the public site URL changes. Tables beyond 20 use the online fallback.
- Customer and waiter menus have **All foods**, **Veg only**, and **Non-veg only** filters.
- Owner/Admin → Menu has per-item price editing and availability controls.
- Veg-only and non-veg-only filters also apply to the customer’s special/recommended dishes.
- Admin → Settings lets the owner add a public restaurant address, opening hours, contact number, a Google Maps directions link, and a short “Visit Us” message. The public section stays hidden until at least one field is configured.
- Order confirmation and order history show status-based progress with playful waiting messages.
- The public Quick guide shows customer instructions only. Staff-specific help is available from the waiter/kitchen/admin login screen.
- Admin → Settings requires the owner to enter the restaurant's real merchant UPI ID before UPI payments can be used. Google Pay / PhonePe links use app-specific mobile links where supported, with the standard UPI QR payload available for scanning.


## Simplified role workflows

- **Customer:** scan the table QR with the phone camera, add dishes, use the cart to submit one ticket, and use the single **Help & orders** menu for calling a waiter, billing, tracking, or instructions.
- **Groups at one table:** the QR is a table identifier, not a lock or customer identity. Each submission gets a distinct ticket number so one customer's submission does not intentionally replace another ticket. The tickets are not yet shared across phones; this becomes operational only after database sync is connected.
- **Waiter:** select a table, add items, and send a ticket. The table selection is visibly highlighted and the confirmation shows the ticket number.
- **Kitchen:** each ticket is shown with its table number and ticket reference. On mobile, New / Cooking / Ready lanes stack vertically for easier reading.
- **Owner/Admin:** everyday tools are Orders, Alerts, Menu, QR, and Settings. Reports, party bookings, reviews, and payment log are in **More tools**.
- **After placing an order:** the customer sees the ticket/progress and three clear actions: Order more, Track my orders, and Request bill / Pay.

## Publish with GitHub Pages

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**, then click **Save**.
4. Use the URL shown by GitHub Pages. A table QR link is formed by adding `?table=01`, `?table=02`, and so on.

## Important limitations before real service

- The live app uses Supabase for the shared menu, order creation/status, customer cancellation, staff roles, notifications, and—after applying the accounts migration—payment and accounting actions. A few convenience preferences and customer details remain device-local.
- Staff access uses Supabase Auth and database roles. Keep the Supabase publishable key in the browser only; never expose a service-role/secret key. Keep staff credentials private and review database permissions before production use.
- Apply `supabase/order-management-accounting.sql` once in Supabase SQL Editor to enable owner table cleanup, complimentary/free meal tracking, the shared payment ledger, database-wide stats, cancellation audit records, and role-checked order status transitions. Cleanup preserves records rather than deleting history.
- Local owner price changes only affect the browser where they are saved until shared database persistence is implemented.
- UPI requires the owner to enter a real merchant VPA (UPI ID) in Admin → Settings. A missing UPI ID disables the UPI launch path and asks the customer to contact staff.
- Payment completion is not verified automatically by this static frontend. Even if an app reports that a payment was submitted, staff must verify the money was received before marking an order paid.
- QR generation uses public CDN sources with a backup QR-image service, so internet access is required for both normal and fallback generation.

## Main files

- `index.html` — application UI and prototype logic.
- `manifest.webmanifest` — install metadata for supported browsers.
- `icon.svg` — app icon.


## Owner accounting and table cleanup

Run `supabase/order-management-accounting.sql` once in Supabase SQL Editor after deploying the current app. The migration adds an audit trail, confirmed-payment ledger, complimentary reasons, and test/archive flags. It is designed to be safely re-run.

In **Owner → Stats**, use **Complimentary / free food** to classify an unpaid ticket with a reason; its value is tracked separately from money received. Use **Clean test orders for a table** only when every unarchived ticket at that table is test data. The app previews order count, active count, total order value and recorded payments before asking for confirmation; active tickets are cancelled and all selected records remain in history marked as test. Do not run cleanup on a table with real service unless every ticket has been reviewed.

Record received cash/card/UPI in **Owner → Payment log** by table. Opening a UPI link or tapping Continue never records a payment. Payment receipts are allocated to open tickets and the owner stats use the shared database, including partial balances, cancellations, complimentary value, and excluded test orders.
