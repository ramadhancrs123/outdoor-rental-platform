import { supabase } from "@/app/providers/supabase/client";
import type {
  ReservationCapabilities,
  ReservationDetail,
  ReservationLineItem,
  ReservationListFilters,
  ReservationListItem,
  ReservationTenantContext,
  ReservationCommandResult,
  ReservationPricingLine,
  RequestDetail,
  RequestLineItem,
  RequestListItem,
  UnitPreference,
} from "./types";
import { sanitizeReservationSearch } from "./utils";

type MembershipRow = { usaha_id: string; status: string; revoked_at: string | null };
type RenterRow = { penyewa_id: string; nama_lengkap: string };
type ItemRow = { barang_id: string; nama: string };
type VariantRow = { varian_barang_id: string; nama: string };
type PackageRow = { paket_sewa_id: string; nama: string };
type RequestHeaderRow = {
  permintaan_sewa_id: string;
  usaha_id: string;
  penyewa_id: string;
  nomor_permintaan: string;
  sumber: string;
  mulai_rencana: string;
  selesai_rencana: string;
  status: string;
  catatan: string | null;
  submitted_at: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};
type ReservationHeaderRow = {
  reservasi_id: string;
  usaha_id: string;
  permintaan_sewa_id: string | null;
  penyewa_id: string;
  nomor_reservasi: string;
  mulai_reservasi: string;
  selesai_reservasi: string;
  status: string;
  stock_lock_status: string;
  confirmed_at: string | null;
  confirmed_by_admin_id: string | null;
  canceled_at: string | null;
  canceled_by_admin_id: string | null;
  cancellation_reason: string | null;
  catatan: string | null;
  created_at: string;
  updated_at: string;
};

const REQUEST_SELECT =
  "permintaan_sewa_id,usaha_id,penyewa_id,nomor_permintaan,sumber,mulai_rencana,selesai_rencana,status,catatan,submitted_at,processed_at,created_at,updated_at";
const REQUEST_DETAIL_SELECT =
  "detail_permintaan_id,usaha_id,permintaan_sewa_id,barang_id,varian_barang_id,paket_sewa_id,jumlah,catatan";
const RESERVATION_SELECT =
  "reservasi_id,usaha_id,permintaan_sewa_id,penyewa_id,nomor_reservasi,mulai_reservasi,selesai_reservasi,status,stock_lock_status,confirmed_at,confirmed_by_admin_id,canceled_at,canceled_by_admin_id,cancellation_reason,catatan,created_at,updated_at";
const RESERVATION_DETAIL_SELECT =
  "detail_reservasi_id,usaha_id,reservasi_id,barang_id,varian_barang_id,paket_sewa_id,jumlah,unit_price,currency_code,subtotal,catatan";

export async function getReservasiContext(): Promise<ReservationTenantContext> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error("Sesi admin tidak ditemukan.");

  const { data: admin, error: adminError } = await supabase
    .from("akun_admin")
    .select("akun_admin_id")
    .eq("auth_user_id", userData.user.id)
    .eq("status", "active")
    .maybeSingle();
  if (adminError) throw adminError;
  if (!admin) throw new Error("Akun admin aktif tidak ditemukan.");

  const { data: memberships, error: membershipError } = await supabase
    .from("keanggotaan_usaha")
    .select("usaha_id,status,revoked_at")
    .eq("akun_admin_id", admin.akun_admin_id)
    .eq("status", "active")
    .is("revoked_at", null);
  if (membershipError) throw membershipError;

  const rows = (memberships ?? []) as MembershipRow[];
  if (rows.length === 0) throw new Error("Akun admin belum memiliki Usaha aktif.");
  if (rows.length > 1) {
    throw new Error("Konteks Usaha belum ditentukan karena ada lebih dari satu keanggotaan aktif.");
  }

  const { data: usaha, error: usahaError } = await supabase
    .from("usaha")
    .select("usaha_id,nama,status")
    .eq("usaha_id", rows[0].usaha_id)
    .eq("status", "active")
    .maybeSingle();
  if (usahaError) throw usahaError;
  if (!usaha) throw new Error("Usaha aktif tidak ditemukan.");

  return {
    akunAdminId: admin.akun_admin_id as string,
    usahaId: usaha.usaha_id as string,
    usahaNama: usaha.nama as string,
  };
}

async function findRenterIds(usahaId: string, search: string) {
  const term = sanitizeReservationSearch(search);
  if (!term) return [] as string[];
  const pattern = "%" + term + "%";
  const { data, error } = await supabase
    .from("penyewa")
    .select("penyewa_id")
    .eq("usaha_id", usahaId)
    .or("nama_lengkap.ilike." + pattern + ",nomor_telepon.ilike." + pattern)
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => row.penyewa_id as string);
}

async function findRequestDetailIds(usahaId: string, search: string) {
  const term = sanitizeReservationSearch(search);
  if (!term) return { requestIds: [] as string[] };
  const pattern = "%" + term + "%";
  const [itemResult, variantResult, packageResult] = await Promise.all([
    supabase.from("barang").select("barang_id").eq("usaha_id", usahaId).or("nama.ilike." + pattern + ",slug.ilike." + pattern).limit(100),
    supabase.from("varian_barang").select("varian_barang_id").eq("usaha_id", usahaId).or("nama.ilike." + pattern + ",kode_internal.ilike." + pattern).limit(100),
    supabase.from("paket_sewa").select("paket_sewa_id").eq("usaha_id", usahaId).ilike("nama", "%" + term + "%").limit(100),
  ]);
  if (itemResult.error) throw itemResult.error;
  if (variantResult.error) throw variantResult.error;
  if (packageResult.error) throw packageResult.error;

  const targetIds = [
    ...(itemResult.data ?? []).map((row) => ({ key: "barang_id", value: row.barang_id as string })),
    ...(variantResult.data ?? []).map((row) => ({ key: "varian_barang_id", value: row.varian_barang_id as string })),
    ...(packageResult.data ?? []).map((row) => ({ key: "paket_sewa_id", value: row.paket_sewa_id as string })),
  ];
  if (targetIds.length === 0) return { requestIds: [] as string[] };

  const { data, error } = await supabase
    .from("detail_permintaan")
    .select("permintaan_sewa_id")
    .eq("usaha_id", usahaId)
    .or(
      [
        itemResult.data?.length ? "barang_id.in.(" + itemResult.data.map((row) => row.barang_id).join(",") + ")" : "",
        variantResult.data?.length ? "varian_barang_id.in.(" + variantResult.data.map((row) => row.varian_barang_id).join(",") + ")" : "",
        packageResult.data?.length ? "paket_sewa_id.in.(" + packageResult.data.map((row) => row.paket_sewa_id).join(",") + ")" : "",
      ].filter(Boolean).join(","),
    )
    .limit(200);
  if (error) throw error;
  return { requestIds: Array.from(new Set((data ?? []).map((row) => row.permintaan_sewa_id as string))) };
}

async function findReservationDetailIds(usahaId: string, search: string) {
  const term = sanitizeReservationSearch(search);
  if (!term) return [] as string[];
  const pattern = "%" + term + "%";
  const [itemResult, variantResult, packageResult] = await Promise.all([
    supabase.from("barang").select("barang_id").eq("usaha_id", usahaId).or("nama.ilike." + pattern + ",slug.ilike." + pattern).limit(100),
    supabase.from("varian_barang").select("varian_barang_id").eq("usaha_id", usahaId).or("nama.ilike." + pattern + ",kode_internal.ilike." + pattern).limit(100),
    supabase.from("paket_sewa").select("paket_sewa_id").eq("usaha_id", usahaId).ilike("nama", "%" + term + "%").limit(100),
  ]);
  if (itemResult.error) throw itemResult.error;
  if (variantResult.error) throw variantResult.error;
  if (packageResult.error) throw packageResult.error;

  const clauses = [
    itemResult.data?.length ? "barang_id.in.(" + itemResult.data.map((row) => row.barang_id).join(",") + ")" : "",
    variantResult.data?.length ? "varian_barang_id.in.(" + variantResult.data.map((row) => row.varian_barang_id).join(",") + ")" : "",
    packageResult.data?.length ? "paket_sewa_id.in.(" + packageResult.data.map((row) => row.paket_sewa_id).join(",") + ")" : "",
  ].filter(Boolean);
  if (!clauses.length) return [] as string[];

  const { data, error } = await supabase
    .from("detail_reservasi")
    .select("reservasi_id")
    .eq("usaha_id", usahaId)
    .or(clauses.join(","))
    .limit(200);
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((row) => row.reservasi_id as string)));
}

async function resolveRenters(usahaId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data, error } = await supabase
    .from("penyewa")
    .select("penyewa_id,nama_lengkap")
    .eq("usaha_id", usahaId)
    .in("penyewa_id", Array.from(new Set(ids)));
  if (error) throw error;
  return new Map((data ?? []).map((row: RenterRow) => [row.penyewa_id, row.nama_lengkap]));
}

async function resolveRequestNumbers(usahaId: string, ids: Array<string | null>) {
  const validIds = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  if (!validIds.length) return new Map<string, string>();
  const { data, error } = await supabase
    .from("permintaan_sewa")
    .select("permintaan_sewa_id,nomor_permintaan")
    .eq("usaha_id", usahaId)
    .in("permintaan_sewa_id", validIds);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.permintaan_sewa_id as string, row.nomor_permintaan as string]));
}

async function countRequestDetails(usahaId: string, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const { data, error } = await supabase
    .from("detail_permintaan")
    .select("permintaan_sewa_id")
    .eq("usaha_id", usahaId)
    .in("permintaan_sewa_id", ids);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = row.permintaan_sewa_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function countReservationDetails(usahaId: string, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const { data, error } = await supabase
    .from("detail_reservasi")
    .select("reservasi_id")
    .eq("usaha_id", usahaId)
    .in("reservasi_id", ids);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = row.reservasi_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function resolveRequestReservations(usahaId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { reservasiId: string; nomorReservasi: string }>();
  const { data, error } = await supabase
    .from("reservasi")
    .select("reservasi_id,permintaan_sewa_id,nomor_reservasi")
    .eq("usaha_id", usahaId)
    .in("permintaan_sewa_id", ids)
    .limit(200);
  if (error) throw error;
  return new Map(
    (data ?? [])
      .filter((row) => row.permintaan_sewa_id)
      .map((row) => [
        row.permintaan_sewa_id as string,
        { reservasiId: row.reservasi_id as string, nomorReservasi: row.nomor_reservasi as string },
      ]),
  );
}

async function resolveCatalogNames(
  usahaId: string,
  barangIds: Array<string | null>,
  variantIds: Array<string | null>,
  packageIds: Array<string | null>,
) {
  const uniqueBarangIds = Array.from(new Set(barangIds.filter((id): id is string => Boolean(id))));
  const uniqueVariantIds = Array.from(new Set(variantIds.filter((id): id is string => Boolean(id))));
  const uniquePackageIds = Array.from(new Set(packageIds.filter((id): id is string => Boolean(id))));
  const [itemsResult, variantsResult, packagesResult] = await Promise.all([
    uniqueBarangIds.length
      ? supabase.from("barang").select("barang_id,nama").eq("usaha_id", usahaId).in("barang_id", uniqueBarangIds)
      : Promise.resolve({ data: [], error: null }),
    uniqueVariantIds.length
      ? supabase.from("varian_barang").select("varian_barang_id,nama").eq("usaha_id", usahaId).in("varian_barang_id", uniqueVariantIds)
      : Promise.resolve({ data: [], error: null }),
    uniquePackageIds.length
      ? supabase.from("paket_sewa").select("paket_sewa_id,nama").eq("usaha_id", usahaId).in("paket_sewa_id", uniquePackageIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (variantsResult.error) throw variantsResult.error;
  if (packagesResult.error) throw packagesResult.error;
  return {
    barangNames: new Map((itemsResult.data ?? []).map((row) => [(row as ItemRow).barang_id, (row as ItemRow).nama])),
    variantNames: new Map((variantsResult.data ?? []).map((row) => [(row as VariantRow).varian_barang_id, (row as VariantRow).nama])),
    packageNames: new Map((packagesResult.data ?? []).map((row) => [(row as PackageRow).paket_sewa_id, (row as PackageRow).nama])),
  };
}

async function resolvePreferenceUnits(usahaId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data, error } = await supabase
    .from("unit_barang")
    .select("unit_barang_id,kode_unit")
    .eq("usaha_id", usahaId)
    .in("unit_barang_id", Array.from(new Set(ids)));
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.unit_barang_id as string, row.kode_unit as string]));
}

export async function listRequests(
  usahaId: string,
  filters: ReservationListFilters,
) {
  const start = Math.max(0, filters.page - 1) * filters.pageSize;
  const end = start + filters.pageSize - 1;
  let query = supabase
    .from("permintaan_sewa")
    .select(REQUEST_SELECT, { count: "exact" })
    .eq("usaha_id", usahaId);

  const term = sanitizeReservationSearch(filters.search);
  if (term) {
    const [renterIds, requestDetailIds] = await Promise.all([
      findRenterIds(usahaId, term),
      findRequestDetailIds(usahaId, term),
    ]);
    const clauses = ["nomor_permintaan.ilike.*" + term + "*"];
    if (renterIds.length) clauses.push("penyewa_id.in.(" + renterIds.join(",") + ")");
    if (requestDetailIds.requestIds.length) clauses.push("permintaan_sewa_id.in.(" + requestDetailIds.requestIds.join(",") + ")");
    query = query.or(clauses.join(","));
  }

  query = query.order("mulai_rencana", { ascending: true }).order("nomor_permintaan", { ascending: true });
  const { data, error, count } = await query.range(start, end);
  if (error) throw error;

  const rows = (data ?? []) as RequestHeaderRow[];
  const requestIds = rows.map((row) => row.permintaan_sewa_id);
  const [renterNames, detailCounts, reservationMap] = await Promise.all([
    resolveRenters(usahaId, rows.map((row) => row.penyewa_id)),
    countRequestDetails(usahaId, requestIds),
    resolveRequestReservations(usahaId, requestIds),
  ]);

  return {
    requests: rows.map(
      (row): RequestListItem => ({
        ...row,
        penyewa_nama: renterNames.get(row.penyewa_id) ?? null,
        detail_count: detailCounts.get(row.permintaan_sewa_id) ?? 0,
        reservasi_id: reservationMap.get(row.permintaan_sewa_id)?.reservasiId ?? null,
        nomor_reservasi: reservationMap.get(row.permintaan_sewa_id)?.nomorReservasi ?? null,
      }),
    ),
    total: count ?? 0,
  };
}

export async function getRequest(usahaId: string, requestId: string): Promise<RequestDetail> {
  const { data, error } = await supabase
    .from("permintaan_sewa")
    .select(REQUEST_SELECT)
    .eq("usaha_id", usahaId)
    .eq("permintaan_sewa_id", requestId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Permintaan tidak ditemukan dalam Usaha aktif.");

  const header = data as RequestHeaderRow;
  const [detailResult, preferenceResult, renterNames, reservationMap] = await Promise.all([
    supabase
      .from("detail_permintaan")
      .select(REQUEST_DETAIL_SELECT)
      .eq("usaha_id", usahaId)
      .eq("permintaan_sewa_id", requestId)
      .order("created_at", { ascending: true }),
    supabase
      .from("pilihan_unit")
      .select("pilihan_unit_id,detail_permintaan_id,unit_barang_id,urutan_preferensi,status,catatan")
      .eq("usaha_id", usahaId)
      .in(
        "detail_permintaan_id",
        await (async () => {
          const { data: ids, error: idsError } = await supabase
            .from("detail_permintaan")
            .select("detail_permintaan_id")
            .eq("usaha_id", usahaId)
            .eq("permintaan_sewa_id", requestId);
          if (idsError) throw idsError;
          return (ids ?? []).map((row) => row.detail_permintaan_id as string);
        })(),
      ),
    resolveRenters(usahaId, [header.penyewa_id]),
    resolveRequestReservations(usahaId, [requestId]),
  ]);
  if (detailResult.error) throw detailResult.error;
  if (preferenceResult.error) throw preferenceResult.error;

  const lines = (detailResult.data ?? []) as Array<{
    detail_permintaan_id: string;
    usaha_id: string;
    permintaan_sewa_id: string;
    barang_id: string | null;
    varian_barang_id: string | null;
    paket_sewa_id: string | null;
    jumlah: string | number;
    catatan: string | null;
  }>;
  const preferencesRaw = (preferenceResult.data ?? []) as Array<{
    pilihan_unit_id: string;
    detail_permintaan_id: string;
    unit_barang_id: string;
    urutan_preferensi: number;
    status: string;
    catatan: string | null;
  }>;

  const [catalogNames, preferenceUnits] = await Promise.all([
    resolveCatalogNames(
      usahaId,
      lines.map((line) => line.barang_id),
      lines.map((line) => line.varian_barang_id),
      lines.map((line) => line.paket_sewa_id),
    ),
    resolvePreferenceUnits(
      usahaId,
      preferencesRaw.map((preference) => preference.unit_barang_id),
    ),
  ]);

  return {
    ...header,
    penyewa_nama: renterNames.get(header.penyewa_id) ?? null,
    detail_count: lines.length,
    reservasi_id: reservationMap.get(requestId)?.reservasiId ?? null,
    nomor_reservasi: reservationMap.get(requestId)?.nomorReservasi ?? null,
    lines: lines.map(
      (line): RequestLineItem => ({
        ...line,
        barang_nama: line.barang_id ? catalogNames.barangNames.get(line.barang_id) ?? null : null,
        varian_nama: line.varian_barang_id ? catalogNames.variantNames.get(line.varian_barang_id) ?? null : null,
        paket_nama: line.paket_sewa_id ? catalogNames.packageNames.get(line.paket_sewa_id) ?? null : null,
      }),
    ),
    preferences: preferencesRaw.map(
      (preference): UnitPreference => ({
        ...preference,
        kode_unit: preferenceUnits.get(preference.unit_barang_id) ?? null,
      }),
    ),
  };
}

export async function listReservations(
  usahaId: string,
  filters: ReservationListFilters,
) {
  const start = Math.max(0, filters.page - 1) * filters.pageSize;
  const end = start + filters.pageSize - 1;
  let query = supabase
    .from("reservasi")
    .select(RESERVATION_SELECT, { count: "exact" })
    .eq("usaha_id", usahaId);

  const term = sanitizeReservationSearch(filters.search);
  if (term) {
    const [renterIds, detailReservationIds] = await Promise.all([
      findRenterIds(usahaId, term),
      findReservationDetailIds(usahaId, term),
    ]);
    const clauses = ["nomor_reservasi.ilike.*" + term + "*"];
    if (renterIds.length) clauses.push("penyewa_id.in.(" + renterIds.join(",") + ")");
    if (detailReservationIds.length) clauses.push("reservasi_id.in.(" + detailReservationIds.join(",") + ")");
    query = query.or(clauses.join(","));
  }

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  query = query.order("mulai_reservasi", { ascending: true }).order("nomor_reservasi", { ascending: true });
  const { data, error, count } = await query.range(start, end);
  if (error) throw error;
  const rows = (data ?? []) as ReservationHeaderRow[];
  const ids = rows.map((row) => row.reservasi_id);
  const [renterNames, requestNumbers, detailCounts] = await Promise.all([
    resolveRenters(usahaId, rows.map((row) => row.penyewa_id)),
    resolveRequestNumbers(usahaId, rows.map((row) => row.permintaan_sewa_id)),
    countReservationDetails(usahaId, ids),
  ]);

  return {
    reservations: rows.map(
      (row): ReservationListItem => ({
        ...row,
        penyewa_nama: renterNames.get(row.penyewa_id) ?? null,
        nomor_permintaan: row.permintaan_sewa_id ? requestNumbers.get(row.permintaan_sewa_id) ?? null : null,
        detail_count: detailCounts.get(row.reservasi_id) ?? 0,
      }),
    ),
    total: count ?? 0,
  };
}

export async function getReservation(usahaId: string, reservationId: string): Promise<ReservationDetail> {
  const { data, error } = await supabase
    .from("reservasi")
    .select(RESERVATION_SELECT)
    .eq("usaha_id", usahaId)
    .eq("reservasi_id", reservationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Reservasi tidak ditemukan dalam Usaha aktif.");

  const header = data as ReservationHeaderRow;
  const [detailResult, renterNames, requestNumbers] = await Promise.all([
    supabase
      .from("detail_reservasi")
      .select(RESERVATION_DETAIL_SELECT)
      .eq("usaha_id", usahaId)
      .eq("reservasi_id", reservationId)
      .order("created_at", { ascending: true }),
    resolveRenters(usahaId, [header.penyewa_id]),
    resolveRequestNumbers(usahaId, [header.permintaan_sewa_id]),
  ]);
  if (detailResult.error) throw detailResult.error;
  const lines = (detailResult.data ?? []) as Array<{
    detail_reservasi_id: string;
    usaha_id: string;
    reservasi_id: string;
    barang_id: string | null;
    varian_barang_id: string | null;
    paket_sewa_id: string | null;
    jumlah: string | number;
    unit_price: string | number | null;
    currency_code: string;
    subtotal: string | number | null;
    catatan: string | null;
  }>;

  const catalogNames = await resolveCatalogNames(
    usahaId,
    lines.map((line) => line.barang_id),
    lines.map((line) => line.varian_barang_id),
    lines.map((line) => line.paket_sewa_id),
  );

  return {
    ...header,
    penyewa_nama: renterNames.get(header.penyewa_id) ?? null,
    nomor_permintaan: header.permintaan_sewa_id ? requestNumbers.get(header.permintaan_sewa_id) ?? null : null,
    detail_count: lines.length,
    lines: lines.map(
      (line): ReservationLineItem => ({
        ...line,
        barang_nama: line.barang_id ? catalogNames.barangNames.get(line.barang_id) ?? null : null,
        varian_nama: line.varian_barang_id ? catalogNames.variantNames.get(line.varian_barang_id) ?? null : null,
        paket_nama: line.paket_sewa_id ? catalogNames.packageNames.get(line.paket_sewa_id) ?? null : null,
      }),
    ),
  };
}

export function getReservationCapabilities(): ReservationCapabilities {
  return {
    read: true,
    mutation: true,
    commands: [
      "create_reservation_from_request",
      "confirm_reservation",
      "cancel_reservation",
    ],
    reason:
      "Command Reservasi berjalan melalui trusted RPC dengan tenant validation, idempotency, transaction atomicity, audit, outbox, dan revalidasi source.",
  };
}

function newCommandRequestId() {
  return crypto.randomUUID();
}

function assertRpcResult<T>(data: T | null, error: unknown, label: string): T {
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
  if (data == null) throw new Error(`${label}: server tidak mengembalikan hasil command.`);
  return data;
}

type ReservationCommandOptions = {
  idempotencyKey?: string;
  requestId?: string;
};

export async function createReservationFromRequest(
  usahaId: string,
  permintaanSewaId: string,
  lines: ReservationPricingLine[],
  options: ReservationCommandOptions = {},
): Promise<ReservationCommandResult> {
  const { data, error } = await supabase.rpc("command_create_reservation_from_request", {
    p_usaha_id: usahaId,
    p_permintaan_sewa_id: permintaanSewaId,
    p_lines: lines,
    p_idempotency_key: options.idempotencyKey ?? `create-reservation-${permintaanSewaId}-${crypto.randomUUID()}`,
    p_request_id: options.requestId ?? newCommandRequestId(),
  });
  return assertRpcResult(data as ReservationCommandResult | null, error, "Pembuatan reservasi");
}

export async function confirmReservation(
  usahaId: string,
  reservationId: string,
  options: ReservationCommandOptions = {},
): Promise<ReservationCommandResult> {
  const { data, error } = await supabase.rpc("command_confirm_reservation", {
    p_usaha_id: usahaId,
    p_reservasi_id: reservationId,
    p_idempotency_key: options.idempotencyKey ?? `confirm-reservation-${reservationId}-${crypto.randomUUID()}`,
    p_request_id: options.requestId ?? newCommandRequestId(),
  });
  return assertRpcResult(data as ReservationCommandResult | null, error, "Konfirmasi reservasi");
}

export async function cancelReservation(
  usahaId: string,
  reservationId: string,
  reason: string,
  options: ReservationCommandOptions = {},
): Promise<ReservationCommandResult> {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error("Alasan pembatalan wajib diisi.");
  const { data, error } = await supabase.rpc("command_cancel_reservation", {
    p_usaha_id: usahaId,
    p_reservasi_id: reservationId,
    p_reason: normalizedReason,
    p_idempotency_key: options.idempotencyKey ?? `cancel-reservation-${reservationId}-${crypto.randomUUID()}`,
    p_request_id: options.requestId ?? newCommandRequestId(),
  });
  return assertRpcResult(data as ReservationCommandResult | null, error, "Pembatalan reservasi");
}
