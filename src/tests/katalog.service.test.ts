import { describe, expect, test, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import { createCatalogProduct, createCatalogCategory, setCatalogProductStatus } from "@/features/katalog/service";

describe("Katalog trusted mutation service", () => {
  test("create product preserves tenant and idempotency command contract", async () => {
    rpcMock.mockResolvedValue({
      data: {
        barang_id: "barang-1",
        usaha_id: "usaha-1",
        nama: "Tenda 4P",
        slug: "tenda-4p",
        status: "active",
        is_public: false,
      },
      error: null,
    });

    await expect(createCatalogProduct("usaha-1", {
      kategoriBarangId: "category-1",
      nama: "Tenda 4P",
      slug: "Tenda-4P",
    }, {
      idempotencyKey: "catalog-product-test",
      requestId: "request-catalog-test",
    })).resolves.toMatchObject({
      barang_id: "barang-1",
      usaha_id: "usaha-1",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_create_barang", {
      p_usaha_id: "usaha-1",
      p_kategori_barang_id: "category-1",
      p_nama: "Tenda 4P",
      p_slug: "tenda-4p",
      p_deskripsi: null,
      p_ringkasan_publik: null,
      p_status: "active",
      p_is_public: false,
      p_metadata: null,
      p_idempotency_key: "catalog-product-test",
      p_request_id: "request-catalog-test",
    });
  });

  test("create category reconciles a committed response after unknown command response", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("network timeout") })
      .mockResolvedValueOnce({
        data: {
          state: "committed",
          response: {
            kategori_barang_id: "category-1",
            usaha_id: "usaha-1",
            nama: "Tenda",
            status: "active",
          },
        },
        error: null,
      });

    await expect(createCatalogCategory("usaha-1", { nama: "Tenda" }, {
      idempotencyKey: "catalog-category-test",
      requestId: "request-category-test",
    })).resolves.toMatchObject({
      kategori_barang_id: "category-1",
      usaha_id: "usaha-1",
    });

    expect(rpcMock).toHaveBeenNthCalledWith(1, "command_create_kategori_barang", {
      p_usaha_id: "usaha-1",
      p_nama: "Tenda",
      p_deskripsi: null,
      p_idempotency_key: "catalog-category-test",
      p_request_id: "request-category-test",
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "command_reconcile_catalog_mutation", {
      p_usaha_id: "usaha-1",
      p_command_name: "create_kategori_barang",
      p_idempotency_key: "catalog-category-test",
    });
  });

  test("status mutation surfaces unknown outcome instead of blind retry", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("network timeout") })
      .mockResolvedValueOnce({
        data: { state: "unknown", response: null },
        error: null,
      });

    await expect(setCatalogProductStatus("usaha-1", "barang-1", "inactive", "2026-09-28T10:00:00Z", {
      idempotencyKey: "catalog-status-test",
      requestId: "request-status-test",
    })).rejects.toThrow("UNKNOWN_OUTCOME");
  });
});
