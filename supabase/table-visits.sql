-- Mirch Masaala: simple table-visit lifecycle
-- Run once in Supabase Dashboard > SQL Editor after updating the app.
-- A table is IN SERVICE until staff confirms guests have left and the table is reset.
-- FINISH is blocked while tickets are in the kitchen or any bill balance remains.

CREATE TABLE IF NOT EXISTS public.restaurant_table_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  table_id uuid NOT NULL REFERENCES public.restaurant_tables(id) ON DELETE RESTRICT,
  table_number text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  finished_at timestamptz,
  finished_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT restaurant_table_visits_state_times CHECK (
    (status = 'OPEN' AND finished_at IS NULL) OR
    (status = 'CLOSED' AND finished_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_restaurant_table_visits_one_open
  ON public.restaurant_table_visits (restaurant_id, table_id)
  WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS ix_restaurant_table_visits_history
  ON public.restaurant_table_visits (restaurant_id, table_id, started_at DESC);

ALTER TABLE public.restaurant_table_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.restaurant_table_visits FROM PUBLIC, anon, authenticated;

-- Carry forward recent table activity so a live table does not suddenly look free
-- just because this feature is being installed during service. A waiter can close it
-- once the guest has left, food tickets are complete, and the balance is settled.
INSERT INTO public.restaurant_table_visits
  (restaurant_id, table_id, table_number, status, started_at)
SELECT
  'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid,
  t.id,
  lpad(t.table_number::text, 2, '0'),
  'OPEN',
  min(o.created_at)
FROM public.restaurant_tables t
JOIN public.orders o
  ON o.table_id = t.id
 AND o.restaurant_id = t.restaurant_id
WHERE t.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
  AND t.is_active = true
  AND o.created_at >= now() - interval '3 hours'
  AND upper(coalesce(o.status, '')) <> 'CANCELLED'
  AND coalesce(o.is_test_order, false) = false
  AND o.archived_at IS NULL
GROUP BY t.id, t.table_number
ON CONFLICT (restaurant_id, table_id) WHERE status = 'OPEN' DO NOTHING;

CREATE OR REPLACE FUNCTION public.mm_ensure_public_table_visit(p_table_number text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table_number text;
  v_table_id uuid;
  v_started_at timestamptz;
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

  SELECT v.started_at INTO v_started_at
  FROM public.restaurant_table_visits v
  WHERE v.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND v.table_id = v_table_id AND v.status = 'OPEN'
  LIMIT 1;

  IF v_started_at IS NULL THEN
    INSERT INTO public.restaurant_table_visits
      (restaurant_id, table_id, table_number, status, started_at, started_by)
    VALUES (
      'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid,
      v_table_id, v_table_number, 'OPEN', now(), auth.uid()
    )
    ON CONFLICT (restaurant_id, table_id) WHERE status = 'OPEN' DO NOTHING;

    SELECT v.started_at INTO v_started_at
    FROM public.restaurant_table_visits v
    WHERE v.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND v.table_id = v_table_id AND v.status = 'OPEN'
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'table_number', v_table_number,
    'status', 'OPEN',
    'started_at', v_started_at
  );
END
$$;

CREATE OR REPLACE FUNCTION public.mm_staff_get_table_visits()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF coalesce(public.get_my_staff_role(), '') NOT IN ('admin', 'waiter') THEN
    RAISE EXCEPTION 'Owner/Admin or signed-in waiter access required';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'table_number', lpad(t.table_number::text, 2, '0'),
        'status', CASE WHEN v.id IS NULL THEN 'AVAILABLE' ELSE 'OPEN' END,
        'started_at', v.started_at
      ) ORDER BY t.table_number
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.restaurant_tables t
  LEFT JOIN LATERAL (
    SELECT tv.id, tv.started_at
    FROM public.restaurant_table_visits tv
    WHERE tv.restaurant_id = t.restaurant_id
      AND tv.table_id = t.id AND tv.status = 'OPEN'
    ORDER BY tv.started_at DESC
    LIMIT 1
  ) v ON true
  WHERE t.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND t.is_active = true;

  RETURN v_rows;
END
$$;

CREATE OR REPLACE FUNCTION public.mm_staff_set_table_visit_status(
  p_table_number text,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table_number text;
  v_action text;
  v_table_id uuid;
  v_visit_id uuid;
  v_started_at timestamptz;
  v_due numeric(12,2);
BEGIN
  IF coalesce(public.get_my_staff_role(), '') NOT IN ('admin', 'waiter') THEN
    RAISE EXCEPTION 'Owner/Admin or signed-in waiter access required';
  END IF;
  IF p_table_number IS NULL OR trim(p_table_number) !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Choose a valid table number';
  END IF;

  v_table_number := lpad(trim(p_table_number), 2, '0');
  v_action := upper(trim(coalesce(p_action, '')));
  IF v_action NOT IN ('START', 'FINISH') THEN
    RAISE EXCEPTION 'Choose Start visit or Finish visit';
  END IF;

  SELECT t.id INTO v_table_id
  FROM public.restaurant_tables t
  WHERE t.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text, 2, '0') = v_table_number
    AND t.is_active = true
  LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_table_id::text));

  IF v_action = 'START' THEN
    INSERT INTO public.restaurant_table_visits
      (restaurant_id, table_id, table_number, status, started_at, started_by)
    VALUES (
      'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid,
      v_table_id, v_table_number, 'OPEN', now(), auth.uid()
    )
    ON CONFLICT (restaurant_id, table_id) WHERE status = 'OPEN' DO NOTHING;

    SELECT v.id, v.started_at INTO v_visit_id, v_started_at
    FROM public.restaurant_table_visits v
    WHERE v.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND v.table_id = v_table_id AND v.status = 'OPEN'
    ORDER BY v.started_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'table_number', v_table_number, 'status', 'OPEN',
      'started_at', v_started_at, 'visit_id', v_visit_id
    );
  END IF;

  SELECT v.id, v.started_at INTO v_visit_id, v_started_at
  FROM public.restaurant_table_visits v
  WHERE v.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND v.table_id = v_table_id AND v.status = 'OPEN'
  ORDER BY v.started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_visit_id IS NULL THEN
    RAISE EXCEPTION 'Table % has no active visit. Refresh the table list.', v_table_number;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND o.table_id = v_table_id
      AND upper(coalesce(o.status, '')) IN ('NEW', 'PREPARING', 'READY')
      AND coalesce(o.is_test_order, false) = false
      AND o.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Table % still has kitchen tickets in progress. Serve or cancel every ticket first.', v_table_number;
  END IF;

  SELECT coalesce(sum(greatest(round(coalesce(o.total, 0) - coalesce(p.paid, 0), 2), 0)), 0)
  INTO v_due
  FROM public.orders o
  LEFT JOIN (
    SELECT op.order_id, sum(op.amount) AS paid
    FROM public.order_payments op
    GROUP BY op.order_id
  ) p ON p.order_id = o.id
  WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND o.table_id = v_table_id
    AND upper(coalesce(o.status, '')) NOT IN ('CANCELLED', 'PAID')
    AND coalesce(o.is_test_order, false) = false
    AND coalesce(o.is_complimentary, false) = false
    AND o.archived_at IS NULL;

  IF coalesce(v_due, 0) > 0.01 THEN
    RAISE EXCEPTION 'Table % still has ₹% unpaid. Settle the bill before finishing the visit.',
      v_table_number, to_char(v_due, 'FM999999990.00');
  END IF;

  UPDATE public.restaurant_table_visits
  SET status = 'CLOSED', finished_at = now(), finished_by = auth.uid()
  WHERE id = v_visit_id AND status = 'OPEN';

  RETURN jsonb_build_object(
    'table_number', v_table_number, 'status', 'CLOSED',
    'finished_at', now(), 'visit_id', v_visit_id
  );
END
$$;

REVOKE ALL ON FUNCTION public.mm_ensure_public_table_visit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_ensure_public_table_visit(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.mm_staff_get_table_visits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_staff_get_table_visits() TO authenticated;

REVOKE ALL ON FUNCTION public.mm_staff_set_table_visit_status(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_staff_set_table_visit_status(text, text) TO authenticated;
