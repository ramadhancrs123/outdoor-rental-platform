import type ExcelJS from "exceljs";
import { downloadExcelBlob } from "./download";
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

const PALETTE = {
  navy: "16324F",
  green: "0F766E",
  blue: "2563EB",
  pale: "F1F5F9",
  paleBlue: "EFF6FF",
  border: "D8E1EA",
  text: "1F2937",
  muted: "64748B",
  white: "FFFFFF",
  red: "B91C1C",
};

function lastDayExclusive(period: { end_date_exclusive: string }) {
  const date = new Date(period.end_date_exclusive + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function safeSlug(value: string) {
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

function periodLabel(period: { start_date: string; end_date_exclusive: string }) {
  return period.start_date + " s.d. " + lastDayExclusive(period);
}

function numericFormat(sheet: ExcelJS.Worksheet, columns: number[], startRow: number, endRow: number) {
  columns.forEach((column) => {
    for (let row = startRow; row <= endRow; row += 1) {
      sheet.getCell(row, column).numFmt = '#,##0.00;[Red](#,##0.00);-';
      sheet.getCell(row, column).alignment = { horizontal: "right", vertical: "middle" };
    }
  });
}

function writeTop(
  sheet: ExcelJS.Worksheet,
  title: string,
  businessName: string,
  period: { start_date: string; end_date_exclusive: string; timezone: string },
  columnCount: number,
) {
  sheet.mergeCells(1, 1, 1, columnCount);
  sheet.getCell(1, 1).value = title;
  sheet.getCell(1, 1).font = { name: "Aptos Display", size: 18, bold: true, color: { argb: PALETTE.white } };
  sheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.navy } };
  sheet.getCell(1, 1).alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(1).height = 34;

  sheet.mergeCells(2, 1, 2, columnCount);
  sheet.getCell(2, 1).value = businessName;
  sheet.getCell(2, 1).font = { name: "Aptos", size: 11, bold: true, color: { argb: PALETTE.text } };

  sheet.mergeCells(3, 1, 3, columnCount);
  sheet.getCell(3, 1).value = "Periode: " + periodLabel(period) + " | Zona waktu: " + period.timezone;
  sheet.getCell(3, 1).font = { name: "Aptos", size: 9, color: { argb: PALETTE.muted } };

  sheet.mergeCells(4, 1, 4, columnCount);
  sheet.getCell(4, 1).value = "Dibuat: " + new Date().toLocaleString("id-ID", { timeZone: period.timezone }) + " | Sumber data: Rental Outdoor Admin";
  sheet.getCell(4, 1).font = { name: "Aptos", size: 9, color: { argb: PALETTE.muted } };
  sheet.getRow(5).height = 8;
}

function writeTableSheet(
  workbook: ExcelJS.Workbook,
  input: {
    name: string;
    title: string;
    businessName: string;
    period: { start_date: string; end_date_exclusive: string; timezone: string };
    headers: string[];
    rows: Array<Array<string | number | boolean | null>>;
    widths?: number[];
    numericColumns?: number[];
  },
) {
  const sheet = workbook.addWorksheet(input.name);
  sheet.properties.tabColor = { argb: PALETTE.green };
  writeTop(sheet, input.title, input.businessName, input.period, input.headers.length);
  const headerRow = 6;
  const header = sheet.getRow(headerRow);
  header.values = input.headers;
  header.height = 30;
  header.eachCell((cell, column) => {
    if (column === 0) return;
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: PALETTE.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.green } };
    cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: PALETTE.navy } } };
  });

  input.rows.forEach((values, index) => {
    const row = sheet.addRow(values);
    row.height = 24;
    row.eachCell((cell) => {
      cell.font = { name: "Aptos", size: 9, color: { argb: PALETTE.text } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: PALETTE.border } } };
      if (index % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.pale } };
    });
  });

  sheet.views = [{ state: "frozen", ySplit: headerRow }];
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow, column: input.headers.length },
  };
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
  };
  if (input.widths) input.widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  else input.headers.forEach((_, index) => { sheet.getColumn(index + 1).width = index === 0 ? 22 : 18; });
  const lastDataRow = Math.max(headerRow + 1, headerRow + input.rows.length);
  if (input.numericColumns?.length) numericFormat(sheet, input.numericColumns, headerRow + 1, lastDataRow);
  return sheet;
}

async function downloadWorkbook(workbook: ExcelJS.Workbook, fileName: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await downloadExcelBlob(blob, fileName);
}

export async function exportFinanceReportToExcel(report: FinanceExportReport, businessName: string) {
  const ExcelJSRuntime = (await import("exceljs")).default;
  const workbook = new ExcelJSRuntime.Workbook();
  workbook.creator = "Rental Outdoor";
  workbook.lastModifiedBy = "Rental Outdoor";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = false;

  const summary = report.summary;
  const summaryRows: Array<Array<string | number | boolean | null>> = [
    ...report.currencySummaries.flatMap((item) => [
      [item.currency_code, "Pemasukan tercatat", item.recorded_income, item.recorded_income_transaction_count, "Transaksi Finance berstatus tercatat."],
      [item.currency_code, "Pengeluaran tercatat", item.recorded_expense, item.recorded_expense_transaction_count, "Transaksi Finance berstatus tercatat."],
      [item.currency_code, "Net transaksi", item.net_operational_movement, item.recorded_income_transaction_count + item.recorded_expense_transaction_count, "Pemasukan dikurangi pengeluaran tercatat dalam mata uang yang sama; bukan laba bersih atau saldo kas."],
      [item.currency_code, "Pembayaran tercatat", item.recorded_payment_amount, item.recorded_payment_count, "Fakta pembayaran ditampilkan terpisah, tidak dijumlahkan ke transaksi Finance."],
      [item.currency_code, "Koreksi pemasukan (reversal)", item.reversal_income_in_period, "", "Bagian dari transaksi Finance; dirinci terpisah."],
      [item.currency_code, "Koreksi pengeluaran (reversal)", item.reversal_expense_in_period, "", "Bagian dari transaksi Finance; dirinci terpisah."],
    ]),
    ["", "Jumlah baris transaksi", "", report.transactions.length, "Tab Transaksi berisi seluruh transaksi dalam periode."],
    ["", "Jumlah baris pembayaran", "", report.payments.length, "Tab Pembayaran berisi semua pembayaran bertanggal dalam periode."],
    ["", "Jumlah baris pengeluaran", "", report.expenses.length, "Tab Pengeluaran berisi detail pengeluaran dalam periode."],
    ["", "Baris alokasi bagi hasil", "", report.stakeholderAllocations.length, "Hak alokasi berbeda dari uang yang benar-benar dibayar."],
    ["", "Payout Investor/Pengelola", "", report.stakeholderPayouts.length, "Pengeluaran kas kepada penerima; bukan biaya operasional."],
    ["", "Alih hak alokasi Investor", "", report.stakeholderTransfers.length, "Alih hak dapat terjadi tanpa perpindahan uang fisik."],
    ["", "Pemisahan kas/pergerakan stakeholder", "", report.stakeholderCashSegregations.length, "Pergerakan internal tidak otomatis memengaruhi laba/rugi."],
    ["", "Catatan sumber", "", "", summary.source_note],
    ["", "Status rekonsiliasi saat ekspor", "", "", report.financeHealth.status + ". Pemeriksaan saat ini, bukan snapshot historis pada akhir periode."],
    ["", "Item temuan yang ditampilkan", "", report.reconciliationFindings.length, "Maksimal 100 temuan pertama; jumlah masalah keseluruhan tercermin pada indikator health di tab Rekonsiliasi."],
    ["", "Akun keuangan belum diklasifikasi", "", report.unclassifiedAccounts.length, "Saldo ditampilkan terpisah agar tidak hilang dari rekonsiliasi."],
    ["", "Saldo akun", "", "", "Snapshot pada waktu ekspor, bukan saldo historis pada akhir periode."],
  ];
  if (report.hasMultipleCurrencies) {
    summaryRows.push(["", "Perhatian mata uang", "", "", "Periode memuat lebih dari satu mata uang. Nilai disajikan per mata uang; jangan menjumlahkan lintas mata uang. Atribusi pendapatan per barang/unit disembunyikan karena sumber agregatnya belum memiliki pemisahan mata uang."]);
  }
  writeTableSheet(workbook, {
    name: "Ringkasan",
    title: "LAPORAN KEUANGAN",
    businessName,
    period: report.period,
    headers: ["Mata Uang", "Indikator", "Nilai", "Jumlah/Baris", "Keterangan"],
    widths: [16, 38, 24, 20, 88],
    rows: summaryRows,
    numericColumns: [3],
  });

  writeTableSheet(workbook, {
    name: "Transaksi",
    title: "RINCIAN TRANSAKSI KEUANGAN",
    businessName,
    period: report.period,
    headers: ["Tanggal", "Nomor Transaksi", "Jenis", "Arah", "Sumber", "ID Sumber", "Nominal", "Mata Uang", "Status", "Catatan"],
    widths: [20, 27, 18, 14, 18, 36, 19, 14, 18, 42],
    rows: report.transactions.map((item) => [
      item.tanggal_transaksi,
      item.nomor_transaksi,
      formatFinanceKind(item.jenis),
      formatFinanceDirection(item.arah),
      formatFinanceSource(item.sumber_type),
      item.sumber_id,
      Number(item.amount),
      item.currency_code,
      formatFinanceStatus(item.status),
      item.catatan,
    ]),
    numericColumns: [7],
  });

  const healthRows: Array<Array<string | number | boolean | null>> = [
    ["Status rekonsiliasi", report.financeHealth.status, "Snapshot saat ekspor; bukan histori akhir periode."],
    ["Prinsip", report.financeHealth.principle, ""],
    ...Object.entries(report.financeHealth.critical).map(([key, value]) => ["Jumlah kritis: " + key, value, "Harus ditinjau sebelum pembukuan periode ditutup."]),
    ...Object.entries(report.financeHealth.attention).map(([key, value]) => ["Jumlah perhatian: " + key, value, "Perlu ditinjau oleh admin."]),
  ];
  writeTableSheet(workbook, {
    name: "Rekonsiliasi",
    title: "KESEHATAN DAN TEMUAN REKONSILIASI",
    businessName,
    period: report.period,
    headers: ["Indikator", "Nilai", "Keterangan"],
    widths: [36, 52, 84],
    rows: [
      ...healthRows,
      ...report.reconciliationFindings.map((finding) => [
        String(finding.code ?? "FINDING"),
        String(finding.severity ?? "unknown"),
        Object.entries(finding).filter(([key]) => key !== "code" && key !== "severity")
          .map(([key, value]) => key + ": " + (typeof value === "string" ? value : JSON.stringify(value)))
          .join(" | "),
      ]),
      ["Batas daftar", report.reconciliationFindings.length, "Maksimal 100 temuan pertama. Status rekonsiliasi mencerminkan kondisi saat ekspor."],
    ],
  });

  writeTableSheet(workbook, {
    name: "Akun Operasional",
    title: "SALDO AKUN OPERASIONAL",
    businessName,
    period: report.period,
    headers: ["Kode Akun", "Nama Akun", "Jenis", "Mata Uang", "Status", "Saldo Awal Akun", "Total Masuk Akumulatif", "Total Keluar Akumulatif", "Saldo Saat Ekspor", "Tanggal Saldo Awal", "Fungsi"],
    widths: [18, 30, 16, 14, 16, 20, 20, 20, 23, 22, 18],
    rows: [
      ...report.accounts.map((account) => [
        account.kode_akun,
        account.nama_akun,
        account.jenis_akun,
        account.mata_uang,
        formatFinanceStatus(account.status),
        Number(account.saldo_awal),
        Number(account.uang_masuk),
        Number(account.uang_keluar),
        Number(account.saldo),
        account.tanggal_saldo_awal,
        account.fungsi_akun ?? "unknown",
      ]),
      ["Catatan", "Saldo akun adalah snapshot saat ekspor, bukan saldo historis pada akhir periode laporan. Total masuk/keluar bersifat akumulatif sejak saldo awal, bukan hanya mutasi pada periode terpilih. Gunakan tab Mutasi Akun untuk mutasi selama periode.", "", "", "", "", "", "", "", "", ""],
    ],
    numericColumns: [6, 7, 8, 9],
  });

  writeTableSheet(workbook, {
    name: "Akun Belum Diklasifikasi",
    title: "AKUN KEUANGAN BELUM DIKLASIFIKASI",
    businessName,
    period: report.period,
    headers: ["ID Akun", "Kode Akun", "Nama Akun", "Jenis", "Mata Uang", "Status", "Saldo Awal Akun", "Total Masuk Akumulatif", "Total Keluar Akumulatif", "Saldo Saat Ekspor", "Tanggal Saldo Awal"],
    widths: [38, 18, 32, 16, 14, 16, 20, 20, 20, 23, 22],
    rows: report.unclassifiedAccounts.map((account) => [
      account.akun_keuangan_id,
      account.kode_akun,
      account.nama_akun,
      account.jenis_akun,
      account.mata_uang,
      formatFinanceStatus(account.status),
      Number(account.saldo_awal),
      Number(account.uang_masuk),
      Number(account.uang_keluar),
      Number(account.saldo),
      account.tanggal_saldo_awal,
    ]),
    numericColumns: [7, 8, 9, 10],
  });

  const accountNameById = new Map(report.accounts.map((account) => [account.akun_keuangan_id, account.nama_akun]));
  writeTableSheet(workbook, {
    name: "Mutasi Akun",
    title: "MUTASI AKUN OPERASIONAL",
    businessName,
    period: report.period,
    headers: ["Waktu", "Akun", "Arah", "Nominal", "Mata Uang", "Sumber", "ID Sumber", "ID Transaksi Keuangan", "Status", "ID Permintaan", "Catatan"],
    widths: [24, 30, 14, 20, 14, 20, 38, 28, 18, 38, 44],
    rows: report.accountMovements.map((movement) => [
      movement.terjadi_at,
      accountNameById.get(movement.akun_keuangan_id) ?? movement.akun_keuangan_id,
      formatFinanceDirection(movement.arah),
      Number(movement.amount),
      movement.mata_uang,
      formatFinanceSource(movement.sumber_type),
      movement.sumber_id,
      movement.transaksi_keuangan_id,
      movement.status,
      movement.request_id,
      movement.catatan,
    ]),
    numericColumns: [4],
  });

  writeTableSheet(workbook, {
    name: "Akun Stakeholder",
    title: "SALDO AKUN INVESTOR DAN PENGELOLA",
    businessName,
    period: report.period,
    headers: ["Nama Akun", "Peran", "Status Akun", "Mata Uang", "Saldo Fisik Saat Ekspor", "Jenis Saldo"],
    widths: [34, 18, 18, 14, 26, 30],
    rows: report.stakeholderAccounts.map((account) => [
      account.account_name,
      account.stakeholder_type,
      formatFinanceStatus(account.account_status ?? "unknown"),
      account.currency_code,
      Number(account.physical_balance),
      account.balance_kind,
    ]),
    numericColumns: [5],
  });

  writeTableSheet(workbook, {
    name: "Alokasi Bagi Hasil",
    title: "ALOKASI BAGI HASIL INVESTOR DAN PENGELOLA",
    businessName,
    period: report.period,
    headers: ["Awal Periode", "Akhir Eksklusif", "Pihak", "ID Investor", "ID Pengelola", "Mata Uang", "Dasar Hasil Bersih", "Persentase", "Hak Alokasi", "Sudah Dibayar", "Alih Hak Keluar", "Alih Hak Masuk", "Sisa Hak", "Kelebihan Uang Muka", "Status"],
    widths: [18, 20, 18, 38, 38, 14, 23, 16, 20, 20, 20, 20, 20, 24, 20],
    rows: report.stakeholderAllocations.map((item) => [
      item.period_start,
      item.period_end_exclusive,
      item.stakeholder_type,
      item.investor_id ?? "-",
      item.pengelola_akun_admin_id ?? "-",
      item.currency_code,
      Number(item.result_basis_amount),
      Number(item.percentage),
      Number(item.allocation_amount),
      Number(item.paid_amount),
      Number(item.transferred_out_amount),
      Number(item.transferred_in_amount),
      Number(item.remaining_amount),
      Number(item.advance_excess_amount),
      formatFinanceStatus(item.status),
    ]),
    numericColumns: [7, 9, 10, 11, 12, 13, 14],
  });
  const allocationSheet = workbook.getWorksheet("Alokasi Bagi Hasil");
  if (allocationSheet) {
    for (let row = 7; row < 7 + report.stakeholderAllocations.length; row += 1) {
      allocationSheet.getCell(row, 8).numFmt = '0.00"%"';
    }
  }

  const stakeholderAccountName = new Map(report.stakeholderAccounts.map((account) => [account.account_id, account.account_name]));
  const operationalAccountName = new Map(report.accounts.map((account) => [account.akun_keuangan_id, account.nama_akun]));
  const anyAccountName = (accountId: string | null | undefined) =>
    accountId ? stakeholderAccountName.get(accountId) ?? operationalAccountName.get(accountId) ?? accountId : "-";

  writeTableSheet(workbook, {
    name: "Payout Stakeholder",
    title: "PEMBAYARAN STAKEHOLDER INVESTOR DAN PENGELOLA",
    businessName,
    period: report.period,
    headers: ["Tanggal Dibayar", "Jenis Payout", "Pihak", "Periode Hak", "Penerima", "Rekening Sumber", "Nominal", "Mata Uang", "Status", "Nomor Transaksi", "ID Payout", "Referensi Tujuan", "Catatan"],
    widths: [24, 24, 18, 18, 32, 30, 20, 14, 18, 28, 38, 28, 40],
    rows: report.stakeholderPayouts.map((item) => [
      item.paid_at,
      formatFinanceKind(item.payout_kind ?? "Payout stakeholder"),
      item.stakeholder_type === "investor" ? "Investor" : "Pengelola",
      item.period_start ?? "Uang muka",
      item.destination_name,
      anyAccountName(item.source_account_id),
      Number(item.amount),
      item.currency_code,
      formatFinanceStatus(item.status),
      item.transaction_id ?? "-",
      item.payout_id,
      item.destination_reference ?? "-",
      item.catatan ?? "-",
    ]),
    numericColumns: [6],
  });

  writeTableSheet(workbook, {
    name: "Alih Hak Investor",
    title: "ALIH HAK ALOKASI INVESTOR",
    businessName,
    period: report.period,
    headers: ["Tanggal Alih Hak", "Periode ID", "Tujuan Hak", "Nominal", "Mata Uang", "Uang Fisik Berpindah", "Rekening Sumber Fisik", "Rekening Tujuan Fisik", "Nomor Transaksi", "ID Transfer Akun", "Status", "Catatan"],
    widths: [24, 38, 18, 20, 14, 22, 30, 30, 28, 38, 18, 40],
    rows: report.stakeholderTransfers.map((item) => [
      item.transferred_at,
      item.period_id,
      item.target_type === "usaha" ? "Usaha" : "Pengelola",
      Number(item.amount),
      item.currency_code,
      item.physical_money_moved ? "Ya" : "Tidak — hanya alih hak",
      anyAccountName(item.physical_source_account_id),
      anyAccountName(item.physical_target_account_id),
      item.transaction_id ?? "-",
      item.finance_transfer_id ?? "-",
      formatFinanceStatus(item.status),
      item.catatan ?? "-",
    ]),
    numericColumns: [4],
  });

  writeTableSheet(workbook, {
    name: "Pemisahan Kas",
    title: "MUTASI INTERNAL / PEMISAHAN KAS STAKEHOLDER",
    businessName,
    period: report.period,
    headers: ["Tanggal", "Jenis Pergerakan", "Pihak", "Rekening Sumber", "Rekening Tujuan", "Nominal", "Mata Uang", "Status Dampak Hak", "ID Transfer", "ID Kejadian", "Catatan"],
    widths: [24, 27, 18, 30, 30, 20, 14, 24, 38, 38, 42],
    rows: report.stakeholderCashSegregations.map((item) => [
      item.occurred_at,
      formatFinanceKind(item.movement_kind),
      item.stakeholder_type === "investor" ? "Investor" : "Pengelola",
      item.source_account_name ?? anyAccountName(item.source_account_id),
      item.target_account_name ?? anyAccountName(item.target_account_id),
      Number(item.amount),
      item.currency_code,
      item.affects_entitlement ? "Mempengaruhi hak" : "Tidak memengaruhi hak/alokasi",
      item.transfer_id ?? "-",
      item.event_id,
      item.catatan ?? "-",
    ]),
    numericColumns: [6],
  });

  writeTableSheet(workbook, {
    name: "Pembayaran",
    title: "RINCIAN PEMBAYARAN",
    businessName,
    period: report.period,
    headers: ["Tanggal Bayar", "Nomor Pembayaran", "Sumber", "Jenis", "Metode", "Nomor Transaksi", "Nominal", "Mata Uang", "Status", "Referensi", "Catatan"],
    widths: [22, 25, 34, 18, 18, 25, 19, 14, 18, 28, 40],
    rows: report.payments.map((item) => [
      item.dibayar_at,
      item.nomor_pembayaran,
      item.source_label ?? (item.penyewaan_id ? "Penyewaan" : item.reservasi_id ? "Reservasi" : "Tanpa sumber"),
      formatPaymentKind(item.jenis),
      item.metode,
      item.nomor_transaksi,
      Number(item.amount),
      item.currency_code,
      formatFinanceStatus(item.status),
      item.reference_text,
      item.catatan,
    ]),
    numericColumns: [7],
  });

  writeTableSheet(workbook, {
    name: "Pengeluaran",
    title: "RINCIAN PENGELUARAN",
    businessName,
    period: report.period,
    headers: ["Tanggal Transaksi Finance", "Tanggal Pengeluaran", "Nomor Transaksi", "Kategori", "Deskripsi", "Pemasok", "Sumber", "Nominal", "Mata Uang", "Bukti"],
    widths: [24, 20, 26, 22, 42, 28, 18, 19, 14, 34],
    rows: report.expenses.map((item) => [
      item.transaction_date ?? "Tidak tersedia",
      item.tanggal_pengeluaran,
      item.nomor_transaksi,
      item.kategori_biaya,
      item.deskripsi,
      item.pemasok_nama,
      formatFinanceSource(item.source_type),
      Number(item.amount),
      item.currency_code,
      item.bukti_storage_path ? "Tersedia" : "Tidak ada",
    ]),
    numericColumns: [8],
  });

  writeTableSheet(workbook, {
    name: "Biaya Kategori",
    title: "ANALISIS PENGELUARAN PER KATEGORI",
    businessName,
    period: report.period,
    headers: ["Mata Uang", "Kategori Biaya", "Jumlah Transaksi", "Total Nominal"],
    widths: [16, 40, 22, 24],
    rows: report.expenseByCategoryCurrency.map((item) => [item.currency_code, item.key, item.count, item.amount]),
    numericColumns: [4],
  });

  writeTableSheet(workbook, {
    name: "Biaya Pemasok",
    title: "ANALISIS PENGELUARAN PER PEMASOK",
    businessName,
    period: report.period,
    headers: ["Mata Uang", "Pemasok", "Jumlah Transaksi", "Total Nominal"],
    widths: [16, 42, 22, 24],
    rows: report.expenseBySupplierCurrency.map((item) => [item.currency_code, item.key, item.count, item.amount]),
    numericColumns: [4],
  });

  writeTableSheet(workbook, {
    name: "Biaya Sumber",
    title: "ANALISIS PENGELUARAN PER SUMBER",
    businessName,
    period: report.period,
    headers: ["Mata Uang", "Sumber", "Jumlah Transaksi", "Total Nominal"],
    widths: [16, 32, 22, 24],
    rows: report.expenseBySourceCurrency.map((item) => [item.currency_code, formatFinanceSource(item.key), item.count, item.amount]),
    numericColumns: [4],
  });

  writeTableSheet(workbook, {
    name: "Pendapatan Barang",
    title: "ATRIBUSI PENDAPATAN PER BARANG",
    businessName,
    period: report.period,
    headers: ["ID Barang", "ID Varian", "Pendapatan Teratribusi", "Nilai Detail Sewa", "Jumlah Transaksi", "Status Atribusi"],
    widths: [38, 38, 24, 23, 20, 30],
    rows: report.hasMultipleCurrencies
      ? [["Perlu pemisahan mata uang", "", "", "", "", "Atribusi nominal tidak ditampilkan karena sumber agregat belum dipisahkan per mata uang. Rincian transaksi tetap tersedia di tab Transaksi."]]
      : [
      ...report.productRevenue.items.map((item) => [
        item.barang_id,
        item.varian_barang_id,
        item.recorded_income_exact,
        item.rental_detail_value,
        item.transaction_count,
        item.attribution_status,
      ]),
      ["Keterangan", "", report.productRevenue.unallocated_income, "", "", "Pendapatan tidak dapat dialokasikan secara pasti"],
      ["Cakupan atribusi", "", report.productRevenue.coverage_ratio === null ? "N/A" : Math.round(report.productRevenue.coverage_ratio * 100) + "%", "", "", report.productRevenue.allocation_policy],
    ],
    numericColumns: [3, 4],
  });

  writeTableSheet(workbook, {
    name: "Pendapatan Unit",
    title: "ATRIBUSI PENDAPATAN PER UNIT",
    businessName,
    period: report.period,
    headers: ["Kode Unit", "ID Unit", "ID Barang", "ID Varian", "Pendapatan Teratribusi", "Jumlah Transaksi", "Status Atribusi"],
    widths: [22, 40, 38, 38, 24, 20, 38],
    rows: report.hasMultipleCurrencies
      ? [["Perlu pemisahan mata uang", "", "", "", "", "", "Atribusi nominal tidak ditampilkan karena sumber agregat belum dipisahkan per mata uang. Rincian transaksi tetap tersedia di tab Transaksi."]]
      : [
      ...report.unitRevenue.items.map((item) => [
        item.kode_unit,
        item.unit_barang_id,
        item.barang_id,
        item.varian_barang_id,
        item.recorded_income_exact,
        item.transaction_count,
        item.attribution_status,
      ]),
      ["Keterangan", "", "", "", report.unitRevenue.unallocated_or_ambiguous_income, "", "Pendapatan yang belum dapat diatribusikan secara pasti"],
      ["Cakupan atribusi", "", "", "", report.unitRevenue.coverage_ratio === null ? "N/A" : Math.round(report.unitRevenue.coverage_ratio * 100) + "%", "", report.unitRevenue.allocation_policy],
    ],
    numericColumns: [5],
  });

  const fileName = "laporan-keuangan-" + safeSlug(businessName) + "-" + report.period.start_date + "-sd-" + lastDayExclusive(report.period) + "-" + timestamp(report.period.timezone) + ".xlsx";
  await downloadWorkbook(workbook, fileName);
}

export async function exportRentalReportToExcel(report: RentalExportReport, businessName: string) {
  const ExcelJSRuntime = (await import("exceljs")).default;
  const workbook = new ExcelJSRuntime.Workbook();
  workbook.creator = "Rental Outdoor";
  workbook.lastModifiedBy = "Rental Outdoor";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = false;

  const rentalSummaryRows: Array<Array<string | number | boolean | null>> = [
    ...report.currencySummaries.flatMap((item) => [
      [item.currency_code, "Jumlah penyewaan", item.rental_count, "", "Berdasarkan tanggal mulai jadwal."],
      [item.currency_code, "Nilai kontrak (non-draf/batal)", item.contractual_value, "", "Dalam mata uang ini saja."],
      [item.currency_code, "Pembayaran tercatat terkait sewa", item.recorded_payment_total, "", "Semua tanggal bayar untuk penyewaan yang mulai pada periode, termasuk pembayaran ter-record pada draf/batal; bukan pengurang nilai kontrak jika bukan DP/pelunasan mata uang yang sama."],
      [item.currency_code, "Sisa tagihan kontrak", item.balance_due_total, "", "DP/pelunasan dalam mata uang kontrak; pembayaran tambahan tidak mengurangi saldo."],
      [item.currency_code, "Kelebihan pembayaran", item.overpaid_total, "", "Perlu pemeriksaan jika nilainya lebih dari nol."],
      [item.currency_code, "Estimasi denda aktif/terlambat", item.estimated_late_fee_total, "", "Dihitung untuk penyewaan yang masih berjalan dan melewati jadwal; denda final mengikuti review."],
      [item.currency_code, "Denda disetujui", item.approved_late_fee_total, "", "Denda yang lolos review."],
      [item.currency_code, "Denda menunggu review", item.pending_late_fee_total, "", "Masih kandidat, belum menjadi nilai final."],
    ]),
    ["", "Jumlah penyewaan", report.summary.rental_count, "", "Jumlah keseluruhan baris, tidak dijumlahkan sebagai nilai uang."],
    ["", "Penyewaan aktif/berjalan", report.summary.active_count, "", ""],
    ["", "Penyewaan selesai", report.summary.completed_count, "", ""],
    ["", "Draf penyewaan", report.summary.draft_count, "", "Tidak dihitung sebagai kontrak aktif."],
    ["", "Penyewaan dibatalkan", report.summary.cancelled_count, "", "Dikecualikan dari nilai kontrak."],
    ["", "Dasar periode", "Tanggal mulai jadwal", "", report.period.basis],
  ];
  if (report.hasMultipleCurrencies) {
    rentalSummaryRows.push(["", "Perhatian mata uang", "", "", "Terdapat beberapa mata uang. Nilai uang dikelompokkan per mata uang dan tidak boleh dijumlahkan lintas mata uang."]);
  }
  writeTableSheet(workbook, {
    name: "Ringkasan",
    title: "LAPORAN PENYEWAAN",
    businessName,
    period: report.period,
    headers: ["Mata Uang", "Indikator", "Nilai", "Jumlah/Baris", "Keterangan"],
    widths: [16, 40, 24, 20, 88],
    rows: rentalSummaryRows,
    numericColumns: [3],
  });

  writeTableSheet(workbook, {
    name: "Daftar Penyewaan",
    title: "RINCIAN PENYEWAAN",
    businessName,
    period: report.period,
    headers: ["Nomor Penyewaan", "Nama Penyewa", "Status", "Mata Uang", "Tanggal Dibuat", "Jadwal Mulai", "Jadwal Kembali", "Serah Terima Aktual", "Pengembalian Dimulai", "Dikembalikan Aktual", "Barang/Paket", "Nilai Kontrak/Draf", "Pembayaran DP/Pelunasan", "Sisa Tagihan Kontrak", "Kelebihan Bayar", "Pembayaran dalam mata uang kontrak", "Estimasi Denda Aktif", "Denda Disetujui", "Denda Menunggu Review", "Status Review Denda", "Perbedaan Mata Uang Pembayaran", "Perbedaan Mata Uang Review", "Jumlah Unit Ditetapkan"],
    widths: [26, 30, 22, 14, 24, 24, 24, 24, 24, 24, 48, 20, 24, 20, 20, 27, 20, 20, 23, 28, 22, 22, 20],
    rows: report.items.map((item) => [
      item.nomor_penyewaan,
      item.penyewa_nama ?? "Nama tidak tersedia",
      formatRentalStatus(item.status),
      item.currency_code,
      item.created_at,
      item.jadwal_mulai,
      item.jadwal_kembali,
      item.actual_pickup_at,
      item.actual_return_started_at,
      item.actual_return_completed_at,
      item.lines.map((line) => line.label + " x" + line.quantity).join("; "),
      Number(item.total_amount),
      item.rental_base_payment_total,
      item.status === "draft" || item.status === "cancelled" ? "Tidak ditagih (draf/batal)" : item.balance_due,
      item.status === "draft" || item.status === "cancelled" ? "Tidak dihitung (draf/batal)" : item.overpaid_amount,
      item.recorded_payment_total,
      item.late_fee_assessment ? Number(item.late_fee_assessment.amount ?? 0) : "",
      item.approved_late_fee,
      item.pending_late_fee,
      item.late_fee_review_status,
      item.payment_currency_mismatch_count,
      item.late_fee_currency_mismatch_count,
      item.assignment_count,
    ]),
    numericColumns: [12, 13, 14, 15, 16, 17, 18, 19],
  });

  const rentalNumberById = new Map(report.items.map((item) => [item.penyewaan_id, item.nomor_penyewaan]));
  writeTableSheet(workbook, {
    name: "Pembayaran Penyewaan",
    title: "PEMBAYARAN TERKAIT PENYEWAAN",
    businessName,
    period: report.period,
    headers: ["Tanggal Bayar", "Nomor Pembayaran", "Nomor Penyewaan", "Nama Penyewa", "Jenis", "Metode", "Nominal", "Mata Uang", "Status", "Referensi", "Catatan", "ID Transaksi Keuangan"],
    widths: [22, 26, 26, 30, 20, 18, 19, 14, 18, 30, 42, 40],
    rows: report.payments.map((payment) => [
      payment.dibayar_at,
      payment.nomor_pembayaran,
      rentalNumberById.get(payment.penyewaan_id) ?? payment.nomor_penyewaan,
      payment.nama_penyewa,
      formatPaymentKind(payment.jenis),
      payment.metode,
      payment.amount,
      payment.currency_code,
      formatFinanceStatus(payment.status),
      payment.reference_text,
      payment.catatan,
      payment.transaksi_keuangan_id,
    ]),
    numericColumns: [7],
  });

  writeTableSheet(workbook, {
    name: "Rincian Barang",
    title: "RINCIAN BARANG DAN PAKET",
    businessName,
    period: report.period,
    headers: ["Nomor Penyewaan", "Nama Penyewa", "Jenis", "Barang/Paket", "Jumlah", "Jumlah Komponen Paket", "Rincian Komponen"],
    widths: [28, 32, 18, 42, 14, 25, 58],
    rows: report.items.flatMap((item) => item.lines.map((line) => [
      item.nomor_penyewaan,
      item.penyewa_nama ?? "Nama tidak tersedia",
      line.kind,
      line.label,
      line.quantity,
      line.component_count,
      line.components.map((component) => component.label + " x" + component.quantity).join("; "),
    ])),
  });

  writeTableSheet(workbook, {
    name: "Tinjauan Denda",
    title: "TINJAUAN DENDA KETERLAMBATAN",
    businessName,
    period: report.period,
    headers: ["Nomor Penyewaan", "Nama Penyewa", "Status Sewa", "Batas Toleransi", "Tarif per Jam", "Jam Ditagihkan", "Estimasi Denda", "Mata Uang", "Status Kalkulasi", "Denda Disetujui", "Denda Menunggu Review", "Status Review", "Jumlah Review", "Review Berbeda Mata Uang"],
    widths: [26, 30, 22, 26, 20, 19, 20, 14, 24, 20, 24, 28, 18, 22],
    rows: report.items.map((item) => [
      item.nomor_penyewaan,
      item.penyewa_nama ?? "Nama tidak tersedia",
      item.status,
      item.late_fee_assessment?.tolerance_deadline ?? item.tolerance_deadline,
      Number(item.late_fee_assessment?.rate_per_hour ?? 0),
      Number(item.late_fee_assessment?.billable_hours ?? 0),
      item.late_fee_assessment ? Number(item.late_fee_assessment.amount ?? 0) : "",
      item.currency_code,
      item.late_fee_assessment?.state ?? "Tidak dihitung; cek review final",
      item.approved_late_fee,
      item.pending_late_fee,
      item.late_fee_review_status,
      item.late_fee_review_count,
      item.late_fee_currency_mismatch_count,
    ]),
    numericColumns: [5, 6, 7, 10, 11],
  });

  const fileName = "laporan-penyewaan-" + safeSlug(businessName) + "-" + report.period.start_date + "-sd-" + lastDayExclusive(report.period) + "-" + timestamp(report.period.timezone) + ".xlsx";
  await downloadWorkbook(workbook, fileName);
}
