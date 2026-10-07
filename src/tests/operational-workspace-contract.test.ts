import { describe, expect, it } from "vitest";
import { getOperationalRentalActivationContract, getRentalPaymentWidgetContract } from "@/features/penyewaan";
import { getOperationalReturnContract } from "@/features/pengembalian";
import { buildApprovedConsequencePaymentInput } from "@/features/keuangan";

describe("operational workspace contracts", () => {
  it("keeps rental activation domain boundaries explicit", () => {
    const contract = getOperationalRentalActivationContract(
      { usahaId: "usaha-1" } as never,
      { penyewaan_id: "rental-1" } as never,
    );

    expect(contract.domainSequence).toEqual(["assignment", "handover", "active"]);
    expect(contract.serverAuthority).toBe(true);
    expect(contract.autoAssignmentDefault).toBe(true);
    expect(contract.paymentDoesNotActivateRental).toBe(true);
    expect(contract.toleranceDoesNotExtendSchedule).toBe(true);
    expect(contract.lateFeeDoesNotCreatePaymentAutomatically).toBe(true);
  });

  it("keeps payment widget tied to rental without coupling payment to activation", () => {
    const contract = getRentalPaymentWidgetContract("rental-1");

    expect(contract.source).toBe("penyewaan");
    expect(contract.allowedJenis).toEqual(["dp", "pelunasan", "pembayaran_tambahan"]);
    expect(contract.requiresFinanceAccount).toBe(true);
    expect(contract.doesNotActivateRental).toBe(true);
    expect(contract.amountIsFinancialFact).toBe(true);
  });

  it("keeps return orchestration per-unit and partial-return safe", () => {
    const contract = getOperationalReturnContract();

    expect(contract.domainSequence).toEqual(["return", "inspection", "maintenance_if_required", "readiness"]);
    expect(contract.returnIsNotReady).toBe(true);
    expect(contract.inspectionIsNotReady).toBe(true);
    expect(contract.partialReturnAllowed).toBe(true);
    expect(contract.perUnitMutation).toBe(true);
    expect(contract.batchMutationIsSequentialNotAtomic).toBe(true);
  });

  it("maps approved consequence into Finance additional-payment semantics", () => {
    const payment = buildApprovedConsequencePaymentInput(
      {
        evaluasi_konsekuensi_id: "eval-1", usaha_id: "usaha-1", penyewaan_id: "rental-1",
        penyewa_id: "renter-1", unit_barang_id: null, sumber_type: "penyewaan", sumber_id: "rental-1",
        jenis_konsekuensi: "late_fee", pihak_tanggung_jawab: "penyewa", nominal_kandidat: 100000,
        nominal_disetujui: 75000, currency_code: "IDR", status: "approved",
        alasan: "Late fee after tolerance.", catatan_review: null, reviewed_by_admin_id: "admin-1",
        reviewed_at: "2026-10-05T10:00:00Z", created_at: "2026-10-05T09:00:00Z", updated_at: "2026-10-05T10:00:00Z",
      },
      { evaluasiKonsekuensiId: "eval-1", akunKeuanganId: "account-1", metode: "cash" },
    );

    expect(payment.penyewaanId).toBe("rental-1");
    expect(payment.akunKeuanganId).toBe("account-1");
    expect(payment.jenis).toBe("pembayaran_tambahan");
    expect(payment.amount).toBe(75000);
  });

  it("rejects consequence payment above approved amount", () => {
    expect(() =>
      buildApprovedConsequencePaymentInput(
        {
          evaluasi_konsekuensi_id: "eval-1", usaha_id: "usaha-1", penyewaan_id: "rental-1",
          penyewa_id: "renter-1", unit_barang_id: null, sumber_type: "penyewaan", sumber_id: "rental-1",
          jenis_konsekuensi: "late_fee", pihak_tanggung_jawab: "penyewa", nominal_kandidat: 100000,
          nominal_disetujui: 75000, currency_code: "IDR", status: "approved",
          alasan: "Late fee after tolerance.", catatan_review: null, reviewed_by_admin_id: "admin-1",
          reviewed_at: "2026-10-05T10:00:00Z", created_at: "2026-10-05T09:00:00Z", updated_at: "2026-10-05T10:00:00Z",
        },
        { evaluasiKonsekuensiId: "eval-1", akunKeuanganId: "account-1", metode: "cash", amount: 80000 },
      ),
    ).toThrow("tidak boleh melebihi");
  });
});