-- Mirch Masaala: per-dish spice/notes, customer ticket details, and seating capacity.
-- Run AFTER setup-live.sql, order-management-accounting.sql, table-visits.sql,
-- visit-billing-upgrade.sql, customer-cash-counter.sql, and visit-service-controls.sql.
-- Order rows and financial history are preserved.
BEGIN;
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
  v_guest_order_code text;
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

  SELECT v.id, v.guest_order_code INTO v_visit_id, v_guest_order_code
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

  IF coalesce(public.get_my_staff_role(), '') = '' THEN
    IF p_customer_session_id IS NULL THEN
      RAISE EXCEPTION 'Customer session is missing. Refresh this page and try again.';
    END IF;
    IF p_guest_order_code IS NULL OR trim(p_guest_order_code) !~ '^[0-9]{6}$'
       OR trim(p_guest_order_code) IS DISTINCT FROM v_guest_order_code THEN
      RAISE EXCEPTION 'The 6-digit table order code is incorrect. Please check it with your waiter.';
    END IF;
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
     status, notes, total, ticket_id)
  VALUES
    (p_restaurant_id, v_table_id, v_visit_id, p_customer_session_id,
     'NEW', left(trim(coalesce(p_notes, '')), 1000), v_total, p_ticket_id)
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
    'notes', v_order.notes,
    'createdAt', v_order.created_at,
    'orderNumber', v_order.order_number,
    'items', v_items
  );
END
$$;
REVOKE ALL ON FUNCTION public.mm_place_order(uuid, text, text, jsonb, jsonb, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_place_order(uuid, text, text, jsonb, jsonb, uuid, uuid, text) TO anon, authenticated;

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
    'notes', v_order.notes,
    'createdAt', v_order.created_at,
    'items', v_items
  );
END
$$;
REVOKE ALL ON FUNCTION public.mm_get_public_order(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_public_order(text, uuid) TO anon, authenticated;

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

COMMIT;
