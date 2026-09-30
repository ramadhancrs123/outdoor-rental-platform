export type ProcurementTenantContext = {
  akunAdminId: string;
  usahaId: string;
  usahaNama: string;
};

export type SupplierListItem = {
  pemasok_id: string;
  usaha_id: string;
  nama: string;
  nomor_telepon: string | null;
  email: string | null;
  alamat: string | null;
  status: string;
  catatan: string | null;
  created_at: string;
  updated_at: string;
  purchase_count: number;
  last_purchase_at: string | null;
};

export type SupplierDetail = Omit<SupplierListItem, "purchase_count" | "last_purchase_at">;

export type PurchaseListFilters = {
  search: string;
  status: string;
  page: number;
  pageSize: number;
};

export const DEFAULT_PURCHASE_LIST_FILTERS: PurchaseListFilters = {
  search: "",
  status: "all",
  page: 1,
  pageSize: 20,
};

export type PurchaseListItem = {
  pembelian_id: string;
  usaha_id: string;
  pemasok_id: string | null;
  nomor_pembelian: string;
  tanggal_pembelian: string;
  status: string;
  total_amount: string | number;
  currency_code: string;
  catatan: string | null;
  created_at: string;
  updated_at: string;
  pemasok_nama: string | null;
  line_count: number;
};

export type PurchaseLineItem = {
  detail_pembelian_id: string;
  usaha_id: string;
  pembelian_id: string;
  barang_id: string | null;
  varian_barang_id: string | null;
  deskripsi: string | null;
  jumlah: string | number;
  unit_price: string | number;
  subtotal: string | number;
  created_at: string;
  updated_at: string;
  barang_nama: string | null;
  varian_nama: string | null;
};

export type PurchaseDetail = PurchaseListItem & {
  lines: PurchaseLineItem[];
};

export type ProcurementCapabilities = {
  read: true;
  mutation: boolean;
  reason: string;
};


export type ProcurementCommandOptions = {
  idempotencyKey?: string;
  requestId?: string;
};

export type CreateSupplierInput = {
  nama: string;
  nomorTelepon?: string | null;
  email?: string | null;
  alamat?: string | null;
  catatan?: string | null;
};

export type UpdateSupplierInput = CreateSupplierInput & {
  expectedUpdatedAt: string;
};

export type PurchaseDraftLineInput = {
  barangId?: string | null;
  varianBarangId?: string | null;
  deskripsi?: string | null;
  jumlah: string;
  unitPrice: string;
};

export type CreatePurchaseDraftInput = {
  pemasokId?: string | null;
  nomorPembelian: string;
  tanggalPembelian: string;
  lines?: PurchaseDraftLineInput[];
  catatan?: string | null;
};

export type UpdatePurchaseDraftInput = CreatePurchaseDraftInput & {
  expectedUpdatedAt: string;
};


export type PurchaseMutationResult = {
  pembelian_id: string;
  usaha_id: string;
  pemasok_id: string | null;
  nomor_pembelian: string;
  tanggal_pembelian: string;
  status: string;
  total_amount: string | number;
  currency_code: string;
  catatan: string | null;
  line_count: number;
  created_at: string;
  updated_at: string;
};

export type SupplierOption = {
  pemasok_id: string;
  nama: string;
  status: string;
};

export type PurchaseCatalogOption = {
  barang_id: string;
  nama: string;
  status: string;
};

export type PurchaseVariantOption = {
  varian_barang_id: string;
  barang_id: string;
  nama: string;
  status: string;
};

export type ProcurementMutationState =
  | "idle"
  | "review"
  | "processing"
  | "success"
  | "error"
  | "unknown"
  | "stale";


export type ProcurementReconciliation = {
  state: "not_found" | "committed" | "unknown";
  response: PurchaseMutationResult | SupplierDetail | { pemasok_id: string; usaha_id: string; status: string; updated_at: string } | null;
};
