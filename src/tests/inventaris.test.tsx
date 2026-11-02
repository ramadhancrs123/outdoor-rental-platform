import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { InventoryList } from "@/pages/inventaris/list";
import { InventoryProductShow } from "@/pages/inventaris/product";
import { InventoryShow } from "@/pages/inventaris/show";
import { mockViewport } from "./viewport";

const serviceMock = vi.hoisted(() => ({
  getInventarisContext: vi.fn(), getInventoryProductDetail: vi.fn(), listInventoryUnitMediaForUnits: vi.fn(), listInventoryLocations: vi.fn(), listInventoryProducts: vi.fn(), listInventoryProductOverview: vi.fn(), listInventoryPackageAvailability: vi.fn(), listInventoryVariants: vi.fn(), listInventoryUnits: vi.fn(), getInventoryUnit: vi.fn(), getInventoryOperationalContext: vi.fn(),
  getInventoryStateCapabilities: vi.fn(() => ({ read: true, mutation: true, commands: ["register_inventory_unit", "move_inventory_unit", "mark_inventory_unit_ready", "command_mark_inventory_unit_inspection_pending", "command_reconcile_inventory_unit_mutation"], queries: ["listInventoryUnits", "getInventoryUnit", "lookupInventoryUnitByQr", "findInventoryUnitCandidates", "getInventoryOperationalContext"], reason: "Inventaris trusted command aktif." })),
}));

vi.mock("@/features/inventaris", () => ({
  getInventarisContext: serviceMock.getInventarisContext, getInventoryProductDetail: serviceMock.getInventoryProductDetail, listInventoryUnitMediaForUnits: serviceMock.listInventoryUnitMediaForUnits, listInventoryLocations: serviceMock.listInventoryLocations, listInventoryProducts: serviceMock.listInventoryProducts, listInventoryProductOverview: serviceMock.listInventoryProductOverview, listInventoryPackageAvailability: serviceMock.listInventoryPackageAvailability, listInventoryVariants: serviceMock.listInventoryVariants, listInventoryUnits: serviceMock.listInventoryUnits, getInventoryUnit: serviceMock.getInventoryUnit, getInventoryOperationalContext: serviceMock.getInventoryOperationalContext, getInventoryStateCapabilities: serviceMock.getInventoryStateCapabilities,
  inventoryStatusLabel: (status: string) => status, inventoryStatusVariant: () => "secondary",
  formatInventoryDate: (value: string | null | undefined) => value ?? "-", formatInventoryDateTime: (value: string | null | undefined) => value ?? "-", inventoryEventLabel: (value: string) => value,
  DEFAULT_INVENTORY_FILTERS: {
    search: "",
    status: "all",
    barangId: "all",
    varianBarangId: "all",
    locationId: "all",
    availabilityContext: "all",
    sort: "updated_desc",
    page: 1,
    pageSize: 20,
  },
}));

const context = { akunAdminId: "admin-1", usahaId: "usaha-a", usahaNama: "Usaha A" };
const location = { lokasi_id: "loc-1", usaha_id: "usaha-a", nama: "Gudang Utama", tipe: "warehouse", alamat: null, keterangan: null, status: "active", created_at: "2026-01-01", updated_at: "2026-01-01" };
const unit = { unit_barang_id: "unit-1", usaha_id: "usaha-a", barang_id: "barang-1", varian_barang_id: null, kode_unit: "TD4P-001", serial_number: "SN-001", lokasi_id: "loc-1", tanggal_diperoleh: "2026-01-10", sumber_pembelian_detail_id: null, status: "ready", kondisi_ringkas: "Baik", catatan_internal: null, created_at: "2026-01-10", updated_at: "2026-01-11", barang: { barang_id: "barang-1", nama: "Tenda Dome 4P", slug: "tenda-dome-4p", status: "active" }, varian: null, lokasi: { lokasi_id: "loc-1", nama: "Gudang Utama", tipe: "warehouse", status: "active" } };
function renderWithQuery(element: React.ReactNode) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/inventaris?mode=units"]}>{element}</MemoryRouter></QueryClientProvider>); }

describe("Inventaris read-side", () => {
  beforeEach(() => {
    serviceMock.getInventarisContext.mockReset();
    serviceMock.getInventoryProductDetail.mockReset();
    serviceMock.listInventoryUnitMediaForUnits.mockReset();
    serviceMock.listInventoryUnitMediaForUnits.mockResolvedValue([]);
    serviceMock.listInventoryLocations.mockReset();
    serviceMock.listInventoryProducts.mockReset();
    serviceMock.listInventoryProductOverview.mockReset();
    serviceMock.listInventoryProductOverview.mockResolvedValue([]);
    serviceMock.listInventoryPackageAvailability.mockReset();
    serviceMock.listInventoryPackageAvailability.mockResolvedValue([]);
    serviceMock.listInventoryVariants.mockReset();
    serviceMock.listInventoryUnits.mockReset();
    serviceMock.getInventoryUnit.mockReset();
    serviceMock.getInventoryOperationalContext.mockReset();
    serviceMock.getInventoryStateCapabilities.mockReset();
    serviceMock.getInventoryStateCapabilities.mockReturnValue({
      read: true,
      mutation: true,
      commands: ["register_inventory_unit", "move_inventory_unit", "mark_inventory_unit_ready", "command_mark_inventory_unit_inspection_pending", "command_reconcile_inventory_unit_mutation"],
      queries: ["listInventoryUnits", "getInventoryUnit", "lookupInventoryUnitByQr", "findInventoryUnitCandidates", "getInventoryOperationalContext"],
      reason: "Inventaris trusted command aktif.",
    });
    serviceMock.listInventoryLocations.mockResolvedValue([]);
    serviceMock.listInventoryProducts.mockResolvedValue([]);
    serviceMock.listInventoryVariants.mockResolvedValue([]);
    serviceMock.getInventoryOperationalContext.mockResolvedValue({
      currentAssignment: null,
      activeRental: null,
      latestReturn: null,
      latestInspection: null,
      openMaintenance: [],
    });
  });
  test("tenant-scoped list renders physical unit facts", async () => {
    serviceMock.getInventarisContext.mockResolvedValue(context); serviceMock.listInventoryLocations.mockResolvedValue([location]); serviceMock.listInventoryUnits.mockResolvedValue({ units: [unit], total: 1 });
    renderWithQuery(<InventoryList />);
    await waitFor(() => expect(serviceMock.listInventoryUnits).toHaveBeenCalled(), { timeout: 10_000 });
    expect((await screen.findAllByText("TD4P-001")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tenda Dome 4P").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gudang Utama").length).toBeGreaterThan(0);
  });

  test("product inventory view paginates product cards and filters by its matching variant", async () => {
    const productRows = Array.from({ length: 13 }, (_, index) => ({
      barang_id: "barang-" + String(index + 1).padStart(2, "0"),
      nama: "Carrier " + (index + 1),
      slug: "carrier-" + (index + 1),
      status: "active",
    }));
    serviceMock.getInventarisContext.mockResolvedValue(context);
    serviceMock.listInventoryProducts.mockResolvedValue(productRows);
    serviceMock.listInventoryProductOverview.mockResolvedValue(productRows.map((product, index) => ({
      ...product,
      kategori_nama: "Tas & Carrier",
      total_unit: index + 1,
      ready_unit: index + 1,
      rented_unit: 0,
      attention_unit: 0,
      inspection_pending_unit: 0,
      maintenance_unit: 0,
      damaged_unit: 0,
      lost_unit: 0,
      inactive_unit: 0,
      variant_count: index === 1 ? 1 : 0,
      latest_unit_updated_at: "2026-11-01T00:00:00.000Z",
      cover_url: null,
    })));
    serviceMock.listInventoryVariants.mockResolvedValue([{
      varian_barang_id: "variant-carrier-45",
      barang_id: "barang-02",
      nama: "45 L",
      kode_internal: "CARRIER-45L",
      deskripsi: null,
      atribut_pembeda: { kapasitas: "45 L" },
      status: "active",
    }]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/inventaris?mode=products"]}>
          <Routes>
            <Route path="/inventaris" element={<InventoryList />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Menampilkan 1–12 dari 13 barang")).toBeInTheDocument();
    const productLinks = () => new Set(
      [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/inventaris/barang/"]')]
        .map((link) => link.getAttribute("href")),
    );
    expect(productLinks()).toHaveLength(12);
    expect(productLinks()).toContain("/inventaris/barang/barang-01");
    expect(productLinks()).not.toContain("/inventaris/barang/barang-13");

    fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
    expect(await screen.findByText("Menampilkan 13–13 dari 13 barang")).toBeInTheDocument();
    expect(productLinks()).toHaveLength(1);
    expect(productLinks()).toContain("/inventaris/barang/barang-13");

    fireEvent.click(screen.getByRole("button", { name: "Filter inventaris" }));
    const variantFilter = screen.getByRole("combobox", { name: "Filter varian produk" });
    fireEvent.click(variantFilter);
    fireEvent.click(await screen.findByRole("option", { name: "Carrier 2 · 45 L" }));

    expect(await screen.findByText("Menampilkan 1–1 dari 1 barang")).toBeInTheDocument();
    expect(productLinks()).toHaveLength(1);
    expect(productLinks()).toContain("/inventaris/barang/barang-02");
  });

  test("empty state exposes trusted registration entry point", async () => {
    serviceMock.getInventarisContext.mockResolvedValue(context); serviceMock.listInventoryLocations.mockResolvedValue([]); serviceMock.listInventoryUnits.mockResolvedValue({ units: [], total: 0 });
    renderWithQuery(<InventoryList />);
    expect(await screen.findByText("Belum ada unit barang")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Daftarkan Unit Pertama/i })).toHaveAttribute("href", "/inventaris/create");
  });

  test("mobile presentation keeps detail link accessible", async () => {
    mockViewport(375, 812); serviceMock.getInventarisContext.mockResolvedValue(context); serviceMock.listInventoryLocations.mockResolvedValue([location]); serviceMock.listInventoryUnits.mockResolvedValue({ units: [unit], total: 1 });
    const { container } = renderWithQuery(<InventoryList />);
    expect((await screen.findAllByText("TD4P-001")).length).toBeGreaterThan(0);
    expect(container.querySelector('a[href="/inventaris/unit-1"]')).toBeInTheDocument();
    const desktopBranch = container.querySelector(".hidden.lg\\:block");
    expect(desktopBranch).toBeInTheDocument(); expect(desktopBranch?.querySelector("table")).toBeInTheDocument();
  });

  test("mobile unit list exposes current actions and accessible filters", async () => {
    mockViewport(375, 812);
    serviceMock.getInventarisContext.mockResolvedValue({ ...context, usahaNama: "Akasha Store" });
    serviceMock.listInventoryLocations.mockResolvedValue([]);
    serviceMock.listInventoryUnits.mockResolvedValue({ units: [unit], total: 1 });

    renderWithQuery(<InventoryList />);

    expect(await screen.findByRole("heading", { level: 1, name: "Semua Unit" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pencarian dan filter inventaris" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Daftarkan Unit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ekspor" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter status" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter lokasi" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Cari kode unit, serial, barang, varian, ...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Semua unit$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Sewakan$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Sedang Disewa$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Perhatian$/ })).toBeInTheDocument();
  });

  test("detail shows unit history and trusted command capability boundary", async () => {
    serviceMock.getInventarisContext.mockResolvedValue(context); serviceMock.getInventoryUnit.mockResolvedValue({ unit, history: [{ riwayat_unit_id: "history-1", usaha_id: "usaha-a", unit_barang_id: "unit-1", jenis_kejadian: "UNIT_REGISTERED", terjadi_at: "2026-01-10T01:00:00Z", status_sebelum: null, status_sesudah: "ready", lokasi_sebelum_id: null, lokasi_sesudah_id: "loc-1", sumber_type: null, sumber_id: null, actor_akun_admin_id: "admin-1", catatan: null, metadata: null, created_at: "2026-01-10T01:00:00Z", lokasi_sebelum_nama: null, lokasi_sesudah_nama: "Gudang Utama" }] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/inventaris/unit-1"]}><Routes><Route path="/inventaris/:id" element={<InventoryShow />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: "TD4P-001" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Informasi$/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("button", { name: /^Aksi$/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^Riwayat$/ })).toBeInTheDocument();

    const detailTabs = screen.getByRole("navigation", { name: "Bagian detail unit" });
    expect(detailTabs).toBeInTheDocument();
    const historyTab = within(detailTabs).getByRole("button", { name: /^Riwayat$/ });
    fireEvent.click(historyTab);
    expect(await screen.findByText("UNIT_REGISTERED")).toBeInTheDocument();

    fireEvent.click(within(detailTabs).getByRole("button", { name: /^Aksi$/ }));
    expect(screen.getAllByText(/Aksi Berikutnya/i).length).toBeGreaterThan(0);
  });

  test("detail barang menampilkan nama unit yang ramah dibaca dan memisahkan daftar berdasarkan varian", async () => {
    mockViewport(390, 844);
    serviceMock.getInventarisContext.mockResolvedValue(context);

    const product = {
      barang_id: "barang-carrier",
      usaha_id: "usaha-a",
      kategori_barang_id: "category-1",
      nama: "Carrier",
      slug: "carrier",
      deskripsi: "Tas carrier untuk pendakian.",
      ringkasan_publik: "Carrier untuk perjalanan outdoor.",
      status: "active",
      is_public: true,
      updated_at: "2026-11-01T00:00:00.000Z",
      kategori: { kategori_barang_id: "category-1", nama: "Tas & Carrier", status: "active" },
    };
    const variant45 = {
      varian_barang_id: "variant-45",
      barang_id: "barang-carrier",
      nama: "45 L",
      kode_internal: "CARRIER-45L",
      deskripsi: null,
      atribut_pembeda: { kapasitas: "45 L" },
      status: "active",
      media: [{
        varian_barang_media_id: "variant-media-45",
        usaha_id: "usaha-a",
        varian_barang_id: "variant-45",
        storage_bucket: "rental-public-media",
        storage_path: "usaha-a/varian/variant-45/cover.webp",
        media_type: "image/webp",
        urutan: 1,
        is_cover: true,
        status: "valid",
        url: "https://cdn.example.test/variant-45.webp",
      }],
    };
    const variant60 = {
      varian_barang_id: "variant-60",
      barang_id: "barang-carrier",
      nama: "60 L",
      kode_internal: "CARRIER-60L",
      deskripsi: null,
      atribut_pembeda: { kapasitas: "60 L" },
      status: "active",
    };
    const makeUnit = (id: string, code: string, variant: { varian_barang_id: string; nama: string; [key: string]: unknown }) => ({
      ...unit,
      unit_barang_id: id,
      barang_id: "barang-carrier",
      varian_barang_id: variant.varian_barang_id,
      kode_unit: code,
      barang: { barang_id: "barang-carrier", nama: "Carrier", slug: "carrier", status: "active" },
      varian: { ...variant, usaha_id: "usaha-a" },
    });

    serviceMock.listInventoryUnitMediaForUnits.mockResolvedValue([{
      unit_media_id: "unit-media-45-1",
      usaha_id: "usaha-a",
      unit_barang_id: "unit-45-1",
      storage_bucket: "rental-private-inventory",
      storage_path: "usaha-a/unit/unit-45-1/real.webp",
      media_type: "image/webp",
      urutan: 1,
      is_cover: true,
      status: "valid",
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
      signed_url: "https://signed.example.test/unit-45-1.webp",
    }]);
    serviceMock.getInventoryProductDetail.mockResolvedValue({
      product,
      variants: [variant45, variant60],
      media: [],
      summary: {
        barang_id: "barang-carrier",
        nama: "Carrier",
        slug: "carrier",
        status: "active",
        kategori_nama: "Tas & Carrier",
        total_unit: 3,
        ready_unit: 2,
        rented_unit: 1,
        attention_unit: 0,
        inspection_pending_unit: 0,
        maintenance_unit: 0,
        damaged_unit: 0,
        lost_unit: 0,
        inactive_unit: 0,
        variant_count: 2,
        latest_unit_updated_at: "2026-11-01T00:00:00.000Z",
        cover_url: null,
      },
      units: {
        units: [
          makeUnit("unit-45-1", "TAS-CARRIER-CARRIER-002", variant45),
          makeUnit("unit-45-2", "TAS-CARRIER-CARRIER-003", variant45),
          makeUnit("unit-60-1", "TAS-CARRIER-CARRIER-004", variant60),
        ],
        total: 3,
      },
      recentHistory: [],
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/inventaris/barang/barang-carrier"]}>
          <Routes>
            <Route path="/inventaris/barang/:id" element={<InventoryProductShow />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const group45 = await screen.findByRole("region", { name: "Varian 45 L" });
    const group60 = screen.getByRole("region", { name: "Varian 60 L" });

    expect(screen.queryByRole("heading", { name: "Deskripsi" })).not.toBeInTheDocument();
    expect(within(group45).getByText("2 ditampilkan")).toBeInTheDocument();
    expect(within(group45).getAllByText("Carrier · 45 L")).toHaveLength(2);
    expect(within(group45).getByText("Kode unit · TAS-CARRIER-CARRIER-002")).toHaveClass("font-mono");
    expect(within(group45).getByText("Kode unit · TAS-CARRIER-CARRIER-003")).toBeInTheDocument();
    expect(within(group60).getByText("Carrier · 60 L")).toBeInTheDocument();
    expect(within(group60).queryByText("TAS-CARRIER-CARRIER-002")).not.toBeInTheDocument();
    expect(await screen.findByAltText("Foto fisik TAS-CARRIER-CARRIER-002")).toHaveAttribute(
      "src",
      "https://signed.example.test/unit-45-1.webp",
    );
    expect(screen.getByAltText("Foto varian Carrier · 45 L")).toHaveAttribute(
      "src",
      "https://cdn.example.test/variant-45.webp",
    );

    const pageOneUnits = [
      ...Array.from({ length: 9 }, (_, index) => makeUnit("unit-page1-45-" + index, "CARRIER-45-" + index, variant45)),
      makeUnit("unit-page1-60-1", "CARRIER-60-001", variant60),
    ];
    const pageTwoUnits = [
      makeUnit("unit-page2-60-1", "CARRIER-60-002", variant60),
      makeUnit("unit-page2-60-2", "CARRIER-60-003", variant60),
      makeUnit("unit-page2-60-3", "CARRIER-60-004", variant60),
    ];
    serviceMock.listInventoryUnits.mockImplementation(async (_usahaId, filters) => ({
      units: filters.page === 1 ? pageOneUnits : pageTwoUnits,
      total: 13,
    }));

    fireEvent.click(screen.getByRole("button", { name: "Unit" }));
    await waitFor(() => expect(serviceMock.listInventoryUnits).toHaveBeenCalled(), { timeout: 5_000 });
    expect(await screen.findByText("Menampilkan 1–10 dari 13 unit")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Varian 45 L" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Varian 60 L" })).toBeInTheDocument();
    expect(serviceMock.listInventoryUnits).toHaveBeenNthCalledWith(
      1,
      "usaha-a",
      expect.objectContaining({
        barangId: "barang-carrier",
        varianBarangId: "all",
        page: 1,
        pageSize: 10,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
    expect(await screen.findByText("Menampilkan 11–13 dari 13 unit")).toBeInTheDocument();
    expect(serviceMock.listInventoryUnits).toHaveBeenNthCalledWith(
      2,
      "usaha-a",
      expect.objectContaining({ barangId: "barang-carrier", page: 2, pageSize: 10 }),
    );
  });
});
