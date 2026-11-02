import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";

const inventoryMock = vi.hoisted(() => ({
  getInventarisContext: vi.fn(),
  getInventoryStateCapabilities: vi.fn(),
  listInventoryLocations: vi.fn(),
  listInventoryProducts: vi.fn(),
  listInventoryVariants: vi.fn(),
  reconcileInventoryCommand: vi.fn(),
  registerInventoryUnits: vi.fn(),
}));
const catalogMock = vi.hoisted(() => ({
  createCatalogVariant: vi.fn(),
  reconcileCatalogMutation: vi.fn(),
}));
const purchaseMock = vi.hoisted(() => ({ getPurchase: vi.fn(), listPurchases: vi.fn() }));

vi.mock("@/features/inventaris", () => inventoryMock);
vi.mock("@/features/katalog", () => catalogMock);
vi.mock("@/features/pemasok", () => purchaseMock);

import { InventoryCreate } from "@/pages/inventaris/create";

const context = { akunAdminId: "admin-1", usahaId: "usaha-1", usahaNama: "Akasha Outdoor" };
const product = { barang_id: "barang-1", nama: "Tenda Dome 4P", slug: "tenda-dome-4p", status: "active" };
const existingVariant = {
  varian_barang_id: "variant-existing",
  barang_id: "barang-1",
  nama: "Warna Hitam · Kapasitas/Ukuran 4 orang",
  kode_internal: "TND-4P-HITAM",
  deskripsi: null,
  atribut_pembeda: { warna: "Hitam", kapasitas: "4 orang" },
  status: "active",
  media: [],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/inventaris/create"]}>
        <InventoryCreate />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function chooseProduct() {
  const productSelect = await screen.findByRole("combobox", { name: /Barang/ });
  fireEvent.click(productSelect);
  fireEvent.click(await screen.findByRole("option", { name: "Tenda Dome 4P" }));
}

async function proceedToReview() {
  fireEvent.click(screen.getByRole("button", { name: /Lanjutkan/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Tinjauan Pendaftaran/ }));
}

beforeEach(() => {
  inventoryMock.getInventarisContext.mockReset().mockResolvedValue(context);
  inventoryMock.getInventoryStateCapabilities.mockReset().mockReturnValue({ read: true, mutation: true, commands: [], queries: [], reason: "Trusted command aktif." });
  inventoryMock.listInventoryLocations.mockReset().mockResolvedValue([]);
  inventoryMock.listInventoryProducts.mockReset().mockResolvedValue([product]);
  inventoryMock.listInventoryVariants.mockReset().mockResolvedValue([]);
  inventoryMock.reconcileInventoryCommand.mockReset();
  inventoryMock.registerInventoryUnits.mockReset().mockResolvedValue({
    usaha_id: "usaha-1",
    jumlah_unit: 1,
    units: [{ unit_barang_id: "unit-1", kode_unit: "TD4P-001", status: "ready" }],
  });
  catalogMock.createCatalogVariant.mockReset().mockResolvedValue({ varian_barang_id: "variant-created", barang_id: "barang-1" });
  catalogMock.reconcileCatalogMutation.mockReset();
  purchaseMock.getPurchase.mockReset();
  purchaseMock.listPurchases.mockReset().mockResolvedValue({ purchases: [] });
});

describe("Inventaris unit registration variant creation", () => {
  test("creates a child variant under the selected product and registers the unit to it", async () => {
    renderPage();
    await chooseProduct();

    fireEvent.click(screen.getByRole("button", { name: "+ Tambah varian" }));
    fireEvent.change(screen.getByLabelText("Warna"), { target: { value: "Hitam" } });
    fireEvent.change(screen.getByLabelText("Kapasitas / Ukuran"), { target: { value: "4 orang" } });

    expect(screen.getByText("Varian baru akan menjadi bagian dari barang induk ini. Tidak ada barang katalog baru yang dibuat.")).toBeInTheDocument();
    expect(screen.getByText("Warna Hitam · Kapasitas/Ukuran 4 orang")).toBeInTheDocument();

    await proceedToReview();
    fireEvent.click(screen.getByRole("button", { name: "Daftarkan 1 Unit" }));

    await waitFor(() => expect(catalogMock.createCatalogVariant).toHaveBeenCalledWith("usaha-1", {
      barangId: "barang-1",
      nama: "Warna Hitam · Kapasitas/Ukuran 4 orang",
      kodeInternal: null,
      deskripsi: null,
      atributPembeda: { warna: "Hitam", kapasitas: "4 orang" },
      status: "active",
    }, expect.objectContaining({ idempotencyKey: expect.stringMatching(/^inventory-create-variant-/) })));

    await waitFor(() => expect(inventoryMock.registerInventoryUnits).toHaveBeenCalledWith("usaha-1", expect.objectContaining({
      barangId: "barang-1",
      varianBarangId: "variant-created",
    }), 1, expect.objectContaining({ idempotencyKey: expect.any(String) })));
    expect(await screen.findByText("Unit berhasil didaftarkan")).toBeInTheDocument();
  });

  test("reuses an existing variant with matching attributes instead of creating a duplicate", async () => {
    inventoryMock.listInventoryVariants.mockResolvedValue([existingVariant]);
    renderPage();
    await chooseProduct();

    fireEvent.click(screen.getByRole("button", { name: "+ Tambah varian" }));
    fireEvent.change(screen.getByLabelText("Warna"), { target: { value: " hitam " } });
    fireEvent.change(screen.getByLabelText("Kapasitas / Ukuran"), { target: { value: "4 ORANG" } });

    expect(await screen.findByText("Varian sudah tersedia")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gunakan varian yang ada" }));

    await proceedToReview();
    fireEvent.click(screen.getByRole("button", { name: "Daftarkan 1 Unit" }));

    await waitFor(() => expect(inventoryMock.registerInventoryUnits).toHaveBeenCalledWith("usaha-1", expect.objectContaining({
      barangId: "barang-1",
      varianBarangId: "variant-existing",
    }), 1, expect.objectContaining({ idempotencyKey: expect.any(String) })));
    expect(catalogMock.createCatalogVariant).not.toHaveBeenCalled();
    expect(await screen.findByText("Unit berhasil didaftarkan")).toBeInTheDocument();
  });
});
