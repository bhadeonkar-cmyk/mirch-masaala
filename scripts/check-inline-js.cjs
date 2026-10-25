const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const live = fs.readFileSync('supabase-live.js', 'utf8');
const migration = fs.readFileSync('supabase/order-management-accounting.sql', 'utf8');
const setup = fs.readFileSync('supabase/setup-live.sql', 'utf8');
const publicBoard = fs.readFileSync('supabase/public-table-status-circles.sql', 'utf8');
const tableVisitsMigration = fs.readFileSync('supabase/table-visits.sql', 'utf8');
const visitBillingMigration = fs.readFileSync('supabase/visit-billing-upgrade.sql', 'utf8');
const partyBookingsMigration = fs.readFileSync('supabase/party-bookings.sql', 'utf8');
const paymentConfirmationMigration = fs.readFileSync('supabase/customer-payment-confirmation.sql', 'utf8');
const cashCounterMigration = fs.readFileSync('supabase/customer-cash-counter.sql', 'utf8');
const visitServiceControlsMigration = fs.readFileSync('supabase/visit-service-controls.sql', 'utf8');
const directKitchenMigration = fs.readFileSync('supabase/direct-kitchen-qr-orders.sql', 'utf8');
const menuOptionsMigration = fs.readFileSync('supabase/menu-item-options-and-table-capacity.sql', 'utf8');
const ownerToolkitMigration = fs.readFileSync('supabase/owner-operations-toolkit.sql', 'utf8');
const legacyCancellation = fs.readFileSync('supabase/customer-cancel-order.sql', 'utf8');
const staffPushEdge = fs.readFileSync('supabase/functions/send-staff-push/index.ts', 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];

function fail(message) {
  console.error('✗ ' + message);
  process.exitCode = 1;
}
function requireText(source, needle, label) {
  if (!source.includes(needle)) fail(label + ' missing: ' + needle);
  else console.log('✓ ' + label);
}
if (scripts.length === 0) {
  fail('No inline JavaScript block found in index.html');
} else {
  for (let i = 0; i < scripts.length; i += 1) {
    try {
      new vm.Script(scripts[i][1], { filename: `index.html:inline-script-${i + 1}` });
      console.log(`✓ index.html inline script ${i + 1} parses (${scripts[i][1].length} chars)`);
    } catch (error) {
      fail(`JavaScript syntax error in inline script ${i + 1}: ${error.message}`);
    }
  }
}
try {
  new vm.Script(live, { filename: 'supabase-live.js' });
  console.log('✓ Supabase integration JavaScript parses');
} catch (error) {
  fail('Supabase integration syntax error: ' + error.message);
}

[
  ['MM_CANCEL_CUSTOMER_ORDER', 'Customer cancellation uses the shared RPC'],
  ['customerCancelConfirmed', 'Customer refresh protects confirmed cancellation'],
  ['MM_PREVIEW_TABLE_CLEANUP', 'Owner cleanup requires a server preview'],
  ['MM_CLEAR_TABLE_ORDERS', 'Owner cleanup uses shared database'],
  ['MM_SET_ORDER_COMPLIMENTARY', 'Complimentary meals use shared database'],
  ['MM_RECORD_TABLE_PAYMENT', 'Payments are confirmed through the server'],
  ['MM_GET_PUBLIC_TABLE_BILL', 'Customer bill uses the shared balance API'],
  ['MM_LOAD_ADMIN_ACCOUNTS_SUMMARY', 'Stats use authoritative shared accounts'],
  ['MM_LOAD_ADMIN_PAYMENTS', 'Payment log reads shared receipts'],
  ['MM_SUBMIT_PARTY_BOOKING', 'Party booking submits to the shared database'],
  ['MM_LOAD_PARTY_BOOKINGS', 'Owner party dashboard reads shared booking records'],
  ['MM_UPDATE_PARTY_BOOKING', 'Owner can update party booking status'],
  ['dispatchStaffPushForGuestRequest', 'Guest requests can dispatch configured staff push alerts'],
  ['MM_REQUEST_PAYMENT_VERIFICATION', 'Customer can request payment verification from staff'],
  ["mm_guest_request_payment_check", 'Payment verification uses the shared database RPC'],
  ['MM_GET_PUBLIC_VISIT_BILL', 'Customer bill is scoped to the exact table visit and browser session'],
  ['MM_REQUEST_CASH_COUNTER_RELEASE', 'Cash checkout releases a visit through the server'],
  ['MM_GET_STAFF_VISIT_BILL', 'Counter staff can load the exact visit balance'],
  ['MM_RECORD_VISIT_PAYMENT', 'Counter payments are allocated to one table visit'],
  ['MM_REQUEST_VISIT_PAYMENT_VERIFICATION', 'UPI verification requests are scoped to the active visit'],
  ['MM_RELEASE_ABANDONED_VISIT', 'Staff can release an abandoned table visit without mixing balances'],
  ['p_guest_order_code: null', 'QR customer ordering does not require a guest PIN'],
  ["p_staff_code: String(window.role) === 'waiter' ? staffCode : null", "Staff alerts are filtered by the assigned waiter ID"],
  ['for (var i = 0; i < tokens.length; i++)', 'Every retained customer ticket gets status refresh'],
  [".select('ticket_id,status').maybeSingle()", 'Staff status change confirms a database row was updated'],
  [".select('id,price').maybeSingle()", 'Owner price update confirms a database row was updated'],
  [".select('id,is_available').maybeSingle()", 'Menu availability update confirms a database row was updated']
].forEach(([needle, label]) => requireText(live, needle, label));

[
  ['#home-choose-table, #table-swipe-guide, #tables, #table-continue { display: none !important; }', 'Customer manual table picker is hidden in QR-only flow'],
  ['#scan-table-btn{display:flex!important', 'Primary Table QR scanner is explicitly kept visible'],
  ['id="scan-table-btn" onclick="openScan()"', 'Primary Table QR scanner remains available to customers'],
  ['Sticker missing? Ask your waiter for the correct table link.', 'Customer has a compact fallback when a table sticker is missing'],
  ['class="qr-guide-mini"', 'Customer gets a compact animated QR workflow guide'],
  ['class="qr-mini-mascot"', 'Animated chef character guides the customer toward scanning'],
  ['Scan → choose dishes → track order', 'Customer guidance explains scan, order and tracking in one line'],
  ['class="qr-setup-hero qr-setup-compact"', 'Owner QR setup is compact instead of large instruction cards'],
  ['class="qr-flow-line"', 'Owner sees arrow-based QR setup steps'],
  ['class="owner-qr-quickstart-mascot"', 'Owner order dashboard uses a compact animated chef guide'],
  ['qrButtonGlow', 'Primary QR action has a subtle guiding glow'],
  ['function drawQR()', 'Owner has a dedicated table QR setup screen'],
  ['Generate &amp; print all table QRs', 'Owner can generate and print all QR labels from the guided screen'],
  ['function openOwnerQRSetup()', 'Orders screen directs owner to Table QR setup'],
  ['Digital ordering &amp; business automation by', 'Subtle Onkar FX business enquiry credit is present']
  ['function drawQR()', 'Owner has a dedicated table QR setup screen'],
  ['Generate &amp; print all table QR QRs', 'placeholder'],
  ['function openOwnerQRSetup()', 'Orders screen directs owner to Table QR setup'],
  ['Digital ordering &amp; business automation by', 'Subtle Onkar FX business enquiry credit is present'],
  ['function cancelOrder(id)', 'Customer cancellation UI exists'],
  ['class="customer-explore-shortcut"', 'Customer has a Places to Visit shortcut on the ordering screen'],
  ['function openExploreFromCustomer()', 'Customer explore shortcut preserves the selected table context'],
  ['function backFromExplore()', 'Explore view returns to the screen the customer came from'],
  ['id="customer-bill-pay-btn"', 'Customer has a persistent bill and payment action'],
  ['customerHasActiveOrdersForTable(tableNumber)', 'Customer table focus is limited to their active table'],
  ['id="customer-table-lock"', 'Customer sees a fixed current-table label after ordering'],
  ['id="pay-verify-upi-btn"', 'Customer can ask the owner/waiter to verify a reported UPI payment'],
  ['function requestPaymentVerification()', 'Payment verification button never self-confirms a payment'],
  ['id="pay-cash-leave-btn"', 'Customer can release the table after choosing cash at counter'],
  ['function releaseTableForCash()', 'Cash checkout notifies staff and returns the customer Home'],
  ['async function getWaiterStaffCode(forcePrompt)', 'Waiters choose a name with a stable internal ID'],
  ['function releaseAbandonedTableVisit()', 'Waiters can release a table after guests leave'],
  ['id="waiter-identity-choice"', 'Waiters select a name instead of typing an ID'],
  ['function refreshOwnerWaiterDirectory()', 'Owner manages a central named waiter roster'],
  ['function downloadOwnerBackup()', 'Owner can download a restaurant data backup'],
  ['Backups are due every 10 days.', 'Owner backup reminder has a 10-day cadence'],
  ['function confirmOwnerResetWithoutBackup()', 'Reset asks for a backup or explicit no-backup confirmation'],
  ['RESET MIRCH MASAALA', 'Reset requires a typed confirmation'],
  ['supabase/owner-operations-toolkit.sql', 'UI explains the one-time owner toolkit SQL setup'],
  ['Guest left · free table', 'Waiter sees an explicit abandoned-table action'],
  ['Customers scan the table QR; orders go straight to the kitchen while this visit is open.', 'Waiter sees direct QR-to-kitchen visit instructions'],
  ['This phone is not linked to the current table visit', 'Customer payment verification requires a verified visit'],
  ['function customerVisitContextForTable(tableNumber)', 'Customer checkout retains a verified visit/session pair'],
  ['function openCashCounterCollection(visitId, tableNumber, notificationId, method)', 'Staff cash alert opens the correct visit balance'],
  ['CASH_AT_COUNTER', 'Cash-at-counter alert appears to owner and waiter'],
  ['mm_customer_closed_visit_ids', 'A released visit no longer locks the customer table picker'],
  ['PAYMENT_CHECK', 'Owner and waiter have a dedicated payment verification alert'],
  ['id="home-party-link"', 'Customer has an animated party booking shortcut'],
  ['id="p-phone" placeholder="10-digit mobile number" type="tel"', 'Party booking phone number is required in the form'],
  ['function sendPartyWhatsApp()', 'Customer can message the restaurant with booking details'],
  ['function messagePartyCustomer(id)', 'Owner can message the customer with booking details'],
  ['function updatePartyStatus(id, status)', 'Owner can update party request status'],
  ['PARTY_BOOKING', 'Party requests appear in owner alert UI'],
  ['previewAndCleanTable()', 'Owner can preview/clean test tickets'],
  ['toggleSelectedOrderComplimentary()', 'Owner can classify free meals'],
  ['refreshAdminAccountsSummary()', 'Account stats refresh without resetting controls'],
  ['Only the Owner/Counter using the Admin login can confirm receipt of payment.', 'Only the counter admin can confirm money received'],
  ['/^[0-9]{1,2}$/.test(tableNumber)', 'Payment form validates table number']
].forEach(([needle, label]) => requireText(html, needle, label));

[
  ['CREATE OR REPLACE FUNCTION public.mm_place_order', 'Direct-kitchen migration replaces the order RPC'],
  ['DROP TRIGGER IF EXISTS mm_notify_owner_pending_order_trigger', 'Owner approval trigger is removed'],
  ["'New customer order received'", 'Legacy orders are surfaced to kitchen'],
  ['Customer session is missing', 'Customer session validation remains active'],
].forEach(([needle, label]) => requireText(directKitchenMigration, needle, label));
if (live.includes('if (!actorRole) dispatchStaffPushForGuestRequest(created);')) {
  fail('Guest orders must not dispatch owner order push notifications');
} else {
  console.log('✓ Guest orders do not dispatch owner order push notifications');
}
[
  ['CREATE OR REPLACE FUNCTION public.mm_cancel_public_order', 'Token-verified customer cancellation RPC exists'],
  ['CREATE OR REPLACE FUNCTION public.mm_admin_preview_table_cleanup', 'Owner preview function exists'],
  ['CREATE OR REPLACE FUNCTION public.mm_admin_clear_table_orders', 'Owner cleanup RPC exists'],
  ['CREATE OR REPLACE FUNCTION public.mm_admin_set_complimentary', 'Complimentary accounting RPC exists'],
  ['CREATE OR REPLACE FUNCTION public.mm_get_public_table_bill', 'Public bill amount comes from shared outstanding balances'],
  ['CREATE OR REPLACE FUNCTION public.mm_staff_record_table_payment', 'Server-side payment ledger exists'],
  ["IF public.get_my_staff_role() IS DISTINCT FROM 'admin' THEN", 'Table-level payment recording requires the Owner/Counter Admin login'],
  ["set_config('app.mm_payment_status', 'on', true)", 'Final payment closes a fully paid ticket'],
  ['ORDER_FULLY_PAID', 'Fully-paid tickets create an audit event'],
  ['CREATE OR REPLACE FUNCTION public.mm_admin_accounts_summary', 'Database-wide account summary exists'],
  ['CREATE OR REPLACE FUNCTION public.mm_admin_get_order_details', 'Owner lookup returns order history and line items'],
  ['CREATE TABLE IF NOT EXISTS public.order_management_audit', 'Accounting audit table exists'],
  ['CREATE TABLE IF NOT EXISTS public.order_payments', 'Shared payment table exists'],
  ["IF public.get_my_staff_role() IS DISTINCT FROM 'admin' THEN", 'Payment RPC rejects non-admin staff identities'],
  ['Paid or cancelled orders cannot be reopened', 'Cancelled/paid tickets cannot silently reappear'],
  ['This ticket already has recorded payments.', 'Normal cancellation is blocked after money is recorded'],
  ["set_config('app.mm_owner_table_cleanup', 'on', true)", 'Owner test cleanup is the only payment-cancellation exception'],
  ['Staff must use the staff workflow', 'Staff cannot use the customer cancellation endpoint']
].forEach(([needle, label]) => requireText(migration, needle, label));

requireText(legacyCancellation, 'DEPRECATED', 'Legacy customer cancellation migration is marked deprecated');
if (legacyCancellation.includes('CREATE OR REPLACE FUNCTION public.mm_guard_order_update')) {
  fail('Deprecated cancellation migration must not overwrite the accounting/order-status guard');
}
requireText(setup, 'CREATE OR REPLACE FUNCTION public.mm_admin_clear_table_orders', 'Fresh setup includes owner cleanup');
requireText(setup, 'CREATE OR REPLACE FUNCTION public.mm_staff_record_table_payment', 'Fresh setup includes payment ledger');
requireText(setup, 'Staff must use the staff workflow', 'Fresh setup protects customer cancellation RPC');
requireText(publicBoard, 'o.archived_at IS NULL', 'Public board filters archived orders');
[
  [live, 'window.MM_CANCEL_ADMIN_ORDER = cancelAdminOrder;', 'Owner ticket cancellation export exists'],
  [live, 'window.MM_ADMIN_GET_ORDER_DETAILS = getAdminOrderDetails;', 'Owner can retrieve full ticket history by ticket number'],
  [live, 'window.MM_REFRESH_CUSTOMER_ORDERS = refreshCustomerOrders;', 'Customer can manually refresh saved ticket statuses'],
  [live, 'window.MM_SET_TABLE_VISIT_STATUS = setTableVisitStatus;', 'Table visit transitions use the shared database'],
  [live, 'var visit = await ensurePublicTableVisit(tableNumber);', 'New orders obtain the active server-issued visit ID'],
  [live, 'p_table_visit_id: visit.visit_id', 'Order RPC sends the active visit ID'],
  [live, 'customerSessionIdForVisit(visit.visit_id)', 'Each public browser receives a session ID scoped to a visit'],
  [visitBillingMigration, 'ADD COLUMN IF NOT EXISTS table_visit_id uuid', 'Orders store the active table visit ID'],
  [visitBillingMigration, 'ADD COLUMN IF NOT EXISTS customer_session_id uuid', 'Orders store a per-browser customer session ID'],
  [visitBillingMigration, "'visit_id', v_visit_id", 'Visit creation returns its stable ID'],
  [visitBillingMigration, 'p_table_visit_id uuid DEFAULT NULL', 'Order RPC accepts the server-issued visit ID'],
  [visitBillingMigration, 'p_customer_session_id uuid DEFAULT NULL', 'Order RPC accepts the visit-scoped customer session ID'],
  [visitBillingMigration, 'orders_table_visit_id_fkey', 'Order-to-visit foreign key is guarded'],
  [visitBillingMigration, 'pg_advisory_xact_lock', 'Order placement serializes active visit selection'],
  [visitBillingMigration, 'The table visit has changed.', 'Stale visit submissions are rejected'],
  [tableVisitsMigration, 'CREATE TABLE IF NOT EXISTS public.restaurant_table_visits', 'Persistent table visits are recorded in the shared database'],
  [tableVisitsMigration, 'mm_staff_get_table_visits', 'Staff can load shared table availability'],
  [tableVisitsMigration, 'mm_staff_set_table_visit_status', 'Table visit transitions use guarded server-side RPCs'],
  [tableVisitsMigration, "upper(coalesce(o.status, '')) IN ('NEW', 'PREPARING', 'READY')", 'Table cannot finish while a kitchen ticket is active'],
  [tableVisitsMigration, 'v_due,', 'Table finish checks unpaid bills'],
  [html, 'function lookupAdminTicket()', 'Owner ticket lookup UI exists'],
  [html, 'id="home-my-orders"', 'Customer Home has a persistent saved-order control'],
  [html, "window.mmI18n('My orders', 'माझ्या ऑर्डर्स')", 'Customer Home always shows a My orders control'],
  [html, "if (typeof window.renderCustomerHomeOrders === 'function') window.renderCustomerHomeOrders();", 'Home order link initializes on first page load'],
  [html, 'w-secondary-alert', 'Routine waiter alerts have a lower-priority host below the table picker'],
  [html, 'function finishTableVisit()', 'Waiter has an explicit table-visit completion action'],
  [html, 'id="w-visit-control"', 'Waiter can review table visit state from the selected table'],
  [html, 'accounts-clean-confirm', 'Cleanup requires explicit owner confirmation'],
  [html, 'async function executeTableCleanup()', 'Cleanup confirmation has a separate handler'],
  [migration, 'p_expected_fingerprint text', 'Cleanup rejects stale table previews'],
  [migration, 'owner_cancel_count', 'Owner cancellations appear in accounts stats'],
  [migration, "(p.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day", 'Daily received money follows payment date'],
  [setup, 'CREATE OR REPLACE FUNCTION public.mm_admin_cancel_order', 'Fresh setup includes audited owner cancellation'],
  [setup, 'CREATE OR REPLACE FUNCTION public.mm_admin_get_order_details', 'Fresh setup includes owner ticket lookup'],
  [setup, 'p_expected_fingerprint text', 'Fresh setup checks cleanup snapshots']
].forEach(([source, needle, label]) => requireText(source, needle, label));


function checkSqlDollarQuotes(source, label) {
  if (/^\s*AS\s+\$\s*$/m.test(source) || /^\s*\$;\s*$/m.test(source)) {
    fail(label + ' contains an invalid bare dollar-quote delimiter');
    return;
  }
  const openings = [...source.matchAll(/^\s*(?:AS|DO)\s+(\$[A-Za-z0-9_]*\$)\s*$/gm)].map((m) => m[1]);
  const closings = [...source.matchAll(/^\s*(\$[A-Za-z0-9_]*\$);?\s*$/gm)].map((m) => m[1]);
  const counts = (items) => items.reduce((all, item) => {
    all[item] = (all[item] || 0) + 1;
    return all;
  }, Object.create(null));
  const openCounts = counts(openings);
  const closeCounts = counts(closings);
  const tags = new Set([...Object.keys(openCounts), ...Object.keys(closeCounts)]);
  for (const tag of tags) {
    if ((openCounts[tag] || 0) !== (closeCounts[tag] || 0)) {
      fail(label + ' has unmatched SQL function delimiter ' + tag);
      return;
    }
  }
  console.log('✓ ' + label + ' dollar-quoted function bodies are balanced');
}
function checkCleanupCounterReset(source, label) {
  const start = source.indexOf('CREATE OR REPLACE FUNCTION public.mm_admin_clear_table_orders(');
  const comparison = source.indexOf('IF v_count <> p_expected_count', start);
  const reset = source.indexOf('v_count := 0;', comparison);
  const loop = source.indexOf('FOR v_order IN', comparison);
  if (start < 0 || comparison < start || reset <= comparison || loop <= reset) {
    fail(label + ' must reset the preview count before counting archived orders');
  } else {
    console.log('✓ ' + label + ' resets the archived-ticket counter after preview validation');
  }
}
checkSqlDollarQuotes(migration, 'Accounting migration');
checkSqlDollarQuotes(setup, 'Fresh setup SQL');
checkSqlDollarQuotes(tableVisitsMigration, 'Table visits migration');
checkSqlDollarQuotes(visitBillingMigration, 'Visit billing upgrade migration');
checkSqlDollarQuotes(partyBookingsMigration, 'Party bookings migration');
checkSqlDollarQuotes(paymentConfirmationMigration, 'Customer payment verification migration');
checkSqlDollarQuotes(cashCounterMigration, 'Customer cash-at-counter migration');
checkSqlDollarQuotes(visitServiceControlsMigration, 'Waiter assignment and secure ordering migration');
checkSqlDollarQuotes(menuOptionsMigration, 'Per-dish options and seating capacity migration');
checkSqlDollarQuotes(ownerToolkitMigration, 'Owner waiter directory and backup/reset migration');
requireText(live, 'window.MM_LIST_WAITERS = listWaiters', 'Waiter name roster RPC is connected');
requireText(live, 'window.MM_ADMIN_EXPORT_BACKUP = exportOwnerBackup', 'Owner data backup export RPC is connected');
requireText(live, 'window.MM_ADMIN_RESET_APP = resetOwnerBusinessData', 'Owner reset RPC is connected');
requireText(ownerToolkitMigration, 'CREATE TABLE IF NOT EXISTS public.mm_waiter_directory', 'Waiter directory is shared across devices');
requireText(ownerToolkitMigration, "SELECT 'W' || lpad(g.n::text, 2, '0')", 'Waiter IDs are generated from the shared directory');
requireText(ownerToolkitMigration, 'CREATE OR REPLACE FUNCTION public.mm_admin_export_backup()', 'Owner JSON backup export RPC exists');
requireText(ownerToolkitMigration, 'CREATE OR REPLACE FUNCTION public.mm_admin_reset_business_data(', 'Owner reset RPC exists');
requireText(ownerToolkitMigration, "p_confirmation IS DISTINCT FROM 'RESET MIRCH MASAALA'", 'Database reset has a second typed confirmation gate');
if (html.includes('window.loadRemoteData') || html.includes('id="set-url"') || html.includes('mm_remote_menu')) {
  fail('Legacy remote JSON menu override should be removed to keep one source of truth');
} else {
  console.log('✓ Legacy remote menu override removed');
}
checkSqlDollarQuotes(fs.readFileSync('scripts/check-cash-counter-release.sql', 'utf8'), 'Cash counter checkout QA script');
requireText(paymentConfirmationMigration, 'CREATE OR REPLACE FUNCTION public.mm_guest_request_payment_check', 'Customer payment verification RPC exists');
requireText(cashCounterMigration, 'CREATE OR REPLACE FUNCTION public.mm_guest_cash_counter_release', 'Cash checkout is authorized and committed server-side');
requireText(cashCounterMigration, 'CREATE OR REPLACE FUNCTION public.mm_guest_get_visit_bill', 'Customer bill lookup is visit-scoped');
requireText(cashCounterMigration, 'CREATE OR REPLACE FUNCTION public.mm_staff_record_visit_payment', 'Staff settlement is scoped to the original visit');
requireText(cashCounterMigration, "IF public.get_my_staff_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Only the Owner/Counter (Admin login) can confirm and record payments'; END IF;", 'Visit payment recording requires the Owner/Counter Admin login');
requireText(html, 'DIRECT GUEST TO COUNTER · ACKNOWLEDGE', 'Waiter is told to direct the guest to counter instead of approving payment');
requireText(visitServiceControlsMigration, 'CREATE OR REPLACE FUNCTION public.mm_staff_release_abandoned_visit', 'Staff can release a table after guests leave');
requireText(visitServiceControlsMigration, 'p_guest_order_code text DEFAULT NULL', 'Secure order RPC validates the table PIN');
requireText(visitServiceControlsMigration, "ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'APPROVED'", 'Order approval status is stored in the shared database');
requireText(visitServiceControlsMigration, "THEN 'PENDING' ELSE 'APPROVED' END", 'Guest orders can wait for owner approval');
requireText(visitServiceControlsMigration, 'CREATE OR REPLACE FUNCTION public.mm_admin_review_customer_order', 'Only owner/admin can approve or reject customer orders');
requireText(visitServiceControlsMigration, "'ORDER_APPROVAL'", 'Pending customer orders create owner alerts');
if (html.includes('Needs your approval') || html.includes('Awaiting approval') || html.includes('Owner approval is not connected')) {
  fail('Retired owner approval UI should not appear in direct-kitchen flow');
} else {
  console.log('✓ Owner Orders is observer-only; approval UI removed');
}
requireText(live, 'window.MM_ADMIN_REVIEW_CUSTOMER_ORDER = reviewCustomerOrder', 'Owner approval buttons call the shared database');
requireText(staffPushEdge, '"ORDER_APPROVAL"', 'Background push sender supports owner order approval alerts');
if (html.includes('id="customer-order-code"') || html.includes('6-digit table code from your waiter')) {
  fail('Customer checkout must not request a table PIN');
} else {
  console.log('✓ Customer checkout does not request a table PIN');
}
requireText(html, 'function cycleDishSpice', 'Customer can choose spice per dish');
requireText(html, 'dishImageMarkup(item', 'Menu cards and specials use available dish photos');
requireText(html, 'function saveTableCapacity()', 'Owner can manage table seating capacity');
requireText(live, 'MM_SET_TABLE_CAPACITY', 'Owner capacity action is connected to Supabase');
requireText(menuOptionsMigration, "ADD COLUMN IF NOT EXISTS spice_level text NOT NULL DEFAULT 'normal'", 'Per-dish spice is persisted');
requireText(menuOptionsMigration, 'ADD COLUMN IF NOT EXISTS seating_capacity smallint NOT NULL DEFAULT 4', 'Table seating capacity is persisted');
requireText(menuOptionsMigration, 'CREATE OR REPLACE FUNCTION public.mm_admin_set_table_capacity', 'Owner capacity RPC exists');
requireText(menuOptionsMigration, 'GRANT EXECUTE ON FUNCTION public.mm_place_order(uuid, text, text, text, jsonb, uuid, uuid, text) TO anon, authenticated;', 'Dish-options order RPC grant matches the function signature');
const homeOrdersStart = html.indexOf('function renderCustomerHomeOrders()');
const homeOrdersEnd = html.indexOf('function renderPublicOrderBoard(', homeOrdersStart);
const homeOrdersRenderer = html.slice(homeOrdersStart, homeOrdersEnd);
if (homeOrdersStart < 0 || homeOrdersEnd < 0 || homeOrdersRenderer.includes("host.style.display = 'none'")) {
  fail('Customer Home must keep the My orders control visible even when there are no saved tickets');
} else {
  console.log('✓ Customer Home My orders control remains visible for returning guests');
}
requireText(menuOptionsMigration, "'spiceLevel', coalesce(oi.spice_level, 'normal')", 'Customer ticket returns saved spice');
const sharedOrderStart = live.indexOf('async function createSharedOrder(');
const sharedOrderEnd = live.indexOf('async function placeCustomerOrder(', sharedOrderStart);
if (sharedOrderStart < 0 || sharedOrderEnd < 0 || live.slice(sharedOrderStart, sharedOrderEnd).includes('window.prompt(')) {
  fail('Customer table code must not depend on a browser prompt');
} else {
  console.log('✓ Customer ordering does not use a browser PIN prompt');
}
requireText(visitServiceControlsMigration, 'ADD COLUMN IF NOT EXISTS target_staff_code', 'Alerts can target the assigned waiter ID');
requireText(visitServiceControlsMigration, "'GUEST_LEFT_UNPAID'", 'Unpaid abandoned visits create a distinct alert');
requireText(cashCounterMigration, "'CASH_AT_COUNTER'", 'Cash checkout creates a dedicated owner/waiter alert');
requireText(cashCounterMigration, 'o.table_visit_id=v_visit.id', 'Old unpaid balances never spill into a new table visit');
requireText(paymentConfirmationMigration, "'PAYMENT_CHECK'", 'Payment verification notifications have a distinct type');
requireText(paymentConfirmationMigration, "ARRAY['waiter','admin']::text[]", 'Payment verification alerts target both owner and waiter');
requireText(paymentConfirmationMigration, "v_method NOT IN ('upi','gpay','phonepe')", 'Payment verification rejects unsupported methods');
requireText(partyBookingsMigration, 'CREATE OR REPLACE FUNCTION public.mm_submit_party_booking', 'Party request validation RPC exists');
requireText(partyBookingsMigration, 'CREATE OR REPLACE FUNCTION public.mm_admin_list_party_bookings', 'Owner party list RPC exists');
requireText(partyBookingsMigration, 'CREATE OR REPLACE FUNCTION public.mm_admin_update_party_booking', 'Owner party status RPC exists');
requireText(partyBookingsMigration, "'PARTY_BOOKING'", 'Party request creates an owner alert');
requireText(staffPushEdge, '"PARTY_BOOKING"', 'Background push sender supports party booking alerts');
requireText(staffPushEdge, '"PAYMENT_CHECK"', 'Background push sender supports payment verification alerts');
requireText(staffPushEdge, '"CASH_AT_COUNTER"', 'Background push sender supports urgent cash collection alerts');
requireText(staffPushEdge, 'GUEST_LEFT_UNPAID', 'Background push sender supports abandoned-visit collection alerts');
requireText(staffPushEdge, '"PAYMENT_CHECK", "CASH_AT_COUNTER"', 'Cash collection is included in the push dispatch allowlist');
requireText(staffPushEdge, '|| type === "CASH_AT_COUNTER"', 'Cash collection pushes remain visible until staff attends');
checkCleanupCounterReset(migration, 'Accounting migration');
checkCleanupCounterReset(setup, 'Fresh setup SQL');
if (/DELETE\s+FROM\s+public\.orders/i.test(migration)) {
  fail('Table cleanup must preserve order records rather than delete order history');
}


requireText(html, 'id="accounts-day-filter"', 'Owner stats can select a historical date');
requireText(html, 'requestVersion !== adminStatsRequestVersion', 'Stale account-stat responses cannot overwrite a newer date selection');
const waiterStart = html.indexOf('function drawWaiterOrders()');
const waiterEnd = html.indexOf('/* Kitchen */', waiterStart);
const waiterQueue = html.slice(waiterStart, waiterEnd > waiterStart ? waiterEnd : undefined);
if (!waiterQueue.includes('!o.is_test_order && !o.archived_at')) {
  fail('Waiter recent-ticket view must exclude archived/test orders after table cleanup');
} else {
  console.log('✓ Waiter recent-ticket view excludes archived/test orders');
}

const kitchenStart = html.indexOf('function drawK()');
const kitchenDeclaration = html.indexOf('var operationalOrders =', kitchenStart);
const kitchenUse = html.indexOf('operationalOrders.filter', kitchenStart);
if (kitchenDeclaration < 0 || kitchenUse < 0 || kitchenDeclaration > kitchenUse) {
  fail('Kitchen queue variable must be initialized before use');
}

if (html.includes("o.status = 'CANCELLED'; save('mm_o', orders)")) fail('Unsafe local-only cancellation code remains');
if (html.includes("o.status = 'PAID';")) fail('Unsafe local-only payment status mutation remains');
if (process.exitCode) process.exit(process.exitCode);
console.log('✓ Order lifecycle and accounting QA source checks passed');
