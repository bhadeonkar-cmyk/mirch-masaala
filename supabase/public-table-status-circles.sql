-- Mirch Masaala public table-status circles
-- Run once in Supabase SQL Editor to show NEW, PREPARING and READY tables
-- on the customer screen. This exposes table number + order status only.

BEGIN;

CREATE OR REPLACE FUNCTION public.mm_public_order_board()
RETURNS TABLE (
  ticket text,
  table_number text,
  status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
  SELECT
    coalesce(nullif(o.order_number::text, ''), right(coalesce(o.ticket_id, ''), 4)) AS ticket,
    lpad(t.table_number::text, 2, '0') AS table_number,
    upper(o.status)::text AS status,
    o.created_at
  FROM public.orders AS o
  JOIN public.restaurant_tables AS t ON t.id = o.table_id
  WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND upper(o.status) IN ('NEW', 'PREPARING', 'READY')
    AND coalesce(o.is_test_order, false) = false
    AND o.archived_at IS NULL
    AND o.created_at >= now() - interval '4 hours'
  ORDER BY
    CASE upper(o.status)
      WHEN 'NEW' THEN 0
      WHEN 'PREPARING' THEN 1
      WHEN 'READY' THEN 2
      ELSE 3
    END,
    o.created_at ASC
  LIMIT 60
$$;

REVOKE ALL ON FUNCTION public.mm_public_order_board() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_public_order_board() TO anon, authenticated;

COMMIT;
