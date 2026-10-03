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
