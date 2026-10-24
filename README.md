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
- **Groups at one table:** the QR is a table identifier, not a lock or customer identity. Each submission gets its own ticket. Supabase shares the live tickets with staff screens, while each customer device tracks the tickets created on that device.
- **Waiter:** select a table, add items, and send a ticket. The table selection is visibly highlighted and the confirmation shows the ticket number.
- **Kitchen:** each ticket is shown with its table number and ticket reference. On mobile, New / Cooking / Ready lanes stack vertically for easier reading.
- **Owner/Admin:** everyday tools are Orders, Alerts, Menu, QR, and Settings. Reports, party bookings, reviews, and payment log are in **More tools**.
- **Party bookings:** the animated **Party booking** circle opens a separate request form; no dine-in table is required. Name, Indian mobile number, occasion, date, time, and guest count are required. Successful requests are saved in the shared database with a reference such as `PARTY-00001`, and create an owner alert. The owner can mark requests Contacted, Confirmed, or Unavailable and open a prefilled WhatsApp message to the customer with the full booking details.
- **After placing an order:** the customer sees the ticket/progress and three actions: Order more, Track my orders, and Request bill / Pay. Back on Home, a small **Recheck order** control opens the full ticket list only when tapped; order details no longer occupy the landing screen. Ticket-specific access tokens are stored on the originating browser, so this is not an account-based cross-device order history.

## Party booking and customer checkout setup

1. In Supabase SQL Editor, apply `supabase/party-bookings.sql` after `supabase/setup-live.sql` and `supabase/role-notifications.sql`. It creates shared booking records and owner-management RPCs without assigning a table number to a party.
2. To enable the customer’s **I’ve paid — please verify** action, apply `supabase/customer-payment-confirmation.sql` after `supabase/role-notifications.sql` and `supabase/party-bookings.sql`. It adds a separate alert to both the owner and waiter. It does not mark any payment as received.
3. For table visits, apply `supabase/table-visits.sql` after the live setup/accounting and role-notification migrations, then apply `supabase/visit-billing-upgrade.sql`. These preserve ticket history and associate each ticket with a specific table visit and customer browser session.
4. Apply `supabase/customer-cash-counter.sql` after those migrations. It adds visit-specific bills, cash-at-counter release, and exact-visit payment collection.
5. **Last, apply `supabase/visit-service-controls.sql`.** This replaces the public table-visit lookup so opening Home or selecting a table cannot make it busy. A waiter must start a visit after guests are seated, enter their staff ID (for example `W01`), then share the six-digit order code displayed for that visit. Customers can browse without a code, but cannot submit an order without the active visit's code. Because waiters currently share one account, this ID is an operational label stored on that waiter’s device—not a separately authenticated identity; for stronger accountability, give each waiter their own login later.
6. If guests leave before paying, the waiter can use **Guest left · free table** after food tickets have been served or cancelled. The table becomes available for the next party. Any unpaid balance remains tied to the closed visit and triggers **GUEST LEFT · BALANCE DUE** alerts to the owner and assigned waiter. A new party’s bill is kept separate. The customer’s **I’ll pay cash at the counter & leave the table** button similarly releases the table after food has been served and sends **CASH AT COUNTER** alerts. The customer is instructed to pay at the counter; only signed-in owner/waiter staff can record money received.
7. The visit-aware **Bill & pay** action reads the current visit’s balance. A guest can open a UPI app and request verification, but tapping **I’ve paid** does not mark the bill paid. Staff must verify receipt and record payment against the exact visit.
8. For background push alerts to staff phones, also apply `supabase/staff-push-notifications.sql`, configure push secrets, enable alerts on staff devices after setting their waiter ID, and deploy `supabase/functions/send-staff-push/index.ts`. The owner receives cash and outstanding-balance alerts; the waiter device gets visit alerts targeted to its staff ID. Without this optional setup, alerts appear in the in-app staff panels while connected.
7. Party booking requests receive a reference and appear in **Owner → More tools → Party bookings**. The owner can update the status and open a prefilled WhatsApp message. WhatsApp opens a draft; the person must review and tap **Send**. Automatic WhatsApp delivery requires the WhatsApp Business API and appropriate configuration/consent.

**Payment safety:** selecting cash or tapping “I’ve paid” does not itself create a payment receipt. Cash remains due in the accounts until signed-in staff records the money. Visit-specific accounting prevents an old cash balance from being charged to the next party using the same table.

## Publish with GitHub Pages

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**, then click **Save**.
4. Use the URL shown by GitHub Pages. A table QR link is formed by adding `?table=01`, `?table=02`, and so on.

## Important limitations before real service

- The live app uses Supabase for the shared menu, orders/status, customer cancellation, staff roles, notifications, and—after applying the migrations—payment, accounting and persistent table-visit status. Customer order access tokens remain on the browser that created each ticket; a generated device ID alone would not identify the same person.
- Staff access uses Supabase Auth and database roles. Keep the Supabase publishable key in the browser only; never expose a service-role/secret key. Keep staff credentials private and review database permissions before production use.
- Apply `supabase/order-management-accounting.sql` once in Supabase SQL Editor to enable owner table cleanup, complimentary/free meal tracking, the shared payment ledger, database-wide stats, cancellation audit records, and role-checked order status transitions. Cleanup preserves records rather than deleting history.
- Apply `supabase/table-visits.sql`, `supabase/visit-billing-upgrade.sql`, `supabase/customer-cash-counter.sql`, and finally `supabase/visit-service-controls.sql` in that order. The final migration requires a staff-opened visit plus a six-digit guest code before a customer order can reach the kitchen. App browsing, Home navigation, and table selection alone do not create a busy visit.
- A waiter ID such as `W01` is assigned on the waiter device and attached to the table visit. With the current shared waiter login, staff must enter the correct ID on each device; the ID is a label, not authentication proof.
- Cash-at-counter and UPI-verification alerts are attached to the exact visit. If a customer or waiter releases a table with an unpaid balance, the physical table can be reused but the old balance remains due and alerts the owner and assigned waiter. Collect payment from that visit alert, never from the new party’s table total. Food tickets marked NEW/PREPARING/READY block table release so an active kitchen order cannot be orphaned.
- Owner price and availability edits are saved to Supabase and sync across devices. Other preferences and drafts may remain device-local.
- UPI requires the owner to enter a real merchant VPA (UPI ID) in Admin → Settings. A missing UPI ID disables the UPI launch path and asks the customer to contact staff.
- Payment completion is not verified automatically by this static frontend. Even if an app reports that a payment was submitted, staff must verify the money was received before marking an order paid.
- QR generation uses public CDN sources with a backup QR-image service, so internet access is required for both normal and fallback generation.

## Main files

- `index.html` — application UI and prototype logic.
- `supabase-live.js` — shared Supabase data and order workflow.
- `supabase/table-visits.sql` — guarded table visit lifecycle migration.
- `supabase/visit-billing-upgrade.sql` — order-to-visit and customer-session linkage.
- `supabase/customer-cash-counter.sql` — visit-specific cash-at-counter and payment ledger actions.
- `supabase/visit-service-controls.sql` — waiter assignment, six-digit guest ordering codes, and safe table release.
- `manifest.webmanifest` — install metadata for supported browsers.
- `icon.svg` — app icon.


## Owner accounting and table cleanup

Run `supabase/order-management-accounting.sql` once in Supabase SQL Editor after deploying the current app. The migration adds an audit trail, confirmed-payment ledger, complimentary reasons, and test/archive flags. It is designed to be safely re-run. Then run `supabase/table-visits.sql` once to activate persistent Start visit / Finish visit controls. The table-visit migration carries forward recent table activity during installation and only lets staff finish a visit when every active ticket is served/cancelled and no bill balance remains. The earlier `supabase/customer-cancel-order.sql` is deprecated and intentionally contains no executable SQL; do not use it to update an installation after this accounting migration.

In **Owner → Orders**, use **Verify an order** and enter the ticket number shown by the customer to check its recorded item names, quantities, item prices, total, payments, balance, status, and any test/archive/cancellation/complimentary flags. The lookup includes completed, cancelled, and archived history, and only the owner account can run it. Cancel an unserved ticket with a reason; cancellation is saved to the shared order status and audit log. In **Owner → Stats**, use **Complimentary / free food** to classify an unpaid ticket with a reason; its value is tracked separately from money received. Use **Clean test orders for a table** only after reviewing the full ticket list and confirming every unarchived ticket at that table is test data. The app previews order count, active count, total order value and recorded payments before asking for confirmation; active tickets are cancelled and all selected records remain in history marked as test. Do not run cleanup on a table with real service unless every ticket has been reviewed.

Record received cash/card/UPI in **Owner → Payment log** by table. Opening a UPI link or tapping Continue never records a payment. Payment receipts are allocated to open tickets and the owner stats use the shared database, including partial balances, cancellations, complimentary value, and excluded test orders.
