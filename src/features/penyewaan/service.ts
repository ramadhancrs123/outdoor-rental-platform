import { supabase } from "@/app/providers/supabase/client";
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
  RentalReconciliationResult,
  RentalTenantContext,
  RenterRentalListItem,
  RentalPolicyInput,
  RentalToleranceHistory,
  RentalLateFeeAssessment,
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
    p_idempotency_key: options.idempotencyKey ?? ("update-rental-policy-" + crypto.randomUUID()),
    p_request_id: options.requestId ?? crypto.randomUUID(),
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
    p_idempotency_key: options.idempotencyKey ?? ("extend-rental-tolerance-" + crypto.randomUUID()),
    p_request_id: options.requestId ?? crypto.randomUUID(),
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
  const barangIds = Array.from(new Set(detailRows.map((row) => row.barang_id).filter((id): id is string => Boolean(id))));
  const variantIds = Array.from(new Set(detailRows.map((row) => row.varian_barang_id).filter((id): id is string => Boolean(id))));
  const packageIds = Array.from(new Set(detailRows.map((row) => row.paket_sewa_id).filter((id): id is string => Boolean(id))));
  const [barangs, variants, packages] = await Promise.all([
    barangIds.length ? supabase.from("barang").select("barang_id,nama").eq("usaha_id", usahaId).in("barang_id", barangIds) : Promise.resolve({ data: [], error: null }),
    variantIds.length ? supabase.from("varian_barang").select("varian_barang_id,nama").eq("usaha_id", usahaId).in("varian_barang_id", variantIds) : Promise.resolve({ data: [], error: null }),
    packageIds.length ? supabase.from("paket_sewa").select("paket_sewa_id,nama").eq("usaha_id", usahaId).in("paket_sewa_id", packageIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (barangs.error) throw barangs.error;
  if (variants.error) throw variants.error;
  if (packages.error) throw packages.error;
  return {
    barang: new Map((barangs.data ?? []).map((row) => [row.barang_id as string, row.nama as string])),
    variant: new Map((variants.data ?? []).map((row) => [row.varian_barang_id as string, row.nama as string])),
    package: new Map((packages.data ?? []).map((row) => [row.paket_sewa_id as string, row.nama as string])),
  };
}

export async function listRentals(usahaId: string, filters: RentalListFilters) {
  const start = Math.max(0, filters.page - 1) * filters.pageSize;
  const end = start + filters.pageSize - 1;
  let query = supabase.from("penyewaan").select(RENTAL_SELECT, { count: "exact" }).eq("usaha_id", usahaId);
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
  const [renterNames, detailCounts, assignmentCounts] = await Promise.all([
    resolveRenterNames(usahaId, rows.map((row) => row.penyewa_id)),
    countDetails(usahaId, ids),
    countAssignments(usahaId, ids),
  ]);
  return {
    rentals: rows.map((row): RentalListItem => ({
      ...row,
      penyewa_nama: renterNames.get(row.penyewa_id) ?? null,
      detail_count: detailCounts.get(row.penyewaan_id) ?? 0,
      assignment_count: assignmentCounts.get(row.penyewaan_id) ?? 0,
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
    supabase.from("penyewa").select("penyewa_id,nama_lengkap").eq("usaha_id", usahaId).eq("penyewa_id", header.penyewa_id).maybeSingle(),
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
    detail_count: rawLines.length,
    assignment_count: rawAssignments.filter((row) => row.status === "assigned").length,
    lines: rawLines.map((line): RentalDetailLine => ({
      ...line,
      barang_nama: line.barang_id ? catalog.barang.get(line.barang_id) ?? null : null,
      varian_nama: line.varian_barang_id ? catalog.variant.get(line.varian_barang_id) ?? null : null,
      paket_nama: line.paket_sewa_id ? catalog.package.get(line.paket_sewa_id) ?? null : null,
    })),
    components: rawComponents.map((component): RentalComponent => ({
      ...component,
      barang_nama: component.barang_id ? componentCatalog.barang.get(component.barang_id) ?? null : null,
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
    .select("unit_barang_id,kode_unit,serial_number,status,barang_id,varian_barang_id,barang:barang(nama),varian:varian_barang(nama)")
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
  const { data: assignedRows, error: assignedError } = rentalDetailIds.length
    ? await supabase
      .from("penetapan_unit")
      .select("unit_barang_id")
      .eq("usaha_id", usahaId)
      .in("detail_penyewaan_id", rentalDetailIds)
      .eq("status", "assigned")
    : { data: [], error: null };
  if (assignedError) throw assignedError;

  const assigned = new Set((assignedRows ?? []).map((row) => row.unit_barang_id as string));

  return (data ?? [])
    .filter((row) => !assigned.has(row.unit_barang_id as string))
    .map((row): AssignableRentalUnit => ({
      unit_barang_id: row.unit_barang_id as string,
      kode_unit: row.kode_unit as string,
      serial_number: (row.serial_number as string | null) ?? null,
      status: row.status as string,
      barang_id: row.barang_id as string,
      varian_barang_id: (row.varian_barang_id as string | null) ?? null,
      barang_nama: (row.barang as { nama?: string } | null)?.nama ?? null,
      varian_nama: (row.varian as { nama?: string } | null)?.nama ?? null,
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
  return crypto.randomUUID();
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
    p_idempotency_key: options.idempotencyKey ?? `create-rental-${crypto.randomUUID()}`,
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
    p_idempotency_key: options.idempotencyKey ?? `assign-rental-unit-${crypto.randomUUID()}`,
    p_request_id: options.requestId ?? newRentalCommandRequestId(),
  });
  return assertRentalRpcResult(data as RentalCommandResult | null, error, "Penetapan unit");
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
    p_idempotency_key: options.idempotencyKey ?? `pickup-rental-${crypto.randomUUID()}`,
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
      barang_id: line.barang_id ?? null,
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
    p_idempotency_key: options.idempotencyKey ?? `create-direct-rental-${crypto.randomUUID()}`,
    p_request_id: options.requestId ?? crypto.randomUUID(),
  });
  return assertRentalRpcResult(data as RentalCommandResult | null, error, "Pembuatan rental walk-in");
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
