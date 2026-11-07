export type FinanceTenantContext = {
  akunAdminId: string;
  usahaId: string;
  usahaNama: string;
  timezone: string;
};

export type FinancePeriodPreset = "today" | "week" | "month" | "custom";

export type FinancePeriodSelection = {
  preset: FinancePeriodPreset;
  startDate: string;
  endDateExclusive: string;
  valid?: boolean;
  validationMessage?: string | null;
};

export type FinanceListFilters = {
  search: string;
  page: number;
  pageSize: number;
};

export const DEFAULT_FINANCE_LIST_FILTERS: FinanceListFilters = {
  search: "",
  page: 1,
  pageSize: 20,
};

export type FinanceTransaction = {
  transaksi_keuangan_id: string;
  usaha_id: string;
  nomor_transaksi: string;
  jenis: string;
  arah: string;
  tanggal_transaksi: string;
  amount: string | number;
  currency_code: string;
  sumber_type: string | null;
  sumber_id: string | null;
  status: string;
  catatan: string | null;
  created_at: string;
  updated_at: string;
};

export type FinancePayment = {
  pembayaran_id: string;
  usaha_id: string;
  reservasi_id: string | null;
  penyewaan_id: string | null;
  transaksi_keuangan_id: string;
  nomor_pembayaran: string;
  jenis: string;
  metode: string;
  amount: string | number;
  currency_code: string;
  dibayar_at: string;
  dicatat_by_admin_id: string;
  reference_text: string | null;
  catatan: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  nomor_transaksi: string | null;
  source_label: string | null;
  payment_source_type?: "rental" | "sale";
  penjualan_id?: string | null;
  nomor_penjualan?: string | null;
};

export type FinanceRentalPaymentSummary = {
  totalRental: number;
  recordedPaymentTotal: number;
  paymentCount: number;
  payments: FinancePayment[];
};

export type FinanceExpense = {
  pengeluaran_id: string;
  usaha_id: string;
  transaksi_keuangan_id: string;
  pemasok_id: string | null;
  source_type: string | null;
  source_id: string | null;
  kategori_biaya: string;
  deskripsi: string;
  amount: string | number;
  currency_code: string;
  tanggal_pengeluaran: string;
  bukti_storage_path: string | null;
  created_at: string;
  updated_at: string;
  nomor_transaksi: string | null;
  pemasok_nama: string | null;
  transaction_status?: string;
  transaction_date?: string | null;
};

export type FinanceSummaryCounts = {
  transaction_count: number;
  payment_count: number;
  expense_count: number;
};

export type FinanceCapabilities = {
  read: true;
  mutation: boolean;
  reason: string;
};


export type FinanceCommandOptions = {
  idempotencyKey?: string;
  requestId?: string;
  businessTimezone?: string;
};

export type FinanceAccount = {
  akun_keuangan_id: string;
  usaha_id: string;
  kode_akun: string;
  nama_akun: string;
  jenis_akun: "kas" | "bank" | "e_wallet" | "lainnya";
  mata_uang: string;
  status: "active" | "inactive";
  fungsi_akun?: "operasional" | "investor" | "pengelola" | "unknown";
  investor_id?: string | null;
  pengelola_akun_admin_id?: string | null;
  catatan: string | null;
  saldo_awal: number;
  uang_masuk: number;
  uang_keluar: number;
  saldo: number;
  tanggal_saldo_awal: string | null;
};

export type FinanceAccountSummary = {
  accounts: FinanceAccount[];
  totals: {
    saldo: number;
    saldo_awal: number;
    uang_masuk: number;
    uang_keluar: number;
  };
};

export type FinanceAccountMovement = {
  pergerakan_akun_keuangan_id: string;
  akun_keuangan_id: string;
  transaksi_keuangan_id: string;
  arah: "masuk" | "keluar";
  amount: string | number;
  mata_uang: string;
  terjadi_at: string;
  sumber_type: string;
  sumber_id: string;
  status: string;
  dicatat_by_admin_id: string | null;
  dicatat_by_investor_id: string | null;
  request_id: string;
  catatan: string | null;
  transaksi_nomor: string | null;
  transaksi_jenis: string | null;
  transaksi_status: string | null;
  payment_id: string | null;
  payment_number: string | null;
  payment_type: string | null;
  payment_method: string | null;
  rental_id: string | null;
  rental_number: string | null;
  sale_id: string | null;
  sale_number: string | null;
  expense_id: string | null;
  expense_category: string | null;
  expense_description: string | null;
};

export type RecordPaymentInput = {
  reservasiId?: string | null;
  penyewaanId?: string | null;
  akunKeuanganId: string;
  jenis: "dp" | "pelunasan" | "pembayaran_tambahan";
  metode: "cash" | "bank_transfer" | "qris_manual" | "other";
  amount: number;
  dibayarAt?: string | null;
  referenceText?: string | null;
  catatan?: string | null;
};

export type FinanceOpeningBalanceInput = {
  akunKeuanganId: string;
  nominal: number;
  tanggalSaldoAwal: string;
  catatan?: string | null;
};

export type FinanceExpenseCashoutAllocation = {
  akunKeuanganId: string;
  amount: number;
};

export type RecordExpenseInput = {
  sourceType: "purchase" | "maintenance" | "operational" | "other" | "manual";
  sourceId?: string | null;
  pemasokId?: string | null;
  kategoriBiaya: string;
  deskripsi: string;
  amount: number;
  tanggalPengeluaran?: string | null;
  buktiStoragePath?: string | null;
  catatan?: string | null;
  allocations?: FinanceExpenseCashoutAllocation[];
};

export type FinanceCommandResult = {
  pembayaran_id?: string;
  pengeluaran_id?: string;
  nomor_pembayaran?: string;
  nomor_pengeluaran?: string;
  transaksi_keuangan_id: string;
  nomor_transaksi: string;
  status: string;
  source_type: string | null;
  source_id: string | null;
  amount: number;
  currency_code: string;
  dibayar_at?: string;
  tanggal_pengeluaran?: string;
};

export type FinanceReconciliationResult = {
  state: "committed" | "not_found" | "unknown";
  response: FinanceCommandResult | null;
};


export type FinanceSourceOption = {
  id: string;
  number: string;
  renterName: string | null;
  period: string | null;
  meta: string | null;
  type: "reservation" | "rental";
};

export type SupplierOption = {
  id: string;
  name: string;
};

export type FinanceDashboardCashflowPoint = {
  date: string;
  currency_code: string;
  income: number;
  expense: number;
  rental_income: number;
  retail_income: number;
  purchase_expense: number;
  other_expense: number;
  net: number;
};

export type FinanceDashboardPaymentSummary = {
  currency_code: string;
  amount: number;
  count: number;
};

export type FinanceDashboardDiscountSummary = {
  currency_code: string;
  amount: number;
};

export type FinanceDashboardAnalytics = FinancePeriod & {
  total_transaction_count: number;
  currencies: string[];
  cashflow: FinanceDashboardCashflowPoint[];
  payment_summary: FinanceDashboardPaymentSummary[];
  promotions: {
    active_catalog_count: number;
    active_package_count: number;
    loyalty_active: boolean;
    active_count: number;
    used_transaction_count: number;
    discount_by_currency: FinanceDashboardDiscountSummary[];
  };
};

export type FinancePeriod = { start_date: string; end_date_exclusive: string; timezone: string; };
export type FinanceSummary = FinancePeriod & {
  recorded_income:number;
  recorded_expense:number;
  net_operational_movement:number;
  recorded_income_transaction_count:number;
  recorded_expense_transaction_count:number;
  recorded_payment_amount:number;
  recorded_payment_count:number;
  reversal_income_in_period:number;
  reversal_expense_in_period:number;
  rental_income:number;
  retail_income:number;
  purchase_cash_out:number;
  non_purchase_expense:number;
  source_note:string;
};
export type FinanceReportPage<T> = FinancePeriod & { items:T[]; total:number; limit:number; offset:number; has_more:boolean; };
export type FinanceExpenseAnalysis = FinancePeriod & { by_category:Array<{kategori_biaya:string;amount:number;count:number}>; by_supplier:Array<{pemasok_id:string|null;amount:number;count:number}>; by_source:Array<{source_type:string|null;amount:number;count:number}>; note:string; };
export type FinanceProductRevenueItem = { barang_id:string|null; varian_barang_id:string|null; recorded_income_exact:number; rental_detail_value:number; transaction_count:number; attribution_status:"exact_single_detail"; };
export type FinanceProductRevenueReport = FinancePeriod & { items:FinanceProductRevenueItem[]; total_rental_or_reservation_income:number; exact_attributable_income:number; unallocated_income:number; coverage_ratio:number|null; allocation_policy:string; };
export type FinanceUnitRevenueItem = { unit_barang_id:string; kode_unit:string; barang_id:string|null; varian_barang_id:string|null; recorded_income_exact:number; transaction_count:number; attribution_status:"exact_single_detail_single_unit"; };
export type FinanceUnitRevenueReport = FinancePeriod & { items:FinanceUnitRevenueItem[]; total_rental_income:number; exact_unit_attributable_income:number; unallocated_or_ambiguous_income:number; coverage_ratio:number|null; allocation_policy:string; };

export type FinanceRetailSummary = {
  sales_count: number;
  sales_revenue: number;
  sold_quantity: number;
  known_hpp: number;
  gross_profit_known: number;
  hpp_unknown_revenue: number;
  hpp_unknown_lines: number;
  known_hpp_lines: number;
  sales_with_incomplete_hpp: number;
  hpp_coverage_pct: number | null;
  promotion_bonus_quantity: number;
  promotion_bonus_cost: number;
  promotion_bonus_hpp_unknown_lines: number;
  payment_received: number;
  payment_count: number;
  completed_purchase_count: number;
  completed_purchase_value: number;
  purchase_cash_out: number;
  receiving_count: number;
  received_quantity: number;
  received_stock_value: number;
  currency_code: string;
};

export type FinanceRetailProduct = {
  barang_id: string;
  varian_barang_id: string | null;
  nama_barang: string;
  nama_varian: string | null;
  inventory_mode: "serialized" | "quantity" | "untracked" | string;
  quantity_sold: number;
  revenue: number;
  known_hpp: number;
  gross_profit_known: number;
  hpp_unknown_revenue: number;
  hpp_unknown_lines: number;
  sale_count: number;
};

export type FinanceRetailSale = {
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
  known_hpp: number;
  gross_profit_known: number;
  hpp_unknown_lines: number;
  sold_quantity: number;
  bonus_hpp_amount: number | null;
  bonus_quantity: number;
  bonus_hpp_cost: number;
  bonus_hpp_unknown_lines: number;
  created_at: string;
  currency_code: string;
};

export type FinanceRetailPurchase = {
  pembelian_id: string;
  nomor_pembelian: string;
  tanggal_pembelian: string;
  status: string;
  pemasok_id: string | null;
  nama_pemasok: string;
  total_amount: number;
  currency_code: string;
  receiving_count: number;
  received_quantity: number;
  received_stock_value: number;
  cash_out_amount: number;
  catatan: string | null;
};

export type FinanceRetailStockItem = {
  barang_id: string;
  varian_barang_id: string | null;
  nama_barang: string;
  nama_varian: string | null;
  kategori_nama: string | null;
  inventory_mode: "serialized" | "quantity" | "untracked" | string;
  satuan_jual: string | null;
  stock_quantity: number | null;
  known_cost_value: number | null;
  unknown_cost_quantity: number;
  average_unit_cost: number | null;
};

export type FinanceRetailAnalysis = FinancePeriod & {
  summary: FinanceRetailSummary;
  top_products: FinanceRetailProduct[];
  recent_sales: FinanceRetailSale[];
  purchase_history: FinanceRetailPurchase[];
  stock_snapshot: FinanceRetailStockItem[];
  read_only: true;
  account_policy: string;
  hpp_policy: string;
};

export type FinanceHealth = { status:"HEALTHY"|"ATTENTION"|"UNHEALTHY"; critical:Record<string,number>; attention:Record<string,number>; principle:string; };
export type FinanceFinding = { code:string; severity:"critical"|"attention"; [key:string]:unknown; };
export type FinanceReconciliationFindings = { items:FinanceFinding[]; limit:number; };
export type FinanceCorrectionResult = { pembayaran_id?:string; pengeluaran_id?:string; status:"voided"|"reversed"; correction_id:string; nomor_koreksi:string; replacement_transaksi_keuangan_id:string|null; };

export type RentalConsequenceReview = {
  evaluasi_konsekuensi_id: string;
  usaha_id: string;
  penyewaan_id: string;
  penyewa_id: string;
  unit_barang_id: string | null;
  sumber_type: string;
  sumber_id: string;
  jenis_konsekuensi: "late_fee" | "damage" | "loss" | "missing_component" | "other";
  pihak_tanggung_jawab: "penyewa" | "usaha" | "belum_ditentukan";
  nominal_kandidat: number | null;
  nominal_disetujui: number | null;
  currency_code: string;
  status: "pending_review" | "approved" | "rejected";
  alasan: string;
  catatan_review: string | null;
  reviewed_by_admin_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};
