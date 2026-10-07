export type RentalTenantContext = {
  akunAdminId: string;
  usahaId: string;
  usahaNama: string;
  timezone: string;
  defaultToleranceHours: number;
  lateFeeEnabled: boolean;
  lateFeePerHour: number;
};

export type AssignableRentalUnit = {
  unit_barang_id: string;
  kode_unit: string;
  serial_number: string | null;
  status: string;
  barang_id: string;
  varian_barang_id: string | null;
  barang_nama: string | null;
  varian_nama: string | null;
};

export type RentalAssignmentTarget = {
  target_id: string;
  komponen_penyewaan_id: string | null;
  detail_penyewaan_id: string;
  label: string;
  required_quantity: number;
  assigned_quantity: number;
  barang_id: string | null;
  varian_barang_id: string | null;
};

export type RentalListFilters = {
  search: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  renterSearch: string;
  page: number;
  pageSize: number;
};

export const DEFAULT_RENTAL_LIST_FILTERS: RentalListFilters = {
  search: "",
  status: "all",
  dateFrom: "",
  dateTo: "",
  renterSearch: "",
  page: 1,
  pageSize: 20,
};

export type RenterRentalListItem = {
  penyewaan_id: string;
  usaha_id: string;
  nomor_penyewaan: string;
  jadwal_mulai: string;
  jadwal_kembali: string;
  status: string;
  total_amount: string | number;
  currency_code: string;
  detail_count: number;
  assignment_count: number;
};

export type RentalListLineComponent = {
  label: string;
  quantity: number;
};

export type RentalListLineSummary = {
  detail_penyewaan_id: string;
  kind: "barang" | "varian" | "paket";
  label: string;
  quantity: number;
  component_count: number;
  components: RentalListLineComponent[];
};

export type RentalListItem = {
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
  penyewa_nama: string | null;
  detail_count: number;
  assignment_count: number;
  lines: RentalListLineSummary[];
};

export type RentalDetailLine = {
  detail_penyewaan_id: string;
  usaha_id: string;
  penyewaan_id: string;
  barang_id: string | null;
  varian_barang_id: string | null;
  paket_sewa_id: string | null;
  jumlah: string | number;
  unit_price: string | number;
  currency_code: string;
  subtotal: string | number;
  catatan: string | null;
  barang_nama: string | null;
  varian_nama: string | null;
  paket_nama: string | null;
};

export type RentalAssignment = {
  penetapan_unit_id: string;
  usaha_id: string;
  detail_penyewaan_id: string;
  komponen_penyewaan_id: string | null;
  unit_barang_id: string;
  asal_pilihan_unit_id: string | null;
  status: string;
  ditetapkan_at: string;
  dibatalkan_at: string | null;
  alasan_substitusi: string | null;
  ditetapkan_by_admin_id: string;
  catatan: string | null;
  kode_unit: string | null;
};

export type RentalHandover = {
  serah_terima_id: string;
  usaha_id: string;
  penyewaan_id: string;
  serah_terima_at: string;
  actor_admin_id: string;
  status: string;
  catatan: string | null;
};

export type RentalToleranceHistory = {
  riwayat_toleransi_penyewaan_id: string;
  usaha_id: string;
  penyewaan_id: string;
  tolerance_sebelum: string;
  tolerance_sesudah: string;
  tambahan_menit: number;
  alasan: string;
  actor_akun_admin_id: string;
  actor_nama_tampilan?: string | null;
  request_id: string | null;
  occurred_at: string;
  created_at: string;
};

export type RentalPolicyInput = {
  defaultToleranceHours: number;
  lateFeeEnabled: boolean;
  lateFeePerHour: number;
};

export type RentalLateFeeAssessment = {
  enabled: boolean;
  rate_per_hour: number;
  billable_hours: number;
  amount: number;
  state: string;
  effective_return_at: string | null;
  calculated_at: string;
  tolerance_deadline: string | null;
};

export type RentalExtension = {
  perpanjangan_sewa_id: string;
  usaha_id: string;
  penyewaan_id: string;
  jadwal_kembali_sebelum: string;
  jadwal_kembali_sesudah: string;
  diminta_at: string;
  disetujui_at: string | null;
  disetujui_by_admin_id: string | null;
  status: string;
  tambahan_amount: string | number | null;
  currency_code: string;
  alasan: string | null;
};

export type RentalComponent = {
  komponen_penyewaan_id: string;
  detail_penyewaan_id: string;
  barang_id: string | null;
  varian_barang_id: string | null;
  paket_sewa_id: string | null;
  jumlah: string | number;
  catatan: string | null;
  barang_nama: string | null;
  varian_nama: string | null;
};

export type RentalDetail = Omit<RentalListItem, "lines"> & {
  penyewa_telepon: string | null;
  lines: RentalDetailLine[];
  components: RentalComponent[];
  assignments: RentalAssignment[];
  handover: RentalHandover | null;
  extensions: RentalExtension[];
};

export type RentalMutationCommand =
  | "create_direct_rental"
  | "create_rental_from_reservation"
  | "assign_rental_unit"
  | "complete_rental_handover";

export type AutoAssignRentalTarget = {
  detailPenyewaanId: string;
  komponenPenyewaanId?: string | null;
  requiredQuantity: number;
  assignedQuantity: number;
};

export type AutoAssignRentalResult = {
  state: "completed" | "partial";
  assignedCount: number;
  remainingCount: number;
  assignedUnitIds: string[];
  failedTargets: Array<{
    detailPenyewaanId: string;
    komponenPenyewaanId: string | null;
    remaining: number;
    reason: string;
  }>;
};



export type RentalCapabilities = {
  read: true;
  mutation: boolean;
  reason: string;
  commands: RentalMutationCommand[];
};


export type RentalCommandOptions = {
  idempotencyKey?: string;
  requestId?: string;
};

export type CreateRentalFromReservationInput = {
  reservasiId: string;
  jadwalMulai: string;
  jadwalKembali: string;
};

export type AssignRentalUnitInput = {
  penyewaanId: string;
  detailPenyewaanId: string;
  unitBarangId: string;
  komponenPenyewaanId?: string | null;
  asalPilihanUnitId?: string | null;
  alasanSubstitusi?: string | null;
  catatan?: string | null;
};

export type CompleteRentalHandoverInput = {
  penyewaanId: string;
  serahTerimaAt?: string | null;
  catatan?: string | null;
};


export type DirectRentalLineInput = {
  barang_id?: string | null;
  varian_barang_id?: string | null;
  paket_sewa_id?: string | null;
  tarif_sewa_id: string;
  duration_periods: number;
  jumlah: number;
  unit_price: number;
  subtotal: number;
  currency_code?: "IDR";
  catatan?: string | null;
};

export type CreateDirectRentalInput = {
  penyewa_id: string;
  jadwal_mulai: string;
  jadwal_kembali: string;
  lines: DirectRentalLineInput[];
  catatan?: string | null;
};

export type RentalCommandResult = {
  penyewaan_id?: string;
  reservasi_id?: string;
  nomor_penyewaan?: string;
  penetapan_unit_id?: string;
  detail_penyewaan_id?: string;
  unit_barang_id?: string;
  serah_terima_id?: string;
  status: string;
  jadwal_mulai?: string;
  jadwal_kembali?: string;
  tolerance_deadline?: string | null;
  total_amount?: number;
  currency_code?: string;
  actual_pickup_at?: string;
};

export type RentalReconciliationResult = {
  state: "committed" | "not_found" | "unknown";
  response: RentalCommandResult | null;
};
