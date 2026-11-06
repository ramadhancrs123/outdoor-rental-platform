import { createClientId } from "@/lib/client-id";
import { supabase } from "@/app/providers/supabase/client";
import { getCatalogMediaUrl } from "@/features/katalog/service";
import type { CreateSaleInput, MixedCheckoutCommandResult, SaleCatalogItem, SaleCommandResult, SaleListItem, SalePaymentMethod, SaleReceiptData } from "./types";
import type { CheckoutDiscountRequest } from "@/features/penyewaan/types";

type ProductRow = {
  barang_id: string;
  usaha_id: string;
  kategori_barang_id: string;
  nama: string;
  status: string;
  is_sellable: boolean;
  is_rentable: boolean;
  harga_jual: number | string | null;
  inventory_mode: "serialized" | "quantity" | "untracked";
  satuan_jual: string;
  kategori: { kategori_barang_id: string; nama: string; status: string } | null;
};
type VariantRow = {
  varian_barang_id: string;
  barang_id: string;
  usaha_id: string;
  nama: string;
  status: string;
  is_sellable: boolean | null;
  is_rentable: boolean | null;
  harga_jual: number | string | null;
  inventory_mode: "serialized" | "quantity" | "untracked" | null;
};
type StockRow = { barang_id: string; varian_barang_id: string | null; jumlah: number };
type UnitRow = { barang_id: string; varian_barang_id: string | null; status: string };
type SaleCatalogPromotionRow = {
  promosi_katalog_id: string;
  barang_id: string | null;
  varian_barang_id: string | null;
  diskon_persen: number | string;
  started_at: string;
  valid_until: string | null;
  created_at: string;
};

export async function listSaleCatalogItems(usahaId: string): Promise<SaleCatalogItem[]> {
  const [productsResult, variantsResult] = await Promise.all([
    supabase.from("barang")
      .select("barang_id,usaha_id,kategori_barang_id,nama,status,is_sellable,is_rentable,harga_jual,inventory_mode,satuan_jual,kategori:kategori_barang!barang_kategori_tenant_fk(kategori_barang_id,nama,status)")
      .eq("usaha_id",usahaId).eq("status","active").order("nama",{ascending:true}),
    supabase.from("varian_barang")
      .select("varian_barang_id,barang_id,usaha_id,nama,status,is_sellable,is_rentable,harga_jual,inventory_mode")
      .eq("usaha_id",usahaId).eq("status","active").order("nama",{ascending:true}),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (variantsResult.error) throw variantsResult.error;

  const products = (productsResult.data ?? []) as unknown as ProductRow[];
  const variants = (variantsResult.data ?? []) as unknown as VariantRow[];
  const productIds = products.map((product) => product.barang_id);
  if (!productIds.length) return [];

  const pricingAsOf = new Date().toISOString();
  const [coversResult, variantMediaResult, stockResult, unitsResult, promotionsResult] = await Promise.all([
    supabase.from("barang_media")
      .select("barang_id,storage_bucket,storage_path,is_cover,urutan,status")
      .eq("usaha_id",usahaId).in("barang_id",productIds).eq("status","valid")
      .order("is_cover",{ascending:false}).order("urutan",{ascending:true}),
    supabase.from("varian_barang_media")
      .select("varian_barang_id,storage_bucket,storage_path,is_cover,urutan,status")
      .eq("usaha_id",usahaId).in("varian_barang_id",variants.map(v=>v.varian_barang_id).filter(Boolean))
      .eq("status","valid").order("is_cover",{ascending:false}).order("urutan",{ascending:true}),
    supabase.from("stok_barang").select("barang_id,varian_barang_id,jumlah").eq("usaha_id",usahaId).in("barang_id",productIds),
    supabase.from("unit_barang").select("barang_id,varian_barang_id,status").eq("usaha_id",usahaId).in("barang_id",productIds),
    supabase.from("promosi_katalog")
      .select("promosi_katalog_id,barang_id,varian_barang_id,diskon_persen,started_at,valid_until,created_at")
      .eq("usaha_id", usahaId).eq("channel", "sale").eq("status", "active")
      .is("ended_at", null).lte("started_at", pricingAsOf)
      .order("started_at", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  for (const result of [coversResult,variantMediaResult,stockResult,unitsResult,promotionsResult]) if (result.error) throw result.error;

  const productCover = new Map<string,string>();
  for (const row of coversResult.data ?? []) {
    if (!productCover.has(row.barang_id)) productCover.set(row.barang_id,getCatalogMediaUrl(row.storage_bucket,row.storage_path));
  }
  const variantCover = new Map<string,string>();
  for (const row of variantMediaResult.data ?? []) {
    if (!variantCover.has(row.varian_barang_id)) variantCover.set(row.varian_barang_id,getCatalogMediaUrl(row.storage_bucket,row.storage_path));
  }
  const stockMap = new Map<string,number>();
  for (const row of (stockResult.data ?? []) as StockRow[]) {
    stockMap.set(row.varian_barang_id ?? row.barang_id,Number(row.jumlah));
  }
  const unitCount = new Map<string,number>();
  for (const row of (unitsResult.data ?? []) as UnitRow[]) {
    if (row.status !== "ready") continue;
    const key = row.varian_barang_id ?? row.barang_id;
    unitCount.set(key,(unitCount.get(key) ?? 0)+1);
  }

  const pricingAsOfMs = Date.parse(pricingAsOf);
  const activePromotions = ((promotionsResult.data ?? []) as SaleCatalogPromotionRow[])
    .filter((promotion) => !promotion.valid_until || pricingAsOfMs < Date.parse(promotion.valid_until));
  const productPromotion = new Map<string, SaleCatalogPromotionRow>();
  const variantPromotion = new Map<string, SaleCatalogPromotionRow>();
  for (const promotion of activePromotions) {
    if (promotion.varian_barang_id && !variantPromotion.has(promotion.varian_barang_id)) {
      variantPromotion.set(promotion.varian_barang_id, promotion);
    } else if (promotion.barang_id && !productPromotion.has(promotion.barang_id)) {
      productPromotion.set(promotion.barang_id, promotion);
    }
  }
  const promotionPrice = (normalPrice: number | null, promotion?: SaleCatalogPromotionRow) => {
    if (normalPrice == null || !promotion) {
      return { effectivePrice: normalPrice, discountPercent: null as number | null, validUntil: null as string | null };
    }
    const discountPercent = Number(promotion.diskon_persen);
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent >= 100) {
      return { effectivePrice: normalPrice, discountPercent: null, validUntil: null };
    }
    return {
      effectivePrice: Math.round(normalPrice * (100 - discountPercent)) / 100,
      discountPercent,
      validUntil: promotion.valid_until,
    };
  };

  const items: SaleCatalogItem[] = [];
  for (const product of products) {
    const productVariants = variants.filter((v)=>v.barang_id===product.barang_id);
    if (product.is_sellable) {
      const mode = product.inventory_mode;
      const key = product.barang_id;
      const normalPrice = product.harga_jual == null ? null : Number(product.harga_jual);
      const promoPrice = promotionPrice(normalPrice, productPromotion.get(product.barang_id));
      items.push({
        key, barang_id: product.barang_id, varian_barang_id: null,
        nama: product.nama, nama_barang: product.nama, nama_varian: null,
        kategori_barang_id: product.kategori_barang_id,
        kategori_nama: product.kategori?.nama ?? "Lainnya",
        harga_jual: normalPrice,
        harga_jual_efektif: promoPrice.effectivePrice,
        promo_diskon_persen: promoPrice.discountPercent,
        promo_valid_until: promoPrice.validUntil,
        inventory_mode: mode,
        available_stock: mode === "untracked" ? null : mode === "quantity" ? (stockMap.get(key) ?? 0) : (unitCount.get(key) ?? 0),
        satuan_jual: product.satuan_jual || "pcs",
        cover_url: productCover.get(product.barang_id) ?? null,
      });
    }
    for (const variant of productVariants) {
      if (!(variant.is_sellable ?? product.is_sellable)) continue;
      const mode = variant.inventory_mode ?? product.inventory_mode;
      const effectivePrice = variant.harga_jual == null ? product.harga_jual : variant.harga_jual;
      const key = variant.varian_barang_id;
      const normalPrice = effectivePrice == null ? null : Number(effectivePrice);
      const promoPrice = promotionPrice(
        normalPrice,
        variantPromotion.get(variant.varian_barang_id) ?? productPromotion.get(product.barang_id),
      );
      items.push({
        key: variant.varian_barang_id, barang_id: product.barang_id,
        varian_barang_id: variant.varian_barang_id,
        nama: product.nama + " · " + variant.nama,
        nama_barang: product.nama, nama_varian: variant.nama,
        kategori_barang_id: product.kategori_barang_id,
        kategori_nama: product.kategori?.nama ?? "Lainnya",
        harga_jual: normalPrice,
        harga_jual_efektif: promoPrice.effectivePrice,
        promo_diskon_persen: promoPrice.discountPercent,
        promo_valid_until: promoPrice.validUntil,
        inventory_mode: mode,
        available_stock: mode === "untracked" ? null : mode === "quantity" ? (stockMap.get(key) ?? 0) : (unitCount.get(key) ?? 0),
        satuan_jual: product.satuan_jual || "pcs",
        cover_url: variantCover.get(variant.varian_barang_id) ?? productCover.get(product.barang_id) ?? null,
      });
    }
  }
  return items.sort((a,b)=>a.nama.localeCompare(b.nama,"id"));
}

export async function createSale(
  usahaId: string,
  input: CreateSaleInput,
  options: { idempotencyKey?: string; requestId?: string } = {},
): Promise<SaleCommandResult> {
  if (!usahaId) throw new Error("Usaha aktif belum tersedia.");
  if (!input.lines.length) throw new Error("Keranjang penjualan masih kosong.");
  const key = options.idempotencyKey ?? "create-sale-" + createClientId();
  const requestId = options.requestId ?? createClientId();
  const rpcName = input.penyewaId ? "command_create_sale_with_renter" : "command_create_sale";
  const rpcPayload = {
    p_usaha_id:usahaId,
    ...(input.penyewaId ? { p_penyewa_id: input.penyewaId } : {}),
    p_nama_pelanggan:input.namaPelanggan?.trim() || null,
    p_nomor_telepon:input.nomorTelepon?.trim() || null,
    p_catatan:input.catatan?.trim() || null,
    p_lines:input.lines.map((line) => ({
      barang_id: line.varian_barang_id ? null : line.barang_id,
      varian_barang_id: line.varian_barang_id,
      jumlah: line.jumlah,
    })),
    p_akun_keuangan_id:input.akunKeuanganId,
    p_metode:input.metode,
    p_idempotency_key:key,
    p_request_id:requestId,
  };
  const {data,error} = await supabase.rpc(rpcName,rpcPayload);
  if (!error && data) return data as SaleCommandResult;
  const commandName = input.penyewaId ? "create_sale_with_renter" : "create_sale";
  const reconciled = await reconcileRetailCommand(usahaId,commandName,key);
  if (reconciled.state==="committed" && reconciled.response) return reconciled.response as SaleCommandResult;
  if (reconciled.state==="unknown") throw new Error("UNKNOWN_OUTCOME: hasil checkout penjualan belum dapat dipastikan. Periksa riwayat transaksi sebelum mencoba lagi.");
  if (error) throw new Error(error.message || "Checkout penjualan gagal.");
  throw new Error("Checkout penjualan tidak mengembalikan hasil.");
}


export async function createMixedCheckout(
  usahaId: string,
  input: {
    penyewaId: string;
    jadwalMulai: string;
    jadwalKembali: string;
    rentalLines: Array<{
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
    }>;
    saleLines: Array<{
      barang_id: string;
      varian_barang_id: string | null;
      jumlah: number;
      is_bonus_rental?: boolean;
      bonus_reason?: string | null;
    }>;
    akunKeuanganId: string | null;
    metode: SalePaymentMethod;
    catatan?: string|null;
  },
  options: {
    idempotencyKey?: string;
    requestId?: string;
    activateRental?: boolean;
    discountRequest?: CheckoutDiscountRequest;
  } = {},
): Promise<MixedCheckoutCommandResult> {
  if (!usahaId || !input.penyewaId) throw new Error("Data usaha dan penyewa wajib ditentukan.");
  if (!input.rentalLines.length || !input.saleLines.length) throw new Error("Checkout gabungan membutuhkan detail sewa dan pembelian.");

  // A rental detail must point to exactly one catalog target. A variant is the
  // target itself; its parent product ID is intentionally omitted from the RPC.
  const rentalLines = input.rentalLines.map((line, index) => {
    const hasPackage = Boolean(line.paket_sewa_id);
    const hasVariant = Boolean(line.varian_barang_id);
    const hasProduct = Boolean(line.barang_id);

    if ((hasPackage && (hasVariant || hasProduct)) || (!hasPackage && !hasVariant && !hasProduct)) {
      throw new Error("Detail rental ke-" + (index + 1) + " harus memiliki tepat satu target katalog.");
    }

    return {
      ...line,
      barang_id: hasPackage || hasVariant ? null : line.barang_id ?? null,
      varian_barang_id: hasVariant ? line.varian_barang_id ?? null : null,
      paket_sewa_id: hasPackage ? line.paket_sewa_id ?? null : null,
    };
  });

  const key=options.idempotencyKey ?? "create-mixed-checkout-"+createClientId();
  const activateRental = options.activateRental === true;
  const rpcName = activateRental
    ? "command_create_mixed_checkout_and_activate_with_discount"
    : "command_create_mixed_checkout_with_discount";
  const {data,error}=await supabase.rpc(rpcName,{
    p_usaha_id:usahaId,
    p_penyewa_id:input.penyewaId,
    p_jadwal_mulai:input.jadwalMulai,
    p_jadwal_kembali:input.jadwalKembali,
    p_rental_lines:rentalLines,
    p_sale_lines:input.saleLines.map((line) => ({
      barang_id: line.varian_barang_id ? null : line.barang_id,
      varian_barang_id: line.varian_barang_id,
      jumlah: line.jumlah,
      is_bonus_rental: line.is_bonus_rental === true,
      bonus_reason: line.is_bonus_rental ? line.bonus_reason?.trim() || null : null,
    })),
    p_akun_keuangan_id: input.akunKeuanganId || null,
    p_metode:input.metode,
    p_payment_rental_amount:0,
    p_dibayar_at:null,
    p_catatan:input.catatan?.trim()||null,
    p_discount_request: options.discountRequest ?? { mode: "none" },
    p_idempotency_key:key,
    p_request_id:options.requestId??createClientId(),
  });
  if (!error && data) return data as MixedCheckoutCommandResult;
  if (error) throw new Error(error.message || "Checkout gabungan gagal.");
  throw new Error("Checkout gabungan tidak mengembalikan hasil.");
}

export async function createQuickSaleProduct(
  usahaId: string,
  input: { kategoriBarangId: string; nama: string; satuanJual: string; hargaBeli: number; hargaJual: number },
  options: { idempotencyKey?: string; requestId?: string } = {},
) {
  if (!usahaId) throw new Error("Usaha aktif belum tersedia.");
  const key = options.idempotencyKey ?? "create-quick-sale-product-" + createClientId();
  const { data, error } = await supabase.rpc("command_create_quick_sale_product", {
    p_usaha_id: usahaId, p_kategori_barang_id: input.kategoriBarangId,
    p_nama: input.nama.trim(), p_satuan_jual: input.satuanJual.trim() || "pcs",
    p_harga_beli: input.hargaBeli, p_harga_jual: input.hargaJual,
    p_idempotency_key: key, p_request_id: options.requestId ?? createClientId(),
  });
  if (!error && data) return data as { barang_id: string; harga_beli: number; harga_jual: number; inventory_mode: "untracked" };
  const reconciliation = await supabase.rpc("command_reconcile_catalog_mutation", {
    p_usaha_id: usahaId, p_command_name: "create_quick_sale_product", p_idempotency_key: key,
  });
  if (!reconciliation.error && reconciliation.data?.state === "committed" && reconciliation.data.response) {
    return reconciliation.data.response as { barang_id: string; harga_beli: number; harga_jual: number; inventory_mode: "untracked" };
  }
  if (!reconciliation.error && reconciliation.data?.state === "unknown") {
    throw new Error("UNKNOWN_OUTCOME: status pembuatan produk belum dapat dipastikan. Periksa katalog sebelum mencoba lagi.");
  }
  if (error) throw new Error(error.message || "Produk gagal dibuat.");
  throw new Error("Pembuatan produk tidak mengembalikan hasil.");
}

export async function adjustSaleStock(
  usahaId: string,
  input: { barangId: string; varianBarangId?: string | null; jumlahBaru: number; alasan: string; expectedUpdatedAt?: string | null },
  options: { idempotencyKey?: string; requestId?: string } = {},
) {
  const key = options.idempotencyKey ?? "adjust-sale-stock-"+createClientId();
  const {data,error} = await supabase.rpc("command_adjust_sale_stock",{
    p_usaha_id:usahaId,
    p_barang_id:input.barangId,
    p_varian_barang_id:input.varianBarangId ?? null,
    p_jumlah_baru:input.jumlahBaru,
    p_alasan:input.alasan,
    p_expected_updated_at:input.expectedUpdatedAt ?? null,
    p_idempotency_key:key,
    p_request_id:options.requestId ?? createClientId(),
  });
  if (!error && data) return data;
  const reconciled = await reconcileRetailCommand(usahaId,"adjust_sale_stock",key);
  if (reconciled.state==="committed" && reconciled.response) return reconciled.response;
  if (reconciled.state==="unknown") throw new Error("UNKNOWN_OUTCOME: hasil perubahan stok belum dapat dipastikan.");
  if (error) throw new Error(error.message || "Penyesuaian stok gagal.");
  throw new Error("Penyesuaian stok tidak mengembalikan hasil.");
}

export async function reconcileRetailCommand(
  usahaId: string,
  commandName: "create_sale" | "create_sale_with_renter" | "create_mixed_checkout" | "create_mixed_checkout_and_activate" | "adjust_sale_stock" | "set_barang_sales_config" | "set_varian_sales_config",
  idempotencyKey: string,
) {
  const {data,error}=await supabase.rpc("command_reconcile_retail_command",{
    p_usaha_id:usahaId,p_command_name:commandName,p_idempotency_key:idempotencyKey,
  });
  if(error) throw error;
  return data as {state:"committed"|"not_found"|"unknown";response:Record<string,unknown>|null};
}

export async function listSales(usahaId: string, search = "", limit = 50): Promise<SaleListItem[]> {
  let query = supabase.from("penjualan")
    .select("penjualan_id,nomor_penjualan,source,nama_pelanggan,nomor_telepon,status,payment_status,total_amount,total_hpp,gross_profit,currency_code,created_at")
    .eq("usaha_id",usahaId).order("created_at",{ascending:false}).limit(limit);
  if (search.trim()) {
    const term=search.trim().replace(/[,()]/g," ");
    query=query.or("nomor_penjualan.ilike.%"+term+"%,nama_pelanggan.ilike.%"+term+"%,nomor_telepon.ilike.%"+term+"%");
  }
  const {data,error}=await query;
  if(error) throw error;
  return ((data ?? []) as unknown as Array<Record<string,unknown>>).map(row=>({
    ...row,total_amount:Number(row.total_amount)
  })) as unknown as SaleListItem[];
}

export async function getSaleReceiptData(usahaId: string, penjualanId: string): Promise<SaleReceiptData> {
  const [{data: sale,error: saleError},{data: lines,error: linesError},{data: payments,error: paymentsError},{data: checkout,error: checkoutError},{data: usaha,error: usahaError}] = await Promise.all([
    supabase.from("penjualan").select("penjualan_id,nomor_penjualan,nama_pelanggan,nomor_telepon,total_amount,subtotal_amount,discount_amount,total_hpp,gross_profit,currency_code,created_at,payment_status").eq("usaha_id",usahaId).eq("penjualan_id",penjualanId).maybeSingle(),
    supabase.from("detail_penjualan").select("nama_barang_snapshot,nama_varian_snapshot,jumlah,unit_price,subtotal").eq("usaha_id",usahaId).eq("penjualan_id",penjualanId).order("created_at",{ascending:true}),
    supabase.from("penjualan_pembayaran").select("amount,status").eq("usaha_id",usahaId).eq("penjualan_id",penjualanId).eq("status","recorded"),
    supabase.from("checkout").select("nomor_checkout,amount_paid,payment_status,penyewaan_id,total_amount,subtotal_rental,discount_rental_amount,manual_discount_amount,loyalty_rental_discount_amount,subtotal_penjualan,subtotal_penjualan_gross,discount_penjualan_amount").eq("usaha_id",usahaId).eq("penjualan_id",penjualanId).maybeSingle(),
    supabase.from("usaha").select("nama,alamat,nomor_telepon,email,timezone").eq("usaha_id",usahaId).maybeSingle(),
  ]);
  for (const error of [saleError,linesError,paymentsError,checkoutError,usahaError]) if(error) throw error;
  if(!sale || !usaha || !checkout) throw new Error("Data struk penjualan belum lengkap.");

  let rental: SaleReceiptData["rental"] = null;
  if (checkout.penyewaan_id) {
    const [{getRental},{getQrPenyewaanRecord},{buildPenyewaanQrUrl}]=await Promise.all([
      import("@/features/penyewaan"),
      import("@/features/qr-operasional/service"),
      import("@/features/qr-operasional/url"),
    ]);
    const [rentalDetail,qrRecord]=await Promise.all([
      getRental(usahaId,checkout.penyewaan_id as string),
      getQrPenyewaanRecord(usahaId,checkout.penyewaan_id as string),
    ]);
    if (!qrRecord || qrRecord.status_qr !== "aktif") throw new Error("QR penyewaan untuk struk checkout tidak tersedia.");
    rental={
      nomor_penyewaan:rentalDetail.nomor_penyewaan,
      nama_penyewa:rentalDetail.penyewa_nama ?? "Penyewa",
      jadwal_mulai:rentalDetail.jadwal_mulai,
      jadwal_kembali:rentalDetail.jadwal_kembali,
      subtotal:Number(checkout.subtotal_rental ?? rentalDetail.total_amount),
      token_qr:qrRecord.token_qr,
      url:buildPenyewaanQrUrl(window.location.origin,qrRecord.token_qr),
      lines:rentalDetail.lines.map(line=>({
        nama:line.paket_nama ?? line.barang_nama ?? "Barang rental",
        rincian:line.varian_nama,
        jumlah:Number(line.jumlah),
        subtotal:Number(line.subtotal),
      })),
    };
  }

  return {
    usaha_nama:usaha.nama as string,
    usaha_alamat:(usaha.alamat as string|null) ?? null,
    usaha_telepon:(usaha.nomor_telepon as string|null) ?? null,
    usaha_email:(usaha.email as string|null) ?? null,
    timezone:(usaha.timezone as string) || "Asia/Jakarta",
    nomor_checkout:checkout.nomor_checkout as string,
    nomor_penjualan:sale.nomor_penjualan as string,
    nama_pelanggan:(sale.nama_pelanggan as string|null) ?? null,
    nomor_telepon:(sale.nomor_telepon as string|null) ?? null,
    tanggal:sale.created_at as string,
    total_amount:Number(checkout.total_amount ?? sale.total_amount),
    rental_subtotal:Number(checkout.subtotal_rental ?? 0),
    rental_discount_amount:Number(checkout.discount_rental_amount ?? 0),
    manual_discount_amount:Number(checkout.manual_discount_amount ?? 0),
    loyalty_rental_discount_amount:Number(checkout.loyalty_rental_discount_amount ?? 0),
    sale_subtotal:Number(checkout.subtotal_penjualan_gross ?? checkout.subtotal_penjualan ?? sale.subtotal_amount ?? (lines ?? []).reduce((sum,row)=>sum+Number(row.subtotal),0)),
    sale_discount_amount:Number(checkout.discount_penjualan_amount ?? sale.discount_amount ?? 0),
    total_hpp:sale.total_hpp == null ? null : Number(sale.total_hpp),
    gross_profit:sale.gross_profit == null ? null : Number(sale.gross_profit),
    amount_paid:Number(checkout.amount_paid ?? (payments ?? []).reduce((sum,row)=>sum+Number(row.amount),0)),
    payment_status:String(checkout.payment_status ?? sale.payment_status),
    currency_code:sale.currency_code as string,
    lines:(lines ?? []).map(row=>({
      nama:row.nama_barang_snapshot as string,
      rincian:(row.nama_varian_snapshot as string|null) ?? null,
      jumlah:Number(row.jumlah),
      unit_price:Number(row.unit_price),
      subtotal:Number(row.subtotal),
    })),
    rental,
  };
}

export async function getSaleStockBalance(usahaId: string, barangId: string, varianBarangId: string | null = null) {
  const query=supabase.from("stok_barang")
    .select("stok_barang_id,usaha_id,barang_id,varian_barang_id,jumlah,updated_at")
    .eq("usaha_id",usahaId).eq("barang_id",barangId);
  const {data,error}=await query;
  if(error) throw error;
  const row=(data??[]).find(item=>(item.varian_barang_id??null)===varianBarangId);
  return row ? {
    stok_barang_id:row.stok_barang_id as string,
    jumlah:Number(row.jumlah),
    updated_at:row.updated_at as string,
  } : null;
}
