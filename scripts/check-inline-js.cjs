const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const live = fs.readFileSync('supabase-live.js', 'utf8');
const migration = fs.readFileSync('supabase/order-management-accounting.sql', 'utf8');
const setup = fs.readFileSync('supabase/setup-live.sql', 'utf8');
const publicBoard = fs.readFileSync('supabase/public-table-status-circles.sql', 'utf8');
const tableVisitsMigration = fs.readFileSync('supabase/table-visits.sql', 'utf8');
const visitBillingMigration = fs.readFileSync('supabase/visit-billing-upgrade.sql', 'utf8');
const legacyCancellation = fs.readFileSync('supabase/customer-cancel-order.sql', 'utf8');
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
  ['for (var i = 0; i < tokens.length; i++)', 'Every retained customer ticket gets status refresh'],
  [".select('ticket_id,status').maybeSingle()", 'Staff status change confirms a database row was updated'],
  [".select('id,price').maybeSingle()", 'Owner price update confirms a database row was updated'],
  [".select('id,is_available').maybeSingle()", 'Menu availability update confirms a database row was updated']
].forEach(([needle, label]) => requireText(live, needle, label));

[
  ['function cancelOrder(id)', 'Customer cancellation UI exists'],
  ['previewAndCleanTable()', 'Owner can preview/clean test tickets'],
  ['toggleSelectedOrderComplimentary()', 'Owner can classify free meals'],
  ['refreshAdminAccountsSummary()', 'Account stats refresh without resetting controls'],
  ['Only signed-in owner/waiter staff can confirm receipt of payment.', 'Customer cannot self-confirm payment'],
  ['/^[0-9]{1,2}$/.test(tableNumber)', 'Payment form validates table number']
].forEach(([needle, label]) => requireText(html, needle, label));

[
  ['CREATE OR REPLACE FUNCTION public.mm_cancel_public_order', 'Token-verified customer cancellation RPC exists'],
  ['CREATE OR REPLACE FUNCTION public.mm_admin_preview_table_cleanup', 'Owner preview function exists'],
  ['CREATE OR REPLACE FUNCTION public.mm_admin_clear_table_orders', 'Owner cleanup RPC exists'],
  ['CREATE OR REPLACE FUNCTION public.mm_admin_set_complimentary', 'Complimentary accounting RPC exists'],
  ['CREATE OR REPLACE FUNCTION public.mm_get_public_table_bill', 'Public bill amount comes from shared outstanding balances'],
  ['CREATE OR REPLACE FUNCTION public.mm_staff_record_table_payment', 'Server-side payment ledger exists'],
  ["set_config('app.mm_payment_status', 'on', true)", 'Final payment closes a fully paid ticket'],
  ['ORDER_FULLY_PAID', 'Fully-paid tickets create an audit event'],
  ['CREATE OR REPLACE FUNCTION public.mm_admin_accounts_summary', 'Database-wide account summary exists'],
  ['CREATE OR REPLACE FUNCTION public.mm_admin_get_order_details', 'Owner lookup returns order history and line items'],
  ['CREATE TABLE IF NOT EXISTS public.order_management_audit', 'Accounting audit table exists'],
  ['CREATE TABLE IF NOT EXISTS public.order_payments', 'Shared payment table exists'],
  ['coalesce(public.get_my_staff_role(), \'\') NOT IN (\'admin\', \'waiter\')', 'Payment RPC rejects non-staff identities'],
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
  [live, 'orderArgs.p_table_visit_id = visit.visit_id', 'Order RPC sends the active visit ID'],
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
  [html, 'id="home-my-orders"', 'Customer Home has a discreet saved-order control'],
  [html, 'Recheck order', 'Customer can reopen saved orders from Home with one small button'],
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
  const openings = [...source.matchAll(/^\s*AS\s+(\$[A-Za-z0-9_]*\$)\s*$/gm)].map((m) => m[1]);
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
