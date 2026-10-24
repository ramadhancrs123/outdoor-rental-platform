import { createClient } from "npm:@supabase/supabase-js@2";

type ServiceAccount = { client_email: string; private_key: string; project_id?: string; token_uri?: string };
let cachedAccessToken = "";
let cachedTokenExpiresAt = 0;

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function pemToDer(pem: string): Uint8Array {
  const normalized = pem.replace(/\\n/g, "\n");
  const base64 = normalized.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}
async function getFcmCredentials(): Promise<{ token: string; projectId: string }> {
  const now = Math.floor(Date.now() / 1000);
  const serviceAccountRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (serviceAccountRaw) {
    let account: ServiceAccount;
    try { account = JSON.parse(serviceAccountRaw) as ServiceAccount; }
    catch { throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON"); }
    if (!account.client_email || !account.private_key || !account.project_id) {
      throw new Error("Firebase service account must include client_email, private_key and project_id");
    }
    const configuredProject = Deno.env.get("FIREBASE_PROJECT_ID");
    if (configuredProject && configuredProject !== account.project_id) {
      throw new Error("FIREBASE_PROJECT_ID does not match service-account project_id");
    }
    if (cachedAccessToken && cachedTokenExpiresAt > now + 60) {
      return { token: cachedAccessToken, projectId: account.project_id };
    }
    const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
    const unsigned = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
      base64Url(JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: tokenUri, iat: now, exp: now + 3600,
      }));
    const key = await crypto.subtle.importKey(
      "pkcs8", pemToDer(account.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
    );
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
    const assertion = unsigned + "." + base64Url(new Uint8Array(signature));
    const response = await fetch(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || typeof result.access_token !== "string") {
      throw new Error("Google OAuth token exchange failed; check Firebase service-account IAM/API configuration");
    }
    cachedAccessToken = result.access_token;
    cachedTokenExpiresAt = now + Math.min(Number(result.expires_in ?? 3600), 3600);
    return { token: cachedAccessToken, projectId: account.project_id };
  }

  const fallbackToken = Deno.env.get("FIREBASE_ACCESS_TOKEN") || Deno.env.get("FIREBASE_SERVER_KEY");
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
  if (!projectId || !fallbackToken) {
    throw new Error("Configure FIREBASE_SERVICE_ACCOUNT_JSON and FIREBASE_PROJECT_ID in Edge Function secrets");
  }
  if (fallbackToken.startsWith("AAAA")) {
    throw new Error("FIREBASE_SERVER_KEY appears to be a legacy FCM server key; HTTP v1 requires service-account OAuth");
  }
  return { token: fallbackToken, projectId };
}
function normalizeData(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([k,v]) => [k, v == null ? "" : String(v)]));
}
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Server configuration missing" }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const token = req.headers.get("x-internal-token");
    if (!token || token.length < 32) return json({ error: "Unauthorized" }, 401);
    const { data: authorized, error: authError } = await supabase.rpc("verify_internal_trigger_token", { p_token: token });
    if (authError || authorized !== true) return json({ error: "Unauthorized" }, 401);

    // Validate Firebase credentials before claiming rows, so a configuration issue does not strand queue items.
    const firebase = await getFcmCredentials();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const limit = Math.min(200, Math.max(1, Number(body.limit ?? 50) || 50));
    const { data: items, error: claimError } = await supabase.rpc("claim_fcm_notification_batch", { p_limit: limit });
    if (claimError) throw claimError;
    const queue = Array.isArray(items) ? items as Array<Record<string, unknown>> : [];
    if (queue.length === 0) return json({ success: true, processed: 0, sent: 0, failed: 0, retrying: 0 });

    let sent = 0, failed = 0, retrying = 0;
    for (let i = 0; i < queue.length; i += 5) {
      const batch = queue.slice(i, i + 5);
      const outcomes = await Promise.all(batch.map(async item => {
        const queueId = String(item.queue_id);
        const attempt = Number(item.attempt_count ?? 1);
        const tokenValue = String(item.fcm_token ?? "");
        if (!tokenValue) {
          await supabase.from("fcm_notification_queue").update({ status: "failed", last_error: "Missing FCM token", next_attempt_at: null, updated_at: new Date().toISOString() }).eq("queue_id", queueId);
          return "failed";
        }
        const message = {
          message: {
            token: tokenValue,
            notification: { title: String(item.title ?? ""), body: String(item.body ?? "") },
            data: normalizeData(item.data),
            android: { priority: item.priority === "normal" ? "normal" : "high", notification: { channel_id: "important_alerts", click_action: "FLUTTER_NOTIFICATION_CLICK" } },
          },
        };
        try {
          const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(firebase.projectId)}/messages:send`, {
            method: "POST",
            headers: { authorization: `Bearer ${firebase.token}`, "content-type": "application/json" },
            body: JSON.stringify(message),
            signal: AbortSignal.timeout(15000),
          });
          const result = await response.json().catch(() => ({})) as Record<string, unknown>;
          if (response.ok) {
            const { error } = await supabase.from("fcm_notification_queue").update({
              status: "sent", sent_at: new Date().toISOString(), last_error: null, next_attempt_at: null, updated_at: new Date().toISOString(),
            }).eq("queue_id", queueId);
            if (error) throw error;
            return "sent";
          }
          const apiError = (result.error && typeof result.error === "object" ? result.error : {}) as Record<string, unknown>;
          const messageText = String(apiError.message ?? `FCM HTTP ${response.status}`);
          const details = Array.isArray(apiError.details) ? apiError.details : [];
          const unregistered = details.some(d => d && typeof d === "object" && String((d as Record<string, unknown>).errorCode ?? "") === "UNREGISTERED");
          const transient = response.status === 429 || response.status >= 500;
          const shouldRetry = transient && attempt < 5;
          const nextAttempt = shouldRetry ? new Date(Date.now() + Math.min(3600, 60 * Math.pow(2, Math.max(0, attempt - 1))) * 1000).toISOString() : null;
          const { error } = await supabase.from("fcm_notification_queue").update({
            status: shouldRetry ? "pending" : "failed",
            last_error: messageText.slice(0,1000), next_attempt_at: nextAttempt, updated_at: new Date().toISOString(),
          }).eq("queue_id", queueId);
          if (error) throw error;
          if (unregistered) {
            const { error: deviceError } = await supabase.from("user_devices").update({ is_active: false, updated_at: new Date().toISOString() })
              .eq("usaha_id", String(item.usaha_id)).eq("fcm_token", tokenValue);
            if (deviceError) console.error("Unable to deactivate unregistered FCM token");
          }
          return shouldRetry ? "retrying" : "failed";
        } catch (err) {
          const messageText = err instanceof Error ? err.message : "Unknown FCM request error";
          const shouldRetry = attempt < 5;
          const nextAttempt = shouldRetry ? new Date(Date.now() + Math.min(3600, 60 * Math.pow(2, Math.max(0, attempt - 1))) * 1000).toISOString() : null;
          const { error } = await supabase.from("fcm_notification_queue").update({
            status: shouldRetry ? "pending" : "failed", last_error: messageText.slice(0,1000),
            next_attempt_at: nextAttempt, updated_at: new Date().toISOString(),
          }).eq("queue_id", queueId);
          if (error) console.error("Unable to save FCM failure state");
          return shouldRetry ? "retrying" : "failed";
        }
      }));
      for (const outcome of outcomes) {
        if (outcome === "sent") sent++;
        else if (outcome === "retrying") retrying++;
        else failed++;
      }
    }
    return json({ success: failed === 0, processed: queue.length, sent, failed, retrying });
  } catch (error) {
    console.error("FCM queue processor error:", error instanceof Error ? error.message : "unknown");
    return json({ error: error instanceof Error ? error.message : "FCM queue processor failed" }, 500);
  }
});