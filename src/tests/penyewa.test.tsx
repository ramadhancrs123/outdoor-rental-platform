import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, test, vi, afterEach } from "vitest";
import { AppProviders } from "@/app/providers";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { RenterList } from "@/pages/penyewa/list";
import { RenterShow } from "@/pages/penyewa/show";
import { buildRenterDetailPath, buildRenterListPath } from "@/features/penyewa/service";
import { mockViewport } from "./viewport";

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

const tenantA = { akunAdminId: "admin-1", usahaId: "usaha-a", usahaNama: "Usaha A" };
const tenantB = { akunAdminId: "admin-1", usahaId: "usaha-b", usahaNama: "Usaha B" };
const renterA = {
  penyewa_id: "renter-1", nama_lengkap: "Siti Sintetis", nomor_telepon: "081234567890",
  alamat: "Alamat sintetis A", status: "active", created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};
const renterB = {
  penyewa_id: "renter-2", nama_lengkap: "Budi Beta", nomor_telepon: "089876543210",
  alamat: "Alamat sintetis B", status: "active", created_at: "2026-01-03T00:00:00Z",
  updated_at: "2026-01-04T00:00:00Z",
};

function tokenFor(sub = "user-1") {
  const payload = btoa(JSON.stringify({ sub }));
  return "header." + payload + ".signature";
}

function response(rows: unknown[], status = 200) {
  return new Response(JSON.stringify(rows), { status, headers: { "Content-Type": "application/json" } });
}

function installAuth() {
  window.localStorage.setItem(
    "sb-nbirkybutpvtrqifaxlt-auth-token",
    JSON.stringify({ access_token: tokenFor() }),
  );
}

function installTenantFetch(renters: unknown[] = [renterA]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("akun_admin?")) return response([{ akun_admin_id: tenantA.akunAdminId }]);
    if (url.includes("keanggotaan_usaha?")) return response([{ usaha_id: tenantA.usahaId }]);
    if (url.includes("usaha?")) return response([{ usaha_id: tenantA.usahaId, nama: tenantA.usahaNama, status: "active" }]);
    if (url.includes("foto_penyewa?")) return response([]);
    if (url.includes("bukti_identitas_penyewa?")) return response([]);
    if (url.includes("penyewa?")) return response(renters);
    return response([], 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  installAuth();
  return fetchMock;
}

function installMultiUsahaFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("akun_admin?")) return response([{ akun_admin_id: tenantA.akunAdminId }]);
    if (url.includes("keanggotaan_usaha?")) {
      return response([{ usaha_id: tenantA.usahaId }, { usaha_id: tenantB.usahaId }]);
    }
    if (url.includes("usaha?") && url.includes("usaha-a")) {
      return response([{ usaha_id: tenantA.usahaId, nama: tenantA.usahaNama, status: "active" }]);
    }
    if (url.includes("usaha?") && url.includes("usaha-b")) {
      return response([{ usaha_id: tenantB.usahaId, nama: tenantB.usahaNama, status: "active" }]);
    }
    if (url.includes("penyewa?") && url.includes("usaha_id=eq.usaha-a")) return response([renterA]);
    if (url.includes("penyewa?") && url.includes("usaha_id=eq.usaha-b")) return response([renterB]);
    return response([], 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  installAuth();
  window.sessionStorage.setItem("rental-admin.current-usaha-id", tenantA.usahaId);
  return fetchMock;
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={["/penyewa"]}>
      <AppProviders><RenterList /></AppProviders>
    </MemoryRouter>,
  );
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/penyewa/" + renterA.penyewa_id]}>
      <AppProviders>
        <Routes><Route path="/penyewa/:id" element={<RenterShow />} /></Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

function UsahaSwitchProbe() {
  const { current, available, selectUsaha } = useCurrentUsaha();
  return (
    <div>
      <p data-testid="current-usaha">{current?.usahaNama ?? "none"}</p>
      {available.map((usaha) => (
        <button key={usaha.usahaId} type="button" onClick={() => void selectUsaha(usaha.usahaId)}>
          Ganti ke {usaha.usahaNama}
        </button>
      ))}
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("Penyewa Phase 1 read-side contract", () => {
  test("tenant-scoped list and detail always bind usaha_id", () => {
    expect(buildRenterListPath(tenantA.usahaId)).toContain("usaha_id=eq.usaha-a");
    expect(buildRenterListPath(tenantA.usahaId)).not.toContain("usaha-b");
    expect(buildRenterDetailPath(tenantA.usahaId, renterA.penyewa_id)).toContain("usaha_id=eq.usaha-a");
  });

  test("search uses name/normalized phone inside tenant scope", async () => {
    const fetchMock = installTenantFetch();
    renderList();
    await screen.findAllByText("Siti Sintetis");
    fireEvent.change(screen.getByLabelText(/nama atau nomor telepon/i), { target: { value: "08123" } });
    fireEvent.click(screen.getByRole("button", { name: "Cari penyewa" }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(urls.some((url) => url.includes("nomor_telepon_normalized"))).toBe(true);
      expect(urls.some((url) => url.includes("usaha_id=eq.usaha-a"))).toBe(true);
    });
  });

  test("empty database has a dedicated empty state", async () => {
    installTenantFetch([]);
    renderList();
    expect(await screen.findByText("Belum ada penyewa")).toBeInTheDocument();
    expect(screen.queryByText(/Tidak ada penyewa yang cocok/)).not.toBeInTheDocument();
  });

  test("search no-result is distinct from an empty database", async () => {
    installTenantFetch([]);
    renderList();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cari penyewa" })).not.toBeDisabled());

    fireEvent.change(screen.getByLabelText(/nama atau nomor telepon/i), { target: { value: "08123" } });
    fireEvent.click(screen.getByRole("button", { name: "Cari penyewa" }));

    expect(await screen.findByText("Penyewa tidak ditemukan")).toBeInTheDocument();
    expect(screen.getByText(/Tidak ada penyewa yang cocok dengan pencarian/)).toBeInTheDocument();
    expect(screen.queryByText("Belum ada penyewa")).not.toBeInTheDocument();
  });

  test("authorization error is not rendered as an empty state", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("akun_admin?")) return response([{ akun_admin_id: tenantA.akunAdminId }]);
      if (url.includes("keanggotaan_usaha?")) return response([{ usaha_id: tenantA.usahaId }]);
      if (url.includes("usaha?")) return response([], 403);
      return response([], 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    installAuth();

    renderList();

    expect(await screen.findByText("Akses ditolak")).toBeInTheDocument();
    expect(screen.getByText("Anda tidak memiliki akses ke data penyewa pada Usaha ini.")).toBeInTheDocument();
    expect(screen.queryByText("Belum ada penyewa")).not.toBeInTheDocument();
  });

  test("read failure exposes retry state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response([], 500)));
    installAuth();
    renderList();
    expect(await screen.findByText("Data belum dapat ditampilkan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeInTheDocument();
  });

  test("detail route keeps sensitive media lazy and does not invent unavailable cross-module data", async () => {
    const fetchMock = installTenantFetch();
    renderDetail();

    expect(await screen.findByRole("heading", { level: 1, name: "Siti Sintetis" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Identitas" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Kontak" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Operasional" })).toBeInTheDocument();

    const initialUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(initialUrls.some((url) => url.includes("bukti_identitas_penyewa?"))).toBe(false);
    expect(initialUrls.some((url) => url.includes("foto_penyewa?"))).toBe(false);

    expect(screen.getByRole("tab", { name: "Ringkasan" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Identitas" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel", { name: "Ringkasan" })).toBeInTheDocument();

    installAuth();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Identitas" }));
    expect(screen.getByRole("tab", { name: "Identitas" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Bukti Identitas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tambah KTP/SIM" })).toBeInTheDocument();

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([input]) => String(input));

      expect(urls.some((url) => url.includes("bukti_identitas_penyewa?"))).toBe(true);
      expect(urls.some((url) => url.includes("foto_penyewa?"))).toBe(true);
    });
    expect(screen.getByText("Belum ada bukti identitas")).toBeInTheDocument();
    expect(screen.getByText("Belum ada foto penyewa")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Operasional" }));
    expect(screen.getByRole("tab", { name: "Operasional" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Tidak ada rental aktif")).toBeInTheDocument();
    expect(screen.queryByText("Reservasi Aktif")).not.toBeInTheDocument();
    expect(screen.queryByText("Pengembalian Terkait")).not.toBeInTheDocument();
  });

  test("404 detail uses a security-safe not-found state", async () => {
    const fetchMock = installTenantFetch();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("akun_admin?")) return response([{ akun_admin_id: tenantA.akunAdminId }]);
      if (url.includes("keanggotaan_usaha?")) return response([{ usaha_id: tenantA.usahaId }]);
      if (url.includes("usaha?")) return response([{ usaha_id: tenantA.usahaId, nama: tenantA.usahaNama, status: "active" }]);
      if (url.includes("penyewa?")) return response([]);
      return response([], 404);
    });

    renderDetail();

    expect(await screen.findByText("Penyewa tidak ditemukan")).toBeInTheDocument();
    expect(screen.getByText("Penyewa tidak ditemukan atau tidak tersedia dalam Usaha aktif.")).toBeInTheDocument();
    expect(screen.queryByText("Siti Sintetis")).not.toBeInTheDocument();
  });

  test("current Usaha switch invalidates renter state and revalidates against the selected Usaha", async () => {
    installMultiUsahaFetch();

    render(
      <MemoryRouter initialEntries={["/penyewa"]}>
        <AppProviders>
          <UsahaSwitchProbe />
          <RenterList />
        </AppProviders>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("current-usaha")).toHaveTextContent("Usaha A");
    expect((await screen.findAllByText("Siti Sintetis")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Ganti ke Usaha B" }));

    await waitFor(() => expect(screen.getByTestId("current-usaha")).toHaveTextContent("Usaha B"));
    expect((await screen.findAllByText("Budi Beta")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Siti Sintetis")).not.toBeInTheDocument();

    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes("penyewa?") && url.includes("usaha_id=eq.usaha-b"))).toBe(true);
  });

  test("mobile viewport keeps the mobile card presentation", async () => {
    mockViewport(375, 812);
    installTenantFetch();
    const { container } = renderList();

    expect(await screen.findAllByText("Siti Sintetis")).not.toHaveLength(0);

    const mobileBranch = container.querySelector("[class~=\"md:hidden\"]");
    const desktopBranch = container.querySelector("[class~=\"hidden\"][class~=\"md:block\"]");

    expect(mobileBranch).toBeInTheDocument();
    expect(mobileBranch?.querySelector('a[href="/penyewa/renter-1"]')).toBeInTheDocument();
    expect(mobileBranch?.querySelector("table")).not.toBeInTheDocument();
    expect(desktopBranch).toBeInTheDocument();
    expect(desktopBranch?.querySelector("table")).toBeInTheDocument();
  });
});
