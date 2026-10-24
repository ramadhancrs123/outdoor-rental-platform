import type {
  InvestorConnectionStatus,
  InvestorOverview,
  InvestorAllocationStatus,
} from "./types";

export type InvestorContractState =
  | "CONFIG_REQUIRED"
  | "OPEN"
  | "CLOSED"
  | "STALE"
  | "REVIEW_REQUIRED";

export type InvestorActionAvailability = "AVAILABLE" | "SERVER_GUARDED" | "NOT_AVAILABLE";

export type InvestorUiContract = {
  state: InvestorContractState;
  period: {
    start: string | null;
    endExclusive: string | null;
    timezone: string | null;
    mode: "OPEN" | "CLOSED" | "UNKNOWN";
  };
  result: {
    basis: "net_operational_result";
    calculationPolicy: "INVESTOR_PERCENT_X_OPERATIONAL_RESULT";
    income: number | null;
    expense: number | null;
    net: number | null;
    investorPercentage: number | null;
    investorEntitlement: number | null;
    operatorRemainder: number | null;
  };
  cash: {
    operational: number | null;
    reserve: number | null;
    estimatedDistributable: number | null;
    reserveShortfall: number | null;
  };
  dataQuality: {
    allocationStatus: InvestorAllocationStatus | null;
    currencyCount: number | null;
    currencies: string[];
    freshness: InvestorOverview["freshness"] | null;
    connection: InvestorConnectionStatus;
    lastCalculatedAt: string | null;
  };
  capabilities: {
    configureParticipation: InvestorActionAvailability;
    closePeriod: InvestorActionAvailability;
    recordOpenAdvance: InvestorActionAvailability;
    distributeInvestorAllocation: InvestorActionAvailability;
    withdrawOperatorAllocation: InvestorActionAvailability;
    transferInvestorEntitlement: InvestorActionAvailability;
  };
};

export function buildInvestorUiContract(
  overview: InvestorOverview | null,
  connection: InvestorConnectionStatus,
): InvestorUiContract | null {
  if (!overview || overview.status === "NO_INVESTOR_CONFIG") {
    return overview?.status === "NO_INVESTOR_CONFIG"
      ? {
          state: "CONFIG_REQUIRED",
          period: { start: null, endExclusive: null, timezone: null, mode: "UNKNOWN" },
          result: {
            basis: "net_operational_result",
            calculationPolicy: "INVESTOR_PERCENT_X_OPERATIONAL_RESULT",
            income: null,
            expense: null,
            net: null,
            investorPercentage: null,
            investorEntitlement: null,
            operatorRemainder: null,
          },
          cash: { operational: null, reserve: null, estimatedDistributable: null, reserveShortfall: null },
          dataQuality: {
            allocationStatus: null,
            currencyCount: null,
            currencies: [],
            freshness: overview.freshness ?? null,
            connection,
            lastCalculatedAt: overview.calculated_at ?? null,
          },
          capabilities: {
            configureParticipation: "AVAILABLE",
            closePeriod: "NOT_AVAILABLE",
            recordOpenAdvance: "NOT_AVAILABLE",
            distributeInvestorAllocation: "NOT_AVAILABLE",
            withdrawOperatorAllocation: "NOT_AVAILABLE",
            transferInvestorEntitlement: "NOT_AVAILABLE",
          },
        }
      : null;
  }

  const isAdmin = overview.principal === "admin";
  const periodMode = overview.period_state ?? "OPEN";
  const reviewRequired = overview.allocation_status === "MULTI_CURRENCY_REVIEW_REQUIRED";
  const stale = connection === "STALE" || overview.freshness === "LAGGING";

  return {
    state: reviewRequired ? "REVIEW_REQUIRED" : stale ? "STALE" : periodMode,
    period: {
      start: overview.period?.start ?? null,
      endExclusive: overview.period?.end_exclusive ?? null,
      timezone: overview.period?.timezone ?? null,
      mode: overview.period_state ?? "OPEN",
    },
    result: {
      basis: "net_operational_result",
      calculationPolicy: "INVESTOR_PERCENT_X_OPERATIONAL_RESULT",
      income: overview.income_recorded ?? null,
      expense: overview.expense_recorded ?? null,
      net: overview.net_operational_result ?? null,
      investorPercentage: overview.percentage ?? null,
      investorEntitlement: overview.investor_entitlement ?? null,
      operatorRemainder: overview.operator_remainder ?? null,
    },
    cash: {
      operational: overview.operational_cash ?? null,
      reserve: overview.reserve_amount ?? null,
      estimatedDistributable: overview.estimated_distributable_cash ?? null,
      reserveShortfall: null,
    },
    dataQuality: {
      allocationStatus: overview.allocation_status ?? null,
      currencyCount: overview.currency_count ?? null,
      currencies: overview.currencies ?? [],
      freshness: overview.freshness ?? null,
      connection,
      lastCalculatedAt: overview.calculated_at ?? null,
    },
    capabilities: {
      configureParticipation: isAdmin ? "AVAILABLE" : "NOT_AVAILABLE",
      closePeriod:
        isAdmin && periodMode === "OPEN" && !reviewRequired && !stale
          ? "SERVER_GUARDED"
          : "NOT_AVAILABLE",
      recordOpenAdvance:
        isAdmin && periodMode === "OPEN" && !reviewRequired && !stale
          ? "SERVER_GUARDED"
          : "NOT_AVAILABLE",
      distributeInvestorAllocation:
        isAdmin && periodMode === "CLOSED" && !reviewRequired && !stale
          ? "SERVER_GUARDED"
          : "NOT_AVAILABLE",
      withdrawOperatorAllocation:
        isAdmin && periodMode === "CLOSED" && !reviewRequired && !stale
          ? "SERVER_GUARDED"
          : "NOT_AVAILABLE",
      transferInvestorEntitlement:
        isAdmin && periodMode === "CLOSED" && !reviewRequired && !stale
          ? "SERVER_GUARDED"
          : "NOT_AVAILABLE",
    },
  };
}
