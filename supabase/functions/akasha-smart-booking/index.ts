import { createClient } from "npm:@supabase/supabase-js@2"

type JsonObject = Record<string, unknown>
type RpcError = { code?: string; message?: string; details?: string } | null

const BUSINESS_SLUG =
  Deno.env.get("AKASHA_SMART_BOOKING_USAHA_SLUG") ?? "akasha-outdoor"

const corsHeaders = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-akasha-smart-booking-ingress-secret",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
}

function json(body: JsonObject, status = 200, origin = ""): Response {
  const headers = new Headers({
    ...corsHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
  })
  if (origin && isAllowedOrigin(origin)) headers.set("Access-Control-Allow-Origin", origin)
  return new Response(JSON.stringify(body), { status, headers })
}

function isAllowedOrigin(origin: string): boolean {
  if (origin === "https://akasha-outdoor.vercel.app" || origin === "http://localhost:3000") return true
  return /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function getKeySet(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.values(parsed).filter((value): value is string => typeof value === "string" && value.length > 0)
  } catch {
    return []
  }
}

function getDefaultKey(raw: string | undefined): string {
  if (!raw) return ""
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return typeof parsed.default === "string" ? parsed.default : ""
  } catch {
    return ""
  }
}

function getFingerprint(request: Request, supplied: unknown): string {
  const explicit = text(supplied, 500)
  if (explicit.length >= 8) return explicit

  const headers = request.headers
  const ip =
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "unknown"
  const userAgent = headers.get("user-agent") ?? "unknown"
  return ip + "|" + userAgent.slice(0, 240)
}

function statusForSqlError(error: RpcError): number {
  switch (error?.code) {
    case "22023":
    case "P0002":
    case "22P02":
      return 400
    case "28000":
    case "42501":
      return 401
    case "23505":
    case "23514":
    case "40001":
      return 409
    case "54000":
      return 429
    default:
      return 503
  }
}

function publicError(error: RpcError, fallback: string): { status: number; message: string } {
  const status = statusForSqlError(error)
  if (status === 400) return { status, message: "Data booking atau permintaan belum valid." }
  if (status === 401) return { status, message: "Sesi atau akses booking tidak valid." }
  if (status === 409) return { status, message: "Data booking telah berubah atau mengalami konflik." }
  if (status === 429) return { status, message: "Terlalu banyak percobaan. Coba kembali beberapa saat lagi." }
  return { status: 503, message: fallback }
}

function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL")
  const serviceKey =
    getDefaultKey(Deno.env.get("SUPABASE_SECRET_KEYS")) ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    ""

  if (!url || !serviceKey) throw new Error("Edge Function service credentials are unavailable")

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "X-Application-Name": "akasha-smart-booking-edge" },
    },
  })
}

function isAllowedApiKey(request: Request): boolean {
  const apiKey = request.headers.get("apikey") ?? ""
  if (!apiKey) return false

  const accepted = new Set([
    ...getKeySet(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")),
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  ].filter(Boolean))

  return accepted.has(apiKey)
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin") ?? ""

  if (request.method === "OPTIONS") {
    if (origin && !isAllowedOrigin(origin)) return json({ error: "Origin not allowed" }, 403, origin)
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
      },
    })
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin)
  if (origin && !isAllowedOrigin(origin)) return json({ error: "Origin not allowed" }, 403, origin)
  const contentLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > 24_000) {
    return json({ error: "Payload too large" }, 413, origin)
  }

  let body: JsonObject
  try {
    const raw = await request.text()
    if (raw.length > 24_000) return json({ error: "Payload too large" }, 413, origin)
    const parsed = JSON.parse(raw)
    if (!isObject(parsed)) return json({ error: "Invalid payload" }, 400, origin)
    body = parsed
  } catch {
    return json({ error: "Invalid JSON payload" }, 400, origin)
  }

  let supabase: ReturnType<typeof createAdminClient>
  try {
    supabase = createAdminClient()
  } catch {
    return json({ error: "Booking service is not configured" }, 503, origin)
  }

  // The public Supabase anon JWT only proves the request came from a
  // Supabase client. Require a second, server-only ingress credential so a
  // browser cannot call this service-role Edge Function directly.
  const ingressCandidate = request.headers.get("x-akasha-smart-booking-ingress-secret") ?? ""
  try {
    const { data: ingressAllowed, error: ingressError } = await supabase.rpc(
      "verify_akasha_smart_booking_ingress",
      { p_candidate: ingressCandidate },
    )
    if (ingressError || ingressAllowed !== true) {
      return json({ error: "Authentication required" }, 401, origin)
    }
  } catch {
    return json({ error: "Booking service authentication is unavailable" }, 503, origin)
  }

  const action = text(body.action, 32)
  const fingerprint = getFingerprint(request, body.client_fingerprint)

  try {
    if (action === "create") {
      const booking = body.booking
      const key = text(body.idempotency_key, 80)
      if (!isObject(booking) || key.length < 8) {
        return json({ error: "Booking payload or idempotency key is invalid" }, 400, origin)
      }

      const { data: throttle, error: throttleError } = await supabase.rpc(
        "register_akasha_smart_booking_create_attempt",
        {
          p_slug: BUSINESS_SLUG,
          p_client_fingerprint: fingerprint,
        },
      )
      if (throttleError) {
        return json({ error: "Booking service is temporarily unavailable" }, 503, origin)
      }
      if (!isObject(throttle) || throttle.ok !== true) {
        const retryAfter = Math.max(1, Math.min(3600, Number(throttle?.retry_after_seconds ?? 600)))
        return json({ error: "Too many booking attempts. Please try again later.", retry_after_seconds: retryAfter }, 429, origin)
      }

      const { data, error } = await supabase.rpc("command_create_akasha_smart_booking", {
        p_slug: BUSINESS_SLUG,
        p_booking: booking,
        p_idempotency_key: key,
      })
      if (error || !isObject(data)) {
        const failure = publicError(error, "Booking could not be processed")
        return json({ error: failure.message }, failure.status, origin)
      }

      return json(data, 201, origin)
    }

    if (action === "login") {
      const reference = text(body.reference_code, 24)
      const accessCode = text(body.access_code, 40)
      if (!reference || accessCode.length < 4) {
        return json({ error: "Reference or access code is invalid" }, 401, origin)
      }

      const { data, error } = await supabase.rpc("exchange_akasha_smart_booking_access", {
        p_slug: BUSINESS_SLUG,
        p_reference_code: reference,
        p_access_code: accessCode,
        p_client_fingerprint: fingerprint,
      })
      if (error || !isObject(data) || data.ok !== true || typeof data.session_token !== "string") {
        return json({ error: "Reference or access code is invalid, or access is temporarily limited" }, 401, origin)
      }
      return json(data, 200, origin)
    }

    if (action === "login_code" || action === "login_link") {
      const credentialType = action === "login_code" ? "code" : "link";
      const credential = credentialType === "code"
        ? text(body.access_code, 40)
        : text(body.portal_link_token, 64);

      if (credential.length < 4 || (credentialType === "link" && !/^[0-9a-f]{64}$/i.test(credential))) {
        return json({ error: "Customer credential is invalid" }, 401, origin);
      }

      const { data, error } = await supabase.rpc("exchange_akasha_smart_booking_customer_credential", {
        p_slug: BUSINESS_SLUG,
        p_credential: credential,
        p_credential_type: credentialType,
        p_client_fingerprint: fingerprint,
      });
      if (error || !isObject(data) || data.ok !== true || typeof data.session_token !== "string") {
        return json({ error: "Customer access code or private link is invalid, or access is temporarily limited" }, 401, origin);
      }
      return json(data, 200, origin);
    }

    if (action === "portal") {
      const token = text(body.session_token, 128)
      if (token.length !== 64) return json({ error: "Invalid portal session" }, 401, origin)

      const { data, error } = await supabase.rpc("get_akasha_smart_booking_portal", {
        p_session_token: token,
      })
      if (error || !isObject(data)) return json({ error: "Portal session expired" }, 401, origin)
      return json(data, 200, origin)
    }

    if (action === "availability") {
      const token = text(body.session_token, 128)
      if (token.length !== 64) return json({ error: "Invalid portal session" }, 401, origin)

      const { data, error } = await supabase.rpc("get_akasha_smart_booking_availability", {
        p_session_token: token,
      })
      if (error || !isObject(data)) {
        const failure = publicError(error, "Availability projection is temporarily unavailable")
        return json({ error: failure.message }, failure.status, origin)
      }
      return json(data, 200, origin)
    }

    if (action === "change") {
      const token = text(body.session_token, 128)
      const requestType = text(body.request_type, 40)
      const expectedRevision = Number(body.expected_revision)
      const idempotencyKey = text(body.idempotency_key, 100)
      const payload = body.payload

      if (
        token.length !== 64 ||
        !["item_change", "variant_change", "quantity_change", "schedule_change", "cancellation", "alternative_interest", "other"].includes(requestType) ||
        !Number.isInteger(expectedRevision) ||
        expectedRevision < 1 ||
        idempotencyKey.length < 8 ||
        !isObject(payload)
      ) {
        return json({ error: "Invalid change request" }, 400, origin)
      }

      const { data, error } = await supabase.rpc("submit_akasha_smart_booking_change", {
        p_session_token: token,
        p_request_type: requestType,
        p_payload: payload,
        p_reason: text(body.reason, 500) || null,
        p_expected_revision: expectedRevision,
        p_idempotency_key: idempotencyKey,
      })
      if (error || !isObject(data)) {
        const failure = publicError(error, "Change request could not be submitted")
        return json({ error: failure.message }, failure.status, origin)
      }
      return json(data, 201, origin)
    }

    if (action === "logout") {
      const token = text(body.session_token, 128)
      if (token.length !== 64) return json({ ok: true }, 200, origin)
      const { data, error } = await supabase.rpc("revoke_akasha_smart_booking_portal_session", {
        p_session_token: token,
      })
      if (error) return json({ error: "Unable to revoke portal session" }, 503, origin)
      return json({ ok: Boolean(data) }, 200, origin)
    }

    return json({ error: "Unsupported booking action" }, 400, origin)
  } catch {
    return json({ error: "Booking service is temporarily unavailable" }, 503, origin)
  }
})
