\set ON_ERROR_STOP on
-- Regression: the consolidated QR-ordering RPC must survive the FULL migration
-- chain, including menu-item-options-and-table-capacity.sql running after
-- direct-kitchen-qr-orders.sql (which previously re-introduced the six-digit
-- guest code and broke every customer order). Runs in the isolated CI database.
DO $qa$
DECLARE
  v_visit_id uuid;
  v_closed_table text;
  v_result jsonb;
  v_items jsonb;
  v_token uuid;
  v_public jsonb;
  v_detail jsonb;
  v_rejected boolean;
  v_count integer;
  v_menu_id uuid := '66666666-6666-4666-8666-666666666666'::uuid;
  v_session uuid := 'bbbbbbbb-0000-4000-8000-000000000077'::uuid;
  v_rest uuid := 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid;
BEGIN
  PERFORM set_config('app.qa_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
  PERFORM set_config('app.qa_role','',false);

  SELECT v.id INTO v_visit_id
  FROM public.restaurant_table_visits v
  JOIN public.restaurant_tables t ON t.id = v.table_id
  WHERE v.restaurant_id = v_rest AND t.table_number = '06' AND v.status = 'OPEN'
  ORDER BY v.started_at DESC LIMIT 1;
  IF v_visit_id IS NULL THEN
    RAISE EXCEPTION 'QA failed: consolidated ordering test needs the open Table 06 visit from prior QA';
  END IF;

  -- 1. A customer orders with NO six-digit code (the app sends null) and the
  --    order is auto-approved, linked to the visit, and routed to the kitchen.
  v_items := jsonb_build_array(jsonb_build_object(
    'menu_item_id', v_menu_id, 'quantity', 2, 'spice_level', 'hot', 'notes', 'No onion please'));
  v_result := public.mm_place_order(v_rest, '06', 'MM-CONSOL-QR-001', 'Less oily please',
    v_items, v_visit_id, v_session, NULL);
  IF v_result->>'status' <> 'NEW' OR v_result->>'approvalStatus' <> 'APPROVED'
     OR v_result->>'visitId' IS DISTINCT FROM v_visit_id::text THEN
    RAISE EXCEPTION 'QA failed: code-free QR order was not approved onto the open visit: %', v_result;
  END IF;
  IF (v_result->>'total')::numeric <> 24 THEN
    RAISE EXCEPTION 'QA failed: total must use the database price (2 x 12), got %', v_result->>'total';
  END IF;
  IF v_result->'items'->0->>'spiceLevel' IS DISTINCT FROM 'hot'
     OR v_result->'items'->0->>'notes' IS DISTINCT FROM 'No onion please' THEN
    RAISE EXCEPTION 'QA failed: consolidated RPC lost dish options: %', v_result;
  END IF;
  IF jsonb_array_length(coalesce(v_result->'notification_ids','[]'::jsonb)) <> 0
     OR jsonb_array_length(coalesce(v_result->'dispatch_tokens','[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION 'QA failed: direct QR order returned owner approval alerts: %', v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public.mm_restaurant_notifications
  WHERE ticket_id = 'MM-CONSOL-QR-001' AND target_role = 'kitchen'
    AND notification_type = 'NEW_ORDER' AND resolved_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'QA failed: kitchen must receive exactly one NEW_ORDER alert, got %', v_count;
  END IF;
  IF EXISTS (SELECT 1 FROM public.mm_restaurant_notifications
    WHERE ticket_id = 'MM-CONSOL-QR-001' AND target_role = 'admin'
      AND notification_type = 'ORDER_APPROVAL' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'QA failed: direct QR order created an owner approval alert';
  END IF;

  -- 2. A stale/wrong code must not block ordering either (the code is retired,
  --    not enforced); security rests on the OPEN visit + visit id + session.
  v_result := public.mm_place_order(v_rest, '06', 'MM-CONSOL-QR-002', '',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_menu_id, 'quantity', 1)),
    v_visit_id, v_session, '000000');
  IF v_result->>'approvalStatus' <> 'APPROVED' THEN
    RAISE EXCEPTION 'QA failed: retired guest code changed order behaviour: %', v_result;
  END IF;

  -- 3. Duplicate ticket IDs are rejected and leave no second row (retry safety).
  v_rejected := false;
  BEGIN
    PERFORM public.mm_place_order(v_rest, '06', 'MM-CONSOL-QR-001', '',
      jsonb_build_array(jsonb_build_object('menu_item_id', v_menu_id, 'quantity', 1)),
      v_visit_id, v_session, NULL);
  EXCEPTION WHEN unique_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'QA failed: duplicate ticket ID was accepted';
  END IF;
  SELECT count(*) INTO v_count FROM public.orders WHERE ticket_id = 'MM-CONSOL-QR-001';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'QA failed: duplicate attempt created extra order rows (%)', v_count;
  END IF;

  -- 4. Missing customer session is rejected for anonymous callers.
  v_rejected := false;
  BEGIN
    PERFORM public.mm_place_order(v_rest, '06', 'MM-CONSOL-NOSESS-001', '',
      jsonb_build_array(jsonb_build_object('menu_item_id', v_menu_id, 'quantity', 1)),
      v_visit_id, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Customer session is missing%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: anonymous order without a session was accepted'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE ticket_id = 'MM-CONSOL-NOSESS-001') THEN
    RAISE EXCEPTION 'QA failed: rejected sessionless order left a ticket behind';
  END IF;

  -- 5. Ordering against a different/stale visit is rejected (cross-table protection).
  v_rejected := false;
  BEGIN
    PERFORM public.mm_place_order(v_rest, '06', 'MM-CONSOL-WRONGVISIT-001', '',
      jsonb_build_array(jsonb_build_object('menu_item_id', v_menu_id, 'quantity', 1)),
      '99999999-9999-4999-8999-999999999999'::uuid, v_session, NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'The table visit has changed%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: stale visit ID was accepted'; END IF;

  -- 6. A table with no OPEN visit refuses orders (waiter must seat first).
  SELECT t.table_number INTO v_closed_table
  FROM public.restaurant_tables t
  WHERE t.restaurant_id = v_rest AND t.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.restaurant_table_visits v
      WHERE v.table_id = t.id AND v.status = 'OPEN'
    )
  ORDER BY t.table_number LIMIT 1;
  IF v_closed_table IS NULL THEN
    RAISE EXCEPTION 'QA failed: expected at least one unseated active table for the gate test';
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.mm_place_order(v_rest, v_closed_table, 'MM-CONSOL-CLOSED-001', '',
      jsonb_build_array(jsonb_build_object('menu_item_id', v_menu_id, 'quantity', 1)),
      NULL, v_session, NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'This table is not open for online orders yet%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: unseated table % accepted an order', v_closed_table; END IF;

  -- 7. Invalid spice level and over-long dish notes are rejected server-side.
  v_rejected := false;
  BEGIN
    PERFORM public.mm_place_order(v_rest, '06', 'MM-CONSOL-BADSPICE-001', '',
      jsonb_build_array(jsonb_build_object('menu_item_id', v_menu_id, 'quantity', 1, 'spice_level', 'extreme')),
      v_visit_id, v_session, NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Choose a valid spice level%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: invalid spice level was accepted'; END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.mm_place_order(v_rest, '06', 'MM-CONSOL-LONGNOTE-001', '',
      jsonb_build_array(jsonb_build_object('menu_item_id', v_menu_id, 'quantity', 1, 'notes', repeat('x', 301))),
      v_visit_id, v_session, NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Per-dish notes must be 300%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: over-long dish note was accepted'; END IF;

  -- 8. Client-supplied prices are ignored; an unavailable dish is refused.
  v_result := public.mm_place_order(v_rest, '06', 'MM-CONSOL-PRICE-001', '',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_menu_id, 'quantity', 3, 'price', 1)),
    v_visit_id, v_session, NULL);
  IF (v_result->>'total')::numeric <> 36 THEN
    RAISE EXCEPTION 'QA failed: browser-supplied price influenced the total: %', v_result->>'total';
  END IF;
  UPDATE public.menu_items SET is_available = false WHERE id = v_menu_id;
  v_rejected := false;
  BEGIN
    PERFORM public.mm_place_order(v_rest, '06', 'MM-CONSOL-SOLDOUT-001', '',
      jsonb_build_array(jsonb_build_object('menu_item_id', v_menu_id, 'quantity', 1)),
      v_visit_id, v_session, NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'A selected dish is unavailable%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  UPDATE public.menu_items SET is_available = true WHERE id = v_menu_id;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: sold-out dish was accepted'; END IF;

  -- 9. Staff (waiter) orders still work without a customer session.
  PERFORM set_config('app.qa_role','waiter',false);
  v_result := public.mm_place_order(v_rest, '06', 'MM-CONSOL-WAITER-001', '[Waiter] QA',
    jsonb_build_array(jsonb_build_object('menu_item_id', v_menu_id, 'quantity', 1, 'spice_level', 'mild')),
    v_visit_id, NULL, NULL);
  IF v_result->>'approvalStatus' <> 'APPROVED' OR v_result->>'status' <> 'NEW' THEN
    RAISE EXCEPTION 'QA failed: waiter order was not routed straight to kitchen: %', v_result;
  END IF;
  PERFORM set_config('app.qa_role','',false);

  -- 10. Dish options survive customer token lookup and owner detail lookup.
  v_token := (SELECT public_token FROM public.orders WHERE ticket_id = 'MM-CONSOL-QR-001');
  v_public := public.mm_get_public_order('MM-CONSOL-QR-001', v_token);
  IF v_public->'items'->0->>'spiceLevel' IS DISTINCT FROM 'hot'
     OR v_public->'items'->0->>'notes' IS DISTINCT FROM 'No onion please'
     OR v_public->>'approvalStatus' IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'QA failed: customer ticket lookup lost options/approval state: %', v_public;
  END IF;
  IF public.mm_get_public_order('MM-CONSOL-QR-001', gen_random_uuid()) IS NOT NULL THEN
    RAISE EXCEPTION 'QA failed: wrong public token returned a ticket';
  END IF;
  PERFORM set_config('app.qa_role','admin',false);
  v_detail := public.mm_admin_get_order_details('MM-CONSOL-QR-001');
  IF v_detail->'items'->0->>'spice_level' IS DISTINCT FROM 'hot'
     OR v_detail->'items'->0->>'notes' IS DISTINCT FROM 'No onion please' THEN
    RAISE EXCEPTION 'QA failed: owner ticket lookup lost dish options: %', v_detail;
  END IF;
  PERFORM set_config('app.qa_role','waiter',false);
  v_rejected := false;
  BEGIN
    PERFORM public.mm_admin_get_order_details('MM-CONSOL-QR-001');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Owner/Admin access required' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: waiter read owner-only ticket details'; END IF;
  PERFORM set_config('app.qa_role','',false);

  -- 11. Approval workflow stays retired: default APPROVED, no owner triggers.
  IF (SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef
      WHERE adrelid = 'public.orders'::regclass
        AND adnum = (SELECT attnum FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attname='approval_status'))
     IS DISTINCT FROM '''APPROVED''::text' THEN
    RAISE EXCEPTION 'QA failed: approval_status default is not APPROVED';
  END IF;
  IF to_regprocedure('public.mm_notify_owner_pending_order()') IS NOT NULL
     OR to_regprocedure('public.mm_notify_kitchen_after_owner_approval()') IS NOT NULL THEN
    RAISE EXCEPTION 'QA failed: retired owner approval functions were re-installed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE restaurant_id = v_rest AND approval_status = 'PENDING') THEN
    RAISE EXCEPTION 'QA failed: pending approval tickets remain after consolidation';
  END IF;

  RAISE NOTICE 'QA passed: consolidated QR ordering keeps code-free seating validation, dish options, kitchen routing, duplicate protection and server-side prices.';
END
$qa$;