-- Mirch Masaala: link each order to the active table visit and a per-browser customer session.
-- Run AFTER setup-live.sql, order-management-accounting.sql, and table-visits.sql.
-- This migration is additive: it preserves existing orders, items and payment history.

BEGIN;

ALTER TABLE public.restaurant_table_visits
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS table_visit_id uuid,
  ADD COLUMN IF NOT EXISTS customer_session_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_table_visit_id_fkey'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_table_visit_id_fkey
      FOREIGN KEY (table_visit_id)
      REFERENCES public.restaurant_table_visits(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ix_orders_table_visit_created
  ON public.orders (table_visit_id, created_at DESC)
  WHERE table_visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_orders_customer_session
  ON public.orders (table_visit_id, customer_session_id)
  WHERE customer_session_id IS NOT NULL;

-- Attach only tickets that belong to a visit that was already seeded/open at its creation time.
-- Older history is deliberately preserved without guessing which group it belongs to.
UPDATE public.orders o
SET table_visit_id = v.id,
    customer_session_id = COALESCE(o.customer_session_id, NULL)
FROM public.restaurant_table_visits v
WHERE o.table_visit_id IS NULL
  AND o.restaurant_id = v.restaurant_id
  AND o.table_id = v.table_id
  AND v.status = 'OPEN'
  AND o.created_at >= v.started_at
  AND coalesce(o.is_test_order, false) = false
  AND o.archived_at IS NULL
  AND upper(coalesce(o.status, '')) <> 'CANCELLED';

UPDATE public.restaurant_table_visits v
SET last_activity_at = COALESCE((
  SELECT max(COALESCE(o.updated_at, o.created_at))
  FROM public.orders o
  WHERE o.table_visit_id = v.id
), v.started_at)
WHERE v.last_activity_at IS NULL OR v.last_activity_at < v.started_at;

CREATE OR REPLACE FUNCTION public.mm_touch_table_visit_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
BEGIN
  IF NEW.table_visit_id IS NOT NULL THEN
    UPDATE public.restaurant_table_visits
    SET last_activity_at = now()
    WHERE id = NEW.table_visit_id
      AND restaurant_id = NEW.restaurant_id
      AND status = 'OPEN';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS mm_touch_table_visit_activity ON public.orders;
CREATE TRIGGER mm_touch_table_visit_activity
AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.mm_touch_table_visit_activity();

CREATE OR REPLACE FUNCTION public.mm_ensure_public_table_visit(p_table_number text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table_number text;
  v_table_id uuid;
  v_visit_id uuid;
  v_started_at timestamptz;
  v_last_activity_at timestamptz;
BEGIN
  IF p_table_number IS NULL OR trim(p_table_number) !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Choose a valid table number';
  END IF;
  v_table_number := lpad(trim(p_table_number), 2, '0');

  SELECT t.id INTO v_table_id
  FROM public.restaurant_tables t
  WHERE t.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text, 2, '0') = v_table_number
    AND t.is_active = true
  LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_table_id::text));

  SELECT v.id, v.started_at, v.last_activity_at
    INTO v_visit_id, v_started_at, v_last_activity_at
  FROM public.restaurant_table_visits v
  WHERE v.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND v.table_id = v_table_id AND v.status = 'OPEN'
  ORDER BY v.started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_visit_id IS NULL THEN
    INSERT INTO public.restaurant_table_visits
      (restaurant_id, table_id, table_number, status, started_at, last_activity_at, started_by)
    VALUES (
      'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid,
      v_table_id, v_table_number, 'OPEN', now(), now(), auth.uid()
    )
    ON CONFLICT (restaurant_id, table_id) WHERE status = 'OPEN' DO NOTHING;

    SELECT v.id, v.started_at, v.last_activity_at
      INTO v_visit_id, v_started_at, v_last_activity_at
    FROM public.restaurant_table_visits v
    WHERE v.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND v.table_id = v_table_id AND v.status = 'OPEN'
    ORDER BY v.started_at DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'table_number', v_table_number,
    'status', 'OPEN',
    'visit_id', v_visit_id,
    'started_at', v_started_at,
    'last_activity_at', v_last_activity_at
  );
END
$$;

-- Replace the old 5-argument RPC with an extended version. The final two arguments
-- have defaults so older callers can still submit orders during a staged frontend rollout.
DROP FUNCTION IF EXISTS public.mm_place_order(uuid, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.mm_place_order(
  p_restaurant_id uuid,
  p_table_number text,
  p_ticket_id text,
  p_notes text,
  p_items jsonb,
  p_table_visit_id uuid DEFAULT NULL,
  p_customer_session_id uuid DEFAULT NULL
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
    IF p_table_visit_id IS NOT NULL THEN
      RAISE EXCEPTION 'The table visit has changed. Refresh the table and submit the order again.';
    END IF;
    INSERT INTO public.restaurant_table_visits
      (restaurant_id, table_id, table_number, status, started_at, last_activity_at, started_by)
    VALUES (p_restaurant_id, v_table_id, v_table_number, 'OPEN', now(), now(), auth.uid())
    RETURNING id INTO v_visit_id;
  ELSIF p_table_visit_id IS NOT NULL AND p_table_visit_id IS DISTINCT FROM v_visit_id THEN
    RAISE EXCEPTION 'The table visit has changed. Refresh the table and submit the order again.';
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
     status, notes, total, ticket_id)
  VALUES
    (p_restaurant_id, v_table_id, v_visit_id, p_customer_session_id,
     'NEW', left(trim(coalesce(p_notes, '')), 1000), v_total, p_ticket_id)
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
    'notes', v_order.notes,
    'createdAt', v_order.created_at,
    'orderNumber', v_order.order_number,
    'items', v_items
  );
END
$$;

REVOKE ALL ON FUNCTION public.mm_ensure_public_table_visit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_ensure_public_table_visit(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.mm_place_order(uuid, text, text, text, jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_place_order(uuid, text, text, text, jsonb, uuid, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
