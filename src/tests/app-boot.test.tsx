import { render, screen, waitFor } from "@testing-library/react";
import App from "@/App";
import { stubFetch } from "./helpers";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "test-auth-user" } } }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-auth-user", email: "admin@rentaloutdoor.test" } }, error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    from: vi.fn(() => {
      const queryBuilder = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { akun_admin_id: "test-admin", nama_tampilan: "Nurdin Ramadhan", role: "super_admin", status: "active" },
          error: null,
        }),
      };
      queryBuilder.select.mockReturnValue(queryBuilder);
      queryBuilder.eq.mockReturnValue(queryBuilder);
      return queryBuilder;
    }),
  },
}));

const navigationSections = [
  {
    label: "Operasional",
    items: ["Reservasi", "Penyewaan", "Penjualan", "Perawatan"],
  },
  {
    label: "Keuangan",
    items: ["Ringkasan Keuangan", "Transaksi", "Pembayaran", "Pengeluaran", "Akun & Kas", "Analisis Retail", "Investor"],
  },
  {
    label: "Stok & Aset",
    items: ["Inventaris", "Pembelian", "Pemasok"],
  },
  {
    label: "Katalog & Promosi",
    items: ["Katalog"],
  },
  {
    label: "Data & Pelanggan",
    items: ["Penyewa"],
  },
  {
    label: "Informasi & Sistem",
    items: ["Pendakian", "Testimoni", "Pemberitahuan"],
  },
  {
    label: "Insight",
    items: ["Laporan"],
  },
];

describe("scenario A — app boot", () => {
  test("boots the canonical dashboard workspace without runtime error", async () => {
    stubFetch({ rows: [] });
    window.history.pushState({}, "", "/dashboard");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));

    expect(await screen.findByTestId("dashboard-root")).toBeInTheDocument();
    expect(await screen.findByText("Perlu Tindakan")).toBeInTheDocument();
    expect(screen.getByText("Promo Aktif")).toBeInTheDocument();
    expect(screen.getByText("Total Transaksi")).toBeInTheDocument();
    expect(screen.getByText("Nilai Diskon")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Arus Kas Usaha" })).toBeInTheDocument();
    expect(screen.getByText("Net Cash")).toBeInTheDocument();
    expect(screen.getByText("Kas Operasional · saldo saat ini")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-cashflow-difference")).toBeInTheDocument();
    expect(screen.getByText("Selisih", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/Grafik mengikuti tanggal transaksi/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atur periode keuangan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Area" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Line" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("link", { name: /Penjualan/ })).toHaveLength(2);
  });

  test("router boot — unknown route renders the error component", async () => {
    stubFetch({ rows: [] });
    window.history.pushState({}, "", "/tidak-ada");
    render(<App />);
    expect(await screen.findByText("Page not found.")).toBeInTheDocument();
  });

  test("admin shell exposes the grouped operational navigation template", async () => {
    stubFetch({ rows: [] });
    window.history.pushState({}, "", "/dashboard");
    render(<App />);

    expect(await screen.findByRole("link", { name: /^Dashboard$/ })).toBeInTheDocument();

    for (const section of navigationSections) {
      const group = await screen.findByRole("button", { name: new RegExp(`^${section.label}`) });
      if (group.getAttribute("aria-expanded") !== "true") {
        await group.click();
      }

      for (const label of section.items) {
        await waitFor(() => {
          expect(screen.getAllByRole("link", { name: new RegExp(`^${label}$`) })).not.toHaveLength(0);
        }, { timeout: 10000 });
      }
    }
  }, 30000);
});
