import { createClient } from "npm:@supabase/supabase-js@2";

const BMKG_URL = "https://api.bmkg.go.id/publik/prakiraan-cuaca";
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const ERROR_RETRY_MS = 5 * 60 * 1000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Max-Age": "86400",
};

type RecordLike = Record<string, unknown>;
type WeatherArea = {
  weather_area_id: string;
  adm4_code: string;
  village_name: string;
  district_name: string | null;
  regency_name: string | null;
  province_name: string;
  latitude: number | null;
  longitude: number | null;
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status >= 200 && status < 300
        ? "public, max-age=300, stale-while-revalidate=900"
        : "no-store",
      ...extra,
    },
  });
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  // BMKG documents analysis_date as UTC without consistently carrying a trailing Z.
  const explicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const parsed = new Date(explicitZone ? raw : raw.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function findLatestAnalysisDate(value: unknown): string | null {
  const found: string[] = [];
  const walk = (node: unknown, depth = 0) => {
    if (depth > 20 || node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(node as RecordLike)) {
      if (key === "analysis_date" && typeof item === "string") {
        const iso = parseTimestamp(item);
        if (iso) found.push(iso);
      } else {
        walk(item, depth + 1);
      }
    }
  };
  walk(value);
  return found.sort().at(-1) ?? null;
}

function publicEnvelope(payload: RecordLike, area: WeatherArea, fetchedAt: string, freshUntil: string, stale: boolean, staleReason?: string) {
  return {
    source: {
      code: "BMKG",
      name: "BMKG",
      attribution: "Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)",
      sourceUrl: "https://data.bmkg.go.id/prakiraan-cuaca/",
      apiUrl: BMKG_URL,
    },
    location: {
      adm4Code: area.adm4_code,
      village: area.village_name,
      district: area.district_name,
      regency: area.regency_name,
      province: area.province_name,
      latitude: area.latitude,
      longitude: area.longitude,
      scopeNotice: "Prakiraan ini mewakili wilayah administratif yang tercantum dan tidak selalu mencerminkan kondisi aktual di sepanjang jalur atau puncak gunung.",
    },
    analysisDate: findLatestAnalysisDate(payload),
    fetchedAt,
    freshUntil,
    stale,
    ...(staleReason ? { staleReason } : {}),
    forecast: Array.isArray(payload.data) ? payload.data : [],
    bmkgLocation: payload.lokasi && typeof payload.lokasi === "object" ? payload.lokasi : null,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "SERVER_CONFIGURATION_MISSING" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "x-hiking-backend": "hiking-weather-forecast" } },
  });

  const { data: rolloutFlags, error: rolloutError } = await supabase
    .from("hiking_feature_flags")
    .select("flag_key,is_enabled")
    .in("flag_key", ["public_hiking_catalog_enabled", "bmkg_forecast_enabled"]);
  if (rolloutError || !rolloutFlags) {
    return json({ error: "FEATURE_FLAG_LOOKUP_FAILED" }, 503, { "Cache-Control": "no-store" });
  }
  const flags = Object.fromEntries(rolloutFlags.map((item: { flag_key: string; is_enabled: boolean }) => [item.flag_key, item.is_enabled]));
  if (flags.public_hiking_catalog_enabled !== true) {
    return json({ error: "FEATURE_DISABLED", feature: "public_hiking_catalog_enabled" }, 503, { "Cache-Control": "no-store" });
  }
  if (flags.bmkg_forecast_enabled !== true) {
    return json({ error: "FEATURE_DISABLED", feature: "bmkg_forecast_enabled" }, 503, { "Cache-Control": "no-store" });
  }

  const url = new URL(request.url);
  const mountainSlug = url.searchParams.get("mountain")?.trim().toLowerCase() ?? "";
  const trailSlug = url.searchParams.get("trail")?.trim().toLowerCase() ?? "";
  if (Boolean(mountainSlug) === Boolean(trailSlug)) {
    return json({
      error: "INVALID_QUERY",
      message: "Isi tepat satu parameter: mountain=<slug> atau trail=<slug>.",
    }, 400);
  }
  const requestedSlug = mountainSlug || trailSlug;
  if (requestedSlug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug)) {
    return json({ error: "INVALID_SLUG" }, 400);
  }


  try {
    let targetId: string;
    let targetKind: "mountain" | "trail";
    if (mountainSlug) {
      const { data, error } = await supabase
        .from("hiking_mountains")
        .select("mountain_id,slug,publication_status")
        .eq("slug", mountainSlug)
        .eq("publication_status", "published")
        .maybeSingle();
      if (error) throw new Error("DESTINATION_LOOKUP_FAILED");
      if (!data) return json({ error: "DESTINATION_NOT_FOUND" }, 404);
      targetId = data.mountain_id;
      targetKind = "mountain";
    } else {
      const { data, error } = await supabase
        .from("hiking_trails")
        .select("trail_id,mountain_id,slug,publication_status")
        .eq("slug", trailSlug)
        .eq("publication_status", "published")
        .maybeSingle();
      if (error) throw new Error("TRAIL_LOOKUP_FAILED");
      if (!data) return json({ error: "TRAIL_NOT_FOUND" }, 404);
      const { data: mountain, error: mountainError } = await supabase
        .from("hiking_mountains")
        .select("mountain_id")
        .eq("mountain_id", data.mountain_id)
        .eq("publication_status", "published")
        .maybeSingle();
      if (mountainError) throw new Error("DESTINATION_LOOKUP_FAILED");
      if (!mountain) return json({ error: "DESTINATION_NOT_FOUND" }, 404);
      targetId = data.trail_id;
      targetKind = "trail";
    }

    const mappingTable = targetKind === "mountain"
      ? "hiking_mountain_weather_areas"
      : "hiking_trail_weather_areas";
    const targetColumn = targetKind === "mountain" ? "mountain_id" : "trail_id";
    const { data: mapping, error: mappingError } = await supabase
      .from(mappingTable)
      .select("weather_area_id,is_primary,verified_at")
      .eq(targetColumn, targetId)
      .not("verified_at", "is", null)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mappingError) throw new Error("WEATHER_MAPPING_LOOKUP_FAILED");
    if (!mapping) {
      return json({
        error: "WEATHER_AREA_NOT_CONFIGURED",
        message: "Wilayah referensi BMKG belum ditetapkan dan diverifikasi untuk destinasi ini.",
      }, 409);
    }

    const { data: area, error: areaError } = await supabase
      .from("hiking_weather_areas")
      .select("weather_area_id,adm4_code,village_name,district_name,regency_name,province_name,latitude,longitude,is_active")
      .eq("weather_area_id", mapping.weather_area_id)
      .eq("is_active", true)
      .maybeSingle();
    if (areaError) throw new Error("WEATHER_AREA_LOOKUP_FAILED");
    if (!area) return json({ error: "WEATHER_AREA_INACTIVE" }, 409);

    const { data: cached, error: cacheError } = await supabase
      .from("hiking_weather_cache")
      .select("payload,analysis_date,fetched_at,fresh_until,fetch_status,last_error_at")
      .eq("adm4_code", area.adm4_code)
      .maybeSingle();
    if (cacheError) throw new Error("WEATHER_CACHE_LOOKUP_FAILED");

    const now = Date.now();
    const fetchedAt = cached?.fetched_at ? new Date(cached.fetched_at).toISOString() : null;
    const freshUntil = cached?.fresh_until ? new Date(cached.fresh_until).toISOString() : null;
    const cachedPayload = cached?.payload && typeof cached.payload === "object"
      ? cached.payload as RecordLike
      : null;
    if (
      cachedPayload && fetchedAt && freshUntil &&
      new Date(freshUntil).getTime() > now &&
      cached.fetch_status === "success"
    ) {
      return json(publicEnvelope(cachedPayload, area as WeatherArea, fetchedAt, freshUntil, false));
    }

    // Reduce upstream retry pressure when BMKG is temporarily unavailable.
    if (
      cachedPayload && fetchedAt && freshUntil && cached.fetch_status === "stale" &&
      cached.last_error_at && now - new Date(cached.last_error_at).getTime() < ERROR_RETRY_MS
    ) {
      return json(publicEnvelope(cachedPayload, area as WeatherArea, fetchedAt, freshUntil, true, "BMKG_TEMPORARILY_UNAVAILABLE"));
    }

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(
        `${BMKG_URL}?adm4=${encodeURIComponent(area.adm4_code)}`,
        { headers: { "Accept": "application/json", "User-Agent": "Akasha-Hiking-Info/1.0" }, signal: AbortSignal.timeout(10000) },
      );
    } catch {
      if (cachedPayload && fetchedAt && freshUntil) {
        await supabase.from("hiking_weather_cache").update({
          fetch_status: "stale",
          last_error_code: "BMKG_NETWORK_ERROR",
          last_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("adm4_code", area.adm4_code);
        return json(publicEnvelope(cachedPayload, area as WeatherArea, fetchedAt, freshUntil, true, "BMKG_TEMPORARILY_UNAVAILABLE"));
      }
      return json({
        error: "BMKG_UNAVAILABLE",
        message: "Prakiraan cuaca BMKG sementara tidak dapat diambil.",
        source: "BMKG",
      }, 502);
    }

    if (!upstreamResponse.ok) {
      if (cachedPayload && fetchedAt && freshUntil) {
        await supabase.from("hiking_weather_cache").update({
          fetch_status: "stale",
          last_error_code: `BMKG_HTTP_${upstreamResponse.status}`,
          last_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("adm4_code", area.adm4_code);
        return json(publicEnvelope(cachedPayload, area as WeatherArea, fetchedAt, freshUntil, true, "BMKG_TEMPORARILY_UNAVAILABLE"));
      }
      return json({ error: "BMKG_UPSTREAM_ERROR", source: "BMKG" }, 502);
    }

    let payload: RecordLike;
    try {
      payload = await upstreamResponse.json() as RecordLike;
    } catch {
      return json({ error: "BMKG_INVALID_RESPONSE", source: "BMKG" }, 502);
    }
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.data) || !payload.lokasi) {
      return json({ error: "BMKG_INVALID_RESPONSE", source: "BMKG" }, 502);
    }

    const time = new Date();
    const currentFetchedAt = time.toISOString();
    const currentFreshUntil = new Date(time.getTime() + CACHE_TTL_MS).toISOString();
    const analysisDate = findLatestAnalysisDate(payload);
    const { error: writeError } = await supabase.from("hiking_weather_cache").upsert({
      adm4_code: area.adm4_code,
      payload,
      analysis_date: analysisDate,
      fetched_at: currentFetchedAt,
      fresh_until: currentFreshUntil,
      fetch_status: "success",
      last_error_code: null,
      last_error_at: null,
      updated_at: currentFetchedAt,
    }, { onConflict: "adm4_code" });

    if (writeError) {
      // A successful live response is still useful even if cache persistence failed.
      console.error("BMKG response received but cache write failed");
    }

    return json(publicEnvelope(payload, area as WeatherArea, currentFetchedAt, currentFreshUntil, false));
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
    const allowed = new Set([
      "DESTINATION_LOOKUP_FAILED", "TRAIL_LOOKUP_FAILED", "WEATHER_MAPPING_LOOKUP_FAILED",
      "WEATHER_AREA_LOOKUP_FAILED", "WEATHER_CACHE_LOOKUP_FAILED",
    ]);
    console.error("hiking-weather-forecast failed:", allowed.has(code) ? code : "INTERNAL_ERROR");
    return json({ error: allowed.has(code) ? code : "INTERNAL_ERROR" }, 500);
  }
});
