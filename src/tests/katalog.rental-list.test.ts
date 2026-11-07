import { beforeEach, describe, expect, test, vi } from "vitest";

type QueryResult = { data: unknown[]; error: null; count?: number };

const fixtures = vi.hoisted(() => ({
  products: [] as unknown[],
  variants: [] as unknown[],
  tariffs: [] as unknown[],
  covers: [] as unknown[],
  from: vi.fn(),
  mediaQuery: null as Record<string, unknown> | null,
  getPublicUrl: vi.fn(),
}));

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    from: fixtures.from,
    storage: {
      from: vi.fn(() => ({
        getPublicUrl: fixtures.getPublicUrl,
      })),
    },
  },
}));

import { listCatalogProducts } from "@/features/katalog/service";

function makeQuery(table: string) {
  const rows =
    table === "barang" ? fixtures.products :
    table === "varian_barang" ? fixtures.variants :
    table === "tarif_sewa" ? fixtures.tariffs :
    table === "barang_media" ? fixtures.covers : [];
  const result: QueryResult = {
    data: rows,
    error: null,
    ...(table === "barang" ? { count: rows.length } : {}),
  };
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "ilike", "or", "order", "range", "lte", "is"]) {
    query[method] = vi.fn(() => query);
  }
  query.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return query;
}

describe("rental catalogue listing projection", () => {
  beforeEach(() => {
    fixtures.covers = [
      {
        barang_id: "product-base-rental",
        storage_bucket: "rental-public-media",
        storage_path: "usaha-1/product-base-rental/cover.png",
        is_cover: true,
        urutan: 1,
        status: "valid",
      },
    ];
    fixtures.getPublicUrl.mockReset();
    fixtures.getPublicUrl.mockImplementation((path: string) => ({
      data: { publicUrl: "https://cdn.example.test/" + path },
    }));
    fixtures.mediaQuery = null;
    fixtures.products = [
      {
        barang_id: "product-base-rental",
        usaha_id: "usaha-1",
        kategori_barang_id: "category-1",
        nama: "Baselayer",
        slug: "baselayer",
        status: "active",
        is_public: true,
        is_rentable: true,
        is_sellable: false,
        harga_jual: null,
        inventory_mode: "serialized",
        kategori: { kategori_barang_id: "category-1", nama: "Outfit", status: "active" },
      },
      {
        barang_id: "product-variant-rental",
        usaha_id: "usaha-1",
        kategori_barang_id: "category-1",
        nama: "Jaket Gorpcore",
        slug: "jaket-gorpcore",
        status: "active",
        is_public: true,
        is_rentable: false,
        is_sellable: false,
        harga_jual: null,
        inventory_mode: "serialized",
        kategori: { kategori_barang_id: "category-1", nama: "Outfit", status: "active" },
      },
      {
        barang_id: "product-sale-only",
        usaha_id: "usaha-1",
        kategori_barang_id: "category-2",
        nama: "Jas Hujan",
        slug: "jas-hujan",
        status: "active",
        is_public: true,
        is_rentable: false,
        is_sellable: true,
        harga_jual: 10000,
        inventory_mode: "serialized",
        kategori: { kategori_barang_id: "category-2", nama: "Aksesoris", status: "active" },
      },
    ];
    fixtures.variants = [
      {
        varian_barang_id: "variant-1",
        barang_id: "product-base-rental",
        is_rentable: false,
        status: "active",
      },
      {
        varian_barang_id: "variant-rental",
        barang_id: "product-variant-rental",
        is_rentable: true,
        status: "active",
      },
    ];
    fixtures.tariffs = [
      {
        tarif_sewa_id: "tariff-product",
        usaha_id: "usaha-1",
        barang_id: "product-base-rental",
        varian_barang_id: null,
        nama: "Sewa Baselayer",
        nominal: 10000,
        currency_code: "IDR",
        durasi_unit: "hari",
        durasi_nilai: 1,
        berlaku_mulai: "2025-01-01T00:00:00.000Z",
        berlaku_sampai: null,
        status: "active",
        updated_at: "2025-01-01T00:00:00.000Z",
      },
      {
        tarif_sewa_id: "tariff-variant",
        usaha_id: "usaha-1",
        barang_id: null,
        varian_barang_id: "variant-rental",
        nama: "Sewa Jaket Gorpcore / Hitam / M",
        nominal: 20000,
        currency_code: "IDR",
        durasi_unit: "hari",
        durasi_nilai: 1,
        berlaku_mulai: "2025-01-01T00:00:00.000Z",
        berlaku_sampai: null,
        status: "active",
        updated_at: "2025-01-01T00:00:00.000Z",
      },
    ];
    fixtures.from.mockReset();
    fixtures.from.mockImplementation((table: string) => {
      const query = makeQuery(table);
      if (table === "barang_media") fixtures.mediaQuery = query;
      return query;
    });
  });

  test("loads product covers from valid media records", async () => {
    const { listCatalogProductCovers } = await import("@/features/katalog/service");
    const result = await listCatalogProductCovers("usaha-1", ["product-base-rental", "product-without-cover"]);

    expect(result).toEqual([
      {
        barang_id: "product-base-rental",
        url: "https://cdn.example.test/usaha-1/product-base-rental/cover.png",
      },
      { barang_id: "product-without-cover", url: null },
    ]);
    expect(fixtures.from).toHaveBeenCalledWith("barang_media");
    expect(fixtures.mediaQuery?.eq).toHaveBeenCalledWith("status", "valid");
    expect(fixtures.getPublicUrl).toHaveBeenCalledWith("usaha-1/product-base-rental/cover.png");
  });

  test("projects rental eligibility and resolves tariffs stored on variants", async () => {
    const result = await listCatalogProducts("usaha-1", {
      search: "",
      categoryId: "all",
      status: "all",
      visibility: "all",
      sort: "name_asc",
      page: 1,
      pageSize: 100,
    });

    expect(result.total).toBe(3);
    expect(result.products).toHaveLength(3);
    expect(result.products[0]).toMatchObject({
      barang_id: "product-base-rental",
      is_rentable: true,
      has_rentable_variants: false,
      active_tariff: { tarif_sewa_id: "tariff-product", nominal: 10000 },
    });
    expect(result.products[1]).toMatchObject({
      barang_id: "product-variant-rental",
      is_rentable: false,
      has_rentable_variants: true,
      active_tariff: { tarif_sewa_id: "tariff-variant", nominal: 20000 },
    });
    expect(result.products[2]).toMatchObject({
      barang_id: "product-sale-only",
      is_rentable: false,
      is_sellable: true,
      has_rentable_variants: false,
      active_tariff: null,
    });
    expect(fixtures.from).toHaveBeenCalledWith("barang");
    expect(fixtures.from).toHaveBeenCalledWith("varian_barang");
    expect(fixtures.from).toHaveBeenCalledWith("tarif_sewa");
  });
});
