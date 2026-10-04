import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { InspectionList } from "@/pages/pemeriksaan/list";
import { InspectionShow } from "@/pages/pemeriksaan/show";

const serviceMock = vi.hoisted(() => ({
  getPemeriksaanContext: vi.fn(),
  listInspectionQueue: vi.fn(),
  getInspectionWorkspace: vi.fn(),
  getInspectionCapabilities: vi.fn(),
  startInspection: vi.fn(),
  completeInspection: vi.fn(),
  reconcileInspectionCommand: vi.fn(),
  uploadAndAttachInspectionEvidence: vi.fn(),
  semanticInspectionLabel: (value: string | null | undefined) => value ?? "-",
  formatInspectionDateTime: (value: string | null | undefined) => value ?? "-",
  nextInspectionAction: vi.fn((value: string | null | undefined) => value === "maintenance_required" ? "Diteruskan ke Perawatan" : "Diteruskan ke readiness review Inventaris"),
  normalizeInspectionFindings: (findings: unknown[]) => findings,
}));

vi.mock("@/features/pemeriksaan", async () => {
  const actual = await vi.importActual<typeof import("@/features/pemeriksaan")>("@/features/pemeriksaan");
  return { ...actual, ...serviceMock };
});

const context = { akunAdminId: "admin-1", usahaId: "usaha-a", usahaNama: "Usaha A", timezone: "Asia/Jakarta" };
const workspace = {
  returnDetail: {
    detail_pengembalian_id: "detail-1",
    pengembalian_id: "return-1",
    unit_barang_id: "unit-1",
    diterima_at: "2026-09-28T03:00:00Z",
    status_pemeriksaan: "pending",
    catatan: null,
    updated_at: "2026-09-28T03:00:00Z",
  },
  returnHeader: { pengembalian_id: "return-1", nomor_pengembalian: "RET-001", penyewaan_id: "rental-1", status: "completed" },
  renter: { penyewa_id: "renter-1", nama_lengkap: "Ahmad", nomor_telepon: "0812" },
  unit: { unit_barang_id: "unit-1", kode_unit: "TD4P-001", status: "inspection_pending", updated_at: "2026-09-28T03:00:00Z", barang_nama: "Tenda", varian_nama: null },
  currentInspection: null,
  history: [],
};

function renderWithQuery(node: React.ReactNode, entry = "/pemeriksaan") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}>{node}</MemoryRouter></QueryClientProvider>);
}

describe("Pemeriksaan UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMock.getPemeriksaanContext.mockResolvedValue(context);
    serviceMock.getInspectionCapabilities.mockReturnValue({
      read: true,
      mutation: true,
      commands: ["start_inspection", "complete_inspection", "attach_inspection_evidence", "command_reconcile_inspection_mutation"],
      queries: ["listInspectionQueue", "getInspectionWorkspace"],
      reason: "Trusted command inspection.",
    });
    serviceMock.nextInspectionAction.mockImplementation((value: string | null | undefined) => value === "maintenance_required" ? "Diteruskan ke Perawatan" : "Diteruskan ke readiness review Inventaris");
  });

  test("queue shows returned unit and waiting state", async () => {
    serviceMock.listInspectionQueue.mockResolvedValue([{
      detail_pengembalian_id: "detail-1",
      pengembalian_id: "return-1",
      nomor_pengembalian: "RET-001",
      unit_barang_id: "unit-1",
      kode_unit: "TD4P-001",
      barang_nama: "Tenda",
      varian_nama: "Eiger 4P",
      penyewa_nama: "Ahmad",
      diterima_at: "2026-09-28T03:00:00Z",
      status_pemeriksaan: "pending",
      inspection_state: "waiting",
      latest_pemeriksaan_id: null,
      latest_hasil: null,
      latest_keputusan_operasional: null,
      unit_updated_at: "2026-09-28T03:00:00Z",
    }]);
    renderWithQuery(<InspectionList />);
    expect((await screen.findAllByText("TD4P-001")).length).toBeGreaterThan(0);
    expect(screen.getByText(/RET-001/)).toBeInTheDocument();
    expect(screen.getAllByText("Menunggu Pemeriksaan").length).toBeGreaterThan(0);
  });

  test("detail cannot create inspection without server start", async () => {
    serviceMock.getInspectionWorkspace.mockResolvedValue(workspace);
    serviceMock.startInspection.mockResolvedValue({
      pemeriksaan_id: "inspection-1",
      detail_pengembalian_id: "detail-1",
      unit_barang_id: "unit-1",
      state: "in_progress",
      reused_draft: false,
    });

    renderWithQuery(
      <Routes><Route path="/pemeriksaan/:id" element={<InspectionShow />} /></Routes>,
      "/pemeriksaan/detail-1",
    );

    expect(await screen.findByRole("heading", { name: "TD4P-001" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mulai Pemeriksaan" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mulai Pemeriksaan" }));
    expect(await screen.findByText(/Pemeriksaan dimulai/i)).toBeInTheDocument();
    expect(serviceMock.startInspection).toHaveBeenCalledWith("usaha-a", "detail-1", "unit-1", expect.any(String));
  });

  test("completed inspection displays findings boundary and hands off to maintenance", async () => {
    serviceMock.getInspectionWorkspace.mockResolvedValue({
      ...workspace,
      returnDetail: { ...workspace.returnDetail, status_pemeriksaan: "completed" },
      currentInspection: {
        pemeriksaan_id: "inspection-1",
        detail_pengembalian_id: "detail-1",
        unit_barang_id: "unit-1",
        diperiksa_at: "2026-09-28T04:00:00Z",
        diperiksa_by_admin_id: "admin-1",
        hasil: "issue_found",
        kelengkapan_status: "incomplete",
        keputusan_operasional: "maintenance_required",
        catatan: "Temuan objektif",
        updated_at: "2026-09-28T04:00:00Z",
        findings: [{
          temuan_pemeriksaan_id: "finding-1",
          usaha_id: "usaha-a",
          pemeriksaan_id: "inspection-1",
          jenis_temuan: "damage",
          deskripsi: "Resleting rusak",
          tingkat: null,
          status_tindak_lanjut: "open",
          nominal_potensi_biaya: 50000,
          currency_code: "IDR",
          created_at: "2026-09-28T04:00:00Z",
          updated_at: "2026-09-28T04:00:00Z",
        }],
        evidences: [],
      },
      linkedMaintenance: {
        perawatan_id: "maintenance-1",
        pemeriksaan_id: "inspection-1",
        jenis_perawatan: "repair",
        status: "planned",
        deskripsi_pekerjaan: "Perbaikan setelah penyewaan.",
        updated_at: "2026-09-28T04:00:00Z",
      },
      history: [],
    });

    renderWithQuery(
      <Routes><Route path="/pemeriksaan/:id" element={<InspectionShow />} /></Routes>,
      "/pemeriksaan/detail-1",
    );

    expect(await screen.findByText("Perlu Perawatan")).toBeInTheDocument();
    expect(screen.getByText("Pemeriksaan selesai", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Perawatan sudah dibuat/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Lanjutkan Perawatan/i })).toHaveAttribute("href", "/perawatan/maintenance-1");
  });

  test("unknown outcome exposes reconciliation instead of retry", async () => {
    serviceMock.getInspectionWorkspace.mockResolvedValue(workspace);
    serviceMock.startInspection.mockRejectedValue(new Error("UNKNOWN_OUTCOME: hasil start belum dapat dipastikan."));
    serviceMock.reconcileInspectionCommand.mockResolvedValue({
      state: "committed",
      command_name: "start_inspection",
      response: {
        pemeriksaan_id: "inspection-1",
        detail_pengembalian_id: "detail-1",
        unit_barang_id: "unit-1",
        state: "in_progress",
        reused_draft: false,
      },
    });

    renderWithQuery(
      <Routes><Route path="/pemeriksaan/:id" element={<InspectionShow />} /></Routes>,
      "/pemeriksaan/detail-1",
    );

    expect(await screen.findByRole("heading", { name: "TD4P-001" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mulai Pemeriksaan" }));
    expect(await screen.findByRole("button", { name: "Periksa Status Tindakan" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Periksa Status Tindakan" }));
    expect(await screen.findByText(/Perubahan sudah disimpan/i)).toBeInTheDocument();
    expect(serviceMock.startInspection).toHaveBeenCalledTimes(1);
    expect(serviceMock.reconcileInspectionCommand).toHaveBeenCalledTimes(1);
  });
});
