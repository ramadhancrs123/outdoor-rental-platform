import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({ useQuery: useQueryMock }));
vi.mock("@/features/katalog", () => ({
  getCatalogContext: vi.fn(),
  getCatalogMediaUrl: vi.fn(() => "https://media.example.test/carrier-cover.jpg"),
  getCatalogProduct: vi.fn(),
}));

import { CatalogShow } from "@/pages/katalog/show";
import type { CatalogProductDetail } from "@/features/katalog/types";
import { CATALOG_PRODUCT_MEDIA_BUCKET } from "@/features/katalog/types";

const product: CatalogProductDetail = {
  barang_id: "product-1",
  usaha_id: "usaha-1",
  kategori_barang_id: "category-1",
  nama: "Carrier",
  slug: "carrier",
  deskripsi: "Carrier untuk perlengkapan pendakian.",
  ringkasan_publik: "Carrier hiking dengan kapasitas luas.",
  status: "active",
  is_public: false,
  is_rentable: true,
  is_sellable: false,
  harga_jual: null,
  inventory_mode: "serialized",
  updated_at: "2026-11-02T00:00:00.000Z",
  kategori: { kategori_barang_id: "category-1", nama: "Tas & Carrier", status: "active" },
  active_tariff: {
    tarif_sewa_id: "tariff-1",
    usaha_id: "usaha-1",
    barang_id: "product-1",
    varian_barang_id: null,
    paket_sewa_id: null,
    nama: "Sewa Harian",
    durasi_unit: "hari",
    durasi_nilai: 1,
    nominal: 25000,
    currency_code: "IDR",
    berlaku_mulai: "2026-11-01T00:00:00.000Z",
    berlaku_sampai: null,
    status: "active",
    updated_at: "2026-11-01T00:00:00.000Z",
  },
  variants: [{
    varian_barang_id: "variant-45l",
    barang_id: "product-1",
    usaha_id: "usaha-1",
    nama: "45 L",
    kode_internal: null,
    deskripsi: "Kapasitas ringkas untuk perjalanan singkat.",
    atribut_pembeda: { kapasitas: "45 L" },
    status: "active",
    is_rentable: null,
    is_sellable: null,
    harga_jual: null,
    inventory_mode: null,
    updated_at: "2026-11-01T00:00:00.000Z",
  }],
  tariffs: [{
    tarif_sewa_id: "tariff-1",
    usaha_id: "usaha-1",
    barang_id: "product-1",
    varian_barang_id: null,
    paket_sewa_id: null,
    nama: "Sewa Harian",
    durasi_unit: "hari",
    durasi_nilai: 1,
    nominal: 25000,
    currency_code: "IDR",
    berlaku_mulai: "2026-11-01T00:00:00.000Z",
    berlaku_sampai: null,
    status: "active",
    updated_at: "2026-11-01T00:00:00.000Z",
  }],
  media: [{
    barang_media_id: "media-1",
    usaha_id: "usaha-1",
    barang_id: "product-1",
    storage_bucket: CATALOG_PRODUCT_MEDIA_BUCKET,
    storage_path: "usaha-1/product-1/media-1/carrier.jpg",
    media_type: "image/jpeg",
    urutan: 1,
    is_cover: true,
    status: "valid",
  }],
  package_references: [],
};

function renderDetail() {
  useQueryMock
    .mockReturnValueOnce({
      data: { usahaId: "usaha-1", usahaName: "Akasha Store", usahaSlug: "akasha-store" },
      isPending: false,
      error: null,
    })
    .mockReturnValueOnce({
      data: product,
      isPending: false,
      error: null,
    });

  return render(
    <MemoryRouter initialEntries={["/katalog/show/product-1"]}>
      <Routes>
        <Route path="/katalog/show/:id" element={<CatalogShow />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Catalog product detail responsive layout", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  it("keeps the product identity and information compact with a readable mobile layout", () => {
    const { container } = renderDetail();
    const mediaSection = screen.getByRole("region", { name: "Media dan informasi produk" });
    const cards = mediaSection.querySelectorAll('[data-slot="card"]');
    const gallery = cards[0];
    const information = screen.getByText("Informasi produk").closest('[data-slot="card"]');

    expect(mediaSection.className).toContain("min-w-0");
    expect(mediaSection.className).toContain("catalog-detail-media-layout");
    expect(cards).toHaveLength(2);
    expect(gallery?.className).toContain("w-full");
    expect(gallery?.className).toContain("min-w-0");
    expect(information?.className).toContain("w-full");
    expect(information?.className).toContain("min-w-0");
    expect(screen.getByText("Deskripsi dan ringkasan")).toBeInTheDocument();
    expect(screen.getByText("Tarif aktif")).toBeInTheDocument();
    expect(container.querySelector('img[alt="Cover Carrier"]')?.className).toContain("object-contain");
  });

  it("keeps the legacy media warning outside the responsive media grid", () => {
    useQueryMock
      .mockReturnValueOnce({
        data: { usahaId: "usaha-1", usahaName: "Akasha Store", usahaSlug: "akasha-store" },
        isPending: false,
        error: null,
      })
      .mockReturnValueOnce({
        data: {
          ...product,
          media: [...product.media, {
            barang_media_id: "legacy-media",
            usaha_id: "usaha-1",
            barang_id: "product-1",
            storage_bucket: "legacy-product-bucket",
            storage_path: "legacy/carrier.jpg",
            media_type: "image/jpeg",
            urutan: 2,
            is_cover: false,
            status: "valid",
          }],
        },
        isPending: false,
        error: null,
      });

    render(
      <MemoryRouter initialEntries={["/katalog/show/product-1"]}>
        <Routes>
          <Route path="/katalog/show/:id" element={<CatalogShow />} />
        </Routes>
      </MemoryRouter>,
    );

    const warning = screen.getByText("Referensi media lama tidak tersedia").closest('[role="alert"]');
    const mediaSection = screen.getByRole("region", { name: "Media dan informasi produk" });

    expect(warning).toBeTruthy();
    expect(mediaSection.contains(warning)).toBe(false);
  });
});
