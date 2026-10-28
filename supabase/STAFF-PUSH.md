# Mirch Masaala — staff background push alerts

Two separate things exist:

- **In-app alerts**: the Alerts feed on an open staff screen. Needs `role-notifications.sql` (already READY on your project).
- **Background / lock-screen push**: a notification on the phone while the app is closed. Needs the SQL below **plus** an Edge Function, three secrets, and each phone enabling alerts.

A working in-app alert does **not** prove background push works.

## What the warning meant

"The one-time staff push SQL setup has not been applied yet" is a blanket message from older website code. It was shown for any failure mentioning the push table, even when the table existed. On this branch it is replaced by specific messages (missing table, outdated columns, permission/RLS, expired session, notification permission, service worker, push key, Edge Function/secrets).

The readiness check marks `preferred_language` "OPTIONAL — NOT CONFIGURED" when that column is missing, nullable, not `text`, or has no `'en'` default. It is optional because the column only controls the language of push text. It is **not** why a subscription save fails, but both fixes are in the same migration. The check now says which of these cases applies.

## 1. Verify a backup first

Supabase Dashboard → your Mirch Masaala project → **Database → Backups**. Confirm a recent recoverable backup exists (or take a dump). The in-app "Download data backup" JSON is not a database backup. If you cannot verify one, stop.

## 2. Run exactly one SQL file

Copy the whole of `supabase/staff-push-notifications.sql` into **SQL Editor → New query** and click **Run**.

- Prerequisites `role-notifications.sql`, `setup-live.sql` and the visit migrations are already READY per your check. Do **not** rerun them.
- It never drops tables or deletes rows. It adds missing columns, normalises `preferred_language` (anything other than `en`/`mr` becomes `en`), re-creates the own-subscription RLS policy, and adds `mm_register_staff_push_subscription`, which lets a phone previously used by another staff login be re-enrolled safely.
- Safe to re-run.
- Success: **Success. No rows returned**. Any error: stop, copy the full text, and do not run reset/erase functions. The migration runs in one transaction, so a failure changes nothing.

## 3. Re-run the readiness check

Run `supabase/app-readiness-check.sql`. Every row containing "push" or "guest waiter-call" must read **READY**:

- Staff push subscription table
- Push language preference column/default
- Push dispatch columns on notifications
- Staff push subscription row-level security and own-subscription policy
- Guest waiter-call / bill-request RPC with push dispatch tokens
- Staff push device registration RPC

## 4. Deploy the Edge Function

Deploy `supabase/functions/send-staff-push/index.ts` as the function named `send-staff-push`.

- Dashboard: **Edge Functions → send-staff-push → Code**, paste the file, **Deploy**.
- Or CLI: `supabase functions deploy send-staff-push --project-ref <your-project-ref> --no-verify-jwt`
- **Verify JWT with legacy secret: OFF for this function only.** The site uses a modern publishable key, and the function does its own checks: exact `Origin` match, a notification ID plus one-time token, a 2-minute freshness window, and unresolved/unsent rows only. Do not remove those checks.

## 5. Secrets (Edge Functions → Secrets)

| Name | Value |
| --- | --- |
| `VAPID_PUBLIC_KEY` | `BCGV3-RIkNT5dJfV96yuWS61iZe5Zf85s8CJWBgq-Q_pGJWCLEkMD-91IB7yvsZ6Z0mGebJCohhVJmUHcuNW1E0` (same as in `supabase-live.js`) |
| `VAPID_PRIVATE_KEY` | The private key of that same pair, from your locally saved VAPID file. Never commit, paste in chat, or screenshot it. |
| `VAPID_SUBJECT` | `https://bhadeonkar-cmyk.github.io/mirch-masaala/` (or `mailto:you@example.com`) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase. Never put the service-role key in the website or GitHub.

**If you do not have the matching private key:** generate a new pair with `npx web-push generate-vapid-keys`. Put the new private key in Supabase Secrets, set `VAPID_PUBLIC_KEY` to the new public key, and replace `WEB_PUSH_VAPID_PUBLIC_KEY` in `supabase-live.js`. Existing phone subscriptions were bound to the old public key and stop working. Each staff phone must tap Alert options once more, and the site detects the old subscription and replaces it. Nothing in the database needs to be deleted.

Public and private keys must be a pair. A mismatch gives push-service errors (usually 401/403) in the function logs.

## 6. Enable alerts on each staff phone

- **Android**: open the live site in Chrome, sign in as Owner/Admin, Waiter or Kitchen.
- **iPhone/iPad**: Safari → Share → **Add to Home Screen**, open from the new icon (iOS/iPadOS 16.4+).
- Tap the bell / **Alert options** and allow notifications. Waiters should have their name/staff code selected first. Set the language before enabling; changing it later updates the saved push language automatically.
- Phone shared by two logins: sign in as the new person and enable again. The phone is re-enrolled for them, and only one login receives alerts per phone.

## 7. Test (no real orders or payments)

1. Keep one staff screen open and confirm the in-app Alerts feed works.
2. On a customer phone, open a table QR, tap **Call waiter**. Lock the waiter's phone. Expect "WAITER NEEDED · TABLE nn" (or Marathi).
3. Tap **Request bill**. Expect waiter and owner/admin notifications.
4. Tapping twice within 30 seconds reuses the open alert, so no duplicate push.
5. Check **Edge Functions → send-staff-push → Logs**.

## 8. Troubleshooting

The browser console (`[Mirch Masaala push setup]`) shows the stage, error code and name. It never logs tokens, keys or subscription data.

| Message / symptom | Meaning and action |
| --- | --- |
| Staff push table not found (`PGRST205`, `42P01`) | Run step 2. If just run, wait a minute for the schema cache. |
| Table/columns out of date (`PGRST204`, `42703`) | Run step 2, then step 3. |
| Permission refused (`42501`) | Wrong or no staff role for this login, or an old database without the re-enrol RPC. Sign out/in; run step 2. |
| Staff session missing or expired | Sign out, sign in, enable again. |
| Notification permission denied | Enable notifications in phone/browser settings. |
| Service worker could not start | `service-worker.js` must be reachable at the site URL. |
| Browser rejected the push key | The website key is not a valid public key. Confirm key values (step 5). |
| Console: Edge Function missing (404) | Deploy step 4. |
| Console: sender configuration incomplete (503) | Missing a VAPID secret. |
| Console: origin/token rejected (403) | Request not from `https://bhadeonkar-cmyk.github.io`, or token already used or older than 2 minutes. |
| Function returns `sent: 0` | No subscription for that role, a waiter staff-code mismatch, or a used/expired token. |
| `failed` > 0 | Function logs show push-service status. 404/410 subscriptions are removed automatically; that phone must enable alerts again. 401/403 usually means mismatched VAPID keys. |

**Failed dispatch note:** the one-time token is redeemed before sending, so a push that fails for every device is not retried automatically. The in-app alert stays visible. This prevents duplicate pushes.

## Security notes

- Pushes contain only a minimal alert: table number and event type. No guest names, dish lists or totals.
- Subscriptions are bound to the signed-in staff user and role taken from the database, never from client input. Public devices cannot read or write subscriptions.
- Never weaken RLS or remove the one-time token checks to make push work.
