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
  rental_income: number;
  retail_income: number;
  other_income: number;
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

export type FinanceExportSale = {
  penjualan_id: string;
  nomor_penjualan: string;
  source: string;
  nama_pelanggan: string | null;
  nomor_telepon: string | null;
  status: string;
  payment_status: string;
  total_amount: number;
  total_hpp: number | null;
  gross_profit: number | null;
  created_at: string;
  currency_code: string;
  item_count: number;
  quantity: number;
  known_hpp: number;
  gross_profit_known: number;
  hpp_unknown_lines: number;
};

export type FinanceExportSaleLine = {
  detail_penjualan_id: string;
  penjualan_id: string;
  nomor_penjualan: string;
  tanggal_transaksi: string;
  barang_id: string;
  varian_barang_id: string | null;
  nama_barang: string;
  nama_varian: string | null;
  inventory_mode: string;
  jumlah: number;
  harga_normal: number;
  diskon_persen: number;
  nominal_diskon: number;
  unit_price: number;
  subtotal: number;
  harga_beli_satuan: number | null;
  hpp_total: number | null;
  gross_profit_known: number | null;
  currency_code: string;
  promosi_katalog_id: string | null;
  is_bonus_rental: boolean;
  bonus_reason: string | null;
};

export type FinanceExportPurchase = {
  pembelian_id: string;
  nomor_pembelian: string;
  tanggal_pembelian: string;
  status: string;
  pemasok_id: string | null;
  nama_pemasok: string;
  total_amount: number;
  currency_code: string;
  catatan: string | null;
  item_count: number;
  received_quantity: number;
  received_stock_value: number;
  cash_out_amount: number;
};

export type FinanceExportPurchaseLine = {
  detail_pembelian_id: string;
  pembelian_id: string;
  nomor_pembelian: string;
  barang_id: string;
  varian_barang_id: string | null;
  deskripsi: string | null;
  jumlah: number;
  unit_price: number;
  subtotal: number;
  received_quantity: number;
  inventory_mode_snapshot: string | null;
  currency_code: string;
};

export type FinanceExportReceipt = {
  penerimaan_pembelian_id: string;
  pembelian_id: string;
  nomor_pembelian: string;
  nomor_penerimaan: string;
  status: string;
  received_at: string;
  received_quantity: number;
  received_stock_value: number;
};

export type FinanceExportReceiptLine = {
  detail_penerimaan_pembelian_id: string;
  penerimaan_pembelian_id: string;
  pembelian_id: string;
  nomor_penerimaan: string;
  nomor_pembelian: string;
  detail_pembelian_id: string;
  barang_id: string;
  varian_barang_id: string | null;
  inventory_mode: string;
  quantity_received: number;
  unit_cost: number;
  subtotal_cost: number;
  currency_code: string;
};

export type FinanceExportPromotionUse = {
  tanggal: string;
  sumber: "Penjualan" | "Penyewaan";
  nomor_transaksi: string;
  jenis_promo: string;
  promo_id: string | null;
  barang_paket: string;
  jumlah: number;
  mata_uang: string;
  harga_normal: number;
  diskon: number;
  nilai_akhir: number;
  hpp_bonus: number | null;
  catatan: string | null;
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
  retailSales: FinanceExportSale[];
  retailSaleLines: FinanceExportSaleLine[];
  purchases: FinanceExportPurchase[];
  purchaseLines: FinanceExportPurchaseLine[];
  purchaseReceipts: FinanceExportReceipt[];
  purchaseReceiptLines: FinanceExportReceiptLine[];
  promotionUsage: FinanceExportPromotionUse[];
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


type ExportRowsPage<T> = { rows: T[]; total: number };

async function readCompleteRows<T>(
  label: string,
  loadPage: (offset: number) => Promise<ExportRowsPage<T>>,
): Promise<T[]> {
  return getCompleteRentalRelatedRows(label, loadPage);
}

async function readRowsForIds<T>(
  label: string,
  ids: string[],
  loadBatch: (batch: string[], offset: number) => Promise<ExportRowsPage<T>>,
): Promise<T[]> {
  if (!ids.length) return [];
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    batches.push(ids.slice(offset, offset + 200));
  }
  const results = await mapWithConcurrency(batches, 3, async (batch) =>
    readCompleteRows(label, (offset) => loadBatch(batch, offset)));
  return results.flat();
}

async function loadFinanceOperationalExports(
  usahaId: string,
  startDate: string,
  endDateExclusive: string,
  timeZone: string,
) {
  const startAt = localDateTimeToUtcIso(startDate + "T00:00", timeZone);
  const endAt = localDateTimeToUtcIso(endDateExclusive + "T00:00", timeZone);

  const salesRaw = await readCompleteRows("penjualan retail", async (offset) => {
    const result = await supabase
      .from("penjualan")
      .select("penjualan_id,usaha_id,nomor_penjualan,source,nama_pelanggan,nomor_telepon,status,payment_status,total_amount,total_hpp,gross_profit,currency_code,created_at", { count: "exact" })
      .eq("usaha_id", usahaId)
      .gte("created_at", startAt)
      .lt("created_at", endAt)
      .order("created_at", { ascending: true })
      .order("penjualan_id", { ascending: true })
      .range(offset, offset + REPORT_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    return { rows: result.data ?? [], total: result.count ?? 0 };
  });

  const saleIds = salesRaw.map((row) => String(row.penjualan_id));
  const saleLineRaw = await readRowsForIds("rincian penjualan retail", saleIds, async (ids, offset) => {
    const result = await supabase
      .from("detail_penjualan")
      .select("detail_penjualan_id,usaha_id,penjualan_id,barang_id,varian_barang_id,nama_barang_snapshot,nama_varian_snapshot,inventory_mode,jumlah,unit_price,subtotal,currency_code,harga_beli_satuan,hpp_total,promosi_katalog_id,harga_normal_snapshot,diskon_persen_snapshot,nominal_diskon_snapshot,is_bonus_rental,bonus_reason", { count: "exact" })
      .eq("usaha_id", usahaId)
      .in("penjualan_id", ids)
      .order("penjualan_id", { ascending: true })
      .order("detail_penjualan_id", { ascending: true })
      .range(offset, offset + REPORT_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    return { rows: result.data ?? [], total: result.count ?? 0 };
  });

  const salesById = new Map(salesRaw.map((sale) => [String(sale.penjualan_id), sale]));
  const saleLines: FinanceExportSaleLine[] = saleLineRaw.map((line) => {
    const sale = salesById.get(String(line.penjualan_id));
    const quantity = Number(line.jumlah ?? 0);
    const subtotal = Number(line.subtotal ?? 0);
    const discount = Number(line.nominal_diskon_snapshot ?? 0);
    const hpp = line.hpp_total == null ? null : Number(line.hpp_total);
    return {
      detail_penjualan_id: String(line.detail_penjualan_id),
      penjualan_id: String(line.penjualan_id),
      nomor_penjualan: String(sale?.nomor_penjualan ?? "-"),
      tanggal_transaksi: String(sale?.created_at ?? ""),
      barang_id: String(line.barang_id),
      varian_barang_id: line.varian_barang_id == null ? null : String(line.varian_barang_id),
      nama_barang: String(line.nama_barang_snapshot ?? "Barang"),
      nama_varian: line.nama_varian_snapshot == null ? null : String(line.nama_varian_snapshot),
      inventory_mode: String(line.inventory_mode ?? "unknown"),
      jumlah: quantity,
      harga_normal: Number(line.harga_normal_snapshot ?? line.unit_price ?? 0),
      diskon_persen: Number(line.diskon_persen_snapshot ?? 0),
      nominal_diskon: discount,
      unit_price: Number(line.unit_price ?? 0),
      subtotal,
      harga_beli_satuan: line.harga_beli_satuan == null ? null : Number(line.harga_beli_satuan),
      hpp_total: hpp,
      gross_profit_known: hpp == null ? null : subtotal - hpp,
      currency_code: String(line.currency_code ?? sale?.currency_code ?? "IDR").trim(),
      promosi_katalog_id: line.promosi_katalog_id == null ? null : String(line.promosi_katalog_id),
      is_bonus_rental: Boolean(line.is_bonus_rental),
      bonus_reason: line.bonus_reason == null ? null : String(line.bonus_reason),
    };
  });

  const retailSales: FinanceExportSale[] = salesRaw.map((sale) => {
    const saleLinesForHeader = saleLines.filter((line) => line.penjualan_id === String(sale.penjualan_id));
    const knownLines = saleLinesForHeader.filter((line) => line.hpp_total != null);
    const unknownLines = saleLinesForHeader.filter((line) => line.hpp_total == null);
    const knownHpp = knownLines.reduce((total, line) => total + (line.hpp_total ?? 0), 0);
    const grossProfitKnown = knownLines.reduce((total, line) => total + (line.gross_profit_known ?? 0), 0);
    return {
      penjualan_id: String(sale.penjualan_id),
      nomor_penjualan: String(sale.nomor_penjualan),
      source: String(sale.source ?? "pos"),
      nama_pelanggan: sale.nama_pelanggan == null ? null : String(sale.nama_pelanggan),
      nomor_telepon: sale.nomor_telepon == null ? null : String(sale.nomor_telepon),
      status: String(sale.status ?? "unknown"),
      payment_status: String(sale.payment_status ?? "unknown"),
      total_amount: Number(sale.total_amount ?? 0),
      total_hpp: sale.total_hpp == null ? null : Number(sale.total_hpp),
      gross_profit: sale.gross_profit == null ? null : Number(sale.gross_profit),
      created_at: String(sale.created_at ?? ""),
      currency_code: String(sale.currency_code ?? "IDR").trim(),
      item_count: saleLinesForHeader.length,
      quantity: saleLinesForHeader.reduce((total, line) => total + line.jumlah, 0),
      known_hpp: knownHpp,
      gross_profit_known: grossProfitKnown,
      hpp_unknown_lines: unknownLines.length,
    };
  });

  const purchaseRaw = await readCompleteRows("dokumen pembelian", async (offset) => {
    const result = await supabase
      .from("pembelian")
      .select("pembelian_id,usaha_id,pemasok_id,nomor_pembelian,tanggal_pembelian,status,total_amount,currency_code,catatan,created_at,updated_at", { count: "exact" })
      .eq("usaha_id", usahaId)
      .gte("tanggal_pembelian", startDate)
      .lt("tanggal_pembelian", endDateExclusive)
      .order("tanggal_pembelian", { ascending: true })
      .order("pembelian_id", { ascending: true })
      .range(offset, offset + REPORT_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    return { rows: result.data ?? [], total: result.count ?? 0 };
  });
  const purchaseIds = purchaseRaw.map((row) => String(row.pembelian_id));
  const purchaseLineRaw = await readRowsForIds("rincian pembelian", purchaseIds, async (ids, offset) => {
    const result = await supabase
      .from("detail_pembelian")
      .select("detail_pembelian_id,usaha_id,pembelian_id,barang_id,varian_barang_id,deskripsi,jumlah,unit_price,subtotal", { count: "exact" })
      .eq("usaha_id", usahaId)
      .in("pembelian_id", ids)
      .order("pembelian_id", { ascending: true })
      .order("detail_pembelian_id", { ascending: true })
      .range(offset, offset + REPORT_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    return { rows: result.data ?? [], total: result.count ?? 0 };
  });
  const purchaseById = new Map(purchaseRaw.map((purchase) => [String(purchase.pembelian_id), purchase]));
  const purchaseLines: FinanceExportPurchaseLine[] = purchaseLineRaw.map((line) => {
    const purchase = purchaseById.get(String(line.pembelian_id));
    return {
      detail_pembelian_id: String(line.detail_pembelian_id),
      pembelian_id: String(line.pembelian_id),
      nomor_pembelian: String(purchase?.nomor_pembelian ?? "-"),
      barang_id: String(line.barang_id),
      varian_barang_id: line.varian_barang_id == null ? null : String(line.varian_barang_id),
      deskripsi: line.deskripsi == null ? null : String(line.deskripsi),
      jumlah: Number(line.jumlah ?? 0),
      unit_price: Number(line.unit_price ?? 0),
      subtotal: Number(line.subtotal ?? 0),
      // Receiving facts are sourced from the immutable receiving ledger below,
      // not from detail_pembelian (those mutable snapshot columns were removed).
      received_quantity: 0,
      inventory_mode_snapshot: null,
      currency_code: String(purchase?.currency_code ?? "IDR").trim(),
    };
  });

  // Receiving tables are intentionally private (no direct authenticated SELECT).
  // Use the tenant/admin-guarded RPC instead of querying those raw tables through PostgREST.
  type PurchaseReceivingSummary = {
    state?: string;
    penerimaan_pembelian_id?: string;
    nomor_penerimaan?: string;
    status?: string;
    received_at?: string;
    details?: Array<{
      detail_penerimaan_pembelian_id: string;
      detail_pembelian_id: string;
      barang_id: string;
      varian_barang_id: string | null;
      inventory_mode: string;
      quantity_received: number;
      unit_cost: number;
      subtotal_cost: number;
    }>;
  };
  const receivingSummaries = await mapWithConcurrency(purchaseIds, 4, async (pembelianId) => {
    const result = await supabase.rpc("get_purchase_receiving_summary", {
      p_usaha_id: usahaId,
      p_pembelian_id: pembelianId,
    });
    if (result.error) throw result.error;
    return {
      pembelian_id: pembelianId,
      summary: (result.data ?? { state: "not_received" }) as PurchaseReceivingSummary,
    };
  });
  const receiptsRaw = receivingSummaries
    .filter(({ summary }) => summary.state === "received" && summary.penerimaan_pembelian_id)
    .map(({ pembelian_id, summary }) => ({
      penerimaan_pembelian_id: String(summary.penerimaan_pembelian_id),
      pembelian_id,
      nomor_penerimaan: String(summary.nomor_penerimaan ?? "-"),
      status: String(summary.status ?? "unknown"),
      received_at: String(summary.received_at ?? ""),
    }));
  const receiptLineRaw = receivingSummaries.flatMap(({ pembelian_id, summary }) => {
    const receipt = receiptsRaw.find((item) => item.pembelian_id === pembelian_id);
    if (!receipt) return [];
    return (summary.details ?? []).map((detail) => ({
      ...detail,
      penerimaan_pembelian_id: receipt.penerimaan_pembelian_id,
    }));
  });
  const receiptById = new Map(receiptsRaw.map((receipt) => [String(receipt.penerimaan_pembelian_id), receipt]));
  const receiptLines: FinanceExportReceiptLine[] = receiptLineRaw.map((line) => {
    const receipt = receiptById.get(String(line.penerimaan_pembelian_id));
    const purchase = purchaseById.get(String(receipt?.pembelian_id ?? ""));
    return {
      detail_penerimaan_pembelian_id: String(line.detail_penerimaan_pembelian_id),
      penerimaan_pembelian_id: String(line.penerimaan_pembelian_id),
      pembelian_id: String(receipt?.pembelian_id ?? ""),
      nomor_penerimaan: String(receipt?.nomor_penerimaan ?? "-"),
      nomor_pembelian: String(purchase?.nomor_pembelian ?? "-"),
      detail_pembelian_id: String(line.detail_pembelian_id),
      barang_id: String(line.barang_id),
      varian_barang_id: line.varian_barang_id == null ? null : String(line.varian_barang_id),
      inventory_mode: String(line.inventory_mode ?? "unknown"),
      quantity_received: Number(line.quantity_received ?? 0),
      unit_cost: Number(line.unit_cost ?? 0),
      subtotal_cost: Number(line.subtotal_cost ?? 0),
      currency_code: String(purchase?.currency_code ?? "IDR").trim(),
    };
  });
  const receiptLinesByPurchaseLine = new Map<string, FinanceExportReceiptLine[]>();
  for (const line of receiptLines) {
    const existing = receiptLinesByPurchaseLine.get(line.detail_pembelian_id) ?? [];
    existing.push(line);
    receiptLinesByPurchaseLine.set(line.detail_pembelian_id, existing);
  }
  for (const purchaseLine of purchaseLines) {
    const receivedLines = receiptLinesByPurchaseLine.get(purchaseLine.detail_pembelian_id) ?? [];
    purchaseLine.received_quantity = receivedLines.reduce((total, line) => total + line.quantity_received, 0);
    const inventoryModes = [...new Set(receivedLines.map((line) => line.inventory_mode).filter((mode) => mode && mode !== "unknown"))];
    purchaseLine.inventory_mode_snapshot = inventoryModes.length === 1
      ? inventoryModes[0]
      : inventoryModes.length > 1
        ? "mixed"
        : null;
  }

  const purchaseReceipts: FinanceExportReceipt[] = receiptsRaw.map((receipt) => {
    const lines = receiptLines.filter((line) => line.penerimaan_pembelian_id === String(receipt.penerimaan_pembelian_id));
    return {
      penerimaan_pembelian_id: String(receipt.penerimaan_pembelian_id),
      pembelian_id: String(receipt.pembelian_id),
      nomor_pembelian: String(purchaseById.get(String(receipt.pembelian_id))?.nomor_pembelian ?? "-"),
      nomor_penerimaan: String(receipt.nomor_penerimaan),
      status: String(receipt.status ?? "unknown"),
      received_at: String(receipt.received_at ?? ""),
      received_quantity: lines.reduce((total, line) => total + line.quantity_received, 0),
      received_stock_value: lines.reduce((total, line) => total + line.subtotal_cost, 0),
    };
  });

  const supplierIds = Array.from(new Set(purchaseRaw.map((row) => row.pemasok_id).filter((id): id is string => Boolean(id)).map(String)));
  const supplierNames = new Map<string, string>();
  if (supplierIds.length) {
    const supplierRows = await readRowsForIds("nama pemasok", supplierIds, async (ids, offset) => {
      const result = await supabase
        .from("pemasok")
        .select("pemasok_id,nama", { count: "exact" })
        .eq("usaha_id", usahaId)
        .in("pemasok_id", ids)
        .order("pemasok_id", { ascending: true })
        .range(offset, offset + REPORT_PAGE_SIZE - 1);
      if (result.error) throw result.error;
      return { rows: result.data ?? [], total: result.count ?? 0 };
    });
    supplierRows.forEach((row) => supplierNames.set(String(row.pemasok_id), String(row.nama)));
  }

  const rentalHeadersRaw = await readCompleteRows("penyewaan untuk laporan promo", async (offset) => {
    const result = await supabase
      .from("penyewaan")
      .select("penyewaan_id,nomor_penyewaan,created_at,subtotal_amount,discount_amount,total_amount,currency_code", { count: "exact" })
      .eq("usaha_id", usahaId)
      .gte("created_at", startAt)
      .lt("created_at", endAt)
      .order("created_at", { ascending: true })
      .order("penyewaan_id", { ascending: true })
      .range(offset, offset + REPORT_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    return { rows: result.data ?? [], total: result.count ?? 0 };
  });
  const rentalIds = rentalHeadersRaw.map((row) => String(row.penyewaan_id));
  const rentalPromoLinesRaw = await readRowsForIds("rincian promo penyewaan", rentalIds, async (ids, offset) => {
    const result = await supabase
      .from("detail_penyewaan")
      .select("detail_penyewaan_id,usaha_id,penyewaan_id,barang_id,varian_barang_id,paket_sewa_id,jumlah,unit_price,subtotal,currency_code,harga_normal_snapshot,diskon_persen_snapshot,nominal_diskon_snapshot,promosi_paket_id,promosi_katalog_id", { count: "exact" })
      .eq("usaha_id", usahaId)
      .in("penyewaan_id", ids)
      .order("penyewaan_id", { ascending: true })
      .order("detail_penyewaan_id", { ascending: true })
      .range(offset, offset + REPORT_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    return { rows: result.data ?? [], total: result.count ?? 0 };
  });
  const rentalDiscountRaw = await readRowsForIds("diskon checkout penyewaan", rentalIds, async (ids, offset) => {
    const result = await supabase
      .from("penyewaan_diskon")
      .select("penyewaan_diskon_id,usaha_id,penyewaan_id,source,program_loyalitas_id,program_version,completed_rental_count,minimum_completed_rentals,recommended_discount_percent,recommended_amount,actual_amount,bonus_amount,reason_code,reason_note,created_at", { count: "exact" })
      .eq("usaha_id", usahaId)
      .in("penyewaan_id", ids)
      .order("created_at", { ascending: true })
      .order("penyewaan_diskon_id", { ascending: true })
      .range(offset, offset + REPORT_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    return { rows: result.data ?? [], total: result.count ?? 0 };
  });

  const productIds = Array.from(new Set(rentalPromoLinesRaw.map((line) => line.barang_id).filter(Boolean).map(String)));
  const variantIds = Array.from(new Set(rentalPromoLinesRaw.map((line) => line.varian_barang_id).filter(Boolean).map(String)));
  const packageIds = Array.from(new Set(rentalPromoLinesRaw.map((line) => line.paket_sewa_id).filter(Boolean).map(String)));
  const catalogNames = new Map<string, string>();
  const [productNameRows, variantNameRows, packageNameRows] = await Promise.all([
    productIds.length
      ? supabase.from("barang").select("barang_id,nama").eq("usaha_id", usahaId).in("barang_id", productIds)
      : Promise.resolve({ data: [], error: null }),
    variantIds.length
      ? supabase.from("varian_barang").select("varian_barang_id,nama").eq("usaha_id", usahaId).in("varian_barang_id", variantIds)
      : Promise.resolve({ data: [], error: null }),
    packageIds.length
      ? supabase.from("paket_sewa").select("paket_sewa_id,nama").eq("usaha_id", usahaId).in("paket_sewa_id", packageIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (productNameRows.error) throw productNameRows.error;
  if (variantNameRows.error) throw variantNameRows.error;
  if (packageNameRows.error) throw packageNameRows.error;
  (productNameRows.data ?? []).forEach((row) => catalogNames.set(String(row.barang_id), String(row.nama)));
  (variantNameRows.data ?? []).forEach((row) => catalogNames.set(String(row.varian_barang_id), String(row.nama)));
  (packageNameRows.data ?? []).forEach((row) => catalogNames.set(String(row.paket_sewa_id), String(row.nama)));

  const rentalHeaderById = new Map(rentalHeadersRaw.map((row) => [String(row.penyewaan_id), row]));
  const promotionUsage: FinanceExportPromotionUse[] = [];
  for (const line of saleLines) {
    const hasDiscount = line.nominal_diskon > 0 || Boolean(line.promosi_katalog_id);
    if (!hasDiscount && !line.is_bonus_rental) continue;
    promotionUsage.push({
      tanggal: line.tanggal_transaksi,
      sumber: "Penjualan",
      nomor_transaksi: line.nomor_penjualan,
      jenis_promo: line.is_bonus_rental ? "Barang bonus retail" : "Promo katalog penjualan",
      promo_id: line.promosi_katalog_id,
      barang_paket: line.nama_varian ? line.nama_barang + " · " + line.nama_varian : line.nama_barang,
      jumlah: line.jumlah,
      mata_uang: line.currency_code,
      harga_normal: line.subtotal + line.nominal_diskon,
      diskon: line.nominal_diskon,
      nilai_akhir: line.subtotal,
      hpp_bonus: line.is_bonus_rental ? line.hpp_total : null,
      catatan: line.is_bonus_rental ? line.bonus_reason : (line.diskon_persen ? line.diskon_persen + "% dari harga normal" : null),
    });
  }
  for (const line of rentalPromoLinesRaw) {
    const catalogPromoId = line.promosi_katalog_id == null ? null : String(line.promosi_katalog_id);
    const packagePromoId = line.promosi_paket_id == null ? null : String(line.promosi_paket_id);
    const discount = Number(line.nominal_diskon_snapshot ?? 0);
    if (!catalogPromoId && !packagePromoId && discount <= 0) continue;
    const productId = line.barang_id == null ? null : String(line.barang_id);
    const variantId = line.varian_barang_id == null ? null : String(line.varian_barang_id);
    const packageId = line.paket_sewa_id == null ? null : String(line.paket_sewa_id);
    const label = packageId
      ? catalogNames.get(packageId) ?? "Paket sewa"
      : variantId
        ? (catalogNames.get(productId ?? "") ?? "Barang") + " · " + (catalogNames.get(variantId) ?? "Varian")
        : catalogNames.get(productId ?? "") ?? "Barang";
    const header = rentalHeaderById.get(String(line.penyewaan_id));
    const actual = Number(line.subtotal ?? 0);
    const promoPercent = Number(line.diskon_persen_snapshot ?? 0);
    promotionUsage.push({
      tanggal: String(header?.created_at ?? ""),
      sumber: "Penyewaan",
      nomor_transaksi: String(header?.nomor_penyewaan ?? "-"),
      jenis_promo: packagePromoId ? "Promo paket penyewaan" : "Promo katalog penyewaan",
      promo_id: packagePromoId ?? catalogPromoId,
      barang_paket: label,
      jumlah: Number(line.jumlah ?? 0),
      mata_uang: String(line.currency_code ?? header?.currency_code ?? "IDR").trim(),
      harga_normal: actual + discount,
      diskon: discount,
      nilai_akhir: actual,
      hpp_bonus: null,
      catatan: promoPercent ? promoPercent + "% dari harga normal" : null,
    });
  }
  for (const discount of rentalDiscountRaw) {
    const header = rentalHeaderById.get(String(discount.penyewaan_id));
    promotionUsage.push({
      tanggal: String(discount.created_at ?? header?.created_at ?? ""),
      sumber: "Penyewaan",
      nomor_transaksi: String(header?.nomor_penyewaan ?? "-"),
      jenis_promo: String(discount.source) === "loyalty" ? "Diskon loyalitas" : "Diskon manual",
      promo_id: discount.program_loyalitas_id == null ? null : String(discount.program_loyalitas_id),
      barang_paket: "Diskon tingkat transaksi",
      jumlah: 1,
      mata_uang: String(header?.currency_code ?? "IDR").trim(),
      // Transaction-level discount is reported as a discount amount only.
      // Do not repeat the rental's full subtotal/total across multiple discount rows.
      harga_normal: 0,
      diskon: Number(discount.actual_amount ?? 0),
      nilai_akhir: 0,
      hpp_bonus: null,
      catatan: [
        discount.reason_code ? String(discount.reason_code) : null,
        discount.reason_note ? String(discount.reason_note) : null,
        discount.program_version ? "Versi program " + String(discount.program_version) : null,
        discount.completed_rental_count != null ? "Penyewaan selesai " + String(discount.completed_rental_count) + " kali" : null,
      ].filter(Boolean).join(" · ") || null,
    });
  }

  const purchaseCashOutBySource = new Map<string, number>();
  const cashOutRows = await readCompleteRows("kas keluar pembelian", async (offset) => {
    const result = await supabase
      .from("transaksi_keuangan")
      .select("sumber_id,amount,currency_code", { count: "exact" })
      .eq("usaha_id", usahaId)
      .eq("sumber_type", "purchase")
      .eq("arah", "expense")
      .eq("status", "recorded")
      .gte("tanggal_transaksi", startAt)
      .lt("tanggal_transaksi", endAt)
      .order("tanggal_transaksi", { ascending: true })
      .order("transaksi_keuangan_id", { ascending: true })
      .range(offset, offset + REPORT_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    return { rows: result.data ?? [], total: result.count ?? 0 };
  });
  for (const row of cashOutRows) {
    if (!row.sumber_id) continue;
    purchaseCashOutBySource.set(
      String(row.sumber_id),
      (purchaseCashOutBySource.get(String(row.sumber_id)) ?? 0) + Number(row.amount ?? 0),
    );
  }

  return {
    retailSales,
    retailSaleLines: saleLines,
    purchases: purchaseRaw.map((purchase) => {
      const lines = purchaseLines.filter((line) => line.pembelian_id === String(purchase.pembelian_id));
      const receipts = purchaseReceipts.filter((receipt) => receipt.pembelian_id === String(purchase.pembelian_id));
      return {
        pembelian_id: String(purchase.pembelian_id),
        nomor_pembelian: String(purchase.nomor_pembelian),
        tanggal_pembelian: String(purchase.tanggal_pembelian),
        status: String(purchase.status ?? "unknown"),
        pemasok_id: purchase.pemasok_id == null ? null : String(purchase.pemasok_id),
        nama_pemasok: purchase.pemasok_id == null ? "Tanpa pemasok" : supplierNames.get(String(purchase.pemasok_id)) ?? "Pemasok tidak diketahui",
        total_amount: Number(purchase.total_amount ?? 0),
        currency_code: String(purchase.currency_code ?? "IDR").trim(),
        catatan: purchase.catatan == null ? null : String(purchase.catatan),
        item_count: lines.length,
        received_quantity: receipts.reduce((total, receipt) => total + receipt.received_quantity, 0),
        received_stock_value: receipts.reduce((total, receipt) => total + receipt.received_stock_value, 0),
        cash_out_amount: purchaseCashOutBySource.get(String(purchase.pembelian_id)) ?? 0,
      };
    }),
    purchaseLines,
    purchaseReceipts,
    purchaseReceiptLines: receiptLines,
    promotionUsage,
  };
}

export async function getFinanceExportReport(
  usahaId: string,
  startDate: string,
  endDateExclusive: string,
  includeSupportingDetails = true,
  includeOperationalDetails = includeSupportingDetails,
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

  const operationalExports = includeOperationalDetails
    ? await loadFinanceOperationalExports(usahaId, startDate, endDateExclusive, summary.timezone)
    : {
      retailSales: [],
      retailSaleLines: [],
      purchases: [],
      purchaseLines: [],
      purchaseReceipts: [],
      purchaseReceiptLines: [],
      promotionUsage: [],
    };

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
        rental_income: 0,
        retail_income: 0,
        other_income: 0,
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
      const sourceType = String(transaction.sumber_type ?? "").toLowerCase();
      if (sourceType === "sale") row.retail_income += amount;
      else if (["rental", "reservation", "penyewaan", "reservasi"].includes(sourceType)) row.rental_income += amount;
      else row.other_income += amount;
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
    ...operationalExports,
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
