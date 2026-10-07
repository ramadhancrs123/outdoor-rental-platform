import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ReturnList } from "@/pages/pengembalian/list";
import { ReturnShow } from "@/pages/pengembalian/show";
import { mockViewport } from "./viewport";

const serviceMock = vi.hoisted(() => ({
  getPengembalianContext: vi.fn(),
  listReturnQueue: vi.fn(),
  getReturnWorkspace: vi.fn(),
  lookupReturnRentalByQr: vi.fn(),
  processUnitReturn: vi.fn(),
  reconcileReturnCommand: vi.fn(),
  getReturnCapabilities: vi.fn(() => ({
    read: true,
    mutation: true,
    commands: ["process_unit_return", "command_reconcile_return_mutation"],
    queries: ["listReturnQueue", "getReturnWorkspace", "lookupReturnRentalByQr"],
    reason: "Pengembalian trusted command aktif.",
  })),
  semanticReturnLabel: (value: string | null | undefined) => value ?? "-",
  returnStatusVariant: () => "secondary",
  formatReturnDateTime: (value: string | null | undefined) => value ?? "-",
  DEFAULT_RETURN_LIST_FILTERS: { search: "", page: 1, pageSize: 20 },
}));

vi.mock("@/features/pengembalian", () => serviceMock);

const context = { akunAdminId: "admin-1", usahaId: "usaha-a", usahaNama: "Usaha A", timezone: "Asia/Jakarta" };
const rental = {
  penyewaan_id: "rental-1",
  nomor_penyewaan: "RNT-2026-001",
  status: "active",
  penyewa_id: "renter-1",
  jadwal_mulai: "2026-09-20T03:00:00Z",
  jadwal_kembali: "2026-09-28T03:00:00Z",
  tolerance_deadline: "2026-09-28T13:00:00Z",
  actual_pickup_at: "2026-09-20T03:30:00Z",
  actual_return_started_at: null,
  actual_return_completed_at: null,
  updated_at: "2026-09-28T03:00:00Z",
};
const units = [
  { unit_barang_id: "unit-1", kode_unit: "TD4P-001", barang_id: "barang-1", barang_nama: "Tenda Dome 4P", varian_barang_id: null, varian_nama: null, assignment_id: "assignment-1", assignment_status: "assigned", unit_status: "rented", returned: false, detail_pengembalian_id: null, received_at: null, inspection_status: null, latest_inspection: null },
  { unit_barang_id: "unit-2", kode_unit: "TD4P-002", barang_id: "barang-1", barang_nama: "Tenda Dome 4P", varian_barang_id: null, varian_nama: null, assignment_id: "assignment-2", assignment_status: "assigned", unit_status: "inspection_pending", returned: true, detail_pengembalian_id: "return-detail-1", received_at: "2026-09-28T02:00:00Z", inspection_status: "pending", latest_inspection: null },
  { unit_barang_id: "unit-3", kode_unit: "TD4P-003", barang_id: "barang-1", barang_nama: "Tenda Dome 4P", varian_barang_id: null, varian_nama: null, assignment_id: "assignment-3", assignment_status: "assigned", unit_status: "rented", returned: false, detail_pengembalian_id: null, received_at: null, inspection_status: null, latest_inspection: null },
];
const workspace = {
  rental,
  renter: { penyewa_id: "renter-1", nama_lengkap: "Ahmad", nomor_telepon: "08123456789" },
  units,
  returnRecords: [{ pengembalian_id: "return-1", nomor_pengembalian: "RET-2026-001", dimulai_at: "2026-09-28T02:00:00Z", selesai_at: "2026-09-28T02:00:00Z", status: "completed", diproses_by_admin_id: "admin-1", catatan: "Diterima", detailIds: ["return-detail-1"] }],
};

function renderWithQuery(element: React.ReactNode, initialEntry = "/pengembalian") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[initialEntry]}>{element}</MemoryRouter></QueryClientProvider>);
}

describe("Pengembalian read/mutation UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMock.getReturnCapabilities.mockReturnValue({
      read: true, mutation: true,
      commands: ["process_unit_return", "command_reconcile_return_mutation"],
      queries: ["listReturnQueue", "getReturnWorkspace", "lookupReturnRentalByQr"],
      reason: "Pengembalian trusted command aktif.",
    });
    serviceMock.getPengembalianContext.mockResolvedValue(context);
    serviceMock.lookupReturnRentalByQr.mockResolvedValue({ unit_barang_id: "unit-1", kode_unit: "TD4P-001", rental_ids: ["rental-1"] });
  });

  test("tenant-scoped queue renders progress and action", async () => {
    serviceMock.listReturnQueue.mockResolvedValue({
      returns: [{
        penyewaan_id: "rental-1",
        nomor_penyewaan: "RNT-2026-001",
        penyewa_id: "renter-1",
        penyewa_nama: "Ahmad",
        jadwal_kembali: rental.jadwal_kembali,
        tolerance_deadline: rental.tolerance_deadline,
        rental_status: "active",
        total_unit_count: 3,
        returned_unit_count: 1,
        outstanding_unit_count: 2,
        return_progress: 1 / 3,
        due_state: "due",
      }],
      total: 1,
    });

    renderWithQuery(<ReturnList />);
    await waitFor(() => expect(serviceMock.listReturnQueue).toHaveBeenCalled(), { timeout: 10_000 });
    expect((await screen.findAllByText("RNT-2026-001")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 / 3").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Proses/i }).length).toBeGreaterThan(0);
  });

  test("mobile branch keeps return action accessible", async () => {
    mockViewport(375, 812);
    serviceMock.listReturnQueue.mockResolvedValue({
      returns: [{
        penyewaan_id: "rental-1",
        nomor_penyewaan: "RNT-2026-001",
        penyewa_id: "renter-1",
        penyewa_nama: "Ahmad",
        jadwal_kembali: rental.jadwal_kembali,
        tolerance_deadline: rental.tolerance_deadline,
        rental_status: "active",
        total_unit_count: 3,
        returned_unit_count: 1,
        outstanding_unit_count: 2,
        return_progress: 1 / 3,
        due_state: "due",
      }],
      total: 1,
    });
    const { container } = renderWithQuery(<ReturnList />);
    expect((await screen.findAllByText("RNT-2026-001")).length).toBeGreaterThan(0);
    expect(container.querySelector(".md\\:hidden")).toBeInTheDocument();
    expect(container.querySelector('a[href="/pengembalian/rental-1"]')).toBeInTheDocument();
  });

  test("return list uses compact filter chips and expandable mobile card", async () => {
    mockViewport(390, 844);
    serviceMock.listReturnQueue.mockResolvedValue({
      returns: [{
        penyewaan_id: "rental-1",
        nomor_penyewaan: "RNT-2026-001",
        penyewa_id: "renter-1",
        penyewa_nama: "Ahmad",
        jadwal_kembali: rental.jadwal_kembali,
        tolerance_deadline: rental.tolerance_deadline,
        rental_status: "active",
        total_unit_count: 3,
        returned_unit_count: 1,
        outstanding_unit_count: 2,
        return_progress: 1 / 3,
        due_state: "due",
      }],
      total: 1,
    });

    renderWithQuery(<ReturnList />);
    expect(await screen.findByRole("heading", { name: "Antrian Pengembalian" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Cari nomor penyewaan, nama penyewa, nomor telepon, atau kode unit...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Semua$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Batas$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Status$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Penyewa$/ })).toBeInTheDocument();
    expect((await screen.findAllByText("RNT-2026-001")).length).toBeGreaterThan(0);

    const toggle = screen.getByRole("button", { name: "Buka detail pengembalian" });
    fireEvent.click(toggle);
    expect(screen.getAllByRole("link", { name: /Proses Pengembalian/ }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /^Status$/ }));
    expect(await screen.findByText("Filter Pengembalian")).toBeInTheDocument();
    expect(screen.getAllByText("Status Penyewaan").length).toBeGreaterThan(0);
  });

  test("detail exposes renter context, unit-level return and inspection-pending distinction", async () => {
    serviceMock.getReturnWorkspace.mockResolvedValue(workspace);
    renderWithQuery(
      <Routes><Route path="/pengembalian/:id" element={<ReturnShow />} /></Routes>,
      "/pengembalian/rental-1",
    );
    expect(await screen.findByRole("heading", { name: "RNT-2026-001" })).toBeInTheDocument();
    expect(screen.getByText("Ahmad")).toBeInTheDocument();
    expect(screen.getByText("08123456789")).toBeInTheDocument();
    expect(screen.getAllByText("TD4P-002").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sudah diterima").length).toBeGreaterThan(0);
    expect(screen.getByText(/Jadwal pengembalian dan pengembalian aktual adalah fakta yang berbeda/i)).toBeInTheDocument();
  });

  test("explicit selection calls one trusted return mutation and clears selected units", async () => {
    serviceMock.getReturnWorkspace.mockResolvedValue(workspace);
    serviceMock.processUnitReturn.mockResolvedValue({
      pengembalian_id: "return-2",
      nomor_pengembalian: "RET-2026-002",
      penyewaan_id: "rental-1",
      status: "completed",
      rental_status: "completed",
      actual_return_at: "2026-09-28T03:05:00Z",
      unit_barang_ids: ["unit-1"],
      detail_pengembalian_ids: ["return-detail-2"],
      returned_unit_count: 3,
      expected_unit_count: 3,
    });

    renderWithQuery(
      <Routes><Route path="/pengembalian/:id" element={<ReturnShow />} /></Routes>,
      "/pengembalian/rental-1",
    );

    expect(await screen.findByRole("heading", { name: "RNT-2026-001" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Pilih unit TD4P-001" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Lanjut ke Konfirmasi" }));
    fireEvent.click(screen.getByRole("button", { name: "Terima Pengembalian" }));
    await screen.findByText("Pengembalian Berhasil Dicatat");
    expect(serviceMock.processUnitReturn).toHaveBeenCalledWith("usaha-a", {
      rentalId: "rental-1",
      unitBarangIds: ["unit-1"],
      catatan: "",
    }, expect.objectContaining({
      expectedRentalUpdatedAt: rental.updated_at,
    }));
  });

  test("unknown outcome exposes reconciliation instead of retry", async () => {
    serviceMock.getReturnWorkspace.mockResolvedValue(workspace);
    serviceMock.processUnitReturn.mockRejectedValue(new Error("UNKNOWN_OUTCOME: command pengembalian memiliki idempotency record tanpa response."));
    serviceMock.reconcileReturnCommand.mockResolvedValue({ state: "committed", response: { status: "completed" } });

    renderWithQuery(
      <Routes><Route path="/pengembalian/:id" element={<ReturnShow />} /></Routes>,
      "/pengembalian/rental-1",
    );

    expect(await screen.findByRole("heading", { name: "RNT-2026-001" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Pilih unit TD4P-001" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Lanjut ke Konfirmasi" }));
    fireEvent.click(screen.getByRole("button", { name: "Terima Pengembalian" }));
    expect(await screen.findByRole("button", { name: "Periksa Status Tindakan" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Periksa Status Tindakan" }));
    expect(await screen.findByText("Pengembalian Berhasil Dicatat")).toBeInTheDocument();
    expect(serviceMock.processUnitReturn).toHaveBeenCalledTimes(1);
    expect(serviceMock.reconcileReturnCommand).toHaveBeenCalledTimes(1);
  });
});
