import { supabase } from "@/app/providers/supabase/client";
import type {
  FinanceCapabilities,
  FinanceCorrectionResult,
  FinanceExpenseAnalysis,
  FinanceHealth,
  FinanceReconciliationFindings,
  FinanceProductRevenueReport,
  FinanceReportPage,
  FinanceSummary,
  FinanceTransaction,
  FinanceUnitRevenueReport,
  FinanceCommandOptions,
  FinanceCommandResult,
  FinanceExpense,
  FinanceListFilters,
  FinancePeriod,
  FinancePayment,
  FinanceReconciliationResult,
  FinanceSummaryCounts,
  FinanceTenantContext,
  RecordExpenseInput,
  RecordPaymentInput,
} from "./types";
import { sanitizeFinanceSearch } from "./utils";

type MembershipRow = { usaha_id: string; status: string; revoked_at: string | null };

const TRANSACTION_SELECT =
  "transaksi_keuangan_id,usaha_id,nomor_transaksi,jenis,arah,tanggal_transaksi,amount,currency_code,sumber_type,sumber_id,status,catatan,created_at,updated_at";
const PAYMENT_SELECT =
  "pembayaran_id,usaha_id,reservasi_id,penyewaan_id,transaksi_keuangan_id,nomor_pembayaran,jenis,metode,amount,currency_code,dibayar_at,dicatat_by_admin_id,reference_text,catatan,status,created_at,updated_at";
const EXPENSE_SELECT =
  "pengeluaran_id,usaha_id,transaksi_keuangan_id,pemasok_id,kategori_biaya,deskripsi,amount,currency_code,tanggal_pengeluaran,bukti_storage_path,created_at,updated_at";

export async function getKeuanganContext(): Promise<FinanceTenantContext> {
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
    .select("usaha_id,nama,status,timezone")
    .eq("usaha_id", rows[0].usaha_id)
    .eq("status", "active")
    .maybeSingle();
  if (usahaError) throw usahaError;
  if (!usaha) throw new Error("Usaha aktif tidak ditemukan.");

  return {
    akunAdminId: admin.akun_admin_id as string,
    usahaId: usaha.usaha_id as string,
    usahaNama: usaha.nama as string,
    timezone: (usaha.timezone as string) || "Asia/Jakarta",
  };
}

export async function getFinanceSummaryCounts(usahaId: string): Promise<FinanceSummaryCounts> {
  const [transactions, payments, expenses] = await Promise.all([
    supabase.from("transaksi_keuangan").select("*", { count: "exact", head: true }).eq("usaha_id", usahaId),
    supabase.from("pembayaran").select("*", { count: "exact", head: true }).eq("usaha_id", usahaId),
    supabase.from("pengeluaran").select("*", { count: "exact", head: true }).eq("usaha_id", usahaId),
  ]);
  if (transactions.error) throw transactions.error;
  if (payments.error) throw payments.error;
  if (expenses.error) throw expenses.error;
  return {
    transaction_count: transactions.count ?? 0,
    payment_count: payments.count ?? 0,
    expense_count: expenses.count ?? 0,
  };
}

async function findPaymentTransactionIds(usahaId: string, term: string) {
  const pattern = "%" + term + "%";
  const [{ data: transactions, error: transactionError }, { data: payments, error: paymentError }] =
    await Promise.all([
      supabase.from("transaksi_keuangan").select("transaksi_keuangan_id").eq("usaha_id", usahaId).or("nomor_transaksi.ilike." + pattern + ",catatan.ilike." + pattern).limit(100),
      supabase.from("pembayaran").select("transaksi_keuangan_id").eq("usaha_id", usahaId).or("nomor_pembayaran.ilike." + pattern + ",reference_text.ilike." + pattern + ",catatan.ilike." + pattern).limit(100),
    ]);
  if (transactionError) throw transactionError;
  if (paymentError) throw paymentError;
  return Array.from(
    new Set([
      ...(transactions ?? []).map((row) => row.transaksi_keuangan_id as string),
      ...(payments ?? []).map((row) => row.transaksi_keuangan_id as string),
    ]),
  );
}

async function resolvePaymentSourceLabels(usahaId: string, rows: Array<FinancePayment>) {
  const reservationIds = Array.from(new Set(rows.map((row) => row.reservasi_id).filter((id): id is string => Boolean(id))));
  const rentalIds = Array.from(new Set(rows.map((row) => row.penyewaan_id).filter((id): id is string => Boolean(id))));
  const [reservations, rentals] = await Promise.all([
    reservationIds.length
      ? supabase.from("reservasi").select("reservasi_id,nomor_reservasi").eq("usaha_id", usahaId).in("reservasi_id", reservationIds)
      : Promise.resolve({ data: [], error: null }),
    rentalIds.length
      ? supabase.from("penyewaan").select("penyewaan_id,nomor_penyewaan").eq("usaha_id", usahaId).in("penyewaan_id", rentalIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (reservations.error) throw reservations.error;
  if (rentals.error) throw rentals.error;
  const reservationMap = new Map((reservations.data ?? []).map((row) => [row.reservasi_id as string, row.nomor_reservasi as string]));
  const rentalMap = new Map((rentals.data ?? []).map((row) => [row.penyewaan_id as string, row.nomor_penyewaan as string]));
  return rows.map((row) => ({
    ...row,
    source_label: row.reservasi_id
      ? "Reservasi " + (reservationMap.get(row.reservasi_id) ?? row.reservasi_id)
      : row.penyewaan_id
        ? "Penyewaan " + (rentalMap.get(row.penyewaan_id) ?? row.penyewaan_id)
        : "Sumber tidak ditautkan",
  }));
}

async function resolveExpenseRelations(usahaId: string, rows: Array<FinanceExpense>) {
  const transactionIds = Array.from(new Set(rows.map((row) => row.transaksi_keuangan_id)));
  const supplierIds = Array.from(new Set(rows.map((row) => row.pemasok_id).filter((id): id is string => Boolean(id))));
  const [transactions, suppliers] = await Promise.all([
    transactionIds.length
      ? supabase.from("transaksi_keuangan")
          .select("transaksi_keuangan_id,nomor_transaksi,sumber_type,sumber_id")
          .eq("usaha_id", usahaId)
          .in("transaksi_keuangan_id", transactionIds)
      : Promise.resolve({ data: [], error: null }),
    supplierIds.length
      ? supabase.from("pemasok").select("pemasok_id,nama").eq("usaha_id", usahaId).in("pemasok_id", supplierIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (transactions.error) throw transactions.error;
  if (suppliers.error) throw suppliers.error;
  const transactionMap = new Map(
    (transactions.data ?? []).map((row) => [
      row.transaksi_keuangan_id as string,
      {
        nomor: row.nomor_transaksi as string,
        sourceType: (row.sumber_type as string | null) ?? null,
        sourceId: (row.sumber_id as string | null) ?? null,
      },
    ]),
  );
  const supplierMap = new Map((suppliers.data ?? []).map((row) => [row.pemasok_id as string, row.nama as string]));
  return rows.map((row) => {
    const transaction = transactionMap.get(row.transaksi_keuangan_id);
    return {
      ...row,
      nomor_transaksi: transaction?.nomor ?? null,
      source_type: transaction?.sourceType ?? null,
      source_id: transaction?.sourceId ?? null,
      pemasok_nama: row.pemasok_id ? supplierMap.get(row.pemasok_id) ?? null : null,
    };
  });
}

export async function listTransactions(usahaId: string, filters: FinanceListFilters) {
  const start = Math.max(0, filters.page - 1) * filters.pageSize;
  const end = start + filters.pageSize - 1;
  let query = supabase.from("transaksi_keuangan").select(TRANSACTION_SELECT, { count: "exact" }).eq("usaha_id", usahaId);
  const term = sanitizeFinanceSearch(filters.search);
  if (term) {
    const pattern = "*" + term + "*";
    query = query.or("nomor_transaksi.ilike." + pattern + ",sumber_type.ilike." + pattern + ",catatan.ilike." + pattern);
  }
  query = query.order("tanggal_transaksi", { ascending: false }).order("nomor_transaksi", { ascending: false }).range(start, end);
  const { data, error, count } = await query;
  if (error) throw error;
  return { transactions: (data ?? []) as FinanceTransaction[], total: count ?? 0 };
}

export async function listPayments(usahaId: string, filters: FinanceListFilters) {
  const start = Math.max(0, filters.page - 1) * filters.pageSize;
  const end = start + filters.pageSize - 1;
  const term = sanitizeFinanceSearch(filters.search);
  let query = supabase.from("pembayaran").select(PAYMENT_SELECT, { count: "exact" }).eq("usaha_id", usahaId);
  if (term) {
    const transactionIds = await findPaymentTransactionIds(usahaId, term);
    const pattern = "*" + term + "*";
    const clauses = [
      "nomor_pembayaran.ilike." + pattern,
      "jenis.ilike." + pattern,
      "metode.ilike." + pattern,
      "reference_text.ilike." + pattern,
    ];
    if (transactionIds.length) clauses.push("transaksi_keuangan_id.in.(" + transactionIds.join(",") + ")");
    query = query.or(clauses.join(","));
  }
  query = query.order("dibayar_at", { ascending: false }).order("nomor_pembayaran", { ascending: false }).range(start, end);
  const { data, error, count } = await query;
  if (error) throw error;
  const rows = (data ?? []) as FinancePayment[];
  return { payments: await resolvePaymentSourceLabels(usahaId, rows), total: count ?? 0 };
}

export async function listExpenses(usahaId: string, filters: FinanceListFilters) {
  const start = Math.max(0, filters.page - 1) * filters.pageSize;
  const end = start + filters.pageSize - 1;
  let query = supabase.from("pengeluaran").select(EXPENSE_SELECT, { count: "exact" }).eq("usaha_id", usahaId);
  const term = sanitizeFinanceSearch(filters.search);
  if (term) {
    const pattern = "*" + term + "*";
    query = query.or("deskripsi.ilike." + pattern + ",kategori_biaya.ilike." + pattern);
  }
  query = query.order("tanggal_pengeluaran", { ascending: false }).order("created_at", { ascending: false }).range(start, end);
  const { data, error, count } = await query;
  if (error) throw error;
  const rows = (data ?? []) as FinanceExpense[];
  return { expenses: await resolveExpenseRelations(usahaId, rows), total: count ?? 0 };
}

export async function getTransaction(usahaId: string, id: string) {
  const { data, error } = await supabase.from("transaksi_keuangan").select(TRANSACTION_SELECT).eq("usaha_id", usahaId).eq("transaksi_keuangan_id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Transaksi keuangan tidak ditemukan dalam Usaha aktif.");
  return data as FinanceTransaction;
}

export async function getPayment(usahaId: string, id: string) {
  const { data, error } = await supabase.from("pembayaran").select(PAYMENT_SELECT).eq("usaha_id", usahaId).eq("pembayaran_id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Pembayaran tidak ditemukan dalam Usaha aktif.");
  const rows = await resolvePaymentSourceLabels(usahaId, [data as FinancePayment]);
  return rows[0];
}

export async function getExpense(usahaId: string, id: string) {
  const { data, error } = await supabase.from("pengeluaran").select(EXPENSE_SELECT).eq("usaha_id", usahaId).eq("pengeluaran_id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Pengeluaran tidak ditemukan dalam Usaha aktif.");
  const rows = await resolveExpenseRelations(usahaId, [data as FinanceExpense]);
  return rows[0];
}

export function getFinanceCapabilities(): FinanceCapabilities {
  return {
    read: true,
    mutation: true,
    reason:
      "Finance mutation berjalan melalui trusted RPC dengan tenant authorization, server-side validation, atomic payment/expense + transaction recording, idempotency, audit, outbox, dan reconciliation.",
  };
}


function newFinanceCommandRequestId() {
  return crypto.randomUUID();
}

function assertFinanceRpcResult<T>(data: T | null, error: unknown, label: string): T {
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
  if (data == null) throw new Error(`${label}: server tidak mengembalikan hasil command.`);
  return data;
}

function normalizeFinancePeriod<T>(data: T): T & FinancePeriod {
  const record = data as T & { period?: FinancePeriod };
  if (!record.period) return record as T & FinancePeriod;
  return { ...record, ...record.period };
}

export async function recordPayment(
  usahaId: string,
  input: RecordPaymentInput,
  options: FinanceCommandOptions = {},
): Promise<FinanceCommandResult> {
  const reservasiId = input.reservasiId?.trim() || null;
  const penyewaanId = input.penyewaanId?.trim() || null;
  if (!reservasiId && !penyewaanId) throw new Error("Pembayaran harus terhubung ke reservasi atau penyewaan.");
  if (reservasiId && penyewaanId) throw new Error("Pilih satu sumber pembayaran: reservasi atau penyewaan.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Nominal pembayaran harus lebih dari 0.");

  const { data, error } = await supabase.rpc("command_record_payment", {
    p_usaha_id: usahaId,
    p_reservasi_id: reservasiId,
    p_penyewaan_id: penyewaanId,
    p_jenis: input.jenis,
    p_metode: input.metode,
    p_amount: input.amount,
    p_dibayar_at: input.dibayarAt ?? null,
    p_reference_text: input.referenceText?.trim() || null,
    p_catatan: input.catatan?.trim() || null,
    p_idempotency_key: options.idempotencyKey ?? `record-payment-${crypto.randomUUID()}`,
    p_request_id: options.requestId ?? newFinanceCommandRequestId(),
  });
  return assertFinanceRpcResult(data as FinanceCommandResult | null, error, "Pencatatan pembayaran");
}

export async function reconcilePaymentCommand(
  usahaId: string,
  idempotencyKey: string,
): Promise<FinanceReconciliationResult> {
  const { data, error } = await supabase.rpc("command_reconcile_payment", {
    p_usaha_id: usahaId,
    p_idempotency_key: idempotencyKey,
  });
  return assertFinanceRpcResult(data as FinanceReconciliationResult | null, error, "Rekonsiliasi pembayaran");
}

export async function recordExpense(
  usahaId: string,
  input: RecordExpenseInput,
  options: FinanceCommandOptions = {},
): Promise<FinanceCommandResult> {
  const sourceType = input.sourceType;
  const sourceId = input.sourceId?.trim() || null;
  if ((sourceType === "purchase" || sourceType === "maintenance") && !sourceId) {
    throw new Error("Source ID wajib diisi untuk pengeluaran berbasis purchase atau maintenance.");
  }
  if (sourceType === "operational" || sourceType === "other" || sourceType === "manual") {
    if (sourceId) throw new Error("Source ID tidak digunakan untuk pengeluaran manual/operasional.");
  }
  if (!input.kategoriBiaya.trim()) throw new Error("Kategori biaya wajib diisi.");
  if (!input.deskripsi.trim()) throw new Error("Deskripsi pengeluaran wajib diisi.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Nominal pengeluaran harus lebih dari 0.");

  const { data, error } = await supabase.rpc("command_record_expense", {
    p_usaha_id: usahaId,
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_pemasok_id: input.pemasokId?.trim() || null,
    p_kategori_biaya: input.kategoriBiaya.trim(),
    p_deskripsi: input.deskripsi.trim(),
    p_amount: input.amount,
    p_tanggal_pengeluaran: input.tanggalPengeluaran ?? null,
    p_bukti_storage_path: input.buktiStoragePath?.trim() || null,
    p_catatan: input.catatan?.trim() || null,
    p_idempotency_key: options.idempotencyKey ?? `record-expense-${crypto.randomUUID()}`,
    p_request_id: options.requestId ?? newFinanceCommandRequestId(),
  });
  return assertFinanceRpcResult(data as FinanceCommandResult | null, error, "Pencatatan pengeluaran");
}

export async function reconcileExpenseCommand(
  usahaId: string,
  idempotencyKey: string,
): Promise<FinanceReconciliationResult> {
  const { data, error } = await supabase.rpc("command_reconcile_expense", {
    p_usaha_id: usahaId,
    p_idempotency_key: idempotencyKey,
  });
  return assertFinanceRpcResult(data as FinanceReconciliationResult | null, error, "Rekonsiliasi pengeluaran");
}

export async function searchFinanceSources(usahaId: string, type: "reservation" | "rental", search = "") {
  const pattern = "%" + sanitizeFinanceSearch(search) + "%";
  if (type === "reservation") {
    let query = supabase.from("reservasi")
      .select("reservasi_id,nomor_reservasi,penyewa_id,mulai_reservasi,selesai_reservasi,status")
      .eq("usaha_id", usahaId)
      .order("mulai_reservasi", { ascending: false })
      .limit(12);
    if (search.trim()) query = query.ilike("nomor_reservasi", pattern);
    const { data, error } = await query;
    if (error) throw error;
    const ids = Array.from(new Set((data ?? []).map((row) => row.penyewa_id as string)));
    const { data: renters, error: renterError } = ids.length
      ? await supabase.from("penyewa").select("penyewa_id,nama_lengkap").eq("usaha_id", usahaId).in("penyewa_id", ids)
      : { data: [], error: null };
    if (renterError) throw renterError;
    const renterMap = new Map((renters ?? []).map((row) => [row.penyewa_id as string, row.nama_lengkap as string]));
    return (data ?? []).map((row) => ({
      id: row.reservasi_id as string,
      number: row.nomor_reservasi as string,
      renterName: renterMap.get(row.penyewa_id as string) ?? null,
      period: row.mulai_reservasi && row.selesai_reservasi ? formatPickerPeriod(String(row.mulai_reservasi), String(row.selesai_reservasi)) : null,
      meta: row.status ? "Status " + String(row.status) : null,
      type: "reservation" as const,
    }));
  }

  let query = supabase.from("penyewaan")
    .select("penyewaan_id,nomor_penyewaan,penyewa_id,jadwal_mulai,jadwal_kembali,status")
    .eq("usaha_id", usahaId)
    .order("jadwal_mulai", { ascending: false })
    .limit(12);
  if (search.trim()) query = query.ilike("nomor_penyewaan", pattern);
  const { data, error } = await query;
  if (error) throw error;
  const ids = Array.from(new Set((data ?? []).map((row) => row.penyewa_id as string)));
  const { data: renters, error: renterError } = ids.length
    ? await supabase.from("penyewa").select("penyewa_id,nama_lengkap").eq("usaha_id", usahaId).in("penyewa_id", ids)
    : { data: [], error: null };
  if (renterError) throw renterError;
  const renterMap = new Map((renters ?? []).map((row) => [row.penyewa_id as string, row.nama_lengkap as string]));
  return (data ?? []).map((row) => ({
    id: row.penyewaan_id as string,
    number: row.nomor_penyewaan as string,
    renterName: renterMap.get(row.penyewa_id as string) ?? null,
    period: row.jadwal_mulai && row.jadwal_kembali ? formatPickerPeriod(String(row.jadwal_mulai), String(row.jadwal_kembali)) : null,
    meta: row.status ? "Status " + String(row.status) : null,
    type: "rental" as const,
  }));
}

export async function listFinanceSuppliers(usahaId: string, search = "") {
  let query = supabase.from("pemasok").select("pemasok_id,nama").eq("usaha_id", usahaId).order("nama", { ascending: true }).limit(12);
  const clean = sanitizeFinanceSearch(search);
  if (clean) query = query.ilike("nama", "%" + clean + "%");
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.pemasok_id as string, name: row.nama as string }));
}

function formatPickerPeriod(start: string, end: string) {
  const fmt = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  return fmt.format(new Date(start)) + " → " + fmt.format(new Date(end));
}


export async function getFinanceSummary(
  usahaId: string,
  startDate: string,
  endDateExclusive: string,
): Promise<FinanceSummary> {
  const { data, error } = await supabase.rpc("finance_summary", {
    p_usaha_id: usahaId,
    p_start_date: startDate,
    p_end_date: endDateExclusive,
  });
  return normalizeFinancePeriod(assertFinanceRpcResult(data as (FinanceSummary & { period?: FinancePeriod }) | null, error, "Ringkasan keuangan"));
}

export async function getFinanceTransactionPage(
  usahaId: string,
  startDate: string,
  endDateExclusive: string,
  limit = 50,
  offset = 0,
): Promise<FinanceReportPage<FinanceTransaction>> {
  const { data, error } = await supabase.rpc("finance_transaction_page", {
    p_usaha_id: usahaId,
    p_start_date: startDate,
    p_end_date: endDateExclusive,
    p_limit: limit,
    p_offset: offset,
  });
  return normalizeFinancePeriod(assertFinanceRpcResult(data as (FinanceReportPage<FinanceTransaction> & { period?: FinancePeriod }) | null, error, "Daftar transaksi keuangan"));
}

export async function getFinancePaymentPage(
  usahaId: string,
  startDate: string,
  endDateExclusive: string,
  limit = 50,
  offset = 0,
): Promise<FinanceReportPage<FinancePayment>> {
  const { data, error } = await supabase.rpc("finance_payment_page", {
    p_usaha_id: usahaId,
    p_start_date: startDate,
    p_end_date: endDateExclusive,
    p_limit: limit,
    p_offset: offset,
  });
  return normalizeFinancePeriod(assertFinanceRpcResult(data as (FinanceReportPage<FinancePayment> & { period?: FinancePeriod }) | null, error, "Daftar pembayaran keuangan"));
}

export async function getFinanceExpensePage(
  usahaId: string,
  startDate: string,
  endDateExclusive: string,
  limit = 50,
  offset = 0,
): Promise<FinanceReportPage<FinanceExpense>> {
  const { data, error } = await supabase.rpc("finance_expense_page", {
    p_usaha_id: usahaId,
    p_start_date: startDate,
    p_end_date: endDateExclusive,
    p_limit: limit,
    p_offset: offset,
  });
  return normalizeFinancePeriod(assertFinanceRpcResult(data as (FinanceReportPage<FinanceExpense> & { period?: FinancePeriod }) | null, error, "Daftar pengeluaran keuangan"));
}

export async function getFinanceExpenseAnalysis(
  usahaId: string,
  startDate: string,
  endDateExclusive: string,
): Promise<FinanceExpenseAnalysis> {
  const { data, error } = await supabase.rpc("finance_expense_analysis", {
    p_usaha_id: usahaId,
    p_start_date: startDate,
    p_end_date: endDateExclusive,
  });
  return normalizeFinancePeriod(assertFinanceRpcResult(data as (FinanceExpenseAnalysis & { period?: FinancePeriod }) | null, error, "Analisis pengeluaran"));
}

export async function getFinanceProductRevenue(
  usahaId: string,
  startDate: string,
  endDateExclusive: string,
): Promise<FinanceProductRevenueReport> {
  const { data, error } = await supabase.rpc("finance_recorded_income_by_product", {
    p_usaha_id: usahaId,
    p_start_date: startDate,
    p_end_date: endDateExclusive,
  });
  return normalizeFinancePeriod(assertFinanceRpcResult(data as (FinanceProductRevenueReport & { period?: FinancePeriod }) | null, error, "Pendapatan per produk"));
}

export async function getFinanceUnitRevenue(
  usahaId: string,
  startDate: string,
  endDateExclusive: string,
): Promise<FinanceUnitRevenueReport> {
  const { data, error } = await supabase.rpc("finance_recorded_income_by_unit", {
    p_usaha_id: usahaId,
    p_start_date: startDate,
    p_end_date: endDateExclusive,
  });
  return normalizeFinancePeriod(assertFinanceRpcResult(data as (FinanceUnitRevenueReport & { period?: FinancePeriod }) | null, error, "Pendapatan per unit"));
}

export async function getFinanceHealth(usahaId: string): Promise<FinanceHealth> {
  const { data, error } = await supabase.rpc("finance_reconciliation", { p_usaha_id: usahaId });
  return assertFinanceRpcResult(data as FinanceHealth | null, error, "Health check keuangan");
}

export async function getFinanceReconciliationFindings(
  usahaId: string,
  limit = 100,
): Promise<FinanceReconciliationFindings> {
  const { data, error } = await supabase.rpc("finance_reconciliation_findings", {
    p_usaha_id: usahaId,
    p_limit: limit,
  });
  return assertFinanceRpcResult(data as FinanceReconciliationFindings | null, error, "Temuan rekonsiliasi keuangan");
}

export async function correctPayment(
  usahaId: string,
  paymentId: string,
  action: "void" | "reversal",
  reason: string,
  options: FinanceCommandOptions = {},
): Promise<FinanceCorrectionResult> {
  if (reason.trim().length < 5) throw new Error("Alasan koreksi minimal 5 karakter.");
  const { data, error } = await supabase.rpc("command_correct_payment", {
    p_usaha_id: usahaId,
    p_pembayaran_id: paymentId,
    p_action_type: action,
    p_reason: reason.trim(),
    p_idempotency_key: options.idempotencyKey ?? `correct-payment-${crypto.randomUUID()}`,
    p_request_id: options.requestId ?? newFinanceCommandRequestId(),
  });
  return assertFinanceRpcResult(data as FinanceCorrectionResult | null, error, "Koreksi pembayaran");
}

export async function correctExpense(
  usahaId: string,
  expenseId: string,
  action: "void" | "reversal",
  reason: string,
  options: FinanceCommandOptions = {},
): Promise<FinanceCorrectionResult> {
  if (reason.trim().length < 5) throw new Error("Alasan koreksi minimal 5 karakter.");
  const { data, error } = await supabase.rpc("command_correct_expense", {
    p_usaha_id: usahaId,
    p_pengeluaran_id: expenseId,
    p_action_type: action,
    p_reason: reason.trim(),
    p_idempotency_key: options.idempotencyKey ?? `correct-expense-${crypto.randomUUID()}`,
    p_request_id: options.requestId ?? newFinanceCommandRequestId(),
  });
  return assertFinanceRpcResult(data as FinanceCorrectionResult | null, error, "Koreksi pengeluaran");
}
