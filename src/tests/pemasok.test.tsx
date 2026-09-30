import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const serviceMock = vi.hoisted(() => ({
  getPemasokContext: vi.fn(),
  listSuppliers: vi.fn(),
  getSupplier: vi.fn(),
  listSupplierPurchases: vi.fn(),
  listPurchases: vi.fn(),
  getPurchase: vi.fn(),
  getProcurementCapabilities: vi.fn(),
}));

vi.mock("@/features/pemasok/service", () => serviceMock);
vi.mock("@/features/pemasok/utils", () => ({
  supplierStatusLabel: (status: string) => status,
  supplierStatusVariant: () => "secondary",
  purchaseStatusLabel: (status: string) => status,
  purchaseStatusVariant: () => "secondary",
  formatProcurementDate: (value: string | null | undefined) => value ?? "-",
  formatProcurementDateTime: (value: string | null | undefined) => value ?? "-",
  formatPurchaseMoney: (value: string | number | null | undefined) => String(value ?? "-"),
}));

import { SupplierList } from "@/pages/pemasok/list";
import { SupplierShow } from "@/pages/pemasok/show";
import { PurchaseList } from "@/pages/pembelian/list";
import { PurchaseShow } from "@/pages/pembelian/show";

const context = { akunAdminId: "admin-1", usahaId: "usaha-a", usahaNama: "Usaha A" };
const supplier = {
  pemasok_id: "supplier-1",
  usaha_id: "usaha-a",
  nama: "PT Outdoor Sejahtera",
  nomor_telepon: "081234567890",
  email: "procurement@example.com",
  alamat: "Gudang supplier",
  status: "active",
  catatan: "Supplier sintetis",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const purchase = {
  pembelian_id: "purchase-1",
  usaha_id: "usaha-a",
  pemasok_id: "supplier-1",
  nomor_pembelian: "PB-001",
  tanggal_pembelian: "2026-01-10",
  status: "draft",
  total_amount: "4250000",
  currency_code: "IDR",
  catatan: "Pembelian sintetis",
  created_at: "2026-01-10T00:00:00Z",
  updated_at: "2026-01-10T00:00:00Z",
  pemasok_nama: "PT Outdoor Sejahtera",
  line_count: 2,
};

function renderWithQuery(element: ReactNode, route = "/pemasok") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function resetCapabilities() {
  serviceMock.getProcurementCapabilities.mockReturnValue({
    read: true,
    mutation: false,
    reason: "Trusted command boundary belum tersedia.",
  });
}

describe("Pemasok & Pembelian read-side", () => {
  beforeEach(() => {
    serviceMock.getPemasokContext.mockReset();
    serviceMock.listSuppliers.mockReset();
    serviceMock.getSupplier.mockReset();
    serviceMock.listSupplierPurchases.mockReset();
    serviceMock.listPurchases.mockReset();
    serviceMock.getPurchase.mockReset();
    resetCapabilities();
  });

  test("supplier list is tenant-bound and exposes search/read-only state", async () => {
    serviceMock.getPemasokContext.mockResolvedValue(context);
    serviceMock.listSuppliers.mockResolvedValue({
      suppliers: [{ ...supplier, purchase_count: 2, last_purchase_at: "2026-01-10" }],
      total: 1,
    });
    renderWithQuery(<SupplierList />);
    expect((await screen.findAllByText("PT Outdoor Sejahtera")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Kelola data pemasok usaha Anda/i)).toBeInTheDocument();
  });

  test("supplier detail keeps purchase history visible for inactive-capable master", async () => {
    serviceMock.getPemasokContext.mockResolvedValue(context);
    serviceMock.getSupplier.mockResolvedValue({ ...supplier, status: "inactive" });
    serviceMock.listSupplierPurchases.mockResolvedValue([purchase]);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/pemasok/supplier-1"]}>
          <Routes><Route path="/pemasok/:id" element={<SupplierShow />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "PT Outdoor Sejahtera" })).toBeInTheDocument();
    expect(screen.getByText("inactive")).toBeInTheDocument();
    await screen.findByRole("tab", { name: "Riwayat Pembelian" });
    await userEvent.click(screen.getByRole("tab", { name: "Riwayat Pembelian" }));
    expect((screen.getAllByText("PB-001")).length).toBeGreaterThan(0);
  });

  test("purchase list supports tenant read-side and empty state", async () => {
    serviceMock.getPemasokContext.mockResolvedValue(context);
    serviceMock.listPurchases.mockResolvedValue({ purchases: [], total: 0 });
    renderWithQuery(<PurchaseList />, "/pembelian");
    expect(await screen.findByText("Belum ada draft pembelian")).toBeInTheDocument();
    expect(screen.getByText(/Buat draft pengadaan baru/i)).toBeInTheDocument();
  });

  test("purchase detail presents line facts and keeps inventory/payment boundaries explicit", async () => {
    serviceMock.getPemasokContext.mockResolvedValue(context);
    serviceMock.getPurchase.mockResolvedValue({
      ...purchase,
      lines: [{
        detail_pembelian_id: "line-1",
        usaha_id: "usaha-a",
        pembelian_id: "purchase-1",
        barang_id: "barang-1",
        varian_barang_id: "variant-1",
        deskripsi: "Tenda Dome 4P",
        jumlah: "2",
        unit_price: "1500000",
        subtotal: "3000000",
        created_at: "2026-01-10T00:00:00Z",
        updated_at: "2026-01-10T00:00:00Z",
        barang_nama: "Tenda Dome 4P",
        varian_nama: "4P",
      }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/pembelian/purchase-1"]}>
          <Routes><Route path="/pembelian/:id" element={<PurchaseShow />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "PB-001" })).toBeInTheDocument();
    expect(screen.getByText(/tidak otomatis berarti receiving/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Item" }));
    expect((screen.getAllByText("Tenda Dome 4P")).length).toBeGreaterThan(0);
  });
});
