import { supabase } from "@/app/providers/supabase/client";
import { createClientId } from "@/lib/client-id";
import type { InspectionFindingInput } from "@/features/pemeriksaan/types";
import { getReturnWorkspace } from "./service";
import type { ReturnWorkspace } from "./types";

export type OperationalReturnUnitState = {
  unit_barang_id: string;
  kode_unit: string;
  barang_id: string;
  barang_nama?: string | null;
  varian_barang_id: string | null;
  unit_status: string;
  kondisi_ringkas?: string | null;
  assignment: {
    penetapan_unit_id: string;
    detail_penyewaan_id: string;
    komponen_penyewaan_id: string | null;
    status: string;
  } | null;
  return: {
    detail_pengembalian_id: string;
    pengembalian_id: string;
    diterima_at: string;
    kondisi_awal: string | null;
    status_pemeriksaan: string;
    catatan: string | null;
  } | null;
  inspection: {
    pemeriksaan_id: string;
    detail_pengembalian_id: string;
    hasil: string;
    kelengkapan_status: string;
    keputusan_operasional: string;
    diperiksa_at: string;
    catatan: string | null;
    finding_count: number;
  } | null;
  maintenance: {
    perawatan_id: string;
    pemeriksaan_id: string | null;
    jenis_perawatan: string;
    status: string;
    dimulai_at: string | null;
    selesai_at: string | null;
    biaya: number | string | null;
    currency_code: string;
    pelaksana: string | null;
  } | null;
  readiness_state: "ready" | "maintenance_required" | "blocked" | "inspection_pending" | "lost";
};

type RawOperationalReturnWorkspace = {
  rental: ReturnWorkspace["rental"] & {
    total_amount: number | string;
    currency_code: string;
  };
  renter: ReturnWorkspace["renter"];
  units: OperationalReturnUnitState[];
};

export type OperationalReturnWorkspace = ReturnWorkspace & {
  rental: ReturnWorkspace["rental"] & {
    total_amount: number | string;
    currency_code: string;
  };
  operational_units: OperationalReturnUnitState[];
};

export type OperationalReturnInspectionInput = {
  hasil: "normal" | "issue_found";
  kelengkapanStatus: "complete" | "incomplete" | "unknown";
  keputusanOperasional:
    | "ready_review"
    | "cleaning_required"
    | "maintenance_required"
    | "unavailable"
    | "follow_up_required"
    | "no_action"
    | "readiness_review";
  catatan?: string | null;
  findings: InspectionFindingInput[];
};

export type OperationalReturnCommandResult = {
  pengembalian_id: string;
  detail_pengembalian_id: string;
  pemeriksaan_id: string;
  perawatan_id: string | null;
  penyewaan_id: string;
  unit_barang_id: string;
  return: Record<string, unknown>;
  inspection: Record<string, unknown>;
  maintenance_required: boolean;
  readiness_state: "ready" | "maintenance_required" | "blocked" | "lost";
  block_reason: string | null;
  unit_status: string;
  ready_response: Record<string, unknown> | null;
};

export type OperationalReturnBatchItem = {
  unitBarangId: string;
  result?: OperationalReturnCommandResult;
  reconciled?: boolean;
};

export type OperationalReturnBatchResult = {
  state: "completed" | "partial" | "failed";
  processed: OperationalReturnBatchItem[];
  failedUnitId?: string;
  error?: string;
  unknownOutcome?: boolean;
};

function describeOperationalError(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const value = error as Record<string, unknown>;
    const details = [value.message, value.details, value.hint]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .join(" · ");
    const code = typeof value.code === "string" && value.code.trim() ? value.code.trim() : null;
    if (details) return details + (code ? " (" + code + ")" : "");
  }
  return fallback;
}

export async function getOperationalReturnWorkspace(
  usahaId: string,
  penyewaanId: string,
): Promise<OperationalReturnWorkspace> {
  const [{ data, error }, legacyWorkspace] = await Promise.all([
    supabase.rpc("get_operational_return_workspace", {
      p_usaha_id: usahaId,
      p_penyewaan_id: penyewaanId,
    }),
    getReturnWorkspace(usahaId, penyewaanId),
  ]);
  if (error) throw error;
  if (!data) throw new Error("Workspace operasional pengembalian tidak mengembalikan data.");

  const raw = data as RawOperationalReturnWorkspace;
  const units: ReturnWorkspace["units"] = raw.units.map((unit) => ({
    unit_barang_id: unit.unit_barang_id,
    detail_penyewaan_id: unit.assignment?.detail_penyewaan_id ?? "",
    komponen_penyewaan_id: unit.assignment?.komponen_penyewaan_id ?? null,
    paket_sewa_id: null,
    paket_nama: null,
    kode_unit: unit.kode_unit,
    barang_id: unit.barang_id,
    barang_nama: unit.barang_nama ?? null,
    varian_barang_id: unit.varian_barang_id,
    varian_nama: null,
    assignment_id: unit.assignment?.penetapan_unit_id ?? "",
    assignment_status: unit.assignment?.status ?? "unknown",
    unit_status: unit.unit_status,
    returned: Boolean(unit.return),
    detail_pengembalian_id: unit.return?.detail_pengembalian_id ?? null,
    received_at: unit.return?.diterima_at ?? null,
    inspection_status: unit.return?.status_pemeriksaan ?? null,
    latest_inspection: unit.inspection
      ? {
          pemeriksaan_id: unit.inspection.pemeriksaan_id,
          hasil: unit.inspection.hasil,
          kelengkapan_status: unit.inspection.kelengkapan_status,
          keputusan_operasional: unit.inspection.keputusan_operasional,
          diperiksa_at: unit.inspection.diperiksa_at,
        }
      : null,
  }));

  return {
    ...legacyWorkspace,
    rental: {
      ...legacyWorkspace.rental,
      ...raw.rental,
    },
    renter: raw.renter,
    units,
    returnRecords: legacyWorkspace.returnRecords,
    operational_units: raw.units,
  };
}

export async function processOperationalUnitReturn(
  usahaId: string,
  input: {
    rentalId: string;
    unitBarangId: string;
    inspection: OperationalReturnInspectionInput;
    expectedRentalUpdatedAt: string;
    note?: string | null;
  },
  options: {
    idempotencyKey?: string;
    requestId?: string;
  } = {},
): Promise<OperationalReturnCommandResult> {
  const idempotencyKey = options.idempotencyKey ?? `operational-return-${input.unitBarangId}-${createClientId()}`;
  const { data, error } = await supabase.rpc("command_operational_process_unit_return", {
    p_usaha_id: usahaId,
    p_penyewaan_id: input.rentalId,
    p_unit_barang_id: input.unitBarangId,
    p_hasil: input.inspection.hasil,
    p_kelengkapan_status: input.inspection.kelengkapanStatus,
    p_keputusan_operasional: input.inspection.keputusanOperasional,
    p_catatan: input.inspection.catatan?.trim() || input.note?.trim() || null,
    p_findings: input.inspection.findings,
    p_idempotency_key: idempotencyKey,
    p_request_id: options.requestId ?? createClientId(),
    p_expected_rental_updated_at: input.expectedRentalUpdatedAt,
  });

  if (!error && data) return data as OperationalReturnCommandResult;
  if (error) throw error;
  throw new Error("Pengembalian operasional gagal: server tidak mengembalikan hasil command.");
}

export async function processOperationalUnitReturns(
  usahaId: string,
  input: {
    rentalId: string;
    units: Array<{ unitBarangId: string; inspection: OperationalReturnInspectionInput }>;
    note?: string | null;
  },
  options: {
    onProgress?: (progress: { index: number; total: number; unitBarangId: string }) => void;
  } = {},
): Promise<OperationalReturnBatchResult> {
  const processed: OperationalReturnBatchItem[] = [];
  if (!input.units.length) {
    return { state: "failed", processed, error: "Pilih kondisi minimal satu unit sebelum memproses." };
  }

  let currentWorkspace: OperationalReturnWorkspace;
  try {
    // Reconcile against the server's current state before starting a sequential run.
    currentWorkspace = await getOperationalReturnWorkspace(usahaId, input.rentalId);
  } catch (error) {
    return {
      state: "failed",
      processed,
      failedUnitId: input.units[0].unitBarangId,
      error: describeOperationalError(error, "Status unit belum dapat diverifikasi sebelum proses dimulai."),
      // No write has been issued yet, so the outcome is known and safe to retry.
      unknownOutcome: false,
    };
  }

  for (let index = 0; index < input.units.length; index += 1) {
    const selected = input.units[index];
    options.onProgress?.({ index: index + 1, total: input.units.length, unitBarangId: selected.unitBarangId });

    let currentUnit = currentWorkspace.operational_units.find(
      (unit) => unit.unit_barang_id === selected.unitBarangId,
    );
    if (!currentUnit) {
      return {
        state: processed.length ? "partial" : "failed",
        processed,
        failedUnitId: selected.unitBarangId,
        error: "Unit tidak ditemukan pada status operasional terbaru. Muat ulang sebelum melanjutkan.",
      };
    }

    // Another admin may have finished the selected unit after this page was opened.
    // Never issue another command for a unit already returned and inspected.
    if (currentUnit.return && currentUnit.inspection) {
      processed.push({ unitBarangId: selected.unitBarangId, reconciled: true });
      continue;
    }
    if (currentUnit.return || currentUnit.unit_status !== "rented") {
      return {
        state: processed.length ? "partial" : "failed",
        processed,
        failedUnitId: selected.unitBarangId,
        error: "Unit " + selected.unitBarangId + " belum berada pada state rented yang valid untuk dikembalikan.",
      };
    }

    try {
      const result = await processOperationalUnitReturn(
        usahaId,
        {
          rentalId: input.rentalId,
          unitBarangId: selected.unitBarangId,
          inspection: selected.inspection,
          expectedRentalUpdatedAt: currentWorkspace.rental.updated_at,
          note: input.note,
        },
        {
          idempotencyKey: "operational-return-" + input.rentalId + "-" + selected.unitBarangId + "-" + createClientId(),
          requestId: createClientId(),
        },
      );
      processed.push({ unitBarangId: selected.unitBarangId, result });
    } catch (error) {
      const message = describeOperationalError(error, "Pengembalian unit gagal.");
      try {
        currentWorkspace = await getOperationalReturnWorkspace(usahaId, input.rentalId);
        currentUnit = currentWorkspace.operational_units.find(
          (unit) => unit.unit_barang_id === selected.unitBarangId,
        );
        if (currentUnit?.return && currentUnit.inspection) {
          // The command may have committed even when its response was lost.
          // The source-of-truth read proves completion, so skip replay and continue.
          processed.push({ unitBarangId: selected.unitBarangId, reconciled: true });
          continue;
        }
        return {
          state: processed.length ? "partial" : "failed",
          processed,
          failedUnitId: selected.unitBarangId,
          error: message,
          unknownOutcome: message.includes("UNKNOWN_OUTCOME"),
        };
      } catch {
        return {
          state: processed.length ? "partial" : "failed",
          processed,
          failedUnitId: selected.unitBarangId,
          error: "UNKNOWN_OUTCOME: hasil per unit belum dapat dipastikan karena status server gagal dibaca. Jangan ulangi sampai status unit diverifikasi.",
          unknownOutcome: true,
        };
      }
    }

    try {
      // Refresh the optimistic concurrency token before processing the next unit.
      currentWorkspace = await getOperationalReturnWorkspace(usahaId, input.rentalId);
    } catch {
      return {
        state: "partial",
        processed,
        failedUnitId: input.units[index + 1]?.unitBarangId,
        error: "Unit terakhir telah diproses, tetapi status rental terbaru belum dapat dimuat. Verifikasi status sebelum melanjutkan.",
        unknownOutcome: false,
      };
    }
  }

  return { state: "completed", processed };
}
export function getOperationalReturnContract() {
  return {
    operation: "receive_inspect_restore",
    domainSequence: ["return", "inspection", "maintenance_if_required", "readiness"],
    returnIsNotReady: true,
    inspectionIsNotReady: true,
    maintenanceIsNotInspection: true,
    readyRequiresServerDecision: true,
    partialReturnAllowed: true,
    perUnitMutation: true,
    batchMutationIsSequentialNotAtomic: true,
    unknownOutcomeRequiresSourceReRead: true,
  } as const;
}
