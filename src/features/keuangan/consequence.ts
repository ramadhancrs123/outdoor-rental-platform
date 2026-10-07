import { supabase } from "@/app/providers/supabase/client";
import { createClientId } from "@/lib/client-id";
import { recordPayment, listFinanceAccounts } from "./service";
import type {
  FinanceAccount,
  FinanceCommandOptions,
  FinanceCommandResult,
  FinanceReconciliationResult,
  RecordPaymentInput,
  RentalConsequenceReview,
} from "./types";

export type RentalConsequenceReviewInput = {
  evaluasiKonsekuensiId: string;
  decision: "approve" | "reject";
  nominalDisetujui?: number | null;
  catatanReview?: string | null;
};

export type ApprovedConsequencePaymentInput = {
  evaluasiKonsekuensiId: string;
  akunKeuanganId: string;
  metode: RecordPaymentInput["metode"];
  amount?: number;
  dibayarAt?: string | null;
  referenceText?: string | null;
  catatan?: string | null;
};

export async function getRentalConsequenceReview(
  usahaId: string,
  evaluasiKonsekuensiId: string,
): Promise<RentalConsequenceReview | null> {
  const { data, error } = await supabase
    .from("evaluasi_konsekuensi_penyewaan")
    .select(
      "evaluasi_konsekuensi_id,usaha_id,penyewaan_id,penyewa_id,unit_barang_id,sumber_type,sumber_id,jenis_konsekuensi,pihak_tanggung_jawab,nominal_kandidat,nominal_disetujui,currency_code,status,alasan,catatan_review,reviewed_by_admin_id,reviewed_at,created_at,updated_at",
    )
    .eq("usaha_id", usahaId)
    .eq("evaluasi_konsekuensi_id", evaluasiKonsekuensiId)
    .maybeSingle();
  if (error) throw error;
  return (data as RentalConsequenceReview | null) ?? null;
}

export async function reviewRentalConsequence(
  usahaId: string,
  input: RentalConsequenceReviewInput,
  options: FinanceCommandOptions = {},
) {
  if (input.decision === "approve") {
    if (input.nominalDisetujui == null || !Number.isFinite(input.nominalDisetujui) || input.nominalDisetujui < 0) {
      throw new Error("Nominal disetujui wajib diisi saat konsekuensi disetujui.");
    }
  }

  const { data, error } = await supabase.rpc("command_review_rental_consequence", {
    p_usaha_id: usahaId,
    p_evaluasi_konsekuensi_id: input.evaluasiKonsekuensiId,
    p_decision: input.decision,
    p_nominal_disetujui: input.decision === "approve" ? input.nominalDisetujui : null,
    p_catatan_review: input.catatanReview?.trim() || null,
    p_idempotency_key: options.idempotencyKey ?? `review-rental-consequence-${input.evaluasiKonsekuensiId}-${createClientId()}`,
    p_request_id: options.requestId ?? createClientId(),
  });
  if (!error && data) return data as {
    evaluasi_konsekuensi_id: string;
    decision: "approve" | "reject";
    status: "approved" | "rejected";
    nominal_disetujui: number | null;
  };
  throw error ?? new Error("Review konsekuensi gagal: server tidak mengembalikan hasil.");
}

export function buildApprovedConsequencePaymentInput(
  review: RentalConsequenceReview,
  input: ApprovedConsequencePaymentInput,
): RecordPaymentInput {
  if (review.status !== "approved") throw new Error("Konsekuensi belum disetujui Finance.");
  if (!review.penyewaan_id) throw new Error("Konsekuensi tidak memiliki penyewaan.");

  const amount = input.amount ?? Number(review.nominal_disetujui ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Nominal pemasukan harus lebih dari 0.");
  if (review.nominal_disetujui != null && amount > Number(review.nominal_disetujui)) {
    throw new Error("Nominal pembayaran tidak boleh melebihi nominal yang disetujui Finance.");
  }

  return {
    penyewaanId: review.penyewaan_id,
    akunKeuanganId: input.akunKeuanganId,
    jenis: "pembayaran_tambahan",
    metode: input.metode,
    amount,
    dibayarAt: input.dibayarAt,
    referenceText: input.referenceText ?? `Konsekuensi rental ${review.evaluasi_konsekuensi_id}`,
    catatan: input.catatan ?? `Pemasukan dari ${review.jenis_konsekuensi} rental setelah review Finance.`,
  };
}

export async function recordApprovedConsequencePayment(
  usahaId: string,
  input: ApprovedConsequencePaymentInput,
  options: FinanceCommandOptions = {},
): Promise<FinanceCommandResult> {
  const review = await getRentalConsequenceReview(usahaId, input.evaluasiKonsekuensiId);
  if (!review) throw new Error("Evaluasi konsekuensi tidak ditemukan.");

  return recordPayment(usahaId, buildApprovedConsequencePaymentInput(review, input), options);
}

export async function listAccountsForConsequencePayment(usahaId: string): Promise<FinanceAccount[]> {
  return listFinanceAccounts(usahaId);
}

export async function reconcileConsequencePayment(
  usahaId: string,
  idempotencyKey: string,
): Promise<FinanceReconciliationResult> {
  const { data, error } = await supabase.rpc("reconcile_finance_command", {
    p_usaha_id: usahaId,
    p_idempotency_key: idempotencyKey,
    p_command_name: "record_payment_with_account",
  });
  if (error) throw error;
  return (data ?? { state: "not_found", response: null }) as FinanceReconciliationResult;
}
