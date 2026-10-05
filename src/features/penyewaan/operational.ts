import { supabase } from "@/app/providers/supabase/client";
import { createClientId } from "@/lib/client-id";
import type { RentalDetail, RentalTenantContext } from "./types";

export type OperationalRentalWorkspaceLineAssignment = {
  penetapan_unit_id: string;
  unit_barang_id: string;
  kode_unit: string;
  status: string;
  komponen_penyewaan_id: string | null;
  asal_pilihan_unit_id: string | null;
  alasan_substitusi: string | null;
};

export type OperationalRentalWorkspaceLine = {
  detail_penyewaan_id: string;
  barang_id: string | null;
  barang_nama: string | null;
  varian_barang_id: string | null;
  varian_nama: string | null;
  paket_sewa_id: string | null;
  paket_nama: string | null;
  jumlah: number | string;
  unit_price: number | string;
  currency_code: string;
  subtotal: number | string;
  catatan: string | null;
  assignments: OperationalRentalWorkspaceLineAssignment[];
};

export type OperationalRentalWorkspacePayment = {
  pembayaran_id: string;
  nomor_pembayaran: string;
  jenis: string;
  metode: string;
  amount: number | string;
  currency_code: string;
  dibayar_at: string;
  status: string;
  reference_text: string | null;
};

export type OperationalRentalWorkspace = {
  rental: Pick<
    RentalDetail,
    | "penyewaan_id"
    | "usaha_id"
    | "nomor_penyewaan"
    | "jadwal_mulai"
    | "jadwal_kembali"
    | "tolerance_deadline"
    | "actual_pickup_at"
    | "actual_return_started_at"
    | "actual_return_completed_at"
    | "status"
    | "total_amount"
    | "currency_code"
    | "catatan"
    | "created_at"
    | "updated_at"
  >;
  renter: {
    penyewa_id: string;
    nama_lengkap: string;
    nomor_telepon: string | null;
  };
  lines: OperationalRentalWorkspaceLine[];
  payments: OperationalRentalWorkspacePayment[];
};

export type OperationalActivationResult = {
  penyewaan_id: string;
  status: string;
  actual_pickup_at: string | null;
  assigned_now: number;
  already_active?: boolean;
  handover?: Record<string, unknown>;
  recovered_from_state_check?: boolean;
};

function isUncertainMutationError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("unknown_outcome") ||
    message.includes("timeout") ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("fetch")
  );
}

function activationFromWorkspace(workspace: OperationalRentalWorkspace): OperationalActivationResult | null {
  if (workspace.rental.status !== "active" || !workspace.rental.actual_pickup_at) return null;
  return {
    penyewaan_id: workspace.rental.penyewaan_id,
    status: workspace.rental.status,
    actual_pickup_at: workspace.rental.actual_pickup_at,
    assigned_now: 0,
    already_active: true,
    recovered_from_state_check: true,
  };
}

export async function getOperationalRentalWorkspace(
  usahaId: string,
  penyewaanId: string,
): Promise<OperationalRentalWorkspace> {
  const { data, error } = await supabase.rpc("get_operational_rental_workspace", {
    p_usaha_id: usahaId,
    p_penyewaan_id: penyewaanId,
  });
  if (error) throw error;
  if (!data) throw new Error("Workspace operasional penyewaan tidak mengembalikan data.");
  return data as OperationalRentalWorkspace;
}

export async function activateRentalOperational(
  usahaId: string,
  penyewaanId: string,
  options: {
    catatan?: string | null;
    idempotencyKey?: string;
    requestId?: string;
  } = {},
): Promise<OperationalActivationResult> {
  const idempotencyKey = options.idempotencyKey ?? `activate-rental-operational-${penyewaanId}-${createClientId()}`;
  const requestId = options.requestId ?? createClientId();

  const { data, error } = await supabase.rpc("command_operational_activate_rental", {
    p_usaha_id: usahaId,
    p_penyewaan_id: penyewaanId,
    p_catatan: options.catatan?.trim() || null,
    p_idempotency_key: idempotencyKey,
    p_request_id: requestId,
  });

  if (!error && data) return data as OperationalActivationResult;

  if (!isUncertainMutationError(error)) {
    if (error) throw error;
    throw new Error("Aktivasi rental gagal: server tidak mengembalikan hasil command.");
  }

  const workspace = await getOperationalRentalWorkspace(usahaId, penyewaanId);
  const recovered = activationFromWorkspace(workspace);
  if (recovered) return recovered;

  throw new Error(
    "UNKNOWN_OUTCOME: aktivasi rental belum dapat dipastikan. State terbaru belum menunjukkan rental aktif; jangan retry mutation sebelum diverifikasi.",
  );
}

export function getOperationalRentalActivationContract(
  context: RentalTenantContext,
  rental: RentalDetail,
) {
  return {
    operation: "activate_rental",
    tenant: context.usahaId,
    rentalId: rental.penyewaan_id,
    domainSequence: ["assignment", "handover", "active"],
    serverAuthority: true,
    autoAssignmentDefault: true,
    manualAssignmentExceptionAllowed: true,
    paymentDoesNotActivateRental: true,
    toleranceDoesNotExtendSchedule: true,
    lateFeeDoesNotCreatePaymentAutomatically: true,
  } as const;
}
