import { beforeEach, describe, expect, test, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: { rpc: rpcMock },
}));

import {
  applyAkashaSmartBookingItemChange,
  checkoutAkashaSmartBooking,
  getAkashaSmartBookingSummary,
  listAkashaSmartBookings,
  resolveAkashaSmartBookingChange,
  rotateAkashaSmartBookingAccess,
  setAkashaSmartBookingStatus,
} from "@/features/akasha-smart-booking/service";

describe("AKASHA SMART BOOKING admin service contract", () => {
  beforeEach(() => rpcMock.mockReset());

  test("queue summary stays within the selected business scope", async () => {
    const summary = { total: 3, received: 1, inventory_is_reserved: false };
    rpcMock.mockResolvedValue({ data: summary, error: null });
    await expect(getAkashaSmartBookingSummary("usaha-1")).resolves.toEqual(summary);
    expect(rpcMock).toHaveBeenCalledWith("admin_get_akasha_smart_booking_summary", { p_usaha_id: "usaha-1" });
  });

  test("queue filters normalize all-status and whitespace before server pagination", async () => {
    rpcMock.mockResolvedValue({ data: { items: [], total: 0, limit: 25, offset: 50 }, error: null });
    await listAkashaSmartBookings({
      usahaId: "usaha-1", status: "all", pickupFrom: "2026-11-01", pickupUntil: "2026-11-30",
      search: "  REF-001  ", limit: 25, offset: 50,
    });
    expect(rpcMock).toHaveBeenCalledWith("admin_list_akasha_smart_bookings", {
      p_usaha_id: "usaha-1", p_status: null, p_pickup_from: "2026-11-01", p_pickup_until: "2026-11-30",
      p_search: "REF-001", p_limit: 25, p_offset: 50,
    });
  });

  test("item approval carries optimistic revision, idempotency and audit notes", async () => {
    const result = { request_status: "applied", revision: 8, inventory_effect: "none" };
    rpcMock.mockResolvedValue({ data: result, error: null });
    await expect(applyAkashaSmartBookingItemChange({
      changeRequestId: "change-1", expectedRevision: 7, idempotencyKey: "apply-change-1",
      resolutionNote: "Approved after review", publicResolutionNote: "Perubahan barang disetujui.",
    })).resolves.toEqual(result);
    expect(rpcMock).toHaveBeenCalledWith("admin_apply_akasha_smart_booking_item_change", {
      p_change_request_id: "change-1", p_expected_revision: 7, p_idempotency_key: "apply-change-1",
      p_resolution_note: "Approved after review", p_public_resolution_note: "Perubahan barang disetujui.",
    });
  });

  test("schedule resolution sends approved dates through the Smart Booking command", async () => {
    rpcMock.mockResolvedValue({ data: { request_status: "applied", revision: 9 }, error: null });
    await resolveAkashaSmartBookingChange({
      changeRequestId: "schedule-1", decision: "approved", expectedRevision: 8,
      schedulePayload: {
        requested_pickup_date: "2026-11-15", requested_return_date: "2026-11-17",
        requested_pickup_at: null, requested_return_at: null,
      },
    });
    expect(rpcMock).toHaveBeenCalledWith("admin_resolve_akasha_smart_booking_change", {
      p_change_request_id: "schedule-1", p_decision: "approved", p_expected_revision: 8,
      p_resolution_note: null, p_public_resolution_note: null,
      p_schedule_payload: {
        requested_pickup_date: "2026-11-15", requested_return_date: "2026-11-17",
        requested_pickup_at: null, requested_return_at: null,
      },
    });
  });

  test("status transitions carry the expected revision and customer-facing note", async () => {
    rpcMock.mockResolvedValue({ data: { workflow_status: "ready_for_checkout", revision: 10 }, error: null });
    await setAkashaSmartBookingStatus({
      smartBookingId: "booking-1", targetStatus: "ready_for_checkout", expectedRevision: 9,
      note: "Item dan jadwal telah ditinjau.",
    });
    expect(rpcMock).toHaveBeenCalledWith("admin_set_akasha_smart_booking_status", {
      p_smart_booking_id: "booking-1", p_target_status: "ready_for_checkout",
      p_expected_revision: 9, p_note: "Item dan jadwal telah ditinjau.",
    });
  });

  test("credential rotation requests a fresh code and private link through a keyed command", async () => {
    const result = {
      smart_booking_id: "booking-1", credential_version: 2, access_code: "AKS12345",
      portal_link_token: "a".repeat(64), expires_at: "2027-01-01T00:00:00.000Z",
    };
    rpcMock.mockResolvedValue({ data: result, error: null });
    await expect(rotateAkashaSmartBookingAccess("booking-1", "rotate-booking-1")).resolves.toEqual(result);
    expect(rpcMock).toHaveBeenCalledWith("admin_rotate_akasha_smart_booking_access", {
      p_smart_booking_id: "booking-1", p_idempotency_key: "rotate-booking-1",
    });
  });

  test("operational checkout normalizes product, variant, package and sale targets", async () => {
    rpcMock.mockResolvedValue({ data: { workflow_status: "fulfilled", inventory_revalidated: true }, error: null });
    await checkoutAkashaSmartBooking({
      smartBookingId: "booking-1", expectedRevision: 10,
      pickupAt: "2026-11-15T02:00:00.000Z", returnAt: "2026-11-16T02:00:00.000Z",
      rentalLines: [
        { barang_id: "product-1", tarif_sewa_id: "tariff-1", duration_periods: 1, jumlah: 2, unit_price: 25000, subtotal: 50000, currency_code: "IDR" },
        { varian_barang_id: "variant-1", tarif_sewa_id: "tariff-2", duration_periods: 1, jumlah: 1, unit_price: 30000, subtotal: 30000, currency_code: "IDR" },
        { paket_sewa_id: "package-1", tarif_sewa_id: "tariff-3", duration_periods: 1, jumlah: 1, unit_price: 60000, subtotal: 60000, currency_code: "IDR" },
      ],
      saleLines: [{ barang_id: "sale-product-1", jumlah: 1 }], accountId: "account-1",
      idempotencyKey: "checkout-booking-1", requestId: "request-booking-1",
    });
    expect(rpcMock).toHaveBeenCalledWith("admin_checkout_akasha_smart_booking", expect.objectContaining({
      p_smart_booking_id: "booking-1", p_expected_revision: 10,
      p_rental_lines: [
        expect.objectContaining({ barang_id: "product-1", varian_barang_id: null, paket_sewa_id: null }),
        expect.objectContaining({ barang_id: null, varian_barang_id: "variant-1", paket_sewa_id: null }),
        expect.objectContaining({ barang_id: null, varian_barang_id: null, paket_sewa_id: "package-1" }),
      ],
      p_sale_lines: [{ barang_id: "sale-product-1", varian_barang_id: null, jumlah: 1, is_bonus_rental: false, bonus_reason: null }],
      p_akun_keuangan_id: "account-1", p_discount_request: { mode: "none" },
      p_idempotency_key: "checkout-booking-1", p_request_id: "request-booking-1", p_activate_rental: false,
    }));
  });

  test("checkout rejects ambiguous item targets before calling the backend", async () => {
    await expect(checkoutAkashaSmartBooking({
      smartBookingId: "booking-1", expectedRevision: 1,
      rentalLines: [{
        barang_id: "product-1", varian_barang_id: "variant-1", tarif_sewa_id: "tariff-1",
        duration_periods: 1, jumlah: 1, unit_price: 10000, subtotal: 10000,
      }],
      saleLines: [], idempotencyKey: "checkout-invalid-target", requestId: "request-invalid-target",
    })).rejects.toThrow("Setiap baris rental harus menunjuk tepat satu barang, varian, atau paket.");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("RPC failures preserve server error details for operator feedback", async () => {
    rpcMock.mockResolvedValue({
      data: null, error: { message: "AUTHORIZATION_ERROR", details: "reservation.amend is not granted" },
    });
    await expect(getAkashaSmartBookingSummary("usaha-1")).rejects.toThrow(
      "AUTHORIZATION_ERROR · reservation.amend is not granted",
    );
  });
});
