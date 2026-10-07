import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useGetIdentity } from "@refinedev/core";
import {
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CreditCard,
  FileBarChart,
  History,
  Mountain,
  Receipt,
  RotateCcw,
  TentTree,
  Wrench,
} from "lucide-react";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { getFinancialReport } from "@/features/laporan/service";
import { listNotifications } from "@/features/pemberitahuan/service";
import { listInventoryUnits } from "@/features/inventaris/service";
import { DEFAULT_RENTAL_LIST_FILTERS } from "@/features/penyewaan/types";
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
  type: "Pickup" | "Pengembalian" | "Reservasi";
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

function SectionHeader({
  icon: Icon,
  title,
  description,
  count,
  href,
  actionLabel = "Lihat semua",
}: {
  icon: typeof Bell;
  title: string;
  description: string;
  count?: number;
  href?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold tracking-tight text-foreground sm:text-base">{title}</h2>
            {typeof count === "number" ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {count}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p>
        </div>
      </div>
      {href ? (
        <Link
          to={href}
          className="inline-flex shrink-0 items-center gap-0.5 pt-1 text-[11px] font-semibold text-primary hover:underline"
        >
          {actionLabel}
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

function AttentionRow({ item }: { item: ActionItem }) {
  const Icon = item.tone === "danger" ? Bell : item.title.toLowerCase().includes("pickup") ? CalendarClock : Wrench;

  return (
    <Link
      to={item.href}
      className="group flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2.5 transition-colors hover:bg-muted/40"
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-xl",
          item.tone === "danger"
            ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300"
            : "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-300",
        )}
      >
        {item.tone === "danger" ? (
          <RotateCcw className="size-4" aria-hidden="true" />
        ) : (
          <Icon className="size-4" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold text-foreground">{item.title}</span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{item.description}</span>
      </span>
      <span
        className={cn(
          "hidden shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold sm:inline-flex",
          item.tone === "danger"
            ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300"
            : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
        )}
      >
        {item.tone === "danger" ? "Perlu tindakan" : "Perhatian"}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

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
  const [activityOpen, setActivityOpen] = useState(false);

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
      listRentals(usahaId, { ...DEFAULT_RENTAL_LIST_FILTERS, pageSize: 50 }),
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
        setError(null);
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
        .slice(0, 4),
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
        type: "Pengembalian" as const,
        title: `${item.nomor_penyewaan} · ${item.penyewa_nama ?? "Penyewa"}`,
        meta: `Kembali ${formatTime(item.jadwal_kembali)}`,
        href: `${paths.penyewaan}/${item.penyewaan_id}#rental-operational`,
      })),
      ...reservationsToday.map((item) => ({
        id: `reservation-${item.reservasi_id}`,
        type: "Reservasi" as const,
        title: `${item.nomor_reservasi} · ${item.penyewa_nama ?? "Penyewa"}`,
        meta: `Mulai ${formatTime(item.mulai_reservasi)}`,
        href: `${paths.reservasi}/${item.reservasi_id}`,
      })),
    ];

    return items.slice(0, 6);
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
          href: `${paths.penyewaan}/${item.penyewaan_id}#rental-operational`,
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
        description: `${inventoryAttentionUnits.length} unit · Hasil pemeriksaan / status inventaris`,
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
    ["Rental Langsung", paths.penyewaanWalkIn, TentTree],
    ["Selesaikan Sewa", paths.penyewaan, TentTree],
    ["Buat Perawatan", paths.perawatan, Wrench],
    ["Tambah Unit", paths.inventarisCreate, Mountain],
    ["Tambah Barang", paths.katalogEdit, TentTree],
    ["Catat Pembayaran", paths.keuangan, CreditCard],
  ] as const;

  const activityItems = notifications.slice(0, activityOpen ? 6 : 3);

  const financeCards = [
    {
      label: "Belum Dibaca",
      value: String(unreadCount),
      helper: unreadCount > 0 ? "Perlu perhatian" : "Semua sudah dibaca",
      icon: Bell,
      surface: "bg-emerald-50/80 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
      href: paths.pemberitahuan,
    },
    {
      label: "Pemasukan",
      value: report ? money(report.summary.recorded_income) : "—",
      helper: "Tercatat periode berjalan",
      icon: CreditCard,
      surface: "bg-emerald-50/80 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
      href: paths.keuangan,
    },
    {
      label: "Pengeluaran",
      value: report ? money(report.summary.recorded_expense) : "—",
      helper: "Tercatat periode berjalan",
      icon: Receipt,
      surface: "bg-red-50/80 text-red-600 dark:bg-red-950/25 dark:text-red-300",
      href: paths.keuangan + "/pengeluaran",
    },
    {
      label: "Pembayaran",
      value: report ? `${report.summary.recorded_payment_count} transaksi` : "—",
      helper: "Source Keuangan",
      icon: FileBarChart,
      surface: "bg-sky-50/80 text-sky-700 dark:bg-sky-950/25 dark:text-sky-300",
      href: paths.keuangan + "/pembayaran",
    },
    {
      label: "Net Operasional",
      value: report ? money(report.summary.net_operational_movement) : "—",
      helper: "Pemasukan − Pengeluaran",
      icon: FileBarChart,
      surface: "bg-violet-50/80 text-violet-700 dark:bg-violet-950/25 dark:text-violet-300",
      href: paths.laporan,
    },
  ] as const;

  return (
    <div data-testid="dashboard-root" className="space-y-4 pb-8 sm:space-y-5">
      <section className="relative overflow-hidden rounded-[1.45rem] border border-border/60 bg-card shadow-[0_8px_30px_rgba(35,55,45,.08)]">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-cover bg-center opacity-35"
          style={{ backgroundImage: "url('/login-bg.webp')" }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-br from-white/80 via-white/70 to-emerald-50/40 dark:from-slate-950/85 dark:via-slate-950/75 dark:to-emerald-950/40"
        />
        <div className="relative z-10 min-h-[178px] px-4 pb-4 pt-4 sm:min-h-[208px] sm:px-6 sm:pb-5 sm:pt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Beranda</p>
            <div className="inline-flex max-w-[58%] items-center gap-1.5 rounded-full border border-border/70 bg-background/85 px-3 py-2 text-[10px] font-semibold shadow-sm backdrop-blur-sm sm:text-[11px]">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Mountain className="size-3" aria-hidden="true" />
              </span>
              <span className="truncate">{current?.usahaNama ?? "Usaha aktif"}</span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            </div>
          </div>

          <div className="mt-6 max-w-[34rem] sm:mt-7">
            <h1 className="text-[1.75rem] font-bold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-3xl">
              Selamat datang, {greetingName}
            </h1>
            <p className="mt-2 max-w-[27rem] text-[12px] leading-5 text-muted-foreground sm:text-sm sm:leading-6">
              Pantau pekerjaan operasional yang membutuhkan perhatian hari ini.
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold",
                error
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700",
              )}
            >
              <span className={cn("size-1.5 rounded-full", error ? "bg-amber-500" : "bg-emerald-500")} aria-hidden="true" />
              {error ? "Perlu dimuat ulang" : "Source terhubung"}
            </span>
            <span className="text-[10px] text-muted-foreground">Operational control center</span>
          </div>
        </div>
      </section>

      <section
        aria-label="Ringkasan"
        className="grid grid-cols-6 gap-2.5 max-[359px]:grid-cols-2"
      >
        {financeCards.map((item, index) => {
          const Icon = item.icon;
          const compactClass =
            index < 3
              ? "col-span-2 max-[359px]:col-span-1"
              : index === 3
                ? "col-span-2 max-[359px]:col-span-1"
                : "col-span-4 max-[359px]:col-span-2";

          return (
            <Link key={item.label} to={item.href} className={cn("min-w-0", compactClass)}>
              <div className="h-full rounded-[1.1rem] border border-border/60 bg-card p-3 shadow-[0_4px_20px_rgba(35,55,45,.05)] transition-colors hover:bg-muted/20 sm:p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-medium text-muted-foreground">{item.label}</p>
                    <p className="mt-1 truncate text-[15px] font-bold tracking-tight sm:text-lg">{item.value}</p>
                  </div>
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", item.surface)}>
                    <Icon className="size-3.5" aria-hidden="true" />
                  </span>
                </div>
                <p className="mt-2 truncate text-[9px] text-muted-foreground">{item.helper}</p>
              </div>
            </Link>
          );
        })}
      </section>

      <section className="rounded-[1.2rem] border border-border/60 bg-card p-3.5 shadow-[0_5px_24px_rgba(35,55,45,.05)] sm:p-4">
        <SectionHeader
          icon={Bell}
          title="Perlu Tindakan"
          count={attentionItems.length}
          description="Pekerjaan yang membutuhkan perhatian segera."
          href={attentionItems.length ? paths.pemberitahuan : undefined}
        />
        <div className="mt-3 space-y-1.5">
          {attentionItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
              Tidak ada pekerjaan yang membutuhkan perhatian saat ini.
            </div>
          ) : (
            attentionItems.slice(0, 3).map((item) => <AttentionRow key={item.id} item={item} />)
          )}
        </div>
      </section>

      <section className="rounded-[1.2rem] border border-border/60 bg-card p-3.5 shadow-[0_5px_24px_rgba(35,55,45,.05)] sm:p-4">
        <SectionHeader
          icon={TentTree}
          title="Aksi Cepat"
          description="Akses langsung ke pekerjaan yang sering dilakukan."
          href={paths.penyewaan}
          actionLabel="Lainnya"
        />
        <div className="mt-3 grid grid-cols-3 gap-2 max-[359px]:grid-cols-2 sm:grid-cols-6">
          {quickActions.map(([label, href, Icon]) => (
            <Link
              key={label}
              to={href}
              className="group flex min-h-[80px] flex-col items-center justify-center rounded-xl border border-border/60 bg-emerald-50/45 px-1.5 py-2.5 text-center transition-colors hover:bg-emerald-50 dark:bg-emerald-950/15 dark:hover:bg-emerald-950/25"
            >
              <span className="grid size-8 place-items-center rounded-xl text-primary">
                <Icon className="size-4.5" strokeWidth={1.9} aria-hidden="true" />
              </span>
              <span className="mt-1 line-clamp-2 text-[10px] font-semibold leading-4 text-foreground">{label}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-3.5 min-[380px]:grid-cols-2">
        <section className="rounded-[1.2rem] border border-border/60 bg-card p-3.5 shadow-[0_5px_24px_rgba(35,55,45,.05)] sm:p-4">
          <SectionHeader
            icon={CalendarClock}
            title="Hari Ini"
            count={agenda.length}
            description="Jadwal operasional hari ini."
            href={agenda.length ? paths.penyewaan : undefined}
          />
          <div className="mt-3 space-y-0.5">
            {agenda.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                Tidak ada agenda operasional hari ini.
              </div>
            ) : (
              agenda.slice(0, 4).map((item, index) => (
                <Link
                  key={item.id}
                  to={item.href}
                  className="relative flex gap-2.5 rounded-xl px-1.5 py-2 hover:bg-muted/30"
                >
                  <div className="relative mt-1.5 flex w-4 shrink-0 justify-center">
                    {index < Math.min(agenda.length, 4) - 1 ? (
                      <span className="absolute left-1/2 top-3 h-full w-px -translate-x-1/2 bg-border" aria-hidden="true" />
                    ) : null}
                    <span
                      className={cn(
                        "relative z-10 size-2.5 rounded-full ring-4 ring-card",
                        item.type === "Pickup"
                          ? "bg-emerald-500"
                          : item.type === "Pengembalian"
                            ? "bg-sky-500"
                            : "bg-slate-400",
                      )}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[9px] font-semibold text-muted-foreground">{formatTime(item.type === "Pickup" ? pickupToday.find((x) => item.id.includes(x.penyewaan_id))?.jadwal_mulai : item.type === "Pengembalian" ? returns.find((x) => item.id.includes(x.penyewaan_id))?.jadwal_kembali : reservations.find((x) => item.id.includes(x.reservasi_id))?.mulai_reservasi)}</p>
                    <p className="mt-0.5 truncate text-[11px] font-semibold">{item.type}</p>
                    <p className="truncate text-[9px] text-muted-foreground">{item.title}</p>
                  </div>
                  <ChevronRight className="mt-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="rounded-[1.2rem] border border-border/60 bg-card p-3.5 shadow-[0_5px_24px_rgba(35,55,45,.05)] sm:p-4">
          <SectionHeader
            icon={TentTree}
            title="Rental Berjalan"
            count={currentRentals.length}
            description="Rental yang saat ini sedang berjalan."
            href={paths.penyewaan}
          />
          <div className="mt-3 space-y-1">
            {currentRentals.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                Belum ada rental berjalan.
              </div>
            ) : (
              currentRentals.slice(0, 2).map((item) => (
                <Link
                  key={item.penyewaan_id}
                  to={`${paths.penyewaan}/${item.penyewaan_id}`}
                  className="group flex items-start gap-2 rounded-xl border border-border/60 px-2.5 py-2.5 hover:bg-muted/25"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-primary dark:bg-emerald-950/20">
                    <TentTree className="size-3.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-[10px] font-bold">{item.nomor_penyewaan}</span>
                      <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[8px] font-semibold text-emerald-700 dark:bg-emerald-950/25 dark:text-emerald-300">
                        Berjalan
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{item.penyewa_nama ?? "Penyewa"}</span>
                    <span className="mt-1 block truncate text-[9px] text-muted-foreground">
                      {item.detail_count} jenis · {item.assignment_count} unit · s.d. {formatTime(item.jadwal_kembali)}
                    </span>
                  </span>
                  <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              ))
            )}
          </div>

          <details className="mt-2.5 rounded-xl border border-border/60 bg-muted/15">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-[10px] font-semibold marker:hidden">
              <span className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Mountain className="size-3.5" aria-hidden="true" />
                </span>
                Kondisi Inventaris
              </span>
              <span className="text-[9px] font-normal text-muted-foreground">Lihat ringkasan</span>
            </summary>
            <div className="grid grid-cols-4 gap-1.5 border-t border-border/60 px-3 py-2.5">
              {[
                ["Ready", inventoryCounts.ready, paths.inventaris + "?status=ready"],
                ["Disewa", inventoryCounts.rented, paths.inventaris + "?status=rented"],
                ["Perawatan", inventoryCounts.maintenance, paths.inventaris + "?status=maintenance"],
                ["Tidak Aktif", inventoryCounts.inactive, paths.inventaris + "?status=inactive"],
              ].map(([label, value, href]) => (
                <Link key={label} to={href as string} className="rounded-lg bg-background px-2 py-2 text-center hover:bg-card">
                  <span className="block text-[8px] text-muted-foreground">{label}</span>
                  <span className="mt-0.5 block text-xs font-bold">{value as number}</span>
                </Link>
              ))}
            </div>
          </details>
        </section>
      </div>

      <section className="rounded-[1.2rem] border border-border/60 bg-card p-3.5 shadow-[0_5px_24px_rgba(35,55,45,.05)] sm:p-4">
        <SectionHeader
          icon={History}
          title="Aktivitas Terbaru"
          count={notifications.length}
          description="Pemberitahuan terbaru yang perlu diketahui."
          href={paths.pemberitahuan}
        />
        {notifications.length > 3 ? (
          <button
            type="button"
            aria-expanded={activityOpen}
            onClick={() => setActivityOpen((open) => !open)}
            className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-primary min-[380px]:hidden"
          >
            {activityOpen ? "Ringkas" : "Tampilkan lebih banyak"}
            <ChevronDown className={cn("size-3.5 transition-transform", activityOpen && "rotate-180")} aria-hidden="true" />
          </button>
        ) : null}
        <div className="mt-2.5 space-y-1.5">
          {activityItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
              Belum ada pemberitahuan.
            </div>
          ) : (
            activityItems.map((item) => (
              <Link
                key={item.pemberitahuan_id}
                to={item.action_target || paths.pemberitahuan}
                className="flex items-center gap-2.5 rounded-xl border border-border/60 px-2.5 py-2 hover:bg-muted/25"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Bell className="size-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[10px] font-semibold", !item.dibaca_at && "text-primary")}>{item.judul}</span>
                  <span className="block truncate text-[9px] text-muted-foreground">{item.pesan}</span>
                </span>
                {!item.dibaca_at ? <Badge variant="secondary" className="shrink-0 px-1.5 py-0.5 text-[8px]">Baru</Badge> : null}
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            ))
          )}
        </div>
      </section>

      <p className="px-1 text-[9px] text-muted-foreground">
        Data dashboard berasal dari modul pemilik dan laporan turunan. Dashboard tidak mengubah fakta bisnis.
      </p>
    </div>
  );
}

Dashboard.displayName = "Dashboard";
