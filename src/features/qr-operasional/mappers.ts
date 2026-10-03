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

export function mapRentalQrReceiptData(
  rental: RentalDetail,
  qr: QrPenyewaanRecord,
  baseUrl: string,
  pembayaran?: RentalReceiptData["pembayaran"],
): RentalReceiptData {
  return {
    nomor_penyewaan: rental.nomor_penyewaan,
    penyewa_nama: rental.penyewa_nama ?? "Penyewa tidak ditemukan",
    jadwal_mulai: rental.jadwal_mulai,
    jadwal_kembali: rental.jadwal_kembali,
    total_amount: Number(rental.total_amount),
    currency_code: rental.currency_code,
    token_qr: qr.token_qr,
    url: buildPenyewaanQrUrl(baseUrl, qr.token_qr),
    lines: rental.lines.map((line) => ({
      nama: line.paket_nama ?? line.barang_nama ?? "Barang",
      rincian: line.varian_nama,
      jumlah: Number(line.jumlah),
      subtotal: Number(line.subtotal),
      currency_code: line.currency_code,
    })),
    catatan: rental.catatan,
    pembayaran: pembayaran ?? null,
  };
}
