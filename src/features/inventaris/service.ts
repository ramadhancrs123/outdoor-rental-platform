import { supabase } from "@/app/providers/supabase/client";
import type {
  InventoryCandidate,
  InventoryCandidateQuery,
  InventoryCapabilities,
  InventoryCatalogItem,
  InventoryCommandOptions,
  InventoryCommandResult,
  InventoryContext,
  InventoryListFilters,
  InventoryLocation,
  InventoryOperationalContext,
  InventoryReconciliationResult,
  InventoryUnit,
  InventoryUnitHistory,
  InventoryVariant,
  InspectionPendingCommandInput,
  RegisterInventoryUnitInput,
} from "./types";
import { sanitizeInventorySearch } from "./utils";

type MembershipRow = { usaha_id: string; status: string; revoked_at: string | null };

const UNIT_SELECT =
  "unit_barang_id,usaha_id,barang_id,varian_barang_id,kode_unit,serial_number,lokasi_id,tanggal_diperoleh,sumber_pembelian_detail_id,status,kondisi_ringkas,catatan_internal,created_at,updated_at,barang:barang!unit_barang_tenant_fk(barang_id,nama,slug,status),varian:varian_barang!unit_variant_product_tenant_fk(varian_barang_id,nama,kode_internal,status),lokasi:lokasi!unit_lokasi_tenant_fk(lokasi_id,nama,tipe,status)";

export async function getInventarisContext(): Promise<InventoryContext> {
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

  const { data: usaha, error: usahaError } = await supabase.from("usaha").select("usaha_id,nama,status").eq("usaha_id", rows[0].usaha_id).eq("status", "active").maybeSingle();
  if (usahaError) throw usahaError;
  if (!usaha) throw new Error("Usaha aktif tidak ditemukan.");

  return { akunAdminId: admin.akun_admin_id as string, usahaId: usaha.usaha_id as string, usahaNama: usaha.nama as string };
}

export async function listInventoryLocations(usahaId: string): Promise<InventoryLocation[]> {
  const { data, error } = await supabase.from("lokasi").select("lokasi_id,usaha_id,nama,tipe,alamat,keterangan,status,created_at,updated_at").eq("usaha_id", usahaId).order("nama", { ascending: true });
  if (error) throw error;
  return (data ?? []) as InventoryLocation[];
}

async function findRelatedIds(usahaId: string, search: string) {
  const term = sanitizeInventorySearch(search);
  if (!term) return { barangIds: [] as string[], varianIds: [] as string[], lokasiIds: [] as string[] };
  const pattern = "%" + term + "%";
  const [barangResult, variantResult, locationResult] = await Promise.all([
    supabase.from("barang").select("barang_id").eq("usaha_id", usahaId).or("nama.ilike." + pattern + ",slug.ilike." + pattern).limit(100),
    supabase.from("varian_barang").select("varian_barang_id").eq("usaha_id", usahaId).or("nama.ilike." + pattern + ",kode_internal.ilike." + pattern).limit(100),
    supabase.from("lokasi").select("lokasi_id").eq("usaha_id", usahaId).or("nama.ilike." + pattern + ",tipe.ilike." + pattern).limit(100),
  ]);
  if (barangResult.error) throw barangResult.error;
  if (variantResult.error) throw variantResult.error;
  if (locationResult.error) throw locationResult.error;
  return {
    barangIds: (barangResult.data ?? []).map((row) => row.barang_id as string),
    varianIds: (variantResult.data ?? []).map((row) => row.varian_barang_id as string),
    lokasiIds: (locationResult.data ?? []).map((row) => row.lokasi_id as string),
  };
}

export async function listInventoryUnits(usahaId: string, filters: InventoryListFilters) {
  const start = (filters.page - 1) * filters.pageSize;
  const end = start + filters.pageSize - 1;
  let query = supabase.from("unit_barang").select(UNIT_SELECT, { count: "exact" }).eq("usaha_id", usahaId);

  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.barangId !== "all") query = query.eq("barang_id", filters.barangId);
  if (filters.varianBarangId !== "all") query = query.eq("varian_barang_id", filters.varianBarangId);
  if (filters.locationId !== "all") query = query.eq("lokasi_id", filters.locationId);

  if (filters.availabilityContext === "ready_now") query = query.eq("status", "ready");
  if (filters.availabilityContext === "rental_active") query = query.eq("status", "rented");
  if (filters.availabilityContext === "attention") {
    query = query.in("status", ["inspection_pending", "maintenance", "damaged", "lost"]);
  }

  const term = sanitizeInventorySearch(filters.search);
  if (term) {
    const related = await findRelatedIds(usahaId, term);
    const parts = ["kode_unit.ilike.*" + term + "*", "serial_number.ilike.*" + term + "*"];
    if (related.barangIds.length) parts.push("barang_id.in.(" + related.barangIds.join(",") + ")");
    if (related.varianIds.length) parts.push("varian_barang_id.in.(" + related.varianIds.join(",") + ")");
    if (related.lokasiIds.length) parts.push("lokasi_id.in.(" + related.lokasiIds.join(",") + ")");
    query = query.or(parts.join(","));
  }

  if (filters.sort === "updated_asc") query = query.order("updated_at", { ascending: true });
  else if (filters.sort === "code_asc") query = query.order("kode_unit", { ascending: true });
  else if (filters.sort === "status_asc") query = query.order("status", { ascending: true }).order("kode_unit", { ascending: true });
  else query = query.order("updated_at", { ascending: false });

  const { data, error, count } = await query.range(start, end);
  if (error) throw error;
  return { units: (data ?? []) as unknown as InventoryUnit[], total: count ?? 0 };
}

export async function getInventoryUnit(usahaId: string, unitId: string) {
  const unitResult = await supabase.from("unit_barang").select(UNIT_SELECT).eq("usaha_id", usahaId).eq("unit_barang_id", unitId).maybeSingle();
  if (unitResult.error) throw unitResult.error;
  if (!unitResult.data) throw new Error("Unit tidak ditemukan dalam Usaha aktif.");

  const [historyResult, locations] = await Promise.all([
    supabase.from("riwayat_unit").select("riwayat_unit_id,usaha_id,unit_barang_id,jenis_kejadian,terjadi_at,status_sebelum,status_sesudah,lokasi_sebelum_id,lokasi_sesudah_id,sumber_type,sumber_id,actor_akun_admin_id,catatan,metadata,created_at").eq("usaha_id", usahaId).eq("unit_barang_id", unitId).order("terjadi_at", { ascending: false }),
    listInventoryLocations(usahaId),
  ]);
  if (historyResult.error) throw historyResult.error;
  const locationsById = new Map(locations.map((location) => [location.lokasi_id, location.nama]));
  const history = ((historyResult.data ?? []) as InventoryUnitHistory[]).map((item) => ({
    ...item,
    lokasi_sebelum_nama: item.lokasi_sebelum_id ? locationsById.get(item.lokasi_sebelum_id) ?? null : null,
    lokasi_sesudah_nama: item.lokasi_sesudah_id ? locationsById.get(item.lokasi_sesudah_id) ?? null : null,
  }));
  return { unit: unitResult.data as unknown as InventoryUnit, history };
}

export function getInventoryStateCapabilities(): InventoryCapabilities {
  return {
    read: true,
    mutation: true,
    commands: [
      "register_inventory_unit",
      "move_inventory_unit",
      "mark_inventory_unit_ready",
      "command_mark_inventory_unit_inspection_pending",
      "command_reconcile_inventory_unit_mutation",
    ],
    queries: [
      "listInventoryUnits",
      "getInventoryUnit",
      "lookupInventoryUnitByQr",
      "findInventoryUnitCandidates",
      "getInventoryOperationalContext",
    ],
    reason:
      "Inventaris menggunakan trusted command/query boundary: tenant authorization, current-state revalidation, atomic mutation, idempotency, concurrency lock, audit, outbox, candidate conflict evaluation, dan reconciliation unknown outcome.",
  };
}


export async function listInventoryProducts(usahaId: string): Promise<InventoryCatalogItem[]> {
  const { data, error } = await supabase
    .from("barang")
    .select("barang_id,nama,slug,status")
    .eq("usaha_id", usahaId)
    .eq("status", "active")
    .order("nama", { ascending: true });
  if (error) throw error;
  return (data ?? []) as InventoryCatalogItem[];
}

export async function listInventoryVariants(usahaId: string): Promise<InventoryVariant[]> {
  const { data, error } = await supabase
    .from("varian_barang")
    .select("varian_barang_id,barang_id,nama,kode_internal,status")
    .eq("usaha_id", usahaId)
    .eq("status", "active")
    .order("nama", { ascending: true });
  if (error) throw error;
  return (data ?? []) as InventoryVariant[];
}

function newInventoryCommandRequestId() {
  return crypto.randomUUID();
}

function normalizeRpcError(error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${label}: ${message}`);
}

async function reconcileInventoryAfterUncertainResult(
  usahaId: string,
  commandName: string,
  idempotencyKey: string,
): Promise<InventoryCommandResult | null> {
  const { data, error } = await supabase.rpc("command_reconcile_inventory_unit_mutation", {
    p_usaha_id: usahaId,
    p_command_name: commandName,
    p_idempotency_key: idempotencyKey,
  });

  if (error) throw error;

  const result = data as InventoryReconciliationResult | null;
  if (!result) return null;
  if (result.state === "committed" && result.response) return result.response;
  if (result.state === "unknown") {
    throw new Error(
      "UNKNOWN_OUTCOME: command Inventaris memiliki idempotency record tanpa response. Jangan retry; lakukan reconciliation lebih lanjut.",
    );
  }
  return null;
}

async function executeInventoryCommand(
  usahaId: string,
  commandName:
    | "register_inventory_unit"
    | "move_inventory_unit"
    | "mark_inventory_unit_ready"
    | "mark_inventory_unit_inspection_pending",
  rpcName: string,
  args: Record<string, unknown>,
  label: string,
  idempotencyKey: string,
): Promise<InventoryCommandResult> {
  const { data, error } = await supabase.rpc(rpcName, args);
  if (!error && data) return data as InventoryCommandResult;

  try {
    const reconciled = await reconcileInventoryAfterUncertainResult(usahaId, commandName, idempotencyKey);
    if (reconciled) return reconciled;
  } catch (reconcileError) {
    if (reconcileError instanceof Error && reconcileError.message.startsWith("UNKNOWN_OUTCOME:")) {
      throw reconcileError;
    }
    // A validation/business failure commonly has no committed idempotency record.
    // Preserve the original command error rather than masking it with reconciliation failure.
  }

  if (error) throw normalizeRpcError(error, label);
  throw new Error(`${label}: server tidak mengembalikan hasil command.`);
}

export async function registerInventoryUnit(
  usahaId: string,
  input: RegisterInventoryUnitInput,
  options: InventoryCommandOptions = {},
): Promise<InventoryCommandResult> {
  const kodeUnit = input.kodeUnit.trim();
  if (!usahaId.trim()) throw new Error("Usaha wajib ditentukan.");
  if (!input.barangId.trim()) throw new Error("Barang wajib dipilih.");
  if (!kodeUnit) throw new Error("Kode unit wajib diisi.");

  const idempotencyKey = options.idempotencyKey ?? `register-inventory-unit-${crypto.randomUUID()}`;

  return executeInventoryCommand(
    usahaId,
    "register_inventory_unit",
    "command_register_inventory_unit",
    {
      p_usaha_id: usahaId,
      p_barang_id: input.barangId,
      p_varian_barang_id: input.varianBarangId ?? null,
      p_kode_unit: kodeUnit,
      p_serial_number: input.serialNumber?.trim() || null,
      p_lokasi_id: input.lokasiId ?? null,
      p_tanggal_diperoleh: input.tanggalDiperoleh || null,
      p_sumber_pembelian_detail_id: input.sumberPembelianDetailId ?? null,
      p_catatan_internal: input.catatanInternal?.trim() || null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? newInventoryCommandRequestId(),
    },
    "Pendaftaran unit",
    idempotencyKey,
  );
}

export async function moveInventoryUnit(
  usahaId: string,
  unitBarangId: string,
  lokasiId: string,
  catatan?: string | null,
  options: InventoryCommandOptions = {},
): Promise<InventoryCommandResult> {
  if (!unitBarangId.trim()) throw new Error("Unit wajib dipilih.");
  if (!lokasiId.trim()) throw new Error("Lokasi tujuan wajib dipilih.");
  if (!options.expectedUpdatedAt) throw new Error("State unit terbaru wajib diverifikasi sebelum memindahkan unit.");

  const idempotencyKey = options.idempotencyKey ?? `move-inventory-unit-${crypto.randomUUID()}`;

  return executeInventoryCommand(
    usahaId,
    "move_inventory_unit",
    "command_move_inventory_unit",
    {
      p_usaha_id: usahaId,
      p_unit_barang_id: unitBarangId,
      p_lokasi_id: lokasiId,
      p_catatan: catatan?.trim() || null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? newInventoryCommandRequestId(),
      p_expected_updated_at: options.expectedUpdatedAt,
    },
    "Pemindahan unit",
    idempotencyKey,
  );
}

export async function markInventoryUnitReady(
  usahaId: string,
  unitBarangId: string,
  catatan?: string | null,
  options: InventoryCommandOptions = {},
): Promise<InventoryCommandResult> {
  if (!unitBarangId.trim()) throw new Error("Unit wajib dipilih.");
  if (!options.expectedUpdatedAt) throw new Error("State unit terbaru wajib diverifikasi sebelum menetapkan READY.");

  const idempotencyKey = options.idempotencyKey ?? `mark-inventory-unit-ready-${crypto.randomUUID()}`;

  return executeInventoryCommand(
    usahaId,
    "mark_inventory_unit_ready",
    "command_mark_inventory_unit_ready",
    {
      p_usaha_id: usahaId,
      p_unit_barang_id: unitBarangId,
      p_catatan: catatan?.trim() || null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? newInventoryCommandRequestId(),
      p_expected_updated_at: options.expectedUpdatedAt,
    },
    "Penetapan READY unit",
    idempotencyKey,
  );
}

export async function reconcileInventoryCommand(
  usahaId: string,
  commandName:
    | "register_inventory_unit"
    | "move_inventory_unit"
    | "mark_inventory_unit_ready"
    | "mark_inventory_unit_inspection_pending",
  idempotencyKey: string,
): Promise<InventoryReconciliationResult> {
  if (!idempotencyKey.trim()) throw new Error("Idempotency key wajib diisi.");

  const { data, error } = await supabase.rpc("command_reconcile_inventory_unit_mutation", {
    p_usaha_id: usahaId,
    p_command_name: commandName,
    p_idempotency_key: idempotencyKey,
  });

  if (error) throw normalizeRpcError(error, "Rekonsiliasi command Inventaris");
  if (!data) throw new Error("Rekonsiliasi command Inventaris: server tidak mengembalikan hasil.");

  return data as InventoryReconciliationResult;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function lookupInventoryUnitByQr(
  usahaId: string,
  stableUnitIdentifier: string,
) {
  const identifier = stableUnitIdentifier.trim();
  if (!identifier) throw new Error("Identifier QR unit wajib diisi.");

  const { data: byCode, error: codeError } = await supabase
    .from("unit_barang")
    .select("unit_barang_id")
    .eq("usaha_id", usahaId)
    .eq("kode_unit", identifier)
    .maybeSingle();

  if (codeError) throw codeError;
  if (byCode?.unit_barang_id) return getInventoryUnit(usahaId, byCode.unit_barang_id);

  if (UUID_PATTERN.test(identifier)) {
    return getInventoryUnit(usahaId, identifier);
  }

  throw new Error("Unit dari QR tidak ditemukan dalam Usaha aktif.");
}

export async function findInventoryUnitCandidates(
  usahaId: string,
  query: InventoryCandidateQuery,
): Promise<InventoryCandidate[]> {
  if (!query.barangId.trim()) throw new Error("Barang kandidat wajib ditentukan.");
  if (!query.startAt || !query.endAt) throw new Error("Periode kandidat wajib ditentukan.");

  const { data, error } = await supabase.rpc("find_inventory_unit_candidates", {
    p_usaha_id: usahaId,
    p_barang_id: query.barangId,
    p_varian_barang_id: query.varianBarangId ?? null,
    p_start_at: query.startAt,
    p_end_at: query.endAt,
    p_preferred_unit_id: query.preferredUnitId ?? null,
    p_exclude_penyewaan_id: query.excludePenyewaanId ?? null,
    p_limit: query.limit ?? 50,
  });

  if (error) throw error;
  return (data ?? []) as InventoryCandidate[];
}

export async function getInventoryOperationalContext(
  usahaId: string,
  unitBarangId: string,
): Promise<InventoryOperationalContext> {
  const assignmentResult = await supabase
    .from("penetapan_unit")
    .select("penetapan_unit_id,detail_penyewaan_id,status,ditetapkan_at,dibatalkan_at,alasan_substitusi,unit_barang_id")
    .eq("usaha_id", usahaId)
    .eq("unit_barang_id", unitBarangId)
    .eq("status", "assigned")
    .order("ditetapkan_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (assignmentResult.error) throw assignmentResult.error;

  const assignment = assignmentResult.data as InventoryOperationalContext["currentAssignment"];
  const [detailResult, returnResult, inspectionResult, maintenanceResult] = await Promise.all([
    assignment
      ? supabase
          .from("detail_penyewaan")
          .select("detail_penyewaan_id,penyewaan_id")
          .eq("usaha_id", usahaId)
          .eq("detail_penyewaan_id", assignment.detail_penyewaan_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("detail_pengembalian")
      .select("detail_pengembalian_id,pengembalian_id,diterima_at,status_pemeriksaan,catatan")
      .eq("usaha_id", usahaId)
      .eq("unit_barang_id", unitBarangId)
      .order("diterima_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("pemeriksaan")
      .select("pemeriksaan_id,detail_pengembalian_id,diperiksa_at,hasil,kelengkapan_status,keputusan_operasional,catatan")
      .eq("usaha_id", usahaId)
      .eq("unit_barang_id", unitBarangId)
      .order("diperiksa_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("perawatan")
      .select("perawatan_id,pemeriksaan_id,jenis_perawatan,deskripsi_pekerjaan,status,dimulai_at,selesai_at,pelaksana,catatan")
      .eq("usaha_id", usahaId)
      .eq("unit_barang_id", unitBarangId)
      .in("status", ["planned", "in_progress"])
      .order("created_at", { ascending: false }),
  ]);

  if (detailResult.error) throw detailResult.error;
  if (returnResult.error) throw returnResult.error;
  if (inspectionResult.error) throw inspectionResult.error;
  if (maintenanceResult.error) throw maintenanceResult.error;

  const penyewaanId = detailResult.data?.penyewaan_id ?? null;
  const rentalResult = penyewaanId
    ? await supabase
        .from("penyewaan")
        .select("penyewaan_id,nomor_penyewaan,penyewa_id,status,jadwal_mulai,jadwal_kembali,actual_pickup_at,actual_return_started_at,actual_return_completed_at")
        .eq("usaha_id", usahaId)
        .eq("penyewaan_id", penyewaanId)
        .maybeSingle()
    : { data: null, error: null };

  if (rentalResult.error) throw rentalResult.error;

  return {
    currentAssignment: assignment
      ? {
          ...assignment,
          penyewaan_id: penyewaanId ?? "",
        }
      : null,
    activeRental:
      rentalResult.data?.status === "active"
        ? (rentalResult.data as InventoryOperationalContext["activeRental"])
        : null,
    latestReturn: (returnResult.data ?? null) as InventoryOperationalContext["latestReturn"],
    latestInspection: (inspectionResult.data ?? null) as InventoryOperationalContext["latestInspection"],
    openMaintenance: (maintenanceResult.data ?? []) as InventoryOperationalContext["openMaintenance"],
  };
}

export async function markInventoryUnitInspectionPending(
  usahaId: string,
  unitBarangId: string,
  input: InspectionPendingCommandInput,
  options: InventoryCommandOptions = {},
): Promise<InventoryCommandResult> {
  if (!unitBarangId.trim()) throw new Error("Unit wajib dipilih.");
  if (!input.detailPengembalianId.trim()) throw new Error("Detail pengembalian wajib ditentukan.");
  if (!options.expectedUpdatedAt) {
    throw new Error("State unit terbaru wajib diverifikasi sebelum meneruskan return ke pemeriksaan.");
  }

  const idempotencyKey =
    options.idempotencyKey ?? ("mark-inventory-unit-inspection-pending-" + crypto.randomUUID());

  return executeInventoryCommand(
    usahaId,
    "mark_inventory_unit_inspection_pending",
    "command_mark_inventory_unit_inspection_pending",
    {
      p_usaha_id: usahaId,
      p_unit_barang_id: unitBarangId,
      p_detail_pengembalian_id: input.detailPengembalianId,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? newInventoryCommandRequestId(),
      p_expected_updated_at: options.expectedUpdatedAt,
    },
    "Handoff unit ke pemeriksaan",
    idempotencyKey,
  );
}