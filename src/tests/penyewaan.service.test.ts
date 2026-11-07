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
  createDirectRentalAndActivate,
  createDirectRentalWithDiscount,
  createRentalFromReservation,
  createRentalFromReservationWithDiscount,
  getBlockedAssignableUnitIds,
  previewDirectRentalAvailability,
  getRentalCapabilities,
  reconcileDirectRentalActivation,
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
    expect(capabilities.reason).toMatch(/Penyewaan mendukung pembuatan langsung/i);
    expect(capabilities.commands).toContain("create_direct_rental");
    expect(capabilities.commands).toContain("create_and_activate_direct_rental");
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
        tarif_sewa_id: "tariff-1",
        duration_periods: 2,
        jumlah: 2,
        unit_price: 75000,
        subtotal: 300000,
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
        subtotal: 300000,
        tarif_sewa_id: "tariff-1",
        duration_periods: 2,
        catatan: null,
      }],
      p_idempotency_key: "walkin-create-test",
      p_request_id: "request-walkin-test",
    }));
  });

  test("direct rental action uses one atomic create-and-activate RPC", async () => {
    rpcMock.mockResolvedValue({
      data: {
        penyewaan_id: "rental-active-1",
        nomor_penyewaan: "RNT-2026-020",
        status: "active",
        actual_pickup_at: "2026-11-02T01:00:00.000Z",
        total_amount: 90000,
        currency_code: "IDR",
      },
      error: null,
    });

    await expect(createDirectRentalAndActivate("usaha-1", {
      penyewa_id: "renter-1",
      jadwal_mulai: "2026-11-02T01:00:00.000Z",
      jadwal_kembali: "2026-11-03T01:00:00.000Z",
      lines: [{
        barang_id: "barang-1",
        tarif_sewa_id: "tariff-1",
        duration_periods: 1,
        jumlah: 1,
        unit_price: 90000,
        subtotal: 90000,
        currency_code: "IDR",
      }],
      catatan: "walk-in langsung",
    }, {
      idempotencyKey: "walkin-atomic-test",
      requestId: "request-atomic-test",
    })).resolves.toMatchObject({
      penyewaan_id: "rental-active-1",
      status: "active",
      actual_pickup_at: "2026-11-02T01:00:00.000Z",
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("command_create_and_activate_direct_rental", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_penyewa_id: "renter-1",
      p_jadwal_mulai: "2026-11-02T01:00:00.000Z",
      p_jadwal_kembali: "2026-11-03T01:00:00.000Z",
      p_lines: [expect.objectContaining({
        barang_id: "barang-1",
        varian_barang_id: null,
        jumlah: 1,
        unit_price: 90000,
        subtotal: 90000,
      })],
      p_idempotency_key: "walkin-atomic-test",
      p_request_id: "request-atomic-test",
    }));
  });


  test("direct rental discount uses the phase-3 atomic discount command", async () => {
    rpcMock.mockResolvedValue({
      data: {
        penyewaan_id: "rental-discount-1",
        nomor_penyewaan: "RNT-2026-030",
        status: "draft",
        total_amount: 90000,
        discount_amount: 10000,
        currency_code: "IDR",
      },
      error: null,
    });

    await expect(createDirectRentalWithDiscount("usaha-1", {
      penyewa_id: "renter-1",
      jadwal_mulai: "2026-11-06T02:00:00.000Z",
      jadwal_kembali: "2026-11-07T02:00:00.000Z",
      lines: [{
        barang_id: "barang-1",
        tarif_sewa_id: "tariff-1",
        duration_periods: 1,
        jumlah: 1,
        unit_price: 100000,
        subtotal: 100000,
        currency_code: "IDR",
      }],
      catatan: "walk-in diskon",
    }, { mode: "loyalty" }, {
      idempotencyKey: "walkin-discount-key",
      requestId: "walkin-discount-request",
    })).resolves.toMatchObject({
      penyewaan_id: "rental-discount-1",
      total_amount: 90000,
      discount_amount: 10000,
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("command_create_direct_rental_with_discount", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_penyewa_id: "renter-1",
      p_discount_request: { mode: "loyalty" },
      p_idempotency_key: "walkin-discount-key",
      p_request_id: "walkin-discount-request",
      p_lines: [expect.objectContaining({
        barang_id: "barang-1",
        varian_barang_id: null,
        subtotal: 100000,
      })],
    }));
  });

  test("reservation conversion with manual discount preserves the reservation RPC contract", async () => {
    rpcMock.mockResolvedValue({
      data: {
        penyewaan_id: "rental-reservation-discount-1",
        reservasi_id: "reservation-1",
        status: "draft",
        total_amount: 85000,
        discount_amount: 15000,
      },
      error: null,
    });

    await createRentalFromReservationWithDiscount("usaha-1", {
      reservasiId: "reservation-1",
      jadwalMulai: "2026-11-06T02:00:00.000Z",
      jadwalKembali: "2026-11-07T02:00:00.000Z",
    }, {
      mode: "manual",
      amount: 15000,
      reason_code: "service_recovery",
      reason_note: "Kompensasi layanan",
    }, {
      idempotencyKey: "reservation-discount-key",
      requestId: "reservation-discount-request",
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("command_create_rental_from_reservation_with_discount", {
      p_usaha_id: "usaha-1",
      p_reservasi_id: "reservation-1",
      p_jadwal_mulai: "2026-11-06T02:00:00.000Z",
      p_jadwal_kembali: "2026-11-07T02:00:00.000Z",
      p_discount_request: {
        mode: "manual",
        amount: 15000,
        reason_code: "service_recovery",
        reason_note: "Kompensasi layanan",
      },
      p_idempotency_key: "reservation-discount-key",
      p_request_id: "reservation-discount-request",
    });
  });

  test("reservation conversion can atomically create, discount, and activate", async () => {
    rpcMock.mockResolvedValue({
      data: {
        penyewaan_id: "rental-reservation-active-1",
        status: "active",
        rental_activation: { status: "active" },
      },
      error: null,
    });

    await createRentalFromReservationWithDiscount("usaha-1", {
      reservasiId: "reservation-2",
      jadwalMulai: "2026-11-06T02:00:00.000Z",
      jadwalKembali: "2026-11-07T02:00:00.000Z",
    }, { mode: "none" }, {
      idempotencyKey: "reservation-active-discount-key",
      requestId: "reservation-active-discount-request",
    }, true);

    expect(rpcMock).toHaveBeenCalledWith("command_create_reservation_rental_activate_discount", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_reservasi_id: "reservation-2",
      p_catatan: "Aktivasi langsung dari konversi reservasi.",
      p_discount_request: { mode: "none" },
      p_idempotency_key: "reservation-active-discount-key",
    }));
  });

  test("candidate filtering excludes units assigned to this rental and physically occupied rentals", () => {
    const blocked = getBlockedAssignableUnitIds(
      [
        { unit_barang_id: "already-current", detail_penyewaan_id: "detail-current" },
        { unit_barang_id: "active-other", detail_penyewaan_id: "detail-active" },
        { unit_barang_id: "overlap-draft", detail_penyewaan_id: "detail-draft" },
        { unit_barang_id: "future-draft", detail_penyewaan_id: "detail-future" },
        { unit_barang_id: "completed-old", detail_penyewaan_id: "detail-completed" },
      ],
      ["detail-current", "detail-current-other"],
      [
        { detail_penyewaan_id: "detail-active", penyewaan_id: "rental-active" },
        { detail_penyewaan_id: "detail-draft", penyewaan_id: "rental-draft" },
        { detail_penyewaan_id: "detail-future", penyewaan_id: "rental-future" },
        { detail_penyewaan_id: "detail-completed", penyewaan_id: "rental-completed" },
      ],
      [
        { penyewaan_id: "rental-active", status: "active", jadwal_mulai: "2026-01-01T00:00:00Z", jadwal_kembali: "2026-01-02T00:00:00Z" },
        { penyewaan_id: "rental-draft", status: "draft", jadwal_mulai: "2026-11-02T12:00:00Z", jadwal_kembali: "2026-11-03T12:00:00Z" },
        { penyewaan_id: "rental-future", status: "draft", jadwal_mulai: "2026-11-04T12:00:00Z", jadwal_kembali: "2026-11-05T12:00:00Z" },
        { penyewaan_id: "rental-completed", status: "completed", jadwal_mulai: "2026-11-02T12:00:00Z", jadwal_kembali: "2026-11-03T12:00:00Z" },
      ],
      { jadwal_mulai: "2026-11-02T10:00:00Z", jadwal_kembali: "2026-11-03T10:00:00Z" },
    );

    expect([...blocked].sort()).toEqual(["active-other", "already-current", "overlap-draft"].sort());
  });

  test("create direct rental sends exactly one catalog target for a variant", async () => {
    rpcMock.mockResolvedValue({
      data: {
        penyewaan_id: "rental-variant-1",
        nomor_penyewaan: "RNT-2026-011",
        status: "draft",
        total_amount: 40000,
        currency_code: "IDR",
      },
      error: null,
    });

    await createDirectRental("usaha-1", {
      penyewa_id: "renter-1",
      jadwal_mulai: "2026-10-10T01:00:00.000Z",
      jadwal_kembali: "2026-10-11T01:00:00.000Z",
      lines: [{
        barang_id: "barang-eiger-40l",
        varian_barang_id: "variant-eiger-cream",
        tarif_sewa_id: "tariff-eiger-cream",
        duration_periods: 1,
        jumlah: 1,
        unit_price: 40000,
        subtotal: 40000,
        currency_code: "IDR",
      }],
    }, {
      idempotencyKey: "walkin-variant-create-test",
      requestId: "request-walkin-variant-test",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_create_direct_rental", expect.objectContaining({
      p_lines: [{
        barang_id: null,
        varian_barang_id: "variant-eiger-cream",
        paket_sewa_id: null,
        jumlah: 1,
        unit_price: 40000,
        currency_code: "IDR",
        subtotal: 40000,
        tarif_sewa_id: "tariff-eiger-cream",
        duration_periods: 1,
        catatan: null,
      }],
    }));
  });

  test("create direct rental preserves distinct base and variant targets in one transaction", async () => {
    rpcMock.mockResolvedValue({
      data: {
        penyewaan_id: "rental-mixed-1",
        nomor_penyewaan: "RNT-2026-012",
        status: "draft",
        total_amount: 125000,
        currency_code: "IDR",
      },
      error: null,
    });

    await createDirectRental("usaha-1", {
      penyewa_id: "renter-1",
      jadwal_mulai: "2026-10-10T01:00:00.000Z",
      jadwal_kembali: "2026-10-11T01:00:00.000Z",
      lines: [
        {
          barang_id: "barang-tenda-4p",
          varian_barang_id: null,
          tarif_sewa_id: "tariff-tenda-base",
          duration_periods: 1,
          jumlah: 1,
          unit_price: 60000,
          subtotal: 60000,
          currency_code: "IDR",
        },
        {
          barang_id: "barang-tenda-4p",
          varian_barang_id: "variant-tenda-cream",
          tarif_sewa_id: "tariff-tenda-cream",
          duration_periods: 1,
          jumlah: 1,
          unit_price: 65000,
          subtotal: 65000,
          currency_code: "IDR",
        },
      ],
    }, {
      idempotencyKey: "walkin-mixed-create-test",
      requestId: "request-walkin-mixed-test",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_create_direct_rental", expect.objectContaining({
      p_lines: [
        expect.objectContaining({
          barang_id: "barang-tenda-4p",
          varian_barang_id: null,
          tarif_sewa_id: "tariff-tenda-base",
          jumlah: 1,
        }),
        expect.objectContaining({
          barang_id: null,
          varian_barang_id: "variant-tenda-cream",
          tarif_sewa_id: "tariff-tenda-cream",
          jumlah: 1,
        }),
      ],
    }));
  });

  test("availability preview counts only server-eligible units in the requested rental period", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { unit_barang_id: "unit-ready-1", status: "ready", eligibility: true, conflict: false },
        { unit_barang_id: "unit-ready-2", status: "ready", eligibility: false, conflict: true },
        { unit_barang_id: "unit-ready-3", status: "ready", eligibility: true, conflict: false },
        { unit_barang_id: "unit-rented", status: "rented", eligibility: false, conflict: false },
      ],
      error: null,
    });

    await expect(previewDirectRentalAvailability("usaha-1", {
      barangId: "barang-1",
      requestedUnits: 2,
      startAt: "2026-11-02T01:00:00.000Z",
      endAt: "2026-11-03T01:00:00.000Z",
    })).resolves.toEqual({
      readyPhysicalUnits: 2,
      requestedUnits: 2,
      physicalCheck: "pass",
    });

    expect(rpcMock).toHaveBeenCalledWith("find_inventory_unit_candidates", {
      p_usaha_id: "usaha-1",
      p_barang_id: "barang-1",
      p_varian_barang_id: null,
      p_start_at: "2026-11-02T01:00:00.000Z",
      p_end_at: "2026-11-03T01:00:00.000Z",
      p_preferred_unit_id: null,
      p_exclude_penyewaan_id: null,
      p_limit: 100,
    });
  });

  test("availability preview rejects an invalid rental window before querying stock", async () => {
    await expect(previewDirectRentalAvailability("usaha-1", {
      barangId: "barang-1",
      requestedUnits: 1,
      startAt: "2026-11-03T01:00:00.000Z",
      endAt: "2026-11-02T01:00:00.000Z",
    })).rejects.toThrow(/Periode rental harus valid/i);
    expect(rpcMock).not.toHaveBeenCalled();
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

  test("atomic direct-rental reconciliation queries the combined command state", async () => {
    rpcMock.mockResolvedValue({
      data: { state: "committed", response: { penyewaan_id: "rental-active-1", status: "active" } },
      error: null,
    });

    await expect(reconcileDirectRentalActivation("usaha-1", "walkin-atomic-key")).resolves.toEqual({
      state: "committed",
      response: { penyewaan_id: "rental-active-1", status: "active" },
    });

    expect(rpcMock).toHaveBeenCalledWith("command_reconcile_direct_rental_activation", {
      p_usaha_id: "usaha-1",
      p_idempotency_key: "walkin-atomic-key",
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
