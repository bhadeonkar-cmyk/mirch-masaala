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

DO $sec$
DECLARE
  v_rejected boolean;
  v_order_id uuid;
  v_visit_id uuid;
  v_table_id uuid := '11111111-1111-1111-1111-111111111111';
  v_count integer;
BEGIN
  -- Ensure a minimal order exists for foreign-key targets (fixture may already have data).
  INSERT INTO public.restaurant_tables(id, restaurant_id, table_number, is_active)
  VALUES (v_table_id, 'a3702d10-6673-4c06-9783-1d61c945ecd5', '01', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.orders(restaurant_id, table_id, status, total, ticket_id)
  VALUES ('a3702d10-6673-4c06-9783-1d61c945ecd5', v_table_id, 'NEW', 10, 'MM-SEC-PAY-001')
  RETURNING id INTO v_order_id;

  -- 1. Payment forgery: anon must not be able to INSERT a payment row.
  --    Use the real columns: restaurant_id, order_id, ticket_id, table_number, amount, method.
  PERFORM set_config('app.qa_role', '', false);  -- anonymous customer
  PERFORM set_config('app.qa_uid', '', false);

  v_rejected := false;
  BEGIN
    INSERT INTO public.order_payments
      (restaurant_id, order_id, ticket_id, table_number, amount, method, note)
    VALUES
      ('a3702d10-6673-4c06-9783-1d61c945ecd5', v_order_id, 'MM-SEC-PAY-001', '01', 10.00, 'cash', 'forged by customer');
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  WHEN OTHERS THEN
    -- RLS or other security error is also acceptable
    IF SQLSTATE IN ('42501', '42503') OR SQLERRM ILIKE '%permission%' OR SQLERRM ILIKE '%policy%'
       OR SQLERRM ILIKE '%denied%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'SECURITY FAIL: anon was able to INSERT into order_payments (payment forgery)';
  END IF;

  -- Confirm no forged row landed
  SELECT count(*) INTO v_count FROM public.order_payments WHERE ticket_id = 'MM-SEC-PAY-001';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'SECURITY FAIL: forged payment row exists after rejected INSERT';
  END IF;

  -- 2. Unauthorized payment UPDATE (if any grant existed it must still fail)
  v_rejected := false;
  BEGIN
    UPDATE public.order_payments SET amount = 999 WHERE ticket_id = 'MM-SEC-PAY-001';
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  WHEN OTHERS THEN
    IF SQLSTATE IN ('42501', '42503') OR SQLERRM ILIKE '%permission%' OR SQLERRM ILIKE '%policy%'
       OR SQLERRM ILIKE '%denied%' OR SQLERRM ILIKE '%does not exist%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'SECURITY FAIL: anon was able to UPDATE order_payments';
  END IF;

  -- 3. Direct PAID status change must still be blocked by the order guard trigger
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
  --    (table has REVOKE ALL; no policies for anon)
  INSERT INTO public.restaurant_table_visits
    (restaurant_id, table_id, table_number, status, started_at)
  VALUES
    ('a3702d10-6673-4c06-9783-1d61c945ecd5', v_table_id, '01', 'OPEN', now())
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_visit_id;

  v_rejected := false;
  BEGIN
    UPDATE public.restaurant_table_visits
    SET guest_order_code = '999999', assigned_waiter_code = 'HACKED'
    WHERE table_number = '01' AND status = 'OPEN';
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  WHEN OTHERS THEN
    IF SQLSTATE IN ('42501', '42503') OR SQLERRM ILIKE '%permission%' OR SQLERRM ILIKE '%policy%'
       OR SQLERRM ILIKE '%denied%' THEN
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
