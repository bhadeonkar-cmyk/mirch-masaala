\set ON_ERROR_STOP on

-- Isolated security mutation regression tests for Mirch Masaala.
-- Run AFTER the full CI migration sequence on the disposable fixture.
-- Never run against production.

DO $sec$
DECLARE
  v_rejected boolean;
  v_order_id uuid;
  v_table_a uuid := '11111111-1111-1111-1111-111111111111';
  v_table_b uuid := '22222222-2222-2222-2222-222222222222';
  v_visit_a uuid;
  v_visit_b uuid;
  v_session_a uuid := 'aaaaaaaa-0000-4000-8000-00000000000a'::uuid;
  v_session_b uuid := 'bbbbbbbb-0000-4000-8000-00000000000b'::uuid;
  v_count integer;
  v_has_open boolean;
  v_bill jsonb;
  v_fn record;
  v_unexpected text := '';
  v_cross_session_checked boolean := false;
BEGIN
  INSERT INTO public.restaurant_tables(id, restaurant_id, table_number, is_active) VALUES
    (v_table_a, 'a3702d10-6673-4c06-9783-1d61c945ecd5', '01', true),
    (v_table_b, 'a3702d10-6673-4c06-9783-1d61c945ecd5', '02', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.orders(restaurant_id, table_id, status, total, ticket_id)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5', v_table_a, 'NEW', 10, 'MM-SEC-PAY-001')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_order_id FROM public.orders WHERE ticket_id = 'MM-SEC-PAY-001' LIMIT 1;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'SECURITY FIXTURE: could not seed MM-SEC-PAY-001';
  END IF;

  PERFORM set_config('app.qa_role', '', false);
  PERFORM set_config('app.qa_uid', '', false);

  v_rejected := false;
  BEGIN
    SET ROLE anon;
    INSERT INTO public.order_payments
      (restaurant_id, order_id, ticket_id, table_number, amount, method, note)
    VALUES
      ('a3702d10-6673-4c06-9783-1d61c945ecd5', v_order_id, 'MM-SEC-PAY-001', '01', 10.00, 'cash', 'forged by customer');
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE; v_rejected := true;
  WHEN OTHERS THEN
    RESET ROLE;
    IF SQLSTATE IN ('42501','42503') OR SQLERRM ILIKE '%permission%' OR SQLERRM ILIKE '%policy%'
       OR SQLERRM ILIKE '%denied%' OR SQLERRM ILIKE '%row-level security%' THEN
      v_rejected := true;
    ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'SECURITY FAIL: anon INSERT into order_payments succeeded';
  END IF;
  SELECT count(*) INTO v_count FROM public.order_payments WHERE note = 'forged by customer';
  IF v_count > 0 THEN RAISE EXCEPTION 'SECURITY FAIL: forged payment row exists'; END IF;

  v_rejected := false;
  BEGIN
    SET ROLE anon;
    UPDATE public.order_payments SET amount = 999 WHERE ticket_id = 'MM-SEC-PAY-001';
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE; v_rejected := true;
  WHEN OTHERS THEN
    RESET ROLE;
    IF SQLSTATE IN ('42501','42503') OR SQLERRM ILIKE '%permission%' OR SQLERRM ILIKE '%policy%'
       OR SQLERRM ILIKE '%denied%' OR SQLERRM ILIKE '%does not exist%'
       OR SQLERRM ILIKE '%row-level security%' THEN
      v_rejected := true;
    ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'SECURITY FAIL: anon UPDATE order_payments succeeded'; END IF;

  PERFORM set_config('app.qa_role', '', false);
  v_rejected := false;
  BEGIN
    UPDATE public.orders SET status = 'PAID' WHERE ticket_id = 'MM-SEC-PAY-001';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Record the payment through the staff payment function%'
       OR SQLERRM LIKE 'Staff login required%'
       OR SQLERRM ILIKE '%permission%' THEN
      v_rejected := true;
    ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'SECURITY FAIL: direct status=PAID accepted'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_table_visits
    WHERE restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND table_id = v_table_a AND status = 'OPEN'
  ) INTO v_has_open;
  IF NOT v_has_open THEN
    INSERT INTO public.restaurant_table_visits
      (restaurant_id, table_id, table_number, status, started_at)
    VALUES
      ('a3702d10-6673-4c06-9783-1d61c945ecd5', v_table_a, '01', 'OPEN', now())
    RETURNING id INTO v_visit_a;
  ELSE
    SELECT id INTO v_visit_a FROM public.restaurant_table_visits
    WHERE table_id = v_table_a AND status = 'OPEN' LIMIT 1;
  END IF;

  v_rejected := false;
  BEGIN
    SET ROLE anon;
    UPDATE public.restaurant_table_visits
    SET guest_order_code = '999999', assigned_waiter_code = 'HACKED'
    WHERE table_number = '01' AND status = 'OPEN';
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE; v_rejected := true;
  WHEN OTHERS THEN
    RESET ROLE;
    IF SQLSTATE IN ('42501','42503') OR SQLERRM ILIKE '%permission%' OR SQLERRM ILIKE '%policy%'
       OR SQLERRM ILIKE '%denied%' OR SQLERRM ILIKE '%row-level security%' THEN
      v_rejected := true;
    ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'SECURITY FAIL: anon UPDATE restaurant_table_visits succeeded'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_table_visits
    WHERE table_id = v_table_b AND status = 'OPEN'
  ) THEN
    INSERT INTO public.restaurant_table_visits
      (restaurant_id, table_id, table_number, status, started_at)
    VALUES
      ('a3702d10-6673-4c06-9783-1d61c945ecd5', v_table_b, '02', 'OPEN', now())
    RETURNING id INTO v_visit_b;
  ELSE
    SELECT id INTO v_visit_b FROM public.restaurant_table_visits
    WHERE table_id = v_table_b AND status = 'OPEN' LIMIT 1;
  END IF;

  BEGIN
    UPDATE public.orders
    SET table_visit_id = v_visit_a, customer_session_id = v_session_a, total = 10
    WHERE id = v_order_id;
  EXCEPTION WHEN undefined_column THEN
    NULL;
  END;

  IF to_regprocedure('public.mm_guest_get_visit_bill(text,uuid,uuid)') IS NOT NULL THEN
    v_cross_session_checked := true;
    BEGIN
      v_bill := public.mm_guest_get_visit_bill('01', v_visit_a, v_session_b);
      IF v_bill IS NOT NULL AND coalesce((v_bill->>'amount')::numeric, (v_bill->>'balance')::numeric, 0) > 0 THEN
        RAISE EXCEPTION 'SECURITY FAIL: session B read visit A bill amount %', v_bill;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'SECURITY FAIL:%' THEN
        RAISE;
      END IF;
      NULL;
    END;
  ELSIF to_regprocedure('public.mm_get_public_visit_bill(text,uuid,uuid)') IS NOT NULL THEN
    v_cross_session_checked := true;
    BEGIN
      v_bill := public.mm_get_public_visit_bill('01', v_visit_a, v_session_b);
      IF v_bill IS NOT NULL AND coalesce((v_bill->>'amount')::numeric, (v_bill->>'balance')::numeric, 0) > 0 THEN
        RAISE EXCEPTION 'SECURITY FAIL: session B read visit A bill amount %', v_bill;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'SECURITY FAIL:%' THEN
        RAISE;
      END IF;
      NULL;
    END;
  ELSE
    RAISE NOTICE 'cross-session visit bill RPC not present in this fixture; skipping ownership bill check';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('order_payments', 'restaurant_table_visits', 'orders', 'order_items')
      AND grantee IN ('anon')
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'SECURITY FAIL: anon still has INSERT/UPDATE/DELETE on sensitive tables';
  END IF;

  FOR v_fn IN
    SELECT p.proname AS name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname NOT IN (
        'mm_place_order',
        'mm_get_public_order',
        'mm_cancel_public_order',
        'mm_ensure_public_table_visit',
        'mm_get_public_table_bill',
        'mm_get_public_visit_bill',
        'mm_guest_get_visit_bill',
        'mm_guest_request_payment_check',
        'mm_guest_request_visit_payment_check',
        'mm_guest_cash_counter_release',
        'mm_request_cash_counter_release',
        'mm_submit_party_booking',
        'get_my_staff_role',
        'mm_get_public_table_status',
        'mm_list_public_table_status',
        'mm_public_table_status_circles',
        'mm_public_order_board',
        'mm_guard_order_update',
        'mm_touch_table_visit_activity',
        'mm_notify_kitchen_new_order',
        'mm_notify_order_ready',
        'mm_notify_menu_sold_out',
        'mm_create_guest_notification'
      )
      AND p.proname NOT LIKE 'mm_get_public%'
      AND p.proname NOT LIKE 'mm_guest%'
      AND p.proname NOT LIKE 'mm_submit%'
      AND p.proname NOT LIKE 'mm_public%'
      AND p.proname NOT LIKE 'mm_notify_%'
      AND p.proname NOT LIKE 'mm_guard_%'
      AND p.proname NOT LIKE 'mm_touch_%'
  LOOP
    v_unexpected := v_unexpected || v_fn.name || '(' || v_fn.args || '); ';
  END LOOP;
  IF v_unexpected <> '' THEN
    RAISE EXCEPTION 'SECURITY FAIL: unexpected SECURITY DEFINER execute grant(s) to anon: %', v_unexpected;
  END IF;

  RAISE NOTICE 'PASS: payment forgery, visit ownership, cross-session bill (checked=%), grants, SECURITY DEFINER surface',
    v_cross_session_checked;
END
$sec$;

SELECT 'PASS: security mutation regression (forgery + ownership + grants + definer surface)' AS security_qa_result;
