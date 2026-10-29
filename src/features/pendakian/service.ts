import { appConfig } from "@/app/config";
import { supabase } from "@/app/providers/supabase/client";
import type {
  GpxUploadResult,
  HikingEntity,
  HikingList,
  HikingOverview,
  HikingResource,
  RouteApplyResult,
} from "./types";

type QueryValue = string | number | boolean | null | undefined;
type QueryParams = Record<string, QueryValue>;

function apiError(status: number, code: string): Error {
  const messages: Record<string, string> = {
    AUTHENTICATION_REQUIRED: "Sesi admin tidak ditemukan. Silakan masuk kembali.",
    INVALID_SESSION: "Sesi admin sudah berakhir. Silakan masuk kembali.",
    SUPER_ADMIN_REQUIRED: "Modul pendakian saat ini hanya tersedia untuk super admin.",
    INVALID_MOUNTAIN_CODE: "Kode gunung tidak valid.",
    INVALID_SLUG: "Alamat nama (slug) tidak valid.",
    MOUNTAIN_METADATA_INCOMPLETE: "Lengkapi nama, koordinat, dan sumber gunung sebelum publikasi. Ketinggian boleh kosong jika belum diketahui.",
    SOURCE_REQUIRED: "Pilih sumber informasi terlebih dahulu.",
    SOURCE_REFERENCE_REQUIRED: "Tambahkan tautan rujukan dari sumber yang dipilih.",
    SOURCE_PERMISSION_NOT_CLEARED: "Izin sumber belum diverifikasi atau belum diberikan.",
    SOURCE_REFERENCE_DOMAIN_MISMATCH: "Domain tautan rujukan tidak sesuai dengan sumber yang dipilih.",
    MOUNTAIN_VERIFICATION_FAILED: "Data gunung belum dapat diverifikasi.",
    MOUNTAIN_PUBLISH_FAILED: "Gunung belum dapat dipublikasikan. Periksa semua persyaratan.",
    TRAIL_SAVE_FAILED: "Data jalur belum berhasil disimpan.",
    TRAIL_ROUTE_NOT_VERIFIED: "Impor rute dan verifikasi sumbernya sebelum publikasi.",
    VERIFIED_ROUTE_REQUIRED: "Jalur belum memiliki rute yang berhasil diterapkan.",
    PARENT_MOUNTAIN_NOT_PUBLISHED: "Publikasikan dan verifikasi gunung terlebih dahulu.",
    PARENT_TRAIL_NOT_PUBLISHED: "Publikasikan jalur terlebih dahulu.",
    WEATHER_AREA_NOT_CONFIGURED: "Pencocokan wilayah cuaca belum tersedia untuk lokasi ini.",
    FEATURE_DISABLED: "Fitur katalog pendakian belum dirilis.",
    PUBLIC_CATALOG_DISABLED: "Publikasi media ditahan sampai katalog pendakian dirilis.",
    LICENSE_REVIEW_REQUIRED: "Periksa izin penggunaan berkas rute terlebih dahulu.",
    GPX_ROOT_REQUIRED: "Berkas yang dipilih bukan GPX yang dapat dibaca.",
    GPX_HAS_NO_ROUTE_SEGMENTS: "Berkas GPX tidak berisi garis rute yang dapat digunakan.",
    INVALID_ROUTE_CANDIDATE: "Pilih satu rute yang benar dari pratinjau GPX.",
    GPX_TOO_MANY_ROUTE_CANDIDATES: "Berkas GPX memuat terlalu banyak kandidat rute untuk diperiksa sekaligus.",
    GPX_XML_INVALID: "Struktur berkas GPX tidak valid.",
    GPX_FILE_REQUIRED: "Pilih berkas GPX terlebih dahulu.",
    MEDIA_FILE_REQUIRED: "Pilih gambar terlebih dahulu.",
    MEDIA_PERMISSION_NOT_CLEARED: "Hak penggunaan gambar belum disetujui.",
    UNKNOWN_ACTION: "Tindakan ini belum didukung oleh backend.",
    UNKNOWN_RESOURCE: "Daftar data ini belum didukung oleh backend.",
    ADMIN_READ_FAILED: "Data belum dapat dibaca. Periksa koneksi atau kontrak API pendakian.",
    INTERNAL_ERROR: "Terjadi kendala di server. Coba lagi setelah memeriksa status data.",
  };
  return new Error(messages[code] ?? `${code || `HTTP_${status}`}. Periksa data yang diisi dan coba kembali.`);
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!appConfig.supabase.isConfigured) {
    throw new Error("Konfigurasi koneksi Supabase belum tersedia pada aplikasi.");
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Sesi admin tidak ditemukan. Silakan masuk kembali.");
  }
  return {
    apikey: appConfig.supabase.anonKey,
    Authorization: `Bearer ${data.session.access_token}`,
  };
}

async function requestJson<T>(
  functionName: string,
  options: { method?: "GET" | "POST"; query?: QueryParams; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  const headers = await authHeaders();
  const url = new URL(`${appConfig.supabase.url}/functions/v1/${functionName}`);
  Object.entries(options.query ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });

  const requestHeaders = { ...headers };
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers: requestHeaders,
      body,
      cache: "no-store",
    });
  } catch {
    throw new Error("Tidak bisa terhubung ke layanan pendakian. Periksa koneksi internet.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw apiError(response.status, "INVALID_SERVER_RESPONSE");
  }
  if (!response.ok) {
    const code = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : `HTTP_${response.status}`;
    throw apiError(response.status, code);
  }
  return payload as T;
}

export function getHikingOverview(): Promise<HikingOverview> {
  return requestJson<HikingOverview>("hiking-admin-api", { query: { resource: "overview" } });
}

export function listHikingResource<T extends HikingEntity = HikingEntity>(
  resource: HikingResource,
  params: QueryParams = {},
): Promise<HikingList<T>> {
  return requestJson<HikingList<T>>("hiking-admin-api", {
    query: { resource, page: 1, pageSize: 100, ...params },
  });
}

export async function getHikingEntity<T extends HikingEntity = HikingEntity>(
  resource: HikingResource,
  id: string,
): Promise<T | null> {
  const result = await listHikingResource<T>(resource, { id, pageSize: 1 });
  return result.items[0] ?? null;
}

export function saveHikingAction<T = { ok: true; action: string; result: HikingEntity; bookingEnabled: false }>(
  action: string,
  fields: Record<string, unknown>,
): Promise<T> {
  return requestJson<T>("hiking-admin-api", { method: "POST", body: { action, ...fields } });
}

export function uploadGpxRoute(file: File, trailId: string, sourceId: string, sourceReferenceUrl: string): Promise<GpxUploadResult> {
  const form = new FormData();
  form.set("file", file);
  form.set("trail_id", trailId);
  form.set("source_id", sourceId);
  form.set("source_reference_url", sourceReferenceUrl);
  return requestJson<GpxUploadResult>("hiking-route-import", { method: "POST", formData: form });
}

export function applyGpxRoute(importId: string, reviewNote?: string, routeIndex = 0): Promise<RouteApplyResult> {
  return requestJson<RouteApplyResult>("hiking-route-import", {
    method: "POST",
    body: { action: "apply", import_id: importId, review_note: reviewNote ?? null, route_index: routeIndex },
  });
}

export function uploadHikingMedia(fields: {
  file: File;
  mountainId?: string;
  trailId?: string;
  sourceId: string;
  sourceReferenceUrl: string;
  mediaType: string;
  altText: string;
  caption?: string;
}): Promise<{ ok: true; media: HikingEntity; nextStep: string }> {
  const form = new FormData();
  form.set("file", fields.file);
  if (fields.mountainId) form.set("mountain_id", fields.mountainId);
  if (fields.trailId) form.set("trail_id", fields.trailId);
  form.set("source_id", fields.sourceId);
  form.set("source_reference_url", fields.sourceReferenceUrl);
  form.set("media_type", fields.mediaType);
  form.set("alt_text", fields.altText);
  if (fields.caption) form.set("caption", fields.caption);
  return requestJson("hiking-media-upload", { method: "POST", formData: form });
}

export async function getHikingForecast(targetType: "mountain" | "trail", slug: string): Promise<unknown> {
  return requestJson("hiking-weather-forecast", {
    method: "GET",
    query: { [targetType]: slug },
  });
}
