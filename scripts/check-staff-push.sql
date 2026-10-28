-- QA for supabase/staff-push-notifications.sql (run AFTER that migration, in the QA fixture DB).
-- Verifies row-level security, device re-enrolment and guest-request duplicate handling.
-- Transactions that only test refusals are rolled back; the first two leave QA rows behind.
\set ON_ERROR_STOP on

INSERT INTO auth.users(id) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b')
ON CONFLICT DO NOTHING;

INSERT INTO public.restaurant_tables(id, restaurant_id, table_number, is_active)
SELECT gen_random_uuid(), 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid, '07', true
WHERE NOT EXISTS (SELECT 1 FROM public.restaurant_tables WHERE table_number = '07');

-- 1. Waiter registers a device (Marathi); a second registration updates, not duplicates.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL app.qa_uid = 'aaaaaaaa-0000-0000-0000-00000000000a';
SET LOCAL app.qa_role = 'waiter';
SELECT public.mm_register_staff_push_subscription('https://push.example/qa-1', '{"keys":{}}'::jsonb, ' w7 ', 'mr', 'qa');
SELECT public.mm_register_staff_push_subscription('https://push.example/qa-1', '{"keys":{}}'::jsonb, 'W7', 'en', 'qa');
DO $qa$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mm_staff_push_subscriptions WHERE endpoint = 'https://push.example/qa-1';
  IF r.target_role <> 'waiter' OR r.staff_code <> 'W7' OR r.preferred_language <> 'en' THEN
    RAISE EXCEPTION 'QA failed: registration did not store role/code/language from the session (%).', r;
  END IF;
  IF (SELECT count(*) FROM public.mm_staff_push_subscriptions WHERE endpoint = 'https://push.example/qa-1') <> 1 THEN
    RAISE EXCEPTION 'QA failed: re-registering duplicated the subscription';
  END IF;
END $qa$;
COMMIT;

-- 2. Same phone, different staff login: direct write is blocked by RLS, the RPC re-enrols it.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL app.qa_uid = 'bbbbbbbb-0000-0000-0000-00000000000b';
SET LOCAL app.qa_role = 'kitchen';
DO $qa$
BEGIN
  BEGIN
    INSERT INTO public.mm_staff_push_subscriptions(staff_user_id, target_role, endpoint, subscription)
    VALUES ('bbbbbbbb-0000-0000-0000-00000000000b', 'kitchen', 'https://push.example/qa-1', '{}')
    ON CONFLICT (endpoint) DO UPDATE SET staff_user_id = EXCLUDED.staff_user_id;
    RAISE EXCEPTION 'QA failed: RLS allowed taking over another login''s endpoint by direct write';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $qa$;
SELECT public.mm_register_staff_push_subscription('https://push.example/qa-1', '{"keys":{}}'::jsonb, 'ignored', 'en', 'qa');
DO $qa$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mm_staff_push_subscriptions WHERE endpoint = 'https://push.example/qa-1';
  IF r.staff_user_id <> 'bbbbbbbb-0000-0000-0000-00000000000b' OR r.target_role <> 'kitchen' OR r.staff_code <> '' THEN
    RAISE EXCEPTION 'QA failed: RPC did not re-enrol the shared phone for the current login (%).', r;
  END IF;
END $qa$;
COMMIT;

-- 3. The RPC trusts the session, not the caller: no session, no staff role, bad endpoint.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL app.qa_uid = '';
SET LOCAL app.qa_role = '';
DO $qa$
BEGIN
  BEGIN
    PERFORM public.mm_register_staff_push_subscription('https://push.example/qa-2', '{}'::jsonb, '', 'en', '');
    RAISE EXCEPTION 'QA failed: registration worked without a staff session';
  EXCEPTION WHEN sqlstate '28000' THEN NULL;
  END;
END $qa$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL app.qa_uid = 'aaaaaaaa-0000-0000-0000-00000000000a';
SET LOCAL app.qa_role = '';
DO $qa$
BEGIN
  BEGIN
    PERFORM public.mm_register_staff_push_subscription('https://push.example/qa-2', '{}'::jsonb, '', 'en', '');
    RAISE EXCEPTION 'QA failed: registration worked for a user without a staff role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $qa$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL app.qa_uid = 'aaaaaaaa-0000-0000-0000-00000000000a';
SET LOCAL app.qa_role = 'waiter';
DO $qa$
BEGIN
  BEGIN
    PERFORM public.mm_register_staff_push_subscription('http://insecure.example/x', '{}'::jsonb, '', 'en', '');
    RAISE EXCEPTION 'QA failed: non-HTTPS endpoint accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
END $qa$;
ROLLBACK;

-- 4. Anonymous devices cannot read or write subscriptions or call the registration RPC.
BEGIN;
SET LOCAL ROLE anon;
DO $qa$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.mm_staff_push_subscriptions;
    RAISE EXCEPTION 'QA failed: anon can read push subscriptions';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.mm_register_staff_push_subscription('https://push.example/qa-3', '{}'::jsonb, '', 'en', '');
    RAISE EXCEPTION 'QA failed: anon can call the registration RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $qa$;
ROLLBACK;

-- 5. Guest requests: waiter call -> waiter only; bill -> waiter + admin; duplicates reuse the
--    open alert; staff-only types are refused for public devices.
BEGIN;
SET LOCAL ROLE anon;
DO $qa$
DECLARE a jsonb; b jsonb; c jsonb;
BEGIN
  a := public.mm_create_guest_notification('a3702d10-6673-4c06-9783-1d61c945ecd5', 'WAITER_CALL', '07');
  b := public.mm_create_guest_notification('a3702d10-6673-4c06-9783-1d61c945ecd5', 'WAITER_CALL', '07');
  IF jsonb_array_length(a->'notification_ids') <> 1 OR a->'notification_ids' <> b->'notification_ids' THEN
    RAISE EXCEPTION 'QA failed: repeated waiter call within 30s created a duplicate alert (% vs %)', a, b;
  END IF;
  c := public.mm_create_guest_notification('a3702d10-6673-4c06-9783-1d61c945ecd5', 'BILL_REQUEST', '07');
  IF jsonb_array_length(c->'notification_ids') <> 2 THEN
    RAISE EXCEPTION 'QA failed: bill request should alert waiter and admin (%)', c;
  END IF;
  BEGIN
    PERFORM public.mm_create_guest_notification('a3702d10-6673-4c06-9783-1d61c945ecd5', 'NEW_ORDER', '07');
    RAISE EXCEPTION 'QA failed: public device created a staff-only notification type';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Unsupported guest request' THEN RAISE; END IF;
  END;
END $qa$;
ROLLBACK;
