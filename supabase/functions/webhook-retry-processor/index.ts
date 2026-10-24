import { createClient } from "npm:@supabase/supabase-js@2";

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
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
    const token = req.headers.get("x-internal-token");
    if (!token || token.length < 32) return json({ error: "Unauthorized" }, 401);
    const { data: authorized, error: authError } = await supabase.rpc("verify_internal_trigger_token", { p_token: token });
    if (authError || authorized !== true) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const limit = Math.min(200, Math.max(1, Number(body.limit ?? 50) || 50));
    const { data: rows, error } = await supabase.rpc("get_webhook_retries_ready", { p_limit: limit });
    if (error) throw error;
    const deliveries = Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
    if (deliveries.length === 0) return json({ success: true, candidates: 0, dispatched: 0, skipped: 0 });

    let dispatched = 0;
    let skipped = 0;
    let failed = 0;
    for (let i = 0; i < deliveries.length; i += 5) {
      const batch = deliveries.slice(i, i + 5);
      const results = await Promise.all(batch.map(async (delivery) => {
        const id = String(delivery.delivery_log_id ?? "");
        if (!id) return "failed";
        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/webhook-dispatcher`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-internal-token": token },
            body: JSON.stringify({ delivery_log_id: id }),
            signal: AbortSignal.timeout(35000),
          });
          const result = await response.json().catch(() => ({})) as Record<string, unknown>;
          if (response.status === 409 || result.skipped === true) return "skipped";
          if (response.ok) return "dispatched";
          return "failed";
        } catch {
          return "failed";
        }
      }));
      for (const result of results) {
        if (result === "dispatched") dispatched++;
        else if (result === "skipped") skipped++;
        else failed++;
      }
    }

    return json({ success: failed === 0, candidates: deliveries.length, dispatched, skipped, failed });
  } catch (error) {
    console.error("Webhook retry processor error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Webhook retry processor internal error" }, 500);
  }
});