"use client";

import {
  Bell,
  Boxes,
  ClipboardCheck,
  CreditCard,
  FileBarChart,
  Home,
  Package,
  Receipt,
  SearchCheck,
  ShoppingCart,
  TentTree,
  Users,
  Wrench,
} from "lucide-react";
import { Link, useLocation } from "react-router";
import { useGetIdentity } from "@refinedev/core";
import { useCurrentUsaha } from "@/app/current-usaha-context";
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

const sections = [
  {
    group: "Operasional Sewa",
    items: [
      ["Permintaan", paths.permintaan, SearchCheck],
      ["Reservasi", paths.reservasi, ClipboardCheck],
      ["Penyewaan", paths.penyewaan, TentTree],
      ["Perawatan", paths.perawatan, Wrench],
    ],
  },
  {
    group: "Aset & Produk",
    items: [
      ["Inventaris", paths.inventaris, Boxes],
      ["Katalog", paths.katalog, Package],
    ],
  },
  {
    group: "Master",
    items: [
      ["Penyewa", paths.penyewa, Users],
      ["Pemasok", paths.pemasok, ShoppingCart],
    ],
  },
  {
    group: "Pengadaan & Keuangan",
    items: [
      ["Pembelian", paths.pembelian, Receipt],
      ["Keuangan", paths.keuangan, CreditCard],
    ],
  },
  {
    group: "Sistem",
    items: [["Pemberitahuan", paths.pemberitahuan, Bell]],
  },
  {
    group: "Insight",
    items: [["Laporan", paths.laporan, FileBarChart]],
  },
] as const;

export function Sidebar() {
  const { current } = useCurrentUsaha();
  const { data: identity } = useGetIdentity<{ name?: string; role?: string | null }>();

  return (
    <ShadcnSidebar collapsible="icon" className="border-sidebar-border bg-sidebar">
      <SidebarRail />
      <ShadcnSidebarHeader className="border-b border-sidebar-border px-3 py-3">
        <div className="flex items-center gap-3 overflow-hidden rounded-xl px-2 py-2">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
            <TentTree className="size-5" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-bold">{current?.usahaNama ?? "Usaha aktif"}</p>
            <p className="text-[11px] text-sidebar-foreground/60">management system</p>
          </div>
        </div>
      </ShadcnSidebarHeader>

      <SidebarContent className="px-2 py-3">
        <div className="space-y-4">
          <NavItem label="Dashboard" path={paths.dashboard} icon={Home} />
          {sections.map((section) => (
            <div key={section.group} className="space-y-1">
              <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/42 group-data-[collapsible=icon]:sr-only">
                {section.group}
              </p>
              {section.items.map(([label, path, Icon]) => (
                <NavItem key={path} label={label} path={path} icon={Icon} />
              ))}
            </div>
          ))}
        </div>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <div className="flex items-center gap-3 rounded-xl p-2 group-data-[collapsible=icon]:justify-center">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="bg-sidebar-primary text-xs text-sidebar-primary-foreground">{(identity?.name ?? "Admin").slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-xs font-semibold text-sidebar-foreground">{identity?.name ?? "Admin"}</p>
            <p className="truncate text-[11px] text-sidebar-foreground/55">{identity?.role ?? "Administrator"}</p>
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
}: {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const location = useLocation();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const isActive =
    path === paths.dashboard
      ? location.pathname === path || location.pathname === "/"
      : location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <Link
      to={path}
      onClick={() => isMobile && setOpenMobile(false)}
      aria-current={isActive ? "page" : undefined}
      title={state === "collapsed" ? label : undefined}
      className={cn(
        "flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium",
        "text-sidebar-foreground/72 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        state === "collapsed" && "justify-center px-2",
        isActive && "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className={cn("truncate", state === "collapsed" && "sr-only")}>{label}</span>
    </Link>
  );
}

Sidebar.displayName = "Sidebar";
