import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DispatchPayload {
  delivery_log_id: string;
  endpoint_url: string;
  timeout_seconds: number;
  retry_policy: {
    max_attempts: number;
    base_delay_seconds: number;
    max_delay_seconds: number;
    backoff_multiplier: number;
  };
}

async function signPayload(payload: unknown, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify(payload)));
  return "sha256=" + Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
}

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
    const payload: DispatchPayload = await req.json();

    const { data: deliveryLog, error: logError } = await supabase
      .from("webhook_delivery_log")
      .select("*, webhook_endpoint:webhook_endpoint_id(*)")
      .eq("delivery_log_id", payload.delivery_log_id)
      .single();

    if (logError || !deliveryLog) {
      return new Response(JSON.stringify({ error: "Delivery log not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const endpoint = deliveryLog.webhook_endpoint;
    if (!endpoint || !endpoint.is_active) {
      return new Response(JSON.stringify({ error: "Endpoint not active" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const attempt = deliveryLog.attempt_number;
    const maxAttempts = endpoint.retry_policy?.max_attempts ?? 5;

    // Mark as processing
    await supabase
      .from("webhook_delivery_log")
      .update({
        status: "processing",
        attempt_count: attempt + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("delivery_log_id", payload.delivery_log_id);

    const startTime = Date.now();
    let response: Response;
    let responseBody: string;
    let responseStatus: number;
    let status: "success" | "failed" | "timeout" = "failed";
    let errorMessage: string | null = null;

    try {
      const signature = await signPayload(deliveryLog.request_payload, endpoint.secret_key);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": deliveryLog.request_payload?.event_type ?? "unknown",
        "X-Webhook-ID": deliveryLog.outbox_event_id,
        "X-Webhook-Timestamp": Math.floor(Date.now() / 1000).toString(),
        "User-Agent": "Akasha-Outdoor-Webhook/1.0",
        ...endpoint.headers,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), (endpoint.timeout_seconds ?? 30) * 1000);

      response = await fetch(endpoint.endpoint_url, {
        method: "POST",
        headers,
        body: JSON.stringify(deliveryLog.request_payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      responseBody = await response.text();
      responseStatus = response.status;

      if (response.ok) {
        status = "success";
      } else {
        status = "failed";
        errorMessage = `HTTP ${responseStatus}: ${responseBody}`;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        status = "timeout";
        errorMessage = `Request timeout after ${endpoint.timeout_seconds ?? 30}s`;
      } else {
        status = "failed";
        errorMessage = err instanceof Error ? err.message : "Unknown error";
      }
    }

    const durationMs = Date.now() - startTime;
    const isLastAttempt = attempt + 1 >= maxAttempts;
    const retryPolicy = endpoint.retry_policy ?? {
      max_attempts: 5,
      base_delay_seconds: 60,
      max_delay_seconds: 3600,
      backoff_multiplier: 2,
    };

    const nextRetryAt = !isLastAttempt && status !== "success"
      ? new Date(Date.now() + Math.min(
          retryPolicy.base_delay_seconds * Math.pow(retryPolicy.backoff_multiplier, attempt),
          retryPolicy.max_delay_seconds
        ) * 1000).toISOString()
      : null;

    await supabase
      .from("webhook_delivery_log")
      .update({
        attempt_number: attempt + 1,
        response_status: responseStatus,
        response_body: responseBody,
        duration_ms: durationMs,
        status,
        error_message: errorMessage,
        next_retry_at: nextRetryAt,
        completed_at: status === "success" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("delivery_log_id", payload.delivery_log_id);

    if (status === "success") {
      await supabase
        .from("webhook_endpoint")
        .update({
          last_triggered_at: new Date().toISOString(),
          last_status: "success",
          last_error: null,
          consecutive_failures: 0,
        })
        .eq("webhook_endpoint_id", endpoint.webhook_endpoint_id);
    } else if (isLastAttempt) {
      await supabase
        .from("webhook_endpoint")
        .update({
          last_triggered_at: new Date().toISOString(),
          last_status: "failed",
          last_error: errorMessage,
          consecutive_failures: (endpoint.consecutive_failures ?? 0) + 1,
        })
        .eq("webhook_endpoint_id", endpoint.webhook_endpoint_id);
    }

    return new Response(JSON.stringify({
      success: status === "success",
      delivery_log_id: payload.delivery_log_id,
      status,
      attempt: attempt + 1,
      duration_ms: durationMs,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Webhook Dispatcher Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});