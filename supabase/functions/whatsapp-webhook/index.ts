import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESTAURANT_ID = "a3702d10-6673-4c06-9783-1d61c945ecd5";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
function textResponse(status: number, text: string) {
  return new Response(text, { status, headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" } });
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function verifySignature(rawBody: string, signatureHeader: string, appSecret: string) {
  if (!signatureHeader.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return hex(signature) === signatureHeader.slice(7).toLowerCase();
}
function normalizePhone(value: string) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(-10);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(-10);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}
function isOptOut(text: string) {
  const v = String(text || "").trim().toUpperCase().replace(/[.! ]+$/g, "");
  return ["STOP", "UNSUBSCRIBE", "STOP ALL", "CANCEL", "OPT OUT", "OPTOUT"].includes(v);
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") || "";
    if (mode === "subscribe" && expected && token === expected && challenge) return textResponse(200, challenge);
    return textResponse(403, "Webhook verification failed");
  }
  if (req.method !== "POST") return textResponse(405, "Method not allowed");

  const appSecret = Deno.env.get("WHATSAPP_META_APP_SECRET") || "";
  const signature = req.headers.get("x-hub-signature-256") || "";
  const rawBody = await req.text();
  if (!appSecret || !await verifySignature(rawBody, signature, appSecret)) return textResponse(401, "Invalid signature");

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return textResponse(400, "Invalid JSON"); }
  const messages: any[] = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      for (const msg of change?.value?.messages || []) messages.push(msg);
    }
  }
  if (!messages.length) return textResponse(200, "OK");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return textResponse(503, "Supabase server configuration is incomplete");
  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  for (const msg of messages) {
    const bodyText = msg?.type === "text" ? String(msg?.text?.body || "") : "";
    if (!isOptOut(bodyText)) continue;
    const phone = normalizePhone(String(msg?.from || ""));
    if (!phone) continue;
    const updateResult = await serviceClient.from("mm_customer_profiles")
      .update({
        wa_order_updates: false,
        wa_marketing_opt_in: false,
        wa_order_updates_consent_at: null,
        wa_marketing_consent_at: null,
        consent_updated_at: new Date().toISOString()
      })
      .eq("restaurant_id", RESTAURANT_ID)
      .eq("phone", phone);
    if (updateResult.error) console.error("[WhatsApp webhook] Could not process opt-out:", updateResult.error.message);
  }
  return textResponse(200, "OK");
});
