-- Mirch Masaala: persistent, token-verified customer cancellation.
-- Run once in Supabase SQL Editor after deploying the matching app update.
BEGIN;

CREATE OR REPLACE FUNCTION public.mm_guard_order_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.mm_cancel_public_order(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_cancel_public_order(text, uuid) TO anon, authenticated;

COMMIT;
