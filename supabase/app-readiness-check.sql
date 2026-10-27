-- Mirch Masaala read-only deployment preflight.
-- Run in Supabase SQL Editor AFTER applying the live-order and dependent migrations.
-- This script only reports readiness; it does not change data or schema.

WITH dependencies(component, required, ready, next_step) AS (
  SELECT 'Shared orders table', true, to_regclass('public.orders') IS NOT NULL,
         'Apply supabase/setup-live.sql'
  UNION ALL
  SELECT 'Order line items table', true, to_regclass('public.order_items') IS NOT NULL,
         'Apply supabase/setup-live.sql'
  UNION ALL
  SELECT 'Active table visits', true, to_regclass('public.restaurant_table_visits') IS NOT NULL,
         'Apply supabase/table-visits.sql and supabase/visit-billing-upgrade.sql'
  UNION ALL
  SELECT 'Role notifications table', true, to_regclass('public.mm_restaurant_notifications') IS NOT NULL,
         'Apply supabase/role-notifications.sql'
  UNION ALL
  SELECT 'QR-to-kitchen order RPC (8 arguments)', true,
         to_regprocedure('public.mm_place_order(uuid, text, text, text, jsonb, uuid, uuid, text)') IS NOT NULL,
         'Apply supabase/visit-service-controls.sql, then supabase/direct-kitchen-qr-orders.sql'
  UNION ALL
  SELECT 'Public table-visit RPC', true,
         to_regprocedure('public.mm_ensure_public_table_visit(text)') IS NOT NULL,
         'Apply supabase/table-visits.sql and supabase/visit-service-controls.sql'
  UNION ALL
  SELECT 'Staff notification read RPC', true,
         to_regprocedure('public.mm_staff_notifications(integer, text)') IS NOT NULL,
         'Apply supabase/visit-service-controls.sql after supabase/role-notifications.sql'
  UNION ALL
  SELECT 'Staff notification resolve RPC', true,
         to_regprocedure('public.mm_resolve_staff_notification(bigint, text)') IS NOT NULL,
         'Apply supabase/visit-service-controls.sql after supabase/role-notifications.sql'
  UNION ALL
  SELECT 'Kitchen alert function', true,
         to_regprocedure('public.mm_notify_kitchen_new_order()') IS NOT NULL,
         'Apply supabase/role-notifications.sql'
  UNION ALL
  SELECT 'New-order kitchen alert trigger', true,
         EXISTS (
           SELECT 1 FROM pg_trigger t
           WHERE t.tgrelid = to_regclass('public.orders')
             AND t.tgname = 'mm_notify_kitchen_new_order_trigger'
             AND NOT t.tgisinternal
         ),
         'Apply supabase/direct-kitchen-qr-orders.sql'
  UNION ALL
  SELECT 'Order-ready alert trigger', true,
         EXISTS (
           SELECT 1 FROM pg_trigger t
           WHERE t.tgrelid = to_regclass('public.orders')
             AND t.tgname = 'mm_notify_order_ready_trigger'
             AND NOT t.tgisinternal
         ),
         'Apply supabase/role-notifications.sql'
  UNION ALL
  SELECT 'Notification types include payment and visit alerts', true,
         EXISTS (
           SELECT 1 FROM pg_constraint c
           WHERE c.conrelid = to_regclass('public.mm_restaurant_notifications')
             AND c.contype = 'c'
             AND pg_get_constraintdef(c.oid) ILIKE '%CASH_AT_COUNTER%'
             AND pg_get_constraintdef(c.oid) ILIKE '%GUEST_LEFT_UNPAID%'
             AND pg_get_constraintdef(c.oid) ILIKE '%PAYMENT_CHECK%'
             AND pg_get_constraintdef(c.oid) ILIKE '%PARTY_BOOKING%'
         ),
         'Re-apply supabase/customer-payment-confirmation.sql, supabase/customer-cash-counter.sql and supabase/visit-service-controls.sql in the README order'
  UNION ALL
  SELECT 'Staff push subscription table', false,
         to_regclass('public.mm_staff_push_subscriptions') IS NOT NULL,
         'Optional: apply supabase/staff-push-notifications.sql'
  UNION ALL
  SELECT 'Push language preference column/default', false,
         EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'mm_staff_push_subscriptions'
             AND column_name = 'preferred_language'
             AND data_type = 'text'
             AND is_nullable = 'NO'
             AND column_default ILIKE '%en%'
         ),
         'For background push: after verifying a recoverable database backup, apply supabase/staff-push-notifications.sql; do not rerun other READY migrations'
)
SELECT
  component,
  CASE
    WHEN ready THEN 'READY'
    WHEN required THEN 'ACTION REQUIRED'
    ELSE 'OPTIONAL — NOT CONFIGURED'
  END AS status,
  next_step
FROM dependencies
ORDER BY
  CASE WHEN ready THEN 2 WHEN required THEN 0 ELSE 1 END,
  component;
