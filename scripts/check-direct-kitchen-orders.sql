\set ON_ERROR_STOP on

DO $qa$
DECLARE
  v_visit_id uuid;
  v_result jsonb;
  v_items jsonb;
  v_menu_id uuid := '66666666-6666-4666-8666-666666666666'::uuid;
  v_session uuid := 'bbbbbbbb-0000-4000-8000-000000000019'::uuid;
BEGIN
  PERFORM set_config('app.qa_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
  PERFORM set_config('app.qa_role','',false);

  SELECT id INTO v_visit_id
  FROM public.restaurant_table_visits
  WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND table_number='06' AND status='OPEN'
  ORDER BY started_at DESC LIMIT 1;

  IF v_visit_id IS NULL THEN
    RAISE EXCEPTION 'QA failed: direct QR order test has no open waiter-started table visit';
  END IF;

  v_items := jsonb_build_array(jsonb_build_object('menu_item_id',v_menu_id,'quantity',2));
  v_result := public.mm_place_order(
    'a3702d10-6673-4c06-9783-1d61c945ecd5',
    '06', 'MM-QRO-DIRECT-001', '', v_items, v_visit_id, v_session, NULL
  );

  IF v_result->>'status' <> 'NEW'
     OR v_result->>'approvalStatus' <> 'APPROVED'
     OR v_result->>'visitId' IS DISTINCT FROM v_visit_id::text THEN
    RAISE EXCEPTION 'QA failed: QR order was not auto-approved and linked to the open visit: %',v_result;
  END IF;
  IF jsonb_array_length(coalesce(v_result->'notification_ids','[]'::jsonb)) <> 0
     OR jsonb_array_length(coalesce(v_result->'dispatch_tokens','[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION 'QA failed: direct QR order returned owner approval alerts: %',v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.mm_restaurant_notifications
    WHERE ticket_id='MM-QRO-DIRECT-001' AND target_role='admin'
      AND notification_type='ORDER_APPROVAL' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'QA failed: direct QR order generated an owner approval alert';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mm_restaurant_notifications
    WHERE ticket_id='MM-QRO-DIRECT-001' AND target_role='kitchen'
      AND notification_type='NEW_ORDER' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'QA failed: kitchen was not notified of the new QR order';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders
    WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND approval_status='PENDING') THEN
    RAISE EXCEPTION 'QA failed: pending approval tickets remain';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mm_restaurant_notifications
    WHERE restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND target_role='admin' AND notification_type='ORDER_APPROVAL' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'QA failed: stale owner approval alert remains';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders
    WHERE ticket_id='MM-GUEST-LEGACY-001' AND (approval_status <> 'APPROVED' OR status <> 'NEW')) THEN
    RAISE EXCEPTION 'QA failed: legacy customer ticket was not released';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mm_restaurant_notifications
    WHERE ticket_id='MM-GUEST-LEGACY-001' AND target_role='kitchen'
      AND notification_type='NEW_ORDER' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'QA failed: legacy ticket was not surfaced to kitchen';
  END IF;

  RAISE NOTICE 'QA passed: no customer PIN, direct kitchen routing, no owner order alert, and safe legacy release.';
END
$qa$;
