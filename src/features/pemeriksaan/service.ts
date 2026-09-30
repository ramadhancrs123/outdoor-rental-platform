import { supabase } from "@/app/providers/supabase/client";
import type {
  AttachEvidenceResult,
  CompleteInspectionResult,
  InspectionCapabilities,
  InspectionCompleteInput,
  InspectionEvidence,
  InspectionFinding,
  InspectionHistoryItem,
  InspectionQueueItem,
  InspectionReconciliationResult,
  InspectionTenantContext,
  InspectionWorkspace,
  StartInspectionResult,
} from "./types";
import { deriveInspectionState, normalizeInspectionFindings } from "./utils";

const CONDITION_BUCKET = "rental-private-condition";

type MembershipRow = { usaha_id: string };
type ReturnDetailRow = {
  detail_pengembalian_id: string;
  usaha_id: string;
  pengembalian_id: string;
  unit_barang_id: string;
  diterima_at: string;
  status_pemeriksaan: string;
  catatan: string | null;
  updated_at: string;
};
type ReturnHeaderRow = {
  pengembalian_id: string;
  usaha_id: string;
  penyewaan_id: string;
  nomor_pengembalian: string;
  status: string;
};
type UnitRow = {
  unit_barang_id: string;
  usaha_id: string;
  kode_unit: string;
  status: string;
  barang_id: string;
  varian_barang_id: string | null;
  updated_at: string;
};
type InspectionRow = {
  pemeriksaan_id: string;
  usaha_id: string;
  detail_pengembalian_id: string;
  unit_barang_id: string;
  diperiksa_at: string;
  diperiksa_by_admin_id: string;
  hasil: string;
  kelengkapan_status: string;
  keputusan_operasional: string;
  catatan: string | null;
  created_at: string;
  updated_at: string;
};

async function getAdminContext(usahaId?: string): Promise<InspectionTenantContext> {
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

  let query = supabase
    .from("keanggotaan_usaha")
    .select("usaha_id")
    .eq("akun_admin_id", admin.akun_admin_id)
    .eq("status", "active")
    .is("revoked_at", null);

  if (usahaId) query = query.eq("usaha_id", usahaId);

  const { data, error } = await query;
  if (error) throw error;

  const memberships = (data ?? []) as MembershipRow[];
  if (!memberships.length) throw new Error("Akun admin belum memiliki Usaha aktif.");
  if (memberships.length > 1) throw new Error("Konteks Usaha belum ditentukan karena ada lebih dari satu keanggotaan aktif.");

  const { data: usaha, error: usahaError } = await supabase
    .from("usaha")
    .select("usaha_id,nama,status,timezone")
    .eq("usaha_id", memberships[0].usaha_id)
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

export async function getPemeriksaanContext() {
  return getAdminContext();
}

async function resolveProductNames(usahaId: string, units: UnitRow[]) {
  const barangIds = Array.from(new Set(units.map((unit) => unit.barang_id)));
  const variantIds = Array.from(new Set(units.map((unit) => unit.varian_barang_id).filter(Boolean)));

  const [barangResult, variantResult] = await Promise.all([
    barangIds.length
      ? supabase.from("barang").select("barang_id,nama").eq("usaha_id", usahaId).in("barang_id", barangIds)
      : Promise.resolve({ data: [], error: null }),
    variantIds.length
      ? supabase.from("varian_barang").select("varian_barang_id,nama").eq("usaha_id", usahaId).in("varian_barang_id", variantIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (barangResult.error) throw barangResult.error;
  if (variantResult.error) throw variantResult.error;

  return {
    barang: new Map((barangResult.data ?? []).map((row) => [row.barang_id as string, row.nama as string])),
    variants: new Map((variantResult.data ?? []).map((row) => [row.varian_barang_id as string, row.nama as string])),
  };
}

async function getLatestInspectionsByDetail(usahaId: string, detailIds: string[]) {
  if (!detailIds.length) return new Map<string, InspectionRow>();
  const { data, error } = await supabase
    .from("pemeriksaan")
    .select(
      "pemeriksaan_id,usaha_id,detail_pengembalian_id,unit_barang_id,diperiksa_at,diperiksa_by_admin_id,hasil,kelengkapan_status,keputusan_operasional,catatan,created_at,updated_at",
    )
    .eq("usaha_id", usahaId)
    .in("detail_pengembalian_id", detailIds)
    .order("diperiksa_at", { ascending: false });
  if (error) throw error;

  const map = new Map<string, InspectionRow>();
  for (const row of (data ?? []) as InspectionRow[]) {
    if (!map.has(row.detail_pengembalian_id)) map.set(row.detail_pengembalian_id, row);
  }
  return map;
}

async function getInspectionChildren(usahaId: string, inspectionIds: string[]) {
  if (!inspectionIds.length) {
    return {
      findings: new Map<string, InspectionFinding[]>(),
      evidence: new Map<string, InspectionEvidence[]>(),
    };
  }

  const [findingResult, evidenceResult] = await Promise.all([
    supabase
      .from("temuan_pemeriksaan")
      .select(
        "temuan_pemeriksaan_id,usaha_id,pemeriksaan_id,jenis_temuan,deskripsi,tingkat,status_tindak_lanjut,nominal_potensi_biaya,currency_code,created_at,updated_at",
      )
      .eq("usaha_id", usahaId)
      .in("pemeriksaan_id", inspectionIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("bukti_foto_kondisi")
      .select(
        "bukti_foto_kondisi_id,usaha_id,pemeriksaan_id,unit_barang_id,jenis_foto,storage_bucket,storage_path,captured_at,captured_by_admin_id,catatan,created_at",
      )
      .eq("usaha_id", usahaId)
      .in("pemeriksaan_id", inspectionIds)
      .order("created_at", { ascending: true }),
  ]);

  if (findingResult.error) throw findingResult.error;
  if (evidenceResult.error) throw evidenceResult.error;

  const findings = new Map<string, InspectionFinding[]>();
  for (const row of (findingResult.data ?? []) as InspectionFinding[]) {
    const current = findings.get(row.pemeriksaan_id) ?? [];
    current.push(row);
    findings.set(row.pemeriksaan_id, current);
  }

  const evidence = new Map<string, InspectionEvidence[]>();
  for (const row of (evidenceResult.data ?? []) as InspectionEvidence[]) {
    const current = evidence.get(row.pemeriksaan_id) ?? [];
    current.push(row);
    evidence.set(row.pemeriksaan_id, current);
  }

  return { findings, evidence };
}

async function hydrateEvidenceUrls(inspectionEvidence: InspectionEvidence[]) {
  if (!inspectionEvidence.length) return [];
  const result = await Promise.all(
    inspectionEvidence.map(async (item) => {
      const signed = await supabase.storage
        .from(item.storage_bucket)
        .createSignedUrl(item.storage_path, 15 * 60);
      return signed.error ? item : { ...item, signed_url: signed.data?.signedUrl };
    }),
  );
  return result;
}

async function buildHistory(usahaId: string, rows: InspectionRow[]): Promise<InspectionHistoryItem[]> {
  if (!rows.length) return [];
  const children = await getInspectionChildren(usahaId, rows.map((row) => row.pemeriksaan_id));

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      findings: children.findings.get(row.pemeriksaan_id) ?? [],
      evidences: await hydrateEvidenceUrls(children.evidence.get(row.pemeriksaan_id) ?? []),
    })),
  );
}

export async function listInspectionQueue(usahaId: string, search = "") {
  let unitQuery = supabase
    .from("unit_barang")
    .select("unit_barang_id,usaha_id,kode_unit,status,barang_id,varian_barang_id,updated_at")
    .eq("usaha_id", usahaId)
    .in("status", ["inspection_pending"])
    .order("updated_at", { ascending: false })
    .limit(200);

  const term = search.trim().replace(/[*,%(),]/g, " ").replace(/\s+/g, " ").slice(0, 120);
  if (term) unitQuery = unitQuery.ilike("kode_unit", "%" + term + "%");

  const { data: unitData, error: unitError } = await unitQuery;
  if (unitError) throw unitError;

  const units = (unitData ?? []) as UnitRow[];
  if (!units.length) return [] as InspectionQueueItem[];

  const detailResult = await supabase
    .from("detail_pengembalian")
    .select(
      "detail_pengembalian_id,usaha_id,pengembalian_id,unit_barang_id,diterima_at,status_pemeriksaan,catatan,updated_at",
    )
    .eq("usaha_id", usahaId)
    .in("unit_barang_id", units.map((unit) => unit.unit_barang_id))
    .in("status_pemeriksaan", ["pending", "in_progress"])
    .order("diterima_at", { ascending: true });

  if (detailResult.error) throw detailResult.error;
  const details = (detailResult.data ?? []) as ReturnDetailRow[];

  const returnIds = Array.from(new Set(details.map((detail) => detail.pengembalian_id)));
  const { data: returnData, error: returnError } = returnIds.length
    ? await supabase
        .from("pengembalian")
        .select("pengembalian_id,usaha_id,penyewaan_id,nomor_pengembalian,status")
        .eq("usaha_id", usahaId)
        .in("pengembalian_id", returnIds)
    : { data: [], error: null };
  if (returnError) throw returnError;

  const rentalIds = Array.from(new Set(((returnData ?? []) as ReturnHeaderRow[]).map((item) => item.penyewaan_id)));
  const { data: rentalData, error: rentalError } = rentalIds.length
    ? await supabase.from("penyewaan").select("penyewaan_id,penyewa_id").eq("usaha_id", usahaId).in("penyewaan_id", rentalIds)
    : { data: [], error: null };
  if (rentalError) throw rentalError;

  const renterIds = Array.from(new Set((rentalData ?? []).map((row) => row.penyewa_id as string)));
  const { data: renterData, error: renterError } = renterIds.length
    ? await supabase.from("penyewa").select("penyewa_id,nama_lengkap").eq("usaha_id", usahaId).in("penyewa_id", renterIds)
    : { data: [], error: null };
  if (renterError) throw renterError;

  const latestMap = await getLatestInspectionsByDetail(
    usahaId,
    details.map((detail) => detail.detail_pengembalian_id),
  );
  const names = await resolveProductNames(usahaId, units);

  const unitMap = new Map(units.map((unit) => [unit.unit_barang_id, unit]));
  const returnMap = new Map(((returnData ?? []) as ReturnHeaderRow[]).map((item) => [item.pengembalian_id, item]));
  const rentalMap = new Map((rentalData ?? []).map((item) => [item.penyewaan_id as string, item.penyewa_id as string]));
  const renterMap = new Map((renterData ?? []).map((item) => [item.penyewa_id as string, item.nama_lengkap as string]));
  const latestForUnit = new Map<string, ReturnDetailRow>();

  for (const detail of details) {
    const current = latestForUnit.get(detail.unit_barang_id);
    if (!current || new Date(detail.diterima_at).getTime() > new Date(current.diterima_at).getTime()) {
      latestForUnit.set(detail.unit_barang_id, detail);
    }
  }

  return Array.from(latestForUnit.values())
    .map((detail): InspectionQueueItem | null => {
      const unit = unitMap.get(detail.unit_barang_id);
      const header = returnMap.get(detail.pengembalian_id);
      if (!unit || !header) return null;
      const renterId = rentalMap.get(header.penyewaan_id);
      const inspection = latestMap.get(detail.detail_pengembalian_id) ?? null;
      return {
        detail_pengembalian_id: detail.detail_pengembalian_id,
        pengembalian_id: header.pengembalian_id,
        nomor_pengembalian: header.nomor_pengembalian,
        unit_barang_id: unit.unit_barang_id,
        kode_unit: unit.kode_unit,
        barang_nama: names.barang.get(unit.barang_id) ?? null,
        varian_nama: unit.varian_barang_id ? names.variants.get(unit.varian_barang_id) ?? null : null,
        penyewa_nama: renterId ? renterMap.get(renterId) ?? null : null,
        diterima_at: detail.diterima_at,
        status_pemeriksaan: detail.status_pemeriksaan,
        inspection_state: deriveInspectionState(detail.status_pemeriksaan, inspection?.hasil ?? null),
        latest_pemeriksaan_id: inspection?.pemeriksaan_id ?? null,
        latest_hasil: inspection?.hasil ?? null,
        latest_keputusan_operasional: inspection?.keputusan_operasional ?? null,
        unit_updated_at: unit.updated_at,
      };
    })
    .filter(Boolean) as InspectionQueueItem[];
}

export async function getInspectionWorkspace(
  usahaId: string,
  detailPengembalianId: string,
): Promise<InspectionWorkspace> {
  const { data: detailData, error: detailError } = await supabase
    .from("detail_pengembalian")
    .select(
      "detail_pengembalian_id,usaha_id,pengembalian_id,unit_barang_id,diterima_at,status_pemeriksaan,catatan,updated_at",
    )
    .eq("usaha_id", usahaId)
    .eq("detail_pengembalian_id", detailPengembalianId)
    .maybeSingle();

  if (detailError) throw detailError;
  if (!detailData) throw new Error("Detail pengembalian tidak ditemukan.");

  const detail = detailData as ReturnDetailRow;

  const [returnResult, unitResult] = await Promise.all([
    supabase
      .from("pengembalian")
      .select("pengembalian_id,usaha_id,penyewaan_id,nomor_pengembalian,status")
      .eq("usaha_id", usahaId)
      .eq("pengembalian_id", detail.pengembalian_id)
      .maybeSingle(),
    supabase
      .from("unit_barang")
      .select("unit_barang_id,usaha_id,kode_unit,status,barang_id,varian_barang_id,updated_at")
      .eq("usaha_id", usahaId)
      .eq("unit_barang_id", detail.unit_barang_id)
      .maybeSingle(),
  ]);

  if (returnResult.error) throw returnResult.error;
  if (unitResult.error) throw unitResult.error;
  if (!returnResult.data || !unitResult.data) throw new Error("Return atau unit pemeriksaan tidak ditemukan.");

  const returnHeader = returnResult.data as ReturnHeaderRow;
  const unit = unitResult.data as UnitRow;

  const { data: rental, error: rentalError } = await supabase
    .from("penyewaan")
    .select("penyewa_id")
    .eq("usaha_id", usahaId)
    .eq("penyewaan_id", returnHeader.penyewaan_id)
    .maybeSingle();
  if (rentalError) throw rentalError;

  const renterResult = rental
    ? await supabase
        .from("penyewa")
        .select("penyewa_id,nama_lengkap,nomor_telepon")
        .eq("usaha_id", usahaId)
        .eq("penyewa_id", rental.penyewa_id)
        .maybeSingle()
    : { data: null, error: null };
  if (renterResult.error) throw renterResult.error;

  const productNames = await resolveProductNames(usahaId, [unit]);

  const { data: inspectionRows, error: inspectionError } = await supabase
    .from("pemeriksaan")
    .select(
      "pemeriksaan_id,usaha_id,detail_pengembalian_id,unit_barang_id,diperiksa_at,diperiksa_by_admin_id,hasil,kelengkapan_status,keputusan_operasional,catatan,created_at,updated_at",
    )
    .eq("usaha_id", usahaId)
    .eq("detail_pengembalian_id", detailPengembalianId)
    .order("diperiksa_at", { ascending: false });

  if (inspectionError) throw inspectionError;

  const history = await buildHistory(usahaId, (inspectionRows ?? []) as InspectionRow[]);
  const currentInspection = history[0] ?? null;

  return {
    returnDetail: detail,
    returnHeader: returnHeader,
    renter: renterResult.data
      ? {
          penyewa_id: renterResult.data.penyewa_id as string,
          nama_lengkap: renterResult.data.nama_lengkap as string,
          nomor_telepon: (renterResult.data.nomor_telepon as string | null) ?? null,
        }
      : null,
    unit: {
      unit_barang_id: unit.unit_barang_id,
      kode_unit: unit.kode_unit,
      status: unit.status,
      updated_at: unit.updated_at,
      barang_nama: productNames.barang.get(unit.barang_id) ?? null,
      varian_nama: unit.varian_barang_id ? productNames.variants.get(unit.varian_barang_id) ?? null : null,
    },
    currentInspection,
    history,
  };
}

function newRequestId() {
  return crypto.randomUUID();
}

function unknownOutcome(message: string) {
  return new Error("UNKNOWN_OUTCOME: " + message);
}

async function reconcileMutation(usahaId: string, idempotencyKey: string) {
  const { data, error } = await supabase.rpc("command_reconcile_inspection_mutation", {
    p_usaha_id: usahaId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return data as InspectionReconciliationResult | null;
}

async function reconcileOrUnknown(usahaId: string, idempotencyKey: string) {
  try {
    const result = await reconcileMutation(usahaId, idempotencyKey);
    if (result?.state === "committed" && result.response) return result;
    if (result?.state === "unknown") throw unknownOutcome("command memiliki idempotency record tanpa response.");
    return result ?? { state: "not_found", response: null };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("UNKNOWN_OUTCOME:")) throw error;
    throw unknownOutcome("hasil command belum dapat direkonsiliasi. Jangan retry mutation.");
  }
}

export async function startInspection(
  usahaId: string,
  detailPengembalianId: string,
  unitBarangId: string,
  idempotencyKey = "start-inspection-" + crypto.randomUUID(),
): Promise<StartInspectionResult> {
  const { data, error } = await supabase.rpc("command_start_inspection", {
    p_usaha_id: usahaId,
    p_detail_pengembalian_id: detailPengembalianId,
    p_unit_barang_id: unitBarangId,
    p_idempotency_key: idempotencyKey,
    p_request_id: newRequestId(),
  });

  if (!error && data) return data as StartInspectionResult;

  const reconciled = await reconcileOrUnknown(usahaId, idempotencyKey);
  if (reconciled.state === "committed" && reconciled.response) return reconciled.response as StartInspectionResult;
  if (error) throw error;
  throw unknownOutcome("server tidak mengembalikan hasil start inspection.");
}

export async function completeInspection(
  usahaId: string,
  input: InspectionCompleteInput,
  expectedInspectionUpdatedAt: string,
  expectedUnitUpdatedAt: string,
  idempotencyKey = "complete-inspection-" + crypto.randomUUID(),
): Promise<CompleteInspectionResult> {
  const findings = normalizeInspectionFindings(input.findings);
  const { data, error } = await supabase.rpc("command_complete_inspection", {
    p_usaha_id: usahaId,
    p_pemeriksaan_id: input.pemeriksaanId,
    p_hasil: input.hasil,
    p_kelengkapan_status: input.kelengkapanStatus,
    p_keputusan_operasional: input.keputusanOperasional,
    p_catatan: input.catatan?.trim() || null,
    p_findings: findings,
    p_idempotency_key: idempotencyKey,
    p_request_id: newRequestId(),
    p_expected_inspection_updated_at: expectedInspectionUpdatedAt,
    p_expected_unit_updated_at: expectedUnitUpdatedAt,
  });

  if (!error && data) return data as CompleteInspectionResult;

  const reconciled = await reconcileOrUnknown(usahaId, idempotencyKey);
  if (reconciled.state === "committed" && reconciled.response) return reconciled.response as CompleteInspectionResult;
  if (error) throw error;
  throw unknownOutcome("server tidak mengembalikan hasil complete inspection.");
}

export async function uploadAndAttachInspectionEvidence(
  usahaId: string,
  pemeriksaanId: string,
  unitBarangId: string,
  input: { file: File; jenisFoto: string; catatan?: string | null },
  idempotencyKey = "attach-evidence-" + crypto.randomUUID(),
): Promise<AttachEvidenceResult> {
  const evidenceId = crypto.randomUUID();
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "condition.jpg";
  const storagePath = usahaId + "/" + pemeriksaanId + "/" + evidenceId + "/" + safeName;

  const { error: uploadError } = await supabase.storage
    .from(CONDITION_BUCKET)
    .upload(storagePath, input.file, { upsert: false, contentType: input.file.type || "image/jpeg" });

  if (uploadError) {
    const { data: existing, error: listError } = await supabase.storage
      .from(CONDITION_BUCKET)
      .list(usahaId + "/" + pemeriksaanId + "/" + evidenceId, { limit: 10, search: safeName });
    if (!listError && existing?.some((item) => item.name === safeName)) {
      // Upload committed; continue to metadata attachment.
    } else {
      throw uploadError;
    }
  }

  const { data, error } = await supabase.rpc("command_attach_inspection_evidence", {
    p_usaha_id: usahaId,
    p_pemeriksaan_id: pemeriksaanId,
    p_bukti_foto_kondisi_id: evidenceId,
    p_unit_barang_id: unitBarangId,
    p_jenis_foto: input.jenisFoto.trim() || "overview",
    p_storage_bucket: CONDITION_BUCKET,
    p_storage_path: storagePath,
    p_catatan: input.catatan?.trim() || null,
    p_idempotency_key: idempotencyKey,
    p_request_id: newRequestId(),
  });

  if (!error && data) return data as AttachEvidenceResult;

  const reconciled = await reconcileOrUnknown(usahaId, idempotencyKey);
  if (reconciled.state === "committed" && reconciled.response) return reconciled.response as AttachEvidenceResult;
  if (error) throw error;
  throw unknownOutcome("server tidak mengembalikan hasil attach evidence.");
}

export async function reconcileInspectionCommand(
  usahaId: string,
  idempotencyKey: string,
): Promise<InspectionReconciliationResult> {
  if (!usahaId.trim() || !idempotencyKey.trim()) throw new Error("Usaha dan idempotency key wajib diisi.");
  return (await reconcileMutation(usahaId, idempotencyKey)) ?? { state: "not_found", response: null };
}

export function getInspectionCapabilities(): InspectionCapabilities {
  return {
    read: true,
    mutation: true,
    commands: [
      "start_inspection",
      "complete_inspection",
      "attach_inspection_evidence",
      "command_reconcile_inspection_mutation",
    ],
    queries: ["listInspectionQueue", "getInspectionWorkspace"],
    reason:
      "Inspection memakai trusted command: return prerequisite, tenant authorization, server timestamps, stale guards, atomic findings finalization, private evidence metadata, idempotency, advisory locking, audit, outbox, dan reconciliation. Inspection tidak mengubah unit menjadi READY.",
  };
}
