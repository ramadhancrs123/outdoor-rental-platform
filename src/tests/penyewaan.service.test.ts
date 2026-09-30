import { describe, expect, test, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
  },
}));

import {
  assignRentalUnit,
  completeRentalHandover,
  createDirectRental,
  createRentalFromReservation,
  previewDirectRentalAvailability,
  getRentalCapabilities,
  reconcileDirectRentalCreation,
  reconcileRentalAssignment,
  reconcileRentalCreation,
  reconcileRentalHandover,
} from "@/features/penyewaan/service";

describe("Penyewaan trusted command service", () => {
  test("capabilities expose phase-1 trusted mutation slice", () => {
    const capabilities = getRentalCapabilities();
    expect(capabilities.read).toBe(true);
    expect(capabilities.mutation).toBe(true);
    expect(capabilities.reason).toMatch(/trusted commands/i);
    expect(capabilities.commands).toContain("create_direct_rental");
  });

  test("create rental maps reservation conversion contract", async () => {
    rpcMock.mockResolvedValue({
      data: {
        penyewaan_id: "rental-1",
        reservasi_id: "reservation-1",
        nomor_penyewaan: "RNT-2026-001",
        status: "draft",
        total_amount: 250000,
        currency_code: "IDR",
      },
      error: null,
    });

    await expect(createRentalFromReservation("usaha-1", {
      reservasiId: "reservation-1",
      jadwalMulai: "2026-10-10T01:00:00.000Z",
      jadwalKembali: "2026-10-12T10:00:00.000Z",
    }, {
      idempotencyKey: "create-rental-test",
      requestId: "request-create-test",
    })).resolves.toMatchObject({
      penyewaan_id: "rental-1",
      status: "draft",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_create_rental_from_reservation", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_reservasi_id: "reservation-1",
      p_jadwal_mulai: "2026-10-10T01:00:00.000Z",
      p_jadwal_kembali: "2026-10-12T10:00:00.000Z",
      p_idempotency_key: "create-rental-test",
      p_request_id: "request-create-test",
    }));
  });

  test("create direct rental creates draft without bypassing trusted RPC", async () => {
    rpcMock.mockResolvedValue({
      data: {
        penyewaan_id: "rental-walkin-1",
        nomor_penyewaan: "RNT-2026-010",
        status: "draft",
        total_amount: 150000,
        currency_code: "IDR",
      },
      error: null,
    });

    await expect(createDirectRental("usaha-1", {
      penyewa_id: "renter-1",
      jadwal_mulai: "2026-10-10T01:00:00.000Z",
      jadwal_kembali: "2026-10-11T01:00:00.000Z",
      lines: [{
        barang_id: "barang-1",
        jumlah: 2,
        unit_price: 75000,
        currency_code: "IDR",
      }],
      catatan: "walk-in",
    }, {
      idempotencyKey: "walkin-create-test",
      requestId: "request-walkin-test",
    })).resolves.toMatchObject({
      penyewaan_id: "rental-walkin-1",
      status: "draft",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_create_direct_rental", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_penyewa_id: "renter-1",
      p_jadwal_mulai: "2026-10-10T01:00:00.000Z",
      p_jadwal_kembali: "2026-10-11T01:00:00.000Z",
      p_lines: [{
        barang_id: "barang-1",
        varian_barang_id: null,
        paket_sewa_id: null,
        jumlah: 2,
        unit_price: 75000,
        currency_code: "IDR",
        subtotal: 150000,
        catatan: null,
      }],
      p_idempotency_key: "walkin-create-test",
      p_request_id: "request-walkin-test",
    }));
  });

  test("availability preview only claims current physical readiness", async () => {
    fromMock.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ count: 2, error: null })),
          })),
        })),
      })),
    });

    await expect(previewDirectRentalAvailability("usaha-1", {
      barangId: "barang-1",
      requestedUnits: 2,
    })).resolves.toEqual({
      readyPhysicalUnits: 2,
      requestedUnits: 2,
      physicalCheck: "pass",
    });
  });

  test("assignment and handover commands use separate trusted boundaries", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: {
          penetapan_unit_id: "assignment-1",
          penyewaan_id: "rental-1",
          detail_penyewaan_id: "detail-1",
          unit_barang_id: "unit-1",
          status: "assigned",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          serah_terima_id: "handover-1",
          penyewaan_id: "rental-1",
          status: "active",
          actual_pickup_at: "2026-10-10T01:30:00.000Z",
        },
        error: null,
      });

    await assignRentalUnit("usaha-1", {
      penyewaanId: "rental-1",
      detailPenyewaanId: "detail-1",
      unitBarangId: "unit-1",
    }, {
      idempotencyKey: "assign-test",
      requestId: "request-assign-test",
    });

    await completeRentalHandover("usaha-1", {
      penyewaanId: "rental-1",
      serahTerimaAt: "2026-10-10T01:30:00.000Z",
      catatan: "pickup",
    }, {
      idempotencyKey: "pickup-test",
      requestId: "request-pickup-test",
    });

    expect(rpcMock).toHaveBeenNthCalledWith(1, "command_assign_rental_unit_checked", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_penyewaan_id: "rental-1",
      p_detail_penyewaan_id: "detail-1",
      p_unit_barang_id: "unit-1",
      p_idempotency_key: "assign-test",
      p_request_id: "request-assign-test",
    }));
    expect(rpcMock).toHaveBeenNthCalledWith(2, "command_complete_rental_handover", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_penyewaan_id: "rental-1",
      p_serah_terima_at: "2026-10-10T01:30:00.000Z",
      p_catatan: "pickup",
      p_idempotency_key: "pickup-test",
      p_request_id: "request-pickup-test",
    }));
  });

  test("reconciliation functions preserve committed/unknown state", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: { state: "committed", response: { status: "draft" } }, error: null })
      .mockResolvedValueOnce({ data: { state: "committed", response: { status: "assigned" } }, error: null })
      .mockResolvedValueOnce({ data: { state: "unknown", response: null }, error: null })
      .mockResolvedValueOnce({ data: { state: "not_found", response: null }, error: null });

    await expect(reconcileRentalCreation("usaha-1", "create-key")).resolves.toEqual({
      state: "committed",
      response: { status: "draft" },
    });
    await expect(reconcileRentalAssignment("usaha-1", "assign-key")).resolves.toEqual({
      state: "committed",
      response: { status: "assigned" },
    });
    await expect(reconcileRentalHandover("usaha-1", "pickup-key")).resolves.toEqual({
      state: "unknown",
      response: null,
    });
    await expect(reconcileDirectRentalCreation("usaha-1", "walkin-key")).resolves.toEqual({
      state: "not_found",
      response: null,
    });

    expect(rpcMock).toHaveBeenNthCalledWith(1, "command_reconcile_rental_creation", {
      p_usaha_id: "usaha-1",
      p_idempotency_key: "create-key",
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "command_reconcile_rental_assignment", {
      p_usaha_id: "usaha-1",
      p_idempotency_key: "assign-key",
    });
    expect(rpcMock).toHaveBeenNthCalledWith(3, "command_reconcile_rental_handover", {
      p_usaha_id: "usaha-1",
      p_idempotency_key: "pickup-key",
    });
    expect(rpcMock).toHaveBeenNthCalledWith(4, "command_reconcile_direct_rental_creation", {
      p_usaha_id: "usaha-1",
      p_idempotency_key: "walkin-key",
    });
  });

  test("command errors are surfaced without silent retry", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: new Error("timeout"),
    });

    await expect(createRentalFromReservation("usaha-1", {
      reservasiId: "reservation-1",
      jadwalMulai: "2026-10-10T01:00:00.000Z",
      jadwalKembali: "2026-10-12T10:00:00.000Z",
    })).rejects.toThrow(/Pembuatan penyewaan: timeout/i);

    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
