import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvestorAccountTransferCard } from "@/pages/investor";
import type { useInvestorDashboard } from "@/features/investor/use-investor-dashboard";
import type { InvestorAccountTransferResult } from "@/features/investor/types";

const { transferInvestorAccountBalanceMock } = vi.hoisted(() => ({
  transferInvestorAccountBalanceMock: vi.fn(),
}));

vi.mock("@/features/investor/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/investor/service")>()),
  transferInvestorAccountBalance: transferInvestorAccountBalanceMock,
}));

const successResult: InvestorAccountTransferResult = {
  status: "recorded",
  transfer_id: "internal-transfer-1",
  transaction_id: "transaction-1",
  source_account_id: "own-account",
  target_account_id: "operational-account",
  amount: 12500,
  currency_code: "IDR",
  source_balance_after: 37500,
  target_balance_after: 87500,
  affects_operational_result: false,
  affects_entitlement: false,
};

function renderCard() {
  const dashboard = {
    principal: {
      data: { investorId: "investor-1", usahaId: "usaha-1" },
    },
    stakeholderAccounts: {
      data: {
        status: "OK",
        accounts: [
          {
            akun_keuangan_id: "own-account",
            nama_akun: "Saldo Investor Saya",
            fungsi_akun: "investor",
            investor_id: "investor-1",
            pengelola_akun_admin_id: null,
            mata_uang: "IDR",
            saldo: 50000,
          },
        ],
        transfer_targets: [
          {
            akun_keuangan_id: "operational-account",
            nama_akun: "Kas Usaha",
            fungsi_akun: "operasional",
            investor_id: null,
            nama_pemilik: "Akun Usaha",
            mata_uang: "IDR",
          },
          {
            akun_keuangan_id: "other-investor-account",
            nama_akun: "Saldo Investor Lain",
            fungsi_akun: "investor",
            investor_id: "investor-2",
            nama_pemilik: "Investor Lain",
            mata_uang: "IDR",
          },
          {
            akun_keuangan_id: "foreign-currency-account",
            nama_akun: "Akun USD",
            fungsi_akun: "operasional",
            investor_id: null,
            nama_pemilik: "Akun Usaha",
            mata_uang: "USD",
          },
        ],
        investor_allocations: [],
        operator_allocations: [],
      },
      isLoading: false,
      isError: false,
      error: null,
    },
  } as unknown as ReturnType<typeof useInvestorDashboard>;

  const onSuccess = vi.fn().mockResolvedValue(undefined);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const view = render(
    <QueryClientProvider client={client}>
      <InvestorAccountTransferCard dashboard={dashboard} onSuccess={onSuccess} />
    </QueryClientProvider>,
  );
  return { ...view, dashboard, onSuccess, client };
}

describe("Investor internal account transfer", () => {
  beforeEach(() => {
    transferInvestorAccountBalanceMock.mockReset();
    transferInvestorAccountBalanceMock.mockResolvedValue(successResult);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows the Investor's own balance and offers only same-currency internal targets", () => {
    renderCard();
    expect(screen.getByText("Saldo Investor Saya")).toBeTruthy();
    expect(screen.getByLabelText("Akun tujuan internal")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Kas Usaha.*Akun Usaha/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Saldo Investor Lain.*Investor Lain/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Akun USD/ })).toBeNull();
    expect(screen.queryByLabelText(/nama penerima|rekening pribadi|referensi/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Catat Transfer Internal" }).hasAttribute("disabled")).toBe(true);
  });

  it("records an internal transfer with source/target account IDs and refreshes canonical reads", async () => {
    const { onSuccess } = renderCard();
    fireEvent.change(screen.getByLabelText("Akun sumber"), { target: { value: "own-account" } });
    fireEvent.change(screen.getByLabelText("Akun tujuan internal"), { target: { value: "operational-account" } });
    fireEvent.change(screen.getByLabelText("Nominal transfer"), { target: { value: "12500" } });
    fireEvent.change(screen.getByLabelText("Catatan (opsional)"), { target: { value: "Setoran kembali operasional" } });
    fireEvent.click(screen.getByRole("button", { name: "Catat Transfer Internal" }));

    await waitFor(() => expect(transferInvestorAccountBalanceMock).toHaveBeenCalledTimes(1));
    const input = transferInvestorAccountBalanceMock.mock.calls[0][0];
    expect(input).toMatchObject({
      usahaId: "usaha-1",
      sourceAccountId: "own-account",
      targetAccountId: "operational-account",
      amount: 12500,
      catatan: "Setoran kembali operasional",
    });
    expect(input.idempotencyKey).toContain("investor-account-transfer-");
    expect(input.requestId).toBeTruthy();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText(/tidak menjadi pemasukan\/pengeluaran, dan tidak mengubah hak alokasi/i)).toBeTruthy();
  });

  it("disables submission when the amount exceeds the source balance", () => {
    renderCard();
    fireEvent.change(screen.getByLabelText("Akun sumber"), { target: { value: "own-account" } });
    fireEvent.change(screen.getByLabelText("Akun tujuan internal"), { target: { value: "operational-account" } });
    fireEvent.change(screen.getByLabelText("Nominal transfer"), { target: { value: "50001" } });
    expect(screen.getByRole("button", { name: "Catat Transfer Internal" }).hasAttribute("disabled")).toBe(true);
    expect(transferInvestorAccountBalanceMock).not.toHaveBeenCalled();
  });
});
