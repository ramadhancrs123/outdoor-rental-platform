import { createClient } from "npm:@supabase/supabase-js@2";

type ServiceAccount = { client_email: string; private_key: string; project_id?: string; token_uri?: string };
type Payload = { token?: string; topic?: string; title: string; body: string; data?: Record<string, unknown>; priority?: "high" | "normal"; image?: string };
let cachedAccessToken = "";
let cachedTokenExpiresAt = 0;

function json(value: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
function base64Url(value: string | Uint8Array): string {
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
async function getFcmCredentials(): Promise<{ token: string; accessToken: string; projectId: string }> {
  const now = Math.floor(Date.now() / 1000);
  const serviceAccountRaw =
    Deno.env.get("FIREBASE_SERVICE_KEY") ||
    Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ||
    Deno.env.get("FIREBASE_SERVER_KEY");

  if (!serviceAccountRaw) {
    throw new Error(
      "Missing Firebase service-account JSON secret. Set FIREBASE_SERVICE_KEY, FIREBASE_SERVICE_ACCOUNT_JSON, or FIREBASE_SERVER_KEY to the complete service-account JSON; FIREBASE_PROJECT_ID must contain the target Firebase project ID."
    );
  }

  let account: ServiceAccount;
  try {
    account = JSON.parse(serviceAccountRaw) as ServiceAccount;
  } catch {
    throw new Error(
      "The Firebase credential secret must contain the complete service-account JSON object, not a legacy FCM server key or a private-key string alone."
    );
  }

  if (!account.client_email || !account.private_key || !account.project_id) {
    throw new Error(
      "Firebase service-account JSON must contain client_email, private_key, and project_id."
    );
  }

  const targetProjectId = Deno.env.get("FIREBASE_PROJECT_ID") || account.project_id;
  if (!targetProjectId || !/^[a-z0-9-]+$/.test(targetProjectId)) {
    throw new Error("FIREBASE_PROJECT_ID is missing or invalid.");
  }

  if (cachedAccessToken && cachedTokenExpiresAt > now + 60) {
    return { token: cachedAccessToken, accessToken: cachedAccessToken, projectId: targetProjectId };
  }

  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const unsigned = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    base64Url(JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = unsigned + "." + base64Url(new Uint8Array(signedBytes));

  const tokenResponse = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const tokenData = await tokenResponse.json().catch(() => ({})) as Record<string, unknown>;
  if (!tokenResponse.ok || typeof tokenData.access_token !== "string") {
    console.error("Firebase OAuth token exchange failed with HTTP", tokenResponse.status);
    throw new Error(
      "Google OAuth token exchange failed. Verify the service-account private key and Firebase Cloud Messaging API/IAM permissions."
    );
  }

  cachedAccessToken = tokenData.access_token;
  cachedTokenExpiresAt = now + Math.min(Number(tokenData.expires_in ?? 3600), 3600);
  return { token: cachedAccessToken, accessToken: cachedAccessToken, projectId: targetProjectId };
}
function toData(input?: Record<string, unknown>): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const data = Object.fromEntries(Object.entries(input).map(([k,v]) => [k, v == null ? "" : String(v)]));
  if (data.uri || !data.action_target) return data;

  const configuredBase = Deno.env.get("RENTAL_WEB_APP_URL");
  if (!configuredBase) return data;
  try {
    const base = new URL(configuredBase);
    if (base.protocol !== "https:" || base.username || base.password) return data;
    const target = new URL(data.action_target, base);
    if (target.protocol === "https:" && target.origin === base.origin) data.uri = target.toString();
  } catch {
    // Missing/invalid base URL: keep push functional and let Smart WebView open app home.
  }
  return data;
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
        notification: { channel_id: "1", click_action: "OPEN_URI" },
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