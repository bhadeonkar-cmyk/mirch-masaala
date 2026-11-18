-- Mirch Masaala: consolidated QR-to-kitchen ordering (final order RPC).
-- Run LAST, after visit-service-controls.sql, direct-kitchen-qr-orders.sql and
-- menu-item-options-and-table-capacity.sql. Safe to re-run.
--
-- Why this file exists:
--   * direct-kitchen-qr-orders.sql removed the six-digit guest code and routed
--     customer orders straight to the kitchen (approval_status APPROVED).
--   * menu-item-options-and-table-capacity.sql then redefined mm_place_order
--     again, re-introducing the six-digit code requirement and dropping the
--     explicit APPROVED status. Applied after direct-kitchen it broke every
--     customer order, because the app sends p_guest_order_code => null.
-- This migration installs ONE final mm_place_order that keeps both feature
-- sets: QR + waiter-opened visit + customer session (no manual code) AND
-- per-dish spice levels / special instructions, plus seating capacity and the
-- option-aware ticket lookups. It also installs the public table-visit gate
-- (read-only mm_public_table_visit_status + strict mm_ensure_public_table_visit)
-- so customers are blocked before the waiter seats the table and unlock after.
-- Existing orders and financial history are
-- preserved; unresolved legacy approval tickets are released to the kitchen.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.restaurant_table_visits') IS NULL
     OR to_regclass('public.orders') IS NULL
     OR to_regclass('public.restaurant_tables') IS NULL
     OR to_regclass('public.mm_restaurant_notifications') IS NULL THEN
    RAISE EXCEPTION 'Run table-visits.sql, visit-billing-upgrade.sql, customer-cash-counter.sql, role-notifications.sql, and visit-service-controls.sql first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attname='approval_status' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attname='table_visit_id' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attname='customer_session_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Run supabase/visit-service-controls.sql before this migration.';
  END IF;
  IF to_regprocedure('public.mm_notify_kitchen_new_order()') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/role-notifications.sql before this migration.';
  END IF;
END
$$;

-- Dish options and seating capacity (idempotent; same contract as
-- menu-item-options-and-table-capacity.sql so either file may run first).
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS spice_level text NOT NULL DEFAULT 'normal';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.order_items'::regclass AND conname='order_items_spice_level_check') THEN
    ALTER TABLE public.order_items ADD CONSTRAINT order_items_spice_level_check CHECK (spice_level IN ('normal','mild','medium','hot'));
  END IF;
END
$$;
ALTER TABLE public.restaurant_tables ADD COLUMN IF NOT EXISTS seating_capacity smallint NOT NULL DEFAULT 4;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.restaurant_tables'::regclass AND conname='restaurant_tables_seating_capacity_check') THEN
    ALTER TABLE public.restaurant_tables ADD CONSTRAINT restaurant_tables_seating_capacity_check CHECK (seating_capacity BETWEEN 1 AND 30);
  END IF;
END
$$;

-- Customer orders go straight to the kitchen; the owner approval queue is retired.
ALTER TABLE public.orders ALTER COLUMN approval_status SET DEFAULT 'APPROVED';

DROP TRIGGER IF EXISTS mm_notify_owner_pending_order_trigger ON public.orders;
DROP TRIGGER IF EXISTS mm_notify_kitchen_after_owner_approval_trigger ON public.orders;
DROP FUNCTION IF EXISTS public.mm_notify_owner_pending_order();
DROP FUNCTION IF EXISTS public.mm_notify_kitchen_after_owner_approval();

DROP TRIGGER IF EXISTS mm_notify_kitchen_new_order_trigger ON public.orders;
CREATE TRIGGER mm_notify_kitchen_new_order_trigger
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.mm_notify_kitchen_new_order();

CREATE OR REPLACE FUNCTION public.mm_place_order(
  p_restaurant_id uuid,
  p_table_number text,
  p_ticket_id text,
  p_notes text,
  p_items jsonb,
  p_table_visit_id uuid DEFAULT NULL,
  p_customer_session_id uuid DEFAULT NULL,
  p_guest_order_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table_id uuid;
  v_table_number text;
  v_visit_id uuid;
  v_line jsonb;
  v_menu_id uuid;
  v_item_name text;
  v_price numeric;
  v_qty integer;
  v_spice text;
  v_item_notes text;
  v_total numeric := 0;
  v_order public.orders%ROWTYPE;
  v_items jsonb;
BEGIN
  -- p_guest_order_code is kept only for client signature compatibility. The
  -- product flow is QR scan -> waiter seating -> order; the manual six-digit
  -- code is retired. Security still requires an active table, the current
  -- waiter-opened OPEN visit, and a customer session for anonymous callers.
  IF p_restaurant_id IS DISTINCT FROM 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid THEN
    RAISE EXCEPTION 'Unknown restaurant';
  END IF;
  IF p_ticket_id IS NULL OR p_ticket_id !~ '^[A-Z0-9-]{8,64}$' THEN
    RAISE EXCEPTION 'Invalid ticket ID';
  END IF;
  IF p_table_number IS NULL OR p_table_number !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Invalid table number';
  END IF;
  v_table_number := lpad(trim(p_table_number), 2, '0');

  SELECT t.id INTO v_table_id
  FROM public.restaurant_tables AS t
  WHERE t.restaurant_id = p_restaurant_id
    AND lpad(t.table_number::text, 2, '0') = v_table_number
    AND t.is_active = true
  LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'This table is not active'; END IF;

  -- Serialise visit selection per table so concurrent scans/orders cannot split one visit.
  PERFORM pg_advisory_xact_lock(hashtext(v_table_id::text));

  SELECT v.id INTO v_visit_id
  FROM public.restaurant_table_visits v
  WHERE v.restaurant_id = p_restaurant_id
    AND v.table_id = v_table_id
    AND v.status = 'OPEN'
  ORDER BY v.started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_visit_id IS NULL THEN
    RAISE EXCEPTION 'This table is not open for online orders yet. Please ask your waiter to start the visit.';
  END IF;
  IF p_table_visit_id IS NULL OR p_table_visit_id IS DISTINCT FROM v_visit_id THEN
    RAISE EXCEPTION 'The table visit has changed. Refresh and ask your waiter for the current order code.';
  END IF;

  IF coalesce(public.get_my_staff_role(), '') = '' AND p_customer_session_id IS NULL THEN
    RAISE EXCEPTION 'Customer session is missing. Refresh this page and try again.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Add between 1 and 100 order lines';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) AS x(value)
  LOOP
    v_menu_id := NULLIF(v_line->>'menu_item_id', '')::uuid;
    v_qty := NULLIF(v_line->>'quantity', '')::integer;
    v_spice := lower(coalesce(nullif(trim(v_line->>'spice_level'), ''), 'normal'));
    v_item_notes := left(trim(coalesce(v_line->>'notes', '')), 300);
    IF v_menu_id IS NULL OR v_qty IS NULL OR v_qty < 1 OR v_qty > 99 THEN
      RAISE EXCEPTION 'Invalid menu item or quantity';
    END IF;
    IF v_spice NOT IN ('normal', 'mild', 'medium', 'hot') THEN
      RAISE EXCEPTION 'Choose a valid spice level for each dish';
    END IF;
    IF length(coalesce(v_line->>'notes', '')) > 300 THEN
      RAISE EXCEPTION 'Per-dish notes must be 300 characters or fewer';
    END IF;

    -- Prices always come from the database, never from the browser payload.
    SELECT mi.name, mi.price
      INTO v_item_name, v_price
    FROM public.menu_items AS mi
    WHERE mi.id = v_menu_id
      AND mi.restaurant_id = p_restaurant_id
      AND mi.is_available = true
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected dish is unavailable. Refresh the menu and try again.';
    END IF;
    v_total := v_total + (v_price * v_qty);
  END LOOP;

  INSERT INTO public.orders
    (restaurant_id, table_id, table_visit_id, customer_session_id,
     status, approval_status, notes, total, ticket_id)
  VALUES
    (p_restaurant_id, v_table_id, v_visit_id, p_customer_session_id,
     'NEW',
     'APPROVED',
     left(trim(coalesce(p_notes, '')), 1000), v_total, p_ticket_id)
  RETURNING * INTO v_order;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) AS x(value)
  LOOP
    v_menu_id := NULLIF(v_line->>'menu_item_id', '')::uuid;
    v_qty := NULLIF(v_line->>'quantity', '')::integer;
    v_spice := lower(coalesce(nullif(trim(v_line->>'spice_level'), ''), 'normal'));
    v_item_notes := left(trim(coalesce(v_line->>'notes', '')), 300);

    SELECT mi.name, mi.price
      INTO v_item_name, v_price
    FROM public.menu_items AS mi
    WHERE mi.id = v_menu_id
      AND mi.restaurant_id = p_restaurant_id
      AND mi.is_available = true
    FOR SHARE;

    INSERT INTO public.order_items
      (order_id, menu_item_id, item_name, quantity, price, notes, spice_level)
    VALUES
      (v_order.id, v_menu_id, v_item_name, v_qty, v_price, nullif(v_item_notes, ''), v_spice);
  END LOOP;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object(
                'name', oi.item_name, 'price', oi.price, 'qty', oi.quantity,
                'spiceLevel', coalesce(oi.spice_level, 'normal'),
                'notes', coalesce(oi.notes, '')
              ) ORDER BY oi.created_at, oi.item_name),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.order_items AS oi
  WHERE oi.order_id = v_order.id;

  RETURN jsonb_build_object(
    'id', v_order.ticket_id,
    'dbId', v_order.id,
    'publicToken', v_order.public_token,
    'table', v_table_number,
    'visitId', v_visit_id,
    'customerSessionId', p_customer_session_id,
    'total', v_order.total,
    'status', v_order.status,
    'approvalStatus', v_order.approval_status,
    'notes', v_order.notes,
    'createdAt', v_order.created_at,
    'orderNumber', v_order.order_number,
    'items', v_items,
    'notification_ids', coalesce((
      SELECT jsonb_agg(n.id ORDER BY n.id)
      FROM public.mm_restaurant_notifications n
      WHERE n.restaurant_id = v_order.restaurant_id
        AND n.target_role = 'admin'
        AND n.notification_type = 'ORDER_APPROVAL'
        AND n.ticket_id = v_order.ticket_id
        AND n.resolved_at IS NULL
    ), '[]'::jsonb),
    'dispatch_tokens', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', n.id, 'token', n.push_dispatch_token) ORDER BY n.id)
      FROM public.mm_restaurant_notifications n
      WHERE n.restaurant_id = v_order.restaurant_id
        AND n.target_role = 'admin'
        AND n.notification_type = 'ORDER_APPROVAL'
        AND n.ticket_id = v_order.ticket_id
        AND n.resolved_at IS NULL
        AND n.push_dispatch_token IS NOT NULL
    ), '[]'::jsonb)
  );
END
$$;

REVOKE ALL ON FUNCTION public.mm_place_order(uuid, text, text, text, jsonb, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_place_order(uuid, text, text, text, jsonb, uuid, uuid, text) TO anon, authenticated;

-- Option-aware customer ticket lookup (token-verified; never exposes other guests' tickets).
CREATE OR REPLACE FUNCTION public.mm_get_public_order(
  p_ticket_id text,
  p_public_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_table_number text;
  v_items jsonb;
BEGIN
  IF p_ticket_id IS NULL OR p_public_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT o.* INTO v_order
  FROM public.orders AS o
  WHERE o.ticket_id = p_ticket_id
    AND o.public_token = p_public_token
    AND o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT t.table_number INTO v_table_number
  FROM public.restaurant_tables AS t
  WHERE t.id = v_order.table_id;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object(
                'name', oi.item_name, 'price', oi.price, 'qty', oi.quantity,
                'spiceLevel', coalesce(oi.spice_level, 'normal'),
                'notes', coalesce(oi.notes, '')
              ) ORDER BY oi.created_at, oi.item_name),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.order_items AS oi
  WHERE oi.order_id = v_order.id;

  RETURN jsonb_build_object(
    'id', v_order.ticket_id,
    'table', v_table_number,
    'total', v_order.total,
    'status', v_order.status,
    'approvalStatus', v_order.approval_status,
    'notes', v_order.notes,
    'createdAt', v_order.created_at,
    'items', v_items
  );
END
$$;
REVOKE ALL ON FUNCTION public.mm_get_public_order(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_public_order(text, uuid) TO anon, authenticated;

-- Option-aware owner ticket lookup (admin only).
CREATE OR REPLACE FUNCTION public.mm_admin_get_order_details(p_ticket_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_table_number text;
  v_items jsonb;
  v_payments jsonb;
  v_paid numeric(12,2) := 0;
  v_balance numeric(12,2) := 0;
  v_status text;
BEGIN
  IF public.get_my_staff_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Owner/Admin access required';
  END IF;
  IF p_ticket_id IS NULL OR length(trim(p_ticket_id)) < 4 OR length(trim(p_ticket_id)) > 64
     OR trim(p_ticket_id) !~ '^[A-Za-z0-9-]+$' THEN
    RAISE EXCEPTION 'Enter the ticket number shown to the customer';
  END IF;

  SELECT o.* INTO v_order
  FROM public.orders AS o
  WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND upper(o.ticket_id) = upper(trim(p_ticket_id))
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found. Check the ticket number and try again.'; END IF;

  SELECT lpad(t.table_number::text, 2, '0') INTO v_table_number
  FROM public.restaurant_tables AS t WHERE t.id = v_order.table_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', oi.item_name,
      'quantity', oi.quantity,
      'unit_price', oi.price,
      'line_total', oi.price * oi.quantity,
      'notes', oi.notes,
      'spice_level', coalesce(oi.spice_level, 'normal')
    ) ORDER BY oi.created_at, oi.item_name), '[]'::jsonb)
    INTO v_items
  FROM public.order_items AS oi
  WHERE oi.order_id = v_order.id;

  SELECT coalesce(sum(p.amount), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'amount', p.amount, 'method', p.method, 'note', p.note, 'created_at', p.created_at
         ) ORDER BY p.created_at, p.id), '[]'::jsonb)
    INTO v_paid, v_payments
  FROM public.order_payments AS p
  WHERE p.order_id = v_order.id;

  v_status := upper(coalesce(v_order.status, 'NEW'));
  IF v_order.archived_at IS NOT NULL OR coalesce(v_order.is_test_order, false)
     OR coalesce(v_order.is_complimentary, false) OR v_status IN ('CANCELLED', 'PAID') THEN
    v_balance := 0;
  ELSE
    v_balance := greatest(coalesce(v_order.total, 0) - v_paid, 0);
  END IF;

  RETURN jsonb_build_object(
    'ticket_id', v_order.ticket_id,
    'order_number', v_order.order_number,
    'table', v_table_number,
    'status', v_status,
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'notes', coalesce(v_order.notes, ''),
    'total', coalesce(v_order.total, 0),
    'paid_total', v_paid,
    'balance_due', v_balance,
    'is_test_order', coalesce(v_order.is_test_order, false),
    'is_complimentary', coalesce(v_order.is_complimentary, false),
    'complimentary_reason', coalesce(v_order.complimentary_reason, ''),
    'cancel_reason', coalesce(v_order.cancel_reason, ''),
    'archived_at', v_order.archived_at,
    'items', v_items,
    'payments', v_payments
  );
END
$$;
REVOKE ALL ON FUNCTION public.mm_admin_get_order_details(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_admin_get_order_details(text) TO authenticated;

-- Owner-managed seating capacity (admin only).
CREATE OR REPLACE FUNCTION public.mm_admin_set_table_capacity(
  p_table_number text,
  p_capacity integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table_number text;
  v_capacity smallint;
BEGIN
  IF public.get_my_staff_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Owner/Admin access required';
  END IF;
  IF p_table_number IS NULL OR trim(p_table_number) !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Choose a valid table number';
  END IF;
  IF p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 30 THEN
    RAISE EXCEPTION 'Table seating capacity must be between 1 and 30';
  END IF;
  v_table_number := lpad(trim(p_table_number), 2, '0');
  v_capacity := p_capacity::smallint;
  UPDATE public.restaurant_tables AS t
  SET seating_capacity = v_capacity
  WHERE t.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text, 2, '0') = v_table_number
    AND t.is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active table % was not found', v_table_number; END IF;
  RETURN jsonb_build_object('table_number',v_table_number,'seating_capacity',v_capacity);
END
$$;
REVOKE ALL ON FUNCTION public.mm_admin_set_table_capacity(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_admin_set_table_capacity(text, integer) TO authenticated;

-- Public table-visit gate (same contract as public-table-visit-gate.sql, included here so
-- applying this final migration alone installs the complete customer ordering gate).
-- Read-only: customers only learn whether their table is seated; it never creates visits
-- and never exposes another guest's data. Only staff can open a visit.
CREATE OR REPLACE FUNCTION public.mm_public_table_visit_status(p_table_number text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table text;
  v_table_id uuid;
  v_visit_id uuid;
  v_started_at timestamptz;
BEGIN
  IF p_table_number IS NULL OR trim(p_table_number) !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Choose a valid table number';
  END IF;
  v_table := lpad(trim(p_table_number), 2, '0');

  SELECT t.id INTO v_table_id
  FROM public.restaurant_tables t
  WHERE t.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text, 2, '0') = v_table
    AND t.is_active = true
  LIMIT 1;

  IF v_table_id IS NULL THEN
    RETURN jsonb_build_object(
      'table_number', v_table,
      'status', 'UNKNOWN',
      'can_order', false,
      'message', 'Table not found'
    );
  END IF;

  SELECT v.id, v.started_at INTO v_visit_id, v_started_at
  FROM public.restaurant_table_visits v
  WHERE v.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND v.table_id = v_table_id
    AND v.status = 'OPEN'
  ORDER BY v.started_at DESC
  LIMIT 1;

  IF v_visit_id IS NULL THEN
    RETURN jsonb_build_object(
      'table_number', v_table,
      'status', 'AVAILABLE',
      'can_order', false,
      'visit_id', null,
      'message', 'Please wait for the waiter to activate this table.'
    );
  END IF;

  RETURN jsonb_build_object(
    'table_number', v_table,
    'status', 'OPEN',
    'can_order', true,
    'visit_id', v_visit_id,
    'started_at', v_started_at,
    'message', 'You are ready to order.'
  );
END
$$;
REVOKE ALL ON FUNCTION public.mm_public_table_visit_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_public_table_visit_status(text) TO anon, authenticated;

-- Ensure never auto-opens a visit: ordering requires a waiter-started OPEN visit.
CREATE OR REPLACE FUNCTION public.mm_ensure_public_table_visit(p_table_number text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table text;
  v_table_id uuid;
  v_visit public.restaurant_table_visits%ROWTYPE;
BEGIN
  IF p_table_number IS NULL OR trim(p_table_number) !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Choose a valid table number';
  END IF;
  v_table := lpad(trim(p_table_number), 2, '0');
  SELECT t.id INTO v_table_id
  FROM public.restaurant_tables t
  WHERE t.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text, 2, '0') = v_table AND t.is_active = true
  LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;

  SELECT v.* INTO v_visit
  FROM public.restaurant_table_visits v
  WHERE v.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND v.table_id = v_table_id AND v.status = 'OPEN'
  ORDER BY v.started_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This table is not open for online orders yet. Please ask your waiter to start the visit.';
  END IF;

  RETURN jsonb_build_object(
    'table_number', v_table,
    'status', 'OPEN',
    'visit_id', v_visit.id,
    'started_at', v_visit.started_at,
    'last_activity_at', v_visit.last_activity_at
  );
END
$$;
REVOKE ALL ON FUNCTION public.mm_ensure_public_table_visit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_ensure_public_table_visit(text) TO anon, authenticated;

-- Release old tickets from the approval queue (idempotent; no-op once released).
WITH released AS (
  UPDATE public.orders o
  SET approval_status = 'APPROVED',
      updated_at = now()
  WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND upper(coalesce(o.approval_status, '')) = 'PENDING'
  RETURNING o.restaurant_id, o.table_id, o.ticket_id, o.status, o.is_test_order, o.archived_at
)
INSERT INTO public.mm_restaurant_notifications (
  restaurant_id, target_role, notification_type, table_number, ticket_id, message
)
SELECT r.restaurant_id, 'kitchen', 'NEW_ORDER', lpad(t.table_number::text, 2, '0'),
       coalesce(r.ticket_id, ''), 'New customer order received'
FROM released r
JOIN public.restaurant_tables t ON t.id = r.table_id AND t.restaurant_id = r.restaurant_id
WHERE upper(coalesce(r.status, '')) = 'NEW'
  AND coalesce(r.is_test_order, false) = false
  AND r.archived_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.mm_restaurant_notifications n
    WHERE n.restaurant_id = r.restaurant_id
      AND n.target_role = 'kitchen'
      AND n.notification_type = 'NEW_ORDER'
      AND n.ticket_id = r.ticket_id
      AND n.resolved_at IS NULL
  );

UPDATE public.mm_restaurant_notifications
SET resolved_at = coalesce(resolved_at, now()),
    push_dispatch_token = NULL
WHERE restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
  AND target_role = 'admin'
  AND notification_type = 'ORDER_APPROVAL'
  AND resolved_at IS NULL;

COMMIT;