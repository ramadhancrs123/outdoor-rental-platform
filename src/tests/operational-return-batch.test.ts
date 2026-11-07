import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({ rpc: vi.fn() }));
const returnServiceMock = vi.hoisted(() => ({ getReturnWorkspace: vi.fn() }));

vi.mock("@/app/providers/supabase/client", () => ({ supabase: supabaseMock }));
vi.mock("@/features/pengembalian/service", () => returnServiceMock);

import { processOperationalUnitReturns } from "@/features/pengembalian/operational";

type RuntimeUnit = {
  id: string;
  status: "rented" | "ready" | "maintenance";
  returned: boolean;
  inspected: boolean;
};

let runtime: { updatedAt: string; units: RuntimeUnit[] };
const commandCalls: Array<Record<string, unknown>> = [];

function rawUnit(unit: RuntimeUnit) {
  return {
    unit_barang_id: unit.id,
    kode_unit: unit.id.toUpperCase(),
    barang_id: "barang-1",
    barang_nama: "Tenda",
    varian_barang_id: null,
    unit_status: unit.status,
    kondisi_ringkas: null,
    assignment: {
      penetapan_unit_id: "assignment-" + unit.id,
      detail_penyewaan_id: "detail-rental-" + unit.id,
      komponen_penyewaan_id: null,
      status: "assigned",
    },
    return: unit.returned ? {
      detail_pengembalian_id: "detail-return-" + unit.id,
      pengembalian_id: "return-" + unit.id,
      diterima_at: "2026-11-01T10:00:00Z",
      kondisi_awal: null,
      status_pemeriksaan: "completed",
      catatan: null,
    } : null,
    inspection: unit.inspected ? {
      pemeriksaan_id: "inspection-" + unit.id,
      detail_pengembalian_id: "detail-return-" + unit.id,
      hasil: unit.id === "unit-damage" ? "issue_found" : "normal",
      kelengkapan_status: "complete",
      keputusan_operasional: unit.id === "unit-damage" ? "maintenance_required" : "ready_review",
      diperiksa_at: "2026-11-01T10:05:00Z",
      catatan: null,
      finding_count: unit.id === "unit-damage" ? 1 : 0,
    } : null,
    maintenance: null,
    readiness_state: unit.status === "ready" ? "ready" : unit.status === "maintenance" ? "maintenance_required" : "inspection_pending",
  };
}

function currentRpcWorkspace() {
  return {
    rental: {
      penyewaan_id: "rental-1",
      usaha_id: "usaha-1",
      nomor_penyewaan: "RNT-001",
      jadwal_mulai: "2026-11-01T08:00:00Z",
      jadwal_kembali: "2026-11-02T08:00:00Z",
      tolerance_deadline: "2026-11-02T18:00:00Z",
      actual_pickup_at: "2026-11-01T08:00:00Z",
      actual_return_started_at: null,
      actual_return_completed_at: null,
      status: "active",
      total_amount: 300000,
      currency_code: "IDR",
      catatan: null,
      created_at: "2026-11-01T07:00:00Z",
      updated_at: runtime.updatedAt,
    },
    renter: { penyewa_id: "renter-1", nama_lengkap: "Penyewa", nomor_telepon: null },
    units: runtime.units.map(rawUnit),
  };
}

function commandResult(unitId: string) {
  return {
    pengembalian_id: "return-" + unitId,
    detail_pengembalian_id: "detail-return-" + unitId,
    pemeriksaan_id: "inspection-" + unitId,
    perawatan_id: null,
    penyewaan_id: "rental-1",
    unit_barang_id: unitId,
    return: {},
    inspection: {},
    maintenance_required: false,
    readiness_state: "ready" as const,
    block_reason: null,
    unit_status: "ready",
    ready_response: {},
  };
}

function updateUnitAsCompleted(unitId: string, damage = false) {
  runtime.units = runtime.units.map((unit) => unit.id === unitId
    ? { ...unit, status: damage ? "maintenance" : "ready", returned: true, inspected: true }
    : unit);
  const version = Number(runtime.updatedAt.replace("v", "")) + 1;
  runtime.updatedAt = "v" + version;
}

const normalInspection = {
  hasil: "normal" as const,
  kelengkapanStatus: "complete" as const,
  keputusanOperasional: "ready_review" as const,
  findings: [],
};
const damageInspection = {
  hasil: "issue_found" as const,
  kelengkapanStatus: "complete" as const,
  keputusanOperasional: "maintenance_required" as const,
  findings: [{ jenis_temuan: "damage" as const, deskripsi: "Retak pada rangka.", status_tindak_lanjut: "pending" }],
};

describe("operational unit-return orchestration", () => {
  beforeEach(() => {
    runtime = {
      updatedAt: "v1",
      units: [
        { id: "unit-a", status: "rented", returned: false, inspected: false },
        { id: "unit-damage", status: "rented", returned: false, inspected: false },
        { id: "unit-c", status: "rented", returned: false, inspected: false },
      ],
    };
    commandCalls.length = 0;
    supabaseMock.rpc.mockReset();
    returnServiceMock.getReturnWorkspace.mockReset();
    returnServiceMock.getReturnWorkspace.mockResolvedValue({
      rental: currentRpcWorkspace().rental,
      renter: currentRpcWorkspace().renter,
      units: [],
      returnRecords: [],
    });
    supabaseMock.rpc.mockImplementation(async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "get_operational_return_workspace") {
        return { data: currentRpcWorkspace(), error: null };
      }
      if (functionName === "command_operational_process_unit_return") {
        commandCalls.push(args);
        const unitId = String(args.p_unit_barang_id);
        updateUnitAsCompleted(unitId, unitId === "unit-damage");
        return { data: commandResult(unitId), error: null };
      }
      throw new Error("Unexpected RPC: " + functionName);
    });
  });

  it("executes one existing per-unit command at a time with a refreshed rental concurrency token", async () => {
    const progress: string[] = [];
    const result = await processOperationalUnitReturns("usaha-1", {
      rentalId: "rental-1",
      units: [
        { unitBarangId: "unit-a", inspection: normalInspection },
        { unitBarangId: "unit-damage", inspection: damageInspection },
      ],
    }, {
      onProgress: ({ index, total, unitBarangId }) => progress.push(index + "/" + total + ":" + unitBarangId),
    });

    expect(result.state).toBe("completed");
    expect(result.processed.map((item) => item.unitBarangId)).toEqual(["unit-a", "unit-damage"]);
    expect(commandCalls).toHaveLength(2);
    expect(commandCalls.map((args) => args.p_unit_barang_id)).toEqual(["unit-a", "unit-damage"]);
    expect(commandCalls[0].p_expected_rental_updated_at).toBe("v1");
    expect(commandCalls[1].p_expected_rental_updated_at).toBe("v2");
    expect(commandCalls[1].p_findings).toEqual([
      expect.objectContaining({ jenis_temuan: "damage", deskripsi: "Retak pada rangka." }),
    ]);
    expect(progress).toEqual(["1/2:unit-a", "2/2:unit-damage"]);
  });

  it("stops at the first failed unit, preserves the actual RPC error, and does not start later units", async () => {
    supabaseMock.rpc.mockImplementation(async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "get_operational_return_workspace") {
        return { data: currentRpcWorkspace(), error: null };
      }
      if (functionName === "command_operational_process_unit_return") {
        commandCalls.push(args);
        const unitId = String(args.p_unit_barang_id);
        if (unitId === "unit-damage") {
          return {
            data: null,
            error: {
              message: "maintenance handoff rejected for finding type damage",
              details: "A database trigger blocked the maintenance transition.",
              code: "23514",
            },
          };
        }
        updateUnitAsCompleted(unitId);
        return { data: commandResult(unitId), error: null };
      }
      throw new Error("Unexpected RPC: " + functionName);
    });

    const result = await processOperationalUnitReturns("usaha-1", {
      rentalId: "rental-1",
      units: [
        { unitBarangId: "unit-a", inspection: normalInspection },
        { unitBarangId: "unit-damage", inspection: damageInspection },
        { unitBarangId: "unit-c", inspection: normalInspection },
      ],
    });

    expect(result.state).toBe("partial");
    expect(result.processed.map((item) => item.unitBarangId)).toEqual(["unit-a"]);
    expect(result.failedUnitId).toBe("unit-damage");
    expect(result.error).toContain("maintenance handoff rejected for finding type damage");
    expect(result.error).toContain("A database trigger blocked the maintenance transition.");
    expect(result.error).toContain("23514");
    expect(commandCalls.map((args) => args.p_unit_barang_id)).toEqual(["unit-a", "unit-damage"]);
    expect(runtime.units.find((unit) => unit.id === "unit-c")?.returned).toBe(false);
  });

  it("reconciles a committed command after a lost response and never replays that unit", async () => {
    supabaseMock.rpc.mockImplementation(async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "get_operational_return_workspace") {
        return { data: currentRpcWorkspace(), error: null };
      }
      if (functionName === "command_operational_process_unit_return") {
        commandCalls.push(args);
        const unitId = String(args.p_unit_barang_id);
        updateUnitAsCompleted(unitId, unitId === "unit-damage");
        if (unitId === "unit-a") {
          return { data: null, error: { message: "Network response lost after commit", code: "FETCH_ERROR" } };
        }
        return { data: commandResult(unitId), error: null };
      }
      throw new Error("Unexpected RPC: " + functionName);
    });

    const result = await processOperationalUnitReturns("usaha-1", {
      rentalId: "rental-1",
      units: [
        { unitBarangId: "unit-a", inspection: normalInspection },
        { unitBarangId: "unit-damage", inspection: damageInspection },
      ],
    });

    expect(result.state).toBe("completed");
    expect(result.processed).toEqual([
      { unitBarangId: "unit-a", reconciled: true },
      { unitBarangId: "unit-damage", result: expect.objectContaining({ unit_barang_id: "unit-damage" }) },
    ]);
    expect(commandCalls.map((args) => args.p_unit_barang_id)).toEqual(["unit-a", "unit-damage"]);
  });
});
