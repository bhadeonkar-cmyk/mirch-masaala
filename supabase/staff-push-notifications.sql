-- Mirch Masaala staff push notifications
-- Run AFTER supabase/role-notifications.sql.
-- Saves each staff device's Web Push subscription. Push endpoints are private;
-- only the signed-in staff member can manage their own subscription.

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
  ADD COLUMN IF NOT EXISTS push_sent_at timestamptz;

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

CREATE INDEX IF NOT EXISTS ix_mm_staff_push_role
  ON public.mm_staff_push_subscriptions (target_role, updated_at DESC);

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
