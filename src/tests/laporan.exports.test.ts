import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  formatFinanceDirection,
  formatFinanceKind,
  formatFinanceSource,
  formatFinanceStatus,
  formatPaymentKind,
  formatRentalStatus,
  type FinanceExportReport,
  type RentalExportReport,
} from "@/features/laporan/export-service";

const pdfDownload = vi.hoisted(() => ({ downloadPdfBytes: vi.fn() }));
vi.mock("@/features/qr-operasional/download", () => pdfDownload);

import { downloadPdfBytes } from "@/features/qr-operasional/download";
import { exportFinanceReportToExcel, exportRentalReportToExcel } from "@/features/laporan/excel";
import { exportFinanceReportToPdf, exportRentalReportToPdf } from "@/features/laporan/pdf";

const period = {
  start_date: "2026-10-01",
  end_date_exclusive: "2026-11-01",
  timezone: "Asia/Jakarta",
};

const financeReport = {
  period,
  currencySummaries: [{
    currency_code: "IDR",
    recorded_income: 1500000,
    recorded_expense: 300000,
    net_operational_movement: 1200000,
    recorded_income_transaction_count: 2,
    recorded_expense_transaction_count: 1,
    recorded_payment_amount: 1500000,
    recorded_payment_count: 2,
    reversal_income_in_period: 0,
    reversal_expense_in_period: 0,
  }],
  hasMultipleCurrencies: false,
  expenseByCategoryCurrency: [],
  expenseBySupplierCurrency: [],
  expenseBySourceCurrency: [],
  summary: {
    ...period,
    recorded_income: 1500000,
    recorded_expense: 300000,
    net_operational_movement: 1200000,
    recorded_income_transaction_count: 2,
    recorded_expense_transaction_count: 1,
    recorded_payment_amount: 1500000,
    recorded_payment_count: 2,
    reversal_income_in_period: 0,
    reversal_expense_in_period: 0,
    source_note: "Data finance resmi.",
  },
  transactions: [],
  payments: [],
  expenses: [],
  productRevenue: {
    ...period,
    items: [],
    total_rental_or_reservation_income: 1500000,
    exact_attributable_income: 0,
    unallocated_income: 1500000,
    coverage_ratio: 0,
    allocation_policy: "Exact attribution only.",
  },
  unitRevenue: {
    ...period,
    items: [],
    total_rental_income: 1500000,
    exact_unit_attributable_income: 0,
    unallocated_or_ambiguous_income: 1500000,
    coverage_ratio: 0,
    allocation_policy: "Exact unit attribution only.",
  },
  accounts: [],
  unclassifiedAccounts: [],
  accountMovements: [],
  stakeholderAccounts: [],
  stakeholderAllocations: [],
  stakeholderPayouts: [],
  stakeholderTransfers: [],
  stakeholderCashSegregations: [],
  financeHealth: { status: "HEALTHY", critical: {}, attention: {}, principle: "Tes" },
  reconciliationFindings: [],
} as unknown as FinanceExportReport;

const rentalReport = {
  period: { ...period, basis: "Tanggal mulai jadwal penyewaan." },
  currencySummaries: [{
    currency_code: "IDR",
    rental_count: 0,
    completed_count: 0,
    active_count: 0,
    draft_count: 0,
    cancelled_count: 0,
    contractual_value: 0,
    recorded_payment_total: 0,
    balance_due_total: 0,
    overpaid_total: 0,
    estimated_late_fee_total: 0,
    approved_late_fee_total: 0,
    pending_late_fee_total: 0,
  }],
  hasMultipleCurrencies: false,
  summary: {
    rental_count: 0,
    completed_count: 0,
    active_count: 0,
    draft_count: 0,
    cancelled_count: 0,
    contractual_value: 0,
    recorded_payment_total: 0,
    balance_due_total: 0,
    overpaid_total: 0,
    estimated_late_fee_total: 0,
    approved_late_fee_total: 0,
    pending_late_fee_total: 0,
  },
  items: [],
  payments: [],
} as unknown as RentalExportReport;

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("Blob test tidak dapat dibaca."));
    };
    reader.onerror = () => reject(new Error("Blob test gagal dibaca."));
    reader.readAsArrayBuffer(blob);
  });
}

describe("Laporan exports", () => {
  test("uses Indonesian business labels for report status and finance details", () => {
    expect(formatRentalStatus("active")).toBe("Sedang disewa");
    expect(formatRentalStatus("tolerance_expired")).toBe("Masa toleransi habis");
    expect(formatFinanceStatus("recorded")).toBe("Tercatat");
    expect(formatFinanceStatus("pending_review")).toBe("Menunggu review");
    expect(formatFinanceDirection("income")).toBe("Masuk");
    expect(formatFinanceDirection("expense")).toBe("Keluar");
    expect(formatFinanceKind("finance_reversal")).toBe("Koreksi transaksi keuangan");
    expect(formatFinanceSource("purchase")).toBe("Pembelian");
    expect(formatPaymentKind("pelunasan")).toBe("Pelunasan");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("finance Excel has readable summary, account, payment, expense and attribution sheets", async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const capturedBlobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: (blob: Blob) => {
        capturedBlobs.push(blob);
        return "blob:laporan-finance-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      await exportFinanceReportToExcel(financeReport, "Outdoor Test");
      expect(click).toHaveBeenCalledTimes(1);
      expect(capturedBlobs).toHaveLength(1);
      const capturedBlob = capturedBlobs[0];
      if (!capturedBlob) throw new Error("File Excel tidak tertangkap.");
      expect(capturedBlob.type).toContain("spreadsheetml.sheet");

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await readBlobAsArrayBuffer(capturedBlob));
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(
        expect.arrayContaining([
          "Ringkasan",
          "Transaksi",
          "Akun Operasional",
          "Akun Belum Diklasifikasi",
          "Rekonsiliasi",
          "Mutasi Akun",
          "Akun Stakeholder",
          "Alokasi Bagi Hasil",
          "Payout Stakeholder",
          "Alih Hak Investor",
          "Pemisahan Kas",
          "Pembayaran",
          "Pengeluaran",
          "Pendapatan Barang",
          "Pendapatan Unit",
        ]),
      );
      const summarySheet = workbook.getWorksheet("Ringkasan");
      expect(summarySheet?.getCell(6, 1).value).toBe("Mata Uang");
      expect(summarySheet?.getCell(6, 2).value).toBe("Indikator");
      expect(summarySheet?.getCell(7, 2).value).toBe("Pemasukan tercatat");
    } finally {
      if (originalCreate) Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreate });
      else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      if (originalRevoke) Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevoke });
      else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
      click.mockRestore();
    }
  });

  test("rental Excel includes rental detail, payment, line-item and late-fee sheets", async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const capturedBlobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: (blob: Blob) => {
        capturedBlobs.push(blob);
        return "blob:laporan-rental-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      await exportRentalReportToExcel(rentalReport, "Outdoor Test");
      expect(click).toHaveBeenCalledTimes(1);
      expect(capturedBlobs).toHaveLength(1);
      const capturedBlob = capturedBlobs[0];
      if (!capturedBlob) throw new Error("File Excel tidak tertangkap.");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await readBlobAsArrayBuffer(capturedBlob));
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(
        expect.arrayContaining([
          "Ringkasan",
          "Daftar Penyewaan",
          "Pembayaran Penyewaan",
          "Rincian Barang",
          "Tinjauan Denda",
        ]),
      );
    } finally {
      if (originalCreate) Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreate });
      else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      if (originalRevoke) Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevoke });
      else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
      click.mockRestore();
    }
  });

  test("finance PDF is valid, multi-page, and downloaded with a PDF file name", async () => {
    vi.mocked(downloadPdfBytes).mockClear();
    await exportFinanceReportToPdf(financeReport, "Outdoor Test");
    const [bytes, fileName] = vi.mocked(downloadPdfBytes).mock.calls[0];
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(fileName.startsWith("laporan-keuangan-outdoor-test-")).toBe(true);
    expect(fileName.endsWith(".pdf")).toBe(true);
  });

  test("rental PDF is valid, multi-page, and downloaded with a PDF file name", async () => {
    vi.mocked(downloadPdfBytes).mockClear();
    await exportRentalReportToPdf(rentalReport, "Outdoor Test");
    const [bytes, fileName] = vi.mocked(downloadPdfBytes).mock.calls[0];
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(fileName.startsWith("laporan-penyewaan-outdoor-test-")).toBe(true);
    expect(fileName.endsWith(".pdf")).toBe(true);
  });
});
