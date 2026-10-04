import { createClientId } from "@/lib/client-id";
import { supabase } from "@/app/providers/supabase/client";
import type {
  InventoryCandidate,
  InventoryCandidateQuery,
  InventoryCapabilities,
  CreateInventoryLocationInput,
  InventoryCatalogItem,
  InventoryCommandOptions,
  InventoryCommandResult,
  InventoryConditionCorrectionInput,
  InventoryConditionCorrectionResult,
  UpdateInventoryLocationInput,
  InventoryContext,
  InventoryListFilters,
  InventoryLocation,
  InventoryOperationalContext,
  InventoryOperationalStatusInput,
  InventoryPackageAvailability,
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

async function shouldRefreshAuthForReadError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; status?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  return (
    candidate.status === 401 ||
    candidate.status === 403 ||
    candidate.code === "42501" ||
    message.includes("permission denied") ||
    message.includes("jwt") ||
    message.includes("unauthorized")
  );
}

export async function listInventoryLocations(usahaId: string): Promise<InventoryLocation[]> {
  const select =
    "lokasi_id,usaha_id,nama,tipe,alamat,keterangan,status,created_at,updated_at";

  let result = await supabase
    .from("lokasi")
    .select(select)
    .eq("usaha_id", usahaId)
    .order("nama", { ascending: true });

  if (result.error && await shouldRefreshAuthForReadError(result.error)) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError) {
      result = await supabase
        .from("lokasi")
        .select(select)
        .eq("usaha_id", usahaId)
        .order("nama", { ascending: true });
    }
  }

  if (result.error) throw result.error;
  return (result.data ?? []) as InventoryLocation[];
}

async function reconcileInventoryLocationAfterUncertainResult(
  usahaId: string,
  commandName: "create_lokasi" | "update_lokasi",
  idempotencyKey: string,
): Promise<InventoryLocation | null> {
  const { data, error } = await supabase.rpc("command_reconcile_lokasi_mutation", {
    p_usaha_id: usahaId,
    p_command_name: commandName,
    p_idempotency_key: idempotencyKey,
  });

  if (error) throw error;

  const result = data as InventoryReconciliationResult | null;
  if (!result) return null;
  if (result.state === "committed" && result.response) return result.response as unknown as InventoryLocation;
  if (result.state === "unknown") {
    throw new Error(
      "Hasil perubahan master lokasi belum dapat dipastikan. Jangan mengulang tindakan sebelum status diperiksa.",
    );
  }
  return null;
}

async function executeInventoryLocationCommand(
  usahaId: string,
  commandName: "create_lokasi" | "update_lokasi",
  rpcName: "command_create_lokasi" | "command_update_lokasi",
  args: Record<string, unknown>,
  label: string,
  idempotencyKey: string,
): Promise<InventoryLocation> {
  const { data, error } = await supabase.rpc(rpcName, args);
  if (!error && data) return data as InventoryLocation;

  try {
    const reconciled = await reconcileInventoryLocationAfterUncertainResult(
      usahaId,
      commandName,
      idempotencyKey,
    );
    if (reconciled) return reconciled;
  } catch (reconcileError) {
    if (reconcileError instanceof Error && reconcileError.message.startsWith("UNKNOWN_OUTCOME:")) {
      throw reconcileError;
    }
  }

  if (error) throw normalizeRpcError(error, label);
  throw new Error(`${label}: server tidak mengembalikan hasil command.`);
}

export async function createInventoryLocation(
  usahaId: string,
  input: CreateInventoryLocationInput,
  options: InventoryCommandOptions = {},
): Promise<InventoryLocation> {
  const nama = input.nama.trim();
  if (!nama) throw new Error("Nama lokasi wajib diisi.");
  const idempotencyKey = options.idempotencyKey ?? `create-lokasi-${createClientId()}`;

  return executeInventoryLocationCommand(
    usahaId,
    "create_lokasi",
    "command_create_lokasi",
    {
      p_usaha_id: usahaId,
      p_nama: nama,
      p_tipe: input.tipe.trim() || "gudang",
      p_alamat: input.alamat?.trim() || null,
      p_keterangan: input.keterangan?.trim() || null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? newInventoryCommandRequestId(),
    },
    "Pembuatan lokasi",
    idempotencyKey,
  );
}

export async function updateInventoryLocation(
  usahaId: string,
  lokasiId: string,
  input: UpdateInventoryLocationInput,
  options: InventoryCommandOptions = {},
): Promise<InventoryLocation> {
  const nama = input.nama.trim();
  if (!lokasiId.trim()) throw new Error("Lokasi wajib dipilih.");
  if (!nama) throw new Error("Nama lokasi wajib diisi.");
  if (!options.expectedUpdatedAt) throw new Error("Data lokasi terbaru wajib diverifikasi sebelum diperbarui.");
  const idempotencyKey = options.idempotencyKey ?? `update-lokasi-${createClientId()}`;

  return executeInventoryLocationCommand(
    usahaId,
    "update_lokasi",
    "command_update_lokasi",
    {
      p_usaha_id: usahaId,
      p_lokasi_id: lokasiId,
      p_nama: nama,
      p_tipe: input.tipe.trim() || "gudang",
      p_alamat: input.alamat?.trim() || null,
      p_keterangan: input.keterangan?.trim() || null,
      p_status: input.status,
      p_expected_updated_at: options.expectedUpdatedAt,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? newInventoryCommandRequestId(),
    },
    "Pembaruan lokasi",
    idempotencyKey,
  );
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
      "set_inventory_unit_operational_status",
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
      "Data Inventaris diproses dengan pemeriksaan Usaha aktif, validasi status terbaru, pencatatan aman, perlindungan perubahan bersamaan, audit, dan pemeriksaan ulang hasil tindakan.",
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
  return createClientId();
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
      "Hasil tindakan Inventaris belum dapat dipastikan. Jangan mengulang tindakan; periksa status terbaru terlebih dahulu.",
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
    | "mark_inventory_unit_inspection_pending"
    | "set_inventory_unit_operational_status",
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

  const idempotencyKey = options.idempotencyKey ?? `register-inventory-unit-${createClientId()}`;

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
  if (!options.expectedUpdatedAt) throw new Error("Status unit terbaru wajib diverifikasi sebelum memindahkan unit.");

  const idempotencyKey = options.idempotencyKey ?? `move-inventory-unit-${createClientId()}`;

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

export async function correctInventoryConditionSummary(
  usahaId: string,
  unitBarangId: string,
  input: InventoryConditionCorrectionInput,
  options: { idempotencyKey?: string; requestId?: string } = {},
): Promise<InventoryConditionCorrectionResult> {
  const newCondition = input.newCondition.trim();
  const correctionReason = input.correctionReason.trim();
  if (!newCondition) throw new Error("Kondisi ringkas baru wajib diisi.");
  if (!correctionReason) throw new Error("Alasan koreksi wajib diisi.");
  if (!input.expectedUpdatedAt) throw new Error("Status unit terbaru wajib diverifikasi sebelum koreksi.");

  const idempotencyKey = options.idempotencyKey ?? ("correct-inventory-condition-" + createClientId());
  const { data, error } = await supabase.rpc("command_correct_inventory_condition_summary", {
    p_usaha_id: usahaId,
    p_unit_barang_id: unitBarangId,
    p_new_condition: newCondition,
    p_correction_reason: correctionReason,
    p_correction_note: input.correctionNote?.trim() || null,
    p_source_pemeriksaan_id: input.sourcePemeriksaanId ?? null,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_idempotency_key: idempotencyKey,
    p_request_id: options.requestId ?? newInventoryCommandRequestId(),
  });

  if (!error && data) return data as InventoryConditionCorrectionResult;

  const { data: reconciliation, error: reconcileError } = await supabase.rpc("command_reconcile_inventory_condition_mutation", {
    p_usaha_id: usahaId,
    p_idempotency_key: idempotencyKey,
  });
  if (reconcileError) throw normalizeRpcError(reconcileError, "Rekonsiliasi Koreksi Kondisi");
  if (reconciliation?.state === "committed" && reconciliation.response) {
    return reconciliation.response as InventoryConditionCorrectionResult;
  }
  if (reconciliation?.state === "unknown") {
    throw new Error("UNKNOWN_OUTCOME: hasil koreksi kondisi belum dapat dipastikan. Jangan mengulang tindakan.");
  }
  if (error) throw normalizeRpcError(error, "Koreksi Kondisi");
  throw new Error("Koreksi Kondisi: server tidak mengembalikan hasil.");
}
export async function markInventoryUnitReady(
  usahaId: string,
  unitBarangId: string,
  catatan?: string | null,
  options: InventoryCommandOptions = {},
): Promise<InventoryCommandResult> {
  if (!unitBarangId.trim()) throw new Error("Unit wajib dipilih.");
  if (!options.expectedUpdatedAt) throw new Error("Status unit terbaru wajib diverifikasi sebelum menetapkan Siap Disewakan.");

  const idempotencyKey = options.idempotencyKey ?? `mark-inventory-unit-ready-${createClientId()}`;

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
    "Penetapan Siap Disewakan unit",
    idempotencyKey,
  );
}

export async function setInventoryUnitOperationalStatus(
  usahaId: string,
  unitBarangId: string,
  input: InventoryOperationalStatusInput,
  options: InventoryCommandOptions = {},
): Promise<InventoryCommandResult> {
  if (!unitBarangId.trim()) throw new Error("Unit wajib dipilih.");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Alasan wajib diisi.");
  if (!input.expectedUpdatedAt) throw new Error("Status unit terbaru wajib diverifikasi sebelum diubah.");

  const idempotencyKey = options.idempotencyKey ?? `set-inventory-unit-status-${createClientId()}`;
  const { data, error } = await supabase.rpc("command_set_inventory_unit_operational_status", {
    p_usaha_id: usahaId,
    p_unit_barang_id: unitBarangId,
    p_status: input.status,
    p_alasan: reason,
    p_catatan: input.note?.trim() || null,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_idempotency_key: idempotencyKey,
    p_request_id: options.requestId ?? newInventoryCommandRequestId(),
  });

  if (!error && data) return data as InventoryCommandResult;

  const { data: reconciliation, error: reconcileError } = await supabase.rpc(
    "command_reconcile_inventory_unit_mutation",
    {
      p_usaha_id: usahaId,
      p_command_name: "set_inventory_unit_operational_status",
      p_idempotency_key: idempotencyKey,
    },
  );

  if (reconcileError) throw normalizeRpcError(reconcileError, "Rekonsiliasi perubahan status unit");
  if (reconciliation?.state === "committed" && reconciliation.response) {
    return reconciliation.response as InventoryCommandResult;
  }
  if (reconciliation?.state === "unknown") {
    throw new Error("UNKNOWN_OUTCOME: hasil perubahan status unit belum dapat dipastikan. Jangan mengulang tindakan.");
  }
  if (error) throw normalizeRpcError(error, "Perubahan status unit");
  throw new Error("Perubahan status unit: server tidak mengembalikan hasil.");
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

export async function lookupInventoryUnitByQr(
  usahaId: string,
  stableUnitIdentifier: string,
) {
  const identifier = stableUnitIdentifier.trim();
  if (!identifier) throw new Error("Identifier QR unit wajib diisi.");
  return getInventoryUnit(usahaId, identifier);
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
      .select("perawatan_id,pemeriksaan_id,jenis_perawatan,deskripsi_pekerjaan,status,dimulai_at,selesai_at,pelaksana,catatan,created_at")
      .eq("usaha_id", usahaId)
      .eq("unit_barang_id", unitBarangId)
      .neq("status", "cancelled")
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

  const maintenanceRows = (maintenanceResult.data ?? []) as InventoryOperationalContext["openMaintenance"];
  const latestMaintenance = maintenanceRows[0] ?? null;

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
    openMaintenance: maintenanceRows.filter((row) => row.status === "planned" || row.status === "in_progress"),
    latestMaintenance,
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
    throw new Error("Status unit terbaru wajib diverifikasi sebelum meneruskan pengembalian ke pemeriksaan.");
  }

  const idempotencyKey =
    options.idempotencyKey ?? ("mark-inventory-unit-inspection-pending-" + createClientId());

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

export async function listInventoryPackageAvailability(
  usahaId: string,
): Promise<InventoryPackageAvailability[]> {
  const [packagesResult, componentsResult] = await Promise.all([
    supabase
      .from("paket_sewa")
      .select("paket_sewa_id,nama,deskripsi,harga_dasar,currency_code,status")
      .eq("usaha_id", usahaId)
      .eq("status", "active")
      .order("nama", { ascending: true }),
    supabase
      .from("komponen_paket")
      .select("komponen_paket_id,paket_sewa_id,barang_id,varian_barang_id,jumlah,catatan")
      .eq("usaha_id", usahaId)
      .order("created_at", { ascending: true }),
  ]);
  if (packagesResult.error) throw packagesResult.error;
  if (componentsResult.error) throw componentsResult.error;

  const packages = (packagesResult.data ?? []) as Array<{
    paket_sewa_id: string;
    nama: string;
    deskripsi: string | null;
    harga_dasar: number | null;
    currency_code: string;
  }>;
  const components = (componentsResult.data ?? []) as Array<{
    komponen_paket_id: string;
    paket_sewa_id: string;
    barang_id: string | null;
    varian_barang_id: string | null;
    jumlah: number | string;
  }>;

  const barangIds = Array.from(new Set(components.map((row) => row.barang_id).filter(Boolean) as string[]));
  const variantIds = Array.from(new Set(components.map((row) => row.varian_barang_id).filter(Boolean) as string[]));

  const [productsResult, variantsResult, unitsResult] = await Promise.all([
    barangIds.length
      ? supabase.from("barang").select("barang_id,nama").eq("usaha_id", usahaId).in("barang_id", barangIds)
      : Promise.resolve({ data: [], error: null }),
    variantIds.length
      ? supabase.from("varian_barang").select("varian_barang_id,nama,barang_id").eq("usaha_id", usahaId).in("varian_barang_id", variantIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("unit_barang")
      .select("unit_barang_id,barang_id,varian_barang_id,status")
      .eq("usaha_id", usahaId),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (variantsResult.error) throw variantsResult.error;
  if (unitsResult.error) throw unitsResult.error;

  const productNames = new Map((productsResult.data ?? []).map((row) => [row.barang_id as string, row.nama as string]));
  const variantRows = (variantsResult.data ?? []) as Array<{ varian_barang_id: string; nama: string; barang_id: string }>;
  const variantNames = new Map(variantRows.map((row) => [row.varian_barang_id, row.nama]));
  const units = (unitsResult.data ?? []) as Array<{
    unit_barang_id: string;
    barang_id: string;
    varian_barang_id: string | null;
    status: string;
  }>;

  const componentAvailability = components.map((component) => {
    const required = Number(component.jumlah);
    const matching = units.filter((unit) =>
      component.varian_barang_id
        ? unit.varian_barang_id === component.varian_barang_id
        : unit.barang_id === component.barang_id,
    );
    const ready = matching.filter((unit) => unit.status === "ready").length;
    const rented = matching.filter((unit) => unit.status === "rented").length;
    const maintenance = matching.filter((unit) => unit.status === "maintenance").length;
    const inspectionPending = matching.filter((unit) => unit.status === "inspection_pending").length;
    const blocked = matching.filter((unit) => ["damaged", "lost", "inactive"].includes(unit.status)).length;
    const shortfall = Math.max(0, required - ready);
    const name = component.varian_barang_id
      ? (productNames.get(component.barang_id ?? "") ?? "Barang") + " · " + (variantNames.get(component.varian_barang_id) ?? "Varian")
      : productNames.get(component.barang_id ?? "") ?? "Barang";

    return {
      ...component,
      nama: name,
      required_quantity: required,
      ready_quantity: ready,
      rented_quantity: rented,
      maintenance_quantity: maintenance,
      inspection_pending_quantity: inspectionPending,
      blocked_quantity: blocked,
      shortfall_quantity: shortfall,
    };
  });

  return packages.map((pkg) => {
    const packageComponents = componentAvailability.filter((component) => component.paket_sewa_id === pkg.paket_sewa_id);
    const available = packageComponents.length
      ? Math.min(...packageComponents.map((component) => Math.floor(component.ready_quantity / component.required_quantity)))
      : 0;
    const limiting = packageComponents
      .filter((component) => component.shortfall_quantity > 0)
      .sort((a, b) => b.shortfall_quantity - a.shortfall_quantity)[0];

    return {
      ...pkg,
      available_package_quantity: Number.isFinite(available) ? available : 0,
      status: available > 0 ? "available" : "insufficient",
      limiting_component_name: limiting?.nama ?? null,
      components: packageComponents,
    };
  });
}
