import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFinanceExportReport: vi.fn(),
  getRentalExportReport: vi.fn(),
  exportFinanceReportToExcel: vi.fn(),
  exportFinanceReportToPdf: vi.fn(),
  exportRentalReportToExcel: vi.fn(),
  exportRentalReportToPdf: vi.fn(),
  getPenyewaanContext: vi.fn(),
}));

vi.mock("@/app/current-usaha-context", () => ({
  useCurrentUsaha: () => ({
    current: { usahaId: "usaha-1", usahaNama: "Akasha Outdoor" },
    status: "ready",
    error: null,
  }),
}));

vi.mock("@/features/laporan/export-service", () => ({
  getFinanceExportReport: mocks.getFinanceExportReport,
  getRentalExportReport: mocks.getRentalExportReport,
  formatFinanceKind: (value: string) => value === "income" ? "Pemasukan" : value,
  formatFinanceSource: (value: string | null) => value ?? "Lainnya",
  formatRentalStatus: (value: string) => value === "active" ? "Sedang disewa" : value,
}));

vi.mock("@/features/laporan/excel", () => ({
  exportFinanceReportToExcel: mocks.exportFinanceReportToExcel,
  exportRentalReportToExcel: mocks.exportRentalReportToExcel,
}));

vi.mock("@/features/laporan/pdf", () => ({
  exportFinanceReportToPdf: mocks.exportFinanceReportToPdf,
  exportRentalReportToPdf: mocks.exportRentalReportToPdf,
}));

vi.mock("@/features/penyewaan/service", () => ({
  getPenyewaanContext: mocks.getPenyewaanContext,
}));

import { LaporanPage } from "@/pages/laporan";

const financeReport = {
  period: { start_date: "2026-11-01", end_date_exclusive: "2026-12-01", timezone: "Asia/Jakarta" },
  currencySummaries: [{
    currency_code: "IDR",
    rental_income: 500000,
    retail_income: 125000,
    other_income: 0,
    recorded_income: 625000,
    recorded_expense: 200000,
    net_operational_movement: 425000,
    recorded_income_transaction_count: 3,
    recorded_expense_transaction_count: 1,
    recorded_payment_amount: 625000,
    recorded_payment_count: 3,
    reversal_income_in_period: 0,
    reversal_expense_in_period: 0,
  }],
  hasMultipleCurrencies: false,
  expenseByCategoryCurrency: [{ currency_code: "IDR", key: "Pembelian", amount: 200000, count: 1 }],
  transactions: [{
    transaksi_keuangan_id: "finance-1",
    nomor_transaksi: "TRX-001",
    jenis: "income",
    arah: "income",
    tanggal_transaksi: "2026-11-06T02:00:00.000Z",
    amount: 625000,
    currency_code: "IDR",
    sumber_type: "sale",
  }],
  retailSales: [{
    penjualan_id: "sale-1",
    nomor_penjualan: "SL-001",
    source: "pos",
    nama_pelanggan: "Pelanggan Uji",
    nomor_telepon: null,
    status: "completed",
    payment_status: "paid",
    total_amount: 125000,
    total_hpp: 75000,
    gross_profit: 50000,
    created_at: "2026-11-06T02:00:00.000Z",
    currency_code: "IDR",
    item_count: 1,
    quantity: 2,
    known_hpp: 75000,
    gross_profit_known: 50000,
    hpp_unknown_lines: 0,
  }],
  purchases: [{
    pembelian_id: "purchase-1",
    nomor_pembelian: "PO-001",
    tanggal_pembelian: "2026-11-05",
    status: "received",
    pemasok_id: null,
    nama_pemasok: "Supplier Uji",
    total_amount: 80000,
    currency_code: "IDR",
    catatan: null,
    item_count: 1,
    received_quantity: 4,
    received_stock_value: 80000,
    cash_out_amount: 80000,
  }],
  promotionUsage: [{
    tanggal: "2026-11-06T02:00:00.000Z",
    sumber: "Penjualan",
    nomor_transaksi: "SL-001",
    jenis_promo: "Promo katalog penjualan",
    promo_id: "promo-1",
    barang_paket: "Jaket",
    jumlah: 2,
    mata_uang: "IDR",
    harga_normal: 150000,
    diskon: 25000,
    nilai_akhir: 125000,
    hpp_bonus: null,
    catatan: "Diskon 16%",
  }],
} as never;

const rentalReport = {
  period: { start_date: "2026-11-01", end_date_exclusive: "2026-12-01", timezone: "Asia/Jakarta", basis: "Tanggal mulai jadwal penyewaan." },
  currencySummaries: [{
    currency_code: "IDR",
    rental_count: 1,
    completed_count: 0,
    active_count: 1,
    draft_count: 0,
    cancelled_count: 0,
    contractual_value: 500000,
    recorded_payment_total: 200000,
    balance_due_total: 300000,
    overpaid_total: 0,
    estimated_late_fee_total: 0,
    approved_late_fee_total: 0,
    pending_late_fee_total: 0,
  }],
  hasMultipleCurrencies: false,
  summary: { rental_count: 1, completed_count: 0, active_count: 1, draft_count: 0, cancelled_count: 0 },
  items: [],
  payments: [],
} as never;

function renderPage() {
  return render(<MemoryRouter initialEntries={["/laporan"]}><LaporanPage /></MemoryRouter>);
}

describe("Laporan dashboard-style workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFinanceExportReport.mockResolvedValue(financeReport);
    mocks.getRentalExportReport.mockResolvedValue(rentalReport);
    mocks.getPenyewaanContext.mockResolvedValue({ timezone: "Asia/Jakarta" });
  });

  test("loads sales, purchase, and realized promo details for the finance view without the heavy reconciliation bundle", async () => {
    renderPage();

    expect(await screen.findByText("Promo & Diskon Digunakan")).toBeInTheDocument();
    expect(screen.getByText("Penjualan Retail")).toBeInTheDocument();
    expect(screen.getByText("Pembelian & Penerimaan")).toBeInTheDocument();
    expect(screen.getByText("Promo katalog penjualan")).toBeInTheDocument();
    expect(screen.getByText(/Supplier Uji/)).toBeInTheDocument();
    expect(mocks.getFinanceExportReport).toHaveBeenCalledWith(
      "usaha-1",
      expect.any(String),
      expect.any(String),
      false,
      true,
    );
  });

  test("switches to a compact rental report while keeping period controls available", async () => {
    renderPage();

    await screen.findByText("Promo & Diskon Digunakan");
    fireEvent.click(screen.getByRole("tab", { name: "Penyewaan" }));

    expect(await screen.findByText("Ringkasan Penyewaan")).toBeInTheDocument();
    expect(screen.getByText("Daftar Penyewaan")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Keuangan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7 hari" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getRentalExportReport).toHaveBeenCalledWith(
      "usaha-1",
      expect.any(String),
      expect.any(String),
      "Asia/Jakarta",
    ));
  });
});
