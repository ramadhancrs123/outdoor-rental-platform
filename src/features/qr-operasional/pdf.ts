import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { DEFAULT_THERMAL_RECEIPT_WIDTH_MM, DEFAULT_UNIT_QR_LABEL_SIZE_MM } from "./constants";
import { dataUrlToUint8Array, generateQrPngDataUrl } from "./generator";
import type {
  RentalReceiptData,
  ThermalReceiptOptions,
  UnitQrLabelData,
  UnitQrLabelOptions,
} from "./types";

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
  const widthMm = options.widthMm ?? DEFAULT_THERMAL_RECEIPT_WIDTH_MM;
  const marginMm = options.marginMm ?? 3;
  const includeQr = options.includeQr ?? true;
  const qrSizeMm = options.qrSizeMm ?? 26;

  const itemLines = receipt.lines.flatMap((line) => {
    const title = wrapText(line.nama + (line.rincian ? " · " + line.rincian : ""), 27);
    return [
      ...title,
      `${line.jumlah} x ${currency(line.subtotal / Math.max(line.jumlah, 1), line.currency_code)}`,
      currency(line.subtotal, line.currency_code),
      "",
    ];
  });

  const headerHeight = 54;
  const paymentHeight = receipt.pembayaran ? 28 : 0;
  const noteHeight = receipt.catatan ? 24 : 0;
  const qrHeight = includeQr ? qrSizeMm + 14 : 0;
  const estimatedHeightMm = headerHeight + itemLines.length * 4.8 + paymentHeight + noteHeight + qrHeight;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([mm(widthMm), mm(estimatedHeightMm)]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  let y = page.getHeight() - mm(6);
  const x = mm(marginMm);
  const contentWidth = page.getWidth() - mm(marginMm * 2);
  const bodySize = 8;

  page.drawText("AKASHA STORE", {
    x,
    y,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  y -= mm(5);

  page.drawText("NOTA PENYEWAAN", {
    x,
    y,
    size: 8,
    font: boldFont,
  });
  y -= mm(5);

  for (const line of wrapText(receipt.nomor_penyewaan, 29)) {
    page.drawText(line, { x, y, size: bodySize, font });
    y -= mm(4);
  }

  page.drawText("Penyewa: " + safeText(receipt.penyewa_nama), {
    x,
    y,
    size: bodySize,
    font,
    maxWidth: contentWidth,
  });
  y -= mm(4);

  page.drawText("Mulai: " + new Date(receipt.jadwal_mulai).toLocaleString("id-ID"), {
    x,
    y,
    size: 7,
    font,
    maxWidth: contentWidth,
  });
  y -= mm(4);

  page.drawText("Kembali: " + new Date(receipt.jadwal_kembali).toLocaleString("id-ID"), {
    x,
    y,
    size: 7,
    font,
    maxWidth: contentWidth,
  });
  y -= mm(6);

  page.drawLine({
    start: { x, y },
    end: { x: page.getWidth() - x, y },
    thickness: 0.7,
    color: rgb(0.75, 0.75, 0.75),
  });
  y -= mm(4);

  for (const line of receipt.lines) {
    for (const titleLine of wrapText(line.nama + (line.rincian ? " · " + line.rincian : ""), 27)) {
      page.drawText(titleLine, { x, y, size: bodySize, font, maxWidth: contentWidth });
      y -= mm(4);
    }

    page.drawText(line.jumlah + " x " + currency(line.subtotal / Math.max(line.jumlah, 1), line.currency_code), {
      x,
      y,
      size: 7,
      font,
      maxWidth: contentWidth,
    });
    y -= mm(4);

    page.drawText(currency(line.subtotal, line.currency_code), {
      x,
      y,
      size: bodySize,
      font: boldFont,
      maxWidth: contentWidth,
    });
    y -= mm(5);
  }

  page.drawLine({
    start: { x, y },
    end: { x: page.getWidth() - x, y },
    thickness: 0.7,
    color: rgb(0.75, 0.75, 0.75),
  });
  y -= mm(5);

  page.drawText("TOTAL", { x, y, size: 9, font: boldFont });
  page.drawText(currency(receipt.total_amount, receipt.currency_code), {
    x: pageWidthRight(page, marginMm, currency(receipt.total_amount, receipt.currency_code), boldFont, 9),
    y,
    size: 9,
    font: boldFont,
  });
  y -= mm(6);

  if (receipt.pembayaran) {
    page.drawText("Pembayaran tercatat", { x, y, size: 7, font });
    y -= mm(4);
    page.drawText(currency(receipt.pembayaran.tercatat, receipt.currency_code), { x, y, size: 8, font: boldFont });
    y -= mm(4);
    page.drawText("Sisa " + currency(receipt.pembayaran.sisa, receipt.currency_code), { x, y, size: 7, font });
    y -= mm(6);
  }

  if (receipt.catatan) {
    page.drawText("Catatan", { x, y, size: 7, font: boldFont });
    y -= mm(4);
    for (const noteLine of wrapText(receipt.catatan, 32)) {
      page.drawText(noteLine, { x, y, size: 7, font, maxWidth: contentWidth });
      y -= mm(4);
    }
    y -= mm(3);
  }

  if (includeQr) {
    const qrDataUrl = await generateQrPngDataUrl(receipt.url, 512);
    const qr = await pdf.embedPng(dataUrlToUint8Array(qrDataUrl));
    y -= mm(qrSizeMm / 2);
    const qrX = (page.getWidth() - mm(qrSizeMm)) / 2;
    page.drawImage(qr, {
      x: qrX,
      y: y - mm(qrSizeMm),
      width: mm(qrSizeMm),
      height: mm(qrSizeMm),
    });
    y -= mm(qrSizeMm + 8);
    page.drawText("Scan untuk membuka detail penyewaan", {
      x: mm(marginMm),
      y,
      size: 6,
      font,
      maxWidth: contentWidth,
    });
  }

  return pdf.save();
}

function pageWidthRight(
  page: { getWidth(): number },
  marginMm: number,
  text: string,
  font: { widthOfTextAtSize(text: string, size: number): number },
  size: number,
) {
  return page.getWidth() - mm(marginMm) - font.widthOfTextAtSize(text, size);
}
