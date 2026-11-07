import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useGetIdentity } from "@refinedev/core";
import {
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CreditCard,
  History,
  Mountain,
  RotateCcw,
  ShoppingBag,
  Tag,
  TentTree,
  TrendingDown,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { FinancePeriodCompact } from "@/components/keuangan/finance-ui";
import { getFinanceAccountSummary, getFinanceDashboardAnalytics, useFinancePeriod } from "@/features/keuangan";
import type { FinanceAccount, FinanceDashboardCashflowPoint, FinanceDashboardAnalytics } from "@/features/keuangan/types";
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { listNotifications } from "@/features/pemberitahuan/service";
import { listInventoryUnits } from "@/features/inventaris/service";
import { DEFAULT_RENTAL_LIST_FILTERS } from "@/features/penyewaan/types";
import { listRentals } from "@/features/penyewaan/service";
import { listReturnQueue } from "@/features/pengembalian/service";
import { listReservations } from "@/features/reservasi/service";
import type { NotificationRecord } from "@/features/pemberitahuan/types";
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

function moneyForCurrency(value: number, currencyCode: string) {
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value) + " " + currencyCode;
  }
}

function compactMoney(value: number) {
  return new Intl.NumberFormat("id-ID", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatBusinessDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value + "T00:00:00+07:00"));
}

type CashflowTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: FinanceDashboardCashflowPoint }>;
  label?: string;
  currencyCode: string;
};

function CashflowTooltip({ active, payload, label, currencyCode }: CashflowTooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="min-w-[190px] rounded-xl border border-border/70 bg-card/95 p-3 shadow-xl backdrop-blur-xl">
      <p className="mb-2 text-[11px] font-bold text-foreground">{label ? formatBusinessDate(label) : "Rincian harian"}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-5 text-[11px]">
          <span className="font-semibold text-emerald-700 dark:text-emerald-300">Uang masuk</span>
          <span className="font-bold tabular-nums">{moneyForCurrency(point.income, currencyCode)}</span>
        </div>
        <div className="flex items-center justify-between gap-5 pl-2 text-[9px] text-muted-foreground">
          <span>Rental</span><span className="tabular-nums">{moneyForCurrency(point.rental_income, currencyCode)}</span>
        </div>
        <div className="flex items-center justify-between gap-5 pl-2 text-[9px] text-muted-foreground">
          <span>Retail</span><span className="tabular-nums">{moneyForCurrency(point.retail_income, currencyCode)}</span>
        </div>
        <div className="my-1 border-t border-border/60" />
        <div className="flex items-center justify-between gap-5 text-[11px]">
          <span className="font-semibold text-orange-700 dark:text-orange-300">Uang keluar</span>
          <span className="font-bold tabular-nums">{moneyForCurrency(point.expense, currencyCode)}</span>
        </div>
        <div className="flex items-center justify-between gap-5 pl-2 text-[9px] text-muted-foreground">
          <span>Pembelian</span><span className="tabular-nums">{moneyForCurrency(point.purchase_expense, currencyCode)}</span>
        </div>
        <div className="flex items-center justify-between gap-5 pl-2 text-[9px] text-muted-foreground">
          <span>Biaya lainnya</span><span className="tabular-nums">{moneyForCurrency(point.other_expense, currencyCode)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-5 border-t border-border/60 pt-2 text-[10px]">
          <span className="font-semibold">Arus bersih harian</span>
          <span className={cn("font-bold tabular-nums", point.net >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-orange-700 dark:text-orange-300")}>
            {point.net >= 0 ? "+" : ""}{moneyForCurrency(point.net, currencyCode)}
          </span>
        </div>
      </div>
    </div>
  );
}

const cashflowChartConfig = {
  income: { label: "Pemasukan", color: "#0F9F72" },
  expense: { label: "Pengeluaran", color: "#E77A5D" },
};

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
  const [dashboardAnalytics, setDashboardAnalytics] = useState<FinanceDashboardAnalytics | null>(null);
  const [operationalAccounts, setOperationalAccounts] = useState<FinanceAccount[] | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState("IDR");
  const [chartMode, setChartMode] = useState<"area" | "line">("area");
  const [showIncome, setShowIncome] = useState(true);
  const [showExpense, setShowExpense] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [rentals, setRentals] = useState<RentalListItem[]>([]);
  const [returns, setReturns] = useState<ReturnQueueItem[]>([]);
  const [reservations, setReservations] = useState<ReservationListItem[]>([]);
  const [inventoryAttentionUnits, setInventoryAttentionUnits] = useState<InventoryUnit[]>([]);
  const [inventoryCounts, setInventoryCounts] = useState({ ready: 0, rented: 0, maintenance: 0, inactive: 0 });
  const [error, setError] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const financePeriod = useFinancePeriod("Asia/Jakarta");

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(media.matches);
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  const usahaId = current?.usahaId;
  const adminId = current?.akunAdminId;
  const greetingName = identity?.name?.split(" ")[0] || "Admin";
  const todayKey = dateOnly(new Date());

  useEffect(() => {
    if (!usahaId || !adminId) return;

    let active = true;

    Promise.all([
      listNotifications(usahaId, adminId, 8),
      getFinanceDashboardAnalytics(
        usahaId,
        financePeriod.period.startDate,
        financePeriod.period.endDateExclusive,
      ).catch(() => null),
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
        analyticsData,
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
        setDashboardAnalytics(analyticsData);
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
  }, [
    usahaId,
    adminId,
    financePeriod.period.startDate,
    financePeriod.period.endDateExclusive,
  ]);

  useEffect(() => {
    if (!usahaId || !adminId) {
      setOperationalAccounts(null);
      return;
    }

    let active = true;
    setOperationalAccounts(null);
    getFinanceAccountSummary(usahaId)
      .then((summary) => {
        if (active) setOperationalAccounts(summary.accounts);
      })
      .catch(() => {
        if (active) setOperationalAccounts(null);
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
    ["Penjualan", paths.penjualan, ShoppingBag],
    ["Selesaikan Sewa", paths.penyewaan, TentTree],
    ["Buat Perawatan", paths.perawatan, Wrench],
    ["Tambah Unit", paths.inventarisCreate, Mountain],
    ["Tambah Barang", paths.katalogQuickItem, TentTree],
    ["Catat Pembayaran", paths.keuangan, CreditCard],
  ] as const;

  const activityItems = notifications.slice(0, activityOpen ? 6 : 3);

  const currencyOptions = dashboardAnalytics?.currencies?.length ? dashboardAnalytics.currencies : ["IDR"];
  const activeCurrency = currencyOptions.includes(selectedCurrency)
    ? selectedCurrency
    : currencyOptions.includes("IDR")
      ? "IDR"
      : currencyOptions[0];
  const currencyCashflow = (dashboardAnalytics?.cashflow ?? [])
    .filter((item) => item.currency_code === activeCurrency)
    .sort((left, right) => left.date.localeCompare(right.date));
  const cashflowTotals = currencyCashflow.reduce(
    (total, item) => ({
      income: total.income + item.income,
      expense: total.expense + item.expense,
    }),
    { income: 0, expense: 0 },
  );
  const cashflowDifference = cashflowTotals.income - cashflowTotals.expense;
  const paymentSummary = dashboardAnalytics?.payment_summary?.find(
    (item) => item.currency_code === activeCurrency,
  );
  const discountSummary = dashboardAnalytics?.promotions.discount_by_currency?.find(
    (item) => item.currency_code === activeCurrency,
  );
  const operationalCashBalance = operationalAccounts
    ?.filter((account) => (
      account.status === "active" &&
      account.fungsi_akun === "operasional" &&
      account.mata_uang === activeCurrency
    ))
    .reduce((total, account) => total + (Number(account.saldo) || 0), 0) ?? null;
  const hasOperationalCashBalance = operationalAccounts !== null && operationalAccounts.some((account) => (
    account.status === "active" &&
    account.fungsi_akun === "operasional" &&
    account.mata_uang === activeCurrency
  ));
  const netCashValue = hasOperationalCashBalance ? operationalCashBalance : null;
  const promotionSummary = dashboardAnalytics?.promotions;
  const promoKpis = [
    {
      label: "Promo Aktif",
      value: promotionSummary ? String(promotionSummary.active_count) : "—",
      helper: promotionSummary
        ? "Saat ini · " + promotionSummary.active_catalog_count + " katalog · " + promotionSummary.active_package_count + " paket" + (promotionSummary.loyalty_active ? " · loyalitas" : "")
        : "Informasi promo belum tersedia",
      icon: Tag,
      tone: "emerald",
      href: paths.eventPromotions,
    },
    {
      label: "Total Transaksi",
      value: dashboardAnalytics ? String(dashboardAnalytics.total_transaction_count) : "—",
      helper: "Rental & penjualan · periode terpilih",
      icon: ShoppingBag,
      tone: "violet",
      href: paths.laporan,
    },
    {
      label: "Nilai Diskon",
      value: dashboardAnalytics
        ? moneyForCurrency(discountSummary?.amount ?? 0, activeCurrency)
        : "—",
      helper: "Periode terpilih · " + activeCurrency,
      icon: TrendingDown,
      tone: "amber",
      href: paths.laporan,
    },
    {
      label: "Pembayaran Diterima",
      value: dashboardAnalytics
        ? moneyForCurrency(paymentSummary?.amount ?? 0, activeCurrency)
        : "—",
      helper: String(paymentSummary?.count ?? 0) + " pembayaran tercatat",
      icon: CreditCard,
      tone: "blue",
      href: paths.keuangan + "/pembayaran",
    },
  ] as const;

  return (
    <div data-testid="dashboard-root" className="space-y-4 pb-8 sm:space-y-5">
      <section className="relative overflow-hidden rounded-[1.45rem] border border-border/60 bg-card shadow-[0_8px_30px_rgba(35,55,45,.08)]">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: "url('/login-bg.webp')" }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-br from-white/88 via-white/80 to-emerald-50/55 dark:from-slate-950/85 dark:via-slate-950/75 dark:to-emerald-950/40"
        />
        <div className="relative z-10 flex min-h-[82px] items-center justify-between gap-3 px-4 py-3 sm:min-h-[88px] sm:px-5 sm:py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground sm:text-[9px]">Ringkasan Usaha</p>
            <h1 className="mt-0.5 truncate text-lg font-bold leading-tight tracking-[-0.03em] text-foreground sm:text-2xl">
              Selamat datang, {greetingName}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-semibold",
                  error
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700",
                )}
              >
                <span className={cn("size-1.5 rounded-full", error ? "bg-amber-500" : "bg-emerald-500")} aria-hidden="true" />
                {error ? "Perlu dimuat ulang" : "Source terhubung"}
              </span>
              <span className="text-[9px] text-muted-foreground sm:text-[10px]">Aktivitas rental & retail</span>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background/85 px-2.5 py-2 text-[9px] font-bold shadow-sm backdrop-blur-sm sm:px-3 sm:text-[10px]">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Mountain className="size-3" aria-hidden="true" />
            </span>
            Akasha Outdoor
          </span>
        </div>
      </section>

      <section aria-label="KPI promosi dan pembayaran" className="grid min-w-0 grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-4">
        {promoKpis.map((item) => {
          const Icon = item.icon;
          const toneClass = item.tone === "emerald"
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
            : item.tone === "violet"
              ? "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300"
              : item.tone === "amber"
                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                : "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300";
          return (
            <Link
              key={item.label}
              to={item.href}
              className="group min-w-0 rounded-[1.05rem] border border-border/60 bg-card p-3 shadow-[0_3px_14px_rgba(35,55,45,.045)] transition-colors hover:border-primary/25 hover:bg-muted/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-3.5"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[9px] font-semibold text-muted-foreground sm:text-[10px]">{item.label}</p>
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg sm:size-8 sm:rounded-xl", toneClass)}>
                  <Icon className="size-3.5 sm:size-4" aria-hidden="true" />
                </span>
              </div>
              <p className="mt-1 whitespace-nowrap text-[clamp(0.78rem,3.5vw,1.125rem)] font-bold leading-5 tracking-tight tabular-nums">{item.value}</p>
              <p className="mt-1.5 line-clamp-2 min-h-[2rem] text-[9px] leading-4 text-muted-foreground">{item.helper}</p>
            </Link>
          );
        })}
      </section>

      <section className="min-w-0 overflow-hidden rounded-[1.2rem] border border-border/60 bg-card p-3.5 shadow-[0_6px_24px_rgba(35,55,45,.055)] sm:p-4 lg:p-5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <TrendingUp className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-bold tracking-tight sm:text-sm">Arus Kas Usaha</h2>
              <p className="truncate text-[9px] text-muted-foreground sm:text-[10px]">Pergerakan uang masuk dan keluar</p>
            </div>
          </div>
          <FinancePeriodCompact
            compact
            timezone="Asia/Jakarta"
            selection={financePeriod.period}
            onPreset={financePeriod.setPreset}
            onCustomStart={financePeriod.setCustomStart}
            onCustomEnd={financePeriod.setCustomEnd}
          />
        </div>

        <div className="mt-3 grid min-w-0 gap-2">
          <div
            className={cn(
              "flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border px-3.5 py-3 sm:px-4",
              netCashValue !== null && netCashValue < 0
                ? "border-rose-500/70 bg-rose-700 text-white dark:border-rose-400/40 dark:bg-rose-900"
                : "border-emerald-500/70 bg-emerald-700 text-white dark:border-emerald-400/40 dark:bg-emerald-900",
            )}
            data-testid="dashboard-net-cash"
          >
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white">Net Cash</p>
              <p className="mt-0.5 text-[9px] font-medium text-white/85">Kas Operasional · saldo saat ini</p>
            </div>
            <p className="shrink-0 text-right text-base font-extrabold leading-tight tracking-tight tabular-nums text-white sm:text-xl">
              {netCashValue === null ? "—" : moneyForCurrency(netCashValue, activeCurrency)}
            </p>
          </div>
          <div className="grid min-w-0 grid-cols-3 gap-1.5 sm:gap-2">
            <div className="min-w-0 rounded-xl border border-border/70 bg-background/75 px-2.5 py-2.5 sm:px-3">
              <p className="truncate text-[8px] font-semibold text-muted-foreground sm:text-[9px]">Uang Masuk</p>
              <p className="mt-1 truncate text-[10px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300 sm:text-sm">
                {moneyForCurrency(cashflowTotals.income, activeCurrency)}
              </p>
            </div>
            <div className="min-w-0 rounded-xl border border-border/70 bg-background/75 px-2.5 py-2.5 sm:px-3">
              <p className="truncate text-[8px] font-semibold text-muted-foreground sm:text-[9px]">Uang Keluar</p>
              <p className="mt-1 truncate text-[10px] font-bold tabular-nums text-orange-700 dark:text-orange-300 sm:text-sm">
                {moneyForCurrency(cashflowTotals.expense, activeCurrency)}
              </p>
            </div>
            <div
              className={cn(
                "min-w-0 rounded-xl border px-2.5 py-2.5 sm:px-3",
                cashflowDifference > 0
                  ? "border-sky-400 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/45"
                  : cashflowDifference < 0
                    ? "border-rose-400 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/45"
                    : "border-border bg-muted/50",
              )}
              data-testid="dashboard-cashflow-difference"
              aria-label="Selisih arus kas pada rentang tanggal terpilih"
              title="Selisih uang masuk dan uang keluar pada periode terpilih"
            >
              <p className={cn(
                "truncate text-[8px] font-extrabold sm:text-[9px]",
                cashflowDifference > 0
                  ? "text-sky-800 dark:text-sky-200"
                  : cashflowDifference < 0
                    ? "text-rose-800 dark:text-rose-200"
                    : "text-foreground",
              )}>Selisih</p>
              <p className={cn(
                "mt-1 truncate text-[10px] font-extrabold tabular-nums sm:text-sm",
                cashflowDifference > 0
                  ? "text-sky-900 dark:text-sky-100"
                  : cashflowDifference < 0
                    ? "text-rose-900 dark:text-rose-100"
                    : "text-foreground",
              )}>
                {moneyForCurrency(cashflowDifference, activeCurrency)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              aria-pressed={showIncome}
              disabled={!showExpense}
              onClick={() => setShowIncome((value) => !value)}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[9px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60", showIncome ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-200" : "bg-muted text-muted-foreground")}
            >
              <span className="size-1.5 rounded-full bg-emerald-500" /> Pemasukan
            </button>
            <button
              type="button"
              aria-pressed={showExpense}
              disabled={!showIncome}
              onClick={() => setShowExpense((value) => !value)}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[9px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60", showExpense ? "bg-orange-50 text-orange-800 dark:bg-orange-950/35 dark:text-orange-200" : "bg-muted text-muted-foreground")}
            >
              <span className="size-1.5 rounded-full bg-orange-500" /> Pengeluaran
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {currencyOptions.length > 1 ? (
              <select
                aria-label="Mata uang grafik"
                value={activeCurrency}
                onChange={(event) => setSelectedCurrency(event.target.value)}
                className="h-7 max-w-[76px] rounded-lg border border-border/70 bg-background px-1.5 text-[9px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-none sm:px-2 sm:text-[10px]"
              >
                {currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            ) : (
              <span className="inline-flex h-7 items-center rounded-lg border border-border/70 bg-background px-2 text-[9px] font-semibold text-muted-foreground">{activeCurrency}</span>
            )}
            <div className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-0.5">
            <button
              type="button"
              aria-pressed={chartMode === "area"}
              onClick={() => setChartMode("area")}
              className={cn("h-6 rounded-md px-2.5 text-[9px] font-semibold transition-colors", chartMode === "area" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
            >
              Area
            </button>
            <button
              type="button"
              aria-pressed={chartMode === "line"}
              onClick={() => setChartMode("line")}
              className={cn("h-6 rounded-md px-2.5 text-[9px] font-semibold transition-colors", chartMode === "line" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
            >
              Line
            </button>
            </div>
          </div>
        </div>

        {dashboardAnalytics ? (
          currencyCashflow.length ? (
            <ChartContainer config={cashflowChartConfig} className="mt-2 h-[190px] w-full min-w-0 aspect-auto sm:h-[230px] lg:mt-3 lg:h-[260px]">
              {chartMode === "area" ? (
                <AreaChart data={currencyCashflow} margin={{ top: 8, right: 6, left: -14, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboard-income-gradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0F9F72" stopOpacity={0.3} />
                      <stop offset="92%" stopColor="#0F9F72" stopOpacity={0.015} />
                    </linearGradient>
                    <linearGradient id="dashboard-expense-gradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#E77A5D" stopOpacity={0.24} />
                      <stop offset="92%" stopColor="#E77A5D" stopOpacity={0.012} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 5" className="stroke-border/60" />
                  <XAxis dataKey="date" tickFormatter={formatBusinessDate} tickLine={false} axisLine={false} minTickGap={22} tick={{ fontSize: 9 }} />
                  <YAxis tickFormatter={compactMoney} tickLine={false} axisLine={false} width={48} tick={{ fontSize: 9 }} />
                  <ChartTooltip cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} content={<CashflowTooltip currencyCode={activeCurrency} />} />
                  {showIncome ? <Area type="monotone" dataKey="income" name="Pemasukan" stroke="#0F9F72" strokeWidth={2.5} fill="url(#dashboard-income-gradient)" activeDot={{ r: 4, strokeWidth: 2 }} isAnimationActive={!prefersReducedMotion} animationDuration={750} animationEasing="ease-out" /> : null}
                  {showExpense ? <Area type="monotone" dataKey="expense" name="Pengeluaran" stroke="#E77A5D" strokeWidth={2.3} fill="url(#dashboard-expense-gradient)" activeDot={{ r: 4, strokeWidth: 2 }} isAnimationActive={!prefersReducedMotion} animationDuration={750} animationEasing="ease-out" /> : null}
                </AreaChart>
              ) : (
                <LineChart data={currencyCashflow} margin={{ top: 8, right: 6, left: -14, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 5" className="stroke-border/60" />
                  <XAxis dataKey="date" tickFormatter={formatBusinessDate} tickLine={false} axisLine={false} minTickGap={22} tick={{ fontSize: 9 }} />
                  <YAxis tickFormatter={compactMoney} tickLine={false} axisLine={false} width={48} tick={{ fontSize: 9 }} />
                  <ChartTooltip cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} content={<CashflowTooltip currencyCode={activeCurrency} />} />
                  {showIncome ? <Line type="monotone" dataKey="income" name="Pemasukan" stroke="#0F9F72" strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 2 }} isAnimationActive={!prefersReducedMotion} animationDuration={650} /> : null}
                  {showExpense ? <Line type="monotone" dataKey="expense" name="Pengeluaran" stroke="#E77A5D" strokeWidth={2.3} dot={false} activeDot={{ r: 4, strokeWidth: 2 }} isAnimationActive={!prefersReducedMotion} animationDuration={650} /> : null}
                </LineChart>
              )}
            </ChartContainer>
          ) : (
            <div className="mt-3 grid h-[170px] place-items-center rounded-xl border border-dashed border-border/70 text-center">
              <div>
                <TrendingUp className="mx-auto size-6 text-muted-foreground/50" />
                <p className="mt-2 text-[11px] font-semibold">Belum ada pergerakan keuangan</p>
                <p className="mt-1 text-[9px] text-muted-foreground">Transaksi tercatat akan muncul pada periode ini.</p>
              </div>
            </div>
          )
        ) : (
          <div className="mt-3 grid h-[170px] place-items-center rounded-xl border border-dashed border-border/70 px-4 text-center">
            <div>
              <TrendingUp className="mx-auto size-6 text-muted-foreground/50" />
              <p className="mt-2 text-[11px] font-semibold">Grafik belum tersedia</p>
              <p className="mt-1 text-[9px] leading-4 text-muted-foreground">Pembaruan struktur ringkasan keuangan diperlukan sebelum grafik dapat dimuat.</p>
            </div>
          </div>
        )}
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
        <div className="mt-3 grid grid-cols-4 gap-2 max-[359px]:grid-cols-2 xl:grid-cols-7">
          {quickActions.map(([label, href, Icon]) => (
            <Link
              key={label}
              to={href}
              className="group flex min-h-[80px] flex-col items-center justify-center rounded-xl border border-border/60 bg-primary/5 px-1.5 py-2.5 text-center transition-colors hover:bg-primary/10 dark:bg-primary/10 dark:hover:bg-primary/15"
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
