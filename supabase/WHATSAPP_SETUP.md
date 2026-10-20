# Mirch Masaala WhatsApp setup

The website UI is committed, but actual WhatsApp delivery remains off until this setup is completed. Never put Meta access tokens or the Supabase service-role key into index.html, browser JavaScript, or GitHub.

## 1. Add the shared customer tables

Open the Supabase SQL Editor for project adbhxldsqwsyaqzdmxnf and run the full contents of supabase/whatsapp-crm.sql. This creates the consent fields, owner settings, broadcast history, customer-save RPC, and admin opt-out RPC.

## 2. Deploy the Edge Functions

From a terminal with the Supabase CLI installed, run:

    supabase login
    supabase link --project-ref adbhxldsqwsyaqzdmxnf
    supabase functions deploy send-whatsapp-broadcast
    supabase functions deploy whatsapp-webhook --no-verify-jwt

The webhook must allow Meta's unauthenticated requests, so its handler validates Meta's HMAC signature before processing POST events. Do not deploy the broadcast function with JWT verification disabled.

## 3. Create approved templates and set secrets

Create and approve two WhatsApp Business Platform templates first. Both templates must have two body text placeholders: customer name as {{1}} and broadcast text as {{2}}. Add an opt-out instruction to your approved templates, such as asking customers to reply STOP. The webhook handles STOP, UNSUBSCRIBE, STOP ALL, CANCEL, and OPT OUT replies.

Run this command in your own terminal, replacing every example value with the values from your Meta developer/WhatsApp Business account:

    supabase secrets set WHATSAPP_ACCESS_TOKEN='PASTE_TOKEN_IN_YOUR_TERMINAL' WHATSAPP_PHONE_NUMBER_ID='YOUR_PHONE_NUMBER_ID' WHATSAPP_GRAPH_API_VERSION='vXX.X' WHATSAPP_TEMPLATE_LANGUAGE='en' WHATSAPP_ORDER_UPDATES_TEMPLATE='approved_order_update_template' WHATSAPP_MARKETING_TEMPLATE='approved_marketing_template' WHATSAPP_WEBHOOK_VERIFY_TOKEN='MAKE_A_LONG_RANDOM_VALUE' WHATSAPP_META_APP_SECRET='YOUR_META_APP_SECRET'

Never paste these secrets into ChatGPT or a source file. Choose the current supported Graph API version in Meta's official documentation and use the exact approved template language code. If the two templates use different languages, adjust the function configuration before sending.

## 4. Configure the Meta webhook

Use this webhook URL in Meta's WhatsApp/Developer settings:

    https://adbhxldsqwsyaqzdmxnf.supabase.co/functions/v1/whatsapp-webhook

Use the same WHATSAPP_WEBHOOK_VERIFY_TOKEN value from step 3 and subscribe to WhatsApp message events. The Meta app must have the matching app secret so incoming webhook signatures can be verified.

## Safety behaviour

- The broadcast function verifies that the signed-in user has the Owner/Admin role.
- It sends only to phone numbers with consent for the selected category.
- Order/service-update consent and news/offer consent are stored separately.
- The owner can use Stop all WhatsApp messages in the customer list.
- STOP-like replies disable both WhatsApp consent categories.
- The sender caps each run at 500 recipients to avoid a long-running request.
- API acceptance is not a guarantee that the recipient read a message. Provider charges, limits, and approved template requirements still apply.