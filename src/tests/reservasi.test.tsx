import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";

const serviceMock = vi.hoisted(() => ({
  getReservasiContext: vi.fn(),
  listRequests: vi.fn(),
  getRequest: vi.fn(),
  listReservations: vi.fn(),
  getReservation: vi.fn(),
  getReservationCapabilities: vi.fn(),
  createReservationFromRequest: vi.fn(),
  confirmReservation: vi.fn(),
  cancelReservation: vi.fn(),
}));

vi.mock("@/features/reservasi/service", () => serviceMock);
vi.mock("@/features/reservasi/utils", () => ({
  requestSourceLabel: (value: string) => value,
  semanticStatusLabel: (value: string) => value,
  statusVariant: () => "secondary",
  stockLockStatusLabel: (value: string) => value,
  formatReservationDate: (value: string | null | undefined) => value ?? "-",
  formatReservationDateTime: (value: string | null | undefined) => value ?? "-",
  formatReservationMoney: (value: string | number | null | undefined) => String(value ?? "-"),
}));

import { RequestList } from "@/pages/permintaan/list";
import { RequestShow } from "@/pages/permintaan/show";
import { ReservationList } from "@/pages/reservasi/list";
import { ReservationShow } from "@/pages/reservasi/show";
import { ReservationCreate } from "@/pages/reservasi/create";

const context = { akunAdminId: "admin-1", usahaId: "usaha-a", usahaNama: "Usaha A" };
const request = {
  permintaan_sewa_id: "request-1",
  usaha_id: "usaha-a",
  penyewa_id: "renter-1",
  nomor_permintaan: "REQ-001",
  sumber: "admin",
  mulai_rencana: "2026-10-01",
  selesai_rencana: "2026-10-03",
  status: "submitted",
  catatan: null,
  submitted_at: "2026-09-27T01:00:00Z",
  processed_at: null,
  created_at: "2026-09-27T01:00:00Z",
  updated_at: "2026-09-27T01:00:00Z",
  penyewa_nama: "Ahmad Outdoor",
  detail_count: 1,
  reservasi_id: "reservation-1",
  nomor_reservasi: "RSV-001",
};

const reservation = {
  reservasi_id: "reservation-1",
  usaha_id: "usaha-a",
  permintaan_sewa_id: "request-1",
  penyewa_id: "renter-1",
  nomor_reservasi: "RSV-001",
  mulai_reservasi: "2026-10-01",
  selesai_reservasi: "2026-10-03",
  status: "confirmed",
  stock_lock_status: "locked",
  confirmed_at: "2026-09-27T02:00:00Z",
  confirmed_by_admin_id: "admin-1",
  canceled_at: null,
  canceled_by_admin_id: null,
  cancellation_reason: null,
  catatan: null,
  created_at: "2026-09-27T02:00:00Z",
  updated_at: "2026-09-27T02:00:00Z",
  penyewa_nama: "Ahmad Outdoor",
  nomor_permintaan: "REQ-001",
  detail_count: 1,
};

function renderWithQuery(element: ReactNode, route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}>{element}</MemoryRouter></QueryClientProvider>);
}

function resetCapabilities() {
  serviceMock.getReservationCapabilities.mockReturnValue({
    read: true,
    mutation: true,
    commands: ["create_reservation_from_request", "confirm_reservation", "cancel_reservation"],
    reason: "Command Reservasi berjalan melalui trusted RPC.",
  });
}

describe("Reservasi read-side", () => {
  beforeEach(() => {
    serviceMock.getReservasiContext.mockReset();
    serviceMock.listRequests.mockReset();
    serviceMock.getRequest.mockReset();
    serviceMock.listReservations.mockReset();
    serviceMock.getReservation.mockReset();
    serviceMock.createReservationFromRequest.mockReset();
    serviceMock.confirmReservation.mockReset();
    serviceMock.cancelReservation.mockReset();
    resetCapabilities();
  });

  test("request list keeps tenant context and reservation handoff", async () => {
    serviceMock.getReservasiContext.mockResolvedValue(context);
    serviceMock.listRequests.mockResolvedValue({ requests: [request], total: 1 });
    renderWithQuery(<RequestList />, "/permintaan");
    expect((await screen.findAllByText("REQ-001")).length).toBeGreaterThan(0);
    expect((screen.getAllByText("Ahmad Outdoor")).length).toBeGreaterThan(0);
    expect(screen.getByText(/command aktif/i)).toBeInTheDocument();
  });

  test("request detail distinguishes unit preference from assignment", async () => {
    serviceMock.getReservasiContext.mockResolvedValue(context);
    serviceMock.getRequest.mockResolvedValue({
      ...request,
      lines: [{ detail_permintaan_id: "detail-1", usaha_id: "usaha-a", permintaan_sewa_id: "request-1", barang_id: "barang-1", varian_barang_id: null, paket_sewa_id: null, jumlah: "2", catatan: null, barang_nama: "Tenda Dome 4P", varian_nama: null, paket_nama: null }],
      preferences: [{ pilihan_unit_id: "pref-1", detail_permintaan_id: "detail-1", unit_barang_id: "unit-1", urutan_preferensi: 1, status: "selected", catatan: null, kode_unit: "TD4P-002" }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/permintaan/request-1"]}>
          <Routes>
            <Route path="/permintaan/:id" element={<RequestShow />} />
            <Route path="/reservasi/:id" element={<div>Reservation created</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "REQ-001" })).toBeInTheDocument();
    expect(screen.getByText("TD4P-002")).toBeInTheDocument();
    expect(screen.getByText(/Preference bukan assignment/i)).toBeInTheDocument();
  });

  test("reservation list exposes lock status separately", async () => {
    serviceMock.getReservasiContext.mockResolvedValue(context);
    serviceMock.listReservations.mockResolvedValue({ reservations: [reservation], total: 1 });
    renderWithQuery(<ReservationList />, "/reservasi");
    expect((await screen.findAllByText("RSV-001")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Kapasitas Terkunci/i).length).toBeGreaterThan(0);
  });

  test("request detail hands off to the mobile reservation wizard", async () => {
    serviceMock.getReservasiContext.mockResolvedValue(context);
    serviceMock.getRequest.mockResolvedValue({
      ...request,
      reservasi_id: null,
      nomor_reservasi: null,
      lines: [{
        detail_permintaan_id: "detail-1",
        usaha_id: "usaha-a",
        permintaan_sewa_id: "request-1",
        barang_id: "barang-1",
        varian_barang_id: null,
        paket_sewa_id: null,
        jumlah: "2",
        catatan: null,
        barang_nama: "Tenda Dome 4P",
        varian_nama: null,
        paket_nama: null,
      }],
      preferences: [],
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/permintaan/request-1"]}>
          <Routes>
            <Route path="/permintaan/:id" element={<RequestShow />} />
            <Route path="/reservasi/create" element={<ReservationCreate />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.change(await screen.findByLabelText("Harga/unit"), { target: { value: "100000" } });
    fireEvent.click(await screen.findByRole("button", { name: "Lanjutkan" }));

    expect(await screen.findByText("Informasi Penyewa")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }));

    expect(await screen.findByText("Pilih Item dan Jumlah")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }));

    expect(await screen.findByText("Ringkasan Reservasi")).toBeInTheDocument();

    serviceMock.createReservationFromRequest.mockResolvedValue({
      ...reservation,
      status: "draft",
      stock_lock_status: "not_locked",
      permintaan_sewa_id: "request-1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Buat Reservasi" }));

    await waitFor(() => expect(serviceMock.createReservationFromRequest).toHaveBeenCalledTimes(1));
    expect(serviceMock.createReservationFromRequest).toHaveBeenCalledWith(
      "usaha-a",
      "request-1",
      [{
        detail_permintaan_id: "detail-1",
        unit_price: 100000,
        subtotal: 200000,
        currency_code: "IDR",
      }],
      expect.objectContaining({
        idempotencyKey: expect.stringContaining("create-reservation-request-1-"),
        requestId: expect.any(String),
      }),
    );
  });

  test("reservation detail wires confirm command through trusted boundary", async () => {
    serviceMock.getReservasiContext.mockResolvedValue(context);
    serviceMock.getReservation.mockResolvedValue({
      ...reservation,
      status: "draft",
      stock_lock_status: "not_locked",
      lines: [{
        detail_reservasi_id: "reservation-line-1",
        usaha_id: "usaha-a",
        reservasi_id: "reservation-1",
        barang_id: "barang-1",
        varian_barang_id: null,
        paket_sewa_id: null,
        jumlah: "2",
        unit_price: "1500000",
        currency_code: "IDR",
        subtotal: "3000000",
        catatan: null,
        barang_nama: "Tenda Dome 4P",
        varian_nama: null,
        paket_nama: null,
      }],
    });
    serviceMock.confirmReservation.mockResolvedValue({
      ...reservation,
      status: "confirmed",
      stock_lock_status: "locked",
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/reservasi/reservation-1"]}>
          <Routes><Route path="/reservasi/:id" element={<ReservationShow />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findAllByRole("button", { name: "Konfirmasi Reservasi" })).not.toHaveLength(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Konfirmasi Reservasi" })[0]);

    await waitFor(() => expect(serviceMock.confirmReservation).toHaveBeenCalledTimes(1));
    expect(serviceMock.confirmReservation).toHaveBeenCalledWith(
      "usaha-a",
      "reservation-1",
      expect.objectContaining({
        idempotencyKey: expect.stringContaining("confirm-reservation-reservation-1-"),
        requestId: expect.any(String),
      }),
    );
  });

  test("reservation detail keeps payment and rental ownership separate", async () => {
    serviceMock.getReservasiContext.mockResolvedValue(context);
    serviceMock.getReservation.mockResolvedValue({
      ...reservation,
      lines: [{ detail_reservasi_id: "reservation-line-1", usaha_id: "usaha-a", reservasi_id: "reservation-1", barang_id: "barang-1", varian_barang_id: null, paket_sewa_id: null, jumlah: "2", unit_price: "1500000", currency_code: "IDR", subtotal: "3000000", catatan: null, barang_nama: "Tenda Dome 4P", varian_nama: null, paket_nama: null }],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/reservasi/reservation-1"]}>
          <Routes><Route path="/reservasi/:id" element={<ReservationShow />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "RSV-001" })).toBeInTheDocument();
    expect(screen.getByText("Tenda Dome 4P")).toBeInTheDocument();
    expect(screen.getByText("Payment", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Ownership tetap berada di Keuangan/i)).toBeInTheDocument();

  });
});

describe("Reservasi reconciliation", () => {
  beforeEach(() => {
    serviceMock.getReservasiContext.mockReset();
    serviceMock.listRequests.mockReset();
    serviceMock.getRequest.mockReset();
    serviceMock.listReservations.mockReset();
    serviceMock.getReservation.mockReset();
    serviceMock.getReservationCapabilities.mockReset();
    serviceMock.createReservationFromRequest.mockReset();
    serviceMock.confirmReservation.mockReset();
    serviceMock.cancelReservation.mockReset();
    resetCapabilities();
  });

  test("confirm command reconciles source when mutation outcome is uncertain", async () => {
    serviceMock.getReservasiContext.mockResolvedValue(context);
    serviceMock.getReservation
      .mockResolvedValueOnce({
        ...reservation,
        status: "draft",
        stock_lock_status: "not_locked",
        lines: [{
          detail_reservasi_id: "reservation-line-1",
          usaha_id: "usaha-a",
          reservasi_id: "reservation-1",
          barang_id: "barang-1",
          varian_barang_id: null,
          paket_sewa_id: null,
          jumlah: "1",
          unit_price: "100000",
          currency_code: "IDR",
          subtotal: "100000",
          catatan: null,
          barang_nama: "Tenda Dome 4P",
          varian_nama: null,
          paket_nama: null,
        }],
      })
      .mockResolvedValueOnce({
        ...reservation,
        status: "confirmed",
        stock_lock_status: "locked",
        lines: [],
      });
    serviceMock.confirmReservation.mockRejectedValue(new Error("network timeout"));

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/reservasi/reservation-1"]}>
          <Routes><Route path="/reservasi/:id" element={<ReservationShow />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findAllByRole("button", { name: "Konfirmasi Reservasi" })).not.toHaveLength(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Konfirmasi Reservasi" })[0]);

    await waitFor(() => expect(serviceMock.confirmReservation).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Status transaksi sudah diperiksa", { exact: true })).toBeInTheDocument();
    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
    expect(serviceMock.getReservation).toHaveBeenCalledTimes(2);
  });

  test("cancel command reconciles source when mutation outcome is uncertain", async () => {
    serviceMock.getReservasiContext.mockResolvedValue(context);
    serviceMock.getReservation
      .mockResolvedValueOnce({
        ...reservation,
        status: "confirmed",
        stock_lock_status: "locked",
        lines: [],
      })
      .mockResolvedValueOnce({
        ...reservation,
        status: "cancelled",
        stock_lock_status: "released",
        lines: [],
      });
    serviceMock.cancelReservation.mockRejectedValue(new Error("network timeout"));

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/reservasi/reservation-1"]}>
          <Routes><Route path="/reservasi/:id" element={<ReservationShow />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click((await screen.findAllByRole("button", { name: /^Batalkan Reservasi$/ }))[0]);
    const reason = await screen.findByLabelText("Alasan pembatalan");
    fireEvent.change(reason, { target: { value: "test reconciliation" } });
    const cancelButtons = await screen.findAllByRole("button", { name: /^Batalkan Reservasi$/ });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);

    await waitFor(() => expect(serviceMock.cancelReservation).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Status transaksi sudah diperiksa", { exact: true })).toBeInTheDocument();
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(serviceMock.getReservation).toHaveBeenCalledTimes(2);
  });
  test("unknown confirm outcome never becomes a generic server error and exposes reconciliation", async () => {
    serviceMock.getReservasiContext.mockResolvedValue(context);
    serviceMock.getReservation
      .mockResolvedValueOnce({ ...reservation, status: "draft", stock_lock_status: "not_locked", lines: [] })
      .mockResolvedValueOnce({ ...reservation, status: "draft", stock_lock_status: "not_locked", lines: [] });
    serviceMock.confirmReservation.mockRejectedValue(new Error("network timeout"));

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/reservasi/reservation-1"]}>
          <Routes><Route path="/reservasi/:id" element={<ReservationShow />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click((await screen.findAllByRole("button", { name: "Konfirmasi Reservasi" }))[0]);
    await waitFor(() => expect(serviceMock.confirmReservation).toHaveBeenCalledTimes(1));

    expect(await screen.findByText("Status transaksi belum dapat dipastikan", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cek Status" })).toBeInTheDocument();
  });

  test("availability conflict is presented as a business conflict", async () => {
    serviceMock.getReservasiContext.mockResolvedValue(context);
    serviceMock.getReservation
      .mockResolvedValueOnce({ ...reservation, status: "draft", stock_lock_status: "not_locked", lines: [] })
      .mockResolvedValueOnce({ ...reservation, status: "draft", stock_lock_status: "not_locked", lines: [] });
    serviceMock.confirmReservation.mockRejectedValue(new Error("capacity unavailable"));

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/reservasi/reservation-1"]}>
          <Routes><Route path="/reservasi/:id" element={<ReservationShow />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click((await screen.findAllByRole("button", { name: "Konfirmasi Reservasi" }))[0]);
    await waitFor(() => expect(serviceMock.confirmReservation).toHaveBeenCalledTimes(1));

    expect(await screen.findByText("Kapasitas atau state berubah")).toBeInTheDocument();
    expect(await screen.findByText(/Kapasitas tidak cukup/i)).toBeInTheDocument();
  });
});