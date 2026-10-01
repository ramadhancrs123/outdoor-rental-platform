import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useGetIdentity } from "@refinedev/core";
import {
  Bell,
  CalendarClock,
  ChevronRight,
  CreditCard,
  FileBarChart,
  History,
  Mountain,
  Receipt,
  RotateCcw,
  Search,
  TentTree,
  Wrench,
} from "lucide-react";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { getFinancialReport } from "@/features/laporan/service";
import { listNotifications } from "@/features/pemberitahuan/service";
import { listInventoryUnits } from "@/features/inventaris/service";
import { listRentals } from "@/features/penyewaan/service";
import { listReturnQueue } from "@/features/pengembalian/service";
import { listReservations } from "@/features/reservasi/service";
import type { NotificationRecord } from "@/features/pemberitahuan/types";
import type { FinancialReport } from "@/features/laporan/types";
import type { InventoryUnit } from "@/features/inventaris/types";
import type { RentalListItem } from "@/features/penyewaan/types";
import type { ReturnQueueItem } from "@/features/pengembalian/types";
import type { ReservationListItem } from "@/features/reservasi/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { paths } from "@/routes/paths";

type AdminIdentity = { id: string; name: string };

type ActionItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  tone?: "default" | "warning" | "danger";
};

type AgendaItem = {
  id: string;
  type: "Pickup" | "Return" | "Reservasi";
  title: string;
  meta: string;
  href: string;
};

function dateOnly(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function period() {
  const now = new Date();
  return {
    start: dateOnly(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: dateOnly(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
  };
}

function money(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function sameDay(value: string | null | undefined, day: string) {
  return value ? dateOnly(new Date(value)) === day : false;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function humanStatus(status: string) {
  return status.replaceAll("_", " ");
}

const inventoryQuery = {
  search: "",
  status: "all",
  barangId: "all",
  varianBarangId: "all",
  locationId: "all",
  availabilityContext: "all" as const,
  sort: "updated_desc" as const,
  page: 1,
  pageSize: 1,
};

export function Dashboard() {
  const { data: identity } = useGetIdentity<AdminIdentity>();
  const { current } = useCurrentUsaha();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [rentals, setRentals] = useState<RentalListItem[]>([]);
  const [returns, setReturns] = useState<ReturnQueueItem[]>([]);
  const [reservations, setReservations] = useState<ReservationListItem[]>([]);
  const [inventoryAttentionUnits, setInventoryAttentionUnits] = useState<InventoryUnit[]>([]);
  const [inventoryCounts, setInventoryCounts] = useState({ ready: 0, rented: 0, maintenance: 0, inactive: 0 });
  const [error, setError] = useState<string | null>(null);

  const usahaId = current?.usahaId;
  const adminId = current?.akunAdminId;
  const greetingName = identity?.name?.split(" ")[0] || "Admin";
  const todayKey = dateOnly(new Date());

  useEffect(() => {
    if (!usahaId || !adminId) return;

    const p = period();
    let active = true;

    Promise.all([
      listNotifications(usahaId, adminId, 8),
      getFinancialReport(usahaId, p.start, p.end),
      listRentals(usahaId, { search: "", page: 1, pageSize: 50 }),
      listReturnQueue(usahaId, { search: "", page: 1, pageSize: 50, rentalStatus: "all", dueState: "all" }),
      listReservations(usahaId, { search: "", status: "all", page: 1, pageSize: 50 }),
      listInventoryUnits(usahaId, inventoryQuery),
      listInventoryUnits(usahaId, { ...inventoryQuery, status: "ready" }),
      listInventoryUnits(usahaId, { ...inventoryQuery, status: "rented" }),
      listInventoryUnits(usahaId, { ...inventoryQuery, status: "maintenance" }),
      listInventoryUnits(usahaId, { ...inventoryQuery, status: "inactive" }),
    ])
      .then(([
        notificationData,
        reportData,
        rentalData,
        returnData,
        reservationData,
        attentionData,
        readyData,
        rentedData,
        maintenanceData,
        inactiveData,
      ]) => {
        if (!active) return;
        setNotifications(notificationData.items);
        setUnreadCount(notificationData.unreadCount);
        setReport(reportData);
        setRentals(rentalData.rentals);
        setReturns(returnData.returns);
        setReservations(reservationData.reservations);
        setInventoryAttentionUnits(
          attentionData.units.filter((unit) =>
            ["inspection_pending", "maintenance", "damaged", "lost"].includes(unit.status),
          ),
        );
        setInventoryCounts({
          ready: readyData.total,
          rented: rentedData.total,
          maintenance: maintenanceData.total,
          inactive: inactiveData.total,
        });
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Dashboard gagal dimuat.");
      });

    return () => {
      active = false;
    };
  }, [usahaId, adminId]);

  const currentRentals = useMemo(
    () =>
      rentals
        .filter(
          (item) =>
            item.actual_pickup_at &&
            !item.actual_return_completed_at &&
            !["completed", "cancelled", "canceled"].includes(item.status),
        )
        .slice(0, 5),
    [rentals],
  );

  const pickupToday = useMemo(
    () =>
      rentals.filter(
        (item) =>
          sameDay(item.jadwal_mulai, todayKey) &&
          !item.actual_pickup_at &&
          !["completed", "cancelled", "canceled"].includes(item.status),
      ),
    [rentals, todayKey],
  );

  const returnsToday = useMemo(
    () => returns.filter((item) => sameDay(item.jadwal_kembali, todayKey)),
    [returns, todayKey],
  );

  const reservationsToday = useMemo(
    () =>
      reservations.filter(
        (item) =>
          sameDay(item.mulai_reservasi, todayKey) &&
          !["cancelled", "canceled"].includes(item.status),
      ),
    [reservations, todayKey],
  );

  const agenda = useMemo<AgendaItem[]>(() => {
    const items: AgendaItem[] = [
      ...pickupToday.map((item) => ({
        id: `pickup-${item.penyewaan_id}`,
        type: "Pickup" as const,
        title: `${item.nomor_penyewaan} · ${item.penyewa_nama ?? "Penyewa"}`,
        meta: `Pickup ${formatTime(item.jadwal_mulai)}`,
        href: `${paths.penyewaan}/${item.penyewaan_id}`,
      })),
      ...returnsToday.map((item) => ({
        id: `return-${item.penyewaan_id}`,
        type: "Return" as const,
        title: `${item.nomor_penyewaan} · ${item.penyewa_nama ?? "Penyewa"}`,
        meta: `Kembali ${formatTime(item.jadwal_kembali)}`,
        href: `${paths.pengembalian}/${item.penyewaan_id}`,
      })),
      ...reservationsToday.map((item) => ({
        id: `reservation-${item.reservasi_id}`,
        type: "Reservasi" as const,
        title: `${item.nomor_reservasi} · ${item.penyewa_nama ?? "Penyewa"}`,
        meta: `Mulai ${formatTime(item.mulai_reservasi)}`,
        href: `${paths.reservasi}/${item.reservasi_id}`,
      })),
    ];

    return items.slice(0, 7);
  }, [pickupToday, returnsToday, reservationsToday]);

  const attentionItems = useMemo<ActionItem[]>(() => {
    const items: ActionItem[] = [];

    returns
      .filter((item) => ["due", "late_within_tolerance", "tolerance_expired"].includes(item.due_state))
      .slice(0, 3)
      .forEach((item) => {
        items.push({
          id: `return-${item.penyewaan_id}`,
          title:
            item.due_state === "tolerance_expired"
              ? `Pengembalian melewati toleransi · ${item.nomor_penyewaan}`
              : `Pengembalian perlu diproses · ${item.nomor_penyewaan}`,
          description: `${item.penyewa_nama ?? "Penyewa"} · ${humanStatus(item.due_state)}`,
          href: `${paths.pengembalian}/${item.penyewaan_id}`,
          tone: item.due_state === "tolerance_expired" ? "danger" : "warning",
        });
      });

    pickupToday.slice(0, 2).forEach((item) => {
      items.push({
        id: `pickup-${item.penyewaan_id}`,
        title: `Pickup hari ini · ${item.nomor_penyewaan}`,
        description: `${item.penyewa_nama ?? "Penyewa"} · ${formatTime(item.jadwal_mulai)}`,
        href: `${paths.penyewaan}/${item.penyewaan_id}`,
      });
    });

    if (inventoryAttentionUnits.length > 0) {
      items.push({
        id: "inventory-attention",
        title: "Unit membutuhkan perhatian",
        description: `${inventoryAttentionUnits.length} unit terlihat pada antrean perhatian inventaris.`,
        href: `${paths.inventaris}?availability=attention`,
        tone: "warning",
      });
    }

    notifications
      .filter((item) => !item.dibaca_at)
      .slice(0, 2)
      .forEach((item) => {
        items.push({
          id: `notification-${item.pemberitahuan_id}`,
          title: item.judul,
          description: item.pesan,
          href: item.action_target || paths.pemberitahuan,
        });
      });

    return items.slice(0, 6);
  }, [inventoryAttentionUnits.length, notifications, pickupToday, returns]);

  const quickActions = [
    ["Rental Langsung", paths.penyewaanWalkIn, TentTree, "Buka flow walk-in"],
    ["Proses Pengembalian", paths.pengembalian, RotateCcw, "Buka antrean return"],
    ["Buat Perawatan", paths.perawatan, Wrench, "Kelola maintenance"],
    ["Tambah Unit", paths.inventarisCreate, Mountain, "Daftarkan unit"],
    ["Tambah Barang", paths.katalogEdit, TentTree, "Kelola katalog"],
    ["Catat Pembayaran", paths.keuangan, CreditCard, "Buka finance"],
    ["Buat Reservasi", paths.reservasiCreate, CalendarClock, "Buat reservation"],
  ] as const;

  const statusTone = (tone: ActionItem["tone"]) =>
    cn(
      "size-2.5 rounded-full",
      tone === "danger" ? "bg-destructive" : tone === "warning" ? "bg-amber-500" : "bg-primary",
    );

  return (
    <div data-testid="dashboard-root" className="space-y-5 pb-8">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-950 via-emerald-900 to-slate-900 text-white shadow-sm">
        <div className="absolute inset-0 opacity-70" aria-hidden="true">
          <div className="absolute -right-16 -top-16 size-48 rounded-full bg-emerald-400/20 blur-3xl sm:size-64" />
          <div className="absolute -bottom-24 right-16 size-56 rounded-full bg-sky-400/10 blur-3xl sm:size-72" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/25 via-transparent to-transparent" />
        </div>
        <div className="pointer-events-none absolute right-[-1rem] bottom-[-2.5rem] opacity-15 sm:right-4 sm:bottom-[-3rem]" aria-hidden="true">
          <Mountain className="size-48 stroke-[1.1] sm:size-64" />
        </div>
        <div className="pointer-events-none absolute right-20 bottom-5 opacity-10 sm:right-36" aria-hidden="true">
          <TentTree className="size-20 stroke-[1.2] sm:size-24" />
        </div>
        <div className="relative z-10 flex min-h-[210px] flex-col justify-between p-5 sm:min-h-[240px] sm:p-7 lg:p-8">
          <div className="max-w-xl">
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">Operational control center</p>
              <span className="hidden h-1 w-1 rounded-full bg-white/30 sm:block" aria-hidden="true" />
              <p className="text-sm font-medium text-white/80">{current?.usahaNama ?? "Usaha aktif"}</p>
            </div>
            <div className="mt-5 space-y-1">
              <p className="text-sm font-medium text-white/65">Selamat datang kembali,</p>
              <h1 className="text-[2rem] font-bold leading-none tracking-[-0.03em] sm:text-4xl">{greetingName}</h1>
            </div>
            <p className="mt-4 max-w-lg text-sm leading-6 text-white/72 sm:text-base">
              Pantau pekerjaan yang membutuhkan perhatian dan kembali ke modul pemilik saat tindakan diperlukan.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm">
              <span className={cn("size-2 rounded-full", error ? "bg-amber-400" : "bg-emerald-300")} aria-hidden="true" />
              {error ? "Perlu dimuat ulang" : "Source terhubung"}
            </span>
            <Link
              className="inline-flex items-center text-xs font-semibold text-white/90 underline-offset-4 hover:text-white hover:underline"
              to={paths.laporan}
            >
              Buka Laporan
            </Link>
          </div>
        </div>
      </section>

      {/* Existing KPI block — intentionally preserved in content and semantics. */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5" aria-label="KPI">
        {([
          ["Belum dibaca", String(unreadCount), "Perlu Perhatian", Bell, "bg-primary/10 text-primary", paths.pemberitahuan],
          ["Pemasukan", report ? money(report.summary.recorded_income) : "—", "Finance source", CreditCard, "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300", paths.keuangan],
          ["Pengeluaran", report ? money(report.summary.recorded_expense) : "—", "Finance source", Receipt, "bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300", paths.keuangan + "/pengeluaran"],
          ["Net operasional", report ? money(report.summary.net_operational_movement) : "—", "Derived report", FileBarChart, "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200", paths.laporan],
          ["Pembayaran", report ? String(report.summary.recorded_payment_count) : "—", "Finance source", CreditCard, "bg-primary/10 text-primary", paths.keuangan + "/pembayaran"],
        ] as const).map(([label, value, delta, Icon, tone, href]) => (
          <Link key={label} to={href} className="block">
            <Card className="h-full shadow-sm transition-colors hover:bg-muted/30">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
                    <p className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{value}</p>
                  </div>
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", tone)}>
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">{delta}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>

      <div className="hidden space-y-5 lg:block">
        <section className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
          <Card className="shadow-sm">
            <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
              <div>
                <CardTitle className="text-base sm:text-lg">Perlu Tindakan</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Pekerjaan yang perlu dilanjutkan dari source domain masing-masing.</p>
              </div>
              <Badge variant={attentionItems.length ? "default" : "secondary"}>{attentionItems.length} item</Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {attentionItems.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Tidak ada pekerjaan yang terdeteksi perlu tindakan saat ini.
                </div>
              ) : (
                attentionItems.map((item) => (
                  <Link key={item.id} to={item.href} className="flex items-center gap-3 rounded-xl border bg-background p-3 transition-colors hover:bg-muted/40">
                    <span className={statusTone(item.tone)} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
              <div>
                <CardTitle className="text-base sm:text-lg">Agenda Hari Ini</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Pickup, return, dan reservasi yang jatuh pada hari ini.</p>
              </div>
              <Badge variant="secondary">{agenda.length}</Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {agenda.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Tidak ada agenda operasional untuk hari ini.
                </div>
              ) : (
                agenda.map((item) => (
                  <Link key={item.id} to={item.href} className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/40">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                      {item.type === "Pickup" ? <TentTree className="size-4" /> : item.type === "Return" ? <RotateCcw className="size-4" /> : <CalendarClock className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.type} · {item.meta}</p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg">Quick Actions</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Shortcut menuju workflow domain. Validasi tetap dilakukan di halaman dan server pemilik.</p>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {quickActions.map(([label, href, Icon, helper]) => (
              <Button key={label} asChild variant="outline" className="h-auto justify-between px-3 py-3 text-left">
                <Link to={href}>
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{label}</span>
                      <span className="block truncate text-[11px] font-normal text-muted-foreground">{helper}</span>
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>

        <section className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Operational Snapshot</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Kondisi operasional saat ini. Angka tetap berasal dari source domain.</p>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Rental berjalan", currentRentals.length, paths.penyewaan],
                ["Pickup hari ini", pickupToday.length, paths.penyewaan],
                ["Return hari ini", returnsToday.length, paths.pengembalian],
                ["Perlu inventory attention", inventoryAttentionUnits.length, paths.inventaris],
              ].map(([label, value, href]) => (
                <Link key={label} to={href as string} className="rounded-xl border p-4 transition-colors hover:bg-muted/40">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-2 text-2xl font-bold tracking-tight">{value as number}</p>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Inventory</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Physical truth unit berdasarkan status inventaris saat ini.</p>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {[
                ["Ready", inventoryCounts.ready, paths.inventaris + "?status=ready"],
                ["Rented", inventoryCounts.rented, paths.inventaris + "?status=rented"],
                ["Maintenance", inventoryCounts.maintenance, paths.inventaris + "?status=maintenance"],
                ["Inactive", inventoryCounts.inactive, paths.inventaris + "?status=inactive"],
              ].map(([label, value, href]) => (
                <Link key={label} to={href as string} className="rounded-xl border bg-background p-3 transition-colors hover:bg-muted/40">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-semibold">{value as number}</p>
                </Link>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Finance</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Ringkasan periode berjalan dari source keuangan. KPI di atas tetap dipertahankan.</p>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link to={paths.keuangan} className="flex items-center justify-between rounded-xl border p-3 hover:bg-muted/40">
                <span><span className="block text-sm font-medium">Pemasukan tercatat</span><span className="text-xs text-muted-foreground">Periode berjalan</span></span>
                <span className="font-semibold">{report ? money(report.summary.recorded_income) : "—"}</span>
              </Link>
              <Link to={paths.keuangan + "/pengeluaran"} className="flex items-center justify-between rounded-xl border p-3 hover:bg-muted/40">
                <span><span className="block text-sm font-medium">Pengeluaran tercatat</span><span className="text-xs text-muted-foreground">Periode berjalan</span></span>
                <span className="font-semibold">{report ? money(report.summary.recorded_expense) : "—"}</span>
              </Link>
              <Link to={paths.laporan} className="flex items-center justify-between rounded-xl border p-3 hover:bg-muted/40">
                <span><span className="block text-sm font-medium">Net operasional</span><span className="text-xs text-muted-foreground">Derived report</span></span>
                <span className="font-semibold">{report ? money(report.summary.net_operational_movement) : "—"}</span>
              </Link>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Recent Activity</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Aktivitas sistem terbaru yang memiliki notifikasi atau target tindakan.</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {notifications.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada aktivitas yang dapat ditampilkan.</div>
              ) : (
                notifications.slice(0, 6).map((item) => (
                  <Link key={item.pemberitahuan_id} to={item.action_target || paths.pemberitahuan} className="flex items-center gap-3 rounded-xl border p-3 hover:bg-muted/40">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><History className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.judul}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.pesan}</p>
                    </div>
                    {!item.dibaca_at && <Badge variant="secondary">Baru</Badge>}
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold">Pencarian operasional</p>
              <p className="mt-1 text-xs text-muted-foreground">Cari penyewa, penyewaan, unit, barang, atau QR dari satu tempat.</p>
            </div>
            <div className="relative w-full lg:max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="Cari operasional" placeholder="Cari penyewa, barang, kode penyewaan, atau QR..." className="h-11 pl-9" />
            </div>
          </div>
        </section>
      </div>

      <div className="space-y-4 lg:hidden">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Perlu Tindakan</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Prioritas operasional yang perlu dilanjutkan.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {attentionItems.length === 0 ? (
              <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Tidak ada tindakan mendesak saat ini.</div>
            ) : attentionItems.slice(0, 4).map((item) => (
              <Link key={item.id} to={item.href} className="flex items-center gap-3 rounded-xl border p-3">
                <span className={statusTone(item.tone)} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base">Quick Action</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {quickActions.slice(0, 6).map(([label, href, Icon]) => (
              <Button key={label} asChild variant="outline" className="h-auto justify-start px-3 py-3 text-left">
                <Link to={href}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span>
                    <span className="truncate text-xs font-semibold">{label}</span>
                  </span>
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Today</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Jadwal operasional hari ini.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {agenda.length === 0 ? (
              <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Tidak ada agenda hari ini.</div>
            ) : agenda.slice(0, 5).map((item) => (
              <Link key={item.id} to={item.href} className="flex items-center gap-3 rounded-xl border p-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  {item.type === "Pickup" ? <TentTree className="size-4" /> : item.type === "Return" ? <RotateCcw className="size-4" /> : <CalendarClock className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.type} · {item.meta}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Current Rentals</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Rental yang saat ini sedang berjalan.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {currentRentals.length === 0 ? (
              <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Belum ada rental aktif.</div>
            ) : currentRentals.map((item) => (
              <Link key={item.penyewaan_id} to={`${paths.penyewaan}/${item.penyewaan_id}`} className="flex items-center gap-3 rounded-xl border p-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><TentTree className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.nomor_penyewaan}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.penyewa_nama ?? "Penyewa"} · s.d. {formatTime(item.jadwal_kembali)}</p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base">Returns</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {returns.slice(0, 5).length === 0 ? (
              <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Tidak ada return dalam antrean.</div>
            ) : returns.slice(0, 5).map((item) => (
              <Link key={item.penyewaan_id} to={`${paths.pengembalian}/${item.penyewaan_id}`} className="flex items-center gap-3 rounded-xl border p-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><RotateCcw className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.nomor_penyewaan}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.penyewa_nama ?? "Penyewa"} · {humanStatus(item.due_state)}</p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
            <div><CardTitle className="text-base">Notifications</CardTitle><p className="mt-1 text-xs text-muted-foreground">Notifikasi terbaru yang perlu diketahui.</p></div>
            <Badge variant="secondary">{unreadCount}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {notifications.length === 0 ? (
              <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">Belum ada notifikasi.</div>
            ) : notifications.slice(0, 5).map((item) => (
              <Link key={item.pemberitahuan_id} to={item.action_target || paths.pemberitahuan} className="flex items-center gap-3 rounded-xl border p-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Bell className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-medium", !item.dibaca_at && "text-primary")}>{item.judul}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.pesan}</p>
                </div>
                {!item.dibaca_at && <Badge variant="secondary">Baru</Badge>}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

Dashboard.displayName = "Dashboard";
