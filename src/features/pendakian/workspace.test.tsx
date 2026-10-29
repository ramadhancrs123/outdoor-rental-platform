import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PendakianWorkspace } from "@/pages/pendakian";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  list: vi.fn(),
  forecast: vi.fn(),
  save: vi.fn(),
  uploadRoute: vi.fn(),
  applyRoute: vi.fn(),
  uploadMedia: vi.fn(),
}));

vi.mock("./service", () => ({
  getHikingOverview: mocks.overview,
  listHikingResource: mocks.list,
  getHikingForecast: mocks.forecast,
  saveHikingAction: mocks.save,
  uploadGpxRoute: mocks.uploadRoute,
  applyGpxRoute: mocks.applyRoute,
  uploadHikingMedia: mocks.uploadMedia,
}));

vi.mock("./map-canvas", () => ({
  HikingMapCanvas: () => <div data-testid="hiking-map-preview">Peta interaktif</div>,
}));

describe("PendakianWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.overview.mockResolvedValue({
      resource: "overview",
      generatedAt: "2026-10-29T00:00:00.000Z",
      counts: { mountains: 0, trails: 0, checkpoints: 0 },
      mountainReviewQueue: [],
      featureFlags: [
        { flag_key: "public_hiking_catalog_enabled", is_enabled: false, description: "Katalog ditahan", updated_at: "2026-10-29T00:00:00.000Z", isLocked: false },
        { flag_key: "bmkg_forecast_enabled", is_enabled: true, description: "Prakiraan BMKG", updated_at: "2026-10-29T00:00:00.000Z", isLocked: false },
        { flag_key: "bmkg_nowcast_alerts_enabled", is_enabled: true, description: "Peringatan BMKG", updated_at: "2026-10-29T00:00:00.000Z", isLocked: false },
        { flag_key: "hiking_ticket_booking_enabled", is_enabled: false, description: "Pemesanan belum diaktifkan", updated_at: "2026-10-29T00:00:00.000Z", isLocked: true },
        { flag_key: "akasha_rental_booking_enabled", is_enabled: false, description: "Transaksi rental tidak diaktifkan", updated_at: "2026-10-29T00:00:00.000Z", isLocked: true },
      ],
      policy: { bookingEnabled: false, bookingActivationAllowedByThisApi: false, privilegedRole: "active super_admin", message: "Tetap nonaktif" },
    });
    mocks.list.mockImplementation(async (resource: string) => ({ resource, items: [], total: 0, page: 1, pageSize: 100 }));
    mocks.forecast.mockResolvedValue(null);
  });

  it("shows a single workspace and a clear preparation state without public content", async () => {
    render(<PendakianWorkspace />);
    expect(await screen.findByRole("heading", { name: "Pendakian" })).toBeInTheDocument();
    expect(screen.getByText("Mode persiapan")).toBeInTheDocument();
    expect(screen.getByText(/Katalog publik masih dalam tahap persiapan/)).toBeInTheDocument();
    expect(screen.getByText(/Pemesanan dan pembayaran tiket tetap terkunci/)).toBeInTheDocument();
  });

  it("shows information, map/routes, checkpoints and weather together in one workspace", async () => {
    render(<PendakianWorkspace />);
    await screen.findByRole("heading", { name: "Pendakian" });
    expect(screen.getByRole("button", { name: "Data & peta" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Informasi gunung" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Peta lokasi dan jalur" })).toBeInTheDocument();
    expect(screen.getByTestId("hiking-map-preview")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Impor rute dari GPX" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tambah titik penting" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cuaca wilayah otomatis" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Peta & rute" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Titik penting" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cuaca" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ADM4|kode wilayah BMKG/i)).not.toBeInTheDocument();
  });

  it("uses one contextual target selector for safety advisories", async () => {
    render(<PendakianWorkspace />);
    await screen.findByRole("heading", { name: "Pendakian" });
    fireEvent.click(screen.getByRole("button", { name: "Keselamatan" }));
    expect(screen.getByRole("heading", { name: "Buat peringatan keselamatan" })).toBeInTheDocument();
    expect(screen.getByText("Peringatan ditujukan ke", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("Untuk gunung", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Untuk jalur", { exact: true })).not.toBeInTheDocument();
  });

  it("shows booking-related switches as status only, not controls", async () => {
    render(<PendakianWorkspace />);
    await screen.findByRole("heading", { name: "Pendakian" });
    fireEvent.click(screen.getByRole("button", { name: "Status sistem" }));
    await waitFor(() => expect(screen.getByText("Pemesanan tiket pendakian")).toBeInTheDocument());
    expect(screen.getByText("Transaksi rental")).toBeInTheDocument();
    expect(screen.getAllByText("Terkunci")).toHaveLength(2);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
