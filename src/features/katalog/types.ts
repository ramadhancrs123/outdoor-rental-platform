export type CatalogCategory = {
  kategori_barang_id: string;
  usaha_id: string;
  nama: string;
  deskripsi: string | null;
  urutan_tampilan: number | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type CatalogProduct = {
  barang_id: string;
  usaha_id: string;
  kategori_barang_id: string;
  nama: string;
  slug: string;
  deskripsi: string | null;
  ringkasan_publik: string | null;
  status: "active" | "inactive" | string;
  is_public: boolean;
  updated_at: string;
  kategori: Pick<CatalogCategory, "kategori_barang_id" | "nama" | "status"> | null;
  active_tariff: CatalogTariff | null;
  cover_url?: string | null;
  ready_count?: number;
  total_unit_count?: number;
};

export type CatalogVariant = {
  varian_barang_id: string;
  barang_id: string;
  usaha_id: string;
  nama: string;
  kode_internal: string | null;
  deskripsi: string | null;
  atribut_pembeda: Record<string, unknown> | null;
  status: string;
  updated_at: string;
};

export type CatalogTariff = {
  tarif_sewa_id: string;
  usaha_id: string;
  barang_id: string | null;
  varian_barang_id: string | null;
  paket_sewa_id: string | null;
  nama: string;
  durasi_unit: string;
  durasi_nilai: number;
  nominal: number;
  currency_code: string;
  berlaku_mulai: string;
  berlaku_sampai: string | null;
  status: string;
  updated_at: string;
};

export type CatalogMedia = {
  barang_media_id: string;
  usaha_id: string;
  barang_id: string;
  storage_bucket: string;
  storage_path: string;
  media_type: string;
  urutan: number;
  is_cover: boolean;
  status: string;
};

export type CatalogPackageReference = {
  komponen_paket_id: string;
  paket_sewa_id: string;
  jumlah: number;
  paket: {
    paket_sewa_id: string;
    nama: string;
    status: string;
    is_public: boolean;
  } | null;
};

export type CatalogProductDetail = CatalogProduct & {
  variants: CatalogVariant[];
  tariffs: CatalogTariff[];
  media: CatalogMedia[];
  package_references: CatalogPackageReference[];
};

export type CatalogListFilters = {
  search: string;
  categoryId: string;
  status: "all" | "active" | "inactive";
  visibility: "all" | "public" | "private";
  sort: "updated_desc" | "updated_asc" | "name_asc" | "name_desc";
  page: number;
  pageSize: number;
};

export const DEFAULT_CATALOG_FILTERS: CatalogListFilters = {
  search: "",
  categoryId: "all",
  status: "all",
  visibility: "all",
  sort: "updated_desc",
  page: 1,
  pageSize: 20,
};

export type CatalogPackageMedia = {
  paket_media_id: string;
  usaha_id: string;
  paket_sewa_id: string;
  storage_bucket: string;
  storage_path: string;
  media_type: string;
  urutan: number;
  is_cover: boolean;
  status: string;
};

export type CatalogPackage = {
  paket_sewa_id: string;
  usaha_id: string;
  nama: string;
  slug: string;
  deskripsi: string | null;
  harga_dasar: number | null;
  active_tariff?: CatalogTariff | null;
  currency_code: string;
  status: string;
  is_public: boolean;
  metadata: Record<string, unknown> | null;
  cover_url?: string | null;
  updated_at: string;
};

export type CatalogPackageComponent = {
  komponen_paket_id: string;
  usaha_id: string;
  paket_sewa_id: string;
  barang_id: string | null;
  varian_barang_id: string | null;
  jumlah: number;
  catatan: string | null;
  updated_at: string;
};

export type CatalogPackageComponentDetail = CatalogPackageComponent & {
  barang: { barang_id: string; nama: string; slug: string } | null;
  varian: { varian_barang_id: string; nama: string; kode_internal: string | null } | null;
};

export type CatalogVariantOption = CatalogVariant & {
  barang_nama: string;
};

export const CATALOG_PRODUCT_MEDIA_BUCKET = "rental-public-media";


export type CatalogSummary = {
  categoryCount: number;
  productCount: number;
  activeCount: number;
  inactiveCount: number;
};

export type CatalogStockSummary = {
  byProduct: Record<string, number>;
  byProductTotal: Record<string, number>;
  byVariant: Record<string, number>;
};