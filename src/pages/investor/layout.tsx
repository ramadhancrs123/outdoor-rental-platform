import type { PropsWithChildren } from "react";
import { useGetIdentity } from "@refinedev/core";
import {
  Activity,
  BarChart3,
  Bell,
  CircleDollarSign,
  LayoutDashboard,
  Menu,
  Settings2,
  WalletCards,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { CurrentUsahaContext } from "@/app/current-usaha-context";
import type { TenantContext } from "@/features/penyewa/service";
import { Button } from "@/components/ui/button";

type PrincipalIdentity = {
  id: string;
  name: string;
  kind?: "admin" | "investor";
  email?: string;
  role?: string | null;
  usahaId?: string | null;
};

type InvestorTab = "summary" | "performance" | "transactions" | "accounts";

const tabs: Array<{ key: InvestorTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "summary", label: "Ringkasan", icon: LayoutDashboard },
  { key: "performance", label: "Performa", icon: BarChart3 },
  { key: "transactions", label: "Transaksi", icon: Activity },
  { key: "accounts", label: "Akun", icon: WalletCards },
];

function InvestorBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "flex items-center gap-2" : "px-2 py-3"}>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-slate-950 shadow-sm">
        <span className="text-[11px] font-extrabold">A</span>
      </span>
      {!compact ? (
        <div className="min-w-0">
          <p className="truncate text-[12px] font-bold text-white">Akasha</p>
          <p className="text-[9px] font-medium text-white/55">Investor</p>
        </div>
      ) : null}
    </div>
  );
}

function DesktopSidebar({ isAdmin }: { isAdmin: boolean }) {
  return (
    <aside className="hidden min-h-svh w-[92px] shrink-0 flex-col bg-[#07181a] text-white md:flex">
      <div className="px-3 pt-4">
        <InvestorBrand />
      </div>

      <nav className="mt-5 flex flex-1 flex-col items-center gap-1.5 px-2" aria-label="Investor navigation">
        <SidebarItem label="Dashboard" href="/investor" icon={LayoutDashboard} active />
        <SidebarItem label="Periode" href="/investor" icon={CalendarIcon} />
        <SidebarItem label="Akun" href="/investor?tab=accounts" icon={WalletCards} />
        <SidebarItem label="Transaksi" href="/investor?tab=transactions" icon={Activity} />
        <SidebarItem label="Riwayat" href="/investor?tab=accounts" icon={CircleDollarSign} />
        <SidebarItem label="Laporan" href="/investor?tab=performance" icon={BarChart3} />
        {isAdmin ? <SidebarItem label="Pengaturan" href="/keuangan/investor" icon={Settings2} /> : null}
      </nav>

      <div className="border-t border-white/10 px-2 py-3">
        <button type="button" className="flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-[8px] font-medium text-white/45 hover:bg-white/5 hover:text-white" aria-label="Menu lainnya">
          <Menu className="size-4" />
          Lainnya
        </button>
      </div>
    </aside>
  );
}

function SidebarItem({
  label,
  href,
  icon: Icon,
  active = false,
}: {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
}) {
  return (
    <Link
      to={href}
      className={[
        "flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-[8px] font-medium transition",
        active ? "bg-emerald-500/15 text-emerald-300" : "text-white/50 hover:bg-white/5 hover:text-white",
      ].join(" ")}
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </Link>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return <span className={`grid place-items-center ${className ?? ""}`}>▣</span>;
}

function InvestorMobileHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-[#f5f7f6]/95 px-3 py-3 backdrop-blur-xl md:hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-950 text-white shadow-sm">
            <span className="text-[11px] font-extrabold">A</span>
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-slate-900">Akasha</p>
            <p className="text-[10px] font-medium text-slate-500">Investor</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="size-9 rounded-full" aria-label="Notifikasi">
            <Bell className="size-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}

function InvestorBottomNav() {
  const [params] = useSearchParams();
  const current = (params.get("tab") as InvestorTab | null) ?? "summary";

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/96 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5 backdrop-blur-xl md:hidden" aria-label="Investor tab navigation">
      <div className="mx-auto grid max-w-[430px] grid-cols-4 gap-1">
        {tabs.map((tab) => {
          const active = current === tab.key;
          const Icon = tab.icon;
          const href = tab.key === "summary" ? "/investor" : `/investor?tab=${tab.key}`;
          return (
            <Link
              key={tab.key}
              to={href}
              className={[
                "flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[9px] font-semibold",
                active ? "bg-emerald-50 text-emerald-700" : "text-slate-400",
              ].join(" ")}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-4" />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function InvestorSidebarContext({ tenant, children }: PropsWithChildren<{ tenant?: TenantContext | null }>) {
  const value = tenant
    ? {
        status: "ready" as const,
        current: tenant,
        available: [{ usahaId: tenant.usahaId, usahaNama: tenant.usahaNama }],
        error: null,
        refresh: async () => {},
        selectUsaha: async () => {},
      }
    : null;

  if (!value) return <>{children}</>;
  return <CurrentUsahaContext.Provider value={value}>{children}</CurrentUsahaContext.Provider>;
}

export function InvestorSurfaceLayout({
  children,
  tenant,
}: PropsWithChildren<{ tenant?: TenantContext | null }>) {
  const identity = useGetIdentity<PrincipalIdentity>();
  return (
    <div className="min-h-svh bg-[#f5f7f6] text-slate-900">
      <InvestorSidebarContext tenant={tenant}>
        <div className="flex min-h-svh">
          <DesktopSidebar isAdmin={identity.data?.kind === "admin"} />
          <div className="min-w-0 flex-1">
            <InvestorMobileHeader />
            <main className="min-w-0">{children}</main>
            <InvestorBottomNav />
          </div>
        </div>
      </InvestorSidebarContext>

    </div>
  );
}
