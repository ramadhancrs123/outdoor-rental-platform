import { CheckCircle2, CircleAlert, CreditCard } from "lucide-react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";
import {
  AmountDisplay,
  FinanceMetric,
  FinanceNavNote,
  FinanceShell,
  FinanceStateScreen,
  FinanceStatus,
  SourcePreview,
} from "@/components/keuangan/finance-ui";

describe("Finance visual contract", () => {
  test("dashboard shell renders the finance hierarchy", () => {
    render(
      <MemoryRouter>
        <FinanceShell
          title="Keuangan"
          subtitle="Ringkasan fakta keuangan usaha Anda."
          action={<span>Usaha: Akasha Store</span>}
        >
          <FinanceMetric label="Payment Count" value="24" icon={CreditCard} tone="info" />
          <div>Total Pemasukan Tercatat</div>
          <div>Total Pengeluaran Tercatat</div>
          <div>Net Operational Movement</div>
        </FinanceShell>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Keuangan" })).toBeInTheDocument();
    expect(screen.getByText("Total Pemasukan Tercatat")).toBeInTheDocument();
    expect(screen.getByText("Total Pengeluaran Tercatat")).toBeInTheDocument();
    expect(screen.getByText("Net Operational Movement")).toBeInTheDocument();
  });

  test("payment detail separates amount, status and source", () => {
    render(
      <FinanceShell title="Detail Pembayaran">
        <AmountDisplay amount={150000} direction="income" />
        <FinanceStatus status="Recorded" tone="success" />
        <SourcePreview type="Reservasi" number="RSV-2026-001" renter="Ahmad Fauzi" period="10–12 Okt 2026" meta="2 item · 3 unit" />
      </FinanceShell>,
    );
    expect(screen.getByText(/\+Rp/)).toBeInTheDocument();
    expect(screen.getByText("Recorded")).toBeInTheDocument();
    expect(screen.getByText("RSV-2026-001")).toBeInTheDocument();
    expect(screen.getByText("Ahmad Fauzi")).toBeInTheDocument();
  });

  test("batas pengelolaan transaksi keuangan terlihat", () => {
    render(
      <FinanceShell title="Detail Pembayaran">
        <FinanceNavNote>Pembayaran → Transaksi Keuangan → Sumber</FinanceNavNote>
        <p>Pembayaran tercatat tidak otomatis berarti Reservasi Dikonfirmasi atau Penyewaan Aktif.</p>
      </FinanceShell>,
    );
    expect(screen.getByText("Pembayaran → Transaksi Keuangan → Sumber")).toBeInTheDocument();
    expect(screen.getByText(/Pembayaran tercatat tidak otomatis/i)).toBeInTheDocument();
  });

  test("source picker preview supports reservation and rental semantics", () => {
    const { rerender } = render(
      <SourcePreview type="Reservasi" number="RSV-2026-001" renter="Ahmad Fauzi" period="10–12 Okt 2026" meta="2 item · 3 unit" />,
    );
    expect(screen.getByText("Reservasi")).toBeInTheDocument();
    rerender(<SourcePreview type="Penyewaan" number="REN-2026-001" renter="Siti Rahma" period="14–16 Okt 2026" meta="1 item · 2 unit" />);
    expect(screen.getByText("Penyewaan")).toBeInTheDocument();
    expect(screen.getByText("REN-2026-001")).toBeInTheDocument();
  });

  test("payment processing state has operational feedback", () => {
    render(
      <FinanceStateScreen
        icon={CreditCard}
        tone="warning"
        title="Memproses Pembayaran"
        description="Sistem sedang mencatat pembayaran dan transaksi keuangan."
        primary={<div>Validasi data → Menyimpan pembayaran → Finalisasi</div>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Memproses Pembayaran" })).toBeInTheDocument();
    expect(screen.getByText(/Validasi data/i)).toBeInTheDocument();
  });

  test("payment success state has clear next action", () => {
    render(
      <FinanceStateScreen
        icon={CheckCircle2}
        tone="success"
        title="Pembayaran Berhasil Dicatat"
        description="Pembayaran telah dicatat dan transaksi keuangan dibuat."
        primary={<button type="button">Lihat Detail Pembayaran</button>}
        secondary={<button type="button">Kembali ke Pembayaran</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Pembayaran Berhasil Dicatat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lihat Detail Pembayaran" })).toBeInTheDocument();
  });

  test("business conflict and unknown outcome are distinct semantic states", () => {
    const { rerender } = render(
      <FinanceStateScreen
        icon={CircleAlert}
        tone="danger"
        title="Sumber Tidak Dapat Digunakan"
        description="Sumber tidak dapat digunakan untuk pencatatan pembayaran."
        primary={<button type="button">Pilih Sumber Lain</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Sumber Tidak Dapat Digunakan" })).toBeInTheDocument();

    rerender(
      <FinanceStateScreen
        icon={CircleAlert}
        tone="warning"
        title="Status Transaksi Belum Dapat Dipastikan"
        description="Sistem sedang memeriksa kembali status pencatatan."
        primary={<button type="button">Cek Status</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Status Transaksi Belum Dapat Dipastikan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cek Status" })).toBeInTheDocument();
  });

  test("expense flow keeps source and evidence semantics", () => {
    render(
      <FinanceShell title="Catat Pengeluaran">
        <div>Pembelian</div>
        <div>Perawatan</div>
        <div>Operational</div>
        <div>Other</div>
        <div>Manual</div>
        <div>Bukti Tersedia</div>
        <div>Transaksi Keuangan</div>
      </FinanceShell>,
    );
    expect(screen.getByText("Pembelian")).toBeInTheDocument();
    expect(screen.getByText("Perawatan")).toBeInTheDocument();
    expect(screen.getByText("Operational")).toBeInTheDocument();
    expect(screen.getByText("Bukti Tersedia")).toBeInTheDocument();
    expect(screen.getByText("Transaksi Keuangan")).toBeInTheDocument();
  });
});
