-- Mirch Masaala: public in-app reviews, owner moderation, and Google Reviews link.
-- Run after restaurant-config.sql. Safe to re-run.

BEGIN;

-- Store the owner's Google Reviews URL in the same shared configuration used for UPI/WhatsApp.
ALTER TABLE IF EXISTS public.mm_restaurant_config
  ADD COLUMN IF NOT EXISTS google_reviews_url text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.mm_restaurant_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Guest' CHECK (length(display_name) <= 80),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (length(comment) <= 1500),
  table_number text NOT NULL DEFAULT '' CHECK (length(table_number) <= 20),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_mm_restaurant_reviews_public
  ON public.mm_restaurant_reviews (restaurant_id, status, created_at DESC);

ALTER TABLE public.mm_restaurant_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mm_restaurant_reviews_public_read ON public.mm_restaurant_reviews;
CREATE POLICY mm_restaurant_reviews_public_read
  ON public.mm_restaurant_reviews
  FOR SELECT TO anon, authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND status = 'published'
  );

DROP POLICY IF EXISTS mm_restaurant_reviews_admin_read ON public.mm_restaurant_reviews;
CREATE POLICY mm_restaurant_reviews_admin_read
  ON public.mm_restaurant_reviews
  FOR SELECT TO authenticated
  USING (
    restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND public.get_my_staff_role() = 'admin'
  );

-- Customers submit reviews through a validated function. New reviews are public immediately;
-- the owner may hide or permanently delete comments from the Admin → Reviews panel.
REVOKE ALL ON public.mm_restaurant_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mm_restaurant_reviews TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mm_submit_restaurant_review(
  p_restaurant_id uuid,
  p_name text,
  p_rating integer,
  p_comment text,
  p_table_number text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
DECLARE
  v_name text;
  v_comment text;
  v_table text;
  v_review_id uuid;
BEGIN
  IF p_restaurant_id IS DISTINCT FROM 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid THEN
    RAISE EXCEPTION 'Unknown restaurant';
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Choose a rating from 1 to 5 stars';
  END IF;

  v_name := left(trim(coalesce(p_name, 'Guest')), 80);
  IF v_name = '' THEN v_name := 'Guest'; END IF;
  v_comment := trim(coalesce(p_comment, ''));
  IF length(v_comment) > 1500 THEN
    RAISE EXCEPTION 'Comment must be 1,500 characters or fewer';
  END IF;
  v_table := left(regexp_replace(coalesce(p_table_number, ''), '[^0-9A-Za-z _-]', '', 'g'), 20);

  INSERT INTO public.mm_restaurant_reviews
    (restaurant_id, display_name, rating, comment, table_number, status)
  VALUES
    (p_restaurant_id, v_name, p_rating, v_comment, v_table, 'published')
  RETURNING id INTO v_review_id;

  RETURN jsonb_build_object(
    'submitted', true,
    'review_id', v_review_id,
    'status', 'published',
    'message', 'Thank you. Your review is now visible to everyone.'
  );
END
$$;

REVOKE ALL ON FUNCTION public.mm_submit_restaurant_review(uuid, text, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_submit_restaurant_review(uuid, text, integer, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mm_admin_set_restaurant_review_status(
  p_review_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
BEGIN
  IF coalesce(public.get_my_staff_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Owner/Admin access required';
  END IF;
  IF p_status NOT IN ('published', 'hidden') THEN
    RAISE EXCEPTION 'Review status must be published or hidden';
  END IF;

  UPDATE public.mm_restaurant_reviews
  SET status = p_status
  WHERE id = p_review_id
    AND restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found';
  END IF;

  RETURN jsonb_build_object('updated', true, 'status', p_status);
END
$$;

REVOKE ALL ON FUNCTION public.mm_admin_set_restaurant_review_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_admin_set_restaurant_review_status(uuid, text) TO authenticated;

-- Only the owner may permanently delete an in-app review.
CREATE OR REPLACE FUNCTION public.mm_admin_delete_restaurant_review(
  p_review_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
BEGIN
  IF coalesce(public.get_my_staff_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Owner/Admin access required';
  END IF;

  DELETE FROM public.mm_restaurant_reviews
  WHERE id = p_review_id
    AND restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found';
  END IF;

  RETURN jsonb_build_object('deleted', true);
END
$$;

REVOKE ALL ON FUNCTION public.mm_admin_delete_restaurant_review(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_admin_delete_restaurant_review(uuid) TO authenticated;

-- Guests may see only a minimal label/status board; never return names, line items, notes,
-- prices or public_token. PREPARING and READY orders age off the board after four hours.
CREATE OR REPLACE FUNCTION public.mm_public_order_board()
RETURNS TABLE (
  ticket text,
  table_number text,
  status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog, public, pg_temp'
AS $$
  SELECT
    coalesce(nullif(o.order_number::text, ''), right(coalesce(o.ticket_id, ''), 4)) AS ticket,
    lpad(t.table_number::text, 2, '0') AS table_number,
    upper(o.status)::text AS status,
    o.created_at
  FROM public.orders AS o
  JOIN public.restaurant_tables AS t ON t.id = o.table_id
  WHERE o.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
    AND upper(o.status) IN ('NEW', 'PREPARING', 'READY')
    AND o.created_at >= now() - interval '4 hours'
  ORDER BY
    CASE upper(o.status) WHEN 'NEW' THEN 0 WHEN 'PREPARING' THEN 1 WHEN 'READY' THEN 2 ELSE 3 END,
    o.created_at ASC
  LIMIT 20
$$;

REVOKE ALL ON FUNCTION public.mm_public_order_board() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_public_order_board() TO anon, authenticated;

COMMIT;
