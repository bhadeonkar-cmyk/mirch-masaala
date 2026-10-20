# Mirch Masaala customer reviews and special notifications

## Enable shared in-app reviews and Google Reviews

1. Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/adbhxldsqwsyaqzdmxnf/sql/new).
2. Re-run `supabase/restaurant-config.sql` (the script is idempotent and now adds the shared Google Reviews URL field).
3. Run the entire `supabase/restaurant-feedback.sql` file. A successful run may say `Success. No rows returned`.
4. In the live app, sign in as Owner/Admin → Settings. Paste the restaurant's HTTPS Google review link into **Google Reviews link**, then click **Save settings**.
5. Customers will see **Reviews & feedback** on the home screen. They can submit a star rating and comment in the app, or open the separate Google review link.
6. In Owner/Admin → Reviews, review each in-app submission. Select **Approve & publish** to show it publicly, or **Hide review** to remove it from the public list.

New in-app reviews start as pending and are not visible publicly until approved. The Google review link opens Google's own review page; a Google review is separate from the in-app review.

## Enable special WhatsApp notifications for registered customers

The owner broadcast composer already supports custom announcement and offer messages. To send them:

1. Run `supabase/whatsapp-crm.sql` in the Supabase SQL Editor if it has not already been applied.
2. Follow `supabase/WHATSAPP_SETUP.md` to deploy the `send-whatsapp-broadcast` and `whatsapp-webhook` Edge Functions and configure Meta WhatsApp Business Platform secrets/templates.
3. Customers must register their phone number and explicitly opt in to the selected message category.
4. Sign in as Owner/Admin → More tools → **WhatsApp & Customers**. Choose the category, edit the message, preview the audience and confirm sending.

Announcements and special offers are sent only to registered customers who opted in to that category. Actual delivery requires the official WhatsApp Business Platform configuration; saving text or seeing a recipient list alone does not mean a message has been sent. Broadcasts are logged with sent/failed counts, and customers can opt out.
