import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InvestorStakeholderHistoryCard } from "@/features/investor/stakeholder-history";
import type { InvestorStakeholderHistory } from "@/features/investor/types";

const history: InvestorStakeholderHistory = {
  status: "OK",
  principal: "admin",
  physical_accounts: [
    {
      account_id: "investor-account",
      account_name: "Akun Investor",
      stakeholder_type: "investor",
      account_status: "active",
      currency_code: "IDR",
      physical_balance: 50000,
      balance_kind: "physical_money_location",
    },
    {
      account_id: "operator-account",
      account_name: "Akun Pengelola",
      stakeholder_type: "pengelola",
      account_status: "active",
      currency_code: "IDR",
      physical_balance: 40000,
      balance_kind: "physical_money_location",
    },
  ],
  allocations: [
    {
      stakeholder_type: "investor",
      allocation_id: "allocation-1",
      period_id: "period-1",
      period_start: "2026-09-01",
      period_end_exclusive: "2026-10-01",
      investor_id: "investor-1",
      currency_code: "IDR",
      result_basis_amount: 7460000,
      percentage: 10,
      allocation_amount: 746000,
      paid_amount: 100000,
      transferred_out_amount: 50000,
      transferred_in_amount: 0,
      remaining_amount: 596000,
      advance_excess_amount: 0,
      status: "closed",
    },
  ],
  payouts: [
    {
      payout_id: "payout-1",
      payout_kind: "allocation_payout",
      stakeholder_type: "investor",
      period_start: "2026-09-01",
      period_id: "period-1",
      investor_allocation_id: "allocation-1",
      operator_allocation_id: null,
      source_account_id: "operational-account",
      transaction_id: "txn-payout",
      amount: 100000,
      currency_code: "IDR",
      paid_at: "2026-10-05T09:00:00Z",
      destination_name: "Penerima Eksternal",
      destination_reference: "REF-100",
      recorded_by_admin_id: "admin-1",
      request_id: "request-1",
      created_at: "2026-10-05T09:00:00Z",
      catatan: "Pembayaran aktual",
      status: "recorded",
    },
    {
      payout_id: "self-transfer-1",
      payout_kind: "investor_self_transfer",
      stakeholder_type: "investor",
      period_start: null,
      period_id: null,
      investor_allocation_id: null,
      operator_allocation_id: null,
      source_account_id: "investor-account",
      transaction_id: "txn-self-transfer",
      amount: 12000,
      currency_code: "IDR",
      paid_at: "2026-10-06T09:00:00Z",
      destination_name: "Rekening pribadi",
      destination_reference: "REF-SELF",
      recorded_by_admin_id: null,
      request_id: null,
      created_at: "2026-10-06T09:00:00Z",
      catatan: "Transfer mandiri Investor",
      status: "recorded",
    },
  ],
  entitlement_transfers: [
    {
      transfer_id: "transfer-1",
      period_id: "period-1",
      source_investor_allocation_id: "allocation-1",
      target_type: "usaha",
      target_operator_allocation_id: null,
      physical_source_account_id: null,
      physical_target_account_id: null,
      transaction_id: null,
      finance_transfer_id: null,
      amount: 50000,
      currency_code: "IDR",
      transferred_at: "2026-10-04T09:00:00Z",
      physical_money_moved: false,
      affects_operational_result: false,
      recorded_by_admin_id: "admin-1",
      request_id: "request-2",
      catatan: "Alih hak tanpa pindah uang",
      status: "recorded",
    },
  ],
  cash_segregations: [
    {
      event_id: "segregation-1",
      stakeholder_type: "investor",
      source_account_id: "operational-account",
      target_account_id: "investor-account",
      transfer_id: "physical-transfer-1",
      amount: 75000,
      currency_code: "IDR",
      occurred_at: "2026-10-03T09:00:00Z",
      recorded_by_admin_id: "admin-1",
      request_id: "request-3",
      catatan: "Pemisahan saldo",
      movement_kind: "cash_segregation",
      affects_entitlement: false,
    },
  ],
};

describe("Investor stakeholder history", () => {
  it("keeps payout, internal cash movement, and entitlement transfer visibly distinct", () => {
    render(
      <InvestorStakeholderHistoryCard
        history={history}
        isLoading={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Pembayaran eksternal Investor")).toBeInTheDocument();
    expect(screen.getByText("Transfer keluar oleh Investor dari saldo tercatat")).toBeInTheDocument();
    expect(screen.getByText("Ya · uang keluar dari akun Investor pribadi")).toBeInTheDocument();
    expect(screen.getByText("Pemisahan kas antar akun internal")).toBeInTheDocument();
    expect(screen.getByText("Alih hak Investor → Usaha")).toBeInTheDocument();
    expect(screen.getByText("Tidak · hanya alih hak")).toBeInTheDocument();
    expect(screen.getByText("Ya · uang berpindah di dalam usaha")).toBeInTheDocument();
    expect(screen.getByText("Penerima Eksternal")).toBeInTheDocument();
    expect(screen.getAllByText("Akun Investor · IDR").length).toBeGreaterThan(0);
  });

  it("shows remaining rights separately from the physical balance", () => {
    render(
      <InvestorStakeholderHistoryCard
        history={history}
        isLoading={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Uang fisik · saldo akun")).toBeInTheDocument();
    expect(screen.getByText("Hak alokasi · saldo hak")).toBeInTheDocument();
    expect(screen.getByText(/Hak awal/)).toBeInTheDocument();
    expect(screen.getByText(/dialihkan keluar/)).toBeInTheDocument();
  });
});
