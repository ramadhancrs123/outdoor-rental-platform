import { beforeEach, describe, expect, test, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
        list: vi.fn(),
        createSignedUrl: vi.fn(),
      })),
    },
    auth: { getUser: vi.fn() },
  },
}));

import {
  completeInspection,
  getInspectionCapabilities,
  reconcileInspectionCommand,
  startInspection,
} from "@/features/pemeriksaan/service";
import { normalizeInspectionFindings } from "@/features/pemeriksaan/utils";

describe("Pemeriksaan trusted command service", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  test("capabilities expose trusted commands and queue/detail reads", () => {
    const capabilities = getInspectionCapabilities();
    expect(capabilities.mutation).toBe(true);
    expect(capabilities.commands).toEqual(expect.arrayContaining([
      "start_inspection",
      "complete_inspection",
      "attach_inspection_evidence",
      "command_reconcile_inspection_mutation",
    ]));
  });

  test("start inspection maps return detail and unit", async () => {
    rpcMock.mockResolvedValue({
      data: {
        pemeriksaan_id: "inspection-1",
        detail_pengembalian_id: "return-detail-1",
        unit_barang_id: "unit-1",
        state: "in_progress",
        reused_draft: false,
      },
      error: null,
    });

    await expect(startInspection("usaha-1", "return-detail-1", "unit-1", "start-key"))
      .resolves.toMatchObject({ pemeriksaan_id: "inspection-1", state: "in_progress" });

    expect(rpcMock).toHaveBeenCalledWith("command_start_inspection", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_detail_pengembalian_id: "return-detail-1",
      p_unit_barang_id: "unit-1",
      p_idempotency_key: "start-key",
    }));
  });

  test("complete inspection normalizes findings and preserves stale guards", async () => {
    rpcMock.mockResolvedValue({
      data: {
        pemeriksaan_id: "inspection-1",
        detail_pengembalian_id: "return-detail-1",
        unit_barang_id: "unit-1",
        state: "completed",
        hasil: "issue_found",
        kelengkapan_status: "incomplete",
        keputusan_operasional: "maintenance_required",
        finding_ids: ["finding-1"],
        finding_count: 1,
        reinspection: false,
        reinspection_source_id: null,
      },
      error: null,
    });

    const result = await completeInspection(
      "usaha-1",
      {
        pemeriksaanId: "inspection-1",
        hasil: "issue_found",
        kelengkapanStatus: "incomplete",
        keputusanOperasional: "maintenance_required",
        catatan: "  objektif  ",
        findings: [{
          jenis_temuan: "damage",
          deskripsi: "  resleting sisi kiri rusak  ",
          nominal_potensi_biaya: 50000,
        }],
      },
      "2026-09-28T10:00:00Z",
      "2026-09-28T09:59:00Z",
      "complete-key",
    );

    expect(result.reinspection).toBe(false);
    expect(rpcMock).toHaveBeenCalledWith("command_complete_inspection", expect.objectContaining({
      p_pemeriksaan_id: "inspection-1",
      p_hasil: "issue_found",
      p_expected_inspection_updated_at: "2026-09-28T10:00:00Z",
      p_expected_unit_updated_at: "2026-09-28T09:59:00Z",
      p_findings: [{
        jenis_temuan: "damage",
        deskripsi: "resleting sisi kiri rusak",
        tingkat: null,
        status_tindak_lanjut: "open",
        nominal_potensi_biaya: 50000,
        currency_code: "IDR",
      }],
    }));
  });

  test("unknown outcome never blind-retries complete", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("network timeout") })
      .mockResolvedValueOnce({ data: { state: "unknown", response: null, command_name: "complete_inspection" }, error: null });

    await expect(completeInspection(
      "usaha-1",
      {
        pemeriksaanId: "inspection-1",
        hasil: "normal",
        kelengkapanStatus: "complete",
        keputusanOperasional: "ready_review",
        findings: [],
      },
      "inspection-time",
      "unit-time",
      "unknown-key",
    )).rejects.toThrow(/UNKNOWN_OUTCOME/);

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock).toHaveBeenNthCalledWith(1, "command_complete_inspection", expect.objectContaining({
      p_idempotency_key: "unknown-key",
    }));
    expect(rpcMock).toHaveBeenNthCalledWith(2, "command_reconcile_inspection_mutation", {
      p_usaha_id: "usaha-1",
      p_idempotency_key: "unknown-key",
    });
  });

  test("reconciliation preserves committed response", async () => {
    rpcMock.mockResolvedValue({
      data: {
        state: "committed",
        command_name: "complete_inspection",
        response: { pemeriksaan_id: "inspection-1", state: "completed" },
      },
      error: null,
    });

    await expect(reconcileInspectionCommand("usaha-1", "complete-key")).resolves.toEqual({
      state: "committed",
      command_name: "complete_inspection",
      response: { pemeriksaan_id: "inspection-1", state: "completed" },
    });
  });

  test("finding normalization never turns potential cost into payment semantics", () => {
    expect(normalizeInspectionFindings([{
      jenis_temuan: "missing_component",
      deskripsi: "Pasak dua buah hilang",
      nominal_potensi_biaya: 40000,
    }])).toEqual([{
      jenis_temuan: "missing_component",
      deskripsi: "Pasak dua buah hilang",
      tingkat: null,
      status_tindak_lanjut: "open",
      nominal_potensi_biaya: 40000,
      currency_code: "IDR",
    }]);
  });
});
