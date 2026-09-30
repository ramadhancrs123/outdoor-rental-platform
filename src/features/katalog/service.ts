import { supabase } from "@/app/providers/supabase/client";
import type { CatalogCategory, CatalogListFilters, CatalogPackageReference, CatalogProduct, CatalogProductDetail, CatalogTariff, CatalogVariant, CatalogVariantOption } from "./types";
import { CATALOG_PRODUCT_MEDIA_BUCKET } from "./types";
import { isActiveCatalogTariff } from "./utils";

type MembershipRow = { usaha_id: string; status: string };

async function resolveCurrentUsahaId(): Promise<string> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.user) throw new Error("Sesi admin tidak ditemukan.");
  const { data: admin, error: adminError } = await supabase.from("akun_admin").select("akun_admin_id").eq("auth_user_id", session.user.id).eq("status", "active").maybeSingle();
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

export async function listCatalogVariants(usahaId: string): Promise<CatalogVariantOption[]> {
  const { data, error } = await supabase
    .from("varian_barang")
    .select("varian_barang_id,barang_id,usaha_id,nama,kode_internal,deskripsi,atribut_pembeda,status,barang:barang(barang_id,nama)")
    .eq("usaha_id", usahaId)
    .order("nama", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown as Array<CatalogVariant & { barang?: { nama?: string | null } | null }>).map((variant) => ({
    varian_barang_id: variant.varian_barang_id,
    barang_id: variant.barang_id,
    usaha_id: variant.usaha_id,
    nama: variant.nama,
    kode_internal: variant.kode_internal,
    deskripsi: variant.deskripsi,
    atribut_pembeda: variant.atribut_pembeda,
    status: variant.status,
    barang_nama: variant.barang?.nama ?? "Barang",
  }));
}

export function getCatalogMediaUrl(storageBucket: string, storagePath: string) {
  return supabase.storage.from(storageBucket).getPublicUrl(storagePath).data.publicUrl;
}

export async function uploadCatalogMediaFile(
  usahaId: string,
  barangId: string,
  file: File,
  options: { isCover?: boolean; urutan?: number; idempotencyKey?: string } = {},
) {
  if (!file.type.startsWith("image/")) throw new Error("Media katalog harus berupa gambar.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Ukuran gambar maksimal 8 MB.");

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "product-image";
  const mediaId = crypto.randomUUID();
  const storagePath = usahaId + "/" + barangId + "/" + mediaId + "/" + safeName;

  const { error: uploadError } = await supabase.storage
    .from(CATALOG_PRODUCT_MEDIA_BUCKET)
    .upload(storagePath, file, { upsert: false, contentType: file.type });

  if (uploadError) throw uploadError;

  try {
    return await addCatalogMedia(
      usahaId,
      {
        barangId,
        storageBucket: CATALOG_PRODUCT_MEDIA_BUCKET,
        storagePath,
        mediaType: file.type,
        urutan: options.urutan ?? 1,
        isCover: options.isCover ?? false,
      },
      { idempotencyKey: options.idempotencyKey },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("UNKNOWN_OUTCOME:")) throw new Error(message);
    throw new Error(
      "Upload berhasil tetapi pencatatan media belum dapat dipastikan. Jangan upload ulang file yang sama sebelum memeriksa state. " +
      message,
    );
  }
}

export async function listCatalogProducts(usahaId: string, filters: CatalogListFilters) {
  const start = (filters.page - 1) * filters.pageSize;
  const end = start + filters.pageSize - 1;
  let query = supabase.from("barang").select("barang_id,usaha_id,kategori_barang_id,nama,slug,deskripsi,ringkasan_publik,status,is_public,updated_at,kategori:kategori_barang!barang_kategori_tenant_fk(kategori_barang_id,nama,status)", { count: "exact" }).eq("usaha_id", usahaId);
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
  const productResult = await supabase.from("barang").select("barang_id,usaha_id,kategori_barang_id,nama,slug,deskripsi,ringkasan_publik,status,is_public,updated_at,kategori:kategori_barang!barang_kategori_tenant_fk(kategori_barang_id,nama,status)").eq("usaha_id", usahaId).eq("barang_id", productId).maybeSingle();
  if (productResult.error) throw productResult.error;
  if (!productResult.data) throw new Error("Barang tidak ditemukan dalam Usaha aktif.");
  const variantsResult = await supabase.from("varian_barang").select("varian_barang_id,barang_id,usaha_id,nama,kode_internal,deskripsi,atribut_pembeda,status").eq("usaha_id", usahaId).eq("barang_id", productId).order("nama", { ascending: true });
  if (variantsResult.error) throw variantsResult.error;
  const variants = (variantsResult.data ?? []) as CatalogVariant[];
  const variantIds = variants.map((variant) => variant.varian_barang_id);
  const tariffSelect = "tarif_sewa_id,usaha_id,barang_id,varian_barang_id,paket_sewa_id,nama,durasi_unit,durasi_nilai,nominal,currency_code,berlaku_mulai,berlaku_sampai,status";
  const productTariffQuery = supabase.from("tarif_sewa").select(tariffSelect).eq("usaha_id", usahaId).eq("barang_id", productId).order("berlaku_mulai", { ascending: false });
  const variantTariffQuery = variantIds.length
    ? supabase.from("tarif_sewa").select(tariffSelect).eq("usaha_id", usahaId).in("varian_barang_id", variantIds).order("berlaku_mulai", { ascending: false })
    : Promise.resolve({ data: [], error: null } as const);

  const [productTariffsResult, variantTariffsResult, mediaResult, packageResult] = await Promise.all([
    productTariffQuery,
    variantTariffQuery,
    supabase.from("barang_media").select("barang_media_id,usaha_id,barang_id,storage_bucket,storage_path,media_type,urutan,is_cover,status").eq("usaha_id", usahaId).eq("barang_id", productId).order("urutan", { ascending: true }),
    supabase.from("komponen_paket").select("komponen_paket_id,paket_sewa_id,jumlah,paket:paket_sewa!komponen_paket_paket_sewa_id_fkey(paket_sewa_id,nama,status,is_public)").eq("usaha_id", usahaId).eq("barang_id", productId),
  ]);
  if (productTariffsResult.error) throw productTariffsResult.error;
  if (variantTariffsResult.error) throw variantTariffsResult.error;
  if (mediaResult.error) throw mediaResult.error;
  if (packageResult.error) throw packageResult.error;
  const tariffs = [
    ...((productTariffsResult.data ?? []) as CatalogTariff[]),
    ...((variantTariffsResult.data ?? []) as CatalogTariff[]),
  ].sort((a, b) => b.berlaku_mulai.localeCompare(a.berlaku_mulai));
  return {
    ...(productResult.data as unknown as CatalogProduct),
    active_tariff: tariffs.find((tariff) => (tariff.barang_id === productId || (tariff.varian_barang_id !== null && variantIds.includes(tariff.varian_barang_id))) && isActiveCatalogTariff(tariff)) ?? null,
    variants,
    tariffs,
    media: (mediaResult.data ?? []) as CatalogProductDetail["media"],
    package_references: (packageResult.data ?? []) as unknown as CatalogPackageReference[],
  };
}


export type CatalogCommandOptions = {
  idempotencyKey?: string;
  requestId?: string;
};

export type CatalogCommandResponse = Record<string, unknown>;

export type CreateCatalogCategoryInput = {
  nama: string;
  deskripsi?: string | null;
  status?: "active" | "inactive";
};

export type UpdateCatalogCategoryInput = CreateCatalogCategoryInput & {
  expectedUpdatedAt?: string;
};

export type CreateCatalogProductInput = {
  kategoriBarangId: string;
  nama: string;
  slug: string;
  deskripsi?: string | null;
  ringkasanPublik?: string | null;
  status?: "active" | "inactive";
  isPublic?: boolean;
  metadata?: Record<string, unknown> | null;
};

export type UpdateCatalogProductInput = CreateCatalogProductInput & {
  expectedUpdatedAt?: string;
};

export type CreateCatalogVariantInput = {
  barangId: string;
  nama: string;
  kodeInternal?: string | null;
  deskripsi?: string | null;
  atributPembeda?: Record<string, unknown> | null;
  status?: "active" | "inactive";
};

export type UpdateCatalogVariantInput = Omit<CreateCatalogVariantInput, "barangId"> & {
  expectedUpdatedAt?: string;
};

export type CreateCatalogPackageInput = {
  nama: string;
  slug: string;
  deskripsi?: string | null;
  hargaDasar?: number | null;
  currencyCode?: string;
  status?: "draft" | "active" | "inactive";
  isPublic?: boolean;
  metadata?: Record<string, unknown> | null;
};

export type UpdateCatalogPackageInput = CreateCatalogPackageInput & {
  expectedUpdatedAt?: string;
};

export type AddCatalogPackageComponentInput = {
  paketSewaId: string;
  barangId?: string | null;
  varianBarangId?: string | null;
  jumlah: number;
  catatan?: string | null;
};

export type CreateCatalogTariffInput = {
  barangId?: string | null;
  varianBarangId?: string | null;
  paketSewaId?: string | null;
  nama: string;
  durasiUnit: string;
  durasiNilai: number;
  nominal: number;
  currencyCode?: string;
  berlakuMulai?: string;
  berlakuSampai?: string | null;
  status?: "active" | "inactive";
  metadata?: Record<string, unknown> | null;
};

export type UpdateCatalogTariffInput = {
  tarifSewaId: string;
  nama: string;
  durasiUnit: string;
  durasiNilai: number;
  nominal: number;
  berlakuMulai: string;
  berlakuSampai?: string | null;
  metadata?: Record<string, unknown> | null;
  expectedUpdatedAt?: string;
};

export type AddCatalogMediaInput = {
  barangId: string;
  storageBucket: string;
  storagePath: string;
  mediaType?: string;
  urutan?: number;
  isCover?: boolean;
};

function catalogCommandError(label: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${label}: ${message}`);
}

async function executeCatalogCommand<T extends CatalogCommandResponse>(
  usahaId: string,
  commandName: string,
  rpcName: string,
  args: Record<string, unknown>,
  label: string,
  idempotencyKey: string,
): Promise<T> {
  const { data, error } = await supabase.rpc(rpcName, args);
  if (!error && data) return data as T;

  const reconciliation = await supabase.rpc("command_reconcile_catalog_mutation", {
    p_usaha_id: usahaId,
    p_command_name: commandName,
    p_idempotency_key: idempotencyKey,
  });

  if (!reconciliation.error && reconciliation.data?.state === "committed" && reconciliation.data.response) {
    return reconciliation.data.response as T;
  }

  if (!reconciliation.error && reconciliation.data?.state === "unknown") {
    throw new Error(
      `UNKNOWN_OUTCOME: hasil ${label.toLowerCase()} belum dapat dipastikan. Periksa status sebelum mencoba kembali.`,
    );
  }

  if (error) throw catalogCommandError(label, error);
  throw new Error(`${label}: server tidak mengembalikan hasil command.`);
}

function commandKey(prefix: string, options: CatalogCommandOptions) {
  return options.idempotencyKey ?? `${prefix}-${crypto.randomUUID()}`;
}

export async function createCatalogCategory(
  usahaId: string,
  input: CreateCatalogCategoryInput,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("create-katalog-category", options);
  return executeCatalogCommand(
    usahaId,
    "create_kategori_barang",
    "command_create_kategori_barang",
    {
      p_usaha_id: usahaId,
      p_nama: input.nama.trim(),
      p_deskripsi: input.deskripsi?.trim() || null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Pembuatan kategori",
    idempotencyKey,
  );
}
export async function updateCatalogCategory(
  usahaId: string,
  kategoriBarangId: string,
  input: UpdateCatalogCategoryInput,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("update-katalog-category", options);
  return executeCatalogCommand(
    usahaId,
    "update_kategori_barang",
    "command_update_kategori_barang",
    {
      p_usaha_id: usahaId,
      p_kategori_barang_id: kategoriBarangId,
      p_nama: input.nama.trim(),
      p_deskripsi: input.deskripsi?.trim() || null,
      p_status: input.status ?? "active",
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Pembaruan kategori",
    idempotencyKey,
  );
}

export async function createCatalogProduct(
  usahaId: string,
  input: CreateCatalogProductInput,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("create-katalog-product", options);
  return executeCatalogCommand(
    usahaId,
    "create_barang",
    "command_create_barang",
    {
      p_usaha_id: usahaId,
      p_kategori_barang_id: input.kategoriBarangId,
      p_nama: input.nama.trim(),
      p_slug: input.slug.trim().toLowerCase(),
      p_deskripsi: input.deskripsi?.trim() || null,
      p_ringkasan_publik: input.ringkasanPublik?.trim() || null,
      p_status: input.status ?? "active",
      p_is_public: input.isPublic ?? false,
      p_metadata: input.metadata ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Pembuatan barang",
    idempotencyKey,
  );
}

export async function updateCatalogProduct(
  usahaId: string,
  barangId: string,
  input: UpdateCatalogProductInput,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("update-katalog-product", options);
  return executeCatalogCommand(
    usahaId,
    "update_barang",
    "command_update_barang",
    {
      p_usaha_id: usahaId,
      p_barang_id: barangId,
      p_kategori_barang_id: input.kategoriBarangId,
      p_nama: input.nama.trim(),
      p_slug: input.slug.trim().toLowerCase(),
      p_deskripsi: input.deskripsi?.trim() || null,
      p_ringkasan_publik: input.ringkasanPublik?.trim() || null,
      p_metadata: input.metadata ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Pembaruan barang",
    idempotencyKey,
  );
}

export async function setCatalogProductVisibility(
  usahaId: string,
  barangId: string,
  isPublic: boolean,
  expectedUpdatedAt?: string,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("set-katalog-product-visibility", options);
  return executeCatalogCommand(
    usahaId,
    "set_barang_visibility",
    "command_set_barang_visibility",
    {
      p_usaha_id: usahaId,
      p_barang_id: barangId,
      p_is_public: isPublic,
      p_expected_updated_at: expectedUpdatedAt ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    isPublic ? "Publikasi barang" : "Menyembunyikan barang",
    idempotencyKey,
  );
}

export async function setCatalogProductStatus(
  usahaId: string,
  barangId: string,
  status: "active" | "inactive",
  expectedUpdatedAt?: string,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("set-katalog-product-status", options);
  return executeCatalogCommand(
    usahaId,
    "set_barang_status",
    "command_set_barang_status",
    {
      p_usaha_id: usahaId,
      p_barang_id: barangId,
      p_status: status,
      p_expected_updated_at: expectedUpdatedAt ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Perubahan status barang",
    idempotencyKey,
  );
}

export async function createCatalogVariant(
  usahaId: string,
  input: CreateCatalogVariantInput,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("create-katalog-variant", options);
  return executeCatalogCommand(
    usahaId,
    "create_varian_barang",
    "command_create_varian_barang",
    {
      p_usaha_id: usahaId,
      p_barang_id: input.barangId,
      p_nama: input.nama.trim(),
      p_kode_internal: input.kodeInternal?.trim() || null,
      p_deskripsi: input.deskripsi?.trim() || null,
      p_atribut_pembeda: input.atributPembeda ?? null,
      p_status: input.status ?? "active",
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Pembuatan varian",
    idempotencyKey,
  );
}

export async function updateCatalogVariant(
  usahaId: string,
  varianBarangId: string,
  input: UpdateCatalogVariantInput,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("update-katalog-variant", options);
  return executeCatalogCommand(
    usahaId,
    "update_varian_barang",
    "command_update_varian_barang",
    {
      p_usaha_id: usahaId,
      p_varian_barang_id: varianBarangId,
      p_nama: input.nama.trim(),
      p_kode_internal: input.kodeInternal?.trim() || null,
      p_deskripsi: input.deskripsi?.trim() || null,
      p_atribut_pembeda: input.atributPembeda ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Pembaruan varian",
    idempotencyKey,
  );
}

export async function setCatalogVariantStatus(
  usahaId: string,
  varianBarangId: string,
  status: "active" | "inactive",
  expectedUpdatedAt?: string,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("set-katalog-variant-status", options);
  return executeCatalogCommand(
    usahaId,
    "set_varian_status",
    "command_set_varian_status",
    {
      p_usaha_id: usahaId,
      p_varian_barang_id: varianBarangId,
      p_status: status,
      p_expected_updated_at: expectedUpdatedAt ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Perubahan status varian",
    idempotencyKey,
  );
}

export async function createCatalogPackage(
  usahaId: string,
  input: CreateCatalogPackageInput,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("create-katalog-package", options);
  return executeCatalogCommand(
    usahaId,
    "create_paket_sewa",
    "command_create_paket_sewa",
    {
      p_usaha_id: usahaId,
      p_nama: input.nama.trim(),
      p_slug: input.slug.trim().toLowerCase(),
      p_deskripsi: input.deskripsi?.trim() || null,
      p_harga_dasar: input.hargaDasar ?? null,
      p_currency_code: (input.currencyCode ?? "IDR").toUpperCase(),
      p_status: input.status ?? "draft",
      p_is_public: input.isPublic ?? false,
      p_metadata: input.metadata ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Pembuatan paket",
    idempotencyKey,
  );
}

export async function updateCatalogPackage(
  usahaId: string,
  paketSewaId: string,
  input: UpdateCatalogPackageInput,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("update-katalog-package", options);
  return executeCatalogCommand(
    usahaId,
    "update_paket_sewa",
    "command_update_paket_sewa",
    {
      p_usaha_id: usahaId,
      p_paket_sewa_id: paketSewaId,
      p_nama: input.nama.trim(),
      p_slug: input.slug.trim().toLowerCase(),
      p_deskripsi: input.deskripsi?.trim() || null,
      p_harga_dasar: input.hargaDasar ?? null,
      p_currency_code: (input.currencyCode ?? "IDR").toUpperCase(),
      p_metadata: input.metadata ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Pembaruan paket",
    idempotencyKey,
  );
}

export async function setCatalogPackageState(
  usahaId: string,
  paketSewaId: string,
  status: "draft" | "active" | "inactive",
  isPublic: boolean,
  expectedUpdatedAt?: string,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("set-katalog-package-state", options);
  return executeCatalogCommand(
    usahaId,
    "set_paket_state",
    "command_set_paket_state",
    {
      p_usaha_id: usahaId,
      p_paket_sewa_id: paketSewaId,
      p_status: status,
      p_is_public: isPublic,
      p_expected_updated_at: expectedUpdatedAt ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Perubahan state paket",
    idempotencyKey,
  );
}

export async function addCatalogPackageComponent(
  usahaId: string,
  input: AddCatalogPackageComponentInput,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("add-katalog-package-component", options);
  return executeCatalogCommand(
    usahaId,
    "add_komponen_paket",
    "command_add_komponen_paket",
    {
      p_usaha_id: usahaId,
      p_paket_sewa_id: input.paketSewaId,
      p_barang_id: input.barangId ?? null,
      p_varian_barang_id: input.varianBarangId ?? null,
      p_jumlah: input.jumlah,
      p_catatan: input.catatan?.trim() || null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Penambahan komponen paket",
    idempotencyKey,
  );
}

export async function removeCatalogPackageComponent(
  usahaId: string,
  komponenPaketId: string,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("remove-katalog-package-component", options);
  return executeCatalogCommand(
    usahaId,
    "remove_komponen_paket",
    "command_remove_komponen_paket",
    {
      p_usaha_id: usahaId,
      p_komponen_paket_id: komponenPaketId,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Penghapusan komponen paket",
    idempotencyKey,
  );
}

export async function createCatalogTariff(
  usahaId: string,
  input: CreateCatalogTariffInput,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("create-katalog-tariff", options);
  return executeCatalogCommand(
    usahaId,
    "create_tarif_sewa",
    "command_create_tarif_sewa",
    {
      p_usaha_id: usahaId,
      p_barang_id: input.barangId ?? null,
      p_varian_barang_id: input.varianBarangId ?? null,
      p_paket_sewa_id: input.paketSewaId ?? null,
      p_nama: input.nama.trim(),
      p_durasi_unit: input.durasiUnit.trim(),
      p_durasi_nilai: input.durasiNilai,
      p_nominal: input.nominal,
      p_currency_code: (input.currencyCode ?? "IDR").toUpperCase(),
      p_berlaku_mulai: input.berlakuMulai ?? new Date().toISOString(),
      p_berlaku_sampai: input.berlakuSampai ?? null,
      p_status: input.status ?? "active",
      p_metadata: input.metadata ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Pembuatan tarif",
    idempotencyKey,
  );
}

export async function updateCatalogTariff(
  usahaId: string,
  input: UpdateCatalogTariffInput,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("update-katalog-tariff", options);
  return executeCatalogCommand(
    usahaId,
    "update_tarif_sewa",
    "command_update_tarif_sewa",
    {
      p_usaha_id: usahaId,
      p_tarif_sewa_id: input.tarifSewaId,
      p_nama: input.nama.trim(),
      p_durasi_unit: input.durasiUnit.trim(),
      p_durasi_nilai: input.durasiNilai,
      p_nominal: input.nominal,
      p_berlaku_mulai: input.berlakuMulai,
      p_berlaku_sampai: input.berlakuSampai ?? null,
      p_metadata: input.metadata ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Pembaruan tarif",
    idempotencyKey,
  );
}

export async function setCatalogTariffStatus(
  usahaId: string,
  tarifSewaId: string,
  status: "active" | "inactive",
  expectedUpdatedAt?: string,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("set-katalog-tariff-status", options);
  return executeCatalogCommand(
    usahaId,
    "set_tarif_status",
    "command_set_tarif_status",
    {
      p_usaha_id: usahaId,
      p_tarif_sewa_id: tarifSewaId,
      p_status: status,
      p_expected_updated_at: expectedUpdatedAt ?? null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Perubahan status tarif",
    idempotencyKey,
  );
}

export async function addCatalogMedia(
  usahaId: string,
  input: AddCatalogMediaInput,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("add-katalog-media", options);
  return executeCatalogCommand(
    usahaId,
    "add_barang_media",
    "command_add_barang_media",
    {
      p_usaha_id: usahaId,
      p_barang_id: input.barangId,
      p_storage_bucket: input.storageBucket,
      p_storage_path: input.storagePath,
      p_media_type: input.mediaType ?? "image",
      p_urutan: input.urutan ?? 1,
      p_is_cover: input.isCover ?? false,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Penambahan media katalog",
    idempotencyKey,
  );
}

export async function removeCatalogMedia(
  usahaId: string,
  barangMediaId: string,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("remove-katalog-media", options);
  return executeCatalogCommand(
    usahaId,
    "remove_barang_media",
    "command_remove_barang_media",
    {
      p_usaha_id: usahaId,
      p_barang_media_id: barangMediaId,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Penghapusan media katalog",
    idempotencyKey,
  );
}

export async function setCatalogMediaCover(
  usahaId: string,
  barangMediaId: string,
  isCover: boolean,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("set-katalog-media-cover", options);
  return executeCatalogCommand(
    usahaId,
    "set_barang_media_cover",
    "command_set_barang_media_cover",
    {
      p_usaha_id: usahaId,
      p_barang_media_id: barangMediaId,
      p_is_cover: isCover,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Perubahan cover media",
    idempotencyKey,
  );
}

export async function reorderCatalogMedia(
  usahaId: string,
  barangId: string,
  orders: Array<{ barang_media_id: string; urutan: number }>,
  options: CatalogCommandOptions = {},
) {
  const idempotencyKey = commandKey("reorder-katalog-media", options);
  return executeCatalogCommand(
    usahaId,
    "reorder_barang_media",
    "command_reorder_barang_media",
    {
      p_usaha_id: usahaId,
      p_barang_id: barangId,
      p_orders: orders,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? crypto.randomUUID(),
    },
    "Pengurutan media katalog",
    idempotencyKey,
  );
}

export async function reconcileCatalogMutation(
  usahaId: string,
  commandName: string,
  idempotencyKey: string,
) {
  const { data, error } = await supabase.rpc("command_reconcile_catalog_mutation", {
    p_usaha_id: usahaId,
    p_command_name: commandName,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw catalogCommandError("Rekonsiliasi katalog", error);
  if (!data) throw new Error("Rekonsiliasi katalog: server tidak mengembalikan hasil.");
  return data as { state: "committed" | "not_found" | "unknown"; response: CatalogCommandResponse | null };
}


export async function listCatalogPackages(usahaId: string): Promise<import("./types").CatalogPackage[]> {
  const { data, error } = await supabase
    .from("paket_sewa")
    .select("paket_sewa_id,usaha_id,nama,slug,deskripsi,harga_dasar,currency_code,status,is_public,metadata,updated_at")
    .eq("usaha_id", usahaId)
    .order("nama", { ascending: true });
  if (error) throw error;
  return (data ?? []) as import("./types").CatalogPackage[];
}

export async function listCatalogPackageComponents(usahaId: string, paketSewaId: string): Promise<import("./types").CatalogPackageComponent[]> {
  const { data, error } = await supabase
    .from("komponen_paket")
    .select("komponen_paket_id,usaha_id,paket_sewa_id,barang_id,varian_barang_id,jumlah,catatan,updated_at")
    .eq("usaha_id", usahaId)
    .eq("paket_sewa_id", paketSewaId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as import("./types").CatalogPackageComponent[];
}
