import { supabase } from "@/app/providers/supabase/client";
import type { QrPenyewaanRecord, QrUnitRecord } from "./types";

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
