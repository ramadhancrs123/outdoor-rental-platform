import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { InventoryList } from "@/pages/inventaris/list";
import { InventoryShow } from "@/pages/inventaris/show";
import { mockViewport } from "./viewport";

const serviceMock = vi.hoisted(() => ({
  getInventarisContext: vi.fn(), listInventoryLocations: vi.fn(), listInventoryProducts: vi.fn(), listInventoryVariants: vi.fn(), listInventoryUnits: vi.fn(), getInventoryUnit: vi.fn(), getInventoryOperationalContext: vi.fn(),
  getInventoryStateCapabilities: vi.fn(() => ({ read: true, mutation: true, commands: ["register_inventory_unit", "move_inventory_unit", "mark_inventory_unit_ready", "command_mark_inventory_unit_inspection_pending", "command_reconcile_inventory_unit_mutation"], queries: ["listInventoryUnits", "getInventoryUnit", "lookupInventoryUnitByQr", "findInventoryUnitCandidates", "getInventoryOperationalContext"], reason: "Inventaris trusted command aktif." })),
}));

vi.mock("@/features/inventaris", () => ({
  getInventarisContext: serviceMock.getInventarisContext, listInventoryLocations: serviceMock.listInventoryLocations, listInventoryProducts: serviceMock.listInventoryProducts, listInventoryVariants: serviceMock.listInventoryVariants, listInventoryUnits: serviceMock.listInventoryUnits, getInventoryUnit: serviceMock.getInventoryUnit, getInventoryOperationalContext: serviceMock.getInventoryOperationalContext, getInventoryStateCapabilities: serviceMock.getInventoryStateCapabilities,
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
function renderWithQuery(element: React.ReactNode) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/inventaris"]}>{element}</MemoryRouter></QueryClientProvider>); }

describe("Inventaris read-side", () => {
  beforeEach(() => {
    serviceMock.getInventarisContext.mockReset();
    serviceMock.listInventoryLocations.mockReset();
    serviceMock.listInventoryProducts.mockReset();
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

  test("mobile inventory vocabulary and compact actions follow the approved reference", async () => {
    mockViewport(375, 812);
    serviceMock.getInventarisContext.mockResolvedValue({ ...context, usahaNama: "Akasha Store" });
    serviceMock.listInventoryLocations.mockResolvedValue([]);
    serviceMock.listInventoryUnits.mockResolvedValue({ units: [unit], total: 1 });

    renderWithQuery(<InventoryList />);

    expect(await screen.findByRole("heading", { level: 1, name: "Unit Barang" })).toBeInTheDocument();
    expect(screen.getByText("Kondisi dan informasi fisik setiap unit dalam konteks Usaha yang dipilih.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Daftarkan Unit/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Kelola Lokasi/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pindai QR/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Unit$/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^Paket$/ })).toHaveAttribute("aria-selected", "false");
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
});
