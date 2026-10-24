import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

function json(data: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function isInternalAuthorized(req: Request, supabase: ReturnType<typeof createClient>): Promise<boolean> {
  const token = req.headers.get("x-internal-token");
  if (!token || token.length < 32) return false;
  const { data, error } = await supabase.rpc("verify_internal_trigger_token", { p_token: token });
  return !error && data === true;
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;
  const [a,b] = parts.map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19));
}

function isSafeWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (u.protocol !== "https:" || u.username || u.password) return false;
    if (u.port && u.port !== "443") return false;
    if (!host || host === "localhost" || host === "metadata" ||
      host === "metadata.google.internal" ||
      host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".svc") ||
      host.endsWith(".cluster.local")) return false;
    if (host.includes(":")) return false; // Reject IPv6 literals by default.
    if (isPrivateIpv4(host)) return false;
    const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    if (isIpv4) return true; // private/reserved ranges are rejected above
    if (!host.includes(".")) return false;
    const labels = host.split(".");
    if (labels.some(label => !label || label.length > 63 ||
      !/^[a-z0-9-]+$/.test(label) || label.startsWith("-") || label.endsWith("-"))) return false;
    return true;
  } catch {
    return false;
  }
}

function signature(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  ).then(async key => {
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    return "sha256=" + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Server configuration missing" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    if (!await isInternalAuthorized(req, supabase)) return json({ error: "Unauthorized" }, 401);

    const incoming = await req.json().catch(() => null) as JsonObject | null;
    if (!incoming) return json({ error: "Invalid JSON payload" }, 400);

    const record = (incoming.record && typeof incoming.record === "object" ? incoming.record : {}) as JsonObject;
    const deliveryId = String(incoming.delivery_log_id ?? record.delivery_log_id ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deliveryId)) {
      return json({ error: "delivery_log_id is required" }, 400);
    }

    const { data: log, error: logError } = await supabase
      .from("webhook_delivery_log").select("*").eq("delivery_log_id", deliveryId).maybeSingle();
    if (logError) throw logError;
    if (!log) return json({ error: "Delivery log not found" }, 404);
    if (log.status === "success") return json({ success: true, skipped: true, reason: "already_delivered" });
    if (log.status === "processing" && log.updated_at &&
        Date.now() - Date.parse(log.updated_at) < 10 * 60 * 1000) {
      return json({ success: true, skipped: true, reason: "already_claimed" }, 409);
    }

    const { data: endpoint, error: endpointError } = await supabase
      .from("webhook_endpoint").select("*")
      .eq("webhook_endpoint_id", log.webhook_endpoint_id).maybeSingle();
    if (endpointError) throw endpointError;

    if (!endpoint || !endpoint.is_active) {
      await supabase.from("webhook_delivery_log").update({
        status: "failed", next_retry_at: null, completed_at: new Date().toISOString(),
        error_message: "Webhook endpoint is missing or inactive", updated_at: new Date().toISOString(),
      }).eq("delivery_log_id", deliveryId);
      return json({ success: false, status: "failed", reason: "endpoint_inactive" });
    }

    if (!isSafeWebhookUrl(String(endpoint.endpoint_url ?? ""))) {
      await supabase.from("webhook_delivery_log").update({
        status: "failed", next_retry_at: null, completed_at: new Date().toISOString(),
        error_message: "Endpoint URL rejected by outbound URL policy; use a public HTTPS endpoint on port 443",
        updated_at: new Date().toISOString(),
      }).eq("delivery_log_id", deliveryId);
      await supabase.from("webhook_endpoint").update({
        last_triggered_at: new Date().toISOString(),
        last_status: "failed",
        last_error: "Endpoint URL rejected by outbound URL policy",
      }).eq("webhook_endpoint_id", endpoint.webhook_endpoint_id);
      return json({ success: false, status: "failed", reason: "endpoint_url_rejected" });
    }

    const status = String(log.status);
    const now = new Date();
    if ((status === "failed" || status === "timeout") &&
        (!log.next_retry_at || Date.parse(log.next_retry_at) > now.getTime())) {
      return json({ success: true, skipped: true, reason: "retry_not_due" }, 409);
    }
    if (!["queued", "pending", "failed", "timeout", "processing"].includes(status)) {
      return json({ success: true, skipped: true, reason: "unsupported_status" }, 409);
    }

    const currentAttempt = (status === "failed" || status === "timeout" ||
      (status === "processing" && log.updated_at &&
       Date.now() - Date.parse(log.updated_at) >= 10 * 60 * 1000))
      ? Number(log.attempt_number ?? 1) + 1
      : Math.max(1, Number(log.attempt_number ?? 1));

    let claim = supabase.from("webhook_delivery_log").update({
      status: "processing", attempt_number: currentAttempt, next_retry_at: null, updated_at: now.toISOString(),
    }).eq("delivery_log_id", deliveryId).eq("status", status);

    if (status === "failed" || status === "timeout") {
      claim = claim.not("next_retry_at", "is", null).lte("next_retry_at", now.toISOString());
    }
    if (status === "processing") {
      const staleBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
      claim = claim.lte("updated_at", staleBefore);
    }
    const { data: claimed, error: claimError } = await claim.select("delivery_log_id").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return json({ success: true, skipped: true, reason: "another_worker_claimed" }, 409);

    const retry = (endpoint.retry_policy ?? {}) as Record<string, unknown>;
    const maxAttempts = Math.min(10, Math.max(1, Number(retry.max_attempts ?? 5)));
    const baseDelay = Math.min(3600, Math.max(1, Number(retry.base_delay_seconds ?? 60)));
    const maxDelay = Math.min(86400, Math.max(1, Number(retry.max_delay_seconds ?? 3600)));
    const multiplier = Math.min(10, Math.max(1, Number(retry.backoff_multiplier ?? 2)));
    const timeoutSeconds = Math.min(30, Math.max(1, Number(endpoint.timeout_seconds ?? 30)));

    const body = JSON.stringify(log.request_payload ?? {});
    const headerTimestamp = String(Math.floor(Date.parse(String((log.request_payload as JsonObject | null)?.timestamp ?? now.toISOString())) / 1000));
    const customHeaders: Record<string, string> = {};
    if (endpoint.headers && typeof endpoint.headers === "object" && !Array.isArray(endpoint.headers)) {
      for (const [key, value] of Object.entries(endpoint.headers as Record<string, unknown>)) {
        const lower = key.toLowerCase();
        if (typeof value === "string" &&
          !["content-type","host","content-length","connection","transfer-encoding","user-agent",
            "x-webhook-signature","x-webhook-event","x-webhook-id","x-webhook-timestamp"].includes(lower)) {
          customHeaders[key] = value;
        }
      }
    }

    let responseStatus: number | null = null;
    let responseBody = "";
    let errorMessage: string | null = null;
    let finalStatus: "success" | "failed" | "timeout" = "failed";
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    try {
      const sig = await signature(body, String(endpoint.secret_key));
      const response = await fetch(String(endpoint.endpoint_url), {
        method: "POST",
        redirect: "manual",
        headers: {
          ...customHeaders,
          "Content-Type": "application/json",
          "X-Webhook-Signature": sig,
          "X-Webhook-Event": String((log.request_payload as JsonObject | null)?.event_type ?? "unknown"),
          "X-Webhook-ID": String(log.outbox_event_id),
          "X-Webhook-Timestamp": headerTimestamp,
          "User-Agent": "Akasha-Outdoor-Webhook/1.0",
        },
        body,
        signal: controller.signal,
      });
      responseStatus = response.status;
      responseBody = (await response.text()).slice(0, 4000);
      if (response.status >= 200 && response.status < 300) {
        finalStatus = "success";
      } else {
        finalStatus = "failed";
        errorMessage = `HTTP ${response.status}: ${responseBody.slice(0, 1000)}`;
      }
    } catch (err) {
      finalStatus = err instanceof DOMException && err.name === "AbortError" ? "timeout" : "failed";
      errorMessage = finalStatus === "timeout"
        ? `Request timeout after ${timeoutSeconds}s`
        : (err instanceof Error ? err.message : "Unknown outbound request error");
    } finally {
      clearTimeout(timer);
    }

    const durationMs = Date.now() - startedAt;
    const retryAt = finalStatus !== "success" && currentAttempt < maxAttempts
      ? new Date(Date.now() + Math.min(baseDelay * Math.pow(multiplier, currentAttempt - 1), maxDelay) * 1000).toISOString()
      : null;
    const completedAt = finalStatus === "success" || retryAt === null ? new Date().toISOString() : null;

    const { error: saveError } = await supabase.from("webhook_delivery_log").update({
      status: finalStatus,
      response_status: responseStatus,
      response_body: responseBody,
      duration_ms: durationMs,
      error_message: errorMessage,
      next_retry_at: retryAt,
      completed_at: completedAt,
      updated_at: new Date().toISOString(),
    }).eq("delivery_log_id", deliveryId).eq("status", "processing");
    if (saveError) throw saveError;

    if (finalStatus === "success") {
      const { error } = await supabase.from("webhook_endpoint").update({
        last_triggered_at: new Date().toISOString(),
        last_status: "success", last_error: null, consecutive_failures: 0,
      }).eq("webhook_endpoint_id", endpoint.webhook_endpoint_id);
      if (error) throw error;
    } else if (retryAt === null) {
      const { error } = await supabase.from("webhook_endpoint").update({
        last_triggered_at: new Date().toISOString(),
        last_status: "failed",
        last_error: errorMessage ?? "Webhook delivery failed",
        consecutive_failures: Number(endpoint.consecutive_failures ?? 0) + 1,
      }).eq("webhook_endpoint_id", endpoint.webhook_endpoint_id);
      if (error) throw error;
    }

    return json({
      success: finalStatus === "success",
      delivery_log_id: deliveryId,
      status: finalStatus,
      attempt: currentAttempt,
      retry_scheduled: retryAt !== null,
      duration_ms: durationMs,
    });
  } catch (error) {
    console.error("Webhook dispatcher error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Webhook dispatcher internal error" }, 500);
  }
});