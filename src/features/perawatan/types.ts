export type MaintenanceStatus = "planned" | "in_progress" | "completed" | "cancelled";

export type MaintenanceContext = {
  akunAdminId: string;
  usahaId: string;
  usahaNama: string;
};

export type MaintenanceFinding = {
  temuan_pemeriksaan_id: string;
  jenis_temuan: string;
  deskripsi: string;
  tingkat: string | null;
  status_tindak_lanjut: string;
  nominal_potensi_biaya: number | null;
  currency_code: string;
};

export type MaintenanceRow = {
  perawatan_id: string;
  usaha_id: string;
  unit_barang_id: string;
  pemeriksaan_id: string | null;
  jenis_perawatan: string;
  deskripsi_pekerjaan: string;
  status: MaintenanceStatus;
  dimulai_at: string | null;
  selesai_at: string | null;
  biaya: number | null;
  currency_code: string;
  pelaksana: string | null;
  catatan: string | null;
  created_at: string;
  updated_at: string;
};

export type MaintenanceQueueItem = MaintenanceRow & {
  kode_unit: string;
  barang_nama: string | null;
  unit_status: string;
  pemeriksaan_hasil: string | null;
};

export type MaintenanceWorkspace = {
  maintenance: MaintenanceRow;
  unit: {
    unit_barang_id: string;
    kode_unit: string;
    status: string;
    updated_at: string;
    barang_nama: string | null;
    varian_nama: string | null;
  };
  sourceInspection: {
    pemeriksaan_id: string;
    hasil: string;
    kelengkapan_status: string;
    keputusan_operasional: string;
    diperiksa_at: string;
    catatan: string | null;
  } | null;
  findings: MaintenanceFinding[];
  history: Array<{
    riwayat_unit_id: string;
    jenis_kejadian: string;
    terjadi_at: string;
    status_sebelum: string | null;
    status_sesudah: string | null;
    catatan: string | null;
    sumber_type: string | null;
    sumber_id: string | null;
  }>;
};

export type MaintenanceUnitCandidate = {
  unit_barang_id: string;
  kode_unit: string;
  status: string;
  barang_nama: string | null;
};

export type MaintenanceInspectionCandidate = {
  pemeriksaan_id: string;
  unit_barang_id: string;
  kode_unit: string;
  barang_nama: string | null;
  varian_nama: string | null;
  hasil: string;
  kelengkapan_status: string;
  keputusan_operasional: string;
  diperiksa_at: string;
  finding_count: number;
  finding_summary: string | null;
};

export type CreateMaintenanceInput = {
  unitBarangId: string;
  pemeriksaanId: string | null;
  jenisPerawatan: string;
  deskripsiPekerjaan: string;
  pelaksana?: string | null;
  biaya?: number | null;
  currencyCode?: string;
  catatan?: string | null;
};

export type CompleteMaintenanceInput = {
  perawatanId: string;
  pelaksana?: string | null;
  biaya?: number | null;
  currencyCode?: string | null;
  catatan?: string | null;
};

export type VerifyMaintenanceReadinessInput = {
  perawatanId: string;
  verificationResult: "passed" | "failed";
  catatan?: string | null;
};

export type MaintenanceReconciliationResult = {
  state: "committed" | "not_found" | "unknown";
  command_name: string;
  response: Record<string, unknown> | null;
};

export type MaintenanceCommandResult = Record<string, unknown>;
export type MaintenanceCapabilities = {
  read: true;
  mutation: true;
  commands: string[];
  queries: string[];
  reason: string;
};
