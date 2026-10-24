import { createClient } from "npm:@supabase/supabase-js@2";

type ServiceAccount = { client_email: string; private_key: string; project_id?: string; token_uri?: string };
type Payload = { token?: string; topic?: string; title: string; body: string; data?: Record<string, unknown>; priority?: "high" | "normal"; image?: string };
let cachedToken = "";
let cachedExp = 0;

function json(value: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
function b64url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function pemToDer(pem: string): Uint8Array {
  const normalized = pem.replace(/\\n/g, "\n");
  return Uint8Array.from(
    atob(normalized.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "")),
    c => c.charCodeAt(0),
  );
}
async function getFcmCredentials(): Promise<{ accessToken: string; projectId: string }> {
  const now = Math.floor(Date.now() / 1000);
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (raw) {
    let account: ServiceAccount;
    try { account = JSON.parse(raw) as ServiceAccount; }
    catch { throw new Error("Firebase service-account JSON is invalid"); }
    if (!account.client_email || !account.private_key || !account.project_id) {
      throw new Error("Firebase service account lacks required fields");
    }
    const configuredProject = Deno.env.get("FIREBASE_PROJECT_ID");
    if (configuredProject && configuredProject !== account.project_id) throw new Error("Firebase project configuration mismatch");
    if (cachedToken && cachedExp > now + 60) return { accessToken: cachedToken, projectId: account.project_id };

    const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
    const unsigned = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
      b64url(JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: tokenUri, iat: now, exp: now + 3600,
      }));
    const key = await crypto.subtle.importKey(
      "pkcs8", pemToDer(account.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
    const assertion = unsigned + "." + b64url(new Uint8Array(sig));
    const response = await fetch(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || typeof data.access_token !== "string") throw new Error("Google OAuth token exchange failed");
    cachedToken = data.access_token;
    cachedExp = now + Math.min(Number(data.expires_in ?? 3600), 3600);
    return { accessToken: cachedToken, projectId: account.project_id };
  }

  const accessToken = Deno.env.get("FIREBASE_ACCESS_TOKEN") || Deno.env.get("FIREBASE_SERVER_KEY");
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
  if (!accessToken || !projectId) throw new Error("Firebase service-account configuration is missing");
  if (accessToken.startsWith("AAAA")) throw new Error("Legacy FCM server keys are not accepted by the FCM HTTP v1 API");
  return { accessToken, projectId };
}
function toData(input?: Record<string, unknown>): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).map(([k,v]) => [k, v == null ? "" : String(v)]));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Server configuration missing" }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const internalToken = req.headers.get("x-internal-token");
    if (!internalToken || internalToken.length < 32) return json({ error: "Unauthorized" }, 401);
    const { data: authorized, error: authError } = await supabase.rpc("verify_internal_trigger_token", { p_token: internalToken });
    if (authError || authorized !== true) return json({ error: "Unauthorized" }, 401);

    const input = await req.json().catch(() => null) as Payload | null;
    if (!input || typeof input !== "object") return json({ error: "Invalid JSON payload" }, 400);
    const token = typeof input.token === "string" ? input.token.trim() : "";
    const topic = typeof input.topic === "string" ? input.topic.trim() : "";
    if (Boolean(token) === Boolean(topic)) return json({ error: "Provide exactly one of token or topic" }, 400);
    if (!input.title?.trim() || !input.body?.trim()) return json({ error: "title and body are required" }, 400);
    if (input.title.length > 256 || input.body.length > 2048) return json({ error: "title or body exceeds supported limits" }, 400);

    const credentials = await getFcmCredentials();
    const message: Record<string, unknown> = {
      notification: { title: input.title, body: input.body, ...(input.image ? { image: input.image } : {}) },
      data: toData(input.data),
      android: {
        priority: input.priority === "normal" ? "normal" : "high",
        notification: { channel_id: "important_alerts", click_action: "FLUTTER_NOTIFICATION_CLICK" },
      },
    };
    if (token) message.token = token;
    else message.topic = topic;

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.projectId)}/messages:send`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${credentials.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const firebaseError = (result.error && typeof result.error === "object" ? result.error : {}) as Record<string, unknown>;
      return json({ success: false, error: String(firebaseError.message ?? `FCM HTTP ${response.status}`), status: response.status }, 502);
    }
    return json({ success: true, messageId: result.name ?? null });
  } catch (error) {
    console.error("FCM direct-send failed:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "FCM sender failed; check function logs and Firebase configuration" }, 500);
  }
});