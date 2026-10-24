import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenPeriodAdvanceCard } from "@/pages/investor";

const { payoutInvestorBalanceMock, withdrawOperatorBalanceMock } = vi.hoisted(() => ({
  payoutInvestorBalanceMock: vi.fn(),
  withdrawOperatorBalanceMock: vi.fn(),
}));

vi.mock("@/features/investor/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/investor/service")>()),
  payoutInvestorBalance: payoutInvestorBalanceMock,
  withdrawOperatorBalance: withdrawOperatorBalanceMock,
}));

const operationalAccounts = [
  {
    akun_keuangan_id: "cash-1",
    nama_akun: "Kas Usaha",
    mata_uang: "IDR",
    saldo: 50000,
  },
];

function renderAdvance(kind: "investor" | "pengelola" = "investor", accounts = operationalAccounts) {
  const onSuccess = vi.fn().mockResolvedValue(undefined);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <OpenPeriodAdvanceCard
        kind={kind}
        usahaId="usaha-1"
        periodStart="2026-10-01"
        availableEntitlement={20000}
        operationalAccounts={accounts}
        onSuccess={onSuccess}
      />
    </QueryClientProvider>,
  );
  return { ...view, onSuccess, client };
}

describe("Open-period Investor/Pengelola advance", () => {
  beforeEach(() => {
    payoutInvestorBalanceMock.mockReset().mockResolvedValue({
      status: "recorded",
      settlement_status: "advance_before_closing",
      affects_operational_result: false,
    });
    withdrawOperatorBalanceMock.mockReset().mockResolvedValue({
      status: "recorded",
      settlement_status: "advance_before_closing",
      affects_operational_result: false,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("records only a real external Investor advance against the current period without an allocation ID", async () => {
    const { onSuccess } = renderAdvance("investor");

    fireEvent.change(screen.getByLabelText("Nominal dibayarkan"), { target: { value: "12500" } });
    fireEvent.change(screen.getByLabelText("Nama penerima"), { target: { value: "Investor UAT" } });
    fireEvent.click(screen.getByRole("button", { name: "Catat penarikan awal" }));

    await waitFor(() => expect(payoutInvestorBalanceMock).toHaveBeenCalledTimes(1));
    expect(payoutInvestorBalanceMock).toHaveBeenCalledWith(expect.objectContaining({
      usahaId: "usaha-1",
      periodStart: "2026-10-01",
      allocationId: null,
      sourceAccountId: "cash-1",
      amount: 12500,
      destinationName: "Investor UAT",
    }));
    expect(withdrawOperatorBalanceMock).not.toHaveBeenCalled();
    expect(window.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("routes the same contract through the Pengelola advance command", async () => {
    renderAdvance("pengelola");

    fireEvent.change(screen.getByLabelText("Nominal dibayarkan"), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText("Nama penerima"), { target: { value: "Pengelola UAT" } });
    fireEvent.click(screen.getByRole("button", { name: "Catat penarikan awal" }));

    await waitFor(() => expect(withdrawOperatorBalanceMock).toHaveBeenCalledTimes(1));
    expect(withdrawOperatorBalanceMock).toHaveBeenCalledWith(expect.objectContaining({
      usahaId: "usaha-1",
      periodStart: "2026-10-01",
      allocationId: null,
      sourceAccountId: "cash-1",
      amount: 10000,
      destinationName: "Pengelola UAT",
    }));
    expect(payoutInvestorBalanceMock).not.toHaveBeenCalled();
  });

  it("disables amounts above the available operational cash", () => {
    renderAdvance();
    fireEvent.change(screen.getByLabelText("Nominal dibayarkan"), { target: { value: "50000.01" } });
    fireEvent.change(screen.getByLabelText("Nama penerima"), { target: { value: "Investor UAT" } });
    expect(screen.getByRole("button", { name: "Catat penarikan awal" })).toBeDisabled();
    expect(payoutInvestorBalanceMock).not.toHaveBeenCalled();
  });

  it("blocks advance entry if the operating-account pool has multiple currencies", () => {
    renderAdvance("investor", [
      ...operationalAccounts,
      {
        akun_keuangan_id: "bank-usd",
        nama_akun: "Bank USD",
        mata_uang: "USD",
        saldo: 800,
      },
    ]);

    expect(screen.getByRole("alert")).toHaveTextContent(/lebih dari satu mata uang/i);
    expect(screen.queryByRole("button", { name: "Catat penarikan awal" })).not.toBeInTheDocument();
  });
});
