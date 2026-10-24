import { buildInvestorUiContract } from "@/features/investor/contract";
import { describe, expect, it } from "vitest";
import {
  calculateDeterministicKpis,
  classifyOverview,
  formatInvestorCurrency,
  type InvestorOverview,
} from "@/features/investor/types";

const baseOverview: InvestorOverview = {
  status: "OK",
  usaha_id: "usaha-1",
  investor_id: "investor-1",
  investor_name: "Investor Test",
  participation_id: "participation-1",
  period: {
    start: "2026-10-01",
    end_exclusive: "2026-11-01",
    timezone: "Asia/Jakarta",
  },
  basis_type: "net_operational_result",
  percentage: 10,
  income_recorded: 130000,
  expense_recorded: 40000,
  net_operational_result: 90000,
  investor_entitlement: 9000,
  operator_remainder: 81000,
  transaction_count: 6,
  currency_count: 1,
  currencies: ["IDR"],
  allocation_status: "CALCULATED",
  calculated_at: "2026-10-07T16:00:00Z",
  finance_last_changed_at: "2026-10-07T15:59:00Z",
  freshness: "DIRECT_FRESH",
  principal: "investor",
};

describe("Investor UI contract", () => {
  it("maps server result to deterministic KPI presentation", () => {
    const kpis = calculateDeterministicKpis(baseOverview);

    expect(kpis.find((item) => item.key === "income")?.value).toBe(130000);
    expect(kpis.find((item) => item.key === "expense")?.value).toBe(40000);
    expect(kpis.find((item) => item.key === "net")?.value).toBe(90000);
    expect(kpis.find((item) => item.key === "percentage")?.value).toBe(10);
    expect(kpis.find((item) => item.key === "entitlement")?.value).toBe(9000);
    expect(kpis.find((item) => item.key === "expense_ratio")?.value).toBeCloseTo(30.7692307);
  });

  it("keeps zero distinct from unavailable", () => {
    const zero = calculateDeterministicKpis({
      ...baseOverview,
      income_recorded: 0,
      expense_recorded: 0,
      net_operational_result: 0,
      investor_entitlement: 0,
    });

    expect(zero.find((item) => item.key === "net")?.state).toBe("value");
    expect(zero.find((item) => item.key === "net")?.value).toBe(0);

    const unavailable = calculateDeterministicKpis({
      ...baseOverview,
      income_recorded: undefined,
      expense_recorded: undefined,
      net_operational_result: undefined,
      investor_entitlement: undefined,
    });

    expect(unavailable.find((item) => item.key === "net")?.state).toBe("unavailable");
    expect(unavailable.find((item) => item.key === "net")?.value).toBeNull();
  });

  it("exposes stale state instead of silently presenting live", () => {
    expect(classifyOverview(baseOverview, "LIVE")).toBe("VALUE");
    expect(classifyOverview({ ...baseOverview, freshness: "LAGGING" }, "LIVE")).toBe("STALE");
    expect(classifyOverview(baseOverview, "STALE")).toBe("STALE");
    expect(classifyOverview({ ...baseOverview, status: "NO_INVESTOR_CONFIG" }, "LIVE")).toBe("CONFIG_REQUIRED");
  });

  it("builds an explicit UI contract for an open operational period", () => {
    const contract = buildInvestorUiContract({ ...baseOverview, principal: "admin" }, "LIVE");
    expect(contract?.state).toBe("OPEN");
    expect(contract?.period.mode).toBe("OPEN");
    expect(contract?.result.calculationPolicy).toBe("INVESTOR_PERCENT_X_OPERATIONAL_RESULT");
    expect(contract?.capabilities.closePeriod).toBe("SERVER_GUARDED");
    expect(contract?.capabilities.recordOpenAdvance).toBe("SERVER_GUARDED");
    expect(contract?.capabilities.distributeInvestorAllocation).toBe("NOT_AVAILABLE");
    expect(contract?.capabilities.transferInvestorEntitlement).toBe("NOT_AVAILABLE");
  });

  it("does not expose admin financial mutations to investor principal", () => {
    const contract = buildInvestorUiContract(baseOverview, "LIVE");
    expect(contract?.capabilities.configureParticipation).toBe("NOT_AVAILABLE");
    expect(contract?.capabilities.closePeriod).toBe("NOT_AVAILABLE");
    expect(contract?.capabilities.recordOpenAdvance).toBe("NOT_AVAILABLE");
    expect(contract?.capabilities.distributeInvestorAllocation).toBe("NOT_AVAILABLE");
    expect(contract?.capabilities.withdrawOperatorAllocation).toBe("NOT_AVAILABLE");
    expect(contract?.capabilities.transferInvestorEntitlement).toBe("NOT_AVAILABLE");
  });

  it("disables financial mutations when the data is stale", () => {
    const contract = buildInvestorUiContract(
      { ...baseOverview, principal: "admin" },
      "STALE",
    );

    expect(contract?.state).toBe("STALE");
    expect(contract?.capabilities.closePeriod).toBe("NOT_AVAILABLE");
    expect(contract?.capabilities.recordOpenAdvance).toBe("NOT_AVAILABLE");
    expect(contract?.capabilities.distributeInvestorAllocation).toBe("NOT_AVAILABLE");
    expect(contract?.capabilities.withdrawOperatorAllocation).toBe("NOT_AVAILABLE");
    expect(contract?.capabilities.transferInvestorEntitlement).toBe("NOT_AVAILABLE");
  });

  it("keeps multi-currency review separate from value state", () => {
    const contract = buildInvestorUiContract(
      { ...baseOverview, allocation_status: "MULTI_CURRENCY_REVIEW_REQUIRED" },
      "LIVE",
    );
    expect(contract?.state).toBe("REVIEW_REQUIRED");
    expect(contract?.dataQuality.allocationStatus).toBe("MULTI_CURRENCY_REVIEW_REQUIRED");
  });

  it("maps a closed period to closed UI state and guarded distribution", () => {
    const contract = buildInvestorUiContract(
      { ...baseOverview, period_state: "CLOSED", allocation_status: "CLOSED_FINAL", principal: "admin" },
      "LIVE",
    );

    expect(contract?.state).toBe("CLOSED");
    expect(contract?.period.mode).toBe("CLOSED");
    expect(contract?.capabilities.closePeriod).toBe("NOT_AVAILABLE");
    expect(contract?.capabilities.recordOpenAdvance).toBe("NOT_AVAILABLE");
    expect(contract?.capabilities.distributeInvestorAllocation).toBe("SERVER_GUARDED");
    expect(contract?.capabilities.withdrawOperatorAllocation).toBe("SERVER_GUARDED");
    expect(contract?.capabilities.transferInvestorEntitlement).toBe("SERVER_GUARDED");
  });

  it("preserves non-negative investor entitlement for a negative operational result", () => {
    const negative = { ...baseOverview, net_operational_result: -20000, investor_entitlement: 0 };
    const kpis = calculateDeterministicKpis(negative);

    expect(kpis.find((item) => item.key === "net")?.value).toBe(-20000);
    expect(kpis.find((item) => item.key === "entitlement")?.value).toBe(0);
  });

  it("uses Indonesian currency formatting without browser-side business math", () => {
    expect(formatInvestorCurrency(9000)).toContain("9.000");
  });
});
