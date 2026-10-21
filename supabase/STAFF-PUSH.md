# Mirch Masaala — waiter push alerts

This enables a phone notification when a customer taps **Call waiter**, even if the staff app is in the background or the phone is locked. In-app alerts continue to work while the staff screen is open.

## One-time setup

### 1. Apply the SQL

Open the Supabase SQL Editor for this project and run these scripts in order, if they have not already been applied:

1. `supabase/role-notifications.sql`
2. `supabase/staff-push-notifications.sql`

The second script creates a private table for each staff device's push subscription. RLS limits staff to their own subscription; only the Edge Function's service-role client can read the subscriptions to send a push.

### 2. Add Edge Function secrets

In Supabase Dashboard → Edge Functions → Secrets, add:

- `VAPID_PUBLIC_KEY` = `BFfNaha9B9Qr2km9sJF7nOJ6zc8BGUMp85rVplwULF3BpCF0ut0TFNcEL8vzvG4ya5DFR1ZMRJA5_cB2UGk6kA0`
- `VAPID_PRIVATE_KEY` = keep this private; get the value from the app owner, then paste it into Supabase Secrets only. **Never commit this value to GitHub or place it in browser code.**
- `VAPID_SUBJECT` = `https://bhadeonkar-cmyk.github.io/mirch-masaala/`

Supabase normally provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions automatically. Do not expose the service-role key in the website.

### 3. Deploy the Edge Function

Create an Edge Function named `send-staff-push` in the Supabase Dashboard, paste the code from [`supabase/functions/send-staff-push/index.ts`](./functions/send-staff-push/index.ts), then deploy it. Keep JWT verification enabled; the app calls this using the Supabase client.

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
