import {
  getFinanceExpenseAnalysis,
  getFinanceProductRevenue,
  getFinanceSummary,
  getFinanceTransactionPage,
  getFinanceUnitRevenue,
} from "@/features/keuangan/service";
import type { FinancialReport, ReportSourceTrace } from "./types";

export const FINANCE_REPORT_SOURCE_TRACE: ReportSourceTrace = {
  source: "finance",
  owner: "keuangan",
  derived: true,
  readOnly: true,
  note: "Laporan membaca fakta Finance melalui kontrak server-side; Laporan tidak menghitung ulang atau memutasi Money Truth.",
};

export async function getFinancialReport(
  usahaId: string,
  startDate: string,
  endDateExclusive: string,
  transactionLimit = 50,
  transactionOffset = 0,
): Promise<FinancialReport> {
  const [
    summary,
    transactions,
    expenseAnalysis,
    productRevenue,
    unitRevenue,
  ] = await Promise.all([
    getFinanceSummary(usahaId, startDate, endDateExclusive),
    getFinanceTransactionPage(
      usahaId,
      startDate,
      endDateExclusive,
      transactionLimit,
      transactionOffset,
    ),
    getFinanceExpenseAnalysis(usahaId, startDate, endDateExclusive),
    getFinanceProductRevenue(usahaId, startDate, endDateExclusive),
    getFinanceUnitRevenue(usahaId, startDate, endDateExclusive),
  ]);

  if (
    summary.start_date !== startDate ||
    summary.end_date_exclusive !== endDateExclusive
  ) {
    throw new Error("Laporan Finance: periode summary tidak konsisten.");
  }

  if (
    transactions.start_date !== startDate ||
    transactions.end_date_exclusive !== endDateExclusive
  ) {
    throw new Error("Laporan Finance: periode transaction tidak konsisten.");
  }

  if (
    expenseAnalysis.start_date !== startDate ||
    expenseAnalysis.end_date_exclusive !== endDateExclusive
  ) {
    throw new Error("Laporan Finance: periode expense analysis tidak konsisten.");
  }

  if (
    productRevenue.start_date !== startDate ||
    productRevenue.end_date_exclusive !== endDateExclusive
  ) {
    throw new Error("Laporan Finance: periode product revenue tidak konsisten.");
  }

  if (
    unitRevenue.start_date !== startDate ||
    unitRevenue.end_date_exclusive !== endDateExclusive
  ) {
    throw new Error("Laporan Finance: periode unit revenue tidak konsisten.");
  }

  return {
    period: {
      start_date: summary.start_date,
      end_date_exclusive: summary.end_date_exclusive,
      timezone: summary.timezone,
    },
    summary,
    transactions,
    expenseAnalysis,
    productRevenue,
    unitRevenue,
  };
}
