import { describe, expect, test, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import {
  createPurchaseDraft,
  createSupplier,
  setSupplierStatus,
  updatePurchaseDraft,
  updateSupplier,
} from "@/features/pemasok/service";

describe("Pemasok & Pembelian trusted mutation service", () => {
  test("create supplier preserves tenant, idempotency, and request boundary", async () => {
    rpcMock.mockResolvedValue({
      data: {
        pemasok_id: "supplier-1",
        usaha_id: "usaha-1",
        nama: "Supplier Synthetic",
        status: "active",
      },
      error: null,
    });

    await expect(
      createSupplier(
        "usaha-1",
        {
          nama: "Supplier Synthetic",
          nomorTelepon: "081200000000",
          email: "supplier@example.test",
        },
        {
          idempotencyKey: "supplier-create-test",
          requestId: "request-supplier-create-test",
        },
      ),
    ).resolves.toMatchObject({
      pemasok_id: "supplier-1",
      usaha_id: "usaha-1",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_create_supplier", {
      p_usaha_id: "usaha-1",
      p_nama: "Supplier Synthetic",
      p_nomor_telepon: "081200000000",
      p_email: "supplier@example.test",
      p_alamat: null,
      p_catatan: null,
      p_idempotency_key: "supplier-create-test",
      p_request_id: "request-supplier-create-test",
    });
  });

  test("supplier update sends optimistic concurrency token", async () => {
    rpcMock.mockResolvedValue({
      data: {
        pemasok_id: "supplier-1",
        usaha_id: "usaha-1",
        nama: "Supplier Updated",
        status: "active",
      },
      error: null,
    });

    await expect(
      updateSupplier(
        "usaha-1",
        "supplier-1",
        {
          nama: "Supplier Updated",
          expectedUpdatedAt: "2026-09-29T00:00:00Z",
        },
        {
          idempotencyKey: "supplier-update-test",
          requestId: "request-supplier-update-test",
        },
      ),
    ).resolves.toMatchObject({
      pemasok_id: "supplier-1",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_update_supplier", {
      p_usaha_id: "usaha-1",
      p_pemasok_id: "supplier-1",
      p_nama: "Supplier Updated",
      p_nomor_telepon: null,
      p_email: null,
      p_alamat: null,
      p_catatan: null,
      p_expected_updated_at: "2026-09-29T00:00:00Z",
      p_idempotency_key: "supplier-update-test",
      p_request_id: "request-supplier-update-test",
    });
  });

  test("supplier status mutation uses explicit active/inactive state", async () => {
    rpcMock.mockResolvedValue({
      data: {
        pemasok_id: "supplier-1",
        usaha_id: "usaha-1",
        status: "inactive",
        updated_at: "2026-09-29T00:00:01Z",
      },
      error: null,
    });

    await expect(
      setSupplierStatus(
        "usaha-1",
        "supplier-1",
        "inactive",
        "2026-09-29T00:00:00Z",
        {
          idempotencyKey: "supplier-status-test",
          requestId: "request-supplier-status-test",
        },
      ),
    ).resolves.toMatchObject({
      status: "inactive",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_set_supplier_status", {
      p_usaha_id: "usaha-1",
      p_pemasok_id: "supplier-1",
      p_status: "inactive",
      p_expected_updated_at: "2026-09-29T00:00:00Z",
      p_idempotency_key: "supplier-status-test",
      p_request_id: "request-supplier-status-test",
    });
  });

  test("purchase draft normalizes line shape and delegates server-side money calculation", async () => {
    rpcMock.mockResolvedValue({
      data: {
        pembelian_id: "purchase-1",
        usaha_id: "usaha-1",
        status: "draft",
        total_amount: "250000.00",
        currency_code: "IDR",
        line_count: 1,
      },
      error: null,
    });

    await expect(
      createPurchaseDraft(
        "usaha-1",
        {
          pemasokId: "supplier-1",
          nomorPembelian: " PB-SYNTH-001 ",
          tanggalPembelian: "2026-09-29",
          lines: [
            {
              barangId: "barang-1",
              deskripsi: "Synthetic line",
              jumlah: "2",
              unitPrice: "125000.00",
            },
          ],
          catatan: "Synthetic purchase",
        },
        {
          idempotencyKey: "purchase-create-test",
          requestId: "request-purchase-create-test",
        },
      ),
    ).resolves.toMatchObject({
      pembelian_id: "purchase-1",
      status: "draft",
      total_amount: "250000.00",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_create_purchase", {
      p_usaha_id: "usaha-1",
      p_pemasok_id: "supplier-1",
      p_nomor_pembelian: "PB-SYNTH-001",
      p_tanggal_pembelian: "2026-09-29",
      p_lines: [
        {
          barang_id: "barang-1",
          varian_barang_id: null,
          deskripsi: "Synthetic line",
          jumlah: "2",
          unit_price: "125000.00",
        },
      ],
      p_catatan: "Synthetic purchase",
      p_idempotency_key: "purchase-create-test",
      p_request_id: "request-purchase-create-test",
    });
  });

  test("variant-targeted purchase normalizes to variant-only canonical target", async () => {
    rpcMock.mockResolvedValue({
      data: {
        pembelian_id: "purchase-variant-1",
        usaha_id: "usaha-1",
        status: "draft",
        total_amount: "300000.00",
        currency_code: "IDR",
        line_count: 1,
      },
      error: null,
    });

    await expect(
      createPurchaseDraft(
        "usaha-1",
        {
          pemasokId: "supplier-1",
          nomorPembelian: "PB-VARIANT-001",
          tanggalPembelian: "2026-10-01",
          lines: [
            {
              barangId: "barang-1",
              varianBarangId: "variant-1",
              deskripsi: "Tenda hijau",
              jumlah: "2",
              unitPrice: "150000",
            },
          ],
        },
        {
          idempotencyKey: "purchase-variant-test",
          requestId: "request-purchase-variant-test",
        },
      ),
    ).resolves.toMatchObject({ pembelian_id: "purchase-variant-1", status: "draft" });

    expect(rpcMock).toHaveBeenCalledWith("command_create_purchase", expect.objectContaining({
      p_lines: [{
        barang_id: null,
        varian_barang_id: "variant-1",
        deskripsi: "Tenda hijau",
        jumlah: "2",
        unit_price: "150000",
      }],
    }));
  });

  test("purchase draft unknown outcome reconciles before returning error", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: null,
        error: new Error("network timeout"),
      })
      .mockResolvedValueOnce({
        data: {
          state: "unknown",
          response: null,
        },
        error: null,
      });

    await expect(
      createPurchaseDraft(
        "usaha-1",
        {
          nomorPembelian: "PB-SYNTH-002",
          tanggalPembelian: "2026-09-29",
          lines: [],
        },
        {
          idempotencyKey: "purchase-unknown-test",
          requestId: "request-purchase-unknown-test",
        },
      ),
    ).rejects.toThrow("UNKNOWN_OUTCOME");

    expect(rpcMock).toHaveBeenNthCalledWith(1, "command_create_purchase", {
      p_usaha_id: "usaha-1",
      p_pemasok_id: null,
      p_nomor_pembelian: "PB-SYNTH-002",
      p_tanggal_pembelian: "2026-09-29",
      p_lines: [],
      p_catatan: null,
      p_idempotency_key: "purchase-unknown-test",
      p_request_id: "request-purchase-unknown-test",
    });

    expect(rpcMock).toHaveBeenNthCalledWith(2, "command_reconcile_procurement_mutation", {
      p_usaha_id: "usaha-1",
      p_command_name: "create_purchase",
      p_idempotency_key: "purchase-unknown-test",
    });
  });

  test("purchase draft update preserves stale-write token", async () => {
    rpcMock.mockResolvedValue({
      data: {
        pembelian_id: "purchase-1",
        usaha_id: "usaha-1",
        status: "draft",
        total_amount: "0.00",
        currency_code: "IDR",
      },
      error: null,
    });

    await updatePurchaseDraft(
      "usaha-1",
      "purchase-1",
      {
        nomorPembelian: "PB-SYNTH-001",
        tanggalPembelian: "2026-09-29",
        lines: [],
        expectedUpdatedAt: "2026-09-29T00:00:00Z",
      },
      {
        idempotencyKey: "purchase-update-test",
        requestId: "request-purchase-update-test",
      },
    );

    expect(rpcMock).toHaveBeenCalledWith("command_update_purchase_draft", {
      p_usaha_id: "usaha-1",
      p_pembelian_id: "purchase-1",
      p_pemasok_id: null,
      p_nomor_pembelian: "PB-SYNTH-001",
      p_tanggal_pembelian: "2026-09-29",
      p_lines: [],
      p_catatan: null,
      p_expected_updated_at: "2026-09-29T00:00:00Z",
      p_idempotency_key: "purchase-update-test",
      p_request_id: "request-purchase-update-test",
    });
  });
});
