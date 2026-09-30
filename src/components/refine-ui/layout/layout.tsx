"use client";

import { Link, useLocation } from "react-router";
import { Bell, CreditCard, FileText, Home, Menu, MoreVertical, QrCode, ReceiptText, RotateCcw, Search, WalletCards } from "lucide-react";
import { Header } from "@/components/refine-ui/layout/header";
import { ThemeProvider } from "@/components/refine-ui/theme/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { paths } from "@/routes/paths";
import type { PropsWithChildren } from "react";
import { Sidebar } from "./sidebar";

const mobileNav = [
  ["Beranda", paths.dashboard, Home],
  ["Operasional", paths.penyewaan, Search],
  ["Inventaris", paths.inventaris, QrCode],
  ["Notifikasi", paths.pemberitahuan, Bell],
] as const;

const financeNav = [
  ["Beranda", paths.keuangan, WalletCards],
  ["Pembayaran", paths.keuangan + "/pembayaran", CreditCard],
  ["Pengeluaran", paths.keuangan + "/pengeluaran", ReceiptText],
  ["Transaksi", paths.keuangan + "/transaksi", FileText],
] as const;

const returnNav = [
  ["Beranda", paths.dashboard, Home],
  ["Pengembalian", paths.pengembalian, RotateCcw],
  ["Scan QR", paths.pengembalian + "?scan=1", QrCode],
  ["Notifikasi", paths.pemberitahuan, Bell],
] as const;

function isFinancePath(pathname: string) {
  return pathname === paths.keuangan || pathname.startsWith(paths.keuangan + "/");
}

function isReturnPath(pathname: string) {
  return pathname === paths.pengembalian || pathname.startsWith(paths.pengembalian + "/");
}

function isFocusedTransactionPath(pathname: string) {
  return pathname === paths.penyewaanWalkIn;
}

function isFocusedInspectionPath(pathname: string) {
  return pathname.startsWith(paths.pemeriksaan + "/");
}

function isFocusedMaintenancePath(pathname: string) {
  return pathname === paths.perawatan + "/create" || pathname.startsWith(paths.perawatan + "/");
}

function isFocusedProcurementPath(pathname: string) {
  const supplierFocused =
    pathname === paths.pemasok + "/create" ||
    pathname.match(new RegExp("^" + paths.pemasok.replace("/", "\\/") + "/[^/]+$")) ||
    pathname.match(new RegExp("^" + paths.pemasok.replace("/", "\\/") + "/[^/]+/edit$"));
  const purchaseFocused =
    pathname === paths.pembelian + "/create" ||
    pathname.match(new RegExp("^" + paths.pembelian.replace("/", "\\/") + "/[^/]+$")) ||
    pathname.match(new RegExp("^" + paths.pembelian.replace("/", "\\/") + "/[^/]+/edit$"));
  return Boolean(supplierFocused || purchaseFocused);
}

function showFinanceBottomNav(pathname: string) {
  if (!isFinancePath(pathname)) return false;
  return !pathname.includes("/create") && !pathname.match(/\/(pembayaran|pengeluaran|transaksi)\/[^/]+$/);
}

export function Layout({ children }: PropsWithChildren) {
  const location = useLocation();
  const focusedInspection = isFocusedInspectionPath(location.pathname);
  const focusedMaintenance = isFocusedMaintenancePath(location.pathname);
  const focusedProcurement = isFocusedProcurementPath(location.pathname);
  const focusedWorkspace = focusedInspection || focusedMaintenance || focusedProcurement;

  return (
    <ThemeProvider>
      <SidebarProvider defaultOpen>
        {!focusedWorkspace && <Sidebar />}
        <SidebarInset>
          {!focusedWorkspace && <Header />}
          <main className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-3 pb-24 pt-4 sm:px-5 sm:pt-5 lg:px-6 lg:pb-8 lg:pt-6">
            {children}
          </main>
          <MobileBottomNav />
        </SidebarInset>
      </SidebarProvider>
    </ThemeProvider>
  );
}

function MobileBottomNav() {
  const location = useLocation();
  if (
    isFocusedTransactionPath(location.pathname) ||
    isFocusedInspectionPath(location.pathname) ||
    isFocusedMaintenancePath(location.pathname) ||
    isFocusedProcurementPath(location.pathname)
  ) {
    return null;
  }

  const financeMode = showFinanceBottomNav(location.pathname);
  const returnMode = isReturnPath(location.pathname) && !financeMode;
  const items = financeMode ? financeNav : returnMode ? returnNav : mobileNav;

  return (
    <nav
      className={cn(
        "fixed inset-x-2 bottom-2 z-50 grid grid-cols-5 items-center rounded-2xl border bg-background/95 p-1.5 shadow-[0_14px_44px_rgba(20,40,30,.16)] backdrop-blur-md lg:hidden",
        isFinancePath(location.pathname) && !financeMode && "hidden",
      )}
      aria-label="Navigasi mobile"
    >
      {items.map(([label, path, Icon]) => {
        const cleanPath = path.split("?")[0];
        const active = path.includes("?")
          ? location.search.includes("scan=1") && location.pathname === cleanPath
          : location.pathname === cleanPath || (cleanPath !== paths.dashboard && location.pathname.startsWith(cleanPath + "/"));
        const isCenterInventory = !financeMode && !returnMode && path === paths.inventaris;
        const isCenterReturnScan = returnMode && path.includes("?scan=1");
        return (
          <Link
            key={path}
            to={path}
            className={cn(
              "flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium text-muted-foreground",
              active && "bg-primary/10 text-primary",
            )}
          >
            {isCenterInventory || isCenterReturnScan ? (
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <QrCode className="size-6" strokeWidth={3} aria-hidden="true" />
              </div>
            ) : (
              <Icon className="size-4 shrink-0" aria-hidden="true" />
            )}
            <span>{label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => document.querySelector<HTMLButtonElement>("[data-sidebar='trigger']")?.click()}
        className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {financeMode ? <MoreVertical className="size-4" aria-hidden="true" /> : <Menu className="size-4" aria-hidden="true" />}
        <span>Menu</span>
      </button>
    </nav>
  );
}

Layout.displayName = "Layout";
