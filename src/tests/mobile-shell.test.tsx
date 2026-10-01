import { render, screen, within } from "@testing-library/react";
import App from "@/App";
import { stubFetch } from "./helpers";
import { mockViewport } from "./viewport";
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

describe("scenario B — responsive admin shell", () => {
  test("mobile viewport renders the mobile header and bottom navigation", async () => {
    mockViewport(375, 812);
    stubFetch({ rows: [] });
    window.history.pushState({}, "", "/dashboard");
    render(<App />);

    expect(await screen.findByRole("button", { name: "Toggle Sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Navigasi mobile" })).toBeInTheDocument();
  });

  test("desktop viewport renders the desktop header without the mobile trigger", async () => {
    mockViewport(1280, 800);
    stubFetch({ rows: [] });
    window.history.pushState({}, "", "/dashboard");
    render(<App />);

    const banner = await screen.findByRole("banner");
    const trigger = within(banner).getByRole("button", { name: "Toggle Sidebar" });
    expect(trigger).toHaveClass("md:hidden");
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /^Dashboard$/ })).toBeInTheDocument();
  }, 15000);

  test("tablet viewport keeps the full navigation reachable", async () => {
    mockViewport(768, 1024);
    stubFetch({ rows: [] });
    window.history.pushState({}, "", "/dashboard");
    render(<App />);

    expect(await screen.findByRole("banner")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /^Dashboard$/ })).toBeInTheDocument();
    expect(await screen.findAllByRole("link", { name: /^Laporan$/ })).not.toHaveLength(0);
  }, 15000);
});
