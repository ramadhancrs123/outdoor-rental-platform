import { DEFAULT_THERMAL_RECEIPT_WIDTH_MM, DEFAULT_UNIT_QR_LABEL_SIZE_MM } from "./constants";
import { dataUrlToUint8Array, generateQrPngDataUrl } from "./generator";
import type {
  RentalReceiptData,
  ThermalReceiptOptions,
  UnitQrLabelData,
  UnitQrLabelOptions,
} from "./types";

async function loadPdfLib() {
  return import("pdf-lib");
}

const PT_PER_MM = 72 / 25.4;

function mm(value: number) {
  return value * PT_PER_MM;
}

function safeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function currency(amount: number, code: string) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).format(amount);
}

function wrapText(text: string, maxCharacters: number) {
  const words = safeText(text).split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (candidate.length > maxCharacters && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines;
}

export async function generateUnitQrLabelPdf(
  labels: UnitQrLabelData[],
  options: UnitQrLabelOptions = {},
) {
  if (labels.length === 0) throw new Error("Tidak ada label QR unit yang akan dibuat.");
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();

  const format = options.format ?? "label";
  const includeVariant = options.includeVariant ?? true;

  if (format === "a4") {
    const marginMm = options.marginMm ?? 10;
    const labelsPerPage = Math.max(1, options.labelsPerPage ?? 8);
    const pageWidthMm = 210;
    const pageHeightMm = 297;
    const columns = 2;
    const rows = Math.ceil(labelsPerPage / columns);
    const gapMm = 5;
    const contentWidthMm = pageWidthMm - marginMm * 2;
    const contentHeightMm = pageHeightMm - marginMm * 2;
    const cardWidthMm = (contentWidthMm - gapMm * (columns - 1)) / columns;
    const cardHeightMm = (contentHeightMm - gapMm * (rows - 1)) / rows;
    const qrSizeMm = Math.min(43, cardHeightMm - 18, cardWidthMm - 32);

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

    for (let start = 0; start < labels.length; start += labelsPerPage) {
      const page = pdf.addPage([mm(pageWidthMm), mm(pageHeightMm)]);

      for (let offset = 0; offset < Math.min(labelsPerPage, labels.length - start); offset += 1) {
        const label = labels[start + offset];
        const column = offset % columns;
        const row = Math.floor(offset / columns);
        const x = mm(marginMm + column * (cardWidthMm + gapMm));
        const y = page.getHeight() - mm(marginMm + row * (cardHeightMm + gapMm) + cardHeightMm);

        page.drawRectangle({
          x,
          y,
          width: mm(cardWidthMm),
          height: mm(cardHeightMm),
          borderWidth: 1,
          borderColor: rgb(0.82, 0.84, 0.88),
          color: rgb(1, 1, 1),
        });

        const qrDataUrl = await generateQrPngDataUrl(label.url, 768);
        const qr = await pdf.embedPng(dataUrlToUint8Array(qrDataUrl));
        const qrX = x + mm(cardWidthMm - qrSizeMm - 7);
        const qrY = y + (mm(cardHeightMm) - mm(qrSizeMm)) / 2;
        page.drawImage(qr, {
          x: qrX,
          y: qrY,
          width: mm(qrSizeMm),
          height: mm(qrSizeMm),
        });

        const textX = x + mm(6);
        const textWidth = mm(cardWidthMm - qrSizeMm - 20);
        const title = includeVariant && label.nama_varian
          ? label.nama_barang + " · " + label.nama_varian
          : label.nama_barang;

        page.drawText("UNIT OUTDOOR", {
          x: textX,
          y: y + mm(cardHeightMm - 12),
          size: 7,
          font: boldFont,
          color: rgb(0.35, 0.39, 0.45),
          maxWidth: textWidth,
        });

        page.drawText(safeText(label.kode_unit), {
          x: textX,
          y: y + mm(cardHeightMm - 22),
          size: 16,
          font: boldFont,
          color: rgb(0.05, 0.05, 0.05),
          maxWidth: textWidth,
        });

        page.drawText(safeText(title), {
          x: textX,
          y: y + mm(cardHeightMm - 31),
          size: 9,
          font,
          color: rgb(0.25, 0.28, 0.32),
          maxWidth: textWidth,
        });

        page.drawText("Scan untuk membuka detail unit", {
          x: textX,
          y: y + mm(7),
          size: 7,
          font,
          color: rgb(0.35, 0.39, 0.45),
          maxWidth: textWidth,
        });

        page.drawText("QR Unit", {
          x: qrX,
          y: y + mm(7),
          size: 7,
          font: boldFont,
          color: rgb(0.29, 0.33, 0.38),
          maxWidth: mm(qrSizeMm),
        });
      }
    }

    return pdf.save();
  }

  const widthMm = options.widthMm ?? DEFAULT_UNIT_QR_LABEL_SIZE_MM.width;
  const heightMm = options.heightMm ?? DEFAULT_UNIT_QR_LABEL_SIZE_MM.height;
  const marginMm = options.marginMm ?? 2.5;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (const label of labels) {
    const page = pdf.addPage([mm(widthMm), mm(heightMm)]);
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const qrSize = Math.min(mm(heightMm - marginMm * 2), mm(21));
    const qrDataUrl = await generateQrPngDataUrl(label.url, 512);
    const qr = await pdf.embedPng(dataUrlToUint8Array(qrDataUrl));

    page.drawImage(qr, {
      x: pageWidth - mm(marginMm) - qrSize,
      y: (pageHeight - qrSize) / 2,
      width: qrSize,
      height: qrSize,
    });

    const textX = mm(marginMm);
    const textWidth = pageWidth - qrSize - mm(marginMm * 3);
    const title = includeVariant && label.nama_varian
      ? label.nama_barang + " · " + label.nama_varian
      : label.nama_barang;

    page.drawText(safeText(label.kode_unit), {
      x: textX,
      y: pageHeight - mm(7),
      size: 10,
      font: boldFont,
      color: rgb(0.05, 0.05, 0.05),
      maxWidth: textWidth,
    });

    page.drawText(safeText(title), {
      x: textX,
      y: pageHeight - mm(13),
      size: 7.5,
      font,
      color: rgb(0.25, 0.25, 0.25),
      maxWidth: textWidth,
    });

    page.drawText("Scan untuk membuka detail unit", {
      x: textX,
      y: mm(4),
      size: 6,
      font,
      color: rgb(0.35, 0.35, 0.35),
      maxWidth: textWidth,
    });
  }

  return pdf.save();
}

export async function generateRentalReceiptThermalPdf(
  receipt: RentalReceiptData,
  options: ThermalReceiptOptions = {},
) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const widthMm = options.widthMm ?? DEFAULT_THERMAL_RECEIPT_WIDTH_MM;
  const marginMm = options.marginMm ?? 3;
  const includeQr = options.includeQr ?? true;
  const qrSizeMm = options.qrSizeMm ?? 29;

  const estimateTextLines = receipt.lines.reduce((sum, line) =>
    sum + wrapText(line.nama + (line.rincian ? " · " + line.rincian : ""), 24).length + 2, 1);
  const heightMm = 92 + estimateTextLines * 3.8 + (receipt.usaha_alamat ? 7 : 0) + (receipt.usaha_telepon || receipt.usaha_email ? 6 : 0) + (receipt.pembayaran ? 22 : 0) + (receipt.catatan ? 14 : 0) + (includeQr ? qrSizeMm + 22 : 0);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([mm(widthMm), mm(Math.max(heightMm, 150))]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const x = mm(marginMm);
  const contentWidth = page.getWidth() - mm(marginMm * 2);
  let y = page.getHeight() - mm(5);

  const center = (text: string, size: number, font: typeof regular, gap = 4) => {
    page.drawText(safeText(text), { x: (page.getWidth() - font.widthOfTextAtSize(safeText(text), size)) / 2, y, size, font });
    y -= mm(gap);
  };
  const rule = () => {
    page.drawLine({ start: { x, y }, end: { x: page.getWidth() - x, y }, thickness: 0.7, color: rgb(0.2, 0.2, 0.2) });
    y -= mm(4);
  };
  const softRule = () => {
    page.drawLine({ start: { x, y }, end: { x: page.getWidth() - x, y }, thickness: 0.35, color: rgb(0.55, 0.55, 0.55), dashArray: [2, 2] });
    y -= mm(3);
  };
  const row = (label: string, value: string, size = 7.1) => {
    page.drawText(safeText(label), { x, y, size, font: regular });
    const clean = safeText(value);
    page.drawText(clean, { x: page.getWidth() - x - bold.widthOfTextAtSize(clean, size), y, size, font: bold });
    y -= mm(3.8);
  };

  center("AKASHA OUTDOOR RENT", 8.9, bold, 4.5);
  center("ready for your wild journey", 6.2, regular, 3.5);
  if (receipt.usaha_alamat) center(receipt.usaha_alamat, 6.6, regular, 3.5);
  if (receipt.usaha_telepon || receipt.usaha_email) center([receipt.usaha_telepon, receipt.usaha_email].filter(Boolean).join(" · "), 6.2, regular, 4);
  rule();
  center("BUKTI PENYEWAAN", 8.5, bold, 3.5);
  center(receipt.nomor_penyewaan, 10, bold, 5);

  page.drawText("PERIODE PENYEWAAN", { x, y, size: 7, font: bold });
  y -= mm(4);
  row("Mulai", formatReceiptDateTime(receipt.jadwal_mulai, receipt.timezone));
  row("Berakhir", formatReceiptDateTime(receipt.jadwal_kembali, receipt.timezone));
  row("Toleransi", formatReceiptDateTime(receipt.tolerance_deadline, receipt.timezone));
  if (receipt.actual_pickup_at) row("Serah-terima", formatReceiptDateTime(receipt.actual_pickup_at, receipt.timezone));

  y -= mm(1);
  page.drawText("PENYEWA", { x, y, size: 7, font: bold });
  y -= mm(4);
  for (const line of wrapText(receipt.penyewa_nama, 29)) {
    page.drawText(line, { x, y, size: 8.2, font: bold, maxWidth: contentWidth });
    y -= mm(4);
  }
  if (receipt.penyewa_telepon) {
    page.drawText(safeText(receipt.penyewa_telepon), { x, y, size: 6.7, font: regular });
    y -= mm(4);
  }

  y -= mm(1);
  page.drawText("PERLENGKAPAN", { x, y, size: 7, font: bold });
  y -= mm(3);
  softRule();
  for (const line of receipt.lines) {
    const title = line.nama + (line.rincian ? " · " + line.rincian : "");
    for (const titleLine of wrapText(title, 23)) {
      page.drawText(titleLine, { x, y, size: 7.3, font: bold, maxWidth: contentWidth });
      y -= mm(3.6);
    }
    const meta = line.jumlah + " × " + currency(line.subtotal / Math.max(line.jumlah, 1), line.currency_code);
    page.drawText(meta, { x, y, size: 6.5, font: regular });
    const amount = currency(line.subtotal, line.currency_code);
    page.drawText(amount, { x: page.getWidth() - x - bold.widthOfTextAtSize(amount, 7.3), y, size: 7.3, font: bold });
    y -= mm(5);
  }

  y -= mm(1);
  rule();
  page.drawText("TOTAL PENYEWAAN", { x, y, size: 8, font: bold });
  const total = currency(receipt.total_amount, receipt.currency_code);
  page.drawText(total, { x: page.getWidth() - x - bold.widthOfTextAtSize(total, 10), y, size: 10, font: bold });
  y -= mm(7);

  if (receipt.pembayaran) {
    page.drawText("PEMBAYARAN", { x, y, size: 7, font: bold });
    y -= mm(4);
    row("Status", paymentLabel(receipt.pembayaran.status), 7);
    row("Tercatat", currency(receipt.pembayaran.tercatat, receipt.currency_code), 7);
    row("Sisa", currency(receipt.pembayaran.sisa, receipt.currency_code), 7);
    y -= mm(1);
  }

  if (receipt.catatan) {
    page.drawText("CATATAN", { x, y, size: 7, font: bold });
    y -= mm(4);
    for (const line of wrapText(receipt.catatan, 31)) {
      page.drawText(line, { x, y, size: 6.6, font: regular, maxWidth: contentWidth });
      y -= mm(3.6);
    }
    y -= mm(2);
  }

  softRule();
  if (includeQr) {
    const qrDataUrl = await generateQrPngDataUrl(receipt.url, 512);
    const qr = await pdf.embedPng(dataUrlToUint8Array(qrDataUrl));
    const qrX = (page.getWidth() - mm(qrSizeMm)) / 2;
    page.drawImage(qr, { x: qrX, y: y - mm(qrSizeMm), width: mm(qrSizeMm), height: mm(qrSizeMm) });
    y -= mm(qrSizeMm + 4);
    center("QR PENYEWAAN", 6.6, bold, 3);
    center(receipt.nomor_penyewaan, 6.6, bold, 4);
  }
  center("SEMOGA PERJALANAN ANDA MENYENANGKAN", 6.3, bold, 4);
  center("Dicetak " + formatReceiptDateTime(receipt.generated_at, receipt.timezone), 5.5, regular, 2);

  return pdf.save();
}

function formatReceiptDateTime(value: string | null | undefined, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value)).replace(".", ":");
}

function paymentLabel(status: NonNullable<RentalReceiptData["pembayaran"]>["status"]) {
  if (status === "lunas") return "LUNAS";
  if (status === "sebagian") return "SEBAGIAN";
  return "BELUM DIBAYAR";
}


