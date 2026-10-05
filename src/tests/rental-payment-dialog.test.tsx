import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const financeMock = vi.hoisted(() => ({
  getFinanceCapabilities: vi.fn(),
  getRentalPaymentSummary: vi.fn(),
  listFinanceAccounts: vi.fn(),
  recordPayment: vi.fn(),
  reconcilePaymentCommand: vi.fn(),
}));

const penyewaanMock = vi.hoisted(() => ({
  formatRentalMoney: vi.fn((amount: number | string) => "Rp" + Number(amount).toLocaleString("id-ID")),
}));

vi.mock("@/features/keuangan", () => financeMock);
vi.mock("@/features/penyewaan", () => penyewaanMock);

import { RentalPaymentDialog } from "@/components/penyewaan/rental-payment-dialog";

const context = {
  akunAdminId: "admin-1",
  usahaId: "usaha-a",
  usahaNama: "Usaha A",
  timezone: "Asia/Jakarta",
  defaultToleranceHours: 10,
  lateFeeEnabled: false,
  lateFeePerHour: 0,
};

const rental = {
  penyewaan_id: "rental-1",
  usaha_id: "usaha-a",
  reservasi_id: null,
  penyewa_id: "renter-1",
  nomor_penyewaan: "RNT-001",
  jadwal_mulai: "2026-10-01T10:00:00Z",
  jadwal_kembali: "2026-10-03T10:00:00Z",
  tolerance_deadline: "2026-10-03T20:00:00Z",
  actual_pickup_at: null,
  actual_return_started_at: null,
  actual_return_completed_at: null,
  status: "active",
  total_amount: "300000",
  currency_code: "IDR",
  catatan: null,
  created_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  penyewa_nama: "Aldi",
  penyewa_telepon: "081234567890",
  detail_count: 1,
  assignment_count: 1,
  lines: [],
  components: [],
  assignments: [],
  handover: null,
  extensions: [],
};

describe("RentalPaymentDialog", () => {
  beforeEach(() => {
    financeMock.getFinanceCapabilities.mockReset();
    financeMock.getRentalPaymentSummary.mockReset();
    financeMock.listFinanceAccounts.mockReset();
    financeMock.recordPayment.mockReset();
    financeMock.reconcilePaymentCommand.mockReset();

    financeMock.getFinanceCapabilities.mockReturnValue({ read: true, mutation: true, reason: "ok" });
    financeMock.getRentalPaymentSummary.mockResolvedValue({
      totalRental: 300000,
      recordedPaymentTotal: 100000,
      paymentCount: 1,
      payments: [],
    });
    financeMock.listFinanceAccounts.mockResolvedValue([
      {
        akun_keuangan_id: "account-1",
        usaha_id: "usaha-a",
        kode_akun: "KAS-01",
        nama_akun: "Kas Utama",
        jenis_akun: "kas",
        mata_uang: "IDR",
        status: "active",
        catatan: null,
        saldo_awal: 0,
        uang_masuk: 0,
        uang_keluar: 0,
        saldo: 0,
        tanggal_saldo_awal: null,
      },
    ]);
    financeMock.recordPayment.mockResolvedValue({
      pembayaran_id: "payment-2",
      nomor_pembayaran: "PAY-002",
      transaksi_keuangan_id: "trx-2",
      nomor_transaksi: "TRX-002",
      status: "recorded",
      source_type: "rental",
      source_id: "rental-1",
      amount: 50000,
      currency_code: "IDR",
    });
  });

  test("mencatat pembayaran dari detail rental tanpa pindah halaman", async () => {
    const onOpenChange = vi.fn();
    const onRecorded = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <RentalPaymentDialog
          open
          onOpenChange={onOpenChange}
          onRecorded={onRecorded}
          context={context}
          rental={rental as never}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Pembayaran untuk Penyewaan RNT-001.")).toBeInTheDocument();
    expect(screen.queryByText("Pilih Sumber Pembayaran")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nominal Pembayaran"), { target: { value: "50000" } });
    fireEvent.click(screen.getByRole("button", { name: /Catat Pembayaran$/i }));

    await waitFor(() => expect(financeMock.recordPayment).toHaveBeenCalledTimes(1));
    expect(financeMock.recordPayment.mock.calls[0][1]).toMatchObject({
      penyewaanId: "rental-1",
      reservasiId: null,
      akunKeuanganId: "account-1",
      amount: 50000,
    });
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Pembayaran berhasil dicatat")).toBeInTheDocument();
  });
});
