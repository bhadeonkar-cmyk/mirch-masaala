-- Mirch Masaala: secure live-order setup
-- Run this AFTER seed-menu.sql. Uses Supabase Auth for staff access.
-- Project restaurant ID: a3702d10-6673-4c06-9783-1d61c945ecd5
-- Never put a Supabase secret/service_role key in the browser.

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ticket_id text,
  ADD COLUMN IF NOT EXISTS public_token uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS is_veg boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_bestseller boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS spicy_level integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_ticket_id
  ON public.orders (ticket_id) WHERE ticket_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_public_token
  ON public.orders (public_token);

CREATE TABLE IF NOT EXISTS public.staff_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'waiter', 'kitchen')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

-- This function returns the role attached to the signed-in Supabase Auth user.
CREATE OR REPLACE FUNCTION public.get_my_staff_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT sp.role
  FROM public.staff_profiles AS sp
  WHERE sp.user_id = auth.uid()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_my_staff_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_staff_role() TO anon, authenticated;

-- Public menu and active tables are readable; inactive items stay staff-only.
DROP POLICY IF EXISTS mm_restaurant_public_read ON public.restaurants;
CREATE POLICY mm_restaurant_public_read ON public.restaurants
  FOR SELECT TO anon, authenticated
  USING (id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid);

DROP POLICY IF EXISTS mm_tables_read ON public.restaurant_tables;
CREATE POLICY mm_tables_read ON public.restaurant_tables
  FOR SELECT TO anon, authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND (is_active OR public.get_my_staff_role() IN ('admin', 'waiter', 'kitchen'))
  );

DROP POLICY IF EXISTS mm_categories_read ON public.categories;
CREATE POLICY mm_categories_read ON public.categories
  FOR SELECT TO anon, authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND (is_active OR public.get_my_staff_role() IN ('admin', 'waiter', 'kitchen'))
  );

DROP POLICY IF EXISTS mm_menu_items_read ON public.menu_items;
CREATE POLICY mm_menu_items_read ON public.menu_items
  FOR SELECT TO anon, authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND (
      is_available
      OR public.get_my_staff_role() IN ('admin', 'waiter', 'kitchen')
    )
  );

DROP POLICY IF EXISTS mm_menu_items_staff_update ON public.menu_items;
CREATE POLICY mm_menu_items_staff_update ON public.menu_items
  FOR UPDATE TO authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() IN ('admin', 'kitchen')
  )
  WITH CHECK (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() IN ('admin', 'kitchen')
  );

-- Staff can read shared tickets, but customers cannot read the order tables directly.
DROP POLICY IF EXISTS mm_orders_staff_read ON public.orders;
CREATE POLICY mm_orders_staff_read ON public.orders
  FOR SELECT TO authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() IN ('admin', 'waiter', 'kitchen')
  );

DROP POLICY IF EXISTS mm_orders_staff_update ON public.orders;
CREATE POLICY mm_orders_staff_update ON public.orders
  FOR UPDATE TO authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() IN ('admin', 'waiter', 'kitchen')
  )
  WITH CHECK (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() IN ('admin', 'waiter', 'kitchen')
  );

DROP POLICY IF EXISTS mm_order_items_staff_read ON public.order_items;
CREATE POLICY mm_order_items_staff_read ON public.order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders AS o
      WHERE o.id = order_items.order_id
        AND o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    )
    AND public.get_my_staff_role() IN ('admin', 'waiter', 'kitchen')
  );

DROP POLICY IF EXISTS mm_settings_admin_all ON public.restaurant_settings;
CREATE POLICY mm_settings_admin_all ON public.restaurant_settings
  FOR ALL TO authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() = 'admin'
  )
  WITH CHECK (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() = 'admin'
  );

-- Privileges complement RLS. There is deliberately no direct anon access to orders/order_items.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
REVOKE ALL ON public.restaurants, public.restaurant_tables, public.categories,
  public.menu_items, public.orders, public.order_items,
  public.restaurant_settings, public.staff_profiles FROM anon, authenticated;

GRANT SELECT ON public.restaurants, public.restaurant_tables,
  public.categories, public.menu_items TO anon, authenticated;

GRANT SELECT ON public.orders, public.order_items TO authenticated;
GRANT UPDATE (status) ON public.orders TO authenticated;
GRANT UPDATE (price, is_available) ON public.menu_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_settings TO authenticated;

-- A kitchen account can mark an item unavailable/available, but cannot change prices.
CREATE OR REPLACE FUNCTION public.mm_guard_menu_item_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := public.get_my_staff_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'kitchen') THEN
    RAISE EXCEPTION 'Staff role is not allowed to edit the menu';
  END IF;

  IF v_role = 'kitchen' AND NEW.price IS DISTINCT FROM OLD.price THEN
    RAISE EXCEPTION 'Only the owner/admin can change prices';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS mm_menu_item_update_guard ON public.menu_items;
CREATE TRIGGER mm_menu_item_update_guard
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.mm_guard_menu_item_update();

CREATE OR REPLACE FUNCTION public.mm_guard_order_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $
BEGIN
  -- Customers may only perform the NEW -> CANCELLED transition through the token-verified RPC.
  IF coalesce(public.get_my_staff_role(), '') NOT IN ('admin', 'waiter', 'kitchen')
     AND NOT (
       coalesce(current_setting('app.mm_public_cancel', true), '') = 'on'
       AND OLD.status = 'NEW'
       AND NEW.status = 'CANCELLED'
       AND OLD.ticket_id IS NOT NULL
       AND NEW.ticket_id IS NOT DISTINCT FROM OLD.ticket_id
       AND NEW.public_token IS NOT DISTINCT FROM OLD.public_token
     ) THEN
    RAISE EXCEPTION 'Staff login required to update an order';
  END IF;
  IF NEW.status NOT IN ('NEW', 'PREPARING', 'READY', 'SERVED', 'PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'Invalid order status';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$;

DROP TRIGGER IF EXISTS mm_order_update_guard ON public.orders;
CREATE TRIGGER mm_order_update_guard
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.mm_guard_order_update();

-- One atomic RPC creates both the order and its line items.
-- Prices are taken from the database, never trusted from the browser.
CREATE OR REPLACE FUNCTION public.mm_place_order(
  p_restaurant_id uuid,
  p_table_number text,
  p_ticket_id text,
  p_notes text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table_id uuid;
  v_table_number text;
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
    AND t.table_number = v_table_number
    AND t.is_active = true
  LIMIT 1;
  IF v_table_id IS NULL THEN
    RAISE EXCEPTION 'This table is not active';
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
    (restaurant_id, table_id, status, notes, total, ticket_id)
  VALUES
    (p_restaurant_id, v_table_id, 'NEW', left(trim(coalesce(p_notes, '')), 1000), v_total, p_ticket_id)
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
    'total', v_order.total,
    'status', v_order.status,
    'notes', v_order.notes,
    'createdAt', v_order.created_at,
    'orderNumber', v_order.order_number,
    'items', v_items
  );
END
$$;

-- Customers can read the status of only an order when they have its secret per-order token.
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
    jsonb_agg(jsonb_build_object('name', oi.item_name, 'price', oi.price, 'qty', oi.quantity)
              ORDER BY oi.created_at, oi.item_name),
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

-- Token-verified customer cancellation, limited to NEW orders in the 7-minute window.
CREATE OR REPLACE FUNCTION public.mm_cancel_public_order(
  p_ticket_id text,
  p_public_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $
DECLARE
  v_order public.orders%ROWTYPE;
  v_table_number text;
BEGIN
  IF p_ticket_id IS NULL OR trim(p_ticket_id) = '' OR p_public_token IS NULL THEN
    RAISE EXCEPTION 'Order credentials are missing';
  END IF;

  SELECT o.* INTO v_order
  FROM public.orders AS o
  WHERE o.ticket_id = p_ticket_id
    AND o.public_token = p_public_token
    AND o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or cancellation link expired';
  END IF;
  IF upper(coalesce(v_order.status, '')) <> 'NEW' THEN
    RAISE EXCEPTION 'The kitchen has started this order. Please ask your waiter.';
  END IF;
  IF v_order.created_at <= now() - interval '7 minutes' THEN
    RAISE EXCEPTION 'The cancellation window has expired. Please ask your waiter.';
  END IF;

  -- Transaction-local flag, validated by mm_guard_order_update.
  PERFORM pg_catalog.set_config('app.mm_public_cancel', 'on', true);

  UPDATE public.orders AS o
  SET status = 'CANCELLED'
  WHERE o.id = v_order.id
    AND upper(o.status) = 'NEW'
    AND o.created_at > now() - interval '7 minutes'
  RETURNING o.* INTO v_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The order has changed and can no longer be cancelled.';
  END IF;

  SELECT lpad(t.table_number::text, 2, '0')
    INTO v_table_number
  FROM public.restaurant_tables AS t
  WHERE t.id = v_order.table_id;

  RETURN jsonb_build_object(
    'id', v_order.ticket_id,
    'table', v_table_number,
    'status', v_order.status,
    'cancelledAt', v_order.updated_at
  );
END
$;

REVOKE ALL ON FUNCTION public.mm_cancel_public_order(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_cancel_public_order(text, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.mm_place_order(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_place_order(uuid, text, text, text, jsonb) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.mm_get_public_order(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_public_order(text, uuid) TO anon, authenticated;

COMMIT;
