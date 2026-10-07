import { createClientId } from "@/lib/client-id";
import { supabase } from "@/app/providers/supabase/client";

export type QuickItemVariantRow = {
  attributes: Record<string, string>;
  quantity: number;
  nominal: number;
};

export type QuickItemUnitDetail = {
  serialNumber?: string | null;
  tanggalDiperoleh?: string | null;
  catatanInternal?: string | null;
};

export type QuickItemOnboardingInput = {
  kategoriBarangId?: string | null;
  kategoriNama?: string | null;
  namaBarang: string;
  deskripsi?: string | null;
  hargaSewa: {
    nominal: number | null;
    durasiUnit: string;
    durasiNilai: number;
    currencyCode: string;
  };
  jumlah?: number | null;
  lokasiId?: string | null;
  varianMode: boolean;
  variantDimensions?: string[];
  variants?: QuickItemVariantRow[];
  advancedMode?: boolean;
  unitDetails?: QuickItemUnitDetail[];
};

export type QuickItemLocation = {
  lokasi_id: string;
  usaha_id: string;
  nama: string;
  tipe: string;
  alamat: string | null;
  keterangan: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type QuickItemOnboardingUnit = {
  unit_barang_id: string;
  kode_unit: string;
  status: "ready" | string;
  serial_number: string | null;
  tanggal_diperoleh: string | null;
  lokasi_id: string | null;
  catatan_internal: string | null;
  varian_barang_id: string | null;
};

export type QuickItemOnboardingVariant = {
  varian_barang_id: string;
  nama: string;
  atribut_pembeda: Record<string, unknown>;
  quantity: number;
  nominal: number;
};

export type QuickItemOnboardingResult = {
  state: "committed";
  usaha_id: string;
  barang_id: string;
  barang_nama: string;
  deskripsi: string | null;
  slug: string;
  kategori_barang_id: string;
  kategori_dibuat: boolean;
  lokasi_id: string | null;
  varian_mode: boolean;
  variant_count: number;
  unit_count: number;
  tariff_count: number;
  min_price: number;
  max_price: number;
  currency_code: string;
  durasi_unit: string;
  durasi_nilai: number;
  variants: QuickItemOnboardingVariant[];
  tariffs: Array<{
    tarif_sewa_id: string;
    target_type: "barang" | "varian_barang";
    varian_barang_id?: string;
    nominal: number;
    currency_code: string;
    durasi_unit: string;
    durasi_nilai: number;
  }>;
  units: QuickItemOnboardingUnit[];
  readiness: "ready";
  source: "quick_item_onboarding";
  existing_stock: true;
};

function quickItemError(error: unknown) {
  if (error instanceof Error) return error;
  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const message = typeof record?.message === "string" ? record.message : null;
  const hint = typeof record?.hint === "string" ? record.hint : null;
  const details = typeof record?.details === "string" ? record.details : null;
  return new Error([message, hint, details].filter(Boolean).join(" · ") || "Quick Item gagal diproses.");
}

function quickItemIdempotencyKey(options?: { idempotencyKey?: string }) {
  return options?.idempotencyKey ?? "quick-item-" + createClientId();
}

export async function listQuickItemLocations(usahaId: string): Promise<QuickItemLocation[]> {
  const { data, error } = await supabase
    .from("lokasi")
    .select("lokasi_id,usaha_id,nama,tipe,alamat,keterangan,status,created_at,updated_at")
    .eq("usaha_id", usahaId)
    .eq("status", "active")
    .order("nama", { ascending: true });

  if (error) throw quickItemError(error);
  return (data ?? []) as QuickItemLocation[];
}

export async function onboardQuickItem(
  usahaId: string,
  input: QuickItemOnboardingInput,
  options: { idempotencyKey?: string; requestId?: string } = {},
): Promise<QuickItemOnboardingResult> {
  const idempotencyKey = quickItemIdempotencyKey(options);
  const { data, error } = await supabase.rpc("command_quick_item_onboarding", {
    p_usaha_id: usahaId,
    p_payload: {
      kategori_barang_id: input.kategoriBarangId ?? null,
      kategori_nama: input.kategoriNama ?? null,
      nama_barang: input.namaBarang.trim(),
      deskripsi: input.deskripsi?.trim() || null,
      harga_sewa: {
        nominal: input.hargaSewa.nominal,
        durasi_unit: input.hargaSewa.durasiUnit,
        durasi_nilai: input.hargaSewa.durasiNilai,
        currency_code: input.hargaSewa.currencyCode,
      },
      jumlah: input.jumlah ?? null,
      lokasi_id: input.lokasiId ?? null,
      varian_mode: input.varianMode,
      variant_dimensions: input.variantDimensions ?? [],
      variants: input.variants ?? [],
      advanced_mode: input.advancedMode ?? false,
      unit_details: input.unitDetails ?? [],
    },
    p_idempotency_key: idempotencyKey,
    p_request_id: options.requestId ?? createClientId(),
  });

  if (!error && data) return data as QuickItemOnboardingResult;

  const reconciliation = await supabase.rpc("command_reconcile_catalog_mutation", {
    p_usaha_id: usahaId,
    p_command_name: "quick_item_onboarding",
    p_idempotency_key: idempotencyKey,
  });

  if (!reconciliation.error && reconciliation.data?.state === "committed" && reconciliation.data.response) {
    return reconciliation.data.response as QuickItemOnboardingResult;
  }

  if (!reconciliation.error && reconciliation.data?.state === "unknown") {
    throw new Error(
      "UNKNOWN_OUTCOME: hasil penambahan barang belum dapat dipastikan. Periksa Katalog sebelum mencoba kembali.",
    );
  }

  if (error) throw quickItemError(error);
  throw new Error("Quick Item: server tidak mengembalikan hasil command.");
}

export function quickItemLocationSelection(locations: QuickItemLocation[]) {
  if (locations.length === 1) {
    return {
      selectedLocationId: locations[0].lokasi_id,
      selectionRequired: false,
    };
  }

  return {
    selectedLocationId: null,
    selectionRequired: locations.length > 1,
  };
}
