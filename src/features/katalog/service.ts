import { supabase } from "@/app/providers/supabase/client";
import type { CatalogCategory, CatalogListFilters, CatalogPackageReference, CatalogProduct, CatalogProductDetail, CatalogTariff, CatalogVariant } from "./types";
import { isActiveCatalogTariff } from "./utils";

type MembershipRow = { usaha_id: string; status: string };

async function resolveCurrentUsahaId(): Promise<string> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error("Sesi admin tidak ditemukan.");
  const { data: admin, error: adminError } = await supabase.from("akun_admin").select("akun_admin_id").eq("auth_user_id", userData.user.id).eq("status", "active").maybeSingle();
  if (adminError) throw adminError;
  if (!admin) throw new Error("Akun admin aktif tidak ditemukan.");
  const { data: memberships, error: membershipError } = await supabase.from("keanggotaan_usaha").select("usaha_id,status").eq("akun_admin_id", admin.akun_admin_id).eq("status", "active");
  if (membershipError) throw membershipError;
  const rows = (memberships ?? []) as MembershipRow[];
  if (rows.length === 0) throw new Error("Akun admin belum memiliki Usaha aktif.");
  if (rows.length > 1) throw new Error("Konteks Usaha belum ditentukan. Katalog membutuhkan satu Usaha aktif sebelum data dapat ditampilkan.");
  return rows[0].usaha_id;
}

export async function getCatalogContext() {
  const usahaId = await resolveCurrentUsahaId();
  const { data: usaha, error } = await supabase.from("usaha").select("usaha_id,nama,slug").eq("usaha_id", usahaId).maybeSingle();
  if (error) throw error;
  if (!usaha) throw new Error("Usaha aktif tidak ditemukan.");
  return { usahaId, usahaName: usaha.nama as string, usahaSlug: usaha.slug as string };
}

export async function listCatalogCategories(usahaId: string): Promise<CatalogCategory[]> {
  const { data, error } = await supabase.from("kategori_barang").select("kategori_barang_id,usaha_id,nama,deskripsi,urutan_tampilan,status,created_at,updated_at").eq("usaha_id", usahaId).order("nama", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CatalogCategory[];
}

export async function listCatalogProducts(usahaId: string, filters: CatalogListFilters) {
  const start = (filters.page - 1) * filters.pageSize;
  const end = start + filters.pageSize - 1;
  let query = supabase.from("barang").select("barang_id,usaha_id,kategori_barang_id,nama,slug,deskripsi,ringkasan_publik,status,is_public,updated_at,kategori:kategori_barang(kategori_barang_id,nama,status)", { count: "exact" }).eq("usaha_id", usahaId);
  if (filters.categoryId !== "all") query = query.eq("kategori_barang_id", filters.categoryId);
  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.visibility === "public") query = query.eq("is_public", true);
  if (filters.visibility === "private") query = query.eq("is_public", false);
  if (filters.search.trim()) {
    const term = filters.search.trim().replace(/[,()]/g, " ");
    query = query.or("nama.ilike.%" + term + "%,slug.ilike.%" + term + "%");
  }
  const ascending = filters.sort === "updated_asc" || filters.sort === "name_asc";
  const column = filters.sort.startsWith("name") ? "nama" : "updated_at";
  const { data, error, count } = await query.order(column, { ascending }).range(start, end);
  if (error) throw error;
  const products = (data ?? []) as unknown as CatalogProduct[];
  const productIds = products.map((product) => product.barang_id);
  let tariffs: CatalogTariff[] = [];
  const now = new Date();
  if (productIds.length) {
    const nowIso = now.toISOString();
    const tariffResult = await supabase.from("tarif_sewa").select("tarif_sewa_id,usaha_id,barang_id,varian_barang_id,paket_sewa_id,nama,durasi_unit,durasi_nilai,nominal,currency_code,berlaku_mulai,berlaku_sampai,status").eq("usaha_id", usahaId).in("barang_id", productIds).eq("status", "active").lte("berlaku_mulai", nowIso).or("berlaku_sampai.is.null,berlaku_sampai.gt." + nowIso).order("nominal", { ascending: true });
    if (tariffResult.error) throw tariffResult.error;
    tariffs = (tariffResult.data ?? []) as CatalogTariff[];
  }
  const firstTariffByProduct = new Map<string, CatalogTariff>();
  for (const tariff of tariffs) {
    if (tariff.barang_id && isActiveCatalogTariff(tariff, now) && !firstTariffByProduct.has(tariff.barang_id)) {
      firstTariffByProduct.set(tariff.barang_id, tariff);
    }
  }
  return {
    products: products.map((product) => ({ ...product, active_tariff: firstTariffByProduct.get(product.barang_id) ?? null })),
    total: count ?? 0,
  };
}

export async function getCatalogProduct(usahaId: string, productId: string): Promise<CatalogProductDetail> {
  const productResult = await supabase.from("barang").select("barang_id,usaha_id,kategori_barang_id,nama,slug,deskripsi,ringkasan_publik,status,is_public,updated_at,kategori:kategori_barang(kategori_barang_id,nama,status)").eq("usaha_id", usahaId).eq("barang_id", productId).maybeSingle();
  if (productResult.error) throw productResult.error;
  if (!productResult.data) throw new Error("Barang tidak ditemukan dalam Usaha aktif.");
  const variantsResult = await supabase.from("varian_barang").select("varian_barang_id,barang_id,usaha_id,nama,kode_internal,deskripsi,atribut_pembeda,status").eq("usaha_id", usahaId).eq("barang_id", productId).order("nama", { ascending: true });
  if (variantsResult.error) throw variantsResult.error;
  const variants = (variantsResult.data ?? []) as CatalogVariant[];
  const variantIds = variants.map((variant) => variant.varian_barang_id);
  const tariffQuery = supabase.from("tarif_sewa").select("tarif_sewa_id,usaha_id,barang_id,varian_barang_id,paket_sewa_id,nama,durasi_unit,durasi_nilai,nominal,currency_code,berlaku_mulai,berlaku_sampai,status").eq("usaha_id", usahaId);
  if (variantIds.length) tariffQuery.or("barang_id.eq." + productId + ",varian_barang_id.in.(" + variantIds.join(",") + ")");
  else tariffQuery.eq("barang_id", productId);
  const [tariffsResult, mediaResult, packageResult] = await Promise.all([
    tariffQuery.order("berlaku_mulai", { ascending: false }),
    supabase.from("barang_media").select("barang_media_id,usaha_id,barang_id,storage_bucket,storage_path,media_type,urutan,is_cover,status").eq("usaha_id", usahaId).eq("barang_id", productId).order("urutan", { ascending: true }),
    supabase.from("komponen_paket").select("komponen_paket_id,paket_sewa_id,jumlah,paket:paket_sewa(paket_sewa_id,nama,status,is_public)").eq("usaha_id", usahaId).eq("barang_id", productId),
  ]);
  if (tariffsResult.error) throw tariffsResult.error;
  if (mediaResult.error) throw mediaResult.error;
  if (packageResult.error) throw packageResult.error;
  const tariffs = (tariffsResult.data ?? []) as CatalogTariff[];
  return {
    ...(productResult.data as unknown as CatalogProduct),
    active_tariff: tariffs.find((tariff) => (tariff.barang_id === productId || (tariff.varian_barang_id !== null && variantIds.includes(tariff.varian_barang_id))) && isActiveCatalogTariff(tariff)) ?? null,
    variants,
    tariffs,
    media: (mediaResult.data ?? []) as CatalogProductDetail["media"],
    package_references: (packageResult.data ?? []) as unknown as CatalogPackageReference[],
  };
}