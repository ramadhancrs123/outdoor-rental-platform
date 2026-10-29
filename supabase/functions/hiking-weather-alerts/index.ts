import { createClient } from "npm:@supabase/supabase-js@2";
import { XMLParser, XMLValidator } from "npm:fast-xml-parser@4.5.3";

const RSS_URL = "https://www.bmkg.go.id/alerts/nowcast/id";
const CACHE_WINDOW_MS = 5 * 60 * 1000;
const RETRY_WINDOW_MS = 60 * 1000;
const MAX_CAP_DETAILS_PER_REFRESH = 12;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Max-Age": "86400",
};

type RecordLike = Record<string, unknown>;
type FeedItem = { title: string; description: string; link: string; pubDate: string | null };
type ParsedArea = {
  area_description: string;
  province_name: string | null;
  regency_name: string | null;
  district_name: string | null;
  admin_codes: string[];
  area_geometry_geojson: RecordLike | null;
  altitude_m: number | null;
  ceiling_m: number | null;
};
const PROVINCE_ALIASES: Record<string, string[]> = {
  "aceh": ["aceh"],
  "sumatera utara": ["sumatera utara"],
  "sumatera barat": ["sumatera barat"],
  "riau": ["riau"],
  "kepulauan riau": ["kepulauan riau", "kep riau"],
  "jambi": ["jambi"],
  "sumatera selatan": ["sumatera selatan"],
  "kepulauan bangka belitung": ["kepulauan bangka belitung", "kep bangka belitung"],
  "bengkulu": ["bengkulu"],
  "lampung": ["lampung"],
  "dki jakarta": ["dki jakarta", "jakarta"],
  "banten": ["banten"],
  "jawa barat": ["jawa barat"],
  "jawa tengah": ["jawa tengah"],
  "daerah istimewa yogyakarta": ["daerah istimewa yogyakarta", "di yogyakarta", "yogyakarta"],
  "jawa timur": ["jawa timur"],
  "bali": ["bali"],
  "nusa tenggara barat": ["nusa tenggara barat", "ntb"],
  "nusa tenggara timur": ["nusa tenggara timur", "ntt"],
  "kalimantan barat": ["kalimantan barat"],
  "kalimantan tengah": ["kalimantan tengah"],
  "kalimantan selatan": ["kalimantan selatan"],
  "kalimantan timur": ["kalimantan timur"],
  "kalimantan utara": ["kalimantan utara"],
  "sulawesi utara": ["sulawesi utara"],
  "gorontalo": ["gorontalo"],
  "sulawesi tengah": ["sulawesi tengah"],
  "sulawesi barat": ["sulawesi barat"],
  "sulawesi selatan": ["sulawesi selatan"],
  "sulawesi tenggara": ["sulawesi tenggara"],
  "maluku": ["maluku"],
  "maluku utara": ["maluku utara"],
  "papua": ["papua"],
  "papua barat": ["papua barat"],
  "papua selatan": ["papua selatan"],
  "papua tengah": ["papua tengah"],
  "papua pegunungan": ["papua pegunungan"],
  "papua barat daya": ["papua barat daya"],
};
function resolveProvince(input: string): { canonical: string; aliases: string[] } | null {
  const key = norm(input);
  for (const [canonical, aliases] of Object.entries(PROVINCE_ALIASES)) {
    if (key === canonical || aliases.some((alias) => norm(alias) === key)) return { canonical, aliases };
  }
  return null;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  allowBooleanAttributes: false,
  removeNSPrefix: true,
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status >= 200 && status < 300
        ? "public, max-age=120, stale-while-revalidate=300"
        : "no-store",
    },
  });
}

function norm(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\bprovinsi\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function asObject(value: unknown): RecordLike | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as RecordLike;
}
function asArray<T = unknown>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result ? result : null;
}
function firstString(value: unknown): string | null {
  if (Array.isArray(value)) return firstString(value[0]);
  return str(value);
}
function textOrNull(value: unknown): string | null {
  const valueText = firstString(value);
  return valueText ? valueText.slice(0, 12000) : null;
}
function parseDate(value: unknown): string | null {
  const text = firstString(value);
  if (!text) return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function parseInteger(value: unknown): number | null {
  const text = firstString(value);
  if (!text) return null;
  const result = Number(text);
  return Number.isInteger(result) && result >= -500 && result <= 10000 ? result : null;
}
function parsePolygon(value: string): [number, number][] | null {
  const points: [number, number][] = [];
  for (const pair of value.trim().split(/\s+/)) {
    const [latRaw, lonRaw] = pair.split(",");
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    points.push([lon, lat]);
  }
  if (points.length < 3) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([first[0], first[1]]);
  return points.length >= 4 ? points : null;
}

function parseAreas(areaValue: unknown, province: string): ParsedArea[] {
  return asArray(areaValue).map((value) => {
    const area = asObject(value) ?? {};
    const polygons = asArray(area.polygon).map(firstString).filter((x): x is string => Boolean(x));
    const polygonCoords: [number, number][][][] = [];
    for (const raw of polygons) {
      const ring = parsePolygon(raw);
      if (ring) polygonCoords.push([ring]);
    }
    const geocodeNodes = asArray(area.geocode).map(asObject).filter((x): x is RecordLike => x !== null);
    const adminCodes = geocodeNodes.map((node) => firstString(node.value)).filter((x): x is string => Boolean(x));
    return {
      area_description: (firstString(area.areaDesc) ?? "Wilayah terdampak belum dirinci").slice(0, 2000),
      province_name: province,
      regency_name: null,
      district_name: null,
      admin_codes: adminCodes,
      area_geometry_geojson: polygonCoords.length ? { type: "MultiPolygon", coordinates: polygonCoords } : null,
      altitude_m: parseInteger(area.altitude),
      ceiling_m: parseInteger(area.ceiling),
    };
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function parseXml(xml: string): RecordLike {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("BMKG_XML_UNSAFE_OR_TOO_LARGE");
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error("BMKG_XML_INVALID");
  const root = asObject(xmlParser.parse(xml));
  if (!root) throw new Error("BMKG_XML_INVALID");
  return root;
}

function parseFeed(xml: string): FeedItem[] {
  const root = parseXml(xml);
  const rss = asObject(root.rss);
  const channel = asObject(rss?.channel);
  if (!channel) throw new Error("BMKG_RSS_INVALID");
  return asArray(channel.item).map((item) => {
    const record = asObject(item) ?? {};
    return {
      title: firstString(record.title) ?? "",
      description: firstString(record.description) ?? "",
      link: firstString(record.link) ?? "",
      pubDate: firstString(record.pubDate),
    };
  }).filter((item) => item.link.length > 0);
}

function parseCap(xml: string, province: string) {
  const root = parseXml(xml);
  const alert = asObject(root.alert);
  if (!alert) throw new Error("BMKG_CAP_INVALID");
  const infos = asArray(alert.info).map(asObject).filter((x): x is RecordLike => x !== null);
  const info = infos.find((item) => (firstString(item.language) ?? "").toLowerCase().startsWith("id")) ?? infos[0] ?? null;
  const status = firstString(alert.status) ?? "Actual";
  const messageType = firstString(alert.msgType) ?? "Alert";
  const references = firstString(alert.references) ?? "";
  const areas = info ? parseAreas(info.area, province) : [];
  return {
    record: {
      identifier: firstString(alert.identifier),
      sender: firstString(alert.sender),
      sent_at: parseDate(alert.sent),
      status,
      message_type: messageType,
      scope: firstString(alert.scope),
      category: info ? firstString(info.category) : null,
      event: info ? firstString(info.event) : null,
      urgency: info ? firstString(info.urgency) : null,
      severity: info ? firstString(info.severity) : null,
      certainty: info ? firstString(info.certainty) : null,
      headline: info ? textOrNull(info.headline) : null,
      description: info ? textOrNull(info.description) : null,
      instruction: info ? textOrNull(info.instruction) : null,
      language: info ? firstString(info.language) : "id",
      effective_at: info ? parseDate(info.effective) : null,
      onset_at: info ? parseDate(info.onset) : null,
      expires_at: info ? parseDate(info.expires) : null,
      web_url: info ? firstString(info.web) : null,
      references,
    },
    areas,
  };
}
function safeCapUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "www.bmkg.go.id") return null;
    if (!url.pathname.startsWith("/alerts/nowcast/id/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}
function extractReferencedIdentifiers(references: string): string[] {
  const tokens = references.trim().split(/\s+/).filter(Boolean);
  const identifiers: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 3) if (tokens[i + 1]) identifiers.push(tokens[i + 1]);
  return identifiers;
}
async function fetchXml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "Accept": "application/xml, text/xml, application/rss+xml" },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error(`BMKG_HTTP_${response.status}`);
  const xml = await response.text();
  if (xml.length > 2_000_000) throw new Error("BMKG_RESPONSE_TOO_LARGE");
  return xml;
}
async function activeAlertsForProvince(supabase: ReturnType<typeof createClient>, province: string) {
  const { data, error } = await supabase.from("v_public_hiking_weather_alerts")
    .select("*").order("effective_at", { ascending: false }).limit(100);
  if (error) throw new Error("ALERT_CACHE_READ_FAILED");
  const provinceKey = norm(province);
  return (data ?? []).filter((alert: RecordLike) => {
    const areas = Array.isArray(alert.affected_areas) ? alert.affected_areas as RecordLike[] : [];
    return areas.some((area) => {
      const areaProvince = typeof area.province === "string" ? norm(area.province) : "";
      const description = typeof area.description === "string" ? norm(area.description) : "";
      return areaProvince === provinceKey || description.includes(provinceKey);
    }) || norm(String(alert.headline ?? "")).includes(provinceKey);
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "SERVER_CONFIGURATION_MISSING" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "x-hiking-backend": "hiking-weather-alerts" } },
  });

  const { data: rollout, error: rolloutError } = await supabase
    .from("hiking_feature_flags")
    .select("is_enabled")
    .eq("flag_key", "bmkg_nowcast_alerts_enabled")
    .maybeSingle();
  if (rolloutError) return json({ error: "FEATURE_FLAG_LOOKUP_FAILED" }, 503);
  if (!rollout || rollout.is_enabled !== true) {
    return json({ error: "FEATURE_DISABLED", feature: "bmkg_nowcast_alerts_enabled" }, 503);
  }

  const url = new URL(request.url);
  const provinceInput = (url.searchParams.get("province") ?? "").trim();
  const province = resolveProvince(provinceInput);
  if (!province) {
    return json({ error: "INVALID_PROVINCE", message: "Gunakan nama provinsi Indonesia yang dikenal." }, 400);
  }
  const provinceKey = province.canonical;

  const feedKey = `bmkg_nowcast_id:${provinceKey.replace(/\s+/g, "-")}`;
  const now = new Date();
  const nowIso = now.toISOString();
  try {
    const { data: state, error: stateError } = await supabase.from("hiking_weather_alert_feed_state")
      .select("last_success_at,next_refresh_after,last_error_code")
      .eq("feed_key", feedKey).maybeSingle();
    if (stateError) throw new Error("ALERT_STATE_READ_FAILED");
    if (state?.next_refresh_after && new Date(state.next_refresh_after).getTime() > now.getTime()) {
      const cached = await activeAlertsForProvince(supabase, provinceInput);
      return json({
        source: { name: "BMKG", attribution: "Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)", sourceUrl: "https://data.bmkg.go.id/peringatan-dini-cuaca/" },
        province: provinceInput, checkedAt: state.last_success_at ?? null,
        cacheUntil: state.next_refresh_after, stale: Boolean(state.last_error_code), alerts: cached,
      });
    }

    const leaseUntil = new Date(now.getTime() + 45_000).toISOString();
    const { error: leaseError } = await supabase.from("hiking_weather_alert_feed_state").upsert({
      feed_key: feedKey, next_refresh_after: leaseUntil, last_error_code: null, updated_at: nowIso,
    }, { onConflict: "feed_key" });
    if (leaseError) throw new Error("ALERT_STATE_WRITE_FAILED");

    try {
      const rssXml = await fetchXml(RSS_URL);
      const matchingFeedItems = parseFeed(rssXml).filter((item) => {
        const itemText = norm(`${item.title} ${item.description}`);
        return province.aliases.some((alias) => {
          const term = norm(alias);
          return itemText.includes(term);
        });
      });
      const feedPartial = matchingFeedItems.length > MAX_CAP_DETAILS_PER_REFRESH;
      const matchingItems = matchingFeedItems.slice(0, MAX_CAP_DETAILS_PER_REFRESH);

      const fetchedCaps = await Promise.all(matchingItems.map(async (item) => {
        const capUrl = safeCapUrl(item.link);
        if (!capUrl) return null;
        try {
          const xml = await fetchXml(capUrl);
          const parsed = parseCap(xml, provinceInput);
          if (!parsed.record.identifier) return null;
          return { item, capUrl, xml, ...parsed };
        } catch (error) {
          console.warn("Skipping malformed or unavailable BMKG CAP item", error instanceof Error ? error.message : "CAP_ITEM_FAILED");
          return null;
        }
      }));

      for (const cap of fetchedCaps) {
        if (!cap) continue;
        const record = cap.record as RecordLike;
        const references = extractReferencedIdentifiers(String(record.references ?? ""));
        if (record.message_type === "Cancel" && references.length) {
          const { error: cancelError } = await supabase.from("hiking_weather_alerts").update({
            expires_at: nowIso, updated_at: nowIso,
          }).in("identifier", references);
          if (cancelError) console.error("BMKG CAP cancellation update failed");
        }
        const { references: _references, ...dbRecord } = record;
        const { error: upsertError } = await supabase.from("hiking_weather_alerts").upsert({
          ...dbRecord, source_url: cap.capUrl, raw_cap_xml: cap.xml,
          content_sha256: await sha256(cap.xml), last_fetched_at: nowIso, updated_at: nowIso,
        }, { onConflict: "identifier" });
        if (upsertError) {
          console.error("Failed to persist a BMKG CAP record", upsertError.code ?? "DB_ERROR");
          continue;
        }
        const { data: persisted, error: idError } = await supabase.from("hiking_weather_alerts")
          .select("alert_id").eq("identifier", String(record.identifier)).maybeSingle();
        if (idError || !persisted?.alert_id) continue;
        const { error: areaDeleteError } = await supabase.from("hiking_weather_alert_areas").delete().eq("alert_id", persisted.alert_id);
        if (areaDeleteError) {
          console.error("Failed to replace BMKG alert areas");
          continue;
        }
        if (cap.areas.length) {
          const { error: areasError } = await supabase.from("hiking_weather_alert_areas")
            .insert(cap.areas.map((area) => ({ ...area, alert_id: persisted.alert_id })));
          if (areasError) console.error("Failed to persist BMKG CAP area metadata");
        }
      }

      const nextRefresh = new Date(Date.now() + CACHE_WINDOW_MS).toISOString();
      const completedAt = new Date().toISOString();
      const { error: stateWriteError } = await supabase.from("hiking_weather_alert_feed_state").upsert({
        feed_key: feedKey, last_success_at: completedAt, next_refresh_after: nextRefresh,
        last_error_code: null, last_error_at: null, updated_at: completedAt,
      }, { onConflict: "feed_key" });
      if (stateWriteError) throw new Error("ALERT_STATE_WRITE_FAILED");

      const alerts = await activeAlertsForProvince(supabase, provinceInput);
      return json({
        source: { name: "BMKG", attribution: "Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)", sourceUrl: "https://data.bmkg.go.id/peringatan-dini-cuaca/" },
        province: provinceInput, checkedAt: completedAt, cacheUntil: nextRefresh,
        stale: false, partial: feedPartial, alerts,
      });
    } catch (error) {
      const rawCode = error instanceof Error ? error.message : "BMKG_REFRESH_FAILED";
      const code = rawCode.startsWith("BMKG_") ? rawCode : "BMKG_REFRESH_FAILED";
      console.error("BMKG alert refresh failed", code);
      const retryAt = new Date(Date.now() + RETRY_WINDOW_MS).toISOString();
      await supabase.from("hiking_weather_alert_feed_state").upsert({
        feed_key: feedKey, next_refresh_after: retryAt, last_error_code: code,
        last_error_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: "feed_key" });
      const cached = await activeAlertsForProvince(supabase, provinceInput).catch(() => []);
      if (cached.length) {
        return json({
          source: { name: "BMKG", attribution: "Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)", sourceUrl: "https://data.bmkg.go.id/peringatan-dini-cuaca/" },
          province: provinceInput, checkedAt: state?.last_success_at ?? null, cacheUntil: retryAt,
          stale: true, warning: "BMKG_TEMPORARILY_UNAVAILABLE", alerts: cached,
        });
      }
      return json({
        source: { name: "BMKG", attribution: "Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)", sourceUrl: "https://data.bmkg.go.id/peringatan-dini-cuaca/" },
        province: provinceInput, error: "BMKG_TEMPORARILY_UNAVAILABLE", code,
        checkedAt: state?.last_success_at ?? null, alerts: [],
      }, 502);
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
    console.error("hiking-weather-alerts request failed", code.startsWith("ALERT_") ? code : "INTERNAL_ERROR");
    return json({ error: code.startsWith("ALERT_") ? code : "INTERNAL_ERROR" }, 500);
  }
});
