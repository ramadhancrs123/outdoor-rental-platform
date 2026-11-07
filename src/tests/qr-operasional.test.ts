import { PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { parseQrValue } from "@/features/qr-operasional/scan";
import {
  buildPenyewaanQrUrl,
  buildUnitQrUrl,
  generateQrPngDataUrl,
  generateQrSvg,
  buildThermalReceiptPrintHtml,
  buildRentalReceiptHtml,
  buildRentalReceiptFileName,
  getReceiptToleranceHours,
  normalizeReceiptWhatsAppPhone,
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

  test("parses rental QR deep links into the rental token", () => {
    expect(parseQrValue("https://admin.example.com/qr/penyewaan/rent456?source=printed"))
      .toEqual({ jenis: "penyewaan", token: "rent456" });
    expect(parseQrValue("https://admin.example.com/qr/unit/unit123"))
      .toEqual({ jenis: "unit", token: "unit123" });
    expect(parseQrValue("  rent456  ")).toEqual({ token: "rent456" });
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

  test("builds one 58mm rental and mixed-checkout receipt layout with item and checkout discounts", () => {
    const receipt = {
      usaha_nama: "Akasha Outdoor",
      usaha_alamat: "Jl. QA No. 1",
      usaha_telepon: "081234567890",
      usaha_email: "hello@example.com",
      timezone: "Asia/Jakarta",
      generated_at: "2026-10-03T01:20:00.000Z",
      tanggal_transaksi: "2026-10-03T01:00:00.000Z",
      nomor_penyewaan: "RNT-2026-027",
      nomor_checkout: "CHK-2026-004",
      nomor_penjualan: "SAL-2026-004",
      penyewa_nama: "Budi Santoso",
      penyewa_telepon: "081234567890",
      jadwal_mulai: "2026-10-03T01:00:00.000Z",
      jadwal_kembali: "2026-10-04T01:00:00.000Z",
      tolerance_deadline: "2026-10-04T11:00:00.000Z",
      actual_pickup_at: "2026-10-03T02:15:00.000Z",
      actual_return_completed_at: "2026-10-04T03:30:00.000Z",
      subtotal_rental: 155000,
      subtotal_penjualan: 50000,
      total_amount: 197000,
      currency_code: "IDR",
      token_qr: "rental-token-1",
      url: "https://admin.example.com/qr/penyewaan/rental-token-1",
      lines: [{
        nama: "Tenda dome 4P",
        rincian: "4P-cream",
        jumlah: 1,
        unit_price: 65000,
        subtotal: 65000,
        currency_code: "IDR",
        harga_normal_snapshot: 75000,
        diskon_persen_snapshot: 13.33,
        nominal_diskon_snapshot: 10000,
        period_count: 2,
        period_description: "1 hari",
      }, {
        nama: "Paket Camping Keluarga",
        rincian: null,
        jumlah: 1,
        unit_price: 45000,
        subtotal: 90000,
        currency_code: "IDR",
        harga_normal_snapshot: 50000,
        diskon_persen_snapshot: 10,
        nominal_diskon_snapshot: 10000,
        promo_label: "Promo paket",
        period_count: 2,
        period_description: "1 hari",
      }],
      sale_lines: [{
        nama: "Jas Hujan",
        rincian: null,
        jumlah: 2,
        unit_price: 25000,
        subtotal: 50000,
        currency_code: "IDR",
        harga_normal_snapshot: 30000,
        diskon_persen_snapshot: 16.67,
        nominal_diskon_snapshot: 10000,
      }],
      discounts: {
        manual_rental: 5000,
        loyalty_rental: 2000,
        loyalty_sale: 1000,
        other_rental: 0,
      },
      pembayaran: { tercatat: 197000, sisa: 0, status: "lunas" as const },
    };
    const html = buildRentalReceiptHtml(receipt, "data:image/png;base64,TEST", "data:image/webp;base64,LOGO");

    expect(html).toContain("@page { size: 58mm auto; margin: 0; }");
    expect(html).toContain("data:image/png;base64,TEST");
    expect(html).toContain("data:image/webp;base64,LOGO");
    expect(html).toContain("AKASHA OUTDOOR");
    expect(html).toContain("ready for your wild journey");
    expect(html).toContain("DETAIL TRANSAKSI & PENYEWA");
    expect(html).toContain("Budi Santoso");
    expect(html).toContain("JADWAL PENYEWAAN");
    expect(html).toContain(">Mulai</span>");
    expect(html).toContain(">Kembali</span>");
    expect(html).toContain(">Toleransi</span>");
    expect(html).not.toContain("Serah-terima");
    expect(html).not.toContain("Pengembalian aktual");
    expect(html).not.toContain("Tanggal transaksi");
    expect(html).not.toContain("CHK-2026-004");
    expect(html).not.toContain("SAL-2026-004");
    expect(html).not.toContain("RNT-2026-027");
    expect(html).toContain("RINCIAN BARANG");
    expect(html).toContain("item-kind sewa");
    expect(html).toContain("item-kind jual");
    expect(html).not.toContain("BARANG SEWA</div>");
    expect(html).not.toContain("BARANG DIBELI");
    expect(html).toContain("Promo katalog (13.33%)");
    expect(html).toContain("Promo paket (10%)");
    expect(html).toContain("2 periode × 1 hari");
    expect(html).not.toContain("Total Rental");
    expect(html).not.toContain("Total Jual");
    expect(html).not.toContain("Promo barang / paket");
    expect(html).not.toContain("Diskon Manual");
    expect(html).toContain("Promo / Diskon Sewa");
    expect(html).toContain("Diskon Loyalitas Rental");
    expect(html).toContain("Diskon Loyalitas Penjualan");
    expect(html).toContain("Total Sewa + Beli");
    expect(html).toContain("Rp 205.000");
    expect(html).toContain("TOTAL TRANSAKSI");
    expect(html).toContain("Rp 197.000");
    expect(html).toContain("PEMBAYARAN");
    expect(html).toContain("<div class=\"section-title\">Catatan</div>");
    expect(html).toContain("Waktu toleransi pengembalian <strong>10</strong> jam");
    expect(html).not.toContain("CATATAN UNTUK PENYEWA");
    expect(html).toContain("Semoga perjalanan Anda menyenangkan.");
    expect(html).toContain("Dicetak dengan Akasha Outdoor Management System");
    expect(html).not.toContain("SELAMAT BERAKTIVITAS");
    expect(html.indexOf("Total Sewa + Beli")).toBeLessThan(html.indexOf("DISKON"));
    expect(html.indexOf("DISKON")).toBeLessThan(html.indexOf("TOTAL TRANSAKSI"));
    expect(html.indexOf("TOTAL TRANSAKSI")).toBeLessThan(html.indexOf("PEMBAYARAN"));
    expect(html.indexOf("QR PENYEWAAN")).toBeGreaterThan(html.indexOf("PEMBAYARAN"));
    expect(html.indexOf("Semoga perjalanan Anda menyenangkan.")).toBeGreaterThan(html.indexOf("QR PENYEWAAN"));
    expect(html.indexOf("Dicetak dengan Akasha Outdoor Management System")).toBeGreaterThan(html.indexOf("Semoga perjalanan Anda menyenangkan."));

    expect(buildThermalReceiptPrintHtml(receipt, "data:image/png;base64,TEST")).toContain("AKASHA OUTDOOR");
  });

  test("derives the printed tolerance from the persisted rental return deadline", () => {
    expect(getReceiptToleranceHours("2026-10-04T01:00:00.000Z", "2026-10-04T11:00:00.000Z")).toBe(10);
    expect(getReceiptToleranceHours("2026-10-04T01:00:00.000Z", "2026-10-04T13:30:00.000Z")).toBe(12.5);
    expect(getReceiptToleranceHours("2026-10-04T01:00:00.000Z", "2026-10-04T01:00:00.000Z")).toBe(0);
    expect(getReceiptToleranceHours("2026-10-04T01:00:00.000Z", null)).toBe(0);
    expect(getReceiptToleranceHours("invalid", "also-invalid")).toBe(0);
  });

  test("normalizes Indonesian renter phones for direct WhatsApp sharing", () => {
    expect(normalizeReceiptWhatsAppPhone("0812 3456 7890")).toBe("6281234567890");
    expect(normalizeReceiptWhatsAppPhone("+62 812-3456-7890")).toBe("6281234567890");
    expect(normalizeReceiptWhatsAppPhone("081234567890")).toBe("6281234567890");
    expect(normalizeReceiptWhatsAppPhone("+1 415 555 0199")).toBe("14155550199");
    expect(normalizeReceiptWhatsAppPhone("nomor tidak ada")).toBe("");
    expect(normalizeReceiptWhatsAppPhone(null)).toBe("");
  });

  test("builds a filesystem-safe filename from renter name and rental start date", () => {
    expect(buildRentalReceiptFileName({
      penyewa_nama: "Budi Santoso",
      jadwal_mulai: "2026-10-02T18:00:00.000Z",
      timezone: "Asia/Jakarta",
    })).toBe("BUDI-SANTOSO-2026-10-03");
    expect(buildRentalReceiptFileName({
      penyewa_nama: "Éka Pratama / Outdoor",
      jadwal_mulai: "2026-10-02T18:00:00.000Z",
      timezone: "Asia/Jakarta",
    })).toBe("EKA-PRATAMA-OUTDOOR-2026-10-03");
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
