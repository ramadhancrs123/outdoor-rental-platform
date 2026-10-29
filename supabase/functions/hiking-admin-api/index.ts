import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Vary": "Origin",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Max-Age": "86400",
};

const restrictedOrigins = new Set([
  "https://akasha-outdoor.vercel.app",
  "https://rental-web-din-media.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
]);
function withRestrictedCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.delete("Access-Control-Allow-Origin");
  const origin = request.headers.get("Origin");
  if (origin && restrictedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, x-request-id");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

type Obj = Record<string, unknown>;
type Admin = { akun_admin_id: string; role: string; status: string };
const allowedFlags = new Set(["public_hiking_catalog_enabled", "bmkg_forecast_enabled", "bmkg_nowcast_alerts_enabled"]);
const sourcePermissionValues = new Set(["verified_open", "permission_granted", "permission_required", "unknown", "restricted"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function isObj(value: unknown): value is Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max: number, required = false): string | null {
  if (typeof value !== "string") return required ? "" : null;
  const valueText = value.trim();
  if (!valueText && !required) return null;
  return valueText.slice(0, max);
}
function uuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
function requiredUuid(value: unknown, key: string): string {
  const result = uuid(value);
  if (!result) throw new HttpError(400, "INVALID_" + key.toUpperCase());
  return result;
}
function safeHttps(value: unknown, key: string, required = false): string | null {
  const valueText = text(value, 1000, required);
  if (!valueText) return null;
  try {
    const url = new URL(valueText);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url.toString();
  } catch {
    throw new HttpError(400, "INVALID_HTTPS_URL_" + key.toUpperCase());
  }
}
function slug(value: unknown): string {
  const result = String(value ?? "").trim().toLowerCase();
  if (result.length < 2 || result.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) {
    throw new HttpError(400, "INVALID_SLUG");
  }
  return result;
}
function numberOrNull(value: unknown, min: number, max: number, key: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const valueNumber = Number(value);
  if (!Number.isFinite(valueNumber) || valueNumber < min || valueNumber > max) throw new HttpError(400, "INVALID_" + key.toUpperCase());
  return valueNumber;
}

function integerOrNull(value: unknown, min: number, max: number, key: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const valueNumber = Number(value);
  if (!Number.isSafeInteger(valueNumber) || valueNumber < min || valueNumber > max) {
    throw new HttpError(400, "INVALID_" + key.toUpperCase());
  }
  return valueNumber;
}

function isoDateTimeOrNull(value: unknown, key: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > Date.now() + 60_000) {
    throw new HttpError(400, "INVALID_" + key.toUpperCase());
  }
  return parsed.toISOString();
}
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function errorCode(error: unknown): string {
  if (isObj(error) && typeof error.code === "string") return error.code;
  if (error instanceof HttpError) return error.message;
  return "INTERNAL_ERROR";
}

async function readAdmin(request: Request, service: ReturnType<typeof createClient>): Promise<{ admin: Admin; userId: string }> {
  const bearer = request.headers.get("Authorization") ?? "";
  const tokenMatch = bearer.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) throw new HttpError(401, "AUTHENTICATION_REQUIRED");
  const { data: authData, error: authError } = await service.auth.getUser(tokenMatch[1]);
  if (authError || !authData.user) throw new HttpError(401, "INVALID_SESSION");
  const { data, error } = await service.from("akun_admin")
    .select("akun_admin_id,role,status")
    .eq("auth_user_id", authData.user.id)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new HttpError(500, "ADMIN_IDENTITY_LOOKUP_FAILED");
  if (!data || data.role !== "super_admin") throw new HttpError(403, "SUPER_ADMIN_REQUIRED");
  return { admin: data as Admin, userId: authData.user.id };
}
async function audit(service: ReturnType<typeof createClient>, adminId: string, action: string, targetType: string, targetId: string | null, details: Obj = {}) {
  const safeDetails: Obj = {};
  for (const [key, value] of Object.entries(details)) {
    if (/token|secret|password|key|private|gpx|raw|payload|phone|name|email/i.test(key)) continue;
    if (["string", "number", "boolean"].includes(typeof value) || value === null) safeDetails[key] = typeof value === "string" ? value.slice(0, 180) : value;
  }
  const { error } = await service.from("hiking_admin_audit").insert({
    actor_admin_id: adminId, action, target_type: targetType, target_id: targetId, safe_details: safeDetails,
  });
  if (error) console.error("hiking admin audit write failed", error.code ?? "DB_ERROR");
}
function registrableHost(value: string): string {
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host)) return host;
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return host;
  const countrySecondLevels = new Set([
    "ac.id","co.id","go.id","mil.id","net.id","or.id","sch.id","web.id",
    "ac.uk","co.uk","gov.uk","ltd.uk","me.uk","net.uk","org.uk","plc.uk","sch.uk",
    "ac.au","asn.au","com.au","edu.au","gov.au","id.au","net.au","org.au",
    "ac.nz","co.nz","geek.nz","gen.nz","govt.nz","iwi.nz","kiwi.nz","maori.nz","net.nz","org.nz",
    "ac.jp","co.jp","go.jp","ne.jp","or.jp",
    "ac.kr","co.kr","go.kr","ne.kr","or.kr",
    "com.br","gov.br","net.br","org.br",
    "ac.in","co.in","firm.in","gen.in","gov.in","ind.in","net.in","org.in","res.in",
    "com.my","gov.my","net.my","org.my",
    "com.ph","gov.ph","net.ph","org.ph",
    "com.sg","gov.sg","net.sg","org.sg",
    "co.th","go.th","in.th","or.th",
  ]);
  const lastTwo = labels.slice(-2).join(".");
  return countrySecondLevels.has(lastTwo) && labels.length >= 3
    ? labels.slice(-3).join(".")
    : labels.slice(-2).join(".");
}

async function ensureSourceAllowed(service: ReturnType<typeof createClient>, sourceId: string | null, referenceUrl: string | null) {
  if (!sourceId) throw new HttpError(409, "SOURCE_REQUIRED");
  if (!referenceUrl) throw new HttpError(409, "SOURCE_REFERENCE_REQUIRED");
  let referenceHost: string;
  try {
    const reference = new URL(referenceUrl);
    if (reference.protocol !== "https:" || reference.username || reference.password) throw new Error();
    referenceHost = registrableHost(reference.toString());
  } catch {
    throw new HttpError(400, "SOURCE_REFERENCE_MUST_USE_HTTPS");
  }
  const { data, error } = await service.from("hiking_data_sources")
    .select("source_id,source_url,source_type,permission_status,is_active")
    .eq("source_id", sourceId).maybeSingle();
  if (error) throw new HttpError(500, "SOURCE_LOOKUP_FAILED");
  if (!data || data.is_active !== true || !["verified_open", "permission_granted"].includes(data.permission_status)) {
    throw new HttpError(409, "SOURCE_PERMISSION_NOT_CLEARED");
  }
  let canonicalHost: string;
  try {
    const canonical = new URL(String(data.source_url ?? ""));
    if (canonical.protocol !== "https:" || canonical.username || canonical.password) throw new Error();
    canonicalHost = registrableHost(canonical.toString());
  } catch {
    throw new HttpError(409, "SOURCE_CANONICAL_URL_INVALID");
  }
  if (referenceHost !== canonicalHost) throw new HttpError(409, "SOURCE_REFERENCE_DOMAIN_MISMATCH");
  return data;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}
function detectedHikingImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8,12)) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4,8)) === "ftyp"
      && ["avif","avis"].includes(String.fromCharCode(...bytes.slice(8,12)))) return "image/avif";
  return null;
}

async function assertSourceHasNoPublishedDependents(service: ReturnType<typeof createClient>, sourceId: string) {
  const checks = await Promise.all([
    service.from("hiking_mountains").select("mountain_id",{count:"exact",head:true}).eq("primary_source_id",sourceId).eq("publication_status","published"),
    service.from("hiking_mountains").select("mountain_id",{count:"exact",head:true}).eq("volcanic_status_source_id",sourceId).eq("publication_status","published").neq("volcanic_status","unknown"),
    service.from("hiking_trails").select("trail_id",{count:"exact",head:true}).eq("route_source_id",sourceId).eq("publication_status","published"),
    service.from("hiking_trails").select("trail_id",{count:"exact",head:true}).eq("operational_status_source_id",sourceId).eq("publication_status","published").neq("operational_status","unknown"),
    service.from("hiking_trails").select("trail_id",{count:"exact",head:true}).eq("difficulty_grade_source_id",sourceId).eq("publication_status","published").not("difficulty_grade","is",null),
    service.from("hiking_checkpoints").select("checkpoint_id",{count:"exact",head:true}).eq("source_id",sourceId).eq("publication_status","published"),
    service.from("hiking_checkpoints").select("checkpoint_id",{count:"exact",head:true}).eq("elevation_source_id",sourceId).eq("publication_status","published"),
    service.from("hiking_safety_advisories").select("advisory_id",{count:"exact",head:true}).eq("source_id",sourceId).eq("publication_status","published"),
    service.from("hiking_media").select("media_id",{count:"exact",head:true}).eq("source_id",sourceId).eq("publication_status","published"),
    service.from("hiking_operators").select("operator_id",{count:"exact",head:true}).eq("source_id",sourceId).eq("is_public",true).eq("verification_status","verified"),
  ]);
  if (checks.some((item) => item.error)) throw new HttpError(500,"SOURCE_DEPENDENCY_CHECK_FAILED");
  const count = checks.reduce((total,item) => total + (item.count ?? 0),0);
  if (count > 0) throw new HttpError(409,"SOURCE_HAS_PUBLISHED_DEPENDENTS_WITHDRAW_FIRST");
}

async function count(service: ReturnType<typeof createClient>, table: string, column = "id") {
  const { count, error } = await service.from(table).select(column, { count: "exact", head: true });
  if (error) throw new HttpError(500, "OVERVIEW_QUERY_FAILED");
  return count ?? 0;
}

const readResources = {
  mountains: { table: "hiking_mountains", pk: "mountain_id", select: "*", order: "updated_at", search: ["name", "code", "slug", "province", "regency"], filters: ["publication_status"] },
  trails: { table: "hiking_trails", pk: "trail_id", select: "*", order: "updated_at", search: ["name", "code", "slug", "basecamp_name"], filters: ["mountain_id", "publication_status", "operational_status"] },
  checkpoints: { table: "hiking_checkpoints", pk: "checkpoint_id", select: "*", order: "sequence_number", search: ["name", "code"], filters: ["trail_id", "publication_status"] },
  sources: { table: "hiking_data_sources", pk: "source_id", select: "source_id,code,name,source_type,source_url,attribution_text,license_name,license_url,permission_status,is_public,is_active,notes,created_at,updated_at", order: "name", search: ["name", "code", "source_url"], filters: ["source_type", "permission_status", "is_active"] },
  weatherAreas: { table: "hiking_weather_areas", pk: "weather_area_id", select: "*", order: "province_name", search: ["village_name", "district_name", "regency_name", "province_name", "adm4_code"], filters: ["is_active", "province_name"] },
  advisories: { table: "hiking_safety_advisories", pk: "advisory_id", select: "*", order: "updated_at", search: ["title", "description", "advisory_type"], filters: ["mountain_id", "trail_id", "publication_status", "severity"] },
  routeImports: { table: "hiking_route_imports", pk: "import_id", select: "import_id,trail_id,source_id,original_filename,content_sha256,file_format,source_version,source_reference_url,license_review_status,import_status,point_count,segment_count,calculated_distance_m,validation_report,reviewed_by_admin_id,reviewed_at,created_at,updated_at", order: "created_at", search: ["original_filename", "source_version"], filters: ["trail_id", "license_review_status", "import_status"] },
  routeVersions: { table: "hiking_route_versions", pk: "route_version_id", select: "route_version_id,trail_id,import_id,version_number,route_geojson,distance_m,elevation_gain_m,checkpoint_snapshot,metadata_snapshot,source_id,source_reference_url,source_version,license_review_status,validation_report,change_reason,created_by_admin_id,created_at", order: "created_at", search: ["source_version", "change_reason"], filters: ["trail_id"] },
  media: { table: "hiking_media", pk: "media_id", select: "media_id,mountain_id,trail_id,bucket_id,storage_path,media_type,alt_text,caption,sort_order,source_id,source_reference_url,permission_status,publication_status,content_sha256,created_at,updated_at,published_at", order: "sort_order", search: ["alt_text", "caption", "media_type"], filters: ["mountain_id", "trail_id", "publication_status", "media_type"] },
  operators: { table: "hiking_operators", pk: "operator_id", select: "*", order: "name", search: ["name", "code", "province", "regency"], filters: ["operator_type", "verification_status", "is_public"] },
  featureFlags: { table: "hiking_feature_flags", pk: "flag_key", select: "flag_key,is_enabled,description,updated_at", order: "flag_key", search: ["flag_key", "description"], filters: [] },
  weatherAlerts: { table: "hiking_weather_alerts", pk: "alert_id", select: "alert_id,identifier,sender,sent_at,status,message_type,category,event,urgency,severity,certainty,headline,description,instruction,effective_at,onset_at,expires_at,web_url,source_url,last_fetched_at", order: "sent_at", search: ["headline", "event", "severity"], filters: ["status", "message_type"] },
} as const;

async function readAdminResource(service: ReturnType<typeof createClient>, url: URL): Promise<Response> {
  const resource = url.searchParams.get("resource") ?? "overview";
  const page = Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1));
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50));
  const id = url.searchParams.get("id");
  const search = (url.searchParams.get("search") ?? "").trim().replace(/[,%()"\\]/g, " ").replace(/\s+/g, " ").slice(0, 120);

  if (resource === "mountainWeatherMappings" || resource === "trailWeatherMappings") {
    const isMountain = resource === "mountainWeatherMappings";
    const table = isMountain ? "hiking_mountain_weather_areas" : "hiking_trail_weather_areas";
    const targetColumn = isMountain ? "mountain_id" : "trail_id";
    let query: any = service.from(table).select("*", { count: "exact" });
    const targetId = url.searchParams.get(targetColumn) ?? url.searchParams.get("target_id");
    if (targetId) query = query.eq(targetColumn, targetId);
    if (id) query = query.eq(targetColumn, id);
    const result = await query.order("is_primary", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw new HttpError(500, "ADMIN_READ_FAILED");
    const rows = (result.data ?? []) as Obj[];
    const areaIds = [...new Set(rows.map((row) => String(row.weather_area_id ?? "")).filter(Boolean))];
    const areasResult = areaIds.length
      ? await service.from("hiking_weather_areas").select("weather_area_id,adm4_code,village_name,district_name,regency_name,province_name,latitude,longitude,is_active").in("weather_area_id", areaIds)
      : { data: [], error: null };
    if (areasResult.error) throw new HttpError(500, "ADMIN_READ_FAILED");
    const areas = new Map(((areasResult.data ?? []) as Obj[]).map((area) => [String(area.weather_area_id), area]));
    const items = rows.map((row) => ({ ...row, target_type: isMountain ? "mountain" : "trail", weather_area: areas.get(String(row.weather_area_id)) ?? null }));
    return json({ resource, items, total: result.count ?? items.length, page, pageSize });
  }

  const config = (readResources as Record<string, { table: string; pk: string; select: string; order: string; search: readonly string[]; filters: readonly string[] }>)[resource];
  if (!config) throw new HttpError(400, "UNKNOWN_RESOURCE");
  if (id && resource !== "featureFlags" && !uuid(id)) throw new HttpError(400, "INVALID_ID");
  let query: any = service.from(config.table).select(config.select, { count: "exact" });
  if (id) query = query.eq(config.pk, id);
  for (const filter of config.filters) {
    const value = url.searchParams.get(filter);
    if (value !== null && value.trim() !== "") query = query.eq(filter, value);
  }
  if (search && config.search.length) {
    const predicate = config.search.map((column) => `${column}.ilike.%${search.replace(/\*/g, "")}%`).join(",");
    query = query.or(predicate);
  }
  query = query.order(config.order, { ascending: config.order === "name" || config.order === "province_name" || config.order === "sequence_number" || config.order === "flag_key" }).range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count: total } = await query;
  if (error) throw new HttpError(500, "ADMIN_READ_FAILED");
  let items = (data ?? []) as Obj[];

  if (resource === "media") {
    items = await Promise.all(items.map(async (row) => {
      const bucket = String(row.bucket_id ?? "");
      const path = String(row.storage_path ?? "");
      const { storage_path: _storagePath, bucket_id: _bucketId, ...safeRow } = row;
      if (!bucket || !path || !["hiking-media-staging", "hiking-public-media"].includes(bucket)) return { ...safeRow, preview_url: null };
      const { data: signed, error: signedError } = await service.storage.from(bucket).createSignedUrl(path, 300);
      if (signedError) console.error("hiking media preview URL failed", signedError.name ?? "STORAGE_ERROR");
      return { ...safeRow, preview_url: signed?.signedUrl ?? null };
    }));
  }
  if (resource === "featureFlags") {
    items = items.map((row) => ({ ...row, isLocked: ["hiking_ticket_booking_enabled", "akasha_rental_booking_enabled"].includes(String(row.flag_key)) }));
  }
  return json({ resource, items, total: total ?? items.length, page, pageSize });
}

async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  const allowedOrigins = new Set([
    "https://akasha-outdoor.vercel.app",
    "https://rental-web-din-media.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
  ]);
  const headers = { ...corsHeaders, "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://akasha-outdoor.vercel.app", "Vary": "Origin" };
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "SERVER_CONFIGURATION_MISSING" }, 500);
  const service = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let admin: Admin;
  try {
    ({ admin } = await readAdmin(request, service));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return json({ error: errorCode(error) }, status);
  }

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const resource = url.searchParams.get("resource") ?? "overview";
      if (resource !== "overview") return await readAdminResource(service, url);
      const tables = [
        ["mountains", "hiking_mountains", "mountain_id"],
        ["trails", "hiking_trails", "trail_id"],
        ["checkpoints", "hiking_checkpoints", "checkpoint_id"],
        ["sources", "hiking_data_sources", "source_id"],
        ["weatherAreas", "hiking_weather_areas", "weather_area_id"],
        ["advisories", "hiking_safety_advisories", "advisory_id"],
        ["routeImports", "hiking_route_imports", "import_id"],
        ["routeVersions", "hiking_route_versions", "route_version_id"],
        ["media", "hiking_media", "media_id"],
        ["bookingProviders", "hiking_booking_providers", "provider_id"],
      ] as const;
      const counts: Record<string, number> = {};
      for (const [key, table, pk] of tables) counts[key] = await count(service, table, pk);
      const { data: drafts, error: draftsError } = await service.from("hiking_mountains")
        .select("mountain_id,code,slug,name,province,regency,publication_status,verified_at,created_at")
        .neq("publication_status", "published").order("created_at", { ascending: false }).limit(30);
      if (draftsError) throw new HttpError(500, "DRAFT_QUEUE_QUERY_FAILED");
      const { data: flags, error: flagsError } = await service.from("hiking_feature_flags").select("flag_key,is_enabled,description,updated_at").order("flag_key");
      if (flagsError) throw new HttpError(500, "FEATURE_FLAG_QUERY_FAILED");
      return json({
        resource: "overview",
        generatedAt: new Date().toISOString(),
        counts,
        mountainReviewQueue: drafts ?? [],
        featureFlags: (flags ?? []).map((flag: Obj) => ({
          ...flag,
          isLocked: ["hiking_ticket_booking_enabled", "akasha_rental_booking_enabled"].includes(String(flag.flag_key)),
        })),
        policy: {
          bookingEnabled: false,
          bookingActivationAllowedByThisApi: false,
          privilegedRole: "active super_admin",
          message: "Fitur pemesanan dan pembayaran tiket tetap dinonaktifkan selama tahap persiapan.",
        },
      });
    }

    const textBody = await request.text();
    if (textBody.length > 1_100_000) return json({ error: "REQUEST_TOO_LARGE" }, 413);
    let body: unknown;
    try { body = JSON.parse(textBody); } catch { return json({ error: "INVALID_JSON" }, 400); }
    if (!isObj(body)) return json({ error: "INVALID_BODY" }, 400);
    const action = text(body.action, 64, true) as string;
    let targetType = action;
    let targetId: string | null = null;
    let result: unknown;

    switch (action) {
      case "upsert_source": {
        const code = text(body.code, 80, true) as string;
        const name = text(body.name, 180, true) as string;
        const sourceType = text(body.source_type, 40, true) as string;
        const permissionStatus = text(body.permission_status, 40, false) ?? "unknown";
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(code) || !["official_agency","basemap","trail_network","gpx_archive","elevation_dem","weather_forecast","weather_alert","ticket_provider","community","other"].includes(sourceType) || !sourcePermissionValues.has(permissionStatus)) {
          throw new HttpError(400, "INVALID_SOURCE_FIELDS");
        }
        const payload = {
          code, name, source_type: sourceType,
          source_url: safeHttps(body.source_url, "source", true),
          attribution_text: text(body.attribution_text, 500),
          license_name: text(body.license_name, 180),
          license_url: safeHttps(body.license_url, "license"),
          permission_status: permissionStatus,
          is_public: body.is_public === true,
          is_active: body.is_active !== false,
          notes: text(body.notes, 2000),
          updated_at: new Date().toISOString(),
        };
        const sourceId = uuid(body.source_id);
        if (sourceId && (payload.is_active !== true || !["verified_open","permission_granted"].includes(payload.permission_status))) {
          await assertSourceHasNoPublishedDependents(service,sourceId);
        }
        const query = sourceId
          ? service.from("hiking_data_sources").update(payload).eq("source_id", sourceId).select("*").single()
          : service.from("hiking_data_sources").insert(payload).select("*").single();
        const { data, error } = await query;
        if (error) throw new HttpError(409, "SOURCE_SAVE_FAILED");
        result = data; targetId = data.source_id; break;
      }

      case "upsert_mountain": {
        const mountainId = uuid(body.mountain_id);
        const code = text(body.code, 40, true)!.toUpperCase();
        const name = text(body.name, 180, true) as string;
        const isVolcanic = body.is_volcanic === true;
        const sourceId = uuid(body.primary_source_id);
        const referenceUrl = safeHttps(body.source_reference_url, "mountain_source");
        const aliases = Array.isArray(body.aliases) ? body.aliases.filter((x) => typeof x === "string").map((x) => String(x).trim().slice(0,100)).filter(Boolean).slice(0,30) : [];
        const volcanicStatusCheckedAt = isVolcanic ? isoDateTimeOrNull(body.volcanic_status_checked_at,"volcanic_status_checked_at") : null;
        const payload = {
          code, slug: slug(body.slug), name,
          aliases, description: text(body.description, 10000),
          elevation_m: integerOrNull(body.elevation_m, 0, 9000, "elevation_m"),
          province: text(body.province, 100), regency: text(body.regency, 120),
          latitude: numberOrNull(body.latitude, -90, 90, "latitude"),
          longitude: numberOrNull(body.longitude, -180, 180, "longitude"),
          is_volcanic: isVolcanic,
          volcanic_status: isVolcanic ? (text(body.volcanic_status, 30) ?? "unknown") : "not_applicable",
          volcanic_status_source_id: isVolcanic ? uuid(body.volcanic_status_source_id) : null,
          volcanic_status_source_url: isVolcanic ? safeHttps(body.volcanic_status_source_url, "volcano_source") : null,
          volcanic_status_checked_at: volcanicStatusCheckedAt,
          operator_id: uuid(body.operator_id), primary_source_id: sourceId, source_reference_url: referenceUrl,
          publication_status: "draft", published_at: null, verified_at: null, updated_at: new Date().toISOString(),
        };
        if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)) throw new HttpError(400, "INVALID_MOUNTAIN_CODE");
        if (!["normal","waspada","siaga","awas","unknown","not_applicable"].includes(payload.volcanic_status)
            || (isVolcanic && payload.volcanic_status === "not_applicable")) throw new HttpError(400, "INVALID_VOLCANIC_STATUS");
        const query = mountainId
          ? service.from("hiking_mountains").update(payload).eq("mountain_id", mountainId).select("*").single()
          : service.from("hiking_mountains").insert(payload).select("*").single();
        const { data, error } = await query;
        if (error) throw new HttpError(409, "MOUNTAIN_SAVE_FAILED");
        result = data; targetId = data.mountain_id; break;
      }

      case "upsert_trail": {
        const trailId = uuid(body.trail_id);
        const mountainId = requiredUuid(body.mountain_id, "mountain_id");
        const code = text(body.code, 40);
        const difficultyGradeStatus = text(body.difficulty_grade_status, 40) ?? "not_assessed";
        const suppliedDifficultyGrade = integerOrNull(body.difficulty_grade, 1, 5, "difficulty_grade");
        const difficultyGradeSourceId = uuid(body.difficulty_grade_source_id);
        const difficultyGradeSourceUrl = safeHttps(body.difficulty_grade_source_url, "difficulty_source");
        if (["official","operator_verified"].includes(difficultyGradeStatus) && suppliedDifficultyGrade !== null
            && (!difficultyGradeSourceId || !difficultyGradeSourceUrl)) {
          throw new HttpError(400,"DIFFICULTY_GRADE_SOURCE_REQUIRED");
        }
        const payload = {
          mountain_id: mountainId,
          operator_id: uuid(body.operator_id),
          code: code ? code.toUpperCase() : null,
          slug: slug(body.slug),
          name: text(body.name, 180, true),
          description: text(body.description, 10000),
          basecamp_name: text(body.basecamp_name, 180),
          basecamp_address: text(body.basecamp_address, 500),
          basecamp_latitude: numberOrNull(body.basecamp_latitude, -90, 90, "basecamp_latitude"),
          basecamp_longitude: numberOrNull(body.basecamp_longitude, -180, 180, "basecamp_longitude"),
          distance_m: integerOrNull(body.distance_m, 0, 2000000, "distance_m"),
          elevation_gain_m: integerOrNull(body.elevation_gain_m, 0, 100000, "elevation_gain_m"),
          estimated_duration_minutes: integerOrNull(body.estimated_duration_minutes, 1, 100000, "duration"),
          // Never persist an unverified numeric grade to a row that may later be public.
          difficulty_grade: ["official","operator_verified"].includes(difficultyGradeStatus) ? suppliedDifficultyGrade : null,
          difficulty_grade_status: difficultyGradeStatus,
          difficulty_grade_source_id: difficultyGradeSourceId,
          difficulty_grade_source_url: difficultyGradeSourceUrl,
          daily_quota: integerOrNull(body.daily_quota, 0, 1000000, "daily_quota"),
          quota_source_url: safeHttps(body.quota_source_url, "quota_source"),
          publication_status: "draft", published_at: null, verified_at: null,
          updated_at: new Date().toISOString(),
        };
        if (!["official","operator_verified","community_reference","not_assessed"].includes(payload.difficulty_grade_status)) throw new HttpError(400, "INVALID_DIFFICULTY_STATUS");
        const query = trailId
          ? service.from("hiking_trails").update(payload).eq("trail_id", trailId).select("*").single()
          : service.from("hiking_trails").insert(payload).select("*").single();
        const { data, error } = await query;
        if (error) throw new HttpError(409, "TRAIL_SAVE_FAILED");
        result = data; targetId = data.trail_id; break;
      }

      case "upsert_checkpoint": {
        const checkpointId = uuid(body.checkpoint_id);
        const trailId = requiredUuid(body.trail_id, "trail_id");
        const payload = {
          trail_id: trailId, sequence_number: integerOrNull(body.sequence_number,0,100000,"sequence_number"),
          code: text(body.code, 40), name: text(body.name,180,true), checkpoint_type: text(body.checkpoint_type,40) ?? "waypoint",
          description: text(body.description,2000),
          latitude: numberOrNull(body.latitude,-90,90,"latitude"), longitude: numberOrNull(body.longitude,-180,180,"longitude"),
          elevation_m: integerOrNull(body.elevation_m,-500,9000,"elevation_m"),
          elevation_source_id: uuid(body.elevation_source_id), elevation_source_url: safeHttps(body.elevation_source_url,"elevation_source"),
          source_id: uuid(body.source_id), source_reference_url: safeHttps(body.source_reference_url,"source_reference"),
          publication_status: "draft", verified_at: null, updated_at: new Date().toISOString(),
        };
        if (payload.sequence_number === null || payload.latitude === null || payload.longitude === null) throw new HttpError(400,"CHECKPOINT_COORDINATES_REQUIRED");
        const query = checkpointId
          ? service.from("hiking_checkpoints").update(payload).eq("checkpoint_id",checkpointId).select("*").single()
          : service.from("hiking_checkpoints").insert(payload).select("*").single();
        const {data,error}=await query;
        if(error) throw new HttpError(409,"CHECKPOINT_SAVE_FAILED");
        result=data; targetId=data.checkpoint_id; break;
      }

      case "upsert_weather_area": {
        const adm4 = text(body.adm4_code, 20, true) as string;
        if (!/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(adm4)) throw new HttpError(400,"INVALID_ADM4_CODE");
        const payload = {
          adm4_code: adm4, village_name: text(body.village_name,180,true),
          district_name: text(body.district_name,180), regency_name: text(body.regency_name,180),
          province_name: text(body.province_name,180,true),
          latitude: numberOrNull(body.latitude,-90,90,"latitude"), longitude: numberOrNull(body.longitude,-180,180,"longitude"),
          source_url:"https://data.bmkg.go.id/prakiraan-cuaca/", is_active: body.is_active !== false, updated_at:new Date().toISOString(),
        };
        const {data,error}=await service.from("hiking_weather_areas").upsert(payload,{onConflict:"adm4_code"}).select("*").single();
        if(error) throw new HttpError(409,"WEATHER_AREA_SAVE_FAILED");
        result=data; targetId=data.weather_area_id; break;
      }

      case "map_weather_area": {
        const targetKind = body.target_type;
        if (targetKind !== "mountain" && targetKind !== "trail") throw new HttpError(400,"INVALID_TARGET_TYPE");
        const targetIdValue = requiredUuid(body[targetIdField], targetIdField);
        const areaId = requiredUuid(body.weather_area_id,"weather_area_id");
        const evidenceUrl = safeHttps(body.source_reference_url,"weather_mapping_source",true);
        const purpose = text(body.purpose,30) ?? (targetKind === "mountain" ? "reference" : "basecamp");
        const allowedPurpose = targetKind === "mountain" ? ["basecamp","mountain_foot","nearby","reference"] : ["basecamp","trail_head","nearby","reference"];
        if (!allowedPurpose.includes(purpose)) throw new HttpError(400,"INVALID_MAPPING_PURPOSE");
        const {data,error}=await service.rpc("hiking_admin_map_weather_area",{
          p_target_type:targetKind,
          p_target_id:targetIdValue,
          p_weather_area_id:areaId,
          p_purpose:purpose,
          p_is_primary:body.is_primary===true,
          p_source_reference_url:evidenceUrl,
          p_actor_admin_id:admin.akun_admin_id,
        });
        if(error) {
          const message=String(error.message ?? "");
          if(message.includes("WEATHER_AREA_NOT_FOUND")) throw new HttpError(404,"WEATHER_AREA_NOT_FOUND");
          if(message.includes("MOUNTAIN_NOT_FOUND")) throw new HttpError(404,"MOUNTAIN_NOT_FOUND");
          if(message.includes("TRAIL_NOT_FOUND")) throw new HttpError(404,"TRAIL_NOT_FOUND");
          if(message.includes("WEATHER_AREA_INACTIVE")) throw new HttpError(409,"WEATHER_AREA_INACTIVE");
          if(message.includes("ACTIVE_SUPER_ADMIN_REQUIRED")) throw new HttpError(403,"SUPER_ADMIN_REQUIRED");
          throw new HttpError(409,"WEATHER_MAPPING_SAVE_FAILED");
        }
        result=data; targetId=targetIdValue; break;
      }

      case "set_trail_status": {
        const trailId=requiredUuid(body.trail_id,"trail_id");
        const status=text(body.operational_status,40,true) as string;
        const verifyStatus=text(body.verification_status,40) ?? "unverified";
        const sourceId=uuid(body.source_id);
        const sourceUrl=safeHttps(body.source_url,"status_source");
        if(!["open","closed","limited","temporarily_suspended","unknown"].includes(status)) throw new HttpError(400,"INVALID_TRAIL_STATUS");
        if(!["official","operator_verified","community_reference","unverified"].includes(verifyStatus)) throw new HttpError(400,"INVALID_STATUS_VERIFICATION");
        if(status!=="unknown") {
          if(!["official","operator_verified"].includes(verifyStatus)) throw new HttpError(409,"VERIFIED_SOURCE_REQUIRED_FOR_PUBLIC_TRAIL_STATUS");
          if(!sourceId || !sourceUrl) throw new HttpError(400,"TRAIL_STATUS_SOURCE_REQUIRED");
          const source=await ensureSourceAllowed(service,sourceId,sourceUrl);
          if(verifyStatus==="official" && source.source_type!=="official_agency") throw new HttpError(409,"OFFICIAL_TRAIL_STATUS_REQUIRES_OFFICIAL_AGENCY_SOURCE");
        }
        const {data,error}=await service.rpc("hiking_admin_set_trail_status",{
          p_trail_id:trailId,p_new_status:status,p_source_id:sourceId,p_source_url:sourceUrl,
          p_verification_status:verifyStatus,p_notes:text(body.notes,2000),p_actor_admin_id:admin.akun_admin_id,
        });
        if(error) throw new HttpError(409,"TRAIL_STATUS_UPDATE_FAILED");
        result={history_id:data,trail_id:trailId,operational_status:status}; targetId=trailId; break;
      }

      case "verify_mountain": {
        const mountainId=requiredUuid(body.mountain_id,"mountain_id");
        const sourceId=requiredUuid(body.source_id,"source_id");
        const sourceUrl=safeHttps(body.source_reference_url,"mountain_source",true);
        await ensureSourceAllowed(service,sourceId,sourceUrl);
        const {data,error}=await service.from("hiking_mountains").update({
          primary_source_id:sourceId,source_reference_url:sourceUrl,
          verified_at:new Date().toISOString(),updated_at:new Date().toISOString(),
        }).eq("mountain_id",mountainId).select("mountain_id,verified_at").single();
        if(error) throw new HttpError(409,"MOUNTAIN_VERIFICATION_FAILED");
        result=data; targetId=mountainId; break;
      }

      case "verify_trail": {
        const trailId=requiredUuid(body.trail_id,"trail_id");
        const sourceId=requiredUuid(body.source_id,"source_id");
        const sourceUrl=safeHttps(body.source_reference_url,"trail_source",true);
        await ensureSourceAllowed(service,sourceId,sourceUrl);
        const {data:trail,error:readError}=await service.from("hiking_trails")
          .select("trail_id,route_geojson,difficulty_grade,difficulty_grade_status,difficulty_grade_source_id,difficulty_grade_source_url").eq("trail_id",trailId).maybeSingle();
        if(readError) throw new HttpError(500,"TRAIL_LOOKUP_FAILED");
        if(!trail || !trail.route_geojson) throw new HttpError(409,"VERIFIED_ROUTE_REQUIRED");
        if(trail.difficulty_grade!==null) {
          if(!["official","operator_verified"].includes(String(trail.difficulty_grade_status))
              || !trail.difficulty_grade_source_id || !trail.difficulty_grade_source_url)
            throw new HttpError(409,"DIFFICULTY_GRADE_SOURCE_REQUIRED");
          await ensureSourceAllowed(service,trail.difficulty_grade_source_id,trail.difficulty_grade_source_url);
        }
        const {data,error}=await service.from("hiking_trails").update({
          route_source_id:sourceId,route_source_reference_url:sourceUrl,
          verified_at:new Date().toISOString(),updated_at:new Date().toISOString(),
        }).eq("trail_id",trailId).select("trail_id,verified_at,route_source_id").single();
        if(error) throw new HttpError(409,"TRAIL_VERIFICATION_FAILED");
        result=data; targetId=trailId; break;
      }

      case "save_advisory": {
        const advisoryId=uuid(body.advisory_id);
        const mountainId=uuid(body.mountain_id);
        const trailId=uuid(body.trail_id);
        if(Boolean(mountainId)===Boolean(trailId)) throw new HttpError(400,"ADVISORY_EXACTLY_ONE_TARGET");
        const startsAt=body.starts_at ? new Date(String(body.starts_at)) : new Date();
        const expiresAt=body.expires_at ? new Date(String(body.expires_at)) : null;
        if(Number.isNaN(startsAt.getTime()) || (expiresAt && Number.isNaN(expiresAt.getTime())) || (expiresAt && expiresAt <= startsAt)) throw new HttpError(400,"INVALID_ADVISORY_DATES");
        const advisoryType=text(body.advisory_type,40,true) as string;
        const severity=text(body.severity,20) ?? "info";
        if(!["closure","weather","landslide","flood","wildfire","volcanic","earthquake","wildlife","infrastructure","health","other"].includes(advisoryType) || !["info","watch","warning","critical"].includes(severity)) throw new HttpError(400,"INVALID_ADVISORY_CLASSIFICATION");
        const payload={
          mountain_id:mountainId,trail_id:trailId,advisory_type:advisoryType,severity,
          title:text(body.title,240,true),description:text(body.description,12000,true),instruction:text(body.instruction,6000),
          source_id:uuid(body.source_id),source_url:safeHttps(body.source_url,"advisory_source"),
          official_source:body.official_source===true,verification_status:"unverified",publication_status:"draft",
          verified_at:null,published_at:null,
          starts_at:startsAt.toISOString(),expires_at:expiresAt?.toISOString()??null,
          recorded_by_admin_id:admin.akun_admin_id,updated_at:new Date().toISOString(),
        };
        const query=advisoryId
          ? service.from("hiking_safety_advisories").update(payload).eq("advisory_id",advisoryId).select("*").single()
          : service.from("hiking_safety_advisories").insert(payload).select("*").single();
        const {data,error}=await query;
        if(error) throw new HttpError(409,"ADVISORY_SAVE_FAILED");
        result=data;targetId=data.advisory_id;break;
      }

      case "publish_mountain": {
        const mountainId=requiredUuid(body.mountain_id,"mountain_id");
        const {data:mountain,error:readError}=await service.from("hiking_mountains")
          .select("mountain_id,name,elevation_m,latitude,longitude,primary_source_id,source_reference_url,verified_at,publication_status,is_volcanic,volcanic_status,volcanic_status_source_id,volcanic_status_source_url,volcanic_status_checked_at")
          .eq("mountain_id",mountainId).maybeSingle();
        if(readError) throw new HttpError(500,"MOUNTAIN_LOOKUP_FAILED");
        if(!mountain) throw new HttpError(404,"MOUNTAIN_NOT_FOUND");
        if(!mountain.verified_at || !mountain.primary_source_id || !mountain.source_reference_url || !mountain.name || mountain.elevation_m===null || mountain.latitude===null || mountain.longitude===null) throw new HttpError(409,"MOUNTAIN_METADATA_INCOMPLETE");
        await ensureSourceAllowed(service,mountain.primary_source_id,mountain.source_reference_url);
        if(mountain.is_volcanic===true && mountain.volcanic_status!=="unknown") {
          const checkedAt=mountain.volcanic_status_checked_at ? Date.parse(String(mountain.volcanic_status_checked_at)) : NaN;
          if(!mountain.volcanic_status_source_id || !mountain.volcanic_status_source_url || !Number.isFinite(checkedAt))
            throw new HttpError(409,"VOLCANIC_STATUS_SOURCE_REQUIRED");
          if(checkedAt>Date.now()+60_000 || Date.now()-checkedAt>24*60*60*1000)
            throw new HttpError(409,"VOLCANIC_STATUS_STALE");
          await ensureSourceAllowed(service,mountain.volcanic_status_source_id,mountain.volcanic_status_source_url);
        }
        const now=new Date().toISOString();
        const {data,error}=await service.from("hiking_mountains").update({publication_status:"published",published_at:now,updated_at:now})
          .eq("mountain_id",mountainId).select("mountain_id,slug,name,publication_status,published_at").single();
        if(error) throw new HttpError(409,"MOUNTAIN_PUBLISH_FAILED");
        result=data;targetId=mountainId;break;
      }

      case "publish_trail": {
        const trailId=requiredUuid(body.trail_id,"trail_id");
        const {data:trail,error:readError}=await service.from("hiking_trails")
          .select("trail_id,mountain_id,name,route_geojson,route_source_id,route_source_reference_url,verified_at,publication_status,difficulty_grade,difficulty_grade_status,difficulty_grade_source_id,difficulty_grade_source_url")
          .eq("trail_id",trailId).maybeSingle();
        if(readError) throw new HttpError(500,"TRAIL_LOOKUP_FAILED");
        if(!trail) throw new HttpError(404,"TRAIL_NOT_FOUND");
        if(!trail.route_geojson || !trail.verified_at || !trail.route_source_id || !trail.route_source_reference_url) throw new HttpError(409,"TRAIL_ROUTE_NOT_VERIFIED");
        await ensureSourceAllowed(service,trail.route_source_id,trail.route_source_reference_url);
        if(trail.difficulty_grade!==null) {
          if(!["official","operator_verified"].includes(String(trail.difficulty_grade_status))
              || !trail.difficulty_grade_source_id || !trail.difficulty_grade_source_url)
            throw new HttpError(409,"DIFFICULTY_GRADE_SOURCE_REQUIRED");
          await ensureSourceAllowed(service,trail.difficulty_grade_source_id,trail.difficulty_grade_source_url);
        }
        const {data:mountain,error:mountainError}=await service.from("hiking_mountains").select("publication_status").eq("mountain_id",trail.mountain_id).maybeSingle();
        if(mountainError) throw new HttpError(500,"MOUNTAIN_LOOKUP_FAILED");
        if(mountain?.publication_status!=="published") throw new HttpError(409,"PARENT_MOUNTAIN_NOT_PUBLISHED");
        const now=new Date().toISOString();
        const {data,error}=await service.from("hiking_trails").update({publication_status:"published",published_at:now,updated_at:now})
          .eq("trail_id",trailId).select("trail_id,slug,name,publication_status,published_at").single();
        if(error) throw new HttpError(409,"TRAIL_PUBLISH_FAILED");
        result=data;targetId=trailId;break;
      }

      case "publish_checkpoint": {
        const checkpointId=requiredUuid(body.checkpoint_id,"checkpoint_id");
        const {data:checkpoint,error:readError}=await service.from("hiking_checkpoints")
          .select("checkpoint_id,trail_id,source_id,source_reference_url,publication_status")
          .eq("checkpoint_id",checkpointId).maybeSingle();
        if(readError) throw new HttpError(500,"CHECKPOINT_LOOKUP_FAILED");
        if(!checkpoint) throw new HttpError(404,"CHECKPOINT_NOT_FOUND");
        if(!checkpoint.source_id||!checkpoint.source_reference_url) throw new HttpError(409,"CHECKPOINT_SOURCE_REQUIRED");
        await ensureSourceAllowed(service,checkpoint.source_id,checkpoint.source_reference_url);
        const {data:trail,error:trailError}=await service.from("hiking_trails").select("publication_status,mountain_id")
          .eq("trail_id",checkpoint.trail_id).maybeSingle();
        if(trailError) throw new HttpError(500,"TRAIL_LOOKUP_FAILED");
        if(trail?.publication_status!=="published") throw new HttpError(409,"PARENT_TRAIL_NOT_PUBLISHED");
        const {data:parentMountain,error:parentMountainError}=await service.from("hiking_mountains")
          .select("publication_status").eq("mountain_id",trail.mountain_id).maybeSingle();
        if(parentMountainError) throw new HttpError(500,"MOUNTAIN_LOOKUP_FAILED");
        if(parentMountain?.publication_status!=="published") throw new HttpError(409,"PARENT_MOUNTAIN_NOT_PUBLISHED");
        const now=new Date().toISOString();
        const {data,error}=await service.from("hiking_checkpoints").update({
          publication_status:"published",verified_at:now,updated_at:now,
        }).eq("checkpoint_id",checkpointId).select("checkpoint_id,trail_id,name,sequence_number,publication_status,verified_at").single();
        if(error) throw new HttpError(409,"CHECKPOINT_PUBLISH_FAILED");
        result=data;targetId=checkpointId;break;
      }

      case "publish_advisory": {
        const advisoryId=requiredUuid(body.advisory_id,"advisory_id");
        const {data:a,error:readError}=await service.from("hiking_safety_advisories").select("*").eq("advisory_id",advisoryId).maybeSingle();
        if(readError) throw new HttpError(500,"ADVISORY_LOOKUP_FAILED");
        if(!a) throw new HttpError(404,"ADVISORY_NOT_FOUND");
        if(!a.source_id || !a.source_url) throw new HttpError(409,"ADVISORY_SOURCE_REQUIRED");
        const {data:source,error:sourceError}=await service.from("hiking_data_sources").select("source_id,is_active,source_type,permission_status").eq("source_id",a.source_id).maybeSingle();
        if(sourceError || !source || !source.is_active || !["verified_open","permission_granted"].includes(String(source.permission_status)))
          throw new HttpError(409,"ADVISORY_SOURCE_INVALID");
        await ensureSourceAllowed(service,a.source_id,a.source_url);
        if(a.official_source===true && !["official_agency","weather_alert","weather_forecast"].includes(String(source.source_type)))
          throw new HttpError(409,"OFFICIAL_ADVISORY_SOURCE_REQUIRED");
        if(a.mountain_id) {
          const {data:parent,error:parentError}=await service.from("hiking_mountains").select("publication_status")
            .eq("mountain_id",a.mountain_id).maybeSingle();
          if(parentError) throw new HttpError(500,"MOUNTAIN_LOOKUP_FAILED");
          if(parent?.publication_status!=="published") throw new HttpError(409,"PARENT_MOUNTAIN_NOT_PUBLISHED");
        } else if(a.trail_id) {
          const {data:parent,error:parentError}=await service.from("hiking_trails").select("publication_status,mountain_id")
            .eq("trail_id",a.trail_id).maybeSingle();
          if(parentError) throw new HttpError(500,"TRAIL_LOOKUP_FAILED");
          if(parent?.publication_status!=="published") throw new HttpError(409,"PARENT_TRAIL_NOT_PUBLISHED");
          const {data:parentMountain,error:mountainError}=await service.from("hiking_mountains").select("publication_status")
            .eq("mountain_id",parent.mountain_id).maybeSingle();
          if(mountainError) throw new HttpError(500,"MOUNTAIN_LOOKUP_FAILED");
          if(parentMountain?.publication_status!=="published") throw new HttpError(409,"PARENT_MOUNTAIN_NOT_PUBLISHED");
        }
        const now=new Date().toISOString();
        const verifyStatus=a.official_source===true ? "official" : "operator_verified";
        const {data,error}=await service.from("hiking_safety_advisories").update({
          verification_status:verifyStatus,verified_at:now,publication_status:"published",published_at:now,updated_at:now,
        }).eq("advisory_id",advisoryId).select("advisory_id,title,publication_status,verified_at,published_at").single();
        if(error) throw new HttpError(409,"ADVISORY_PUBLISH_FAILED");
        result=data;targetId=advisoryId;break;
      }

      case "publish_media": {
        // A public Storage bucket bypasses row-level checks on object downloads.
        // Do not copy new media into that bucket before the catalog release is enabled.
        const {data:catalogFlag,error:catalogFlagError}=await service.from("hiking_feature_flags")
          .select("is_enabled").eq("flag_key","public_hiking_catalog_enabled").maybeSingle();
        if(catalogFlagError || !catalogFlag) throw new HttpError(503,"FEATURE_FLAG_LOOKUP_FAILED");
        if(catalogFlag.is_enabled !== true) throw new HttpError(409,"PUBLIC_CATALOG_DISABLED");
        const mediaId=requiredUuid(body.media_id,"media_id");
        const {data:media,error:readError}=await service.from("hiking_media").select("*").eq("media_id",mediaId).maybeSingle();
        if(readError) throw new HttpError(500,"MEDIA_LOOKUP_FAILED");
        if(!media) throw new HttpError(404,"MEDIA_NOT_FOUND");
        if(!media.source_id || !media.source_reference_url || !["verified_open","permission_granted"].includes(media.permission_status)) throw new HttpError(409,"MEDIA_PERMISSION_NOT_CLEARED");
        await ensureSourceAllowed(service,media.source_id,media.source_reference_url);
        if(media.bucket_id!=="hiking-media-staging" && media.bucket_id!=="hiking-public-media") throw new HttpError(409,"MEDIA_BUCKET_INVALID");
        if(!media.storage_path || media.storage_path.startsWith("/") || media.storage_path.includes("..") || media.storage_path.includes("\\")) throw new HttpError(409,"MEDIA_PATH_INVALID");
        if(!/^[a-f0-9]{64}$/i.test(String(media.content_sha256 ?? ""))) throw new HttpError(409,"MEDIA_CHECKSUM_REQUIRED");
        if(Boolean(media.mountain_id)===Boolean(media.trail_id)) throw new HttpError(409,"MEDIA_TARGET_INVALID");
        if(media.mountain_id) {
          const {data:parent,error:parentError}=await service.from("hiking_mountains").select("publication_status")
            .eq("mountain_id",media.mountain_id).maybeSingle();
          if(parentError) throw new HttpError(500,"MOUNTAIN_LOOKUP_FAILED");
          if(parent?.publication_status!=="published") throw new HttpError(409,"MEDIA_PARENT_NOT_PUBLISHED");
        } else {
          const {data:parent,error:parentError}=await service.from("hiking_trails").select("publication_status,mountain_id")
            .eq("trail_id",media.trail_id).maybeSingle();
          if(parentError) throw new HttpError(500,"TRAIL_LOOKUP_FAILED");
          if(parent?.publication_status!=="published") throw new HttpError(409,"MEDIA_PARENT_NOT_PUBLISHED");
          const {data:parentMountain,error:mountainError}=await service.from("hiking_mountains").select("publication_status")
            .eq("mountain_id",parent.mountain_id).maybeSingle();
          if(mountainError) throw new HttpError(500,"MOUNTAIN_LOOKUP_FAILED");
          if(parentMountain?.publication_status!=="published") throw new HttpError(409,"MEDIA_PARENT_NOT_PUBLISHED");
        }
        const sourceBucket=String(media.bucket_id);
        const publicPath=String(media.storage_path);
        const {data:file,error:downloadError}=await service.storage.from(sourceBucket).download(publicPath);
        if(downloadError || !file) throw new HttpError(500,"MEDIA_SOURCE_OBJECT_UNAVAILABLE");
        const bytes=new Uint8Array(await file.arrayBuffer());
        const mime=detectedHikingImageMime(bytes);
        if(!mime || (file.type && file.type!==mime)) throw new HttpError(415,"MEDIA_CONTENT_TYPE_MISMATCH");
        const actualHash=await sha256Hex(bytes);
        if(actualHash.toLowerCase()!==String(media.content_sha256).toLowerCase()) throw new HttpError(409,"MEDIA_CHECKSUM_MISMATCH");
        const stagedObjectExists=sourceBucket==="hiking-media-staging";
        if(stagedObjectExists){
          const {error:uploadError}=await service.storage.from("hiking-public-media").upload(publicPath,new Blob([bytes],{type:mime}),{
            contentType:mime,upsert:true,cacheControl:"60",
          });
          if(uploadError) throw new HttpError(500,"MEDIA_PUBLIC_PUBLISH_FAILED");
        }
        const now=new Date().toISOString();
        const {data,error}=await service.from("hiking_media").update({
          bucket_id:"hiking-public-media",verified_by_admin_id:admin.akun_admin_id,
          verified_at:now,publication_status:"published",published_at:now,updated_at:now,
        }).eq("media_id",mediaId).select("media_id,bucket_id,storage_path,publication_status,published_at,content_sha256").single();
        if(error){
          if(stagedObjectExists) {
            const {error:cleanupError}=await service.storage.from("hiking-public-media").remove([publicPath]);
            if(cleanupError) {
              await audit(service,admin.akun_admin_id,"publish_media_rollback_cleanup_pending","media",mediaId,{outcome:"failed",reason:"public_object_cleanup_pending"});
              throw new HttpError(503,"MEDIA_PUBLIC_ROLLBACK_CLEANUP_PENDING");
            }
          }
          throw new HttpError(409,"MEDIA_PUBLISH_FAILED");
        }
        let stagingCleanupPending=false;
        if(stagedObjectExists) {
          const {error:stagingCleanupError}=await service.storage.from("hiking-media-staging").remove([publicPath]);
          if(stagingCleanupError) {
            stagingCleanupPending=true;
            console.error("Hiking staging object cleanup pending",mediaId);
          }
        }
        result={...data,stagingCleanupPending,mediaDelivery:"short_lived_signed_url"};
        targetId=mediaId;break;
      }

      case "set_feature_flag": {
        const key=text(body.flag_key,80,true) as string;
        if(!allowedFlags.has(key)) throw new HttpError(403,"FEATURE_FLAG_LOCKED_OR_UNKNOWN");
        if(typeof body.is_enabled!=="boolean") throw new HttpError(400,"BOOLEAN_IS_ENABLED_REQUIRED");
        const {data,error}=await service.from("hiking_feature_flags").update({is_enabled:body.is_enabled,updated_at:new Date().toISOString()})
          .eq("flag_key",key).select("flag_key,is_enabled,updated_at").single();
        if(error) throw new HttpError(409,"FEATURE_FLAG_UPDATE_FAILED");
        result=data;targetType="feature_flag";break;
      }

      case "archive_media": {
        const mediaId=requiredUuid(body.media_id,"media_id");
        const {data:media,error:readError}=await service.from("hiking_media")
          .select("media_id,bucket_id,storage_path,publication_status")
          .eq("media_id",mediaId).maybeSingle();
        if(readError) throw new HttpError(500,"MEDIA_LOOKUP_FAILED");
        if(!media) throw new HttpError(404,"MEDIA_NOT_FOUND");
        if(!["hiking-media-staging","hiking-public-media"].includes(String(media.bucket_id))
            || !media.storage_path || String(media.storage_path).startsWith("/")
            || String(media.storage_path).includes("..") || String(media.storage_path).includes("\\")) {
          throw new HttpError(409,"MEDIA_STORAGE_REFERENCE_INVALID");
        }
        const {data:archived,error:archiveError}=await service.from("hiking_media")
          .update({publication_status:"archived",updated_at:new Date().toISOString()})
          .eq("media_id",mediaId).select("media_id,bucket_id,storage_path,publication_status").single();
        if(archiveError || !archived) throw new HttpError(409,"ARCHIVE_FAILED");
        const {error:removeError}=await service.storage.from(String(media.bucket_id)).remove([String(media.storage_path)]);
        if(removeError) {
          await audit(service,admin.akun_admin_id,"archive_media_cleanup_pending","media",mediaId,{outcome:"failed",reason:"storage_cleanup_pending"});
          throw new HttpError(503,"MEDIA_STORAGE_CLEANUP_PENDING");
        }
        result={media_id:mediaId,publication_status:"archived",storage_object_removed:true};
        targetId=mediaId;break;
      }

      case "archive_mountain":
      case "archive_trail":
      case "archive_advisory": {
        const map:Record<string,{table:string;pk:string}> = {
          archive_mountain:{table:"hiking_mountains",pk:"mountain_id"},
          archive_trail:{table:"hiking_trails",pk:"trail_id"},
          archive_advisory:{table:"hiking_safety_advisories",pk:"advisory_id"},
          archive_media:{table:"hiking_media",pk:"media_id"},
        };
        const item=map[action]; const id=requiredUuid(body[item.pk],item.pk); const now=new Date().toISOString();
        if(action==="archive_mountain" || action==="archive_trail") {
          let rows: Obj[] = [];
          if(action==="archive_mountain") {
            const {data:mountainMedia,error:mountainMediaError}=await service.from("hiking_media")
              .select("media_id,bucket_id,storage_path").eq("mountain_id",id);
            if(mountainMediaError) throw new HttpError(500,"MEDIA_ARCHIVE_LOOKUP_FAILED");
            rows.push(...((mountainMedia??[]) as Obj[]));
            const {data:trails,error:trailsError}=await service.from("hiking_trails").select("trail_id").eq("mountain_id",id);
            if(trailsError) throw new HttpError(500,"TRAIL_ARCHIVE_LOOKUP_FAILED");
            const trailIds=(trails??[]).map((trail:Obj)=>String(trail.trail_id));
            if(trailIds.length) {
              const {data:trailMedia,error:trailMediaError}=await service.from("hiking_media")
                .select("media_id,bucket_id,storage_path").in("trail_id",trailIds);
              if(trailMediaError) throw new HttpError(500,"MEDIA_ARCHIVE_LOOKUP_FAILED");
              rows.push(...((trailMedia??[]) as Obj[]));
            }
            rows=[...new Map(rows.map((row:Obj)=>[String(row.media_id),row])).values()];
          } else {
            const {data:mediaRows,error:mediaReadError}=await service.from("hiking_media")
              .select("media_id,bucket_id,storage_path").eq("trail_id",id);
            if(mediaReadError) throw new HttpError(500,"MEDIA_ARCHIVE_LOOKUP_FAILED");
            rows=(mediaRows??[]) as Obj[];
          }
          for(const media of rows) {
            if(!["hiking-media-staging","hiking-public-media"].includes(String(media.bucket_id))
                || !media.storage_path || String(media.storage_path).startsWith("/")
                || String(media.storage_path).includes("..") || String(media.storage_path).includes("\\")) {
              throw new HttpError(409,"MEDIA_STORAGE_REFERENCE_INVALID");
            }
          }
          if(rows.length) {
            const ids=rows.map((media:Obj)=>String(media.media_id));
            const {error:mediaArchiveError}=await service.from("hiking_media").update({publication_status:"archived",updated_at:now}).in("media_id",ids);
            if(mediaArchiveError) throw new HttpError(409,"MEDIA_ARCHIVE_FAILED");
            const byBucket=new Map<string,string[]>();
            for(const media of rows) {
              const bucket=String(media.bucket_id);
              const paths=byBucket.get(bucket)??[];
              paths.push(String(media.storage_path));byBucket.set(bucket,paths);
            }
            for(const [bucket,paths] of byBucket) {
              const {error:removeError}=await service.storage.from(bucket).remove(paths);
              if(removeError) {
                await audit(service,admin.akun_admin_id,"archive_parent_media_cleanup_pending",action,id,{outcome:"failed",reason:"storage_cleanup_pending",mediaCount:paths.length});
                throw new HttpError(503,"MEDIA_STORAGE_CLEANUP_PENDING");
              }
            }
          }
        }
        const {data,error}=await service.from(item.table).update({publication_status:"archived",published_at:null,updated_at:now}).eq(item.pk,id).select(item.pk+",publication_status,updated_at").single();
        if(error) throw new HttpError(409,"ARCHIVE_FAILED");
        result=data;targetId=id;break;
      }

      case "upsert_operator": {
        const operatorId=uuid(body.operator_id);
        const operatorType=text(body.operator_type,40) ?? "other";
        if(!["national_park","nature_park","forest_area","basecamp","community","ticket_vendor","other"].includes(operatorType)) throw new HttpError(400,"INVALID_OPERATOR_TYPE");
        const payload={
          code:text(body.code,80),name:text(body.name,200,true),operator_type:operatorType,
          province:text(body.province,100),regency:text(body.regency,120),address:text(body.address,1000),
          public_phone:text(body.public_phone,60),public_email:text(body.public_email,180),
          website_url:safeHttps(body.website_url,"operator_website"),
          official_booking_url:safeHttps(body.official_booking_url,"operator_booking"),
          verification_status:"unverified",is_public:false,
          source_id:uuid(body.source_id),source_reference_url:safeHttps(body.source_reference_url,"operator_source"),
          verified_at:null,updated_at:new Date().toISOString(),
        };
        const query=operatorId
          ? service.from("hiking_operators").update(payload).eq("operator_id",operatorId).select("*").single()
          : service.from("hiking_operators").insert(payload).select("*").single();
        const {data,error}=await query;
        if(error) throw new HttpError(409,"OPERATOR_SAVE_FAILED");
        result=data;targetId=data.operator_id;break;
      }

      case "verify_operator": {
        const operatorId=requiredUuid(body.operator_id,"operator_id");
        const sourceId=requiredUuid(body.source_id,"source_id");
        const sourceUrl=safeHttps(body.source_reference_url,"operator_source",true);
        await ensureSourceAllowed(service,sourceId,sourceUrl);
        const now=new Date().toISOString();
        const {data,error}=await service.from("hiking_operators").update({
          source_id:sourceId,source_reference_url:sourceUrl,
          verification_status:"verified",is_public:body.is_public===true,verified_at:now,updated_at:now,
        }).eq("operator_id",operatorId).select("operator_id,name,verification_status,is_public,verified_at").single();
        if(error) throw new HttpError(409,"OPERATOR_VERIFICATION_FAILED");
        result=data;targetId=operatorId;break;
      }

      case "review_route_import": {
        const importId=requiredUuid(body.import_id,"import_id");
        const review=text(body.license_review_status,30,true) as string;
        if(!["approved","rejected","not_required"].includes(review)) throw new HttpError(400,"INVALID_LICENSE_REVIEW_STATUS");
        if(review==="not_required" && body.reason !== "clearly_original_or_public_domain") throw new HttpError(400,"NOT_REQUIRED_REASON_REQUIRED");
        const reviewNote=text(body.review_note,2000,true);
        const sourceReferenceUrl=safeHttps(body.source_reference_url,"route_import_source",review!=="rejected");
        const {data:imp,error:readError}=await service.from("hiking_route_imports")
          .select("import_id,trail_id,source_id,import_status").eq("import_id",importId).maybeSingle();
        if(readError) throw new HttpError(500,"IMPORT_LOOKUP_FAILED");
        if(!imp) throw new HttpError(404,"IMPORT_NOT_FOUND");
        if(imp.import_status==="accepted") throw new HttpError(409,"IMPORT_ALREADY_ACCEPTED");
        if(review==="approved" || review==="not_required") await ensureSourceAllowed(service,imp.source_id,sourceReferenceUrl);
        const {data,error}=await service.from("hiking_route_imports").update({
          license_review_status:review,source_reference_url:sourceReferenceUrl,
          import_status:review==="rejected"?"rejected":"pending_review",
          reviewed_by_admin_id:admin.akun_admin_id,reviewed_at:new Date().toISOString(),
          validation_report:{review_note:reviewNote,reviewed_license_status:review,review_reason:text(body.reason,100)},
          updated_at:new Date().toISOString(),
        }).eq("import_id",importId).select("import_id,trail_id,license_review_status,source_reference_url,import_status,reviewed_at").single();
        if(error) throw new HttpError(409,"IMPORT_REVIEW_FAILED");
        result=data;targetId=importId;break;
      }

      default:
        throw new HttpError(400,"UNKNOWN_ACTION");
    }

    await audit(service,admin.akun_admin_id,action,targetType,targetId,{
      outcome:"success",
      requestId:request.headers.get("x-request-id") ?? null,
      entityId:targetId,
    });
    return json({ ok:true, action, result, bookingEnabled:false });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = errorCode(error);
    console.error("hiking-admin-api request failed", actionFromRequest(request) + ":" + code);
    return json({ error:code }, status);
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (origin && !restrictedOrigins.has(origin)) {
    return new Response(JSON.stringify({ error: "ORIGIN_NOT_ALLOWED" }), { status: 403, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin" } });
  }
  return withRestrictedCors(await handleRequest(request), request);
});

function actionFromRequest(request: Request): string {
  return request.method === "GET" ? "GET" : "POST";
}
