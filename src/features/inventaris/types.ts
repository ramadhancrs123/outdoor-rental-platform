export type InventoryLocation = {
  lokasi_id: string;
  usaha_id: string;
  nama: string;
  tipe: string;
  alamat: string | null;
  keterangan: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type CreateInventoryLocationInput = {
  nama: string;
  tipe: string;
  alamat?: string | null;
  keterangan?: string | null;
};

export type UpdateInventoryLocationInput = CreateInventoryLocationInput & {
  status: "active" | "inactive";
};

export type InventoryUnit = {
  unit_barang_id: string;
  usaha_id: string;
  barang_id: string;
  varian_barang_id: string | null;
  kode_unit: string;
  serial_number: string | null;
  lokasi_id: string | null;
  tanggal_diperoleh: string | null;
  sumber_pembelian_detail_id: string | null;
  status: string;
  kondisi_ringkas: string | null;
  catatan_internal: string | null;
  created_at: string;
  updated_at: string;
  barang: { barang_id: string; nama: string; slug: string; status: string } | null;
  varian: { varian_barang_id: string; nama: string; kode_internal: string | null; status: string } | null;
  lokasi: Pick<InventoryLocation, "lokasi_id" | "nama" | "tipe" | "status"> | null;
};

export type InventoryUnitHistory = {
  riwayat_unit_id: string;
  usaha_id: string;
  unit_barang_id: string;
  jenis_kejadian: string;
  terjadi_at: string;
  status_sebelum: string | null;
  status_sesudah: string | null;
  lokasi_sebelum_id: string | null;
  lokasi_sesudah_id: string | null;
  sumber_type: string | null;
  sumber_id: string | null;
  actor_akun_admin_id: string | null;
  catatan: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  lokasi_sebelum_nama?: string | null;
  lokasi_sesudah_nama?: string | null;
};

export type InventoryAvailabilityContext =
  | "all"
  | "ready_now"
  | "rental_active"
  | "attention";

export type InventoryListFilters = {
  search: string;
  status: "all" | string;
  barangId: string;
  varianBarangId: string;
  locationId: string;
  availabilityContext: InventoryAvailabilityContext;
  sort: "updated_desc" | "updated_asc" | "code_asc" | "status_asc";
  page: number;
  pageSize: number;
};

export const DEFAULT_INVENTORY_FILTERS: InventoryListFilters = {
  search: "",
  status: "all",
  barangId: "all",
  varianBarangId: "all",
  locationId: "all",
  availabilityContext: "all",
  sort: "updated_desc",
  page: 1,
  pageSize: 20,
};

export type InventoryContext = {
  akunAdminId: string;
  usahaId: string;
  usahaNama: string;
};

export type InventoryCatalogItem = {
  barang_id: string;
  nama: string;
  slug: string;
  status: string;
};

export type InventoryVariant = {
  varian_barang_id: string;
  barang_id: string;
  nama: string;
  kode_internal: string | null;
  status: string;
};

export type RegisterInventoryUnitInput = {
  barangId: string;
  varianBarangId?: string | null;
  kodeUnit: string;
  serialNumber?: string | null;
  lokasiId?: string | null;
  tanggalDiperoleh?: string | null;
  sumberPembelianDetailId?: string | null;
  catatanInternal?: string | null;
};

export type InventoryCommandResult = {
  unit_barang_id: string;
  usaha_id?: string;
  kode_unit?: string;
  status: string;
  lokasi_id?: string | null;
  lokasi_sebelum_id?: string | null;
  inspection_id?: string;
  detail_pengembalian_id?: string;
  state?: "changed" | "unchanged";
};

export type InventoryOperationalStatus = "damaged" | "lost" | "inactive";

export type InventoryOperationalStatusInput = {
  status: InventoryOperationalStatus;
  reason: string;
  note?: string | null;
  expectedUpdatedAt: string;
};

export type InventoryReconciliationResult = {
  state: "committed" | "not_found" | "unknown";
  response: InventoryCommandResult | null;
};

export type InventoryConditionCorrectionInput = {
  newCondition: string;
  correctionReason: string;
  correctionNote?: string | null;
  sourcePemeriksaanId?: string | null;
  expectedUpdatedAt: string;
};

export type InventoryConditionCorrectionResult = {
  unit_barang_id: string;
  status: string;
  kondisi_ringkas: string | null;
  old_kondisi_ringkas: string | null;
  new_kondisi_ringkas: string | null;
  state: "corrected" | "unchanged";
  source_pemeriksaan_id: string | null;
};

export type InventoryCandidate = {
  unit_barang_id: string;
  unit_code: string;
  status: string;
  lokasi_id: string | null;
  lokasi_nama: string | null;
  eligibility: boolean;
  conflict: boolean;
  conflict_reason: string | null;
  preferred: boolean;
};

export type InventoryOperationalContext = {
  currentAssignment: {
    penetapan_unit_id: string;
    detail_penyewaan_id: string;
    penyewaan_id: string;
    status: string;
    ditetapkan_at: string;
    dibatalkan_at: string | null;
    alasan_substitusi: string | null;
    unit_barang_id: string;
  } | null;
  activeRental: {
    penyewaan_id: string;
    nomor_penyewaan: string;
    penyewa_id: string;
    status: string;
    jadwal_mulai: string;
    jadwal_kembali: string;
    actual_pickup_at: string | null;
    actual_return_started_at: string | null;
    actual_return_completed_at: string | null;
  } | null;
  latestReturn: {
    detail_pengembalian_id: string;
    pengembalian_id: string;
    diterima_at: string;
    status_pemeriksaan: string;
    catatan: string | null;
  } | null;
  latestInspection: {
    pemeriksaan_id: string;
    detail_pengembalian_id: string;
    diperiksa_at: string;
    hasil: string;
    kelengkapan_status: string;
    keputusan_operasional: string;
    catatan: string | null;
  } | null;
  openMaintenance: Array<{
    perawatan_id: string;
    pemeriksaan_id: string | null;
    jenis_perawatan: string;
    deskripsi_pekerjaan: string;
    status: string;
    dimulai_at: string | null;
    selesai_at: string | null;
    pelaksana: string | null;
    catatan: string | null;
  }>;
  latestMaintenance: {
    perawatan_id: string;
    pemeriksaan_id: string | null;
    jenis_perawatan: string;
    deskripsi_pekerjaan: string;
    status: string;
    dimulai_at: string | null;
    selesai_at: string | null;
    pelaksana: string | null;
    catatan: string | null;
  } | null;
};

export type InspectionPendingCommandInput = {
  detailPengembalianId: string;
};

export type InventoryCandidateQuery = {
  barangId: string;
  varianBarangId?: string | null;
  startAt: string;
  endAt: string;
  preferredUnitId?: string | null;
  excludePenyewaanId?: string | null;
  limit?: number;
};

export type InventoryCommandOptions = {
  idempotencyKey?: string;
  requestId?: string;
  expectedUpdatedAt?: string;
};

export type InventoryCapabilities = {
  read: true;
  mutation: boolean;
  commands: string[];
  queries: string[];
  reason: string;
};
export type InventoryPackageComponentAvailability = {
  komponen_paket_id: string;
  barang_id: string | null;
  varian_barang_id: string | null;
  nama: string;
  required_quantity: number;
  ready_quantity: number;
  rented_quantity: number;
  maintenance_quantity: number;
  inspection_pending_quantity: number;
  blocked_quantity: number;
  shortfall_quantity: number;
};

export type InventoryPackageAvailability = {
  paket_sewa_id: string;
  nama: string;
  deskripsi: string | null;
  harga_dasar: number | null;
  currency_code: string;
  available_package_quantity: number;
  status: "available" | "insufficient";
  limiting_component_name: string | null;
  components: InventoryPackageComponentAvailability[];
};
