-- Mirch Masaala initial menu import
-- Run this once in Supabase SQL Editor for restaurant a3702d10-6673-4c06-9783-1d61c945ecd5.
-- This script stops rather than overwriting an already imported menu.

BEGIN;

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS is_veg boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_bestseller boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS spicy_level integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.menu_items
    WHERE restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
  ) THEN
    RAISE EXCEPTION 'Menu items already exist for Mirch Masaala. Import cancelled to avoid duplicates.';
  END IF;

  IF (
    SELECT COUNT(DISTINCT name) FROM public.categories
    WHERE restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
      AND name IN ('Soup & Starters', 'Beverages', 'Mutton Starters', 'Chicken Starters', 'Veg Starters', 'Thali', 'Non-Veg Main Course', 'Veg Main Course', 'Rice & Breads')
  ) <> 9 THEN
    RAISE EXCEPTION 'Expected 9 distinct menu categories for Mirch Masaala. Import cancelled.';
  END IF;
END $$;

WITH source(name, category_name, description, price, image_url, is_available, sort_order, is_veg, is_bestseller, spicy_level) AS (
VALUES
  ('Manchow Soup (Chicken)', 'Soup & Starters', NULL, 240, NULL, true, 1, false, false, 0),
  ('Manchow Soup (Veg)', 'Soup & Starters', NULL, 200, NULL, true, 2, true, false, 0),
  ('Hot & Sour Soup (Chicken)', 'Soup & Starters', NULL, 240, NULL, true, 3, false, false, 0),
  ('Hot & Sour Soup (Veg)', 'Soup & Starters', NULL, 200, NULL, true, 4, true, false, 0),
  ('Alani Soup (Mutton)', 'Soup & Starters', NULL, 260, NULL, true, 5, false, false, 0),
  ('Alani Soup (Chicken)', 'Soup & Starters', NULL, 230, NULL, true, 6, false, false, 0),
  ('Mutton Paya Soup', 'Soup & Starters', NULL, 270, NULL, true, 7, false, false, 0),
  ('Green Salad', 'Soup & Starters', NULL, 110, NULL, true, 8, true, false, 0),
  ('Masala Papad', 'Soup & Starters', NULL, 40, NULL, true, 9, true, false, 0),
  ('Fry Papad', 'Soup & Starters', NULL, 35, NULL, true, 10, true, false, 0),
  ('Roasted Papad', 'Soup & Starters', NULL, 35, NULL, true, 11, true, false, 0),
  ('Mineral Water', 'Beverages', NULL, 20, NULL, true, 12, true, false, 0),
  ('Soft Drink (Big)', 'Beverages', NULL, 40, NULL, true, 13, true, false, 0),
  ('Soft Drink (Small)', 'Beverages', NULL, 20, NULL, true, 14, true, false, 0),
  ('Mutton Raan', 'Mutton Starters', NULL, 2500, NULL, true, 15, false, true, 0),
  ('Mutton Boti Kebab', 'Mutton Starters', NULL, 480, NULL, true, 16, false, true, 0),
  ('Mutton Kharda', 'Mutton Starters', NULL, 450, NULL, true, 17, false, false, 0),
  ('Mutton Fry', 'Mutton Starters', NULL, 420, NULL, true, 18, false, false, 0),
  ('Mutton Ukad', 'Mutton Starters', NULL, 420, NULL, true, 19, false, false, 0),
  ('Wajadi Fry', 'Mutton Starters', NULL, 390, NULL, true, 20, false, false, 0),
  ('Chicken Raan', 'Chicken Starters', NULL, 500, NULL, true, 21, false, false, 0),
  ('Chicken Tikka', 'Chicken Starters', NULL, 310, NULL, true, 22, false, false, 0),
  ('Chicken Banjara Tikka', 'Chicken Starters', NULL, 320, NULL, true, 23, false, false, 0),
  ('Chicken Hariyali Tikka', 'Chicken Starters', NULL, 310, NULL, true, 24, false, false, 0),
  ('Chicken Kharda', 'Chicken Starters', NULL, 280, NULL, true, 25, false, false, 0),
  ('Chicken Fry', 'Chicken Starters', NULL, 280, NULL, true, 26, false, false, 0),
  ('Chicken Ukad', 'Chicken Starters', NULL, 280, NULL, true, 27, false, false, 0),
  ('Chicken Koliwada Fry', 'Chicken Starters', NULL, 280, NULL, true, 28, false, false, 0),
  ('Chicken Chilli Dry', 'Chicken Starters', NULL, 280, NULL, true, 29, false, false, 0),
  ('Chicken Manchurian Dry', 'Chicken Starters', NULL, 280, NULL, true, 30, false, false, 0),
  ('Chicken 65 Dry', 'Chicken Starters', NULL, 280, NULL, true, 31, false, false, 0),
  ('Paneer Tikka', 'Veg Starters', NULL, 280, NULL, true, 32, true, false, 0),
  ('Paneer Banjara Tikka', 'Veg Starters', NULL, 300, NULL, true, 33, true, false, 0),
  ('Paneer Hariyali Tikka', 'Veg Starters', NULL, 280, NULL, true, 34, true, false, 0),
  ('Tandoori Mushroom', 'Veg Starters', NULL, 270, NULL, true, 35, true, false, 0),
  ('Palak Paneer Shami Kebab', 'Veg Starters', NULL, 280, NULL, true, 36, true, false, 0),
  ('Kothimbir Vadi', 'Veg Starters', NULL, 270, NULL, true, 37, true, false, 0),
  ('Thalipeeth', 'Veg Starters', NULL, 260, NULL, true, 38, true, false, 0),
  ('Veg Manchurian Dry', 'Veg Starters', NULL, 260, NULL, true, 39, true, false, 0),
  ('Paneer Chilli Dry', 'Veg Starters', NULL, 280, NULL, true, 40, true, false, 0),
  ('Paneer Manchurian Dry', 'Veg Starters', NULL, 280, NULL, true, 41, true, false, 0),
  ('Mushroom Chilli Dry', 'Veg Starters', NULL, 270, NULL, true, 42, true, false, 0),
  ('Mushroom Manchurian Dry', 'Veg Starters', NULL, 270, NULL, true, 43, true, false, 0),
  ('Mutton Gawakadchi Thali', 'Thali', 'Mutton Fry, Tambda Rassa, Pandhra Rassa, Pulao or Indrayani Rice, Dahi Kanda, Bakari / Chapati / Roti', 580, NULL, true, 44, false, true, 0),
  ('Special Mutton Thali', 'Thali', 'Mutton Fry, Mutton Kheema, Tambda Rassa, Pandhra Rassa, Biryani or Alani Rice, Dahi Kanda, Boiled Egg, Bakari / Chapati / Roti', 680, NULL, true, 45, false, false, 0),
  ('Chicken Gawakadchi Thali', 'Thali', 'Chicken Fry, Tambda Rassa, Pandhra Rassa, Pulao or Indrayani Rice, Dahi Kanda, Bakari / Chapati / Roti', 490, NULL, true, 46, false, true, 0),
  ('Special Chicken Thali', 'Thali', 'Chicken Fry, Chicken Kheema, Tambda Rassa, Pandhra Rassa, Biryani or Alani Rice, Dahi Kanda, Boiled Egg, Bakari / Chapati / Roti', 590, NULL, true, 47, false, false, 0),
  ('Veg Thali', 'Thali', 'Sukhi Bhaji, Rassa Bhaji, Dal, Rice, Dahi Kanda, Bakari / Chapati / Roti', 450, NULL, true, 48, true, false, 0),
  ('Mutton Handi (Full)', 'Non-Veg Main Course', NULL, 670, NULL, true, 49, false, false, 0),
  ('Mutton Handi (Half)', 'Non-Veg Main Course', NULL, 550, NULL, true, 50, false, false, 0),
  ('Hyderabadi Paya Korma', 'Non-Veg Main Course', NULL, 430, NULL, true, 51, false, false, 0),
  ('Mutton Kheema Masala', 'Non-Veg Main Course', NULL, 420, NULL, true, 52, false, false, 0),
  ('Mutton Kolhapuri Lonche', 'Non-Veg Main Course', NULL, 400, NULL, true, 53, false, false, 0),
  ('Mutton Kolhapuri Curry', 'Non-Veg Main Course', NULL, 390, NULL, true, 54, false, false, 0),
  ('Mutton Kharda (Main)', 'Non-Veg Main Course', NULL, 400, NULL, true, 55, false, false, 0),
  ('Mutton Aalni', 'Non-Veg Main Course', NULL, 380, NULL, true, 56, false, false, 0),
  ('Chicken Handi (Full)', 'Non-Veg Main Course', NULL, 650, NULL, true, 57, false, false, 0),
  ('Chicken Handi (Half)', 'Non-Veg Main Course', NULL, 520, NULL, true, 58, false, false, 0),
  ('Chicken Kolhapuri Curry', 'Non-Veg Main Course', NULL, 350, NULL, true, 59, false, false, 0),
  ('Chicken Kheema Masala', 'Non-Veg Main Course', NULL, 390, NULL, true, 60, false, false, 0),
  ('Chicken Kolhapuri Lonche', 'Non-Veg Main Course', NULL, 370, NULL, true, 61, false, false, 0),
  ('Chicken Kharda (Main)', 'Non-Veg Main Course', NULL, 370, NULL, true, 62, false, false, 0),
  ('Chicken Aalni', 'Non-Veg Main Course', NULL, 340, NULL, true, 63, false, false, 0),
  ('Chicken Tikka Masala', 'Non-Veg Main Course', NULL, 370, NULL, true, 64, false, false, 0),
  ('Paneer Butter Masala', 'Veg Main Course', NULL, 350, NULL, true, 65, true, false, 0),
  ('Paneer Bhurji Masala', 'Veg Main Course', NULL, 350, NULL, true, 66, true, false, 0),
  ('Paneer Mirch Masala', 'Veg Main Course', NULL, 350, NULL, true, 67, true, false, 0),
  ('Paneer Taka Tak', 'Veg Main Course', NULL, 320, NULL, true, 68, true, false, 0),
  ('Veg Kolhapuri', 'Veg Main Course', NULL, 280, NULL, true, 69, true, false, 0),
  ('Veg Amritsari', 'Veg Main Course', NULL, 280, NULL, true, 70, true, false, 0),
  ('Veg Mirch Masala', 'Veg Main Course', NULL, 260, NULL, true, 71, true, false, 0),
  ('Paneer Mutter', 'Veg Main Course', NULL, 320, NULL, true, 72, true, false, 0),
  ('Mushroom Mutter', 'Veg Main Course', NULL, 280, NULL, true, 73, true, false, 0),
  ('Shevga Masala', 'Veg Main Course', NULL, 250, NULL, true, 74, true, false, 0),
  ('Methi Besan', 'Veg Main Course', NULL, 250, NULL, true, 75, true, false, 0),
  ('Bharli Vangi', 'Veg Main Course', NULL, 250, NULL, true, 76, true, false, 0),
  ('Pithla', 'Veg Main Course', NULL, 220, NULL, true, 77, true, false, 0),
  ('Dal Fry', 'Veg Main Course', NULL, 180, NULL, true, 78, true, false, 0),
  ('Dal Tadka', 'Veg Main Course', NULL, 200, NULL, true, 79, true, false, 0),
  ('Hyderabadi Degh Biryani (Mutton)', 'Rice & Breads', NULL, 550, NULL, true, 80, false, true, 0),
  ('Hyderabadi Degh Biryani (Chicken)', 'Rice & Breads', NULL, 480, NULL, true, 81, false, false, 0),
  ('Alani Rice (Mutton)', 'Rice & Breads', NULL, 310, NULL, true, 82, false, false, 0),
  ('Alani Rice (Chicken)', 'Rice & Breads', NULL, 280, NULL, true, 83, false, false, 0),
  ('Plain Rice (Full)', 'Rice & Breads', NULL, 220, NULL, true, 84, true, false, 0),
  ('Plain Rice (Half)', 'Rice & Breads', NULL, 180, NULL, true, 85, true, false, 0),
  ('Jeera / Steamed / Indrayani Rice', 'Rice & Breads', NULL, 180, NULL, true, 86, true, false, 0),
  ('Schezwan Fried Rice (Chicken)', 'Rice & Breads', NULL, 270, NULL, true, 87, false, false, 0),
  ('Schezwan Fried Rice (Veg)', 'Rice & Breads', NULL, 220, NULL, true, 88, true, false, 0),
  ('Schezwan Fried Rice (Egg)', 'Rice & Breads', NULL, 240, NULL, true, 89, false, false, 0),
  ('Fried Rice (Chicken)', 'Rice & Breads', NULL, 250, NULL, true, 90, false, false, 0),
  ('Fried Rice (Veg)', 'Rice & Breads', NULL, 200, NULL, true, 91, true, false, 0),
  ('Fried Rice (Egg)', 'Rice & Breads', NULL, 220, NULL, true, 92, false, false, 0),
  ('Dal Khichdi', 'Rice & Breads', NULL, 250, NULL, true, 93, true, false, 0),
  ('Dal Khichdi Tadka', 'Rice & Breads', NULL, 270, NULL, true, 94, true, false, 0),
  ('Roti (Plain)', 'Rice & Breads', NULL, 30, NULL, true, 95, true, false, 0),
  ('Roti (Butter)', 'Rice & Breads', NULL, 35, NULL, true, 96, true, false, 0),
  ('Roti (Garlic)', 'Rice & Breads', NULL, 40, NULL, true, 97, true, false, 0),
  ('Naan (Plain)', 'Rice & Breads', NULL, 70, NULL, true, 98, true, false, 0),
  ('Naan (Butter)', 'Rice & Breads', NULL, 90, NULL, true, 99, true, false, 0),
  ('Naan (Garlic)', 'Rice & Breads', NULL, 100, NULL, true, 100, true, false, 0),
  ('Naan (Cheese)', 'Rice & Breads', NULL, 120, NULL, true, 101, true, false, 0),
  ('Naan (Cheese Garlic)', 'Rice & Breads', NULL, 140, NULL, true, 102, true, false, 0),
  ('Chapati (Plain)', 'Rice & Breads', NULL, 30, NULL, true, 103, true, false, 0),
  ('Chapati (Butter)', 'Rice & Breads', NULL, 35, NULL, true, 104, true, false, 0),
  ('Bhakri (Plain)', 'Rice & Breads', NULL, 30, NULL, true, 105, true, false, 0),
  ('Bhakri (Butter)', 'Rice & Breads', NULL, 35, NULL, true, 106, true, false, 0)
)
INSERT INTO public.menu_items
  (restaurant_id, category_id, name, description, price, image_url, is_available, sort_order, is_veg, is_bestseller, spicy_level)
SELECT
  'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid,
  c.id,
  s.name,
  s.description,
  s.price,
  s.image_url,
  s.is_available,
  s.sort_order,
  s.is_veg,
  s.is_bestseller,
  s.spicy_level
FROM source s
JOIN public.categories c
  ON c.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
 AND c.name = s.category_name;

DO $$
DECLARE imported_count integer;
BEGIN
  SELECT COUNT(*) INTO imported_count
  FROM public.menu_items
  WHERE restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid;

  IF imported_count <> 106 THEN
    RAISE EXCEPTION 'Expected 106 menu items, but found %', imported_count;
  END IF;
END $$;

COMMIT;

SELECT category_name, COUNT(*) AS dishes
FROM (
  SELECT c.name AS category_name
  FROM public.menu_items mi
  JOIN public.categories c ON c.id = mi.category_id
  WHERE mi.restaurant_id = 'a3702d10-6673-4c06-9783-1d61c945ecd5'::uuid
) imported
GROUP BY category_name
ORDER BY category_name;
