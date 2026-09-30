import { supabase } from "@/app/providers/supabase/client";
import type {
  ProcessUnitReturnInput,
  ReturnCapabilities,
  ReturnCommandOptions,
  ReturnCommandResult,
  ReturnQueueItem,
  ReturnReconciliationResult,
  ReturnTenantContext,
  ReturnUnitRow,
  ReturnWorkspace,
  ReturnListFilters,
} from "./types";
import { deriveReturnDueState, sanitizeReturnSearch } from "./utils";

type MembershipRow = { usaha_id: string; status: string; revoked_at: string | null };

type RentalRow = {
  penyewaan_id: string;
  usaha_id: string;
  nomor_penyewaan: string;
  penyewa_id: string;
  jadwal_kembali: string;
  tolerance_deadline: string | null;
  actual_pickup_at: string | null;
  actual_return_started_at: string | null;
  actual_return_completed_at: string | null;
  status: string;
  jadwal_mulai: string;
  updated_at: string;
};

type AssignmentRow = {
  penetapan_unit_id: string;
  usaha_id: string;
  detail_penyewaan_id: string;
  unit_barang_id: string;
  status: string;
  ditetapkan_at: string;
  dibatalkan_at: string | null;
};

type DetailRow = {
  detail_penyewaan_id: string;
  penyewaan_id: string;
};

type ReturnHeaderRow = {
  pengembalian_id: string;
  usaha_id: string;
  penyewaan_id: string;
  nomor_pengembalian: string;
  dimulai_at: string;
  selesai_at: string | null;
  status: string;
  diproses_by_admin_id: string;
  catatan: string | null;
};

type ReturnDetailRow = {
  detail_pengembalian_id: string;
  usaha_id: string;
  pengembalian_id: string;
  unit_barang_id: string;
  diterima_at: string;
  kondisi_awal: string | null;
  status_pemeriksaan: string;
  catatan: string | null;
};

type UnitRow = {
  unit_barang_id: string;
  usaha_id: string;
  barang_id: string;
  varian_barang_id: string | null;
  kode_unit: string;
  status: string;
};

async function getAdminContext(usahaId?: string): Promise<ReturnTenantContext> {
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

  let membershipQuery = supabase
    .from("keanggotaan_usaha")
    .select("usaha_id,status,revoked_at")
    .eq("akun_admin_id", admin.akun_admin_id)
    .eq("status", "active")
    .is("revoked_at", null);

  if (usahaId) membershipQuery = membershipQuery.eq("usaha_id", usahaId);

  const { data: memberships, error: membershipError } = await membershipQuery;
  if (membershipError) throw membershipError;
  const rows = (memberships ?? []) as MembershipRow[];
  if (!rows.length) throw new Error("Akun admin belum memiliki Usaha aktif.");
  if (rows.length > 1) throw new Error("Konteks Usaha belum ditentukan karena ada lebih dari satu keanggotaan aktif.");

  const { data: usaha, error: usahaError } = await supabase
    .from("usaha")
    .select("usaha_id,nama,status,timezone")
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
  };
}

export async function getPengembalianContext(): Promise<ReturnTenantContext> {
  return getAdminContext();
}

async function findRenterIds(usahaId: string, search: string) {
  const term = sanitizeReturnSearch(search);
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

async function findUnitIds(usahaId: string, search: string) {
  const term = sanitizeReturnSearch(search);
  if (!term) return [] as string[];
  const pattern = "%" + term + "%";
  const { data, error } = await supabase
    .from("unit_barang")
    .select("unit_barang_id")
    .eq("usaha_id", usahaId)
    .or("kode_unit.ilike." + pattern + ",serial_number.ilike." + pattern)
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => row.unit_barang_id as string);
}

async function resolveUnitRentalIds(usahaId: string, unitIds: string[]) {
  if (!unitIds.length) return [] as string[];
  const { data: assignments, error: assignmentError } = await supabase
    .from("penetapan_unit")
    .select("detail_penyewaan_id")
    .eq("usaha_id", usahaId)
    .eq("status", "assigned")
    .in("unit_barang_id", unitIds)
    .limit(300);
  if (assignmentError) throw assignmentError;
  const detailIds = Array.from(new Set((assignments ?? []).map((row) => row.detail_penyewaan_id as string)));
  if (!detailIds.length) return [];
  const { data: details, error: detailError } = await supabase
    .from("detail_penyewaan")
    .select("penyewaan_id")
    .eq("usaha_id", usahaId)
    .in("detail_penyewaan_id", detailIds);
  if (detailError) throw detailError;
  return Array.from(new Set((details ?? []).map((row) => row.penyewaan_id as string)));
}

async function resolveRenterNames(usahaId: string, renterIds: string[]) {
  if (!renterIds.length) return new Map<string, { name: string; phone: string | null }>();
  const { data, error } = await supabase
    .from("penyewa")
    .select("penyewa_id,nama_lengkap,nomor_telepon")
    .eq("usaha_id", usahaId)
    .in("penyewa_id", Array.from(new Set(renterIds)));
  if (error) throw error;
  return new Map(
    (data ?? []).map((row) => [
      row.penyewa_id as string,
      { name: row.nama_lengkap as string, phone: (row.nomor_telepon as string | null) ?? null },
    ]),
  );
}

async function getRentalDetailsForIds(usahaId: string, rentalIds: string[]) {
  if (!rentalIds.length) return [] as DetailRow[];
  const { data, error } = await supabase
    .from("detail_penyewaan")
    .select("detail_penyewaan_id,penyewaan_id")
    .eq("usaha_id", usahaId)
    .in("penyewaan_id", rentalIds);
  if (error) throw error;
  return (data ?? []) as DetailRow[];
}

async function getAssignmentsForDetails(usahaId: string, detailIds: string[]) {
  if (!detailIds.length) return [] as AssignmentRow[];
  const { data, error } = await supabase
    .from("penetapan_unit")
    .select("penetapan_unit_id,usaha_id,detail_penyewaan_id,unit_barang_id,status,ditetapkan_at,dibatalkan_at")
    .eq("usaha_id", usahaId)
    .in("detail_penyewaan_id", detailIds);
  if (error) throw error;
  return (data ?? []) as AssignmentRow[];
}

async function getReturnHeaders(usahaId: string, rentalIds: string[]) {
  if (!rentalIds.length) return [] as ReturnHeaderRow[];
  const { data, error } = await supabase
    .from("pengembalian")
    .select("pengembalian_id,usaha_id,penyewaan_id,nomor_pengembalian,dimulai_at,selesai_at,status,diproses_by_admin_id,catatan")
    .eq("usaha_id", usahaId)
    .in("penyewaan_id", rentalIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReturnHeaderRow[];
}

async function getReturnDetails(usahaId: string, returnIds: string[]) {
  if (!returnIds.length) return [] as ReturnDetailRow[];
  const { data, error } = await supabase
    .from("detail_pengembalian")
    .select("detail_pengembalian_id,usaha_id,pengembalian_id,unit_barang_id,diterima_at,kondisi_awal,status_pemeriksaan,catatan")
    .eq("usaha_id", usahaId)
    .in("pengembalian_id", returnIds)
    .order("diterima_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReturnDetailRow[];
}

export async function listReturnQueue(usahaId: string, filters: ReturnListFilters) {
  const start = Math.max(0, filters.page - 1) * filters.pageSize;
  const end = start + filters.pageSize - 1;
  let query = supabase
    .from("penyewaan")
    .select(
      "penyewaan_id,usaha_id,nomor_penyewaan,penyewa_id,jadwal_kembali,tolerance_deadline,actual_pickup_at,actual_return_started_at,actual_return_completed_at,status,jadwal_mulai,updated_at",
      { count: "exact" },
    )
    .eq("usaha_id", usahaId)
    .in(
      "status",
      filters.rentalStatus && filters.rentalStatus !== "all"
        ? [filters.rentalStatus]
        : ["active", "return_in_progress"],
    );

  if (filters.dueState && filters.dueState !== "all") {
    const nowIso = new Date().toISOString();
    if (filters.dueState === "not_due") {
      query = query.gt("jadwal_kembali", nowIso);
    } else if (filters.dueState === "late_within_tolerance") {
      query = query.lte("jadwal_kembali", nowIso).gte("tolerance_deadline", nowIso);
    } else if (filters.dueState === "tolerance_expired") {
      query = query.lt("tolerance_deadline", nowIso);
    } else if (filters.dueState === "due") {
      query = query.lte("jadwal_kembali", nowIso).is("tolerance_deadline", null);
    }
  }

  const term = sanitizeReturnSearch(filters.search);
  if (term) {
    const [renterIds, unitIds] = await Promise.all([findRenterIds(usahaId, term), findUnitIds(usahaId, term)]);
    const clauses = ["nomor_penyewaan.ilike.*" + term + "*"];
    if (renterIds.length) clauses.push("penyewa_id.in.(" + renterIds.join(",") + ")");
    if (unitIds.length) {
      const rentalIds = await resolveUnitRentalIds(usahaId, unitIds);
      if (rentalIds.length) clauses.push("penyewaan_id.in.(" + rentalIds.join(",") + ")");
    }
    query = query.or(clauses.join(","));
  }

  query = query.order("jadwal_kembali", { ascending: true }).order("nomor_penyewaan", { ascending: true }).range(start, end);
  const { data, error, count } = await query;
  if (error) throw error;

  const rentals = (data ?? []) as RentalRow[];
  if (!rentals.length) return { returns: [] as ReturnQueueItem[], total: count ?? 0 };

  const rentalIds = rentals.map((row) => row.penyewaan_id);
  const details = await getRentalDetailsForIds(usahaId, rentalIds);
  const detailIds = details.map((row) => row.detail_penyewaan_id);
  const assignments = (await getAssignmentsForDetails(usahaId, detailIds)).filter((row) => row.status === "assigned");
  const returnHeaders = await getReturnHeaders(usahaId, rentalIds);
  const returnDetails = await getReturnDetails(usahaId, returnHeaders.map((row) => row.pengembalian_id));
  const renterMap = await resolveRenterNames(usahaId, rentals.map((row) => row.penyewa_id));

  const detailToRental = new Map(details.map((row) => [row.detail_penyewaan_id, row.penyewaan_id]));
  const assignedUnitsByRental = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    const rentalId = detailToRental.get(assignment.detail_penyewaan_id);
    if (!rentalId) continue;
    const set = assignedUnitsByRental.get(rentalId) ?? new Set<string>();
    set.add(assignment.unit_barang_id);
    assignedUnitsByRental.set(rentalId, set);
  }

  const returnedUnitsByRental = new Map<string, Set<string>>();
  for (const detail of returnDetails) {
    const header = returnHeaders.find((row) => row.pengembalian_id === detail.pengembalian_id);
    if (!header) continue;
    const set = returnedUnitsByRental.get(header.penyewaan_id) ?? new Set<string>();
    set.add(detail.unit_barang_id);
    returnedUnitsByRental.set(header.penyewaan_id, set);
  }

  return {
    returns: rentals.map((rental): ReturnQueueItem => {
      const totalUnitCount = assignedUnitsByRental.get(rental.penyewaan_id)?.size ?? 0;
      const returnedUnitCount = returnedUnitsByRental.get(rental.penyewaan_id)?.size ?? 0;
      const outstanding = Math.max(0, totalUnitCount - returnedUnitCount);
      const renter = renterMap.get(rental.penyewa_id);
      const returnProgress = totalUnitCount > 0 ? Math.min(1, returnedUnitCount / totalUnitCount) : 0;
      return {
        penyewaan_id: rental.penyewaan_id,
        nomor_penyewaan: rental.nomor_penyewaan,
        penyewa_id: rental.penyewa_id,
        penyewa_nama: renter?.name ?? null,
        penyewa_telepon: renter?.phone ?? null,
        jadwal_kembali: rental.jadwal_kembali,
        tolerance_deadline: rental.tolerance_deadline,
        rental_status: rental.status,
        total_unit_count: totalUnitCount,
        returned_unit_count: returnedUnitCount,
        outstanding_unit_count: outstanding,
        return_progress: returnProgress,
        due_state:
          outstanding === 0
            ? "returned"
            : deriveReturnDueState(rental.jadwal_kembali, rental.tolerance_deadline),
      };
    }),
    total: count ?? 0,
  };
}

async function getLatestInspections(usahaId: string, detailPengembalianIds: string[]) {
  if (!detailPengembalianIds.length) return new Map<string, ReturnUnitRow["latest_inspection"]>();
  const { data, error } = await supabase
    .from("pemeriksaan")
    .select("pemeriksaan_id,detail_pengembalian_id,hasil,kelengkapan_status,keputusan_operasional,diperiksa_at")
    .eq("usaha_id", usahaId)
    .in("detail_pengembalian_id", detailPengembalianIds)
    .order("diperiksa_at", { ascending: false });
  if (error) throw error;
  const map = new Map<string, ReturnUnitRow["latest_inspection"]>();
  for (const row of data ?? []) {
    const detailId = row.detail_pengembalian_id as string;
    if (!map.has(detailId)) {
      map.set(detailId, {
        pemeriksaan_id: row.pemeriksaan_id as string,
        hasil: row.hasil as string,
        kelengkapan_status: row.kelengkapan_status as string,
        keputusan_operasional: row.keputusan_operasional as string,
        diperiksa_at: row.diperiksa_at as string,
      });
    }
  }
  return map;
}

export async function getReturnWorkspace(usahaId: string, rentalId: string): Promise<ReturnWorkspace> {
  const { data: rentalData, error: rentalError } = await supabase
    .from("penyewaan")
    .select(
      "penyewaan_id,usaha_id,nomor_penyewaan,status,penyewa_id,jadwal_mulai,jadwal_kembali,tolerance_deadline,actual_pickup_at,actual_return_started_at,actual_return_completed_at,updated_at",
    )
    .eq("usaha_id", usahaId)
    .eq("penyewaan_id", rentalId)
    .maybeSingle();
  if (rentalError) throw rentalError;
  if (!rentalData) throw new Error("Penyewaan tidak ditemukan dalam Usaha aktif.");

  const renterPromise = supabase
    .from("penyewa")
    .select("penyewa_id,nama_lengkap,nomor_telepon")
    .eq("usaha_id", usahaId)
    .eq("penyewa_id", rentalData.penyewa_id)
    .maybeSingle();

  const details = await getRentalDetailsForIds(usahaId, [rentalId]);
  const assignments = (await getAssignmentsForDetails(usahaId, details.map((row) => row.detail_penyewaan_id))).filter(
    (row) => row.status === "assigned",
  );
  const [returnHeaders, unitRows] = await Promise.all([
    getReturnHeaders(usahaId, [rentalId]),
    assignments.length
      ? supabase
          .from("unit_barang")
          .select("unit_barang_id,usaha_id,barang_id,varian_barang_id,kode_unit,status")
          .eq("usaha_id", usahaId)
          .in("unit_barang_id", Array.from(new Set(assignments.map((row) => row.unit_barang_id))))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (unitRows.error) throw unitRows.error;

  const returnDetails = await getReturnDetails(usahaId, returnHeaders.map((row) => row.pengembalian_id));
  const inspectionMap = await getLatestInspections(
    usahaId,
    returnDetails.map((row) => row.detail_pengembalian_id),
  );
  const barangIds = Array.from(new Set((unitRows.data ?? []).map((row) => row.barang_id as string)));
  const variantIds = Array.from(new Set((unitRows.data ?? []).map((row) => row.varian_barang_id as string).filter(Boolean)));

  const [barangResult, variantResult, renterResult] = await Promise.all([
    barangIds.length
      ? supabase.from("barang").select("barang_id,nama").eq("usaha_id", usahaId).in("barang_id", barangIds)
      : Promise.resolve({ data: [], error: null }),
    variantIds.length
      ? supabase.from("varian_barang").select("varian_barang_id,nama").eq("usaha_id", usahaId).in("varian_barang_id", variantIds)
      : Promise.resolve({ data: [], error: null }),
    renterPromise,
  ]);
  if (barangResult.error) throw barangResult.error;
  if (variantResult.error) throw variantResult.error;
  if (renterResult.error) throw renterResult.error;

  const unitMap = new Map((unitRows.data ?? []).map((row) => [row.unit_barang_id as string, row as unknown as UnitRow]));
  const barangMap = new Map((barangResult.data ?? []).map((row) => [row.barang_id as string, row.nama as string]));
  const variantMap = new Map((variantResult.data ?? []).map((row) => [row.varian_barang_id as string, row.nama as string]));

  const returnDetailByUnit = new Map<string, ReturnDetailRow>();
  for (const detail of returnDetails) {
    if (!returnDetailByUnit.has(detail.unit_barang_id)) returnDetailByUnit.set(detail.unit_barang_id, detail);
  }

  const units: ReturnUnitRow[] = assignments.map((assignment) => {
    const unit = unitMap.get(assignment.unit_barang_id);
    const returnDetail = returnDetailByUnit.get(assignment.unit_barang_id) ?? null;
    return {
      unit_barang_id: assignment.unit_barang_id,
      kode_unit: unit?.kode_unit ?? assignment.unit_barang_id,
      barang_id: unit?.barang_id ?? "",
      barang_nama: unit ? barangMap.get(unit.barang_id) ?? null : null,
      varian_barang_id: unit?.varian_barang_id ?? null,
      varian_nama: unit?.varian_barang_id ? variantMap.get(unit.varian_barang_id) ?? null : null,
      assignment_id: assignment.penetapan_unit_id,
      assignment_status: assignment.status,
      unit_status: unit?.status ?? "unknown",
      returned: Boolean(returnDetail),
      detail_pengembalian_id: returnDetail?.detail_pengembalian_id ?? null,
      received_at: returnDetail?.diterima_at ?? null,
      inspection_status: returnDetail?.status_pemeriksaan ?? null,
      latest_inspection: returnDetail ? inspectionMap.get(returnDetail.detail_pengembalian_id) ?? null : null,
    };
  });

  return {
    rental: rentalData as ReturnWorkspace["rental"],
    renter: renterResult.data
      ? {
          penyewa_id: renterResult.data.penyewa_id as string,
          nama_lengkap: renterResult.data.nama_lengkap as string,
          nomor_telepon: (renterResult.data.nomor_telepon as string | null) ?? null,
        }
      : null,
    units,
    returnRecords: returnHeaders.map((row) => ({
      pengembalian_id: row.pengembalian_id,
      nomor_pengembalian: row.nomor_pengembalian,
      dimulai_at: row.dimulai_at,
      selesai_at: row.selesai_at,
      status: row.status,
      diproses_by_admin_id: row.diproses_by_admin_id,
      catatan: row.catatan,
      detailIds: returnDetails.filter((detail) => detail.pengembalian_id === row.pengembalian_id).map((detail) => detail.detail_pengembalian_id),
    })),
  };
}

const QR_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function lookupReturnRentalByQr(usahaId: string, stableUnitIdentifier: string) {
  const value = stableUnitIdentifier.trim();
  if (!value) throw new Error("Identifier QR wajib diisi.");

  const byCode = await supabase
    .from("unit_barang")
    .select("unit_barang_id,kode_unit,usaha_id,status")
    .eq("usaha_id", usahaId)
    .eq("kode_unit", value)
    .maybeSingle();

  if (byCode.error) throw byCode.error;

  let unit = byCode.data;

  if (!unit && QR_UUID_PATTERN.test(value)) {
    const byId = await supabase
      .from("unit_barang")
      .select("unit_barang_id,kode_unit,usaha_id,status")
      .eq("usaha_id", usahaId)
      .eq("unit_barang_id", value)
      .maybeSingle();

    if (byId.error) throw byId.error;
    unit = byId.data;
  }

  if (!unit) throw new Error("Unit dari QR tidak ditemukan dalam Usaha aktif.");

  const { data: assignments, error: assignmentError } = await supabase
    .from("penetapan_unit")
    .select("detail_penyewaan_id,ditetapkan_at,status")
    .eq("usaha_id", usahaId)
    .eq("unit_barang_id", unit.unit_barang_id)
    .eq("status", "assigned")
    .order("ditetapkan_at", { ascending: false })
    .limit(20);
  if (assignmentError) throw assignmentError;

  const detailIds = (assignments ?? []).map((row) => row.detail_penyewaan_id as string);
  if (!detailIds.length) throw new Error("Unit belum memiliki assignment rental aktif.");

  const { data: details, error: detailError } = await supabase
    .from("detail_penyewaan")
    .select("detail_penyewaan_id,penyewaan_id")
    .eq("usaha_id", usahaId)
    .in("detail_penyewaan_id", detailIds);
  if (detailError) throw detailError;

  const rentalIds = Array.from(new Set((details ?? []).map((row) => row.penyewaan_id as string)));
  const { data: rentals, error: rentalError } = await supabase
    .from("penyewaan")
    .select("penyewaan_id,status")
    .eq("usaha_id", usahaId)
    .in("penyewaan_id", rentalIds)
    .in("status", ["active", "return_in_progress"]);
  if (rentalError) throw rentalError;
  if (!rentals?.length) throw new Error("Unit QR tidak sedang berada pada rental yang dapat menerima pengembalian.");

  return {
    unit_barang_id: unit.unit_barang_id as string,
    kode_unit: unit.kode_unit as string,
    rental_ids: rentals.map((row) => row.penyewaan_id as string),
  };
}

function newRequestId() {
  return crypto.randomUUID();
}

function normalizeRpcError(error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(label + ": " + message);
}

async function reconcileAfterUncertainResult(usahaId: string, idempotencyKey: string) {
  const { data, error } = await supabase.rpc("command_reconcile_return_mutation", {
    p_usaha_id: usahaId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return data as ReturnReconciliationResult | null;
}

export async function processUnitReturn(
  usahaId: string,
  input: ProcessUnitReturnInput,
  options: ReturnCommandOptions = {},
): Promise<ReturnCommandResult> {
  if (!usahaId.trim()) throw new Error("Usaha wajib ditentukan.");
  if (!input.rentalId.trim()) throw new Error("Penyewaan wajib ditentukan.");
  const unitIds = Array.from(new Set(input.unitBarangIds.map((id) => id.trim()).filter(Boolean)));
  if (!unitIds.length) throw new Error("Minimal satu unit harus dipilih.");
  if (!options.expectedRentalUpdatedAt) {
    throw new Error("State rental terbaru wajib diverifikasi sebelum menerima pengembalian.");
  }

  const idempotencyKey = options.idempotencyKey ?? "process-return-" + crypto.randomUUID();
  const { data, error } = await supabase.rpc("command_process_unit_return", {
    p_usaha_id: usahaId,
    p_penyewaan_id: input.rentalId,
    p_unit_barang_ids: unitIds,
    p_catatan: input.catatan?.trim() || null,
    p_idempotency_key: idempotencyKey,
    p_request_id: options.requestId ?? newRequestId(),
    p_expected_rental_updated_at: options.expectedRentalUpdatedAt,
  });

  if (!error && data) return data as ReturnCommandResult;

  try {
    const reconciled = await reconcileAfterUncertainResult(usahaId, idempotencyKey);
    if (reconciled?.state === "committed" && reconciled.response) return reconciled.response;
    if (reconciled?.state === "unknown") {
      throw new Error("UNKNOWN_OUTCOME: command pengembalian memiliki idempotency record tanpa response. Jangan retry.");
    }
  } catch (reconcileError) {
    if (reconcileError instanceof Error && reconcileError.message.startsWith("UNKNOWN_OUTCOME:")) {
      throw reconcileError;
    }
    throw new Error("UNKNOWN_OUTCOME: hasil command pengembalian tidak dapat direkonsiliasi. Jangan retry mutation sebelum state source-of-truth diverifikasi.");
  }

  if (error) throw normalizeRpcError(error, "Pengembalian gagal");
  throw new Error("Pengembalian gagal: server tidak mengembalikan hasil command.");
}

export async function reconcileReturnCommand(
  usahaId: string,
  idempotencyKey: string,
): Promise<ReturnReconciliationResult> {
  if (!usahaId.trim()) throw new Error("Usaha wajib ditentukan.");
  if (!idempotencyKey.trim()) throw new Error("Idempotency key wajib diisi.");
  const result = await reconcileAfterUncertainResult(usahaId, idempotencyKey);
  if (!result) return { state: "not_found", response: null };
  return result;
}

export function getReturnCapabilities(): ReturnCapabilities {
  return {
    read: true,
    mutation: true,
    commands: ["process_unit_return", "command_reconcile_return_mutation"],
    queries: ["listReturnQueue", "getReturnWorkspace", "lookupReturnRentalByQr"],
    reason:
      "Pengembalian memakai trusted command: tenant authorization, per-unit validation, rental stale guard, atomic return + Inventory inspection handoff, idempotency, concurrency lock, audit, outbox, dan reconciliation unknown outcome.",
  };
}
