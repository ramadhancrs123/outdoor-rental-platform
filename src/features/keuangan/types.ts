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
};

export type RecordPaymentInput = {
  reservasiId?: string | null;
  penyewaanId?: string | null;
  jenis: "dp" | "pelunasan" | "pembayaran_tambahan";
  metode: "cash" | "bank_transfer" | "qris_manual" | "other";
  amount: number;
  dibayarAt?: string | null;
  referenceText?: string | null;
  catatan?: string | null;
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

export type FinancePeriod = { start_date: string; end_date_exclusive: string; timezone: string; };
export type FinanceSummary = FinancePeriod & { recorded_income:number; recorded_expense:number; net_operational_movement:number; recorded_income_transaction_count:number; recorded_expense_transaction_count:number; recorded_payment_amount:number; recorded_payment_count:number; reversal_income_in_period:number; reversal_expense_in_period:number; source_note:string; };
export type FinanceReportPage<T> = FinancePeriod & { items:T[]; total:number; limit:number; offset:number; has_more:boolean; };
export type FinanceExpenseAnalysis = FinancePeriod & { by_category:Array<{kategori_biaya:string;amount:number;count:number}>; by_supplier:Array<{pemasok_id:string|null;amount:number;count:number}>; by_source:Array<{source_type:string|null;amount:number;count:number}>; note:string; };
export type FinanceProductRevenueItem = { barang_id:string|null; varian_barang_id:string|null; recorded_income_exact:number; rental_detail_value:number; transaction_count:number; attribution_status:"exact_single_detail"; };
export type FinanceProductRevenueReport = FinancePeriod & { items:FinanceProductRevenueItem[]; total_rental_or_reservation_income:number; exact_attributable_income:number; unallocated_income:number; coverage_ratio:number|null; allocation_policy:string; };
export type FinanceUnitRevenueItem = { unit_barang_id:string; kode_unit:string; barang_id:string|null; varian_barang_id:string|null; recorded_income_exact:number; transaction_count:number; attribution_status:"exact_single_detail_single_unit"; };
export type FinanceUnitRevenueReport = FinancePeriod & { items:FinanceUnitRevenueItem[]; total_rental_income:number; exact_unit_attributable_income:number; unallocated_or_ambiguous_income:number; coverage_ratio:number|null; allocation_policy:string; };
export type FinanceHealth = { status:"HEALTHY"|"ATTENTION"|"UNHEALTHY"; critical:Record<string,number>; attention:Record<string,number>; principle:string; };
export type FinanceFinding = { code:string; severity:"critical"|"attention"; [key:string]:unknown; };
export type FinanceReconciliationFindings = { items:FinanceFinding[]; limit:number; };
export type FinanceCorrectionResult = { pembayaran_id?:string; pengeluaran_id?:string; status:"voided"|"reversed"; correction_id:string; nomor_koreksi:string; replacement_transaksi_keuangan_id:string|null; };
