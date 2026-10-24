-- Mirch Masaala: customer asks staff to verify a reported UPI payment.
-- Run after supabase/role-notifications.sql and, if installed, staff-push-notifications.sql.
-- A guest can raise a verification request, but only authorized staff can record a payment.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.mm_restaurant_notifications') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/role-notifications.sql first.';
  END IF;
  IF to_regprocedure('public.get_my_staff_role()') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/setup-live.sql first.';
  END IF;
END
$$;

-- Keep existing alert types and add PAYMENT_CHECK. Handle installations that
-- already include PARTY_BOOKING as well as older notification table versions.
DO $$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.mm_restaurant_notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%notification_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.mm_restaurant_notifications DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;

  ALTER TABLE public.mm_restaurant_notifications
    ADD CONSTRAINT mm_restaurant_notifications_type_check
    CHECK (notification_type IN (
      'WAITER_CALL','BILL_REQUEST','NEW_ORDER','ORDER_READY','ITEM_SOLD_OUT',
      'PARTY_BOOKING','PAYMENT_CHECK','CASH_AT_COUNTER','GUEST_LEFT_UNPAID'
    ));
END
$$;

CREATE OR REPLACE FUNCTION public.mm_guest_request_payment_check(
  p_restaurant_id uuid,
  p_table_number text,
  p_method text DEFAULT 'upi'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_table text := lpad(trim(coalesce(p_table_number, '')), 2, '0');
  v_method text := lower(trim(coalesce(p_method, 'upi')));
  v_role text;
  v_existing bigint;
  v_id bigint;
  v_token text;
  v_message text;
  v_ids bigint[] := ARRAY[]::bigint[];
  v_tokens jsonb := '[]'::jsonb;
  v_has_push boolean;
BEGIN
  IF p_restaurant_id IS DISTINCT FROM 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid THEN
    RAISE EXCEPTION 'Unknown restaurant';
  END IF;
  IF v_table !~ '^[0-9]{2}$' OR NOT EXISTS (
    SELECT 1
    FROM public.restaurant_tables t
    WHERE t.restaurant_id = p_restaurant_id
      AND lpad(t.table_number::text, 2, '0') = v_table
      AND t.is_active = true
  ) THEN
    RAISE EXCEPTION 'Choose a valid active table';
  END IF;
  IF v_method NOT IN ('upi','gpay','phonepe') THEN
    RAISE EXCEPTION 'Choose a supported digital payment method';
  END IF;

  v_message := format(
    'Payment verification requested · Table %s · Customer reports paying via %s. Please verify the transaction in the restaurant account before recording payment.',
    v_table,
    CASE v_method WHEN 'gpay' THEN 'Google Pay / UPI'
                  WHEN 'phonepe' THEN 'PhonePe / UPI'
                  ELSE 'UPI' END
  );

  SELECT
    EXISTS (SELECT 1 FROM pg_attribute
            WHERE attrelid = 'public.mm_restaurant_notifications'::regclass
              AND attname = 'push_dispatch_token' AND NOT attisdropped)
    AND
    EXISTS (SELECT 1 FROM pg_attribute
            WHERE attrelid = 'public.mm_restaurant_notifications'::regclass
              AND attname = 'push_sent_at' AND NOT attisdropped)
  INTO v_has_push;

  -- Duplicate taps within 45 seconds reuse the open alert.
  FOREACH v_role IN ARRAY ARRAY['waiter','admin']::text[]
  LOOP
    SELECT n.id INTO v_existing
    FROM public.mm_restaurant_notifications n
    WHERE n.restaurant_id = p_restaurant_id
      AND n.target_role = v_role
      AND n.notification_type = 'PAYMENT_CHECK'
      AND n.table_number = v_table
      AND n.resolved_at IS NULL
      AND n.created_at >= now() - interval '45 seconds'
    ORDER BY n.created_at DESC
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      v_ids := array_append(v_ids, v_existing);
      v_existing := NULL;
      CONTINUE;
    END IF;

    IF v_has_push THEN
      v_token := gen_random_uuid()::text;
      EXECUTE
        'INSERT INTO public.mm_restaurant_notifications
          (restaurant_id, target_role, notification_type, table_number, message, push_dispatch_token)
         VALUES ($1, $2, ''PAYMENT_CHECK'', $3, $4, $5)
         RETURNING id'
        INTO v_id
        USING p_restaurant_id, v_role, v_table, v_message, v_token;
      v_tokens := v_tokens || jsonb_build_array(jsonb_build_object('id', v_id, 'token', v_token));
    ELSE
      INSERT INTO public.mm_restaurant_notifications
        (restaurant_id, target_role, notification_type, table_number, message)
      VALUES (p_restaurant_id, v_role, 'PAYMENT_CHECK', v_table, v_message)
      RETURNING id INTO v_id;
    END IF;

    v_ids := array_append(v_ids, v_id);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'table_number', v_table,
    'notification_ids', to_jsonb(v_ids),
    'dispatch_tokens', v_tokens,
    'message', 'Payment verification request sent to staff.'
  );
END
$$;

REVOKE ALL ON FUNCTION public.mm_guest_request_payment_check(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_guest_request_payment_check(uuid, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
