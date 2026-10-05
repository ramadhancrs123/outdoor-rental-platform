import type { RecordPaymentInput } from "@/features/keuangan";

export type RentalPaymentWidgetContract = {
  source: "penyewaan";
  penyewaanId: string;
  allowedJenis: RecordPaymentInput["jenis"][];
  requiresFinanceAccount: true;
  doesNotActivateRental: true;
  amountIsFinancialFact: true;
};

export function getRentalPaymentWidgetContract(penyewaanId: string): RentalPaymentWidgetContract {
  if (!penyewaanId.trim()) throw new Error("Penyewaan wajib ditentukan.");
  return {
    source: "penyewaan",
    penyewaanId,
    allowedJenis: ["dp", "pelunasan", "pembayaran_tambahan"],
    requiresFinanceAccount: true,
    doesNotActivateRental: true,
    amountIsFinancialFact: true,
  };
}
