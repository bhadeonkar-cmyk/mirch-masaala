-- Mirch Masaala: safely release a table for the next party while retaining
-- any cash-at-counter balance against the original table visit.
-- Run after order-management-accounting.sql, table-visits.sql,
-- visit-billing-upgrade.sql, role-notifications.sql, and customer-payment-confirmation.sql.
-- Optional staff push is detected dynamically; in-app alerts still work without it.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.restaurant_table_visits') IS NULL
     OR to_regclass('public.restaurant_tables') IS NULL
     OR to_regclass('public.orders') IS NULL
     OR to_regclass('public.order_payments') IS NULL
     OR to_regclass('public.order_management_audit') IS NULL
     OR to_regclass('public.mm_restaurant_notifications') IS NULL THEN
    RAISE EXCEPTION 'Run the table-visit, order-accounting, and role-notification migrations first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attname='table_visit_id' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attname='customer_session_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Run supabase/visit-billing-upgrade.sql first.';
  END IF;
END
$$;

-- Preserve every existing alert type and add the cash-at-counter request.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='public.mm_restaurant_notifications'::regclass
      AND contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%notification_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.mm_restaurant_notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE public.mm_restaurant_notifications
    ADD CONSTRAINT mm_restaurant_notifications_type_check
    CHECK (notification_type IN (
      'WAITER_CALL','BILL_REQUEST','NEW_ORDER','ORDER_READY','ITEM_SOLD_OUT',
      'PARTY_BOOKING','PAYMENT_CHECK','CASH_AT_COUNTER','GUEST_LEFT_UNPAID'
    ));
END
$$;

-- Anonymous customer can see the shared amount for a specific visit only after
-- proving possession of the browser-session UUID attached to one of its orders.
CREATE OR REPLACE FUNCTION public.mm_guest_get_visit_bill(
  p_table_number text,
  p_visit_id uuid,
  p_customer_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table text;
  v_visit public.restaurant_table_visits%ROWTYPE;
  v_table_id uuid;
  v_amount numeric(12,2);
  v_count integer;
  v_in_progress boolean;
BEGIN
  IF p_table_number IS NULL OR trim(p_table_number) !~ '^[0-9]{1,2}$' OR p_visit_id IS NULL OR p_customer_session_id IS NULL THEN
    RAISE EXCEPTION 'Your table visit could not be verified. Refresh your order and try again.';
  END IF;
  v_table := lpad(trim(p_table_number), 2, '0');

  SELECT t.id INTO v_table_id
  FROM public.restaurant_tables t
  WHERE t.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text,2,'0')=v_table AND t.is_active=true
  LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;

  SELECT v.* INTO v_visit
  FROM public.restaurant_table_visits v
  WHERE v.id=p_visit_id AND v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND v.table_id=v_table_id AND v.table_number=v_table;
  IF NOT FOUND THEN RAISE EXCEPTION 'This table visit could not be found. Refresh and try again.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_table_id
      AND o.table_visit_id=v_visit.id AND o.customer_session_id=p_customer_session_id
      AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false
      AND o.archived_at IS NULL AND upper(coalesce(o.status,''))<>'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'We could not verify the order from this phone. Please ask staff for the bill.';
  END IF;

  SELECT
    coalesce(sum(greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)),0),
    count(*) FILTER (WHERE greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)>0.01)::integer,
    coalesce(bool_or(upper(coalesce(o.status,'')) IN ('NEW','PREPARING','READY')),false)
  INTO v_amount, v_count, v_in_progress
  FROM public.orders o
  LEFT JOIN (
    SELECT order_id,sum(amount) AS paid FROM public.order_payments GROUP BY order_id
  ) p ON p.order_id=o.id
  WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_table_id AND o.table_visit_id=v_visit.id
    AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false
    AND o.archived_at IS NULL;

  RETURN jsonb_build_object(
    'table',v_table,'visit_id',v_visit.id,'visit_status',v_visit.status,
    'amount',round(coalesce(v_amount,0),2),'order_count',coalesce(v_count,0),
    'orders_in_progress',coalesce(v_in_progress,false)
  );
END
$$;

-- Signed-in counter/owner uses this for the exact visit shown in an alert.
CREATE OR REPLACE FUNCTION public.mm_staff_get_visit_bill(p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_visit public.restaurant_table_visits%ROWTYPE;
  v_table text;
  v_amount numeric(12,2);
  v_count integer;
  v_in_progress boolean;
BEGIN
  IF coalesce(public.get_my_staff_role(),'') NOT IN ('admin','waiter') THEN
    RAISE EXCEPTION 'Owner/Admin or signed-in counter staff access required';
  END IF;
  SELECT v.* INTO v_visit
  FROM public.restaurant_table_visits v
  WHERE v.id=p_visit_id AND v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Table visit not found'; END IF;
  v_table:=lpad(v_visit.table_number,2,'0');

  SELECT
    coalesce(sum(greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)),0),
    count(*) FILTER (WHERE greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)>0.01)::integer,
    coalesce(bool_or(upper(coalesce(o.status,'')) IN ('NEW','PREPARING','READY')),false)
  INTO v_amount,v_count,v_in_progress
  FROM public.orders o
  LEFT JOIN (SELECT order_id,sum(amount) AS paid FROM public.order_payments GROUP BY order_id) p ON p.order_id=o.id
  WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_visit.table_id AND o.table_visit_id=v_visit.id
    AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL;

  RETURN jsonb_build_object(
    'table',v_table,'visit_id',v_visit.id,'visit_status',v_visit.status,
    'amount',round(coalesce(v_amount,0),2),'order_count',coalesce(v_count,0),
    'orders_in_progress',coalesce(v_in_progress,false)
  );
END
$$;

-- Customer chooses cash-at-counter and confirms they are leaving. The visit is
-- closed (table becomes available) but the unpaid balance remains in the ledger.
CREATE OR REPLACE FUNCTION public.mm_guest_cash_counter_release(
  p_table_number text,
  p_visit_id uuid,
  p_customer_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table text;
  v_table_id uuid;
  v_visit public.restaurant_table_visits%ROWTYPE;
  v_amount numeric(12,2);
  v_role text;
  v_existing bigint;
  v_id bigint;
  v_token text;
  v_message text;
  v_ids bigint[] := ARRAY[]::bigint[];
  v_tokens jsonb := '[]'::jsonb;
  v_has_push boolean;
BEGIN
  IF coalesce(public.get_my_staff_role(),'') IN ('admin','waiter','kitchen') THEN
    RAISE EXCEPTION 'Staff must use the staff payment workflow.';
  END IF;
  IF p_table_number IS NULL OR trim(p_table_number) !~ '^[0-9]{1,2}$' OR p_visit_id IS NULL OR p_customer_session_id IS NULL THEN
    RAISE EXCEPTION 'Your table visit could not be verified. Refresh your order and try again.';
  END IF;
  v_table:=lpad(trim(p_table_number),2,'0');

  SELECT t.id INTO v_table_id
  FROM public.restaurant_tables t
  WHERE t.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text,2,'0')=v_table AND t.is_active=true
  LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_table_id::text));
  SELECT v.* INTO v_visit
  FROM public.restaurant_table_visits v
  WHERE v.id=p_visit_id AND v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND v.table_id=v_table_id AND v.table_number=v_table
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This table visit could not be found. Refresh and try again.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_table_id
      AND o.table_visit_id=v_visit.id AND o.customer_session_id=p_customer_session_id
      AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false
      AND o.archived_at IS NULL AND upper(coalesce(o.status,''))<>'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'We could not verify the order from this phone. Please ask staff for help.';
  END IF;

  -- Idempotent retry when the network response was lost after successful release.
  IF v_visit.status='CLOSED' THEN
    IF EXISTS (
      SELECT 1 FROM public.mm_restaurant_notifications n
      WHERE n.restaurant_id=v_visit.restaurant_id AND n.notification_type='CASH_AT_COUNTER'
        AND n.ticket_id=v_visit.id::text
    ) THEN
      SELECT coalesce(sum(greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)),0)
      INTO v_amount
      FROM public.orders o
      LEFT JOIN (SELECT order_id,sum(amount) AS paid FROM public.order_payments GROUP BY order_id) p ON p.order_id=o.id
      WHERE o.table_visit_id=v_visit.id AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID')
        AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL;
      RETURN jsonb_build_object('ok',true,'table',v_table,'visit_id',v_visit.id,'visit_status','CLOSED',
        'amount',round(coalesce(v_amount,0),2),'already_released',true,'notification_ids','[]'::jsonb,'dispatch_tokens','[]'::jsonb);
    END IF;
    RAISE EXCEPTION 'This table visit has already ended. Please ask staff if you still have a balance.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_table_id AND o.table_visit_id=v_visit.id
      AND upper(coalesce(o.status,'')) IN ('NEW','PREPARING','READY')
      AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Please wait until all food orders are served before releasing the table.';
  END IF;

  SELECT coalesce(sum(greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)),0)
  INTO v_amount
  FROM public.orders o
  LEFT JOIN (SELECT order_id,sum(amount) AS paid FROM public.order_payments GROUP BY order_id) p ON p.order_id=o.id
  WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_table_id AND o.table_visit_id=v_visit.id
    AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL;

  UPDATE public.restaurant_table_visits
  SET status='CLOSED',finished_at=now(),finished_by=auth.uid(),last_activity_at=now()
  WHERE id=v_visit.id AND status='OPEN';

  IF coalesce(v_amount,0)<=0.01 THEN
    RETURN jsonb_build_object('ok',true,'table',v_table,'visit_id',v_visit.id,'visit_status','CLOSED',
      'amount',0,'already_released',false,'notification_ids','[]'::jsonb,'dispatch_tokens','[]'::jsonb);
  END IF;

  v_message:=format(
    'CASH AT COUNTER · Table %s · Guest is leaving now and says they will pay cash at the counter · Visit %s · Balance ₹%s',
    v_table,left(v_visit.id::text,8),to_char(v_amount,'FM999999990.00')
  );
  SELECT
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.mm_restaurant_notifications'::regclass AND attname='push_dispatch_token' AND NOT attisdropped)
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.mm_restaurant_notifications'::regclass AND attname='push_sent_at' AND NOT attisdropped)
  INTO v_has_push;

  FOREACH v_role IN ARRAY ARRAY['admin','waiter']::text[]
  LOOP
    SELECT n.id INTO v_existing FROM public.mm_restaurant_notifications n
    WHERE n.restaurant_id=v_visit.restaurant_id AND n.target_role=v_role
      AND n.notification_type='CASH_AT_COUNTER' AND n.ticket_id=v_visit.id::text
      AND n.resolved_at IS NULL
    ORDER BY n.created_at DESC LIMIT 1;

    IF v_existing IS NOT NULL THEN
      v_ids:=array_append(v_ids,v_existing);
      v_existing:=NULL;
      CONTINUE;
    END IF;

    IF v_has_push THEN
      v_token:=gen_random_uuid()::text;
      EXECUTE 'INSERT INTO public.mm_restaurant_notifications
        (restaurant_id,target_role,notification_type,table_number,ticket_id,message,push_dispatch_token)
        VALUES ($1,$2,''CASH_AT_COUNTER'',$3,$4,$5,$6) RETURNING id'
      INTO v_id USING v_visit.restaurant_id,v_role,v_table,v_visit.id::text,v_message,v_token;
      v_tokens:=v_tokens||jsonb_build_array(jsonb_build_object('id',v_id,'token',v_token));
    ELSE
      INSERT INTO public.mm_restaurant_notifications
        (restaurant_id,target_role,notification_type,table_number,ticket_id,message)
      VALUES (v_visit.restaurant_id,v_role,'CASH_AT_COUNTER',v_table,v_visit.id::text,v_message)
      RETURNING id INTO v_id;
    END IF;
    v_ids:=array_append(v_ids,v_id);
  END LOOP;

  RETURN jsonb_build_object('ok',true,'table',v_table,'visit_id',v_visit.id,'visit_status','CLOSED',
    'amount',round(v_amount,2),'already_released',false,'notification_ids',to_jsonb(v_ids),
    'dispatch_tokens',v_tokens,'message','The table is released and counter staff have been notified.');
END
$$;

-- New visit-aware UPI confirmation alert. The customer still cannot mark a bill paid.
CREATE OR REPLACE FUNCTION public.mm_guest_request_visit_payment_check(
  p_restaurant_id uuid,
  p_table_number text,
  p_visit_id uuid,
  p_customer_session_id uuid,
  p_method text DEFAULT 'upi'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table text:=lpad(trim(coalesce(p_table_number,'')),2,'0');
  v_method text:=lower(trim(coalesce(p_method,'upi')));
  v_visit public.restaurant_table_visits%ROWTYPE;
  v_table_id uuid;
  v_role text;
  v_existing bigint;
  v_id bigint;
  v_token text;
  v_message text;
  v_amount numeric(12,2);
  v_ids bigint[]:=ARRAY[]::bigint[];
  v_tokens jsonb:='[]'::jsonb;
  v_has_push boolean;
BEGIN
  IF p_restaurant_id IS DISTINCT FROM 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid THEN RAISE EXCEPTION 'Unknown restaurant'; END IF;
  IF v_table !~ '^[0-9]{2}$' OR p_visit_id IS NULL OR p_customer_session_id IS NULL THEN
    RAISE EXCEPTION 'Your table visit could not be verified.';
  END IF;
  IF v_method NOT IN ('upi','gpay','phonepe') THEN RAISE EXCEPTION 'Choose a supported digital payment method'; END IF;

  SELECT t.id INTO v_table_id FROM public.restaurant_tables t
  WHERE t.restaurant_id=p_restaurant_id AND lpad(t.table_number::text,2,'0')=v_table AND t.is_active=true LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;
  SELECT v.* INTO v_visit FROM public.restaurant_table_visits v
  WHERE v.id=p_visit_id AND v.restaurant_id=p_restaurant_id AND v.table_id=v_table_id AND v.table_number=v_table;
  IF NOT FOUND OR v_visit.status<>'OPEN' THEN RAISE EXCEPTION 'This table visit has ended. Please ask staff for the current bill.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o WHERE o.restaurant_id=p_restaurant_id AND o.table_id=v_table_id
      AND o.table_visit_id=v_visit.id AND o.customer_session_id=p_customer_session_id
      AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false
      AND o.archived_at IS NULL AND upper(coalesce(o.status,''))<>'CANCELLED'
  ) THEN RAISE EXCEPTION 'We could not verify the order from this phone. Please ask staff for the bill.'; END IF;

  SELECT coalesce(sum(greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)),0)
  INTO v_amount
  FROM public.orders o
  LEFT JOIN (SELECT order_id,sum(amount) AS paid FROM public.order_payments GROUP BY order_id) p ON p.order_id=o.id
  WHERE o.table_visit_id=v_visit.id AND o.restaurant_id=p_restaurant_id
    AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL;
  IF coalesce(v_amount,0)<=0.01 THEN RAISE EXCEPTION 'No unpaid balance remains for this visit.'; END IF;

  v_message:=format('Payment verification requested · Table %s · Visit %s · Customer reports paying via %s · Balance ₹%s. Verify the restaurant transaction before recording payment.',
    v_table,left(v_visit.id::text,8),
    CASE v_method WHEN 'gpay' THEN 'Google Pay / UPI' WHEN 'phonepe' THEN 'PhonePe / UPI' ELSE 'UPI' END,
    to_char(v_amount,'FM999999990.00'));

  SELECT
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.mm_restaurant_notifications'::regclass AND attname='push_dispatch_token' AND NOT attisdropped)
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.mm_restaurant_notifications'::regclass AND attname='push_sent_at' AND NOT attisdropped)
  INTO v_has_push;

  FOREACH v_role IN ARRAY ARRAY['admin','waiter']::text[]
  LOOP
    SELECT n.id INTO v_existing FROM public.mm_restaurant_notifications n
    WHERE n.restaurant_id=p_restaurant_id AND n.target_role=v_role AND n.notification_type='PAYMENT_CHECK'
      AND n.ticket_id=v_visit.id::text AND n.resolved_at IS NULL
      AND n.created_at>=now()-interval '45 seconds'
    ORDER BY n.created_at DESC LIMIT 1;
    IF v_existing IS NOT NULL THEN
      v_ids:=array_append(v_ids,v_existing);v_existing:=NULL;CONTINUE;
    END IF;

    IF v_has_push THEN
      v_token:=gen_random_uuid()::text;
      EXECUTE 'INSERT INTO public.mm_restaurant_notifications
        (restaurant_id,target_role,notification_type,table_number,ticket_id,message,push_dispatch_token)
        VALUES ($1,$2,''PAYMENT_CHECK'',$3,$4,$5,$6) RETURNING id'
      INTO v_id USING p_restaurant_id,v_role,v_table,v_visit.id::text,v_message,v_token;
      v_tokens:=v_tokens||jsonb_build_array(jsonb_build_object('id',v_id,'token',v_token));
    ELSE
      INSERT INTO public.mm_restaurant_notifications
        (restaurant_id,target_role,notification_type,table_number,ticket_id,message)
      VALUES (p_restaurant_id,v_role,'PAYMENT_CHECK',v_table,v_visit.id::text,v_message)
      RETURNING id INTO v_id;
    END IF;
    v_ids:=array_append(v_ids,v_id);
  END LOOP;

  RETURN jsonb_build_object('ok',true,'table_number',v_table,'visit_id',v_visit.id,
    'notification_ids',to_jsonb(v_ids),'dispatch_tokens',v_tokens,'message','Payment verification request sent to staff.');
END
$$;

-- Only a signed-in owner/waiter can record payment, and the allocation is restricted
-- to one exact visit, even if a later party is now using the same physical table.
CREATE OR REPLACE FUNCTION public.mm_staff_record_visit_payment(
  p_visit_id uuid,
  p_amount numeric,
  p_method text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_visit public.restaurant_table_visits%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_table text;
  v_method text:=lower(trim(coalesce(p_method,'')));
  v_note text:=left(trim(coalesce(p_note,'')),500);
  v_outstanding numeric(12,2);
  v_paid numeric(12,2);
  v_due numeric(12,2);
  v_apply numeric(12,2);
  v_remaining numeric(12,2);
  v_remaining_visit_due numeric(12,2);
  v_allocations jsonb:='[]'::jsonb;
  v_count integer:=0;
  v_paid_count integer:=0;
  v_in_progress boolean;
BEGIN
  IF public.get_my_staff_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Only the Owner/Counter (Admin login) can confirm and record payments'; END IF;
  IF p_visit_id IS NULL THEN RAISE EXCEPTION 'Choose the exact table visit from its counter alert'; END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_amount>999999 THEN RAISE EXCEPTION 'Enter a valid received amount'; END IF;
  IF v_method NOT IN ('gpay','phonepe','upi','cash','card','other') THEN RAISE EXCEPTION 'Choose a valid payment method'; END IF;

  SELECT v.* INTO v_visit FROM public.restaurant_table_visits v
  WHERE v.id=p_visit_id AND v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Table visit not found'; END IF;
  v_table:=lpad(v_visit.table_number,2,'0');

  LOCK TABLE public.order_payments IN SHARE ROW EXCLUSIVE MODE;
  SELECT coalesce(sum(greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)),0)
  INTO v_outstanding
  FROM public.orders o
  LEFT JOIN (SELECT order_id,sum(amount) AS paid FROM public.order_payments GROUP BY order_id) p ON p.order_id=o.id
  WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_visit.table_id AND o.table_visit_id=v_visit.id
    AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL;
  IF v_outstanding<=0.01 THEN RAISE EXCEPTION 'No unpaid balance remains on visit %',left(v_visit.id::text,8); END IF;
  IF p_amount>v_outstanding THEN RAISE EXCEPTION 'Received amount exceeds this visit balance of %',v_outstanding; END IF;

  v_remaining:=round(p_amount,2);
  FOR v_order IN
    SELECT o.* FROM public.orders o
    WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_visit.table_id AND o.table_visit_id=v_visit.id
      AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID')
      AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL
    ORDER BY o.created_at,o.id FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0;
    SELECT coalesce(sum(p.amount),0) INTO v_paid FROM public.order_payments p WHERE p.order_id=v_order.id;
    v_due:=greatest(round(coalesce(v_order.total,0)-v_paid,2),0);
    IF v_due<=0 THEN CONTINUE; END IF;
    v_apply:=least(v_due,v_remaining);

    INSERT INTO public.order_payments
      (restaurant_id,order_id,ticket_id,table_number,amount,method,note,received_by,created_at)
    VALUES (v_order.restaurant_id,v_order.id,v_order.ticket_id,v_table,v_apply,v_method,nullif(v_note,''),auth.uid(),now());

    INSERT INTO public.order_management_audit
      (restaurant_id,order_id,ticket_id,table_number,action,from_status,to_status,amount,reason,actor_user_id,created_at)
    VALUES (v_order.restaurant_id,v_order.id,v_order.ticket_id,v_table,'PAYMENT_RECEIVED',
      upper(v_order.status),upper(v_order.status),v_apply,
      v_method||CASE WHEN v_note<>'' THEN ' · '||v_note ELSE '' END,auth.uid(),now());

    SELECT coalesce(sum(p.amount),0) INTO v_paid FROM public.order_payments p WHERE p.order_id=v_order.id;
    IF v_paid>=coalesce(v_order.total,0)-0.01 AND upper(coalesce(v_order.status,'')) NOT IN ('PAID','CANCELLED') THEN
      PERFORM pg_catalog.set_config('app.mm_payment_status','on',true);
      UPDATE public.orders SET status='PAID' WHERE id=v_order.id AND upper(status) NOT IN ('PAID','CANCELLED');
      IF FOUND THEN
        INSERT INTO public.order_management_audit
          (restaurant_id,order_id,ticket_id,table_number,action,from_status,to_status,amount,reason,actor_user_id,created_at)
        VALUES (v_order.restaurant_id,v_order.id,v_order.ticket_id,v_table,'ORDER_FULLY_PAID',
          upper(v_order.status),'PAID',v_paid,'All ticket value has been received',auth.uid(),now());
        v_paid_count:=v_paid_count+1;
      END IF;
    END IF;
    v_remaining:=round(v_remaining-v_apply,2);
    v_count:=v_count+1;
    v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object('ticket_id',v_order.ticket_id,'amount',v_apply,'method',v_method));
  END LOOP;

  IF v_remaining>0 THEN RAISE EXCEPTION 'Payment could not be allocated. No payment was saved; refresh and try again.'; END IF;

  SELECT coalesce(sum(greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)),0)
  INTO v_remaining_visit_due
  FROM public.orders o
  LEFT JOIN (SELECT order_id,sum(amount) AS paid FROM public.order_payments GROUP BY order_id) p ON p.order_id=o.id
  WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_visit.table_id AND o.table_visit_id=v_visit.id
    AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL;

  SELECT coalesce(bool_or(upper(coalesce(o.status,'')) IN ('NEW','PREPARING','READY')),false)
  INTO v_in_progress
  FROM public.orders o
  WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_visit.table_id AND o.table_visit_id=v_visit.id
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL
    AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID');

  IF v_remaining_visit_due<=0.01 THEN
    IF NOT coalesce(v_in_progress,false) THEN
      UPDATE public.restaurant_table_visits
      SET status='CLOSED',finished_at=coalesce(finished_at,now()),finished_by=coalesce(finished_by,auth.uid()),last_activity_at=now()
      WHERE id=v_visit.id AND status='OPEN';
      UPDATE public.mm_restaurant_notifications
      SET resolved_at=coalesce(resolved_at,now()),resolved_by=coalesce(resolved_by,auth.uid())
      WHERE restaurant_id=v_visit.restaurant_id AND ticket_id=v_visit.id::text
        AND notification_type IN ('CASH_AT_COUNTER','PAYMENT_CHECK','GUEST_LEFT_UNPAID') AND resolved_at IS NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'table',v_table,'visit_id',v_visit.id,'amount',round(p_amount,2),'method',v_method,
    'allocated_tickets',v_count,'fully_paid_tickets',v_paid_count,'allocations',v_allocations,
    'remaining_due',round(coalesce(v_remaining_visit_due,0),2),
    'visit_status',CASE WHEN v_remaining_visit_due<=0.01 AND NOT coalesce(v_in_progress,false) THEN 'CLOSED' ELSE v_visit.status END,
    'status','RECORDED'
  );
END
$$;

-- FINISH must check only the selected visit, not a prior cash-pending visit
-- for the same physical table.
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
  v_table text;
  v_action text;
  v_table_id uuid;
  v_visit_id uuid;
  v_started timestamptz;
  v_due numeric(12,2);
BEGIN
  IF coalesce(public.get_my_staff_role(),'') NOT IN ('admin','waiter') THEN RAISE EXCEPTION 'Owner/Admin or signed-in waiter access required'; END IF;
  IF p_table_number IS NULL OR trim(p_table_number) !~ '^[0-9]{1,2}$' THEN RAISE EXCEPTION 'Choose a valid table number'; END IF;
  v_table:=lpad(trim(p_table_number),2,'0');
  v_action:=upper(trim(coalesce(p_action,'')));
  IF v_action NOT IN ('START','FINISH') THEN RAISE EXCEPTION 'Choose Start visit or Finish visit'; END IF;

  SELECT t.id INTO v_table_id FROM public.restaurant_tables t
  WHERE t.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text,2,'0')=v_table AND t.is_active=true LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_table_id::text));

  IF v_action='START' THEN
    INSERT INTO public.restaurant_table_visits(restaurant_id,table_id,table_number,status,started_at,last_activity_at,started_by)
    VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid,v_table_id,v_table,'OPEN',now(),now(),auth.uid())
    ON CONFLICT (restaurant_id,table_id) WHERE status='OPEN' DO NOTHING;
    SELECT v.id,v.started_at INTO v_visit_id,v_started FROM public.restaurant_table_visits v
    WHERE v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid AND v.table_id=v_table_id AND v.status='OPEN'
    ORDER BY v.started_at DESC LIMIT 1;
    RETURN jsonb_build_object('table_number',v_table,'status','OPEN','started_at',v_started,'visit_id',v_visit_id);
  END IF;

  SELECT v.id,v.started_at INTO v_visit_id,v_started FROM public.restaurant_table_visits v
  WHERE v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid AND v.table_id=v_table_id AND v.status='OPEN'
  ORDER BY v.started_at DESC LIMIT 1 FOR UPDATE;
  IF v_visit_id IS NULL THEN RAISE EXCEPTION 'Table % has no active visit. Refresh the table list.',v_table; END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders o WHERE o.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND o.table_id=v_table_id AND o.table_visit_id=v_visit_id
      AND upper(coalesce(o.status,'')) IN ('NEW','PREPARING','READY')
      AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL
  ) THEN RAISE EXCEPTION 'Table % still has kitchen tickets in progress. Serve or cancel every ticket first.',v_table; END IF;

  SELECT coalesce(sum(greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)),0)
  INTO v_due
  FROM public.orders o
  LEFT JOIN (SELECT order_id,sum(amount) AS paid FROM public.order_payments GROUP BY order_id) p ON p.order_id=o.id
  WHERE o.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND o.table_id=v_table_id AND o.table_visit_id=v_visit_id
    AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL;
  IF coalesce(v_due,0)>0.01 THEN
    RAISE EXCEPTION 'Table % still has ₹% unpaid. Settle this visit before finishing it.',v_table,to_char(v_due,'FM999999990.00');
  END IF;
  UPDATE public.restaurant_table_visits SET status='CLOSED',finished_at=now(),finished_by=auth.uid(),last_activity_at=now()
  WHERE id=v_visit_id AND status='OPEN';
  RETURN jsonb_build_object('table_number',v_table,'status','CLOSED','finished_at',now(),'visit_id',v_visit_id);
END
$$;

REVOKE ALL ON FUNCTION public.mm_guest_get_visit_bill(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_guest_get_visit_bill(text,uuid,uuid) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.mm_staff_get_visit_bill(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mm_staff_get_visit_bill(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.mm_guest_cash_counter_release(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_guest_cash_counter_release(text,uuid,uuid) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.mm_guest_request_visit_payment_check(uuid,text,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_guest_request_visit_payment_check(uuid,text,uuid,uuid,text) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.mm_staff_record_visit_payment(uuid,numeric,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mm_staff_record_visit_payment(uuid,numeric,text,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
