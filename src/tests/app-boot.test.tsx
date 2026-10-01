import { render, screen, waitFor } from "@testing-library/react";
import App from "@/App";
import { stubFetch } from "./helpers";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/app/providers/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "test-auth-user" } } }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-auth-user", email: "admin@rentaloutdoor.test" } }, error: null }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { akun_admin_id: "test-admin", nama_tampilan: "Nurdin Ramadhan", role: "super_admin", status: "active" },
            error: null,
          }),
        })),
      })),
    })),
  },
}));

const navigation = [
  "Dashboard",
  "Permintaan",
  "Reservasi",
  "Penyewaan",
  "Pengembalian",
  "Inventaris",
  "Perawatan/Pemeriksaan",
  "Penyewa",
  "Katalog",
  "Pemasok",
  "Pembelian",
  "Keuangan",
  "Pemberitahuan",
  "Laporan",
];

describe("scenario A — app boot", () => {
  test("boots the canonical dashboard workspace without runtime error", async () => {
    stubFetch({ rows: [] });
    window.history.pushState({}, "", "/dashboard");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));

    expect(await screen.findByTestId("dashboard-root")).toBeInTheDocument();
    expect(await screen.findByText("Perlu Perhatian")).toBeInTheDocument();
  });

  test("router boot — unknown route renders the error component", async () => {
    stubFetch({ rows: [] });
    window.history.pushState({}, "", "/tidak-ada");
    render(<App />);
    expect(await screen.findByText("Page not found.")).toBeInTheDocument();
  });

  test("admin shell exposes the approved navigation template", async () => {
    stubFetch({ rows: [] });
    window.history.pushState({}, "", "/dashboard");
    render(<App />);

    for (const label of navigation) {
      await waitFor(() => {
        expect(screen.getAllByRole("link", { name: new RegExp(`^${label}$`) })).not.toHaveLength(0);
      }, { timeout: 10000 });
    }
  }, 30000);
});
