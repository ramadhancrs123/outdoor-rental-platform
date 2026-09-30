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
  | "cancel_reservation";

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

export type ReservationCapabilities = {
  read: true;
  mutation: true;
  commands: ReservationMutationCommand[];
  reason: string;
};
