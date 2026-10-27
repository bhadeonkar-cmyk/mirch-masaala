-- Mirch Masaala staff push notifications and device language preference.
-- Apply AFTER role-notifications.sql and the table-visit/service-control migrations.
-- This migration is safe to re-run; it preserves existing subscriptions and alerts.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.mm_restaurant_notifications') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/role-notifications.sql first, then run this push setup.';
  END IF;
  IF to_regprocedure('public.get_my_staff_role()') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/setup-live.sql first so staff roles can be checked.';
  END IF;
END
$$;

ALTER TABLE public.mm_restaurant_notifications
  ADD COLUMN IF NOT EXISTS push_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS push_dispatch_token text,
  ADD COLUMN IF NOT EXISTS target_staff_code text NOT NULL DEFAULT '';

-- Public devices can only create the safe front-of-house requests, never arbitrary
-- kitchen orders, owner approvals, payments or other staff-only notification types.
CREATE OR REPLACE FUNCTION public.mm_create_guest_notification(
  p_restaurant_id uuid,
  p_type text,
  p_table_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_type text := upper(coalesce(p_type, ''));
  v_table text := lpad(trim(coalesce(p_table_number, '')), 2, '0');
  v_role text;
  v_existing bigint;
  v_existing_sent timestamptz;
  v_id bigint;
  v_token text;
  v_ids bigint[] := ARRAY[]::bigint[];
  v_tokens jsonb := '[]'::jsonb;
BEGIN
  IF p_restaurant_id IS DISTINCT FROM 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid THEN
    RAISE EXCEPTION 'Unknown restaurant';
  END IF;
  IF v_type NOT IN ('WAITER_CALL', 'BILL_REQUEST') THEN
    RAISE EXCEPTION 'Unsupported guest request';
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

  FOREACH v_role IN ARRAY
    CASE WHEN v_type = 'WAITER_CALL'
      THEN ARRAY['waiter']::text[]
      ELSE ARRAY['waiter', 'admin']::text[]
    END
  LOOP
    SELECT n.id, n.push_sent_at
      INTO v_existing, v_existing_sent
    FROM public.mm_restaurant_notifications n
    WHERE n.restaurant_id = p_restaurant_id
      AND n.target_role = v_role
      AND n.notification_type = v_type
      AND n.table_number = v_table
      AND n.resolved_at IS NULL
      AND n.created_at >= now() - interval '30 seconds'
    ORDER BY n.created_at DESC
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      v_id := v_existing;
      -- Reuse a recent open alert; only create a fresh one-time push token
      -- if it has not already been dispatched.
      IF v_existing_sent IS NULL THEN
        v_token := gen_random_uuid()::text;
        UPDATE public.mm_restaurant_notifications
        SET push_dispatch_token = v_token
        WHERE id = v_existing;
      ELSE
        v_token := NULL;
      END IF;
    ELSE
      v_token := gen_random_uuid()::text;
      INSERT INTO public.mm_restaurant_notifications (
        restaurant_id, target_role, notification_type, table_number,
        message, push_dispatch_token
      )
      VALUES (
        p_restaurant_id, v_role, v_type, v_table,
        CASE WHEN v_type = 'WAITER_CALL' THEN 'Guest needs a waiter'
             ELSE 'Guest requested the bill' END,
        v_token
      )
      RETURNING id INTO v_id;
    END IF;

    v_ids := array_append(v_ids, v_id);
    IF v_token IS NOT NULL THEN
      v_tokens := v_tokens || jsonb_build_array(
        jsonb_build_object('id', v_id, 'token', v_token)
      );
    END IF;
    v_id := NULL;
    v_token := NULL;
    v_existing := NULL;
    v_existing_sent := NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'notification_ids', to_jsonb(v_ids),
    'dispatch_tokens', v_tokens
  );
END
$$;

REVOKE ALL ON FUNCTION public.mm_create_guest_notification(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_create_guest_notification(uuid, text, text) TO anon, authenticated;

-- Each staff device retains its language setting so background push messages
-- can be rendered in English or Marathi without changing shared alert records.
CREATE TABLE IF NOT EXISTS public.mm_staff_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_role text NOT NULL CHECK (target_role IN ('admin', 'waiter', 'kitchen')),
  endpoint text NOT NULL UNIQUE,
  subscription jsonb NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mm_staff_push_subscriptions
  ADD COLUMN IF NOT EXISTS staff_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en';

-- Older installations may already have this column but with a nullable definition,
-- no default, or a non-text type. Drop language-related CHECK constraints first so
-- the migration can normalize the column definition without losing subscriptions.
DO $$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.mm_staff_push_subscriptions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%preferred_language%'
  LOOP
    EXECUTE format('ALTER TABLE public.mm_staff_push_subscriptions DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;
END
$$;

ALTER TABLE public.mm_staff_push_subscriptions
  ALTER COLUMN preferred_language DROP DEFAULT,
  ALTER COLUMN preferred_language TYPE text USING preferred_language::text;

UPDATE public.mm_staff_push_subscriptions
SET preferred_language = 'en'
WHERE preferred_language IS NULL OR preferred_language NOT IN ('en', 'mr');

ALTER TABLE public.mm_staff_push_subscriptions
  ALTER COLUMN preferred_language SET DEFAULT 'en',
  ALTER COLUMN preferred_language SET NOT NULL;

ALTER TABLE public.mm_staff_push_subscriptions
  ADD CONSTRAINT mm_staff_push_subscriptions_language_check
  CHECK (preferred_language IN ('en', 'mr'));

CREATE INDEX IF NOT EXISTS ix_mm_staff_push_role
  ON public.mm_staff_push_subscriptions (target_role, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_mm_staff_push_staff_code
  ON public.mm_staff_push_subscriptions (target_role, staff_code)
  WHERE staff_code <> '';

ALTER TABLE public.mm_staff_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mm_staff_push_subscriptions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mm_staff_push_subscriptions TO authenticated;
GRANT ALL ON public.mm_staff_push_subscriptions TO service_role;

DROP POLICY IF EXISTS mm_staff_push_manage_own_subscription
  ON public.mm_staff_push_subscriptions;
CREATE POLICY mm_staff_push_manage_own_subscription
  ON public.mm_staff_push_subscriptions
  FOR ALL TO authenticated
  USING (
    staff_user_id = auth.uid()
    AND target_role = public.get_my_staff_role()
  )
  WITH CHECK (
    staff_user_id = auth.uid()
    AND target_role = public.get_my_staff_role()
  );

COMMIT;
