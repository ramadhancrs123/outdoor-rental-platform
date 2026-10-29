import { downloadPdfBytes } from "@/features/qr-operasional/download";
import {
  formatFinanceDirection,
  formatFinanceKind,
  formatFinanceSource,
  formatFinanceStatus,
  formatPaymentKind,
  formatRentalStatus,
  type FinanceExportReport,
  type RentalExportReport,
} from "./export-service";

type ReportSection = {
  title: string;
  headers: string[];
  widths: number[];
  rows: string[][];
};

type Metric = { label: string; value: string };

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 30;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PDF_SECTION_ROW_LIMIT = 200;

function safeText(value: unknown) {
  return String(value ?? "-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—→]/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function moneyForCurrency(value: number | string | null | undefined, currencyCode: string) {
  try {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: currencyCode, maximumFractionDigits: 2 }).format(Number(value ?? 0));
  } catch {
    return Number(value ?? 0).toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " " + safeText(currencyCode);
  }
}

function lastDayExclusive(period: { end_date_exclusive: string }) {
  const date = new Date(period.end_date_exclusive + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function slug(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "usaha";
}

function timestamp(timeZone: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date()).replace(/[^0-9]+/g, "");
}

function fitText(text: string, font: { widthOfTextAtSize: (value: string, size: number) => number }, size: number, width: number) {
  let value = safeText(text);
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  while (value.length > 0 && font.widthOfTextAtSize(value + "...", size) > width) value = value.slice(0, -1);
  return value.length ? value + "..." : "";
}

function drawPageHeader(
  page: import("pdf-lib").PDFPage,
  font: import("pdf-lib").PDFFont,
  boldFont: import("pdf-lib").PDFFont,
  rgb: typeof import("pdf-lib").rgb,
  title: string,
  businessName: string,
  period: { start_date: string; end_date_exclusive: string; timezone: string },
  pageNumber: number,
) {
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 84, width: PAGE_WIDTH, height: 84, color: rgb(0.09, 0.20, 0.31) });
  page.drawText(fitText(title, boldFont, 17, CONTENT_WIDTH), {
    x: MARGIN,
    y: PAGE_HEIGHT - 36,
    size: 17,
    font: boldFont,
    color: rgb(1, 1, 1),
  });
  page.drawText(fitText(businessName, font, 9, CONTENT_WIDTH), {
    x: MARGIN,
    y: PAGE_HEIGHT - 54,
    size: 9,
    font,
    color: rgb(0.88, 0.93, 0.96),
  });
  page.drawText("Periode: " + period.start_date + " s.d. " + lastDayExclusive(period) + " | Zona waktu: " + period.timezone, {
    x: MARGIN,
    y: PAGE_HEIGHT - 69,
    size: 8,
    font,
    color: rgb(0.88, 0.93, 0.96),
  });
  page.drawText("Halaman " + pageNumber, {
    x: PAGE_WIDTH - MARGIN - 55,
    y: 16,
    size: 7,
    font,
    color: rgb(0.42, 0.46, 0.51),
  });
}

async function buildReportPdf(input: {
  title: string;
  businessName: string;
  period: { start_date: string; end_date_exclusive: string; timezone: string };
  metrics: Metric[];
  notes: string[];
  sections: ReportSection[];
}) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  let pageNumber = 1;
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  drawPageHeader(page, font, boldFont, rgb, input.title, input.businessName, input.period, pageNumber);
  page.drawText("RINGKASAN", {
    x: MARGIN,
    y: PAGE_HEIGHT - 110,
    size: 10,
    font: boldFont,
    color: rgb(0.09, 0.20, 0.31),
  });

  const metricGap = 12;
  const metricWidth = (CONTENT_WIDTH - metricGap) / 2;
  const metricHeight = 54;
  const metricTop = PAGE_HEIGHT - 126;
  input.metrics.forEach((metric, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = MARGIN + col * (metricWidth + metricGap);
    const y = metricTop - row * (metricHeight + 10) - metricHeight;
    page.drawRectangle({
      x,
      y,
      width: metricWidth,
      height: metricHeight,
      color: rgb(0.95, 0.97, 0.98),
      borderColor: rgb(0.84, 0.88, 0.91),
      borderWidth: 0.8,
    });
    page.drawText(fitText(metric.label, font, 8, metricWidth - 18), {
      x: x + 9,
      y: y + metricHeight - 17,
      size: 8,
      font,
      color: rgb(0.37, 0.42, 0.47),
    });
    page.drawText(fitText(metric.value, boldFont, 14, metricWidth - 18), {
      x: x + 9,
      y: y + 17,
      size: 14,
      font: boldFont,
      color: rgb(0.05, 0.35, 0.31),
    });
  });

  const notesTop = metricTop - Math.ceil(input.metrics.length / 2) * (metricHeight + 10) - 10;
  const omittedEmptySections = input.sections.filter((section) => section.rows.length === 0).length;
  if (input.notes.length) {
    page.drawText("CATATAN LAPORAN", {
      x: MARGIN,
      y: notesTop,
      size: 9,
      font: boldFont,
      color: rgb(0.09, 0.20, 0.31),
    });
    input.notes.slice(0, 5).forEach((note, index) => {
      const text = "- " + safeText(note);
      page.drawText(fitText(text, font, 7.5, CONTENT_WIDTH), {
        x: MARGIN + 2,
        y: notesTop - 15 - index * 12,
        size: 7.5,
        font,
        color: rgb(0.30, 0.34, 0.39),
      });
    });
  }
  const footerNote = "Dibuat pada " + new Date().toLocaleString("id-ID", { timeZone: input.period.timezone }) +
    ". Detail data mengikuti filter periode di atas." +
    (omittedEmptySections ? " " + omittedEmptySections + " bagian tanpa data tidak dicetak." : "");
  page.drawText(fitText(footerNote, font, 7, CONTENT_WIDTH), {
    x: MARGIN,
    y: 31,
    size: 7,
    font,
    color: rgb(0.42, 0.46, 0.51),
  });

  for (const section of input.sections) {
    if (section.rows.length === 0) continue;
    const sourceRows = section.rows;
    const rows = sourceRows.slice(0, PDF_SECTION_ROW_LIMIT);
    const wasTruncated = sourceRows.length > PDF_SECTION_ROW_LIMIT;
    if (wasTruncated) {
      rows.push([
        "PDF dibatasi " + PDF_SECTION_ROW_LIMIT + " dari " + sourceRows.length.toLocaleString("id-ID") +
          " baris. Gunakan Excel untuk seluruh rincian.",
      ]);
    }
    const pageChunks: string[][][] = [];
    for (let offset = 0; offset < rows.length; offset += 20) pageChunks.push(rows.slice(offset, offset + 20));

    for (let chunkIndex = 0; chunkIndex < pageChunks.length; chunkIndex += 1) {
      pageNumber += 1;
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawPageHeader(page, font, boldFont, rgb, input.title, input.businessName, input.period, pageNumber);
      page.drawText(
        fitText(section.title + " | " + sourceRows.length.toLocaleString("id-ID") +
          " baris" + (wasTruncated ? " (maks. " + PDF_SECTION_ROW_LIMIT + " ditampilkan)" : ""),
          boldFont, 10, CONTENT_WIDTH),
        { x: MARGIN, y: PAGE_HEIGHT - 109, size: 10, font: boldFont, color: rgb(0.09, 0.20, 0.31) },
      );

      const headerY = PAGE_HEIGHT - 128;
      const headerHeight = 27;
      const rowHeight = 19;
      const sumWidths = section.widths.reduce((total, width) => total + width, 0);
      const scaledWidths = section.widths.map((width) => (width / sumWidths) * CONTENT_WIDTH);
      let x = MARGIN;
      section.headers.forEach((header, index) => {
        const width = scaledWidths[index];
        page.drawRectangle({
          x,
          y: headerY - headerHeight,
          width,
          height: headerHeight,
          color: rgb(0.06, 0.42, 0.35),
          borderColor: rgb(1, 1, 1),
          borderWidth: 0.35,
        });
        page.drawText(fitText(header, boldFont, 7.4, width - 8), {
          x: x + 4,
          y: headerY - 16,
          size: 7.4,
          font: boldFont,
          color: rgb(1, 1, 1),
        });
        x += width;
      });

      pageChunks[chunkIndex].forEach((rowValues, rowIndex) => {
        const y = headerY - headerHeight - (rowIndex + 1) * rowHeight;
        const isEven = rowIndex % 2 === 0;
        let cellX = MARGIN;
        section.headers.forEach((_, columnIndex) => {
          const width = scaledWidths[columnIndex];
          page.drawRectangle({
            x: cellX,
            y,
            width,
            height: rowHeight,
            color: isEven ? rgb(0.96, 0.97, 0.98) : rgb(1, 1, 1),
            borderColor: rgb(0.86, 0.89, 0.92),
            borderWidth: 0.35,
          });
          const value = rowValues.length === 1 && section.headers.length > 1 && rowValues[0] === "Tidak ada data pada periode ini."
            ? (columnIndex === 0 ? rowValues[0] : "")
            : rowValues[columnIndex] ?? "";
          page.drawText(fitText(String(value), font, 7.2, width - 8), {
            x: cellX + 4,
            y: y + 6.5,
            size: 7.2,
            font,
            color: rgb(0.12, 0.16, 0.20),
          });
          cellX += width;
        });
      });
    }
  }

  return pdf.save();
}

function dateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "-";
}

export async function exportFinanceReportToPdf(report: FinanceExportReport, businessName: string) {
  const sections: ReportSection[] = [
    {
      title: "Transaksi Keuangan",
      headers: ["Tanggal", "Nomor Transaksi", "Jenis / Arah", "Sumber", "Nominal", "Mata Uang", "Status"],
      widths: [68, 115, 100, 95, 86, 48, 66],
      rows: report.transactions.map((item) => [
        dateOnly(item.tanggal_transaksi),
        item.nomor_transaksi,
        formatFinanceKind(item.jenis) + " / " + formatFinanceDirection(item.arah),
        formatFinanceSource(item.sumber_type),
        moneyForCurrency(item.amount, item.currency_code),
        item.currency_code,
        formatFinanceStatus(item.status),
      ]),
    },
    {
      title: "Kesehatan Rekonsiliasi (snapshot saat ekspor)",
      headers: ["Indikator", "Severity", "Rincian"],
      widths: [100, 48, 320],
      rows: [
        ["Status keseluruhan", report.financeHealth.status, "Prinsip: " + report.financeHealth.principle],
        ...Object.entries(report.financeHealth.critical).map(([key, value]) => ["Jumlah kritis: " + key, "critical", String(value)]),
        ...Object.entries(report.financeHealth.attention).map(([key, value]) => ["Jumlah perhatian: " + key, "attention", String(value)]),
        ...report.reconciliationFindings.map((finding) => [
          String(finding.code ?? "FINDING"),
          String(finding.severity ?? "unknown"),
          Object.entries(finding).filter(([key]) => key !== "code" && key !== "severity")
            .map(([key, value]) => key + ": " + (typeof value === "string" ? value : JSON.stringify(value)))
            .join(" | "),
        ]),
        ["Catatan", "-", "Daftar maksimal 100 temuan pertama; status adalah kondisi saat ekspor, bukan histori akhir periode."],
      ],
    },
    {
      title: "Saldo Akun Operasional (saat ekspor)",
      headers: ["Nama Akun", "Jenis", "Mata Uang", "Saldo Saat Ekspor", "Status"],
      widths: [180, 85, 65, 120, 80],
      rows: report.accounts.map((account) => [
        account.nama_akun + " (" + account.kode_akun + ")",
        account.jenis_akun,
        account.mata_uang,
        moneyForCurrency(account.saldo, account.mata_uang),
        formatFinanceStatus(account.status),
      ]),
    },
    {
      title: "Akun Keuangan Belum Diklasifikasi (snapshot saat ekspor)",
      headers: ["Nama Akun", "Jenis", "Mata Uang", "Saldo Saat Ekspor", "Status"],
      widths: [190, 90, 60, 120, 85],
      rows: report.unclassifiedAccounts.map((account) => [
        account.nama_akun + " (" + account.kode_akun + ")",
        account.jenis_akun,
        account.mata_uang,
        moneyForCurrency(account.saldo, account.mata_uang),
        formatFinanceStatus(account.status),
      ]),
    },
    {
      title: "Mutasi Akun Operasional",
      headers: ["Tanggal", "Akun", "Arah", "Nominal", "Mata Uang", "Sumber / Status"],
      widths: [75, 135, 55, 90, 55, 155],
      rows: report.accountMovements.map((movement) => [
        dateOnly(movement.terjadi_at),
        report.accounts.find((account) => account.akun_keuangan_id === movement.akun_keuangan_id)?.nama_akun ?? movement.akun_keuangan_id,
        formatFinanceDirection(movement.arah),
        moneyForCurrency(movement.amount, movement.mata_uang),
        movement.mata_uang,
        formatFinanceSource(movement.sumber_type) + " / " + formatFinanceStatus(movement.status),
      ]),
    },
    {
      title: "Saldo Akun Investor/Pengelola (snapshot saat ekspor)",
      headers: ["Nama Akun", "Peran", "Status", "Mata Uang", "Saldo Fisik Saat Ekspor"],
      widths: [160, 70, 60, 55, 100],
      rows: report.stakeholderAccounts.map((account) => [
        account.account_name,
        account.stakeholder_type,
        formatFinanceStatus(account.account_status ?? "unknown"),
        account.currency_code,
        moneyForCurrency(account.physical_balance, account.currency_code),
      ]),
    },
    {
      title: "Alokasi Bagi Hasil",
      headers: ["Periode", "Pihak", "Mata Uang", "Persentase", "Hak Alokasi", "Dibayar", "Sisa Hak / Status"],
      widths: [95, 75, 60, 65, 100, 90, 150],
      rows: report.stakeholderAllocations.map((item) => [
        item.period_start + " s.d. " + item.period_end_exclusive,
        item.stakeholder_type,
        item.currency_code,
        String(item.percentage) + "%",
        moneyForCurrency(item.allocation_amount, item.currency_code),
        moneyForCurrency(item.paid_amount, item.currency_code),
        moneyForCurrency(item.remaining_amount, item.currency_code) + " / " + item.status,
      ]),
    },
    {
      title: "Pembayaran Stakeholder Investor/Pengelola",
      headers: ["Tanggal", "Jenis / Pihak", "Penerima", "Nominal", "Mata Uang", "Akun Sumber", "Status"],
      widths: [70, 115, 125, 90, 55, 135, 70],
      rows: report.stakeholderPayouts.map((item) => [
        dateOnly(item.paid_at),
        formatFinanceKind(item.payout_kind ?? "Payout") + " / " + (item.stakeholder_type === "investor" ? "Investor" : "Pengelola"),
        item.destination_name,
        moneyForCurrency(item.amount, item.currency_code),
        item.currency_code,
        report.stakeholderAccounts.find((account) => account.account_id === item.source_account_id)?.account_name
          ?? report.accounts.find((account) => account.akun_keuangan_id === item.source_account_id)?.nama_akun
          ?? item.source_account_id,
        formatFinanceStatus(item.status),
      ]),
    },
    {
      title: "Alih Hak Alokasi Investor",
      headers: ["Tanggal", "Tujuan Hak", "Nominal", "Mata Uang", "Uang Fisik?", "Rekening Sumber → Tujuan", "Status"],
      widths: [70, 90, 90, 55, 85, 225, 70],
      rows: report.stakeholderTransfers.map((item) => [
        dateOnly(item.transferred_at),
        item.target_type === "usaha" ? "Usaha" : "Pengelola",
        moneyForCurrency(item.amount, item.currency_code),
        item.currency_code,
        item.physical_money_moved ? "Ya" : "Tidak, hak saja",
        (report.stakeholderAccounts.find((account) => account.account_id === item.physical_source_account_id)?.account_name
          ?? report.accounts.find((account) => account.akun_keuangan_id === item.physical_source_account_id)?.nama_akun
          ?? item.physical_source_account_id ?? "-") + " → " +
        (report.stakeholderAccounts.find((account) => account.account_id === item.physical_target_account_id)?.account_name
          ?? report.accounts.find((account) => account.akun_keuangan_id === item.physical_target_account_id)?.nama_akun
          ?? item.physical_target_account_id ?? "-"),
        formatFinanceStatus(item.status),
      ]),
    },
    {
      title: "Pemisahan Kas / Pergerakan Internal Stakeholder",
      headers: ["Tanggal", "Jenis / Pihak", "Rekening Sumber → Tujuan", "Nominal", "Mata Uang", "Catatan"],
      widths: [70, 120, 220, 90, 55, 170],
      rows: report.stakeholderCashSegregations.map((item) => [
        dateOnly(item.occurred_at),
        formatFinanceKind(item.movement_kind) + " / " + (item.stakeholder_type === "investor" ? "Investor" : "Pengelola"),
        (item.source_account_name
          ?? report.stakeholderAccounts.find((account) => account.account_id === item.source_account_id)?.account_name
          ?? report.accounts.find((account) => account.akun_keuangan_id === item.source_account_id)?.nama_akun
          ?? item.source_account_id) + " → " +
        (item.target_account_name
          ?? report.stakeholderAccounts.find((account) => account.account_id === item.target_account_id)?.account_name
          ?? report.accounts.find((account) => account.akun_keuangan_id === item.target_account_id)?.nama_akun
          ?? item.target_account_id),
        moneyForCurrency(item.amount, item.currency_code),
        item.currency_code,
        item.catatan ?? "-",
      ]),
    },
    {
      title: "Pembayaran",
      headers: ["Tanggal", "Nomor Pembayaran", "Sumber / Jenis", "Nominal", "Mata Uang", "Metode", "Status"],
      widths: [70, 115, 150, 90, 55, 85, 70],
      rows: report.payments.map((item) => [
        dateOnly(item.dibayar_at),
        item.nomor_pembayaran,
        (item.source_label ?? (item.penyewaan_id ? "Penyewaan" : item.reservasi_id ? "Reservasi" : "Tanpa sumber")) + " / " + formatPaymentKind(item.jenis),
        moneyForCurrency(item.amount, item.currency_code),
        item.currency_code,
        item.metode,
        formatFinanceStatus(item.status),
      ]),
    },
    {
      title: "Pengeluaran",
      headers: ["Tanggal", "Kategori", "Deskripsi", "Pemasok / Sumber", "Nominal", "Mata Uang"],
      widths: [70, 100, 180, 155, 90, 55],
      rows: report.expenses.map((item) => [
        dateOnly(item.transaction_date),
        item.kategori_biaya,
        item.deskripsi + (item.nomor_transaksi ? " (" + item.nomor_transaksi + ")" : ""),
        (item.pemasok_nama ?? "Tanpa pemasok") + " / " + formatFinanceSource(item.source_type),
        moneyForCurrency(item.amount, item.currency_code),
        item.currency_code,
      ]),
    },
    {
      title: "Ringkasan Transaksi per Mata Uang",
      headers: ["Mata Uang", "Indikator", "Nominal", "Jumlah Transaksi"],
      widths: [70, 150, 100, 80],
      rows: report.currencySummaries.flatMap((item) => [
        [item.currency_code, "Pemasukan tercatat", moneyForCurrency(item.recorded_income, item.currency_code), String(item.recorded_income_transaction_count)],
        [item.currency_code, "Pengeluaran tercatat", moneyForCurrency(item.recorded_expense, item.currency_code), String(item.recorded_expense_transaction_count)],
        [item.currency_code, "Net transaksi", moneyForCurrency(item.net_operational_movement, item.currency_code), String(item.recorded_income_transaction_count + item.recorded_expense_transaction_count)],
        [item.currency_code, "Pembayaran tercatat (terpisah)", moneyForCurrency(item.recorded_payment_amount, item.currency_code), String(item.recorded_payment_count)],
        [item.currency_code, "Koreksi pemasukan", moneyForCurrency(item.reversal_income_in_period, item.currency_code), "-"],
        [item.currency_code, "Koreksi pengeluaran", moneyForCurrency(item.reversal_expense_in_period, item.currency_code), "-"],
      ]),
    },
    {
      title: "Biaya per Kategori",
      headers: ["Mata Uang", "Kategori", "Jumlah Transaksi", "Total Nominal"],
      widths: [70, 150, 90, 100],
      rows: report.expenseByCategoryCurrency.map((item) => [item.currency_code, item.key, String(item.count), moneyForCurrency(item.amount, item.currency_code)]),
    },
    {
      title: "Pendapatan per Barang",
      headers: ["ID Barang", "ID Varian", "Pendapatan Teratribusi", "Transaksi"],
      widths: [120, 120, 115, 70],
      rows: report.hasMultipleCurrencies
        ? [["Atribusi tidak ditampilkan", "-", "Agregat sumber belum dipisahkan per mata uang.", "-"]]
        : [
          ...report.productRevenue.items.map((item) => [
            item.barang_id ?? "-",
            item.varian_barang_id ?? "-",
            moneyForCurrency(item.recorded_income_exact, report.currencySummaries[0]?.currency_code ?? "IDR"),
            String(item.transaction_count),
          ]),
          ["Belum teratribusi secara pasti", "-", moneyForCurrency(report.productRevenue.unallocated_income, report.currencySummaries[0]?.currency_code ?? "IDR"), "-"],
          ["Cakupan atribusi", "-", report.productRevenue.coverage_ratio === null ? "Tidak tersedia" : Math.round(report.productRevenue.coverage_ratio * 100) + "%", "-"],
        ],
    },
    {
      title: "Pendapatan per Unit",
      headers: ["Kode Unit", "ID Unit", "Pendapatan Teratribusi", "Transaksi"],
      widths: [100, 150, 120, 70],
      rows: report.hasMultipleCurrencies
        ? [["Atribusi tidak ditampilkan", "-", "Agregat sumber belum dipisahkan per mata uang.", "-"]]
        : [
          ...report.unitRevenue.items.map((item) => [
            item.kode_unit,
            item.unit_barang_id,
            moneyForCurrency(item.recorded_income_exact, report.currencySummaries[0]?.currency_code ?? "IDR"),
            String(item.transaction_count),
          ]),
          ["Belum teratribusi atau ambigu", "-", moneyForCurrency(report.unitRevenue.unallocated_or_ambiguous_income, report.currencySummaries[0]?.currency_code ?? "IDR"), "-"],
          ["Cakupan atribusi", "-", report.unitRevenue.coverage_ratio === null ? "Tidak tersedia" : Math.round(report.unitRevenue.coverage_ratio * 100) + "%", "-"],
        ],
    },
    {
      title: "Pengeluaran per Pemasok",
      headers: ["Mata Uang", "Pemasok", "Jumlah Transaksi", "Total Nominal"],
      widths: [70, 150, 80, 100],
      rows: report.expenseBySupplierCurrency.map((item) => [item.currency_code, item.key, String(item.count), moneyForCurrency(item.amount, item.currency_code)]),
    },
    {
      title: "Pengeluaran per Sumber",
      headers: ["Mata Uang", "Sumber", "Jumlah Transaksi", "Total Nominal"],
      widths: [70, 150, 80, 100],
      rows: report.expenseBySourceCurrency.map((item) => [item.currency_code, formatFinanceSource(item.key), String(item.count), moneyForCurrency(item.amount, item.currency_code)]),
    },
  ];

  const bytes = await buildReportPdf({
    title: "LAPORAN KEUANGAN",
    businessName,
    period: report.period,
    metrics: report.hasMultipleCurrencies
      ? [
        { label: "Mata uang terlibat", value: String(report.currencySummaries.length) },
        { label: "Transaksi Finance", value: String(report.transactions.length) },
        { label: "Pembayaran tercatat", value: String(report.payments.filter((item) => item.status === "recorded").length) },
        { label: "Akun operasional", value: String(report.accounts.length) },
        { label: "Alokasi stakeholder", value: String(report.stakeholderAllocations.length) },
        { label: "Payout eksternal", value: String(report.stakeholderPayouts.length) },
      ]
      : [
        { label: "Pemasukan tercatat (" + (report.currencySummaries[0]?.currency_code ?? "—") + ")", value: moneyForCurrency(report.currencySummaries[0]?.recorded_income ?? 0, report.currencySummaries[0]?.currency_code ?? "IDR") },
        { label: "Pengeluaran tercatat (" + (report.currencySummaries[0]?.currency_code ?? "—") + ")", value: moneyForCurrency(report.currencySummaries[0]?.recorded_expense ?? 0, report.currencySummaries[0]?.currency_code ?? "IDR") },
        { label: "Net transaksi", value: moneyForCurrency(report.currencySummaries[0]?.net_operational_movement ?? 0, report.currencySummaries[0]?.currency_code ?? "IDR") },
        { label: "Pembayaran tercatat (terpisah)", value: moneyForCurrency(report.currencySummaries[0]?.recorded_payment_amount ?? 0, report.currencySummaries[0]?.currency_code ?? "IDR") },
        { label: "Jumlah transaksi pemasukan", value: String(report.currencySummaries[0]?.recorded_income_transaction_count ?? 0) },
        { label: "Jumlah transaksi pengeluaran", value: String(report.currencySummaries[0]?.recorded_expense_transaction_count ?? 0) },
      ],
    notes: [
      "Sumber angka adalah transaksi Finance server-side; laporan bersifat baca-saja dan tidak mengubah saldo.",
      "Pengeluaran dipilih menurut tanggal transaksi Finance; tanggal biaya tetap ditampilkan terpisah jika berbeda.",
      "Pembayaran adalah fakta kas tersendiri dan tidak dijumlahkan lagi ke transaksi Finance.",
      report.hasMultipleCurrencies
        ? "Terdapat beberapa mata uang. Angka diringkas per mata uang dan tidak dijumlahkan lintas mata uang; atribusi barang/unit ditahan."
        : "Mata uang laporan: " + (report.currencySummaries[0]?.currency_code ?? "tidak ada data") + ". Net transaksi bukan laba bersih atau saldo kas.",
      "Saldo akun, mutasi investor/pengelola, dan rekonsiliasi menunjukkan keadaan saat ekspor, bukan snapshot historis penutupan periode.",
      "Excel memuat ID dan catatan lengkap; tiap bagian PDF menampilkan maksimal 200 baris untuk menjaga keterbacaan.",
    ],
    sections,
  });

  await downloadPdfBytes(bytes, "laporan-keuangan-" + slug(businessName) + "-" + report.period.start_date + "-sd-" + lastDayExclusive(report.period) + "-" + timestamp(report.period.timezone) + ".pdf");
}

export async function exportRentalReportToPdf(report: RentalExportReport, businessName: string) {
  const sections: ReportSection[] = [
    {
      title: "Ringkasan Penyewaan per Mata Uang",
      headers: ["Mata Uang", "Indikator", "Nominal", "Jumlah"],
      widths: [70, 150, 100, 70],
      rows: report.currencySummaries.flatMap((item) => [
        [item.currency_code, "Nilai kontrak (non-draf/batal)", moneyForCurrency(item.contractual_value, item.currency_code), "-"],
        [item.currency_code, "Pembayaran tercatat terkait sewa", moneyForCurrency(item.recorded_payment_total, item.currency_code), "-"],
        [item.currency_code, "Sisa tagihan kontrak", moneyForCurrency(item.balance_due_total, item.currency_code), "-"],
        [item.currency_code, "Kelebihan pembayaran", moneyForCurrency(item.overpaid_total, item.currency_code), "-"],
        [item.currency_code, "Estimasi denda aktif/terlambat", moneyForCurrency(item.estimated_late_fee_total, item.currency_code), "-"],
        [item.currency_code, "Denda disetujui", moneyForCurrency(item.approved_late_fee_total, item.currency_code), "-"],
        [item.currency_code, "Denda menunggu review", moneyForCurrency(item.pending_late_fee_total, item.currency_code), "-"],
        [item.currency_code, "Jumlah penyewaan", "-", String(item.rental_count)],
      ]),
    },
    {
      title: "Daftar Penyewaan",
      headers: ["Nomor", "Penyewa", "Status", "Mata Uang", "Jadwal", "Barang / Paket", "Nilai Kontrak", "Sisa Tagihan", "Est. Denda Aktif", "Denda Disetujui"],
      widths: [85, 98, 85, 62, 105, 123, 88, 82, 95, 90],
      rows: report.items.map((item) => [
        item.nomor_penyewaan,
        item.penyewa_nama ?? "-",
        formatRentalStatus(item.status),
        item.currency_code,
        dateOnly(item.jadwal_mulai) + " - " + dateOnly(item.jadwal_kembali),
        item.lines.map((line) => line.label + " x" + line.quantity).join(", "),
        moneyForCurrency(item.total_amount, item.currency_code),
        moneyForCurrency(item.balance_due, item.currency_code),
        item.late_fee_assessment ? moneyForCurrency(item.late_fee_assessment.amount, item.currency_code) : "Tidak dihitung",
        moneyForCurrency(item.approved_late_fee, item.currency_code),
      ]),
    },
    {
      title: "Pembayaran Terkait Penyewaan",
      headers: ["Tanggal", "Nomor Bayar", "Nomor Sewa", "Penyewa", "Jenis / Metode", "Nominal", "Mata Uang", "Status"],
      widths: [70, 90, 90, 105, 100, 90, 55, 70],
      rows: report.payments.map((payment) => [
        dateOnly(payment.dibayar_at),
        payment.nomor_pembayaran,
        payment.nomor_penyewaan,
        payment.nama_penyewa,
        formatPaymentKind(payment.jenis) + " / " + payment.metode,
        moneyForCurrency(payment.amount, payment.currency_code),
        payment.currency_code,
        formatFinanceStatus(payment.status),
      ]),
    },
    {
      title: "Rincian Barang/Paket",
      headers: ["Nomor Penyewaan", "Penyewa", "Jenis", "Barang/Paket", "Jumlah", "Komponen"],
      widths: [95, 100, 55, 145, 45, 150],
      rows: report.items.flatMap((item) => item.lines.map((line) => [
        item.nomor_penyewaan,
        item.penyewa_nama ?? "-",
        line.kind,
        line.label,
        String(line.quantity),
        line.components.map((component) => component.label + " x" + component.quantity).join(", "),
      ])),
    },
    {
      title: "Tinjauan Denda Keterlambatan",
      headers: ["Nomor", "Penyewa / Status", "Batas Toleransi", "Jam Ditagihkan", "Estimasi", "Mata Uang", "Disetujui", "Menunggu", "Status Review / Peringatan"],
      widths: [95, 130, 100, 65, 90, 55, 90, 90, 145],
      rows: report.items.map((item) => [
        item.nomor_penyewaan,
        (item.penyewa_nama ?? "-") + " / " + formatRentalStatus(item.status),
        dateOnly(item.late_fee_assessment?.tolerance_deadline ?? item.tolerance_deadline),
        String(item.late_fee_assessment?.billable_hours ?? 0),
        item.late_fee_assessment ? moneyForCurrency(item.late_fee_assessment.amount, item.currency_code) : "Tidak dihitung",
        item.currency_code,
        moneyForCurrency(item.approved_late_fee, item.currency_code),
        moneyForCurrency(item.pending_late_fee, item.currency_code),
        item.late_fee_review_status + (item.late_fee_currency_mismatch_count ? "; " + item.late_fee_currency_mismatch_count + " beda mata uang" : ""),
      ]),
    },
  ];

  const summary = report.summary;
  const bytes = await buildReportPdf({
    title: "LAPORAN PENYEWAAN",
    businessName,
    period: report.period,
    metrics: report.hasMultipleCurrencies
      ? [
        { label: "Jumlah penyewaan", value: String(summary.rental_count) },
        { label: "Mata uang terlibat", value: String(report.currencySummaries.length) },
        { label: "Penyewaan aktif", value: String(summary.active_count) },
        { label: "Penyewaan selesai", value: String(summary.completed_count) },
        { label: "Draf", value: String(summary.draft_count) },
        { label: "Dibatalkan", value: String(summary.cancelled_count) },
      ]
      : [
        { label: "Jumlah penyewaan", value: String(summary.rental_count) },
        { label: "Nilai kontrak (" + (report.currencySummaries[0]?.currency_code ?? "—") + ")", value: moneyForCurrency(report.currencySummaries[0]?.contractual_value ?? 0, report.currencySummaries[0]?.currency_code ?? "IDR") },
        { label: "Pembayaran tercatat terkait sewa", value: moneyForCurrency(report.currencySummaries[0]?.recorded_payment_total ?? 0, report.currencySummaries[0]?.currency_code ?? "IDR") },
        { label: "Sisa tagihan kontrak", value: moneyForCurrency(report.currencySummaries[0]?.balance_due_total ?? 0, report.currencySummaries[0]?.currency_code ?? "IDR") },
        { label: "Estimasi denda", value: moneyForCurrency(report.currencySummaries[0]?.estimated_late_fee_total ?? 0, report.currencySummaries[0]?.currency_code ?? "IDR") },
        { label: "Denda disetujui", value: moneyForCurrency(report.currencySummaries[0]?.approved_late_fee_total ?? 0, report.currencySummaries[0]?.currency_code ?? "IDR") },
      ],
    notes: [
      "Periode penyewaan mengikuti tanggal mulai jadwal, bukan tanggal pembayaran.",
      report.hasMultipleCurrencies
        ? "Angka diringkas per mata uang; nominal berbeda mata uang tidak dijumlahkan."
        : "Mata uang laporan: " + (report.currencySummaries[0]?.currency_code ?? "tidak ada data") + ".",
      "Rincian pembayaran memuat pembayaran tercatat sepanjang waktu untuk penyewaan terpilih, sehingga tanggal bayarnya dapat di luar periode.",
      "Sisa kontrak hanya memakai DP/pelunasan dalam mata uang yang sama; pembayaran tambahan dan mata uang berbeda tidak otomatis melunasi kontrak.",
      "Estimasi denda dihitung ulang untuk penyewaan yang masih berjalan dan melewati jadwal; angka final mengikuti review.",
      "PDF dibatasi maksimal 200 baris per bagian; Excel memuat rincian sampai batas ekspor 10.000 baris per sumber.",
    ],
    sections,
  });

  await downloadPdfBytes(bytes, "laporan-penyewaan-" + slug(businessName) + "-" + report.period.start_date + "-sd-" + lastDayExclusive(report.period) + "-" + timestamp(report.period.timezone) + ".pdf");
}
