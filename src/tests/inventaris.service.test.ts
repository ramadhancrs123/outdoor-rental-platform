import { describe, expect, test, vi, beforeEach } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const refreshSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
    auth: {
      refreshSession: refreshSessionMock,
    },
  },
}));

import {
  findInventoryUnitCandidates,
  listInventoryLocations,
  listInventoryUnits,
  listInventoryPackageAvailability,
  getInventoryStateCapabilities,
  markInventoryUnitInspectionPending,
  markInventoryUnitReady,
  setInventoryUnitOperationalStatus,
  moveInventoryUnit,
  registerInventoryUnit,
  registerInventoryUnits,
} from "@/features/inventaris/service";

describe("Inventaris trusted command service", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    refreshSessionMock.mockReset();
    refreshSessionMock.mockResolvedValue({ data: { session: null }, error: null });
  });

  test("capabilities expose trusted mutation commands", () => {
    const capabilities = getInventoryStateCapabilities();
    expect(capabilities.read).toBe(true);
    expect(capabilities.mutation).toBe(true);
    expect(capabilities.commands).toEqual(expect.arrayContaining([
      "register_inventory_unit",
      "register_inventory_units",
      "move_inventory_unit",
      "mark_inventory_unit_ready",
      "command_mark_inventory_unit_inspection_pending",
      "set_inventory_unit_operational_status",
      "command_reconcile_inventory_unit_mutation",
    ]));
    expect(capabilities.queries).toEqual(expect.arrayContaining([
      "lookupInventoryUnitByQr",
      "findInventoryUnitCandidates",
      "getInventoryOperationalContext",
    ]));
  });



  test("unit list applies the explicit no-variant filter as IS NULL", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      in: vi.fn(),
      or: vi.fn(),
      order: vi.fn(),
      range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    };
    for (const method of ["select", "eq", "is", "in", "or", "order"] as const) {
      query[method].mockReturnValue(query);
    }
    fromMock.mockReturnValue(query);

    await expect(listInventoryUnits("usaha-1", {
      search: "",
      status: "all",
      barangId: "barang-1",
      varianBarangId: "none",
      locationId: "all",
      availabilityContext: "all",
      sort: "updated_desc",
      page: 1,
      pageSize: 10,
    })).resolves.toMatchObject({ units: [], total: 0 });

    expect(query.is).toHaveBeenCalledWith("varian_barang_id", null);
    expect(query.eq).toHaveBeenCalledWith("barang_id", "barang-1");
    expect(query.range).toHaveBeenCalledWith(0, 9);
  });

  test("location read refreshes an invalid auth session once after permission failure", async () => {
    const orderMock = vi.fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42501", message: "permission denied for table lokasi" },
      })
      .mockResolvedValueOnce({
        data: [{
          lokasi_id: "loc-1",
          usaha_id: "usaha-1",
          nama: "Gudang Utama",
          tipe: "gudang",
          alamat: null,
          keterangan: null,
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }],
        error: null,
      });
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: orderMock,
        }),
      }),
    });
    refreshSessionMock.mockResolvedValueOnce({
      data: { session: { access_token: "fresh-token" } },
      error: null,
    });

    await expect(listInventoryLocations("usaha-1")).resolves.toMatchObject([{
      lokasi_id: "loc-1",
      nama: "Gudang Utama",
    }]);

    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(orderMock).toHaveBeenCalledTimes(2);
  });

  test("register command preserves tenant, source and idempotency contract", async () => {
    rpcMock.mockResolvedValue({
      data: {
        unit_barang_id: "unit-1",
        usaha_id: "usaha-1",
        kode_unit: "TD4P-001",
        status: "ready",
        lokasi_id: "loc-1",
      },
      error: null,
    });

    await expect(registerInventoryUnit("usaha-1", {
      barangId: "barang-1",
      varianBarangId: "variant-1",
      kodeUnit: " TD4P-001 ",
      serialNumber: " SN-001 ",
      lokasiId: "loc-1",
      tanggalDiperoleh: "2026-09-28",
      sumberPembelianDetailId: "purchase-detail-1",
      catatanInternal: " Unit baru ",
    }, {
      idempotencyKey: "inventory-register-key",
      requestId: "request-1",
    })).resolves.toMatchObject({
      unit_barang_id: "unit-1",
      status: "ready",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_register_inventory_unit", {
      p_usaha_id: "usaha-1",
      p_barang_id: "barang-1",
      p_varian_barang_id: "variant-1",
      p_kode_unit: "TD4P-001",
      p_serial_number: "SN-001",
      p_lokasi_id: "loc-1",
      p_tanggal_diperoleh: "2026-09-28",
      p_sumber_pembelian_detail_id: "purchase-detail-1",
      p_catatan_internal: "Unit baru",
      p_idempotency_key: "inventory-register-key",
      p_request_id: "request-1",
    });
  });

  test("bulk register command sends quantity to the atomic trusted RPC and receives unique generated unit codes", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        usaha_id: "usaha-1",
        jumlah_unit: 3,
        units: [
          { unit_barang_id: "unit-1", usaha_id: "usaha-1", kode_unit: "TENDA-001", status: "ready" },
          { unit_barang_id: "unit-2", usaha_id: "usaha-1", kode_unit: "TENDA-002", status: "ready" },
          { unit_barang_id: "unit-3", usaha_id: "usaha-1", kode_unit: "TENDA-003", status: "ready" },
        ],
      },
      error: null,
    });

    await expect(registerInventoryUnits("usaha-1", {
      barangId: "barang-1",
      varianBarangId: "variant-1",
      lokasiId: "loc-1",
      tanggalDiperoleh: "2026-10-29",
      sumberPembelianDetailId: "purchase-detail-1",
      catatanInternal: "Bulk registration",
    }, 3, {
      idempotencyKey: "inventory-register-batch-test",
      requestId: "request-inventory-register-batch-test",
    })).resolves.toMatchObject({
      jumlah_unit: 3,
      units: [
        { unit_barang_id: "unit-1", kode_unit: "TENDA-001" },
        { unit_barang_id: "unit-2", kode_unit: "TENDA-002" },
        { unit_barang_id: "unit-3", kode_unit: "TENDA-003" },
      ],
    });

    expect(rpcMock).toHaveBeenCalledWith("command_register_inventory_units", {
      p_usaha_id: "usaha-1",
      p_barang_id: "barang-1",
      p_varian_barang_id: "variant-1",
      p_jumlah_unit: 3,
      p_lokasi_id: "loc-1",
      p_tanggal_diperoleh: "2026-10-29",
      p_sumber_pembelian_detail_id: "purchase-detail-1",
      p_catatan_internal: "Bulk registration",
      p_idempotency_key: "inventory-register-batch-test",
      p_request_id: "request-inventory-register-batch-test",
    });
  });

  test("bulk register refuses a non-integer or out-of-range quantity before RPC", async () => {
    await expect(registerInventoryUnits("usaha-1", { barangId: "barang-1" }, 0))
      .rejects.toThrow("antara 1 dan 250");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("unknown outcome reconciles before returning committed response and never blind-retries mutation", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("network timeout") })
      .mockResolvedValueOnce({
        data: {
          state: "committed",
          response: {
            unit_barang_id: "unit-1",
            status: "ready",
          },
        },
        error: null,
      });

    await expect(moveInventoryUnit(
      "usaha-1",
      "unit-1",
      "loc-2",
      "Pindah lokasi",
      {
        idempotencyKey: "move-key",
        requestId: "request-2",
        expectedUpdatedAt: "2026-09-28T02:00:00.000Z",
      },
    )).resolves.toMatchObject({
      unit_barang_id: "unit-1",
      status: "ready",
    });

    expect(rpcMock).toHaveBeenNthCalledWith(1, "command_move_inventory_unit", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_unit_barang_id: "unit-1",
      p_lokasi_id: "loc-2",
      p_idempotency_key: "move-key",
      p_request_id: "request-2",
      p_expected_updated_at: "2026-09-28T02:00:00.000Z",
    }));
    expect(rpcMock).toHaveBeenNthCalledWith(2, "command_reconcile_inventory_unit_mutation", {
      p_usaha_id: "usaha-1",
      p_command_name: "move_inventory_unit",
      p_idempotency_key: "move-key",
    });
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  test("operational status change uses trusted command and reconciles unknown outcome", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("network timeout") })
      .mockResolvedValueOnce({
        data: {
          state: "committed",
          response: {
            unit_barang_id: "unit-1",
            status: "inactive",
            state: "changed",
          },
        },
        error: null,
      });

    await expect(setInventoryUnitOperationalStatus(
      "usaha-1",
      "unit-1",
      {
        status: "inactive",
        reason: "Unit tidak ekonomis untuk digunakan.",
        note: "Sudah tidak layak operasional.",
        expectedUpdatedAt: "2026-09-28T02:00:00.000Z",
      },
      {
        idempotencyKey: "unit-status-key",
        requestId: "request-status",
      },
    )).resolves.toMatchObject({
      unit_barang_id: "unit-1",
      status: "inactive",
      state: "changed",
    });

    expect(rpcMock).toHaveBeenNthCalledWith(1, "command_set_inventory_unit_operational_status", {
      p_usaha_id: "usaha-1",
      p_unit_barang_id: "unit-1",
      p_status: "inactive",
      p_alasan: "Unit tidak ekonomis untuk digunakan.",
      p_catatan: "Sudah tidak layak operasional.",
      p_expected_updated_at: "2026-09-28T02:00:00.000Z",
      p_idempotency_key: "unit-status-key",
      p_request_id: "request-status",
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "command_reconcile_inventory_unit_mutation", {
      p_usaha_id: "usaha-1",
      p_command_name: "set_inventory_unit_operational_status",
      p_idempotency_key: "unit-status-key",
    });
  });

  test("unknown reconciliation state stops retry path", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("network timeout") })
      .mockResolvedValueOnce({ data: { state: "unknown", response: null }, error: null });

    await expect(markInventoryUnitReady(
      "usaha-1",
      "unit-1",
      undefined,
      {
        idempotencyKey: "ready-key",
        requestId: "request-3",
        expectedUpdatedAt: "2026-09-28T02:00:00.000Z",
      },
    )).rejects.toThrow(/Penetapan Siap Disewakan unit: network timeout/i);

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls.map(([name]) => name)).toEqual([
      "command_mark_inventory_unit_ready",
      "command_reconcile_inventory_unit_mutation",
    ]);
  });

  test("business command error with no committed idempotency state surfaces original error", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("BUSINESS_CONFLICT: unit rented") })
      .mockResolvedValueOnce({ data: { state: "not_found", response: null }, error: null });

    await expect(moveInventoryUnit(
      "usaha-1",
      "unit-1",
      "loc-2",
      undefined,
      {
        idempotencyKey: "move-conflict-key",
        requestId: "request-4",
        expectedUpdatedAt: "2026-09-28T02:00:00.000Z",
      },
    )).rejects.toThrow(/Pemindahan unit: BUSINESS_CONFLICT: unit rented/i);

    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  test("move rejects without server-current timestamp guard", async () => {
    await expect(
      moveInventoryUnit("usaha-1", "unit-1", "loc-2", undefined, {
        idempotencyKey: "missing-stale-key",
        requestId: "request-stale",
      }),
    ).rejects.toThrow(/Status unit terbaru wajib diverifikasi/i);

    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("candidate query delegates temporal conflict evaluation to trusted database", async () => {
    rpcMock.mockResolvedValue({
      data: [{
        unit_barang_id: "unit-1",
        unit_code: "TD4P-001",
        status: "ready",
        lokasi_id: "loc-1",
        lokasi_nama: "Gudang",
        eligibility: true,
        conflict: false,
        conflict_reason: null,
        preferred: true,
      }],
      error: null,
    });

    await expect(findInventoryUnitCandidates("usaha-1", {
      barangId: "barang-1",
      varianBarangId: null,
      startAt: "2026-10-10T01:00:00.000Z",
      endAt: "2026-10-12T01:00:00.000Z",
      preferredUnitId: "unit-1",
      limit: 20,
    })).resolves.toMatchObject([{ unit_barang_id: "unit-1", eligibility: true }]);

    expect(rpcMock).toHaveBeenCalledWith("find_inventory_unit_candidates", {
      p_usaha_id: "usaha-1",
      p_barang_id: "barang-1",
      p_varian_barang_id: null,
      p_start_at: "2026-10-10T01:00:00.000Z",
      p_end_at: "2026-10-12T01:00:00.000Z",
      p_preferred_unit_id: "unit-1",
      p_exclude_penyewaan_id: null,
      p_limit: 20,
    });
  });

  test("return handoff command preserves expected-state and return-detail provenance", async () => {
    rpcMock.mockResolvedValue({
      data: {
        unit_barang_id: "unit-1",
        status: "inspection_pending",
        detail_pengembalian_id: "return-detail-1",
      },
      error: null,
    });

    await expect(markInventoryUnitInspectionPending(
      "usaha-1",
      "unit-1",
      { detailPengembalianId: "return-detail-1" },
      {
        idempotencyKey: "return-handoff-key",
        requestId: "request-handoff",
        expectedUpdatedAt: "2026-09-28T02:00:00.000Z",
      },
    )).resolves.toMatchObject({
      unit_barang_id: "unit-1",
      status: "inspection_pending",
      detail_pengembalian_id: "return-detail-1",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_mark_inventory_unit_inspection_pending", {
      p_usaha_id: "usaha-1",
      p_unit_barang_id: "unit-1",
      p_detail_pengembalian_id: "return-detail-1",
      p_idempotency_key: "return-handoff-key",
      p_request_id: "request-handoff",
      p_expected_updated_at: "2026-09-28T02:00:00.000Z",
    });
  });


  test("package availability resolves variant-only components to their parent product before trusted stock lookup", async () => {
    const dataByTable: Record<string, unknown[]> = {
      paket_sewa: [{
        paket_sewa_id: "package-camping-2",
        nama: "Paket camping 2 orang",
        deskripsi: null,
        harga_dasar: null,
        currency_code: "IDR",
        status: "active",
      }],
      komponen_paket: [
        {
          komponen_paket_id: "component-tent",
          paket_sewa_id: "package-camping-2",
          barang_id: null,
          varian_barang_id: "variant-tent",
          jumlah: 1,
        },
        {
          komponen_paket_id: "component-pole",
          paket_sewa_id: "package-camping-2",
          barang_id: null,
          varian_barang_id: "variant-pole",
          jumlah: 2,
        },
      ],
      tarif_sewa: [{
        tarif_sewa_id: "tariff-package",
        usaha_id: "usaha-1",
        barang_id: null,
        varian_barang_id: null,
        paket_sewa_id: "package-camping-2",
        nama: "Harian",
        durasi_unit: "hari",
        durasi_nilai: 1,
        nominal: 80000,
        currency_code: "IDR",
        berlaku_mulai: "2026-01-01T00:00:00.000Z",
        berlaku_sampai: null,
        status: "active",
        updated_at: "2026-01-01T00:00:00.000Z",
      }],
      promosi_paket_sewa: [],
      varian_barang: [
        { varian_barang_id: "variant-tent", nama: "Biru / 3", barang_id: "barang-tent" },
        { varian_barang_id: "variant-pole", nama: "Hitam / X", barang_id: "barang-pole" },
      ],
      barang: [
        { barang_id: "barang-tent", nama: "Tenda dome" },
        { barang_id: "barang-pole", nama: "Tracking pole" },
      ],
      unit_barang: [
        { unit_barang_id: "unit-tent", barang_id: "barang-tent", varian_barang_id: "variant-tent", status: "ready" },
        { unit_barang_id: "unit-pole-1", barang_id: "barang-pole", varian_barang_id: "variant-pole", status: "ready" },
        { unit_barang_id: "unit-pole-2", barang_id: "barang-pole", varian_barang_id: "variant-pole", status: "ready" },
      ],
    };

    fromMock.mockImplementation((table: string) => {
      const data = dataByTable[table] ?? [];
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "lte", "or", "is", "order"]) {
        builder[method] = vi.fn(() => builder);
      }
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(resolve, reject);
      return builder;
    });

    rpcMock.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
      const variantId = args.p_varian_barang_id;
      const unitIds = variantId === "variant-tent" ? ["unit-tent"] : ["unit-pole-1", "unit-pole-2"];
      return {
        data: unitIds.map((unit_barang_id) => ({
          unit_barang_id,
          status: "ready",
          eligibility: true,
          conflict: false,
        })),
        error: null,
      };
    });

    const result = await listInventoryPackageAvailability("usaha-1", {
      startAt: "2026-11-10T01:00:00.000Z",
      endAt: "2026-11-11T01:00:00.000Z",
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      paket_sewa_id: "package-camping-2",
      status: "available",
      available_package_quantity: 1,
    });
    expect(result[0].components).toEqual(expect.arrayContaining([
      expect.objectContaining({ nama: "Tenda dome · Biru / 3", ready_quantity: 1, shortfall_quantity: 0 }),
      expect.objectContaining({ nama: "Tracking pole · Hitam / X", ready_quantity: 2, shortfall_quantity: 0 }),
    ]));
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock).toHaveBeenCalledWith("find_inventory_unit_candidates", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_barang_id: "barang-tent",
      p_varian_barang_id: "variant-tent",
    }));
    expect(rpcMock).toHaveBeenCalledWith("find_inventory_unit_candidates", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_barang_id: "barang-pole",
      p_varian_barang_id: "variant-pole",
    }));
  });

});
