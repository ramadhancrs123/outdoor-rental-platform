import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle, ArrowRight, CalendarClock, CalendarDays,
  Filter, Inbox, RefreshCw, Search, ShieldAlert, Users,
} from "lucide-react";
import { useCurrentUsaha } from "@/app/current-usaha-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { paths } from "@/routes/paths";
import {
  getAkashaSmartBookingSummary,
  listAkashaSmartBookings,
} from "@/features/akasha-smart-booking/service";
import type {
  AkashaSmartBookingStatus,
} from "@/features/akasha-smart-booking/types";

const PAGE_SIZE = 25;
const STATUS_FILTERS: Array<{ value: "all" | AkashaSmartBookingStatus; label: string }> = [
  { value: "all", label: "Semua status" },
  { value: "received", label: "Baru diterima" },
  { value: "reviewing", label: "Sedang ditinjau" },
  { value: "acknowledged", label: "Sudah ditinjau" },
  { value: "customer_action_required", label: "Menunggu customer" },
  { value: "change_requested", label: "Perubahan diminta" },
  { value: "cancellation_pending", label: "Pembatalan diminta" },
  { value: "ready_for_checkout", label: "Siap checkout" },
  { value: "cancelled", label: "Dibatalkan" },
  { value: "expired", label: "Kedaluwarsa" },
  { value: "fulfilled", label: "Selesai" },
];

function statusLabel(status: AkashaSmartBookingStatus) {
  const labels: Record<AkashaSmartBookingStatus, string> = {
    received: "Baru",
    reviewing: "Ditinjau",
    acknowledged: "Ditinjau",
    customer_action_required: "Menunggu customer",
    change_requested: "Perubahan diminta",
    cancellation_pending: "Pembatalan diminta",
    ready_for_checkout: "Siap checkout",
    cancelled: "Dibatalkan",
    expired: "Kedaluwarsa",
    fulfilled: "Dikonversi",
  };
  return labels[status];
}

function statusVariant(status: AkashaSmartBookingStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "received" || status === "change_requested" || status === "cancellation_pending") return "default";
  if (status === "customer_action_required") return "destructive";
  if (status === "ready_for_checkout" || status === "fulfilled") return "secondary";
  return "outline";
}

function dateOnly(value: string | null, timeZone = "Asia/Jakarta") {
  if (!value) return "Jadwal belum ditentukan";
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return "Tanggal tidak valid";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit", month: "short", year: "numeric", timeZone,
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

function SummaryCard({
  label, value, icon: Icon, detail,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  detail?: string;
}) {
  return (
    <Card className="border-border/70 shadow-none">
      <CardContent className="flex items-center gap-3 p-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-xl font-bold tracking-tight">{value}</p>
          {detail ? <p className="truncate text-[10px] text-muted-foreground">{detail}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function AkashaSmartBookingList() {
  const { status: tenantStatus, current, error: tenantError } = useCurrentUsaha();
  const [filter, setFilter] = useState<"all" | AkashaSmartBookingStatus>("all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [pickupFrom, setPickupFrom] = useState("");
  const [pickupUntil, setPickupUntil] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const summary = useQuery({
    queryKey: ["akasha-smart-booking", "summary", current?.usahaId],
    enabled: tenantStatus === "ready" && Boolean(current?.usahaId),
    queryFn: () => getAkashaSmartBookingSummary(current!.usahaId),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const bookings = useQuery({
    queryKey: [
      "akasha-smart-booking", "list", current?.usahaId, filter,
      appliedSearch, pickupFrom, pickupUntil, page,
    ],
    enabled: tenantStatus === "ready" && Boolean(current?.usahaId),
    queryFn: () => listAkashaSmartBookings({
      usahaId: current!.usahaId,
      status: filter,
      pickupFrom: pickupFrom || null,
      pickupUntil: pickupUntil || null,
      search: appliedSearch,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  const totalPages = Math.max(1, Math.ceil((bookings.data?.total ?? 0) / PAGE_SIZE));
  const data = summary.data;
  const cards = data ? [
    { label: "Booking baru", value: data.received, icon: Inbox },
    {
      label: "Perlu tindak lanjut",
      value: data.customer_action_required + data.change_requested + data.cancellation_pending,
      icon: ShieldAlert,
      detail: data.pending_change_requests + " permintaan perubahan pending",
    },
    { label: "Pengambilan hari ini", value: data.pickup_today, icon: CalendarClock, detail: data.today_business_date },
    { label: "Pengambilan besok", value: data.pickup_tomorrow, icon: CalendarDays, detail: data.business_timezone },
  ] : [];

  if (tenantStatus === "loading") {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (tenantStatus === "error" || !current) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Booking online belum dapat dibuka</AlertTitle>
        <AlertDescription>{tenantError?.message ?? "Usaha aktif belum tersedia."}</AlertDescription>
      </Alert>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 pb-8 sm:space-y-5" data-testid="akasha-smart-booking-list">
      <header className="flex flex-col gap-3 border-b border-border/70 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/5 text-primary">
            <CalendarClock className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary/80">Kanal website</p>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Booking Online</h1>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Tinjau permintaan customer, pantau proyeksi stok, dan tindak lanjuti perubahan.
            </p>
          </div>
        </div>
        <Button
          type="button" variant="outline" size="sm"
          className="h-9 self-start rounded-lg text-xs sm:self-auto"
          onClick={() => { void summary.refetch(); void bookings.refetch(); }}
          disabled={summary.isFetching || bookings.isFetching}
        >
          <RefreshCw className={"size-3.5 " + (summary.isFetching || bookings.isFetching ? "animate-spin" : "")} />
          Perbarui
        </Button>
      </header>

      <Alert className="border-amber-500/25 bg-amber-500/[0.04]">
        <ShieldAlert className="size-4 text-amber-600" />
        <AlertTitle className="text-sm">Booking bukan penguncian stok</AlertTitle>
        <AlertDescription className="text-xs leading-5">
          Angka ketersediaan pada detail merupakan proyeksi saat diperiksa. Barang belum dialokasikan dan harus diverifikasi kembali melalui alur penyewaan/penjualan operasional.
        </AlertDescription>
      </Alert>

      {summary.error ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Ringkasan belum dapat dimuat</AlertTitle>
          <AlertDescription>{summary.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4" aria-label="Ringkasan booking">
        {cards.length > 0
          ? cards.map((item) => <SummaryCard key={item.label} {...item} />)
          : Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[78px] rounded-xl" />)}
      </section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="border-border/70 shadow-none">
          <CardContent className="space-y-3 p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(0); }}
                  placeholder="Cari referensi, nama, WA, atau barang"
                  className="h-9 rounded-lg pl-9 text-xs"
                  aria-label="Cari booking"
                />
              </div>
              <select
                value={filter}
                onChange={(event) => { setFilter(event.target.value as typeof filter); setPage(0); }}
                className="h-9 min-w-[155px] rounded-lg border border-input bg-background px-3 text-xs"
                aria-label="Filter status booking"
              >
                {STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>Pengambilan dari</span>
                <Input type="date" value={pickupFrom} onChange={(event) => { setPickupFrom(event.target.value); setPage(0); }} className="h-8 w-[145px] rounded-lg text-xs" />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>sampai</span>
                <Input type="date" value={pickupUntil} onChange={(event) => { setPickupUntil(event.target.value); setPage(0); }} className="h-8 w-[145px] rounded-lg text-xs" />
              </label>
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-[11px]" onClick={() => { setPickupFrom(""); setPickupUntil(""); setFilter("all"); setSearch(""); setAppliedSearch(""); setPage(0); }}>
                <Filter className="size-3.5" /> Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-none">
          <CardContent className="flex h-full items-center gap-3 p-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
              <Users className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">Seluruh booking</p>
              <p className="text-xl font-bold">{data?.total ?? "—"}</p>
              <p className="text-[10px] text-muted-foreground">Termasuk booking yang sudah ditutup</p>
            </div>
          </CardContent>
        </Card>
      </section>

      {bookings.error ? (
        <Alert variant="destructive">
          <AlertTitle>Daftar booking belum dapat dimuat</AlertTitle>
          <AlertDescription>{bookings.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/20 px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">Antrian booking</span>
            <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px]">{bookings.data?.total ?? 0}</Badge>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {bookings.data ? "Halaman " + (page + 1) + " dari " + totalPages : "Memuat daftar"}
          </span>
        </div>

        {bookings.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-16 rounded-lg" />)}
          </div>
        ) : !bookings.data?.items.length ? (
          <div className="flex min-h-52 flex-col items-center justify-center px-4 py-10 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground"><Inbox className="size-5" /></span>
            <h2 className="mt-3 text-sm font-semibold">Belum ada booking pada filter ini</h2>
            <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">Permintaan baru dari website akan muncul di antrian ini setelah customer mengirim formulir booking.</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border/70">
              {bookings.data.items.map((item) => (
                <Link
                  key={item.smart_booking_id}
                  to={paths.akashaSmartBooking + "/" + item.smart_booking_id}
                  className="group flex flex-col gap-2 px-3 py-3 transition-colors hover:bg-muted/25 sm:flex-row sm:items-center sm:justify-between sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold tracking-wide">{item.reference_code}</span>
                      <Badge variant={statusVariant(item.workflow_status)} className="h-5 rounded-full px-2 text-[10px]">
                        {statusLabel(item.workflow_status)}
                      </Badge>
                      {item.pending_change_count > 0 ? (
                        <Badge variant="destructive" className="h-5 rounded-full px-2 text-[10px]">
                          {item.pending_change_count} perubahan
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-sm font-semibold">{item.customer_name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {item.line_summary.slice(0, 2).map((line) =>
                        (line.kind === "rental" ? "Sewa" : "Beli") + " · " + line.name + (line.variant ? " / " + line.variant : "") + " × " + line.quantity,
                      ).join(" · ")}
                      {item.line_summary.length > 2 ? " · +" + (item.line_summary.length - 2) + " item" : ""}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="text-left sm:text-right">
                      <p className="text-xs font-semibold">{dateOnly(item.requested_pickup_date, data?.business_timezone)}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{item.requested_return_date ? "Kembali " + dateOnly(item.requested_return_date, data?.business_timezone) : dateTime(item.created_at)}</p>
                    </div>
                    <span className="min-w-[112px] text-right text-xs font-semibold">{currency(item.quote_total, item.currency_code)}</span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                </Link>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border/70 px-3 py-2.5 sm:px-4">
              <span className="text-[10px] text-muted-foreground">
                Menampilkan {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, bookings.data.total)} dari {bookings.data.total}
              </span>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" className="h-8 text-xs" disabled={page === 0 || bookings.isFetching} onClick={() => setPage((value) => Math.max(0, value - 1))}>Sebelumnya</Button>
                <Button variant="outline" size="sm" className="h-8 text-xs" disabled={page + 1 >= totalPages || bookings.isFetching} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>Berikutnya</Button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
