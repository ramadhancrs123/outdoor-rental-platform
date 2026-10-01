import { beforeEach, describe, expect, test, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}));

import {
  getReturnCapabilities,
  listReturnQueue,
  getReturnWorkspace,
  processUnitReturn,
  reconcileReturnCommand,
} from "@/features/pengembalian/service";
import {
  deriveReturnDueState,
  formatReturnProgress,
} from "@/features/pengembalian/utils";

describe("Pengembalian trusted command service", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  test("capabilities expose unit-level return, reconciliation and read queries", () => {
    const capabilities = getReturnCapabilities();
    expect(capabilities.read).toBe(true);
    expect(capabilities.mutation).toBe(true);
    expect(capabilities.commands).toEqual(expect.arrayContaining([
      "process_unit_return",
      "command_reconcile_return_mutation",
    ]));
    expect(capabilities.queries).toEqual(expect.arrayContaining([
      "listReturnQueue",
      "getReturnWorkspace",
      "lookupReturnRentalByQr",
    ]));
  });

  test("read queue maps tenant-scoped rental, assigned units and partial return progress", async () => {
    const builders = {
      penyewaan: [{
        penyewaan_id: "rental-1", usaha_id: "usaha-1", nomor_penyewaan: "RNT-001", penyewa_id: "renter-1",
        jadwal_kembali: "2026-09-28T08:00:00Z", tolerance_deadline: "2026-09-28T18:00:00Z",
        actual_pickup_at: "2026-09-27T08:00:00Z", actual_return_started_at: null, actual_return_completed_at: null,
        status: "return_in_progress", jadwal_mulai: "2026-09-27T08:00:00Z", updated_at: "2026-09-28T08:30:00Z",
      }],
      detail_penyewaan: [{ detail_penyewaan_id: "detail-1", penyewaan_id: "rental-1" }],
      penetapan_unit: [
        { penetapan_unit_id: "assignment-1", usaha_id: "usaha-1", detail_penyewaan_id: "detail-1", unit_barang_id: "unit-1", status: "assigned", ditetapkan_at: "2026-09-27T08:00:00Z", dibatalkan_at: null },
        { penetapan_unit_id: "assignment-2", usaha_id: "usaha-1", detail_penyewaan_id: "detail-1", unit_barang_id: "unit-2", status: "assigned", ditetapkan_at: "2026-09-27T08:00:00Z", dibatalkan_at: null },
      ],
      pengembalian: [{ pengembalian_id: "return-1", usaha_id: "usaha-1", penyewaan_id: "rental-1", nomor_pengembalian: "RET-001", dimulai_at: "2026-09-28T09:00:00Z", selesai_at: "2026-09-28T09:00:00Z", status: "completed", diproses_by_admin_id: "admin-1", catatan: null }],
      detail_pengembalian: [{ detail_pengembalian_id: "rd-1", usaha_id: "usaha-1", pengembalian_id: "return-1", unit_barang_id: "unit-1", diterima_at: "2026-09-28T09:00:00Z", kondisi_awal: null, status_pemeriksaan: "pending", catatan: null }],
      penyewa: [{ penyewa_id: "renter-1", nama_lengkap: "Ahmad", nomor_telepon: "0812" }],
    };
    fromMock.mockImplementation((table: string) => {
      const result = { data: builders[table as keyof typeof builders] ?? [], error: null, count: table === "penyewaan" ? 1 : null };
      const builder = {} as Record<string, ReturnType<typeof vi.fn>>;
      for (const method of ["select", "eq", "in", "or", "is", "order", "range", "limit"]) builder[method] = vi.fn(() => builder);
      builder.maybeSingle = vi.fn(async () => ({ data: (builders[table as keyof typeof builders] ?? [])[0] ?? null, error: null }));
      builder.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve));
      return builder;
    });

    const result = await listReturnQueue("usaha-1", { search: "", page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.returns[0]).toMatchObject({
      penyewaan_id: "rental-1",
      nomor_penyewaan: "RNT-001",
      penyewa_nama: "Ahmad",
      total_unit_count: 2,
      returned_unit_count: 1,
      outstanding_unit_count: 1,
      rental_status: "return_in_progress",
    });
  });

  test("workspace maps returned unit to inspection-pending context", async () => {
    const responses: Record<string, unknown[]> = {
      penyewaan: [{ penyewaan_id: "rental-1", usaha_id: "usaha-1", nomor_penyewaan: "RNT-001", status: "return_in_progress", penyewa_id: "renter-1", jadwal_mulai: "2026-09-27T08:00:00Z", jadwal_kembali: "2026-09-28T08:00:00Z", tolerance_deadline: "2026-09-28T18:00:00Z", actual_pickup_at: "2026-09-27T08:00:00Z", actual_return_started_at: "2026-09-28T09:00:00Z", actual_return_completed_at: null, updated_at: "2026-09-28T09:00:00Z" }],
      penyewa: [{ penyewa_id: "renter-1", nama_lengkap: "Ahmad", nomor_telepon: "0812" }],
      detail_penyewaan: [{ detail_penyewaan_id: "detail-1", penyewaan_id: "rental-1" }],
      penetapan_unit: [{ penetapan_unit_id: "assignment-1", usaha_id: "usaha-1", detail_penyewaan_id: "detail-1", unit_barang_id: "unit-1", status: "assigned", ditetapkan_at: "2026-09-27T08:00:00Z", dibatalkan_at: null }],
      pengembalian: [{ pengembalian_id: "return-1", usaha_id: "usaha-1", penyewaan_id: "rental-1", nomor_pengembalian: "RET-001", dimulai_at: "2026-09-28T09:00:00Z", selesai_at: "2026-09-28T09:00:00Z", status: "completed", diproses_by_admin_id: "admin-1", catatan: "diterima" }],
      detail_pengembalian: [{ detail_pengembalian_id: "rd-1", usaha_id: "usaha-1", pengembalian_id: "return-1", unit_barang_id: "unit-1", diterima_at: "2026-09-28T09:00:00Z", kondisi_awal: null, status_pemeriksaan: "pending", catatan: null }],
      unit_barang: [{ unit_barang_id: "unit-1", usaha_id: "usaha-1", barang_id: "barang-1", varian_barang_id: null, kode_unit: "TD4P-001", status: "inspection_pending" }],
      barang: [{ barang_id: "barang-1", nama: "Tenda Dome" }],
      varian_barang: [],
      pemeriksaan: [{ pemeriksaan_id: "inspection-1", detail_pengembalian_id: "rd-1", hasil: "normal", kelengkapan_status: "complete", keputusan_operasional: "ready_review", diperiksa_at: "2026-09-28T10:00:00Z" }],
    };
    fromMock.mockImplementation((table: string) => {
      const result = { data: responses[table] ?? [], error: null };
      const builder = {} as Record<string, ReturnType<typeof vi.fn>>;
      for (const method of ["select", "eq", "in", "or", "is", "order", "range", "limit"]) builder[method] = vi.fn(() => builder);
      builder.maybeSingle = vi.fn(async () => ({ data: responses[table]?.[0] ?? null, error: null }));
      builder.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve));
      return builder;
    });

    const result = await getReturnWorkspace("usaha-1", "rental-1");
    expect(result.renter?.nama_lengkap).toBe("Ahmad");
    expect(result.units).toHaveLength(1);
    expect(result.units[0]).toMatchObject({
      unit_barang_id: "unit-1",
      kode_unit: "TD4P-001",
      returned: true,
      inspection_status: "pending",
      latest_inspection: expect.objectContaining({ pemeriksaan_id: "inspection-1" }),
    });
  });

  test("return command maps rental, unit ids, stale guard and idempotency", async () => {
    rpcMock.mockResolvedValue({
      data: {
        pengembalian_id: "return-1",
        nomor_pengembalian: "RET-2026-001",
        penyewaan_id: "rental-1",
        status: "completed",
        rental_status: "return_in_progress",
        actual_return_at: "2026-09-28T03:00:00.000Z",
        unit_barang_ids: ["unit-1", "unit-2"],
        detail_pengembalian_ids: ["detail-1", "detail-2"],
        returned_unit_count: 2,
        expected_unit_count: 3,
      },
      error: null,
    });

    await expect(processUnitReturn("usaha-1", {
      rentalId: "rental-1",
      unitBarangIds: ["unit-2", "unit-1", "unit-1"],
      catatan: "  Diterima di gudang  ",
    }, {
      idempotencyKey: "return-key",
      requestId: "request-return",
      expectedRentalUpdatedAt: "2026-09-28T02:55:00.000Z",
    })).resolves.toMatchObject({
      pengembalian_id: "return-1",
      rental_status: "return_in_progress",
      returned_unit_count: 2,
    });

    expect(rpcMock).toHaveBeenCalledWith("command_process_unit_return", {
      p_usaha_id: "usaha-1",
      p_penyewaan_id: "rental-1",
      p_unit_barang_ids: ["unit-2", "unit-1"],
      p_catatan: "Diterima di gudang",
      p_idempotency_key: "return-key",
      p_request_id: "request-return",
      p_expected_rental_updated_at: "2026-09-28T02:55:00.000Z",
    });
  });

  test("mutation does not proceed without expected current rental state", async () => {
    await expect(processUnitReturn("usaha-1", {
      rentalId: "rental-1",
      unitBarangIds: ["unit-1"],
    }, {
      idempotencyKey: "return-stale-key",
      requestId: "request-stale",
    })).rejects.toThrow(/Status penyewaan terbaru wajib diverifikasi/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("unknown outcome reconciles once and never blind-retries the mutation", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("network timeout") })
      .mockResolvedValueOnce({
        data: {
          state: "committed",
          response: {
            pengembalian_id: "return-2",
            nomor_pengembalian: "RET-2026-002",
            penyewaan_id: "rental-2",
            status: "completed",
            rental_status: "completed",
            actual_return_at: "2026-09-28T03:05:00.000Z",
            unit_barang_ids: ["unit-3"],
            detail_pengembalian_ids: ["detail-3"],
            returned_unit_count: 1,
            expected_unit_count: 1,
          },
        },
        error: null,
      });

    await expect(processUnitReturn("usaha-1", {
      rentalId: "rental-2",
      unitBarangIds: ["unit-3"],
    }, {
      idempotencyKey: "return-unknown-key",
      requestId: "request-unknown",
      expectedRentalUpdatedAt: "2026-09-28T03:00:00.000Z",
    })).resolves.toMatchObject({ pengembalian_id: "return-2", rental_status: "completed" });

    expect(rpcMock).toHaveBeenNthCalledWith(1, "command_process_unit_return", expect.objectContaining({
      p_idempotency_key: "return-unknown-key",
    }));
    expect(rpcMock).toHaveBeenNthCalledWith(2, "command_reconcile_return_mutation", {
      p_usaha_id: "usaha-1",
      p_idempotency_key: "return-unknown-key",
    });
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  test("unknown reconciliation state is surfaced, not retried", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("timeout") })
      .mockResolvedValueOnce({ data: { state: "unknown", response: null }, error: null });

    await expect(processUnitReturn("usaha-1", {
      rentalId: "rental-1",
      unitBarangIds: ["unit-1"],
    }, {
      idempotencyKey: "return-unknown",
      requestId: "request-unknown",
      expectedRentalUpdatedAt: "2026-09-28T03:00:00.000Z",
    })).rejects.toThrow(/UNKNOWN_OUTCOME: command pengembalian/i);

    expect(rpcMock).toHaveBeenCalledTimes(2);
  });


  test("reconciliation transport failure stays UNKNOWN_OUTCOME", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("network timeout") })
      .mockRejectedValueOnce(new Error("reconciliation timeout"));

    await expect(processUnitReturn("usaha-1", {
      rentalId: "rental-1",
      unitBarangIds: ["unit-1"],
    }, {
      idempotencyKey: "return-reconcile-failure",
      requestId: "request-reconcile-failure",
      expectedRentalUpdatedAt: "2026-09-28T03:00:00.000Z",
    })).rejects.toThrow(/UNKNOWN_OUTCOME: hasil command pengembalian tidak dapat direkonsiliasi/i);

    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  test("reconciliation query preserves source state", async () => {
    rpcMock.mockResolvedValue({ data: { state: "committed", response: { status: "completed" } }, error: null });
    await expect(reconcileReturnCommand("usaha-1", "return-key")).resolves.toEqual({
      state: "committed",
      response: { status: "completed" },
    });
    expect(rpcMock).toHaveBeenCalledWith("command_reconcile_return_mutation", {
      p_usaha_id: "usaha-1",
      p_idempotency_key: "return-key",
    });
  });

  test("due state uses schedule and tolerance without changing schedule", () => {
    const now = new Date("2026-09-28T12:00:00.000Z");
    expect(deriveReturnDueState("2026-09-29T12:00:00.000Z", "2026-09-29T22:00:00.000Z", now)).toBe("not_due");
    expect(deriveReturnDueState("2026-09-28T10:00:00.000Z", "2026-09-28T22:00:00.000Z", now)).toBe("late_within_tolerance");
    expect(deriveReturnDueState("2026-09-28T10:00:00.000Z", "2026-09-28T11:00:00.000Z", now)).toBe("tolerance_expired");
    expect(formatReturnProgress(2, 3)).toBe("2 / 3");
  });
});
