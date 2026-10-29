import { supabase } from "@/app/providers/supabase/client";
import {
  calculateRentalLateFee,
  listRentals,
} from "@/features/penyewaan/service";
import type { RentalLateFeeAssessment, RentalListItem } from "@/features/penyewaan/types";
import { localDateTimeToUtcIso } from "@/features/keuangan/utils";
import { getInvestorStakeholderHistory } from "@/features/investor/service";
import type {
  InvestorHistoryAllocation,
  InvestorHistoryCashSegregation,
  InvestorHistoryEntitlementTransfer,
  InvestorHistoryPayout,
  InvestorStakeholderHistory,
} from "@/features/investor/types";
import {
  getFinanceAccountSummary,
  getFinanceExpensePage,
  getFinanceHealth,
  getFinanceReconciliationFindings,
  getFinancePaymentPage,
  getFinanceProductRevenue,
  getFinanceSummary,
  getFinanceTransactionPage,
  getFinanceUnitRevenue,
  resolveExpenseRelations,
} from "@/features/keuangan/service";
import type {
  FinanceAccount,
  FinanceAccountMovement,
  FinanceAccountSummary,
  FinanceExpense,
  FinanceFinding,
  FinanceHealth,
  FinancePayment,
  FinancePeriod,
  FinanceProductRevenueReport,
  FinanceReconciliationFindings,
  FinanceSummary,
  FinanceTransaction,
  FinanceUnitRevenueReport,
} from "@/features/keuangan/types";

const EXPORT_ROW_LIMIT = 10000;
const REPORT_PAGE_SIZE = 200;
const RENTAL_PAGE_SIZE = 100;

const RENTAL_STATUS_LABELS: Record<string, string> = {
  draft: "Draf",
  prepared: "Disiapkan",
  ready_for_pickup: "Siap diambil",
  active: "Sedang disewa",
  due: "Jatuh tempo",
  late_within_tolerance: "Terlambat (masa toleransi)",
  tolerance_expired: "Masa toleransi habis",
  return_in_progress: "Proses pengembalian",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  confirmed: "Dikonfirmasi",
};

export function formatRentalStatus(status: string) {
  const normalized = String(status ?? "").trim().toLowerCase();
  return (RENTAL_STATUS_LABELS[normalized] ?? normalized.replace(/_/g, " ")) || "Tidak diketahui";
}

export function formatFinanceStatus(status: string) {
  const normalized = String(status ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    recorded: "Tercatat",
    pending: "Menunggu",
    voided: "Dibatalkan",
    reversed: "Dikoreksi",
    approved: "Disetujui",
    pending_review: "Menunggu review",
    rejected: "Ditolak",
    open: "Terbuka",
    closed: "Ditutup",
    settled: "Diselesaikan",
    unknown: "Tidak diketahui",
    active: "Aktif",
    inactive: "Nonaktif",
    partially_paid: "Dibayar sebagian",
    unpaid: "Belum dibayar",
    allocated: "Dialokasikan",
    calculated: "Dihitung",
    posted: "Tercatat",
    pending_settlement: "Menunggu penyelesaian",
  };
  return (labels[normalized] ?? normalized.replace(/_/g, " ")) || "Tidak diketahui";
}

export function formatFinanceDirection(direction: string) {
  const normalized = String(direction ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    income: "Masuk",
    expense: "Keluar",
    masuk: "Masuk",
    keluar: "Keluar",
  };
  return (labels[normalized] ?? normalized.replace(/_/g, " ")) || "Tidak diketahui";
}

export function formatFinanceKind(kind: string) {
  const normalized = String(kind ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    finance_reversal: "Koreksi transaksi keuangan",
    rental_payment: "Pembayaran penyewaan",
    payment: "Pembayaran",
    expense: "Pengeluaran",
    purchase: "Pembelian",
    maintenance: "Perawatan",
    opening_balance: "Saldo awal",
    investor_allocation_payout: "Pembayaran bagi hasil",
    allocation_payout: "Pembayaran hak bagi hasil",
    investor_self_transfer: "Pemindahan saldo investor",
    investor_account_transfer: "Transfer akun investor",
    cash_segregation: "Pemisahan kas",
  };
  return (labels[normalized] ?? normalized.replace(/_/g, " ")) || "Tidak diketahui";
}

export function formatFinanceSource(sourceType: string | null | undefined) {
  const normalized = String(sourceType ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    purchase: "Pembelian",
    pembelian: "Pembelian",
    rental: "Penyewaan",
    penyewaan: "Penyewaan",
    reservation: "Reservasi",
    reservasi: "Reservasi",
    payment: "Pembayaran",
    transfer_akun: "Transfer akun",
    investor_distribution: "Distribusi investor",
    investor_payout: "Pencairan investor",
    operator_withdrawal: "Penarikan pengelola",
    operator_withdrawal_payout: "Pencairan pengelola",
    investor_entitlement_transfer: "Alih hak alokasi investor",
    stakeholder_cash_segregation: "Pemisahan kas stakeholder",
    finance_correction: "Koreksi keuangan",
    manual: "Manual",
    operational: "Operasional",
    maintenance: "Perawatan",
    perawatan: "Perawatan",
    investor: "Investor",
    pengelola: "Pengelola",
    other: "Lainnya",
    other_source: "Sumber lain",
    unknown: "Tidak diketahui",
  };
  return (labels[normalized] ?? normalized.replace(/_/g, " ")) || "Tidak ditautkan";
}

export function formatPaymentKind(kind: string) {
  const normalized = String(kind ?? "").trim().toLowerCase();
  const labels: Record<string, string> = {
    dp: "Uang muka (DP)",
    pelunasan: "Pelunasan",
    additional: "Pembayaran tambahan",
    additional_payment: "Pembayaran tambahan",
    tambahan: "Pembayaran tambahan",
    late_fee: "Denda keterlambatan",
    damage: "Kerusakan",
    loss: "Kehilangan",
    missing_component: "Komponen hilang",
    other: "Lainnya",
  };
  return (labels[normalized] ?? normalized.replace(/_/g, " ")) || "Tidak diketahui";
}

export type FinanceCurrencySummary = {
  currency_code: string;
  recorded_income: number;
  recorded_expense: number;
  net_operational_movement: number;
  recorded_income_transaction_count: number;
  recorded_expense_transaction_count: number;
  recorded_payment_amount: number;
  recorded_payment_count: number;
  reversal_income_in_period: number;
  reversal_expense_in_period: number;
};

export type FinanceExpenseBreakdown = {
  currency_code: string;
  key: string;
  amount: number;
  count: number;
};

export type FinanceExportReport = {
  period: FinancePeriod;
  currencySummaries: FinanceCurrencySummary[];
  hasMultipleCurrencies: boolean;
  expenseByCategoryCurrency: FinanceExpenseBreakdown[];
  expenseBySupplierCurrency: FinanceExpenseBreakdown[];
  expenseBySourceCurrency: FinanceExpenseBreakdown[];
  summary: FinanceSummary;
  transactions: FinanceTransaction[];
  payments: FinancePayment[];
  expenses: Array<FinanceExpense & { transaction_status?: string }>;
  productRevenue: FinanceProductRevenueReport;
  unitRevenue: FinanceUnitRevenueReport;
  accounts: FinanceAccount[];
  unclassifiedAccounts: FinanceAccount[];
  accountMovements: FinanceAccountMovement[];
  stakeholderAccounts: InvestorStakeholderHistory["physical_accounts"];
  stakeholderAllocations: InvestorHistoryAllocation[];
  stakeholderPayouts: InvestorHistoryPayout[];
  stakeholderTransfers: InvestorHistoryEntitlementTransfer[];
  stakeholderCashSegregations: InvestorHistoryCashSegregation[];
  financeHealth: FinanceHealth;
  reconciliationFindings: FinanceFinding[];
};

export type RentalExportPayment = {
  pembayaran_id: string;
  penyewaan_id: string;
  nomor_penyewaan: string;
  nama_penyewa: string;
  nomor_pembayaran: string;
  jenis: string;
  metode: string;
  amount: number;
  currency_code: string;
  dibayar_at: string;
  status: string;
  reference_text: string | null;
  catatan: string | null;
  transaksi_keuangan_id: string;
};

export type RentalExportItem = RentalListItem & {
  recorded_payment_total: number;
  rental_base_payment_total: number;
  balance_due: number;
  overpaid_amount: number;
  late_fee_assessment: RentalLateFeeAssessment | null;
  approved_late_fee: number;
  pending_late_fee: number;
  late_fee_review_status: string;
  late_fee_review_count: number;
  payment_currency_mismatch_count: number;
  late_fee_currency_mismatch_count: number;
};

export type RentalCurrencySummary = {
  currency_code: string;
  rental_count: number;
  completed_count: number;
  active_count: number;
  draft_count: number;
  cancelled_count: number;
  contractual_value: number;
  recorded_payment_total: number;
  balance_due_total: number;
  overpaid_total: number;
  estimated_late_fee_total: number;
  approved_late_fee_total: number;
  pending_late_fee_total: number;
};

export type RentalExportReport = {
  period: FinancePeriod & { basis: string };
  currencySummaries: RentalCurrencySummary[];
  hasMultipleCurrencies: boolean;
  summary: {
    rental_count: number;
    completed_count: number;
    active_count: number;
    draft_count: number;
    cancelled_count: number;
    contractual_value: number;
    recorded_payment_total: number;
    balance_due_total: number;
    overpaid_total: number;
    estimated_late_fee_total: number;
    approved_late_fee_total: number;
    pending_late_fee_total: number;
  };
  items: RentalExportItem[];
  payments: RentalExportPayment[];
};

type FinancePage<T> = {
  start_date: string;
  end_date_exclusive: string;
  timezone: string;
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
};

function ensurePeriod(page: { start_date: string; end_date_exclusive: string }, startDate: string, endDateExclusive: string, label: string) {
  if (page.start_date !== startDate || page.end_date_exclusive !== endDateExclusive) {
    throw new Error("Laporan " + label + ": data dari periode berbeda; ekspor dibatalkan agar hasil tidak tercampur.");
  }
}

async function getAllFinanceRows<T>(
  label: string,
  startDate: string,
  endDateExclusive: string,
  loadPage: (limit: number, offset: number) => Promise<FinancePage<T>>,
): Promise<T[]> {
  const first = await loadPage(REPORT_PAGE_SIZE, 0);
  ensurePeriod(first, startDate, endDateExclusive, label);
  if (!Number.isInteger(first.limit) || first.limit < 1) {
    throw new Error("Laporan " + label + " tidak mengembalikan ukuran halaman yang valid.");
  }
  if (first.total > EXPORT_ROW_LIMIT) {
    throw new Error("Laporan " + label + " berisi lebih dari " + EXPORT_ROW_LIMIT.toLocaleString("id-ID") + " baris. Persempit rentang tanggal agar ekspor lengkap dan stabil.");
  }

  const rows = [...first.items];
  for (let offset = first.limit; offset < first.total; offset += first.limit) {
    const page = await loadPage(REPORT_PAGE_SIZE, offset);
    ensurePeriod(page, startDate, endDateExclusive, label);
    if (page.total !== first.total || page.limit !== first.limit) {
      throw new Error("Jumlah " + label + " berubah saat ekspor. Muat ulang laporan agar hasil konsisten.");
    }
    rows.push(...page.items);
  }

  if (rows.length !== first.total) {
    throw new Error("Laporan " + label + " tidak lengkap (" + rows.length + " dari " + first.total + " baris). Silakan muat ulang dan ekspor kembali.");
  }
  return rows;
}

export async function getFinanceExportReport(
  usahaId: string,
  startDate: string,
  endDateExclusive: string,
  includeSupportingDetails = true,
): Promise<FinanceExportReport> {
  if (!usahaId) throw new Error("Usaha aktif tidak ditemukan.");
  if (!(startDate < endDateExclusive)) throw new Error("Rentang tanggal laporan tidak valid.");

  const [summary, transactions, payments, rawExpenses] = await Promise.all([
    getFinanceSummary(usahaId, startDate, endDateExclusive),
    getAllFinanceRows("transaksi", startDate, endDateExclusive, (limit, offset) =>
      getFinanceTransactionPage(usahaId, startDate, endDateExclusive, limit, offset)),
    getAllFinanceRows("pembayaran", startDate, endDateExclusive, (limit, offset) =>
      getFinancePaymentPage(usahaId, startDate, endDateExclusive, limit, offset)),
    getAllFinanceRows("pengeluaran", startDate, endDateExclusive, (limit, offset) =>
      getFinanceExpensePage(usahaId, startDate, endDateExclusive, limit, offset)),
  ]);

  let expenses: FinanceExportReport["expenses"] = rawExpenses;
  if (includeSupportingDetails) {
    const expenseBatches: FinanceExpense[][] = [];
    for (let offset = 0; offset < rawExpenses.length; offset += REPORT_PAGE_SIZE) {
      expenseBatches.push(rawExpenses.slice(offset, offset + REPORT_PAGE_SIZE));
    }
    expenses = (await mapWithConcurrency(expenseBatches, 3, (batch) =>
      resolveExpenseRelations(usahaId, batch))).flat();
  }

  const supporting = includeSupportingDetails
    ? await Promise.all([
      getFinanceProductRevenue(usahaId, startDate, endDateExclusive),
      getFinanceUnitRevenue(usahaId, startDate, endDateExclusive),
      getFinanceAccountSummary(usahaId),
      getInvestorStakeholderHistory(usahaId),
      getFinanceHealth(usahaId),
      getFinanceReconciliationFindings(usahaId, 100),
    ] as const)
    : null;

  const productRevenue = supporting?.[0] ?? ({
    start_date: startDate,
    end_date_exclusive: endDateExclusive,
    timezone: summary.timezone,
    items: [],
    total_rental_or_reservation_income: 0,
    exact_attributable_income: 0,
    unallocated_income: 0,
    coverage_ratio: null,
    allocation_policy: "Rincian atribusi dimuat saat ekspor lengkap.",
  } as unknown as FinanceProductRevenueReport);
  const unitRevenue = supporting?.[1] ?? ({
    start_date: startDate,
    end_date_exclusive: endDateExclusive,
    timezone: summary.timezone,
    items: [],
    total_rental_income: 0,
    exact_unit_attributable_income: 0,
    unallocated_or_ambiguous_income: 0,
    coverage_ratio: null,
    allocation_policy: "Rincian atribusi dimuat saat ekspor lengkap.",
  } as unknown as FinanceUnitRevenueReport);
  const accountSummary = supporting?.[2] ?? ({
    accounts: [],
    totals: { saldo: 0, saldo_awal: 0, uang_masuk: 0, uang_keluar: 0 },
  } as FinanceAccountSummary);
  const stakeholderHistory = supporting?.[3] ?? ({
    status: "OK",
    principal: "admin",
    physical_accounts: [],
    allocations: [],
    payouts: [],
    entitlement_transfers: [],
    cash_segregations: [],
  } as InvestorStakeholderHistory);
  const financeHealth = supporting?.[4] ?? ({
    status: "ATTENTION",
    critical: {},
    attention: {},
    principle: "Pemeriksaan rekonsiliasi dimuat saat ekspor lengkap.",
  } as FinanceHealth);
  const reconciliationFindings: FinanceReconciliationFindings["items"] = supporting?.[5]?.items ?? [];

  [summary, productRevenue, unitRevenue].forEach((part, index) => {
    ensurePeriod(part, startDate, endDateExclusive, ["ringkasan", "pendapatan barang", "pendapatan unit"][index]);
  });

  // Keep financial totals separated by currency. The server-side legacy summary
  // sums amounts without a currency grouping, so it must not be used as a
  // cross-currency grand total in exports.
  const currencyMap = new Map<string, FinanceCurrencySummary>();
  const currencyRow = (currency: string) => {
    const code = (currency || "UNKNOWN").trim().toUpperCase();
    let row = currencyMap.get(code);
    if (!row) {
      row = {
        currency_code: code,
        recorded_income: 0,
        recorded_expense: 0,
        net_operational_movement: 0,
        recorded_income_transaction_count: 0,
        recorded_expense_transaction_count: 0,
        recorded_payment_amount: 0,
        recorded_payment_count: 0,
        reversal_income_in_period: 0,
        reversal_expense_in_period: 0,
      };
      currencyMap.set(code, row);
    }
    return row;
  };

  for (const transaction of transactions) {
    if (transaction.status !== "recorded") continue;
    const row = currencyRow(transaction.currency_code);
    const amount = Number(transaction.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    if (transaction.arah === "income") {
      row.recorded_income += amount;
      row.recorded_income_transaction_count += 1;
      if (transaction.jenis === "finance_reversal") row.reversal_income_in_period += amount;
    } else if (transaction.arah === "expense") {
      row.recorded_expense += amount;
      row.recorded_expense_transaction_count += 1;
      if (transaction.jenis === "finance_reversal") row.reversal_expense_in_period += amount;
    }
  }
  for (const expense of expenses) {
    if (expense.transaction_status === "recorded") currencyRow(expense.currency_code);
  }
  for (const payment of payments) {
    if (payment.status !== "recorded") continue;
    const row = currencyRow(payment.currency_code);
    const amount = Number(payment.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    row.recorded_payment_amount += amount;
    row.recorded_payment_count += 1;
  }
  const currencySummaries = Array.from(currencyMap.values())
    .map((row) => ({ ...row, net_operational_movement: row.recorded_income - row.recorded_expense }))
    .sort((left, right) => left.currency_code.localeCompare(right.currency_code));

  function groupExpenseRows(keyFor: (expense: FinanceExpense) => string) {
    const rows = new Map<string, FinanceExpenseBreakdown>();
    for (const expense of expenses) {
      if (expense.transaction_status !== "recorded") continue;
      const currency = (expense.currency_code || "UNKNOWN").trim().toUpperCase();
      const key = keyFor(expense);
      const groupKey = currency + "\\u0000" + key;
      const current = rows.get(groupKey) ?? { currency_code: currency, key, amount: 0, count: 0 };
      current.amount += Number(expense.amount ?? 0) || 0;
      current.count += 1;
      rows.set(groupKey, current);
    }
    return Array.from(rows.values()).sort((left, right) =>
      left.currency_code.localeCompare(right.currency_code) || right.amount - left.amount);
  }

  const expenseByCategoryCurrency = groupExpenseRows((expense) => expense.kategori_biaya || "Tanpa kategori");
  const expenseBySupplierCurrency = groupExpenseRows((expense) => expense.pemasok_nama || expense.pemasok_id || "Tanpa pemasok");
  const expenseBySourceCurrency = groupExpenseRows((expense) => expense.source_type || "Tanpa sumber");

  const accounts = accountSummary.accounts.filter((account) => account.fungsi_akun === "operasional");
  const unclassifiedAccounts = accountSummary.accounts.filter(
    (account) => !["operasional", "investor", "pengelola"].includes(account.fungsi_akun ?? "unknown"),
  );
  const accountMovements = includeSupportingDetails
    ? await getFinanceAccountMovements(usahaId, accounts, startDate, endDateExclusive, summary.timezone)
    : [];

  const periodStartAt = localDateTimeToUtcIso(startDate + "T00:00", summary.timezone);
  const periodEndAt = localDateTimeToUtcIso(endDateExclusive + "T00:00", summary.timezone);
  const periodStartMs = Date.parse(periodStartAt);
  const periodEndMs = Date.parse(periodEndAt);
  const inPeriodInstant = (value: string | null | undefined) => {
    if (!value) return false;
    const instant = Date.parse(value);
    return Number.isFinite(instant) && instant >= periodStartMs && instant < periodEndMs;
  };

  if (includeSupportingDetails && (stakeholderHistory.status !== "OK" || stakeholderHistory.principal !== "admin")) {
    throw new Error("Riwayat alokasi/pembayaran investor tidak dapat diverifikasi sebagai data admin. Ekspor dibatalkan agar laporan keuangan tidak tampak lengkap padahal sebagian data hilang.");
  }

  const stakeholderAllocations = stakeholderHistory.allocations.filter(
    (item) => item.period_start >= startDate && item.period_start < endDateExclusive,
  );
  const stakeholderPayouts = stakeholderHistory.payouts.filter((item) => item.status === "recorded" && inPeriodInstant(item.paid_at));
  const stakeholderTransfers = stakeholderHistory.entitlement_transfers.filter((item) => item.status === "recorded" && inPeriodInstant(item.transferred_at));
  const stakeholderCashSegregations = stakeholderHistory.cash_segregations.filter((item) => inPeriodInstant(item.occurred_at));
  const stakeholderRecordCounts = [
    ["alokasi bagi hasil", stakeholderAllocations.length],
    ["payout investor/pengelola", stakeholderPayouts.length],
    ["alih hak alokasi", stakeholderTransfers.length],
    ["pemisahan kas", stakeholderCashSegregations.length],
  ] as const;
  const oversizedStakeholderSection = stakeholderRecordCounts.find(([, count]) => count > EXPORT_ROW_LIMIT);
  if (oversizedStakeholderSection) {
    throw new Error("Detail " + oversizedStakeholderSection[0] + " melebihi " + EXPORT_ROW_LIMIT.toLocaleString("id-ID") + " baris. Persempit periode laporan.");
  }

  return {
    period: {
      start_date: summary.start_date,
      end_date_exclusive: summary.end_date_exclusive,
      timezone: summary.timezone,
    },
    currencySummaries,
    hasMultipleCurrencies: currencySummaries.length > 1,
    expenseByCategoryCurrency,
    expenseBySupplierCurrency,
    expenseBySourceCurrency,
    summary,
    transactions,
    payments,
    expenses,
    productRevenue,
    unitRevenue,
    accounts,
    unclassifiedAccounts,
    accountMovements,
    stakeholderAccounts: stakeholderHistory.physical_accounts,
    stakeholderAllocations,
    stakeholderPayouts,
    stakeholderTransfers,
    stakeholderCashSegregations,
    financeHealth,
    reconciliationFindings,
  };
}

async function getFinanceAccountMovements(
  usahaId: string,
  accounts: FinanceAccount[],
  startDate: string,
  endDateExclusive: string,
  timeZone: string,
): Promise<FinanceAccountMovement[]> {
  const accountIds = accounts.map((account) => account.akun_keuangan_id);
  if (!accountIds.length) return [];

  const startAt = localDateTimeToUtcIso(startDate + "T00:00", timeZone);
  const endAt = localDateTimeToUtcIso(endDateExclusive + "T00:00", timeZone);
  const loadPage = async (offset: number) => {
    const { data, error, count } = await supabase
      .from("pergerakan_akun_keuangan")
      .select("pergerakan_akun_keuangan_id,akun_keuangan_id,transaksi_keuangan_id,arah,amount,mata_uang,terjadi_at,sumber_type,sumber_id,status,dicatat_by_admin_id,dicatat_by_investor_id,request_id,catatan", { count: "exact" })
      .eq("usaha_id", usahaId)
      .in("akun_keuangan_id", accountIds)
      .eq("status", "recorded")
      .gte("terjadi_at", startAt)
      .lt("terjadi_at", endAt)
      .order("terjadi_at", { ascending: true })
      .order("pergerakan_akun_keuangan_id", { ascending: true })
      .range(offset, offset + REPORT_PAGE_SIZE - 1);
    if (error) throw error;
    return {
      rows: (data ?? []) as FinanceAccountMovement[],
      total: count ?? 0,
    };
  };

  const first = await loadPage(0);
  if (first.total > EXPORT_ROW_LIMIT) {
    throw new Error("Mutasi akun operasional berisi lebih dari " + EXPORT_ROW_LIMIT.toLocaleString("id-ID") + " baris. Persempit rentang tanggal agar ekspor lengkap.");
  }
  const rows = [...first.rows];
  for (let offset = first.rows.length; offset < first.total; offset += REPORT_PAGE_SIZE) {
    const next = await loadPage(offset);
    if (next.total !== first.total) {
      throw new Error("Jumlah mutasi akun berubah saat ekspor. Muat ulang laporan agar hasil konsisten.");
    }
    rows.push(...next.rows);
  }
  if (rows.length !== first.total) {
    throw new Error("Mutasi akun operasional tidak lengkap; ekspor dibatalkan untuk menghindari laporan terpotong.");
  }
  return rows;
}


function shiftIsoDate(value: string, days: number) {
  const date = new Date(value + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let index = 0;
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) return;
      output[currentIndex] = await task(items[currentIndex]);
    }
  }));
  return output;
}

async function getCompleteRentalRelatedRows<T>(
  label: string,
  loadPage: (offset: number) => Promise<{ rows: T[]; total: number }>,
): Promise<T[]> {
  const first = await loadPage(0);
  if (first.total > EXPORT_ROW_LIMIT) {
    throw new Error("Detail " + label + " berisi lebih dari " + EXPORT_ROW_LIMIT.toLocaleString("id-ID") + " baris. Persempit periode laporan.");
  }
  const rows = [...first.rows];
  while (rows.length < first.total) {
    const next = await loadPage(rows.length);
    if (next.total !== first.total) {
      throw new Error("Jumlah " + label + " berubah saat ekspor. Muat ulang laporan agar hasil konsisten.");
    }
    if (!next.rows.length) break;
    rows.push(...next.rows);
  }
  if (rows.length !== first.total) {
    throw new Error("Detail " + label + " tidak lengkap; ekspor dibatalkan agar data tidak terpotong.");
  }
  return rows;
}

export async function getRentalExportReport(
  usahaId: string,
  startDate: string,
  endDateExclusive: string,
  timeZone = "Asia/Jakarta",
): Promise<RentalExportReport> {
  if (!usahaId) throw new Error("Usaha aktif tidak ditemukan.");
  if (!(startDate < endDateExclusive)) throw new Error("Rentang tanggal laporan tidak valid.");

  const dateTo = shiftIsoDate(endDateExclusive, -1);
  const filters = {
    search: "",
    status: "all",
    dateFrom: startDate,
    dateTo,
    renterSearch: "",
    page: 1,
    pageSize: RENTAL_PAGE_SIZE,
  };
  const first = await listRentals(usahaId, filters, timeZone);
  if (first.total > EXPORT_ROW_LIMIT) {
    throw new Error("Laporan penyewaan berisi lebih dari " + EXPORT_ROW_LIMIT.toLocaleString("id-ID") + " baris. Persempit rentang tanggal agar ekspor lengkap.");
  }

  const rentals: RentalListItem[] = [...first.rentals];
  for (let page = 2; rentals.length < first.total; page += 1) {
    const result = await listRentals(usahaId, { ...filters, page }, timeZone);
    if (result.total !== first.total) {
      throw new Error("Jumlah penyewaan berubah saat ekspor. Muat ulang laporan agar hasil konsisten.");
    }
    if (!result.rentals.length) break;
    rentals.push(...result.rentals);
  }
  if (rentals.length !== first.total) {
    throw new Error("Daftar penyewaan tidak lengkap (" + rentals.length + " dari " + first.total + " baris). Silakan muat ulang dan ekspor kembali.");
  }

  const rentalIds = rentals.map((rental) => rental.penyewaan_id);
  const rentalIdBatches: string[][] = [];
  for (let offset = 0; offset < rentalIds.length; offset += 200) {
    rentalIdBatches.push(rentalIds.slice(offset, offset + 200));
  }
  const [paymentBatches, reviewBatches] = rentalIdBatches.length
    ? await Promise.all([
      mapWithConcurrency(rentalIdBatches, 3, async (ids) =>
        getCompleteRentalRelatedRows("pembayaran penyewaan", async (offset) => {
          const result = await supabase
            .from("pembayaran")
            .select("pembayaran_id,usaha_id,penyewaan_id,nomor_pembayaran,jenis,metode,amount,currency_code,status,dibayar_at,reference_text,catatan,transaksi_keuangan_id", { count: "exact" })
            .eq("usaha_id", usahaId)
            .in("penyewaan_id", ids)
            .eq("status", "recorded")
            .order("dibayar_at", { ascending: true })
            .order("pembayaran_id", { ascending: true })
            .range(offset, offset + REPORT_PAGE_SIZE - 1);
          if (result.error) throw result.error;
          return { rows: result.data ?? [], total: result.count ?? 0 };
        })),
      mapWithConcurrency(rentalIdBatches, 3, async (ids) =>
        getCompleteRentalRelatedRows("review denda penyewaan", async (offset) => {
          const result = await supabase
            .from("evaluasi_konsekuensi_penyewaan")
            .select("evaluasi_konsekuensi_id,usaha_id,penyewaan_id,jenis_konsekuensi,nominal_kandidat,nominal_disetujui,currency_code,status,created_at", { count: "exact" })
            .eq("usaha_id", usahaId)
            .in("penyewaan_id", ids)
            .eq("jenis_konsekuensi", "late_fee")
            .order("created_at", { ascending: true })
            .order("evaluasi_konsekuensi_id", { ascending: true })
            .range(offset, offset + REPORT_PAGE_SIZE - 1);
          if (result.error) throw result.error;
          return { rows: result.data ?? [], total: result.count ?? 0 };
        })),
    ])
    : [[], []];
  const paymentRows = paymentBatches.flat();
  const reviewRows = reviewBatches.flat();

  const rentalById = new Map(rentals.map((rental) => [rental.penyewaan_id, rental]));
  const rentalPayments = paymentRows.flatMap((payment) => {
    const rentalId = payment.penyewaan_id as string | null;
    if (!rentalId) return [];
    const rental = rentalById.get(rentalId);
    if (!rental) return [];
    return [{
      pembayaran_id: String(payment.pembayaran_id),
      penyewaan_id: rentalId,
      nomor_penyewaan: rental.nomor_penyewaan,
      nama_penyewa: rental.penyewa_nama ?? "Nama tidak tersedia",
      nomor_pembayaran: String(payment.nomor_pembayaran ?? "-"),
      jenis: String(payment.jenis ?? "-"),
      metode: String(payment.metode ?? "-"),
      amount: Number(payment.amount ?? 0),
      currency_code: String(payment.currency_code ?? rental.currency_code ?? "IDR"),
      dibayar_at: String(payment.dibayar_at ?? ""),
      status: String(payment.status ?? "-"),
      reference_text: (payment.reference_text as string | null) ?? null,
      catatan: (payment.catatan as string | null) ?? null,
      transaksi_keuangan_id: String(payment.transaksi_keuangan_id ?? ""),
    }];
  });

  const paymentsByRental = new Map<string, Array<{ amount: number; jenis: string; currencyCode: string }>>();
  for (const payment of paymentRows) {
    const rentalId = payment.penyewaan_id as string | null;
    if (!rentalId) continue;
    const rows = paymentsByRental.get(rentalId) ?? [];
    rows.push({
      amount: Number(payment.amount ?? 0),
      jenis: String(payment.jenis ?? ""),
      currencyCode: String(payment.currency_code ?? "IDR").toUpperCase(),
    });
    paymentsByRental.set(rentalId, rows);
  }

  const reviewsByRental = new Map<string, Array<{ amountCandidate: number; amountApproved: number; status: string; currencyCode: string }>>();
  for (const review of reviewRows) {
    const rentalId = review.penyewaan_id as string;
    const rows = reviewsByRental.get(rentalId) ?? [];
    rows.push({
      amountCandidate: Number(review.nominal_kandidat ?? 0),
      amountApproved: Number(review.nominal_disetujui ?? 0),
      status: String(review.status ?? "unknown"),
      currencyCode: String(review.currency_code ?? "IDR").toUpperCase(),
    });
    reviewsByRental.set(rentalId, rows);
  }

  const reportEvaluationInstant = Date.now();
  const items = await mapWithConcurrency(rentals, 6, async (rental): Promise<RentalExportItem> => {
    const paymentRows = paymentsByRental.get(rental.penyewaan_id) ?? [];
    const rentalCurrency = String(rental.currency_code ?? "IDR").toUpperCase();
    const currencyPayments = paymentRows.filter((payment) => payment.currencyCode === rentalCurrency);
    const rentalBasePaymentTotal = sum(currencyPayments
      .filter((payment) => payment.jenis === "dp" || payment.jenis === "pelunasan")
      .map((payment) => payment.amount));
    const recordedPaymentTotal = sum(currencyPayments.map((payment) => payment.amount));
    const reviewRows = reviewsByRental.get(rental.penyewaan_id) ?? [];
    const currencyReviews = reviewRows.filter((row) => row.currencyCode === rentalCurrency);
    const approvedLateFee = sum(currencyReviews.filter((row) => row.status === "approved").map((row) => row.amountApproved));
    const pendingLateFee = sum(currencyReviews.filter((row) => row.status === "pending_review").map((row) => row.amountCandidate));
    const statuses = Array.from(new Set(reviewRows.map((row) => row.status)));
    const feeStatus = statuses.length === 0 ? "Belum ada review" : statuses.map((status) => ({
      pending_review: "Menunggu review",
      approved: "Disetujui",
      rejected: "Ditolak",
    }[status] ?? status)).join(" / ");

    let assessment: RentalLateFeeAssessment | null = null;
    const openRental =
      rental.status === "active" ||
      rental.status === "return_in_progress";
    const scheduledReturnMs = Date.parse(rental.jadwal_kembali);
    const potentiallyLate =
      !Number.isFinite(scheduledReturnMs) ||
      scheduledReturnMs < reportEvaluationInstant;
    // Avoid an RPC per completed rental. Completed rentals use their recorded
    // approval/review trail; recalculate only still-open rentals past schedule.
    if (openRental && potentiallyLate) {
      assessment = await calculateRentalLateFee(usahaId, rental.penyewaan_id);
    }

    const totalAmount = Math.max(0, Number(rental.total_amount) || 0);
    return {
      ...rental,
      recorded_payment_total: recordedPaymentTotal,
      rental_base_payment_total: rentalBasePaymentTotal,
      balance_due: Math.max(0, totalAmount - rentalBasePaymentTotal),
      overpaid_amount: Math.max(0, rentalBasePaymentTotal - totalAmount),
      late_fee_assessment: assessment,
      approved_late_fee: approvedLateFee,
      pending_late_fee: pendingLateFee,
      late_fee_review_status: feeStatus,
      late_fee_review_count: reviewRows.length,
      payment_currency_mismatch_count: paymentRows.filter((payment) => payment.currencyCode !== rentalCurrency).length,
      late_fee_currency_mismatch_count: reviewRows.filter((row) => row.currencyCode !== rentalCurrency).length,
    };
  });

  const contractedItems = items.filter((item) => item.status !== "cancelled" && item.status !== "draft");
  const activeStatuses = new Set(["active", "return_in_progress", "ready_for_pickup", "confirmed"]);
  const summary = {
    rental_count: items.length,
    completed_count: items.filter((item) => item.status === "completed").length,
    active_count: items.filter((item) => activeStatuses.has(item.status)).length,
    draft_count: items.filter((item) => item.status === "draft").length,
    cancelled_count: items.filter((item) => item.status === "cancelled").length,
    contractual_value: sum(contractedItems.map((item) => Math.max(0, Number(item.total_amount) || 0))),
    recorded_payment_total: sum(items.map((item) => item.recorded_payment_total)),
    balance_due_total: sum(contractedItems.map((item) => item.balance_due)),
    overpaid_total: sum(contractedItems.map((item) => item.overpaid_amount)),
    estimated_late_fee_total: sum(contractedItems.map((item) => Number(item.late_fee_assessment?.amount ?? 0))),
    approved_late_fee_total: sum(contractedItems.map((item) => item.approved_late_fee)),
    pending_late_fee_total: sum(contractedItems.map((item) => item.pending_late_fee)),
  };

  const rentalCurrencyMap = new Map<string, RentalCurrencySummary>();
  const rentalCurrencyRow = (currencyCode: string) => {
    const code = String(currencyCode || "UNKNOWN").toUpperCase();
    let row = rentalCurrencyMap.get(code);
    if (!row) {
      row = {
        currency_code: code,
        rental_count: 0,
        completed_count: 0,
        active_count: 0,
        draft_count: 0,
        cancelled_count: 0,
        contractual_value: 0,
        recorded_payment_total: 0,
        balance_due_total: 0,
        overpaid_total: 0,
        estimated_late_fee_total: 0,
        approved_late_fee_total: 0,
        pending_late_fee_total: 0,
      };
      rentalCurrencyMap.set(code, row);
    }
    return row;
  };
  for (const item of items) {
    const currency = String(item.currency_code ?? "IDR").toUpperCase();
    const row = rentalCurrencyRow(currency);
    row.rental_count += 1;
    if (item.status === "completed") row.completed_count += 1;
    if (activeStatuses.has(item.status)) row.active_count += 1;
    if (item.status === "draft") row.draft_count += 1;
    if (item.status === "cancelled") row.cancelled_count += 1;
    if (item.status !== "cancelled" && item.status !== "draft") {
      row.contractual_value += Math.max(0, Number(item.total_amount) || 0);
      row.balance_due_total += item.balance_due;
      row.overpaid_total += item.overpaid_amount;
      row.estimated_late_fee_total += Number(item.late_fee_assessment?.amount ?? 0);
      row.approved_late_fee_total += item.approved_late_fee;
      row.pending_late_fee_total += item.pending_late_fee;
    }
  }
  for (const payment of rentalPayments) {
    const row = rentalCurrencyRow(payment.currency_code);
    row.recorded_payment_total += payment.amount;
  }
  const currencySummaries = Array.from(rentalCurrencyMap.values())
    .sort((left, right) => left.currency_code.localeCompare(right.currency_code));

  return {
    period: {
      start_date: startDate,
      end_date_exclusive: endDateExclusive,
      timezone: timeZone,
      basis: "Periode berdasarkan tanggal mulai jadwal penyewaan. Pembayaran yang ditampilkan adalah pembayaran tercatat sepanjang waktu untuk penyewaan yang masuk periode ini.",
    },
    currencySummaries,
    hasMultipleCurrencies: currencySummaries.length > 1,
    summary,
    items,
    payments: rentalPayments,
  };
}
