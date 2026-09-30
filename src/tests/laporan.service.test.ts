import { describe, expect, test, vi } from "vitest";

const financeMocks = vi.hoisted(() => ({
  getFinanceSummary: vi.fn(),
  getFinanceTransactionPage: vi.fn(),
  getFinanceExpenseAnalysis: vi.fn(),
  getFinanceProductRevenue: vi.fn(),
  getFinanceUnitRevenue: vi.fn(),
}));

vi.mock("@/features/keuangan/service", () => financeMocks);

import {
  FINANCE_REPORT_SOURCE_TRACE,
  getFinancialReport,
} from "@/features/laporan/service";

const period = {
  start_date: "2026-09-01",
  end_date_exclusive: "2026-10-01",
  timezone: "Asia/Jakarta",
};

const summary = {
  ...period,
  recorded_income: 1000000,
  recorded_expense: 250000,
  net_operational_movement: 750000,
  recorded_income_transaction_count: 2,
  recorded_expense_transaction_count: 1,
  recorded_payment_amount: 1000000,
  recorded_payment_count: 2,
  reversal_income_in_period: 0,
  reversal_expense_in_period: 0,
  source_note: "Recorded finance facts only.",
};

describe("Laporan → Finance read integration", () => {
  test("uses Finance server contracts as the sole financial source", async () => {
    financeMocks.getFinanceSummary.mockResolvedValue(summary);
    financeMocks.getFinanceTransactionPage.mockResolvedValue({
      ...period,
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      has_more: false,
    });
    financeMocks.getFinanceExpenseAnalysis.mockResolvedValue({
      ...period,
      by_category: [],
      by_supplier: [],
      by_source: [],
      note: "derived from Finance",
    });
    financeMocks.getFinanceProductRevenue.mockResolvedValue({
      ...period,
      items: [],
      total_rental_or_reservation_income: 0,
      exact_attributable_income: 0,
      unallocated_income: 0,
      coverage_ratio: null,
      allocation_policy: "exact only",
    });
    financeMocks.getFinanceUnitRevenue.mockResolvedValue({
      ...period,
      items: [],
      total_rental_income: 0,
      exact_unit_attributable_income: 0,
      unallocated_or_ambiguous_income: 0,
      coverage_ratio: null,
      allocation_policy: "exact only",
    });

    const report = await getFinancialReport(
      "usaha-1",
      "2026-09-01",
      "2026-10-01",
    );

    expect(report.summary.net_operational_movement).toBe(750000);
    expect(report.period).toEqual(period);
    expect(financeMocks.getFinanceSummary).toHaveBeenCalledWith(
      "usaha-1",
      "2026-09-01",
      "2026-10-01",
    );
    expect(financeMocks.getFinanceTransactionPage).toHaveBeenCalledWith(
      "usaha-1",
      "2026-09-01",
      "2026-10-01",
      50,
      0,
    );
    expect(financeMocks.getFinanceProductRevenue).toHaveBeenCalledTimes(1);
    expect(financeMocks.getFinanceUnitRevenue).toHaveBeenCalledTimes(1);
  });

  test("rejects mixed-period data rather than hiding report inconsistency", async () => {
    financeMocks.getFinanceSummary.mockResolvedValue(summary);
    financeMocks.getFinanceTransactionPage.mockResolvedValue({
      ...period,
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      has_more: false,
    });
    financeMocks.getFinanceExpenseAnalysis.mockResolvedValue({
      ...period,
      by_category: [],
      by_supplier: [],
      by_source: [],
      note: "derived",
    });
    financeMocks.getFinanceProductRevenue.mockResolvedValue({
      ...period,
      items: [],
      total_rental_or_reservation_income: 0,
      exact_attributable_income: 0,
      unallocated_income: 0,
      coverage_ratio: null,
      allocation_policy: "exact only",
    });
    financeMocks.getFinanceUnitRevenue.mockResolvedValue({
      ...period,
      items: [],
      total_rental_income: 0,
      exact_unit_attributable_income: 0,
      unallocated_or_ambiguous_income: 0,
      coverage_ratio: null,
      allocation_policy: "exact only",
    });

    financeMocks.getFinanceSummary.mockResolvedValueOnce({
      ...summary,
      start_date: "2026-08-01",
    });

    await expect(
      getFinancialReport("usaha-1", "2026-09-01", "2026-10-01"),
    ).rejects.toThrow(/periode summary tidak konsisten/i);
  });

  test("publishes explicit traceability metadata", () => {
    expect(FINANCE_REPORT_SOURCE_TRACE).toEqual({
      source: "finance",
      owner: "keuangan",
      derived: true,
      readOnly: true,
      note: expect.stringMatching(/Money Truth|memutasi/i),
    });
  });
});
