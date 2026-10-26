import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
  resolveNotificationTarget: vi.fn(),
  subscribeToAdminNotifications: vi.fn(),
}));

vi.mock("@/app/current-usaha-context", () => ({
  useCurrentUsaha: () => ({
    current: { usahaId: "usaha-1", usahaNama: "Akasha Outdoor", akunAdminId: "admin-1", timezone: "Asia/Jakarta" },
  }),
}));

vi.mock("@/features/pemberitahuan/service", () => mocks);

import { PemberitahuanList } from "@/pages/pemberitahuan";

const notifications = [
  {
    pemberitahuan_id: "notice-1",
    usaha_id: "usaha-1",
    penerima_akun_admin_id: "admin-1",
    jenis: "payment_recorded",
    prioritas: "high",
    judul: "Pembayaran penyewaan tercatat",
    pesan: "Pembayaran sebesar Rp25.000 telah dicatat untuk penyewaan RNT-2026-011.",
    sumber_type: "penyewaan",
    sumber_id: "rental-1",
    action_type: "navigate",
    action_target: "/penyewaan/rental-1",
    dibaca_at: null,
    created_at: "2026-10-26T07:00:00.000Z",
    outbox_event_id: "event-1",
    source_exists: true,
  },
  {
    pemberitahuan_id: "notice-2",
    usaha_id: "usaha-1",
    penerima_akun_admin_id: "admin-1",
    jenis: "rental_created",
    prioritas: "normal",
    judul: "Penyewaan baru dibuat",
    pesan: "Sumber alur kerja tidak lagi tersedia.",
    sumber_type: "penyewaan",
    sumber_id: "rental-old",
    action_type: null,
    action_target: null,
    dibaca_at: "2026-10-26T06:00:00.000Z",
    created_at: "2026-10-26T05:00:00.000Z",
    outbox_event_id: "event-2",
    source_exists: false,
  },
];

function renderPage() {
  return render(<MemoryRouter><PemberitahuanList /></MemoryRouter>);
}

describe("Pemberitahuan compact UI", () => {
  beforeEach(() => {
    mocks.listNotifications.mockReset();
    mocks.markAllNotificationsRead.mockReset();
    mocks.markNotificationRead.mockReset();
    mocks.resolveNotificationTarget.mockReset();
    mocks.subscribeToAdminNotifications.mockReset();
    mocks.listNotifications.mockResolvedValue({ items: notifications, unreadCount: 1 });
    mocks.resolveNotificationTarget.mockImplementation((item: (typeof notifications)[number]) => item.action_target);
    mocks.subscribeToAdminNotifications.mockReturnValue(() => undefined);
    mocks.markNotificationRead.mockResolvedValue(undefined);
    mocks.markAllNotificationsRead.mockResolvedValue(undefined);
  });

  it("renders notifications as compact rows with priority, unread status and concise metadata", async () => {
    renderPage();
    await screen.findByText("Pembayaran penyewaan tercatat");

    expect(screen.getByText("1 belum dibaca")).toBeInTheDocument();
    expect(screen.getByText("Semua aktivitas")).toBeInTheDocument();
    expect(screen.getByText("Tinggi")).toBeInTheDocument();
    expect(screen.getByText("Sumber tidak tersedia")).toBeInTheDocument();

    const row = document.querySelector('[data-notification-id="notice-1"]');
    expect(row).not.toBeNull();
    expect(row).toHaveClass("py-3");
    expect(row).toHaveClass("border-l-primary");
    expect(within(row as HTMLElement).getByRole("link", { name: /Buka sumber/ })).toHaveAttribute("href", "/penyewaan/rental-1");
  });

  it("marks a single notification as read", async () => {
    renderPage();
    await screen.findByText("Pembayaran penyewaan tercatat");

    fireEvent.click(screen.getByRole("button", { name: "Tandai dibaca" }));
    await waitFor(() => expect(mocks.markNotificationRead).toHaveBeenCalledWith("usaha-1", "admin-1", "notice-1"));
  });

  it("marks all unread notifications as read", async () => {
    renderPage();
    await screen.findByText("Pembayaran penyewaan tercatat");

    fireEvent.click(screen.getByRole("button", { name: /Tandai semua dibacaBaca semua/ }));
    await waitFor(() => expect(mocks.markAllNotificationsRead).toHaveBeenCalledWith("usaha-1", "admin-1"));
  });
});
