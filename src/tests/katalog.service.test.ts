import { beforeEach, describe, expect, test, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import { createCatalogProduct, createCatalogCategory, removeCatalogVariantMedia, setCatalogVariantMediaCover, setCatalogPackagePromo, setCatalogProductStatus } from "@/features/katalog/service";

describe("Katalog trusted mutation service", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });
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

  test("create product can atomically initialize rental and retail channels", async () => {
    rpcMock.mockResolvedValue({
      data: {
        barang_id: "gas-parent-1",
        usaha_id: "usaha-1",
        nama: "Gas LPG",
        is_rentable: false,
        is_sellable: false,
        inventory_mode: "serialized",
      },
      error: null,
    });

    await createCatalogProduct("usaha-1", {
      kategoriBarangId: "category-1",
      nama: "Gas LPG",
      slug: "gas-lpg",
      salesConfig: {
        isRentable: false,
        isSellable: false,
        hargaJual: null,
        inventoryMode: "serialized",
      },
    }, {
      idempotencyKey: "catalog-gas-create",
      requestId: "request-gas-create",
    });

    expect(rpcMock).toHaveBeenCalledWith("command_create_barang_with_channels", {
      p_usaha_id: "usaha-1",
      p_kategori_barang_id: "category-1",
      p_nama: "Gas LPG",
      p_slug: "gas-lpg",
      p_deskripsi: null,
      p_ringkasan_publik: null,
      p_status: "active",
      p_is_public: false,
      p_metadata: null,
      p_is_rentable: false,
      p_is_sellable: false,
      p_harga_jual: null,
      p_inventory_mode: "serialized",
      p_idempotency_key: "catalog-gas-create",
      p_request_id: "request-gas-create",
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

  test("package promo uses the trusted RPC and preserves idempotency and optimistic concurrency", async () => {
    rpcMock.mockResolvedValue({
      data: {
        usaha_id: "usaha-1",
        paket_sewa_id: "package-1",
        tarif_sewa_id: "tariff-1",
        enabled: true,
        promosi_paket_id: "promo-1",
        harga_normal: 80000,
        harga_promo: 65000,
        updated_at: "2026-10-01T10:00:00Z",
      },
      error: null,
    });

    await expect(setCatalogPackagePromo("usaha-1", {
      paketSewaId: "package-1",
      tarifSewaId: "tariff-1",
      enabled: true,
      hargaPromo: 65000,
      expectedUpdatedAt: "2026-10-01T09:00:00Z",
    }, {
      idempotencyKey: "catalog-package-promo-test",
      requestId: "request-package-promo-test",
    })).resolves.toMatchObject({
      enabled: true,
      promosi_paket_id: "promo-1",
      harga_promo: 65000,
    });

    expect(rpcMock).toHaveBeenCalledWith("command_set_paket_promo", {
      p_usaha_id: "usaha-1",
      p_paket_sewa_id: "package-1",
      p_tarif_sewa_id: "tariff-1",
      p_enabled: true,
      p_harga_promo: 65000,
      p_expected_updated_at: "2026-10-01T09:00:00Z",
      p_idempotency_key: "catalog-package-promo-test",
      p_request_id: "request-package-promo-test",
    });
  });

  test("package promo reconciles an uncertain response using the same command key", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: new Error("network timeout") })
      .mockResolvedValueOnce({
        data: {
          state: "committed",
          response: {
            enabled: false,
            harga_normal: 80000,
            harga_promo: null,
          },
        },
        error: null,
      });

    await expect(setCatalogPackagePromo("usaha-1", {
      paketSewaId: "package-1",
      tarifSewaId: "tariff-1",
      enabled: false,
    }, {
      idempotencyKey: "catalog-package-promo-disable-test",
    })).resolves.toMatchObject({ enabled: false, harga_normal: 80000 });

    expect(rpcMock).toHaveBeenNthCalledWith(2, "command_reconcile_catalog_mutation", {
      p_usaha_id: "usaha-1",
      p_command_name: "set_paket_promo",
      p_idempotency_key: "catalog-package-promo-disable-test",
    });
  });

  test("variant photo commands remain tenant-scoped and use trusted RPC contracts", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: { removed: true, varian_barang_media_id: "variant-media-1" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          varian_barang_media_id: "variant-media-2",
          usaha_id: "usaha-1",
          varian_barang_id: "variant-1",
          is_cover: true,
        },
        error: null,
      });

    await expect(removeCatalogVariantMedia("usaha-1", "variant-media-1", {
      idempotencyKey: "remove-variant-photo",
      requestId: "request-remove-variant-photo",
    })).resolves.toMatchObject({ removed: true, varian_barang_media_id: "variant-media-1" });

    await expect(setCatalogVariantMediaCover("usaha-1", "variant-media-2", true, {
      idempotencyKey: "cover-variant-photo",
      requestId: "request-cover-variant-photo",
    })).resolves.toMatchObject({ is_cover: true, varian_barang_id: "variant-1" });

    expect(rpcMock).toHaveBeenNthCalledWith(1, "command_remove_varian_barang_media", {
      p_usaha_id: "usaha-1",
      p_varian_barang_media_id: "variant-media-1",
      p_idempotency_key: "remove-variant-photo",
      p_request_id: "request-remove-variant-photo",
    });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "command_set_varian_barang_media_cover", {
      p_usaha_id: "usaha-1",
      p_varian_barang_media_id: "variant-media-2",
      p_is_cover: true,
      p_idempotency_key: "cover-variant-photo",
      p_request_id: "request-cover-variant-photo",
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
