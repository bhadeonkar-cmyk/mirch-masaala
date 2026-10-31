-- Mirch Masaala: public table visit gate (read-only)
-- Safe to re-run. Does NOT create visits. Customers only learn whether a table
-- is available, already in service, or not found — never other guests' data.
-- Apply in Supabase SQL Editor after visit-service-controls.sql.

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

-- Ensure ensure does not auto-open (idempotent with visit-service-controls.sql)
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
