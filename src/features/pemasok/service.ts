import { createClientId } from "@/lib/client-id";
import { supabase } from "@/app/providers/supabase/client";
import type {
  ProcurementCapabilities,
  ProcurementTenantContext,
  ProcurementReconciliation,
  PurchaseMutationResult,
  PurchaseCatalogOption,
  PurchaseVariantOption,
  SupplierOption,
  PurchaseDetail,
  PurchaseListFilters,
  PurchaseListItem,
  PurchaseLineItem,
  SupplierDetail,
  SupplierListItem,
  CreateSupplierInput,
  UpdateSupplierInput,
  CreatePurchaseDraftInput,
  UpdatePurchaseDraftInput,
  ProcurementCommandOptions,
} from "./types";
import { sanitizeProcurementSearch } from "./utils";

type MembershipRow = { usaha_id: string; status: string; revoked_at: string | null };
type CountRow = { pemasok_id: string | null; tanggal_pembelian: string };
type PurchaseHeaderRow = {
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
};

const SUPPLIER_SELECT =
  "pemasok_id,usaha_id,nama,nomor_telepon,email,alamat,status,catatan,created_at,updated_at";

const PURCHASE_SELECT =
  "pembelian_id,usaha_id,pemasok_id,nomor_pembelian,tanggal_pembelian,status,total_amount,currency_code,catatan,created_at,updated_at";

const PURCHASE_LINE_SELECT =
  "detail_pembelian_id,usaha_id,pembelian_id,barang_id,varian_barang_id,deskripsi,jumlah,unit_price,subtotal,created_at,updated_at";

export async function getPemasokContext(): Promise<ProcurementTenantContext> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error("Sesi admin tidak ditemukan.");

  const { data: admin, error: adminError } = await supabase
    .from("akun_admin")
    .select("akun_admin_id")
    .eq("auth_user_id", userData.user.id)
    .eq("status", "active")
    .maybeSingle();
  if (adminError) throw adminError;
  if (!admin) throw new Error("Akun admin aktif tidak ditemukan.");

  const { data: memberships, error: membershipError } = await supabase
    .from("keanggotaan_usaha")
    .select("usaha_id,status,revoked_at")
    .eq("akun_admin_id", admin.akun_admin_id)
    .eq("status", "active")
    .is("revoked_at", null);
  if (membershipError) throw membershipError;

  const rows = (memberships ?? []) as MembershipRow[];
  if (rows.length === 0) throw new Error("Akun admin belum memiliki Usaha aktif.");
  if (rows.length > 1) {
    throw new Error("Konteks Usaha belum ditentukan karena ada lebih dari satu keanggotaan aktif.");
  }

  const { data: usaha, error: usahaError } = await supabase
    .from("usaha")
    .select("usaha_id,nama,status")
    .eq("usaha_id", rows[0].usaha_id)
    .eq("status", "active")
    .maybeSingle();
  if (usahaError) throw usahaError;
  if (!usaha) throw new Error("Usaha aktif tidak ditemukan.");

  return {
    akunAdminId: admin.akun_admin_id as string,
    usahaId: usaha.usaha_id as string,
    usahaNama: usaha.nama as string,
  };
}

async function getPurchaseCountsForSuppliers(usahaId: string, supplierIds: string[]) {
  if (supplierIds.length === 0) return new Map<string, { count: number; lastPurchaseAt: string | null }>();

  const { data, error } = await supabase
    .from("pembelian")
    .select("pemasok_id,tanggal_pembelian")
    .eq("usaha_id", usahaId)
    .in("pemasok_id", supplierIds)
    .order("tanggal_pembelian", { ascending: false });

  if (error) throw error;

  const result = new Map<string, { count: number; lastPurchaseAt: string | null }>();
  for (const row of (data ?? []) as CountRow[]) {
    if (!row.pemasok_id) continue;
    const current = result.get(row.pemasok_id) ?? { count: 0, lastPurchaseAt: null };
    current.count += 1;
    if (!current.lastPurchaseAt) {
      current.lastPurchaseAt = row.tanggal_pembelian;
    }
    result.set(row.pemasok_id, current);
  }
  return result;
}

export async function listSuppliers(
  usahaId: string,
  search: string,
  page = 1,
  pageSize = 20,
) {
  const start = Math.max(0, page - 1) * pageSize;
  const end = start + pageSize - 1;
  let query = supabase
    .from("pemasok")
    .select(SUPPLIER_SELECT, { count: "exact" })
    .eq("usaha_id", usahaId)
    .order("nama", { ascending: true })
    .range(start, end);

  const term = sanitizeProcurementSearch(search);
  if (term) {
    const pattern = "*" + term + "*";
    query = query.or(
      "nama.ilike." + pattern + ",nomor_telepon.ilike." + pattern + ",email.ilike." + pattern,
    );
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const suppliers = (data ?? []) as SupplierDetail[];
  const counts = await getPurchaseCountsForSuppliers(
    usahaId,
    suppliers.map((supplier) => supplier.pemasok_id),
  );

  const items: SupplierListItem[] = suppliers.map((supplier) => {
    const stats = counts.get(supplier.pemasok_id) ?? { count: 0, lastPurchaseAt: null };
    return { ...supplier, purchase_count: stats.count, last_purchase_at: stats.lastPurchaseAt };
  });

  return { suppliers: items, total: count ?? 0 };
}

export async function getSupplier(usahaId: string, pemasokId: string) {
  const { data, error } = await supabase
    .from("pemasok")
    .select(SUPPLIER_SELECT)
    .eq("usaha_id", usahaId)
    .eq("pemasok_id", pemasokId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Pemasok tidak ditemukan dalam Usaha aktif.");
  return data as SupplierDetail;
}

export async function listSupplierPurchases(usahaId: string, pemasokId: string) {
  const { data, error } = await supabase
    .from("pembelian")
    .select(PURCHASE_SELECT)
    .eq("usaha_id", usahaId)
    .eq("pemasok_id", pemasokId)
    .order("tanggal_pembelian", { ascending: false })
    .limit(50);
  if (error) throw error;

  const purchases = (data ?? []) as PurchaseHeaderRow[];
  const purchaseIds = purchases.map((purchase) => purchase.pembelian_id);
  const lineCounts = await getLineCounts(usahaId, purchaseIds);

  return purchases.map(
    (purchase): PurchaseListItem => ({
      ...purchase,
      pemasok_nama: null,
      line_count: lineCounts.get(purchase.pembelian_id) ?? 0,
    }),
  );
}

async function resolveSupplierNames(usahaId: string, supplierIds: Array<string | null>) {
  const ids = Array.from(new Set(supplierIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return new Map<string, string>();

  const { data, error } = await supabase
    .from("pemasok")
    .select("pemasok_id,nama")
    .eq("usaha_id", usahaId)
    .in("pemasok_id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.pemasok_id as string, row.nama as string]));
}

async function getLineCounts(usahaId: string, purchaseIds: string[]) {
  if (purchaseIds.length === 0) return new Map<string, number>();

  const { data, error } = await supabase
    .from("detail_pembelian")
    .select("pembelian_id")
    .eq("usaha_id", usahaId)
    .in("pembelian_id", purchaseIds);
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ pembelian_id: string }>) {
    counts.set(row.pembelian_id, (counts.get(row.pembelian_id) ?? 0) + 1);
  }
  return counts;
}

async function findSupplierIdsBySearch(usahaId: string, search: string) {
  const term = sanitizeProcurementSearch(search);
  if (!term) return [] as string[];
  const pattern = "*" + term + "*";
  const { data, error } = await supabase
    .from("pemasok")
    .select("pemasok_id")
    .eq("usaha_id", usahaId)
    .or("nama.ilike." + pattern + ",nomor_telepon.ilike." + pattern + ",email.ilike." + pattern)
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => row.pemasok_id as string);
}

export async function listPurchases(
  usahaId: string,
  filters: PurchaseListFilters,
) {
  const start = Math.max(0, filters.page - 1) * filters.pageSize;
  const end = start + filters.pageSize - 1;
  let query = supabase
    .from("pembelian")
    .select(PURCHASE_SELECT, { count: "exact" })
    .eq("usaha_id", usahaId);

  if (filters.status !== "all") query = query.eq("status", filters.status);

  const term = sanitizeProcurementSearch(filters.search);
  if (term) {
    const supplierIds = await findSupplierIdsBySearch(usahaId, term);
    const pattern = "*" + term + "*";
    const clauses = ["nomor_pembelian.ilike." + pattern];
    if (supplierIds.length) clauses.push("pemasok_id.in.(" + supplierIds.join(",") + ")");
    query = query.or(clauses.join(","));
  }

  query = query
    .order("tanggal_pembelian", { ascending: false })
    .order("nomor_pembelian", { ascending: false })
    .range(start, end);

  const { data, error, count } = await query;
  if (error) throw error;

  const purchases = (data ?? []) as PurchaseHeaderRow[];
  const [supplierNames, lineCounts] = await Promise.all([
    resolveSupplierNames(usahaId, purchases.map((purchase) => purchase.pemasok_id)),
    getLineCounts(usahaId, purchases.map((purchase) => purchase.pembelian_id)),
  ]);

  return {
    purchases: purchases.map(
      (purchase): PurchaseListItem => ({
        ...purchase,
        pemasok_nama: purchase.pemasok_id ? supplierNames.get(purchase.pemasok_id) ?? null : null,
        line_count: lineCounts.get(purchase.pembelian_id) ?? 0,
      }),
    ),
    total: count ?? 0,
  };
}

export async function getPurchase(usahaId: string, pembelianId: string): Promise<PurchaseDetail> {
  const { data, error } = await supabase
    .from("pembelian")
    .select(PURCHASE_SELECT)
    .eq("usaha_id", usahaId)
    .eq("pembelian_id", pembelianId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Pembelian tidak ditemukan dalam Usaha aktif.");

  const purchase = data as PurchaseHeaderRow;
  const [{ data: lineData, error: lineError }, supplierNames, lineCounts] = await Promise.all([
    supabase
      .from("detail_pembelian")
      .select(PURCHASE_LINE_SELECT)
      .eq("usaha_id", usahaId)
      .eq("pembelian_id", pembelianId)
      .order("created_at", { ascending: true }),
    resolveSupplierNames(usahaId, [purchase.pemasok_id]),
    getLineCounts(usahaId, [purchase.pembelian_id]),
  ]);

  if (lineError) throw lineError;

  const lines = (lineData ?? []) as Array<PurchaseLineItem>;
  const catalogIds = Array.from(
    new Set(lines.map((line) => line.barang_id).filter((id): id is string => Boolean(id))),
  );
  const variantIds = Array.from(
    new Set(lines.map((line) => line.varian_barang_id).filter((id): id is string => Boolean(id))),
  );

  const [catalogResult, variantResult] = await Promise.all([
    catalogIds.length
      ? supabase.from("barang").select("barang_id,nama").eq("usaha_id", usahaId).in("barang_id", catalogIds)
      : Promise.resolve({ data: [], error: null }),
    variantIds.length
      ? supabase.from("varian_barang").select("varian_barang_id,barang_id,nama").eq("usaha_id", usahaId).in("varian_barang_id", variantIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (catalogResult.error) throw catalogResult.error;
  if (variantResult.error) throw variantResult.error;

  const catalogNames = new Map((catalogResult.data ?? []).map((row) => [row.barang_id as string, row.nama as string]));
  const variantNames = new Map((variantResult.data ?? []).map((row) => [row.varian_barang_id as string, row.nama as string]));
  const variantProductIds = new Map(
    (variantResult.data ?? []).map((row) => [row.varian_barang_id as string, row.barang_id as string]),
  );

  return {
    ...purchase,
    pemasok_nama: purchase.pemasok_id ? supplierNames.get(purchase.pemasok_id) ?? null : null,
    line_count: lineCounts.get(purchase.pembelian_id) ?? 0,
    lines: lines.map((line) => ({
      ...line,
      // For variant-targeted purchase lines, resolve the parent product for
      // editing/presentation. The command adapter will omit it on mutation.
      barang_id:
        line.barang_id ??
        (line.varian_barang_id ? variantProductIds.get(line.varian_barang_id) ?? null : null),
      barang_nama:
        line.barang_id
          ? catalogNames.get(line.barang_id) ?? null
          : line.varian_barang_id
            ? catalogNames.get(variantProductIds.get(line.varian_barang_id) ?? "") ?? null
            : null,
      varian_nama: line.varian_barang_id ? variantNames.get(line.varian_barang_id) ?? null : null,
    })),
  };
}

export function getProcurementCapabilities(): ProcurementCapabilities {
  return {
    read: true,
    mutation: true,
    reason:
      "Pemasok dan Pembelian memiliki trusted command boundary dengan tenant authorization, idempotency, stale-write protection, audit, dan reconciliation.",
  };
}


type ProcurementCommandResponse = Record<string, unknown>;

function procurementCommandKey(prefix: string, options: ProcurementCommandOptions) {
  return options.idempotencyKey ?? `${prefix}-${createClientId()}`;
}

async function executeProcurementCommand<T extends ProcurementCommandResponse>(
  usahaId: string,
  commandName: string,
  rpcName: string,
  args: Record<string, unknown>,
  label: string,
  idempotencyKey: string,
): Promise<T> {
  const { data, error } = await supabase.rpc(rpcName, args);
  if (!error && data) return data as T;

  const reconciliation = await supabase.rpc("command_reconcile_procurement_mutation", {
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

  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }

  throw new Error(`${label}: server tidak mengembalikan hasil command.`);
}

function normalizePurchaseLines(input: CreatePurchaseDraftInput["lines"]) {
  return (input ?? []).map((line) => {
    const variantId = line.varianBarangId?.trim() || null;

    return {
      // The purchase line has exactly one canonical target.
      // A selected variant is itself the target; its parent product is
      // presentation/context only and must not be sent alongside it.
      barang_id: variantId ? null : line.barangId?.trim() || null,
      varian_barang_id: variantId,
      deskripsi: line.deskripsi?.trim() || null,
      jumlah: line.jumlah,
      unit_price: line.unitPrice,
    };
  });
}

export async function createSupplier(
  usahaId: string,
  input: CreateSupplierInput,
  options: ProcurementCommandOptions = {},
) {
  const idempotencyKey = procurementCommandKey("create-pemasok", options);
  return executeProcurementCommand<SupplierDetail>(
    usahaId,
    "create_supplier",
    "command_create_supplier",
    {
      p_usaha_id: usahaId,
      p_nama: input.nama.trim(),
      p_nomor_telepon: input.nomorTelepon?.trim() || null,
      p_email: input.email?.trim() || null,
      p_alamat: input.alamat?.trim() || null,
      p_catatan: input.catatan?.trim() || null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? createClientId(),
    },
    "Pembuatan pemasok",
    idempotencyKey,
  );
}

export async function updateSupplier(
  usahaId: string,
  pemasokId: string,
  input: UpdateSupplierInput,
  options: ProcurementCommandOptions = {},
) {
  const idempotencyKey = procurementCommandKey("update-pemasok", options);
  return executeProcurementCommand<SupplierDetail>(
    usahaId,
    "update_supplier",
    "command_update_supplier",
    {
      p_usaha_id: usahaId,
      p_pemasok_id: pemasokId,
      p_nama: input.nama.trim(),
      p_nomor_telepon: input.nomorTelepon?.trim() || null,
      p_email: input.email?.trim() || null,
      p_alamat: input.alamat?.trim() || null,
      p_catatan: input.catatan?.trim() || null,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? createClientId(),
    },
    "Pembaruan pemasok",
    idempotencyKey,
  );
}

export async function setSupplierStatus(
  usahaId: string,
  pemasokId: string,
  status: "active" | "inactive",
  expectedUpdatedAt: string,
  options: ProcurementCommandOptions = {},
) {
  const idempotencyKey = procurementCommandKey("set-pemasok-status", options);
  return executeProcurementCommand<{ pemasok_id: string; usaha_id: string; status: string; updated_at: string }>(
    usahaId,
    "set_supplier_status",
    "command_set_supplier_status",
    {
      p_usaha_id: usahaId,
      p_pemasok_id: pemasokId,
      p_status: status,
      p_expected_updated_at: expectedUpdatedAt,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? createClientId(),
    },
    "Perubahan status pemasok",
    idempotencyKey,
  );
}

export async function createPurchaseDraft(
  usahaId: string,
  input: CreatePurchaseDraftInput,
  options: ProcurementCommandOptions = {},
) {
  const idempotencyKey = procurementCommandKey("create-pembelian-draft", options);
  return executeProcurementCommand<PurchaseMutationResult>(
    usahaId,
    "create_purchase",
    "command_create_purchase",
    {
      p_usaha_id: usahaId,
      p_pemasok_id: input.pemasokId ?? null,
      p_nomor_pembelian: input.nomorPembelian.trim(),
      p_tanggal_pembelian: input.tanggalPembelian,
      p_lines: normalizePurchaseLines(input.lines),
      p_catatan: input.catatan?.trim() || null,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? createClientId(),
    },
    "Pembuatan draft pembelian",
    idempotencyKey,
  );
}

export async function updatePurchaseDraft(
  usahaId: string,
  pembelianId: string,
  input: UpdatePurchaseDraftInput,
  options: ProcurementCommandOptions = {},
) {
  const idempotencyKey = procurementCommandKey("update-pembelian-draft", options);
  return executeProcurementCommand<PurchaseMutationResult>(
    usahaId,
    "update_purchase_draft",
    "command_update_purchase_draft",
    {
      p_usaha_id: usahaId,
      p_pembelian_id: pembelianId,
      p_pemasok_id: input.pemasokId ?? null,
      p_nomor_pembelian: input.nomorPembelian.trim(),
      p_tanggal_pembelian: input.tanggalPembelian,
      p_lines: normalizePurchaseLines(input.lines),
      p_catatan: input.catatan?.trim() || null,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_idempotency_key: idempotencyKey,
      p_request_id: options.requestId ?? createClientId(),
    },
    "Pembaruan draft pembelian",
    idempotencyKey,
  );
}


export async function listActiveSuppliers(usahaId: string, search = ""): Promise<SupplierOption[]> {
  let query = supabase
    .from("pemasok")
    .select("pemasok_id,nama,status")
    .eq("usaha_id", usahaId)
    .eq("status", "active")
    .order("nama", { ascending: true })
    .limit(100);

  const term = sanitizeProcurementSearch(search);
  if (term) {
    query = query.ilike("nama", "*" + term + "*");
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SupplierOption[];
}

export async function listPurchaseCatalogOptions(
  usahaId: string,
): Promise<PurchaseCatalogOption[]> {
  const { data, error } = await supabase
    .from("barang")
    .select("barang_id,nama,status")
    .eq("usaha_id", usahaId)
    .eq("status", "active")
    .order("nama", { ascending: true })
    .limit(500);

  if (error) throw error;
  return (data ?? []) as PurchaseCatalogOption[];
}

export async function listPurchaseVariantOptions(
  usahaId: string,
): Promise<PurchaseVariantOption[]> {
  const { data, error } = await supabase
    .from("varian_barang")
    .select("varian_barang_id,barang_id,nama,status")
    .eq("usaha_id", usahaId)
    .eq("status", "active")
    .order("nama", { ascending: true })
    .limit(1000);

  if (error) throw error;
  return (data ?? []) as PurchaseVariantOption[];
}

export async function getSupplierForEdit(usahaId: string, pemasokId: string) {
  return getSupplier(usahaId, pemasokId);
}

export async function getPurchaseForEdit(usahaId: string, pembelianId: string) {
  return getPurchase(usahaId, pembelianId);
}


export async function reconcileProcurementMutation(
  usahaId: string,
  commandName:
    | "create_supplier"
    | "update_supplier"
    | "set_supplier_status"
    | "create_purchase"
    | "update_purchase_draft",
  idempotencyKey: string,
): Promise<ProcurementReconciliation> {
  const { data, error } = await supabase.rpc("command_reconcile_procurement_mutation", {
    p_usaha_id: usahaId,
    p_command_name: commandName,
    p_idempotency_key: idempotencyKey,
  });

  if (error) throw error;
  return data as ProcurementReconciliation;
}
