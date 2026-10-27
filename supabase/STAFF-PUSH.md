# Mirch Masaala — waiter push alerts

This enables a phone notification when a customer taps **Call waiter**, even if the staff app is in the background or the phone is locked. In-app alerts continue to work while the staff screen is open.

## One-time setup

### 1. Apply the SQL

Open the Supabase SQL Editor for this project and run these scripts in order, if they have not already been applied:

1. `supabase/role-notifications.sql`
2. `supabase/staff-push-notifications.sql`

If you ran the earlier version of the second script already, **run the updated `staff-push-notifications.sql` again**. It is designed to be re-run; this update adds one-time dispatch tokens and replaces the guest notification RPC so a push must redeem its matching, fresh ID/token pair. The script also creates the private table for each staff device's subscription. RLS limits staff to their own subscription; only the Edge Function's service-role client can read subscriptions to send a push.

### 2. Add Edge Function secrets

In Supabase Dashboard → Edge Functions → Secrets, add:

- `VAPID_PUBLIC_KEY` = `BCGV3-RIkNT5dJfV96yuWS61iZe5Zf85s8CJWBgq-Q_pGJWCLEkMD-91IB7yvsZ6Z0mGebJCohhVJmUHcuNW1E0`
- `VAPID_PRIVATE_KEY` = keep this private; get the value from the app owner, then paste it into Supabase Secrets only. **Never commit this value to GitHub or place it in browser code.**
- `VAPID_SUBJECT` = `https://bhadeonkar-cmyk.github.io/mirch-masaala/`

Supabase normally provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions automatically. Do not expose the service-role key in the website.

### 3. Deploy the Edge Function

Open the existing `send-staff-push` function in the Supabase Dashboard, replace its code with the latest [`supabase/functions/send-staff-push/index.ts`](./functions/send-staff-push/index.ts), then deploy it. In the function's settings, turn **Verify JWT with legacy secret OFF**. This app sends a modern `sb_publishable_...` key, which the legacy verifier cannot validate. The function performs custom checks on the approved web origin and redeems a one-time ID/token pair minted by the guest-notification SQL RPC; keep the VAPID private key and service-role key in Supabase Secrets only.

### 4. Enable it on each staff phone

- **iPhone/iPad:** Open this site in Safari, choose Share → Add to Home Screen, then open Mirch Masaala from that new icon. Web push on iPhone/iPad requires a Home Screen web app and iOS/iPadOS 16.4 or later.
- **Android:** Open in a push-capable browser such as Chrome.
- Sign in with the staff member's correct role and tap the bell / **Alert options** once. Allow notifications when asked.

### 5. Test

From a customer phone, choose a table and tap **Call waiter**. A subscribed waiter phone should show a notification such as **WAITER NEEDED · TABLE 04**. Tap it to open the waiter workspace. Notification delivery is subject to OS notification settings, network access and the push service.

## Security notes

- The VAPID private key belongs only in Supabase Function Secrets.
- A push does not include guest names, food items, order totals or other private order details.
- Each staff device subscribes under its authenticated staff role.
