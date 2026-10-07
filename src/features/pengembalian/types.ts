export type ReturnTenantContext = {
  akunAdminId: string;
  usahaId: string;
  usahaNama: string;
  timezone: string;
};

export type ReturnListFilters = {
  search: string;
  page: number;
  pageSize: number;
  rentalStatus?: "all" | "active" | "return_in_progress" | "completed";
  dueState?: "all" | "not_due" | "due" | "late_within_tolerance" | "tolerance_expired";
};

export const DEFAULT_RETURN_LIST_FILTERS: ReturnListFilters = {
  search: "",
  page: 1,
  pageSize: 20,
  rentalStatus: "all",
  dueState: "all",
};

export type ReturnQueueItem = {
  penyewaan_id: string;
  nomor_penyewaan: string;
  penyewa_id: string;
  penyewa_nama: string | null;
  penyewa_telepon: string | null;
  jadwal_kembali: string;
  tolerance_deadline: string | null;
  rental_status: string;
  total_unit_count: number;
  returned_unit_count: number;
  outstanding_unit_count: number;
  return_progress: number;
  due_state: "not_due" | "due" | "late_within_tolerance" | "tolerance_expired" | "returned";
};

export type ReturnUnitRow = {
  unit_barang_id: string;
  detail_penyewaan_id: string;
  komponen_penyewaan_id: string | null;
  paket_sewa_id: string | null;
  paket_nama: string | null;
  kode_unit: string;
  barang_id: string;
  barang_nama: string | null;
  varian_barang_id: string | null;
  varian_nama: string | null;
  assignment_id: string;
  assignment_status: string;
  unit_status: string;
  returned: boolean;
  detail_pengembalian_id: string | null;
  received_at: string | null;
  inspection_status: string | null;
  latest_inspection: {
    pemeriksaan_id: string;
    hasil: string;
    kelengkapan_status: string;
    keputusan_operasional: string;
    diperiksa_at: string;
  } | null;
};

export type ReturnWorkspace = {
  rental: {
    penyewaan_id: string;
    nomor_penyewaan: string;
    status: string;
    penyewa_id: string;
    jadwal_mulai: string;
    jadwal_kembali: string;
    tolerance_deadline: string | null;
    actual_pickup_at: string | null;
    actual_return_started_at: string | null;
    actual_return_completed_at: string | null;
    updated_at: string;
  };
  renter: {
    penyewa_id: string;
    nama_lengkap: string;
    nomor_telepon: string | null;
  } | null;
  units: ReturnUnitRow[];
  returnRecords: Array<{
    pengembalian_id: string;
    nomor_pengembalian: string;
    dimulai_at: string;
    selesai_at: string | null;
    status: string;
    diproses_by_admin_id: string;
    catatan: string | null;
    detailIds: string[];
  }>;
};

export type ReturnCommandOptions = {
  idempotencyKey?: string;
  requestId?: string;
  expectedRentalUpdatedAt?: string;
};

export type ProcessUnitReturnInput = {
  rentalId: string;
  unitBarangIds: string[];
  catatan?: string | null;
};

export type ReturnCommandResult = {
  pengembalian_id: string;
  nomor_pengembalian: string;
  penyewaan_id: string;
  status: string;
  rental_status: string;
  actual_return_at: string;
  unit_barang_ids: string[];
  detail_pengembalian_ids: string[];
  returned_unit_count: number;
  expected_unit_count: number;
};

export type ReturnReconciliationResult = {
  state: "committed" | "not_found" | "unknown";
  response: ReturnCommandResult | null;
};

export type ReturnCapabilities = {
  read: true;
  mutation: true;
  commands: string[];
  queries: string[];
  reason: string;
};
