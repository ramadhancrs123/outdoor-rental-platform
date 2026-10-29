import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Max-Age": "86400",
};
const SOURCE = {
  openStreetMap: { attribution: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" },
  bmkg: { attribution: "Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)", url: "https://data.bmkg.go.id/" },
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status >= 200 && status < 300
        ? "public, max-age=60, stale-while-revalidate=300"
        : "no-store",
      ...extraHeaders,
    },
  });
}
function normalizedSearch(input: string | null): string | null {
  if (!input) return null;
  const value = input.normalize("NFC").replace(/[^\p{L}\p{N} .'-]/gu, " ").trim().replace(/\s+/g, " ");
  if (value.length < 2) return null;
  return value.slice(0, 80);
}
function boundedInt(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}
function slug(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cleaned) && cleaned.length <= 100 ? cleaned : null;
}

const MAX_PUBLIC_ROUTE_POINTS = 100_000;

function normalizedPlace(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\bprovinsi\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  return normalized.length >= 2 ? normalized.slice(0, 80) : null;
}
function normalizedPlaceMatch(left: unknown, right: string): boolean {
  if (typeof left !== "string") return false;
  const a = normalizedPlace(left);
  const b = normalizedPlace(right);
  return Boolean(a && b && (a === b || a.includes(b)));
}
type RouteParse = { segments: number[][][]; pointCount: number; tooMany: boolean };
function parsePublicRoute(value: unknown): RouteParse {
  const empty: RouteParse = { segments: [], pointCount: 0, tooMany: false };
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const root = value as Record<string, unknown>;
  const geometryOf = (item: unknown): { type: string; coordinates: unknown } | null => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const object = item as Record<string, unknown>;
    if (object.type === "Feature") {
      const geometry = object.geometry;
      return geometry && typeof geometry === "object" && !Array.isArray(geometry)
        ? geometry as { type: string; coordinates: unknown } : null;
    }
    if (typeof object.type === "string") return object as { type: string; coordinates: unknown };
    return null;
  };
  const geometries: { type: string; coordinates: unknown }[] = [];
  if (root.type === "FeatureCollection" && Array.isArray(root.features)) {
    for (const feature of root.features) {
      const geometry = geometryOf(feature);
      if (geometry) geometries.push(geometry);
    }
  } else {
    const geometry = geometryOf(value);
    if (geometry) geometries.push(geometry);
  }
  const segments: number[][][] = [];
  let pointCount = 0;
  for (const geometry of geometries) {
    const rawSegments: unknown[] = geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)
        ? geometry.coordinates
        : [];
    for (const rawSegment of rawSegments) {
      if (!Array.isArray(rawSegment)) continue;
      const points: number[][] = [];
      for (const rawPoint of rawSegment) {
        if (!Array.isArray(rawPoint) || rawPoint.length < 2) continue;
        if (typeof rawPoint[0] !== "number" || typeof rawPoint[1] !== "number") continue;
        const longitude = rawPoint[0];
        const latitude = rawPoint[1];
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
          || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) continue;
        const point = [longitude, latitude];
        if (rawPoint.length > 2 && typeof rawPoint[2] === "number") {
          const elevation = rawPoint[2];
          if (Number.isFinite(elevation) && elevation >= -500 && elevation <= 9000) point.push(elevation);
        }
        points.push(point);
        pointCount += 1;
        if (pointCount > MAX_PUBLIC_ROUTE_POINTS) {
          return { segments: [], pointCount, tooMany: true };
        }
      }
      if (points.length >= 2) segments.push(points);
    }
  }
  return { segments, pointCount, tooMany: false };
}
function xmlEscape(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function gpxCoordinate(point: number[]): string {
  const longitude = point[0];
  const latitude = point[1];
  const elevation = point.length > 2 ? "<ele>" + point[2] + "</ele>" : "";
  return '<trkpt lat="' + latitude + '" lon="' + longitude + '">' + elevation + "</trkpt>";
}
function gpxWayPoint(point: Record<string, unknown>): string | null {
  if (point.latitude === null || point.latitude === undefined
    || point.longitude === null || point.longitude === undefined) return null;
  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const elevation = point.elevation_m === null || point.elevation_m === undefined
    ? Number.NaN : Number(point.elevation_m);
  const ele = Number.isFinite(elevation) && elevation >= -500 && elevation <= 9000
    ? "<ele>" + elevation + "</ele>" : "";
  return '<wpt lat="' + latitude + '" lon="' + longitude + '">' + ele
    + "<name>" + xmlEscape(point.name) + "</name></wpt>";
}
function buildGpx(trail: Record<string, unknown>, checkpoints: Record<string, unknown>[], route: RouteParse): string {
  const waypoints = checkpoints.map((point) => gpxWayPoint(point))
    .filter((point): point is string => point !== null);
  const title = [trail.mountain_name, trail.name]
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join(" - ");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Akasha Outdoor" xmlns="http://www.topografix.com/GPX/1/1">',
    "<metadata><name>" + xmlEscape(title) + "</name></metadata>",
    ...waypoints,
    "<trk><name>" + xmlEscape(trail.name) + "</name>",
    ...route.segments.map((segment) => "<trkseg>" + segment.map((point) => gpxCoordinate(point)).join("") + "</trkseg>"),
    "</trk></gpx>",
  ].join("");
}
function csvSafeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "jalur";
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "SERVER_CONFIGURATION_MISSING" }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const url = new URL(request.url);
  const resource = (url.searchParams.get("resource") ?? "mountains").trim().toLowerCase();
  const limit = boundedInt(url.searchParams.get("limit"), 20, 1, 50);
  const offset = boundedInt(url.searchParams.get("offset"), 0, 0, 5000);
  if (limit === null || offset === null) return json({ error: "INVALID_PAGINATION", maxLimit: 50, maxOffset: 5000 }, 400);

  const q = normalizedSearch(url.searchParams.get("q"));
  const mountainSlugInput = url.searchParams.get("mountain_slug");
  const trailSlugInput = url.searchParams.get("trail_slug");
  const mountainSlug = slug(mountainSlugInput);
  const trailSlug = slug(trailSlugInput);
  if ((mountainSlugInput && !mountainSlug) || (trailSlugInput && !trailSlug)) return json({ error: "INVALID_SLUG" }, 400);

  try {
    const { data: flags, error: flagsError } = await supabase.from("hiking_feature_flags")
      .select("flag_key,is_enabled").in("flag_key", [
        "public_hiking_catalog_enabled", "bmkg_forecast_enabled", "bmkg_nowcast_alerts_enabled",
        "hiking_ticket_booking_enabled", "akasha_rental_booking_enabled",
      ]);
    if (flagsError || !flags) {
      console.error("hiking-catalog feature flag lookup failed", flagsError?.code ?? "FLAGS_MISSING");
      return json({ error: "FEATURE_FLAG_LOOKUP_FAILED" }, 503, { "Cache-Control": "no-store" });
    }
    const featureFlags = Object.fromEntries(flags.map((item: {flag_key: string; is_enabled: boolean}) => [item.flag_key, item.is_enabled]));

    // Weather alerts have their own independent rollout flag. All catalog and
    // availability resources stay fail-closed until the catalog release is approved.
    const catalogResources = new Set(["map", "mountains", "trails", "route-download", "checkpoints", "advisories", "media", "availability"]);
    if (catalogResources.has(resource) && featureFlags.public_hiking_catalog_enabled !== true) {
      return json({
        error: "FEATURE_DISABLED",
        feature: "public_hiking_catalog_enabled",
        resource,
        items: [],
      }, 503, { "Cache-Control": "no-store" });
    }


    // Map markers stay discoverable independently of route completeness.
    if (resource === "map") {
      let query = supabase.from("v_public_hiking_mountains")
        .select("mountain_id,slug,name,province,regency,latitude,longitude,elevation_m,volcanic_status", { count: "exact" })
        .not("latitude", "is", null).not("longitude", "is", null)
        .order("name", { ascending: true });
      if (q) query = query.ilike("name", "%" + q + "%");
      const province = normalizedPlace(url.searchParams.get("province"));
      if (province) query = query.ilike("province", "%" + province + "%");
      if (mountainSlug) query = query.eq("slug", mountainSlug);
      const { data, error, count } = await query.range(offset, offset + limit - 1);
      if (error) throw new Error("CATALOG_QUERY_FAILED");
      const items = data ?? [];
      return json({
        resource: "map",
        items,
        pagination: { limit, offset, total: count ?? 0, hasMore: (count ?? 0) > offset + items.length },
        map: { coordinateSystem: "WGS84", coordinateOrder: ["latitude", "longitude"], markerSource: "published_mountains" },
        interaction: { detailMayBeIncomplete: true, unavailableMessage: "Data belum tersedia." },
        sources: SOURCE,
      });
    }

    if (resource === "mountains") {
      let query = supabase.from("v_public_hiking_mountains").select("*", { count: "exact" }).order("name", { ascending: true });
      if (q) query = query.ilike("name", `%${q}%`);
      const province = normalizedPlace(url.searchParams.get("province"));
      if (province) query = query.ilike("province", "%" + province + "%");
      if (mountainSlug) query = query.eq("slug", mountainSlug);
      const { data, error, count } = await query.range(offset, offset + limit - 1);
      if (error) throw new Error("CATALOG_QUERY_FAILED");
      const rows = (data ?? []).map((mountain: Record<string, unknown>) => ({
        ...mountain,
        dataAvailability: {
          coordinates: mountain.latitude !== null && mountain.latitude !== undefined
            && mountain.longitude !== null && mountain.longitude !== undefined,
          description: typeof mountain.description === "string" && mountain.description.trim().length > 0,
          elevation: mountain.elevation_m !== null && mountain.elevation_m !== undefined,
          verified: mountain.verified_at !== null && mountain.verified_at !== undefined,
        },
      }));
      return json({
        resource, items: rows, pagination: { limit, offset, total: count ?? 0, hasMore: (count ?? 0) > offset + rows.length },
        featureFlags: { publicHikingCatalogEnabled: Boolean(featureFlags.public_hiking_catalog_enabled) },
        dataAvailability: { status: rows.length ? "available_or_partial" : (mountainSlug ? "not_found" : "empty"), message: rows.length ? null : "Data gunung belum tersedia." },
        sources: SOURCE,
      });
    }

    if (resource === "trails") {
      let query = supabase.from("v_public_hiking_trails").select("*", { count: "exact" }).order("mountain_name").order("name");
      if (q) query = query.ilike("name", `%${q}%`);
      if (mountainSlug) query = query.eq("mountain_slug", mountainSlug);
      if (trailSlug) query = query.eq("slug", trailSlug);
      const { data, error, count } = await query.range(offset, offset + limit - 1);
      if (error) throw new Error("CATALOG_QUERY_FAILED");
      if (trailSlug && mountainSlug && (data?.length ?? 0) === 0) return json({ error: "TRAIL_NOT_FOUND" }, 404);
      const rows = (data ?? []).map((trail: Record<string, unknown>) => {
        const route = parsePublicRoute(trail.route_geojson);
        const routeAvailable = route.segments.length > 0 && !route.tooMany;
        return {
          ...trail,
          dataAvailability: {
            routeGeoJson: routeAvailable,
            gpxDownload: routeAvailable,
            offlineGps: routeAvailable,
            status: routeAvailable ? "available" : "not_available",
            message: routeAvailable ? null : "Data jalur/GPX belum tersedia.",
            gpxResource: routeAvailable ? {
              resource: "route-download",
              mountain_slug: trail.mountain_slug,
              trail_slug: trail.slug,
            } : null,
          },
        };
      });
      return json({
        resource, items: rows,
        pagination: { limit, offset, total: count ?? 0, hasMore: (count ?? 0) > offset + rows.length },
        dataAvailability: { status: rows.length ? "available_or_partial" : (mountainSlug ? "not_available" : "empty"), message: rows.length ? null : "Data jalur belum tersedia." },
        offlineGps: { formats: ["GeoJSON", "GPX"], requiresDownloadBeforeOffline: true },
        sources: SOURCE,
      });
    }

    if (resource === "route-download") {
      if (!mountainSlug || !trailSlug) {
        return json({ error: "ROUTE_QUERY_REQUIRED", message: "Gunakan mountain_slug dan trail_slug." }, 400);
      }
      const { data: trail, error: trailError } = await supabase.from("v_public_hiking_trails")
        .select("trail_id,slug,name,mountain_slug,mountain_name,route_geojson,verified_at,route_source_reference_url")
        .eq("mountain_slug", mountainSlug).eq("slug", trailSlug).maybeSingle();
      if (trailError) throw new Error("CATALOG_QUERY_FAILED");
      if (!trail) return json({ error: "TRAIL_NOT_FOUND", message: "Data jalur belum tersedia." }, 404);
      const route = parsePublicRoute(trail.route_geojson);
      if (route.tooMany) return json({ error: "ROUTE_TOO_COMPLEX", message: "Rute terlalu besar untuk diunduh dengan aman." }, 413);
      if (!route.segments.length || route.pointCount < 2) {
        return json({ error: "ROUTE_DATA_UNAVAILABLE", message: "Data GPX belum tersedia untuk jalur ini." }, 404);
      }
      const { data: checkpoints, error: checkpointError } = await supabase.from("v_public_hiking_checkpoints")
        .select("name,latitude,longitude,elevation_m,sequence_number")
        .eq("trail_id", trail.trail_id).order("sequence_number", { ascending: true }).limit(2000);
      if (checkpointError) console.error("hiking route download checkpoint lookup failed", checkpointError.code ?? "DB_ERROR");
      const gpx = buildGpx(trail as Record<string, unknown>, (checkpoints ?? []) as Record<string, unknown>[], route);
      const etag = '"' + await sha256Hex(gpx) + '"';
      const filename = csvSafeSlug(String(trail.mountain_slug)) + "-" + csvSafeSlug(String(trail.slug)) + ".gpx";
      const headers = {
        ...corsHeaders,
        "Content-Type": "application/gpx+xml; charset=utf-8",
        "Content-Disposition": 'attachment; filename="' + filename + '"',
        "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
        "X-Route-Offline-Ready": "true",
      };
      if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
      return new Response(gpx, { status: 200, headers });
    }

    if (resource === "checkpoints") {
      if (!trailSlug || !mountainSlug) return json({ error: "TRAIL_CONTEXT_REQUIRED", message: "Gunakan mountain_slug dan trail_slug." }, 400);
      const { data: trail, error: trailError } = await supabase.from("v_public_hiking_trails")
        .select("trail_id").eq("mountain_slug", mountainSlug).eq("slug", trailSlug).maybeSingle();
      if (trailError) throw new Error("CATALOG_QUERY_FAILED");
      if (!trail) return json({ error: "TRAIL_NOT_FOUND" }, 404);
      const { data, error, count } = await supabase.from("v_public_hiking_checkpoints")
        .select("*", { count: "exact" }).eq("trail_id", trail.trail_id).order("sequence_number").range(offset, offset + limit - 1);
      if (error) throw new Error("CATALOG_QUERY_FAILED");
      return json({ resource, items: data ?? [], pagination: { limit, offset, total: count ?? 0, hasMore: (count ?? 0) > offset + (data?.length ?? 0) }, sources: SOURCE });
    }

    if (resource === "alerts") {
      if (!featureFlags.bmkg_nowcast_alerts_enabled) return json({ resource, items: [], status: "disabled", source: SOURCE.bmkg });
      let query = supabase.from("v_public_hiking_weather_alerts").select("*").order("effective_at", { ascending: false }).limit(limit);
      if (q) query = query.ilike("headline", `%${q}%`);
      const { data, error } = await query;
      if (error) throw new Error("ALERT_QUERY_FAILED");
      const province = normalizedPlace(url.searchParams.get("province"));
      const items = province ? (data ?? []).filter((item: Record<string, unknown>) => {
        const areas = Array.isArray(item.affected_areas) ? item.affected_areas as Record<string, unknown>[] : [];
        return areas.some((area) =>
          normalizedPlaceMatch(area.province, province) || normalizedPlaceMatch(area.description, province)
        );
      }) : (data ?? []);
      return json({ resource, items: items.slice(0, limit), checkedAt: new Date().toISOString(), source: SOURCE.bmkg });
    }

    if (resource === "advisories") {
      let query = supabase.from("v_public_hiking_safety_advisories").select("*").order("starts_at", { ascending: false });
      if (mountainSlug) query = query.eq("mountain_slug", mountainSlug);
      if (trailSlug) query = query.eq("trail_slug", trailSlug);
      if (q) query = query.ilike("title", `%${q}%`);
      const { data, error, count } = await query.range(offset, offset + limit - 1);
      if (error) throw new Error("ADVISORY_QUERY_FAILED");
      return json({ resource, items: data ?? [], pagination: { limit, offset, total: count ?? 0, hasMore: (count ?? 0) > offset + (data?.length ?? 0) }, sources: SOURCE });
    }

    if (resource === "media") {
      let query = supabase.from("v_public_hiking_media").select("*").order("sort_order", { ascending: true });
      if (mountainSlug) query = query.eq("mountain_slug", mountainSlug);
      if (trailSlug) query = query.eq("trail_slug", trailSlug);
      const { data, error, count } = await query.range(offset, offset + limit - 1);
      if (error) throw new Error("MEDIA_QUERY_FAILED");
      const rows = data ?? [];
      const items = await Promise.all(rows.map(async (media: Record<string, unknown>) => {
        const bucket = String(media.bucket_id ?? "");
        const path = String(media.storage_path ?? "");
        if (bucket !== "hiking-public-media" || !path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
          throw new Error("MEDIA_STORAGE_REFERENCE_INVALID");
        }
        const { data: signed, error: signError } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
        if (signError || !signed?.signedUrl) {
          console.error("Hiking media URL signing failed", signError?.name ?? "SIGNING_FAILED");
          throw new Error("MEDIA_SIGNED_URL_FAILED");
        }
        return {
          ...media,
          mediaUrl: signed.signedUrl,
          mediaUrlExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        };
      }));
      return json({
        resource, items,
        pagination: { limit, offset, total: count ?? 0, hasMore: (count ?? 0) > offset + rows.length },
        mediaDelivery: { mode: "short_lived_signed_url", ttlSeconds: 300 },
      });
    }

    if (resource === "availability") {
      const date = url.searchParams.get("date");
      if (!trailSlug || !mountainSlug || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return json({ error: "AVAILABILITY_QUERY_REQUIRED", message: "Gunakan mountain_slug, trail_slug, dan date=YYYY-MM-DD." }, 400);
      }
      const { data: trail, error: trailError } = await supabase.from("v_public_hiking_trails")
        .select("trail_id").eq("mountain_slug", mountainSlug).eq("slug", trailSlug).maybeSingle();
      if (trailError) throw new Error("CATALOG_QUERY_FAILED");
      if (!trail) return json({ error: "TRAIL_NOT_FOUND" }, 404);
      const { data, error } = await supabase.from("v_public_hiking_availability")
        .select("*").eq("trail_id", trail.trail_id).eq("hiking_date", date).maybeSingle();
      if (error) throw new Error("AVAILABILITY_QUERY_FAILED");
      return json({
        resource, item: data ?? null,
        status: data ? "official_snapshot" : "unavailable_or_not_verified",
        warning: "Data kuota adalah snapshot yang diverifikasi, bukan jaminan ketersediaan real-time. Ini bukan pemesanan dan tidak menahan kuota.",
      });
    }

    return json({
      error: "UNKNOWN_RESOURCE",
      supportedResources: ["map", "mountains", "trails", "route-download", "checkpoints", "alerts", "advisories", "media", "availability"],
    }, 400);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
    console.error("hiking-catalog failed:", code);
    if (code === "MEDIA_SIGNED_URL_FAILED") {
      return json({ error: code }, 503, { "Cache-Control": "no-store", "Retry-After": "30" });
    }
    if (code === "FEATURE_FLAG_LOOKUP_FAILED") {
      return json({ error: code }, 503, { "Cache-Control": "no-store", "Retry-After": "30" });
    }
    return json({ error: code.includes("QUERY_FAILED") ? code : "INTERNAL_ERROR" }, 500);
  }
});
