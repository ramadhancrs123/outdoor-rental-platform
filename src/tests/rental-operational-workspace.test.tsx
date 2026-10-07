import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const operationalMock = vi.hoisted(() => ({
  getOperationalReturnWorkspace: vi.fn(),
  processOperationalUnitReturn: vi.fn(),
}));

vi.mock("@/features/pengembalian/operational", () => operationalMock);
vi.mock("react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

vi.mock("@/features/penyewaan", () => ({
  formatRentalDateTime: (value: string | null | undefined) => value ?? "-",
}));

import { RentalOperationalWorkspace } from "@/components/penyewaan/rental-operational-workspace";
import type { OperationalReturnInspectionInput, OperationalReturnWorkspace } from "@/features/pengembalian/operational";

const baseWorkspace = {
  rental: {
    penyewaan_id: "rental-1",
    usaha_id: "usaha-1",
    nomor_penyewaan: "RNT-001",
    jadwal_mulai: "2026-10-01T10:00:00Z",
    jadwal_kembali: "2026-10-03T10:00:00Z",
    tolerance_deadline: "2026-10-03T20:00:00Z",
    actual_pickup_at: "2026-10-01T10:00:00Z",
    actual_return_started_at: null,
    actual_return_completed_at: null,
    status: "active",
    total_amount: 500000,
    currency_code: "IDR",
    catatan: null,
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "rental-v1",
  },
  renter: { penyewa_id: "renter-1", nama_lengkap: "Ahmad", nomor_telepon: null },
  units: [],
  returnRecords: [],
  operational_units: [],
};

const unit = (id: string, code: string) => ({
  unit_barang_id: id,
  kode_unit: code,
  barang_id: "barang-1",
  barang_nama: "Tenda Dome 4P",
  varian_barang_id: null,
  unit_status: "rented",
  kondisi_ringkas: null,
  assignment: { penetapan_unit_id: "assign-" + id, detail_penyewaan_id: "detail-1", komponen_penyewaan_id: null, status: "assigned" },
  return: null,
  inspection: null,
  maintenance: null,
  readiness_state: "inspection_pending" as const,
});

function renderWorkspace() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RentalOperationalWorkspace usahaId="usaha-1" penyewaanId="rental-1" rentalStatus="active" enabled />
    </QueryClientProvider>,
  );
}

describe("Rental operational workspace", () => {
  beforeEach(() => {
    operationalMock.getOperationalReturnWorkspace.mockReset();
    operationalMock.processOperationalUnitReturn.mockReset();
    operationalMock.getOperationalReturnWorkspace.mockResolvedValue({
      ...baseWorkspace,
      units: [],
      operational_units: [unit("unit-a", "TD4P-001"), unit("unit-b", "TD4P-002")],
    });
    operationalMock.processOperationalUnitReturn.mockResolvedValue({
      pengembalian_id: "return-1",
      detail_pengembalian_id: "return-detail-1",
      pemeriksaan_id: "inspection-1",
      perawatan_id: null,
      penyewaan_id: "rental-1",
      unit_barang_id: "unit-a",
      return: {},
      inspection: {},
      maintenance_required: false,
      readiness_state: "ready",
      block_reason: null,
      unit_status: "ready",
      ready_response: {},
    });
  });

  it("requires explicit condition before processing a unit", async () => {
    renderWorkspace();
    await screen.findByText("TD4P-001 · Tenda Dome 4P");
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    const pickers = screen.getAllByRole("button", { name: /Pilih kondisi/ });
    expect(pickers).toHaveLength(2);
    const actions = screen.getAllByRole("button", { name: /Terima Unit \+ Proses Kondisi/ });
    expect(actions[0]).toBeDisabled();
    fireEvent.click(pickers[0]);
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(actions[0]).toBeDisabled();
    expect(screen.getAllByText(/Sistem tidak menganggap unit normal/)).toHaveLength(2);
  });

  it("processes a normal unit as ready and a damaged unit as maintenance independently", async () => {
    let state = {
      ...baseWorkspace,
      units: [],
      operational_units: [unit("unit-a", "TD4P-001"), unit("unit-b", "TD4P-002")],
    } as unknown as OperationalReturnWorkspace;
    operationalMock.getOperationalReturnWorkspace.mockImplementation(async () => state);
    operationalMock.processOperationalUnitReturn.mockImplementation(async (_usahaId: string, input: { unitBarangId: string; inspection: OperationalReturnInspectionInput }) => {
      const target = state.operational_units.find((item) => item.unit_barang_id === input.unitBarangId)!;
      const ready = input.inspection.hasil === "normal";
      state = {
        ...state,
        rental: { ...state.rental, updated_at: ready ? "rental-v2" : "rental-v3" },
        operational_units: state.operational_units.map((item) => item.unit_barang_id === target.unit_barang_id ? {
          ...item,
          unit_status: ready ? "ready" : "maintenance",
          return: { detail_pengembalian_id: "detail-" + target.unit_barang_id, pengembalian_id: "return-" + target.unit_barang_id, diterima_at: "2026-10-05T11:00:00Z", kondisi_awal: null, status_pemeriksaan: "completed", catatan: null },
          inspection: { pemeriksaan_id: "inspection-" + target.unit_barang_id, detail_pengembalian_id: "detail-" + target.unit_barang_id, hasil: ready ? "normal" : "issue_found", kelengkapan_status: ready ? "complete" : "complete", keputusan_operasional: ready ? "ready_review" : "maintenance_required", diperiksa_at: "2026-10-05T11:00:00Z", catatan: null, finding_count: ready ? 0 : 1 },
          maintenance: ready ? null : { perawatan_id: "maintenance-" + target.unit_barang_id, pemeriksaan_id: "inspection-" + target.unit_barang_id, jenis_perawatan: "perbaikan", status: "planned", dimulai_at: null, selesai_at: null, biaya: null, currency_code: "IDR", pelaksana: null },
          readiness_state: ready ? "ready" : "maintenance_required",
        } : item),
      };
      return {
        pengembalian_id: "return-1",
        detail_pengembalian_id: "detail-1",
        pemeriksaan_id: "inspection-1",
        perawatan_id: ready ? null : "maintenance-" + target.unit_barang_id,
        penyewaan_id: "rental-1",
        unit_barang_id: target.unit_barang_id,
        return: {}, inspection: {}, maintenance_required: !ready,
        readiness_state: ready ? "ready" : "maintenance_required",
        block_reason: ready ? null : "Unit memerlukan tindak lanjut perawatan sebelum readiness.",
        unit_status: ready ? "ready" : "maintenance",
        ready_response: ready ? {} : null,
      };
    });

    renderWorkspace();
    await screen.findByText("TD4P-001 · Tenda Dome 4P");

    fireEvent.click(screen.getAllByRole("button", { name: /Pilih kondisi/ })[0]);
    fireEvent.click(screen.getAllByRole("radio")[0]);
    const firstProcessButton = screen.getAllByRole("button", { name: /Terima Unit \+ Proses Kondisi/ })[0];
    expect(firstProcessButton).toBeEnabled();
    fireEvent.click(firstProcessButton);

    await waitFor(() => expect(operationalMock.processOperationalUnitReturn).toHaveBeenCalledWith(
      "usaha-1",
      expect.objectContaining({
        unitBarangId: "unit-a",
        inspection: expect.objectContaining({ hasil: "normal", keputusanOperasional: "ready_review", findings: [] }),
        expectedRentalUpdatedAt: "rental-v1",
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String), requestId: expect.any(String) }),
    ));

    await waitFor(() => expect(screen.getByText("Siap Disewakan")).toBeInTheDocument());
    expect(screen.getByText("Unit sudah dikembalikan ke pool siap disewakan.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Pilih kondisi/ })[0]);
    fireEvent.click(screen.getAllByRole("radio")[2]);
    const processButtons = screen.getAllByRole("button", { name: /Terima Unit \+ Proses Kondisi/ });
    fireEvent.click(processButtons[0]);

    await waitFor(() => expect(operationalMock.processOperationalUnitReturn).toHaveBeenLastCalledWith(
      "usaha-1",
      expect.objectContaining({
        unitBarangId: "unit-b",
        inspection: expect.objectContaining({
          hasil: "issue_found",
          keputusanOperasional: "maintenance_required",
          findings: [expect.objectContaining({ jenis_temuan: "damage" })],
        }),
        expectedRentalUpdatedAt: "rental-v2",
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String), requestId: expect.any(String) }),
    ));

    await waitFor(() => expect(screen.getByText("Masuk Perawatan")).toBeInTheDocument());
    expect(screen.getByText(/Perawatan .* planned/)).toBeInTheDocument();
    expect(screen.getByText("Siap Disewakan")).toBeInTheDocument();
  });

  it("processes loss as unavailable and surfaces the lost state", async () => {
    let state = {
      ...baseWorkspace,
      units: [],
      operational_units: [unit("unit-loss", "CARRIER-EIGER-005")],
    } as unknown as OperationalReturnWorkspace;

    operationalMock.getOperationalReturnWorkspace.mockImplementation(async () => state);
    operationalMock.processOperationalUnitReturn.mockImplementation(async (_usahaId: string, input: { unitBarangId: string; inspection: OperationalReturnInspectionInput }) => {
      expect(input.unitBarangId).toBe("unit-loss");
      expect(input.inspection).toEqual(expect.objectContaining({
        hasil: "issue_found",
        kelengkapanStatus: "incomplete",
        keputusanOperasional: "unavailable",
        findings: [expect.objectContaining({ jenis_temuan: "loss" })],
      }));

      state = {
        ...state,
        rental: { ...state.rental, updated_at: "rental-v2" },
        operational_units: state.operational_units.map((item) => item.unit_barang_id === "unit-loss" ? {
          ...item,
          unit_status: "lost",
          return: { detail_pengembalian_id: "detail-loss", pengembalian_id: "return-loss", diterima_at: "2026-10-05T11:00:00Z", kondisi_awal: null, status_pemeriksaan: "completed", catatan: null },
          inspection: { pemeriksaan_id: "inspection-loss", detail_pengembalian_id: "detail-loss", hasil: "issue_found", kelengkapan_status: "incomplete", keputusan_operasional: "unavailable", diperiksa_at: "2026-10-05T11:00:00Z", catatan: "Unit hilang", finding_count: 1 },
          maintenance: null,
          readiness_state: "lost",
        } : item),
      };

      return {
        pengembalian_id: "return-loss",
        detail_pengembalian_id: "detail-loss",
        pemeriksaan_id: "inspection-loss",
        perawatan_id: null,
        penyewaan_id: "rental-1",
        unit_barang_id: "unit-loss",
        return: {},
        inspection: {},
        maintenance_required: false,
        readiness_state: "lost",
        block_reason: "Unit dinyatakan hilang dan tidak tersedia secara fisik.",
        unit_status: "lost",
        ready_response: null,
      };
    });

    renderWorkspace();
    await screen.findByText("CARRIER-EIGER-005 · Tenda Dome 4P");

    fireEvent.click(screen.getByRole("button", { name: /Pilih kondisi/ }));
    fireEvent.click(screen.getAllByRole("radio")[4]);
    const processButton = screen.getByRole("button", { name: /Terima Unit \+ Proses Kondisi/ });
    fireEvent.click(processButton);

    await waitFor(() => expect(screen.getByText("Hilang")).toBeInTheDocument());
    expect(screen.getByText("Unit ditandai Hilang dan tidak tersedia untuk penyewaan baru.")).toBeInTheDocument();
    expect(screen.getByText(/Tidak ada pekerjaan Perawatan yang dibuat/)).toBeInTheDocument();
  });

});
