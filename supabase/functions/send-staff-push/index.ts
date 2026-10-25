import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const RESTAURANT_ID = "a3702d10-6673-4c06-9783-1d61c945ecd5";
const SITE_ROOT = "https://bhadeonkar-cmyk.github.io/mirch-masaala/";
const ALLOWED_ORIGIN = "https://bhadeonkar-cmyk.github.io";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}

function makeMessage(row: Record<string, unknown>, role: string, language = "en") {
  const type = String(row.notification_type || "").toUpperCase();
  const table = String(row.table_number || "").padStart(2, "0");
  const pathRole = ["waiter", "kitchen", "admin"].includes(role) ? role : "waiter";
  let title = "Mirch Masaala";
  let body = String(row.message || "A restaurant update needs your attention.");
  if (type === "ORDER_APPROVAL") {
    title = "NEW ORDER · OWNER APPROVAL REQUIRED · TABLE " + table;
    body = String(row.message || "A customer order is waiting for your approval.");
  } else if (type === "CASH_AT_COUNTER") {
    title = "CASH AT COUNTER · TABLE " + table;
    body = String(row.message || "A guest is leaving and will pay cash at the counter. Please collect the payment.");
  } else if (type === "GUEST_LEFT_UNPAID") {
    title = "GUEST LEFT · BALANCE DUE · TABLE " + table;
    body = String(row.message || "Guests have left before checkout. Please collect the outstanding balance from the original visit.");
  } else if (type === "PAYMENT_CHECK") {
    title = "PAYMENT VERIFICATION · TABLE " + table;
    body = String(row.message || "A guest says they paid. Please verify the transaction before recording payment.");
  } else if (type === "PARTY_BOOKING") {
    title = "NEW PARTY BOOKING REQUEST";
    body = String(row.message || "A new party booking request needs your attention.");
  } else if (type === "WAITER_CALL") {
    title = "WAITER NEEDED · TABLE " + table;
    body = "A guest is waiting. Please go to Table " + table + " now.";
  } else if (type === "BILL_REQUEST") {
    title = "BILL REQUEST · TABLE " + table;
    body = "Please attend the bill request at Table " + table + ".";
  } else if (type === "NEW_ORDER") {
    title = "NEW ORDER · TABLE " + table;
    body = "A new kitchen ticket has arrived for Table " + table + ".";
  } else if (type === "ORDER_READY") {
    title = "ORDER READY · TABLE " + table;
    body = "Please check the ready ticket at Table " + table + ".";
  } else if (type === "ITEM_SOLD_OUT") {
    title = "MENU AVAILABILITY UPDATE";
    body = String(row.item_name || row.message || "Kitchen changed menu availability.");
  }
  if (String(language || "en").toLowerCase() === "mr") {
    // Translate by stable event type, not by whichever customer's language created it.
    // This keeps one shared notification record readable to each staff member locally.
    if (type === "ORDER_APPROVAL") {
      title = "नवीन ऑर्डर · मालकांची मंजुरी आवश्यक · टेबल " + table;
      body = "ग्राहकाची ऑर्डर मंजुरीसाठी प्रतीक्षेत आहे.";
    } else if (type === "CASH_AT_COUNTER") {
      title = "काउंटरवर रोख पैसे · टेबल " + table;
      body = "ग्राहक काउंटरवर रोख रक्कम देणार आहे. कृपया पैसे स्वीकारा.";
    } else if (type === "GUEST_LEFT_UNPAID") {
      title = "ग्राहक बिल न भरता निघून गेला · टेबल " + table;
      body = "मूळ टेबल भेटीची बाकी रक्कम तपासून वसूल करा.";
    } else if (type === "PAYMENT_CHECK") {
      title = "पेमेंट तपासा · टेबल " + table;
      body = "ग्राहकाने पेमेंट केल्याचे सांगितले आहे. नोंद करण्यापूर्वी व्यवहार तपासा.";
    } else if (type === "PARTY_BOOKING") {
      title = "कार्यक्रम बुकिंगची नवीन विनंती";
      body = "कार्यक्रम बुकिंगची नवीन विनंती आली आहे.";
    } else if (type === "WAITER_CALL") {
      title = "वेटर हवा · टेबल " + table;
      body = "ग्राहक वाट पाहत आहे. कृपया लगेच टेबल " + table + " वर जा.";
    } else if (type === "BILL_REQUEST") {
      title = "बिलाची विनंती · टेबल " + table;
      body = "कृपया टेबल " + table + " वरील बिलाची विनंती हाताळा.";
    } else if (type === "NEW_ORDER") {
      title = "नवीन ऑर्डर · टेबल " + table;
      body = "टेबल " + table + " साठी किचनमध्ये नवीन ऑर्डर आली आहे.";
    } else if (type === "ORDER_READY") {
      title = "ऑर्डर तयार · टेबल " + table;
      body = "टेबल " + table + " वरील तयार ऑर्डर तपासा.";
    } else if (type === "ITEM_SOLD_OUT") {
      title = "मेनू उपलब्धतेतील बदल";
      body = String(row.item_name || "").trim()
        ? String(row.item_name) + " सध्या उपलब्ध नाही."
        : "किचनने पदार्थाची उपलब्धता बदलली आहे.";
    }
  }

  return {
    title,
    body,
    role: pathRole,
    url: SITE_ROOT + "?staff=" + encodeURIComponent(pathRole),
    tag: "mm-alert-" + String(row.id || "") + "-" + pathRole,
    requireInteraction: type === "WAITER_CALL" || type === "BILL_REQUEST" || type === "PAYMENT_CHECK" || type === "CASH_AT_COUNTER" || type === "GUEST_LEFT_UNPAID"
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json(405, { error: "POST required." });

  const origin = req.headers.get("origin");
  if (origin !== ALLOWED_ORIGIN) return json(403, { error: "Origin not allowed." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || SITE_ROOT;
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return json(503, { error: "Push sender secrets are not configured in Supabase." });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request JSON." }); }
  const rawIds = Array.isArray(body.notification_ids) ? body.notification_ids : [];
  const ids = [...new Set(rawIds.map((x) => Number(x)).filter((x) => Number.isSafeInteger(x) && x > 0))].slice(0, 10);
  const dispatchTokens = Array.isArray(body.dispatch_tokens) ? body.dispatch_tokens : [];
  if (!ids.length || !dispatchTokens.length) {
    return json(400, { error: "A fresh notification ID and dispatch token are required." });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Limit public dispatch to fresh guest requests with a matching one-time token.
  const recentCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const candidates = await admin.from("mm_restaurant_notifications")
    .select("id, target_role, notification_type, table_number, ticket_id, item_name, message, target_staff_code, push_dispatch_token")
    .eq("restaurant_id", RESTAURANT_ID)
    .in("id", ids)
    .in("notification_type", ["WAITER_CALL", "BILL_REQUEST", "PARTY_BOOKING", "PAYMENT_CHECK", "CASH_AT_COUNTER", "GUEST_LEFT_UNPAID", "ORDER_APPROVAL"])
    .is("push_sent_at", null)
    .is("resolved_at", null)
    .gt("created_at", recentCutoff);

  if (candidates.error) {
    console.error("[send-staff-push] Could not read eligible notification:", candidates.error.message);
    return json(500, { error: "Could not load recent staff notifications." });
  }

  const rows: Record<string, unknown>[] = [];
  for (const row of (candidates.data || []) as Record<string, unknown>[]) {
    const supplied = dispatchTokens.find((pair: Record<string, unknown>) =>
      Number(pair.id) === Number(row.id) &&
      String(pair.token || "") === String(row.push_dispatch_token || "")
    );
    if (!supplied) continue;

    const claimed = await admin.from("mm_restaurant_notifications")
      .update({ push_sent_at: new Date().toISOString(), push_dispatch_token: null })
      .eq("restaurant_id", RESTAURANT_ID)
      .eq("id", Number(row.id))
      .eq("push_dispatch_token", String(supplied.token))
      .is("push_sent_at", null)
      .is("resolved_at", null)
      .gt("created_at", recentCutoff)
      .select("id, target_role, notification_type, table_number, ticket_id, item_name, message, target_staff_code")
      .maybeSingle();

    if (claimed.error) {
      console.error("[send-staff-push] Could not redeem dispatch token:", claimed.error.message);
      return json(500, { error: "Could not redeem the push request." });
    }
    if (claimed.data) rows.push(claimed.data as Record<string, unknown>);
  }

  if (!rows.length) {
    return json(200, { sent: 0, message: "No new eligible notification. The token may be expired or already used." });
  }

  const roles = [...new Set(rows.map((r: Record<string, unknown>) => String(r.target_role || "")))];
  const subsResult = await admin.from("mm_staff_push_subscriptions")
    .select("id, target_role, staff_code, endpoint, subscription, preferred_language")
    .in("target_role", roles);

  if (subsResult.error) {
    console.error("[send-staff-push] Could not load device subscriptions:", subsResult.error.message);
    return json(500, { error: "Push subscription table is not ready." });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  let sent = 0;
  let failed = 0;
  const subscriptions = subsResult.data || [];

  for (const row of rows) {
    const assignedCode = String(row.target_staff_code || "").trim().toUpperCase();
    const target = subscriptions.filter((sub: Record<string, unknown>) =>
      String(sub.target_role) === String(row.target_role) &&
      (!assignedCode || String(row.target_role) !== "waiter" ||
        String(sub.staff_code || "").trim().toUpperCase() === assignedCode)
    );
    for (const sub of target) {
      const payload = JSON.stringify(makeMessage(
        row as Record<string, unknown>,
        String(row.target_role || "waiter"),
        String(sub.preferred_language || "en")
      ));
      try {
        await webpush.sendNotification(
          sub.subscription as Record<string, unknown>,
          payload,
          {
            TTL: 120,
            urgency: String(row.notification_type) === "WAITER_CALL" ? "high" : "normal"
          }
        );
        sent++;
      } catch (e) {
        failed++;
        const statusCode = Number((e as { statusCode?: number })?.statusCode || 0);
        const endpoint = String(sub.endpoint || "");
        console.warn("[send-staff-push] Delivery failed:", statusCode || "unknown");
        if ((statusCode === 404 || statusCode === 410) && endpoint) {
          await admin.from("mm_staff_push_subscriptions").delete().eq("endpoint", endpoint);
        }
      }
    }
  }

  return json(200, { notifications: rows.length, devices: subscriptions.length, sent, failed });
});
