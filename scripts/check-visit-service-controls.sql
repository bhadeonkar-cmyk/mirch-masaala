\set ON_ERROR_STOP on

DO $qa$
DECLARE
  v_visit_id uuid;
  v_visit8 uuid;
  v_guest_session uuid := 'bbbbbbbb-0000-4000-8000-000000000006'::uuid;
  v_pin text;
  v_result jsonb;
  v_rows jsonb;
  v_rejected boolean;
  v_count integer;
  v_alert_id bigint;
  v_menu_id uuid := '66666666-6666-4666-8666-666666666666'::uuid;
  v_items jsonb;
BEGIN
  PERFORM set_config('app.qa_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
  INSERT INTO auth.users(id) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  ON CONFLICT (id) DO NOTHING;
  PERFORM set_config('app.qa_role','admin',false);

  INSERT INTO public.restaurant_tables(id,restaurant_id,table_number,is_active) VALUES
    ('66666666-6666-4666-8666-666666666661','a3702d10-6673-4c06-9783-1d61c945ecd5','06',true),
    ('77777777-7777-4777-8777-777777777771','a3702d10-6673-4c06-9783-1d61c945ecd5','07',true),
    ('88888888-8888-4888-8888-888888888881','a3702d10-6673-4c06-9783-1d61c945ecd5','08',true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.menu_items(id,restaurant_id,name,price,is_available,updated_at)
  VALUES(v_menu_id,'a3702d10-6673-4c06-9783-1d61c945ecd5','QA secure order dish',12,true,now())
  ON CONFLICT (id) DO UPDATE SET price=EXCLUDED.price,is_available=true;

  -- Home/table selection does not create a visit or make a table busy.
  PERFORM set_config('app.qa_role','',false);
  v_rejected := false;
  BEGIN
    PERFORM public.mm_ensure_public_table_visit('07');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'This table is not open for online orders yet%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'QA failed: public table lookup opened or accepted a table with no staffed visit';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.restaurant_table_visits
    WHERE table_number='07' AND status='OPEN'
  ) THEN
    RAISE EXCEPTION 'QA failed: opening the app created a busy table visit';
  END IF;

  -- A waiter starts a visit and receives a six-digit guest code with their waiter ID.
  PERFORM set_config('app.qa_role','waiter',false);
  v_result := public.mm_staff_set_table_visit_status('06','START','W06');
  v_visit_id := (v_result->>'visit_id')::uuid;
  v_pin := v_result->>'guest_order_code';
  IF v_result->>'status' <> 'OPEN' OR v_result->>'assigned_waiter_code' <> 'W06'
     OR v_pin !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'QA failed: visit did not return waiter ID and six-digit guest code: %',v_result;
  END IF;

  -- An incorrect PIN must be rejected before any ticket is written.
  v_items := jsonb_build_array(jsonb_build_object('menu_item_id',v_menu_id,'quantity',1));
  PERFORM set_config('app.qa_role','',false);
  v_rejected := false;
  BEGIN
    PERFORM public.mm_place_order(
      'a3702d10-6673-4c06-9783-1d61c945ecd5','06','MM-GUEST-BAD-001','',v_items,
      v_visit_id,v_guest_session,'000000'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'The 6-digit table order code is incorrect%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: incorrect guest table PIN was accepted'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE ticket_id='MM-GUEST-BAD-001') THEN
    RAISE EXCEPTION 'QA failed: invalid PIN left an order ticket behind';
  END IF;

  -- The correct code allows ordering only into this already-open visit.
  v_result := public.mm_place_order(
    'a3702d10-6673-4c06-9783-1d61c945ecd5','06','MM-GUEST-GOOD-001','',v_items,
    v_visit_id,v_guest_session,v_pin
  );
  IF v_result->>'visitId' IS DISTINCT FROM v_visit_id::text
     OR v_result->>'status' <> 'NEW'
     OR v_result->>'approvalStatus' <> 'PENDING' THEN
    RAISE EXCEPTION 'QA failed: valid PIN did not create a pending order tied to the active visit: %',v_result;
  END IF;
  IF jsonb_array_length(coalesce(v_result->'notification_ids','[]'::jsonb)) <> 1
     OR jsonb_array_length(coalesce(v_result->'dispatch_tokens','[]'::jsonb)) <> 1 THEN
    RAISE EXCEPTION 'QA failed: pending order did not return the owner notification and push dispatch token: %',v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mm_restaurant_notifications
    WHERE ticket_id='MM-GUEST-GOOD-001' AND target_role='admin'
      AND notification_type='ORDER_APPROVAL' AND resolved_at IS NULL
  ) THEN
    RAISE EXCEPTION 'QA failed: owner did not receive an approval alert';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mm_restaurant_notifications
    WHERE ticket_id='MM-GUEST-GOOD-001' AND target_role='kitchen'
      AND notification_type='NEW_ORDER'
  ) THEN
    RAISE EXCEPTION 'QA failed: pending order was sent to kitchen before owner approval';
  END IF;

  -- Only the owner can approve; approval resolves the owner alert and notifies the kitchen.
  PERFORM set_config('app.qa_role','admin',false);
  v_result := public.mm_admin_review_customer_order('MM-GUEST-GOOD-001','APPROVE','QA owner approval');
  IF v_result->>'approvalStatus' <> 'APPROVED' OR v_result->>'status' <> 'NEW' THEN
    RAISE EXCEPTION 'QA failed: owner approval did not update ticket state: %',v_result;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mm_restaurant_notifications
    WHERE ticket_id='MM-GUEST-GOOD-001' AND target_role='admin'
      AND notification_type='ORDER_APPROVAL' AND resolved_at IS NULL
  ) THEN
    RAISE EXCEPTION 'QA failed: owner approval alert stayed open after approval';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mm_restaurant_notifications
    WHERE ticket_id='MM-GUEST-GOOD-001' AND target_role='kitchen'
      AND notification_type='NEW_ORDER'
  ) THEN
    RAISE EXCEPTION 'QA failed: approved ticket did not notify the kitchen';
  END IF;

  -- Staff cannot release a table with an active kitchen ticket.
  PERFORM set_config('app.qa_role','waiter',false);
  v_rejected := false;
  BEGIN
    PERFORM public.mm_staff_release_abandoned_visit('06','QA active ticket protection');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Cancel or finish all active food tickets before freeing this table%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: active ticket did not block abandoned table release'; END IF;
  IF (SELECT status FROM public.restaurant_table_visits WHERE id=v_visit_id) <> 'OPEN' THEN
    RAISE EXCEPTION 'QA failed: blocked release still closed the active visit';
  END IF;

  -- A guest who leaves after serving can free the physical table, while the old balance stays on its visit.
  v_result := public.mm_staff_set_table_visit_status('08','START','W08');
  v_visit8 := (v_result->>'visit_id')::uuid;
  INSERT INTO public.orders(restaurant_id,table_id,table_visit_id,customer_session_id,status,total,ticket_id,created_at,updated_at)
  VALUES('a3702d10-6673-4c06-9783-1d61c945ecd5',
         '88888888-8888-4888-8888-888888888881',v_visit8,NULL,'SERVED',45,'MM-LEFT-UNPAID-001',now(),now());

  v_result := public.mm_staff_release_abandoned_visit('08','QA guests left early');
  IF v_result->>'visit_status' <> 'CLOSED' OR (v_result->>'amount')::numeric <> 45 THEN
    RAISE EXCEPTION 'QA failed: abandoned visit did not close with balance retained: %',v_result;
  END IF;

  SELECT count(*) INTO v_count FROM public.mm_restaurant_notifications
  WHERE ticket_id=v_visit8::text AND notification_type='GUEST_LEFT_UNPAID'
    AND resolved_at IS NULL AND target_role IN ('admin','waiter');
  IF v_count <> 2 THEN RAISE EXCEPTION 'QA failed: owner and assigned waiter did not both receive an unpaid alert'; END IF;

  SELECT id INTO v_alert_id FROM public.mm_restaurant_notifications
  WHERE ticket_id=v_visit8::text AND notification_type='GUEST_LEFT_UNPAID'
    AND target_role='waiter' AND resolved_at IS NULL LIMIT 1;
  IF NOT EXISTS (
    SELECT 1 FROM public.mm_restaurant_notifications
    WHERE id=v_alert_id AND target_staff_code='W08'
  ) THEN RAISE EXCEPTION 'QA failed: unpaid alert was not assigned to waiter W08'; END IF;

  -- Shared waiters' login can be the same, but the typed staff ID scopes actionable alerts.
  SELECT count(*) INTO v_count FROM public.mm_staff_notifications(50,'W09') n
  WHERE n.ticket_id=v_visit8::text;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'QA failed: waiter W09 can see waiter W08''s assigned alert';
  END IF;
  SELECT count(*) INTO v_count FROM public.mm_staff_notifications(50,'W08') n
  WHERE n.ticket_id=v_visit8::text;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'QA failed: assigned waiter W08 cannot see their alert';
  END IF;
  IF public.mm_resolve_staff_notification(v_alert_id,'W09') THEN
    RAISE EXCEPTION 'QA failed: waiter W09 resolved another waiter''s alert';
  END IF;

  v_rows := public.mm_staff_get_table_visits();
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_rows) a
    WHERE a->>'table_number'='08' AND a->>'status'='AVAILABLE'
  ) THEN
    RAISE EXCEPTION 'QA failed: table 08 was not available for the next party after release';
  END IF;

  -- Settling the old visit closes its old alert, and never charges a later visit.
  PERFORM set_config('app.qa_role','admin',false);
  v_result := public.mm_staff_record_visit_payment(v_visit8,45,'cash','QA settle old visit');
  IF (v_result->>'remaining_due')::numeric > 0.01 THEN
    RAISE EXCEPTION 'QA failed: old unpaid visit could not be settled independently';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mm_restaurant_notifications WHERE ticket_id=v_visit8::text
    AND notification_type='GUEST_LEFT_UNPAID' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'QA failed: unpaid alert remained open after settlement';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_payments WHERE ticket_id='MM-GUEST-GOOD-001') THEN
    RAISE EXCEPTION 'QA failed: old-visit settlement leaked onto the table 06 ticket';
  END IF;

  RAISE NOTICE 'QA passed: Home browsing creates no visit, order PIN is enforced, active tickets block release, assigned waiter alerts route correctly, and closed balances settle separately.';
END
$qa$;
