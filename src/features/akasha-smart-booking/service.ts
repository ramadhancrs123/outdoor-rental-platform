import { createClientId } from "@/lib/client-id"
import { supabase } from "@/app/providers/supabase/client"
import type {
  AkashaSmartBookingDetail,
  AkashaSmartBookingListResult,
  AkashaSmartBookingStatus,
  AkashaSmartBookingSummary,
} from "./types"

type RpcError = { message?: string; details?: string; hint?: string; code?: string } | null

function throwRpcError(error: RpcError, fallback: string): never {
  const parts = [error?.message, error?.details, error?.hint].filter(Boolean)
  throw new Error(parts.join(" · ") || fallback)
}

async function rpc<T>(
  name: string,
  payload: Record<string, unknown>,
  fallback: string,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, payload as never)
  if (error) throwRpcError(error, fallback)
  if (data == null) throw new Error(fallback)
  return data as T
}

export async function getAkashaSmartBookingSummary(
  usahaId: string,
): Promise<AkashaSmartBookingSummary> {
  return rpc(
    "admin_get_akasha_smart_booking_summary",
    { p_usaha_id: usahaId },
    "Ringkasan booking online gagal dimuat.",
  )
}

export async function listAkashaSmartBookings(input: {
  usahaId: string
  status?: AkashaSmartBookingStatus | "all"
  pickupFrom?: string | null
  pickupUntil?: string | null
  search?: string
  limit?: number
  offset?: number
}): Promise<AkashaSmartBookingListResult> {
  return rpc(
    "admin_list_akasha_smart_bookings",
    {
      p_usaha_id: input.usahaId,
      p_status: input.status && input.status !== "all" ? input.status : null,
      p_pickup_from: input.pickupFrom ?? null,
      p_pickup_until: input.pickupUntil ?? null,
      p_search: input.search?.trim() || null,
      p_limit: input.limit ?? 50,
      p_offset: input.offset ?? 0,
    },
    "Daftar AKASHA SMART BOOKING gagal dimuat.",
  )
}

export async function getAkashaSmartBooking(
  smartBookingId: string,
): Promise<AkashaSmartBookingDetail> {
  return rpc(
    "admin_get_akasha_smart_booking",
    { p_smart_booking_id: smartBookingId },
    "Detail booking tidak dapat dimuat.",
  )
}

export async function setAkashaSmartBookingStatus(input: {
  smartBookingId: string
  targetStatus: Exclude<AkashaSmartBookingStatus, "received" | "change_requested" | "cancellation_pending" | "fulfilled">
  expectedRevision: number
  note?: string | null
}) {
  return rpc<{
    smart_booking_id: string
    workflow_status: AkashaSmartBookingStatus
    revision: number
  }>(
    "admin_set_akasha_smart_booking_status",
    {
      p_smart_booking_id: input.smartBookingId,
      p_target_status: input.targetStatus,
      p_expected_revision: input.expectedRevision,
      p_note: input.note ?? null,
    },
    "Status booking gagal diperbarui.",
  )
}

export async function resolveAkashaSmartBookingChange(input: {
  changeRequestId: string
  decision: "approved" | "rejected"
  expectedRevision: number
  resolutionNote?: string | null
  publicResolutionNote?: string | null
  schedulePayload?: {
    requested_pickup_date?: string
    requested_return_date?: string
    requested_pickup_at?: string | null
    requested_return_at?: string | null
  } | null
}) {
  return rpc<{
    request_id: string
    request_status: "approved" | "rejected" | "applied"
    workflow_status: AkashaSmartBookingStatus
    revision: number
  }>(
    "admin_resolve_akasha_smart_booking_change",
    {
      p_change_request_id: input.changeRequestId,
      p_decision: input.decision,
      p_expected_revision: input.expectedRevision,
      p_resolution_note: input.resolutionNote ?? null,
      p_public_resolution_note: input.publicResolutionNote ?? null,
      p_schedule_payload: input.schedulePayload ?? null,
    },
    "Permintaan perubahan booking gagal diselesaikan.",
  )
}

export async function applyAkashaSmartBookingItemChange(input: {
  changeRequestId: string
  expectedRevision: number
  idempotencyKey: string
  resolutionNote?: string | null
  publicResolutionNote?: string | null
}) {
  return rpc<{
    smart_booking_id: string
    request_id: string
    request_status: "applied"
    workflow_status: AkashaSmartBookingStatus
    revision: number
    line_count: number
    quote_total: number
    currency_code: string
    inventory_effect: "none"
  }>(
    "admin_apply_akasha_smart_booking_item_change",
    {
      p_change_request_id: input.changeRequestId,
      p_expected_revision: input.expectedRevision,
      p_idempotency_key: input.idempotencyKey,
      p_resolution_note: input.resolutionNote ?? null,
      p_public_resolution_note: input.publicResolutionNote ?? null,
    },
    "Perubahan barang booking gagal diterapkan.",
  )
}

export async function rotateAkashaSmartBookingAccess(
  smartBookingId: string,
  idempotencyKey = "smart-booking-access-" + createClientId(),
) {
  return rpc<{
    smart_booking_id: string
    credential_version: number
    expires_at: string
    access_code: string
    portal_link_token?: string | null
  }>(
    "admin_rotate_akasha_smart_booking_access",
    {
      p_smart_booking_id: smartBookingId,
      p_idempotency_key: idempotencyKey,
    },
    "Kode akses customer gagal diperbarui.",
  )
}


export type AkashaSmartBookingCheckoutResult = {
  smart_booking_id: string
  reference_code: string
  workflow_status: "fulfilled"
  revision: number
  penyewaan_id: string | null
  penjualan_id: string | null
  checkout_id: string | null
  transaction_result: Record<string, unknown>
  inventory_revalidated: true
  stock_lock_created: false
}

export async function checkoutAkashaSmartBooking(input: {
  smartBookingId: string
  expectedRevision: number
  pickupAt?: string | null
  returnAt?: string | null
  rentalLines: Array<{
    barang_id?: string | null
    varian_barang_id?: string | null
    paket_sewa_id?: string | null
    tarif_sewa_id: string
    duration_periods: number
    jumlah: number
    unit_price: number
    subtotal: number
    currency_code?: "IDR"
    catatan?: string | null
  }>
  saleLines: Array<{
    barang_id?: string | null
    varian_barang_id?: string | null
    jumlah: number
  }>
  accountId?: string | null
  paymentMethod?: string
  paymentRentalAmount?: number
  note?: string | null
  discountRequest?: Record<string, unknown>
  idempotencyKey: string
  requestId: string
  activateRental?: boolean
}) {
  const rentalLines = input.rentalLines.map((line) => {
    const hasPackage = Boolean(line.paket_sewa_id)
    const hasVariant = Boolean(line.varian_barang_id)
    const hasProduct = Boolean(line.barang_id)
    if (Number(hasPackage) + Number(hasVariant) + Number(hasProduct) !== 1) {
      throw new Error("Setiap baris rental harus menunjuk tepat satu barang, varian, atau paket.")
    }
    return {
      ...line,
      barang_id: hasPackage || hasVariant ? null : line.barang_id ?? null,
      varian_barang_id: hasVariant ? line.varian_barang_id ?? null : null,
      paket_sewa_id: hasPackage ? line.paket_sewa_id ?? null : null,
    }
  })

  const saleLines = input.saleLines.map((line) => {
    if (Number(Boolean(line.barang_id)) + Number(Boolean(line.varian_barang_id)) !== 1) {
      throw new Error("Setiap pembelian harus menunjuk satu barang atau varian.")
    }
    return {
      barang_id: line.varian_barang_id ? null : line.barang_id ?? null,
      varian_barang_id: line.varian_barang_id ?? null,
      jumlah: line.jumlah,
      is_bonus_rental: false,
      bonus_reason: null,
    }
  })

  return rpc<AkashaSmartBookingCheckoutResult>(
    "admin_checkout_akasha_smart_booking",
    {
      p_smart_booking_id: input.smartBookingId,
      p_expected_revision: input.expectedRevision,
      p_jadwal_mulai: input.pickupAt ?? null,
      p_jadwal_kembali: input.returnAt ?? null,
      p_rental_lines: rentalLines,
      p_sale_lines: saleLines,
      p_akun_keuangan_id: input.accountId ?? null,
      p_metode: input.paymentMethod ?? "cash",
      p_payment_rental_amount: input.paymentRentalAmount ?? 0,
      p_dibayar_at: null,
      p_catatan: input.note ?? null,
      p_discount_request: input.discountRequest ?? { mode: "none" },
      p_idempotency_key: input.idempotencyKey,
      p_request_id: input.requestId,
      p_activate_rental: input.activateRental === true,
    },
    "Konversi booking menjadi transaksi operasional gagal.",
  )
}

export async function getAkashaSmartBookingConversion(smartBookingId: string) {
  const { data, error } = await supabase.rpc("admin_get_akasha_smart_booking_conversion", {
    p_smart_booking_id: smartBookingId,
  })
  if (error) throwRpcError(error, "Referensi transaksi booking gagal dimuat.")
  return data as {
    smart_booking_id: string
    converted_at: string
    source_command:
      | "mixed_checkout"
      | "mixed_checkout_and_activate"
      | "direct_rental"
      | "direct_rental_and_activate"
      | "sale"
    checkout_id: string | null
    checkout_number: string | null
    rental_id: string | null
    rental_number: string | null
    sale_id: string | null
    sale_number: string | null
  } | null
}

export async function getAkashaSmartBookingAvailability(
  smartBookingId: string,
) {
  return rpc<import("./types").AkashaSmartBookingAvailability>(
    "admin_get_akasha_smart_booking_availability",
    { p_smart_booking_id: smartBookingId },
    "Proyeksi ketersediaan booking tidak dapat dimuat.",
  )
}
