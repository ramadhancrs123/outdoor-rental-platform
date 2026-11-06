
import { createClientId } from "@/lib/client-id";
import { supabase } from "@/app/providers/supabase/client";
import { getCatalogMediaUrl } from "@/features/katalog/service";
import type {
  BusinessPermission,
  CatalogPromotion,
  CatalogPromotionTarget,
  CheckoutDiscountPolicy,
  LoyaltyProgram,
  PackagePromotion,
  PromotionAdminMember,
} from "./types";

type RpcError = { message?: string; details?: string; hint?: string; code?: string } | null;

function throwRpcError(error: RpcError, fallback: string): never {
  const parts = [error?.message, error?.details, error?.hint].filter(Boolean);
  throw new Error(parts.join(" · ") || fallback);
}

async function rpc<T>(name: string, payload: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.rpc(name, payload as never);
  if (error) throwRpcError(error, fallback);
  if (data == null) throw new Error(fallback);
  return data as T;
}

function requestMeta(prefix: string) {
  return {
    p_idempotency_key: prefix + "-" + createClientId(),
    p_request_id: createClientId(),
  };
}

export async function getMyBusinessPermissions(usahaId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_my_usaha_permissions", { p_usaha_id: usahaId });
  if (error) throw error;
  return (data ?? []) as string[];
}

export type EventPromotionCheckoutReconciliation = {
  state: "committed" | "not_found" | "unknown";
  response: Record<string, unknown> | null;
};

export async function reconcileEventPromotionCheckout(
  usahaId: string,
  commandName: string,
  idempotencyKey: string,
): Promise<EventPromotionCheckoutReconciliation> {
  const { data, error } = await supabase.rpc("command_reconcile_event_promotion_checkout", {
    p_usaha_id: usahaId,
    p_command_name: commandName,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return data as EventPromotionCheckoutReconciliation;
}

export async function listCatalogPromotionTargets(usahaId: string): Promise<CatalogPromotionTarget[]> {
  const now = new Date();
  const nowIso = now.toISOString();
  const [productsResult, variantsResult] = await Promise.all([
    supabase.from("barang")
      .select("barang_id,nama,kategori_barang_id,is_rentable,is_sellable,harga_jual,status,kategori:kategori_barang!barang_kategori_tenant_fk(kategori_barang_id,nama,status)")
      .eq("usaha_id", usahaId)
      .eq("status", "active")
      .order("nama"),
    supabase.from("varian_barang")
      .select("varian_barang_id,barang_id,nama,is_rentable,is_sellable,harga_jual,status")
      .eq("usaha_id", usahaId)
      .eq("status", "active")
      .order("nama"),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (variantsResult.error) throw variantsResult.error;

  const products = productsResult.data ?? [];
  const variants = variantsResult.data ?? [];
  if (!products.length) return [];

  const productIds = products.map((row) => row.barang_id);
  const variantIds = variants.map((row) => row.varian_barang_id);
  const tariffSelect = "tarif_sewa_id,usaha_id,barang_id,varian_barang_id,paket_sewa_id,nama,durasi_unit,durasi_nilai,nominal,currency_code,berlaku_mulai,berlaku_sampai,status,updated_at";
  const [productMediaResult, variantMediaResult, tariffsResult] = await Promise.all([
    supabase.from("barang_media")
      .select("barang_id,storage_bucket,storage_path,is_cover,urutan,status")
      .eq("usaha_id", usahaId).in("barang_id", productIds).eq("status", "valid")
      .order("is_cover", { ascending: false }).order("urutan", { ascending: true }),
    variantIds.length
      ? supabase.from("varian_barang_media")
          .select("varian_barang_id,storage_bucket,storage_path,is_cover,urutan,status")
          .eq("usaha_id", usahaId).in("varian_barang_id", variantIds).eq("status", "valid")
          .order("is_cover", { ascending: false }).order("urutan", { ascending: true })
      : Promise.resolve({ data: [], error: null } as const),
    supabase.from("tarif_sewa")
      .select(tariffSelect)
      .eq("usaha_id", usahaId)
      .eq("status", "active")
      .is("paket_sewa_id", null)
      .lte("berlaku_mulai", nowIso)
      .or("berlaku_sampai.is.null,berlaku_sampai.gt." + nowIso)
      .order("berlaku_mulai", { ascending: false }),
  ]);
  for (const result of [productMediaResult, variantMediaResult, tariffsResult]) {
    if (result.error) throw result.error;
  }

  const productCover = new Map<string, string>();
  for (const row of productMediaResult.data ?? []) {
    if (!productCover.has(row.barang_id)) {
      productCover.set(row.barang_id, getCatalogMediaUrl(row.storage_bucket, row.storage_path));
    }
  }
  const variantCover = new Map<string, string>();
  for (const row of variantMediaResult.data ?? []) {
    if (!variantCover.has(row.varian_barang_id)) {
      variantCover.set(row.varian_barang_id, getCatalogMediaUrl(row.storage_bucket, row.storage_path));
    }
  }

  const variantsByProduct = new Map<string, typeof variants>();
  for (const variant of variants) {
    const rows = variantsByProduct.get(variant.barang_id) ?? [];
    rows.push(variant);
    variantsByProduct.set(variant.barang_id, rows);
  }

  type TariffRow = NonNullable<typeof tariffsResult.data>[number];
  const productTariffs = new Map<string, TariffRow[]>();
  const variantTariffs = new Map<string, TariffRow[]>();
  for (const tariff of tariffsResult.data ?? []) {
    if (tariff.varian_barang_id) {
      const rows = variantTariffs.get(tariff.varian_barang_id) ?? [];
      rows.push(tariff);
      variantTariffs.set(tariff.varian_barang_id, rows);
    } else if (tariff.barang_id) {
      const rows = productTariffs.get(tariff.barang_id) ?? [];
      rows.push(tariff);
      productTariffs.set(tariff.barang_id, rows);
    }
  }

  const byPrice = (a: TariffRow, b: TariffRow) => Number(a.nominal) - Number(b.nominal);
  const moneyCaption = (value: number, unit?: string | null, duration?: number | string | null) => {
    const amount = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
    return unit ? amount + " / " + (duration ? duration + " " : "") + unit : amount;
  };
  const targets: CatalogPromotionTarget[] = [];

  for (const product of products) {
    const category = Array.isArray(product.kategori) ? product.kategori[0] : product.kategori;
    const productVariants = variantsByProduct.get(product.barang_id) ?? [];
    const ownRentalTariffs = (productTariffs.get(product.barang_id) ?? []).sort(byPrice);
    const eligibleVariantTariffs = productVariants
      .filter((variant) => (variant.is_rentable ?? product.is_rentable) === true)
      .flatMap((variant) => variantTariffs.get(variant.varian_barang_id) ?? [])
      .sort(byPrice);
    const productRentalTariff = ownRentalTariffs[0] ?? eligibleVariantTariffs[0] ?? null;
    const salePrice = product.harga_jual == null ? null : Number(product.harga_jual);

    if (product.is_rentable && productRentalTariff) {
      targets.push({
        barang_id: product.barang_id,
        varian_barang_id: null,
        label: product.nama,
        product_name: product.nama,
        variant_name: null,
        channel: "rental",
        normal_price: Number(productRentalTariff.nominal),
        currency_code: String(productRentalTariff.currency_code ?? "IDR"),
        category_id: product.kategori_barang_id,
        category_name: category?.nama ?? "Tanpa kategori",
        cover_url: productCover.get(product.barang_id) ?? null,
        price_caption: (ownRentalTariffs.length ? "" : "Mulai dari ") +
          moneyCaption(Number(productRentalTariff.nominal), productRentalTariff.durasi_unit, productRentalTariff.durasi_nilai),
      });
    }

    if (product.is_sellable && salePrice != null && salePrice > 0) {
      targets.push({
        barang_id: product.barang_id,
        varian_barang_id: null,
        label: product.nama,
        product_name: product.nama,
        variant_name: null,
        channel: "sale",
        normal_price: salePrice,
        currency_code: "IDR",
        category_id: product.kategori_barang_id,
        category_name: category?.nama ?? "Tanpa kategori",
        cover_url: productCover.get(product.barang_id) ?? null,
        price_caption: moneyCaption(salePrice),
      });
    }

    for (const variant of productVariants) {
      const variantRentable = variant.is_rentable ?? product.is_rentable;
      const variantSellable = variant.is_sellable ?? product.is_sellable;
      const variantRentalTariff = (variantTariffs.get(variant.varian_barang_id) ?? []).sort(byPrice)[0]
        ?? ownRentalTariffs[0]
        ?? null;
      const variantSaleRaw = variant.harga_jual ?? product.harga_jual;
      const variantSalePrice = variantSaleRaw == null ? null : Number(variantSaleRaw);
      const variantImage = variantCover.get(variant.varian_barang_id) ?? productCover.get(product.barang_id) ?? null;

      if (variantRentable && variantRentalTariff) {
        targets.push({
          barang_id: product.barang_id,
          varian_barang_id: variant.varian_barang_id,
          label: product.nama + " · " + variant.nama,
          product_name: product.nama,
          variant_name: variant.nama,
          channel: "rental",
          normal_price: Number(variantRentalTariff.nominal),
          currency_code: String(variantRentalTariff.currency_code ?? "IDR"),
          category_id: product.kategori_barang_id,
          category_name: category?.nama ?? "Tanpa kategori",
          cover_url: variantImage,
          price_caption: moneyCaption(Number(variantRentalTariff.nominal), variantRentalTariff.durasi_unit, variantRentalTariff.durasi_nilai),
        });
      }

      if (variantSellable && variantSalePrice != null && variantSalePrice > 0) {
        targets.push({
          barang_id: product.barang_id,
          varian_barang_id: variant.varian_barang_id,
          label: product.nama + " · " + variant.nama,
          product_name: product.nama,
          variant_name: variant.nama,
          channel: "sale",
          normal_price: variantSalePrice,
          currency_code: "IDR",
          category_id: product.kategori_barang_id,
          category_name: category?.nama ?? "Tanpa kategori",
          cover_url: variantImage,
          price_caption: moneyCaption(variantSalePrice),
        });
      }
    }
  }

  return targets.sort((a, b) => a.label.localeCompare(b.label, "id"));
}

export async function listCatalogPromotions(usahaId: string): Promise<CatalogPromotion[]> {
  const { data, error } = await supabase.from("promosi_katalog")
    .select("promosi_katalog_id,usaha_id,barang_id,varian_barang_id,channel,diskon_persen,is_public,status,started_at,valid_until,ended_at,created_at,updated_at")
    .eq("usaha_id", usahaId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as CatalogPromotion[];
  const productIds = Array.from(new Set(rows.map((row) => row.barang_id).filter((id): id is string => Boolean(id))));
  const variantIds = Array.from(new Set(rows.map((row) => row.varian_barang_id).filter((id): id is string => Boolean(id))));
  const [products, variants, targets] = await Promise.all([
    productIds.length ? supabase.from("barang").select("barang_id,nama").eq("usaha_id", usahaId).in("barang_id", productIds) : Promise.resolve({ data: [], error: null }),
    variantIds.length ? supabase.from("varian_barang").select("varian_barang_id,nama").eq("usaha_id", usahaId).in("varian_barang_id", variantIds) : Promise.resolve({ data: [], error: null }),
    listCatalogPromotionTargets(usahaId),
  ]);
  if (products.error) throw products.error;
  if (variants.error) throw variants.error;
  const productMap = new Map((products.data ?? []).map((row) => [row.barang_id, row.nama]));
  const variantMap = new Map((variants.data ?? []).map((row) => [row.varian_barang_id, row.nama]));
  const targetMap = new Map(targets.map((target) => [
    target.barang_id + "::" + (target.varian_barang_id ?? "") + "::" + target.channel,
    target,
  ]));
  const variantTargetMap = new Map(targets
    .filter((target) => target.varian_barang_id)
    .map((target) => [target.varian_barang_id + "::" + target.channel, target]));
  return rows.map((row) => {
    const target = row.varian_barang_id
      ? variantTargetMap.get(row.varian_barang_id + "::" + row.channel)
      : targetMap.get(row.barang_id + "::" + (row.varian_barang_id ?? "") + "::" + row.channel);
    return {
      ...row,
      barang_nama: row.barang_id ? productMap.get(row.barang_id) ?? null : target?.product_name ?? null,
      varian_nama: row.varian_barang_id ? variantMap.get(row.varian_barang_id) ?? target?.variant_name ?? null : null,
      kategori_nama: target?.category_name ?? null,
      cover_url: target?.cover_url ?? null,
      normal_price: target?.normal_price ?? null,
      currency_code: target?.currency_code ?? "IDR",
      price_caption: target?.price_caption ?? null,
    };
  });
}

export async function createCatalogPromotion(input: {
  usahaId: string;
  barangId: string;
  variantId: string | null;
  channel: "rental" | "sale";
  percent: number;
  startedAt: string;
  validUntil: string | null;
  isPublic: boolean;
  status: "draft" | "active";
}) {
  return rpc("command_create_katalog_promo", {
    p_usaha_id: input.usahaId,
    p_barang_id: input.variantId ? null : input.barangId,
    p_varian_barang_id: input.variantId,
    p_channel: input.channel,
    p_diskon_persen: input.percent,
    p_started_at: input.startedAt,
    p_valid_until: input.validUntil,
    p_is_public: input.isPublic,
    p_status: input.status,
    ...requestMeta("catalog-promo-create"),
  }, "Promosi katalog gagal dibuat.");
}

export async function updateCatalogPromotionDraft(input: {
  usahaId: string;
  promotionId: string;
  barangId: string;
  variantId: string | null;
  channel: "rental" | "sale";
  percent: number;
  startedAt: string;
  validUntil: string | null;
  isPublic: boolean;
  expectedUpdatedAt: string;
}) {
  return rpc("command_update_katalog_promo_draft", {
    p_usaha_id: input.usahaId,
    p_promosi_katalog_id: input.promotionId,
    p_barang_id: input.variantId ? null : input.barangId,
    p_varian_barang_id: input.variantId,
    p_channel: input.channel,
    p_diskon_persen: input.percent,
    p_started_at: input.startedAt,
    p_valid_until: input.validUntil,
    p_is_public: input.isPublic,
    p_expected_updated_at: input.expectedUpdatedAt,
    ...requestMeta("catalog-promo-draft-update"),
  }, "Perubahan promosi gagal disimpan.");
}

export async function setCatalogPromotionStatus(input: {
  usahaId: string;
  promotionId: string;
  status: "active" | "cancelled";
  expectedUpdatedAt: string;
}) {
  return rpc("command_set_katalog_promo_status", {
    p_usaha_id: input.usahaId,
    p_promosi_katalog_id: input.promotionId,
    p_status: input.status,
    p_expected_updated_at: input.expectedUpdatedAt,
    ...requestMeta("catalog-promo-status"),
  }, "Status promosi gagal diperbarui.");
}

export async function endCatalogPromotion(input: {
  usahaId: string;
  promotionId: string;
  expectedUpdatedAt: string;
}) {
  return rpc("command_end_katalog_promo", {
    p_usaha_id: input.usahaId,
    p_promosi_katalog_id: input.promotionId,
    p_expected_updated_at: input.expectedUpdatedAt,
    ...requestMeta("catalog-promo-end"),
  }, "Promosi gagal diakhiri.");
}

export async function listPackagePromotions(usahaId: string): Promise<PackagePromotion[]> {
  const { data, error } = await supabase.from("promosi_paket_sewa")
    .select("promosi_paket_id,usaha_id,paket_sewa_id,tarif_sewa_id,harga_normal,harga_promo,status,started_at,valid_until,ended_at,updated_at")
    .eq("usaha_id", usahaId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as PackagePromotion[];
  const packageIds = Array.from(new Set(rows.map((row) => row.paket_sewa_id)));
  const tariffIds = Array.from(new Set(rows.map((row) => row.tarif_sewa_id)));
  const [packages, tariffs] = await Promise.all([
    packageIds.length ? supabase.from("paket_sewa").select("paket_sewa_id,nama").eq("usaha_id", usahaId).in("paket_sewa_id", packageIds) : Promise.resolve({ data: [], error: null }),
    tariffIds.length ? supabase.from("tarif_sewa").select("tarif_sewa_id,nama,durasi_unit,durasi_nilai").eq("usaha_id", usahaId).in("tarif_sewa_id", tariffIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (packages.error) throw packages.error;
  if (tariffs.error) throw tariffs.error;
  const packageMap = new Map((packages.data ?? []).map((row) => [row.paket_sewa_id, row.nama]));
  const tariffMap = new Map((tariffs.data ?? []).map((row) => [row.tarif_sewa_id, row]));
  return rows.map((row) => ({
    ...row,
    paket_nama: packageMap.get(row.paket_sewa_id) ?? null,
    tarif_nama: tariffMap.get(row.tarif_sewa_id)?.nama ?? null,
    durasi_unit: tariffMap.get(row.tarif_sewa_id)?.durasi_unit ?? null,
    durasi_nilai: Number(tariffMap.get(row.tarif_sewa_id)?.durasi_nilai ?? 0),
  }));
}

export async function listPackageTariffs(usahaId: string) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.from("tarif_sewa")
    .select("tarif_sewa_id,paket_sewa_id,nama,durasi_unit,durasi_nilai,nominal,currency_code,berlaku_mulai,berlaku_sampai,status")
    .eq("usaha_id", usahaId)
    .not("paket_sewa_id", "is", null)
    .eq("status", "active")
    .lte("berlaku_mulai", nowIso)
    .or("berlaku_sampai.is.null,berlaku_sampai.gt." + nowIso)
    .order("nama");
  if (error) throw error;
  const packageIds = Array.from(new Set((data ?? []).map((row) => row.paket_sewa_id).filter((id): id is string => Boolean(id))));
  if (!packageIds.length) return [];
  const [packages, media] = await Promise.all([
    supabase.from("paket_sewa").select("paket_sewa_id,nama,status").eq("usaha_id", usahaId).in("paket_sewa_id", packageIds).eq("status", "active"),
    supabase.from("paket_media").select("paket_sewa_id,storage_bucket,storage_path,is_cover,urutan,status")
      .eq("usaha_id", usahaId).in("paket_sewa_id", packageIds).eq("status", "valid")
      .order("is_cover", { ascending: false }).order("urutan", { ascending: true }),
  ]);
  if (packages.error) throw packages.error;
  if (media.error) throw media.error;
  const names = new Map((packages.data ?? []).map((row) => [row.paket_sewa_id, row.nama]));
  const covers = new Map<string, string>();
  for (const row of media.data ?? []) {
    if (!covers.has(row.paket_sewa_id)) covers.set(row.paket_sewa_id, supabase.storage.from(row.storage_bucket).getPublicUrl(row.storage_path).data.publicUrl);
  }
  return (data ?? [])
    .filter((row) => names.has(row.paket_sewa_id))
    .map((row) => ({
      ...row,
      paket_nama: names.get(row.paket_sewa_id) ?? "Paket",
      cover_url: covers.get(row.paket_sewa_id) ?? null,
    }));
}

export async function setPackagePromotionWindow(input: {
  usahaId: string;
  packageId: string;
  tariffId: string;
  enabled: boolean;
  promoPrice: number | null;
  validUntil: string | null;
  expectedUpdatedAt: string | null;
}) {
  return rpc("command_set_paket_promo_window", {
    p_usaha_id: input.usahaId,
    p_paket_sewa_id: input.packageId,
    p_tarif_sewa_id: input.tariffId,
    p_enabled: input.enabled,
    p_harga_promo: input.promoPrice,
    p_valid_until: input.validUntil,
    p_expected_updated_at: input.expectedUpdatedAt,
    ...requestMeta("package-promo-window"),
  }, "Promosi paket gagal disimpan.");
}

export async function getLoyaltyProgram(usahaId: string): Promise<LoyaltyProgram | null> {
  const { data, error } = await supabase.from("program_loyalitas")
    .select("program_loyalitas_id,usaha_id,is_enabled,minimum_completed_rentals,recommended_discount_percent,valid_from,valid_until,version,updated_at")
    .eq("usaha_id", usahaId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as LoyaltyProgram | null;
}

export async function setLoyaltyProgram(input: {
  usahaId: string;
  isEnabled: boolean;
  minimumCompletedRentals: number;
  recommendedDiscountPercent: number;
  validFrom: string;
  validUntil: string | null;
  expectedVersion: number | null;
}) {
  return rpc("command_set_loyalty_program", {
    p_usaha_id: input.usahaId,
    p_is_enabled: input.isEnabled,
    p_minimum_completed_rentals: input.minimumCompletedRentals,
    p_recommended_discount_percent: input.recommendedDiscountPercent,
    p_valid_from: input.validFrom,
    p_valid_until: input.validUntil,
    p_expected_version: input.expectedVersion,
    ...requestMeta("loyalty-program"),
  }, "Program loyalitas gagal disimpan.");
}

export async function getCheckoutDiscountPolicy(usahaId: string): Promise<CheckoutDiscountPolicy | null> {
  const { data, error } = await supabase.from("kebijakan_diskon_checkout")
    .select("usaha_id,manual_discount_enabled,allow_above_loyalty,max_discount_percent,max_discount_amount,require_reason,allowed_reason_codes,updated_at")
    .eq("usaha_id", usahaId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as CheckoutDiscountPolicy | null;
}

export async function setCheckoutDiscountPolicy(input: {
  usahaId: string;
  manualDiscountEnabled: boolean;
  allowAboveLoyalty: boolean;
  maxDiscountPercent: number | null;
  maxDiscountAmount: number | null;
  requireReason: boolean;
  allowedReasonCodes: string[];
}) {
  return rpc("command_set_checkout_discount_policy", {
    p_usaha_id: input.usahaId,
    p_manual_discount_enabled: input.manualDiscountEnabled,
    p_allow_above_loyalty: input.allowAboveLoyalty,
    p_max_discount_percent: input.maxDiscountPercent,
    p_max_discount_amount: input.maxDiscountAmount,
    p_require_reason: input.requireReason,
    p_allowed_reason_codes: input.allowedReasonCodes,
    ...requestMeta("checkout-discount-policy"),
  }, "Kebijakan diskon checkout gagal disimpan.");
}

export async function listPromotionAdminMembers(usahaId: string): Promise<PromotionAdminMember[]> {
  const { data: memberships, error: membershipError } = await supabase.from("keanggotaan_usaha")
    .select("akun_admin_id")
    .eq("usaha_id", usahaId)
    .eq("status", "active")
    .is("revoked_at", null);
  if (membershipError) throw membershipError;
  const ids = Array.from(new Set((memberships ?? []).map((row) => row.akun_admin_id)));
  if (!ids.length) return [];
  const [admins, permissions] = await Promise.all([
    supabase.from("akun_admin").select("akun_admin_id,nama_tampilan,role,status").in("akun_admin_id", ids).eq("status", "active"),
    supabase.from("keanggotaan_usaha_permission").select("usaha_id,akun_admin_id,permission_key,granted").eq("usaha_id", usahaId).in("akun_admin_id", ids),
  ]);
  if (admins.error) throw admins.error;
  if (permissions.error) throw permissions.error;
  const permissionMap = new Map<string, Partial<Record<BusinessPermission, boolean>>>();
  (permissions.data ?? []).forEach((row) => {
    const current = permissionMap.get(row.akun_admin_id) ?? {};
    current[row.permission_key as BusinessPermission] = row.granted;
    permissionMap.set(row.akun_admin_id, current);
  });
  return (admins.data ?? []).map((admin) => ({
    ...admin,
    permissions: permissionMap.get(admin.akun_admin_id) ?? {},
  })) as PromotionAdminMember[];
}

export async function setMembershipPermission(input: {
  usahaId: string;
  targetAdminId: string;
  permission: BusinessPermission;
  granted: boolean;
}) {
  return rpc("command_set_membership_permission", {
    p_usaha_id: input.usahaId,
    p_target_akun_admin_id: input.targetAdminId,
    p_permission_key: input.permission,
    p_granted: input.granted,
    ...requestMeta("membership-permission"),
  }, "Permission admin gagal diperbarui.");
}

export async function previewLoyaltyDiscount(usahaId: string, renterId: string, rentalSubtotal: number) {
  const { data, error } = await supabase.rpc("preview_loyalty_discount", {
    p_usaha_id: usahaId,
    p_penyewa_id: renterId,
    p_rental_subtotal: rentalSubtotal,
  });
  if (error) throw error;
  return data as {
    program_loyalitas_id: string | null;
    is_enabled: boolean;
    is_in_period: boolean;
    eligible: boolean;
    completed_rental_count: number;
    minimum_completed_rentals: number | null;
    recommended_discount_percent: number;
    recommended_amount: number;
    program_version: number | null;
  };
}
