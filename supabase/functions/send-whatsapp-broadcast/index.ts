import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};
const RESTAURANT_ID = "a3702d10-6673-4c06-9783-1d61c945ecd5";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function normaliseIndianPhone(phone: string) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(-10);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(-10);
  return /^[6-9]\d{9}$/.test(digits) ? "91" + digits : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { error: "Owner sign-in required." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceKey) return json(503, { error: "Supabase server configuration is incomplete." });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const userResult = await userClient.auth.getUser();
  if (userResult.error || !userResult.data.user) return json(401, { error: "Your staff session has expired. Sign in again." });
  const roleResult = await userClient.rpc("get_my_staff_role");
  if (roleResult.error || roleResult.data !== "admin") return json(403, { error: "Only the owner/admin can send a broadcast." });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid request." }); }
  const category = String(body.category || "");
  const message = String(body.message || "").trim();
  if (!["order_updates", "announcement", "offer"].includes(category)) return json(400, { error: "Choose a valid message category." });
  if (message.length < 3 || message.length > 900) return json(400, { error: "Message must contain 3–900 characters." });

  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
  const apiVersion = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") || "";
  const language = Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE") || "en";
  const templateName = category === "order_updates"
    ? (Deno.env.get("WHATSAPP_ORDER_UPDATES_TEMPLATE") || "")
    : (Deno.env.get("WHATSAPP_MARKETING_TEMPLATE") || "");
  if (!accessToken || !phoneNumberId || !apiVersion || !templateName) {
    return json(503, {
      error: "WhatsApp sending is not configured yet. Add the Meta Cloud API token, sender phone-number ID, API version, language, and approved templates as Supabase Function secrets."
    });
  }
  if (!/^v\d+\.\d+$/.test(apiVersion)) return json(503, { error: "WHATSAPP_GRAPH_API_VERSION must look like vXX.X." });

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const consentColumn = category === "order_updates" ? "wa_order_updates" : "wa_marketing_opt_in";
  const { data: recipients, error: recipientError } = await serviceClient
    .from("mm_customer_profiles")
    .select("phone,name")
    .eq("restaurant_id", RESTAURANT_ID)
    .eq(consentColumn, true)
    .order("created_at", { ascending: false })
    .limit(500);
  if (recipientError) return json(503, { error: "Could not load the opted-in customer list. Apply the WhatsApp CRM SQL setup and try again." });
  const targets = (recipients || []).map((r: { phone: string; name: string }) => ({
    phone: normaliseIndianPhone(r.phone),
    name: String(r.name || "there").slice(0, 60)
  })).filter((r: { phone: string | null; name: string }) => !!r.phone);
  if (!targets.length) return json(200, { sent_count: 0, failed_count: 0, eligible_count: 0, message: "No customers have opted in to this category." });

  let sent = 0;
  let failed = 0;
  const apiUrl = "https://graph.facebook.com/" + apiVersion + "/" + phoneNumberId + "/messages";
  const failureCodes: string[] = [];
  for (let i = 0; i < targets.length; i += 5) {
    const batch = targets.slice(i, i + 5);
    const results = await Promise.all(batch.map(async (target: { phone: string; name: string }) => {
      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: target.phone,
            type: "template",
            template: {
              name: templateName,
              language: { code: language },
              components: [{
                type: "body",
                parameters: [
                  { type: "text", text: target.name || "there" },
                  { type: "text", text: message }
                ]
              }]
            }
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const code = payload?.error?.code ? String(payload.error.code) : "provider_error";
          failureCodes.push(code);
          return false;
        }
        return true;
      } catch {
        failureCodes.push("network_error");
        return false;
      }
    }));
    results.forEach((ok) => { if (ok) sent++; else failed++; });
  }

  const logResult = await serviceClient.from("mm_whatsapp_broadcast_logs").insert({
    restaurant_id: RESTAURANT_ID,
    sent_by: userResult.data.user.id,
    category,
    message,
    eligible_count: targets.length,
    attempted_count: targets.length,
    sent_count: sent,
    failed_count: failed,
    provider_status: failed === 0 ? "completed" : sent === 0 ? "failed" : "partial"
  });
  if (logResult.error) console.error("[WhatsApp broadcast] Could not write history log:", logResult.error.message);

  return json(200, {
    eligible_count: targets.length,
    attempted_count: targets.length,
    sent_count: sent,
    failed_count: failed,
    provider_status: failed === 0 ? "completed" : sent === 0 ? "failed" : "partial",
    note: targets.length === 500 ? "Broadcasts are capped at 500 recipients per run." : undefined
  });
});
