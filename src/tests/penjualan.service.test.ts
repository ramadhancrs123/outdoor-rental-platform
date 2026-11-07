import { beforeEach, describe, expect, test, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: { rpc: rpcMock },
}));

import { createMixedCheckout, createSale } from "@/features/penjualan/service";

describe("POS sale commands", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  test("uses registered renter command when a tenant renter is selected", async () => {
    rpcMock.mockResolvedValue({
      data: {
        penjualan_id: "sale-1",
        nomor_penjualan: "POS-2026-0001",
        total_amount: 50000,
        payment_status: "paid",
      },
      error: null,
    });

    await expect(createSale("usaha-1", {
      penyewaId: "renter-1",
      namaPelanggan: "Alya",
      nomorTelepon: "08123456789",
      lines: [{ barang_id: "product-1", varian_barang_id: null, jumlah: 2 }],
      akunKeuanganId: "cash-1",
      metode: "cash",
    }, {
      idempotencyKey: "sale-renter-1",
      requestId: "sale-request-1",
    })).resolves.toMatchObject({ penjualan_id: "sale-1" });

    expect(rpcMock).toHaveBeenCalledWith("command_create_sale_with_renter", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_penyewa_id: "renter-1",
      p_nama_pelanggan: "Alya",
      p_nomor_telepon: "08123456789",
      p_akun_keuangan_id: "cash-1",
      p_idempotency_key: "sale-renter-1",
      p_request_id: "sale-request-1",
    }));
  });

  test("submits rental and retail lines together through the mixed checkout command", async () => {
    rpcMock.mockResolvedValue({
      data: {
        checkout_id: "checkout-1",
        nomor_checkout: "CHK-2026-0001",
        penjualan_id: "sale-1",
        nomor_penjualan: "POS-2026-0001",
        penyewaan_id: "rental-1",
        nomor_penyewaan: "RNT-2026-0001",
        subtotal_rental: 25000,
        subtotal_penjualan: 10000,
        total_amount: 35000,
        total_hpp: 4000,
        gross_profit: 31000,
        amount_paid: 0,
        payment_status: "unpaid",
        penjualan_pembayaran_id: "payment-1",
        transaksi_keuangan_id: "transaction-1",
        status: "completed",
      },
      error: null,
    });

    await expect(createMixedCheckout("usaha-1", {
      penyewaId: "renter-1",
      jadwalMulai: "2026-11-06T02:00:00.000Z",
      jadwalKembali: "2026-11-07T02:00:00.000Z",
      rentalLines: [
        {
          barang_id: "tripod-1",
          tarif_sewa_id: "tariff-tripod",
          duration_periods: 1,
          jumlah: 1,
          unit_price: 25000,
          subtotal: 25000,
        },
        {
          barang_id: "carrier-parent",
          varian_barang_id: "carrier-variant-45l",
          tarif_sewa_id: "tariff-carrier-45l",
          duration_periods: 1,
          jumlah: 1,
          unit_price: 10000,
          subtotal: 10000,
        },
      ],
      saleLines: [
        { barang_id: "jas-hujan-1", varian_barang_id: null, jumlah: 1 },
        { barang_id: "carrier-1", varian_barang_id: "carrier-variant-45l", jumlah: 2 },
      ],
      akunKeuanganId: "cash-1",
      metode: "cash",
      catatan: "Barang tambahan dibeli pada pembuatan rental.",
    }, {
      idempotencyKey: "mixed-checkout-1",
      requestId: "mixed-request-1",
      discountRequest: {
        mode: "manual",
        amount: 5000,
        reason_code: "service_recovery",
        reason_note: "Keterlambatan layanan",
      },
    })).resolves.toMatchObject({
      penyewaan_id: "rental-1",
      penjualan_id: "sale-1",
      subtotal_rental: 25000,
      subtotal_penjualan: 10000,
      total_amount: 35000,
    });

    expect(rpcMock).toHaveBeenCalledWith("command_create_mixed_checkout_with_discount", {
      p_usaha_id: "usaha-1",
      p_penyewa_id: "renter-1",
      p_jadwal_mulai: "2026-11-06T02:00:00.000Z",
      p_jadwal_kembali: "2026-11-07T02:00:00.000Z",
      p_rental_lines: [
        {
          barang_id: "tripod-1",
          varian_barang_id: null,
          paket_sewa_id: null,
          tarif_sewa_id: "tariff-tripod",
          duration_periods: 1,
          jumlah: 1,
          unit_price: 25000,
          subtotal: 25000,
        },
        {
          barang_id: null,
          varian_barang_id: "carrier-variant-45l",
          paket_sewa_id: null,
          tarif_sewa_id: "tariff-carrier-45l",
          duration_periods: 1,
          jumlah: 1,
          unit_price: 10000,
          subtotal: 10000,
        },
      ],
      p_sale_lines: [
        { barang_id: "jas-hujan-1", varian_barang_id: null, jumlah: 1, is_bonus_rental: false, bonus_reason: null },
        { barang_id: null, varian_barang_id: "carrier-variant-45l", jumlah: 2, is_bonus_rental: false, bonus_reason: null },
      ],
      p_akun_keuangan_id: "cash-1",
      p_metode: "cash",
      p_payment_rental_amount: 0,
      p_dibayar_at: null,
      p_catatan: "Barang tambahan dibeli pada pembuatan rental.",
      p_discount_request: {
        mode: "manual",
        amount: 5000,
        reason_code: "service_recovery",
        reason_note: "Keterlambatan layanan",
      },
      p_idempotency_key: "mixed-checkout-1",
      p_request_id: "mixed-request-1",
    });
  });

  test("allows a bonus-only mixed checkout without a cash account and preserves its audit reason", async () => {
    rpcMock.mockResolvedValue({
      data: {
        checkout_id: "checkout-bonus-only",
        nomor_checkout: "CK-2026-0040",
        penjualan_id: "sale-bonus-only",
        nomor_penjualan: "POS-2026-0040",
        penyewaan_id: "rental-bonus-only",
        nomor_penyewaan: "RNT-2026-0040",
        subtotal_rental: 25000,
        subtotal_penjualan: 0,
        total_amount: 25000,
        total_hpp: 5000,
        gross_profit: 0,
        amount_paid: 0,
        payment_status: "unpaid",
        status: "completed",
      },
      error: null,
    });

    await createMixedCheckout("usaha-1", {
      penyewaId: "renter-1",
      jadwalMulai: "2026-11-06T02:00:00.000Z",
      jadwalKembali: "2026-11-07T02:00:00.000Z",
      rentalLines: [{
        barang_id: "tent-1",
        tarif_sewa_id: "tariff-1",
        duration_periods: 1,
        jumlah: 1,
        unit_price: 25000,
        subtotal: 25000,
      }],
      saleLines: [{
        barang_id: "raincoat-1",
        varian_barang_id: null,
        jumlah: 1,
        is_bonus_rental: true,
        bonus_reason: "Bonus paket family",
      }],
      akunKeuanganId: null,
      metode: "cash",
    }, { idempotencyKey: "mixed-bonus-only-1", requestId: "mixed-bonus-only-request-1" });

    expect(rpcMock).toHaveBeenCalledWith("command_create_mixed_checkout_with_discount", expect.objectContaining({
      p_akun_keuangan_id: null,
      p_sale_lines: [{
        barang_id: "raincoat-1",
        varian_barang_id: null,
        jumlah: 1,
        is_bonus_rental: true,
        bonus_reason: "Bonus paket family",
      }],
      p_discount_request: { mode: "none" },
    }));
  });

  test("uses atomic mixed checkout and activation for the Langsung Sewa mode", async () => {
    rpcMock.mockResolvedValue({
      data: {
        checkout_id: "checkout-direct-1",
        nomor_checkout: "CHK-2026-0002",
        penjualan_id: "sale-direct-1",
        nomor_penjualan: "POS-2026-0002",
        penyewaan_id: "rental-direct-1",
        nomor_penyewaan: "RNT-2026-0002",
        subtotal_rental: 25000,
        subtotal_penjualan: 10000,
        total_amount: 35000,
        total_hpp: 4000,
        gross_profit: 6000,
        amount_paid: 10000,
        payment_status: "partial",
        penjualan_pembayaran_id: "payment-direct-1",
        transaksi_keuangan_id: "transaction-direct-1",
        status: "completed",
        rental_activation: { status: "active", assigned_now: 1 },
      },
      error: null,
    });

    await createMixedCheckout("usaha-1", {
      penyewaId: "renter-1",
      jadwalMulai: "2026-11-06T02:00:00.000Z",
      jadwalKembali: "2026-11-07T02:00:00.000Z",
      rentalLines: [{
        barang_id: "carrier-parent",
        varian_barang_id: "carrier-variant-45l",
        tarif_sewa_id: "tariff-carrier-45l",
        duration_periods: 1,
        jumlah: 1,
        unit_price: 25000,
        subtotal: 25000,
      }],
      saleLines: [{ barang_id: "jas-hujan-1", varian_barang_id: null, jumlah: 1 }],
      akunKeuanganId: "cash-1",
      metode: "cash",
    }, {
      idempotencyKey: "mixed-direct-1",
      requestId: "mixed-direct-request-1",
      activateRental: true,
    });

    expect(rpcMock).toHaveBeenCalledWith("command_create_mixed_checkout_and_activate_with_discount", expect.objectContaining({
      p_idempotency_key: "mixed-direct-1",
      p_request_id: "mixed-direct-request-1",
      p_discount_request: { mode: "none" },
      p_rental_lines: [{
        barang_id: null,
        varian_barang_id: "carrier-variant-45l",
        paket_sewa_id: null,
        tarif_sewa_id: "tariff-carrier-45l",
        duration_periods: 1,
        jumlah: 1,
        unit_price: 25000,
        subtotal: 25000,
      }],
    }));
  });

  test("rejects rental lines with zero or multiple catalog targets before calling the RPC", async () => {
    const base = {
      tarif_sewa_id: "tariff-1",
      duration_periods: 1,
      jumlah: 1,
      unit_price: 10000,
      subtotal: 10000,
    };

    await expect(createMixedCheckout("usaha-1", {
      penyewaId: "renter-1",
      jadwalMulai: "2026-11-06T02:00:00.000Z",
      jadwalKembali: "2026-11-07T02:00:00.000Z",
      rentalLines: [{ ...base, barang_id: "product-1", paket_sewa_id: "package-1" }],
      saleLines: [{ barang_id: "sale-1", varian_barang_id: null, jumlah: 1 }],
      akunKeuanganId: "cash-1",
      metode: "cash",
    })).rejects.toThrow("tepat satu target katalog");

    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("keeps generic customer POS sales on the legacy command", async () => {
    rpcMock.mockResolvedValue({
      data: {
        penjualan_id: "sale-2",
        nomor_penjualan: "POS-2026-0002",
        total_amount: 25000,
        payment_status: "paid",
      },
      error: null,
    });

    await createSale("usaha-1", {
      lines: [{ barang_id: "refill-1", varian_barang_id: null, jumlah: 1 }],
      akunKeuanganId: "cash-1",
      metode: "cash",
    }, {
      idempotencyKey: "sale-generic-1",
      requestId: "sale-request-2",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_create_sale", expect.objectContaining({
      p_usaha_id: "usaha-1",
      p_nama_pelanggan: null,
      p_nomor_telepon: null,
      p_akun_keuangan_id: "cash-1",
      p_idempotency_key: "sale-generic-1",
      p_request_id: "sale-request-2",
    }));
  });
});
