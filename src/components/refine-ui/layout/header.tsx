"use client";

import { ArrowLeft, Bell, EllipsisVertical, Menu, Search, SunMoon } from "lucide-react";
import { Link, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/refine-ui/theme/theme-toggle";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { paths } from "@/routes/paths";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { useEffect, useState } from "react";
import { getUnreadNotificationCount, subscribeToAdminNotifications } from "@/features/pemberitahuan/service";

function financeHeader(pathname: string) {
  if (!pathname.startsWith(paths.keuangan)) return null;
  if (pathname === paths.keuangan) return { title: "Keuangan", back: paths.dashboard };
  if (pathname === paths.keuangan + "/pembayaran") return { title: "Pembayaran", back: paths.keuangan };
  if (pathname.startsWith(paths.keuangan + "/pembayaran/create")) return { title: "Catat Pembayaran", back: paths.keuangan + "/pembayaran" };
  if (pathname.startsWith(paths.keuangan + "/pembayaran/")) return { title: "Detail Pembayaran", back: paths.keuangan + "/pembayaran" };
  if (pathname === paths.keuangan + "/pengeluaran") return { title: "Pengeluaran", back: paths.keuangan };
  if (pathname.startsWith(paths.keuangan + "/pengeluaran/create")) return { title: "Catat Pengeluaran", back: paths.keuangan + "/pengeluaran" };
  if (pathname.startsWith(paths.keuangan + "/pengeluaran/")) return { title: "Detail Pengeluaran", back: paths.keuangan + "/pengeluaran" };
  if (pathname === paths.keuangan + "/transaksi") return { title: "Transaksi", back: paths.keuangan };
  if (pathname.startsWith(paths.keuangan + "/transaksi/")) return { title: "Detail Transaksi", back: paths.keuangan + "/transaksi" };
  return { title: "Keuangan", back: paths.dashboard };
}

export function Header() {
  const location = useLocation();
  const finance = financeHeader(location.pathname);
  const { current } = useCurrentUsaha();
  const usahaId = current?.usahaId;
  const adminId = current?.akunAdminId;
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    if (!usahaId || !adminId) {
      setUnreadCount(0);
      return () => { active = false; };
    }

    const refresh = () => {
      void getUnreadNotificationCount(usahaId, adminId)
        .then((count) => { if (active) setUnreadCount(count); })
        .catch(() => { if (active) setUnreadCount(0); });
    };

    refresh();
    const interval = window.setInterval(refresh, 60_000);
    const unsubscribe = subscribeToAdminNotifications(usahaId, adminId, () => refresh());

    return () => {
      active = false;
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [usahaId, adminId]);

  return (
    <header className="sticky top-0 z-40 flex min-h-14 items-center gap-3 border-b border-border/80 bg-background/92 px-3 backdrop-blur-md sm:px-5">
      {finance ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
          <Button asChild variant="ghost" size="icon" aria-label="Kembali" className="size-9 shrink-0">
            <Link to={finance.back}><ArrowLeft className="size-5" /></Link>
          </Button>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold">{finance.title}</p>
            <p className="text-[10px] text-muted-foreground">Keuangan</p>
          </div>
        </div>
      ) : (
        <SidebarTrigger aria-label="Toggle Sidebar" className="size-9 md:hidden">
          <Menu className="size-5" />
        </SidebarTrigger>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="hidden items-center gap-2 lg:flex">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <TentMark />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold">Akasha Store</p>
            <p className="text-[10px] text-muted-foreground">management system</p>
          </div>
        </div>

        <div className="relative hidden w-full max-w-2xl md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input aria-label="Cari operasional" placeholder="Cari penyewa, barang, kode penyewaan, atau QR..." className="h-10 border-0 bg-muted/60 pl-9 pr-14 shadow-none focus-visible:ring-1" />
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-md border bg-background px-2 py-0.5 text-[10px] text-muted-foreground lg:block">⌘K</kbd>
        </div>

        {!finance ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><TentMark /></div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold">Akasha Store</p>
              <p className="text-[10px] text-muted-foreground">management system</p>
            </div>
          </div>
        ) : null}
        <Button variant="outline" className="hidden h-10 min-w-0 flex-1 justify-start gap-2 bg-muted/50 text-muted-foreground sm:max-md:flex">
          <Search className="size-4" />Cari...
        </Button>
      </div>

      <div className="flex items-center gap-1">
        {finance ? (
          <Button variant="ghost" size="icon" aria-label="Menu Keuangan" className="md:hidden">
            <EllipsisVertical className="size-[18px]" />
          </Button>
        ) : (
          <Button asChild variant="ghost" size="icon" aria-label={unreadCount ? "Pemberitahuan, ada yang belum dibaca" : "Pemberitahuan"} className="relative">
            <Link to={paths.pemberitahuan}>
              <Bell className="size-[18px]" />
              {unreadCount > 0 ? <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-4 text-white">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
            </Link>
          </Button>
        )}
        <ThemeToggle className="hidden sm:inline-flex" />
        <Button variant="ghost" size="icon" aria-label="Tema" className="sm:hidden">
          <SunMoon className="size-[18px]" />
        </Button>
      </div>
    </header>
  );
}

function TentMark() {
  return <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M3 19 12 5l9 14H3Z" /><path d="m8 19 4-6 4 6" /></svg>;
}

Header.displayName = "Header";
