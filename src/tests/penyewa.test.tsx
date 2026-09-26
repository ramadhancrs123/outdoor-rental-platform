import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { AppProviders } from "@/app/providers";

vi.mock("@/app/providers/auth", () => ({
  authProvider: {
    login: async () => ({ success: true }),
    logout: async () => ({ success: true }),
    check: async () => ({ authenticated: true }),
    getIdentity: async () => ({ id: "user-1", name: "Test Admin", email: "test@example.com" }),
    getPermissions: async () => "super_admin",
    onError: async (error: unknown) => ({ error }),
  },
}));
import { RenterList } from "@/pages/penyewa/list";
import { RenterShow } from "@/pages/penyewa/show";
import { buildRenterDetailPath, buildRenterListPath } from "@/features/penyewa/service";
import { mockViewport } from "./viewport";

const tenant = { akunAdminId: "admin-1", usahaId: "usaha-a", usahaNama: "Usaha A" };
const renter = {
  penyewa_id: "renter-1", nama_lengkap: "Siti Sintetis", nomor_telepon: "081234567890",
  alamat: "Alamat sintetis", status: "active", created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

function tokenFor(sub = "user-1") {
  const payload = btoa(JSON.stringify({ sub }));
  return `header.${payload}.signature`;
}
function response(rows: unknown[], status = 200) {
  return new Response(JSON.stringify(rows), { status, headers: { "Content-Type": "application/json" } });
}
function installAuth() {
  window.localStorage.setItem("sb-nbirkybutpvtrqifaxlt-auth-token", JSON.stringify({ access_token: tokenFor() }));
}
function installTenantFetch(renters: unknown[] = [renter]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("akun_admin?")) return response([{ akun_admin_id: tenant.akunAdminId }]);
    if (url.includes("keanggotaan_usaha?")) return response([{ usaha_id: tenant.usahaId }]);
    if (url.includes("usaha?")) return response([{ usaha_id: tenant.usahaId, nama: tenant.usahaNama, status: "active" }]);
    if (url.includes("penyewa?")) return response(renters);
    return response([], 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  installAuth();
  return fetchMock;
}
function renderList() {
  return render(<MemoryRouter initialEntries={["/penyewa"]}><AppProviders><RenterList /></AppProviders></MemoryRouter>);
}

describe("Penyewa read-side contract", () => {
  test("tenant-scoped list and detail always bind usaha_id", () => {
    expect(buildRenterListPath(tenant.usahaId)).toContain("usaha_id=eq.usaha-a");
    expect(buildRenterListPath(tenant.usahaId)).not.toContain("usaha-b");
    expect(buildRenterDetailPath(tenant.usahaId, renter.penyewa_id)).toContain("usaha_id=eq.usaha-a");
  });

  test("search uses name/normalized phone inside tenant scope", async () => {
    const fetchMock = installTenantFetch();
    renderList();
    await screen.findAllByText("Siti Sintetis");
    fireEvent.change(screen.getByLabelText(/nama atau nomor telepon/i), { target: { value: "08123" } });
    fireEvent.click(screen.getByRole("button", { name: "Cari" }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(urls.some((url) => url.includes("nomor_telepon_normalized"))).toBe(true);
      expect(urls.some((url) => url.includes("usaha_id=eq.usaha-a"))).toBe(true);
    });
  });

  test("empty state is explicit", async () => {
    installTenantFetch([]);
    renderList();
    expect(await screen.findByText("Belum ada penyewa")).toBeInTheDocument();
  });

  test("read failure exposes retry state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response([], 500)));
    installAuth();
    renderList();
    expect(await screen.findByText("Data belum dapat ditampilkan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeInTheDocument();
  });

  test("list projection excludes full address and identity/storage-sensitive fields", async () => {
    const fetchMock = installTenantFetch();
    renderList();
    await screen.findAllByText("Siti Sintetis");

    const renterUrl = fetchMock.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes("penyewa?"));
    expect(renterUrl).toBeDefined();
    expect(renterUrl).not.toContain("alamat");
    expect(screen.queryByText("Alamat sintetis")).not.toBeInTheDocument();
    expect(screen.queryByText(/nomor identitas|storage path|catatan internal/i)).not.toBeInTheDocument();
  });

  test("detail route renders authorized tenant detail without media URL", async () => {
    installTenantFetch();
    render(<MemoryRouter initialEntries={[`/penyewa/${renter.penyewa_id}`]}><AppProviders><Routes><Route path="/penyewa/:id" element={<RenterShow />} /></Routes></AppProviders></MemoryRouter>);
    expect(await screen.findByRole("heading", { level: 1, name: "Siti Sintetis" })).toBeInTheDocument();
    expect(screen.getByText("Media privat belum tersedia.")).toBeInTheDocument();
  });

  test("unauthorized deep-link does not expose a renter record", async () => {
    const fetchMock = installTenantFetch();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("akun_admin?")) return response([{ akun_admin_id: tenant.akunAdminId }]);
      if (url.includes("keanggotaan_usaha?")) return response([{ usaha_id: tenant.usahaId }]);
      if (url.includes("usaha?")) return response([{ usaha_id: tenant.usahaId, nama: tenant.usahaNama, status: "active" }]);
      if (url.includes("penyewa?")) return response([]);
      return response([], 404);
    });
    render(<MemoryRouter initialEntries={["/penyewa/renter-not-owned"]}><AppProviders><Routes><Route path="/penyewa/:id" element={<RenterShow />} /></Routes></AppProviders></MemoryRouter>);
    expect(await screen.findByText("Detail tidak tersedia")).toBeInTheDocument();
    expect(screen.queryByText("Siti Sintetis")).not.toBeInTheDocument();
  });

  test("mobile viewport selects the implemented card presentation branch", async () => {
    mockViewport(375, 812);
    installTenantFetch();
    const { container } = renderList();

    expect(await screen.findAllByText("Siti Sintetis")).not.toHaveLength(0);

    const mobileBranch = container.querySelector(".md\\:hidden");
    const desktopBranch = container.querySelector(".hidden.md\\:block");

    expect(mobileBranch).toBeInTheDocument();
    expect(mobileBranch?.querySelector('a[href="/penyewa/renter-1"]')).toBeInTheDocument();
    expect(mobileBranch?.querySelector("table")).not.toBeInTheDocument();
    expect(desktopBranch).toBeInTheDocument();
    expect(desktopBranch?.querySelector("table")).toBeInTheDocument();
  });
});
