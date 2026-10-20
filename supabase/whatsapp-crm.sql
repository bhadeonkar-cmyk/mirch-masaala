-- Mirch Masaala: shared WhatsApp customer permissions, owner settings, and broadcast log.
-- Run in Supabase SQL Editor after setup-live.sql. Safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mm_customer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  phone text NOT NULL,
  name text NOT NULL DEFAULT 'Guest',
  wa_order_updates boolean NOT NULL DEFAULT false,
  wa_marketing_opt_in boolean NOT NULL DEFAULT false,
  wa_order_updates_consent_at timestamptz,
  wa_marketing_consent_at timestamptz,
  consent_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  visit_count integer NOT NULL DEFAULT 1 CHECK (visit_count >= 1),
  UNIQUE (restaurant_id, phone),
  CHECK (phone ~ '^[0-9]{10}$')
);
CREATE INDEX IF NOT EXISTS ix_mm_customer_profiles_restaurant_created
  ON public.mm_customer_profiles (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_mm_customer_profiles_marketing
  ON public.mm_customer_profiles (restaurant_id, wa_marketing_opt_in)
  WHERE wa_marketing_opt_in = true;
CREATE INDEX IF NOT EXISTS ix_mm_customer_profiles_order_updates
  ON public.mm_customer_profiles (restaurant_id, wa_order_updates)
  WHERE wa_order_updates = true;

ALTER TABLE public.mm_customer_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mm_customer_profiles_admin_read ON public.mm_customer_profiles;
CREATE POLICY mm_customer_profiles_admin_read ON public.mm_customer_profiles
  FOR SELECT TO authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() = 'admin'
  );
REVOKE ALL ON public.mm_customer_profiles FROM anon, authenticated;
GRANT SELECT ON public.mm_customer_profiles TO authenticated;

CREATE TABLE IF NOT EXISTS public.mm_whatsapp_settings (
  restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  owner_contact text NOT NULL DEFAULT '919657076450',
  display_name text NOT NULL DEFAULT 'Mirch Masaala',
  receipt_message text NOT NULL DEFAULT 'Thank you for dining at Mirch Masaala!',
  order_update_message text NOT NULL DEFAULT 'An update from Mirch Masaala: Thank you for choosing us. Please contact our team if you need help with your visit.',
  announcement_message text NOT NULL DEFAULT 'Hello from Mirch Masaala! We have an update to share with our customers. Thank you for being part of our restaurant family.',
  offer_message text NOT NULL DEFAULT 'Hello from Mirch Masaala! Visit us to ask about our latest specials. We look forward to serving you.',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.mm_whatsapp_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mm_whatsapp_settings_admin_all ON public.mm_whatsapp_settings;
CREATE POLICY mm_whatsapp_settings_admin_all ON public.mm_whatsapp_settings
  FOR ALL TO authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() = 'admin'
  )
  WITH CHECK (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() = 'admin'
  );
REVOKE ALL ON public.mm_whatsapp_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mm_whatsapp_settings TO authenticated;

INSERT INTO public.mm_whatsapp_settings
  (restaurant_id, owner_contact, display_name)
VALUES
  ('a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid, '919657076450', 'Mirch Masaala')
ON CONFLICT (restaurant_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mm_whatsapp_broadcast_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('order_updates', 'announcement', 'offer')),
  message text NOT NULL,
  eligible_count integer NOT NULL DEFAULT 0,
  attempted_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  provider_status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mm_whatsapp_broadcast_logs_created
  ON public.mm_whatsapp_broadcast_logs (restaurant_id, created_at DESC);
ALTER TABLE public.mm_whatsapp_broadcast_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mm_whatsapp_broadcast_logs_admin_read ON public.mm_whatsapp_broadcast_logs;
CREATE POLICY mm_whatsapp_broadcast_logs_admin_read ON public.mm_whatsapp_broadcast_logs
  FOR SELECT TO authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() = 'admin'
  );
REVOKE ALL ON public.mm_whatsapp_broadcast_logs FROM anon, authenticated;
GRANT SELECT ON public.mm_whatsapp_broadcast_logs TO authenticated;

CREATE OR REPLACE FUNCTION public.mm_save_customer_profile(
  p_restaurant_id uuid,
  p_phone text,
  p_name text,
  p_order_updates boolean,
  p_marketing_opt_in boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_phone text;
  v_name text;
  v_order boolean := coalesce(p_order_updates, false);
  v_marketing boolean := coalesce(p_marketing_opt_in, false);
  v_profile public.mm_customer_profiles%ROWTYPE;
BEGIN
  IF p_restaurant_id IS DISTINCT FROM 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid THEN
    RAISE EXCEPTION 'Unknown restaurant';
  END IF;
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  IF length(v_phone) = 12 AND left(v_phone, 2) = '91' THEN
    v_phone := right(v_phone, 10);
  END IF;
  IF length(v_phone) = 11 AND left(v_phone, 1) = '0' THEN
    v_phone := right(v_phone, 10);
  END IF;
  IF v_phone !~ '^[6-9][0-9]{9}$' THEN
    RAISE EXCEPTION 'Enter a valid Indian 10-digit mobile number';
  END IF;
  v_name := left(trim(coalesce(p_name, 'Guest')), 100);
  IF v_name = '' THEN v_name := 'Guest'; END IF;

  INSERT INTO public.mm_customer_profiles AS current_profile
    (restaurant_id, phone, name, wa_order_updates, wa_marketing_opt_in,
     wa_order_updates_consent_at, wa_marketing_consent_at,
     consent_updated_at, created_at, last_seen_at, visit_count)
  VALUES
    (p_restaurant_id, v_phone, v_name, v_order, v_marketing,
     CASE WHEN v_order THEN now() ELSE NULL END,
     CASE WHEN v_marketing THEN now() ELSE NULL END,
     now(), now(), now(), 1)
  ON CONFLICT (restaurant_id, phone) DO UPDATE SET
    name = EXCLUDED.name,
    wa_order_updates = EXCLUDED.wa_order_updates,
    wa_marketing_opt_in = EXCLUDED.wa_marketing_opt_in,
    wa_order_updates_consent_at = CASE
      WHEN EXCLUDED.wa_order_updates THEN
        CASE WHEN current_profile.wa_order_updates THEN current_profile.wa_order_updates_consent_at ELSE now() END
      ELSE NULL END,
    wa_marketing_consent_at = CASE
      WHEN EXCLUDED.wa_marketing_opt_in THEN
        CASE WHEN current_profile.wa_marketing_opt_in THEN current_profile.wa_marketing_consent_at ELSE now() END
      ELSE NULL END,
    consent_updated_at = now(),
    last_seen_at = now(),
    visit_count = current_profile.visit_count + 1
  RETURNING * INTO v_profile;

  RETURN jsonb_build_object(
    'saved', true,
    'phone', v_profile.phone,
    'wa_order_updates', v_profile.wa_order_updates,
    'wa_marketing_opt_in', v_profile.wa_marketing_opt_in
  );
END
$$;
REVOKE ALL ON FUNCTION public.mm_save_customer_profile(uuid, text, text, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_customer_profile(uuid, text, text, boolean, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mm_admin_stop_customer_whatsapp(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $
BEGIN
  IF coalesce(public.get_my_staff_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Owner/Admin access required';
  END IF;

  UPDATE public.mm_customer_profiles
  SET wa_order_updates = false,
      wa_marketing_opt_in = false,
      wa_order_updates_consent_at = NULL,
      wa_marketing_consent_at = NULL,
      consent_updated_at = now()
  WHERE id = p_profile_id
    AND restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer profile not found';
  END IF;
  RETURN jsonb_build_object('updated', true, 'messages_disabled', true);
END
$;
REVOKE ALL ON FUNCTION public.mm_admin_stop_customer_whatsapp(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_admin_stop_customer_whatsapp(uuid) TO authenticated;

COMMIT;
