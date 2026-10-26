\set ON_ERROR_STOP on

DO $qa$
DECLARE
  v_visit uuid := 'aaaaaaaa-0000-4000-8000-000000000001'::uuid;
  v_session_a uuid := 'bbbbbbbb-0000-4000-8000-000000000001'::uuid;
  v_session_b uuid := 'bbbbbbbb-0000-4000-8000-000000000002'::uuid;
  v_result jsonb;
  v_bill_a jsonb;
  v_bill_b jsonb;
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
  VALUES (v_visit,'a3702d10-6673-4c06-9783-1d61c945ecd5',
          '55555555-5555-5555-5555-555555555555','05','OPEN',now(),now());

  -- Two diners on the same table submit separate tickets in the same active visit.
  INSERT INTO public.orders
    (restaurant_id,table_id,table_visit_id,customer_session_id,status,total,ticket_id,created_at,updated_at)
  VALUES
    ('a3702d10-6673-4c06-9783-1d61c945ecd5',
     '55555555-5555-5555-5555-555555555555',v_visit,v_session_a,
     'SERVED',60,'MM-CASH-A',now(),now()),
    ('a3702d10-6673-4c06-9783-1d61c945ecd5',
     '55555555-5555-5555-5555-555555555555',v_visit,v_session_b,
     'SERVED',10,'MM-CASH-B',now(),now());

  -- Asking to pay cash must notify the Owner/Counter but must not free the table.
  v_result := public.mm_guest_cash_counter_release('05',v_visit,v_session_a);
  IF v_result->>'visit_status' <> 'OPEN' OR (v_result->>'amount')::numeric <> 70 THEN
    RAISE EXCEPTION 'QA failed: cash request should leave the shared visit active with the combined balance: %',v_result;
  END IF;
  IF (SELECT status FROM public.restaurant_table_visits WHERE id=v_visit) <> 'OPEN' THEN
    RAISE EXCEPTION 'QA failed: the table was released before cash payment was recorded';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.mm_restaurant_notifications
  WHERE notification_type='CASH_AT_COUNTER' AND ticket_id=v_visit::text
    AND target_role IN ('admin','waiter') AND resolved_at IS NULL;
  IF v_count <> 2 THEN RAISE EXCEPTION 'QA failed: expected owner and waiter cash alerts, found %',v_count; END IF;

  -- Each phone verifies its own ticket but sees the same combined table-visit balance.
  v_bill_a := public.mm_guest_get_visit_bill('05',v_visit,v_session_a);
  v_bill_b := public.mm_guest_get_visit_bill('05',v_visit,v_session_b);
  IF (v_bill_a->>'amount')::numeric <> 70 OR (v_bill_b->>'amount')::numeric <> 70
     OR (v_bill_a->>'order_count')::integer <> 2 OR (v_bill_b->>'order_count')::integer <> 2 THEN
    RAISE EXCEPTION 'QA failed: both diners should see the combined bill for their shared visit: A %, B %',v_bill_a,v_bill_b;
  END IF;

  -- Waiter may attend the alert, but only Owner/Counter (Admin login) records payment.
  PERFORM set_config('app.qa_role','waiter',false);
  v_result := public.mm_staff_get_visit_bill(v_visit);
  IF (v_result->>'amount')::numeric <> 70 OR (v_result->>'order_count')::integer <> 2 THEN
    RAISE EXCEPTION 'QA failed: counter bill did not combine both tickets: %',v_result;
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.mm_staff_record_visit_payment(v_visit,70,'cash','QA waiter cash attempt');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Only the Owner/Counter (Admin login) can confirm and record payments%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: waiter was allowed to record visit payment'; END IF;

  PERFORM set_config('app.qa_role','admin',false);
  -- Partial settlement must not free the table or dismiss the cash alert.
  v_result := public.mm_staff_record_visit_payment(v_visit,60,'cash','QA partial cash at counter');
  IF v_result->>'status' <> 'RECORDED'
     OR (v_result->>'remaining_due')::numeric <> 10
     OR v_result->>'visit_status' <> 'OPEN' THEN
    RAISE EXCEPTION 'QA failed: partial settlement should leave the visit open with ₹10 due: %',v_result;
  END IF;
  IF (SELECT status FROM public.restaurant_table_visits WHERE id=v_visit) <> 'OPEN' THEN
    RAISE EXCEPTION 'QA failed: a partially-paid table was freed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mm_restaurant_notifications
                 WHERE ticket_id=v_visit::text AND notification_type='CASH_AT_COUNTER' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'QA failed: cash request alert was resolved before the balance was settled';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.mm_staff_set_table_visit_status('05','FINISH');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Table % still has ₹% unpaid%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: staff was allowed to finish a visit with an unpaid balance'; END IF;

  -- Only after the final ₹10 is recorded should the table become available.
  v_result := public.mm_staff_record_visit_payment(v_visit,10,'cash','QA final cash settlement');
  IF (v_result->>'remaining_due')::numeric > 0.01 OR v_result->>'visit_status' <> 'CLOSED' THEN
    RAISE EXCEPTION 'QA failed: fully settled shared visit was not closed: %',v_result;
  END IF;
  IF (SELECT status FROM public.restaurant_table_visits WHERE id=v_visit) <> 'CLOSED' THEN
    RAISE EXCEPTION 'QA failed: fully paid visit still occupies the table';
  END IF;
  SELECT count(*) INTO v_count FROM public.orders
  WHERE ticket_id IN ('MM-CASH-A','MM-CASH-B') AND status='PAID';
  IF v_count <> 2 THEN RAISE EXCEPTION 'QA failed: both tickets should be marked paid, found %',v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.mm_restaurant_notifications
             WHERE ticket_id=v_visit::text AND notification_type='CASH_AT_COUNTER' AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'QA failed: cash alert stayed open after full settlement'; END IF;
  SELECT count(*) INTO v_count FROM public.order_payments
  WHERE ticket_id IN ('MM-CASH-A','MM-CASH-B') AND amount > 0;
  IF v_count <> 2 THEN RAISE EXCEPTION 'QA failed: payment ledger should allocate both tickets; found %',v_count; END IF;

  RAISE NOTICE 'QA passed: separate diner tickets share one visit bill; cash request alerts staff without freeing the table; full settlement frees it.';
END
$qa$;
