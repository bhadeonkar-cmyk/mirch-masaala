\set ON_ERROR_STOP on

-- Isolated security mutation regression tests for Mirch Masaala.
-- Designed to run AFTER the full CI migration sequence on the disposable
-- GitHub Actions PostgreSQL fixture. Never run against production.
--
-- Covers:
--   1. Payment forgery (direct INSERT into order_payments as anon)
--   2. Unauthorized payment UPDATE / status change
--   3. Unauthorized visit ownership UPDATE
--   4. Direct table grants must remain revoked for anon
--
-- These tests expect genuine privilege / RLS / trigger failures.
-- They intentionally use the real column list of order_payments.
-- Mutations are attempted under SET ROLE anon so they exercise real grants.

DO $sec$
DECLARE
  v_rejected boolean;
  v_order_id uuid;
  v_table_id uuid := '11111111-1111-1111-1111-111111111111';
  v_count integer;
  v_has_open boolean;
BEGIN
  -- Ensure a minimal order exists for foreign-key targets (fixture may already have data).
  INSERT INTO public.restaurant_tables(id, restaurant_id, table_number, is_active)
  VALUES (v_table_id, 'a3702d10-6673-4c06-9783-1d61c945ecd5', '01', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.orders(restaurant_id, table_id, status, total, ticket_id)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5', v_table_id, 'NEW', 10, 'MM-SEC-PAY-001')
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_order_id FROM public.orders WHERE ticket_id = 'MM-SEC-PAY-001' LIMIT 1;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'SECURITY FIXTURE: could not seed MM-SEC-PAY-001';
  END IF;

  -- 1. Payment forgery: anon must not be able to INSERT a payment row.
  --    Use the real columns: restaurant_id, order_id, ticket_id, table_number, amount, method.
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
    RESET ROLE;
    v_rejected := true;
  WHEN OTHERS THEN
    RESET ROLE;
    IF SQLSTATE IN ('42501', '42503') OR SQLERRM ILIKE '%permission%' OR SQLERRM ILIKE '%policy%'
       OR SQLERRM ILIKE '%denied%' OR SQLERRM ILIKE '%row-level security%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'SECURITY FAIL: anon was able to INSERT into order_payments (payment forgery)';
  END IF;

  -- Confirm no forged row landed
  SELECT count(*) INTO v_count FROM public.order_payments WHERE ticket_id = 'MM-SEC-PAY-001' AND note = 'forged by customer';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'SECURITY FAIL: forged payment row exists after rejected INSERT';
  END IF;

  -- 2. Unauthorized payment UPDATE
  v_rejected := false;
  BEGIN
    SET ROLE anon;
    UPDATE public.order_payments SET amount = 999 WHERE ticket_id = 'MM-SEC-PAY-001';
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    v_rejected := true;
  WHEN OTHERS THEN
    RESET ROLE;
    IF SQLSTATE IN ('42501', '42503') OR SQLERRM ILIKE '%permission%' OR SQLERRM ILIKE '%policy%'
       OR SQLERRM ILIKE '%denied%' OR SQLERRM ILIKE '%does not exist%'
       OR SQLERRM ILIKE '%row-level security%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'SECURITY FAIL: anon was able to UPDATE order_payments';
  END IF;

  -- 3. Direct PAID status change must still be blocked by the order guard trigger
  --    (runs as current role; the trigger uses get_my_staff_role which reads app.qa_role)
  PERFORM set_config('app.qa_role', '', false);
  v_rejected := false;
  BEGIN
    UPDATE public.orders SET status = 'PAID' WHERE ticket_id = 'MM-SEC-PAY-001';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Record the payment through the staff payment function%'
       OR SQLERRM LIKE 'Staff login required%'
       OR SQLERRM ILIKE '%permission%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'SECURITY FAIL: direct status=PAID update was accepted';
  END IF;

  -- 4. Visit ownership: anon must not UPDATE restaurant_table_visits
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_table_visits
    WHERE restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND table_id = v_table_id AND status = 'OPEN'
  ) INTO v_has_open;

  IF NOT v_has_open THEN
    INSERT INTO public.restaurant_table_visits
      (restaurant_id, table_id, table_number, status, started_at)
    VALUES
      ('a3702d10-6673-4c06-9783-1d61c945ecd5', v_table_id, '01', 'OPEN', now());
  END IF;

  v_rejected := false;
  BEGIN
    SET ROLE anon;
    UPDATE public.restaurant_table_visits
    SET guest_order_code = '999999', assigned_waiter_code = 'HACKED'
    WHERE table_number = '01' AND status = 'OPEN';
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    v_rejected := true;
  WHEN OTHERS THEN
    RESET ROLE;
    IF SQLSTATE IN ('42501', '42503') OR SQLERRM ILIKE '%permission%' OR SQLERRM ILIKE '%policy%'
       OR SQLERRM ILIKE '%denied%' OR SQLERRM ILIKE '%row-level security%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'SECURITY FAIL: anon was able to UPDATE restaurant_table_visits';
  END IF;

  -- 5. Confirm grants remain revoked (information_schema check)
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('order_payments', 'restaurant_table_visits')
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'SECURITY FAIL: dangerous INSERT/UPDATE/DELETE grant still present on sensitive tables';
  END IF;

  RAISE NOTICE 'PASS: payment forgery, payment UPDATE, visit UPDATE and grant checks rejected as expected';
END
$sec$;

SELECT 'PASS: security mutation regression (payment forgery + visit ownership + grants)' AS security_qa_result;
