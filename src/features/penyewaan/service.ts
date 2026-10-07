import { supabase } from "@/app/providers/supabase/client";
import { createClientId } from "@/lib/client-id";
import type {
  AssignableRentalUnit,
  AssignRentalUnitInput,
  CompleteRentalHandoverInput,
  CreateDirectRentalInput,
  CreateRentalFromReservationInput,
  RentalAssignment,
  RentalCapabilities,
  RentalCommandOptions,
  RentalCommandResult,
  RentalComponent,
  RentalDetail,
  RentalDetailLine,
  RentalExtension,
  RentalHandover,
  RentalListFilters,
  RentalListItem,
  RentalListLineSummary,
  RentalReconciliationResult,
  RentalTenantContext,
  RenterRentalListItem,
  RentalPolicyInput,
  RentalToleranceHistory,
  RentalLateFeeAssessment,
  AutoAssignRentalResult,
  AutoAssignRentalTarget,
} from "./types";
import { sanitizeRentalSearch } from "./utils";

type MembershipRow = { usaha_id: string; status: string; revoked_at: string | null };
type RentalHeader = {
  penyewaan_id: string;
  usaha_id: string;
  reservasi_id: string | null;
  penyewa_id: string;
  nomor_penyewaan: string;
  jadwal_mulai: string;
  jadwal_kembali: string;
  tolerance_deadline: string | null;
  actual_pickup_at: string | null;
  actual_return_started_at: string | null;
  actual_return_completed_at: string | null;
  status: string;
  total_amount: string | number;
  currency_code: string;
  catatan: string | null;
  created_at: string;
  updated_at: string;
};

const RENTAL_SELECT =
  "penyewaan_id,usaha_id,reservasi_id,penyewa_id,nomor_penyewaan,jadwal_mulai,jadwal_kembali,tolerance_deadline,actual_pickup_at,actual_return_started_at,actual_return_completed_at,status,total_amount,currency_code,catatan,created_at,updated_at";
const DETAIL_SELECT =
  "detail_penyewaan_id,usaha_id,penyewaan_id,barang_id,varian_barang_id,paket_sewa_id,jumlah,unit_price,currency_code,subtotal,catatan";

export async function getPenyewaanContext(): Promise<RentalTenantContext> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error("Sesi admin tidak ditemukan.");

  const { data: admin, error: adminError } = await supabase.from("akun_admin").select("akun_admin_id").eq("auth_user_id", userData.user.id).eq("status", "active").maybeSingle();
  if (adminError) throw adminError;
  if (!admin) throw new Error("Akun admin aktif tidak ditemukan.");

  const { data: memberships, error: membershipError } = await supabase.from("keanggotaan_usaha").select("usaha_id,status,revoked_at").eq("akun_admin_id", admin.akun_admin_id).eq("status", "active").is("revoked_at", null);
  if (membershipError) throw membershipError;
  const rows = (memberships ?? []) as MembershipRow[];
  if (rows.length === 0) throw new Error("Akun admin belum memiliki Usaha aktif.");
  if (rows.length > 1) throw new Error("Konteks Usaha belum ditentukan karena ada lebih dari satu keanggotaan aktif.");

  const { data: usaha, error: usahaError } = await supabase
    .from("usaha")
    .select("usaha_id,nama,status,timezone,default_tolerance_hours,late_fee_enabled,late_fee_per_hour")
    .eq("usaha_id", rows[0].usaha_id)
    .eq("status", "active")
    .maybeSingle();
  if (usahaError) throw usahaError;
  if (!usaha) throw new Error("Usaha aktif tidak ditemukan.");
  return {
    akunAdminId: admin.akun_admin_id as string,
    usahaId: usaha.usaha_id as string,
    usahaNama: usaha.nama as string,
    timezone: usaha.timezone as string,
    defaultToleranceHours: Number(usaha.default_tolerance_hours ?? 10),
    lateFeeEnabled: Boolean(usaha.late_fee_enabled),
    lateFeePerHour: Number(usaha.late_fee_per_hour ?? 0),
  };
}


export async function updateRentalPolicy(usahaId: string, input: RentalPolicyInput, options: RentalCommandOptions = {}) {
  const { data, error } = await supabase.rpc("command_update_rental_policy", {
    p_usaha_id: usahaId,
    p_default_tolerance_hours: input.defaultToleranceHours,
    p_late_fee_enabled: input.lateFeeEnabled,
    p_late_fee_per_hour: input.lateFeePerHour,
    p_idempotency_key: options.idempotencyKey ?? ("update-rental-policy-" + createClientId()),
    p_request_id: options.requestId ?? createClientId(),
  });
  if (error) throw error;
  return data as RentalTenantContext;
}

export async function extendRentalTolerance(
  usahaId: string,
  penyewaanId: string,
  input: { additionalMinutes: number; reason: string },
  options: RentalCommandOptions = {},
) {
  const { data, error } = await supabase.rpc("command_extend_rental_tolerance", {
    p_usaha_id: usahaId,
    p_penyewaan_id: penyewaanId,
    p_additional_minutes: input.additionalMinutes,
    p_reason: input.reason,
    p_idempotency_key: options.idempotencyKey ?? ("extend-rental-tolerance-" + createClientId()),
    p_request_id: options.requestId ?? createClientId(),
  });
  if (error) throw error;
  return data as {
    penyewaan_id: string;
    nomor_penyewaan: string;
    jadwal_kembali: string;
    tolerance_sebelum: string;
    tolerance_sesudah: string;
    tambahan_menit: number;
    history_id: string;
  };
}

export async function listRentalToleranceHistory(usahaId: string, penyewaanId: string): Promise<RentalToleranceHistory[]> {
  const { data, error } = await supabase
    .from("riwayat_toleransi_penyewaan")
    .select("riwayat_toleransi_penyewaan_id,usaha_id,penyewaan_id,tolerance_sebelum,tolerance_sesudah,tambahan_menit,alasan,actor_akun_admin_id,request_id,occurred_at,created_at")
    .eq("usaha_id", usahaId)
    .eq("penyewaan_id", penyewaanId)
    .order("occurred_at", { ascending: false });
  if (error) throw error;

  const history = (data ?? []) as RentalToleranceHistory[];
  const actorIds = [...new Set(history.map((item) => item.actor_akun_admin_id).filter(Boolean))];
  if (!actorIds.length) return history;

  const { data: actors, error: actorError } = await supabase
    .from("akun_admin")
    .select("akun_admin_id,nama_tampilan")
    .eq("status", "active")
    .in("akun_admin_id", actorIds);

  if (actorError) throw actorError;

  const names = new Map((actors ?? []).map((actor) => [actor.akun_admin_id, actor.nama_tampilan]));
  return history.map((item) => ({
    ...item,
    actor_nama_tampilan: names.get(item.actor_akun_admin_id) ?? null,
  }));
}

export async function calculateRentalLateFee(
  usahaId: string,
  penyewaanId: string,
  asOf?: string,
): Promise<RentalLateFeeAssessment> {
  const { data, error } = await supabase.rpc("calculate_rental_late_fee", {
    p_usaha_id: usahaId,
    p_penyewaan_id: penyewaanId,
    p_as_of: asOf ?? new Date().toISOString(),
  });
  if (error) throw error;
  return data as RentalLateFeeAssessment;
}

async function findRenterIds(usahaId: string, search: string) {
  const term = sanitizeRentalSearch(search);
  if (!term) return [] as string[];
  const pattern = "%" + term + "%";
  const { data, error } = await supabase.from("penyewa").select("penyewa_id").eq("usaha_id", usahaId).or("nama_lengkap.ilike." + pattern + ",nomor_telepon.ilike." + pattern).limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => row.penyewa_id as string);
}

async function findUnitIds(usahaId: string, search: string) {
  const term = sanitizeRentalSearch(search);
  if (!term) return [] as string[];
  const pattern = "%" + term + "%";
  const { data, error } = await supabase.from("unit_barang").select("unit_barang_id").eq("usaha_id", usahaId).or("kode_unit.ilike." + pattern + ",serial_number.ilike." + pattern).limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => row.unit_barang_id as string);
}

async function resolveRenterNames(usahaId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data, error } = await supabase.from("penyewa").select("penyewa_id,nama_lengkap").eq("usaha_id", usahaId).in("penyewa_id", Array.from(new Set(ids)));
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.penyewa_id as string, row.nama_lengkap as string]));
}

async function countDetails(usahaId: string, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const { data, error } = await supabase.from("detail_penyewaan").select("penyewaan_id").eq("usaha_id", usahaId).in("penyewaan_id", ids);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = row.penyewaan_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function countAssignments(usahaId: string, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const { data, error } = await supabase.from("penetapan_unit").select("detail_penyewaan_id").eq("usaha_id", usahaId).eq("status", "assigned").in("detail_penyewaan_id", await getDetailIds(usahaId, ids));
  if (error) throw error;
  const detailToRental = await getDetailToRental(usahaId, ids);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const rentalId = detailToRental.get(row.detail_penyewaan_id as string);
    if (rentalId) counts.set(rentalId, (counts.get(rentalId) ?? 0) + 1);
  }
  return counts;
}

async function getDetailIds(usahaId: string, rentalIds: string[]) {
  const { data, error } = await supabase.from("detail_penyewaan").select("detail_penyewaan_id").eq("usaha_id", usahaId).in("penyewaan_id", rentalIds);
  if (error) throw error;
  return (data ?? []).map((row) => row.detail_penyewaan_id as string);
}

async function getDetailToRental(usahaId: string, rentalIds: string[]) {
  const { data, error } = await supabase.from("detail_penyewaan").select("detail_penyewaan_id,penyewaan_id").eq("usaha_id", usahaId).in("penyewaan_id", rentalIds);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.detail_penyewaan_id as string, row.penyewaan_id as string]));
}

async function resolveUnitCodes(usahaId: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data, error } = await supabase.from("unit_barang").select("unit_barang_id,kode_unit").eq("usaha_id", usahaId).in("unit_barang_id", Array.from(new Set(ids)));
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.unit_barang_id as string, row.kode_unit as string]));
}

async function resolveCatalogNames(usahaId: string, detailRows: Array<{ barang_id: string | null; varian_barang_id: string | null; paket_sewa_id: string | null }>) {
  const barangIds = new Set(detailRows.map((row) => row.barang_id).filter((id): id is string => Boolean(id)));
  const variantIds = Array.from(new Set(detailRows.map((row) => row.varian_barang_id).filter((id): id is string => Boolean(id))));
  const packageIds = Array.from(new Set(detailRows.map((row) => row.paket_sewa_id).filter((id): id is string => Boolean(id))));

  const [variants, packages] = await Promise.all([
    variantIds.length ? supabase.from("varian_barang").select("varian_barang_id,nama,barang_id").eq("usaha_id", usahaId).in("varian_barang_id", variantIds) : Promise.resolve({ data: [], error: null }),
    packageIds.length ? supabase.from("paket_sewa").select("paket_sewa_id,nama").eq("usaha_id", usahaId).in("paket_sewa_id", packageIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (variants.error) throw variants.error;
  if (packages.error) throw packages.error;

  for (const variant of variants.data ?? []) {
    if (variant.barang_id) barangIds.add(variant.barang_id as string);
  }

  const barangIdList = Array.from(barangIds);
  const barangs = barangIdList.length
    ? await supabase.from("barang").select("barang_id,nama").eq("usaha_id", usahaId).in("barang_id", barangIdList)
    : { data: [], error: null };
  if (barangs.error) throw barangs.error;

  return {
    barang: new Map((barangs.data ?? []).map((row) => [row.barang_id as string, row.nama as string])),
    variant: new Map((variants.data ?? []).map((row) => [row.varian_barang_id as string, row.nama as string])),
    variantParent: new Map((variants.data ?? []).map((row) => [row.varian_barang_id as string, row.barang_id as string | null])),
    package: new Map((packages.data ?? []).map((row) => [row.paket_sewa_id as string, row.nama as string])),
  };
}

async function resolveRentalListLineSummaries(usahaId: string, rentalIds: string[]) {
  const empty = new Map<string, RentalListLineSummary[]>();
  if (!rentalIds.length) return empty;

  const detailResult = await supabase
    .from("detail_penyewaan")
    .select("detail_penyewaan_id,penyewaan_id,barang_id,varian_barang_id,paket_sewa_id,jumlah")
    .eq("usaha_id", usahaId)
    .in("penyewaan_id", rentalIds)
    .order("created_at", { ascending: true });
  if (detailResult.error) throw detailResult.error;

  const details = (detailResult.data ?? []) as Array<{
    detail_penyewaan_id: string;
    penyewaan_id: string;
    barang_id: string | null;
    varian_barang_id: string | null;
    paket_sewa_id: string | null;
    jumlah: string | number;
  }>;

  const componentIds = details.map((detail) => detail.detail_penyewaan_id);
  const componentResult = componentIds.length
    ? await supabase
      .from("komponen_penyewaan")
      .select("komponen_penyewaan_id,detail_penyewaan_id,barang_id,varian_barang_id,paket_sewa_id,jumlah")
      .eq("usaha_id", usahaId)
      .in("detail_penyewaan_id", componentIds)
      .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (componentResult.error) throw componentResult.error;

  const components = (componentResult.data ?? []) as Array<{
    komponen_penyewaan_id: string;
    detail_penyewaan_id: string;
    barang_id: string | null;
    varian_barang_id: string | null;
    paket_sewa_id: string | null;
    jumlah: string | number;
  }>;

  const [catalog, componentCatalog] = await Promise.all([
    resolveCatalogNames(usahaId, details),
    resolveCatalogNames(usahaId, components),
  ]);

  const componentsByDetail = new Map<string, RentalListLineSummary["components"]>();
  for (const component of components) {
    const componentBarangId = component.barang_id ?? componentCatalog.variantParent.get(component.varian_barang_id ?? "") ?? null;
    const label = component.varian_barang_id
      ? `${componentCatalog.barang.get(componentBarangId ?? "") ?? "Barang"} · ${componentCatalog.variant.get(component.varian_barang_id) ?? "Varian"}`
      : componentCatalog.barang.get(componentBarangId ?? "") ?? "Komponen paket";
    const current = componentsByDetail.get(component.detail_penyewaan_id) ?? [];
    current.push({ label, quantity: Number(component.jumlah) });
    componentsByDetail.set(component.detail_penyewaan_id, current);
  }

  const summaries = new Map<string, RentalListLineSummary[]>();
  for (const detail of details) {
    const kind: RentalListLineSummary["kind"] = detail.paket_sewa_id
      ? "paket"
      : detail.varian_barang_id
        ? "varian"
        : "barang";
    const detailBarangId = detail.barang_id ?? catalog.variantParent.get(detail.varian_barang_id ?? "") ?? null;
    const label = detail.paket_sewa_id
      ? catalog.package.get(detail.paket_sewa_id) ?? "Paket sewa"
      : detail.varian_barang_id
        ? `${catalog.barang.get(detailBarangId ?? "") ?? "Barang"} · ${catalog.variant.get(detail.varian_barang_id) ?? "Varian"}`
        : catalog.barang.get(detailBarangId ?? "") ?? "Barang";

    const line: RentalListLineSummary = {
      detail_penyewaan_id: detail.detail_penyewaan_id,
      kind,
      label,
      quantity: Number(detail.jumlah),
      component_count: componentsByDetail.get(detail.detail_penyewaan_id)?.length ?? 0,
      components: componentsByDetail.get(detail.detail_penyewaan_id) ?? [],
    };

    const current = summaries.get(detail.penyewaan_id) ?? [];
    current.push(line);
    summaries.set(detail.penyewaan_id, current);
  }

  return summaries;
}

function addDays(dateString: string, days: number) {
  const date = new Date(dateString + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function timezoneOffsetMinutes(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  if (value === "GMT") return 0;
  const match = value.match(/^GMT([+-])(\\d{2})(?::?(\\d{2}))?$/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

function localDateBoundaryIso(dateString: string, timeZone: string) {
  const guess = new Date(dateString + "T00:00:00.000Z");
  const offsetMinutes = timezoneOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offsetMinutes * 60_000).toISOString();
}

export async function listRentals(usahaId: string, filters: RentalListFilters, timeZone = "UTC") {
  const start = Math.max(0, filters.page - 1) * filters.pageSize;
  const end = start + filters.pageSize - 1;
  let query = supabase.from("penyewaan").select(RENTAL_SELECT, { count: "exact" }).eq("usaha_id", usahaId);

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.dateFrom) {
    query = query.gte("jadwal_mulai", localDateBoundaryIso(filters.dateFrom, timeZone));
  }

  if (filters.dateTo) {
    query = query.lt("jadwal_mulai", localDateBoundaryIso(addDays(filters.dateTo, 1), timeZone));
  }

  const renterFilterTerm = sanitizeRentalSearch(filters.renterSearch);
  if (renterFilterTerm) {
    const renterIds = await findRenterIds(usahaId, renterFilterTerm);
    query = renterIds.length ? query.in("penyewa_id", renterIds) : query.in("penyewa_id", ["00000000-0000-0000-0000-000000000000"]);
  }

  const term = sanitizeRentalSearch(filters.search);
  if (term) {
    const [renterIds, unitIds] = await Promise.all([findRenterIds(usahaId, term), findUnitIds(usahaId, term)]);
    const pattern = "*" + term + "*";
    const clauses = ["nomor_penyewaan.ilike." + pattern, "status.ilike." + pattern];
    if (renterIds.length) clauses.push("penyewa_id.in.(" + renterIds.join(",") + ")");
    if (unitIds.length) {
      const assignmentRows = await supabase
        .from("penetapan_unit")
        .select("detail_penyewaan_id")
        .eq("usaha_id", usahaId)
        .in("unit_barang_id", unitIds)
        .limit(200);
      if (assignmentRows.error) throw assignmentRows.error;
      const detailAssignmentIds = (assignmentRows.data ?? []).map((row) => row.detail_penyewaan_id as string);
      if (detailAssignmentIds.length) {
        const detailRows = await supabase
          .from("detail_penyewaan")
          .select("penyewaan_id")
          .eq("usaha_id", usahaId)
          .in("detail_penyewaan_id", detailAssignmentIds);
        if (detailRows.error) throw detailRows.error;
        const rentalIds = Array.from(new Set((detailRows.data ?? []).map((row) => row.penyewaan_id as string)));
        if (rentalIds.length) clauses.push("penyewaan_id.in.(" + rentalIds.join(",") + ")");
      }
    }
    query = query.or(clauses.join(","));
  }
  query = query.order("jadwal_mulai", { ascending: false }).order("nomor_penyewaan", { ascending: false }).range(start, end);
  const { data, error, count } = await query;
  if (error) throw error;
  const rows = (data ?? []) as RentalHeader[];
  const ids = rows.map((row) => row.penyewaan_id);
  const [renterNames, detailCounts, assignmentCounts, lineSummaries] = await Promise.all([
    resolveRenterNames(usahaId, rows.map((row) => row.penyewa_id)),
    countDetails(usahaId, ids),
    countAssignments(usahaId, ids),
    resolveRentalListLineSummaries(usahaId, ids),
  ]);
  return {
    rentals: rows.map((row): RentalListItem => ({
      ...row,
      penyewa_nama: renterNames.get(row.penyewa_id) ?? null,
      detail_count: detailCounts.get(row.penyewaan_id) ?? 0,
      assignment_count: assignmentCounts.get(row.penyewaan_id) ?? 0,
      lines: lineSummaries.get(row.penyewaan_id) ?? [],
    })),
    total: count ?? 0,
  };
}

export async function getRental(usahaId: string, id: string): Promise<RentalDetail> {
  const { data, error } = await supabase.from("penyewaan").select(RENTAL_SELECT).eq("usaha_id", usahaId).eq("penyewaan_id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Penyewaan tidak ditemukan dalam Usaha aktif.");
  const header = data as RentalHeader;

  const [detailResult, assignmentResult, componentResult, handoverResult, extensionResult, renterResult] = await Promise.all([
    supabase.from("detail_penyewaan").select(DETAIL_SELECT).eq("usaha_id", usahaId).eq("penyewaan_id", id).order("created_at", { ascending: true }),
    supabase.from("penetapan_unit").select("penetapan_unit_id,usaha_id,detail_penyewaan_id,komponen_penyewaan_id,unit_barang_id,asal_pilihan_unit_id,status,ditetapkan_at,dibatalkan_at,alasan_substitusi,ditetapkan_by_admin_id,catatan").eq("usaha_id", usahaId).in("detail_penyewaan_id", await getDetailIds(usahaId, [id])).order("ditetapkan_at", { ascending: false }),
    supabase.from("komponen_penyewaan").select("komponen_penyewaan_id,detail_penyewaan_id,barang_id,varian_barang_id,paket_sewa_id,jumlah,catatan").eq("usaha_id", usahaId).in("detail_penyewaan_id", await getDetailIds(usahaId, [id])).order("created_at", { ascending: true }),
    supabase.from("serah_terima").select("serah_terima_id,usaha_id,penyewaan_id,serah_terima_at,actor_admin_id,status,catatan").eq("usaha_id", usahaId).eq("penyewaan_id", id).order("serah_terima_at", { ascending: false }).limit(1),
    supabase.from("perpanjangan_sewa").select("perpanjangan_sewa_id,usaha_id,penyewaan_id,jadwal_kembali_sebelum,jadwal_kembali_sesudah,diminta_at,disetujui_at,disetujui_by_admin_id,status,tambahan_amount,currency_code,alasan").eq("usaha_id", usahaId).eq("penyewaan_id", id).order("diminta_at", { ascending: false }),
    supabase.from("penyewa").select("penyewa_id,nama_lengkap,nomor_telepon").eq("usaha_id", usahaId).eq("penyewa_id", header.penyewa_id).maybeSingle(),
  ]);
  if (detailResult.error) throw detailResult.error;
  if (assignmentResult.error) throw assignmentResult.error;
  if (componentResult.error) throw componentResult.error;
  if (handoverResult.error) throw handoverResult.error;
  if (extensionResult.error) throw extensionResult.error;
  if (renterResult.error) throw renterResult.error;

  const rawLines = (detailResult.data ?? []) as Array<{
    detail_penyewaan_id: string; usaha_id: string; penyewaan_id: string;
    barang_id: string | null; varian_barang_id: string | null; paket_sewa_id: string | null;
    jumlah: string | number; unit_price: string | number; currency_code: string; subtotal: string | number; catatan: string | null;
  }>;
  const catalog = await resolveCatalogNames(usahaId, rawLines);
  const rawAssignments = (assignmentResult.data ?? []) as Omit<RentalAssignment, "kode_unit">[];
  const rawComponents = (componentResult.data ?? []) as Array<{
    komponen_penyewaan_id: string;
    detail_penyewaan_id: string;
    barang_id: string | null;
    varian_barang_id: string | null;
    paket_sewa_id: string | null;
    jumlah: string | number;
    catatan: string | null;
  }>;
  const unitCodes = await resolveUnitCodes(usahaId, rawAssignments.map((row) => row.unit_barang_id));
  const componentCatalog = await resolveCatalogNames(usahaId, rawComponents);

  return {
    ...header,
    penyewa_nama: renterResult.data?.nama_lengkap ?? null,
    penyewa_telepon: renterResult.data?.nomor_telepon ?? null,
    detail_count: rawLines.length,
    assignment_count: rawAssignments.filter((row) => row.status === "assigned").length,
    lines: rawLines.map((line): RentalDetailLine => ({
      ...line,
      barang_nama: line.barang_id
        ? catalog.barang.get(line.barang_id) ?? null
        : line.varian_barang_id
          ? catalog.barang.get(catalog.variantParent.get(line.varian_barang_id) ?? "") ?? null
          : null,
      varian_nama: line.varian_barang_id ? catalog.variant.get(line.varian_barang_id) ?? null : null,
      paket_nama: line.paket_sewa_id ? catalog.package.get(line.paket_sewa_id) ?? null : null,
    })),
    components: rawComponents.map((component): RentalComponent => ({
      ...component,
      barang_nama: component.barang_id
        ? componentCatalog.barang.get(component.barang_id) ?? null
        : component.varian_barang_id
          ? componentCatalog.barang.get(componentCatalog.variantParent.get(component.varian_barang_id) ?? "") ?? null
          : null,
      varian_nama: component.varian_barang_id ? componentCatalog.variant.get(component.varian_barang_id) ?? null : null,
    })),
    assignments: rawAssignments.map((row): RentalAssignment => ({ ...row, kode_unit: unitCodes.get(row.unit_barang_id) ?? null })),
    handover: ((handoverResult.data ?? [])[0] as RentalHandover | undefined) ?? null,
    extensions: (extensionResult.data ?? []) as RentalExtension[],
  };
}

export async function listAssignableUnits(
  usahaId: string,
  detailPenyewaanId: string,
  komponenPenyewaanId?: string | null,
): Promise<AssignableRentalUnit[]> {
  const { data: detail, error: detailError } = await supabase
    .from("detail_penyewaan")
    .select("penyewaan_id,barang_id,varian_barang_id,paket_sewa_id")
    .eq("usaha_id", usahaId)
    .eq("detail_penyewaan_id", detailPenyewaanId)
    .maybeSingle();
  if (detailError) throw detailError;
  if (!detail) throw new Error("Detail rental tidak ditemukan dalam Usaha aktif.");

  let barangId: string | null = detail.barang_id as string | null;
  let varianId: string | null = detail.varian_barang_id as string | null;

  if (detail.paket_sewa_id) {
    if (!komponenPenyewaanId) throw new Error("Komponen paket wajib dipilih sebelum memilih unit.");
    const { data: component, error: componentError } = await supabase
      .from("komponen_penyewaan")
      .select("barang_id,varian_barang_id")
      .eq("usaha_id", usahaId)
      .eq("komponen_penyewaan_id", komponenPenyewaanId)
      .eq("detail_penyewaan_id", detailPenyewaanId)
      .maybeSingle();
    if (componentError) throw componentError;
    if (!component) throw new Error("Komponen paket tidak ditemukan dalam Usaha aktif.");
    barangId = component.barang_id as string | null;
    varianId = component.varian_barang_id as string | null;
  }

  let query = supabase
    .from("unit_barang")
    .select("unit_barang_id,kode_unit,serial_number,status,barang_id,varian_barang_id")
    .eq("usaha_id", usahaId)
    .eq("status", "ready")
    .order("kode_unit", { ascending: true })
    .limit(100);

  if (varianId) {
    query = query.eq("varian_barang_id", varianId);
  } else if (barangId) {
    query = query.eq("barang_id", barangId);
  } else {
    return [];
  }

  const { data, error } = await query;
  if (error) throw error;

  const rentalDetailIdsResult = await supabase
    .from("detail_penyewaan")
    .select("detail_penyewaan_id")
    .eq("usaha_id", usahaId)
    .eq("penyewaan_id", detail.penyewaan_id as string);
  if (rentalDetailIdsResult.error) throw rentalDetailIdsResult.error;

  const rentalDetailIds = (rentalDetailIdsResult.data ?? []).map((row) => row.detail_penyewaan_id as string);

  const { data: currentRental, error: rentalError } = await supabase
    .from("penyewaan")
    .select("jadwal_mulai,jadwal_kembali")
    .eq("usaha_id", usahaId)
    .eq("penyewaan_id", detail.penyewaan_id as string)
    .maybeSingle();
  if (rentalError) throw rentalError;
  if (!currentRental) throw new Error("Penyewaan tidak ditemukan dalam Usaha aktif.");

  const candidateIds = (data ?? []).map((row) => row.unit_barang_id as string);
  const { data: assignmentRows, error: assignmentError } = candidateIds.length
    ? await supabase
      .from("penetapan_unit")
      .select("unit_barang_id,detail_penyewaan_id")
      .eq("usaha_id", usahaId)
      .eq("status", "assigned")
      .in("unit_barang_id", candidateIds)
    : { data: [], error: null };
  if (assignmentError) throw assignmentError;

  const competingDetailIds = Array.from(
    new Set(
      (assignmentRows ?? [])
        .map((row) => row.detail_penyewaan_id as string)
        .filter((id) => !rentalDetailIds.includes(id)),
    ),
  );

  const competingDetails = competingDetailIds.length
    ? await supabase
      .from("detail_penyewaan")
      .select("detail_penyewaan_id,penyewaan_id")
      .eq("usaha_id", usahaId)
      .in("detail_penyewaan_id", competingDetailIds)
    : { data: [], error: null };
  if (competingDetails.error) throw competingDetails.error;

  const competingRentalIds = Array.from(
    new Set((competingDetails.data ?? []).map((row) => row.penyewaan_id as string)),
  );

  const competingRentals = competingRentalIds.length
    ? await supabase
      .from("penyewaan")
      .select("penyewaan_id,status,jadwal_mulai,jadwal_kembali")
      .eq("usaha_id", usahaId)
      .in("penyewaan_id", competingRentalIds)
    : { data: [], error: null };
  if (competingRentals.error) throw competingRentals.error;

  const overlappingRentalIds = new Set(
    (competingRentals.data ?? [])
      .filter((row) => {
        const status = row.status as string;
        const operational = !["completed", "cancelled"].includes(status);
        return operational
          && (row.jadwal_mulai as string) < (currentRental.jadwal_kembali as string)
          && (row.jadwal_kembali as string) > (currentRental.jadwal_mulai as string);
      })
      .map((row) => row.penyewaan_id as string),
  );

  const blockedUnitIds = new Set(
    (assignmentRows ?? [])
      .filter((row) => {
        const competingDetail = competingDetails.data?.find(
          (detailRow) => detailRow.detail_penyewaan_id === row.detail_penyewaan_id,
        );
        return competingDetail ? overlappingRentalIds.has(competingDetail.penyewaan_id as string) : false;
      })
      .map((row) => row.unit_barang_id as string),
  );

  return (data ?? [])
    .filter((row) => !blockedUnitIds.has(row.unit_barang_id as string))
    .map((row): AssignableRentalUnit => ({
      unit_barang_id: row.unit_barang_id as string,
      kode_unit: row.kode_unit as string,
      serial_number: (row.serial_number as string | null) ?? null,
      status: row.status as string,
      barang_id: row.barang_id as string,
      varian_barang_id: (row.varian_barang_id as string | null) ?? null,
      barang_nama: null,
      varian_nama: null,
    }));
}

export function getRentalCapabilities(): RentalCapabilities {
  return {
    read: true,
    mutation: true,
    commands: [
      "create_direct_rental",
      "create_rental_from_reservation",
      "assign_rental_unit",
      "complete_rental_handover",
    ],
    reason:
      "Penyewaan mendukung pembuatan langsung, pembuatan penyewa, pembuatan dari Reservasi, Penetapan Unit, dan Serah Terima. Perpanjangan dikelola terpisah.",
  };
}

function newRentalCommandRequestId() {
  return createClientId();
}

function assertRentalRpcResult<T>(data: T | null, error: unknown, label: string): T {
  if (error) {
    if (error instanceof Error) throw new Error(`${label}: ${error.message}`);

    const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
    const message = typeof record?.message === "string" ? record.message : null;
    const hint = typeof record?.hint === "string" ? record.hint : null;
    const details = typeof record?.details === "string" ? record.details : null;
    const code = typeof record?.code === "string" ? record.code : null;
    const status = typeof record?.status === "number" ? `HTTP ${record.status}` : null;
    const parts = [
      message,
      hint,
      details,
      code ? `kode ${code}` : null,
      status,
    ].filter(Boolean) as string[];

    throw new Error(
      `${label}: ${parts.join(" · ") || "server mengembalikan error yang tidak dapat dibaca."}`,
    );
  }
  if (data == null) throw new Error(`${label}: server tidak mengembalikan hasil command.`);
  return data;
}

export async function createRentalFromReservation(
  usahaId: string,
  input: CreateRentalFromReservationInput,
  options: RentalCommandOptions = {},
): Promise<RentalCommandResult> {
  if (!input.reservasiId.trim()) throw new Error("Reservasi wajib dipilih.");
  if (!input.jadwalMulai || !input.jadwalKembali) throw new Error("Jadwal rental wajib diisi.");
  const start = new Date(input.jadwalMulai);
  const end = new Date(input.jadwalKembali);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error("Jadwal rental tidak valid.");
  }

  const { data, error } = await supabase.rpc("command_create_rental_from_reservation", {
    p_usaha_id: usahaId,
    p_reservasi_id: input.reservasiId,
    p_jadwal_mulai: input.jadwalMulai,
    p_jadwal_kembali: input.jadwalKembali,
    p_idempotency_key: options.idempotencyKey ?? `create-rental-${createClientId()}`,
    p_request_id: options.requestId ?? newRentalCommandRequestId(),
  });
  return assertRentalRpcResult(data as RentalCommandResult | null, error, "Pembuatan penyewaan");
}

export async function assignRentalUnit(
  usahaId: string,
  input: AssignRentalUnitInput,
  options: RentalCommandOptions = {},
): Promise<RentalCommandResult> {
  const { data, error } = await supabase.rpc("command_assign_rental_unit_checked", {
    p_usaha_id: usahaId,
    p_penyewaan_id: input.penyewaanId,
    p_detail_penyewaan_id: input.detailPenyewaanId,
    p_unit_barang_id: input.unitBarangId,
    p_komponen_penyewaan_id: input.komponenPenyewaanId ?? null,
    p_asal_pilihan_unit_id: input.asalPilihanUnitId ?? null,
    p_alasan_substitusi: input.alasanSubstitusi?.trim() || null,
    p_catatan: input.catatan?.trim() || null,
    p_idempotency_key: options.idempotencyKey ?? `assign-rental-unit-${createClientId()}`,
    p_request_id: options.requestId ?? newRentalCommandRequestId(),
  });
  return assertRentalRpcResult(data as RentalCommandResult | null, error, "Penetapan unit");
}

export async function autoAssignRentalUnits(
  usahaId: string,
  penyewaanId: string,
  targets: AutoAssignRentalTarget[],
): Promise<AutoAssignRentalResult> {
  const assignedUnitIds: string[] = [];
  const failedTargets: AutoAssignRentalResult["failedTargets"] = [];

  for (const target of targets) {
    const missing = Math.max(0, target.requiredQuantity - target.assignedQuantity);
    if (!missing) continue;

    let remaining = missing;
    const candidates = await listAssignableUnits(
      usahaId,
      target.detailPenyewaanId,
      target.komponenPenyewaanId,
    );

    for (const candidate of candidates) {
      if (remaining <= 0) break;

      try {
        await assignRentalUnit(
          usahaId,
          {
            penyewaanId,
            detailPenyewaanId: target.detailPenyewaanId,
            unitBarangId: candidate.unit_barang_id,
            komponenPenyewaanId: target.komponenPenyewaanId ?? null,
            alasanSubstitusi: null,
            catatan: "Penetapan otomatis dari alur Penyewaan.",
          },
          {
            idempotencyKey: `auto-assign-${penyewaanId}-${target.detailPenyewaanId}-${candidate.unit_barang_id}`,
            requestId: createClientId(),
          },
        );
        assignedUnitIds.push(candidate.unit_barang_id);
        remaining -= 1;
      } catch (error) {
        // A checked assignment revalidates the unit at mutation time.
        // When a candidate became unavailable between read and mutation,
        // continue to the next currently listed candidate.
        const message = error instanceof Error ? error.message : "Penetapan otomatis gagal.";
        if (message.includes("BUSINESS_CONFLICT: unit ")) continue;
        failedTargets.push({
          detailPenyewaanId: target.detailPenyewaanId,
          komponenPenyewaanId: target.komponenPenyewaanId ?? null,
          remaining,
          reason: message,
        });
        break;
      }
    }

    if (remaining > 0 && !failedTargets.some(
      (failure) =>
        failure.detailPenyewaanId === target.detailPenyewaanId &&
        failure.komponenPenyewaanId === (target.komponenPenyewaanId ?? null),
    )) {
      failedTargets.push({
        detailPenyewaanId: target.detailPenyewaanId,
        komponenPenyewaanId: target.komponenPenyewaanId ?? null,
        remaining,
        reason: "Tidak ada unit ready yang cocok untuk sisa kebutuhan saat ini.",
      });
    }
  }

  const remainingCount = failedTargets.reduce((sum, failure) => sum + failure.remaining, 0);
  return {
    state: remainingCount > 0 ? "partial" : "completed",
    assignedCount: assignedUnitIds.length,
    remainingCount,
    assignedUnitIds,
    failedTargets,
  };
}

export async function completeRentalHandover(
  usahaId: string,
  input: CompleteRentalHandoverInput,
  options: RentalCommandOptions = {},
): Promise<RentalCommandResult> {
  if (!input.penyewaanId.trim()) throw new Error("Penyewaan wajib dipilih.");
  const { data, error } = await supabase.rpc("command_complete_rental_handover", {
    p_usaha_id: usahaId,
    p_penyewaan_id: input.penyewaanId,
    p_serah_terima_at: input.serahTerimaAt ?? null,
    p_catatan: input.catatan?.trim() || null,
    p_idempotency_key: options.idempotencyKey ?? `pickup-rental-${createClientId()}`,
    p_request_id: options.requestId ?? newRentalCommandRequestId(),
  });
  return assertRentalRpcResult(data as RentalCommandResult | null, error, "Serah-terima penyewaan");
}

export async function reconcileRentalCreation(
  usahaId: string,
  idempotencyKey: string,
): Promise<RentalReconciliationResult> {
  const { data, error } = await supabase.rpc("command_reconcile_rental_creation", {
    p_usaha_id: usahaId,
    p_idempotency_key: idempotencyKey,
  });
  return assertRentalRpcResult(data as RentalReconciliationResult | null, error, "Rekonsiliasi pembuatan rental");
}

export async function reconcileRentalAssignment(
  usahaId: string,
  idempotencyKey: string,
): Promise<RentalReconciliationResult> {
  const { data, error } = await supabase.rpc("command_reconcile_rental_assignment", {
    p_usaha_id: usahaId,
    p_idempotency_key: idempotencyKey,
  });
  return assertRentalRpcResult(data as RentalReconciliationResult | null, error, "Rekonsiliasi penetapan unit");
}

export async function reconcileRentalHandover(
  usahaId: string,
  idempotencyKey: string,
): Promise<RentalReconciliationResult> {
  const { data, error } = await supabase.rpc("command_reconcile_rental_handover", {
    p_usaha_id: usahaId,
    p_idempotency_key: idempotencyKey,
  });
  return assertRentalRpcResult(data as RentalReconciliationResult | null, error, "Rekonsiliasi serah-terima");
}


export async function createDirectRental(
  usahaId: string,
  input: CreateDirectRentalInput,
  options: RentalCommandOptions = {},
): Promise<RentalCommandResult> {
  const lines = input.lines.map((line) => {
    const subtotal = Math.round(line.subtotal * 100) / 100;
    return {
      barang_id: line.varian_barang_id ? null : (line.barang_id ?? null),
      varian_barang_id: line.varian_barang_id ?? null,
      paket_sewa_id: line.paket_sewa_id ?? null,
      jumlah: line.jumlah,
      unit_price: line.unit_price,
      currency_code: line.currency_code ?? "IDR",
      subtotal,
      tarif_sewa_id: line.tarif_sewa_id,
      duration_periods: line.duration_periods,
      catatan: line.catatan?.trim() || null,
    };
  });
  if (!input.penyewa_id) throw new Error("Penyewa wajib dipilih.");
  if (!lines.length) throw new Error("Minimal satu detail rental wajib dipilih.");
  const start = new Date(input.jadwal_mulai);
  const end = new Date(input.jadwal_kembali);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error("Jadwal rental tidak valid.");
  }
  const { data, error } = await supabase.rpc("command_create_direct_rental", {
    p_usaha_id: usahaId,
    p_penyewa_id: input.penyewa_id,
    p_jadwal_mulai: input.jadwal_mulai,
    p_jadwal_kembali: input.jadwal_kembali,
    p_lines: lines,
    p_catatan: input.catatan?.trim() || null,
    p_idempotency_key: options.idempotencyKey ?? `create-direct-rental-${createClientId()}`,
    p_request_id: options.requestId ?? createClientId(),
  });
  return assertRentalRpcResult(data as RentalCommandResult | null, error, "Pembuatan rental langsung");
}

export async function listRentalsByRenter(
  usahaId: string,
  penyewaId: string,
): Promise<RenterRentalListItem[]> {
  const { data, error } = await supabase
    .from("penyewaan")
    .select("penyewaan_id,usaha_id,nomor_penyewaan,jadwal_mulai,jadwal_kembali,status,total_amount,currency_code")
    .eq("usaha_id", usahaId)
    .eq("penyewa_id", penyewaId)
    .order("jadwal_mulai", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    penyewaan_id: string;
    usaha_id: string;
    nomor_penyewaan: string;
    jadwal_mulai: string;
    jadwal_kembali: string;
    status: string;
    total_amount: string | number;
    currency_code: string;
  }>;
  const ids = rows.map((row) => row.penyewaan_id);
  if (!ids.length) return [];

  const [detailResult, assignmentResult] = await Promise.all([
    supabase.from("detail_penyewaan").select("penyewaan_id").eq("usaha_id", usahaId).in("penyewaan_id", ids),
    supabase
      .from("penetapan_unit")
      .select("detail_penyewaan_id")
      .eq("usaha_id", usahaId)
      .eq("status", "assigned")
      .in("detail_penyewaan_id", await getDetailIds(usahaId, ids)),
  ]);
  if (detailResult.error) throw detailResult.error;
  if (assignmentResult.error) throw assignmentResult.error;

  const detailCounts = new Map<string, number>();
  for (const row of detailResult.data ?? []) {
    const rentalId = row.penyewaan_id as string;
    detailCounts.set(rentalId, (detailCounts.get(rentalId) ?? 0) + 1);
  }

  const detailIds = Array.from(new Set((assignmentResult.data ?? []).map((row) => row.detail_penyewaan_id as string)));
  const detailToRental = detailIds.length
    ? await getDetailToRental(usahaId, ids)
    : new Map<string, string>();
  const assignmentCounts = new Map<string, number>();
  for (const detailId of detailIds) {
    const rentalId = detailToRental.get(detailId);
    if (rentalId) assignmentCounts.set(rentalId, (assignmentCounts.get(rentalId) ?? 0) + 1);
  }

  return rows.map((row) => ({
    ...row,
    detail_count: detailCounts.get(row.penyewaan_id) ?? 0,
    assignment_count: assignmentCounts.get(row.penyewaan_id) ?? 0,
  }));
}


export async function reconcileDirectRentalCreation(
  usahaId: string,
  idempotencyKey: string,
): Promise<RentalReconciliationResult> {
  const { data, error } = await supabase.rpc("command_reconcile_direct_rental_creation", {
    p_usaha_id: usahaId,
    p_idempotency_key: idempotencyKey,
  });
  return assertRentalRpcResult(data as RentalReconciliationResult | null, error, "Rekonsiliasi pembuatan rental walk-in");
}


export type DirectRentalAvailabilityPreview = {
  readyPhysicalUnits: number;
  requestedUnits: number;
  physicalCheck: "pass" | "attention" | "unknown";
};

export async function previewDirectRentalAvailability(
  usahaId: string,
  input: { barangId: string; varianBarangId?: string | null; requestedUnits: number },
): Promise<DirectRentalAvailabilityPreview> {
  let query = supabase
    .from("unit_barang")
    .select("unit_barang_id", { count: "exact", head: true })
    .eq("usaha_id", usahaId)
    .eq("status", "ready")
    .eq("barang_id", input.barangId);

  if (input.varianBarangId) query = query.eq("varian_barang_id", input.varianBarangId);

  const { count, error } = await query;
  if (error) throw error;

  const readyPhysicalUnits = count ?? 0;
  return {
    readyPhysicalUnits,
    requestedUnits: input.requestedUnits,
    physicalCheck:
      readyPhysicalUnits >= input.requestedUnits ? "pass" : readyPhysicalUnits > 0 ? "attention" : "unknown",
  };
}
