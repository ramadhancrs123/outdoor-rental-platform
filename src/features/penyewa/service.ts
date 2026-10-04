import { createClientId } from "@/lib/client-id";
import { supabase } from "@/app/providers/supabase/client";
import { appConfig } from "@/app/config";

export type TenantContext = { akunAdminId: string; usahaId: string; usahaNama: string };
export type AuthorizedUsaha = { usahaId: string; usahaNama: string };

export type RenterListItem = {
  penyewa_id: string;
  nama_lengkap: string;
  nomor_telepon: string;
  status: string;
  created_at: string;
  updated_at: string;
  status_verifikasi?: string | null;
};

export type RenterDetail = RenterListItem & {
  alamat: string | null;
  catatan_internal: string | null;
};

export type RenterIdentityEvidence = {
  buktiIdentitasId: string | null;
  jenisIdentitas: string | null;
  nomorIdentitasMasked: string | null;
  statusVerifikasi: string | null;
  verifiedAt: string | null;
  verifiedByAdminId: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  signedUrl: string | null;
};

export type RenterPhoto = {
  fotoPenyewaId: string | null;
  konteks: string | null;
  status: string | null;
  capturedAt: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  photoUrl: string | null;
};

type AdminRow = { akun_admin_id: string };
type MembershipRow = { usaha_id: string };
type BusinessRow = { usaha_id: string; nama: string; status: string };
type VerificationRow = {
  penyewa_id: string;
  status_verifikasi: string | null;
  created_at: string;
  verified_at?: string | null;
};
type PhotoRow = {
  foto_penyewa_id: string;
  konteks: string;
  status: string;
  captured_at: string;
  storage_bucket: string;
  storage_path: string;
};
type IdentityRow = {
  bukti_identitas_id: string;
  jenis_identitas: string | null;
  nomor_identitas_masked: string | null;
  status_verifikasi: string | null;
  verified_at: string | null;
  verified_by_admin_id: string | null;
  updated_at: string;
  created_at: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

export class RenterReadError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RenterReadError";
    this.status = status;
  }
}

export class RenterUnknownOutcomeError extends RenterReadError {
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(
      "Hasil pembuatan penyewa belum dapat dipastikan. Periksa status terbaru sebelum mencoba lagi.",
      409,
    );
    this.name = "RenterUnknownOutcomeError";
    this.idempotencyKey = idempotencyKey;
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
      // Ignore malformed auth storage and continue looking for another valid session.
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
  } catch {
    return undefined;
  }
};

const encode = (value: string) => encodeURIComponent(value);

async function getJson<T>(path: string, token: string): Promise<T[]> {
  const response = await fetch(`${appConfig.supabase.restUrl}/${path}`, {
    headers: {
      apikey: appConfig.supabase.anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new RenterReadError(
      response.status === 401 || response.status === 403
        ? "Akses data penyewa ditolak."
        : "Data penyewa gagal dimuat.",
      response.status,
    );
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new RenterReadError("Respons data penyewa tidak valid.", 502);
  }

  return body as T[];
}

async function getAdminContext(token = readStoredAccessToken()) {
  if (!token) throw new RenterReadError("Sesi admin tidak ditemukan.", 401);

  const authUserId = readJwtSubject(token);
  if (!authUserId) throw new RenterReadError("Sesi admin tidak valid.", 401);

  const admins = await getJson<AdminRow>(
    `akun_admin?auth_user_id=eq.${encode(authUserId)}&status=eq.active&select=akun_admin_id`,
    token,
  );
  const admin = admins[0];
  if (!admin) throw new RenterReadError("Akun admin tidak memiliki akses.", 403);

  return { token, akunAdminId: admin.akun_admin_id };
}

export async function listAuthorizedUsaha(token = readStoredAccessToken()): Promise<AuthorizedUsaha[]> {
  const admin = await getAdminContext(token);

  const memberships = await getJson<MembershipRow>(
    `keanggotaan_usaha?akun_admin_id=eq.${encode(admin.akunAdminId)}&status=eq.active&revoked_at=is.null&select=usaha_id`,
    admin.token,
  );

  if (!memberships.length) return [];

  const businesses = await Promise.all(
    memberships.map((membership) =>
      getJson<BusinessRow>(
        `usaha?usaha_id=eq.${encode(membership.usaha_id)}&status=eq.active&select=usaha_id,nama,status`,
        admin.token,
      ),
    ),
  );

  return businesses
    .flat()
    .map((business) => ({ usahaId: business.usaha_id, usahaNama: business.nama }))
    .filter((business, index, rows) => rows.findIndex((item) => item.usahaId === business.usahaId) === index);
}

export async function resolveTenantContext(
  token = readStoredAccessToken(),
  requestedUsahaId?: string,
): Promise<TenantContext> {
  const admin = await getAdminContext(token);
  const authorized = await listAuthorizedUsaha(admin.token);

  if (!authorized.length) {
    throw new RenterReadError("Anda tidak memiliki akses ke Usaha aktif.", 403);
  }

  const selected = requestedUsahaId
    ? authorized.find((usaha) => usaha.usahaId === requestedUsahaId)
    : authorized.length === 1
      ? authorized[0]
      : undefined;

  if (!selected) {
    if (requestedUsahaId) {
      throw new RenterReadError("Anda tidak memiliki akses ke Usaha tersebut.", 403);
    }
    throw new RenterReadError("Pilih Usaha aktif sebelum membuka data operasional.", 409);
  }

  return {
    akunAdminId: admin.akunAdminId,
    usahaId: selected.usahaId,
    usahaNama: selected.usahaNama,
  };
}

const listSelect = "penyewa_id,nama_lengkap,nomor_telepon,status,created_at,updated_at";
const detailSelect = listSelect + ",alamat,catatan_internal";

export function buildRenterListPath(
  usahaId: string,
  search?: string,
  status: "active" | "inactive" | "all" = "all",
) {
  const filters = [`usaha_id=eq.${encode(usahaId)}`];
  const term = search?.trim();

  if (status !== "all") {
    filters.push(`status=eq.${encode(status)}`);
  }

  if (term) {
    const escaped = term.replace(/,/g, "\\,").replace(/\*/g, "");
    const normalized = term.replace(/\D/g, "");
    const clauses = [`nama_lengkap.ilike.*${encode(escaped)}*`];
    if (normalized) {
      clauses.push(`nomor_telepon_normalized.ilike.*${encode(normalized)}*`);
    }
    filters.push(`or=(${clauses.join(",")})`);
  }

  return `penyewa?select=${listSelect}&${filters.join("&")}&order=nama_lengkap.asc`;
}

function buildRenterDuplicatePath(usahaId: string, name: string, phone: string) {
  const clauses: string[] = [];
  const safeName = name.trim().replace(/,/g, "\\,").replace(/\*/g, "");
  const normalizedPhone = phone.replace(/\D/g, "");

  if (safeName.length >= 3) clauses.push("nama_lengkap.ilike.*" + encode(safeName) + "*");
  if (normalizedPhone.length >= 6) clauses.push("nomor_telepon_normalized.eq." + encode(normalizedPhone));

  if (!clauses.length) return null;
  return "penyewa?select=" + listSelect
    + "&usaha_id=eq." + encode(usahaId)
    + "&or=(" + clauses.join(",") + ")"
    + "&order=updated_at.desc&limit=8";
}

export async function findDuplicateRenterCandidates(
  tenant: TenantContext,
  name: string,
  phone: string,
  token = readStoredAccessToken(),
): Promise<RenterListItem[]> {
  if (!token) throw new RenterReadError("Sesi admin tidak ditemukan.", 401);
  const path = buildRenterDuplicatePath(tenant.usahaId, name, phone);
  if (!path) return [];
  return getJson<RenterListItem>(path, token);
}

async function enrichVerificationStatus(
  usahaId: string,
  renters: RenterListItem[],
  token: string,
): Promise<RenterListItem[]> {
  if (!renters.length) return renters;

  const ids = [...new Set(renters.map((renter) => renter.penyewa_id))];
  const rows = await getJson<VerificationRow>(
    "bukti_identitas_penyewa?select=penyewa_id,status_verifikasi,created_at,verified_at"
      + "&usaha_id=eq." + encode(usahaId)
      + "&penyewa_id=in.(" + ids.map(encode).join(",") + ")"
      + "&order=created_at.desc",
    token,
  );

  const latestByRenter = new Map<string, string | null>();
  for (const row of rows) {
    if (!latestByRenter.has(row.penyewa_id)) latestByRenter.set(row.penyewa_id, row.status_verifikasi);
  }

  return renters.map((renter) => ({
    ...renter,
    status_verifikasi: latestByRenter.get(renter.penyewa_id) ?? null,
  }));
}

export async function listRenters(
  tenant: TenantContext,
  search?: string,
  status: "active" | "inactive" | "all" = "all",
  token = readStoredAccessToken(),
) {
  if (!token) throw new RenterReadError("Sesi admin tidak ditemukan.", 401);
  const renters = await getJson<RenterListItem>(buildRenterListPath(tenant.usahaId, search, status), token);
  return enrichVerificationStatus(tenant.usahaId, renters, token);
}

export function buildRenterDetailPath(usahaId: string, penyewaId: string) {
  return `penyewa?select=${detailSelect}&usaha_id=eq.${encode(usahaId)}&penyewa_id=eq.${encode(penyewaId)}&limit=1`;
}

export async function getRenter(
  tenant: TenantContext,
  penyewaId: string,
  token = readStoredAccessToken(),
) {
  if (!token) throw new RenterReadError("Sesi admin tidak ditemukan.", 401);

  const rows = await getJson<RenterDetail>(buildRenterDetailPath(tenant.usahaId, penyewaId), token);
  if (!rows[0]) {
    throw new RenterReadError(
      "Penyewa tidak ditemukan atau tidak tersedia dalam Usaha aktif.",
      404,
    );
  }

  return rows[0];
}


export async function listRenterIdentityEvidence(
  tenant: TenantContext,
  penyewaId: string,
  token = readStoredAccessToken(),
): Promise<RenterIdentityEvidence[]> {
  if (!token) throw new RenterReadError("Sesi admin tidak ditemukan.", 401);

  const rows = await getJson<IdentityRow>(
    "bukti_identitas_penyewa?select=bukti_identitas_id,jenis_identitas,nomor_identitas_masked,status_verifikasi,verified_at,verified_by_admin_id,updated_at,created_at,storage_bucket,storage_path"
      + "&usaha_id=eq." + encode(tenant.usahaId)
      + "&penyewa_id=eq." + encode(penyewaId)
      + "&order=created_at.desc",
    token,
  );

  return rows.map((identity) => ({
    buktiIdentitasId: identity.bukti_identitas_id,
    jenisIdentitas: identity.jenis_identitas,
    nomorIdentitasMasked: identity.nomor_identitas_masked,
    statusVerifikasi: identity.status_verifikasi,
    verifiedAt: identity.verified_at,
    verifiedByAdminId: identity.verified_by_admin_id,
    updatedAt: identity.updated_at,
    createdAt: identity.created_at,
    storageBucket: identity.storage_bucket,
    storagePath: identity.storage_path,
    signedUrl: null,
  }));
}

export async function getRenterIdentityEvidence(
  tenant: TenantContext,
  penyewaId: string,
  evidenceId?: string,
  token = readStoredAccessToken(),
): Promise<RenterIdentityEvidence> {
  if (!token) throw new RenterReadError("Sesi admin tidak ditemukan.", 401);

  const rows = await getJson<IdentityRow>(
    `bukti_identitas_penyewa?select=bukti_identitas_id,jenis_identitas,nomor_identitas_masked,status_verifikasi,verified_at,verified_by_admin_id,updated_at,created_at,storage_bucket,storage_path&usaha_id=eq.${encode(tenant.usahaId)}&penyewa_id=eq.${encode(penyewaId)}${evidenceId ? `&bukti_identitas_id=eq.${encode(evidenceId)}` : ""}&order=created_at.desc&limit=1`,
    token,
  );

  const identity = rows[0];
  let signedUrl: string | null = null;

  if (identity?.storage_bucket && identity.storage_path) {
    const signed = await supabase.storage
      .from(identity.storage_bucket)
      .createSignedUrl(identity.storage_path, 300);
    if (!signed.error) signedUrl = signed.data.signedUrl;
  }

  return {
    buktiIdentitasId: identity?.bukti_identitas_id ?? null,
    jenisIdentitas: identity?.jenis_identitas ?? null,
    nomorIdentitasMasked: identity?.nomor_identitas_masked ?? null,
    statusVerifikasi: identity?.status_verifikasi ?? null,
    verifiedAt: identity?.verified_at ?? null,
    verifiedByAdminId: identity?.verified_by_admin_id ?? null,
    updatedAt: identity?.updated_at ?? null,
    createdAt: identity?.created_at ?? null,
    storageBucket: identity?.storage_bucket ?? null,
    storagePath: identity?.storage_path ?? null,
    signedUrl,
  };
}

export async function getRenterPhoto(
  tenant: TenantContext,
  penyewaId: string,
  token = readStoredAccessToken(),
): Promise<RenterPhoto> {
  if (!token) throw new RenterReadError("Sesi admin tidak ditemukan.", 401);

  const rows = await getJson<PhotoRow>(
    `foto_penyewa?select=foto_penyewa_id,konteks,status,captured_at,storage_bucket,storage_path&usaha_id=eq.${encode(tenant.usahaId)}&penyewa_id=eq.${encode(penyewaId)}&status=eq.valid&order=created_at.desc&limit=1`,
    token,
  );

  const photo = rows[0];
  let photoUrl: string | null = null;

  if (photo?.storage_bucket && photo.storage_path) {
    const signed = await supabase.storage
      .from(photo.storage_bucket)
      .createSignedUrl(photo.storage_path, 300);
    if (!signed.error) photoUrl = signed.data.signedUrl;
  }

  return {
    fotoPenyewaId: photo?.foto_penyewa_id ?? null,
    konteks: photo?.konteks ?? null,
    status: photo?.status ?? null,
    capturedAt: photo?.captured_at ?? null,
    storageBucket: photo?.storage_bucket ?? null,
    storagePath: photo?.storage_path ?? null,
    photoUrl,
  };
}


export function maskPhone(phone: string) {
  if (phone.length <= 4) return "••••";
  return `${phone.slice(0, 3)}••••${phone.slice(-3)}`;
}


export type RenterCommandOptions = {
  idempotencyKey?: string;
  requestId?: string;
};

export type CreateRenterInput = {
  nama_lengkap: string;
  nomor_telepon: string;
  alamat?: string | null;
  catatan_internal?: string | null;
};

export type RenterCreatedResult = {
  penyewa_id: string;
  usaha_id: string;
  nama_lengkap: string;
  nomor_telepon: string;
  status: string;
};

export type RenterReconciliationResult = {
  state: "committed" | "not_found" | "unknown";
  response: RenterCreatedResult | null;
};

function assertRenterRpcResult<T>(data: T | null, error: unknown, label: string): T {
  if (error) {
    throw new RenterReadError(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
  if (data == null) {
    throw new RenterReadError(`${label}: server tidak mengembalikan hasil command.`, 502);
  }
  return data;
}

export async function createRenter(
  usahaId: string,
  input: CreateRenterInput,
  options: RenterCommandOptions = {},
): Promise<RenterCreatedResult> {
  const idempotencyKey = options.idempotencyKey ?? `create-renter-${createClientId()}`;
  const requestId = options.requestId ?? createClientId();

  let data: RenterCreatedResult | null = null;
  let error: unknown = null;

  try {
    const rpcResult = await supabase.rpc("command_create_renter", {
      p_usaha_id: usahaId,
      p_nama_lengkap: input.nama_lengkap.trim(),
      p_nomor_telepon: input.nomor_telepon.trim(),
      p_alamat: input.alamat?.trim() || null,
      p_catatan_internal: input.catatan_internal?.trim() || null,
      p_idempotency_key: idempotencyKey,
      p_request_id: requestId,
    });
    data = rpcResult.data as RenterCreatedResult | null;
    error = rpcResult.error;
  } catch (cause) {
    error = cause;
  }

  if (!error && data) return data;

  try {
    const reconciliation = await reconcileRenterCreation(usahaId, idempotencyKey);
    if (reconciliation.state === "committed" && reconciliation.response) {
      return reconciliation.response;
    }
    if (reconciliation.state === "unknown") {
      throw new RenterUnknownOutcomeError(idempotencyKey);
    }
  } catch (reconciliationError) {
    if (reconciliationError instanceof RenterUnknownOutcomeError) {
      throw reconciliationError;
    }
  }

  if (error) {
    throw new RenterReadError(
      `Pembuatan penyewa: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }

  throw new RenterReadError("Pembuatan penyewa: server tidak mengembalikan hasil command.", 502);
}

export async function reconcileRenterCreation(
  usahaId: string,
  idempotencyKey: string,
): Promise<RenterReconciliationResult> {
  const { data, error } = await supabase.rpc("command_reconcile_renter_creation", {
    p_usaha_id: usahaId,
    p_idempotency_key: idempotencyKey,
  });
  return assertRenterRpcResult(data as RenterReconciliationResult | null, error, "Rekonsiliasi pembuatan penyewa");
}

export class RenterStaleDataError extends RenterReadError {
  constructor(message = "Data penyewa sudah berubah. Muat ulang sebelum menyimpan.") {
    super(message, 409);
    this.name = "RenterStaleDataError";
  }
}

export type UpdateRenterProfileInput = CreateRenterInput & {
  penyewa_id: string;
  expected_updated_at: string;
};

export type RenterUpdatedResult = RenterCreatedResult & {
  alamat: string | null;
  catatan_internal: string | null;
  updated_at: string;
};

export type AddRenterIdentityEvidenceInput = {
  penyewa_id: string;
  bukti_identitas_id: string;
  jenis_identitas: "KTP" | "SIM";
  nomor_identitas_masked?: string | null;
  storage_bucket: string;
  storage_path: string;
  catatan?: string | null;
};

export type VerifyRenterIdentityEvidenceInput = {
  penyewa_id: string;
  bukti_identitas_id: string;
  status_verifikasi: "verified" | "rejected";
  catatan?: string | null;
  expected_updated_at: string;
};

export type AddRenterPhotoInput = {
  penyewa_id: string;
  foto_penyewa_id: string;
  konteks: string;
  storage_bucket: string;
  storage_path: string;
};

export type RenterMutationReconciliationResult<T> = {
  state: "committed" | "not_found" | "unknown";
  response: T | null;
  command_name?: string;
};

export async function reconcileRenterMutation<T>(
  usahaId: string,
  idempotencyKey: string,
): Promise<RenterMutationReconciliationResult<T>> {
  const { data, error } = await supabase.rpc("command_reconcile_renter_mutation", {
    p_usaha_id: usahaId,
    p_idempotency_key: idempotencyKey,
  });
  return assertRenterRpcResult(
    data as RenterMutationReconciliationResult<T> | null,
    error,
    "Rekonsiliasi perubahan penyewa",
  );
}

export async function updateRenterProfile(
  usahaId: string,
  input: UpdateRenterProfileInput,
  options: RenterCommandOptions = {},
): Promise<RenterUpdatedResult> {
  const idempotencyKey = options.idempotencyKey ?? "update-renter-" + createClientId();
  const requestId = options.requestId ?? createClientId();

  let error: unknown = null;
  try {
    const { data, error: rpcError } = await supabase.rpc("command_update_renter_profile", {
      p_usaha_id: usahaId,
      p_penyewa_id: input.penyewa_id,
      p_nama_lengkap: input.nama_lengkap.trim(),
      p_nomor_telepon: input.nomor_telepon.trim(),
      p_alamat: input.alamat?.trim() || null,
      p_catatan_internal: input.catatan_internal?.trim() || null,
      p_expected_updated_at: input.expected_updated_at,
      p_idempotency_key: idempotencyKey,
      p_request_id: requestId,
    });
    if (!rpcError && data) return data as RenterUpdatedResult;
    error = rpcError;
  } catch (cause) {
    error = cause;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("STALE_DATA")) {
    throw new RenterStaleDataError();
  }

  try {
    const reconciliation = await reconcileRenterMutation<RenterUpdatedResult>(usahaId, idempotencyKey);
    if (reconciliation.state === "committed" && reconciliation.response) return reconciliation.response;
    if (reconciliation.state === "unknown") throw new RenterUnknownOutcomeError(idempotencyKey);
  } catch (reconciliationError) {
    if (reconciliationError instanceof RenterUnknownOutcomeError) throw reconciliationError;
  }

  throw new RenterReadError(
    "Perubahan profil penyewa: " + message,
    500,
  );
}

export async function addRenterIdentityEvidence(
  usahaId: string,
  input: AddRenterIdentityEvidenceInput,
  options: RenterCommandOptions = {},
) {
  const idempotencyKey = options.idempotencyKey ?? "renter-identity-" + createClientId();
  const requestId = options.requestId ?? createClientId();

  let error: unknown = null;
  try {
    const { data, error: rpcError } = await supabase.rpc("command_add_renter_identity_evidence", {
      p_usaha_id: usahaId,
      p_penyewa_id: input.penyewa_id,
      p_bukti_identitas_id: input.bukti_identitas_id,
      p_jenis_identitas: input.jenis_identitas,
      p_nomor_identitas_masked: input.nomor_identitas_masked?.trim() || null,
      p_storage_bucket: input.storage_bucket,
      p_storage_path: input.storage_path,
      p_catatan: input.catatan?.trim() || null,
      p_idempotency_key: idempotencyKey,
      p_request_id: requestId,
    });
    if (!rpcError && data) return data as RenterIdentityEvidence;
    error = rpcError;
  } catch (cause) {
    error = cause;
  }

  try {
    const reconciliation = await reconcileRenterMutation<RenterIdentityEvidence>(usahaId, idempotencyKey);
    if (reconciliation.state === "committed" && reconciliation.response) return reconciliation.response;
    if (reconciliation.state === "unknown") throw new RenterUnknownOutcomeError(idempotencyKey);
  } catch (reconciliationError) {
    if (reconciliationError instanceof RenterUnknownOutcomeError) throw reconciliationError;
  }

  throw new RenterReadError(
    "Penyimpanan bukti identitas: " + (error instanceof Error ? error.message : String(error)),
    500,
  );
}

export async function verifyRenterIdentityEvidence(
  usahaId: string,
  input: VerifyRenterIdentityEvidenceInput,
  options: RenterCommandOptions = {},
) {
  const idempotencyKey = options.idempotencyKey ?? "verify-renter-identity-" + createClientId();
  const requestId = options.requestId ?? createClientId();

  let error: unknown = null;
  try {
    const { data, error: rpcError } = await supabase.rpc("command_verify_renter_identity_evidence", {
      p_usaha_id: usahaId,
      p_penyewa_id: input.penyewa_id,
      p_bukti_identitas_id: input.bukti_identitas_id,
      p_status_verifikasi: input.status_verifikasi,
      p_catatan: input.catatan?.trim() || null,
      p_expected_updated_at: input.expected_updated_at,
      p_idempotency_key: idempotencyKey,
      p_request_id: requestId,
    });
    if (!rpcError && data) return data as RenterIdentityEvidence;
    error = rpcError;
  } catch (cause) {
    error = cause;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("STALE_DATA")) {
    throw new RenterStaleDataError("Bukti identitas berubah. Muat ulang sebelum memverifikasi.");
  }

  try {
    const reconciliation = await reconcileRenterMutation<RenterIdentityEvidence>(usahaId, idempotencyKey);
    if (reconciliation.state === "committed" && reconciliation.response) return reconciliation.response;
    if (reconciliation.state === "unknown") throw new RenterUnknownOutcomeError(idempotencyKey);
  } catch (reconciliationError) {
    if (reconciliationError instanceof RenterUnknownOutcomeError) throw reconciliationError;
  }

  throw new RenterReadError(
    "Verifikasi identitas: " + message,
    500,
  );
}

export async function uploadRenterPrivateFile(
  bucket: string,
  path: string,
  file: File,
) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw new RenterReadError("Upload file gagal: " + error.message, 500);
}

export async function addRenterPhoto(
  usahaId: string,
  input: AddRenterPhotoInput,
  options: RenterCommandOptions = {},
) {
  const idempotencyKey = options.idempotencyKey ?? "renter-photo-" + createClientId();
  const requestId = options.requestId ?? createClientId();

  let error: unknown = null;
  try {
    const { data, error: rpcError } = await supabase.rpc("command_add_renter_photo", {
      p_usaha_id: usahaId,
      p_penyewa_id: input.penyewa_id,
      p_foto_penyewa_id: input.foto_penyewa_id,
      p_konteks: input.konteks,
      p_storage_bucket: input.storage_bucket,
      p_storage_path: input.storage_path,
      p_idempotency_key: idempotencyKey,
      p_request_id: requestId,
    });
    if (!rpcError && data) return data as RenterPhoto;
    error = rpcError;
  } catch (cause) {
    error = cause;
  }

  try {
    const reconciliation = await reconcileRenterMutation<RenterPhoto>(usahaId, idempotencyKey);
    if (reconciliation.state === "committed" && reconciliation.response) return reconciliation.response;
    if (reconciliation.state === "unknown") throw new RenterUnknownOutcomeError(idempotencyKey);
  } catch (reconciliationError) {
    if (reconciliationError instanceof RenterUnknownOutcomeError) throw reconciliationError;
  }

  throw new RenterReadError(
    "Penyimpanan foto penyewa: " + (error instanceof Error ? error.message : String(error)),
    500,
  );
}

export async function removeRenterPrivateFile(bucket: string, path: string) {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) {
    throw new RenterReadError("Penghapusan file privat gagal: " + error.message, 500);
  }
}
