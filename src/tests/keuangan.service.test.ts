import { describe, expect, test, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: { rpc: rpcMock },
}));

import {
  getFinanceSummary,
  getFinanceDashboardAnalytics,
  getFinanceRetailAnalysis,
  getFinancePaymentPage,
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

  test("retail analysis delegates the bounded read model to the trusted RPC", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        period: { start_date: "2026-11-01", end_date_exclusive: "2026-12-01", timezone: "Asia/Jakarta" },
        summary: {
          sales_count: 2,
          sales_revenue: 25000,
          sold_quantity: 3,
          known_hpp: 10000,
          gross_profit_known: 15000,
          hpp_unknown_revenue: 0,
          hpp_unknown_lines: 0,
          known_hpp_lines: 2,
          sales_with_incomplete_hpp: 0,
          hpp_coverage_pct: 100,
          payment_received: 25000,
          payment_count: 2,
          completed_purchase_count: 1,
          completed_purchase_value: 10000,
          purchase_cash_out: 10000,
          receiving_count: 1,
          received_quantity: 2,
          received_stock_value: 10000,
          currency_code: "IDR",
        },
        top_products: [],
        recent_sales: [],
        purchase_history: [],
        stock_snapshot: [],
        read_only: true,
        account_policy: "shared cash account",
        hpp_policy: "HPP at sale",
      },
      error: null,
    });

    await expect(getFinanceRetailAnalysis("usaha-1", "2026-11-01", "2026-12-01")).resolves.toMatchObject({
      start_date: "2026-11-01",
      summary: { sales_revenue: 25000, gross_profit_known: 15000 },
      read_only: true,
    });

    expect(rpcMock).toHaveBeenCalledWith("finance_retail_analysis", {
      p_usaha_id: "usaha-1",
      p_start_date: "2026-11-01",
      p_end_date: "2026-12-01",
      p_limit: 50,
    });
  });

  test("unified payment page preserves the source ledger discriminator", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        period: { start_date: "2026-11-01", end_date_exclusive: "2026-12-01", timezone: "Asia/Jakarta" },
        items: [{
          pembayaran_id: "sale-payment-1",
          usaha_id: "usaha-1",
          reservasi_id: null,
          penyewaan_id: null,
          penjualan_id: "sale-1",
          nomor_penjualan: "POS-2026-0001",
          transaksi_keuangan_id: "transaction-1",
          nomor_transaksi: "TRX-2026-0001",
          nomor_pembayaran: "POSPAY-2026-0001",
          jenis: "pembayaran_penjualan",
          metode: "cash",
          amount: 10000,
          currency_code: "IDR",
          dibayar_at: "2026-11-05T10:00:00+07:00",
          dicatat_by_admin_id: "admin-1",
          reference_text: null,
          catatan: null,
          status: "recorded",
          created_at: "2026-11-05T10:00:00+07:00",
          updated_at: "2026-11-05T10:00:00+07:00",
          payment_source_type: "sale",
          source_label: "Penjualan POS-2026-0001",
        }],
        total: 1,
        limit: 20,
        offset: 0,
        has_more: false,
      },
      error: null,
    });

    await expect(getFinancePaymentPage("usaha-1", "2026-11-01", "2026-12-01", 20, 0)).resolves.toMatchObject({
      total: 1,
      items: [{ payment_source_type: "sale", penjualan_id: "sale-1", source_label: "Penjualan POS-2026-0001" }],
    });
    expect(rpcMock).toHaveBeenCalledWith("finance_payment_page", {
      p_usaha_id: "usaha-1",
      p_start_date: "2026-11-01",
      p_end_date: "2026-12-01",
      p_limit: 20,
      p_offset: 0,
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

  test("purchase-sourced expense cash-out carries the purchase source id", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        pengeluaran_id: "expense-purchase-1",
        nomor_pengeluaran: "EXP-2026-014",
        transaksi_keuangan_id: "transaction-purchase-1",
        nomor_transaksi: "TRX-2026-014",
        status: "recorded",
        source_type: "purchase",
        source_id: "purchase-1",
        amount: 300000,
        currency_code: "IDR",
        cash_out_recorded: true,
        purchase_status: "completed",
      },
      error: null,
    });

    await expect(recordExpenseWithFinanceCashout("usaha-1", {
      sourceType: "purchase",
      sourceId: "purchase-1",
      pemasokId: "supplier-1",
      kategoriBiaya: "Pembelian",
      deskripsi: "Pembelian PB-2026-014",
      amount: 300000,
      tanggalPengeluaran: "2026-10-28",
      allocations: [{ akunKeuanganId: "cash-operasional", amount: 300000 }],
    }, {
      idempotencyKey: "expense-from-purchase-test",
      requestId: "request-expense-from-purchase-test",
    })).resolves.toMatchObject({
      pengeluaran_id: "expense-purchase-1",
      cash_out_recorded: true,
    });

    expect(rpcMock).toHaveBeenCalledWith("command_record_expense_with_finance_cashout", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_source_type: "purchase",
      p_source_id: "purchase-1",
      p_pemasok_id: "supplier-1",
      p_amount: 300000,
      p_allocations: [{ akun_keuangan_id: "cash-operasional", amount: 300000 }],
      p_idempotency_key: "expense-from-purchase-test",
      p_request_id: "request-expense-from-purchase-test",
    }));
  });

  test("rejects purchase cash-out without a purchase source before RPC", async () => {
    await expect(recordExpenseWithFinanceCashout("usaha-1", {
      sourceType: "purchase",
      kategoriBiaya: "Pembelian",
      deskripsi: "Pembelian tanpa sumber",
      amount: 300000,
      allocations: [{ akunKeuanganId: "cash-operasional", amount: 300000 }],
    })).rejects.toThrow("Pilih pembelian yang akan diselesaikan.");
    expect(rpcMock).not.toHaveBeenCalled();
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


describe("Dashboard finance analytics contract", () => {
  test("loads daily cashflow and promo summary for the selected period", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        period: {
          start_date: "2026-11-01",
          end_date_exclusive: "2026-12-01",
          timezone: "Asia/Jakarta",
        },
        total_transaction_count: 6,
        currencies: ["IDR"],
        cashflow: [{
          date: "2026-11-07",
          currency_code: "IDR",
          income: 600000,
          expense: 250000,
          rental_income: 450000,
          retail_income: 150000,
          purchase_expense: 200000,
          other_expense: 50000,
          net: 350000,
        }],
        payment_summary: [{ currency_code: "IDR", amount: 600000, count: 4 }],
        promotions: {
          active_catalog_count: 2,
          active_package_count: 1,
          loyalty_active: true,
          active_count: 4,
          used_transaction_count: 3,
          discount_by_currency: [{ currency_code: "IDR", amount: 75000 }],
        },
      },
      error: null,
    });

    await expect(
      getFinanceDashboardAnalytics("usaha-1", "2026-11-01", "2026-12-01"),
    ).resolves.toMatchObject({
      total_transaction_count: 6,
      currencies: ["IDR"],
      cashflow: [{ date: "2026-11-07", rental_income: 450000, retail_income: 150000, net: 350000 }],
      payment_summary: [{ currency_code: "IDR", amount: 600000, count: 4 }],
      promotions: { active_count: 4, used_transaction_count: 3 },
    });

    expect(rpcMock).toHaveBeenCalledWith("finance_dashboard_analytics", {
      p_usaha_id: "usaha-1",
      p_start_date: "2026-11-01",
      p_end_date: "2026-12-01",
    });
  });
});
