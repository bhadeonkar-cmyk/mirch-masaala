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
  IF coalesce(public.get_my_staff_role(), '') <> '' THEN
    RAISE EXCEPTION 'Staff must use the staff workflow, not the customer cancellation endpoint';
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



ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_test_order boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_complimentary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS complimentary_reason text,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  ticket_id text NOT NULL,
  table_number text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('gpay', 'phonepe', 'upi', 'cash', 'card', 'other', 'legacy')),
  note text,
  received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_order_payments_restaurant_created
  ON public.order_payments (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_order_payments_order
  ON public.order_payments (order_id);

CREATE TABLE IF NOT EXISTS public.order_management_audit (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  restaurant_id uuid NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ticket_id text,
  table_number text,
  action text NOT NULL,
  from_status text,
  to_status text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  reason text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_order_management_audit_recent
  ON public.order_management_audit (restaurant_id, created_at DESC);

ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_management_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_payments, public.order_management_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_payments, public.order_management_audit TO authenticated;

DROP POLICY IF EXISTS mm_order_payments_staff_read ON public.order_payments;
CREATE POLICY mm_order_payments_staff_read ON public.order_payments
  FOR SELECT TO authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() IN ('admin', 'waiter')
  );
DROP POLICY IF EXISTS mm_order_audit_admin_read ON public.order_management_audit;
CREATE POLICY mm_order_audit_admin_read ON public.order_management_audit
  FOR SELECT TO authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() = 'admin'
  );

-- Backfill legacy PAID tickets as payments once. This retains previously recorded income
-- in the new ledger instead of silently resetting the historic paid amount to zero.
INSERT INTO public.order_payments
  (restaurant_id, order_id, ticket_id, table_number, amount, method, note, received_by, created_at)
SELECT
  o.restaurant_id, o.id, o.ticket_id, lpad(t.table_number::text, 2, '0'),
  o.total, 'legacy', 'Migrated from existing PAID order status', NULL,
  coalesce(o.updated_at, o.created_at, now())
FROM public.orders AS o
JOIN public.restaurant_tables AS t ON t.id = o.table_id
WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
  AND upper(o.status) = 'PAID'
  AND NOT EXISTS (SELECT 1 FROM public.order_payments AS p WHERE p.order_id = o.id);

-- Status transitions are enforced in the database, not only by the browser.
-- A customer must use the token-verified cancellation function; staff roles can only
-- perform their own workflow actions. Payment receipts are stored separately.
CREATE OR REPLACE FUNCTION public.mm_guard_order_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_old text;
  v_new text;
BEGIN
  v_role := coalesce(public.get_my_staff_role(), '');
  v_old := upper(coalesce(OLD.status, ''));
  v_new := upper(coalesce(NEW.status, ''));

  IF v_new NOT IN ('NEW', 'PREPARING', 'READY', 'SERVED', 'PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'Invalid order status';
  END IF;

  IF v_new = v_old THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF v_role = 'admin' THEN
    IF v_old IN ('PAID','CANCELLED') AND v_new <> v_old THEN
      RAISE EXCEPTION 'Paid or cancelled orders cannot be reopened; create a new ticket or record a refund adjustment separately';
    END IF;
    IF v_new = 'PAID' THEN
      RAISE EXCEPTION 'Record the payment through the staff payment function; do not change status to PAID manually';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  ELSIF v_role = 'kitchen' THEN
    IF NOT ((v_old = 'NEW' AND v_new = 'PREPARING') OR (v_old = 'PREPARING' AND v_new = 'READY')) THEN
      RAISE EXCEPTION 'Kitchen may only start or complete preparation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  ELSIF v_role = 'waiter' THEN
    IF NOT (v_old = 'READY' AND v_new = 'SERVED') THEN
      RAISE EXCEPTION 'Waiter may only mark a ready order as served';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  ELSIF v_role = '' AND
        coalesce(current_setting('app.mm_public_cancel', true), '') = 'on'
        AND v_old = 'NEW'
        AND v_new = 'CANCELLED'
        AND OLD.ticket_id IS NOT NULL
        AND NEW.ticket_id IS NOT DISTINCT FROM OLD.ticket_id
        AND NEW.public_token IS NOT DISTINCT FROM OLD.public_token THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Staff login required or invalid order status transition';
END
$$;

DROP TRIGGER IF EXISTS mm_order_update_guard ON public.orders;
CREATE TRIGGER mm_order_update_guard
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.mm_guard_order_update();

-- Replace the cancellation RPC so cancellation reasons/audit are durable and paid
-- tickets cannot be cancelled without an explicit refund workflow.
CREATE OR REPLACE FUNCTION public.mm_cancel_public_order(
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
BEGIN
  IF p_ticket_id IS NULL OR trim(p_ticket_id) = '' OR p_public_token IS NULL THEN
    RAISE EXCEPTION 'Order credentials are missing';
  END IF;
  IF coalesce(public.get_my_staff_role(), '') <> '' THEN
    RAISE EXCEPTION 'Staff must use the staff workflow, not the customer cancellation endpoint';
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
  IF EXISTS (SELECT 1 FROM public.order_payments p WHERE p.order_id = v_order.id) THEN
    RAISE EXCEPTION 'A payment is already recorded. Please ask staff to resolve the bill.';
  END IF;

  PERFORM pg_catalog.set_config('app.mm_public_cancel', 'on', true);

  UPDATE public.orders AS o
  SET status = 'CANCELLED', cancel_reason = 'CUSTOMER_REQUEST'
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

  INSERT INTO public.order_management_audit
    (restaurant_id, order_id, ticket_id, table_number, action, from_status, to_status,
     amount, reason, actor_user_id, created_at)
  VALUES
    (v_order.restaurant_id, v_order.id, v_order.ticket_id, v_table_number,
     'CUSTOMER_CANCEL', 'NEW', 'CANCELLED', coalesce(v_order.total, 0),
     'Customer cancelled within allowed window', NULL, now());

  RETURN jsonb_build_object(
    'id', v_order.ticket_id,
    'table', v_table_number,
    'status', v_order.status,
    'cancelledAt', v_order.updated_at
  );
END
$$;

REVOKE ALL ON FUNCTION public.mm_cancel_public_order(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_cancel_public_order(text, uuid) TO anon, authenticated;

-- Owners preview all unarchived records for a table before approving test-data cleanup.
CREATE OR REPLACE FUNCTION public.mm_admin_preview_table_cleanup(p_table_number text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table_number text;
  v_table_id uuid;
  v_result jsonb;
BEGIN
  IF public.get_my_staff_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Owner/Admin access required';
  END IF;
  IF p_table_number IS NULL OR trim(p_table_number) !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Choose a valid table number';
  END IF;
  v_table_number := lpad(trim(p_table_number), 2, '0');
  SELECT t.id INTO v_table_id FROM public.restaurant_tables t
  WHERE t.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text, 2, '0') = v_table_number AND t.is_active = true
  LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;

  SELECT jsonb_build_object(
    'table', v_table_number,
    'candidate_count', count(*)::integer,
    'active_count', count(*) FILTER (WHERE upper(o.status) IN ('NEW','PREPARING','READY'))::integer,
    'candidate_value', coalesce(sum(o.total), 0),
    'recorded_payment_value', coalesce(sum(coalesce(p.paid, 0)), 0)
  ) INTO v_result
  FROM public.orders o
  LEFT JOIN (
    SELECT order_id, sum(amount) AS paid
    FROM public.order_payments
    GROUP BY order_id
  ) p ON p.order_id = o.id
  WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND o.table_id = v_table_id
    AND o.archived_at IS NULL;
  RETURN v_result;
END
$$;

-- Owner cleanup is archival, not deletion. The expected count ensures the table preview
-- has not gone stale between confirmation and execution.
CREATE OR REPLACE FUNCTION public.mm_admin_clear_table_orders(
  p_table_number text,
  p_reason text,
  p_expected_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table_number text;
  v_table_id uuid;
  v_order public.orders%ROWTYPE;
  v_next_status text;
  v_count integer := 0;
  v_cancelled integer := 0;
  v_excluded_value numeric(12,2) := 0;
BEGIN
  IF public.get_my_staff_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Owner/Admin access required';
  END IF;
  IF p_table_number IS NULL OR trim(p_table_number) !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Choose a valid table number';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 OR length(trim(p_reason)) > 240 THEN
    RAISE EXCEPTION 'Enter a cleanup reason between 3 and 240 characters';
  END IF;
  IF p_expected_count IS NULL OR p_expected_count < 0 THEN
    RAISE EXCEPTION 'Preview the table before cleanup';
  END IF;
  v_table_number := lpad(trim(p_table_number), 2, '0');
  SELECT t.id INTO v_table_id FROM public.restaurant_tables t
  WHERE t.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text, 2, '0') = v_table_number AND t.is_active = true
  LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;

  LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*)::integer INTO v_count FROM public.orders o
  WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND o.table_id = v_table_id AND o.archived_at IS NULL;
  IF v_count <> p_expected_count THEN
    RAISE EXCEPTION 'Table data changed after preview. Preview again before cleaning.';
  END IF;

  v_count := 0;
  FOR v_order IN
    SELECT o.* FROM public.orders o
    WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND o.table_id = v_table_id AND o.archived_at IS NULL
    ORDER BY o.created_at, o.id
    FOR UPDATE
  LOOP
    v_next_status := CASE WHEN upper(v_order.status) IN ('NEW','PREPARING','READY')
                          THEN 'CANCELLED' ELSE upper(v_order.status) END;
    INSERT INTO public.order_management_audit
      (restaurant_id, order_id, ticket_id, table_number, action, from_status, to_status,
       amount, reason, actor_user_id, created_at)
    VALUES
      (v_order.restaurant_id, v_order.id, v_order.ticket_id, v_table_number,
       'TABLE_CLEANUP', upper(v_order.status), v_next_status, coalesce(v_order.total, 0),
       trim(p_reason), auth.uid(), now());

    UPDATE public.orders o
    SET is_test_order = true,
        is_complimentary = false,
        complimentary_reason = NULL,
        archived_at = now(),
        archived_by = auth.uid(),
        status = v_next_status,
        cancel_reason = CASE
          WHEN upper(v_order.status) IN ('NEW','PREPARING','READY') THEN 'OWNER_TABLE_CLEANUP'
          ELSE o.cancel_reason
        END
    WHERE o.id = v_order.id;

    v_count := v_count + 1;
    v_excluded_value := v_excluded_value + coalesce(v_order.total, 0);
    IF upper(v_order.status) IN ('NEW','PREPARING','READY') THEN
      v_cancelled := v_cancelled + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'table', v_table_number,
    'archived_count', v_count,
    'cancelled_active_count', v_cancelled,
    'excluded_order_value', v_excluded_value,
    'reason', trim(p_reason)
  );
END
$$;

-- Classify an order as a comp/free meal. It is not revenue and its reason remains auditable.
CREATE OR REPLACE FUNCTION public.mm_admin_set_complimentary(
  p_ticket_id text,
  p_is_complimentary boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_table_number text;
  v_action text;
  v_reason text;
BEGIN
  IF public.get_my_staff_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Owner/Admin access required';
  END IF;
  IF p_ticket_id IS NULL OR trim(p_ticket_id) = '' OR p_is_complimentary IS NULL THEN
    RAISE EXCEPTION 'Choose an order and an accounting action';
  END IF;
  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  IF p_is_complimentary AND (v_reason IS NULL OR length(v_reason) > 240) THEN
    RAISE EXCEPTION 'Enter a reason for the complimentary meal (up to 240 characters)';
  END IF;

  SELECT o.* INTO v_order FROM public.orders o
  WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND o.ticket_id = p_ticket_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF upper(v_order.status) = 'CANCELLED' OR v_order.archived_at IS NOT NULL OR v_order.is_test_order THEN
    RAISE EXCEPTION 'Cancelled or test orders cannot be classified as complimentary food';
  END IF;
  IF p_is_complimentary AND EXISTS (
    SELECT 1 FROM public.order_payments p WHERE p.order_id = v_order.id
  ) THEN
    RAISE EXCEPTION 'This order already has a recorded payment. Resolve the payment first.';
  END IF;
  IF p_is_complimentary AND upper(v_order.status) = 'PAID' THEN
    RAISE EXCEPTION 'This order is marked paid. Correct its payment record before marking it complimentary.';
  END IF;

  v_action := CASE WHEN p_is_complimentary THEN 'MARK_COMPLIMENTARY' ELSE 'REMOVE_COMPLIMENTARY' END;
  UPDATE public.orders o
  SET is_complimentary = p_is_complimentary,
      complimentary_reason = CASE WHEN p_is_complimentary THEN v_reason ELSE NULL END
  WHERE o.id = v_order.id;

  SELECT lpad(t.table_number::text, 2, '0') INTO v_table_number
  FROM public.restaurant_tables t WHERE t.id = v_order.table_id;
  INSERT INTO public.order_management_audit
    (restaurant_id, order_id, ticket_id, table_number, action, from_status, to_status,
     amount, reason, actor_user_id, created_at)
  VALUES
    (v_order.restaurant_id, v_order.id, v_order.ticket_id, v_table_number, v_action,
     upper(v_order.status), upper(v_order.status), coalesce(v_order.total, 0),
     coalesce(v_reason, 'Complimentary classification removed'), auth.uid(), now());

  RETURN jsonb_build_object(
    'id', v_order.ticket_id,
    'table', v_table_number,
    'status', upper(v_order.status),
    'is_complimentary', p_is_complimentary,
    'complimentary_reason', CASE WHEN p_is_complimentary THEN v_reason ELSE NULL END,
    'total', coalesce(v_order.total, 0)
  );
END
$$;

-- Receive a real payment as owner/waiter. It allocates the amount FIFO to unpaid tickets
-- at the table and stores each allocation with an audit trail. UPI QR opening is not proof
-- of receipt; only this authenticated function records payment in accounts.
CREATE OR REPLACE FUNCTION public.mm_staff_record_table_payment(
  p_table_number text,
  p_amount numeric,
  p_method text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table_number text;
  v_table_id uuid;
  v_order public.orders%ROWTYPE;
  v_method text;
  v_note text;
  v_outstanding numeric(12,2);
  v_paid numeric(12,2);
  v_due numeric(12,2);
  v_apply numeric(12,2);
  v_remaining numeric(12,2);
  v_allocations jsonb := '[]'::jsonb;
  v_order_count integer := 0;
  v_paid_count integer := 0;
BEGIN
  IF coalesce(public.get_my_staff_role(), '') NOT IN ('admin', 'waiter') THEN
    RAISE EXCEPTION 'Owner/Admin or signed-in waiter access required to confirm payment';
  END IF;
  IF p_table_number IS NULL OR trim(p_table_number) !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Choose a valid table number';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 999999 THEN
    RAISE EXCEPTION 'Enter a valid received amount';
  END IF;
  v_method := lower(trim(coalesce(p_method, '')));
  IF v_method NOT IN ('gpay','phonepe','upi','cash','card','other') THEN
    RAISE EXCEPTION 'Choose a valid payment method';
  END IF;
  v_note := left(trim(coalesce(p_note, '')), 500);
  v_table_number := lpad(trim(p_table_number), 2, '0');
  SELECT t.id INTO v_table_id FROM public.restaurant_tables t
  WHERE t.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text, 2, '0') = v_table_number AND t.is_active = true
  LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;

  LOCK TABLE public.order_payments IN SHARE ROW EXCLUSIVE MODE;
  SELECT coalesce(sum(greatest(coalesce(o.total,0) - coalesce(p.paid,0),0)),0)
    INTO v_outstanding
  FROM public.orders o
  LEFT JOIN (SELECT order_id, sum(amount) AS paid FROM public.order_payments GROUP BY order_id) p
    ON p.order_id = o.id
  WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND o.table_id = v_table_id
    AND upper(o.status) NOT IN ('CANCELLED','PAID')
    AND NOT o.is_test_order AND NOT o.is_complimentary AND o.archived_at IS NULL;
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'No unpaid bill is recorded for Table %', v_table_number;
  END IF;
  IF p_amount > v_outstanding THEN
    RAISE EXCEPTION 'Received amount exceeds the recorded outstanding bill of %', v_outstanding;
  END IF;

  v_remaining := round(p_amount, 2);
  FOR v_order IN
    SELECT o.* FROM public.orders o
    WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND o.table_id = v_table_id
      AND upper(o.status) NOT IN ('CANCELLED','PAID')
      AND NOT o.is_test_order AND NOT o.is_complimentary AND o.archived_at IS NULL
    ORDER BY o.created_at, o.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    SELECT coalesce(sum(p.amount),0) INTO v_paid
    FROM public.order_payments p WHERE p.order_id = v_order.id;
    v_due := greatest(round(coalesce(v_order.total,0) - v_paid, 2), 0);
    IF v_due <= 0 THEN CONTINUE; END IF;
    v_apply := least(v_due, v_remaining);
    INSERT INTO public.order_payments
      (restaurant_id, order_id, ticket_id, table_number, amount, method, note, received_by, created_at)
    VALUES
      (v_order.restaurant_id, v_order.id, v_order.ticket_id, v_table_number,
       v_apply, v_method, nullif(v_note,''), auth.uid(), now());
    INSERT INTO public.order_management_audit
      (restaurant_id, order_id, ticket_id, table_number, action, from_status, to_status,
       amount, reason, actor_user_id, created_at)
    VALUES
      (v_order.restaurant_id, v_order.id, v_order.ticket_id, v_table_number, 'PAYMENT_RECEIVED',
       upper(v_order.status), upper(v_order.status), v_apply,
       v_method || CASE WHEN v_note <> '' THEN ' · ' || v_note ELSE '' END,
       auth.uid(), now());
    v_remaining := round(v_remaining - v_apply, 2);
    v_order_count := v_order_count + 1;
    v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
      'ticket_id', v_order.ticket_id, 'amount', v_apply, 'method', v_method
    ));
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Payment could not be allocated. No payment was saved; refresh and try again.';
  END IF;

  RETURN jsonb_build_object(
    'table', v_table_number,
    'amount', round(p_amount,2),
    'method', v_method,
    'allocated_tickets', v_order_count,
    'allocations', v_allocations,
    'status', 'RECORDED'
  );
END
$$;

-- Owner accounting is calculated from every database row, not just the latest 100
-- tickets on the dashboard or data held in one browser's localStorage.
CREATE OR REPLACE FUNCTION public.mm_admin_accounts_summary(p_day date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_day date := coalesce(p_day, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_summary jsonb;
  v_audit jsonb;
BEGIN
  IF public.get_my_staff_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Owner/Admin access required';
  END IF;
  WITH todays AS (
    SELECT o.id, upper(o.status) AS status, coalesce(o.total,0) AS total,
           coalesce(o.is_test_order,false) AS is_test_order,
           coalesce(o.is_complimentary,false) AS is_complimentary,
           coalesce(o.cancel_reason,'') AS cancel_reason,
           coalesce(sum(p.amount),0) AS paid
    FROM public.orders o
    LEFT JOIN public.order_payments p ON p.order_id = o.id
    WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day
    GROUP BY o.id
  )
  SELECT jsonb_build_object(
    'day', v_day,
    'order_count', count(*) FILTER (WHERE NOT is_test_order AND status <> 'CANCELLED'),
    'paid_count', count(*) FILTER (WHERE NOT is_test_order AND NOT is_complimentary
      AND status NOT IN ('CANCELLED','PAID') AND paid >= total - 0.01)
      + count(*) FILTER (WHERE NOT is_test_order AND NOT is_complimentary AND status = 'PAID'),
    'paid_sales', coalesce(sum(paid) FILTER (WHERE NOT is_test_order AND NOT is_complimentary
      AND status <> 'CANCELLED'),0),
    'pending_count', count(*) FILTER (WHERE NOT is_test_order AND NOT is_complimentary
      AND status NOT IN ('CANCELLED','PAID') AND paid < total - 0.01),
    'pending_value', coalesce(sum(greatest(total-paid,0)) FILTER (WHERE NOT is_test_order
      AND NOT is_complimentary AND status NOT IN ('CANCELLED','PAID')),0),
    'cancelled_count', count(*) FILTER (WHERE NOT is_test_order AND status = 'CANCELLED'),
    'cancelled_value', coalesce(sum(total) FILTER (WHERE NOT is_test_order AND status = 'CANCELLED'),0),
    'customer_cancel_count', count(*) FILTER (WHERE NOT is_test_order AND status = 'CANCELLED'
      AND cancel_reason = 'CUSTOMER_REQUEST'),
    'complimentary_count', count(*) FILTER (WHERE NOT is_test_order AND is_complimentary
      AND status <> 'CANCELLED'),
    'complimentary_value', coalesce(sum(total) FILTER (WHERE NOT is_test_order AND is_complimentary
      AND status <> 'CANCELLED'),0),
    'test_count', count(*) FILTER (WHERE is_test_order),
    'test_value', coalesce(sum(total) FILTER (WHERE is_test_order),0)
  ) INTO v_summary
  FROM todays;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'action', a.action, 'ticket_id', a.ticket_id, 'table_number', a.table_number,
    'from_status', a.from_status, 'to_status', a.to_status, 'amount', a.amount,
    'reason', a.reason, 'created_at', a.created_at
  ) ORDER BY a.created_at DESC), '[]'::jsonb) INTO v_audit
  FROM (
    SELECT action, ticket_id, table_number, from_status, to_status, amount, reason, created_at
    FROM public.order_management_audit
    WHERE restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND created_at >= ((v_day - 7)::timestamp AT TIME ZONE 'Asia/Kolkata')
    ORDER BY created_at DESC LIMIT 20
  ) a;

  RETURN v_summary || jsonb_build_object('recent_audit', v_audit);
END
$$;

-- Owner/waiter can read recent payments via RLS; the UI still checks owner role for accounts.
REVOKE ALL ON FUNCTION public.mm_admin_preview_table_cleanup(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mm_admin_clear_table_orders(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mm_admin_set_complimentary(text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mm_staff_record_table_payment(text, numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mm_admin_accounts_summary(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_admin_preview_table_cleanup(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_admin_clear_table_orders(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_admin_set_complimentary(text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_staff_record_table_payment(text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_admin_accounts_summary(date) TO authenticated;


COMMIT;
