export type SaleInventoryMode = "serialized" | "quantity" | "untracked";
export type SalePaymentMethod = "cash" | "bank_transfer" | "qris_manual" | "other";

export type SaleCatalogItem = {
  key: string;
  barang_id: string;
  varian_barang_id: string | null;
  nama: string;
  nama_barang: string;
  nama_varian: string | null;
  kategori_barang_id: string;
  kategori_nama: string;
  harga_jual: number | null;
  harga_jual_efektif?: number | null;
  promo_diskon_persen?: number | null;
  promo_valid_until?: string | null;
  inventory_mode: SaleInventoryMode;
  available_stock: number | null;
  satuan_jual?: string;
  cover_url: string | null;
};

export type SaleCartLine = {
  barang_id: string;
  varian_barang_id: string | null;
  nama: string;
  nama_varian: string | null;
  jumlah: number;
  unit_price: number;
  subtotal: number;
  inventory_mode: SaleInventoryMode;
  available_stock: number | null;
  satuan_jual?: string;
};

export type CreateSaleInput = {
  penyewaId?: string | null;
  namaPelanggan?: string | null;
  nomorTelepon?: string | null;
  catatan?: string | null;
  lines: Array<{ barang_id: string; varian_barang_id: string | null; jumlah: number }>;
  akunKeuanganId: string;
  metode: SalePaymentMethod;
};

export type SaleCommandResult = {
  checkout_id: string;
  nomor_checkout: string;
  penjualan_id: string;
  nomor_penjualan: string;
  total_amount: number;
  total_hpp: number | null;
  gross_profit: number | null;
  amount_paid: number;
  payment_status: "unpaid" | "partial" | "paid";
  penjualan_pembayaran_id: string;
  transaksi_keuangan_id: string;
  status: "completed";
};

export type MixedCheckoutCommandResult = SaleCommandResult & {
  penyewaan_id: string;
  nomor_penyewaan: string;
  subtotal_rental: number;
  subtotal_penjualan: number;
};


export type SaleListItem = {
  penjualan_id: string;
  nomor_penjualan: string;
  source: "pos" | "mixed";
  nama_pelanggan: string | null;
  nomor_telepon: string | null;
  status: string;
  payment_status: string;
  total_amount: number;
  total_hpp: number | null;
  gross_profit: number | null;
  currency_code: string;
  created_at: string;
};

export type SaleReceiptData = {
  usaha_nama: string;
  usaha_alamat: string | null;
  usaha_telepon: string | null;
  usaha_email: string | null;
  timezone: string;
  nomor_checkout: string;
  nomor_penjualan: string;
  nama_pelanggan: string | null;
  nomor_telepon: string | null;
  tanggal: string;
  total_amount: number;
  rental_subtotal: number;
  rental_discount_amount: number;
  manual_discount_amount: number;
  loyalty_rental_discount_amount: number;
  sale_subtotal: number;
  sale_discount_amount: number;
  total_hpp: number | null;
  gross_profit: number | null;
  amount_paid: number;
  payment_status: string;
  currency_code: string;
  lines: Array<{
    nama: string;
    rincian: string | null;
    jumlah: number;
    unit_price: number;
    subtotal: number;
  }>;
  rental?: {
    nomor_penyewaan: string;
    nama_penyewa: string;
    jadwal_mulai: string;
    jadwal_kembali: string;
    subtotal: number;
    token_qr: string;
    url: string;
    lines: Array<{ nama: string; rincian: string | null; jumlah: number; subtotal: number }>;
  } | null;
};
