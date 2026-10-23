-- Exercise the public party request RPC and owner-only review/status workflow.
-- This file runs only against the isolated PostgreSQL fixture in GitHub Actions.

DO $qa$
DECLARE
  v_result jsonb;
  v_booking_id uuid;
  v_count integer;
  v_denied boolean := false;
  v_invalid_rejected boolean := false;
  v_updated jsonb;
BEGIN
  v_result := public.mm_submit_party_booking(
    'QA Party Guest',
    '+91 98765 43210',
    'Birthday',
    current_date + 7,
    '18:00',
    12,
    'Cake and vegetarian menu'
  );
  v_booking_id := (v_result ->> 'id')::uuid;

  IF coalesce(v_result ->> 'booking_ref', '') !~ '^PARTY-[0-9]{5}$' THEN
    RAISE EXCEPTION 'QA failed: party reference was not generated';
  END IF;
  IF v_result ->> 'status' <> 'NEW' THEN
    RAISE EXCEPTION 'QA failed: new booking status should be NEW';
  END IF;
  IF jsonb_array_length(coalesce(v_result -> 'notification_ids', '[]'::jsonb)) <> 1 THEN
    RAISE EXCEPTION 'QA failed: booking did not create exactly one owner alert';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.mm_party_bookings b
    WHERE b.id = v_booking_id
      AND b.customer_phone = '+91 98765 43210'
      AND b.guest_count = 12
      AND b.customer_notes = 'Cake and vegetarian menu'
  ) THEN
    RAISE EXCEPTION 'QA failed: party request details were not saved';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.mm_restaurant_notifications n
    WHERE n.target_role = 'admin'
      AND n.notification_type = 'PARTY_BOOKING'
      AND n.ticket_id = v_result ->> 'booking_ref'
      AND n.message LIKE '%' || (v_result ->> 'booking_ref') || '%'
  ) THEN
    RAISE EXCEPTION 'QA failed: owner party alert was not saved';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_party_bookings'
      AND column_name IN ('table_id','table_number')
  ) THEN
    RAISE EXCEPTION 'QA failed: party bookings must not require a dine-in table';
  END IF;
  IF has_table_privilege('anon', 'public.mm_party_bookings', 'SELECT') THEN
    RAISE EXCEPTION 'QA failed: anonymous users must not directly read party booking data';
  END IF;

  BEGIN
    PERFORM public.mm_submit_party_booking(
      'QA Party Guest', '', 'Birthday', current_date + 7, '18:00', 12, ''
    );
  EXCEPTION WHEN OTHERS THEN
    v_invalid_rejected := true;
  END;
  IF NOT v_invalid_rejected THEN
    RAISE EXCEPTION 'QA failed: empty customer phone was accepted';
  END IF;

  PERFORM set_config('app.qa_role', 'waiter', true);
  BEGIN
    PERFORM id FROM public.mm_admin_list_party_bookings(20);
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'QA failed: waiter role could list owner-only party bookings';
  END IF;

  PERFORM set_config('app.qa_role', 'admin', true);
  SELECT count(*) INTO v_count
  FROM public.mm_admin_list_party_bookings(20)
  WHERE id = v_booking_id AND booking_ref = v_result ->> 'booking_ref';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'QA failed: owner list did not return the saved booking';
  END IF;

  v_updated := public.mm_admin_update_party_booking(v_booking_id, 'CONFIRMED', 'QA confirmation');
  IF v_updated ->> 'status' <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'QA failed: owner could not confirm the party booking';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mm_party_bookings
    WHERE id = v_booking_id AND status = 'CONFIRMED' AND owner_notes = 'QA confirmation'
  ) THEN
    RAISE EXCEPTION 'QA failed: party status update was not persisted';
  END IF;

  RAISE NOTICE 'Party booking QA passed: saved request, generated reference, owner alert, private customer details, required phone, owner-only listing, and status update.';
END
$qa$;
