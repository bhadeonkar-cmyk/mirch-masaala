# Mirch Masaala — staff background push alerts

This setup adds a phone/lock-screen notification for staff when guest requests such as **Call waiter** or **Request bill** arrive. The in-app notification feed is separate: it can work while the staff page is open even when background push has not been configured.

## 1. Protect production before changing SQL

1. In the Supabase Dashboard, open the correct Mirch Masaala project and check **Database → Backups**. Verify the latest recoverable backup and its restore method, or arrange a database dump before proceeding.
2. The app's **Download data backup** JSON is useful for restaurant data export, but it is not a complete database/schema backup and is not a one-click restore.
3. If you cannot verify a recoverable backup, stop before running the migration.

## 2. Run only the SQL this readiness result requires

Run `supabase/app-readiness-check.sql` in the Supabase SQL Editor first. For the current result reported by the owner, the **Staff push subscription table** is already **READY**, while the **Push language preference column/default** is **OPTIONAL — NOT CONFIGURED**. The role-notification table, notification read/resolve RPCs, and kitchen alert components are already READY.

After the backup is verified, run only `supabase/staff-push-notifications.sql` from this repository if the optional background-push setup is wanted. Do not rerun every core migration just because a `next_step` column mentions it; rerun a core migration only if the readiness check reports its component missing.

- Open this file on GitHub and copy the complete SQL: [staff-push-notifications.sql](./staff-push-notifications.sql).
- In Supabase **SQL Editor → New query**, paste the complete file and click **Run**.
- This migration is designed to be re-runnable. It adds missing columns, gives `preferred_language` a default of `en`, normalizes old values, and configures the subscription-table policy while preserving existing subscriptions and notification records.
- A successful DDL-only run may show **Success. No rows returned**. If any error appears, stop and keep the complete error text; do not run reset/erase functions.

Then rerun the updated [read-only readiness check](./app-readiness-check.sql). Confirm both **Staff push subscription table** and **Push language preference column/default** report **READY**. This readiness check only inspects database metadata; it does not modify the schema.

## 3. Configure the Edge Function secrets

In Supabase Dashboard → **Edge Functions → Secrets**, confirm these values exist:

- `VAPID_PUBLIC_KEY` = `BH8rULqiO6c1_QtspafwRyxbpHz3V48VXf7If1UTv1u4s3WUyNw5IeUBDMcISfOCoLEM6spSfJ5Jf1TH0xNgjto`
- `VAPID_PRIVATE_KEY` = the private key that belongs to the public key above. Keep it only in Supabase Secrets; never commit it to GitHub, browser code, a chat, or a screenshot.
- `VAPID_SUBJECT` = `https://bhadeonkar-cmyk.github.io/mirch-masaala/`

Supabase normally injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into Edge Functions. Do not put the service-role key in the frontend or add it to GitHub.

**Key-pair warning:** the public key embedded in `supabase-live.js` must match `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. If the existing private key is unknown or the key pair cannot be verified, pause before changing keys. Generating a new pair requires updating the website public key and having every staff device create a fresh subscription; changing only the server key will break existing subscriptions.

## 4. Deploy the push sender

Deploy the current `supabase/functions/send-staff-push/index.ts` as the existing Edge Function named `send-staff-push`.

In that function's settings, **Verify JWT with legacy secret must be OFF only for this function**, because the website sends a modern publishable key and this function performs its own origin and one-time dispatch-token checks. Keep those code checks in place. Do not change the settings for other functions.

The sender accepts fresh, one-time notification ID/token pairs, checks eligible notification rows, and uses the service-role client server-side to find the matching subscribed staff devices. It returns counts for notifications, devices, sent and failed deliveries. Review the function logs after a test; an HTTP success alone does not guarantee a phone displayed a notification.

## 5. Enable alerts on each staff device

- **Android:** open the live site in a push-capable browser such as Chrome.
- **iPhone/iPad:** open the site in Safari, choose **Share → Add to Home Screen**, open Mirch Masaala from the new Home Screen icon, and use iOS/iPadOS 16.4 or later.
- Sign in as the correct staff role (Owner/Admin, Waiter, or Kitchen), tap the bell / **Alert options**, and allow notifications.
- The staff device must have a valid login and network access. Waiters must use their selected/assigned staff code where the app requests it.

## 6. Test without changing business records

1. Keep a staff screen open and verify the in-app Alerts feed works.
2. From a customer phone, open a valid table QR and tap **Call waiter**. Confirm the staff feed receives the new waiter-call alert.
3. Confirm a subscribed waiter phone receives a background notification when the app is not in the foreground. Also test **Request bill** if that workflow is enabled.
4. Check Supabase Edge Function logs and the function result counts if push does not appear. Do not use real payment, order erase, reset, or destructive cleanup actions as notification tests.

## Troubleshooting

- **Readiness says the subscription table is READY but the language column/default is not:** after verifying a backup, run only `staff-push-notifications.sql`, then run the readiness check again.
- **`PGRST205` or missing table:** check whether the push SQL completed successfully, then wait briefly and retry if the schema cache has not refreshed.
- **`PGRST204`, missing column, or schema-cache message:** re-run the safe push migration and the readiness check.
- **`42501` / permission or RLS refusal:** sign out and back in with the correct staff role. The owner should inspect the staff role and the subscription table's RLS policy before changing grants.
- **Edge Function 404 / not found:** deploy the `send-staff-push` function.
- **Edge Function 503 / secrets not configured:** check the three VAPID secrets and verify the public/private key pair.
- **Function returns `sent: 0`:** check that a staff device has subscribed, the device's role matches the notification target, any waiter staff-code assignment matches, and the request has a fresh one-time token.
- **Function reports failed deliveries:** inspect the Edge Function logs and device/browser subscription. Expired push endpoints may need the staff device to enable alerts again.

## Security notes

- A push contains only a minimal staff alert, not guest names, dish lists, or order totals.
- A staff subscription is tied to the signed-in Supabase user and the role returned by the database.
- Never weaken RLS or remove the one-time dispatch-token checks to make push work.
- In-app alerts and background/lock-screen pushes are separate paths. A working in-app alert does not prove that background push is configured or delivered.
