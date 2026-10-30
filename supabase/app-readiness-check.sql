-- Mirch Masaala read-only deployment preflight.
-- Run in Supabase SQL Editor AFTER applying the live-order and dependent migrations.
-- This script only reports readiness; it does not change data or schema.
-- ACTION REQUIRED = the ordering app cannot work without it.
-- OPTIONAL — NOT CONFIGURED = a separate feature (background push, party bookings) that is simply
--   switched off until its own SQL file is applied; the rest of the app keeps working.
-- READY rows always say 'No action needed'. Run only the file named on a row that is NOT READY.

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
         CASE
           WHEN to_regclass('public.mm_staff_push_subscriptions') IS NULL THEN
             'Table is missing: after verifying a backup, apply supabase/staff-push-notifications.sql'
           WHEN NOT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'mm_staff_push_subscriptions'
               AND column_name = 'preferred_language'
           ) THEN
             'Column preferred_language is MISSING (older table): after verifying a backup, apply only supabase/staff-push-notifications.sql; do not rerun other READY migrations'
           ELSE
             'Column preferred_language exists but is not text NOT NULL DEFAULT ''en'': after verifying a backup, apply only supabase/staff-push-notifications.sql; do not rerun other READY migrations'
         END
  UNION ALL
  SELECT 'Push dispatch columns on notifications (push_sent_at, push_dispatch_token, target_staff_code)', false,
         (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'mm_restaurant_notifications'
            AND column_name IN ('push_sent_at', 'push_dispatch_token', 'target_staff_code')) = 3,
         'Apply only supabase/staff-push-notifications.sql (after verifying a backup)'
  UNION ALL
  SELECT 'Staff push subscription row-level security and own-subscription policy', false,
         COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.mm_staff_push_subscriptions')), false)
           AND EXISTS (
             SELECT 1 FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = 'mm_staff_push_subscriptions'
               AND p.policyname = 'mm_staff_push_manage_own_subscription'
           ),
         'Apply only supabase/staff-push-notifications.sql (after verifying a backup)'
  UNION ALL
  -- role-notifications.sql defines this RPC without push tokens; only the version installed by
  -- staff-push-notifications.sql returns dispatch_tokens, so inspect the function body.
  SELECT 'Guest waiter-call / bill-request RPC with push dispatch tokens', false,
         COALESCE(
           pg_get_functiondef(to_regprocedure('public.mm_create_guest_notification(uuid, text, text)')) ILIKE '%dispatch_tokens%',
           false),
         'Apply only supabase/staff-push-notifications.sql (after verifying a backup)'
  UNION ALL
  SELECT 'Staff push device registration RPC (re-enrol a shared phone)', false,
         to_regprocedure('public.mm_register_staff_push_subscription(text, jsonb, text, text, text)') IS NOT NULL,
         'Apply only supabase/staff-push-notifications.sql (after verifying a backup)'
  UNION ALL
  SELECT 'Party booking table', false,
         to_regclass('public.mm_party_bookings') IS NOT NULL,
         'Apply only supabase/party-bookings.sql (after verifying a backup)'
  UNION ALL
  SELECT 'Party booking submit RPC (customer request form)', false,
         to_regprocedure('public.mm_submit_party_booking(text, text, text, date, time, integer, text)') IS NOT NULL,
         'Apply only supabase/party-bookings.sql (after verifying a backup)'
  UNION ALL
  SELECT 'Party booking owner list and status RPCs', false,
         to_regprocedure('public.mm_admin_list_party_bookings(integer)') IS NOT NULL
           AND to_regprocedure('public.mm_admin_update_party_booking(uuid, text, text)') IS NOT NULL,
         'Apply only supabase/party-bookings.sql (after verifying a backup)'
)
SELECT
  component,
  CASE
    WHEN ready THEN 'READY'
    WHEN required THEN 'ACTION REQUIRED'
    ELSE 'OPTIONAL — NOT CONFIGURED'
  END AS status,
  -- A READY component needs nothing. Never tell the owner to rerun a migration that is already applied.
  CASE WHEN ready THEN 'No action needed' ELSE next_step END AS next_step
FROM dependencies
ORDER BY
  CASE WHEN ready THEN 2 WHEN required THEN 0 ELSE 1 END,
  component;
