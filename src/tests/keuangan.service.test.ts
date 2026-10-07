import { describe, expect, test, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: { rpc: rpcMock },
}));

import {
  getFinanceSummary,
  getFinanceProductRevenue,
  getFinanceUnitRevenue,
  getFinanceHealth,
  correctPayment,
  recordExpenseWithFinanceCashout,
  reconcileExpenseCashoutCommand,
} from "@/features/keuangan/service";

describe("Finance F3 server-side contracts", () => {
  test("summary delegates period semantics to the trusted RPC", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        period: { start_date: "2026-09-01", end_date_exclusive: "2026-10-01", timezone: "Asia/Jakarta" },
        recorded_income: 1000000,
        recorded_expense: 250000,
        net_operational_movement: 750000,
        recorded_income_transaction_count: 2,
        recorded_expense_transaction_count: 1,
        recorded_payment_amount: 1000000,
        recorded_payment_count: 2,
        reversal_income_in_period: 0,
        reversal_expense_in_period: 0,
        source_note: "test",
      },
      error: null,
    });

    await expect(getFinanceSummary("usaha-1", "2026-09-01", "2026-10-01")).resolves.toMatchObject({
      recorded_income: 1000000,
      net_operational_movement: 750000,
    });

    expect(rpcMock).toHaveBeenCalledWith("finance_summary", {
      p_usaha_id: "usaha-1",
      p_start_date: "2026-09-01",
      p_end_date: "2026-10-01",
    });
  });

  test("product and unit revenue preserve attribution coverage", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: {
          period: { start_date: "2026-09-01", end_date_exclusive: "2026-10-01", timezone: "Asia/Jakarta" },
          items: [],
          total_rental_or_reservation_income: 500000,
          exact_attributable_income: 300000,
          unallocated_income: 200000,
          coverage_ratio: 0.6,
          allocation_policy: "exact only",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          period: { start_date: "2026-09-01", end_date_exclusive: "2026-10-01", timezone: "Asia/Jakarta" },
          items: [],
          total_rental_income: 500000,
          exact_unit_attributable_income: 200000,
          unallocated_or_ambiguous_income: 300000,
          coverage_ratio: 0.4,
          allocation_policy: "exact only",
        },
        error: null,
      });

    await expect(getFinanceProductRevenue("usaha-1", "2026-09-01", "2026-10-01")).resolves.toMatchObject({
      exact_attributable_income: 300000,
      unallocated_income: 200000,
      coverage_ratio: 0.6,
    });

    await expect(getFinanceUnitRevenue("usaha-1", "2026-09-01", "2026-10-01")).resolves.toMatchObject({
      exact_unit_attributable_income: 200000,
      unallocated_or_ambiguous_income: 300000,
    });
  });

  test("health contract exposes explicit integrity state", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        status: "ATTENTION",
        critical: { payment_orphan: 0 },
        attention: { finance_outbox_pending: 2 },
        principle: "Every payment has source+transaction",
      },
      error: null,
    });

    await expect(getFinanceHealth("usaha-1")).resolves.toMatchObject({
      status: "ATTENTION",
      attention: { finance_outbox_pending: 2 },
    });
  });

  test("correction requires a human reason and sends idempotency/request metadata", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        pembayaran_id: "payment-1",
        status: "voided",
        correction_id: "correction-1",
        nomor_koreksi: "KOR-2026-001",
        replacement_transaksi_keuangan_id: null,
      },
      error: null,
    });

    await expect(
      correctPayment("usaha-1", "payment-1", "void", "Duplicate entry", {
        idempotencyKey: "correct-payment-test",
        requestId: "request-correct-payment-test",
      }),
    ).resolves.toMatchObject({ status: "voided", correction_id: "correction-1" });

    expect(rpcMock).toHaveBeenCalledWith("command_correct_payment", {
      p_usaha_id: "usaha-1",
      p_pembayaran_id: "payment-1",
      p_action_type: "void",
      p_reason: "Duplicate entry",
      p_idempotency_key: "correct-payment-test",
      p_request_id: "request-correct-payment-test",
    });
  });
});


describe("Manual expense cash-out command", () => {
  test("maps multi-account cash-out allocations to the trusted RPC", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        pengeluaran_id: "expense-cashout-1",
        nomor_pengeluaran: "EXP-2026-001",
        transaksi_keuangan_id: "trx-cashout-1",
        nomor_transaksi: "TRX-2026-001",
        status: "recorded",
        source_type: "operational",
        source_id: null,
        amount: 125000,
        currency_code: "IDR",
        tanggal_pengeluaran: "2026-10-04",
        cash_out_recorded: true,
        settlement: {
          allocations: [
            { akun_keuangan_id: "account-1", amount: 75000 },
            { akun_keuangan_id: "account-2", amount: 50000 },
          ],
        },
      },
      error: null,
    });

    await expect(
      recordExpenseWithFinanceCashout(
        "usaha-1",
        {
          sourceType: "operational",
          kategoriBiaya: "Operasional",
          deskripsi: "Pembelian perlengkapan",
          amount: 125000,
          tanggalPengeluaran: "2026-10-04",
          allocations: [
            { akunKeuanganId: "account-1", amount: 75000 },
            { akunKeuanganId: "account-2", amount: 50000 },
          ],
        },
        {
          idempotencyKey: "expense-cashout-test",
          requestId: "request-expense-cashout-test",
        },
      ),
    ).resolves.toMatchObject({
      pengeluaran_id: "expense-cashout-1",
      cash_out_recorded: true,
    });

    expect(rpcMock).toHaveBeenCalledWith("command_record_expense_with_finance_cashout", {
      p_usaha_id: "usaha-1",
      p_source_type: "operational",
      p_source_id: null,
      p_pemasok_id: null,
      p_kategori_biaya: "Operasional",
      p_deskripsi: "Pembelian perlengkapan",
      p_amount: 125000,
      p_tanggal_pengeluaran: "2026-10-04",
      p_bukti_storage_path: null,
      p_catatan: null,
      p_allocations: [
        { akun_keuangan_id: "account-1", amount: 75000 },
        { akun_keuangan_id: "account-2", amount: 50000 },
      ],
      p_idempotency_key: "expense-cashout-test",
      p_request_id: "request-expense-cashout-test",
    });
  });

  test("rejects incomplete allocations before calling the RPC", async () => {
    await expect(
      recordExpenseWithFinanceCashout(
        "usaha-1",
        {
          sourceType: "manual",
          kategoriBiaya: "Manual",
          deskripsi: "Biaya kecil",
          amount: 100000,
          allocations: [{ akunKeuanganId: "account-1", amount: 25000 }],
        },
      ),
    ).rejects.toThrow("Total alokasi akun harus sama dengan nominal pengeluaran.");

    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("reconciles unknown manual expense cash-out outcome through its command boundary", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        state: "committed",
        response: {
          pengeluaran_id: "expense-cashout-2",
          nomor_pengeluaran: "EXP-2026-002",
          transaksi_keuangan_id: "trx-cashout-2",
          nomor_transaksi: "TRX-2026-002",
          status: "recorded",
          source_type: "manual",
          source_id: null,
          amount: 50000,
          currency_code: "IDR",
        },
      },
      error: null,
    });

    await expect(
      reconcileExpenseCashoutCommand("usaha-1", "expense-cashout-reconcile"),
    ).resolves.toMatchObject({
      state: "committed",
      response: { pengeluaran_id: "expense-cashout-2" },
    });

    expect(rpcMock).toHaveBeenCalledWith("command_reconcile_expense_with_finance_cashout", {
      p_usaha_id: "usaha-1",
      p_idempotency_key: "expense-cashout-reconcile",
    });
  });
});
