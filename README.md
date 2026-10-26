# Mirch Masaala — QR Digital Menu

The existing single-file Mirch Masaala interface is preserved in `index.html`. It includes customer ordering, waiter entry, kitchen queue, and an owner/admin panel.

## Customer and staff experience

- Customers scan the printed table QR with their phone camera; the QR opens that exact table automatically. Customers cannot manually select a table or enter a table code.
- Customer ordering is QR-only. If the QR sticker is missing or damaged, ask a waiter; staff can still select tables in the Waiter Pad.
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

- **Customer:** scan the table QR with the phone camera, add dishes and submit a ticket. The active visit routes the order straight to the kitchen; use **Help & orders** for a waiter call, bill, tracking, or instructions.
- **Groups at one table:** the QR is a table identifier, not a lock or customer identity. Each submission gets its own ticket. Supabase shares the live tickets with staff screens, while each customer device tracks the tickets created on that device.
- **Waiter:** select the table and start a visit when guests are seated. Customers scan that table's QR and submit orders directly to the kitchen without sharing a code. Staff-entered tickets still use the waiter's table selection.
- **Kitchen:** each ticket is shown with its table number and ticket reference. On mobile, New / Cooking / Ready lanes stack vertically for easier reading.
- **Owner/Admin:** everyday tools are Orders, Alerts, Menu, QR, and Settings. Reports, party bookings, reviews, and payment log are in **More tools**.
- **Party bookings:** the animated **Party booking** circle opens a separate request form; no dine-in table is required. Name, Indian mobile number, occasion, date, time, and guest count are required. Successful requests are saved in the shared database with a reference such as `PARTY-00001`, and create an owner alert. The owner can mark requests Contacted, Confirmed, or Unavailable and open a prefilled WhatsApp message to the customer with the full booking details.
- **After placing an order:** the customer sees ticket/progress and the actions Order more, Track my orders, and Request bill / Pay. Back on Home, the always-visible **My orders** control opens the full ticket list on that phone. Each ticket shows saved dishes, quantities, dish preferences/special requests, total and current status; opening the list refreshes statuses. In **Owner → Orders**, the owner can verify a ticket number against the recorded items, prices, total, payments and status, including cancelled or archived history. Ticket-specific access tokens are kept on the originating browser, so this is not an account-based cross-device customer history.

## Owner waiter names, backup and reset

1. In Supabase SQL Editor, apply `supabase/owner-operations-toolkit.sql` **after `supabase/setup-live.sql`**. This toolkit does not depend on optional notification, party-booking, or WhatsApp migrations.
2. In **Owner → Settings → Waiter names**, add each person by name. The database creates stable internal IDs such as `W01` and `W02`; staff select their name on a waiter device instead of typing an ID. Renaming keeps the same ID so old visit records remain traceable. These IDs are labels, not separate authentication.
3. The owner dashboard shows an in-app backup reminder when no backup is recorded or the last export is 10 days old. **Download data backup** creates a JSON export of restaurant-scoped database rows available in the installation plus a snapshot of the current browser settings/menu. It does not contain passwords, staff auth sessions, database schema, or application code, and it is not a one-click database restore.
4. **Reset app data & settings** asks the owner to download a backup first or explicitly proceed without one, then requires typing `RESET MIRCH MASAALA`. It clears orders, payment/audit history, table visits, notifications, bookings, reviews, and customer-profile records where those tables are installed. It resets customer-facing settings and makes sold-out items available again, while retaining menu items/prices, table definitions/capacities, waiter names, and Supabase staff logins. Browser-local preferences are cleared on the owner device only; the app cannot remotely clear browser storage on other phones.

## Party booking and customer checkout setup

1. In Supabase SQL Editor, apply `supabase/party-bookings.sql` after `supabase/setup-live.sql` and `supabase/role-notifications.sql`. It creates shared booking records and owner-management RPCs without assigning a table number to a party.
2. Apply `supabase/customer-payment-confirmation.sql` after `supabase/role-notifications.sql` and `supabase/party-bookings.sql`. It adds a separate payment-verification alert to both the owner and waiter; it never records money as received.
3. Apply `supabase/table-visits.sql` after the live setup/accounting and role-notification migrations, then apply `supabase/visit-billing-upgrade.sql`. These preserve ticket history and link each ticket to a specific table visit and customer browser session.
4. Apply `supabase/customer-cash-counter.sql` after those migrations. It adds visit-specific bills, cash-at-counter release, and exact-visit payment collection.
5. For lock-screen/background push alerts, apply `supabase/staff-push-notifications.sql`, configure push secrets, and deploy `supabase/functions/send-staff-push/index.ts`. Staff enable alerts on their devices after choosing their name; internal waiter IDs route the notifications. This step is optional; in-app alerts still appear on staff screens while connected.
6. **Apply `supabase/visit-service-controls.sql` after the above migrations.** A waiter must start the visit after guests are seated; opening Home never makes a table busy. The waiter selects a name from the owner-managed list; the database assigns an internal ID such as `W01`. Because waiters currently share one login, the name is an operational label, not separate authentication. For stronger accountability, give each waiter their own login later.
7. **Apply `supabase/direct-kitchen-qr-orders.sql` after `visit-service-controls.sql`.** Customers order from the table QR without a six-digit code. New tickets are approved automatically and go directly to the kitchen. The kitchen gets the order alert; the owner monitors Orders without an order-approval alert. Existing order and payment history is retained; old approval alerts are resolved, not deleted.

After setup, the workflow is simple:
- **Cash at counter:** the customer sees “Please confirm at the counter,” taps **I’ll pay cash at the counter & leave the table**, and returns Home. The backend releases the table and alerts the owner/counter plus the assigned waiter ID. The waiter directs the guest to the counter and acknowledges their own alert; only the Owner/Counter using the Admin login can record the received cash. The admin/counter alert remains open until settlement.
- **Customer left early:** once the waiter has served or cancelled every active food ticket, they tap **Guest left · free table**. The table becomes available for the next party. Any old unpaid amount remains attached to the closed visit and sends **GUEST LEFT · BALANCE DUE** alerts; the new party gets a separate bill.
- **UPI payment:** tapping **I’ve paid** requests verification only. The Owner/Counter using the Admin login checks the real transaction and records payment against the exact visit. Once the visit is settled, the customer returns Home automatically.
- **Party booking:** requests receive a reference and appear in **Owner → More tools → Party bookings**. The owner can update status and open a prefilled WhatsApp message. WhatsApp opens a draft; a person must review and tap **Send**. Automatic WhatsApp delivery requires the WhatsApp Business API and appropriate configuration/consent.

**Payment safety:** selecting cash or tapping “I’ve paid” does not itself create a payment receipt. Cash remains due in the accounts until signed-in staff records the money. Visit-specific accounting prevents an old cash balance from being charged to the next party using the same table.

## Publish with GitHub Pages

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**, then click **Save**.
4. Use the URL shown by GitHub Pages. A table QR link is formed by adding `?table=01`, `?table=02`, and so on.

## Whole-app language and live-order readiness

The English/Marathi switch applies across customer checkout, order progress, waiter/kitchen/owner screens, notifications, accessibility labels and order-setup errors. Shared database event types remain language-neutral; each staff device renders those events in its selected language. Background push alerts use the language saved on that device's push subscription.

If order placement reports a missing SQL function or table, the browser cannot install database functions itself. In Supabase SQL Editor, re-apply the existing migrations in this order; they are designed to be re-runnable and preserve order/payment history:

1. `supabase/setup-live.sql`
2. `supabase/order-management-accounting.sql`
3. `supabase/role-notifications.sql`
4. `supabase/party-bookings.sql`
5. `supabase/customer-payment-confirmation.sql`
6. `supabase/table-visits.sql`
7. `supabase/visit-billing-upgrade.sql`
8. `supabase/customer-cash-counter.sql`
9. `supabase/visit-service-controls.sql`
10. `supabase/direct-kitchen-qr-orders.sql`
11. Optional for lock-screen/background staff alerts and device language: `supabase/staff-push-notifications.sql`


### Direct ordering, shared table bills and checkout

- Customer food orders are approved automatically in the database and trigger a kitchen ticket immediately. No waiter or kitchen member has to approve each order.
- Each phone can submit a separate ticket for the same open table visit. The bill and payment screen total every ticket attached to that visit, even when different diners choose different dishes.
- Choosing **cash at counter** creates an Owner/Counter alert; it does not mark the table free or mark the bill paid. Only the Owner/Counter Admin login can record the cash received. The table visit is closed automatically after the full shared balance is paid and no kitchen tickets remain in progress.
- Do not skip `supabase/direct-kitchen-qr-orders.sql`: it removes the legacy order-approval triggers and converts any remaining pending tickets to direct-to-kitchen flow. Re-apply `supabase/role-notifications.sql`, `supabase/customer-cash-counter.sql`, `supabase/visit-service-controls.sql`, and `supabase/direct-kitchen-qr-orders.sql` in the listed order to update an existing installation. Run `supabase/staff-push-notifications.sql` last when background push alerts are enabled.
- The staff-push SQL has been corrected and added to automated PostgreSQL compilation checks. After applying it, redeploy `supabase/functions/send-staff-push/index.ts` for per-device English/Marathi push messages.

Then run `supabase/app-readiness-check.sql` in the same SQL Editor. Fix each **ACTION REQUIRED** row before placing a live order. **OPTIONAL — NOT CONFIGURED** affects background push delivery only; in-app alerts still require the role-notification setup. If background push alerts are enabled, deploy `supabase/functions/send-staff-push/index.ts` after the updated push SQL is applied.

## Important limitations before real service

- The live app uses Supabase for the shared menu, orders/status, customer cancellation, staff roles, notifications, and—after applying the migrations—payment, accounting and persistent table-visit status. Customer order access tokens remain on the browser that created each ticket; a generated device ID alone would not identify the same person.
- Staff access uses Supabase Auth and database roles. Keep the Supabase publishable key in the browser only; never expose a service-role/secret key. Keep staff credentials private and review database permissions before production use.
- Apply `supabase/order-management-accounting.sql` once in Supabase SQL Editor to enable owner table cleanup, complimentary/free meal tracking, the shared payment ledger, database-wide stats, cancellation audit records, and role-checked order status transitions. Cleanup preserves records rather than deleting history.
- Apply `supabase/table-visits.sql`, `supabase/visit-billing-upgrade.sql`, `supabase/customer-cash-counter.sql`, and finally `supabase/visit-service-controls.sql` in that order. The direct-kitchen workflow requires a waiter-opened visit. A customer who scans that table's QR can order while the visit is open; no customer code is needed. Orders route directly to the kitchen, and owner order notifications are disabled. App browsing and Home navigation alone never make a table busy.
- Waiter names are managed by the owner and mapped to stable internal IDs (such as `W01`) attached to table visits and assigned alerts. With the current shared waiter login, selecting a name is operational identification—not authentication proof.
- Cash-at-counter and UPI-verification alerts are attached to the exact visit. If a customer or waiter releases a table with an unpaid balance, the physical table can be reused but the old balance remains due and alerts the owner and assigned waiter. Collect payment from that visit alert, never from the new party’s table total. Food tickets marked NEW/PREPARING/READY block table release so an active kitchen order cannot be orphaned.
- Owner price and availability edits are saved to Supabase and sync across devices. Other preferences and drafts may remain device-local.
- UPI requires the owner to enter a real merchant VPA (UPI ID) in Admin → Settings. A missing UPI ID disables the UPI launch path and asks the customer to contact staff.
- Payment completion is not verified automatically by this static frontend. Even if an app reports that a payment was submitted, the Owner/Counter using the Admin login must verify receipt before recording a payment. Waiter IDs route alerts but do not grant payment approval permission.
- QR generation uses public CDN sources with a backup QR-image service, so internet access is required for both normal and fallback generation.

## Main files

- `index.html` — application UI and prototype logic.
- `supabase-live.js` — shared Supabase data and order workflow.
- `supabase/table-visits.sql` — guarded table visit lifecycle migration.
- `supabase/visit-billing-upgrade.sql` — order-to-visit and customer-session linkage.
- `supabase/customer-cash-counter.sql` — visit-specific cash-at-counter and payment ledger actions.
- `supabase/visit-service-controls.sql` — waiter assignment and safe table release. `supabase/direct-kitchen-qr-orders.sql` removes the guest PIN and owner order-approval alerts, and routes QR orders directly to the kitchen.
- `supabase/owner-operations-toolkit.sql` — named waiter roster, JSON data export, backup reminder status, and guarded business-data reset.
- `manifest.webmanifest` — install metadata for supported browsers.
- `icon.svg` — app icon.


## Owner accounting and table cleanup

Run `supabase/order-management-accounting.sql` once in Supabase SQL Editor after deploying the current app. The migration adds an audit trail, confirmed-payment ledger, complimentary reasons, and test/archive flags. It is designed to be safely re-run. Then run `supabase/table-visits.sql` once to activate persistent Start visit / Finish visit controls. The table-visit migration carries forward recent table activity during installation and only lets staff finish a visit when every active ticket is served/cancelled and no bill balance remains. The earlier `supabase/customer-cancel-order.sql` is deprecated and intentionally contains no executable SQL; do not use it to update an installation after this accounting migration.

In **Owner → Orders**, use **Verify an order** and enter the ticket number shown by the customer to check its recorded item names, quantities, item prices, total, payments, balance, status, and any test/archive/cancellation/complimentary flags. The lookup includes completed, cancelled, and archived history, and only the owner account can run it. Cancel an unserved ticket with a reason; cancellation is saved to the shared order status and audit log. In **Owner → Stats**, use **Complimentary / free food** to classify an unpaid ticket with a reason; its value is tracked separately from money received. Use **Clean test orders for a table** only after reviewing the full ticket list and confirming every unarchived ticket at that table is test data. The app previews order count, active count, total order value and recorded payments before asking for confirmation; active tickets are cancelled and all selected records remain in history marked as test. Do not run cleanup on a table with real service unless every ticket has been reviewed.

Record received cash/card/UPI in **Owner → Payment log** by table. Opening a UPI link or tapping Continue never records a payment. Payment receipts are allocated to open tickets and the owner stats use the shared database, including partial balances, cancellations, complimentary value, and excluded test orders.


## Final menu options and seating capacity
After `setup-live.sql`, `order-management-accounting.sql`, `table-visits.sql`, `visit-billing-upgrade.sql`, `customer-cash-counter.sql`, and `visit-service-controls.sql` are installed, run `supabase/menu-item-options-and-table-capacity.sql` once in Supabase SQL Editor. It stores a spice level for each dish line, returns those details to customer and owner ticket lookup, and adds owner-managed seating capacity (1–30). Existing orders, cancellations, payments, and audit history are preserved.

At checkout, the customer only needs to scan the table QR after the waiter has started the visit. No guest PIN is required; if a request fails, the dishes remain in the cart. The Mutton Biryani fallback photo is credited to Jayanthkumar101 on Wikimedia Commons under CC BY-SA 4.0; other menu items use their HTTPS `image_url` when the owner has added one.

For test-heavy tables, use Owner/Admin → Accounts → Table cleanup, preview the affected tickets, then confirm. Test tickets are archived and remaining active test tickets cancelled, never deleted, so they can be audited but do not count as live sales. Use Complimentary only for genuinely free meals and record a reason so they do not inflate paid revenue. Customers can return Home → Recheck order / Track items & status on the same phone to verify each saved ticket and its ordered dish choices.


## Built for restaurants, by Onkar FX
The customer-facing home screen includes a small footer link to [Onkar FX](https://www.onkarfx.in) for businesses interested in similar digital ordering and workflow automation. Mirch Masaala remains the main brand of the restaurant app.
