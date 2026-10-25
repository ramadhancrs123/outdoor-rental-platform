import { createClient } from "npm:@supabase/supabase-js@2";

const allowedStages = new Set([
  "bridge_missing",
  "waiting_context",
  "waiting_token",
  "registered",
  "registration_failed",
  "bridge_timeout",
  "context_timeout",
  "token_timeout",
]);
const allowedErrors = new Set([
  "database_permission",
  "duplicate_conflict",
  "registration_failed",
  "bridge_timeout",
  "context_timeout",
  "token_timeout",
]);

const allowedOrigins = new Set([
  "https://akasha-outdoor.vercel.app",
  "https://outdoor-rental-platform-din-media.vercel.app",
  "http://localhost:3000",
]);

function corsHeaders(origin: string): Record<string, string> {
  const allowed = allowedOrigins.has(origin);
  return {
    ...(allowed ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function json(data: Record<string, unknown>, status = 200, origin = ""): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  const respond = (data: Record<string, unknown>, status = 200) => json(data, status, origin);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origin not allowed" }, 403);
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  if (Number(req.headers.get("content-length") ?? "0") > 2048) return respond({ error: "Payload too large" }, 413);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const authorization = req.headers.get("authorization") ?? "";
  if (!supabaseUrl || !anonKey || !authorization.toLowerCase().startsWith("bearer ")) {
    return respond({ error: "Authentication required" }, 401);
  }

  try {
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const jwt = authorization.slice(7).trim();
    const { data, error } = await supabase.auth.getUser(jwt);
    if (error || !data.user) return respond({ error: "Authentication required" }, 401);

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return respond({ error: "Invalid payload" }, 400);
    if (typeof body.stage !== "string" || !allowedStages.has(body.stage)) return respond({ error: "Invalid diagnostic stage" }, 400);
    if (typeof body.has_bridge !== "boolean" || typeof body.identity_ready !== "boolean" || typeof body.tenant_ready !== "boolean") {
      return respond({ error: "Invalid diagnostic flags" }, 400);
    }

    const length = typeof body.token_length === "number" && Number.isFinite(body.token_length)
      ? Math.max(0, Math.min(4096, Math.trunc(body.token_length)))
      : null;
    const userType = body.user_type === "admin" || body.user_type === "investor" ? body.user_type : "unknown";
    const errorCode = typeof body.error_code === "string" && allowedErrors.has(body.error_code) ? body.error_code : null;
    const event = {
      stage: body.stage,
      has_bridge: body.has_bridge,
      identity_ready: body.identity_ready,
      tenant_ready: body.tenant_ready,
      token_length: length,
      user_type: userType,
      error_code: errorCode,
      origin: req.headers.get("origin") ?? "unknown",
    };

    console.info("[fcm-device-diagnostic]", JSON.stringify(event));
    return respond({ ok: true });
  } catch {
    return respond({ error: "Diagnostic event rejected" }, 400);
  }
});