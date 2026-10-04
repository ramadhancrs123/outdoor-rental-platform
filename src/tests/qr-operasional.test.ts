import { PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";
import {
  buildPenyewaanQrUrl,
  buildUnitQrUrl,
  generateQrPngDataUrl,
  generateQrSvg,
  buildThermalReceiptPrintHtml,
  generateRentalReceiptThermalPdf,
  generateUnitQrLabelPdf,
  buildUnitQrPrintDocument,
} from "@/features/qr-operasional";

describe("QR operasional foundation", () => {
  test("builds stable unit and rental deep links", () => {
    expect(buildUnitQrUrl("https://admin.example.com/", "abc123")).toBe(
      "https://admin.example.com/qr/unit/abc123",
    );
    expect(buildPenyewaanQrUrl("https://admin.example.com", "rent456")).toBe(
      "https://admin.example.com/qr/penyewaan/rent456",
    );
  });

  test("generates QR SVG and PNG data URL", async () => {
    const svg = await generateQrSvg("https://admin.example.com/qr/unit/abc123");
    const png = await generateQrPngDataUrl("https://admin.example.com/qr/unit/abc123");

    expect(svg).toContain("<svg");
    expect(png).toMatch(/^data:image\/png;base64,/);
  });

  test("generates batch unit label PDF", async () => {
    const bytes = await generateUnitQrLabelPdf([
      {
        kode_unit: "TENDA4-BLK-001",
        nama_barang: "Tenda dome 4P",
        nama_varian: "4P-Hitam",
        token_qr: "unit-token-1",
        url: "https://admin.example.com/qr/unit/unit-token-1",
      },
      {
        kode_unit: "TENDA4-CRM-001",
        nama_barang: "Tenda dome 4P",
        nama_varian: "4P-cream",
        token_qr: "unit-token-2",
        url: "https://admin.example.com/qr/unit/unit-token-2",
      },
    ]);

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
  });

  test("builds A4 batch print document with clear unit label layout", () => {
    const html = buildUnitQrPrintDocument(
      [
        {
          kode_unit: "TENDA4-BLK-001",
          nama_barang: "Tenda dome 4P",
          nama_varian: "4P-Hitam",
          token_qr: "unit-token-1",
          url: "https://admin.example.com/qr/unit/unit-token-1",
        },
        {
          kode_unit: "TENDA4-CRM-001",
          nama_barang: "Tenda dome 4P",
          nama_varian: "4P-Cream",
          token_qr: "unit-token-2",
          url: "https://admin.example.com/qr/unit/unit-token-2",
        },
      ],
      [
        "data:image/png;base64,QR1",
        "data:image/png;base64,QR2",
      ],
      { format: "a4", labelsPerPage: 8 },
    );

    expect(html).toContain("@page { size: A4 portrait; margin: 10mm; }");
    expect(html).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(html).toContain("TENDA4-BLK-001");
    expect(html).toContain("TENDA4-CRM-001");
    expect(html).toContain("data:image/png;base64,QR1");
  });

  test("generates A4 batch unit label PDF", async () => {
    const bytes = await generateUnitQrLabelPdf(
      [
        {
          kode_unit: "TENDA4-BLK-001",
          nama_barang: "Tenda dome 4P",
          nama_varian: "4P-Hitam",
          token_qr: "unit-token-1",
          url: "https://admin.example.com/qr/unit/unit-token-1",
        },
        {
          kode_unit: "TENDA4-CRM-001",
          nama_barang: "Tenda dome 4P",
          nama_varian: "4P-Cream",
          token_qr: "unit-token-2",
          url: "https://admin.example.com/qr/unit/unit-token-2",
        },
      ],
      { format: "a4", labelsPerPage: 8 },
    );

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(841.89, 1);
  });

  test("builds thermal print document with QR and 58mm page rule", () => {
    const html = buildThermalReceiptPrintHtml({
      usaha_nama: "AKASHA",
      usaha_alamat: "Jl. QA No. 1",
      usaha_telepon: "081234567890",
      usaha_email: "hello@example.com",
      timezone: "Asia/Jakarta",
      generated_at: "2026-10-03T01:00:00.000Z",
      nomor_penyewaan: "RNT-2026-027",
      penyewa_nama: "Penyewa QA",
      jadwal_mulai: "2026-10-03T01:00:00.000Z",
      jadwal_kembali: "2026-10-04T01:00:00.000Z",
      tolerance_deadline: "2026-10-04T11:00:00.000Z",
      actual_pickup_at: "2026-10-03T02:15:00.000Z",
      total_amount: 125000,
      currency_code: "IDR",
      token_qr: "rental-token-1",
      url: "https://admin.example.com/qr/penyewaan/rental-token-1",
      lines: [],
      pembayaran: { tercatat: 75000, sisa: 50000, status: "sebagian" },
    }, "data:image/png;base64,TEST");

    expect(html).toContain("@page { size: 58mm auto; margin: 0; }");
    expect(html).toContain("data:image/png;base64,TEST");
    expect(html).toContain("RNT-2026-027");
    expect(html).toContain("<div class=\"brand\">AKASHA OUTDOOR RENT</div>");
    expect(html).toContain("ready for your wild journey");
    expect(html).toContain("PERIODE PENYEWAAN");
    expect(html).toContain("Toleransi");
    expect(html).toContain("PEMBAYARAN");
    expect(html).toContain("QR PENYEWAAN");
    expect(html).toContain("SEMOGA PERJALANAN ANDA MENYENANGKAN");
    expect(html).toContain("03 Okt 2026");
    expect(html).toContain("04 Okt 2026, 18:00");
    expect(html).toContain("03 Okt 2026, 09:15");
  });

  test("generates 58mm thermal rental receipt PDF with QR", async () => {
    const bytes = await generateRentalReceiptThermalPdf({
      usaha_nama: "AKASHA",
      usaha_alamat: "Jl. QA No. 1",
      usaha_telepon: "081234567890",
      usaha_email: "hello@example.com",
      timezone: "Asia/Jakarta",
      generated_at: "2026-10-03T01:00:00.000Z",
      nomor_penyewaan: "RNT-2026-027",
      penyewa_nama: "Penyewa QA",
      jadwal_mulai: "2026-10-03T01:00:00.000Z",
      jadwal_kembali: "2026-10-04T01:00:00.000Z",
      tolerance_deadline: "2026-10-04T11:00:00.000Z",
      actual_pickup_at: "2026-10-03T02:15:00.000Z",
      total_amount: 125000,
      currency_code: "IDR",
      token_qr: "rental-token-1",
      url: "https://admin.example.com/qr/penyewaan/rental-token-1",
      lines: [
        {
          nama: "Tenda dome 4P",
          rincian: "4P-cream",
          jumlah: 1,
          subtotal: 65000,
          currency_code: "IDR",
        },
        {
          nama: "Tenda dome 4P",
          jumlah: 1,
          subtotal: 60000,
          currency_code: "IDR",
        },
      ],
    });

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getWidth()).toBeGreaterThan(160);
    expect(pdf.getPage(0).getWidth()).toBeLessThan(170);
  });
});
