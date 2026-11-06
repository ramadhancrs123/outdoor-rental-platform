export type ReservationTenantContext = {
  akunAdminId: string;
  usahaId: string;
  usahaNama: string;
};

export type ReservationListFilters = {
  search: string;
  status: string;
  page: number;
  pageSize: number;
};

export const DEFAULT_RESERVATION_LIST_FILTERS: ReservationListFilters = {
  search: "",
  status: "all",
  page: 1,
  pageSize: 20,
};

export type RequestListItem = {
  permintaan_sewa_id: string;
  usaha_id: string;
  penyewa_id: string;
  nomor_permintaan: string;
  sumber: string;
  mulai_rencana: string;
  selesai_rencana: string;
  status: string;
  catatan: string | null;
  submitted_at: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
  penyewa_nama: string | null;
  detail_count: number;
  reservasi_id: string | null;
  nomor_reservasi: string | null;
};

export type RequestLineItem = {
  detail_permintaan_id: string;
  usaha_id: string;
  permintaan_sewa_id: string;
  barang_id: string | null;
  varian_barang_id: string | null;
  paket_sewa_id: string | null;
  jumlah: string | number;
  catatan: string | null;
  barang_nama: string | null;
  varian_nama: string | null;
  paket_nama: string | null;
};

export type UnitPreference = {
  pilihan_unit_id: string;
  detail_permintaan_id: string;
  unit_barang_id: string;
  urutan_preferensi: number;
  status: string;
  catatan: string | null;
  kode_unit: string | null;
};

export type RequestDetail = RequestListItem & {
  lines: RequestLineItem[];
  preferences: UnitPreference[];
};

export type ReservationListItem = {
  reservasi_id: string;
  usaha_id: string;
  permintaan_sewa_id: string | null;
  penyewa_id: string;
  nomor_reservasi: string;
  mulai_reservasi: string;
  selesai_reservasi: string;
  status: string;
  stock_lock_status: string;
  confirmed_at: string | null;
  confirmed_by_admin_id: string | null;
  canceled_at: string | null;
  canceled_by_admin_id: string | null;
  cancellation_reason: string | null;
  catatan: string | null;
  created_at: string;
  updated_at: string;
  penyewa_nama: string | null;
  nomor_permintaan: string | null;
  detail_count: number;
};

export type ReservationLineItem = {
  detail_reservasi_id: string;
  usaha_id: string;
  reservasi_id: string;
  barang_id: string | null;
  varian_barang_id: string | null;
  paket_sewa_id: string | null;
  jumlah: string | number;
  unit_price: string | number | null;
  currency_code: string;
  subtotal: string | number | null;
  catatan: string | null;
  tarif_sewa_id?: string | null;
  promosi_paket_id?: string | null;
  promosi_katalog_id?: string | null;
  harga_normal_snapshot?: string | number | null;
  diskon_persen_snapshot?: string | number | null;
  nominal_diskon_snapshot?: string | number | null;
  durasi_unit_snapshot?: string | null;
  durasi_nilai_snapshot?: string | number | null;
  barang_nama: string | null;
  varian_nama: string | null;
  paket_nama: string | null;
};

export type ReservationDetail = ReservationListItem & {
  lines: ReservationLineItem[];
};

export type ReservationMutationCommand =
  | "create_reservation_from_request"
  | "confirm_reservation"
  | "cancel_reservation"
  | "amend_reservation";

export type ReservationPricingLine = {
  detail_permintaan_id: string;
  unit_price: number;
  subtotal: number;
  currency_code?: "IDR";
  catatan?: string | null;
};

export type ReservationCommandResult = {
  reservasi_id: string;
  permintaan_sewa_id?: string;
  nomor_reservasi: string;
  status: string;
  stock_lock_status: string;
  confirmed_at?: string | null;
};



export type ReservationAmendTariff = {
  tarif_sewa_id: string;
  nama: string;
  nominal: number;
  currency_code: string;
  durasi_unit: string;
  durasi_nilai: number;
  berlaku_mulai: string;
  berlaku_sampai: string | null;
};

export type ReservationAmendTarget = {
  key: string;
  barang_id: string | null;
  varian_barang_id: string | null;
  paket_sewa_id: string | null;
  label: string;
  tariffs: ReservationAmendTariff[];
};

export type ReservationAmendLineInput = {
  barang_id: string | null;
  varian_barang_id: string | null;
  paket_sewa_id: string | null;
  tarif_sewa_id: string;
  jumlah: number;
  catatan?: string | null;
  expected_unit_price?: number;
  expected_harga_normal?: number;
  expected_diskon_persen?: number;
  expected_nominal_diskon?: number;
  expected_promosi_katalog_id?: string | null;
  expected_promosi_paket_id?: string | null;
  expected_durasi_unit?: string;
  expected_durasi_nilai?: number;
  expected_currency_code?: string;
};

export type ReservationAmendPreviewLine = ReservationAmendLineInput & {
  unit_price: number;
  currency_code: string;
  subtotal: number;
  harga_normal_snapshot: number;
  diskon_persen_snapshot: number;
  nominal_diskon_snapshot: number;
  promosi_katalog_id: string | null;
  promosi_paket_id: string | null;
  durasi_unit_snapshot: string;
  durasi_nilai_snapshot: number;
};

export type ReservationAmendPreview = {
  reservasi_id: string;
  reservation_updated_at: string;
  total_before: number;
  total_after: number;
  delta: number;
  line_count: number;
  lines: ReservationAmendPreviewLine[];
  note: string;
};

export type ReservationAmendmentResult = {
  reservasi_id: string;
  status: string;
  stock_lock_status: string;
  updated_at: string;
  line_count: number;
};

export type ReservationCapabilities = {
  read: true;
  mutation: true;
  commands: ReservationMutationCommand[];
  reason: string;
};
