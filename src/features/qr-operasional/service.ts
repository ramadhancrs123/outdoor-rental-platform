import { supabase } from "@/app/providers/supabase/client";
import { getRental } from "@/features/penyewaan/service";
import { calculateTariffPeriods } from "@/features/katalog/pricing";
import type { RentalReceiptData, RentalQrLineData, QrPenyewaanRecord, QrUnitRecord } from "./types";
import { buildPenyewaanQrUrl } from "./url";

export async function listQrUnitRecords(
  usahaId: string,
  unitBarangIds?: string[],
): Promise<QrUnitRecord[]> {
  const { data, error } = await supabase.rpc("daftar_qr_unit", {
    p_usaha_id: usahaId,
    p_unit_barang_ids: unitBarangIds?.length ? unitBarangIds : null,
  });

  if (error) throw error;
  return (data ?? []) as QrUnitRecord[];
}

export async function listQrPenyewaanRecords(
  usahaId: string,
  penyewaanIds?: string[],
): Promise<QrPenyewaanRecord[]> {
  const { data, error } = await supabase.rpc("daftar_qr_penyewaan", {
    p_usaha_id: usahaId,
    p_penyewaan_ids: penyewaanIds?.length ? penyewaanIds : null,
  });

  if (error) throw error;
  return (data ?? []) as QrPenyewaanRecord[];
}

export async function resolveQrUnitToken(tokenQr: string) {
  const token = tokenQr.trim();
  if (!token) throw new Error("Token QR unit wajib diisi.");

  const { data, error } = await supabase.rpc("resolve_qr_unit", {
    p_token_qr: token,
  });

  if (error) throw error;
  return data as Array<{
    usaha_id: string;
    unit_barang_id: string;
    kode_unit: string;
  }>;
}

export async function resolveQrPenyewaanToken(tokenQr: string) {
  const token = tokenQr.trim();
  if (!token) throw new Error("Token QR penyewaan wajib diisi.");

  const { data, error } = await supabase.rpc("resolve_qr_penyewaan", {
    p_token_qr: token,
  });

  if (error) throw error;
  return data as Array<{
    usaha_id: string;
    penyewaan_id: string;
    nomor_penyewaan: string;
    status: string;
  }>;
}

export async function getQrUnitRecord(usahaId: string, unitBarangId: string) {
  const rows = await listQrUnitRecords(usahaId, [unitBarangId]);
  return rows[0] ?? null;
}

export async function getQrPenyewaanRecord(usahaId: string, penyewaanId: string) {
  const rows = await listQrPenyewaanRecords(usahaId, [penyewaanId]);
  return rows[0] ?? null;
}

export async function getRentalReceiptSupport(
  usahaId: string,
  penyewaanId: string,
  penyewaId: string,
) {
  const [{ data: usaha, error: usahaError }, { data: penyewa, error: penyewaError }, { data: payments, error: paymentError }] = await Promise.all([
    supabase
      .from("usaha")
      .select("usaha_id,nama,alamat,nomor_telepon,email,timezone")
      .eq("usaha_id", usahaId)
      .maybeSingle(),
    supabase
      .from("penyewa")
      .select("penyewa_id,nomor_telepon")
      .eq("usaha_id", usahaId)
      .eq("penyewa_id", penyewaId)
      .maybeSingle(),
    supabase
      .from("pembayaran")
      .select("pembayaran_id,amount,currency_code,status")
      .eq("usaha_id", usahaId)
      .eq("penyewaan_id", penyewaanId)
      .order("dibayar_at", { ascending: false }),
  ]);

  if (usahaError) throw usahaError;
  if (penyewaError) throw penyewaError;
  if (paymentError) throw paymentError;
  if (!usaha) throw new Error("Profil Usaha untuk struk tidak ditemukan.");

  const validPaymentStatuses = new Set(["recorded", "valid", "posted"]);
  const recorded = (payments ?? []).reduce((sum, payment) => {
    const status = String(payment.status ?? "").toLowerCase();
    return validPaymentStatuses.has(status) ? sum + Number(payment.amount) : sum;
  }, 0);

  const paymentCurrency = (payments ?? []).find((payment) => {
    const status = String(payment.status ?? "").toLowerCase();
    return validPaymentStatuses.has(status);
  })?.currency_code as string | undefined;

  const paymentCurrencyCode = paymentCurrency || "IDR";

  return {
    usaha_nama: usaha.nama as string,
    usaha_alamat: (usaha.alamat as string | null) ?? null,
    usaha_telepon: (usaha.nomor_telepon as string | null) ?? null,
    usaha_email: (usaha.email as string | null) ?? null,
    timezone: (usaha.timezone as string) || "Asia/Jakarta",
    penyewa_telepon: (penyewa?.nomor_telepon as string | null) ?? null,
    paymentCurrencyCode,
    recorded,
  };
}


/**
 * Builds the canonical receipt for a rental. A mixed checkout is resolved from
 * the rental relationship so the rental detail page and Walk-in output share
 * exactly the same snapshot and renderer.
 */
export async function getRentalReceiptData(
  usahaId: string,
  penyewaanId: string,
): Promise<RentalReceiptData> {
  const rental = await getRental(usahaId, penyewaanId);
  const [qr, support, checkoutResult, discountResult] = await Promise.all([
    getQrPenyewaanRecord(usahaId, penyewaanId),
    getRentalReceiptSupport(usahaId, penyewaanId, rental.penyewa_id),
    supabase
      .from("checkout")
      .select("checkout_id,nomor_checkout,source,penjualan_id,subtotal_rental,subtotal_penjualan,subtotal_penjualan_gross,discount_rental_amount,manual_discount_amount,loyalty_rental_discount_amount,discount_penjualan_amount,total_amount,amount_paid,payment_status,created_at")
      .eq("usaha_id", usahaId)
      .eq("penyewaan_id", penyewaanId)
      .eq("source", "mixed")
      .order("created_at", { ascending: false })
      .limit(2),
    supabase
      .from("penyewaan_diskon")
      .select("source,reason_code,actual_amount")
      .eq("usaha_id", usahaId)
      .eq("penyewaan_id", penyewaanId)
      .maybeSingle(),
  ]);

  if (!qr || qr.status_qr !== "aktif") {
    throw new Error("QR penyewaan untuk struk belum tersedia atau sudah dicabut.");
  }
  if (checkoutResult.error) throw checkoutResult.error;
  if (discountResult.error) throw discountResult.error;

  const checkouts = checkoutResult.data ?? [];
  if (checkouts.length > 1) {
    throw new Error("Lebih dari satu checkout campuran terhubung ke penyewaan ini. Periksa relasi transaksi sebelum mencetak struk.");
  }
  const checkout = checkouts[0] ?? null;

  const rentalLines: RentalQrLineData[] = rental.lines.map((line) => {
    const quantity = Number(line.jumlah);
    const unitPrice = Number(line.unit_price);
    const normalPrice = line.harga_normal_snapshot == null ? null : Number(line.harga_normal_snapshot);
    const packagePromo = Boolean(line.promosi_paket_id);
    const catalogPromo = Boolean(line.promosi_katalog_id);
    const periodCount = line.durasi_unit_snapshot && line.durasi_nilai_snapshot != null
      ? calculateTariffPeriods(rental.jadwal_mulai, rental.jadwal_kembali, {
          durasi_unit: line.durasi_unit_snapshot,
          durasi_nilai: Number(line.durasi_nilai_snapshot),
        })
      : null;
    const calculatedPackageDiscount = packagePromo && normalPrice != null && periodCount != null
      ? Math.max(0, Math.round((normalPrice - unitPrice) * quantity * periodCount * 100) / 100)
      : 0;
    const itemDiscount = packagePromo && calculatedPackageDiscount > 0
      ? calculatedPackageDiscount
      : Number(line.nominal_diskon_snapshot ?? 0);
    const discountPercent = Number(line.diskon_persen_snapshot ?? 0) > 0
      ? Number(line.diskon_persen_snapshot)
      : packagePromo && normalPrice != null && normalPrice > 0
        ? Math.round(((normalPrice - unitPrice) / normalPrice) * 10000) / 100
        : 0;

    return {
      nama: line.paket_nama ?? line.barang_nama ?? "Barang",
      rincian: line.varian_nama,
      jumlah: quantity,
      unit_price: unitPrice,
      subtotal: Number(line.subtotal),
      currency_code: line.currency_code,
      harga_normal_snapshot: normalPrice,
      diskon_persen_snapshot: discountPercent,
      nominal_diskon_snapshot: itemDiscount,
      promo_label: packagePromo ? "Promo paket" : catalogPromo ? "Promo katalog" : null,
      period_count: periodCount,
      period_description: line.durasi_unit_snapshot && line.durasi_nilai_snapshot != null
        ? `${Number(line.durasi_nilai_snapshot)} ${line.durasi_unit_snapshot}`
        : null,
    };
  });
  const rentalLinesSubtotal = rentalLines.reduce((sum, line) => sum + line.subtotal, 0);

  let saleLines: RentalQrLineData[] = [];
  let saleNumber: string | null = null;
  if (checkout) {
    const [saleResult, saleLinesResult] = await Promise.all([
      supabase
        .from("penjualan")
        .select("penjualan_id,nomor_penjualan,status")
        .eq("usaha_id", usahaId)
        .eq("penjualan_id", checkout.penjualan_id)
        .maybeSingle(),
      supabase
        .from("detail_penjualan")
        .select("nama_barang_snapshot,nama_varian_snapshot,jumlah,unit_price,subtotal,currency_code,harga_normal_snapshot,diskon_persen_snapshot,nominal_diskon_snapshot")
        .eq("usaha_id", usahaId)
        .eq("penjualan_id", checkout.penjualan_id)
        .order("created_at", { ascending: true }),
    ]);
    if (saleResult.error) throw saleResult.error;
    if (saleLinesResult.error) throw saleLinesResult.error;
    if (!saleResult.data) throw new Error("Penjualan yang terhubung ke checkout tidak ditemukan.");
    if (saleResult.data.status !== "completed") {
      throw new Error("Status penjualan terkait bukan transaksi selesai. Struk checkout tidak dapat dipastikan.");
    }
    saleNumber = saleResult.data.nomor_penjualan as string;
    saleLines = (saleLinesResult.data ?? []).map((line) => ({
      nama: line.nama_barang_snapshot,
      rincian: line.nama_varian_snapshot,
      jumlah: Number(line.jumlah),
      unit_price: Number(line.unit_price),
      subtotal: Number(line.subtotal),
      currency_code: line.currency_code || rental.currency_code,
      harga_normal_snapshot: line.harga_normal_snapshot == null ? null : Number(line.harga_normal_snapshot),
      diskon_persen_snapshot: line.diskon_persen_snapshot == null ? null : Number(line.diskon_persen_snapshot),
      nominal_diskon_snapshot: line.nominal_diskon_snapshot == null ? null : Number(line.nominal_diskon_snapshot),
      promo_label: Number(line.nominal_diskon_snapshot ?? 0) > 0 ? "Promo katalog" : null,
    }));
  }

  const paymentStatus = checkout
    ? String(checkout.payment_status)
    : support.recorded <= 0
      ? "unpaid"
      : support.recorded >= Number(rental.total_amount)
        ? "paid"
        : "partial";
  const totalAmount = Number(checkout?.total_amount ?? rental.total_amount);
  const amountPaid = Number(checkout?.amount_paid ?? support.recorded);
  const subtotalRental = Number(checkout?.subtotal_rental ?? rental.subtotal_amount ?? rentalLinesSubtotal);
  const subtotalSale = checkout
    ? Number(checkout.subtotal_penjualan_gross ?? checkout.subtotal_penjualan ?? saleLines.reduce((sum, line) => sum + line.subtotal, 0))
    : 0;

  const manualRentalDiscount = Number(checkout?.manual_discount_amount ?? 0);
  const loyaltyRentalDiscount = Number(checkout?.loyalty_rental_discount_amount ?? 0);
  const loyaltySaleDiscount = Number(checkout?.discount_penjualan_amount ?? 0);
  const checkoutRentalDiscount = Number(checkout?.discount_rental_amount ?? manualRentalDiscount + loyaltyRentalDiscount);
  const remainingRentalDiscount = Math.max(0, checkoutRentalDiscount - manualRentalDiscount - loyaltyRentalDiscount);
  const standaloneDiscount = Number(rental.discount_amount ?? 0);
  const standaloneDiscountSource = String(discountResult.data?.source ?? "");

  const discounts = checkout
    ? {
        manual_rental: manualRentalDiscount,
        loyalty_rental: loyaltyRentalDiscount,
        loyalty_sale: loyaltySaleDiscount,
        other_rental: remainingRentalDiscount,
        other_rental_label: remainingRentalDiscount > 0 ? "Diskon Rental" : null,
      }
    : {
        manual_rental: standaloneDiscountSource === "manual" ? standaloneDiscount : 0,
        loyalty_rental: standaloneDiscountSource === "loyalty" ? standaloneDiscount : 0,
        loyalty_sale: 0,
        other_rental: standaloneDiscountSource === "manual" || standaloneDiscountSource === "loyalty" ? 0 : standaloneDiscount,
        other_rental_label: standaloneDiscountSource === "combined"
          ? "Diskon Rental Gabungan"
          : standaloneDiscountSource === "manual" || standaloneDiscountSource === "loyalty"
            ? null
            : standaloneDiscount > 0 ? "Diskon Rental" : null,
      };

  const paymentLabel: NonNullable<RentalReceiptData["pembayaran"]>["status"] =
    paymentStatus === "paid" ? "lunas" : paymentStatus === "partial" ? "sebagian" : "belum_dibayar";

  return {
    usaha_nama: support.usaha_nama,
    usaha_alamat: support.usaha_alamat,
    usaha_telepon: support.usaha_telepon,
    usaha_email: support.usaha_email,
    timezone: support.timezone,
    nomor_penyewaan: rental.nomor_penyewaan,
    nomor_checkout: checkout?.nomor_checkout ?? null,
    nomor_penjualan: saleNumber,
    tanggal_transaksi: checkout?.created_at ?? rental.created_at,
    penyewa_nama: rental.penyewa_nama ?? "Penyewa tidak ditemukan",
    penyewa_telepon: support.penyewa_telepon,
    jadwal_mulai: rental.jadwal_mulai,
    jadwal_kembali: rental.jadwal_kembali,
    tolerance_deadline: rental.tolerance_deadline,
    actual_pickup_at: rental.actual_pickup_at,
    actual_return_completed_at: rental.actual_return_completed_at,
    subtotal_rental: subtotalRental,
    subtotal_penjualan: subtotalSale,
    total_amount: totalAmount,
    currency_code: rental.currency_code,
    token_qr: qr.token_qr,
    url: buildPenyewaanQrUrl(window.location.origin, qr.token_qr),
    generated_at: new Date().toISOString(),
    lines: rentalLines,
    sale_lines: saleLines,
    discounts,
    catatan: rental.catatan,
    pembayaran: {
      tercatat: amountPaid,
      sisa: Math.max(0, totalAmount - amountPaid),
      status: paymentLabel,
    },
  };
}
