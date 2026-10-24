import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Missing server configuration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 200);

    const { data: deliveries, error } = await supabase.rpc("get_webhook_retries_ready", { p_limit: limit });

    if (error) {
      throw error;
    }

    if (!deliveries || deliveries.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    for (const delivery of deliveries) {
      await fetch(`${supabaseUrl}/functions/v1/webhook-dispatcher`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          delivery_log_id: delivery.delivery_log_id,
          endpoint_url: delivery.webhook_endpoint.endpoint_url,
          timeout_seconds: delivery.webhook_endpoint.timeout_seconds ?? 30,
          retry_policy: delivery.webhook_endpoint.retry_policy ?? {
            max_attempts: 5,
            base_delay_seconds: 60,
            max_delay_seconds: 3600,
            backoff_multiplier: 2,
          },
        }),
      });
      processed++;
    }

    return new Response(JSON.stringify({ success: true, processed }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Webhook Retry Processor Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});