# Mirch Masaala shared UPI/payment and restaurant WhatsApp settings

To make a UPI ID entered from any Owner/Admin device appear to customers on their own phones, run `supabase/restaurant-config.sql` once in the Supabase SQL Editor.

Open this project SQL Editor:
https://supabase.com/dashboard/project/adbhxldsqwsyaqzdmxnf/sql/new

Then open `supabase/restaurant-config.sql` in GitHub, copy the entire file, paste it into the SQL Editor, and click Run. A successful run may say `Success. No rows returned`.

After the SQL migration is applied:

1. Open the live app and log in as Owner/Admin.
2. Open Settings and enter the restaurant UPI ID, UPI display name, and any PhonePe override.
3. Click Save settings. The app saves the config in Supabase and reports when it syncs. This includes the restaurant WhatsApp contact number and display name.
4. Customer phones read these shared settings at page load and refresh every 20 seconds. The restaurant WhatsApp contact shown in customer-facing areas follows the same central setting. If the payment dialog is already open when settings update, the app rebuilds the payment QR/link.

UPI settings are public checkout configuration, so the configured merchant UPI ID and display name can be read by customer devices. Only Owner/Admin may write the central record. Passwords and Supabase secret keys are not involved.

Important: after running the migration, open Owner/Admin → Settings and click Save settings from the device holding the correct UPI ID and WhatsApp contact. This populates the central record. If you already ran an earlier version of this SQL file, this updated version adds the WhatsApp columns safely. Do not enter an example UPI ID or phone number.