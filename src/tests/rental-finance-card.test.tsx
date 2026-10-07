import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";

const financeMock = vi.hoisted(() => ({
  getRentalPaymentSummary: vi.fn(),
}));

vi.mock("@/features/keuangan", () => financeMock);

import { RentalFinanceCard } from "@/components/penyewaan/rental-finance-card";

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
  status: "draft",
  total_amount: "300000",
  currency_code: "IDR",
  catatan: null,
  created_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  penyewa_nama: "Aldi",
  detail_count: 1,
  assignment_count: 0,
  lines: [],
  components: [],
  assignments: [],
  handover: null,
  extensions: [],
};

describe("RentalFinanceCard", () => {
  beforeEach(() => {
    financeMock.getRentalPaymentSummary.mockReset();
    financeMock.getRentalPaymentSummary.mockResolvedValue({
      totalRental: 300000,
      recordedPaymentTotal: 100000,
      paymentCount: 1,
      payments: [
        {
          pembayaran_id: "payment-1",
          usaha_id: "usaha-a",
          reservasi_id: null,
          penyewaan_id: "rental-1",
          transaksi_keuangan_id: "trx-1",
          nomor_pembayaran: "PAY-001",
          jenis: "dp",
          metode: "cash",
          amount: 100000,
          currency_code: "IDR",
          dibayar_at: "2026-10-01T11:00:00Z",
          dicatat_by_admin_id: "admin-1",
          reference_text: null,
          catatan: null,
          status: "recorded",
          created_at: "2026-10-01T11:00:00Z",
          updated_at: "2026-10-01T11:00:00Z",
          nomor_transaksi: "TRX-001",
          source_label: "Penyewaan RNT-001",
        },
      ],
    });
  });

  test("menampilkan entry point Keuangan dan membuka callback Catat Pembayaran", async () => {
    const onRecordPayment = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <RentalFinanceCard context={context} rental={rental as never} onRecordPayment={onRecordPayment} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Keuangan")).toBeInTheDocument();
    expect(await screen.findByText(/Pembayaran tercatat/)).toBeInTheDocument();
    const paymentButton = screen.getByRole("button", { name: /Catat Pembayaran/i });
    paymentButton.click();
    expect(onRecordPayment).toHaveBeenCalledTimes(1);
  });
});
