import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, ArrowRight, CalendarClock, CalendarDays, ChevronLeft, ChevronRight,
  Filter, Inbox, RefreshCw, Search, ShieldAlert, Trash2,
} from "lucide-react";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { paths } from "@/routes/paths";
import {
  archiveAkashaSmartBookings,
  getAkashaSmartBookingCalendar,
  getAkashaSmartBookingSummary,
  listAkashaSmartBookings,
} from "@/features/akasha-smart-booking/service";
import type {
  AkashaSmartBookingListItem,
  AkashaSmartBookingListResult,
  AkashaSmartBookingStatus,
} from "@/features/akasha-smart-booking/types";
import { isAkashaSmartBookingArchivableStatus } from "@/features/akasha-smart-booking/types";
import {
  estimateSmartBookingTotal,
  resolveSmartBookingTotalDisplay,
} from "@/features/akasha-smart-booking/estimate";
import { getMyBusinessPermissions } from "@/features/event-promotions";
import { ReservationCalendar } from "./reservation-calendar";
import { getReservationCalendarRange } from "./reservation-calendar-utils";

const PAGE_SIZE = 25;
const QUERY_BATCH_SIZE = 100;
type ListFilter = "all" | "unconfirmed" | "attention" | "confirmed" | "done";

const FILTERS: Array<{ value: ListFilter; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "unconfirmed", label: "Belum konfirmasi" },
  { value: "attention", label: "Perlu tindakan" },
  { value: "confirmed", label: "Terkonfirmasi" },
  { value: "done", label: "Selesai" },
];

const FILTER_STATUSES: Record<Exclude<ListFilter, "all">, AkashaSmartBookingStatus[]> = {
  unconfirmed: ["received", "reviewing", "acknowledged"],
  attention: ["customer_action_required", "change_requested", "cancellation_pending"],
  confirmed: ["ready_for_checkout"],
  done: ["fulfilled"],
};

function statusLabel(status: AkashaSmartBookingStatus) {
  const labels: Record<AkashaSmartBookingStatus, string> = {
    received: "Belum dikonfirmasi",
    reviewing: "Belum dikonfirmasi",
    acknowledged: "Belum dikonfirmasi",
    customer_action_required: "Perlu respons",
    change_requested: "Perubahan diminta",
    cancellation_pending: "Pembatalan diminta",
    ready_for_checkout: "Terkonfirmasi",
    cancelled: "Dibatalkan",
    expired: "Kedaluwarsa",
    fulfilled: "Selesai",
  };
  return labels[status];
}

function statusClass(status: AkashaSmartBookingStatus) {
  if (["received", "reviewing", "acknowledged"].includes(status)) {
    return "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300";
  }
  if (["customer_action_required", "change_requested", "cancellation_pending"].includes(status)) {
    return "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }
  if (status === "ready_for_checkout") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "fulfilled") {
    return "border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-300";
  }
  return "border-border bg-muted/70 text-muted-foreground";
}

function dateOnly(value: string | null, timeZone = "Asia/Jakarta") {
  if (!value) return "Jadwal belum ditentukan";
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return "Tanggal tidak valid";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit", month: "short", year: "numeric", timeZone,
  }).format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12)));
}

function shortDate(value: string | null, timeZone = "Asia/Jakarta") {
  if (!value) return "Belum dijadwalkan";
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return "Belum dijadwalkan";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", timeZone,
  }).format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12)));
}

function dateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}
function currency(value: number, code = "IDR") {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: code, maximumFractionDigits: 0,
  }).format(value);
}

function shiftDate(value: string, amount: number) {
  const parts = value.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + amount, 12));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function statusPriority(status: AkashaSmartBookingStatus) {
  if (["cancellation_pending", "change_requested", "customer_action_required"].includes(status)) return 0;
  if (status === "received") return 1;
  return 2;
}

function compareBookings(a: AkashaSmartBookingListItem, b: AkashaSmartBookingListItem) {
  const priorityDifference = statusPriority(a.workflow_status) - statusPriority(b.workflow_status);
  if (priorityDifference !== 0) return priorityDifference;
  if (a.requested_pickup_date === null && b.requested_pickup_date !== null) return 1;
  if (a.requested_pickup_date !== null && b.requested_pickup_date === null) return -1;
  const pickupDifference = (a.requested_pickup_date ?? "").localeCompare(b.requested_pickup_date ?? "");
  return pickupDifference || a.created_at.localeCompare(b.created_at);
}

async function listStatusWindow(input: {
  usahaId: string;
  status: AkashaSmartBookingStatus;
  pickupFrom: string | null;
  pickupUntil: string | null;
  search: string;
  required: number;
}) {
  const first = await listAkashaSmartBookings({
    usahaId: input.usahaId,
    status: input.status,
    pickupFrom: input.pickupFrom,
    pickupUntil: input.pickupUntil,
    search: input.search,
    limit: Math.min(QUERY_BATCH_SIZE, input.required),
    offset: 0,
  });
  const items = [...first.items];
  let offset = items.length;
  const target = Math.min(first.total, input.required);

  while (offset < target) {
    const batch = await listAkashaSmartBookings({
      usahaId: input.usahaId,
      status: input.status,
      pickupFrom: input.pickupFrom,
      pickupUntil: input.pickupUntil,
      search: input.search,
      limit: Math.min(QUERY_BATCH_SIZE, target - offset),
      offset,
    });
    if (batch.items.length === 0) break;
    items.push(...batch.items);
    offset += batch.items.length;
  }

  return { items, total: first.total };
}

async function listFilteredBookings(input: {
  usahaId: string;
  filter: ListFilter;
  pickupFrom: string | null;
  pickupUntil: string | null;
  search: string;
  page: number;
}): Promise<AkashaSmartBookingListResult> {
  if (input.filter === "all") {
    return listAkashaSmartBookings({
      usahaId: input.usahaId,
      pickupFrom: input.pickupFrom,
      pickupUntil: input.pickupUntil,
      search: input.search,
      limit: PAGE_SIZE,
      offset: input.page * PAGE_SIZE,
    });
  }

  const statuses = FILTER_STATUSES[input.filter];
  const required = (input.page + 1) * PAGE_SIZE;
  const results = await Promise.all(statuses.map((status) => listStatusWindow({
    usahaId: input.usahaId,
    status,
    pickupFrom: input.pickupFrom,
    pickupUntil: input.pickupUntil,
    search: input.search,
    required,
  })));
  const allItems = results.flatMap((result) => result.items).sort(compareBookings);
  const offset = input.page * PAGE_SIZE;
  return {
    items: allItems.slice(offset, offset + PAGE_SIZE),
    total: results.reduce((sum, result) => sum + result.total, 0),
    limit: PAGE_SIZE,
    offset,
  };
}

function SummaryCard({
  label, value, icon: Icon, detail, tone, onClick,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  detail: string;
  tone: "amber" | "rose" | "sky" | "slate";
  onClick?: () => void;
}) {
  const toneClasses = {
    amber: "border-amber-500/20 bg-amber-500/[0.055]",
    rose: "border-rose-500/20 bg-rose-500/[0.055]",
    sky: "border-sky-500/20 bg-sky-500/[0.055]",
    slate: "border-slate-500/20 bg-slate-500/[0.045]",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={"group min-w-0 rounded-xl border p-2.5 text-left transition-colors hover:border-primary/30 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " + toneClasses}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold leading-4 text-muted-foreground">{label}</span>
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </span>
      <span className="mt-1 block text-xl font-bold leading-6 tracking-tight text-foreground">{value}</span>
      <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{detail}</span>
    </button>
  );
}

function FilterChip({
  active, children, count, onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-transparent bg-muted/45 text-muted-foreground hover:border-border hover:bg-muted",
      ].join(" ")}
    >
      {children}
      <span className={active ? "rounded-full bg-white/20 px-1.5 py-0.5 text-[9px]" : "rounded-full bg-background/80 px-1.5 py-0.5 text-[9px]"}>
        {count}
      </span>
    </button>
  );
}

export function AkashaSmartBookingList() {
  const { status: tenantStatus, current, error: tenantError } = useCurrentUsaha();
  const [activeView, setActiveView] = useState<"calendar" | "list">("calendar");
  const [calendarMonth, setCalendarMonth] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [pickupFrom, setPickupFrom] = useState("");
  const [pickupUntil, setPickupUntil] = useState("");
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedBookingIds, setSelectedBookingIds] = useState<string[]>([]);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const permissions = useQuery({
    queryKey: ["akasha-smart-booking", "permissions", current?.usahaId],
    enabled: tenantStatus === "ready" && Boolean(current?.usahaId),
    queryFn: () => getMyBusinessPermissions(current!.usahaId),
    staleTime: 30_000,
  });
  const canArchiveBookings = permissions.isSuccess
    && permissions.data.includes("reservation.amend");

  const summary = useQuery({
    queryKey: ["akasha-smart-booking", "summary", current?.usahaId],
    enabled: tenantStatus === "ready" && Boolean(current?.usahaId),
    queryFn: () => getAkashaSmartBookingSummary(current!.usahaId),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const data = summary.data;
  const businessToday = data?.today_business_date ?? "";
  const bookings = useQuery({
    queryKey: [
      "akasha-smart-booking", "list", current?.usahaId, filter,
      appliedSearch, pickupFrom, pickupUntil, page,
    ],
    enabled: tenantStatus === "ready" && Boolean(current?.usahaId) && activeView === "list",
    queryFn: () => listFilteredBookings({
      usahaId: current!.usahaId,
      filter,
      pickupFrom: pickupFrom || null,
      pickupUntil: pickupUntil || null,
      search: appliedSearch,
      page,
    }),
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (businessToday && !selectedDate) {
      setSelectedDate(businessToday);
      setCalendarMonth(businessToday.slice(0, 7));
    }
  }, [businessToday, selectedDate]);

  const browserToday = new Date();
  const browserDate = [
    browserToday.getFullYear(),
    String(browserToday.getMonth() + 1).padStart(2, "0"),
    String(browserToday.getDate()).padStart(2, "0"),
  ].join("-");
  const effectiveMonth = calendarMonth || businessToday.slice(0, 7) || browserDate.slice(0, 7);
  const calendarRange = useMemo(
    () => getReservationCalendarRange(effectiveMonth),
    [effectiveMonth],
  );
  const calendar = useQuery({
    queryKey: [
      "akasha-smart-booking", "calendar", current?.usahaId,
      calendarRange.from, calendarRange.until, selectedDate,
    ],
    enabled: tenantStatus === "ready" && Boolean(current?.usahaId && selectedDate) && activeView === "calendar",
    queryFn: () => getAkashaSmartBookingCalendar({
      usahaId: current!.usahaId,
      dateFrom: calendarRange.from,
      dateUntil: calendarRange.until,
      selectedDate,
    }),
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  const estimateSources = useMemo(() => ({
    list: bookings.data?.items ?? [],
    agenda: calendar.data?.agenda ?? [],
  }), [bookings.data?.items, calendar.data?.agenda]);
  const listEstimates = useMemo(() => new Map(estimateSources.list.map((item) => {
    const calculated = estimateSmartBookingTotal(
      item.line_summary.map((line) => ({ ...line, unit_price: Number(line.unit_price) })),
      item.requested_pickup_date,
      item.requested_return_date,
      {
        pickupAt: item.requested_pickup_at,
        returnAt: item.requested_return_at,
      },
    );
    return [
      item.smart_booking_id,
      resolveSmartBookingTotalDisplay(calculated.total, Number(item.quote_total)),
    ] as const;
  })), [estimateSources.list]);
  const calendarEstimates = useMemo(() => new Map(estimateSources.agenda.map((item) => {
    const calculated = estimateSmartBookingTotal(
      item.line_summary.map((line) => ({ ...line, unit_price: Number(line.unit_price) })),
      item.requested_pickup_date,
      item.requested_return_date,
      {
        pickupAt: item.requested_pickup_at,
        returnAt: item.requested_return_at,
      },
    );
    return [
      item.smart_booking_id,
      resolveSmartBookingTotalDisplay(calculated.total, Number(item.quote_total)),
    ] as const;
  })), [estimateSources.agenda]);

  useEffect(() => {
    setSelectedBookingIds([]);
  }, [filter, appliedSearch, pickupFrom, pickupUntil, page]);

  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (!current?.usahaId || selectedBookingIds.length === 0) {
        throw new Error("Pilih reservasi yang akan dihapus terlebih dahulu.");
      }
      return archiveAkashaSmartBookings({
        usahaId: current.usahaId,
        smartBookingIds: selectedBookingIds,
      });
    },
    onSuccess: async () => {
      setSelectedBookingIds([]);
      setArchiveDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["akasha-smart-booking", "list", current?.usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["akasha-smart-booking", "summary", current?.usahaId] }),
        queryClient.invalidateQueries({ queryKey: ["akasha-smart-booking", "calendar", current?.usahaId] }),
      ]);
    },
  });

  const archivableVisibleIds = (canArchiveBookings ? bookings.data?.items ?? [] : [])
    .filter((item) => isAkashaSmartBookingArchivableStatus(item.workflow_status))
    .map((item) => item.smart_booking_id);
  const allVisibleSelected = archivableVisibleIds.length > 0
    && archivableVisibleIds.every((id) => selectedBookingIds.includes(id));

  const unconfirmedCount = data ? data.received + data.reviewing + data.acknowledged : 0;
  const attentionCount = data ? data.customer_action_required + data.change_requested + data.cancellation_pending : 0;
  const confirmedCount = data?.ready_for_checkout ?? 0;
  const fulfilledCount = data?.fulfilled ?? 0;
  const totalPages = Math.max(1, Math.ceil((bookings.data?.total ?? 0) / PAGE_SIZE));
  const hasCustomDates = Boolean(pickupFrom || pickupUntil);
  const nextSevenDays = businessToday ? shiftDate(businessToday, 6) : "";

  const cards = data ? [
    {
      label: "Belum dikonfirmasi",
      value: unconfirmedCount,
      icon: Inbox,
      detail: "Menunggu konfirmasi admin",
      tone: "amber" as const,
      action: () => { setFilter("unconfirmed"); setPickupFrom(""); setPickupUntil(""); setShowDateFilter(false); setActiveView("list"); setPage(0); },
    },
    {
      label: "Perlu tindakan",
      value: attentionCount,
      icon: ShieldAlert,
      detail: "Perlu perhatian pelanggan",
      tone: "rose" as const,
      action: () => { setFilter("attention"); setPickupFrom(""); setPickupUntil(""); setShowDateFilter(false); setActiveView("list"); setPage(0); },
    },
    {
      label: "Pengambilan hari ini",
      value: data.pickup_today,
      icon: CalendarClock,
      detail: businessToday ? dateOnly(businessToday, data.business_timezone) : "Jadwal hari ini",
      tone: "sky" as const,
      action: () => {
        setFilter("all");
        setPickupFrom(businessToday);
        setPickupUntil(businessToday);
        setShowDateFilter(false);
        setActiveView("list");
        setPage(0);
      },
    },
    {
      label: "Pengambilan besok",
      value: data.pickup_tomorrow,
      icon: CalendarDays,
      detail: businessToday ? dateOnly(shiftDate(businessToday, 1), data.business_timezone) : "Jadwal berikutnya",
      tone: "slate" as const,
      action: () => {
        setFilter("all");
        const tomorrow = shiftDate(businessToday, 1);
        setPickupFrom(tomorrow);
        setPickupUntil(tomorrow);
        setShowDateFilter(false);
        setActiveView("list");
        setPage(0);
      },
    },
  ] : [];

  if (tenantStatus === "loading") {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 rounded-xl" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[76px] rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (tenantStatus === "error" || !current) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Reservasi belum dapat dibuka</AlertTitle>
        <AlertDescription>{tenantError?.message ?? "Usaha aktif belum tersedia."}</AlertDescription>
      </Alert>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-3 pb-24 sm:space-y-4 sm:pb-8" data-testid="akasha-smart-booking-list">
      <header className="flex items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/8 text-primary">
            <CalendarClock className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-primary/80">Operasional</p>
            <h1 className="text-lg font-bold leading-5 tracking-tight">Reservasi</h1>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">Booking dan jadwal pengambilan barang.</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 rounded-lg px-2.5 text-[11px]"
          onClick={() => { void summary.refetch(); void bookings.refetch(); void calendar.refetch(); }}
          disabled={summary.isFetching || bookings.isFetching || calendar.isFetching}
        >
          <RefreshCw className={"size-3 " + (summary.isFetching || bookings.isFetching || calendar.isFetching ? "animate-spin" : "")} />
          Perbarui
        </Button>
      </header>

      {summary.error ? (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="size-3.5" />
          <AlertTitle className="text-xs">Ringkasan belum dapat dimuat</AlertTitle>
          <AlertDescription className="text-[11px]">Coba perbarui halaman.</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-2.5" aria-label="Ringkasan operasional reservasi">
        {cards.length > 0
          ? cards.map((item) => <SummaryCard key={item.label} {...item} onClick={item.action} />)
          : Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[76px] rounded-xl" />)}
      </section>

      <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-muted/35 p-1" role="tablist" aria-label="Tampilan reservasi">
        <Button
          type="button"
          size="sm"
          variant={activeView === "calendar" ? "default" : "ghost"}
          role="tab"
          aria-selected={activeView === "calendar"}
          className="h-8 flex-1 rounded-lg text-[11px] sm:flex-none sm:px-4"
          onClick={() => setActiveView("calendar")}
        >
          <CalendarDays className="size-3.5" /> Kalender
        </Button>
        <Button
          type="button"
          size="sm"
          variant={activeView === "list" ? "default" : "ghost"}
          role="tab"
          aria-selected={activeView === "list"}
          className="h-8 flex-1 rounded-lg text-[11px] sm:flex-none sm:px-4"
          onClick={() => setActiveView("list")}
        >
          <Inbox className="size-3.5" /> Daftar & tindak lanjut
        </Button>
      </div>

      {activeView === "calendar" ? (
        <ReservationCalendar
          month={effectiveMonth}
          selectedDate={selectedDate || businessToday || browserDate}
          data={calendar.data}
          estimates={calendarEstimates}
          isLoading={calendar.isLoading}
          error={calendar.error}
          todayBusinessDate={businessToday}
          onMonthChange={(nextMonth) => {
            setCalendarMonth(nextMonth);
            setSelectedDate(nextMonth + "-01");
          }}
          onDateSelect={(date) => {
            setCalendarMonth(date.slice(0, 7));
            setSelectedDate(date);
          }}
          onRetry={() => void calendar.refetch()}
          onShowList={() => setActiveView("list")}
        />
      ) : (
        <>
          <section className="rounded-xl border border-border/70 bg-card p-2.5 sm:p-3" aria-label="Pencarian dan filter reservasi">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(0); }}
                placeholder="Cari nama, WhatsApp, atau kode booking"
                className="h-9 rounded-lg border-border/70 bg-background pl-9 text-xs"
                aria-label="Cari reservasi"
              />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {FILTERS.map((option) => {
                const count = option.value === "all"
                  ? (data?.total ?? 0)
                  : option.value === "unconfirmed"
                    ? unconfirmedCount
                    : option.value === "attention"
                      ? attentionCount
                      : option.value === "confirmed"
                        ? confirmedCount
                        : fulfilledCount;
                return (
                  <FilterChip
                    key={option.value}
                    active={filter === option.value}
                    count={count}
                    onClick={() => { setFilter(option.value); setPage(0); }}
                  >
                    {option.label}
                  </FilterChip>
                );
              })}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant={!hasCustomDates ? "secondary" : "ghost"}
                size="sm"
                className="h-7 rounded-lg px-2.5 text-[10px]"
                onClick={() => { setPickupFrom(""); setPickupUntil(""); setShowDateFilter(false); setPage(0); }}
              >
                Semua tanggal
              </Button>
              <Button
                type="button"
                variant={pickupFrom === businessToday && pickupUntil === businessToday ? "secondary" : "ghost"}
                size="sm"
                className="h-7 rounded-lg px-2.5 text-[10px]"
                onClick={() => { setPickupFrom(businessToday); setPickupUntil(businessToday); setShowDateFilter(false); setPage(0); }}
                disabled={!businessToday}
              >
                Hari ini
              </Button>
              <Button
                type="button"
                variant={pickupFrom === businessToday && pickupUntil === nextSevenDays && Boolean(businessToday) ? "secondary" : "ghost"}
                size="sm"
                className="h-7 rounded-lg px-2.5 text-[10px]"
                onClick={() => { setPickupFrom(businessToday); setPickupUntil(nextSevenDays); setShowDateFilter(false); setPage(0); }}
                disabled={!businessToday}
              >
                7 hari
              </Button>
              <Button
                type="button"
                variant={showDateFilter ? "secondary" : "ghost"}
                size="sm"
                className="h-7 rounded-lg px-2.5 text-[10px]"
                onClick={() => setShowDateFilter((value) => !value)}
              >
                <CalendarDays className="size-3" /> Pilih tanggal
              </Button>
              {hasCustomDates ? (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {pickupFrom ? shortDate(pickupFrom, data?.business_timezone) : "Awal"} – {pickupUntil ? shortDate(pickupUntil, data?.business_timezone) : "Akhir"}
                </span>
              ) : null}
            </div>

            {showDateFilter ? (
              <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-border/60 bg-muted/25 p-2">
                <label className="min-w-0 space-y-1 text-[10px] font-medium text-muted-foreground">
                  Dari tanggal
                  <Input type="date" value={pickupFrom} onChange={(event) => { setPickupFrom(event.target.value); setPage(0); }} className="h-8 w-full rounded-md bg-background text-xs" />
                </label>
                <label className="min-w-0 space-y-1 text-[10px] font-medium text-muted-foreground">
                  Sampai tanggal
                  <Input type="date" value={pickupUntil} onChange={(event) => { setPickupUntil(event.target.value); setPage(0); }} className="h-8 w-full rounded-md bg-background text-xs" />
                </label>
                <div className="col-span-2 flex justify-end">
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => { setPickupFrom(""); setPickupUntil(""); setShowDateFilter(false); setPage(0); }}>
                    <Filter className="size-3" /> Hapus tanggal
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          {bookings.error ? (
            <Alert variant="destructive" className="py-2">
              <AlertTitle className="text-xs">Daftar reservasi belum dapat dimuat</AlertTitle>
              <AlertDescription className="text-[11px]">Periksa koneksi lalu coba kembali.</AlertDescription>
            </Alert>
          ) : null}

          <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm" data-testid="reservation-list-panel">
                        <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/25 px-3 py-2.5 sm:px-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">Daftar reservasi</span>
                <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px]">{bookings.data?.total ?? 0}</Badge>
              </div>
              <div className="flex items-center gap-2">
                {archivableVisibleIds.length > 0 ? (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      aria-label="Pilih semua reservasi belum dikonfirmasi, terkonfirmasi, dan selesai pada halaman ini"
                      checked={allVisibleSelected}
                      onChange={(event) => setSelectedBookingIds(event.target.checked
                        ? [...new Set([...selectedBookingIds, ...archivableVisibleIds])]
                        : selectedBookingIds.filter((id) => !archivableVisibleIds.includes(id)))}
                      className="size-3.5 rounded border-border accent-primary"
                    />
                    Pilih semua
                  </label>
                ) : null}
                <span className="text-[10px] text-muted-foreground">
                  {bookings.data ? String(page + 1) + " / " + String(totalPages) : "Memuat…"}
                </span>
              </div>
            </div>
            {selectedBookingIds.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/15 bg-primary/[0.035] px-3 py-2 sm:px-4">
                <span className="text-[10px] font-semibold">{selectedBookingIds.length} reservasi dipilih</span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-7 rounded-lg px-2.5 text-[10px]"
                  onClick={() => { archiveMutation.reset(); setArchiveDialogOpen(true); }}
                  disabled={archiveMutation.isPending}
                >
                  <Trash2 className="size-3" /> Hapus dipilih
                </Button>
              </div>
            ) : null}

            {bookings.isLoading ? (
              <div className="space-y-2 p-3" data-testid="reservation-list-loading">
                {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[76px] rounded-lg" />)}
              </div>
            ) : !bookings.data?.items.length ? (
              <div className="flex min-h-36 flex-col items-center justify-center px-4 py-8 text-center">
                <span className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground"><Inbox className="size-4" /></span>
                <h2 className="mt-2.5 text-xs font-semibold">Belum ada reservasi pada filter ini</h2>
                <p className="mt-1 max-w-sm text-[10px] leading-4 text-muted-foreground">
                  Ubah filter atau kata pencarian untuk melihat reservasi lainnya.
                </p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-border/70">
                  {bookings.data.items.map((item) => (
                    <div key={item.smart_booking_id} className="flex min-w-0 items-stretch gap-2 px-2 sm:px-3">
                      {canArchiveBookings && isAkashaSmartBookingArchivableStatus(item.workflow_status) ? (
                        <input
                          type="checkbox"
                          aria-label={"Pilih reservasi " + item.reference_code + " untuk dihapus"}
                          checked={selectedBookingIds.includes(item.smart_booking_id)}
                          onChange={(event) => setSelectedBookingIds((previous) => event.target.checked
                            ? [...previous, item.smart_booking_id]
                            : previous.filter((id) => id !== item.smart_booking_id))}
                          className="mt-4 size-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                        />
                      ) : <span className="w-4 shrink-0" aria-hidden="true" />}
                    <Link
                      to={paths.reservasi + "/" + item.smart_booking_id}
                      data-testid="reservation-list-item"
                      className={[
                        "group relative grid min-w-0 flex-1 gap-2 border-l-[3px] px-2 py-3 transition-colors hover:bg-muted/25 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-3",

                        item.workflow_status === "ready_for_checkout"
                          ? "border-l-emerald-500"
                          : ["customer_action_required", "change_requested", "cancellation_pending"].includes(item.workflow_status)
                            ? "border-l-rose-500"
                            : ["cancelled", "expired", "fulfilled"].includes(item.workflow_status)
                              ? "border-l-slate-400"
                              : "border-l-amber-500",
                      ].join(" ")}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-bold tracking-wide">{item.reference_code}</span>
                          <Badge variant="outline" className={"h-5 rounded-full px-2 text-[9px] " + statusClass(item.workflow_status)}>
                            {statusLabel(item.workflow_status)}
                          </Badge>
                          {item.workflow_status === "ready_for_checkout" ? (
                            <Badge variant="outline" className="h-5 rounded-full border-emerald-500/20 bg-emerald-500/[0.06] px-2 text-[9px] text-emerald-700 dark:text-emerald-300">
                              Siap diproses
                            </Badge>
                          ) : null}
                          {item.pending_change_count > 0 ? (
                            <Badge variant="outline" className="h-5 rounded-full border-rose-500/20 bg-rose-500/10 px-2 text-[9px] text-rose-700 dark:text-rose-300">
                              {item.pending_change_count} tindak lanjut
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-sm font-semibold leading-5">{item.customer_name}</p>
                        <p className="text-[10px] text-muted-foreground">{item.customer_phone}</p>
                      </div>
                      <div className="flex min-w-0 items-end justify-between gap-3 border-t border-border/50 pt-2 sm:items-center sm:justify-end sm:border-0 sm:pt-0">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold text-foreground">
                            Ambil {shortDate(item.requested_pickup_date, data?.business_timezone)}
                          </p>
                          <p className="mt-0.5 text-[9px] text-muted-foreground">
                            {item.requested_return_date
                              ? "Kembali " + shortDate(item.requested_return_date, data?.business_timezone)
                              : dateTime(item.created_at)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="text-right">
                            <p className="text-xs font-bold">
                              {listEstimates.get(item.smart_booking_id)?.total == null
                                ? "Nominal belum tersedia"
                                : currency(listEstimates.get(item.smart_booking_id)!.total as number, item.currency_code)}
                            </p>
                            <p className="text-[9px] text-muted-foreground">
                              {listEstimates.get(item.smart_booking_id)?.source === "snapshot" ? "Nominal saat booking" : "Total estimasi"}
                            </p>
                          </div>
                          <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                        </div>
                      </div>
                    </Link>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border/70 bg-muted/15 px-3 py-2.5 sm:px-4">
                  <span className="text-[10px] text-muted-foreground">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, bookings.data.total)} dari {bookings.data.total}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" className="h-7 px-2 text-[10px]" disabled={page === 0 || bookings.isFetching} onClick={() => setPage((value) => Math.max(0, value - 1))}>
                      <ChevronLeft className="size-3" /> Sebelumnya
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-[10px]" disabled={page + 1 >= totalPages || bookings.isFetching} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>
                      Berikutnya <ChevronRight className="size-3" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      )}
      <Dialog
        open={archiveDialogOpen}
        onOpenChange={(open) => {
          if (!archiveMutation.isPending) setArchiveDialogOpen(open);
        }}
      >
        <DialogContent className="w-[calc(100%-1rem)] max-w-md rounded-2xl p-4 sm:p-5">
          <DialogHeader className="space-y-1.5 text-left">
            <DialogTitle className="flex items-center gap-2 text-base text-destructive">
              <Trash2 className="size-4" /> Hapus reservasi terpilih?
            </DialogTitle>
            <DialogDescription className="text-xs leading-5">
              {selectedBookingIds.length} reservasi yang belum dikonfirmasi, terkonfirmasi, atau selesai akan diarsipkan dari daftar aktif. Kode akses pelanggan dinonaktifkan. Riwayat booking serta catatan transaksi penyewaan, penjualan, checkout, dan keuangan tetap disimpan untuk menjaga integritas laporan.
            </DialogDescription>
          </DialogHeader>
          {archiveMutation.isError ? (
            <Alert variant="destructive" className="py-2">
              <AlertTitle className="text-xs">Penghapusan belum berhasil</AlertTitle>
              <AlertDescription className="text-[10px]">
                {archiveMutation.error instanceof Error ? archiveMutation.error.message : "Periksa status reservasi lalu coba kembali."}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 flex-1 text-xs sm:flex-none"
              onClick={() => setArchiveDialogOpen(false)}
              disabled={archiveMutation.isPending}
            >
              Kembali
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-9 flex-1 text-xs sm:flex-none"
              onClick={() => archiveMutation.mutate()}
              disabled={archiveMutation.isPending || selectedBookingIds.length === 0}
            >
              {archiveMutation.isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Hapus {selectedBookingIds.length} reservasi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
