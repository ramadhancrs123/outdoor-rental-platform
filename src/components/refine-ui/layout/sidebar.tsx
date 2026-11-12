"use client";

import * as React from "react";
import {
  ArrowLeftRight,
  BadgePercent,
  Banknote,
  Bell,
  Boxes,
  CalendarCheck,
  ChevronDown,
  CircleDollarSign,
  Coins,
  CreditCard,
  FileBarChart,
  Home,
  Landmark,
  MessageSquareQuote,
  Mountain,
  Package,
  Receipt,
  ShoppingBag,
  TentTree,
  Truck,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { Link, useLocation } from "react-router";
import { useGetIdentity } from "@refinedev/core";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader as ShadcnSidebarHeader,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { paths } from "@/routes/paths";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { getMyBusinessPermissions } from "@/features/event-promotions";

type MenuItem = {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  permission?: string;
};

type MenuSection = {
  id: string;
  label: string;
  items: MenuItem[];
};

const sections: MenuSection[] = [
  {
    id: "operational",
    label: "Operasional",
    items: [
      { label: "Smart Booking", path: paths.reservasi, icon: CalendarCheck },
      { label: "Penyewaan", path: paths.penyewaan, icon: TentTree },
      { label: "Penjualan", path: paths.penjualan, icon: ShoppingBag },
      { label: "Perawatan", path: paths.perawatan, icon: Wrench },
    ],
  },
  {
    id: "finance",
    label: "Keuangan",
    items: [
      { label: "Ringkasan Keuangan", path: paths.keuangan, icon: Wallet, exact: true },
      { label: "Transaksi", path: paths.keuangan + "/transaksi", icon: ArrowLeftRight },
      { label: "Pembayaran", path: paths.keuangan + "/pembayaran", icon: CreditCard },
      { label: "Pengeluaran", path: paths.keuangan + "/pengeluaran", icon: Banknote },
      { label: "Akun & Kas", path: paths.keuanganAkun, icon: Landmark },
      { label: "Analisis Retail", path: paths.financeRetail, icon: CircleDollarSign },
      { label: "Investor", path: paths.investor, icon: Coins },
    ],
  },
  {
    id: "assets",
    label: "Stok & Aset",
    items: [
      { label: "Inventaris", path: paths.inventaris, icon: Boxes },
      { label: "Pembelian", path: paths.pembelian, icon: Receipt },
      { label: "Pemasok", path: paths.pemasok, icon: Truck },
    ],
  },
  {
    id: "catalog",
    label: "Katalog & Promosi",
    items: [
      { label: "Katalog", path: paths.katalog, icon: Package },
      { label: "Event & Promosi", path: paths.eventPromotions, icon: BadgePercent, permission: "event_promotion.manage" },
    ],
  },
  {
    id: "customers",
    label: "Data & Pelanggan",
    items: [{ label: "Penyewa", path: paths.penyewa, icon: Users }],
  },
  {
    id: "system",
    label: "Informasi & Sistem",
    items: [
      { label: "Pendakian", path: paths.pendakian, icon: Mountain },
      { label: "Testimoni", path: paths.testimoni, icon: MessageSquareQuote },
      { label: "Pemberitahuan", path: paths.pemberitahuan, icon: Bell },
    ],
  },
  {
    id: "insight",
    label: "Insight",
    items: [{ label: "Laporan", path: paths.laporan, icon: FileBarChart }],
  },
];

function matchesPath(pathname: string, item: MenuItem) {
  if (item.exact) return pathname === item.path;
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

export function Sidebar() {
  const location = useLocation();
  const { state, isMobile, openMobile } = useSidebar();
  const iconOnly = state === "collapsed" && !isMobile;
  const { data: identity } = useGetIdentity<{ name?: string; role?: string | null }>();
  const { current, status: usahaStatus } = useCurrentUsaha();

  const permissions = useQuery({
    queryKey: ["event-promotions", "my-permissions", current?.usahaId],
    queryFn: () => getMyBusinessPermissions(current!.usahaId),
    enabled: usahaStatus === "ready" && Boolean(current?.usahaId),
    staleTime: 30_000,
  });

  // Only hide a menu when a matching permission is explicitly defined by the
  // backend. Other modules do not yet expose menu-level permission keys.
  const canManagePromotions =
    !permissions.isSuccess || permissions.data.includes("event_promotion.manage");

  const visibleSections = React.useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          items: section.items.filter(
            (item) => !item.permission || (item.permission === "event_promotion.manage" && canManagePromotions),
          ),
        }))
        .filter((section) => section.items.length > 0),
    [canManagePromotions],
  );

  const activeSectionId = visibleSections.find((section) =>
    section.items.some((item) => matchesPath(location.pathname, item)),
  )?.id;

  const [openSection, setOpenSection] = React.useState("operational");

  React.useEffect(() => {
    if (activeSectionId) setOpenSection(activeSectionId);
  }, [activeSectionId, location.pathname]);

  React.useEffect(() => {
    if (!activeSectionId || (isMobile && !openMobile)) return;
    const timer = window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(`button[aria-controls="sidebar-section-${activeSectionId}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "auto" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [activeSectionId, isMobile, openMobile, location.pathname]);

  return (
    <ShadcnSidebar
      collapsible="icon"
      className="border-r border-sidebar-border/75 bg-gradient-to-b from-sidebar to-sidebar/95 shadow-[5px_0_24px_rgba(38,28,20,0.035)] dark:shadow-[5px_0_24px_rgba(0,0,0,0.16)]"
    >
      <SidebarRail />

      <ShadcnSidebarHeader className="relative border-b border-sidebar-border/80 bg-gradient-to-br from-primary/[0.045] via-transparent to-transparent px-3 py-3">
        <div className="flex items-center gap-3 overflow-hidden rounded-xl border border-sidebar-border/70 bg-background/55 px-2.5 py-2.5 shadow-sm dark:bg-white/[0.025]">
          <img src="/logo.webp" alt="Akasha Outdoor" className="size-10 shrink-0 object-contain" />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-bold tracking-tight">Akasha Outdoor</p>
            <p className="text-[10px] font-medium tracking-normal text-sidebar-foreground/60">sistem management Akasha</p>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" />
      </ShadcnSidebarHeader>

      <SidebarContent className="px-2.5 py-3 group-data-[collapsible=icon]:!overflow-y-auto">
        <div className="space-y-3">
          <NavItem
            label="Dashboard"
            path={paths.dashboard}
            icon={Home}
            exact
            prominent
          />

          <div className="h-px bg-gradient-to-r from-transparent via-sidebar-border to-transparent" />

          {visibleSections.map((section) => {
            const isOpen = iconOnly || openSection === section.id;
            const sectionIsActive = section.items.some((item) => matchesPath(location.pathname, item));

            return (
              <section key={section.id} data-sidebar-section={section.id} className="space-y-1">
                <button
                  type="button"
                  aria-expanded={iconOnly ? undefined : isOpen}
                  aria-controls={`sidebar-section-${section.id}`}
                  onClick={() => setOpenSection((currentSection) => currentSection === section.id ? "" : section.id)}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-[10px] font-bold uppercase tracking-[0.16em]",
                    "text-[#665B52] transition-colors hover:bg-sidebar-accent/55 hover:text-[#211D19] dark:text-[#C3B7AE] dark:hover:text-[#F4F1ED]",
                    iconOnly && "hidden",
                    sectionIsActive && "text-sidebar-foreground/80",
                  )}
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full bg-sidebar-foreground/30", sectionIsActive && "bg-primary")} />
                  <span className="min-w-0 flex-1 truncate">{section.label}</span>
                  <ChevronDown className={cn("size-3.5 shrink-0 text-sidebar-foreground/40 transition-transform duration-200", isOpen && "rotate-180")} />
                </button>

                <div
                  id={`sidebar-section-${section.id}`}
                  className="overflow-hidden transition-[max-height,opacity] duration-200 ease-out"
                  style={{
                    maxHeight: isOpen ? "32rem" : "0px",
                    opacity: isOpen ? 1 : 0,
                  }}
                  aria-hidden={!isOpen}
                  inert={!isOpen}
                >
                  <div className="space-y-0.5 pt-0.5">
                    {section.items.map((item) => (
                      <NavItem key={item.path} {...item} />
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/80 bg-background/25 p-2.5">
        <div className="rounded-xl border border-sidebar-border/70 bg-background/55 p-2.5 shadow-sm dark:bg-white/[0.025]">
          <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center">
            <Avatar className="size-9 shrink-0 ring-2 ring-primary/10">
              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                {(identity?.name ?? "Admin").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-xs font-semibold text-sidebar-foreground">{identity?.name ?? "Admin"}</p>
              <span className="mt-0.5 inline-flex max-w-full truncate rounded-md bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/65">
                {identity?.role ?? "Administrator"}
              </span>
            </div>
          </div>
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}

function NavItem({
  label,
  path,
  icon: Icon,
  exact = false,
  prominent = false,
}: MenuItem & { prominent?: boolean }) {
  const location = useLocation();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const iconOnly = state === "collapsed" && !isMobile;
  const isActive = matchesPath(location.pathname, { label, path, icon: Icon, exact });

  return (
    <Link
      to={path}
      onClick={() => isMobile && setOpenMobile(false)}
      aria-current={isActive ? "page" : undefined}
      title={iconOnly ? label : undefined}
      className={cn(
        "group/nav relative flex min-h-[38px] w-full items-center gap-3 rounded-lg px-3 text-[13px] font-medium",
        "text-[#211D19] transition-[background-color,color,box-shadow] duration-150 dark:text-[#F4F1ED]",
        "hover:bg-sidebar-accent/70 hover:text-[#171411] dark:hover:text-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        iconOnly && "justify-center px-2",
        prominent && "mb-1 min-h-10 font-semibold",
        isActive && [
          "bg-sidebar-accent text-[#211D19] shadow-sm dark:text-[#FFF7F0]",
          "shadow-[inset_3px_0_0_var(--brand-orange),0_1px_2px_rgba(38,28,20,0.04)]",
          "dark:bg-primary/10",
        ],
      )}
    >
      <Icon
        className={cn(
          "size-[17px] shrink-0 transition-colors",
          isActive ? "text-primary" : "text-[#766D66] group-hover/nav:text-[#28231F] dark:text-[#B6AAA0] dark:group-hover/nav:text-[#F4F1ED]",
          prominent && "size-[18px]",
        )}
        aria-hidden="true"
      />
      <span className={cn("truncate", iconOnly && "sr-only")}>{label}</span>
    </Link>
  );
}

Sidebar.displayName = "Sidebar";
