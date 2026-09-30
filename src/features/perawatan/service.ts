import { supabase } from "@/app/providers/supabase/client";
import type {
  CompleteMaintenanceInput,
  VerifyMaintenanceReadinessInput,
  CreateMaintenanceInput,
  MaintenanceCapabilities,
  MaintenanceCommandResult,
  MaintenanceContext,
  MaintenanceFinding,
  MaintenanceInspectionCandidate,
  MaintenanceQueueItem,
  MaintenanceReconciliationResult,
  MaintenanceRow,
  MaintenanceUnitCandidate,
  MaintenanceWorkspace,
} from "./types";
import { normalizeMaintenanceText } from "./utils";

type MembershipRow = { usaha_id: string; status: string; revoked_at: string | null };

function requestId() {
  return crypto.randomUUID();
}

function unknownOutcome(message: string) {
  return new Error("UNKNOWN_OUTCOME: " + message);
}

export async function getPerawatanContext(): Promise<MaintenanceContext> {
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
  if (rows.length > 1) throw new Error("Konteks Usaha belum ditentukan karena ada lebih dari satu keanggotaan aktif.");

  const { data: usaha, error: usahaError } = await supabase
    .from("usaha")
    .select("usaha_id,nama,status")
    .eq("usaha_id", rows[0].usaha_id)
    .eq("status", "active")
    .maybeSingle();
  if (usahaError) throw usahaError;
  if (!usaha) throw new Error("Usaha aktif tidak ditemukan.");

  return { akunAdminId: admin.akun_admin_id as string, usahaId: usaha.usaha_id as string, usahaNama: usaha.nama as string };
}

export async function listMaintenanceQueue(
  usahaId: string,
  input: { status?: string; search?: string } = {},
): Promise<MaintenanceQueueItem[]> {
  const { data: maintenanceRows, error } = await supabase
    .from("perawatan")
    .select("perawatan_id,usaha_id,unit_barang_id,pemeriksaan_id,jenis_perawatan,deskripsi_pekerjaan,status,dimulai_at,selesai_at,biaya,currency_code,pelaksana,catatan,created_at,updated_at")
    .eq("usaha_id", usahaId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const rows = (maintenanceRows ?? []) as MaintenanceRow[];
  if (!rows.length) return [];

  const unitIds = [...new Set(rows.map((row) => row.unit_barang_id))];
  const inspectionIds = [...new Set(rows.map((row) => row.pemeriksaan_id).filter(Boolean) as string[])];

  const [{ data: units, error: unitError }, { data: inspections, error: inspectionError }] = await Promise.all([
    supabase.from("unit_barang").select("unit_barang_id,kode_unit,status,barang:barang(barang_id,nama)").eq("usaha_id", usahaId).in("unit_barang_id", unitIds),
    inspectionIds.length
      ? supabase.from("pemeriksaan").select("pemeriksaan_id,hasil").eq("usaha_id", usahaId).in("pemeriksaan_id", inspectionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (unitError) throw unitError;
  if (inspectionError) throw inspectionError;

  const unitMap = new Map<string, { kode_unit: string; status: string; barang_nama: string | null }>();
  for (const unit of (units ?? []) as Array<{ unit_barang_id: string; kode_unit: string; status: string; barang?: { nama?: string | null } | null }>) {
    unitMap.set(unit.unit_barang_id, {
      kode_unit: unit.kode_unit,
      status: unit.status,
      barang_nama: unit.barang?.nama ?? null,
    });
  }
  const inspectionMap = new Map<string, string>();
  for (const inspection of (inspections ?? []) as Array<{ pemeriksaan_id: string; hasil: string }>) inspectionMap.set(inspection.pemeriksaan_id, inspection.hasil);

  const search = input.search?.trim().toLowerCase() ?? "";
  return rows
    .filter((row) => !input.status || input.status === "all" || row.status === input.status)
    .map((row) => ({
      ...row,
      kode_unit: unitMap.get(row.unit_barang_id)?.kode_unit ?? "-",
      barang_nama: unitMap.get(row.unit_barang_id)?.barang_nama ?? null,
      unit_status: unitMap.get(row.unit_barang_id)?.status ?? "-",
      pemeriksaan_hasil: row.pemeriksaan_id ? inspectionMap.get(row.pemeriksaan_id) ?? null : null,
    }))
    .filter((row) => {
      if (!search) return true;
      return [row.kode_unit, row.barang_nama, row.jenis_perawatan, row.deskripsi_pekerjaan, row.pelaksana, row.pemeriksaan_id]
        .some((value) => value?.toLowerCase().includes(search));
    });
}

export async function listMaintenanceUnitCandidates(usahaId: string, search = ""): Promise<MaintenanceUnitCandidate[]> {
  const { data, error } = await supabase
    .from("unit_barang")
    .select("unit_barang_id,kode_unit,status,barang:barang(barang_id,nama)")
    .eq("usaha_id", usahaId)
    .in("status", ["ready", "inspection_pending"])
    .order("kode_unit", { ascending: true })
    .limit(200);
  if (error) throw error;

  const term = search.trim().toLowerCase();
  return ((data ?? []) as Array<{ unit_barang_id: string; kode_unit: string; status: string; barang?: { nama?: string | null } | null }>)
    .map((unit) => ({
      unit_barang_id: unit.unit_barang_id,
      kode_unit: unit.kode_unit,
      status: unit.status,
      barang_nama: unit.barang?.nama ?? null,
    }))
    .filter((unit) => !term || [unit.kode_unit, unit.barang_nama, unit.status].some((value) => value?.toLowerCase().includes(term)));
}

export async function listMaintenanceInspectionCandidates(
  usahaId: string,
  search = "",
): Promise<MaintenanceInspectionCandidate[]> {
  const { data, error } = await supabase
    .from("pemeriksaan")
    .select(
      "pemeriksaan_id,unit_barang_id,hasil,kelengkapan_status,keputusan_operasional,diperiksa_at,unit:unit_barang(unit_barang_id,kode_unit,status,barang:barang(barang_id,nama),varian:varian_barang(varian_barang_id,nama))",
    )
    .eq("usaha_id", usahaId)
    .eq("hasil", "issue_found")
    .in("keputusan_operasional", ["maintenance_required", "cleaning_required"])
    .order("diperiksa_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<{
    pemeriksaan_id: string;
    unit_barang_id: string;
    hasil: string;
    kelengkapan_status: string;
    keputusan_operasional: string;
    diperiksa_at: string;
    unit?: {
      unit_barang_id: string;
      kode_unit: string;
      status: string;
      barang?: { nama?: string | null } | null;
      varian?: { nama?: string | null } | null;
    } | null;
  }>;

  const ids = rows.map((row) => row.pemeriksaan_id);
  const findingMap = new Map<string, { count: number; summary: string | null }>();

  if (ids.length) {
    const { data: findings, error: findingError } = await supabase
      .from("temuan_pemeriksaan")
      .select("pemeriksaan_id,deskripsi")
      .eq("usaha_id", usahaId)
      .in("pemeriksaan_id", ids)
      .order("created_at", { ascending: true });

    if (findingError) throw findingError;

    for (const finding of (findings ?? []) as Array<{ pemeriksaan_id: string; deskripsi: string }>) {
      const current = findingMap.get(finding.pemeriksaan_id) ?? { count: 0, summary: null };
      current.count += 1;
      current.summary ??= finding.deskripsi;
      findingMap.set(finding.pemeriksaan_id, current);
    }
  }

  const term = search.trim().toLowerCase();
  return rows
    .map((row) => {
      const finding = findingMap.get(row.pemeriksaan_id) ?? { count: 0, summary: null };
      return {
        pemeriksaan_id: row.pemeriksaan_id,
        unit_barang_id: row.unit_barang_id,
        kode_unit: row.unit?.kode_unit ?? "-",
        barang_nama: row.unit?.barang?.nama ?? null,
        varian_nama: row.unit?.varian?.nama ?? null,
        hasil: row.hasil,
        kelengkapan_status: row.kelengkapan_status,
        keputusan_operasional: row.keputusan_operasional,
        diperiksa_at: row.diperiksa_at,
        finding_count: finding.count,
        finding_summary: finding.summary,
      };
    })
    .filter((row) =>
      !term ||
      [row.pemeriksaan_id, row.kode_unit, row.barang_nama, row.varian_nama, row.finding_summary]
        .some((value) => value?.toLowerCase().includes(term)),
    );
}

export async function getMaintenanceWorkspace(usahaId: string, perawatanId: string): Promise<MaintenanceWorkspace> {
  const { data: maintenance, error: maintenanceError } = await supabase
    .from("perawatan")
    .select("perawatan_id,usaha_id,unit_barang_id,pemeriksaan_id,jenis_perawatan,deskripsi_pekerjaan,status,dimulai_at,selesai_at,biaya,currency_code,pelaksana,catatan,created_at,updated_at")
    .eq("usaha_id", usahaId)
    .eq("perawatan_id", perawatanId)
    .maybeSingle();
  if (maintenanceError) throw maintenanceError;
  if (!maintenance) throw new Error("Maintenance tidak ditemukan.");

  const [unitResult, inspectionResult, historyResult] = await Promise.all([
    supabase
      .from("unit_barang")
      .select("unit_barang_id,kode_unit,status,updated_at,barang:barang(barang_id,nama),varian:varian_barang(varian_barang_id,nama)")
      .eq("usaha_id", usahaId)
      .eq("unit_barang_id", maintenance.unit_barang_id)
      .maybeSingle(),
    maintenance.pemeriksaan_id
      ? supabase.from("pemeriksaan").select("pemeriksaan_id,hasil,kelengkapan_status,keputusan_operasional,diperiksa_at,catatan").eq("usaha_id", usahaId).eq("pemeriksaan_id", maintenance.pemeriksaan_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("riwayat_unit").select("riwayat_unit_id,jenis_kejadian,terjadi_at,status_sebelum,status_sesudah,catatan,sumber_type,sumber_id").eq("usaha_id", usahaId).eq("unit_barang_id", maintenance.unit_barang_id).order("terjadi_at", { ascending: false }),
  ]);
  if (unitResult.error) throw unitResult.error;
  if (inspectionResult.error) throw inspectionResult.error;
  if (historyResult.error) throw historyResult.error;
  if (!unitResult.data) throw new Error("Unit maintenance tidak ditemukan.");

  const findingsResult = maintenance.pemeriksaan_id
    ? await supabase.from("temuan_pemeriksaan").select("temuan_pemeriksaan_id,jenis_temuan,deskripsi,tingkat,status_tindak_lanjut,nominal_potensi_biaya,currency_code").eq("usaha_id", usahaId).eq("pemeriksaan_id", maintenance.pemeriksaan_id).order("created_at", { ascending: true })
    : { data: [], error: null };
  if (findingsResult.error) throw findingsResult.error;

  const unit = unitResult.data as { unit_barang_id: string; kode_unit: string; status: string; updated_at: string; barang?: { nama?: string | null } | null; varian?: { nama?: string | null } | null };
  return {
    maintenance: maintenance as MaintenanceRow,
    unit: {
      unit_barang_id: unit.unit_barang_id,
      kode_unit: unit.kode_unit,
      status: unit.status,
      updated_at: unit.updated_at,
      barang_nama: unit.barang?.nama ?? null,
      varian_nama: unit.varian?.nama ?? null,
    },
    sourceInspection: inspectionResult.data ? inspectionResult.data as MaintenanceWorkspace["sourceInspection"] : null,
    findings: (findingsResult.data ?? []) as MaintenanceFinding[],
    history: (historyResult.data ?? []) as MaintenanceWorkspace["history"],
  };
}

async function reconcileMutation(usahaId: string, commandName: string, idempotencyKey: string): Promise<MaintenanceReconciliationResult> {
  const { data, error } = await supabase.rpc("command_reconcile_maintenance_mutation", {
    p_usaha_id: usahaId,
    p_command_name: commandName,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return (data as MaintenanceReconciliationResult | null) ?? { state: "not_found", command_name: commandName, response: null };
}

async function reconcileOrThrow(usahaId: string, commandName: string, idempotencyKey: string, originalError: unknown) {
  try {
    const result = await reconcileMutation(usahaId, commandName, idempotencyKey);
    if (result.state === "committed" && result.response) return result.response as MaintenanceCommandResult;
    if (result.state === "unknown") throw unknownOutcome("command memiliki idempotency record tanpa response. Jangan retry mutation.");
    if (originalError instanceof Error) throw originalError;
    throw unknownOutcome("server tidak mengembalikan hasil command.");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("UNKNOWN_OUTCOME:")) throw error;
    if (originalError instanceof Error) throw originalError;
    throw unknownOutcome("hasil command belum dapat direkonsiliasi.");
  }
}

export async function createMaintenance(usahaId: string, input: CreateMaintenanceInput, idempotencyKey = "create-maintenance-" + crypto.randomUUID()) {
  if (!input.unitBarangId.trim()) throw new Error("Unit wajib dipilih.");
  if (!input.jenisPerawatan.trim()) throw new Error("Jenis perawatan wajib diisi.");
  if (!input.deskripsiPekerjaan.trim()) throw new Error("Deskripsi pekerjaan wajib diisi.");
  if (!input.pemeriksaanId?.trim() && !input.catatan?.trim()) {
    throw new Error("Maintenance tanpa Inspection Source wajib memiliki alasan.");
  }

  const { data, error } = await supabase.rpc("command_create_maintenance", {
    p_usaha_id: usahaId,
    p_unit_barang_id: input.unitBarangId,
    p_pemeriksaan_id: input.pemeriksaanId || null,
    p_jenis_perawatan: input.jenisPerawatan.trim(),
    p_deskripsi_pekerjaan: input.deskripsiPekerjaan.trim(),
    p_pelaksana: normalizeMaintenanceText(input.pelaksana),
    p_biaya: input.biaya ?? null,
    p_currency_code: input.currencyCode?.trim().toUpperCase() || "IDR",
    p_catatan: normalizeMaintenanceText(input.catatan),
    p_idempotency_key: idempotencyKey,
    p_request_id: requestId(),
  });
  if (!error && data) return data as MaintenanceCommandResult;
  return reconcileOrThrow(usahaId, "create_maintenance", idempotencyKey, error);
}

export async function startMaintenance(usahaId: string, perawatanId: string, expectedUpdatedAt: string, expectedUnitUpdatedAt: string, idempotencyKey = "start-maintenance-" + crypto.randomUUID()) {
  const { data, error } = await supabase.rpc("command_start_maintenance", {
    p_usaha_id: usahaId,
    p_perawatan_id: perawatanId,
    p_expected_updated_at: expectedUpdatedAt,
    p_expected_unit_updated_at: expectedUnitUpdatedAt,
    p_idempotency_key: idempotencyKey,
    p_request_id: requestId(),
  });
  if (!error && data) return data as MaintenanceCommandResult;
  return reconcileOrThrow(usahaId, "start_maintenance", idempotencyKey, error);
}

export async function completeMaintenance(usahaId: string, input: CompleteMaintenanceInput, expectedUpdatedAt: string, expectedUnitUpdatedAt: string, idempotencyKey = "complete-maintenance-" + crypto.randomUUID()) {
  const { data, error } = await supabase.rpc("command_complete_maintenance", {
    p_usaha_id: usahaId,
    p_perawatan_id: input.perawatanId,
    p_expected_updated_at: expectedUpdatedAt,
    p_expected_unit_updated_at: expectedUnitUpdatedAt,
    p_pelaksana: normalizeMaintenanceText(input.pelaksana),
    p_biaya: input.biaya ?? null,
    p_currency_code: input.currencyCode?.trim().toUpperCase() || null,
    p_catatan: normalizeMaintenanceText(input.catatan),
    p_idempotency_key: idempotencyKey,
    p_request_id: requestId(),
  });
  if (!error && data) return data as MaintenanceCommandResult;
  return reconcileOrThrow(usahaId, "complete_maintenance", idempotencyKey, error);
}

export async function verifyMaintenanceReadiness(
  usahaId: string,
  input: VerifyMaintenanceReadinessInput,
  expectedMaintenanceUpdatedAt: string,
  expectedUnitUpdatedAt: string,
  idempotencyKey = "verify-maintenance-" + crypto.randomUUID(),
) {
  if (!input.perawatanId.trim()) throw new Error("Maintenance wajib dipilih.");
  if (!["passed", "failed"].includes(input.verificationResult)) {
    throw new Error("Hasil verification tidak valid.");
  }

  const { data, error } = await supabase.rpc("command_verify_maintenance_readiness", {
    p_usaha_id: usahaId,
    p_perawatan_id: input.perawatanId,
    p_verification_result: input.verificationResult,
    p_catatan: normalizeMaintenanceText(input.catatan),
    p_expected_maintenance_updated_at: expectedMaintenanceUpdatedAt,
    p_expected_unit_updated_at: expectedUnitUpdatedAt,
    p_idempotency_key: idempotencyKey,
    p_request_id: requestId(),
  });
  if (!error && data) return data as MaintenanceCommandResult;
  return reconcileOrThrow(usahaId, "verify_maintenance_readiness", idempotencyKey, error);
}

export async function reconcileMaintenanceCommand(
  usahaId: string,
  commandName: "create_maintenance" | "start_maintenance" | "complete_maintenance" | "verify_maintenance_readiness",
  idempotencyKey: string,
) {
  if (!usahaId.trim() || !idempotencyKey.trim()) throw new Error("Usaha dan idempotency key wajib diisi.");
  return reconcileMutation(usahaId, commandName, idempotencyKey);
}

export function getMaintenanceCapabilities(): MaintenanceCapabilities {
  return {
    read: true,
    mutation: true,
    commands: [
      "create_maintenance",
      "start_maintenance",
      "complete_maintenance",
      "verify_maintenance_readiness",
      "command_reconcile_maintenance_mutation",
    ],
    queries: ["listMaintenanceQueue","getMaintenanceWorkspace","listMaintenanceUnitCandidates"],
    reason: "Perawatan memakai trusted command, tenant authorization, advisory lock, active-maintenance uniqueness, server timestamps, stale guards, idempotency, audit, outbox, dan reconciliation. Completion tidak mengubah unit menjadi READY; verification tetap menjadi langkah downstream.",
  };
}
