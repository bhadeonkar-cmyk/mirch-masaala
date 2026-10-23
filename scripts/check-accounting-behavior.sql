\set ON_ERROR_STOP on

DO $qa$
DECLARE
  v_customer_token uuid;
  v_expired_token uuid;
  v_cooking_token uuid;
  v_preview jsonb;
  v_cleanup jsonb;
  v_result jsonb;
  v_payment jsonb;
  v_summary jsonb;
  v_bill jsonb;
  v_rejected boolean;
  v_status text;
  v_count integer;
  v_customer_id uuid;
  v_t2_new_id uuid;
  v_t2_served_id uuid;
  v_t2_paid_id uuid;
BEGIN
  PERFORM set_config('app.qa_uid', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
  PERFORM set_config('app.qa_role', 'admin', false);
  INSERT INTO auth.users(id) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

  INSERT INTO public.restaurant_tables(id, restaurant_id, table_number, is_active) VALUES
    ('11111111-1111-1111-1111-111111111111','a3702d10-6673-4c06-9783-1d61c945ecd5','01',true),
    ('22222222-2222-2222-2222-222222222222','a3702d10-6673-4c06-9783-1d61c945ecd5','02',true),
    ('33333333-3333-3333-3333-333333333333','a3702d10-6673-4c06-9783-1d61c945ecd5','03',true),
    ('44444444-4444-4444-4444-444444444444','a3702d10-6673-4c06-9783-1d61c945ecd5','04',true);

  INSERT INTO public.orders(restaurant_id,table_id,status,total,ticket_id)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5','11111111-1111-1111-1111-111111111111','NEW',30,'MM-CUST-001')
  RETURNING id, public_token INTO v_customer_id, v_customer_token;

  INSERT INTO public.orders(restaurant_id,table_id,status,total,ticket_id,created_at)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5','11111111-1111-1111-1111-111111111111','NEW',20,'MM-EXPIRE-01',now()-interval '8 minutes')
  RETURNING public_token INTO v_expired_token;

  INSERT INTO public.orders(restaurant_id,table_id,status,total,ticket_id)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5','11111111-1111-1111-1111-111111111111','PREPARING',25,'MM-COOK-001')
  RETURNING public_token INTO v_cooking_token;

  INSERT INTO public.orders(restaurant_id,table_id,status,total,ticket_id)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5','11111111-1111-1111-1111-111111111111','NEW',35,'MM-OWNER-01');

  INSERT INTO public.orders(restaurant_id,table_id,status,total,ticket_id)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5','11111111-1111-1111-1111-111111111111','SERVED',50,'MM-COMP-001');

  INSERT INTO public.orders(restaurant_id,table_id,status,total,ticket_id)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5','44444444-4444-4444-4444-444444444444','NEW',60,'MM-PAY-001');

  INSERT INTO public.orders(restaurant_id,table_id,status,total,ticket_id)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5','33333333-3333-3333-3333-333333333333','NEW',25,'MM-OVER-01');

  INSERT INTO public.orders(restaurant_id,table_id,status,total,ticket_id)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5','22222222-2222-2222-2222-222222222222','NEW',20,'MM-T2-NEW')
  RETURNING id INTO v_t2_new_id;
  INSERT INTO public.orders(restaurant_id,table_id,status,total,ticket_id)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5','22222222-2222-2222-2222-222222222222','SERVED',30,'MM-T2-DONE')
  RETURNING id INTO v_t2_served_id;
  INSERT INTO public.orders(restaurant_id,table_id,status,total,ticket_id)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5','22222222-2222-2222-2222-222222222222','PAID',40,'MM-T2-PAID')
  RETURNING id INTO v_t2_paid_id;

  INSERT INTO public.order_items(order_id,item_name,quantity,price)
  VALUES (v_t2_new_id,'QA test dish',1,20),(v_t2_served_id,'QA served dish',1,30),(v_t2_paid_id,'QA paid dish',1,40);
  INSERT INTO public.order_payments(restaurant_id,order_id,ticket_id,table_number,amount,method,note,received_by)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5',v_t2_paid_id,'MM-T2-PAID','02',40,'cash','QA seeded payment',auth.uid());

  -- Customer token validation: an unrelated token must not cancel this ticket.
  PERFORM set_config('app.qa_role','',false);
  v_rejected := false;
  BEGIN
    PERFORM public.mm_cancel_public_order('MM-CUST-001',gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Order not found or cancellation link expired%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: wrong customer token was accepted'; END IF;
  SELECT status INTO v_status FROM public.orders WHERE ticket_id='MM-CUST-001';
  IF v_status <> 'NEW' THEN RAISE EXCEPTION 'QA failed: wrong token changed the order'; END IF;

  v_result := public.mm_cancel_public_order('MM-CUST-001',v_customer_token);
  IF v_result->>'status' <> 'CANCELLED' THEN RAISE EXCEPTION 'QA failed: customer cancellation not persisted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_management_audit WHERE ticket_id='MM-CUST-001' AND action='CUSTOMER_CANCEL') THEN
    RAISE EXCEPTION 'QA failed: customer cancellation was not audited';
  END IF;

  -- Cancellation is rejected after 7 minutes and once kitchen preparation starts.
  v_rejected := false;
  BEGIN
    PERFORM public.mm_cancel_public_order('MM-EXPIRE-01',v_expired_token);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'The cancellation window has expired%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: expired cancellation was accepted'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.mm_cancel_public_order('MM-COOK-001',v_cooking_token);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'The kitchen has started this order%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: cooking order was customer-cancelled'; END IF;

  -- A cancelled ticket cannot be silently reopened.
  PERFORM set_config('app.qa_role','admin',false);
  v_rejected := false;
  BEGIN
    UPDATE public.orders SET status='NEW' WHERE ticket_id='MM-CUST-001';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Paid or cancelled orders cannot be reopened%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: cancelled ticket could be reopened'; END IF;

  -- Owner cancellation stores its reason in the audit log.
  v_result := public.mm_admin_cancel_order('MM-OWNER-01','QA owner cancellation');
  IF v_result->>'status' <> 'CANCELLED' OR NOT EXISTS (
    SELECT 1 FROM public.order_management_audit
    WHERE ticket_id='MM-OWNER-01' AND action='OWNER_CANCEL' AND reason='QA owner cancellation'
  ) THEN RAISE EXCEPTION 'QA failed: owner cancellation or audit failed'; END IF;

  -- A tasting/complimentary meal is recorded separately, not as cash received.
  v_result := public.mm_admin_set_complimentary('MM-COMP-001',true,'QA tasting meal');
  IF v_result->>'is_complimentary' <> 'true' OR NOT EXISTS (
    SELECT 1 FROM public.order_management_audit WHERE ticket_id='MM-COMP-001' AND action='MARK_COMPLIMENTARY'
  ) THEN RAISE EXCEPTION 'QA failed: complimentary meal classification failed'; END IF;

  -- Directly marking an order PAID must be refused; receipt must use the payment ledger.
  v_rejected := false;
  BEGIN
    UPDATE public.orders SET status='PAID' WHERE ticket_id='MM-OVER-01';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Record the payment through the staff payment function%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: direct PAID status update was allowed'; END IF;

  -- Staff payment function should settle only the actual table bill.
  PERFORM set_config('app.qa_role','waiter',false);
  v_payment := public.mm_staff_record_table_payment('04',60,'cash','QA payment');
  IF v_payment->>'status' <> 'RECORDED' OR (v_payment->>'fully_paid_tickets')::integer <> 1 THEN
    RAISE EXCEPTION 'QA failed: payment was not allocated/settled';
  END IF;
  SELECT status INTO v_status FROM public.orders WHERE ticket_id='MM-PAY-001';
  IF v_status <> 'PAID' THEN RAISE EXCEPTION 'QA failed: fully paid ticket did not close'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.mm_staff_record_table_payment('03',26,'cash','QA overpayment attempt');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Received amount exceeds the recorded outstanding bill%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: overpayment was accepted'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.order_payments p JOIN public.orders o ON o.id=p.order_id
    WHERE o.ticket_id='MM-OVER-01'
  ) THEN RAISE EXCEPTION 'QA failed: rejected overpayment left a receipt'; END IF;

  -- Only the owner can access preview/cleanup.
  v_rejected := false;
  BEGIN
    PERFORM public.mm_admin_preview_table_cleanup('02');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='Owner/Admin access required' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'QA failed: waiter was allowed to preview owner cleanup'; END IF;

  -- Preview/fingerprint confirmation archives table-02 history, cancels active tickets,
  -- and reports the true processed count (not preview-count + processed-count).
  PERFORM set_config('app.qa_role','admin',false);
  v_preview := public.mm_admin_preview_table_cleanup('02');
  IF (v_preview->>'candidate_count')::integer <> 3
     OR (v_preview->>'active_count')::integer <> 1
     OR (v_preview->>'recorded_payment_value')::numeric <> 40 THEN
    RAISE EXCEPTION 'QA failed: table cleanup preview totals are wrong: %',v_preview;
  END IF;
  v_cleanup := public.mm_admin_clear_table_orders(
    '02','QA/tasting cleanup',(v_preview->>'candidate_count')::integer,v_preview->>'fingerprint'
  );
  IF (v_cleanup->>'archived_count')::integer <> 3
     OR (v_cleanup->>'cancelled_active_count')::integer <> 1 THEN
    RAISE EXCEPTION 'QA failed: table cleanup counters are wrong: %',v_cleanup;
  END IF;
  SELECT count(*) INTO v_count FROM public.orders
  WHERE table_id='22222222-2222-2222-2222-222222222222'
    AND is_test_order AND archived_at IS NOT NULL;
  IF v_count <> 3 THEN RAISE EXCEPTION 'QA failed: table cleanup deleted/failed to archive history'; END IF;
  SELECT status INTO v_status FROM public.orders WHERE ticket_id='MM-T2-NEW';
  IF v_status <> 'CANCELLED' THEN RAISE EXCEPTION 'QA failed: active test ticket was not cancelled'; END IF;
  SELECT status INTO v_status FROM public.orders WHERE ticket_id='MM-T2-DONE';
  IF v_status <> 'SERVED' THEN RAISE EXCEPTION 'QA failed: completed ticket status/history was changed'; END IF;

  -- Archived tasting orders must not contribute to the public table balance or cash totals.
  v_bill := public.mm_get_public_table_bill('02');
  IF (v_bill->>'amount')::numeric <> 0 THEN RAISE EXCEPTION 'QA failed: archived orders remain on the customer bill'; END IF;
  v_summary := public.mm_admin_accounts_summary((now() AT TIME ZONE 'Asia/Kolkata')::date);
  IF (v_summary->>'paid_sales')::numeric <> 60
     OR (v_summary->>'customer_cancel_count')::integer <> 1
     OR (v_summary->>'owner_cancel_count')::integer <> 1
     OR (v_summary->>'complimentary_count')::integer <> 1
     OR (v_summary->>'test_count')::integer <> 3 THEN
    RAISE EXCEPTION 'QA failed: official accounts totals are inconsistent: %',v_summary;
  END IF;
END
$qa$;

SELECT 'PASS: cancellation, owner cleanup, payment guard, complimentary tracking and accounts totals' AS qa_result;
