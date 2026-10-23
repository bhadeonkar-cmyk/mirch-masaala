\set ON_ERROR_STOP on

DO $qa$
DECLARE
  v_old_visit uuid := 'aaaaaaaa-0000-4000-8000-000000000001'::uuid;
  v_new_visit uuid := 'aaaaaaaa-0000-4000-8000-000000000002'::uuid;
  v_old_session uuid := 'bbbbbbbb-0000-4000-8000-000000000001'::uuid;
  v_new_session uuid := 'bbbbbbbb-0000-4000-8000-000000000002'::uuid;
  v_result jsonb;
  v_old_bill jsonb;
  v_new_bill jsonb;
  v_status text;
  v_count integer;
  v_rejected boolean;
BEGIN
  PERFORM set_config('app.qa_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
  PERFORM set_config('app.qa_role','',false);
  INSERT INTO auth.users(id) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.restaurant_tables(id,restaurant_id,table_number,is_active)
  VALUES ('55555555-5555-5555-5555-555555555555',
          'a3702d10-6673-4c06-9783-1d61c945ecd5','05',true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.restaurant_table_visits
    (id,restaurant_id,table_id,table_number,status,started_at,last_activity_at)
  VALUES (v_old_visit,'a3702d10-6673-4c06-9783-1d61c945ecd5',
          '55555555-5555-5555-5555-555555555555','05','OPEN',now(),now());

  INSERT INTO public.orders
    (restaurant_id,table_id,table_visit_id,customer_session_id,status,total,ticket_id,created_at,updated_at)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5',
          '55555555-5555-5555-5555-555555555555',v_old_visit,v_old_session,
          'SERVED',60,'MM-CASH-OLD',now(),now());

  v_result := public.mm_guest_cash_counter_release('05',v_old_visit,v_old_session);
  IF v_result->>'visit_status' <> 'CLOSED' OR (v_result->>'amount')::numeric <> 60 THEN
    RAISE EXCEPTION 'QA failed: cash checkout did not release the table with the old balance retained: %',v_result;
  END IF;
  IF (SELECT status FROM public.restaurant_table_visits WHERE id=v_old_visit) <> 'CLOSED' THEN
    RAISE EXCEPTION 'QA failed: the old table visit is not closed';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.mm_restaurant_notifications
  WHERE notification_type='CASH_AT_COUNTER' AND ticket_id=v_old_visit::text
    AND target_role IN ('admin','waiter') AND resolved_at IS NULL;
  IF v_count <> 2 THEN RAISE EXCEPTION 'QA failed: expected owner and waiter cash alerts, found %',v_count; END IF;

  -- A new party uses the same physical table but must get a different bill/visit.
  INSERT INTO public.restaurant_table_visits
    (id,restaurant_id,table_id,table_number,status,started_at,last_activity_at)
  VALUES (v_new_visit,'a3702d10-6673-4c06-9783-1d61c945ecd5',
          '55555555-5555-5555-5555-555555555555','05','OPEN',now(),now());

  INSERT INTO public.orders
    (restaurant_id,table_id,table_visit_id,customer_session_id,status,total,ticket_id,created_at,updated_at)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5',
          '55555555-5555-5555-5555-555555555555',v_new_visit,v_new_session,
          'SERVED',10,'MM-CASH-NEW',now(),now());

  PERFORM set_config('app.qa_role','waiter',false);
  v_old_bill := public.mm_staff_get_visit_bill(v_old_visit);
  v_new_bill := public.mm_staff_get_visit_bill(v_new_visit);
  IF (v_old_bill->>'amount')::numeric <> 60 OR (v_new_bill->>'amount')::numeric <> 10 THEN
    RAISE EXCEPTION 'QA failed: balances crossed visits on the same table: old %, new %',v_old_bill,v_new_bill;
  END IF;

  v_result := public.mm_staff_record_visit_payment(v_old_visit,60,'cash','QA cash at counter');
  IF v_result->>'status' <> 'RECORDED' OR (v_result->>'remaining_due')::numeric > 0.01 THEN
    RAISE EXCEPTION 'QA failed: old visit cash payment was not fully recorded: %',v_result;
  END IF;
  SELECT status INTO v_status FROM public.orders WHERE ticket_id='MM-CASH-OLD';
  IF v_status <> 'PAID' THEN RAISE EXCEPTION 'QA failed: old visit ticket did not become PAID'; END IF;
  SELECT status INTO v_status FROM public.orders WHERE ticket_id='MM-CASH-NEW';
  IF v_status <> 'SERVED' THEN RAISE EXCEPTION 'QA failed: new party order status changed unexpectedly'; END IF;
  IF EXISTS (SELECT 1 FROM public.order_payments WHERE ticket_id='MM-CASH-NEW') THEN
    RAISE EXCEPTION 'QA failed: old guest payment was assigned to the new party';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mm_restaurant_notifications
             WHERE ticket_id=v_old_visit::text AND notification_type='CASH_AT_COUNTER' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'QA failed: cash alert stayed open after the balance was settled';
  END IF;

  -- A staff FINISH action only evaluates this new visit, not the old one.
  v_rejected := false;
  BEGIN
    PERFORM public.mm_staff_set_table_visit_status('05','FINISH');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Table % still has ₹% unpaid%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: staff was allowed to finish a table visit with an unpaid new bill'; END IF;

  v_result := public.mm_staff_record_visit_payment(v_new_visit,10,'cash','QA new party cash');
  IF (v_result->>'remaining_due')::numeric > 0.01 OR (v_result->>'visit_status') <> 'CLOSED' THEN
    RAISE EXCEPTION 'QA failed: new visit was not independently settled: %',v_result;
  END IF;

  SELECT count(*) INTO v_count FROM public.order_payments
  WHERE ticket_id IN ('MM-CASH-OLD','MM-CASH-NEW') AND amount > 0;
  IF v_count <> 2 THEN RAISE EXCEPTION 'QA failed: expected exactly one ledger payment for each visit ticket; found %',v_count; END IF;

  RAISE NOTICE 'QA passed: cash checkout released Table 05, owner/waiter alerts were created, and separate visit balances were settled independently.';
END
$qa$;
