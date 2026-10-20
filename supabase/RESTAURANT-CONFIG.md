# Mirch Masaala shared UPI/payment settings

To make a UPI ID entered from any Owner/Admin device appear to customers on their own phones, run `supabase/restaurant-config.sql` once in the Supabase SQL Editor.

Open this project SQL Editor:
https://supabase.com/dashboard/project/adbhxldsqwsyaqzdmxnf/sql/new

Then open `supabase/restaurant-config.sql` in GitHub, copy the entire file, paste it into the SQL Editor, and click Run. A successful run may say `Success. No rows returned`.

After the SQL migration is applied:

1. Open the live app and log in as Owner/Admin.
2. Open Settings and enter the restaurant UPI ID, UPI display name, and any PhonePe override.
3. Click Save settings. The app saves the config in Supabase and reports when it syncs.
4. Customer phones read these shared settings at page load and refresh every 20 seconds. If the payment dialog is already open when settings update, the app rebuilds the payment QR/link.

UPI settings are public checkout configuration, so the configured merchant UPI ID and display name can be read by customer devices. Only Owner/Admin may write the central record. Passwords and Supabase secret keys are not involved.

Important: after running the migration, if you already typed a UPI ID before the migration, open Owner/Admin → Settings and click Save settings again from the device that has that correct UPI ID. It will populate the central record. Do not enter an example UPI ID.