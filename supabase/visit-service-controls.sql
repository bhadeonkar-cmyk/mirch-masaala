-- Mirch Masaala service controls: assigned waiter, guest order code, anti-prank ordering,
-- and safe release of an abandoned table. Additive; preserves order and payment history.
-- Run AFTER customer-cash-counter.sql.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.restaurant_table_visits') IS NULL
     OR to_regclass('public.orders') IS NULL
     OR to_regclass('public.mm_restaurant_notifications') IS NULL THEN
    RAISE EXCEPTION 'Run table-visits.sql, visit-billing-upgrade.sql, and role-notifications.sql first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attname='table_visit_id' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attname='customer_session_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Run visit-billing-upgrade.sql before this migration.';
  END IF;
END
$$;

ALTER TABLE public.restaurant_table_visits
  ADD COLUMN IF NOT EXISTS assigned_waiter_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guest_order_code text NOT NULL DEFAULT '';

-- Give already-open visits a usable code on migration; closed history is untouched.
UPDATE public.restaurant_table_visits
SET guest_order_code = lpad((floor(random()*900000)::integer + 100000)::text, 6, '0')
WHERE status='OPEN'
  AND (guest_order_code !~ '^[0-9]{6}

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

-- Customer lookup is read-only: only staff can open a visit. Opening Home or
-- choosing a table can never create a busy visit.
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
  v_table:=lpad(trim(p_table_number),2,'0');
  SELECT t.id INTO v_table_id
  FROM public.restaurant_tables t
  WHERE t.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text,2,'0')=v_table AND t.is_active=true
  LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;

  SELECT v.* INTO v_visit
  FROM public.restaurant_table_visits v
  WHERE v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND v.table_id=v_table_id AND v.status='OPEN'
  ORDER BY v.started_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This table is not open for online orders yet. Please ask your waiter to start the visit.';
  END IF;

  RETURN jsonb_build_object(
    'table_number',v_table,'status','OPEN','visit_id',v_visit.id,
    'started_at',v_visit.started_at,'last_activity_at',v_visit.last_activity_at
  );
END
$$;

-- Staff sees the service state and the code to share only with guests at this table.
CREATE OR REPLACE FUNCTION public.mm_staff_get_table_visits()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE v_rows jsonb;
BEGIN
  IF coalesce(public.get_my_staff_role(),'') NOT IN ('admin','waiter') THEN
    RAISE EXCEPTION 'Owner/Admin or signed-in waiter access required';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'table_number',lpad(t.table_number::text,2,'0'),
    'status',CASE WHEN v.id IS NULL THEN 'AVAILABLE' ELSE 'OPEN' END,
    'started_at',v.started_at,'visit_id',v.id,
    'assigned_waiter_code',coalesce(v.assigned_waiter_code,''),
    'guest_order_code',coalesce(v.guest_order_code,'')
  ) ORDER BY t.table_number),'[]'::jsonb)
  INTO v_rows
  FROM public.restaurant_tables t
  LEFT JOIN LATERAL (
    SELECT tv.id,tv.started_at,tv.assigned_waiter_code,tv.guest_order_code
    FROM public.restaurant_table_visits tv
    WHERE tv.restaurant_id=t.restaurant_id AND tv.table_id=t.id AND tv.status='OPEN'
    ORDER BY tv.started_at DESC LIMIT 1
  ) v ON true
  WHERE t.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid AND t.is_active=true;
  RETURN v_rows;
END
$$;

DROP FUNCTION IF EXISTS public.mm_staff_set_table_visit_status(text,text);
DROP FUNCTION IF EXISTS public.mm_staff_set_table_visit_status(text,text,text);
CREATE OR REPLACE FUNCTION public.mm_staff_set_table_visit_status(
  p_table_number text,
  p_action text,
  p_waiter_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table text:=lpad(trim(coalesce(p_table_number,'')),2,'0');
  v_action text:=upper(trim(coalesce(p_action,'')));
  v_waiter text:=upper(trim(coalesce(p_waiter_code,'')));
  v_table_id uuid;
  v_visit public.restaurant_table_visits%ROWTYPE;
  v_due numeric(12,2);
BEGIN
  IF coalesce(public.get_my_staff_role(),'') NOT IN ('admin','waiter') THEN RAISE EXCEPTION 'Owner/Admin or signed-in waiter access required'; END IF;
  IF trim(coalesce(p_table_number,'')) !~ '^[0-9]{1,2}$' THEN RAISE EXCEPTION 'Choose a valid table number'; END IF;
  IF v_action NOT IN ('START','FINISH') THEN RAISE EXCEPTION 'Choose Start visit or Finish visit'; END IF;
  SELECT t.id INTO v_table_id FROM public.restaurant_tables t
  WHERE t.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text,2,'0')=v_table AND t.is_active=true LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_table_id::text));

  IF v_action='START' THEN
    IF v_waiter !~ '^[A-Z0-9][A-Z0-9_-]{1,11}$' THEN
      RAISE EXCEPTION 'Enter your waiter ID (for example W01) before starting the visit.';
    END IF;
    SELECT v.* INTO v_visit FROM public.restaurant_table_visits v
    WHERE v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND v.table_id=v_table_id AND v.status='OPEN'
    ORDER BY v.started_at DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF coalesce(v_visit.assigned_waiter_code,'')='' THEN
        UPDATE public.restaurant_table_visits SET assigned_waiter_code=v_waiter
        WHERE id=v_visit.id AND coalesce(assigned_waiter_code,'')='' RETURNING * INTO v_visit;
      END IF;
      RETURN jsonb_build_object('table_number',v_table,'status','OPEN','started_at',v_visit.started_at,
        'visit_id',v_visit.id,'assigned_waiter_code',v_visit.assigned_waiter_code,
        'guest_order_code',v_visit.guest_order_code,'already_open',true);
    END IF;
    INSERT INTO public.restaurant_table_visits
      (restaurant_id,table_id,table_number,status,started_at,last_activity_at,started_by,assigned_waiter_code,guest_order_code)
    VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid,v_table_id,v_table,'OPEN',now(),now(),auth.uid(),
      v_waiter,lpad((floor(random()*900000)::integer+100000)::text,6,'0'))
    RETURNING * INTO v_visit;
    RETURN jsonb_build_object('table_number',v_table,'status','OPEN','started_at',v_visit.started_at,
      'visit_id',v_visit.id,'assigned_waiter_code',v_visit.assigned_waiter_code,
      'guest_order_code',v_visit.guest_order_code,'already_open',false);
  END IF;

  SELECT v.* INTO v_visit FROM public.restaurant_table_visits v
  WHERE v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND v.table_id=v_table_id AND v.status='OPEN'
  ORDER BY v.started_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Table % has no active visit.',v_table; END IF;
  IF EXISTS (SELECT 1 FROM public.orders o WHERE o.restaurant_id=v_visit.restaurant_id
    AND o.table_id=v_table_id AND o.table_visit_id=v_visit.id
    AND upper(coalesce(o.status,'')) IN ('NEW','PREPARING','READY')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL) THEN
    RAISE EXCEPTION 'Table % still has food tickets in progress. Serve or cancel every ticket first.',v_table;
  END IF;
  SELECT coalesce(sum(greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)),0)
  INTO v_due FROM public.orders o
  LEFT JOIN (SELECT order_id,sum(amount) AS paid FROM public.order_payments GROUP BY order_id) p ON p.order_id=o.id
  WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_table_id AND o.table_visit_id=v_visit.id
    AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL;
  IF coalesce(v_due,0)>0.01 THEN
    RAISE EXCEPTION 'Table % still has ₹% unpaid. Record payment or use Guest left / free table if they have left.',v_table,to_char(v_due,'FM999999990.00');
  END IF;
  UPDATE public.restaurant_table_visits SET status='CLOSED',finished_at=now(),finished_by=auth.uid(),last_activity_at=now()
  WHERE id=v_visit.id AND status='OPEN';
  RETURN jsonb_build_object('table_number',v_table,'status','CLOSED','finished_at',now(),'visit_id',v_visit.id);
END
$$;

-- Staff can release the physical table after guests leave even when payment is
-- still outstanding. The balance remains on this exact visit and is alerted to counter/admin.
CREATE OR REPLACE FUNCTION public.mm_staff_release_abandoned_visit(
  p_table_number text,
  p_reason text DEFAULT 'Guest left before checkout'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table text:=lpad(trim(coalesce(p_table_number,'')),2,'0');
  v_table_id uuid;
  v_visit public.restaurant_table_visits%ROWTYPE;
  v_due numeric(12,2);
  v_reason text:=left(trim(coalesce(p_reason,'Guest left before checkout')),200);
  v_role text;
  v_existing bigint;
  v_id bigint;
  v_token text;
  v_message text;
  v_ids bigint[]:=ARRAY[]::bigint[];
  v_tokens jsonb:='[]'::jsonb;
  v_has_push boolean:=false;
BEGIN
  IF coalesce(public.get_my_staff_role(),'') NOT IN ('admin','waiter') THEN RAISE EXCEPTION 'Owner/Admin or signed-in waiter access required'; END IF;
  IF trim(coalesce(p_table_number,'')) !~ '^[0-9]{1,2}$' THEN RAISE EXCEPTION 'Choose a valid table number'; END IF;
  SELECT t.id INTO v_table_id FROM public.restaurant_tables t
  WHERE t.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text,2,'0')=v_table AND t.is_active=true LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_table_id::text));
  SELECT v.* INTO v_visit FROM public.restaurant_table_visits v
  WHERE v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND v.table_id=v_table_id AND v.status='OPEN' ORDER BY v.started_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This table has no active visit. Refresh the table list.'; END IF;

  IF EXISTS (SELECT 1 FROM public.orders o WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_table_id
    AND o.table_visit_id=v_visit.id AND upper(coalesce(o.status,'')) IN ('NEW','PREPARING','READY')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL) THEN
    RAISE EXCEPTION 'Cancel or finish all active food tickets before freeing this table.';
  END IF;

  SELECT coalesce(sum(greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)),0)
  INTO v_due FROM public.orders o
  LEFT JOIN (SELECT order_id,sum(amount) AS paid FROM public.order_payments GROUP BY order_id) p ON p.order_id=o.id
  WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_table_id AND o.table_visit_id=v_visit.id
    AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL;

  UPDATE public.restaurant_table_visits SET status='CLOSED',finished_at=now(),finished_by=auth.uid(),last_activity_at=now()
  WHERE id=v_visit.id AND status='OPEN';

  IF coalesce(v_due,0)<=0.01 THEN
    RETURN jsonb_build_object('ok',true,'table',v_table,'visit_id',v_visit.id,'visit_status','CLOSED',
      'amount',0,'notification_ids','[]'::jsonb,'dispatch_tokens','[]'::jsonb,'message','Table released.');
  END IF;

  v_message:=format('GUEST LEFT UNPAID · Table %s · Assigned waiter %s · Balance ₹%s · Reason: %s · Visit %s',
    v_table,coalesce(nullif(v_visit.assigned_waiter_code,''),'not assigned'),
    to_char(v_due,'FM999999990.00'),v_reason,left(v_visit.id::text,8));

  SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.mm_restaurant_notifications'::regclass AND attname='push_dispatch_token' AND NOT attisdropped)
     AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.mm_restaurant_notifications'::regclass AND attname='push_sent_at' AND NOT attisdropped)
  INTO v_has_push;

  FOREACH v_role IN ARRAY ARRAY['admin','waiter']::text[]
  LOOP
    SELECT n.id INTO v_existing FROM public.mm_restaurant_notifications n
    WHERE n.restaurant_id=v_visit.restaurant_id AND n.target_role=v_role
      AND n.notification_type='GUEST_LEFT_UNPAID' AND n.ticket_id=v_visit.id::text AND n.resolved_at IS NULL
    ORDER BY n.created_at DESC LIMIT 1;
    IF v_existing IS NOT NULL THEN v_ids:=array_append(v_ids,v_existing);v_existing:=NULL;CONTINUE; END IF;
    IF v_has_push THEN
      v_token:=gen_random_uuid()::text;
      EXECUTE 'INSERT INTO public.mm_restaurant_notifications
        (restaurant_id,target_role,notification_type,table_number,ticket_id,message,target_staff_code,push_dispatch_token)
        VALUES ($1,$2,''GUEST_LEFT_UNPAID'',$3,$4,$5,$6,$7) RETURNING id'
        INTO v_id USING v_visit.restaurant_id,v_role,v_table,v_visit.id::text,v_message,CASE WHEN v_role='waiter' THEN coalesce(v_visit.assigned_waiter_code,'') ELSE '' END,v_token;
      v_tokens:=v_tokens||jsonb_build_array(jsonb_build_object('id',v_id,'token',v_token));
    ELSE
      INSERT INTO public.mm_restaurant_notifications(restaurant_id,target_role,notification_type,table_number,ticket_id,message,target_staff_code)
      VALUES(v_visit.restaurant_id,v_role,'GUEST_LEFT_UNPAID',v_table,v_visit.id::text,v_message,CASE WHEN v_role='waiter' THEN coalesce(v_visit.assigned_waiter_code,'') ELSE '' END) RETURNING id INTO v_id;
    END IF;
    v_ids:=array_append(v_ids,v_id);
  END LOOP;

  RETURN jsonb_build_object('ok',true,'table',v_table,'visit_id',v_visit.id,'visit_status','CLOSED',
    'amount',round(v_due,2),'notification_ids',to_jsonb(v_ids),'dispatch_tokens',v_tokens,'message',v_message);
END
$$;

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
    'CASH AT COUNTER · Table %s · Assigned waiter %s · Guest is leaving now and says they will pay cash at the counter · Visit %s · Balance ₹%s',
    v_table,coalesce(nullif(v_visit.assigned_waiter_code,''),'not assigned'),left(v_visit.id::text,8),to_char(v_amount,'FM999999990.00')
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
        (restaurant_id,target_role,notification_type,table_number,ticket_id,message,target_staff_code,push_dispatch_token)
        VALUES ($1,$2,''CASH_AT_COUNTER'',$3,$4,$5,$6,$7) RETURNING id'
      INTO v_id USING v_visit.restaurant_id,v_role,v_table,v_visit.id::text,v_message,CASE WHEN v_role='waiter' THEN coalesce(v_visit.assigned_waiter_code,'') ELSE '' END,v_token;
      v_tokens:=v_tokens||jsonb_build_array(jsonb_build_object('id',v_id,'token',v_token));
    ELSE
      INSERT INTO public.mm_restaurant_notifications
        (restaurant_id,target_role,notification_type,table_number,ticket_id,message,target_staff_code)
      VALUES (v_visit.restaurant_id,v_role,'CASH_AT_COUNTER',v_table,v_visit.id::text,v_message,CASE WHEN v_role='waiter' THEN coalesce(v_visit.assigned_waiter_code,'') ELSE '' END)
      RETURNING id INTO v_id;
    END IF;
    v_ids:=array_append(v_ids,v_id);
  END LOOP;

  RETURN jsonb_build_object('ok',true,'table',v_table,'visit_id',v_visit.id,'visit_status','CLOSED',
    'amount',round(v_amount,2),'already_released',false,'notification_ids',to_jsonb(v_ids),
    'dispatch_tokens',v_tokens,'message','The table is released and counter staff have been notified.');
END
$$;

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

  v_message:=format('Payment verification requested · Table %s · Assigned waiter %s · Visit %s · Customer reports paying via %s · Balance ₹%s. Verify the restaurant transaction before recording payment.',
    v_table,coalesce(nullif(v_visit.assigned_waiter_code,''),'not assigned'),left(v_visit.id::text,8),
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
        (restaurant_id,target_role,notification_type,table_number,ticket_id,message,target_staff_code,push_dispatch_token)
        VALUES ($1,$2,''PAYMENT_CHECK'',$3,$4,$5,$6,$7) RETURNING id'
      INTO v_id USING p_restaurant_id,v_role,v_table,v_visit.id::text,v_message,CASE WHEN v_role='waiter' THEN coalesce(v_visit.assigned_waiter_code,'') ELSE '' END,v_token;
      v_tokens:=v_tokens||jsonb_build_array(jsonb_build_object('id',v_id,'token',v_token));
    ELSE
      INSERT INTO public.mm_restaurant_notifications
        (restaurant_id,target_role,notification_type,table_number,ticket_id,message,target_staff_code)
      VALUES (p_restaurant_id,v_role,'PAYMENT_CHECK',v_table,v_visit.id::text,v_message,CASE WHEN v_role='waiter' THEN coalesce(v_visit.assigned_waiter_code,'') ELSE '' END)
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

-- Recreate order placement so guests can only order into a visit explicitly
-- opened by staff and must supply that visit's code. Staff tickets need no guest PIN.
DROP FUNCTION IF EXISTS public.mm_place_order(uuid,text,text,text,jsonb,uuid,uuid);
DROP FUNCTION IF EXISTS public.mm_place_order(uuid,text,text,text,jsonb);
CREATE OR REPLACE FUNCTION public.mm_place_order(
  p_restaurant_id uuid,
  p_table_number text,
  p_ticket_id text,
  p_notes text,
  p_items jsonb,
  p_table_visit_id uuid DEFAULT NULL,
  p_customer_session_id uuid DEFAULT NULL,
  p_guest_order_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table_id uuid;
  v_table_number text;
  v_visit_id uuid;
  v_guest_order_code text;
  v_line jsonb;
  v_menu_id uuid;
  v_item_name text;
  v_price numeric;
  v_qty integer;
  v_total numeric := 0;
  v_order public.orders%ROWTYPE;
  v_items jsonb;
BEGIN
  IF p_restaurant_id IS DISTINCT FROM 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid THEN
    RAISE EXCEPTION 'Unknown restaurant';
  END IF;
  IF p_ticket_id IS NULL OR p_ticket_id !~ '^[A-Z0-9-]{8,64}$' THEN
    RAISE EXCEPTION 'Invalid ticket ID';
  END IF;
  IF p_table_number IS NULL OR p_table_number !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Invalid table number';
  END IF;
  v_table_number := lpad(trim(p_table_number), 2, '0');

  SELECT t.id INTO v_table_id
  FROM public.restaurant_tables AS t
  WHERE t.restaurant_id = p_restaurant_id
    AND lpad(t.table_number::text, 2, '0') = v_table_number
    AND t.is_active = true
  LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'This table is not active'; END IF;

  -- Serialise visit selection per table so concurrent scans/orders cannot split one visit.
  PERFORM pg_advisory_xact_lock(hashtext(v_table_id::text));

  SELECT v.id, v.guest_order_code INTO v_visit_id, v_guest_order_code
  FROM public.restaurant_table_visits v
  WHERE v.restaurant_id = p_restaurant_id
    AND v.table_id = v_table_id
    AND v.status = 'OPEN'
  ORDER BY v.started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_visit_id IS NULL THEN
    RAISE EXCEPTION 'This table is not open for online orders yet. Please ask your waiter to start the visit.';
  END IF;
  IF p_table_visit_id IS NULL OR p_table_visit_id IS DISTINCT FROM v_visit_id THEN
    RAISE EXCEPTION 'The table visit has changed. Refresh and ask your waiter for the current order code.';
  END IF;

  IF coalesce(public.get_my_staff_role(), '') = '' THEN
    IF p_customer_session_id IS NULL THEN
      RAISE EXCEPTION 'Customer session is missing. Refresh this page and try again.';
    END IF;
    IF p_guest_order_code IS NULL OR trim(p_guest_order_code) !~ '^[0-9]{6}$'
       OR trim(p_guest_order_code) IS DISTINCT FROM v_guest_order_code THEN
      RAISE EXCEPTION 'The 6-digit table order code is incorrect. Please check it with your waiter.';
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Add between 1 and 100 order lines';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) AS x(value)
  LOOP
    v_menu_id := NULLIF(v_line->>'menu_item_id', '')::uuid;
    v_qty := NULLIF(v_line->>'quantity', '')::integer;
    IF v_menu_id IS NULL OR v_qty IS NULL OR v_qty < 1 OR v_qty > 99 THEN
      RAISE EXCEPTION 'Invalid menu item or quantity';
    END IF;

    SELECT mi.name, mi.price
      INTO v_item_name, v_price
    FROM public.menu_items AS mi
    WHERE mi.id = v_menu_id
      AND mi.restaurant_id = p_restaurant_id
      AND mi.is_available = true
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected dish is unavailable. Refresh the menu and try again.';
    END IF;
    v_total := v_total + (v_price * v_qty);
  END LOOP;

  INSERT INTO public.orders
    (restaurant_id, table_id, table_visit_id, customer_session_id,
     status, notes, total, ticket_id)
  VALUES
    (p_restaurant_id, v_table_id, v_visit_id, p_customer_session_id,
     'NEW', left(trim(coalesce(p_notes, '')), 1000), v_total, p_ticket_id)
  RETURNING * INTO v_order;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) AS x(value)
  LOOP
    v_menu_id := NULLIF(v_line->>'menu_item_id', '')::uuid;
    v_qty := NULLIF(v_line->>'quantity', '')::integer;

    SELECT mi.name, mi.price
      INTO v_item_name, v_price
    FROM public.menu_items AS mi
    WHERE mi.id = v_menu_id
      AND mi.restaurant_id = p_restaurant_id
      AND mi.is_available = true
    FOR SHARE;

    INSERT INTO public.order_items
      (order_id, menu_item_id, item_name, quantity, price, notes)
    VALUES
      (v_order.id, v_menu_id, v_item_name, v_qty, v_price, NULL);
  END LOOP;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object('name', oi.item_name, 'price', oi.price, 'qty', oi.quantity)
              ORDER BY oi.created_at, oi.item_name),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.order_items AS oi
  WHERE oi.order_id = v_order.id;

  RETURN jsonb_build_object(
    'id', v_order.ticket_id,
    'dbId', v_order.id,
    'publicToken', v_order.public_token,
    'table', v_table_number,
    'visitId', v_visit_id,
    'customerSessionId', p_customer_session_id,
    'total', v_order.total,
    'status', v_order.status,
    'notes', v_order.notes,
    'createdAt', v_order.created_at,
    'orderNumber', v_order.order_number,
    'items', v_items
  );
END
$$

REVOKE ALL ON FUNCTION public.mm_place_order(uuid, text, text, text, jsonb, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_place_order(uuid, text, text, text, jsonb, uuid, uuid, text) TO anon, authenticated;


REVOKE ALL ON FUNCTION public.mm_ensure_public_table_visit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_ensure_public_table_visit(text) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.mm_staff_get_table_visits() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mm_staff_get_table_visits() TO authenticated;
REVOKE ALL ON FUNCTION public.mm_staff_set_table_visit_status(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mm_staff_set_table_visit_status(text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.mm_staff_release_abandoned_visit(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mm_staff_release_abandoned_visit(text,text) TO authenticated;

-- Filter assigned alerts to the waiter ID saved on the staff device.
DROP FUNCTION IF EXISTS public.mm_staff_notifications(integer);
CREATE OR REPLACE FUNCTION public.mm_staff_notifications(
  p_limit integer DEFAULT 30,
  p_staff_code text DEFAULT NULL
)
RETURNS TABLE (
  id bigint, target_role text, notification_type text, table_number text,
  ticket_id text, item_name text, message text, created_at timestamptz,
  target_staff_code text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_role text:=public.get_my_staff_role();
  v_staff_code text:=upper(trim(coalesce(p_staff_code,'')));
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin','waiter','kitchen') THEN RAISE EXCEPTION 'Staff sign-in required'; END IF;
  RETURN QUERY
  SELECT n.id,n.target_role,n.notification_type,n.table_number,n.ticket_id,n.item_name,n.message,n.created_at,coalesce(n.target_staff_code,'')
  FROM public.mm_restaurant_notifications n
  WHERE n.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid AND n.target_role=v_role AND n.resolved_at IS NULL
    AND (v_role<>'waiter' OR coalesce(n.target_staff_code,'')='' OR (v_staff_code<>'' AND upper(n.target_staff_code)=v_staff_code))
  ORDER BY n.created_at DESC LIMIT greatest(1,least(coalesce(p_limit,30),100));
END
$$;
REVOKE ALL ON FUNCTION public.mm_staff_notifications(integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_staff_notifications(integer,text) TO authenticated;

DROP FUNCTION IF EXISTS public.mm_resolve_staff_notification(bigint);
CREATE OR REPLACE FUNCTION public.mm_resolve_staff_notification(
  p_notification_id bigint,
  p_staff_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_role text:=public.get_my_staff_role();
  v_staff_code text:=upper(trim(coalesce(p_staff_code,'')));
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin','waiter','kitchen') THEN RAISE EXCEPTION 'Staff sign-in required'; END IF;
  UPDATE public.mm_restaurant_notifications n SET resolved_at=now(),resolved_by=auth.uid()
  WHERE n.id=p_notification_id AND n.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND n.target_role=v_role AND n.resolved_at IS NULL
    AND (v_role<>'waiter' OR coalesce(n.target_staff_code,'')='' OR (v_staff_code<>'' AND upper(n.target_staff_code)=v_staff_code));
  RETURN FOUND;
END
$$;
REVOKE ALL ON FUNCTION public.mm_resolve_staff_notification(bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_resolve_staff_notification(bigint,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
);

ALTER TABLE public.mm_restaurant_notifications
  ADD COLUMN IF NOT EXISTS target_staff_code text NOT NULL DEFAULT '';

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

-- Customer lookup is read-only: only staff can open a visit. Opening Home or
-- choosing a table can never create a busy visit.
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
  v_table:=lpad(trim(p_table_number),2,'0');
  SELECT t.id INTO v_table_id
  FROM public.restaurant_tables t
  WHERE t.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text,2,'0')=v_table AND t.is_active=true
  LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;

  SELECT v.* INTO v_visit
  FROM public.restaurant_table_visits v
  WHERE v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND v.table_id=v_table_id AND v.status='OPEN'
  ORDER BY v.started_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This table is not open for online orders yet. Please ask your waiter to start the visit.';
  END IF;

  RETURN jsonb_build_object(
    'table_number',v_table,'status','OPEN','visit_id',v_visit.id,
    'started_at',v_visit.started_at,'last_activity_at',v_visit.last_activity_at
  );
END
$$;

-- Staff sees the service state and the code to share only with guests at this table.
CREATE OR REPLACE FUNCTION public.mm_staff_get_table_visits()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE v_rows jsonb;
BEGIN
  IF coalesce(public.get_my_staff_role(),'') NOT IN ('admin','waiter') THEN
    RAISE EXCEPTION 'Owner/Admin or signed-in waiter access required';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'table_number',lpad(t.table_number::text,2,'0'),
    'status',CASE WHEN v.id IS NULL THEN 'AVAILABLE' ELSE 'OPEN' END,
    'started_at',v.started_at,'visit_id',v.id,
    'assigned_waiter_code',coalesce(v.assigned_waiter_code,''),
    'guest_order_code',coalesce(v.guest_order_code,'')
  ) ORDER BY t.table_number),'[]'::jsonb)
  INTO v_rows
  FROM public.restaurant_tables t
  LEFT JOIN LATERAL (
    SELECT tv.id,tv.started_at,tv.assigned_waiter_code,tv.guest_order_code
    FROM public.restaurant_table_visits tv
    WHERE tv.restaurant_id=t.restaurant_id AND tv.table_id=t.id AND tv.status='OPEN'
    ORDER BY tv.started_at DESC LIMIT 1
  ) v ON true
  WHERE t.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid AND t.is_active=true;
  RETURN v_rows;
END
$$;

DROP FUNCTION IF EXISTS public.mm_staff_set_table_visit_status(text,text);
DROP FUNCTION IF EXISTS public.mm_staff_set_table_visit_status(text,text,text);
CREATE OR REPLACE FUNCTION public.mm_staff_set_table_visit_status(
  p_table_number text,
  p_action text,
  p_waiter_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table text:=lpad(trim(coalesce(p_table_number,'')),2,'0');
  v_action text:=upper(trim(coalesce(p_action,'')));
  v_waiter text:=upper(trim(coalesce(p_waiter_code,'')));
  v_table_id uuid;
  v_visit public.restaurant_table_visits%ROWTYPE;
  v_due numeric(12,2);
BEGIN
  IF coalesce(public.get_my_staff_role(),'') NOT IN ('admin','waiter') THEN RAISE EXCEPTION 'Owner/Admin or signed-in waiter access required'; END IF;
  IF trim(coalesce(p_table_number,'')) !~ '^[0-9]{1,2}$' THEN RAISE EXCEPTION 'Choose a valid table number'; END IF;
  IF v_action NOT IN ('START','FINISH') THEN RAISE EXCEPTION 'Choose Start visit or Finish visit'; END IF;
  SELECT t.id INTO v_table_id FROM public.restaurant_tables t
  WHERE t.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text,2,'0')=v_table AND t.is_active=true LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_table_id::text));

  IF v_action='START' THEN
    IF v_waiter !~ '^[A-Z0-9][A-Z0-9_-]{1,11}$' THEN
      RAISE EXCEPTION 'Enter your waiter ID (for example W01) before starting the visit.';
    END IF;
    SELECT v.* INTO v_visit FROM public.restaurant_table_visits v
    WHERE v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND v.table_id=v_table_id AND v.status='OPEN'
    ORDER BY v.started_at DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      RETURN jsonb_build_object('table_number',v_table,'status','OPEN','started_at',v_visit.started_at,
        'visit_id',v_visit.id,'assigned_waiter_code',v_visit.assigned_waiter_code,
        'guest_order_code',v_visit.guest_order_code,'already_open',true);
    END IF;
    INSERT INTO public.restaurant_table_visits
      (restaurant_id,table_id,table_number,status,started_at,last_activity_at,started_by,assigned_waiter_code,guest_order_code)
    VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid,v_table_id,v_table,'OPEN',now(),now(),auth.uid(),
      v_waiter,lpad((floor(random()*900000)::integer+100000)::text,6,'0'))
    RETURNING * INTO v_visit;
    RETURN jsonb_build_object('table_number',v_table,'status','OPEN','started_at',v_visit.started_at,
      'visit_id',v_visit.id,'assigned_waiter_code',v_visit.assigned_waiter_code,
      'guest_order_code',v_visit.guest_order_code,'already_open',false);
  END IF;

  SELECT v.* INTO v_visit FROM public.restaurant_table_visits v
  WHERE v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND v.table_id=v_table_id AND v.status='OPEN'
  ORDER BY v.started_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Table % has no active visit.',v_table; END IF;
  IF EXISTS (SELECT 1 FROM public.orders o WHERE o.restaurant_id=v_visit.restaurant_id
    AND o.table_id=v_table_id AND o.table_visit_id=v_visit.id
    AND upper(coalesce(o.status,'')) IN ('NEW','PREPARING','READY')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL) THEN
    RAISE EXCEPTION 'Table % still has food tickets in progress. Serve or cancel every ticket first.',v_table;
  END IF;
  SELECT coalesce(sum(greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)),0)
  INTO v_due FROM public.orders o
  LEFT JOIN (SELECT order_id,sum(amount) AS paid FROM public.order_payments GROUP BY order_id) p ON p.order_id=o.id
  WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_table_id AND o.table_visit_id=v_visit.id
    AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL;
  IF coalesce(v_due,0)>0.01 THEN
    RAISE EXCEPTION 'Table % still has ₹% unpaid. Record payment or use Guest left / free table if they have left.',v_table,to_char(v_due,'FM999999990.00');
  END IF;
  UPDATE public.restaurant_table_visits SET status='CLOSED',finished_at=now(),finished_by=auth.uid(),last_activity_at=now()
  WHERE id=v_visit.id AND status='OPEN';
  RETURN jsonb_build_object('table_number',v_table,'status','CLOSED','finished_at',now(),'visit_id',v_visit.id);
END
$$;

-- Staff can release the physical table after guests leave even when payment is
-- still outstanding. The balance remains on this exact visit and is alerted to counter/admin.
CREATE OR REPLACE FUNCTION public.mm_staff_release_abandoned_visit(
  p_table_number text,
  p_reason text DEFAULT 'Guest left before checkout'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table text:=lpad(trim(coalesce(p_table_number,'')),2,'0');
  v_table_id uuid;
  v_visit public.restaurant_table_visits%ROWTYPE;
  v_due numeric(12,2);
  v_reason text:=left(trim(coalesce(p_reason,'Guest left before checkout')),200);
  v_role text;
  v_existing bigint;
  v_id bigint;
  v_token text;
  v_message text;
  v_ids bigint[]:=ARRAY[]::bigint[];
  v_tokens jsonb:='[]'::jsonb;
  v_has_push boolean:=false;
BEGIN
  IF coalesce(public.get_my_staff_role(),'') NOT IN ('admin','waiter') THEN RAISE EXCEPTION 'Owner/Admin or signed-in waiter access required'; END IF;
  IF trim(coalesce(p_table_number,'')) !~ '^[0-9]{1,2}$' THEN RAISE EXCEPTION 'Choose a valid table number'; END IF;
  SELECT t.id INTO v_table_id FROM public.restaurant_tables t
  WHERE t.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND lpad(t.table_number::text,2,'0')=v_table AND t.is_active=true LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'Active table not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_table_id::text));
  SELECT v.* INTO v_visit FROM public.restaurant_table_visits v
  WHERE v.restaurant_id='a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND v.table_id=v_table_id AND v.status='OPEN' ORDER BY v.started_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This table has no active visit. Refresh the table list.'; END IF;

  IF EXISTS (SELECT 1 FROM public.orders o WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_table_id
    AND o.table_visit_id=v_visit.id AND upper(coalesce(o.status,'')) IN ('NEW','PREPARING','READY')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL) THEN
    RAISE EXCEPTION 'Cancel or finish all active food tickets before freeing this table.';
  END IF;

  SELECT coalesce(sum(greatest(round(coalesce(o.total,0)-coalesce(p.paid,0),2),0)),0)
  INTO v_due FROM public.orders o
  LEFT JOIN (SELECT order_id,sum(amount) AS paid FROM public.order_payments GROUP BY order_id) p ON p.order_id=o.id
  WHERE o.restaurant_id=v_visit.restaurant_id AND o.table_id=v_table_id AND o.table_visit_id=v_visit.id
    AND upper(coalesce(o.status,'')) NOT IN ('CANCELLED','PAID')
    AND coalesce(o.is_test_order,false)=false AND coalesce(o.is_complimentary,false)=false AND o.archived_at IS NULL;

  UPDATE public.restaurant_table_visits SET status='CLOSED',finished_at=now(),finished_by=auth.uid(),last_activity_at=now()
  WHERE id=v_visit.id AND status='OPEN';

  IF coalesce(v_due,0)<=0.01 THEN
    RETURN jsonb_build_object('ok',true,'table',v_table,'visit_id',v_visit.id,'visit_status','CLOSED',
      'amount',0,'notification_ids','[]'::jsonb,'dispatch_tokens','[]'::jsonb,'message','Table released.');
  END IF;

  v_message:=format('GUEST LEFT UNPAID · Table %s · Assigned waiter %s · Balance ₹%s · Reason: %s · Visit %s',
    v_table,coalesce(nullif(v_visit.assigned_waiter_code,''),'not assigned'),
    to_char(v_due,'FM999999990.00'),v_reason,left(v_visit.id::text,8));

  SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.mm_restaurant_notifications'::regclass AND attname='push_dispatch_token' AND NOT attisdropped)
     AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.mm_restaurant_notifications'::regclass AND attname='push_sent_at' AND NOT attisdropped)
  INTO v_has_push;

  FOREACH v_role IN ARRAY ARRAY['admin','waiter']::text[]
  LOOP
    SELECT n.id INTO v_existing FROM public.mm_restaurant_notifications n
    WHERE n.restaurant_id=v_visit.restaurant_id AND n.target_role=v_role
      AND n.notification_type='GUEST_LEFT_UNPAID' AND n.ticket_id=v_visit.id::text AND n.resolved_at IS NULL
    ORDER BY n.created_at DESC LIMIT 1;
    IF v_existing IS NOT NULL THEN v_ids:=array_append(v_ids,v_existing);v_existing:=NULL;CONTINUE; END IF;
    IF v_has_push THEN
      v_token:=gen_random_uuid()::text;
      EXECUTE 'INSERT INTO public.mm_restaurant_notifications
        (restaurant_id,target_role,notification_type,table_number,ticket_id,message,push_dispatch_token)
        VALUES ($1,$2,''GUEST_LEFT_UNPAID'',$3,$4,$5,$6) RETURNING id'
        INTO v_id USING v_visit.restaurant_id,v_role,v_table,v_visit.id::text,v_message,v_token;
      v_tokens:=v_tokens||jsonb_build_array(jsonb_build_object('id',v_id,'token',v_token));
    ELSE
      INSERT INTO public.mm_restaurant_notifications(restaurant_id,target_role,notification_type,table_number,ticket_id,message)
      VALUES(v_visit.restaurant_id,v_role,'GUEST_LEFT_UNPAID',v_table,v_visit.id::text,v_message) RETURNING id INTO v_id;
    END IF;
    v_ids:=array_append(v_ids,v_id);
  END LOOP;

  RETURN jsonb_build_object('ok',true,'table',v_table,'visit_id',v_visit.id,'visit_status','CLOSED',
    'amount',round(v_due,2),'notification_ids',to_jsonb(v_ids),'dispatch_tokens',v_tokens,'message',v_message);
END
$$;

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
    'CASH AT COUNTER · Table %s · Assigned waiter %s · Guest is leaving now and says they will pay cash at the counter · Visit %s · Balance ₹%s',
    v_table,coalesce(nullif(v_visit.assigned_waiter_code,''),'not assigned'),left(v_visit.id::text,8),to_char(v_amount,'FM999999990.00')
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

-- Recreate order placement so guests can only order into a visit explicitly
-- opened by staff and must supply that visit's code. Staff tickets need no guest PIN.
DROP FUNCTION IF EXISTS public.mm_place_order(uuid,text,text,text,jsonb,uuid,uuid);
DROP FUNCTION IF EXISTS public.mm_place_order(uuid,text,text,text,jsonb);
CREATE OR REPLACE FUNCTION public.mm_place_order(
  p_restaurant_id uuid,
  p_table_number text,
  p_ticket_id text,
  p_notes text,
  p_items jsonb,
  p_table_visit_id uuid DEFAULT NULL,
  p_customer_session_id uuid DEFAULT NULL,
  p_guest_order_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table_id uuid;
  v_table_number text;
  v_visit_id uuid;
  v_guest_order_code text;
  v_line jsonb;
  v_menu_id uuid;
  v_item_name text;
  v_price numeric;
  v_qty integer;
  v_total numeric := 0;
  v_order public.orders%ROWTYPE;
  v_items jsonb;
BEGIN
  IF p_restaurant_id IS DISTINCT FROM 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid THEN
    RAISE EXCEPTION 'Unknown restaurant';
  END IF;
  IF p_ticket_id IS NULL OR p_ticket_id !~ '^[A-Z0-9-]{8,64}$' THEN
    RAISE EXCEPTION 'Invalid ticket ID';
  END IF;
  IF p_table_number IS NULL OR p_table_number !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Invalid table number';
  END IF;
  v_table_number := lpad(trim(p_table_number), 2, '0');

  SELECT t.id INTO v_table_id
  FROM public.restaurant_tables AS t
  WHERE t.restaurant_id = p_restaurant_id
    AND lpad(t.table_number::text, 2, '0') = v_table_number
    AND t.is_active = true
  LIMIT 1;
  IF v_table_id IS NULL THEN RAISE EXCEPTION 'This table is not active'; END IF;

  -- Serialise visit selection per table so concurrent scans/orders cannot split one visit.
  PERFORM pg_advisory_xact_lock(hashtext(v_table_id::text));

  SELECT v.id, v.guest_order_code INTO v_visit_id, v_guest_order_code
  FROM public.restaurant_table_visits v
  WHERE v.restaurant_id = p_restaurant_id
    AND v.table_id = v_table_id
    AND v.status = 'OPEN'
  ORDER BY v.started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_visit_id IS NULL THEN
    RAISE EXCEPTION 'This table is not open for online orders yet. Please ask your waiter to start the visit.';
  END IF;
  IF p_table_visit_id IS NULL OR p_table_visit_id IS DISTINCT FROM v_visit_id THEN
    RAISE EXCEPTION 'The table visit has changed. Refresh and ask your waiter for the current order code.';
  END IF;

  IF coalesce(public.get_my_staff_role(), '') = '' THEN
    IF p_customer_session_id IS NULL THEN
      RAISE EXCEPTION 'Customer session is missing. Refresh this page and try again.';
    END IF;
    IF p_guest_order_code IS NULL OR trim(p_guest_order_code) !~ '^[0-9]{6}$'
       OR trim(p_guest_order_code) IS DISTINCT FROM v_guest_order_code THEN
      RAISE EXCEPTION 'The 6-digit table order code is incorrect. Please check it with your waiter.';
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Add between 1 and 100 order lines';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) AS x(value)
  LOOP
    v_menu_id := NULLIF(v_line->>'menu_item_id', '')::uuid;
    v_qty := NULLIF(v_line->>'quantity', '')::integer;
    IF v_menu_id IS NULL OR v_qty IS NULL OR v_qty < 1 OR v_qty > 99 THEN
      RAISE EXCEPTION 'Invalid menu item or quantity';
    END IF;

    SELECT mi.name, mi.price
      INTO v_item_name, v_price
    FROM public.menu_items AS mi
    WHERE mi.id = v_menu_id
      AND mi.restaurant_id = p_restaurant_id
      AND mi.is_available = true
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected dish is unavailable. Refresh the menu and try again.';
    END IF;
    v_total := v_total + (v_price * v_qty);
  END LOOP;

  INSERT INTO public.orders
    (restaurant_id, table_id, table_visit_id, customer_session_id,
     status, notes, total, ticket_id)
  VALUES
    (p_restaurant_id, v_table_id, v_visit_id, p_customer_session_id,
     'NEW', left(trim(coalesce(p_notes, '')), 1000), v_total, p_ticket_id)
  RETURNING * INTO v_order;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) AS x(value)
  LOOP
    v_menu_id := NULLIF(v_line->>'menu_item_id', '')::uuid;
    v_qty := NULLIF(v_line->>'quantity', '')::integer;

    SELECT mi.name, mi.price
      INTO v_item_name, v_price
    FROM public.menu_items AS mi
    WHERE mi.id = v_menu_id
      AND mi.restaurant_id = p_restaurant_id
      AND mi.is_available = true
    FOR SHARE;

    INSERT INTO public.order_items
      (order_id, menu_item_id, item_name, quantity, price, notes)
    VALUES
      (v_order.id, v_menu_id, v_item_name, v_qty, v_price, NULL);
  END LOOP;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object('name', oi.item_name, 'price', oi.price, 'qty', oi.quantity)
              ORDER BY oi.created_at, oi.item_name),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.order_items AS oi
  WHERE oi.order_id = v_order.id;

  RETURN jsonb_build_object(
    'id', v_order.ticket_id,
    'dbId', v_order.id,
    'publicToken', v_order.public_token,
    'table', v_table_number,
    'visitId', v_visit_id,
    'customerSessionId', p_customer_session_id,
    'total', v_order.total,
    'status', v_order.status,
    'notes', v_order.notes,
    'createdAt', v_order.created_at,
    'orderNumber', v_order.order_number,
    'items', v_items
  );
END
$$

REVOKE ALL ON FUNCTION public.mm_place_order(uuid, text, text, text, jsonb, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mm_place_order(uuid, text, text, text, jsonb, uuid, uuid, text) TO anon, authenticated;


REVOKE ALL ON FUNCTION public.mm_ensure_public_table_visit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_ensure_public_table_visit(text) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.mm_staff_get_table_visits() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mm_staff_get_table_visits() TO authenticated;
REVOKE ALL ON FUNCTION public.mm_staff_set_table_visit_status(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mm_staff_set_table_visit_status(text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.mm_staff_release_abandoned_visit(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mm_staff_release_abandoned_visit(text,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
