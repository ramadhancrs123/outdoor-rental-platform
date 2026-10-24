export type InvestorConnectionStatus = "CONNECTING" | "LIVE" | "STALE";

export type InvestorPrincipal = {
  investorId: string;
  usahaId: string;
  namaTampilan: string;
  status: "active" | "inactive";
};

export type InvestorPeriodState = "OPEN" | "CLOSED";
export type InvestorOverviewStatus = "OK" | "NO_INVESTOR_CONFIG";
export type InvestorAllocationStatus =
  | "NO_FINANCIAL_ACTIVITY"
  | "CALCULATED"
  | "MULTI_CURRENCY_REVIEW_REQUIRED"
  | "CLOSED_FINAL";
export type InvestorFreshness = "DIRECT_FRESH" | "LAGGING" | "UNKNOWN";

export type InvestorPeriod = {
  start: string;
  end_exclusive: string;
  timezone: string;
};

export type InvestorOverview = {
  status: InvestorOverviewStatus;
  usaha_id: string;
  investor_id?: string;
  investor_name?: string | null;
  participation_id?: string;
  period_id?: string | null;
  period_state?: InvestorPeriodState;
  period?: InvestorPeriod;
  basis_type?: "net_operational_result";
  calculation_policy?: "INVESTOR_PERCENT_X_OPERATIONAL_RESULT";
  percentage?: number;
  reserve_amount?: number | null;
  income_recorded?: number;
  expense_recorded?: number;
  net_operational_result?: number;
  investor_entitlement?: number | null;
  operator_remainder?: number | null;
  operational_cash?: number | null;
  estimated_distributable_cash?: number | null;
  operational_currency_count?: number;
  transaction_count?: number;
  currency_count?: number;
  currencies?: string[];
  allocation_status?: InvestorAllocationStatus;
  calculated_at?: string;
  finance_last_changed_at?: string | null;
  freshness?: InvestorFreshness;
  principal?: "investor" | "admin";
};

export type InvestorActivityItem = {
  transaksi_keuangan_id: string;
  nomor_transaksi: string;
  occurred_at: string;
  direction: "income" | "expense";
  amount: number;
  investor_impact: number;
  currency_code: string;
  source_type: string | null;
  expense_category: string | null;
  activity_reason: string;
};

export type InvestorActivity = {
  status: InvestorOverviewStatus;
  principal?: "investor" | "admin";
  investor_id?: string;
  period?: InvestorPeriod;
  percentage?: number;
  items: InvestorActivityItem[];
  total: number;
  limit: number;
  offset: number;
};

export type InvestorParticipation = {
  participation_id: string;
  investor_id: string;
  percentage: number;
  basis_type: "net_operational_result";
  operational_reserve_amount: number;
  pengelola_akun_admin_id: string | null;
  period_start_day: number;
  period_end_day: number;
  effective_from: string;
  effective_until: string | null;
  status: "active" | "inactive";
  updated_at: string;
};

export type InvestorParticipationHistory = {
  principal: "investor" | "admin";
  investor_id: string | null;
  items: InvestorParticipation[];
};

export type InvestorFinanceConfig = {
  config_id?: string;
  participation_id?: string;
  investor_id: string;
  investor_percentage: number;
  operational_reserve_amount: number;
  pengelola_akun_admin_id: string | null;
  period_start_day: number;
  period_end_day: number;
  basis_type: "net_operational_result";
  effective_from: string;
  effective_until: string | null;
  status: "active" | "inactive";
  updated_at?: string;
};

export type InvestorFinanceConfigResponse = {
  status: "OK" | "NO_INVESTOR_CONFIG";
  principal: "investor" | "admin";
  current: InvestorFinanceConfig | null;
  history: InvestorFinanceConfig[];
};

export type FinanceOperationalAccount = {
  akun_keuangan_id: string;
  nama_akun: string;
  mata_uang: string;
  saldo: number;
};

export type FinanceOperationalAccountSummary = {
  accounts: FinanceOperationalAccount[];
  saldo: number | null;
  currency_count: number;
};

export type InvestorPeriodCloseResult = {
  period_id: string;
  period_start: string;
  period_end_exclusive: string;
  status: "closed";
  income_recorded: number;
  expense_recorded: number;
  net_operational_result: number;
  investor_allocation: number;
  operator_allocation: number;
  operational_reserve_amount: number;
  operational_cash_at_close: number;
  distributable_cash_at_close: number;
  reserve_shortfall_at_close: number;
  investor_allocation_id: string;
  operator_allocation_id: string;
  investor_advance_paid?: number;
  operator_advance_paid?: number;
  investor_advance_excess?: number;
  operator_advance_excess?: number;
};

export type InvestorStakeholderPayoutResult = {
  payout_id: string;
  stakeholder_type: "investor" | "pengelola";
  period_start: string;
  allocation_id: string | null;
  transaction_id: string;
  source_account_id: string;
  amount: number;
  currency_code: string;
  destination_name: string;
  remaining_entitlement: number;
  settlement_status: "paid_against_allocation" | "advance_before_closing";
  affects_operational_result: false;
  status: "recorded";
};

export type InvestorEntitlementTransferResult = {
  transfer_id: string;
  period_id: string;
  source_investor_allocation_id: string;
  target_type: "usaha" | "pengelola";
  target_operator_allocation_id: string | null;
  amount: number;
  currency_code: string;
  remaining_investor_right: number;
  physical_money_moved: boolean;
  transaction_id: string | null;
  finance_transfer_id: string | null;
  affects_operational_result: false;
  status: "recorded";
};

export type InvestorHistoryMoney = number | string;

export type InvestorHistoryAllocation = {
  stakeholder_type: "investor" | "pengelola";
  allocation_id: string;
  period_id: string;
  period_start: string;
  period_end_exclusive: string;
  investor_id?: string | null;
  pengelola_akun_admin_id?: string | null;
  currency_code: string;
  result_basis_amount: InvestorHistoryMoney;
  percentage: InvestorHistoryMoney;
  allocation_amount: InvestorHistoryMoney;
  paid_amount: InvestorHistoryMoney;
  transferred_out_amount: InvestorHistoryMoney;
  transferred_in_amount: InvestorHistoryMoney;
  remaining_amount: InvestorHistoryMoney;
  advance_excess_amount: InvestorHistoryMoney;
  status: string;
};

export type InvestorSelfTransferResult = {
  status: "recorded";
  payout_id: string;
  payout_kind: "investor_self_transfer";
  stakeholder_type: "investor";
  investor_id: string;
  source_account_id: string;
  transaction_id: string;
  amount: number;
  currency_code: string;
  destination_name: string;
  destination_reference: string | null;
  balance_after: number;
  affects_operational_result: false;
};

export type InvestorHistoryPayout = {
  payout_id: string;
  payout_kind?: "allocation_payout" | "investor_self_transfer";
  stakeholder_type: "investor" | "pengelola";
  period_start: string | null;
  period_id: string | null;
  investor_allocation_id: string | null;
  operator_allocation_id: string | null;
  source_account_id: string;
  transaction_id: string | null;
  amount: InvestorHistoryMoney;
  currency_code: string;
  paid_at: string;
  destination_name: string;
  destination_reference: string | null;
  recorded_by_admin_id: string | null;
  request_id: string | null;
  created_at: string;
  catatan: string | null;
  status: string;
};

export type InvestorHistoryEntitlementTransfer = {
  transfer_id: string;
  period_id: string;
  source_investor_allocation_id: string;
  target_type: "usaha" | "pengelola";
  target_operator_allocation_id: string | null;
  physical_source_account_id: string | null;
  physical_target_account_id: string | null;
  transaction_id: string | null;
  finance_transfer_id: string | null;
  amount: InvestorHistoryMoney;
  currency_code: string;
  transferred_at: string;
  physical_money_moved: boolean;
  affects_operational_result: false;
  recorded_by_admin_id: string | null;
  request_id: string | null;
  catatan: string | null;
  status: string;
};

export type InvestorHistoryCashSegregation = {
  event_id: string;
  stakeholder_type: string;
  source_account_id: string;
  target_account_id: string;
  transfer_id: string | null;
  amount: InvestorHistoryMoney;
  currency_code: string;
  occurred_at: string;
  recorded_by_admin_id: string | null;
  request_id: string | null;
  catatan: string | null;
  movement_kind: "cash_segregation" | "investor_account_transfer";
  source_account_name?: string | null;
  target_account_name?: string | null;
  affects_entitlement: false;
};

export type InvestorStakeholderHistory = {
  status: "OK";
  principal: "admin" | "investor";
  physical_accounts: Array<{
    account_id: string;
    account_name: string;
    stakeholder_type: "investor" | "pengelola";
    account_status?: string;
    currency_code: string;
    physical_balance: InvestorHistoryMoney;
    balance_kind: "physical_money_location";
  }>;
  allocations: InvestorHistoryAllocation[];
  payouts: InvestorHistoryPayout[];
  entitlement_transfers: InvestorHistoryEntitlementTransfer[];
  cash_segregations: InvestorHistoryCashSegregation[];
};

export type InvestorRealtimeCheckpoint = {
  principal: "investor" | "admin";
  last_event_seq: number;
  last_event_at: string | null;
};

export type InvestorReconciliation = {
  status: "HEALTHY" | "ATTENTION";
  checked_by_admin_id: string;
  current_config_count: number;
  future_config_count: number;
  active_investor_count: number;
  operational_account_count: number;
  investor_account_count: number;
  operator_account_count: number;
  unsettled_allocations: number;
  pending_realtime_events: number;
  operational_currency_count: number;
  negative_operational_or_stakeholder_accounts: number;
  negative_result_policy: "investor_allocation_zero";
  open_period_formula: "investor_percentage_x_operational_result";
};

export type InvestorErrorState =
  | "LOADING"
  | "EMPTY"
  | "CONFIG_REQUIRED"
  | "REVIEW_REQUIRED"
  | "STALE"
  | "ERROR";

export type InvestorKpi = {
  key: string;
  label: string;
  value: number | null;
  helper: string;
  state: "value" | "unavailable";
  format: "currency" | "percentage" | "number";
};

export function classifyOverview(
  overview: InvestorOverview | null,
  connection: InvestorConnectionStatus,
) {
  if (!overview) return "LOADING" as const;
  if (overview.status === "NO_INVESTOR_CONFIG") return "CONFIG_REQUIRED" as const;
  if (overview.allocation_status === "MULTI_CURRENCY_REVIEW_REQUIRED") return "REVIEW_REQUIRED" as const;
  if (connection === "STALE" || overview.freshness === "LAGGING") return "STALE" as const;
  return "VALUE" as const;
}

export function calculateDeterministicKpis(overview: InvestorOverview): InvestorKpi[] {
  const income = overview.income_recorded ?? null;
  const expense = overview.expense_recorded ?? null;
  const net = overview.net_operational_result ?? null;
  const entitlement = overview.investor_entitlement ?? null;
  const percentage = overview.percentage ?? null;
  const operationalCash = overview.operational_cash ?? null;
  const reserve = overview.reserve_amount ?? null;
  const distributable = overview.estimated_distributable_cash ?? null;
  const expenseRatio = income != null && income > 0 && expense != null ? (expense / income) * 100 : null;

  return [
    { key: "income", label: "Pemasukan", value: income, helper: "Recorded income pada periode", state: income == null ? "unavailable" : "value", format: "currency" },
    { key: "expense", label: "Pengeluaran", value: expense, helper: "Recorded expense pada periode", state: expense == null ? "unavailable" : "value", format: "currency" },
    { key: "net", label: "Hasil Bersih", value: net, helper: "Pemasukan − Pengeluaran", state: net == null ? "unavailable" : "value", format: "currency" },
    { key: "percentage", label: "Partisipasi", value: percentage, helper: "Persentase efektif periode", state: percentage == null ? "unavailable" : "value", format: "percentage" },
    { key: "entitlement", label: "Hak Investor", value: entitlement, helper: "Allocation dari hasil bersih", state: entitlement == null ? "unavailable" : "value", format: "currency" },
    { key: "operational_cash", label: "Kas Operasional", value: operationalCash, helper: "Saldo akun usaha operasional", state: operationalCash == null ? "unavailable" : "value", format: "currency" },
    { key: "reserve", label: "Cadangan Operasional", value: reserve, helper: "Saldo minimum yang dipertahankan", state: reserve == null ? "unavailable" : "value", format: "currency" },
    { key: "distributable_cash", label: "Kas Distributable", value: distributable, helper: "Kas operasional setelah cadangan", state: distributable == null ? "unavailable" : "value", format: "currency" },
    { key: "expense_ratio", label: "Rasio Pengeluaran", value: expenseRatio, helper: "Pengeluaran ÷ pemasukan", state: expenseRatio == null ? "unavailable" : "value", format: "percentage" },
  ];
}

export function formatInvestorCurrency(value: number | null | undefined, currency = "IDR") {
  if (value == null) return "—";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatInvestorDate(
  value: string | null | undefined,
  timezone?: string | null,
) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(value));
}

export function formatInvestorDateTime(
  value: string | null | undefined,
  timezone?: string | null,
) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(value));
}


export type InvestorAdminOperator = {
  akun_admin_id: string;
  nama_tampilan: string;
  role: string;
};

export type InvestorStakeholderAccount = {
  akun_keuangan_id: string;
  nama_akun: string;
  fungsi_akun: "investor" | "pengelola";
  investor_id: string | null;
  pengelola_akun_admin_id: string | null;
  mata_uang: string;
  saldo: number;
};

export type InvestorAccountTransferTarget = {
  akun_keuangan_id: string;
  nama_akun: string;
  fungsi_akun: "operasional" | "investor";
  investor_id: string | null;
  nama_pemilik: string | null;
  mata_uang: string;
};

export type InvestorAccountTransferResult = {
  status: "recorded";
  transfer_id: string;
  transaction_id: string;
  source_account_id: string;
  target_account_id: string;
  amount: number;
  currency_code: string;
  source_balance_after: number;
  target_balance_after: number;
  affects_operational_result: false;
  affects_entitlement: false;
};


export type InvestorPendingAllocation = {
  allocation_id: string;
  investor_id?: string;
  pengelola_akun_admin_id?: string;
  period_start: string;
  period_end_exclusive: string;
  currency_code: string;
  allocation_amount: number;
  distributed_amount: number;
  remaining_amount: number;
  transferred_out_amount?: number;
  transferred_in_amount?: number;
  advance_excess_amount?: number;
  status: "allocated" | "partially_distributed" | "settled" | "review_required";
};

