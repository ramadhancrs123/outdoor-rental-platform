import { createClient } from "npm:@supabase/supabase-js@2";

function json(value: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
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
    const { data: authorized, error } = await supabase.rpc("verify_internal_trigger_token", { p_token: token });
    if (error || authorized !== true) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const response = await fetch(`${supabaseUrl}/functions/v1/process-fcm-queue-cron`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": token },
      body: JSON.stringify({ limit: Math.min(200, Math.max(1, Number(body.limit ?? 50) || 50)) }),
      signal: AbortSignal.timeout(40000),
    });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    return json(result, response.status);
  } catch {
    return json({ error: "FCM queue processor relay failed" }, 502);
  }
});