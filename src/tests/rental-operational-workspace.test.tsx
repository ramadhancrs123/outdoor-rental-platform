import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const operationalMock = vi.hoisted(() => ({
  getOperationalReturnWorkspace: vi.fn(),
  processOperationalUnitReturns: vi.fn(),
}));

vi.mock("@/features/pengembalian/operational", () => operationalMock);
vi.mock("react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

vi.mock("@/features/penyewaan", () => ({
  formatRentalDateTime: (value: string | null | undefined) => value ?? "-",
}));

import { RentalOperationalWorkspace } from "@/components/penyewaan/rental-operational-workspace";
import type { OperationalReturnWorkspace } from "@/features/pengembalian/operational";

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

function returned(unitId: string, choice: "normal" | "damage" | "loss") {
  const ready = choice === "normal";
  const lost = choice === "loss";
  return {
    ...unit(unitId, unitId === "unit-a" ? "TD4P-001" : unitId === "unit-b" ? "TD4P-002" : unitId === "unit-loss" ? "CARRIER-EIGER-005" : unitId.toUpperCase()),
    unit_status: ready ? "ready" : lost ? "lost" : "maintenance",
    return: {
      detail_pengembalian_id: "detail-return-" + unitId,
      pengembalian_id: "return-" + unitId,
      diterima_at: "2026-10-05T11:00:00Z",
      kondisi_awal: null,
      status_pemeriksaan: "completed",
      catatan: null,
    },
    inspection: {
      pemeriksaan_id: "inspection-" + unitId,
      detail_pengembalian_id: "detail-return-" + unitId,
      hasil: ready ? "normal" : "issue_found",
      kelengkapan_status: choice === "loss" ? "incomplete" : "complete",
      keputusan_operasional: ready ? "ready_review" : lost ? "unavailable" : "maintenance_required",
      diperiksa_at: "2026-10-05T11:00:00Z",
      catatan: null,
      finding_count: ready ? 0 : 1,
    },
    maintenance: choice === "damage" ? {
      perawatan_id: "maintenance-" + unitId,
      pemeriksaan_id: "inspection-" + unitId,
      jenis_perawatan: "perbaikan",
      status: "planned",
      dimulai_at: null,
      selesai_at: null,
      biaya: null,
      currency_code: "IDR",
      pelaksana: null,
    } : null,
    readiness_state: ready ? "ready" as const : lost ? "lost" as const : "maintenance_required" as const,
  };
}

function renderWorkspace() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RentalOperationalWorkspace usahaId="usaha-1" penyewaanId="rental-1" rentalStatus="active" enabled />
    </QueryClientProvider>,
  );
}

function getUnitCard(code: string) {
  const heading = screen.getByText(code + " · Tenda Dome 4P");
  const card = heading.closest("div.rounded-2xl.border");
  if (!card) throw new Error("Unit card tidak ditemukan: " + code);
  return within(card as HTMLElement);
}

describe("Rental operational workspace", () => {
  beforeEach(() => {
    operationalMock.getOperationalReturnWorkspace.mockReset();
    operationalMock.processOperationalUnitReturns.mockReset();
    operationalMock.getOperationalReturnWorkspace.mockResolvedValue({
      ...baseWorkspace,
      units: [],
      operational_units: [unit("unit-a", "TD4P-001"), unit("unit-b", "TD4P-002")],
    });
    operationalMock.processOperationalUnitReturns.mockResolvedValue({
      state: "completed",
      processed: [{ unitBarangId: "unit-a", result: {} }, { unitBarangId: "unit-b", result: {} }],
    });
  });

  it("requires an explicit condition for every unit before the common action can run", async () => {
    renderWorkspace();
    await screen.findByText("TD4P-001 · Tenda Dome 4P");

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    const firstPicker = getUnitCard("TD4P-001").getByRole("button", { name: "Pilih kondisi unit" });
    const commonAction = screen.getAllByRole("button", { name: "Pilih kondisi unit" }).at(-1)!;
    expect(commonAction).toBeDisabled();

    fireEvent.click(firstPicker);
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    fireEvent.click(screen.getByRole("radio", { name: /Baik:/ }));

    expect(getUnitCard("TD4P-001").getByText("Baik")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Proses Pengembalian · 1 Unit/ }).at(-1)).toBeEnabled();
    expect(operationalMock.processOperationalUnitReturns).not.toHaveBeenCalled();
  });

  it("processes selected units through one sequential orchestration while preserving each condition payload", async () => {
    let state = {
      ...baseWorkspace,
      units: [],
      operational_units: [unit("unit-a", "TD4P-001"), unit("unit-b", "TD4P-002")],
    } as unknown as OperationalReturnWorkspace;
    operationalMock.getOperationalReturnWorkspace.mockImplementation(async () => state);
    operationalMock.processOperationalUnitReturns.mockImplementation(async (
      _usahaId: string,
      input: {
        rentalId: string;
        units: Array<{ unitBarangId: string; inspection: Record<string, unknown> }>;
      },
      options: { onProgress?: (progress: { index: number; total: number; unitBarangId: string }) => void },
    ) => {
      input.units.forEach((entry, index) => {
        options.onProgress?.({ index: index + 1, total: input.units.length, unitBarangId: entry.unitBarangId });
      });
      state = {
        ...state,
        rental: { ...state.rental, updated_at: "rental-v3" },
        operational_units: [
          returned("unit-a", "normal"),
          returned("unit-b", "damage"),
        ] as unknown as typeof state.operational_units,
      };
      return {
        state: "completed",
        processed: [
          { unitBarangId: "unit-a", result: {} },
          { unitBarangId: "unit-b", result: {} },
        ],
      };
    });

    renderWorkspace();
    await screen.findByText("TD4P-001 · Tenda Dome 4P");

    const firstCard = getUnitCard("TD4P-001");
    fireEvent.click(firstCard.getByRole("button", { name: "Pilih kondisi unit" }));
    fireEvent.click(screen.getByRole("radio", { name: /Baik:/ }));

    const secondCard = getUnitCard("TD4P-002");
    fireEvent.click(secondCard.getByRole("button", { name: "Pilih kondisi unit" }));
    fireEvent.click(screen.getByRole("radio", { name: /Rusak:/ }));

    const finishButton = screen.getAllByRole("button", { name: /Selesaikan Sewa/ }).at(-1)!;
    expect(finishButton).toBeEnabled();
    fireEvent.click(finishButton);

    await waitFor(() => expect(operationalMock.processOperationalUnitReturns).toHaveBeenCalledTimes(1));
    expect(operationalMock.processOperationalUnitReturns).toHaveBeenCalledWith(
      "usaha-1",
      expect.objectContaining({
        rentalId: "rental-1",
        units: [
          {
            unitBarangId: "unit-a",
            inspection: expect.objectContaining({
              hasil: "normal",
              kelengkapanStatus: "complete",
              keputusanOperasional: "ready_review",
              findings: [],
            }),
          },
          {
            unitBarangId: "unit-b",
            inspection: expect.objectContaining({
              hasil: "issue_found",
              kelengkapanStatus: "complete",
              keputusanOperasional: "maintenance_required",
              findings: [expect.objectContaining({ jenis_temuan: "damage" })],
            }),
          },
        ],
      }),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );

    await waitFor(() => expect(getUnitCard("TD4P-001").getByText("Siap Disewakan")).toBeInTheDocument());
    expect(getUnitCard("TD4P-002").getByText("Masuk Perawatan")).toBeInTheDocument();
    expect(getUnitCard("TD4P-002").getByText(/Perawatan .* planned/)).toBeInTheDocument();
  });

  it("keeps a failed damaged unit visible and preserves selection after a partial batch", async () => {
    let state = {
      ...baseWorkspace,
      units: [],
      operational_units: [unit("unit-a", "TD4P-001"), unit("unit-b", "TD4P-002")],
    } as unknown as OperationalReturnWorkspace;
    operationalMock.getOperationalReturnWorkspace.mockImplementation(async () => state);
    operationalMock.processOperationalUnitReturns.mockImplementation(async () => {
      state = {
        ...state,
        rental: { ...state.rental, updated_at: "rental-v2" },
        operational_units: [
          returned("unit-a", "normal"),
          unit("unit-b", "TD4P-002"),
        ] as unknown as typeof state.operational_units,
      };
      return {
        state: "partial",
        processed: [{ unitBarangId: "unit-a", result: {} }],
        failedUnitId: "unit-b",
        error: "RPC ERROR: maintenance handoff rejected for finding type damage.",
        unknownOutcome: false,
      };
    });

    renderWorkspace();
    await screen.findByText("TD4P-001 · Tenda Dome 4P");
    fireEvent.click(getUnitCard("TD4P-001").getByRole("button", { name: "Pilih kondisi unit" }));
    fireEvent.click(screen.getByRole("radio", { name: /Baik:/ }));
    fireEvent.click(getUnitCard("TD4P-002").getByRole("button", { name: "Pilih kondisi unit" }));
    fireEvent.click(screen.getByRole("radio", { name: /Rusak:/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Selesaikan Sewa/ }).at(-1)!);

    await waitFor(() => expect(screen.getByText(/RPC ERROR: maintenance handoff rejected/)).toBeInTheDocument());
    expect(getUnitCard("TD4P-001").getByText("Siap Disewakan")).toBeInTheDocument();
    expect(getUnitCard("TD4P-002").getByText("Belum kembali")).toBeInTheDocument();
    expect(getUnitCard("TD4P-002").getByText("Kondisi: Rusak")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Selesaikan Sewa/ }).at(-1)).toBeEnabled();
  });

  it("blocks a unit that is not in rented inventory state", async () => {
    operationalMock.getOperationalReturnWorkspace.mockResolvedValue({
      ...baseWorkspace,
      units: [],
      operational_units: [{ ...unit("unit-ready", "PERLENGKAPAN-TRACKING-POLE-001"), unit_status: "ready" }],
    });

    renderWorkspace();
    await screen.findByText("PERLENGKAPAN-TRACKING-POLE-001 · Tenda Dome 4P");

    expect(screen.getByText("Penerimaan unit diblokir")).toBeInTheDocument();
    const blockedAlert = screen.getByRole("alert");
    expect(blockedAlert.textContent?.toLowerCase()).toContain("sistem hanya menerima pengembalian");
    expect(blockedAlert.textContent?.toLowerCase()).toContain("rented");
    expect(getUnitCard("PERLENGKAPAN-TRACKING-POLE-001").queryByRole("button", { name: "Pilih kondisi unit" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tidak ada unit untuk diproses" })).toBeDisabled();
    expect(operationalMock.processOperationalUnitReturns).not.toHaveBeenCalled();
  });

  it("preserves the unavailable outcome for a lost unit", async () => {
    let state = {
      ...baseWorkspace,
      units: [],
      operational_units: [unit("unit-loss", "CARRIER-EIGER-005")],
    } as unknown as OperationalReturnWorkspace;
    operationalMock.getOperationalReturnWorkspace.mockImplementation(async () => state);
    operationalMock.processOperationalUnitReturns.mockImplementation(async (
      _usahaId: string,
      input: { units: Array<{ unitBarangId: string; inspection: Record<string, unknown> }> },
    ) => {
      expect(input.units[0]).toEqual(expect.objectContaining({
        unitBarangId: "unit-loss",
        inspection: expect.objectContaining({
          hasil: "issue_found",
          kelengkapanStatus: "incomplete",
          keputusanOperasional: "unavailable",
          findings: [expect.objectContaining({ jenis_temuan: "loss" })],
        }),
      }));
      state = {
        ...state,
        operational_units: [returned("unit-loss", "loss")] as unknown as typeof state.operational_units,
      };
      return { state: "completed", processed: [{ unitBarangId: "unit-loss", result: {} }] };
    });

    renderWorkspace();
    await screen.findByText("CARRIER-EIGER-005 · Tenda Dome 4P");
    fireEvent.click(getUnitCard("CARRIER-EIGER-005").getByRole("button", { name: "Pilih kondisi unit" }));
    fireEvent.click(screen.getByRole("radio", { name: /Hilang:/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Selesaikan Sewa/ }).at(-1)!);

    await waitFor(() => expect(getUnitCard("CARRIER-EIGER-005").getByText("Hilang")).toBeInTheDocument());
    expect(getUnitCard("CARRIER-EIGER-005").getByText("Unit ditandai Hilang dan tidak tersedia untuk penyewaan baru.")).toBeInTheDocument();
    expect(getUnitCard("CARRIER-EIGER-005").getByText(/Tidak ada pekerjaan Perawatan yang dibuat/)).toBeInTheDocument();
  });
});
