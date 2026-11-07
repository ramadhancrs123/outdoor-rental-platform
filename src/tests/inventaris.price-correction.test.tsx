import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const catalogMock = vi.hoisted(() => ({
  getCatalogProduct: vi.fn(),
  reconcileCatalogMutation: vi.fn(),
  setCatalogProductPurchaseCost: vi.fn(),
  setCatalogProductSalesConfig: vi.fn(),
  setCatalogVariantPurchaseCost: vi.fn(),
  setCatalogVariantSalesConfig: vi.fn(),
  updateCatalogTariff: vi.fn(),
}));

vi.mock("@/features/katalog", () => catalogMock);

import { InventoryPriceCorrectionDialog } from "@/components/inventaris/inventory-price-correction-dialog";

const product = {
  barang_id: "product-1",
  usaha_id: "usaha-1",
  kategori_barang_id: null,
  nama: "Tenda",
  slug: "tenda",
  deskripsi: null,
  ringkasan_publik: null,
  status: "active",
  is_public: true,
  is_rentable: true,
  is_sellable: true,
  harga_jual: 40000,
  harga_beli: 25000,
  satuan_jual: "unit",
  inventory_mode: "serialized" as const,
  updated_at: "2026-11-07T08:00:00.000Z",
  kategori: null,
  active_tariff: null,
  rental_promotion: null,
  rental_variant_promotions: {},
  has_variant_promotion: false,
  variants: [
    {
      varian_barang_id: "variant-1",
      barang_id: "product-1",
      usaha_id: "usaha-1",
      nama: "Kapasitas 2 · Single layer",
      kode_internal: null,
      deskripsi: null,
      atribut_pembeda: { kapasitas: "2", seri: "Single layer" },
      status: "active",
      is_rentable: true,
      is_sellable: true,
      harga_jual: 35000,
      harga_beli: 20000,
      inventory_mode: "serialized" as const,
      updated_at: "2026-11-07T08:00:00.000Z",
      media: [],
    },
    {
      varian_barang_id: "variant-2",
      barang_id: "product-1",
      usaha_id: "usaha-1",
      nama: "Varian nonaktif jual dan sewa",
      kode_internal: null,
      deskripsi: null,
      atribut_pembeda: null,
      status: "active",
      is_rentable: false,
      is_sellable: false,
      harga_jual: null,
      harga_beli: null,
      inventory_mode: null,
      updated_at: "2026-11-07T08:00:00.000Z",
      media: [],
    },
  ],
  tariffs: [
    {
      tarif_sewa_id: "tariff-product",
      usaha_id: "usaha-1",
      barang_id: "product-1",
      varian_barang_id: null,
      paket_sewa_id: null,
      nama: "Sewa Tenda / 1 Hari",
      durasi_unit: "hari",
      durasi_nilai: 1,
      nominal: 30000,
      currency_code: "IDR",
      berlaku_mulai: "2026-11-01T00:00:00.000Z",
      berlaku_sampai: null,
      status: "active",
      updated_at: "2026-11-07T08:00:00.000Z",
    },
    {
      tarif_sewa_id: "tariff-variant",
      usaha_id: "usaha-1",
      barang_id: null,
      varian_barang_id: "variant-1",
      paket_sewa_id: null,
      nama: "Sewa Tenda Single Layer / 1 Hari",
      durasi_unit: "hari",
      durasi_nilai: 1,
      nominal: 25000,
      currency_code: "IDR",
      berlaku_mulai: "2026-11-01T00:00:00.000Z",
      berlaku_sampai: null,
      status: "active",
      updated_at: "2026-11-07T08:00:00.000Z",
    },
  ],
  media: [],
  package_references: [],
};

function renderDialog(overrides: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InventoryPriceCorrectionDialog
        usahaId="usaha-1"
        productId="product-1"
        productName="Tenda"
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /Koreksi Harga/ }));
  await screen.findByRole("dialog");
}

beforeEach(() => {
  catalogMock.getCatalogProduct.mockReset().mockResolvedValue(product);
  catalogMock.reconcileCatalogMutation.mockReset();
  catalogMock.setCatalogProductPurchaseCost.mockReset().mockResolvedValue({ state: "changed" });
  catalogMock.setCatalogProductSalesConfig.mockReset().mockResolvedValue({ state: "changed" });
  catalogMock.setCatalogVariantPurchaseCost.mockReset().mockResolvedValue({ state: "changed" });
  catalogMock.setCatalogVariantSalesConfig.mockReset().mockResolvedValue({ state: "changed" });
  catalogMock.updateCatalogTariff.mockReset().mockResolvedValue({ state: "changed" });
});

describe("Inventaris price correction", () => {
  test("automatically shows sale HPP and rental tariff controls only for active channels", async () => {
    renderDialog();
    await openDialog();

    expect(await screen.findByText("HPP dan harga jual")).toBeInTheDocument();
    expect(screen.getByText("Tarif sewa")).toBeInTheDocument();
    expect(screen.getAllByText("Kapasitas 2 · Single layer")).toHaveLength(2);
    expect(screen.queryByText("Varian nonaktif jual dan sewa")).not.toBeInTheDocument();
    expect(screen.getByText("Sewa Tenda / 1 Hari")).toBeInTheDocument();
    expect(screen.getByText("Sewa Tenda Single Layer / 1 Hari")).toBeInTheDocument();
  });

  test("resolves sell and rent channel overrides at variant level when parent channels are disabled", async () => {
    catalogMock.getCatalogProduct.mockResolvedValueOnce({
      ...product,
      is_rentable: false,
      is_sellable: false,
      variants: [product.variants[0]],
      tariffs: [product.tariffs[1]],
    });
    renderDialog();
    await openDialog();

    expect(await screen.findByText("HPP dan harga jual")).toBeInTheDocument();
    expect(screen.getByText("Tarif sewa")).toBeInTheDocument();
    expect(screen.getByText("Channel Sewa")).toBeInTheDocument();
    expect(screen.getByText("Channel Jual")).toBeInTheDocument();
    expect(screen.getByLabelText("HPP varian (IDR)")).toBeInTheDocument();
    expect(screen.getByLabelText("Harga jual varian (IDR)")).toBeInTheDocument();
    expect(screen.getByText("Sewa Tenda Single Layer / 1 Hari")).toBeInTheDocument();
  });

  test("persists product HPP through the existing trusted command", async () => {
    renderDialog();
    await openDialog();

    const hppInput = await screen.findByLabelText("HPP barang (IDR)");
    fireEvent.change(hppInput, { target: { value: "27500" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Simpan HPP" })[0]);

    await waitFor(() => expect(catalogMock.setCatalogProductPurchaseCost).toHaveBeenCalledWith(
      "usaha-1",
      "product-1",
      27500,
      "2026-11-07T08:00:00.000Z",
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^inventory-price-/) }),
    ));
  });

  test("updates the selected active variant rental tariff without changing its duration", async () => {
    renderDialog();
    await openDialog();

    const amounts = await screen.findAllByLabelText("Nominal baru");
    fireEvent.change(amounts[1], { target: { value: "28000" } });
    const saveButtons = screen.getAllByRole("button", { name: "Simpan" });
    fireEvent.click(saveButtons[1]);

    await waitFor(() => expect(catalogMock.updateCatalogTariff).toHaveBeenCalledWith(
      "usaha-1",
      {
        tarifSewaId: "tariff-variant",
        nama: "Sewa Tenda Single Layer / 1 Hari",
        durasiUnit: "hari",
        durasiNilai: 1,
        nominal: 28000,
        berlakuMulai: "2026-11-01T00:00:00.000Z",
        berlakuSampai: null,
        expectedUpdatedAt: "2026-11-07T08:00:00.000Z",
      },
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^inventory-price-/) }),
    ));
  });

  test("sale-only item hides rental correction while rent-only item hides sale correction", async () => {
    catalogMock.getCatalogProduct.mockResolvedValueOnce({
      ...product,
      is_rentable: false,
      is_sellable: true,
      variants: [],
      tariffs: [],
    });
    const saleOnly = renderDialog();
    await openDialog();
    expect(await screen.findByText("HPP dan harga jual")).toBeInTheDocument();
    expect(screen.queryByText("Tarif sewa")).not.toBeInTheDocument();
    saleOnly.unmount();

    catalogMock.getCatalogProduct.mockResolvedValueOnce({
      ...product,
      is_rentable: true,
      is_sellable: false,
      variants: [],
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Koreksi Harga/ }));
    await screen.findByRole("dialog");
    expect(await screen.findByText("Tarif sewa")).toBeInTheDocument();
    expect(screen.queryByText("HPP dan harga jual")).not.toBeInTheDocument();
  });
});
