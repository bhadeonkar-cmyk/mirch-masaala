-- Exercise the guest payment-verification alert in the isolated PostgreSQL fixture.

INSERT INTO public.restaurant_tables (id, restaurant_id, table_number, is_active)
VALUES (
  '49b87c58-3f1c-4385-91ef-49bdca1a9450'::uuid,
  'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid,
  '49',
  true
)
ON CONFLICT (id) DO UPDATE SET is_active = true;

DO $qa$
DECLARE
  v_result jsonb;
  v_repeat jsonb;
  v_count integer;
  v_invalid_rejected boolean := false;
BEGIN
  v_result := public.mm_guest_request_payment_check(
    'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid,
    '49',
    'gpay'
  );

  IF coalesce(v_result ->> 'ok','false') <> 'true' THEN
    RAISE EXCEPTION 'QA failed: payment verification request was not accepted';
  END IF;
  IF jsonb_array_length(coalesce(v_result -> 'notification_ids','[]'::jsonb)) <> 2 THEN
    RAISE EXCEPTION 'QA failed: verification should notify both owner and waiter';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mm_restaurant_notifications
    WHERE restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND table_number = '49'
      AND target_role = 'admin'
      AND notification_type = 'PAYMENT_CHECK'
      AND message ILIKE '%Google Pay%'
      AND message ILIKE '%verify the transaction%'
  ) THEN
    RAISE EXCEPTION 'QA failed: owner did not receive the payment verification detail';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mm_restaurant_notifications
    WHERE restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND table_number = '49'
      AND target_role = 'waiter'
      AND notification_type = 'PAYMENT_CHECK'
      AND message ILIKE '%Table 49%'
  ) THEN
    RAISE EXCEPTION 'QA failed: waiter did not receive the payment verification detail';
  END IF;

  v_repeat := public.mm_guest_request_payment_check(
    'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid,
    '49',
    'gpay'
  );
  SELECT count(*) INTO v_count
  FROM public.mm_restaurant_notifications
  WHERE table_number = '49'
    AND notification_type = 'PAYMENT_CHECK'
    AND resolved_at IS NULL;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'QA failed: repeated verification tap created duplicate alerts';
  END IF;

  BEGIN
    PERFORM public.mm_guest_request_payment_check(
      'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid,
      '49',
      'cash'
    );
  EXCEPTION WHEN OTHERS THEN
    v_invalid_rejected := true;
  END;
  IF NOT v_invalid_rejected THEN
    RAISE EXCEPTION 'QA failed: unsupported payment verification method was accepted';
  END IF;

  RAISE NOTICE 'Payment verification QA passed: owner/waiter alerts include table/method, duplicate taps are suppressed, and unsupported methods are rejected.';
END
$qa$;
