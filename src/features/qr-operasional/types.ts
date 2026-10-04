export type QrStatus = "aktif" | "dicabut";

export type QrUnitRecord = {
  qr_unit_id: string;
  usaha_id: string;
  unit_barang_id: string;
  token_qr: string;
  status_qr: QrStatus;
};

export type QrPenyewaanRecord = {
  qr_penyewaan_id: string;
  usaha_id: string;
  penyewaan_id: string;
  token_qr: string;
  status_qr: QrStatus;
};

export type QrJenis = "unit" | "penyewaan";

export type QrDestination = {
  jenis: QrJenis;
  token_qr: string;
  url: string;
};

export type UnitQrLabelData = {
  kode_unit: string;
  nama_barang: string;
  nama_varian?: string | null;
  token_qr: string;
  url: string;
};

export type RentalQrLineData = {
  nama: string;
  rincian?: string | null;
  jumlah: number;
  subtotal: number;
  currency_code: string;
};

export type RentalReceiptData = {
  usaha_nama: string;
  usaha_alamat?: string | null;
  usaha_telepon?: string | null;
  usaha_email?: string | null;
  timezone: string;
  nomor_penyewaan: string;
  penyewa_nama: string;
  penyewa_telepon?: string | null;
  jadwal_mulai: string;
  jadwal_kembali: string;
  tolerance_deadline?: string | null;
  actual_pickup_at?: string | null;
  total_amount: number;
  currency_code: string;
  token_qr: string;
  url: string;
  generated_at: string;
  lines: RentalQrLineData[];
  catatan?: string | null;
  pembayaran?: {
    tercatat: number;
    sisa: number;
    status: "belum_dibayar" | "sebagian" | "lunas";
  } | null;
};

export type UnitQrLabelOptions = {
  widthMm?: number;
  heightMm?: number;
  marginMm?: number;
  includeVariant?: boolean;
  format?: "label" | "a4";
  labelsPerPage?: number;
};

export type ThermalReceiptOptions = {
  widthMm?: number;
  marginMm?: number;
  includeQr?: boolean;
  qrSizeMm?: number;
};
