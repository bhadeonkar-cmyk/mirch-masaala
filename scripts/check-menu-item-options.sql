\set ON_ERROR_STOP on
DO $qa$
DECLARE
  v_capacity jsonb;
  v_rejected boolean := false;
  v_visit_id uuid;
  v_visit_code text;
  v_session uuid := 'bbbbbbbb-0000-4000-8000-000000000099'::uuid;
  v_menu uuid := '66666666-6666-4666-8666-666666666666'::uuid;
  v_order jsonb;
  v_public jsonb;
  v_detail jsonb;
  v_token uuid;
BEGIN
  PERFORM set_config('app.qa_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
  PERFORM set_config('app.qa_role','admin',false);
  v_capacity := public.mm_admin_set_table_capacity('02', 6);
  IF v_capacity->>'table_number' IS DISTINCT FROM '02'
     OR (v_capacity->>'seating_capacity')::integer IS DISTINCT FROM 6
     OR (SELECT seating_capacity FROM public.restaurant_tables WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid AND table_number='02') IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'QA failed: seating capacity not persisted: %',v_capacity;
  END IF;
  PERFORM set_config('app.qa_role','waiter',false);
  BEGIN
    PERFORM public.mm_admin_set_table_capacity('02', 8);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Owner/Admin access required' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: waiter could change capacity'; END IF;
  PERFORM set_config('app.qa_role','admin',false);
  v_rejected := false;
  BEGIN
    PERFORM public.mm_admin_set_table_capacity('02', 31);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Table seating capacity must be between 1 and 30' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: invalid capacity accepted'; END IF;
  SELECT v.id, v.guest_order_code INTO v_visit_id, v_visit_code
  FROM public.restaurant_table_visits v JOIN public.restaurant_tables t ON t.id=v.table_id
  WHERE v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid AND t.table_number='06' AND v.status='OPEN'
  ORDER BY v.started_at DESC LIMIT 1;
  IF v_visit_id IS NULL OR v_visit_code !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'QA failed: expected staffed Table 06 visit from prior ordering QA';
  END IF;
  PERFORM set_config('app.qa_role','',false);
  v_order := public.mm_place_order(
    'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid,
    '06','MM-SPICE-OPTION-001','Please keep it less oily',
    jsonb_build_array(jsonb_build_object('menu_item_id',v_menu,'quantity',1,'spice_level','hot','notes','No onion please')),
    v_visit_id,v_session,v_visit_code
  );
  IF v_order->'items'->0->>'spiceLevel' IS DISTINCT FROM 'hot'
     OR v_order->'items'->0->>'notes' IS DISTINCT FROM 'No onion please' THEN
    RAISE EXCEPTION 'QA failed: created ticket lost dish options: %',v_order;
  END IF;
  v_token := (v_order->>'publicToken')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id
    WHERE o.ticket_id='MM-SPICE-OPTION-001' AND oi.spice_level='hot' AND oi.notes='No onion please') THEN
    RAISE EXCEPTION 'QA failed: line-item options not stored';
  END IF;
  v_public := public.mm_get_public_order('MM-SPICE-OPTION-001',v_token);
  IF v_public->'items'->0->>'spiceLevel' IS DISTINCT FROM 'hot'
     OR v_public->'items'->0->>'notes' IS DISTINCT FROM 'No onion please' THEN
    RAISE EXCEPTION 'QA failed: customer ticket lookup lost options: %',v_public;
  END IF;
  PERFORM set_config('app.qa_role','admin',false);
  v_detail := public.mm_admin_get_order_details('MM-SPICE-OPTION-001');
  IF v_detail->'items'->0->>'spice_level' IS DISTINCT FROM 'hot'
     OR v_detail->'items'->0->>'notes' IS DISTINCT FROM 'No onion please' THEN
    RAISE EXCEPTION 'QA failed: owner ticket lookup lost options: %',v_detail;
  END IF;
  RAISE NOTICE 'QA passed: owner capacity permissions, bounds, and dish options survive customer and owner lookup.';
END
$qa$;
