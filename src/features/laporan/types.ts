import type {
  FinanceExpense,
  FinanceExpenseAnalysis,
  FinancePeriod,
  FinanceProductRevenueReport,
  FinanceReportPage,
  FinanceSummary,
  FinanceTransaction,
  FinanceUnitRevenueReport,
} from "@/features/keuangan/types";

export type FinancialReport = {
  period: FinancePeriod;
  summary: FinanceSummary;
  transactions: FinanceReportPage<FinanceTransaction>;
  expenseAnalysis: FinanceExpenseAnalysis;
  productRevenue: FinanceProductRevenueReport;
  unitRevenue: FinanceUnitRevenueReport;
};

export type FinancialReportPage = FinanceReportPage<FinanceTransaction | FinanceExpense>;

export type ReportSourceTrace = {
  source: "finance";
  owner: "keuangan";
  derived: true;
  readOnly: true;
  note: string;
};
