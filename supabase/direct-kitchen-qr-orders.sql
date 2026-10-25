-- Direct QR-to-kitchen ordering.
-- Run AFTER supabase/visit-service-controls.sql and its required visit/payment migrations.
-- A customer needs a table QR and an active waiter-opened visit, not a six-digit guest code.
-- Existing orders and payment/audit history are preserved; old approval alerts are resolved, not deleted.

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
  v_total numeric := 0;
  v_order public.orders%ROWTYPE;
  v_items jsonb;
BEGIN
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
    IF v_menu_id IS NULL OR v_qty IS NULL OR v_qty < 1 OR v_qty > 99 THEN
      RAISE EXCEPTION 'Invalid menu item or quantity';
    END IF;

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

    SELECT mi.name, mi.price
      INTO v_item_name, v_price
    FROM public.menu_items AS mi
    WHERE mi.id = v_menu_id
      AND mi.restaurant_id = p_restaurant_id
      AND mi.is_available = true
    FOR SHARE;

    INSERT INTO public.order_items
      (order_id, menu_item_id, item_name, quantity, price, notes)
    VALUES
      (v_order.id, v_menu_id, v_item_name, v_qty, v_price, NULL);
  END LOOP;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object('name', oi.item_name, 'price', oi.price, 'qty', oi.quantity)
              ORDER BY oi.created_at, oi.item_name),
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

-- Release old tickets from the approval queue. Active NEW tickets now need to appear in kitchen.
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
