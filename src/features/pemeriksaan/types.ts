export type InspectionTenantContext = {
  akunAdminId: string;
  usahaId: string;
  usahaNama: string;
  timezone: string;
};

export type InspectionQueueItem = {
  detail_pengembalian_id: string;
  pengembalian_id: string;
  nomor_pengembalian: string;
  unit_barang_id: string;
  kode_unit: string;
  barang_nama: string | null;
  varian_nama: string | null;
  penyewa_nama: string | null;
  diterima_at: string;
  status_pemeriksaan: string;
  inspection_state: "waiting" | "in_progress" | "completed";
  latest_pemeriksaan_id: string | null;
  latest_hasil: string | null;
  latest_keputusan_operasional: string | null;
  unit_updated_at: string;
};

export type InspectionFindingInput = {
  jenis_temuan: "damage" | "loss" | "missing_component" | "dirty" | "other";
  deskripsi: string;
  tingkat?: string | null;
  status_tindak_lanjut?: string | null;
  nominal_potensi_biaya?: number | null;
  currency_code?: string | null;
};

export type InspectionFinding = InspectionFindingInput & {
  temuan_pemeriksaan_id: string;
  usaha_id: string;
  pemeriksaan_id: string;
  created_at: string;
  updated_at: string;
};

export type InspectionEvidence = {
  bukti_foto_kondisi_id: string;
  usaha_id: string;
  pemeriksaan_id: string;
  unit_barang_id: string;
  jenis_foto: string;
  storage_bucket: string;
  storage_path: string;
  captured_at: string;
  captured_by_admin_id: string;
  catatan: string | null;
  created_at: string;
  signed_url?: string;
};

export type InspectionHistoryItem = {
  pemeriksaan_id: string;
  detail_pengembalian_id: string;
  unit_barang_id: string;
  diperiksa_at: string;
  diperiksa_by_admin_id: string;
  hasil: string;
  kelengkapan_status: string;
  keputusan_operasional: string;
  catatan: string | null;
  updated_at: string;
  findings: InspectionFinding[];
  evidences: InspectionEvidence[];
};

export type InspectionLinkedMaintenance = {
  perawatan_id: string;
  pemeriksaan_id: string;
  jenis_perawatan: string;
  status: string;
  deskripsi_pekerjaan: string;
  updated_at: string;
};

export type InspectionWorkspace = {
  returnDetail: {
    detail_pengembalian_id: string;
    pengembalian_id: string;
    unit_barang_id: string;
    diterima_at: string;
    status_pemeriksaan: string;
    catatan: string | null;
    updated_at: string;
  };
  returnHeader: {
    pengembalian_id: string;
    nomor_pengembalian: string;
    penyewaan_id: string;
    status: string;
  };
  renter: {
    penyewa_id: string;
    nama_lengkap: string;
    nomor_telepon: string | null;
  } | null;
  unit: {
    unit_barang_id: string;
    kode_unit: string;
    status: string;
    updated_at: string;
    barang_nama: string | null;
    varian_nama: string | null;
  };
  currentInspection: InspectionHistoryItem | null;
  linkedMaintenance: InspectionLinkedMaintenance | null;
  history: InspectionHistoryItem[];
};

export type StartInspectionResult = {
  pemeriksaan_id: string;
  detail_pengembalian_id: string;
  unit_barang_id: string;
  state: "in_progress";
  reused_draft: boolean;
};

export type CompleteInspectionResult = {
  pemeriksaan_id: string;
  detail_pengembalian_id: string;
  unit_barang_id: string;
  state: "completed";
  hasil: string;
  kelengkapan_status: string;
  keputusan_operasional: string;
  finding_ids: string[];
  finding_count: number;
  reinspection: boolean;
  reinspection_source_id: string | null;
};

export type AttachEvidenceResult = {
  bukti_foto_kondisi_id: string;
  pemeriksaan_id: string;
  unit_barang_id: string;
  storage_bucket: string;
  storage_path: string;
  state: "attached";
};

export type InspectionReconciliationResult = {
  state: "committed" | "not_found" | "unknown";
  response: StartInspectionResult | CompleteInspectionResult | AttachEvidenceResult | null;
  command_name?: string;
};

export type InspectionCapabilities = {
  read: true;
  mutation: true;
  commands: string[];
  queries: string[];
  reason: string;
};

export type InspectionCompleteInput = {
  pemeriksaanId: string;
  hasil: "normal" | "issue_found";
  kelengkapanStatus: "complete" | "incomplete" | "unknown";
  keputusanOperasional:
    | "ready_review"
    | "cleaning_required"
    | "maintenance_required"
    | "unavailable"
    | "follow_up_required"
    | "no_action"
    | "readiness_review";
  catatan?: string | null;
  findings: InspectionFindingInput[];
};
