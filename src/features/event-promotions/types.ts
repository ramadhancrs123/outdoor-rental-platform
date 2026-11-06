
export type PromotionChannel = "rental" | "sale";
export type CatalogPromotionStatus = "draft" | "active" | "ended" | "cancelled";

export type CatalogPromotion = {
  promosi_katalog_id: string;
  usaha_id: string;
  barang_id: string | null;
  varian_barang_id: string | null;
  channel: PromotionChannel;
  diskon_persen: number | string;
  is_public: boolean;
  status: CatalogPromotionStatus;
  started_at: string;
  valid_until: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  barang_nama?: string | null;
  varian_nama?: string | null;
  kategori_nama?: string | null;
  cover_url?: string | null;
  normal_price?: number | null;
  currency_code?: string | null;
  price_caption?: string | null;
};

export type CatalogPromotionTarget = {
  barang_id: string;
  varian_barang_id: string | null;
  label: string;
  channel: PromotionChannel;
  normal_price?: number | null;
  currency_code?: string;
  category_id?: string | null;
  category_name?: string | null;
  cover_url?: string | null;
  price_caption?: string | null;
  product_name?: string;
  variant_name?: string | null;
};

export type PackagePromotion = {
  promosi_paket_id: string;
  usaha_id: string;
  paket_sewa_id: string;
  tarif_sewa_id: string;
  harga_normal: number | string;
  harga_promo: number | string;
  status: string;
  started_at: string;
  valid_until: string | null;
  ended_at: string | null;
  updated_at: string;
  paket_nama?: string | null;
  tarif_nama?: string | null;
  durasi_unit?: string | null;
  durasi_nilai?: number | null;
  cover_url?: string | null;
};

export type LoyaltyProgram = {
  program_loyalitas_id: string;
  usaha_id: string;
  is_enabled: boolean;
  minimum_completed_rentals: number;
  recommended_discount_percent: number | string;
  valid_from: string;
  valid_until: string | null;
  version: number;
  updated_at: string;
};

export type CheckoutDiscountPolicy = {
  usaha_id: string;
  manual_discount_enabled: boolean;
  allow_above_loyalty: boolean;
  max_discount_percent: number | string | null;
  max_discount_amount: number | string | null;
  require_reason: boolean;
  allowed_reason_codes: string[];
  updated_at: string;
};

export type BusinessPermission =
  | "event_promotion.manage"
  | "checkout_discount.apply"
  | "checkout_discount.override"
  | "retail_bonus.apply"
  | "access_control.manage"
  | "reservation.amend";

export type MembershipPermissionRow = {
  usaha_id: string;
  akun_admin_id: string;
  permission_key: BusinessPermission;
  granted: boolean;
};

export type PromotionAdminMember = {
  akun_admin_id: string;
  nama_tampilan: string;
  role: string;
  status: string;
  permissions: Partial<Record<BusinessPermission, boolean>>;
};
