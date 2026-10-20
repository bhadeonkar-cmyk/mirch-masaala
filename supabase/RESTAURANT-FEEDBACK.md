# Mirch Masaala customer reviews, live order board, and special notifications

## Enable public reviews, owner moderation, and the customer-facing order board

1. Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/adbhxldsqwsyaqzdmxnf/sql/new).
2. Run the entire `supabase/restaurant-feedback.sql` file. It is safe to re-run. A successful run may say `Success. No rows returned`.
3. In the live app, sign in as Owner/Admin → Settings. Paste the restaurant's HTTPS Google Reviews URL into **Google Reviews link**, then click **Save settings**.
4. Guests can read published in-app reviews from the home page. New in-app reviews are published immediately. In Owner/Admin → Reviews, use **Hide review** to remove a comment from public view or **Delete permanently** to delete it.
5. The post-payment follow-up includes a small Google review link, using the URL saved in Owner/Admin → Settings.
6. A corner status board shows current **PREPARING** and **READY** orders. It displays only table/order labels and status—not guest details, order items, notes, totals, or private order tokens.

The public status board uses a secure, read-only RPC added by `restaurant-feedback.sql`. Only PREPARING/READY tickets from the last four hours are eligible for the board.

## Counter and kitchen screens

Open the same live app on each phone, tablet, or PC. Sign in on counter devices with the authorised Waiter Pad or Owner/Admin account, and sign in on the kitchen device with the Kitchen account. Orders are stored in Supabase and staff status changes sync across devices. Waiters can switch tables while keeping a separate in-progress cart for each table, and every waiter device sees the shared live order queue. The kitchen screen uses columns on desktop and a stacked layout on mobile.

## Enable special WhatsApp notifications for registered customers

1. Run `supabase/whatsapp-crm.sql` in the Supabase SQL Editor if it has not already been applied.
2. Follow `supabase/WHATSAPP_SETUP.md` to deploy the `send-whatsapp-broadcast` and `whatsapp-webhook` Edge Functions and configure Meta WhatsApp Business Platform secrets/templates.
3. Customers must register their phone number and explicitly opt in to the selected message category.
4. Sign in as Owner/Admin → More tools → **WhatsApp & Customers**. Choose the category, edit the message, preview the audience and confirm sending.

Announcements and special offers are sent only to registered customers who opted in to that category. Actual delivery requires the official WhatsApp Business Platform configuration; saving text or seeing a recipient list alone does not mean a message has been sent. Broadcasts are logged with sent/failed counts, and customers can opt out.
