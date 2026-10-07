import type { RentalDetail } from "@/features/penyewaan/types";
import type { QrPenyewaanRecord, RentalReceiptData, UnitQrLabelData } from "./types";
import { buildPenyewaanQrUrl, buildUnitQrUrl } from "./url";

export function mapUnitQrLabelData(
  input: {
    kode_unit: string;
    nama_barang: string;
    nama_varian?: string | null;
    token_qr: string;
  },
  baseUrl: string,
): UnitQrLabelData {
  return {
    ...input,
    url: buildUnitQrUrl(baseUrl, input.token_qr),
  };
}

export type RentalReceiptSupport = {
  usaha_nama: string;
  usaha_alamat: string | null;
  usaha_telepon: string | null;
  usaha_email: string | null;
  timezone: string;
  penyewa_telepon?: string | null;
  pembayaran: RentalReceiptData["pembayaran"];
};

export function mapRentalQrReceiptData(
  rental: RentalDetail,
  qr: QrPenyewaanRecord,
  baseUrl: string,
  support: RentalReceiptSupport,
): RentalReceiptData {
  return {
    usaha_nama: support.usaha_nama,
    usaha_alamat: support.usaha_alamat,
    usaha_telepon: support.usaha_telepon,
    usaha_email: support.usaha_email,
    timezone: support.timezone || "Asia/Jakarta",
    nomor_penyewaan: rental.nomor_penyewaan,
    penyewa_nama: rental.penyewa_nama ?? "Penyewa tidak ditemukan",
    penyewa_telepon: support.penyewa_telepon ?? null,
    jadwal_mulai: rental.jadwal_mulai,
    jadwal_kembali: rental.jadwal_kembali,
    tolerance_deadline: rental.tolerance_deadline,
    actual_pickup_at: rental.actual_pickup_at,
    total_amount: Number(rental.total_amount),
    currency_code: rental.currency_code,
    token_qr: qr.token_qr,
    url: buildPenyewaanQrUrl(baseUrl, qr.token_qr),
    generated_at: new Date().toISOString(),
    lines: rental.lines.map((line) => ({
      nama: line.paket_nama ?? line.barang_nama ?? "Barang",
      rincian: line.varian_nama,
      jumlah: Number(line.jumlah),
      subtotal: Number(line.subtotal),
      currency_code: line.currency_code,
    })),
    catatan: rental.catatan,
    pembayaran: support.pembayaran,
  };
}
