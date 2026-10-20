-- Mirch Masaala shared public/checkout settings.
-- Run once in Supabase SQL Editor. Safe to re-run.
-- Stores shared UPI/payment configuration so owner edits on any device reach customers.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mm_restaurant_config (
  restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  restaurant_name text NOT NULL DEFAULT 'MIRCH MASAALA',
  tagline text NOT NULL DEFAULT 'INDIAN RESTAURANT',
  admin_phone text NOT NULL DEFAULT '+91 9657076450',
  upi_id text NOT NULL DEFAULT '',
  upi_name text NOT NULL DEFAULT 'Mirch Masaala',
  phonepe_upi text NOT NULL DEFAULT '',
  pay_note text NOT NULL DEFAULT 'Review the amount in your payment app before paying.',
  accept_card boolean NOT NULL DEFAULT true,
  accept_cash boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (length(upi_id) <= 150),
  CHECK (length(phonepe_upi) <= 150)
);

ALTER TABLE public.mm_restaurant_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mm_restaurant_config_public_read ON public.mm_restaurant_config;
CREATE POLICY mm_restaurant_config_public_read
  ON public.mm_restaurant_config
  FOR SELECT TO anon, authenticated
  USING (restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid);

DROP POLICY IF EXISTS mm_restaurant_config_admin_insert ON public.mm_restaurant_config;
CREATE POLICY mm_restaurant_config_admin_insert
  ON public.mm_restaurant_config
  FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() = 'admin'
  );

DROP POLICY IF EXISTS mm_restaurant_config_admin_update ON public.mm_restaurant_config;
CREATE POLICY mm_restaurant_config_admin_update
  ON public.mm_restaurant_config
  FOR UPDATE TO authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() = 'admin'
  )
  WITH CHECK (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() = 'admin'
  );

REVOKE ALL ON public.mm_restaurant_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mm_restaurant_config TO anon, authenticated;
GRANT INSERT, UPDATE ON public.mm_restaurant_config TO authenticated;

COMMIT;
