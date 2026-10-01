import { beforeEach, describe, expect, test, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
    auth: { getUser: vi.fn() },
  },
}));

import {
  completeMaintenance,
  verifyMaintenanceReadiness,
  createMaintenance,
  getMaintenanceCapabilities,
  reconcileMaintenanceCommand,
  startMaintenance,
} from "@/features/perawatan";

describe("Perawatan trusted command service", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  test("capabilities expose trusted maintenance commands", () => {
    const capabilities = getMaintenanceCapabilities();
    expect(capabilities.mutation).toBe(true);
    expect(capabilities.commands).toEqual(expect.arrayContaining([
      "create_maintenance",
      "start_maintenance",
      "complete_maintenance",
      "command_reconcile_maintenance_mutation",
    ]));
  });

  test("create maintenance maps trace, cost, and idempotency inputs", async () => {
    rpcMock.mockResolvedValue({
      data: {
        perawatan_id: "maintenance-1",
        status: "planned",
        pemeriksaan_id: "inspection-1",
        biaya: 50000,
        currency_code: "IDR",
      },
      error: null,
    });

    await expect(createMaintenance(
      "usaha-1",
      {
        unitBarangId: "unit-1",
        pemeriksaanId: "inspection-1",
        jenisPerawatan: "repair",
        deskripsiPekerjaan: "  Ganti resleting dan uji buka-tutup.  ",
        pelaksana: "  Teknisi  ",
        biaya: 50000,
        currencyCode: "idr",
        catatan: "  trace finding  ",
      },
      "create-key",
    )).resolves.toMatchObject({ perawatan_id: "maintenance-1", status: "planned" });

    expect(rpcMock).toHaveBeenCalledWith("command_create_maintenance", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_unit_barang_id: "unit-1",
      p_pemeriksaan_id: "inspection-1",
      p_jenis_perawatan: "repair",
      p_deskripsi_pekerjaan: "Ganti resleting dan uji buka-tutup.",
      p_pelaksana: "Teknisi",
      p_biaya: 50000,
      p_currency_code: "IDR",
      p_catatan: "trace finding",
      p_idempotency_key: "create-key",
    }));
  });

  test("manual maintenance without inspection source requires a reason", async () => {
    await expect(createMaintenance("usaha-1", {
      unitBarangId: "unit-1",
      pemeriksaanId: null,
      jenisPerawatan: "cleaning",
      deskripsiPekerjaan: "Pembersihan rutin",
      catatan: "   ",
    })).rejects.toThrow(/Perawatan tanpa mengacu pada Pemeriksaan wajib memiliki alasan/);

    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("manual maintenance with reason preserves a null inspection source", async () => {
    rpcMock.mockResolvedValue({
      data: {
        perawatan_id: "maintenance-manual-1",
        status: "planned",
        pemeriksaan_id: null,
      },
      error: null,
    });

    await expect(createMaintenance(
      "usaha-1",
      {
        unitBarangId: "unit-1",
        pemeriksaanId: null,
        jenisPerawatan: "cleaning",
        deskripsiPekerjaan: "Pembersihan rutin",
        catatan: "Perawatan manual terjadwal sesuai checklist operasional.",
      },
      "manual-key",
    )).resolves.toMatchObject({
      perawatan_id: "maintenance-manual-1",
      status: "planned",
      pemeriksaan_id: null,
    });

    expect(rpcMock).toHaveBeenCalledWith("command_create_maintenance", expect.objectContaining({
      p_pemeriksaan_id: null,
      p_catatan: "Perawatan manual terjadwal sesuai checklist operasional.",
      p_idempotency_key: "manual-key",
    }));
  });

  test("start maintenance preserves optimistic-lock timestamps", async () => {
    rpcMock.mockResolvedValue({
      data: { perawatan_id: "maintenance-1", status: "in_progress" },
      error: null,
    });

    await expect(startMaintenance(
      "usaha-1",
      "maintenance-1",
      "2026-09-28T10:00:00Z",
      "2026-09-28T09:59:00Z",
      "start-key",
    )).resolves.toMatchObject({ status: "in_progress" });

    expect(rpcMock).toHaveBeenCalledWith("command_start_maintenance", expect.objectContaining({
      p_perawatan_id: "maintenance-1",
      p_expected_updated_at: "2026-09-28T10:00:00Z",
      p_expected_unit_updated_at: "2026-09-28T09:59:00Z",
      p_idempotency_key: "start-key",
    }));
  });

  test("complete maintenance maps actual cost without payment semantics", async () => {
    rpcMock.mockResolvedValue({
      data: {
        perawatan_id: "maintenance-1",
        status: "completed",
        biaya: 75000,
        currency_code: "IDR",
        verification_required: true,
      },
      error: null,
    });

    await expect(completeMaintenance(
      "usaha-1",
      {
        perawatanId: "maintenance-1",
        pelaksana: "Teknisi",
        biaya: 75000,
        currencyCode: "IDR",
        catatan: "Pekerjaan selesai dan diuji.",
      },
      "maintenance-time",
      "unit-time",
      "complete-key",
    )).resolves.toMatchObject({
      status: "completed",
      biaya: 75000,
      verification_required: true,
    });

    expect(rpcMock).toHaveBeenCalledWith("command_complete_maintenance", expect.objectContaining({
      p_perawatan_id: "maintenance-1",
      p_biaya: 75000,
      p_currency_code: "IDR",
      p_idempotency_key: "complete-key",
      p_expected_updated_at: "maintenance-time",
      p_expected_unit_updated_at: "unit-time",
    }));
  });

  test("verification maps pass/fail and optimistic-lock inputs", async () => {
    rpcMock.mockResolvedValue({
      data: {
        perawatan_id: "maintenance-1",
        unit_barang_id: "unit-1",
        verification_result: "passed",
        unit_status: "ready",
      },
      error: null,
    });

    await expect(verifyMaintenanceReadiness(
      "usaha-1",
      {
        perawatanId: "maintenance-1",
        verificationResult: "passed",
        catatan: "Sudah diuji dan layak.",
      },
      "maintenance-time",
      "unit-time",
      "verify-key",
    )).resolves.toMatchObject({
      verification_result: "passed",
      unit_status: "ready",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_verify_maintenance_readiness", expect.objectContaining({
      p_perawatan_id: "maintenance-1",
      p_verification_result: "passed",
      p_catatan: "Sudah diuji dan layak.",
      p_expected_maintenance_updated_at: "maintenance-time",
      p_expected_unit_updated_at: "unit-time",
      p_idempotency_key: "verify-key",
    }));
  });

  test("verification unknown outcome reconciles without blind retry", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("timeout") })
      .mockResolvedValueOnce({
        data: { state: "unknown", command_name: "verify_maintenance_readiness", response: null },
        error: null,
      });

    await expect(verifyMaintenanceReadiness(
      "usaha-1",
      { perawatanId: "maintenance-1", verificationResult: "passed" },
      "maintenance-time",
      "unit-time",
      "verify-unknown-key",
    )).rejects.toThrow(/UNKNOWN_OUTCOME/);

    expect(rpcMock).toHaveBeenNthCalledWith(1, "command_verify_maintenance_readiness", expect.objectContaining({
      p_idempotency_key: "verify-unknown-key",
    }));
    expect(rpcMock).toHaveBeenNthCalledWith(2, "command_reconcile_maintenance_mutation", {
      p_usaha_id: "usaha-1",
      p_command_name: "verify_maintenance_readiness",
      p_idempotency_key: "verify-unknown-key",
    });
  });

  test("unknown outcome reconciles once and never blind-retries mutation", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("network timeout") })
      .mockResolvedValueOnce({
        data: { state: "unknown", command_name: "complete_maintenance", response: null },
        error: null,
      });

    await expect(completeMaintenance(
      "usaha-1",
      {
        perawatanId: "maintenance-1",
        biaya: 50000,
        currencyCode: "IDR",
      },
      "maintenance-time",
      "unit-time",
      "unknown-key",
    )).rejects.toThrow(/UNKNOWN_OUTCOME/);

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock).toHaveBeenNthCalledWith(1, "command_complete_maintenance", expect.objectContaining({
      p_idempotency_key: "unknown-key",
    }));
    expect(rpcMock).toHaveBeenNthCalledWith(2, "command_reconcile_maintenance_mutation", {
      p_usaha_id: "usaha-1",
      p_command_name: "complete_maintenance",
      p_idempotency_key: "unknown-key",
    });
  });

  test("reconciliation preserves committed response", async () => {
    rpcMock.mockResolvedValue({
      data: {
        state: "committed",
        command_name: "create_maintenance",
        response: { perawatan_id: "maintenance-1", status: "planned" },
      },
      error: null,
    });

    await expect(reconcileMaintenanceCommand("usaha-1", "create_maintenance", "create-key"))
      .resolves.toEqual({
        state: "committed",
        command_name: "create_maintenance",
        response: { perawatan_id: "maintenance-1", status: "planned" },
      });
  });

  test("mutation payload rejects missing business fields before RPC", async () => {
    await expect(createMaintenance("usaha-1", {
      unitBarangId: "",
      pemeriksaanId: null,
      jenisPerawatan: "repair",
      deskripsiPekerjaan: "Repair",
    })).rejects.toThrow(/Unit wajib/);

    expect(rpcMock).not.toHaveBeenCalled();
  });
});
