import { appConfig } from "@/app/config";

export type TenantContext = { akunAdminId: string; usahaId: string; usahaNama: string };
export type RenterListItem = {
  penyewa_id: string;
  nama_lengkap: string;
  nomor_telepon: string;
  status: string;
  created_at: string;
};
export type RenterDetail = RenterListItem & {
  alamat: string | null;
  updated_at: string;
};
type AdminRow = { akun_admin_id: string };
type MembershipRow = { usaha_id: string };
type BusinessRow = { usaha_id: string; nama: string; status: string };

export class RenterReadError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message); this.name = "RenterReadError"; this.status = status;
  }
}

const readStoredAccessToken = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  const keys = appConfig.supabase.projectRef
    ? [`sb-${appConfig.supabase.projectRef}-auth-token`]
    : Object.keys(window.localStorage).filter((key) => /^sb-[^-]+-auth-token$/.test(key));
  for (const key of keys) {
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    if (!raw.startsWith("{")) return raw;
    try {
      const parsed = JSON.parse(raw) as { access_token?: unknown };
      if (typeof parsed.access_token === "string") return parsed.access_token;
    } catch {
      // ignore malformed auth storage and continue looking for a valid session
    }
  }
  return undefined;
};

const readJwtSubject = (token: string): string | undefined => {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof decoded.sub === "string" ? decoded.sub : undefined;
  } catch { return undefined; }
};

const encode = (value: string) => encodeURIComponent(value);

async function getJson<T>(path: string, token: string): Promise<T[]> {
  const response = await fetch(`${appConfig.supabase.restUrl}/${path}`, {
    headers: { apikey: appConfig.supabase.anonKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new RenterReadError(
      response.status === 401 || response.status === 403 ? "Akses data penyewa ditolak." : "Data penyewa gagal dimuat.",
      response.status,
    );
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new RenterReadError("Respons data penyewa tidak valid.", 502);
  return body as T[];
}

export async function resolveTenantContext(token = readStoredAccessToken()): Promise<TenantContext> {
  if (!token) throw new RenterReadError("Sesi admin tidak ditemukan.", 401);
  const authUserId = readJwtSubject(token);
  if (!authUserId) throw new RenterReadError("Sesi admin tidak valid.", 401);

  const admins = await getJson<AdminRow>(
    `akun_admin?auth_user_id=eq.${encode(authUserId)}&status=eq.active&select=akun_admin_id`, token,
  );
  const admin = admins[0];
  if (!admin) throw new RenterReadError("Akun admin tidak memiliki akses.", 403);

  const memberships = await getJson<MembershipRow>(
    `keanggotaan_usaha?akun_admin_id=eq.${encode(admin.akun_admin_id)}&status=eq.active&revoked_at=is.null&select=usaha_id`, token,
  );
  if (memberships.length !== 1) {
    throw new RenterReadError(
      memberships.length === 0
        ? "Usaha aktif belum dapat ditentukan."
        : "Konteks usaha belum dapat ditentukan karena ada lebih dari satu keanggotaan aktif.",
      409,
    );
  }

  const businesses = await getJson<BusinessRow>(
    `usaha?usaha_id=eq.${encode(memberships[0].usaha_id)}&status=eq.active&select=usaha_id,nama,status`, token,
  );
  const business = businesses[0];
  if (!business) throw new RenterReadError("Usaha aktif tidak ditemukan.", 403);
  return { akunAdminId: admin.akun_admin_id, usahaId: business.usaha_id, usahaNama: business.nama };
}

const listSelect = "penyewa_id,nama_lengkap,nomor_telepon,status,created_at";
const detailSelect = `${listSelect},alamat,updated_at`;

export function buildRenterListPath(usahaId: string, search?: string) {
  const filters = [`usaha_id=eq.${encode(usahaId)}`];
  const term = search?.trim();
  if (term) {
    const escaped = term.replace(/,/g, "\\,").replace(/\*/g, "");
    const normalized = term.replace(/\D/g, "");
    const clauses = [`nama_lengkap.ilike.*${encode(escaped)}*`];
    if (normalized) clauses.push(`nomor_telepon_normalized.ilike.*${encode(normalized)}*`);
    filters.push(`or=(${clauses.join(",")})`);
  }
  return `penyewa?select=${listSelect}&${filters.join("&")}&order=nama_lengkap.asc`;
}

export async function listRenters(tenant: TenantContext, search?: string, token = readStoredAccessToken()) {
  if (!token) throw new RenterReadError("Sesi admin tidak ditemukan.", 401);
  return getJson<RenterListItem>(buildRenterListPath(tenant.usahaId, search), token);
}

export function buildRenterDetailPath(usahaId: string, penyewaId: string) {
  return `penyewa?select=${detailSelect}&usaha_id=eq.${encode(usahaId)}&penyewa_id=eq.${encode(penyewaId)}&limit=1`;
}

export async function getRenter(tenant: TenantContext, penyewaId: string, token = readStoredAccessToken()) {
  if (!token) throw new RenterReadError("Sesi admin tidak ditemukan.", 401);
  const rows = await getJson<RenterDetail>(buildRenterDetailPath(tenant.usahaId, penyewaId), token);
  if (!rows[0]) throw new RenterReadError("Penyewa tidak ditemukan atau Anda tidak memiliki akses.", 404);
  return rows[0];
}

export function maskPhone(phone: string) {
  if (phone.length <= 4) return "••••";
  return `${phone.slice(0, 3)}••••${phone.slice(-3)}`;
}
