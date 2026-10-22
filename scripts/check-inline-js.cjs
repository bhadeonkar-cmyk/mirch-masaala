const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const live = fs.readFileSync('supabase-live.js', 'utf8');
const migration = fs.readFileSync('supabase/order-management-accounting.sql', 'utf8');
const setup = fs.readFileSync('supabase/setup-live.sql', 'utf8');
const publicBoard = fs.readFileSync('supabase/public-table-status-circles.sql', 'utf8');
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
  ['MM_LOAD_ADMIN_ACCOUNTS_SUMMARY', 'Stats use authoritative shared accounts'],
  ['MM_LOAD_ADMIN_PAYMENTS', 'Payment log reads shared receipts']
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
  ['CREATE OR REPLACE FUNCTION public.mm_staff_record_table_payment', 'Server-side payment ledger exists'],
  ['CREATE OR REPLACE FUNCTION public.mm_admin_accounts_summary', 'Database-wide account summary exists'],
  ['CREATE TABLE IF NOT EXISTS public.order_management_audit', 'Accounting audit table exists'],
  ['CREATE TABLE IF NOT EXISTS public.order_payments', 'Shared payment table exists'],
  ['coalesce(public.get_my_staff_role(), \'\') NOT IN (\'admin\', \'waiter\')', 'Payment RPC rejects non-staff identities'],
  ['Paid or cancelled orders cannot be reopened', 'Cancelled/paid tickets cannot silently reappear'],
  ['Staff must use the staff workflow', 'Staff cannot use the customer cancellation endpoint']
].forEach(([needle, label]) => requireText(migration, needle, label));

requireText(setup, 'CREATE OR REPLACE FUNCTION public.mm_admin_clear_table_orders', 'Fresh setup includes owner cleanup');
requireText(setup, 'CREATE OR REPLACE FUNCTION public.mm_staff_record_table_payment', 'Fresh setup includes payment ledger');
requireText(setup, 'Staff must use the staff workflow', 'Fresh setup protects customer cancellation RPC');
requireText(publicBoard, 'o.archived_at IS NULL', 'Public board filters archived orders');

if (html.includes("o.status = 'CANCELLED'; save('mm_o', orders)")) fail('Unsafe local-only cancellation code remains');
if (html.includes("o.status = 'PAID';")) fail('Unsafe local-only payment status mutation remains');
if (process.exitCode) process.exit(process.exitCode);
console.log('✓ Order lifecycle and accounting QA source checks passed');
